//! Host-side storage a `codex.native` provider keeps beside its agent.
//!
//! Part of the `codex.native` compatibility surface (`keep_temporarily`,
//! owner backend). The Codex App Server persists threads as rollout files
//! that the companion indexes itself; the sync hub reaches that storage only
//! through these traits, obtained from [`super::NativeSurface`] of the
//! provider that owns the matching capability (or of the thread's own
//! provider), never by provider id. Values are client-wire JSON and errors
//! carry the user-visible message the companion has always forwarded.
//! Removal condition: the client speaks the neutral protocol and these reads
//! are neutral provider operations. Negative check: no provider other than
//! the Codex adapter returns an implementation.

use std::collections::{HashMap, HashSet};

use async_trait::async_trait;
use serde_json::Value;
use tokio::sync::mpsc;

/// One `companion/thread/sync` history read.
pub struct HistorySyncRequest<'a> {
    pub thread_id: &'a str,
    /// The client's newest known immutable turn; `None` asks for the latest window.
    pub after_turn_id: Option<&'a str>,
    pub limit: usize,
    /// The mutable head the provider reported; it is excluded from history.
    pub active_turn_id: Option<&'a str>,
    /// The client's previous source witness, if any.
    pub source_witness: Option<&'a str>,
}

/// Failure of a semantic history page (`companion/thread/history/*`).
#[derive(Debug, thiserror::Error)]
pub enum HistoryPageError {
    /// The cursor expired or the source changed; the client reloads the tail
    /// (wire code `-32021`).
    #[error("{0}")]
    Stale(String),
    /// Any other failure (wire code `-32020`).
    #[error("{0}")]
    Failed(String),
}

/// Thread catalog visibility and durable turn history of native threads.
#[async_trait]
pub trait NativeThreadStore: Send + Sync {
    /// Prepares one journaled event for client replay.
    ///
    /// # Errors
    /// Returns an error when the catalog cannot classify the event.
    fn replay_event(&self, payload: Value) -> Result<Value, String>;

    /// Marks a thread shell's catalog visibility.
    fn annotate_thread(&self, thread: &mut Value);

    /// Whether `source` is a creation source the supervisor list may read.
    fn is_supervisor_source(&self, source: &str) -> bool;

    /// Removes catalog-excluded rows from a native `thread/list` page.
    async fn filter_thread_page(
        &self,
        page: Value,
        supervisor_source: Option<String>,
    ) -> Result<Value, String>;

    /// Replaces list previews with the newest stored conversation text.
    async fn enrich_thread_page(&self, page: Value) -> Value;

    /// Stored usage and activity metrics for full-turn reads, by turn id.
    async fn activity_metadata(
        &self,
        thread_id: String,
        turn_ids: Vec<String>,
    ) -> Result<HashMap<String, Value>, String>;

    /// A stored `thread/turns/list` page; `None` when the request must go to
    /// the provider.
    async fn turns_page(&self, method: &str, params: &Value) -> Option<Result<Value, String>>;

    /// A `companion/thread/history/after|before` page; `None` for other methods.
    async fn history_page(
        &self,
        method: &str,
        params: &Value,
    ) -> Option<Result<Value, HistoryPageError>>;

    /// Immutable history for `companion/thread/sync`.
    async fn sync_history(&self, request: HistorySyncRequest<'_>) -> Result<Value, String>;

    /// Adds stored evidence (questions, realtime transcripts) to the
    /// provider-owned active turn.
    async fn enrich_active_turn(
        &self,
        thread_id: &str,
        active_turn: &mut Value,
    ) -> Result<(), String>;

    /// The stored subagent tree under `params.threadId`.
    ///
    /// # Errors
    /// Returns an error when the root id is missing or the index cannot be read.
    fn subagent_descendants(&self, params: &Value) -> Result<Value, String>;

    /// The pin snapshot, with stored archive state for `stored_threads`.
    async fn pin_snapshot(&self, stored_threads: HashSet<String>) -> Result<Value, String>;

    /// Starts watching changes written outside the companion and publishes
    /// their semantic invalidations into `events`.
    fn spawn_change_monitor(&self, events: mpsc::Sender<Value>);
}

/// Full-text search over stored messages (`history.messageSearch`).
#[async_trait]
pub trait NativeMessageSearch: Send + Sync {
    /// Answers a `companion/search*` method; `None` for other methods.
    async fn search(&self, method: &str, params: &Value) -> Option<Result<Value, String>>;
}

/// Thread resources projected from stored history (`history.threadResources`).
#[async_trait]
pub trait NativeThreadResources: Send + Sync {
    /// Whether `method` is a thread-resource read.
    fn handles(&self, method: &str) -> bool;

    async fn read(&self, method: &str, params: &Value) -> Result<Value, String>;

    /// Warms the projection of a thread the client is opening.
    fn prewarm(&self, thread_id: &str);

    /// Observes a journaled event for the live resource overlay.
    async fn observe_event(&self, payload: &Value);

    /// Observes an RPC result for the live resource overlay.
    async fn observe_rpc_result(&self, method: &str, result: &Value);
}
