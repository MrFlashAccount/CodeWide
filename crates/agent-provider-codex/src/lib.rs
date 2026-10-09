//! Codex provider adapter: the in-process `AgentProvider` over the Codex App
//! Server connection (`UpstreamHandle`), the account pool and the Codex
//! storage modules.
//!
//! The adapter maps neutral operations to App Server methods and publishes
//! every App Server notification and server request unchanged through the
//! `codex.native` compatibility surface, which is how Codex threads keep a
//! byte-identical client wire. The account pool runs only inside this
//! adapter (`admit_turn`, `turn/start` and `thread/settings/update`
//! dispatch), so other providers bypass it without any name check.
//! The Codex storage modules (rollout history, catalog, message search and
//! thread resources) are reached only through this adapter's
//! [`storage::CodexStorage`], exposed on the `codex.native` surface.
//! See `CONTEXT.md`.

pub mod account_pool;
pub mod catalog;
mod catalog_summary;
mod catalog_visibility;
mod client_tools;
mod dispatch;
pub mod history;
mod history_questions;
pub mod history_service;
pub mod host;
mod mapping;
pub mod message_search;
pub mod pricing;
pub mod resources;
pub mod rollout;
mod rollout_changes;
pub mod rollout_content;
pub mod rollout_monitor;
pub mod rollout_store;
pub mod storage;
#[cfg(test)]
mod test_support;

use std::sync::{Arc, RwLock};

use agent_core::{
    model::{
        AgentEvent, AgentThread, AppThreadId, Capability, CapabilityInvokeParams, CapabilitySet,
        ClientMessageId, ModelCatalog, PermissionProfileCatalog, Provenance, ProviderDescriptor,
        ProviderId, ProviderThreadRef, RequestRespondParams, RpcError, RuntimeResponse,
        StartWhileActiveMode, ThreadCreateParams, ThreadListParams, ThreadListResult,
        ThreadReadResult, ThreadTurnsParams, ThreadTurnsResult, ThreadUpdateParams,
        ThreadUpdateResult, TurnId, TurnInterruptParams, TurnStartParams, TurnStartResult,
        TurnSteerParams, TurnSteerResult, thread_not_found_message,
    },
    provider::{
        AdmissionError, AgentProvider, ClientToolHost, DispatchError, NativeMessageSearch,
        NativeSurface, NativeThreadResources, NativeThreadStore, ProviderError, ProviderEvent,
        ProviderFence, ProviderStatus,
    },
    request_ids,
    usage::ModelPricing,
};
use agent_transport::{OrderedUpstreamEvent, UpstreamError, UpstreamHandle};
use async_trait::async_trait;
use serde_json::{Value, json};
use tokio::sync::{broadcast, mpsc, oneshot, watch};
use tracing::error;

use crate::{
    account_pool::{AccountPoolError, AccountPoolService},
    client_tools::CodexClientTools,
};

pub const PROVIDER_ID: &str = "codex";
const EVENT_CHANNEL_CAPACITY: usize = 2_048;

/// The Codex column of the capability table.
pub const CAPABILITIES: CapabilitySet = CapabilitySet {
    turns_steer: true,
    turns_provider_initiated: false,
    threads_host_minted_ids: false,
    threads_external_discovery: true,
    threads_compact: true,
    threads_fork: true,
    requests_user_input: true,
    requests_mcp_elicitation: true,
    requests_dynamic_tool_call: true,
    settings_service_tier: true,
    settings_personality: true,
    input_skills_and_mentions: true,
    catalog_skills_plugins: true,
    review: true,
    goals: true,
    background_terminals: true,
    realtime_voice: true,
    global_supervisor: true,
    subagent_threads: true,
    accounts_pool: true,
    accounts_rate_limits: true,
    history_thread_resources: true,
    history_message_search: true,
    host_fs: true,
    host_config: true,
    codex_native: true,
    orchestration_tools: true,
    threads_cross_provider_fork: true,
    turns_start_while_active: StartWhileActiveMode::NativeJoin,
};

/// The in-process Codex adapter.
pub struct CodexProvider {
    upstream: UpstreamHandle,
    account_pool: RwLock<Option<Arc<AccountPoolService>>>,
    storage: Option<Arc<storage::CodexStorage>>,
    client_tools: Arc<CodexClientTools>,
    id: ProviderId,
}

impl CodexProvider {
    /// Wraps an App Server connection.
    #[must_use]
    pub fn new(upstream: UpstreamHandle) -> Self {
        Self {
            upstream,
            account_pool: RwLock::new(None),
            storage: None,
            client_tools: Arc::new(CodexClientTools::default()),
            id: codex_provider_id(),
        }
    }

    /// Attaches the host's Codex storage (rollout history, catalog, search
    /// and resources). Without it the storage-backed companion methods are
    /// unavailable on this host.
    #[must_use]
    pub fn with_storage(mut self, storage: storage::CodexStorage) -> Self {
        self.storage = Some(Arc::new(storage));
        self
    }

    /// Installs the companion-owned multi-account scheduler.
    pub fn install_account_pool(&self, pool: Arc<AccountPoolService>) {
        match self.account_pool.write() {
            Ok(mut slot) => *slot = Some(pool),
            Err(poisoned) => *poisoned.into_inner() = Some(pool),
        }
    }

    fn account_pool(&self) -> Option<Arc<AccountPoolService>> {
        match self.account_pool.read() {
            Ok(slot) => slot.clone(),
            Err(poisoned) => poisoned.into_inner().clone(),
        }
    }

    /// The connected App Server version, for host status surfaces.
    #[must_use]
    pub fn version(&self) -> Option<String> {
        self.upstream.version()
    }

    async fn rpc(&self, method: &str, params: Value) -> Result<Value, ProviderError> {
        let response = self
            .upstream
            .request(json!({"id": format!("codex-adapter:{method}"), "method": method, "params": params}))
            .await
            .map_err(transport_error)?;
        rpc_result(response)
    }

    async fn rpc_fenced(
        &self,
        method: &str,
        params: Value,
    ) -> Result<(Value, ProviderFence), ProviderError> {
        let (response, fence) = self
            .upstream
            .request_fenced(json!({"id": format!("codex-adapter:{method}"), "method": method, "params": params}))
            .await
            .map_err(transport_error)?;
        let fence = ProviderFence::new(async move { fence.wait().await.map_err(transport_error) });
        Ok((rpc_result(response)?, fence))
    }

    fn read_result(&self, result: &Value) -> Result<ThreadReadResult, ProviderError> {
        let thread_value = result
            .get("thread")
            .ok_or_else(|| ProviderError::Protocol("thread/read returned no thread".into()))?;
        let thread = mapping::thread(&self.id, thread_value, false).ok_or_else(|| {
            ProviderError::Protocol("thread/read returned an invalid thread".into())
        })?;
        Ok(ThreadReadResult {
            thread,
            active_turn_id: None,
        })
    }

    /// A neutral turns page; every turn and item is stamped with this
    /// provider and the (phase-1) native thread id, the app thread id.
    fn turns_result(&self, thread: &AppThreadId, result: &Value) -> ThreadTurnsResult {
        let origin = Provenance {
            provider: self.id.clone(),
            native_thread_id: ProviderThreadRef::same_as(thread),
        };
        ThreadTurnsResult {
            turns: result
                .get("data")
                .and_then(Value::as_array)
                .map(|turns| {
                    turns
                        .iter()
                        .filter_map(mapping::turn)
                        .map(|mut turn| {
                            turn.stamp(&origin);
                            turn
                        })
                        .collect()
                })
                .unwrap_or_default(),
            next_cursor: result
                .get("nextCursor")
                .and_then(Value::as_str)
                .map(str::to_owned),
        }
    }

    fn turns_params(params: &ThreadTurnsParams) -> Value {
        json!({
            "threadId": params.app_thread_id.as_str(),
            "cursor": params.cursor,
            "limit": params.limit,
            "sortDirection": match params.sort_direction {
                agent_core::model::SortDirection::Asc => "asc",
                agent_core::model::SortDirection::Desc => "desc",
            },
            "itemsView": mapping::items_view(params.items_view),
        })
    }
}

fn codex_provider_id() -> ProviderId {
    ProviderId::from_static(PROVIDER_ID)
}

/// Maps a transport failure, preserving its user-visible message and retry class.
pub(crate) fn transport_error(error: UpstreamError) -> ProviderError {
    match error {
        UpstreamError::Reconnecting => ProviderError::Reconnecting(error.to_string()),
        UpstreamError::Backpressure => ProviderError::Backpressure(error.to_string()),
        UpstreamError::Disconnected => ProviderError::Disconnected(error.to_string()),
        UpstreamError::Protocol(detail) => {
            ProviderError::Protocol(format!("App Server protocol error: {detail}"))
        }
    }
}

/// Splits a JSON-RPC response into its result or a typed rejection.
pub(crate) fn rpc_result(response: Value) -> Result<Value, ProviderError> {
    let Value::Object(mut response) = response else {
        return Err(ProviderError::Protocol(
            "App Server response is not an object".into(),
        ));
    };
    if let Some(error) = response.get("error") {
        return Err(ProviderError::Rejected(RpcError {
            code: error.get("code").and_then(Value::as_i64).unwrap_or(-32_603),
            message: error
                .get("message")
                .and_then(Value::as_str)
                .unwrap_or("App Server rejected the request")
                .to_owned(),
            data: None,
        }));
    }
    response
        .remove("result")
        .ok_or_else(|| ProviderError::Protocol("App Server response has no result".into()))
}

fn admission_error(error: &AccountPoolError) -> AdmissionError {
    match error {
        AccountPoolError::Deferred(_) => AdmissionError::Deferred(error.to_string()),
        error if error.is_retryable() => AdmissionError::Retryable(error.to_string()),
        error => AdmissionError::Fatal(error.to_string()),
    }
}

/// Thread id a native notification belongs to, for binding observation.
fn native_thread_id(payload: &Value) -> Option<AppThreadId> {
    let params = payload.get("params")?;
    params
        .get("threadId")
        .and_then(Value::as_str)
        .or_else(|| params.pointer("/thread/id").and_then(Value::as_str))
        .and_then(AppThreadId::parse)
}

/// The adapter side of the native event forwarder: client tools answered
/// here and the connection that answers them.
struct ToolInterception {
    tools: Arc<CodexClientTools>,
    upstream: UpstreamHandle,
    provider: ProviderId,
}

async fn forward_native_events(
    mut upstream: mpsc::Receiver<OrderedUpstreamEvent>,
    events: mpsc::Sender<ProviderEvent>,
    interception: ToolInterception,
) {
    while let Some(event) = upstream.recv().await {
        let forwarded = match event {
            OrderedUpstreamEvent::Notification(payload) => {
                if interception.tools.intercept(
                    &payload,
                    &interception.upstream,
                    &interception.provider,
                ) {
                    continue;
                }
                if payload.get("method").is_some()
                    && payload
                        .get("id")
                        .is_some_and(request_ids::is_ambiguous_primary_id)
                {
                    let method = payload
                        .get("method")
                        .and_then(Value::as_str)
                        .unwrap_or_default()
                        .to_owned();
                    error!(
                        method = %method,
                        "App Server request id collides with the provider id namespace; request dropped"
                    );
                    continue;
                }
                ProviderEvent::Event(Box::new(AgentEvent::CapabilityEvent {
                    app_thread_id: native_thread_id(&payload),
                    capability: Capability::CodexNative.name().to_owned(),
                    payload,
                }))
            }
            OrderedUpstreamEvent::Fence(upstream_fence) => {
                let (fence, completion) = oneshot::channel::<Result<u64, ProviderError>>();
                tokio::spawn(async move {
                    let result = match completion.await {
                        Ok(Ok(cursor)) => Ok(cursor),
                        Ok(Err(error)) => Err(UpstreamError::Protocol(error.to_string())),
                        Err(_) => Err(UpstreamError::Disconnected),
                    };
                    let _ = upstream_fence.send(result);
                });
                ProviderEvent::Fence(fence)
            }
        };
        if events.send(forwarded).await.is_err() {
            break;
        }
    }
}

#[async_trait]
impl AgentProvider for CodexProvider {
    fn descriptor(&self) -> ProviderDescriptor {
        ProviderDescriptor {
            id: self.id.clone(),
            display_name: "Codex".into(),
            model_provider: "openai".into(),
            version: self.upstream.version().unwrap_or_default(),
        }
    }

    fn as_any(&self) -> &dyn std::any::Any {
        self
    }

    fn capabilities(&self) -> CapabilitySet {
        CAPABILITIES
    }

    fn status(&self) -> ProviderStatus {
        self.upstream.status()
    }

    fn subscribe_status(&self) -> watch::Receiver<ProviderStatus> {
        self.upstream.subscribe_status()
    }

    fn take_events(&self) -> mpsc::Receiver<ProviderEvent> {
        let (sender, receiver) = mpsc::channel(EVENT_CHANNEL_CAPACITY);
        tokio::spawn(forward_native_events(
            self.upstream.take_ordered_events(),
            sender,
            ToolInterception {
                tools: self.client_tools.clone(),
                upstream: self.upstream.clone(),
                provider: self.id.clone(),
            },
        ));
        receiver
    }

    async fn catalog_models(&self) -> Result<ModelCatalog, ProviderError> {
        let result = self.rpc("model/list", json!({"limit": 100})).await?;
        Ok(ModelCatalog {
            models: result
                .get("data")
                .and_then(Value::as_array)
                .map(|rows| rows.iter().filter_map(mapping::model).collect())
                .unwrap_or_default(),
        })
    }

    async fn catalog_permission_profiles(&self) -> Result<PermissionProfileCatalog, ProviderError> {
        let result = self.rpc("permissionProfile/list", json!({})).await?;
        Ok(PermissionProfileCatalog {
            profiles: result
                .get("data")
                .and_then(Value::as_array)
                .map(|rows| {
                    rows.iter()
                        .filter_map(mapping::permission_profile)
                        .collect()
                })
                .unwrap_or_default(),
        })
    }

    async fn thread_create(
        &self,
        params: ThreadCreateParams,
    ) -> Result<AgentThread, ProviderError> {
        let mut request = json!({
            "cwd": params.cwd,
            "model": params.settings.model,
            "permissions": params.settings.permission_profile,
        });
        if let Some(tier) = params.settings.service_tier {
            request["serviceTier"] = json!(tier);
        }
        // Codex declares its own tools from the installed host; the neutral
        // `clientTools` field is the Claude host's channel.
        self.client_tools.declare_on_params(&mut request);
        let result = self.rpc("thread/start", request).await?;
        let thread = result
            .get("thread")
            .and_then(|thread| mapping::thread(&self.id, thread, false))
            .ok_or_else(|| {
                ProviderError::Protocol("thread/start returned an invalid thread".into())
            })?;
        Ok(thread)
    }

    async fn thread_read(&self, thread: &AppThreadId) -> Result<ThreadReadResult, ProviderError> {
        let result = self
            .rpc(
                "thread/read",
                json!({"threadId": thread.as_str(), "includeTurns": false}),
            )
            .await?;
        self.read_result(&result)
    }

    async fn thread_read_fenced(
        &self,
        thread: &AppThreadId,
    ) -> Result<(ThreadReadResult, ProviderFence), ProviderError> {
        let (result, fence) = self
            .rpc_fenced(
                "thread/read",
                json!({"threadId": thread.as_str(), "includeTurns": false}),
            )
            .await?;
        Ok((self.read_result(&result)?, fence))
    }

    async fn thread_list(
        &self,
        params: ThreadListParams,
    ) -> Result<ThreadListResult, ProviderError> {
        let result = self
            .rpc("thread/list", mapping::thread_list_params(&params))
            .await?;
        Ok(ThreadListResult {
            threads: result
                .get("data")
                .and_then(Value::as_array)
                .map(|rows| {
                    rows.iter()
                        .filter_map(|row| mapping::thread(&self.id, row, params.archived))
                        .collect()
                })
                .unwrap_or_default(),
            next_cursor: result
                .get("nextCursor")
                .and_then(Value::as_str)
                .map(str::to_owned),
        })
    }

    async fn thread_turns(
        &self,
        params: ThreadTurnsParams,
    ) -> Result<ThreadTurnsResult, ProviderError> {
        let result = self
            .rpc("thread/turns/list", Self::turns_params(&params))
            .await?;
        Ok(self.turns_result(&params.app_thread_id, &result))
    }

    async fn thread_turns_fenced(
        &self,
        params: ThreadTurnsParams,
    ) -> Result<(ThreadTurnsResult, ProviderFence), ProviderError> {
        let (result, fence) = self
            .rpc_fenced("thread/turns/list", Self::turns_params(&params))
            .await?;
        Ok((self.turns_result(&params.app_thread_id, &result), fence))
    }

    async fn thread_update(
        &self,
        params: ThreadUpdateParams,
    ) -> Result<ThreadUpdateResult, ProviderError> {
        let (method, request) = mapping::thread_change(&params.app_thread_id, &params.change);
        let result = if method == "thread/settings/update" {
            let response = self
                .dispatch_settings_update(
                    json!({"id": "codex-adapter:settings", "method": method, "params": request}),
                )
                .await
                .map_err(|error| match error {
                    DispatchError::Transport(error) => error,
                    DispatchError::Admission(error) => ProviderError::Protocol(error.to_string()),
                })?;
            rpc_result(response)?
        } else {
            self.rpc(method, request).await?
        };
        let thread = result
            .get("thread")
            .and_then(|thread| mapping::thread(&self.id, thread, false));
        Ok(ThreadUpdateResult { thread })
    }

    async fn thread_owns(&self, thread: &AppThreadId) -> Result<bool, ProviderError> {
        match self.thread_read(thread).await {
            Ok(_) => Ok(true),
            Err(ProviderError::Rejected(error))
                if error.message == thread_not_found_message(thread.as_str()) =>
            {
                Ok(false)
            }
            Err(error) => Err(error),
        }
    }

    async fn thread_compact(&self, thread: &AppThreadId) -> Result<(), ProviderError> {
        self.rpc("thread/compact/start", json!({"threadId": thread.as_str()}))
            .await
            .map(|_| ())
    }

    async fn turn_start(&self, params: TurnStartParams) -> Result<TurnStartResult, ProviderError> {
        let request = json!({
            "id": "codex-adapter:turn/start",
            "method": "turn/start",
            "params": {
                "threadId": params.app_thread_id.as_str(),
                "clientUserMessageId": params.client_message_id.as_ref().map(ClientMessageId::as_str),
                "input": params.input.iter().map(mapping::user_input).collect::<Vec<_>>(),
            }
        });
        let response = self
            .dispatch_turn_start(request)
            .await
            .map_err(|error| match error {
                DispatchError::Transport(error) => error,
                DispatchError::Admission(error) => ProviderError::Protocol(error.to_string()),
            })?;
        let result = rpc_result(response)?;
        // nativeJoin: the App Server joins an active turn itself and answers
        // with that turn id, so `started` is the only outcome.
        let turn_id = result
            .pointer("/turn/id")
            .and_then(Value::as_str)
            .and_then(TurnId::parse)
            .ok_or_else(|| ProviderError::Protocol("turn/start returned no turn id".into()))?;
        Ok(TurnStartResult::Started { turn_id })
    }

    async fn turn_steer(&self, params: TurnSteerParams) -> Result<TurnSteerResult, ProviderError> {
        let result = self
            .rpc(
                "turn/steer",
                json!({
                    "threadId": params.app_thread_id.as_str(),
                    "clientUserMessageId": params.client_message_id.as_ref().map(ClientMessageId::as_str),
                    "input": params.input.iter().map(mapping::user_input).collect::<Vec<_>>(),
                    "expectedTurnId": params.expected_turn_id.as_str(),
                }),
            )
            .await?;
        let turn_id = result
            .get("turnId")
            .and_then(Value::as_str)
            .and_then(TurnId::parse)
            .ok_or_else(|| ProviderError::Protocol("turn/steer returned no turn id".into()))?;
        Ok(TurnSteerResult { turn_id })
    }

    async fn turn_interrupt(&self, params: TurnInterruptParams) -> Result<(), ProviderError> {
        self.rpc(
            "turn/interrupt",
            json!({
                "threadId": params.app_thread_id.as_str(),
                "turnId": params.turn_id.as_ref().map(TurnId::as_str),
            }),
        )
        .await
        .map(|_| ())
    }

    async fn request_respond(&self, params: RequestRespondParams) -> Result<(), ProviderError> {
        let id = params.request_id.to_json();
        let response = match params.response {
            RuntimeResponse::Approval { decision } => {
                json!({"id": id, "result": {"decision": decision}})
            }
            RuntimeResponse::UserInput { answers } => {
                json!({"id": id, "result": {"answers": answers}})
            }
            RuntimeResponse::Capability { payload } => json!({"id": id, "result": payload}),
            RuntimeResponse::Error { message } => {
                json!({"id": id, "error": {"code": -32_603, "message": message}})
            }
        };
        self.respond(response).await
    }

    async fn capability_invoke(
        &self,
        params: CapabilityInvokeParams,
    ) -> Result<Value, ProviderError> {
        self.rpc(&params.method, params.params).await
    }

    async fn admit_turn(&self) -> Result<(), AdmissionError> {
        match self.account_pool() {
            Some(pool) => pool
                .prepare_for_turn()
                .await
                .map_err(|error| admission_error(&error)),
            None => Ok(()),
        }
    }

    fn install_client_tools(&self, host: Arc<dyn ClientToolHost>) {
        self.client_tools.install(host);
    }

    fn native_surface(&self) -> Option<&dyn NativeSurface> {
        Some(self)
    }

    fn usage_pricing(&self) -> Option<Arc<dyn ModelPricing>> {
        Some(Arc::new(pricing::OpenAiPricing))
    }
}

#[async_trait]
impl NativeSurface for CodexProvider {
    async fn request(&self, mut request: Value) -> Result<Value, ProviderError> {
        self.client_tools.declare_on_thread_start(&mut request);
        self.upstream
            .request(request)
            .await
            .map_err(transport_error)
    }

    async fn request_fenced(
        &self,
        mut request: Value,
    ) -> Result<(Value, ProviderFence), ProviderError> {
        self.client_tools.declare_on_thread_start(&mut request);
        let (response, fence) = self
            .upstream
            .request_fenced(request)
            .await
            .map_err(transport_error)?;
        Ok((
            response,
            ProviderFence::new(async move { fence.wait().await.map_err(transport_error) }),
        ))
    }

    async fn respond(&self, response: Value) -> Result<(), ProviderError> {
        self.upstream
            .respond(response)
            .await
            .map_err(transport_error)
    }

    async fn dispatch_turn_start(&self, request: Value) -> Result<Value, DispatchError> {
        dispatch::turn_start_with_resume(&self.upstream, self.account_pool().as_ref(), request)
            .await
    }

    async fn dispatch_settings_update(&self, request: Value) -> Result<Value, DispatchError> {
        dispatch::settings_update_with_resume(&self.upstream, self.account_pool().as_ref(), request)
            .await
    }

    async fn dispatch_realtime_start(&self, request: Value) -> Result<Value, DispatchError> {
        dispatch::realtime_start_with_resume(&self.upstream, self.account_pool().as_ref(), request)
            .await
    }

    async fn handle_host_rpc(&self, method: &str, params: &Value) -> Option<Result<Value, String>> {
        if !AccountPoolService::handles(method) {
            return None;
        }
        let Some(pool) = self.account_pool() else {
            return Some(Err("Account pool is unavailable".into()));
        };
        Some(
            pool.handle(method, params)
                .await
                .map_err(|error| error.to_string()),
        )
    }

    fn subscribe_local_events(&self) -> Option<broadcast::Receiver<Value>> {
        self.account_pool().map(|pool| pool.subscribe_events())
    }

    fn thread_store(&self) -> Option<Arc<dyn NativeThreadStore>> {
        let storage: Arc<dyn NativeThreadStore> = self.storage.clone()?;
        Some(storage)
    }

    fn message_search(&self) -> Option<Arc<dyn NativeMessageSearch>> {
        let storage: Arc<dyn NativeMessageSearch> = self.storage.clone()?;
        Some(storage)
    }

    fn thread_resources(&self) -> Option<Arc<dyn NativeThreadResources>> {
        let storage: Arc<dyn NativeThreadResources> = self.storage.clone()?;
        Some(storage)
    }
}
