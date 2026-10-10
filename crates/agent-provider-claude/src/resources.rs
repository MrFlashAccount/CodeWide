//! Thread resources of Claude threads: the shared `agent-resources` reads
//! over projections built from the indexed neutral turns.
//!
//! The VCS overlay needs only the thread's working directory. A thread whose
//! sessions are not indexed yet (a new thread before its first index read,
//! or an index the host cannot fill) still gets it from the working
//! directory its live `thread/settings/updated` reported, so its Changes
//! offer the repository's scopes like any other thread.

use std::{
    collections::HashMap,
    path::{Path, PathBuf},
    sync::{Arc, Mutex, PoisonError},
};

use agent_core::{model::AppThreadId, provider::NativeThreadResources};
use agent_resources::{ProjectionSource, ResourceError, ResourceProjection, ThreadResources};
use async_trait::async_trait;
use serde_json::Value;

use crate::store::ClaudeStore;

/// A thread the index does not know and whose working directory was never
/// reported live.
#[derive(Debug, thiserror::Error)]
#[error("Claude thread is not indexed: {0}")]
struct NotIndexed(String);

/// Working directories of threads as their live client-wire settings report
/// them, by thread id. One entry per thread seen since start; a deleted
/// thread's entry is dropped.
#[derive(Default)]
struct LiveThreadCwds {
    cwds: Mutex<HashMap<String, PathBuf>>,
}

impl LiveThreadCwds {
    /// Records the `cwd` of a `thread/settings/updated` payload and forgets
    /// the thread on `thread/deleted`; any other payload is ignored.
    fn observe(&self, payload: &Value) {
        let Some(params) = payload.get("params") else {
            return;
        };
        let Some(thread_id) = params.get("threadId").and_then(Value::as_str) else {
            return;
        };
        match payload.get("method").and_then(Value::as_str) {
            Some("thread/settings/updated") => {
                let Some(cwd) = params
                    .pointer("/threadSettings/cwd")
                    .and_then(Value::as_str)
                    .map(Path::new)
                    .filter(|cwd| cwd.is_absolute())
                else {
                    return;
                };
                self.cwds
                    .lock()
                    .unwrap_or_else(PoisonError::into_inner)
                    .insert(thread_id.to_owned(), cwd.to_path_buf());
            }
            Some("thread/deleted") => {
                self.cwds
                    .lock()
                    .unwrap_or_else(PoisonError::into_inner)
                    .remove(thread_id);
            }
            _ => {}
        }
    }

    fn get(&self, thread_id: &str) -> Option<PathBuf> {
        self.cwds
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .get(thread_id)
            .cloned()
    }
}

/// Projections of indexed Claude threads.
pub struct IndexedProjections {
    store: Arc<ClaudeStore>,
    live_cwds: LiveThreadCwds,
}

impl IndexedProjections {
    #[must_use]
    pub fn new(store: Arc<ClaudeStore>) -> Self {
        Self {
            store,
            live_cwds: LiveThreadCwds::default(),
        }
    }
}

#[async_trait]
impl ProjectionSource for IndexedProjections {
    type Projection = ResourceProjection;

    async fn refresh(&self, thread_id: &str) -> Result<ResourceProjection, ResourceError> {
        let store = self.store.clone();
        let live_cwd = self.live_cwds.get(thread_id);
        let thread_id = thread_id.to_owned();
        tokio::task::spawn_blocking(move || {
            let not_indexed = || ResourceError::Source(Box::new(NotIndexed(thread_id.clone())));
            let thread = AppThreadId::parse(&thread_id).ok_or_else(not_indexed)?;
            let sessions = store
                .thread_sessions(&thread)
                .map_err(|error| ResourceError::Source(Box::new(error)))?;
            let Some(turns) = store
                .thread_turns(&thread)
                .map_err(|error| ResourceError::Source(Box::new(error)))?
            else {
                // Not indexed yet: no recorded turns, but the live overlay
                // and the workspace VCS still apply to its directory.
                return live_cwd
                    .map(|cwd| ResourceProjection::from_turns(Some(cwd), &[]))
                    .ok_or_else(not_indexed);
            };
            let cwd = sessions
                .iter()
                .rev()
                .find_map(|stored| stored.session.cwd.clone())
                .map(PathBuf::from)
                .filter(|cwd| cwd.is_absolute())
                .or(live_cwd);
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
        self.resources.source().live_cwds.observe(payload);
        self.resources.observe(payload).await;
    }

    async fn observe_rpc_result(&self, method: &str, result: &Value) {
        self.resources.observe_rpc_result(method, result).await;
    }
}

#[cfg(test)]
mod tests {
    use companion_host::vcs::{
        CHANGES_CAPABILITY, DIFF_CAPABILITY, VcsDiff, VcsDiffPage, VcsError, VcsFile,
        VcsFileStatus, VcsRepository, VcsScope, VcsSnapshot, VcsState, VcsSummary, WorkspaceVcs,
    };
    use serde_json::json;

    use super::*;
    use crate::test_support::{MemoryThreadIndex, RecordingPreviewFiles, session_read};

    const REPOSITORY: &str = "/repo";
    const CHANGED: &str = "/repo/src/lib.rs";

    /// A VCS provider that owns only [`REPOSITORY`], with one modified file.
    struct RepositoryVcs;

    fn repository() -> VcsRepository {
        VcsRepository {
            provider: "git".into(),
            root: PathBuf::from(REPOSITORY),
            branch: Some("feature".into()),
            head: Some("head".into()),
            base: Some("base".into()),
        }
    }

    #[async_trait]
    impl WorkspaceVcs for RepositoryVcs {
        async fn changes(
            &self,
            workspace: &Path,
            scope: VcsScope,
        ) -> Result<VcsSnapshot, VcsError> {
            if workspace != Path::new(REPOSITORY) {
                return Err(VcsError::UnsupportedWorkspace(workspace.to_path_buf()));
            }
            Ok(VcsSnapshot {
                capability: CHANGES_CAPABILITY.into(),
                repository: repository(),
                scope,
                available_scopes: vec![
                    VcsScope::Staged,
                    VcsScope::Unstaged,
                    VcsScope::Uncommitted,
                    VcsScope::Branch,
                ],
                snapshot_id: "snapshot".into(),
                state: VcsState::Dirty,
                summary: VcsSummary {
                    total: 1,
                    modified: 1,
                    ..VcsSummary::default()
                },
                files: vec![VcsFile {
                    id: "file".into(),
                    path: PathBuf::from(CHANGED),
                    old_path: None,
                    status: VcsFileStatus::Modified,
                    staged: false,
                    additions: Some(1),
                    deletions: Some(1),
                    binary: false,
                    conflict: None,
                }],
            })
        }

        async fn diff(
            &self,
            workspace: &Path,
            path: &Path,
            scope: VcsScope,
        ) -> Result<VcsDiff, VcsError> {
            if workspace != Path::new(REPOSITORY) {
                return Err(VcsError::UnsupportedWorkspace(workspace.to_path_buf()));
            }
            Ok(VcsDiff {
                capability: DIFF_CAPABILITY.into(),
                repository: repository(),
                scope,
                snapshot_id: "snapshot".into(),
                file_id: "file".into(),
                path: path.to_path_buf(),
                old_path: None,
                status: VcsFileStatus::Modified,
                diff: "@@ -1 +1 @@\n-old\n+new\n".into(),
                source: None,
                truncated: false,
                binary: false,
                additions: 1,
                deletions: 1,
            })
        }

        async fn diff_page(
            &self,
            workspace: &Path,
            _path: &Path,
            scope: VcsScope,
            _offset: usize,
            _limit: usize,
        ) -> Result<VcsDiffPage, VcsError> {
            Err(VcsError::UnsupportedScope {
                workspace: workspace.to_path_buf(),
                scope,
            })
        }
    }

    fn resources_over(store: Arc<ClaudeStore>) -> ClaudeResources {
        ClaudeResources::new(
            ThreadResources::new(
                Arc::new(IndexedProjections::new(store)),
                Arc::new(RecordingPreviewFiles),
            )
            .with_vcs(Arc::new(RepositoryVcs)),
        )
    }

    fn open_store(directory: &Path) -> Result<Arc<ClaudeStore>, Box<dyn std::error::Error>> {
        let database = companion_host::database::open(directory.join("index.redb"), "test")?;
        Ok(Arc::new(ClaudeStore::attach(
            database,
            Arc::new(MemoryThreadIndex::default()),
        )?))
    }

    /// The repository's changes and the scopes the client offers for them.
    async fn assert_repository_changes(
        resources: &ClaudeResources,
        thread: &str,
    ) -> Result<(), Box<dyn std::error::Error>> {
        let changes = resources
            .read("companion/threadChanges/read", &json!({"threadId": thread}))
            .await?;
        assert_eq!(changes["changeScope"], "branch");
        assert_eq!(
            changes["changeScopes"],
            json!(["session", "uncommitted", "branch"])
        );
        assert_eq!(changes["vcs"]["provider"], "git");
        assert_eq!(changes["vcs"]["branch"], "feature");
        assert_eq!(changes["changes"][0]["path"], CHANGED);
        let diff = resources
            .read(
                "companion/threadChange/read",
                &json!({"threadId": thread, "path": CHANGED, "changeScope": "uncommitted"}),
            )
            .await?;
        assert_eq!(diff["changeScope"], "uncommitted");
        assert_eq!(diff["patches"][0]["diff"], "@@ -1 +1 @@\n-old\n+new\n");
        Ok(())
    }

    #[tokio::test]
    async fn indexed_thread_in_a_repository_offers_its_vcs_changes()
    -> Result<(), Box<dyn std::error::Error>> {
        let directory = tempfile::tempdir()?;
        let store = open_store(directory.path())?;
        let mut read = session_read("session", "thread", 10, &["change the code"]);
        read.session.cwd = Some(REPOSITORY.into());
        store.replace_session(&read)?;
        let resources = resources_over(store);

        assert_repository_changes(&resources, "thread").await
    }

    #[tokio::test]
    async fn unindexed_thread_offers_vcs_changes_of_its_live_working_directory()
    -> Result<(), Box<dyn std::error::Error>> {
        let directory = tempfile::tempdir()?;
        let resources = resources_over(open_store(directory.path())?);
        let not_indexed = Some("Claude thread is not indexed: new-thread");
        let params = json!({"threadId": "new-thread"});
        let read_changes = || resources.read("companion/threadChanges/read", &params);
        assert_eq!(read_changes().await.err().as_deref(), not_indexed);

        // A relative directory is not a workspace.
        resources
            .observe_event(&json!({
                "method": "thread/settings/updated",
                "params": {"threadId": "new-thread", "threadSettings": {"cwd": "repo"}}
            }))
            .await;
        assert_eq!(read_changes().await.err().as_deref(), not_indexed);

        resources
            .observe_event(&json!({
                "method": "thread/settings/updated",
                "params": {"threadId": "new-thread", "threadSettings": {"cwd": REPOSITORY}}
            }))
            .await;
        assert_repository_changes(&resources, "new-thread").await?;

        resources
            .observe_event(&json!({
                "method": "thread/deleted",
                "params": {"threadId": "new-thread"}
            }))
            .await;
        assert_eq!(read_changes().await.err().as_deref(), not_indexed);
        Ok(())
    }

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
