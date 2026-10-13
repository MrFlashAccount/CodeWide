//! The inherited history of a paginated Codex fork.
//!
//! Codex writes a paginated fork's rollout without the conversation before the
//! fork point. The fork's `session_meta` names the parent thread and the byte
//! offset its history runs through (`history_base`); the turns before that
//! offset stay in the parent's rollout, which keeps growing on its own. A fork
//! of a fork repeats this, so a thread's history is a chain of rollouts.

use std::{
    fs::File,
    io::{BufRead, BufReader, Read},
    path::Path,
};

use serde::Deserialize;

/// The longest first line read for `session_meta`; it carries the base
/// instructions, which are tens of kilobytes.
const MAX_SESSION_META_BYTES: u64 = 16 * 1024 * 1024;

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

#[derive(Deserialize)]
struct FirstRecord {
    #[serde(rename = "type")]
    kind: String,
    #[serde(default)]
    payload: Option<SessionMeta>,
}

#[derive(Deserialize)]
struct SessionMeta {
    #[serde(default)]
    history_base: Option<HistoryBaseRecord>,
}

#[derive(Deserialize)]
struct HistoryBaseRecord {
    thread_id: String,
    end_byte_offset: u64,
}

/// Reads the inherited history a rollout continues, if any.
///
/// A rollout without a complete `session_meta` first line, or whose
/// `session_meta` names no `history_base`, owns its whole history.
///
/// # Errors
///
/// Returns an error when the rollout cannot be read.
pub(crate) fn read_history_base(path: &Path) -> Result<Option<HistoryBase>, std::io::Error> {
    let mut line = Vec::new();
    BufReader::new(File::open(path)?)
        .take(MAX_SESSION_META_BYTES)
        .read_until(b'\n', &mut line)?;
    if line.last() != Some(&b'\n') {
        return Ok(None);
    }
    Ok(history_base_from_line(&line))
}

fn history_base_from_line(line: &[u8]) -> Option<HistoryBase> {
    let record: FirstRecord = serde_json::from_slice(line).ok()?;
    if record.kind != "session_meta" {
        return None;
    }
    let base = record.payload?.history_base?;
    (!base.thread_id.is_empty() && base.end_byte_offset > 0).then_some(HistoryBase {
        rollout_id: base.thread_id,
        end_byte_offset: base.end_byte_offset,
    })
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::{HistoryBase, history_base_from_line};

    fn line(value: &serde_json::Value) -> Vec<u8> {
        let mut line = serde_json::to_vec(value).unwrap_or_default();
        line.push(b'\n');
        line
    }

    #[test]
    fn a_paginated_fork_names_its_parent_and_fork_point() {
        let record = json!({"timestamp":"2026-10-12T09:01:27.092Z", "ordinal":59507, "type":"session_meta",
            "payload":{"id":"fork", "forked_from_id":"parent", "history_mode":"paginated",
                "history_base":{"thread_id":"parent", "end_ordinal_exclusive":59507, "end_byte_offset":362_687_652_u64}}});
        assert_eq!(
            history_base_from_line(&line(&record)),
            Some(HistoryBase {
                rollout_id: "parent".into(),
                end_byte_offset: 362_687_652,
            })
        );
    }

    #[test]
    fn rollouts_without_a_base_own_their_history() {
        for record in [
            json!({"type":"session_meta", "payload":{"id":"thread", "history_mode":"paginated"}}),
            json!({"type":"session_meta", "payload":{"history_base":{"thread_id":"", "end_byte_offset":10}}}),
            json!({"type":"session_meta", "payload":{"history_base":{"thread_id":"parent", "end_byte_offset":0}}}),
            json!({"type":"event_msg", "payload":{"type":"task_started", "turn_id":"turn"}}),
        ] {
            assert_eq!(history_base_from_line(&line(&record)), None, "{record}");
        }
    }
}
