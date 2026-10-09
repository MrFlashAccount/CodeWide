//! Claude provider adapter: launches and supervises the `apps/claude-sidecar`
//! child and speaks `codewide-agent` v1 JSON-RPC to it over stdio, reusing
//! the upstream JSONL framing through its supervised constructor. Trait calls
//! are forwarded 1:1; protocol semantics live in the sidecar.
//!
//! The adapter never reads, stores or logs Claude credentials, tokens or
//! `~/.claude` contents, and never emits client-wire JSON.

pub mod config;

use std::sync::Arc;

use async_trait::async_trait;
use serde::{Serialize, de::DeserializeOwned};
use serde_json::{Value, json};
use tokio::sync::{mpsc, oneshot, watch};
use tracing::{error, info, warn};

use crate::{
    agent::{
        model::{
            AgentEvent, AgentThread, AppThreadId, CapabilityInvokeParams, CapabilitySet, Empty,
            InitializeResult, ModelCatalog, PROTOCOL_NAME, PROTOCOL_VERSION,
            PermissionProfileCatalog, ProviderDescriptor, ProviderId, RequestRespondParams,
            RpcError, RpcErrorData, StartWhileActiveMode, ThreadCreateParams, ThreadListParams,
            ThreadListResult, ThreadOwnsResult, ThreadReadResult, ThreadRef, ThreadResult,
            ThreadTurnsParams, ThreadTurnsResult, ThreadUpdateParams, ThreadUpdateResult,
            TurnInterruptParams, TurnStartParams, TurnStartResult, TurnSteerParams,
            TurnSteerResult,
        },
        provider::{AgentProvider, ProviderError, ProviderEvent, ProviderFence, ProviderStatus},
    },
    upstream::{
        OrderedUpstreamEvent, UpstreamError, UpstreamHandle,
        stdio::{StdioProfile, SupervisedCommand, VersionSource},
    },
};

pub use config::{ClaudeConfig, ClaudeConfigError};

pub const PROVIDER_ID: &str = "claude";
const EVENT_CHANNEL_CAPACITY: usize = 2_048;
const PROVIDER_DISABLED_CODE: i64 = -32_070;

/// The Claude column of the capability table. The sidecar re-declares it at
/// `initialize`; this baseline answers before the first handshake.
pub const CAPABILITIES: CapabilitySet = CapabilitySet {
    turns_steer: true,
    turns_provider_initiated: true,
    threads_host_minted_ids: true,
    threads_external_discovery: false,
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

/// The Claude sidecar adapter.
pub struct ClaudeProvider {
    transport: UpstreamHandle,
    negotiation: watch::Receiver<Negotiation>,
    id: ProviderId,
}

impl ClaudeProvider {
    /// Launches the supervised sidecar. Must be called inside a Tokio runtime.
    #[must_use]
    pub fn spawn(config: &ClaudeConfig) -> Arc<Self> {
        let profile = StdioProfile {
            peer: "Claude sidecar",
            initialize_params: json!({
                "protocol": PROTOCOL_NAME,
                "protocolVersion": PROTOCOL_VERSION,
                "client": {"name": "codewide_companion", "version": env!("CARGO_PKG_VERSION")},
            }),
            version: VersionSource::Pointer("/result/provider/version"),
        };
        let (transport, initialized) = UpstreamHandle::spawn_supervised_stdio(
            SupervisedCommand {
                program: config.runtime_executable.clone(),
                args: config.sidecar_args(),
                label: "claude-sidecar",
            },
            profile,
        );
        Arc::new(Self::with_transport(transport, initialized))
    }

    /// Wraps an already supervised transport (tests and alternative hosts).
    #[must_use]
    pub fn with_transport(
        transport: UpstreamHandle,
        initialized: watch::Receiver<Option<Value>>,
    ) -> Self {
        let (negotiation_tx, negotiation) = watch::channel(Negotiation::Pending);
        tokio::spawn(track_negotiation(initialized, negotiation_tx));
        Self {
            transport,
            negotiation,
            id: ProviderId::from_static(PROVIDER_ID),
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
        let params = serde_json::to_value(params)
            .map_err(|error| ProviderError::Protocol(error.to_string()))?;
        let response = self
            .transport
            .request(json!({"id": method, "method": method, "params": params}))
            .await
            .map_err(transport_error)?;
        decode_response(&response)
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

async fn track_negotiation(
    mut initialized: watch::Receiver<Option<Value>>,
    negotiation: watch::Sender<Negotiation>,
) {
    while initialized.changed().await.is_ok() {
        let Some(response) = initialized.borrow_and_update().clone() else {
            continue;
        };
        if let Some(error) = response.get("error") {
            let message = error.get("message").and_then(Value::as_str).unwrap_or("");
            if message.contains("protocol version mismatch") {
                error!("agent protocol version mismatch");
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
            Ok(_) => {
                error!("agent protocol version mismatch");
                Negotiation::Mismatch
            }
            Err(err) => {
                error!(err = %err, "agent protocol version mismatch");
                Negotiation::Mismatch
            }
        };
        if negotiation.send(next).is_err() {
            return;
        }
    }
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

async fn forward_events(
    mut transport: mpsc::Receiver<OrderedUpstreamEvent>,
    events: mpsc::Sender<ProviderEvent>,
) {
    while let Some(event) = transport.recv().await {
        let forwarded = match event {
            OrderedUpstreamEvent::Notification(payload) => {
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
                    Ok(event) => ProviderEvent::Event(Box::new(event)),
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
        self.accepted()
            .map_or(CAPABILITIES, |result| result.capabilities)
    }

    fn status(&self) -> ProviderStatus {
        self.transport.status()
    }

    fn subscribe_status(&self) -> watch::Receiver<ProviderStatus> {
        self.transport.subscribe_status()
    }

    fn take_events(&self) -> mpsc::Receiver<ProviderEvent> {
        let (sender, receiver) = mpsc::channel(EVENT_CHANNEL_CAPACITY);
        tokio::spawn(forward_events(self.transport.take_ordered_events(), sender));
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
        params: ThreadCreateParams,
    ) -> Result<AgentThread, ProviderError> {
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
        self.call("thread.list", &params).await
    }

    async fn thread_turns(
        &self,
        params: ThreadTurnsParams,
    ) -> Result<ThreadTurnsResult, ProviderError> {
        self.call("thread.turns", &params).await
    }

    async fn thread_turns_fenced(
        &self,
        params: ThreadTurnsParams,
    ) -> Result<(ThreadTurnsResult, ProviderFence), ProviderError> {
        self.call_fenced("thread.turns", &params).await
    }

    async fn thread_update(
        &self,
        params: ThreadUpdateParams,
    ) -> Result<ThreadUpdateResult, ProviderError> {
        self.call("thread.update", &params).await
    }

    async fn thread_owns(&self, thread: &AppThreadId) -> Result<bool, ProviderError> {
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

    async fn turn_start(&self, params: TurnStartParams) -> Result<TurnStartResult, ProviderError> {
        self.call("turn.start", &params).await
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
        let result: crate::agent::model::CapabilityInvokeResult =
            self.call("capability.invoke", &params).await?;
        Ok(result.result)
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
        assert_eq!(provider.capabilities(), CAPABILITIES);
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
