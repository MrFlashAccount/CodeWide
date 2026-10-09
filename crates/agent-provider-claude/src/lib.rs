//! Claude provider adapter: launches and supervises the TypeScript Claude
//! host (`crates/agent-provider-claude/host`) child and speaks
//! `codewide-agent` v1 JSON-RPC to it over stdio, reusing the
//! `agent-transport` JSONL framing through its supervised constructor. Trait
//! calls are forwarded 1:1; protocol semantics live in the host.
//!
//! With host storage attached (`spawn_with_storage`) the adapter also keeps
//! an index of Claude's own session store: a watcher notices changed
//! session records, the host reads them (`nativeSession.read`, through the
//! Agent SDK) and the index answers `thread.turns`, `thread.owns` and
//! message search. The adapter never reads, stores or logs Claude
//! credentials or tokens, never opens Claude's session records itself, and
//! never emits client-wire JSON.

pub mod catalog;
pub mod config;
pub mod indexer;
pub mod preflight;
pub mod resources;
pub mod search;
pub mod storage;
pub mod store;
#[cfg(test)]
mod test_support;
pub mod watcher;

use std::sync::{Arc, OnceLock};

use agent_core::{
    model::{
        ACCOUNT_UPDATED_NOTIFICATION, AccountUpdatedParams, AgentEvent, AgentThread, AppThreadId,
        CapabilityInvokeParams, CapabilitySet, Empty, InitializeResult, ModelCatalog,
        NativeSessionListParams, NativeSessionListResult, NativeSessionReadParams,
        NativeSessionReadResult, PROTOCOL_NAME, PROTOCOL_VERSION, PermissionProfileCatalog,
        Provenance, ProviderAccount, ProviderDescriptor, ProviderId, ProviderRateLimits,
        ProviderThreadRef, RATE_LIMITS_UPDATED_NOTIFICATION, RateLimitsUpdatedParams,
        RequestRespondParams, RpcError, RpcErrorData, StartWhileActiveMode, ThreadCreateParams,
        ThreadListParams, ThreadListResult, ThreadOwnsResult, ThreadReadResult, ThreadRef,
        ThreadResult, ThreadTurnsParams, ThreadTurnsResult, ThreadUpdateParams, ThreadUpdateResult,
        ToolCallParams, TurnInterruptParams, TurnStartParams, TurnStartResult, TurnSteerParams,
        TurnSteerResult,
    },
    provider::{
        AgentProvider, ClientToolHost, NativeThreadResources, ProviderAuth, ProviderError,
        ProviderEvent, ProviderFence, ProviderHealth, ProviderStatus, StoredMessageSearch,
    },
};
use agent_transport::{
    OrderedUpstreamEvent, UpstreamError, UpstreamHandle,
    stdio::{StdioProfile, SupervisedCommand, VersionSource},
};
use async_trait::async_trait;
use serde::{Serialize, de::DeserializeOwned};
use serde_json::{Value, json};
use tokio::sync::{mpsc, oneshot, watch};
use tracing::{error, info, warn};

pub use config::{ClaudeConfig, ClaudeConfigError};
use indexer::NativeSessions;
pub use storage::{ClaudeStorage, ClaudeStorageHost};

pub const PROVIDER_ID: &str = "claude";
const EVENT_CHANNEL_CAPACITY: usize = 2_048;
const PROVIDER_DISABLED_CODE: i64 = -32_070;

/// The Claude column of the capability table. The host re-declares it at
/// `initialize`; this baseline answers before the first handshake. With host
/// storage the adapter itself adds `history.messageSearch`.
pub const CAPABILITIES: CapabilitySet = CapabilitySet {
    turns_steer: true,
    turns_provider_initiated: true,
    threads_host_minted_ids: true,
    threads_external_discovery: true,
    threads_compact: true,
    threads_fork: false,
    requests_user_input: true,
    requests_mcp_elicitation: false,
    requests_dynamic_tool_call: false,
    settings_service_tier: false,
    settings_personality: false,
    input_skills_and_mentions: false,
    catalog_skills_plugins: false,
    review: false,
    goals: false,
    background_terminals: false,
    realtime_voice: false,
    global_supervisor: false,
    subagent_threads: false,
    accounts_pool: false,
    accounts_rate_limits: false,
    history_thread_resources: false,
    history_message_search: false,
    host_fs: false,
    host_config: false,
    codex_native: false,
    orchestration_tools: true,
    threads_cross_provider_fork: true,
    turns_start_while_active: StartWhileActiveMode::Busy,
};

/// What the last handshake established.
#[derive(Clone, Debug)]
enum Negotiation {
    Pending,
    Accepted(Box<InitializeResult>),
    /// The sidecar speaks another protocol version; the provider is disabled.
    Mismatch,
}

/// The Claude agent host adapter.
pub struct ClaudeProvider {
    transport: UpstreamHandle,
    negotiation: watch::Receiver<Negotiation>,
    id: ProviderId,
    storage: Option<Arc<ClaudeStorage>>,
    client_tools: Arc<OnceLock<Arc<dyn ClientToolHost>>>,
    /// Health and sign-in state: written by the negotiation tracker and by
    /// the host's `account.updated` notifications.
    health: Arc<watch::Sender<ProviderHealth>>,
    /// Latest subscription limits from the host's `rateLimits.updated`;
    /// `None` until the first report.
    rate_limits: Arc<watch::Sender<Option<ProviderRateLimits>>>,
}

impl ClaudeProvider {
    /// Launches the supervised host. Must be called inside a Tokio runtime.
    #[must_use]
    pub fn spawn(config: &ClaudeConfig) -> Arc<Self> {
        let (transport, initialized) = Self::launch(config);
        Arc::new(Self::with_transport(transport, initialized))
    }

    /// Launches the supervised host with the session index on the companion's
    /// host storage. Storage that cannot be opened is logged at `error`; the
    /// provider then answers from the host alone.
    #[must_use]
    pub fn spawn_with_storage(config: &ClaudeConfig, host: ClaudeStorageHost) -> Arc<Self> {
        let (transport, initialized) = Self::launch(config);
        let mut provider = Self::with_transport(transport, initialized);
        match ClaudeStorage::open(host) {
            Ok(storage) => provider = provider.with_storage(Arc::new(storage)),
            Err(err) => error!(err = %err, "Claude session index is unavailable"),
        }
        Arc::new(provider)
    }

    /// Attaches host storage and starts indexing through this provider's
    /// host connection.
    #[must_use]
    pub fn with_storage(mut self, storage: Arc<ClaudeStorage>) -> Self {
        storage.start(
            Arc::new(HostSessions {
                transport: self.transport.clone(),
            }),
            self.transport.subscribe_status(),
        );
        self.storage = Some(storage);
        self
    }

    fn launch(config: &ClaudeConfig) -> (UpstreamHandle, watch::Receiver<Option<Value>>) {
        let profile = StdioProfile {
            peer: "Claude sidecar",
            initialize_params: json!({
                "protocol": PROTOCOL_NAME,
                "protocolVersion": PROTOCOL_VERSION,
                "client": {"name": "codewide_companion", "version": env!("CARGO_PKG_VERSION")},
            }),
            version: VersionSource::Pointer("/result/provider/version"),
        };
        UpstreamHandle::spawn_supervised_stdio(
            SupervisedCommand {
                program: config.runtime_executable.clone(),
                args: config.sidecar_args(),
                env: config.host_environment(std::env::var_os("PATH").as_deref()),
                label: "claude-agent-host",
            },
            profile,
        )
    }

    /// Wraps an already supervised transport (tests and alternative hosts).
    #[must_use]
    pub fn with_transport(
        transport: UpstreamHandle,
        initialized: watch::Receiver<Option<Value>>,
    ) -> Self {
        let (negotiation_tx, negotiation) = watch::channel(Negotiation::Pending);
        let health = Arc::new(watch::Sender::new(ProviderHealth::Available(
            ProviderAuth::Unknown,
        )));
        tokio::spawn(track_negotiation(
            initialized,
            negotiation_tx,
            health.clone(),
        ));
        Self {
            transport,
            negotiation,
            id: ProviderId::from_static(PROVIDER_ID),
            storage: None,
            client_tools: Arc::new(OnceLock::new()),
            health,
            rate_limits: Arc::new(watch::Sender::new(None)),
        }
    }

    /// The client tools to declare to the host: the installed set, when the
    /// host declares `orchestration.tools`.
    fn declared_tools(&self) -> Option<Vec<agent_core::model::ClientToolSpec>> {
        let host = self.client_tools.get()?;
        self.capabilities()
            .orchestration_tools
            .then(|| host.specs().to_vec())
    }

    fn stamp_turns(&self, thread: &AppThreadId, result: &mut ThreadTurnsResult) {
        let origin = provenance(&self.id, thread);
        for turn in &mut result.turns {
            turn.stamp(&origin);
        }
    }

    fn accepted(&self) -> Option<Box<InitializeResult>> {
        match &*self.negotiation.borrow() {
            Negotiation::Accepted(result) => Some(result.clone()),
            Negotiation::Pending | Negotiation::Mismatch => None,
        }
    }

    async fn call<Params: Serialize + Sync, Output: DeserializeOwned>(
        &self,
        method: &'static str,
        params: &Params,
    ) -> Result<Output, ProviderError> {
        if matches!(&*self.negotiation.borrow(), Negotiation::Mismatch) {
            return Err(ProviderError::Rejected(RpcError {
                code: PROVIDER_DISABLED_CODE,
                message: "Claude provider is disabled on this host".into(),
                data: None,
            }));
        }
        request(&self.transport, method, params).await
    }

    async fn call_fenced<Params: Serialize + Sync, Output: DeserializeOwned>(
        &self,
        method: &'static str,
        params: &Params,
    ) -> Result<(Output, ProviderFence), ProviderError> {
        let params = serde_json::to_value(params)
            .map_err(|error| ProviderError::Protocol(error.to_string()))?;
        let (response, fence) = self
            .transport
            .request_fenced(json!({"id": method, "method": method, "params": params}))
            .await
            .map_err(transport_error)?;
        let fence = ProviderFence::new(async move { fence.wait().await.map_err(transport_error) });
        Ok((decode_response(&response)?, fence))
    }
}

async fn request<Params: Serialize + Sync, Output: DeserializeOwned>(
    transport: &UpstreamHandle,
    method: &'static str,
    params: &Params,
) -> Result<Output, ProviderError> {
    let params =
        serde_json::to_value(params).map_err(|error| ProviderError::Protocol(error.to_string()))?;
    let response = transport
        .request(json!({"id": method, "method": method, "params": params}))
        .await
        .map_err(transport_error)?;
    decode_response(&response)
}

/// The host's native-session reads, for the indexer.
struct HostSessions {
    transport: UpstreamHandle,
}

#[async_trait]
impl NativeSessions for HostSessions {
    async fn list(
        &self,
        params: NativeSessionListParams,
    ) -> Result<NativeSessionListResult, ProviderError> {
        request(&self.transport, "nativeSession.list", &params).await
    }

    async fn read(&self, session_id: &str) -> Result<NativeSessionReadResult, ProviderError> {
        request(
            &self.transport,
            "nativeSession.read",
            &NativeSessionReadParams {
                session_id: session_id.to_owned(),
            },
        )
        .await
    }
}

async fn track_negotiation(
    mut initialized: watch::Receiver<Option<Value>>,
    negotiation: watch::Sender<Negotiation>,
    health: Arc<watch::Sender<ProviderHealth>>,
) {
    while initialized.changed().await.is_ok() {
        let Some(response) = initialized.borrow_and_update().clone() else {
            continue;
        };
        if let Some(error) = response.get("error") {
            let message = error.get("message").and_then(Value::as_str).unwrap_or("");
            if message.contains("protocol version mismatch") {
                error!(
                    expected = PROTOCOL_VERSION,
                    host_error = %message,
                    "agent protocol version mismatch: the Claude agent host and the companion are from different releases; reinstall the host"
                );
                health.send_replace(ProviderHealth::Unavailable);
                if negotiation.send(Negotiation::Mismatch).is_err() {
                    return;
                }
            }
            continue;
        }
        let Some(result) = response.get("result").cloned() else {
            continue;
        };
        let next = match serde_json::from_value::<InitializeResult>(result) {
            Ok(result) if result.protocol_version == PROTOCOL_VERSION => {
                if result.capabilities != CAPABILITIES {
                    warn!(
                        "Claude sidecar declared capabilities that differ from the adapter baseline"
                    );
                }
                info!(
                    version = %result.provider.version,
                    authenticated = result.account.as_ref().is_some_and(|account| account.authenticated),
                    "Claude sidecar initialized"
                );
                Negotiation::Accepted(Box::new(result))
            }
            Ok(result) => {
                error!(
                    expected = PROTOCOL_VERSION,
                    host = %result.protocol_version,
                    host_version = %result.provider.version,
                    "agent protocol version mismatch: the Claude agent host and the companion are from different releases; reinstall the host"
                );
                Negotiation::Mismatch
            }
            Err(err) => {
                error!(err = %err, "agent protocol version mismatch");
                Negotiation::Mismatch
            }
        };
        health.send_replace(match &next {
            Negotiation::Accepted(result) => {
                ProviderHealth::Available(provider_auth(result.account.as_ref()))
            }
            Negotiation::Pending => ProviderHealth::Available(ProviderAuth::Unknown),
            Negotiation::Mismatch => ProviderHealth::Unavailable,
        });
        if negotiation.send(next).is_err() {
            return;
        }
    }
}

/// The sign-in state a host reports; no account means it does not know.
fn provider_auth(account: Option<&ProviderAccount>) -> ProviderAuth {
    match account {
        None => ProviderAuth::Unknown,
        Some(account) if account.authenticated => ProviderAuth::Authenticated {
            plan_label: account.label.clone(),
            account_label: account.account_label.clone(),
        },
        Some(_) => ProviderAuth::Unauthenticated,
    }
}

/// Applies the host's `account.updated` notification. An unavailable
/// provider stays unavailable; a malformed notification is logged and
/// ignored. Neither the plan label nor the account label is logged.
fn apply_account_update(health: &watch::Sender<ProviderHealth>, payload: &Value) {
    let params = payload
        .get("params")
        .cloned()
        .map(serde_json::from_value::<AccountUpdatedParams>);
    let account = match params {
        Some(Ok(params)) => params.account,
        Some(Err(err)) => {
            warn!(err = %err, "Claude host sent an invalid account.updated notification");
            return;
        }
        None => {
            warn!("Claude host sent account.updated without params");
            return;
        }
    };
    let auth = provider_auth(Some(&account));
    health.send_if_modified(|current| match current {
        ProviderHealth::Available(previous) if *previous != auth => {
            info!(
                authenticated = account.authenticated,
                "Claude sign-in state changed"
            );
            *previous = auth;
            true
        }
        ProviderHealth::Available(_) | ProviderHealth::Unavailable => false,
    });
}

/// Applies the host's `rateLimits.updated` notification: its params carry the
/// full merged snapshot, which replaces the previous one. A malformed
/// notification is logged (without its payload) and ignored.
fn apply_rate_limits_update(
    rate_limits: &watch::Sender<Option<ProviderRateLimits>>,
    payload: &Value,
) {
    let params = payload
        .get("params")
        .cloned()
        .map(serde_json::from_value::<RateLimitsUpdatedParams>);
    let next = match params {
        Some(Ok(params)) => params.rate_limits,
        Some(Err(err)) => {
            warn!(err = %err, "Claude host sent an invalid rateLimits.updated notification");
            return;
        }
        None => {
            warn!("Claude host sent rateLimits.updated without params");
            return;
        }
    };
    rate_limits.send_if_modified(|current| {
        if current.as_ref() == Some(&next) {
            return false;
        }
        *current = Some(next);
        true
    });
}

fn transport_error(error: UpstreamError) -> ProviderError {
    match error {
        UpstreamError::Reconnecting => {
            ProviderError::Reconnecting("Claude provider is reconnecting".into())
        }
        UpstreamError::Backpressure => {
            ProviderError::Backpressure("Claude provider request queue is full".into())
        }
        UpstreamError::Disconnected => {
            ProviderError::Disconnected("Claude provider disconnected".into())
        }
        UpstreamError::Protocol(message) => {
            ProviderError::Protocol(format!("Claude provider protocol error: {message}"))
        }
    }
}

fn decode_response<Output: DeserializeOwned>(response: &Value) -> Result<Output, ProviderError> {
    if let Some(error) = response.get("error") {
        let error =
            serde_json::from_value::<RpcError>(error.clone()).unwrap_or_else(|_| RpcError {
                code: error.get("code").and_then(Value::as_i64).unwrap_or(-32_603),
                message: error
                    .get("message")
                    .and_then(Value::as_str)
                    .unwrap_or("Claude provider rejected the request")
                    .to_owned(),
                data: None::<RpcErrorData>,
            });
        return Err(ProviderError::Rejected(error));
    }
    let result = response
        .get("result")
        .cloned()
        .ok_or_else(|| ProviderError::Protocol("Claude provider response has no result".into()))?;
    serde_json::from_value(result).map_err(|error| ProviderError::Protocol(error.to_string()))
}

/// The phase-1 origin of a Claude turn or item: this provider and the app
/// thread id as the native thread id.
fn provenance(provider: &ProviderId, thread: &AppThreadId) -> Provenance {
    Provenance {
        provider: provider.clone(),
        native_thread_id: ProviderThreadRef::same_as(thread),
    }
}

fn stamp_event(event: &mut AgentEvent, provider: &ProviderId) {
    match event {
        AgentEvent::TurnStarted {
            app_thread_id,
            turn,
        }
        | AgentEvent::TurnCompleted {
            app_thread_id,
            turn,
        } => {
            turn.stamp(&provenance(provider, app_thread_id));
        }
        AgentEvent::ItemStarted {
            app_thread_id,
            item,
            ..
        }
        | AgentEvent::ItemCompleted {
            app_thread_id,
            item,
            ..
        } => item.stamp(&provenance(provider, app_thread_id)),
        _ => {}
    }
}

/// Answers the host's `tool.call` provider requests through the installed
/// client tools, on the same stdio channel.
struct ToolCalls {
    host: Arc<OnceLock<Arc<dyn ClientToolHost>>>,
    transport: UpstreamHandle,
    provider: ProviderId,
}

impl ToolCalls {
    /// Answers one `tool.call` request on a spawned task: a tool failure is
    /// an unsuccessful result; only malformed params are a JSON-RPC error.
    fn answer(&self, payload: &Value) {
        let id = payload.get("id").cloned().unwrap_or(Value::Null);
        let call = payload
            .get("params")
            .cloned()
            .map(serde_json::from_value::<ToolCallParams>);
        let host = self.host.get().cloned();
        let transport = self.transport.clone();
        let provider = self.provider.clone();
        tokio::spawn(async move {
            let response = match (call, host) {
                (Some(Ok(call)), Some(host)) => {
                    let result = host.call(&provider, call).await;
                    json!({"id": id, "result": result})
                }
                (Some(Ok(_)), None) => {
                    json!({"id": id, "result": agent_core::model::ToolCallResult::failure(
                        "client tools are not available on this companion".into(),
                    )})
                }
                (Some(Err(err)), _) => {
                    warn!(err = %err, "Claude host sent invalid tool.call params");
                    json!({"id": id, "error": {"code": agent_core::model::ERROR_INVALID_PARAMS, "message": "invalid tool.call params", "data": null}})
                }
                (None, _) => {
                    json!({"id": id, "error": {"code": agent_core::model::ERROR_INVALID_PARAMS, "message": "tool.call requires params", "data": null}})
                }
            };
            if let Err(err) = transport.respond(response).await {
                error!(err = %err, "Claude client tool result was not delivered");
            }
        });
    }
}

async fn forward_events(
    mut transport: mpsc::Receiver<OrderedUpstreamEvent>,
    events: mpsc::Sender<ProviderEvent>,
    storage: Option<Arc<ClaudeStorage>>,
    tool_calls: ToolCalls,
    health: Arc<watch::Sender<ProviderHealth>>,
    rate_limits: Arc<watch::Sender<Option<ProviderRateLimits>>>,
) {
    let provider = tool_calls.provider.clone();
    while let Some(event) = transport.recv().await {
        let forwarded = match event {
            OrderedUpstreamEvent::Notification(payload) => {
                if payload.get("method").and_then(Value::as_str) == Some("tool.call")
                    && payload.get("id").is_some()
                {
                    tool_calls.answer(&payload);
                    continue;
                }
                if payload.get("method").and_then(Value::as_str)
                    == Some(ACCOUNT_UPDATED_NOTIFICATION)
                {
                    apply_account_update(&health, &payload);
                    continue;
                }
                if payload.get("method").and_then(Value::as_str)
                    == Some(RATE_LIMITS_UPDATED_NOTIFICATION)
                {
                    apply_rate_limits_update(&rate_limits, &payload);
                    continue;
                }
                if payload.get("method").and_then(Value::as_str) != Some("event") {
                    let method = payload
                        .get("method")
                        .and_then(Value::as_str)
                        .unwrap_or_default()
                        .to_owned();
                    warn!(method = %method, "Claude sidecar sent an unexpected notification");
                    continue;
                }
                let Some(params) = payload.get("params").cloned() else {
                    continue;
                };
                match serde_json::from_value::<AgentEvent>(params) {
                    Ok(mut event) => {
                        stamp_event(&mut event, &provider);
                        if let Some(storage) = &storage {
                            storage.observe_event(&event);
                        }
                        ProviderEvent::Event(Box::new(event))
                    }
                    Err(err) => {
                        warn!(err = %err, "Claude sidecar sent an invalid event");
                        continue;
                    }
                }
            }
            OrderedUpstreamEvent::Fence(transport_fence) => {
                let (fence, completion) = oneshot::channel::<Result<u64, ProviderError>>();
                tokio::spawn(async move {
                    let result = match completion.await {
                        Ok(Ok(cursor)) => Ok(cursor),
                        Ok(Err(error)) => Err(UpstreamError::Protocol(error.to_string())),
                        Err(_) => Err(UpstreamError::Disconnected),
                    };
                    let _ = transport_fence.send(result);
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
impl AgentProvider for ClaudeProvider {
    fn descriptor(&self) -> ProviderDescriptor {
        self.accepted().map_or_else(
            || ProviderDescriptor {
                id: self.id.clone(),
                display_name: "Claude".into(),
                model_provider: "anthropic".into(),
                version: String::new(),
            },
            |result| result.provider,
        )
    }

    fn as_any(&self) -> &dyn std::any::Any {
        self
    }

    fn capabilities(&self) -> CapabilitySet {
        let mut capabilities = self
            .accepted()
            .map_or(CAPABILITIES, |result| result.capabilities);
        // Search and resources are served by this adapter's own index.
        capabilities.history_message_search = self.storage.is_some();
        capabilities.history_thread_resources = self.storage.is_some();
        // A cross-provider fork reads neutral history and creates a thread;
        // both are companion work over operations every host serves.
        capabilities.threads_cross_provider_fork = true;
        capabilities
    }

    fn status(&self) -> ProviderStatus {
        self.transport.status()
    }

    fn subscribe_status(&self) -> watch::Receiver<ProviderStatus> {
        self.transport.subscribe_status()
    }

    fn health(&self) -> ProviderHealth {
        self.health.borrow().clone()
    }

    fn subscribe_health(&self) -> Option<watch::Receiver<ProviderHealth>> {
        Some(self.health.subscribe())
    }

    fn subscribe_rate_limits(&self) -> Option<watch::Receiver<Option<ProviderRateLimits>>> {
        Some(self.rate_limits.subscribe())
    }

    fn take_events(&self) -> mpsc::Receiver<ProviderEvent> {
        let (sender, receiver) = mpsc::channel(EVENT_CHANNEL_CAPACITY);
        let transport = self.transport.take_ordered_events();
        let storage = self.storage.clone();
        let tool_calls = ToolCalls {
            host: self.client_tools.clone(),
            transport: self.transport.clone(),
            provider: self.id.clone(),
        };
        tokio::spawn(forward_events(
            transport,
            sender,
            storage,
            tool_calls,
            self.health.clone(),
            self.rate_limits.clone(),
        ));
        receiver
    }

    async fn catalog_models(&self) -> Result<ModelCatalog, ProviderError> {
        self.call("catalog.models", &Empty {}).await
    }

    async fn catalog_permission_profiles(&self) -> Result<PermissionProfileCatalog, ProviderError> {
        self.call("catalog.permissionProfiles", &Empty {}).await
    }

    async fn thread_create(
        &self,
        mut params: ThreadCreateParams,
    ) -> Result<AgentThread, ProviderError> {
        params.client_tools = self.declared_tools();
        let result: ThreadResult = self.call("thread.create", &params).await?;
        Ok(result.thread)
    }

    async fn thread_read(&self, thread: &AppThreadId) -> Result<ThreadReadResult, ProviderError> {
        self.call(
            "thread.read",
            &ThreadRef {
                app_thread_id: thread.clone(),
            },
        )
        .await
    }

    async fn thread_read_fenced(
        &self,
        thread: &AppThreadId,
    ) -> Result<(ThreadReadResult, ProviderFence), ProviderError> {
        self.call_fenced(
            "thread.read",
            &ThreadRef {
                app_thread_id: thread.clone(),
            },
        )
        .await
    }

    async fn thread_list(
        &self,
        params: ThreadListParams,
    ) -> Result<ThreadListResult, ProviderError> {
        let provider = self.descriptor().id;
        if let Some(indexed) = self
            .storage
            .as_ref()
            .and_then(|storage| storage.list(&params, &provider))
        {
            return indexed.map_err(ProviderError::Rejected);
        }
        self.call("thread.list", &params).await
    }

    async fn thread_turns(
        &self,
        params: ThreadTurnsParams,
    ) -> Result<ThreadTurnsResult, ProviderError> {
        let mut result = match self
            .storage
            .as_ref()
            .and_then(|storage| storage.turns(&params))
        {
            Some(indexed) => indexed.map_err(ProviderError::Rejected)?,
            None => self.call("thread.turns", &params).await?,
        };
        self.stamp_turns(&params.app_thread_id, &mut result);
        Ok(result)
    }

    async fn thread_turns_fenced(
        &self,
        params: ThreadTurnsParams,
    ) -> Result<(ThreadTurnsResult, ProviderFence), ProviderError> {
        let (mut result, fence): (ThreadTurnsResult, ProviderFence) =
            self.call_fenced("thread.turns", &params).await?;
        self.stamp_turns(&params.app_thread_id, &mut result);
        Ok((result, fence))
    }

    async fn thread_update(
        &self,
        params: ThreadUpdateParams,
    ) -> Result<ThreadUpdateResult, ProviderError> {
        self.call("thread.update", &params).await
    }

    async fn thread_owns(&self, thread: &AppThreadId) -> Result<bool, ProviderError> {
        if self
            .storage
            .as_ref()
            .is_some_and(|storage| storage.owns(thread))
        {
            return Ok(true);
        }
        let result: ThreadOwnsResult = self
            .call(
                "thread.owns",
                &ThreadRef {
                    app_thread_id: thread.clone(),
                },
            )
            .await?;
        Ok(result.owned)
    }

    async fn thread_compact(&self, thread: &AppThreadId) -> Result<(), ProviderError> {
        let _: Empty = self
            .call(
                "thread.compact",
                &ThreadRef {
                    app_thread_id: thread.clone(),
                },
            )
            .await?;
        Ok(())
    }

    async fn turn_start(
        &self,
        mut params: TurnStartParams,
    ) -> Result<TurnStartResult, ProviderError> {
        // The host's tool set is live process state: every turn carries it,
        // so a released or restarted session gets the tools again.
        params.client_tools = self.declared_tools();
        self.call("turn.start", &params).await
    }

    fn install_client_tools(&self, host: Arc<dyn ClientToolHost>) {
        if self.client_tools.set(host).is_err() {
            warn!("client tools are already installed on the Claude adapter");
        }
    }

    async fn turn_steer(&self, params: TurnSteerParams) -> Result<TurnSteerResult, ProviderError> {
        self.call("turn.steer", &params).await
    }

    async fn turn_interrupt(&self, params: TurnInterruptParams) -> Result<(), ProviderError> {
        let _: Empty = self.call("turn.interrupt", &params).await?;
        Ok(())
    }

    async fn request_respond(&self, params: RequestRespondParams) -> Result<(), ProviderError> {
        let _: Empty = self.call("request.respond", &params).await?;
        Ok(())
    }

    async fn capability_invoke(
        &self,
        params: CapabilityInvokeParams,
    ) -> Result<Value, ProviderError> {
        let result: agent_core::model::CapabilityInvokeResult =
            self.call("capability.invoke", &params).await?;
        Ok(result.result)
    }

    fn thread_resources(&self) -> Option<Arc<dyn NativeThreadResources>> {
        self.storage
            .as_ref()
            .map(|storage| -> Arc<dyn NativeThreadResources> { storage.resources() })
    }

    fn message_search(&self) -> Option<Arc<dyn StoredMessageSearch>> {
        self.storage
            .as_ref()
            .map(|storage| -> Arc<dyn StoredMessageSearch> { storage.search() })
    }
}

#[cfg(test)]
mod tests {
    use std::time::Duration;

    use serde_json::json;

    use super::*;

    fn initialize_result() -> Result<Value, Box<dyn std::error::Error>> {
        let fixture: Value = serde_json::from_slice(&std::fs::read(
            std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
                .join("../../packages/agent-protocol/fixtures/v1/handshake.json"),
        )?)?;
        Ok(fixture["messages"][1]["message"]["result"].clone())
    }

    /// Writes a sidecar stand-in that answers the handshake with `init`,
    /// emits one event and answers one request with `answer`.
    fn fake_sidecar(
        directory: &std::path::Path,
        init: &Value,
        answer: &Value,
    ) -> Result<ClaudeConfig, Box<dyn std::error::Error>> {
        let init_path = directory.join("init.json");
        let answer_path = directory.join("answer.json");
        std::fs::write(&init_path, format!("{init}\n"))?;
        std::fs::write(&answer_path, format!("{answer}\n"))?;
        let script = directory.join("sidecar.sh");
        std::fs::write(
            &script,
            format!(
                r#"IFS= read -r initialize
cat '{init}'
IFS= read -r initialized
printf '%s\n' '{{"method":"event","params":{{"type":"diff.updated","appThreadId":"t","turnId":"u","diff":"d"}}}}'
IFS= read -r request
cat '{answer}'
sleep 5
"#,
                init = init_path.display(),
                answer = answer_path.display(),
            ),
        )?;
        let claude = directory.join("claude");
        std::fs::write(&claude, "")?;
        Ok(ClaudeConfig::parse(&json!({
            "runtimeExecutable": "/bin/sh",
            "sidecarEntry": script,
            "claudeExecutable": claude,
            "journalDirectory": directory.join("journal"),
        }))?)
    }

    async fn wait_live(provider: &ClaudeProvider) -> Result<(), Box<dyn std::error::Error>> {
        let mut status = provider.subscribe_status();
        tokio::time::timeout(Duration::from_secs(5), async {
            while *status.borrow() != ProviderStatus::Live {
                status.changed().await?;
            }
            Ok::<(), Box<dyn std::error::Error>>(())
        })
        .await??;
        Ok(())
    }

    #[tokio::test]
    async fn speaks_the_neutral_protocol_to_a_supervised_sidecar()
    -> Result<(), Box<dyn std::error::Error>> {
        let directory = tempfile::tempdir()?;
        let thread = json!({
            "appThreadId": "0199a3c4-7a8e-7b2c-9d1e-2f3a4b5c6d7e", "provider": "claude",
            "cwd": "/w", "name": null, "preview": "", "createdAt": 1, "updatedAt": 1,
            "recencyAt": null, "archived": false, "origin": "interactive", "status": "idle",
            "settings": {"model": "m", "effort": null, "permissionProfile": ":workspace", "serviceTier": null}
        });
        let config = fake_sidecar(
            directory.path(),
            &json!({"id": "codewide-companion-initialize", "result": initialize_result()?}),
            &json!({"id": "codewide-stdio:1", "result": {"thread": thread, "activeTurnId": null}}),
        )?;
        let provider = ClaudeProvider::spawn(&config);
        let mut events = provider.take_events();
        wait_live(&provider).await?;
        let event = tokio::time::timeout(Duration::from_secs(5), events.recv())
            .await?
            .ok_or("event stream closed")?;
        assert!(matches!(
            event,
            ProviderEvent::Event(event) if matches!(*event, AgentEvent::DiffUpdated { .. })
        ));
        let read = provider
            .thread_read(&AppThreadId::from_static(
                "0199a3c4-7a8e-7b2c-9d1e-2f3a4b5c6d7e",
            ))
            .await?;
        assert_eq!(read.thread.provider.as_str(), "claude");
        assert_eq!(provider.descriptor().model_provider, "anthropic");
        // The host's declaration wins; without storage the adapter adds only
        // the companion-served cross-provider fork.
        let mut declared: CapabilitySet =
            serde_json::from_value(initialize_result()?["capabilities"].clone())?;
        declared.threads_cross_provider_fork = true;
        assert_eq!(provider.capabilities(), declared);
        Ok(())
    }

    struct EchoTools(Vec<agent_core::model::ClientToolSpec>);

    #[async_trait]
    impl ClientToolHost for EchoTools {
        fn specs(&self) -> &[agent_core::model::ClientToolSpec] {
            &self.0
        }

        async fn call(
            &self,
            provider: &ProviderId,
            call: ToolCallParams,
        ) -> agent_core::model::ToolCallResult {
            agent_core::model::ToolCallResult::text(format!(
                "{}:{}:{}",
                provider, call.app_thread_id, call.tool
            ))
        }
    }

    /// The host calls a client tool over stdio and the adapter answers on the
    /// same channel; every `turn.start` carries the declared tools.
    #[tokio::test]
    async fn answers_tool_calls_and_declares_client_tools_on_every_turn()
    -> Result<(), Box<dyn std::error::Error>> {
        let directory = tempfile::tempdir()?;
        let mut init = initialize_result()?;
        init["capabilities"]["orchestration.tools"] = json!(true);
        let init_path = directory.path().join("init.json");
        std::fs::write(
            &init_path,
            format!(
                "{}\n",
                json!({"id": "codewide-companion-initialize", "result": init})
            ),
        )?;
        let tool_response = directory.path().join("tool-response.json");
        let turn_request = directory.path().join("turn-request.json");
        let script = directory.path().join("sidecar.sh");
        std::fs::write(
            &script,
            format!(
                r#"IFS= read -r initialize
cat '{init}'
IFS= read -r initialized
printf '%s\n' '{{"id":"claude-host:1","method":"tool.call","params":{{"appThreadId":"t","turnId":"u","callId":"toolu_1","tool":"codewide_list_agents","arguments":{{}}}}}}'
IFS= read -r response
printf '%s\n' "$response" > '{tool_response}'
IFS= read -r request
printf '%s\n' "$request" > '{turn_request}'
printf '%s\n' '{{"id":"codewide-stdio:1","result":{{"type":"started","turnId":"u2"}}}}'
sleep 5
"#,
                init = init_path.display(),
                tool_response = tool_response.display(),
                turn_request = turn_request.display(),
            ),
        )?;
        let claude = directory.path().join("claude");
        std::fs::write(&claude, "")?;
        let provider = ClaudeProvider::spawn(&ClaudeConfig::parse(&json!({
            "runtimeExecutable": "/bin/sh",
            "sidecarEntry": script,
            "claudeExecutable": claude,
            "journalDirectory": directory.path().join("journal"),
        }))?);
        let spec = agent_core::model::ClientToolSpec {
            name: "codewide_list_agents".into(),
            description: "List".into(),
            input_schema: json!({"type": "object"}),
        };
        provider.install_client_tools(Arc::new(EchoTools(vec![spec])));
        let _events = provider.take_events();
        wait_live(&provider).await?;
        let response = tokio::time::timeout(Duration::from_secs(5), async {
            loop {
                if let Ok(text) = std::fs::read_to_string(&tool_response)
                    && text.ends_with('\n')
                {
                    return serde_json::from_str::<Value>(&text);
                }
                tokio::time::sleep(Duration::from_millis(10)).await;
            }
        })
        .await??;
        assert_eq!(
            response,
            json!({"id": "claude-host:1", "result": {"success": true,
                "content": [{"type": "text", "text": "claude:t:codewide_list_agents"}]}})
        );
        assert!(provider.capabilities().orchestration_tools);
        let started = provider
            .turn_start(TurnStartParams {
                app_thread_id: AppThreadId::from_static("t"),
                client_message_id: None,
                input: Vec::new(),
                client_tools: None,
            })
            .await?;
        assert!(matches!(started, TurnStartResult::Started { .. }));
        let request: Value = serde_json::from_str(&std::fs::read_to_string(&turn_request)?)?;
        assert_eq!(request["method"], "turn.start");
        assert_eq!(
            request["params"]["clientTools"],
            json!([{"name": "codewide_list_agents", "description": "List", "inputSchema": {"type": "object"}}])
        );
        Ok(())
    }

    #[tokio::test]
    async fn a_protocol_version_mismatch_disables_the_provider()
    -> Result<(), Box<dyn std::error::Error>> {
        let directory = tempfile::tempdir()?;
        let config = fake_sidecar(
            directory.path(),
            &json!({"id": "codewide-companion-initialize", "error": {"code": -32600, "message": "agent protocol version mismatch", "data": null}}),
            &json!({}),
        )?;
        let provider = ClaudeProvider::spawn(&config);
        let mut negotiation = provider.negotiation.clone();
        tokio::time::timeout(Duration::from_secs(5), async {
            while !matches!(*negotiation.borrow(), Negotiation::Mismatch) {
                negotiation.changed().await?;
            }
            Ok::<(), Box<dyn std::error::Error>>(())
        })
        .await??;
        let error = provider
            .thread_read(&AppThreadId::from_static("t"))
            .await
            .err()
            .ok_or("a disabled provider must reject calls")?;
        assert!(matches!(
            error,
            ProviderError::Rejected(RpcError { code: -32_070, .. })
        ));
        assert_eq!(provider.health(), ProviderHealth::Unavailable);
        Ok(())
    }

    #[tokio::test]
    async fn reports_sign_in_from_initialize_and_later_host_updates()
    -> Result<(), Box<dyn std::error::Error>> {
        let directory = tempfile::tempdir()?;
        let mut init = initialize_result()?;
        init["account"] = json!({"authenticated": false, "label": null});
        let init_path = directory.path().join("init.json");
        std::fs::write(
            &init_path,
            format!(
                "{}\n",
                json!({"id": "codewide-companion-initialize", "result": init})
            ),
        )?;
        let script = directory.path().join("sidecar.sh");
        std::fs::write(
            &script,
            format!(
                r#"IFS= read -r initialize
cat '{init}'
IFS= read -r initialized
IFS= read -r go
printf '%s\n' '{{"method":"account.updated","params":{{"account":{{"accountLabel":"user@example.com","authenticated":true,"label":"max"}}}}}}'
printf '%s\n' '{{"method":"rateLimits.updated","params":{{"rateLimits":{{"updatedAt":1760000000,"windows":[{{"id":"five_hour","kind":"session","label":"Session","resetsAt":1760010000,"status":"allowed","usedPercent":42,"windowDurationMins":300}}]}}}}}}'
printf '%s\n' '{{"method":"rateLimits.updated","params":{{"rateLimits":{{"updatedAt":"later"}}}}}}'
sleep 5
"#,
                init = init_path.display(),
            ),
        )?;
        let claude = directory.path().join("claude");
        std::fs::write(&claude, "")?;
        let provider = ClaudeProvider::spawn(&ClaudeConfig::parse(&json!({
            "runtimeExecutable": "/bin/sh",
            "sidecarEntry": script,
            "claudeExecutable": claude,
            "journalDirectory": directory.path().join("journal"),
        }))?);
        let _events = provider.take_events();
        let mut health = provider
            .subscribe_health()
            .ok_or("the Claude adapter reports health")?;
        let mut rate_limits = provider
            .subscribe_rate_limits()
            .ok_or("the Claude adapter reports rate limits")?;
        assert!(rate_limits.borrow().is_none());
        wait_live(&provider).await?;
        tokio::time::timeout(Duration::from_secs(5), async {
            while *health.borrow() != ProviderHealth::Available(ProviderAuth::Unauthenticated) {
                health.changed().await?;
            }
            Ok::<(), Box<dyn std::error::Error>>(())
        })
        .await??;
        // Any line lets the stand-in host send its update.
        provider
            .transport
            .respond(json!({"id": "go", "result": {}}))
            .await
            .map_err(|error| error.to_string())?;
        let signed_in = ProviderHealth::Available(ProviderAuth::Authenticated {
            plan_label: Some("max".into()),
            account_label: Some("user@example.com".into()),
        });
        tokio::time::timeout(Duration::from_secs(5), async {
            while *health.borrow() != signed_in {
                health.changed().await?;
            }
            Ok::<(), Box<dyn std::error::Error>>(())
        })
        .await??;
        assert_eq!(provider.health(), signed_in);
        let limits = tokio::time::timeout(Duration::from_secs(5), async {
            loop {
                if let Some(limits) = rate_limits.borrow_and_update().clone() {
                    return Ok::<_, Box<dyn std::error::Error>>(limits);
                }
                rate_limits.changed().await?;
            }
        })
        .await??;
        assert_eq!(limits.windows.len(), 1);
        assert_eq!(limits.windows[0].id, "five_hour");
        assert_eq!(limits.windows[0].used_percent, Some(42));
        // The malformed update that follows is ignored.
        tokio::time::sleep(Duration::from_millis(100)).await;
        assert_eq!(rate_limits.borrow().as_ref(), Some(&limits));
        Ok(())
    }

    #[tokio::test]
    async fn calls_before_the_sidecar_is_live_are_retryable()
    -> Result<(), Box<dyn std::error::Error>> {
        let directory = tempfile::tempdir()?;
        let claude = directory.path().join("claude");
        std::fs::write(&claude, "")?;
        let script = directory.path().join("never.sh");
        std::fs::write(&script, "sleep 5\n")?;
        let provider = ClaudeProvider::spawn(&ClaudeConfig::parse(&json!({
            "runtimeExecutable": "/bin/sh",
            "sidecarEntry": script,
            "claudeExecutable": claude,
            "journalDirectory": directory.path(),
        }))?);
        let error = provider
            .thread_read(&AppThreadId::from_static("t"))
            .await
            .err()
            .ok_or("not live")?;
        assert!(error.not_sent());
        assert_eq!(provider.capabilities(), CAPABILITIES);
        Ok(())
    }
}
