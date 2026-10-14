//! The host's own per-thread metadata (`ThreadState` v2): only what Claude's
//! session store cannot tell. The conversation itself (messages, tool calls,
//! titles, first prompt, timestamps) is read from Claude's store; nothing
//! here copies it.
//!
//! Kept per thread:
//! - the Claude session chain (a lost session is replaced by a new one);
//! - thread settings and settings waiting for the next turn boundary;
//! - `CodeWide`-only list state: archived flag and the delete tombstone;
//! - a title override while Claude cannot hold the title (no session yet, or
//!   a cleared title, which Claude cannot express);
//! - a turn index: turn ids, origins, outcomes and the `clientMessageId` echo
//!   of each prompt, keyed by the persisted message uuids ("anchors") that
//!   identify the turn inside Claude's transcript;
//! - cumulative token usage and cost, the per-model totals last seen in the
//!   current Claude session (the baseline a turn's usage is measured
//!   against) and each finished turn's usage.
//!
//! The in-flight turn's snapshot is kept separately (`active-turn.json`)
//! until the turn ends, so a restart can finalize it. The JSON shape is the
//! TypeScript host's (`host/src/state/threadState.ts`), field for field, so
//! existing files keep their meaning.

use agent_core::model::{
    AppThreadId, NativeThreadPresence, NativeTitleOverride, ThreadSettings, TokenUsage,
};
use serde::{Deserialize, Deserializer, Serialize, Serializer, de, ser::SerializeSeq};

pub use crate::live::usage::{ThreadCost, UsageBaseline};
pub use crate::transcript::turn_index::{PromptRecord, PromptRole, TurnOutcomeRecord, TurnRecord};

/// The current `ThreadState` and `active-turn.json` format version.
pub const THREAD_STATE_VERSION: u8 = 2;

/// A title Claude's store cannot hold (`none`, `pending`, `cleared`).
pub type TitleOverride = NativeTitleOverride;

/// Whether the thread is listed or deleted (tombstone; repeated deletes succeed).
pub type ThreadPresence = NativeThreadPresence;

/// The `version` field of a state file: serializes as `N` and decodes only
/// from the integer `N`.
#[derive(Clone, Copy, Debug, Default, Eq, PartialEq)]
pub struct FormatVersion<const N: u8>;

/// The version marker of `ThreadState` v2 and its active-turn snapshot.
pub type StateVersion = FormatVersion<THREAD_STATE_VERSION>;

impl<const N: u8> Serialize for FormatVersion<N> {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_u8(N)
    }
}

impl<'de, const N: u8> Deserialize<'de> for FormatVersion<N> {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        let found = u64::deserialize(deserializer)?;
        if found == u64::from(N) {
            Ok(Self)
        } else {
            Err(de::Error::custom(format_args!("expected version {N}")))
        }
    }
}

/// How the host learned about the thread.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ThreadStateOrigin {
    /// `thread.create` from `CodeWide`.
    Created,
    /// A session Claude already had (for example, started in a terminal).
    Discovered,
}

/// The thread's Claude session ids, oldest first; never empty. The last one
/// is the current session.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SessionChain {
    first: String,
    rest: Vec<String>,
}

impl SessionChain {
    /// A chain of one session.
    #[must_use]
    pub fn new(first: String) -> Self {
        Self {
            first,
            rest: Vec::new(),
        }
    }

    /// The Claude session the thread currently talks to.
    #[must_use]
    pub fn current(&self) -> &str {
        self.rest.last().unwrap_or(&self.first)
    }

    /// Whether `session_id` is part of the chain.
    #[must_use]
    pub fn contains(&self, session_id: &str) -> bool {
        self.iter().any(|id| id == session_id)
    }

    /// Every session id, oldest first.
    pub fn iter(&self) -> impl Iterator<Item = &str> {
        std::iter::once(self.first.as_str()).chain(self.rest.iter().map(String::as_str))
    }

    /// Appends a replacement session, which becomes the current one.
    pub fn push(&mut self, session_id: String) {
        self.rest.push(session_id);
    }
}

impl Serialize for SessionChain {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        let mut sequence = serializer.serialize_seq(Some(1 + self.rest.len()))?;
        for id in self.iter() {
            sequence.serialize_element(id)?;
        }
        sequence.end()
    }
}

impl<'de> Deserialize<'de> for SessionChain {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        let mut ids = Vec::<String>::deserialize(deserializer)?.into_iter();
        let first = ids
            .next()
            .ok_or_else(|| de::Error::custom("expected at least one session id"))?;
        Ok(Self {
            first,
            rest: ids.collect(),
        })
    }
}

/// The persisted metadata of one `CodeWide` Claude thread (`state.json`).
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", from = "super::codec::ThreadStateRecord")]
pub struct ThreadState {
    pub app_thread_id: AppThreadId,
    pub created_at: i64,
    pub cwd: String,
    pub origin: ThreadStateOrigin,
    /// Settings accepted but not applied yet (applied at the next turn boundary).
    pub pending_settings: Option<ThreadSettings>,
    pub presence: ThreadPresence,
    pub recency_at: Option<i64>,
    pub session_ids: SessionChain,
    /// Whether the current session exists in Claude's store, so the next
    /// open must `resume`.
    pub session_started: bool,
    pub settings: ThreadSettings,
    pub title: TitleOverride,
    /// Cumulative cost of the thread's turns, while every turn's cost was known.
    pub total_cost: ThreadCost,
    pub total_usage: TokenUsage,
    pub turns: Vec<TurnRecord>,
    /// Last activity the host itself caused (turn start or end).
    pub updated_at: i64,
    /// Per-model totals last seen in the current Claude session; empty for
    /// a new session, unknown when absent from the file.
    pub usage_baseline: UsageBaseline,
    pub version: StateVersion,
}

impl ThreadState {
    /// The Claude session the thread currently talks to.
    #[must_use]
    pub fn current_session_id(&self) -> &str {
        self.session_ids.current()
    }

    /// Whether the thread is a delete tombstone.
    #[must_use]
    pub fn is_deleted(&self) -> bool {
        matches!(self.presence, ThreadPresence::Deleted { .. })
    }

    /// Whether the thread is listed and archived.
    #[must_use]
    pub fn is_archived(&self) -> bool {
        matches!(self.presence, ThreadPresence::Listed { archived: true })
    }

    /// The settings the next turn runs with: pending settings when set.
    #[must_use]
    pub fn effective_settings(&self) -> &ThreadSettings {
        self.pending_settings.as_ref().unwrap_or(&self.settings)
    }

    /// Replaces the turn record with the same id, or appends it.
    pub fn put_turn_record(&mut self, record: TurnRecord) {
        match self
            .turns
            .iter_mut()
            .find(|turn| turn.turn_id == record.turn_id)
        {
            Some(slot) => *slot = record,
            None => self.turns.push(record),
        }
    }
}
