//! The `AgentProvider` trait: the only way the companion reaches an agent.
//!
//! Every provider implements the neutral `codewide-agent` v1 operations and
//! publishes one ordered event stream. Optional native features are
//! capabilities, not trait methods. The single exception is the
//! `codex.native` compatibility surface (`keep_temporarily`, owner backend):
//! a provider that declares the `codex.native` capability exposes
//! [`NativeSurface`] so unmapped Codex App Server traffic passes through
//! unchanged, and (through the same surface) the host storage of its threads
//! (`native_storage`). Removal condition: every Codex method used by the
//! client has a neutral or capability mapping and the client speaks the
//! neutral protocol.

mod native_storage;
mod stored_search;

use std::{future::Future, pin::Pin, sync::Arc};

use async_trait::async_trait;
use serde_json::Value;
use tokio::sync::{mpsc, oneshot, watch};

use crate::model::{
    AgentEvent, AgentThread, AppThreadId, CapabilityInvokeParams, CapabilitySet, ClientToolSpec,
    ModelCatalog, PermissionProfileCatalog, ProviderDescriptor, ProviderId, RequestRespondParams,
    RpcError, ThreadCreateParams, ThreadListParams, ThreadListResult, ThreadReadResult,
    ThreadTurnsParams, ThreadTurnsResult, ThreadUpdateParams, ThreadUpdateResult, ToolCallParams,
    ToolCallResult, TurnInterruptParams, TurnStartParams, TurnStartResult, TurnSteerParams,
    TurnSteerResult,
};

pub use native_storage::{
    HistoryPageError, HistorySyncRequest, NativeMessageSearch, NativeThreadResources,
    NativeThreadStore,
};
pub use stored_search::{SearchWindow, StoredMessageSearch};

use crate::usage::ModelPricing;

/// Transport state of one provider. The JSONL/WebSocket transport reports
/// this same two-state lifecycle (`agent-transport` names it
/// `ConnectionStatus`), so adapters forward their transport watch without a
/// translating task (and without its lag).
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ProviderStatus {
    Reconnecting,
    Live,
}

/// Sign-in state reported by a provider runtime. Never carries credentials,
/// tokens, emails or organization names.
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum ProviderAuth {
    /// The provider does not report sign-in state, or has not reported it yet.
    Unknown,
    Unauthenticated,
    /// Signed in; `plan_label` is an opaque plan name such as `max`.
    Authenticated {
        plan_label: Option<String>,
    },
}

/// Whether an enabled provider can serve at all, independent of its
/// transport lifecycle ([`ProviderStatus`]).
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum ProviderHealth {
    /// Usable whenever its transport is live, with its sign-in state.
    Available(ProviderAuth),
    /// Running but unusable on this host (for example its runtime speaks
    /// another protocol version); every call is rejected.
    Unavailable,
}

/// Failure of one provider call. The variants preserve the retry semantics
/// the outbox relies on: `Reconnecting` and `Backpressure` prove the request
/// was not accepted; `Disconnected` and `Protocol` are ambiguous.
#[derive(Clone, Debug, thiserror::Error)]
pub enum ProviderError {
    /// The transport is not live; the request was not sent.
    #[error("{0}")]
    Reconnecting(String),
    /// The bounded transport queue rejected the request before sending it.
    #[error("{0}")]
    Backpressure(String),
    /// The transport dropped after the request may have been sent.
    #[error("{0}")]
    Disconnected(String),
    /// The provider answered with something the companion cannot interpret.
    #[error("{0}")]
    Protocol(String),
    /// The provider answered the call with a JSON-RPC error.
    #[error("{}", .0.message)]
    Rejected(RpcError),
}

impl ProviderError {
    /// Whether the request is proven not to have reached the provider.
    #[must_use]
    pub const fn not_sent(&self) -> bool {
        matches!(self, Self::Reconnecting(_) | Self::Backpressure(_))
    }
}

/// Result of a turn admission check that runs before a turn is dispatched.
#[derive(Clone, Debug, thiserror::Error)]
pub enum AdmissionError {
    /// Admission is temporarily impossible (for example an account switch);
    /// the command waits without consuming an attempt.
    #[error("{0}")]
    Deferred(String),
    /// A transient failure; the command retries with backoff.
    #[error("{0}")]
    Retryable(String),
    /// Admission can never succeed for this command.
    #[error("{0}")]
    Fatal(String),
}

/// Failure of a native dispatch that includes turn admission.
#[derive(Clone, Debug, thiserror::Error)]
pub enum DispatchError {
    #[error(transparent)]
    Admission(AdmissionError),
    #[error(transparent)]
    Transport(ProviderError),
}

/// Completion of a fenced read: resolves to the durable replay cursor after
/// every event the provider emitted before the read's response is committed.
pub struct ProviderFence(Pin<Box<dyn Future<Output = Result<u64, ProviderError>> + Send>>);

impl ProviderFence {
    #[must_use]
    pub fn new(future: impl Future<Output = Result<u64, ProviderError>> + Send + 'static) -> Self {
        Self(Box::pin(future))
    }

    /// Waits until the fence position is committed.
    ///
    /// # Errors
    /// Returns the provider error when the event stream ended first.
    pub async fn wait(self) -> Result<u64, ProviderError> {
        self.0.await
    }
}

/// One entry of a provider's ordered event stream.
pub enum ProviderEvent {
    Event(Box<AgentEvent>),
    /// Marks a position in the stream; the receiver answers with the durable
    /// cursor once every preceding event is committed.
    Fence(oneshot::Sender<Result<u64, ProviderError>>),
}

/// The companion-side owner of client-side tools: it declares them and
/// answers every call a provider's model makes. Providers translate the
/// declaration and the calls to their own channel (Codex `dynamicTools` and
/// `item/tool/call`, the neutral `clientTools` and `tool.call`); the tool
/// semantics live only here.
#[async_trait]
pub trait ClientToolHost: Send + Sync {
    /// The declared tools, identical for every provider.
    fn specs(&self) -> &[ClientToolSpec];

    /// Answers one call. `provider` is the provider whose channel carried
    /// it, so the caller identity never comes from the call's arguments.
    async fn call(&self, provider: &ProviderId, call: ToolCallParams) -> ToolCallResult;

    /// Whether `tool` is one of the declared tools.
    fn declares(&self, tool: &str) -> bool {
        self.specs().iter().any(|spec| spec.name == tool)
    }
}

/// The neutral provider contract.
#[async_trait]
pub trait AgentProvider: Send + Sync {
    /// Identity and display data, stable for the provider's lifetime.
    fn descriptor(&self) -> ProviderDescriptor;

    /// Lets a provider's own host integration find its concrete adapter in a
    /// registry without comparing provider ids.
    fn as_any(&self) -> &dyn std::any::Any;

    /// The provider's declared capability set.
    fn capabilities(&self) -> CapabilitySet;

    fn status(&self) -> ProviderStatus;

    fn subscribe_status(&self) -> watch::Receiver<ProviderStatus>;

    /// Health and sign-in state beyond the transport status. Providers that
    /// report neither are available with unknown sign-in state.
    fn health(&self) -> ProviderHealth {
        ProviderHealth::Available(ProviderAuth::Unknown)
    }

    /// Changes of [`Self::health`]; `None` when it never changes.
    fn subscribe_health(&self) -> Option<watch::Receiver<ProviderHealth>> {
        None
    }

    /// Installs the single lossless ordered event stream. Called once.
    fn take_events(&self) -> mpsc::Receiver<ProviderEvent>;

    async fn catalog_models(&self) -> Result<ModelCatalog, ProviderError>;

    async fn catalog_permission_profiles(&self) -> Result<PermissionProfileCatalog, ProviderError>;

    async fn thread_create(&self, params: ThreadCreateParams)
    -> Result<AgentThread, ProviderError>;

    async fn thread_read(&self, thread: &AppThreadId) -> Result<ThreadReadResult, ProviderError>;

    /// Reads a thread with a fence ordered after every event emitted before
    /// the read was answered.
    async fn thread_read_fenced(
        &self,
        thread: &AppThreadId,
    ) -> Result<(ThreadReadResult, ProviderFence), ProviderError>;

    async fn thread_list(
        &self,
        params: ThreadListParams,
    ) -> Result<ThreadListResult, ProviderError>;

    async fn thread_turns(
        &self,
        params: ThreadTurnsParams,
    ) -> Result<ThreadTurnsResult, ProviderError>;

    async fn thread_turns_fenced(
        &self,
        params: ThreadTurnsParams,
    ) -> Result<(ThreadTurnsResult, ProviderFence), ProviderError>;

    async fn thread_update(
        &self,
        params: ThreadUpdateParams,
    ) -> Result<ThreadUpdateResult, ProviderError>;

    /// Whether the provider recognizes a thread id it did not report before.
    async fn thread_owns(&self, thread: &AppThreadId) -> Result<bool, ProviderError>;

    async fn thread_compact(&self, thread: &AppThreadId) -> Result<(), ProviderError>;

    /// Starts a turn. Never steers: an active thread answers `busy`, or the
    /// provider joins natively when it declares `turns.startWhileActive:
    /// nativeJoin`.
    async fn turn_start(&self, params: TurnStartParams) -> Result<TurnStartResult, ProviderError>;

    async fn turn_steer(&self, params: TurnSteerParams) -> Result<TurnSteerResult, ProviderError>;

    async fn turn_interrupt(&self, params: TurnInterruptParams) -> Result<(), ProviderError>;

    async fn request_respond(&self, params: RequestRespondParams) -> Result<(), ProviderError>;

    async fn capability_invoke(
        &self,
        params: CapabilityInvokeParams,
    ) -> Result<Value, ProviderError>;

    /// Runs before a turn is dispatched. Providers without admission rules
    /// admit every turn.
    async fn admit_turn(&self) -> Result<(), AdmissionError> {
        Ok(())
    }

    /// Installs the companion's client-side tools. A provider declaring
    /// `orchestration.tools` declares them to its model on threads and turns
    /// it starts afterwards and routes their calls to `host`; other providers
    /// ignore it. Called at most once, before any thread is started.
    fn install_client_tools(&self, host: Arc<dyn ClientToolHost>) {
        let _ = host;
    }

    /// The `codex.native` compatibility surface; `None` unless the provider
    /// declares the `codex.native` capability.
    fn native_surface(&self) -> Option<&dyn NativeSurface> {
        None
    }

    /// The provider-owned price table of its models; `None` leaves the
    /// provider's usage unpriced.
    fn usage_pricing(&self) -> Option<Arc<dyn ModelPricing>> {
        None
    }

    /// Search over the provider's own stored history, for a provider that
    /// declares `history.messageSearch` without the `codex.native` surface.
    fn message_search(&self) -> Option<Arc<dyn StoredMessageSearch>> {
        None
    }

    /// Thread resources built from the provider's own stored history, for a
    /// provider that declares `history.threadResources` without the
    /// `codex.native` surface. Requests and observed events are client-wire
    /// JSON, as for the native surface.
    fn thread_resources(&self) -> Option<Arc<dyn NativeThreadResources>> {
        None
    }
}

/// Unchanged pass-through of client-wire (Codex App Server v0.155.1) traffic
/// for a provider that declares `codex.native`. See the module docs for the
/// compatibility surface and its removal condition.
#[async_trait]
pub trait NativeSurface: Send + Sync {
    /// Forwards one JSON-RPC request and returns the provider's JSON-RPC
    /// response object (with `result` or `error`).
    async fn request(&self, request: Value) -> Result<Value, ProviderError>;

    /// Like [`Self::request`], with a fence on the ordered event stream.
    async fn request_fenced(&self, request: Value)
    -> Result<(Value, ProviderFence), ProviderError>;

    /// Delivers a client response to a native server request without
    /// rewriting its id.
    async fn respond(&self, response: Value) -> Result<(), ProviderError>;

    /// `turn/start` with turn admission and one safe resume-retry on a
    /// conclusive `thread not found` rejection.
    async fn dispatch_turn_start(&self, request: Value) -> Result<Value, DispatchError>;

    /// `thread/settings/update` with one safe resume-retry.
    async fn dispatch_settings_update(&self, request: Value) -> Result<Value, DispatchError>;

    /// `thread/realtime/start` with one safe resume-retry.
    async fn dispatch_realtime_start(&self, request: Value) -> Result<Value, DispatchError>;

    /// Handles a host-level native RPC owned by this provider (for example
    /// the account pool); `None` when the method is not one of them.
    async fn handle_host_rpc(&self, method: &str, params: &Value) -> Option<Result<Value, String>>;

    /// Subscribes to provider-owned local events (for example account-pool
    /// changes) that are journaled like other companion events.
    fn subscribe_local_events(&self) -> Option<tokio::sync::broadcast::Receiver<Value>>;

    /// Stored thread catalog and history; `None` without host storage.
    fn thread_store(&self) -> Option<Arc<dyn NativeThreadStore>> {
        None
    }

    /// Stored-message search; `None` without host storage.
    fn message_search(&self) -> Option<Arc<dyn NativeMessageSearch>> {
        None
    }

    /// Stored thread resources; `None` without host storage.
    fn thread_resources(&self) -> Option<Arc<dyn NativeThreadResources>> {
        None
    }
}
