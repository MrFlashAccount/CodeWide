//! Optional native-session operations (mirror of `nativeSession.list` and
//! `nativeSession.read` in `packages/agent-protocol`): a provider whose agent
//! keeps its own session store pages it and reads one session as neutral
//! turns, for the companion's native index. A provider without a native store
//! answers `-32601`.

use serde::{Deserialize, Serialize};

use super::{
    ids::AppThreadId,
    thread::{AgentTurn, ThreadSettings},
};

/// One session in a provider's own session store. Timestamps are
/// milliseconds.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeSession {
    /// The thread the session belongs to: its own id, or the thread a
    /// replacement session continues.
    pub app_thread_id: AppThreadId,
    /// The `CodeWide` metadata of the session's thread; absent when the
    /// companion never touched the session.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub codewide: Option<NativeSessionCodewide>,
    pub created_at_ms: Option<i64>,
    pub cwd: Option<String>,
    /// Size of the stored session, when the store knows it; with
    /// `last_modified_ms` a cheap change detector.
    pub file_size: Option<i64>,
    pub first_prompt: Option<String>,
    /// Started by a person (terminal, IDE) rather than programmatically.
    pub interactive: bool,
    pub last_modified_ms: i64,
    pub session_id: String,
    /// The store's display summary (title, generated summary or first prompt).
    pub summary: String,
    pub title: Option<String>,
}

/// The thread name rule of a session's store title.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum NativeTitleOverride {
    /// The store's own session title is the thread name.
    None,
    /// Named before the session existed; applied to the store once it can.
    Pending { name: String },
    /// The name was cleared; a store title equal to `hidden_title` is hidden.
    Cleared { hidden_title: String },
}

/// Whether the thread is listed (and archived) or deleted (tombstone).
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum NativeThreadPresence {
    Listed { archived: bool },
    Deleted { deleted_at: i64 },
}

/// How the companion came to know a native session's thread.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum NativeThreadOrigin {
    /// A thread the companion created.
    Interactive,
    /// A session the companion found (terminal, IDE).
    External,
}

/// The `CodeWide` metadata of the thread a native session belongs to: every
/// `thread.list` row field the provider's store cannot hold. Unix seconds.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeSessionCodewide {
    pub created_at: i64,
    /// Working directory of the app thread (where its turns run).
    pub cwd: String,
    pub origin: NativeThreadOrigin,
    pub presence: NativeThreadPresence,
    pub recency_at: Option<i64>,
    /// Effective settings of the next turn (pending settings when set).
    pub settings: ThreadSettings,
    pub title: NativeTitleOverride,
    /// Last activity the companion itself caused.
    pub updated_at: i64,
}

/// The turns of one sub-agent of a native session.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeSubagent {
    pub agent_id: String,
    /// The parent sub-agent, or `None` for one the main conversation spawned.
    pub parent_agent_id: Option<String>,
    /// The tool call that spawned the sub-agent, when the store records it.
    pub parent_tool_use_id: Option<String>,
    pub turns: Vec<AgentTurn>,
}

/// `nativeSession.list`: newest first; `dir` narrows to one project
/// directory; the cursor is opaque.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeSessionListParams {
    pub cursor: Option<String>,
    pub dir: Option<String>,
    pub limit: u32,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeSessionListResult {
    pub next_cursor: Option<String>,
    pub sessions: Vec<NativeSession>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeSessionReadParams {
    pub session_id: String,
}

/// `nativeSession.read`: the session, its turns and its sub-agents' turns.
/// Ids are derived only from the stored input, so re-reading unchanged input
/// returns the same ids; a running turn is its `inProgress` snapshot.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeSessionReadResult {
    pub session: NativeSession,
    pub subagents: Vec<NativeSubagent>,
    pub turns: Vec<AgentTurn>,
}

/// The `-32600` message for an unknown native session.
#[must_use]
pub fn native_session_not_found_message(session_id: &str) -> String {
    format!("native session not found: {session_id}")
}
