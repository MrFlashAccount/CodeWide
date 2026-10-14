//! What a session needs from its owner: the query runtime, the clock and
//! ids, persistence of its thread's state, the companion's client tools, the
//! thread's stored history, the rate-limit owner, and the ordered output
//! stream its events and notices go to.

use std::{
    path::PathBuf,
    sync::{Arc, atomic::AtomicUsize},
    time::Duration,
};

use agent_core::{
    model::{
        AgentEvent, AgentTurn, AppThreadId, ClientToolSpec, ProviderRateLimitWindow,
        ToolCallParams, ToolCallResult,
    },
    provider::ProviderError,
};
use serde_json::Value;
use tokio::sync::{mpsc, oneshot};

use super::query::{BoxFuture, QueryRuntime};
use crate::state::thread_state::ThreadState;

/// Timing rules of a session.
#[derive(Clone, Copy, Debug)]
pub struct SessionConfig {
    /// An idle query is closed after this long.
    pub idle_release: Duration,
    /// Background tasks defer the idle release at most this long.
    pub background_defer_max: Duration,
    /// An interrupt not settled by Claude within this time closes the query.
    pub interrupt_timeout: Duration,
}

/// What a session reports, in order, on its owner's output stream.
pub enum SessionOutput {
    Event(Box<AgentEvent>),
    /// The thread's metadata or status changed: publish `thread.updated`.
    ThreadUpdated(AppThreadId),
    /// The session's query ended or was closed; `session_id` is no longer
    /// run by this companion.
    Released {
        app_thread_id: AppThreadId,
        session_id: String,
    },
    /// Claude created the current session (its `init` arrived).
    SessionReady(AppThreadId),
    /// A position in the stream after every event before a fenced read.
    Fence(oneshot::Sender<Result<u64, ProviderError>>),
}

/// Persistence of a thread's state and its in-flight turn snapshot.
pub trait StatePersistence: Send + Sync {
    /// Writes the state.
    ///
    /// # Errors
    ///
    /// Returns the write failure.
    fn write(&self, state: &ThreadState) -> Result<(), Box<dyn std::error::Error + Send + Sync>>;
    /// Writes the in-flight turn snapshot, or removes it with `None`.
    ///
    /// # Errors
    ///
    /// Returns the write failure.
    fn write_active_turn(
        &self,
        app_thread_id: &AppThreadId,
        turn: Option<&AgentTurn>,
    ) -> Result<(), Box<dyn std::error::Error + Send + Sync>>;
}

/// The companion's client tools.
pub trait ClientTools: Send + Sync {
    /// The declared tools; empty until the companion installs them.
    fn specs(&self) -> Vec<ClientToolSpec>;
    /// Runs one call.
    fn call(&self, params: ToolCallParams) -> BoxFuture<'static, ToolCallResult>;
}

/// The thread's stored history, for a replacement session's prefix.
pub trait HistoryLines: Send + Sync {
    /// User messages and final answers of the thread's history, oldest
    /// first, as `User: …` / `Claude: …` lines.
    fn lines(&self, state: &ThreadState) -> BoxFuture<'static, Vec<String>>;
}

/// The owner of the subscription limits sessions observe.
pub trait RateLimitSink: Send + Sync {
    fn reported(&self, window: ProviderRateLimitWindow);
    /// Whether a usage read is due now; claiming it starts the read.
    fn claim_usage_read(&self) -> bool;
    fn usage_read(&self, response: &Value);
}

/// Everything a session is built with.
pub struct SessionDeps {
    pub runtime: Arc<dyn QueryRuntime>,
    /// The `claude` executable queries run.
    pub executable: PathBuf,
    /// Milliseconds since the epoch.
    pub clock: Arc<dyn Fn() -> i64 + Send + Sync>,
    pub new_uuid: Arc<dyn Fn() -> String + Send + Sync>,
    pub persistence: Arc<dyn StatePersistence>,
    pub outputs: mpsc::Sender<SessionOutput>,
    pub client_tools: Arc<dyn ClientTools>,
    pub history: Arc<dyn HistoryLines>,
    pub rate_limits: Arc<dyn RateLimitSink>,
    pub config: SessionConfig,
    /// Live queries across sessions, logged on every open and release.
    pub live_sessions: Arc<AtomicUsize>,
}
