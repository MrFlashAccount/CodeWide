//! Pull request ↔ thread links and tombstones.
//!
//! A link is companion state only; creating or removing one never writes to
//! a forge. Sources: `branch` (detection), `manual` (the user) and `agent`
//! (`codewide_link_pull_request`). A user's unlink writes a tombstone that
//! blocks branch detection from re-adding the same pair; an explicit manual
//! or agent link clears it.

use std::sync::Arc;

use forge_protocol::PullRequestState;
use serde::{Deserialize, Serialize};

use super::{
    errors::ForgeError,
    ids::PullRequestKey,
    wire::{LinkSource, LinkedThreadWire, now_rfc3339},
};
use crate::{
    agent::model::AppThreadId,
    store::{
        IndexStore,
        forge_tables::{FORGE_LINK_TOMBSTONES, FORGE_PR_LINKS},
        kv::KvOp,
    },
};

const LINK_VERSION: u32 = 1;

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LinkRecord {
    pub version: u32,
    pub pull_request: PullRequestKey,
    pub thread_id: String,
    pub source: LinkSource,
    pub linked_at: String,
    pub plugin_id: String,
    pub number: String,
    /// The last state seen for thread badges; refreshed by reads.
    pub last_state: Option<PullRequestState>,
}

impl LinkRecord {
    #[must_use]
    pub fn wire(&self) -> LinkedThreadWire {
        LinkedThreadWire {
            thread_id: self.thread_id.clone(),
            source: self.source,
        }
    }
}

fn pair_key(pull_request: &PullRequestKey, thread: &str) -> String {
    format!("{}\0{thread}", pull_request.as_str())
}

/// The outcome of a link request.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum LinkOutcome {
    Created,
    Existing,
    /// A branch link the user removed earlier.
    Tombstoned,
}

#[derive(Clone)]
pub struct Links {
    store: Arc<IndexStore>,
}

impl Links {
    #[must_use]
    pub fn new(store: Arc<IndexStore>) -> Self {
        Self { store }
    }

    /// The links of one pull request, in thread order.
    ///
    /// # Errors
    ///
    /// Returns a storage failure.
    pub fn of_pull_request(
        &self,
        pull_request: &PullRequestKey,
    ) -> Result<Vec<LinkRecord>, ForgeError> {
        Ok(self
            .store
            .kv_scan(FORGE_PR_LINKS, &format!("{}\0", pull_request.as_str()))?
            .into_iter()
            .filter_map(|(_, value)| serde_json::from_slice(&value).ok())
            .collect())
    }

    /// The links of one thread.
    ///
    /// # Errors
    ///
    /// Returns a storage failure.
    pub fn of_thread(&self, thread: &str) -> Result<Vec<LinkRecord>, ForgeError> {
        Ok(self
            .all()?
            .into_iter()
            .filter(|link| link.thread_id == thread)
            .collect())
    }

    /// Every link.
    ///
    /// # Errors
    ///
    /// Returns a storage failure.
    pub fn all(&self) -> Result<Vec<LinkRecord>, ForgeError> {
        Ok(self
            .store
            .kv_scan(FORGE_PR_LINKS, "")?
            .into_iter()
            .filter_map(|(_, value)| serde_json::from_slice(&value).ok())
            .collect())
    }

    /// Links a thread. A `branch` link honours a tombstone; a `manual` or
    /// `agent` link is the user's explicit choice and clears it.
    ///
    /// # Errors
    ///
    /// Returns a storage failure.
    pub fn link(
        &self,
        pull_request: &PullRequestKey,
        plugin_id: &str,
        number: &str,
        thread: &AppThreadId,
        source: LinkSource,
    ) -> Result<LinkOutcome, ForgeError> {
        let key = pair_key(pull_request, thread.as_str());
        if self.store.kv_get(FORGE_PR_LINKS, &key)?.is_some() {
            return Ok(LinkOutcome::Existing);
        }
        if source == LinkSource::Branch && self.store.kv_get(FORGE_LINK_TOMBSTONES, &key)?.is_some()
        {
            return Ok(LinkOutcome::Tombstoned);
        }
        let record = LinkRecord {
            version: LINK_VERSION,
            pull_request: pull_request.clone(),
            thread_id: thread.as_str().to_owned(),
            source,
            linked_at: now_rfc3339(),
            plugin_id: plugin_id.to_owned(),
            number: number.to_owned(),
            last_state: None,
        };
        let value =
            serde_json::to_vec(&record).map_err(|error| ForgeError::internal(error.to_string()))?;
        self.store.kv_apply(vec![
            KvOp::Put {
                table: FORGE_PR_LINKS,
                key: key.clone(),
                value,
            },
            KvOp::Delete {
                table: FORGE_LINK_TOMBSTONES,
                key,
            },
        ])?;
        Ok(LinkOutcome::Created)
    }

    /// Removes a link and writes its tombstone in one transaction.
    ///
    /// # Errors
    ///
    /// Returns a storage failure.
    pub fn unlink(
        &self,
        pull_request: &PullRequestKey,
        thread: &AppThreadId,
    ) -> Result<(), ForgeError> {
        let key = pair_key(pull_request, thread.as_str());
        self.store.kv_apply(vec![
            KvOp::Delete {
                table: FORGE_PR_LINKS,
                key: key.clone(),
            },
            KvOp::Put {
                table: FORGE_LINK_TOMBSTONES,
                key,
                value: now_rfc3339().into_bytes(),
            },
        ])?;
        Ok(())
    }

    /// Records the latest state of a pull request on its links.
    ///
    /// # Errors
    ///
    /// Returns a storage failure.
    pub fn observe_state(
        &self,
        pull_request: &PullRequestKey,
        state: PullRequestState,
    ) -> Result<(), ForgeError> {
        let mut ops = Vec::new();
        for mut link in self.of_pull_request(pull_request)? {
            if link.last_state == Some(state) {
                continue;
            }
            link.last_state = Some(state);
            ops.push(KvOp::Put {
                table: FORGE_PR_LINKS,
                key: pair_key(pull_request, &link.thread_id),
                value: serde_json::to_vec(&link)
                    .map_err(|error| ForgeError::internal(error.to_string()))?,
            });
        }
        if !ops.is_empty() {
            self.store.kv_apply(ops)?;
        }
        Ok(())
    }
}

#[cfg(test)]
#[allow(clippy::expect_used)]
mod tests {
    use forge_protocol::ForgePrRef;

    use super::*;

    #[test]
    fn a_tombstone_blocks_branch_relinking_but_not_an_explicit_link() {
        let directory = tempfile::tempdir().expect("dir");
        let store = Arc::new(IndexStore::open(directory.path().join("state.redb")).expect("store"));
        let links = Links::new(store);
        let pr = PullRequestKey::issue(
            "github",
            &ForgePrRef {
                host: "github.com".into(),
                repository: "o/r".into(),
                number: "1".into(),
            },
        );
        let thread = AppThreadId::parse("thread-1").expect("thread");
        assert_eq!(
            links
                .link(&pr, "github", "1", &thread, LinkSource::Branch)
                .expect("link"),
            LinkOutcome::Created
        );
        links.unlink(&pr, &thread).expect("unlink");
        assert!(links.of_pull_request(&pr).expect("links").is_empty());
        assert_eq!(
            links
                .link(&pr, "github", "1", &thread, LinkSource::Branch)
                .expect("link"),
            LinkOutcome::Tombstoned
        );
        assert_eq!(
            links
                .link(&pr, "github", "1", &thread, LinkSource::Manual)
                .expect("link"),
            LinkOutcome::Created
        );
        assert_eq!(links.of_thread("thread-1").expect("links").len(), 1);
    }
}
