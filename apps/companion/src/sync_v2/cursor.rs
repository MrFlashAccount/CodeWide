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
const INVALID_V1_CONTINUATION_MESSAGE: &str = "history projection returned an invalid continuation";

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct V1SourceContinuation {
    source_offset: u64,
}

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

/// Extracts the required rollout offset from a V1 history continuation.
///
/// # Errors
///
/// Returns a retryable `sourceUnavailable` error when the source continuation
/// has the wrong wire family or cannot prove an explicit unsigned offset.
pub fn v1_source_offset(value: &str) -> Result<u64, V2Error> {
    let raw = value
        .strip_prefix(V1_INTERNAL_PREFIX)
        .ok_or_else(invalid_v1_continuation)?;
    let decoded = URL_SAFE_NO_PAD
        .decode(raw)
        .map_err(|_| invalid_v1_continuation())?;
    let continuation: V1SourceContinuation =
        serde_json::from_slice(&decoded).map_err(|_| invalid_v1_continuation())?;
    Ok(continuation.source_offset)
}

fn invalid_v1_continuation() -> V2Error {
    V2Error::source_unavailable(INVALID_V1_CONTINUATION_MESSAGE)
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

    fn v1_continuation(payload: &[u8]) -> String {
        format!("{V1_INTERNAL_PREFIX}{}", URL_SAFE_NO_PAD.encode(payload))
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

    #[test]
    fn v1_source_continuation_preserves_explicit_offsets() {
        for offset in [0, 42] {
            let continuation = v1_continuation(
                serde_json::to_vec(&serde_json::json!({
                    "kind": "turns",
                    "threadId": "thread-a",
                    "direction": "desc",
                    "offset": 0,
                    "sourceOffset": offset,
                }))
                .unwrap_or_else(|error| panic!("test continuation encode failed: {error}"))
                .as_slice(),
            );
            assert_eq!(
                v1_source_offset(&continuation)
                    .unwrap_or_else(|error| panic!("valid continuation was rejected: {error:?}")),
                offset
            );
        }
    }

    #[test]
    fn malformed_v1_source_continuations_fail_closed() {
        let malformed_json = v1_continuation(b"not-json");
        let missing_offset = v1_continuation(
            serde_json::to_vec(&serde_json::json!({
                "kind": "turns",
                "threadId": "thread-a",
                "direction": "desc",
                "offset": 0,
            }))
            .unwrap_or_else(|error| panic!("test continuation encode failed: {error}"))
            .as_slice(),
        );

        for continuation in [
            "wrong-prefix:opaque".to_owned(),
            format!("{V1_INTERNAL_PREFIX}not-base64!"),
            malformed_json,
            missing_offset,
        ] {
            let error = match v1_source_offset(&continuation) {
                Err(error) => error,
                Ok(offset) => panic!("malformed continuation produced offset {offset}"),
            };
            assert_eq!(error.code, ErrorCode::SourceUnavailable);
            assert_eq!(error.recovery, Recovery::Retry);
            assert_eq!(error.message, INVALID_V1_CONTINUATION_MESSAGE);
            assert!(error.message.len() <= 128);
        }
    }
}
