//! The inherited history of a paginated Codex fork.
//!
//! Codex writes a paginated fork's rollout without the conversation before the
//! fork point. The fork's `session_meta` names the parent thread and the byte
//! offset its history runs through (`history_base`); the turns before that
//! offset stay in the parent's rollout, which keeps growing on its own. A fork
//! of a fork repeats this, so a thread's history is a chain of rollouts. The
//! header is read by [`crate::rollout_origin`].

use serde::Deserialize;

/// Where a rollout's own records continue another thread's history.
#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct HistoryBase {
    /// The rollout that holds the inherited history. Codex writes the field
    /// as `thread_id`, but it names a rollout: after `thread/revert` a thread
    /// owns several rollouts and the newer one continues the older one.
    pub(crate) rollout_id: String,
    /// The exclusive end of the inherited records in that rollout. Codex
    /// writes it at a record boundary.
    pub(crate) end_byte_offset: u64,
}

/// `session_meta.history_base` as Codex writes it.
#[derive(Deserialize)]
pub(crate) struct HistoryBaseRecord {
    thread_id: String,
    end_byte_offset: u64,
}

impl HistoryBaseRecord {
    /// The base this record names; an empty rollout id or a zero fork point
    /// names none, and the rollout owns its whole history.
    pub(crate) fn into_base(self) -> Option<HistoryBase> {
        (!self.thread_id.is_empty() && self.end_byte_offset > 0).then_some(HistoryBase {
            rollout_id: self.thread_id,
            end_byte_offset: self.end_byte_offset,
        })
    }
}
