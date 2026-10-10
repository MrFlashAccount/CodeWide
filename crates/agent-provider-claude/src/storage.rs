//! The Claude adapter's host storage: the session index in the companion's
//! index database, its search index, the watcher on Claude's session store
//! and the indexer that keeps them current, plus the freshness rule that
//! decides when indexed history may answer `thread.turns`.

use std::{
    collections::{HashMap, HashSet},
    path::PathBuf,
    sync::{
        Arc, Mutex, PoisonError,
        atomic::{AtomicBool, Ordering},
    },
    time::Duration,
};

use agent_core::{
    model::{
        AgentEvent, AgentThread, AppThreadId, ProviderId, RpcError, ThreadListParams,
        ThreadListResult, ThreadStatus, ThreadTurnsParams, ThreadTurnsResult, turns::page_turns,
    },
    provider::{HistoryChange, ProviderStatus},
};
use agent_resources::ThreadResources;
use companion_host::{
    files::PreviewFiles, index::StoreError, thread_index::HostThreadIndex, vcs::WorkspaceVcs,
};
use redb::Database;
use tokio::sync::{mpsc, watch};
use tracing::warn;

use crate::{
    catalog,
    indexer::{ClaudeIndexer, NativeSessions},
    resources::{ClaudeResources, IndexedProjections},
    search::{ClaudeSearch, ClaudeSearchError},
    store::ClaudeStore,
    watcher,
};

const RESCAN_INTERVAL: Duration = Duration::from_secs(30);
const FINISHED_CHANNEL_CAPACITY: usize = 256;
/// Pending history changes; the watcher coalesces echoes before they get here.
const HISTORY_CHANGE_CAPACITY: usize = 256;

/// What the companion host provides for the Claude adapter's storage.
pub struct ClaudeStorageHost {
    /// The companion's index database (`state.redb`).
    pub database: Arc<Database>,
    pub threads: Arc<dyn HostThreadIndex>,
    /// The Claude search index file.
    pub search_path: PathBuf,
    /// Claude's session store; `None` disables the watcher (the backfill and
    /// finished turns still index).
    pub projects_root: Option<PathBuf>,
    /// Preview authorization of thread resources.
    pub files: Arc<dyn PreviewFiles>,
    /// The workspace VCS overlay of thread resources.
    pub vcs: Option<Arc<dyn WorkspaceVcs>>,
}

#[derive(Debug, thiserror::Error)]
pub enum ClaudeStorageError {
    #[error(transparent)]
    Store(#[from] StoreError),
    #[error(transparent)]
    Search(#[from] ClaudeSearchError),
}

/// Threads whose indexed history may lag behind Claude's store: a live turn
/// runs, or a read of one of its sessions is pending.
#[derive(Default)]
pub struct Freshness {
    active: Mutex<HashSet<AppThreadId>>,
    stale: Mutex<HashSet<AppThreadId>>,
    /// The listed facts of every session match the host's last listing.
    catalog_current: AtomicBool,
    /// The last thread status the host reported, by thread.
    statuses: Mutex<HashMap<AppThreadId, ThreadStatus>>,
}

impl Freshness {
    pub(crate) fn set_catalog_current(&self, current: bool) {
        self.catalog_current.store(current, Ordering::Release);
    }

    /// The catalog answers only while it matches the host's listing and no
    /// thread's index lags behind a live turn or a pending re-read.
    fn catalog_is_fresh(&self) -> bool {
        self.catalog_current.load(Ordering::Acquire)
            && self
                .active
                .lock()
                .unwrap_or_else(PoisonError::into_inner)
                .is_empty()
            && self
                .stale
                .lock()
                .unwrap_or_else(PoisonError::into_inner)
                .is_empty()
    }

    fn statuses(&self) -> HashMap<AppThreadId, ThreadStatus> {
        self.statuses
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .clone()
    }

    pub(crate) fn mark_stale(&self, thread: &AppThreadId) {
        self.stale
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .insert(thread.clone());
    }

    pub(crate) fn mark_fresh(&self, thread: &AppThreadId) {
        if !self
            .active
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .contains(thread)
        {
            self.stale
                .lock()
                .unwrap_or_else(PoisonError::into_inner)
                .remove(thread);
        }
    }

    pub(crate) fn started(&self, thread: &AppThreadId) {
        self.active
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .insert(thread.clone());
        self.mark_stale(thread);
    }

    pub(crate) fn finished(&self, thread: &AppThreadId) {
        self.active
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .remove(thread);
    }

    /// Whether a live turn of `thread` runs in the host.
    pub(crate) fn is_running(&self, thread: &AppThreadId) -> bool {
        self.active
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .contains(thread)
    }

    fn is_fresh(&self, thread: &AppThreadId) -> bool {
        !self
            .active
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .contains(thread)
            && !self
                .stale
                .lock()
                .unwrap_or_else(PoisonError::into_inner)
                .contains(thread)
    }
}

/// The Claude adapter's storage services.
pub struct ClaudeStorage {
    store: Arc<ClaudeStore>,
    search: Arc<ClaudeSearch>,
    resources: Arc<ClaudeResources>,
    freshness: Arc<Freshness>,
    finished: Mutex<Option<mpsc::Sender<AppThreadId>>>,
    relist: Mutex<Option<mpsc::Sender<()>>>,
    projects_root: Option<PathBuf>,
    history_changes: mpsc::Sender<HistoryChange>,
    history_changes_rx: Mutex<Option<mpsc::Receiver<HistoryChange>>>,
}

impl ClaudeStorage {
    /// Attaches the session index and opens the search index.
    ///
    /// # Errors
    /// Returns an error when either index cannot be opened.
    pub fn open(host: ClaudeStorageHost) -> Result<Self, ClaudeStorageError> {
        let store = Arc::new(ClaudeStore::attach(host.database, host.threads)?);
        let search = Arc::new(ClaudeSearch::open(&host.search_path, store.clone())?);
        let mut resources =
            ThreadResources::new(Arc::new(IndexedProjections::new(store.clone())), host.files);
        if let Some(vcs) = host.vcs {
            resources = resources.with_vcs(vcs);
        }
        let (history_changes, history_changes_rx) = mpsc::channel(HISTORY_CHANGE_CAPACITY);
        Ok(Self {
            store,
            search,
            resources: Arc::new(ClaudeResources::new(resources)),
            freshness: Arc::new(Freshness::default()),
            finished: Mutex::new(None),
            relist: Mutex::new(None),
            projects_root: host.projects_root,
            history_changes,
            history_changes_rx: Mutex::new(Some(history_changes_rx)),
        })
    }

    /// Starts the watcher and the indexer over the host's session reads.
    /// Must be called inside a Tokio runtime, once.
    pub fn start(
        &self,
        sessions: Arc<dyn NativeSessions>,
        status: watch::Receiver<ProviderStatus>,
    ) {
        let (finished, finished_rx) = mpsc::channel(FINISHED_CHANNEL_CAPACITY);
        *self.finished.lock().unwrap_or_else(PoisonError::into_inner) = Some(finished);
        let (relist, relist_rx) = mpsc::channel(1);
        *self.relist.lock().unwrap_or_else(PoisonError::into_inner) = Some(relist);
        let changes = match &self.projects_root {
            Some(root) => watcher::spawn(root.clone(), RESCAN_INTERVAL),
            None => mpsc::channel(1).1,
        };
        let indexer = ClaudeIndexer::new(
            self.store.clone(),
            self.search.clone(),
            sessions,
            self.freshness.clone(),
        )
        .with_history_changes(self.history_changes.clone());
        tokio::spawn(indexer.run(changes, finished_rx, relist_rx, status));
    }

    /// Threads rewritten from Claude's store outside a live turn (a session
    /// driven in a terminal); taken once by the companion.
    pub fn take_history_changes(&self) -> Option<mpsc::Receiver<HistoryChange>> {
        self.history_changes_rx
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .take()
    }

    /// Observes one live event: a running turn makes its thread's index
    /// stale; a finished turn schedules a re-read.
    pub fn observe_event(&self, event: &AgentEvent) {
        match event {
            AgentEvent::TurnStarted { app_thread_id, .. } => self.freshness.started(app_thread_id),
            AgentEvent::TurnCompleted { app_thread_id, .. } => {
                self.freshness.finished(app_thread_id);
                let sender = self
                    .finished
                    .lock()
                    .unwrap_or_else(PoisonError::into_inner)
                    .clone();
                if let Some(sender) = sender
                    && sender.try_send(app_thread_id.clone()).is_err()
                {
                    warn!(thread_id = %app_thread_id, "Claude re-index queue is full");
                }
            }
            AgentEvent::ThreadUpdated { thread } => {
                self.freshness
                    .statuses
                    .lock()
                    .unwrap_or_else(PoisonError::into_inner)
                    .insert(thread.app_thread_id.clone(), thread.status);
                if !self.lists_as(thread) {
                    self.request_relist();
                }
            }
            _ => {}
        }
    }

    /// Whether the index lists `thread` exactly as the host reported it.
    fn lists_as(&self, thread: &AgentThread) -> bool {
        let Ok(sessions) = self.store.thread_sessions(&thread.app_thread_id) else {
            return false;
        };
        let indexed = catalog::threads(&sessions);
        indexed
            .first()
            .and_then(|indexed| catalog::row(indexed, &thread.provider, thread.status))
            .is_some_and(|row| &row.thread == thread)
    }

    /// Marks the catalog behind the host until the next listing pass.
    fn request_relist(&self) {
        self.freshness.set_catalog_current(false);
        let sender = self
            .relist
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .clone();
        if let Some(sender) = sender {
            // A full queue already holds a pending pass.
            let _ = sender.try_send(());
        }
    }

    /// `thread.list` from the index while the catalog is fresh; `None` sends
    /// the call to the host.
    #[must_use]
    pub fn list(
        &self,
        params: &ThreadListParams,
        provider: &ProviderId,
    ) -> Option<Result<ThreadListResult, RpcError>> {
        if !self.freshness.catalog_is_fresh() {
            return None;
        }
        let sessions = match self.store.sessions() {
            Ok(sessions) => sessions,
            Err(err) => {
                warn!(err = %err, "Claude session index cannot be read; asking the host");
                return None;
            }
        };
        let rows = catalog::rows(&sessions, &self.freshness.statuses(), provider);
        Some(catalog::list(rows, params))
    }

    /// `thread.turns` from the index, when the thread is indexed and fresh;
    /// `None` sends the call to the host.
    #[must_use]
    pub fn turns(&self, params: &ThreadTurnsParams) -> Option<Result<ThreadTurnsResult, RpcError>> {
        if !self.freshness.is_fresh(&params.app_thread_id) {
            return None;
        }
        if !self.owns(&params.app_thread_id) {
            return None;
        }
        let turns = match self.store.thread_turns(&params.app_thread_id) {
            Ok(turns) => turns?,
            Err(err) => {
                warn!(err = %err, "Claude session index cannot be read; asking the host");
                return None;
            }
        };
        Some(page_turns(
            &turns,
            params.cursor.as_deref(),
            params.limit,
            params.sort_direction,
            params.items_view,
        ))
    }

    /// Whether the index knows the thread.
    #[must_use]
    pub fn owns(&self, thread: &AppThreadId) -> bool {
        self.store.thread_sessions(thread).is_ok_and(|sessions| {
            let sessions = sessions.iter().collect::<Vec<_>>();
            !sessions.is_empty() && !catalog::is_deleted(&sessions)
        })
    }

    #[must_use]
    pub fn search(&self) -> Arc<ClaudeSearch> {
        self.search.clone()
    }

    #[must_use]
    pub fn resources(&self) -> Arc<ClaudeResources> {
        self.resources.clone()
    }

    #[must_use]
    pub fn store(&self) -> Arc<ClaudeStore> {
        self.store.clone()
    }
}

#[cfg(test)]
mod tests {
    use agent_core::model::{ItemsView, SortDirection};

    use super::*;
    use crate::test_support::{MemoryThreadIndex, session_read, turn};

    fn storage(directory: &std::path::Path) -> Result<ClaudeStorage, Box<dyn std::error::Error>> {
        Ok(ClaudeStorage::open(ClaudeStorageHost {
            database: companion_host::database::open(directory.join("index.redb"), "test")?,
            threads: Arc::new(MemoryThreadIndex::default()),
            search_path: directory.join("search.sqlite"),
            projects_root: None,
            files: Arc::new(crate::test_support::RecordingPreviewFiles),
            vcs: None,
        })?)
    }

    fn params(thread: &str) -> ThreadTurnsParams {
        ThreadTurnsParams {
            app_thread_id: AppThreadId::parse(thread)
                .unwrap_or_else(|| AppThreadId::from_static("fixture")),
            cursor: None,
            limit: 10,
            sort_direction: SortDirection::Asc,
            items_view: ItemsView::Summary,
        }
    }

    #[test]
    fn indexed_history_answers_only_while_no_turn_runs() -> Result<(), Box<dyn std::error::Error>> {
        let directory = tempfile::tempdir()?;
        let storage = storage(directory.path())?;
        assert!(storage.turns(&params("thread")).is_none());
        storage
            .store
            .replace_session(&session_read("session", "thread", 10, &["one", "two"]))?;
        let page = storage
            .turns(&params("thread"))
            .ok_or("served")?
            .map_err(|error| error.message)?;
        assert_eq!(page.turns.len(), 2);
        assert!(storage.owns(&AppThreadId::from_static("thread")));

        let thread = AppThreadId::from_static("thread");
        storage.observe_event(&AgentEvent::TurnStarted {
            app_thread_id: thread.clone(),
            turn: turn("session", "three", 30),
        });
        assert!(storage.turns(&params("thread")).is_none());
        storage.observe_event(&AgentEvent::TurnCompleted {
            app_thread_id: thread.clone(),
            turn: turn("session", "three", 30),
        });
        // Still stale until the finished turn is re-indexed.
        assert!(storage.turns(&params("thread")).is_none());
        storage.freshness.mark_fresh(&thread);
        assert!(storage.turns(&params("thread")).is_some());
        Ok(())
    }

    #[test]
    fn the_catalog_answers_only_while_it_matches_the_host() -> Result<(), Box<dyn std::error::Error>>
    {
        use agent_core::model::{SortDirection, ThreadSortKey};
        let directory = tempfile::tempdir()?;
        let storage = storage(directory.path())?;
        storage
            .store
            .replace_session(&session_read("terminal", "terminal", 10, &["hello"]))?;
        let provider = ProviderId::from_static("claude");
        let params = ThreadListParams {
            archived: false,
            cwd: None,
            search_term: None,
            sort_key: ThreadSortKey::UpdatedAt,
            sort_direction: SortDirection::Desc,
            window: None,
            cursor: None,
            limit: 10,
        };
        assert!(
            storage.list(&params, &provider).is_none(),
            "before the first listing"
        );
        storage.freshness.set_catalog_current(true);
        let page = storage
            .list(&params, &provider)
            .ok_or("served")?
            .map_err(|error| error.message)?;
        assert_eq!(page.threads.len(), 1);

        // The host reports the thread as the index lists it: still fresh.
        let mut reported = page.threads[0].clone();
        reported.status = ThreadStatus::Idle;
        storage.observe_event(&AgentEvent::ThreadUpdated {
            thread: reported.clone(),
        });
        let page = storage
            .list(&params, &provider)
            .ok_or("served")?
            .map_err(|error| error.message)?;
        assert_eq!(page.threads[0].status, ThreadStatus::Idle);

        // A rename the index has not seen falls back to the host.
        reported.name = Some("Renamed".into());
        storage.observe_event(&AgentEvent::ThreadUpdated { thread: reported });
        assert!(storage.list(&params, &provider).is_none());

        // A running turn also falls back.
        storage.freshness.set_catalog_current(true);
        storage.observe_event(&AgentEvent::TurnStarted {
            app_thread_id: AppThreadId::from_static("terminal"),
            turn: turn("terminal", "next", 20),
        });
        assert!(storage.list(&params, &provider).is_none());
        Ok(())
    }

    /// The Claude host's listing of this machine's store: every session,
    /// interactive or not, as `nativeSession.list` returns it.
    struct ListedSessions(Vec<agent_core::model::NativeSessionReadResult>);

    #[async_trait::async_trait]
    impl NativeSessions for ListedSessions {
        async fn list(
            &self,
            _params: agent_core::model::NativeSessionListParams,
        ) -> Result<agent_core::model::NativeSessionListResult, agent_core::provider::ProviderError>
        {
            Ok(agent_core::model::NativeSessionListResult {
                next_cursor: None,
                sessions: self.0.iter().map(|read| read.session.clone()).collect(),
            })
        }

        async fn read(
            &self,
            session_id: &str,
        ) -> Result<agent_core::model::NativeSessionReadResult, agent_core::provider::ProviderError>
        {
            self.0
                .iter()
                .find(|read| read.session.session_id == session_id)
                .cloned()
                .ok_or_else(|| {
                    agent_core::provider::ProviderError::Rejected(RpcError {
                        code: agent_core::model::ERROR_INVALID_REQUEST,
                        message: format!("native session not found: {session_id}"),
                        data: None,
                    })
                })
        }
    }

    #[tokio::test]
    async fn started_storage_lists_a_terminal_session_from_the_host_listing()
    -> Result<(), Box<dyn std::error::Error>> {
        use agent_core::model::{SortDirection, ThreadOrigin, ThreadSortKey};
        let directory = tempfile::tempdir()?;
        let storage = storage(directory.path())?;
        let terminal = session_read("terminal", "terminal", 20, &["hello"]);
        let mut programmatic = session_read("sdk", "sdk", 30, &["probe"]);
        programmatic.session.interactive = false;
        let (_status, status) = watch::channel(ProviderStatus::Live);
        storage.start(
            Arc::new(ListedSessions(vec![terminal, programmatic])),
            status,
        );
        let params = ThreadListParams {
            archived: false,
            cwd: None,
            search_term: None,
            sort_key: ThreadSortKey::RecencyAt,
            sort_direction: SortDirection::Desc,
            window: None,
            cursor: None,
            limit: 10,
        };
        let provider = ProviderId::from_static("claude");
        let page = tokio::time::timeout(Duration::from_secs(10), async {
            loop {
                if let Some(page) = storage.list(&params, &provider) {
                    return page;
                }
                tokio::time::sleep(Duration::from_millis(10)).await;
            }
        })
        .await?
        .map_err(|error| error.message)?;
        let listed = page
            .threads
            .iter()
            .map(|thread| thread.app_thread_id.as_str())
            .collect::<Vec<_>>();
        assert_eq!(listed, ["terminal"], "programmatic sessions stay hidden");
        let thread = &page.threads[0];
        assert_eq!(thread.origin, ThreadOrigin::External);
        assert_eq!((thread.recency_at, thread.updated_at), (None, 20));
        assert!(storage.owns(&AppThreadId::from_static("terminal")));
        Ok(())
    }
}
