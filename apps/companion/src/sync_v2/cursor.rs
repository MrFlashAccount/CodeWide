//! V2-owned history cursors and source-witness validation.

use base64::{Engine as _, engine::general_purpose::URL_SAFE_NO_PAD};
use serde::{Deserialize, Serialize};

use super::{
    canonical,
    protocol::{HistoryDirection, V2Error},
    scalar::{Id, Timestamp, U64},
};

const PREFIX: &str = "sync-v2-history:";
const V1_INTERNAL_PREFIX: &str = "codewide-history-v1:";

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct HistoryCursor {
    v: u8,
    thread_id: Id,
    direction: HistoryDirection,
    anchor: HistoryAnchor,
    source: SourceWitness,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct HistoryAnchor {
    pub turn_id: Id,
    pub start_offset: Option<U64>,
    pub end_offset: Option<U64>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum SourceWitness {
    Rollout {
        device: U64,
        inode: U64,
        anchor_hash: String,
        durable_end: U64,
    },
    Live {
        generation: U64,
        head_turn_id: Option<Id>,
        updated_at: Timestamp,
    },
}

impl HistoryCursor {
    pub fn new(
        thread_id: Id,
        direction: HistoryDirection,
        anchor: HistoryAnchor,
        source: SourceWitness,
    ) -> Self {
        Self {
            v: 1,
            thread_id,
            direction,
            anchor,
            source,
        }
    }

    pub fn encode(&self) -> Result<String, V2Error> {
        let raw = canonical::to_vec(self)
            .map_err(|_| V2Error::invalid_request("history cursor could not be encoded"))?;
        Ok(format!("{PREFIX}{}", URL_SAFE_NO_PAD.encode(raw)))
    }

    pub fn decode(
        value: &str,
        thread_id: &Id,
        direction: HistoryDirection,
    ) -> Result<Self, V2Error> {
        let raw = value.strip_prefix(PREFIX).ok_or_else(invalid_cursor)?;
        let decoded = URL_SAFE_NO_PAD.decode(raw).map_err(|_| invalid_cursor())?;
        let cursor: Self = serde_json::from_slice(&decoded).map_err(|_| invalid_cursor())?;
        if cursor.v != 1 || &cursor.thread_id != thread_id || cursor.direction != direction {
            return Err(invalid_cursor());
        }
        Ok(cursor)
    }

    #[must_use]
    pub fn source(&self) -> &SourceWitness {
        &self.source
    }

    #[must_use]
    pub fn thread_id(&self) -> &Id {
        &self.thread_id
    }

    #[must_use]
    pub fn anchor(&self) -> &HistoryAnchor {
        &self.anchor
    }

    pub fn internal_v1_cursor(&self) -> Result<String, V2Error> {
        let source_offset = self.anchor.start_offset.map(U64::get);
        let raw = serde_json::to_vec(&serde_json::json!({
            "kind": "turns",
            "threadId": self.thread_id.as_str(),
            "direction": "desc",
            "offset": 0,
            "sourceOffset": source_offset,
        }))
        .map_err(|_| invalid_cursor())?;
        Ok(format!(
            "{V1_INTERNAL_PREFIX}{}",
            URL_SAFE_NO_PAD.encode(raw)
        ))
    }
}

pub fn v1_source_offset(value: &str) -> Option<u64> {
    let raw = value.strip_prefix(V1_INTERNAL_PREFIX)?;
    let decoded = URL_SAFE_NO_PAD.decode(raw).ok()?;
    serde_json::from_slice::<serde_json::Value>(&decoded)
        .ok()?
        .get("sourceOffset")?
        .as_u64()
}

fn invalid_cursor() -> V2Error {
    V2Error {
        code: super::protocol::ErrorCode::InvalidCursor,
        recovery: super::protocol::Recovery::None,
        message: "history cursor is invalid for this thread or direction".into(),
    }
}

pub fn stale_cursor() -> V2Error {
    V2Error {
        code: super::protocol::ErrorCode::StaleCursor,
        recovery: super::protocol::Recovery::Requery,
        message: "history source witness changed".into(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::sync_v2::protocol::{ErrorCode, Recovery};

    fn id(value: &str) -> Id {
        Id::new(value).unwrap_or_else(|error| panic!("invalid test id: {error}"))
    }

    #[test]
    fn cursor_is_closed_to_thread_direction_version_and_wire_family() {
        let cursor = HistoryCursor::new(
            id("thread-a"),
            HistoryDirection::Older,
            HistoryAnchor {
                turn_id: id("turn-a"),
                start_offset: Some(U64::new(10)),
                end_offset: Some(U64::new(20)),
            },
            SourceWitness::Live {
                generation: U64::new(7),
                head_turn_id: Some(id("turn-a")),
                updated_at: Timestamp::new("2026-08-28T00:00:00Z")
                    .unwrap_or_else(|error| panic!("invalid timestamp: {error}")),
            },
        );
        let encoded = cursor
            .encode()
            .unwrap_or_else(|error| panic!("cursor encode failed: {error:?}"));
        assert_eq!(
            HistoryCursor::decode(&encoded, &id("thread-a"), HistoryDirection::Older)
                .unwrap_or_else(|error| panic!("cursor decode failed: {error:?}")),
            cursor
        );
        for result in [
            HistoryCursor::decode(&encoded, &id("thread-b"), HistoryDirection::Older),
            HistoryCursor::decode(&encoded, &id("thread-a"), HistoryDirection::Newer),
            HistoryCursor::decode(
                "codewide-history-v1:opaque",
                &id("thread-a"),
                HistoryDirection::Older,
            ),
            HistoryCursor::decode(
                "sync-v2-history:not-base64!",
                &id("thread-a"),
                HistoryDirection::Older,
            ),
        ] {
            let Err(error) = result else {
                panic!("invalid cursor was accepted");
            };
            assert_eq!(error.code, ErrorCode::InvalidCursor);
            assert_eq!(error.recovery, Recovery::None);
        }
    }
}
