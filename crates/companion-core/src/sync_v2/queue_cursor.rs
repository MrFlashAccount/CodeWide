//! Opaque, owner-bound cursors for the durable V2 queue.

use base64::{Engine as _, engine::general_purpose::URL_SAFE_NO_PAD};
use serde::{Deserialize, Serialize};

use super::{
    auth_context::AuthenticatedContextKey,
    canonical,
    protocol::{ErrorCode, Recovery, V2Error},
    scalar::Id,
};

const PREFIX: &str = "sync-v2-queue:";

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct QueueCursor {
    v: u8,
    owner_hash: String,
    thread_id: Option<Id>,
    witness: String,
    offset: usize,
}

impl QueueCursor {
    #[must_use]
    pub fn new(
        context: &AuthenticatedContextKey,
        thread_id: Option<Id>,
        witness: String,
        offset: usize,
    ) -> Self {
        Self {
            v: 1,
            owner_hash: owner_hash(context),
            thread_id,
            witness,
            offset,
        }
    }

    pub fn encode(&self) -> Result<String, V2Error> {
        let raw = canonical::to_vec(self)
            .map_err(|_| V2Error::invalid_request("queue cursor could not be encoded"))?;
        Ok(format!("{PREFIX}{}", URL_SAFE_NO_PAD.encode(raw)))
    }

    pub fn decode(
        value: &str,
        context: &AuthenticatedContextKey,
        thread_id: Option<&Id>,
    ) -> Result<Self, V2Error> {
        let cursor = Self::decode_for_owner(value, context)?;
        if cursor.thread_id.as_ref() != thread_id {
            return Err(invalid_cursor());
        }
        Ok(cursor)
    }

    pub fn decode_for_owner(
        value: &str,
        context: &AuthenticatedContextKey,
    ) -> Result<Self, V2Error> {
        let raw = value.strip_prefix(PREFIX).ok_or_else(invalid_cursor)?;
        let decoded = URL_SAFE_NO_PAD.decode(raw).map_err(|_| invalid_cursor())?;
        let cursor: Self = serde_json::from_slice(&decoded).map_err(|_| invalid_cursor())?;
        if cursor.v != 1 || cursor.owner_hash != owner_hash(context) {
            return Err(invalid_cursor());
        }
        Ok(cursor)
    }

    #[must_use]
    pub fn witness(&self) -> &str {
        &self.witness
    }

    #[must_use]
    pub fn offset(&self) -> usize {
        self.offset
    }

    #[must_use]
    pub fn thread_id(&self) -> Option<&Id> {
        self.thread_id.as_ref()
    }
}

fn owner_hash(context: &AuthenticatedContextKey) -> String {
    blake3::hash(context.as_str().as_bytes())
        .to_hex()
        .to_string()
}

fn invalid_cursor() -> V2Error {
    V2Error {
        code: ErrorCode::InvalidCursor,
        recovery: Recovery::None,
        message: "queue cursor is invalid for this owner or thread".into(),
    }
}

pub fn stale_cursor() -> V2Error {
    V2Error {
        code: ErrorCode::StaleCursor,
        recovery: Recovery::Requery,
        message: "durable queue changed while it was paged".into(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::auth::AuthorizationContext;

    fn context(device_id: &str) -> AuthenticatedContextKey {
        AuthenticatedContextKey::derive(&AuthorizationContext::Session {
            device_id: device_id.into(),
            expires_at: u64::MAX,
        })
        .unwrap_or_else(|error| panic!("test context failed: {error:?}"))
    }

    fn id(value: &str) -> Id {
        Id::new(value).unwrap_or_else(|error| panic!("test id failed: {error}"))
    }

    #[test]
    fn cursor_is_bound_to_owner_thread_and_wire_family() {
        let owner = context("device-a");
        let cursor = QueueCursor::new(&owner, Some(id("thread-a")), "witness".into(), 100);
        let encoded = cursor
            .encode()
            .unwrap_or_else(|error| panic!("encode failed: {error:?}"));
        assert_eq!(
            QueueCursor::decode(&encoded, &owner, Some(&id("thread-a")))
                .unwrap_or_else(|error| panic!("decode failed: {error:?}")),
            cursor
        );
        for result in [
            QueueCursor::decode(&encoded, &context("device-b"), Some(&id("thread-a"))),
            QueueCursor::decode(&encoded, &owner, Some(&id("thread-b"))),
            QueueCursor::decode("sync-v2-history:opaque", &owner, Some(&id("thread-a"))),
        ] {
            let Err(error) = result else {
                panic!("invalid cursor was accepted");
            };
            assert_eq!(error.code, ErrorCode::InvalidCursor);
        }
    }

    #[test]
    fn revision_tokens_fit_the_contract_for_the_largest_thread_identity() {
        let owner = context("device-a");
        let uuid_revision = QueueCursor::new(
            &owner,
            Some(id("01a01abd-6c85-73b2-afc9-6d5b6cd725da")),
            "f".repeat(64),
            0,
        )
        .encode()
        .unwrap_or_else(|error| panic!("encode failed: {error:?}"));
        assert!(uuid_revision.len() > 256);

        let largest_revision =
            QueueCursor::new(&owner, Some(id(&"x".repeat(256))), "f".repeat(64), 0)
                .encode()
                .unwrap_or_else(|error| panic!("encode failed: {error:?}"));
        assert!(largest_revision.len() <= 1_024);
    }
}
