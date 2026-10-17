//! Which records of a rollout are its thread's own history, decided by the
//! rollout's first `session_meta` (its header).
//!
//! A rollout's records are its thread's own unless the header says otherwise:
//!
//! - A paginated user fork continues the prefix of another rollout
//!   (`history_base`, see [`crate::history_base`]); its own records are all
//!   its own and its history goes on in the base.
//! - A sub-agent child Codex spawned (`source.subagent.thread_spawn`) with the
//!   parent's turns (`fork_turns` other than `"none"`) starts with a copy of
//!   the parent's history written inline: the parent's `session_meta`, a
//!   `compacted` record and parent turns under the parent's turn ids. The
//!   child's own records start at the zero-based record index
//!   `subagent_history_start_ordinal` (Codex 0.161 and later; its own history
//!   projection starts there too). An older child that names `forked_from_id`
//!   without that ordinal owns the turns minted after the child (`UUIDv7` time).
//!   A child spawned without the parent's turns names neither and owns every
//!   record. A child never continues another rollout.
//!
//! The header and the records before the child's own start never change in
//! an append-only rollout, so [`RolloutOrigins`] resolves them once per file.

use std::{
    collections::HashMap,
    fs::File,
    io::{BufRead, BufReader, Read},
    path::Path,
    sync::{Mutex, PoisonError},
};

use agent_index::file::file_identity;
use serde::Deserialize;
use serde_json::Value;

use crate::{
    history_base::{HistoryBase, HistoryBaseRecord},
    rollout_store::TurnRef,
};

/// The longest first line read for `session_meta`; it carries the base
/// instructions, which are tens of kilobytes.
const MAX_SESSION_META_BYTES: u64 = 16 * 1024 * 1024;

/// Rollouts whose origin is remembered before the memo starts over.
const MAX_REMEMBERED_ORIGINS: usize = 16_384;

/// How a rollout's records relate to other threads' history.
#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) enum RolloutOrigin {
    /// The thread began in this rollout: every record is its own. Also a
    /// rollout without a complete `session_meta` header.
    Own,
    /// A paginated user fork whose history continues in `HistoryBase`.
    Fork(HistoryBase),
    /// A sub-agent child; it never continues another rollout.
    Subagent(OwnTurns),
}

impl RolloutOrigin {
    /// The turns of this rollout that are its thread's own history.
    pub(crate) const fn own_turns(&self) -> OwnTurns {
        match self {
            Self::Own | Self::Fork(_) => OwnTurns::All,
            Self::Subagent(own) => *own,
        }
    }

    /// The base a paginated fork continues; no other origin has one.
    pub(crate) const fn base(&self) -> Option<&HistoryBase> {
        match self {
            Self::Fork(base) => Some(base),
            Self::Own | Self::Subagent(_) => None,
        }
    }
}

/// The turns of a rollout that belong to its thread.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum OwnTurns {
    /// Every turn.
    All,
    /// Turns starting at or after this byte offset: the record at
    /// `subagent_history_start_ordinal`, or the end of the rollout while
    /// that record is not written yet.
    From(u64),
    /// Turns whose `UUIDv7` id was minted no earlier than this Unix millisecond
    /// (the child thread id's); a turn id that is not `UUIDv7` is the child's.
    MintedSince(u64),
}

impl OwnTurns {
    /// Whether `turn` is the thread's own.
    pub(crate) fn owns(self, turn: &TurnRef) -> bool {
        match self {
            Self::All => true,
            Self::From(offset) => turn.start_offset >= offset,
            Self::MintedSince(millis) => {
                uuid_v7_millis(&turn.id).is_none_or(|minted| minted >= millis)
            }
        }
    }

    /// Whether some records of the rollout are another thread's history.
    pub(crate) const fn excludes_inherited(self) -> bool {
        !matches!(self, Self::All)
    }

    /// Keeps only the thread's own turns; returns whether any was dropped.
    pub(crate) fn retain(self, turns: &mut Vec<TurnRef>) -> bool {
        let before = turns.len();
        if self.excludes_inherited() {
            turns.retain(|turn| self.owns(turn));
        }
        turns.len() != before
    }
}

/// A header read that may change once more of the rollout is durable.
enum Resolution {
    /// Final for this file: the header and the child's own start are durable.
    Settled(RolloutOrigin),
    /// Valid now, read again later: the header line or the record at the
    /// child's own start is not written yet.
    Pending(RolloutOrigin),
}

/// The resolved origins of rollouts, one per file identity.
#[derive(Default)]
pub(crate) struct RolloutOrigins {
    settled: Mutex<HashMap<[u8; 32], SettledOrigin>>,
}

/// The settled origin of the file with `identity` (device, inode) at a path;
/// a replaced file is read again.
struct SettledOrigin {
    identity: (u64, u64),
    origin: RolloutOrigin,
}

impl RolloutOrigins {
    /// The origin of the rollout at `path`, read once per file.
    ///
    /// # Errors
    ///
    /// Returns an error when the rollout cannot be read.
    pub(crate) fn origin(&self, file_id: [u8; 32], path: &Path) -> std::io::Result<RolloutOrigin> {
        let file = File::open(path)?;
        let identity = file_identity(&file.metadata()?);
        if let Some(known) = self
            .settled
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .get(&file_id)
            && known.identity == identity
        {
            return Ok(known.origin.clone());
        }
        match read_origin(file)? {
            Resolution::Settled(origin) => {
                let mut settled = self.settled.lock().unwrap_or_else(PoisonError::into_inner);
                if settled.len() >= MAX_REMEMBERED_ORIGINS {
                    settled.clear();
                }
                settled.insert(
                    file_id,
                    SettledOrigin {
                        identity,
                        origin: origin.clone(),
                    },
                );
                Ok(origin)
            }
            Resolution::Pending(origin) => Ok(origin),
        }
    }
}

#[derive(Deserialize)]
struct Header {
    #[serde(rename = "type")]
    kind: String,
    #[serde(default)]
    payload: Option<SessionMeta>,
}

#[derive(Deserialize)]
struct SessionMeta {
    #[serde(default)]
    id: Option<String>,
    #[serde(default)]
    forked_from_id: Option<String>,
    #[serde(default)]
    history_base: Option<HistoryBaseRecord>,
    #[serde(default)]
    subagent_history_start_ordinal: Option<u64>,
    #[serde(default)]
    source: Value,
}

/// What the header line alone says.
#[derive(Debug, Eq, PartialEq)]
enum HeaderOrigin {
    Known(RolloutOrigin),
    /// A child whose own records start at this record index.
    SubagentFromRecord(u64),
}

fn read_origin(file: File) -> std::io::Result<Resolution> {
    let mut reader = BufReader::new(file);
    let mut line = Vec::new();
    (&mut reader)
        .take(MAX_SESSION_META_BYTES)
        .read_until(b'\n', &mut line)?;
    if line.last() != Some(&b'\n') {
        return Ok(Resolution::Pending(RolloutOrigin::Own));
    }
    Ok(match header_origin(&line) {
        HeaderOrigin::Known(origin) => Resolution::Settled(origin),
        HeaderOrigin::SubagentFromRecord(ordinal) => {
            match record_offset(&mut reader, line.len() as u64, ordinal)? {
                Some(offset) => {
                    Resolution::Settled(RolloutOrigin::Subagent(OwnTurns::From(offset)))
                }
                None => Resolution::Pending(RolloutOrigin::Subagent(OwnTurns::From(u64::MAX))),
            }
        }
    })
}

fn header_origin(line: &[u8]) -> HeaderOrigin {
    let Ok(header) = serde_json::from_slice::<Header>(line) else {
        return HeaderOrigin::Known(RolloutOrigin::Own);
    };
    let Some(meta) = header.payload.filter(|_| header.kind == "session_meta") else {
        return HeaderOrigin::Known(RolloutOrigin::Own);
    };
    let spawn = meta
        .source
        .get("subagent")
        .or_else(|| meta.source.get("subAgent"))
        .and_then(|subagent| subagent.get("thread_spawn"));
    if spawn.is_none() {
        return HeaderOrigin::Known(
            meta.history_base
                .and_then(HistoryBaseRecord::into_base)
                .map_or(RolloutOrigin::Own, RolloutOrigin::Fork),
        );
    }
    if let Some(ordinal) = meta.subagent_history_start_ordinal {
        return HeaderOrigin::SubagentFromRecord(ordinal);
    }
    let copied_parent = meta.forked_from_id.is_some_and(|parent| !parent.is_empty());
    let own = meta
        .id
        .as_deref()
        .and_then(uuid_v7_millis)
        .filter(|_| copied_parent)
        .map_or(OwnTurns::All, OwnTurns::MintedSince);
    HeaderOrigin::Known(RolloutOrigin::Subagent(own))
}

/// The byte offset of the record at zero-based index `ordinal`, reading on
/// from the end of the header (record 0) at `offset`; `None` while fewer
/// complete records precede it.
fn record_offset<R: BufRead>(
    reader: &mut R,
    mut offset: u64,
    ordinal: u64,
) -> std::io::Result<Option<u64>> {
    if ordinal == 0 {
        return Ok(Some(0));
    }
    let mut remaining = ordinal - 1;
    while remaining > 0 {
        let buffer = reader.fill_buf()?;
        if buffer.is_empty() {
            return Ok(None);
        }
        let consumed = match memchr::memchr(b'\n', buffer) {
            Some(newline) => {
                remaining -= 1;
                newline + 1
            }
            None => buffer.len(),
        };
        reader.consume(consumed);
        offset += consumed as u64;
    }
    // The record itself must have started: its first byte is durable.
    Ok((!reader.fill_buf()?.is_empty()).then_some(offset))
}

/// The Unix millisecond timestamp of a canonical `UUIDv7` string.
fn uuid_v7_millis(id: &str) -> Option<u64> {
    let bytes = id.as_bytes();
    let canonical = bytes.len() == 36
        && bytes.iter().enumerate().all(|(index, byte)| match index {
            8 | 13 | 18 | 23 => *byte == b'-',
            _ => byte.is_ascii_hexdigit(),
        });
    if !canonical
        || bytes[14] != b'7'
        || !matches!(bytes[19], b'8' | b'9' | b'a' | b'b' | b'A' | b'B')
    {
        return None;
    }
    let hex = [&id[0..8], &id[9..13]].concat();
    u64::from_str_radix(&hex, 16).ok()
}

#[cfg(test)]
mod tests {
    use std::io::Write;

    use serde_json::{Value, json};

    use super::{
        HeaderOrigin, OwnTurns, RolloutOrigin, RolloutOrigins, header_origin, uuid_v7_millis,
    };
    use crate::{history_base::HistoryBase, rollout_store::TurnRef};

    fn line(value: &Value) -> Vec<u8> {
        let mut line = serde_json::to_vec(value).unwrap_or_default();
        line.push(b'\n');
        line
    }

    fn known(value: &Value) -> Option<RolloutOrigin> {
        match header_origin(&line(value)) {
            HeaderOrigin::Known(origin) => Some(origin),
            HeaderOrigin::SubagentFromRecord(_) => None,
        }
    }

    fn spawn() -> Value {
        json!({"subagent": {"thread_spawn": {"parent_thread_id": "01a0e973-6795-78b0-b090-502922be4d7f", "depth": 1}}})
    }

    #[test]
    fn a_paginated_fork_names_its_parent_and_fork_point() {
        let record = json!({"timestamp":"2026-10-12T09:01:27.092Z", "ordinal":59507, "type":"session_meta",
            "payload":{"id":"fork", "forked_from_id":"parent", "history_mode":"paginated",
                "history_base":{"thread_id":"parent", "end_ordinal_exclusive":59507, "end_byte_offset":362_687_652_u64}}});
        assert_eq!(
            known(&record),
            Some(RolloutOrigin::Fork(HistoryBase {
                rollout_id: "parent".into(),
                end_byte_offset: 362_687_652,
            }))
        );
    }

    #[test]
    fn rollouts_without_a_base_own_their_history() {
        for record in [
            json!({"type":"session_meta", "payload":{"id":"thread", "history_mode":"paginated"}}),
            json!({"type":"session_meta", "payload":{"history_base":{"thread_id":"", "end_byte_offset":10}}}),
            json!({"type":"session_meta", "payload":{"history_base":{"thread_id":"parent", "end_byte_offset":0}}}),
            json!({"type":"event_msg", "payload":{"type":"task_started", "turn_id":"turn"}}),
            // A Desktop thread may carry the ordinal without being a spawned child.
            json!({"type":"session_meta", "payload":{"id":"thread", "source":"vscode", "subagent_history_start_ordinal":220}}),
        ] {
            assert_eq!(known(&record), Some(RolloutOrigin::Own), "{record}");
        }
    }

    #[test]
    fn a_spawned_child_never_continues_a_base() {
        let record = json!({"type":"session_meta", "payload":{"id":"child", "source": spawn(),
            "history_base":{"thread_id":"parent", "end_byte_offset":10}}});
        assert_eq!(known(&record), Some(RolloutOrigin::Subagent(OwnTurns::All)));
    }

    #[test]
    fn a_child_that_copied_the_parent_names_where_its_own_records_start() {
        let record = json!({"type":"session_meta", "payload":{"id":"01a14155-5c46-7853-ae03-62ded1cb15e1",
            "forked_from_id":"01a0e973-6795-78b0-b090-502922be4d7f", "source": spawn(),
            "subagent_history_start_ordinal": 26}});
        assert_eq!(
            header_origin(&line(&record)),
            HeaderOrigin::SubagentFromRecord(26)
        );
    }

    #[test]
    fn an_older_child_owns_turns_minted_since_it_was_spawned() {
        let child = "01a14155-5c46-7853-ae03-62ded1cb15e1";
        let copied = json!({"type":"session_meta", "payload":{"id": child,
            "forked_from_id":"01a0e973-6795-78b0-b090-502922be4d7f", "source": spawn()}});
        let Some(RolloutOrigin::Subagent(own)) = known(&copied) else {
            panic!("a forked child is a sub-agent");
        };
        let turn = |id: &str| TurnRef {
            id: id.into(),
            start_offset: 0,
            end_offset: 1,
            completed: true,
        };
        assert!(!own.owns(&turn("01a14154-cc2b-7ac3-8669-8f0d548d8d08")));
        assert!(own.owns(&turn("01a14155-5c75-79b3-9d9e-21ed085c7f29")));
        assert!(own.owns(&turn("realtime-item")));

        let not_copied = json!({"type":"session_meta", "payload":{"id": child, "source": spawn()}});
        assert_eq!(
            known(&not_copied),
            Some(RolloutOrigin::Subagent(OwnTurns::All))
        );
        let not_v7 = json!({"type":"session_meta", "payload":{"id":"child", "forked_from_id":"parent", "source": spawn()}});
        assert_eq!(known(&not_v7), Some(RolloutOrigin::Subagent(OwnTurns::All)));
    }

    #[test]
    fn uuid_v7_time_is_read_only_from_canonical_v7_ids() {
        assert_eq!(
            uuid_v7_millis("01a14155-5c46-7853-ae03-62ded1cb15e1"),
            Some(0x01a1_4155_5c46)
        );
        assert_eq!(uuid_v7_millis("01a14155-5c46-4853-ae03-62ded1cb15e1"), None);
        assert_eq!(uuid_v7_millis("01a14155-5c46-7853-ce03-62ded1cb15e1"), None);
        assert_eq!(uuid_v7_millis("01a141555c4678 53ae0362ded1cb15e1xx"), None);
    }

    #[test]
    fn the_own_start_resolves_to_the_record_at_its_ordinal()
    -> Result<(), Box<dyn std::error::Error>> {
        let directory = tempfile::tempdir()?;
        let path = directory.path().join("rollout.jsonl");
        let header = json!({"type":"session_meta", "payload":{"id":"01a14155-5c46-7853-ae03-62ded1cb15e1",
            "forked_from_id":"parent", "source": spawn(), "subagent_history_start_ordinal": 3}});
        let mut file = std::fs::File::create(&path)?;
        file.write_all(&line(&header))?;
        file.write_all(&line(
            &json!({"type":"session_meta", "payload":{"id":"parent"}}),
        ))?;
        file.sync_all()?;
        let origins = RolloutOrigins::default();
        let file_id = agent_index::file_id(&path);
        // The record at the ordinal is not written yet: nothing is the child's.
        assert_eq!(
            origins.origin(file_id, &path)?,
            RolloutOrigin::Subagent(OwnTurns::From(u64::MAX))
        );
        file.write_all(&line(&json!({"type":"compacted", "payload":{}})))?;
        let own_start = std::fs::metadata(&path)?.len();
        file.write_all(&line(
            &json!({"type":"event_msg", "payload":{"type":"thread_settings_applied"}}),
        ))?;
        file.sync_all()?;
        assert_eq!(
            origins.origin(file_id, &path)?,
            RolloutOrigin::Subagent(OwnTurns::From(own_start))
        );
        Ok(())
    }
}
