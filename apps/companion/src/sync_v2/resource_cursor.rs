//! Opaque, owner-bound cursors for paginated thread resources.

use base64::{Engine as _, engine::general_purpose::URL_SAFE_NO_PAD};
use serde::{Deserialize, Serialize};

use super::{
    AuthenticatedContextKey, canonical,
    protocol::{ErrorCode, Recovery, ResourceScope, V2Error},
    scalar::Id,
};

const PREFIX: &str = "sync-v2-resources:";

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ResourceCursor {
    v: u8,
    owner_hash: String,
    thread_id: Id,
    scope: ResourceScope,
    witness: String,
    offset: usize,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ChangeOutputCursor {
    v: u8,
    owner_hash: String,
    thread_id: Id,
    scope: ResourceScope,
    path_hash: String,
    witness: String,
    offset: usize,
}

impl ResourceCursor {
    #[must_use]
    pub fn new(
        context: &AuthenticatedContextKey,
        thread_id: Id,
        scope: ResourceScope,
        witness: String,
        offset: usize,
    ) -> Self {
        Self {
            v: 1,
            owner_hash: owner_hash(context),
            thread_id,
            scope,
            witness,
            offset,
        }
    }

    pub fn encode(&self) -> Result<String, V2Error> {
        let raw = canonical::to_vec(self)
            .map_err(|_| V2Error::invalid_request("resource cursor could not be encoded"))?;
        Ok(format!("{PREFIX}{}", URL_SAFE_NO_PAD.encode(raw)))
    }

    pub fn decode(
        value: &str,
        context: &AuthenticatedContextKey,
        thread_id: &Id,
        scope: ResourceScope,
    ) -> Result<Self, V2Error> {
        let raw = value.strip_prefix(PREFIX).ok_or_else(invalid_cursor)?;
        let decoded = URL_SAFE_NO_PAD.decode(raw).map_err(|_| invalid_cursor())?;
        let cursor: Self = serde_json::from_slice(&decoded).map_err(|_| invalid_cursor())?;
        if cursor.v != 1
            || cursor.owner_hash != owner_hash(context)
            || &cursor.thread_id != thread_id
            || cursor.scope != scope
        {
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
}

impl ChangeOutputCursor {
    #[must_use]
    pub fn new(
        context: &AuthenticatedContextKey,
        thread_id: Id,
        scope: ResourceScope,
        path: &str,
        witness: String,
        offset: usize,
    ) -> Self {
        Self {
            v: 1,
            owner_hash: owner_hash(context),
            thread_id,
            scope,
            path_hash: blake3::hash(path.as_bytes()).to_hex().to_string(),
            witness,
            offset,
        }
    }

    pub fn encode(&self) -> Result<String, V2Error> {
        let raw = canonical::to_vec(self)
            .map_err(|_| V2Error::invalid_request("change output cursor could not be encoded"))?;
        Ok(format!("{PREFIX}change-{}", URL_SAFE_NO_PAD.encode(raw)))
    }

    pub fn decode(
        value: &str,
        context: &AuthenticatedContextKey,
        thread_id: &Id,
        scope: ResourceScope,
        path: &str,
    ) -> Result<Self, V2Error> {
        let encoded = value
            .strip_prefix(&format!("{PREFIX}change-"))
            .ok_or_else(invalid_cursor)?;
        let decoded = URL_SAFE_NO_PAD
            .decode(encoded)
            .map_err(|_| invalid_cursor())?;
        let cursor: Self = serde_json::from_slice(&decoded).map_err(|_| invalid_cursor())?;
        if cursor.v != 1
            || cursor.owner_hash != owner_hash(context)
            || &cursor.thread_id != thread_id
            || cursor.scope != scope
            || cursor.path_hash != blake3::hash(path.as_bytes()).to_hex().to_string()
        {
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
        message: "resource cursor is invalid for this owner, thread, or scope".into(),
    }
}

pub fn stale_cursor() -> V2Error {
    V2Error {
        code: ErrorCode::StaleCursor,
        recovery: Recovery::Requery,
        message: "thread resources changed while they were paged".into(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::auth::AuthorizationContext;

    fn context(device_id: &str) -> AuthenticatedContextKey {
        AuthenticatedContextKey::derive(&AuthorizationContext::Session {
            device_id: device_id.into(),
            scopes: Vec::new(),
            expires_at: u64::MAX,
        })
        .unwrap_or_else(|error| panic!("test context failed: {error:?}"))
    }

    fn id(value: &str) -> Id {
        Id::new(value).unwrap_or_else(|error| panic!("invalid id: {error}"))
    }

    #[test]
    fn cursor_is_closed_to_owner_thread_scope_and_wire_family() {
        let owner = context("device-a");
        let cursor = ResourceCursor::new(
            &owner,
            id("thread-a"),
            ResourceScope::Session,
            "revision".into(),
            100,
        );
        let encoded = cursor
            .encode()
            .unwrap_or_else(|error| panic!("encode failed: {error:?}"));
        assert_eq!(
            ResourceCursor::decode(&encoded, &owner, &id("thread-a"), ResourceScope::Session,)
                .unwrap_or_else(|error| panic!("decode failed: {error:?}")),
            cursor
        );
        assert!(
            ResourceCursor::decode(
                &encoded,
                &context("device-b"),
                &id("thread-a"),
                ResourceScope::Session,
            )
            .is_err()
        );
        assert!(
            ResourceCursor::decode(&encoded, &owner, &id("thread-b"), ResourceScope::Session,)
                .is_err()
        );
        assert!(
            ResourceCursor::decode(&encoded, &owner, &id("thread-a"), ResourceScope::Branch,)
                .is_err()
        );
    }

    #[test]
    fn change_output_cursor_is_closed_to_owner_thread_scope_and_path() {
        let owner = context("device-a");
        let cursor = ChangeOutputCursor::new(
            &owner,
            id("thread-a"),
            ResourceScope::Branch,
            "/workspace/src/main.rs",
            "snapshot.revision".into(),
            65_536,
        );
        let encoded = cursor
            .encode()
            .unwrap_or_else(|error| panic!("encode failed: {error:?}"));

        assert_eq!(
            ChangeOutputCursor::decode(
                &encoded,
                &owner,
                &id("thread-a"),
                ResourceScope::Branch,
                "/workspace/src/main.rs",
            )
            .unwrap_or_else(|error| panic!("decode failed: {error:?}")),
            cursor
        );
        assert!(
            ChangeOutputCursor::decode(
                &encoded,
                &context("device-b"),
                &id("thread-a"),
                ResourceScope::Branch,
                "/workspace/src/main.rs",
            )
            .is_err()
        );
        assert!(
            ChangeOutputCursor::decode(
                &encoded,
                &owner,
                &id("thread-b"),
                ResourceScope::Branch,
                "/workspace/src/main.rs",
            )
            .is_err()
        );
        assert!(
            ChangeOutputCursor::decode(
                &encoded,
                &owner,
                &id("thread-a"),
                ResourceScope::Unstaged,
                "/workspace/src/main.rs",
            )
            .is_err()
        );
        assert!(
            ChangeOutputCursor::decode(
                &encoded,
                &owner,
                &id("thread-a"),
                ResourceScope::Branch,
                "/workspace/src/other.rs",
            )
            .is_err()
        );
    }
}
