//! Thread resources of Claude threads: the shared `agent-resources` reads
//! over projections built from the indexed neutral turns.

use std::{path::PathBuf, sync::Arc};

use agent_core::{model::AppThreadId, provider::NativeThreadResources};
use agent_resources::{ProjectionSource, ResourceError, ResourceProjection, ThreadResources};
use async_trait::async_trait;
use serde_json::Value;

use crate::store::ClaudeStore;

/// A thread the index does not know.
#[derive(Debug, thiserror::Error)]
#[error("Claude thread is not indexed: {0}")]
struct NotIndexed(String);

/// Projections of indexed Claude threads.
pub struct IndexedProjections {
    store: Arc<ClaudeStore>,
}

impl IndexedProjections {
    #[must_use]
    pub fn new(store: Arc<ClaudeStore>) -> Self {
        Self { store }
    }
}

#[async_trait]
impl ProjectionSource for IndexedProjections {
    type Projection = ResourceProjection;

    async fn refresh(&self, thread_id: &str) -> Result<ResourceProjection, ResourceError> {
        let store = self.store.clone();
        let thread_id = thread_id.to_owned();
        tokio::task::spawn_blocking(move || {
            let not_indexed = || ResourceError::Source(Box::new(NotIndexed(thread_id.clone())));
            let thread = AppThreadId::parse(&thread_id).ok_or_else(not_indexed)?;
            let sessions = store
                .thread_sessions(&thread)
                .map_err(|error| ResourceError::Source(Box::new(error)))?;
            let turns = store
                .thread_turns(&thread)
                .map_err(|error| ResourceError::Source(Box::new(error)))?
                .ok_or_else(not_indexed)?;
            let cwd = sessions
                .iter()
                .rev()
                .find_map(|stored| stored.session.cwd.clone())
                .map(PathBuf::from)
                .filter(|cwd| cwd.is_absolute());
            Ok(ResourceProjection::from_turns(cwd, &turns))
        })
        .await
        .map_err(|_| ResourceError::Join)?
    }
}

/// `history.threadResources` of Claude threads.
pub struct ClaudeResources {
    resources: ThreadResources<IndexedProjections>,
}

impl ClaudeResources {
    #[must_use]
    pub fn new(resources: ThreadResources<IndexedProjections>) -> Self {
        Self { resources }
    }
}

#[async_trait]
impl NativeThreadResources for ClaudeResources {
    fn handles(&self, method: &str) -> bool {
        ThreadResources::<IndexedProjections>::handles(method)
    }

    async fn read(&self, method: &str, params: &Value) -> Result<Value, String> {
        self.resources
            .handle(method, params)
            .await
            .map_err(|error| error.to_string())
    }

    fn prewarm(&self, thread_id: &str) {
        self.resources.schedule_prewarm(thread_id);
    }

    async fn observe_event(&self, payload: &Value) {
        self.resources.observe(payload).await;
    }

    async fn observe_rpc_result(&self, method: &str, result: &Value) {
        self.resources.observe_rpc_result(method, result).await;
    }
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;
    use crate::test_support::{MemoryThreadIndex, RecordingPreviewFiles, session_read};

    #[tokio::test]
    async fn indexed_turns_serve_thread_resources() -> Result<(), Box<dyn std::error::Error>> {
        let directory = tempfile::tempdir()?;
        let database = companion_host::database::open(directory.path().join("index.redb"), "test")?;
        let store = Arc::new(ClaudeStore::attach(
            database,
            Arc::new(MemoryThreadIndex::default()),
        )?);
        let mut read = session_read("session", "thread", 10, &["see [notes](notes.md)"]);
        read.session.cwd = Some("/work".into());
        store.replace_session(&read)?;
        let resources = ClaudeResources::new(ThreadResources::new(
            Arc::new(IndexedProjections::new(store)),
            Arc::new(RecordingPreviewFiles),
        ));
        assert!(resources.handles("companion/threadResources/read"));
        let attachments = resources
            .read(
                "companion/threadAttachments/read",
                &json!({"threadId": "thread"}),
            )
            .await?;
        assert_eq!(attachments["attachments"][0]["path"], "/work/notes.md");
        let missing = resources
            .read(
                "companion/threadResources/read",
                &json!({"threadId": "other"}),
            )
            .await
            .err();
        assert_eq!(
            missing.as_deref(),
            Some("Claude thread is not indexed: other")
        );
        Ok(())
    }
}
