//! Durable pull-request attention markers.
//!
//! A provider's update witness is hashed before it leaves this module. The
//! stored and client-visible revision is therefore content-free and can be
//! compared across restarts without persisting forge content.

use std::sync::Arc;

use serde::{Deserialize, Serialize};
use serde_json::Value;

use super::{ForgeContext, errors::ForgeError, ids::PullRequestKey, params};
use crate::store::{IndexStore, forge_tables::FORGE_PR_ATTENTION, kv::KvOp};

const REVISION_BYTES: usize = 64;

/// Whether the current PR activity revision was already displayed.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum AttentionState {
    New,
    Seen,
}

/// Content-free attention state returned with list rows and an overview.
#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AttentionWire {
    pub revision: String,
    pub state: AttentionState,
}

/// Durable owner of the revision last displayed for each PR.
#[derive(Clone)]
pub struct AttentionStore {
    store: Arc<IndexStore>,
}

impl AttentionStore {
    #[must_use]
    pub fn new(store: Arc<IndexStore>) -> Self {
        Self { store }
    }

    /// Hashes a provider witness into a fixed content-free revision.
    #[must_use]
    pub fn revision(witness: &str) -> String {
        blake3::hash(witness.as_bytes()).to_hex().to_string()
    }

    /// Returns whether `revision` matches the last revision displayed.
    ///
    /// # Errors
    /// Returns a storage failure when the marker cannot be read.
    pub fn state(
        &self,
        pull_request: &PullRequestKey,
        revision: String,
    ) -> Result<AttentionWire, ForgeError> {
        let seen = self
            .store
            .kv_get(FORGE_PR_ATTENTION, pull_request.as_str())?
            .is_some_and(|stored| stored == revision.as_bytes());
        Ok(AttentionWire {
            revision,
            state: if seen {
                AttentionState::Seen
            } else {
                AttentionState::New
            },
        })
    }

    /// Records one exact revision as displayed. Repeating the write is safe.
    ///
    /// # Errors
    /// Returns invalid params for a revision not issued by this module, or a
    /// storage failure when the marker cannot be committed.
    pub fn mark_seen(
        &self,
        pull_request: &PullRequestKey,
        revision: &str,
    ) -> Result<AttentionWire, ForgeError> {
        if !valid_revision(revision) {
            return Err(ForgeError::invalid("invalid attention revision"));
        }
        self.store.kv_apply(vec![KvOp::Put {
            table: FORGE_PR_ATTENTION,
            key: pull_request.as_str().to_owned(),
            value: revision.as_bytes().to_vec(),
        }])?;
        Ok(AttentionWire {
            revision: revision.to_owned(),
            state: AttentionState::Seen,
        })
    }
}

fn valid_revision(value: &str) -> bool {
    value.len() == REVISION_BYTES
        && value
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct MarkSeenRequest {
    pull_request: Value,
    revision: String,
}

/// `companion/pullRequest/attention/seen`: records the exact revision the
/// client actually displayed, then invalidates server-side list snapshots.
/// The active client intentionally keeps its current grouping until the next
/// list read so opening a row cannot move it underneath the pointer.
///
/// # Errors
/// Returns invalid params for an unknown PR or revision, or a storage failure.
pub fn mark_seen(context: &ForgeContext, raw: &Value) -> Result<Value, ForgeError> {
    let request: MarkSeenRequest = params(raw)?;
    let (pull_request, _) = ForgeContext::pull_request(&request.pull_request)?;
    let attention = context
        .attention
        .mark_seen(&pull_request, &request.revision)?;
    context.cache.invalidate_lists();
    serde_json::to_value(attention).map_err(|error| ForgeError::internal(error.to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_result<T>(result: Result<T, ForgeError>) -> Result<T, std::io::Error> {
        result.map_err(|error| std::io::Error::other(format!("{error:?}")))
    }

    #[test]
    fn a_marker_is_durable_and_exact_to_one_revision() -> Result<(), Box<dyn std::error::Error>> {
        let directory = tempfile::tempdir()?;
        let store = Arc::new(IndexStore::open(directory.path().join("state.redb"))?);
        let attention = AttentionStore::new(store.clone());
        let key = PullRequestKey::issue(
            "plugin",
            &forge_protocol::ForgePrRef {
                host: "forge.example".into(),
                repository: "team/repo".into(),
                number: "7".into(),
            },
        );
        let first = AttentionStore::revision("first");
        let second = AttentionStore::revision("second");

        assert_eq!(
            test_result(attention.state(&key, first.clone()))?.state,
            AttentionState::New
        );
        test_result(attention.mark_seen(&key, &first))?;
        let restored = AttentionStore::new(store);
        assert_eq!(
            test_result(restored.state(&key, first))?.state,
            AttentionState::Seen
        );
        assert_eq!(
            test_result(restored.state(&key, second))?.state,
            AttentionState::New
        );
        Ok(())
    }
}
