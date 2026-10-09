//! Durable parent → child links of agents spawned with the orchestration
//! tools, stored in the companion index (`agent_subagent_children`,
//! `agent_subagent_parents`). A link is written before the child's first
//! turn starts and is never removed, so a restarted companion still knows
//! every agent a thread may address.

use std::sync::Arc;

use serde::{Deserialize, Serialize};

use crate::{agent::model::ProviderId, store::IndexStore};

const LINK_VERSION: u32 = 1;

/// One spawned agent.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChildLink {
    pub v: u32,
    pub parent_thread_id: String,
    pub child_thread_id: String,
    pub provider: ProviderId,
    pub model: String,
    pub name: Option<String>,
    pub cwd: String,
    /// Unix seconds.
    pub created_at: i64,
}

impl ChildLink {
    #[must_use]
    pub fn new(
        parent_thread_id: String,
        child_thread_id: String,
        provider: ProviderId,
        model: String,
        name: Option<String>,
        cwd: String,
    ) -> Self {
        let created_at = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map_or(0, |elapsed| {
                i64::try_from(elapsed.as_secs()).unwrap_or(i64::MAX)
            });
        Self {
            v: LINK_VERSION,
            parent_thread_id,
            child_thread_id,
            provider,
            model,
            name,
            cwd,
            created_at,
        }
    }
}

#[derive(Debug, thiserror::Error)]
pub enum LinkError {
    #[error(transparent)]
    Store(#[from] crate::store::StoreError),
    #[error("subagent link record is invalid: {0}")]
    Invalid(#[from] serde_json::Error),
    #[error("subagent link worker failed: {0}")]
    Worker(String),
}

/// The link store.
#[derive(Clone)]
pub struct ChildLinks {
    store: Arc<IndexStore>,
}

impl ChildLinks {
    #[must_use]
    pub const fn new(store: Arc<IndexStore>) -> Self {
        Self { store }
    }

    async fn blocking<T: Send + 'static>(
        &self,
        work: impl FnOnce(&IndexStore) -> Result<T, LinkError> + Send + 'static,
    ) -> Result<T, LinkError> {
        let store = self.store.clone();
        tokio::task::spawn_blocking(move || work(&store))
            .await
            .map_err(|error| LinkError::Worker(error.to_string()))?
    }

    /// Writes one link.
    ///
    /// # Errors
    /// Returns the store failure.
    pub async fn link(&self, link: &ChildLink) -> Result<(), LinkError> {
        let record = serde_json::to_vec(link)?;
        let parent = link.parent_thread_id.clone();
        let child = link.child_thread_id.clone();
        self.blocking(move |store| Ok(store.put_agent_subagent_link(&parent, &child, &record)?))
            .await
    }

    /// The links of one parent's children, ordered by child id.
    ///
    /// # Errors
    /// Returns the store failure or an invalid record.
    pub async fn children(&self, parent: &str) -> Result<Vec<ChildLink>, LinkError> {
        let parent = parent.to_owned();
        self.blocking(move |store| Self::children_blocking(store, &parent))
            .await
    }

    fn children_blocking(store: &IndexStore, parent: &str) -> Result<Vec<ChildLink>, LinkError> {
        store
            .agent_subagent_children(parent)?
            .iter()
            .map(|record| serde_json::from_slice(record).map_err(LinkError::from))
            .collect()
    }

    /// Every descendant link of `root`, parents before children.
    ///
    /// # Errors
    /// Returns the store failure or an invalid record.
    pub async fn descendants(&self, root: &str) -> Result<Vec<ChildLink>, LinkError> {
        let root = root.to_owned();
        self.blocking(move |store| {
            let mut pending = vec![root];
            let mut seen = std::collections::HashSet::new();
            let mut descendants = Vec::new();
            while let Some(parent) = pending.pop() {
                for link in Self::children_blocking(store, &parent)? {
                    if seen.insert(link.child_thread_id.clone()) {
                        pending.push(link.child_thread_id.clone());
                        descendants.push(link);
                    }
                }
            }
            Ok(descendants)
        })
        .await
    }

    /// The parent of a linked child.
    ///
    /// # Errors
    /// Returns the store failure.
    pub async fn parent_of(&self, child: &str) -> Result<Option<String>, LinkError> {
        let child = child.to_owned();
        self.blocking(move |store| Ok(store.agent_subagent_parent(&child)?))
            .await
    }

    /// Every linked child id (startup).
    ///
    /// # Errors
    /// Returns the store failure.
    pub fn child_ids(&self) -> Result<Vec<String>, LinkError> {
        Ok(self.store.agent_subagent_child_ids()?)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn links_survive_reopening_and_walk_descendants() -> Result<(), Box<dyn std::error::Error>>
    {
        let directory = tempfile::tempdir()?;
        let path = directory.path().join("state.redb");
        let link = |parent: &str, child: &str| {
            ChildLink::new(
                parent.into(),
                child.into(),
                ProviderId::from_static("claude"),
                "m".into(),
                None,
                "/w".into(),
            )
        };
        {
            let links = ChildLinks::new(Arc::new(IndexStore::open(&path)?));
            links.link(&link("p", "c1")).await?;
            links.link(&link("p", "c2")).await?;
            links.link(&link("c1", "g1")).await?;
            links.link(&link("p-other", "x")).await?;
        }
        let links = ChildLinks::new(Arc::new(IndexStore::open(&path)?));
        let children = links.children("p").await?;
        assert_eq!(
            children
                .iter()
                .map(|link| link.child_thread_id.as_str())
                .collect::<Vec<_>>(),
            ["c1", "c2"]
        );
        let mut descendants = links
            .descendants("p")
            .await?
            .into_iter()
            .map(|link| link.child_thread_id)
            .collect::<Vec<_>>();
        descendants.sort();
        assert_eq!(descendants, ["c1", "c2", "g1"]);
        assert_eq!(links.parent_of("g1").await?.as_deref(), Some("c1"));
        assert_eq!(links.parent_of("p").await?, None);
        let mut ids = links.child_ids()?;
        ids.sort();
        assert_eq!(ids, ["c1", "c2", "g1", "x"]);
        Ok(())
    }
}
