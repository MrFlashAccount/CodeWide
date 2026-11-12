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
        ThreadListResult, ThreadStatus, ThreadTurnsParams, ThreadTurnsResult,
    },
    provider::{HistoryChange, ProviderStatus, SubagentsChange},
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
    index::sessions::SessionIndex,
    index::{
        history::{IndexedHistory, PageRequest},
        read::ReadError,
    },
    indexer::ClaudeIndexer,
    native::{LocalSessions, host_state::HostStateCache},
    resources::{ClaudeResources, IndexedProjections},
    runtime::open_elsewhere::OpenElsewhere,
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
    /// The thread state directory (`<state dir>/claude-journal`): its thread
    /// metadata, read with Claude's session files.
    pub journal_directory: PathBuf,
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
    /// The listed facts of every session match the last listing of Claude's files.
    catalog_current: AtomicBool,
    /// The last thread status the thread service reported, by thread.
    statuses: Mutex<HashMap<AppThreadId, ThreadStatus>>,
}

impl Freshness {
    pub(crate) fn set_catalog_current(&self, current: bool) {
        self.catalog_current.store(current, Ordering::Release);
    }

    /// The catalog answers only while it matches the latest listing and no
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

    /// Whether a live turn of `thread` runs.
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
    /// The owner of session passes, once [`Self::start`] ran.
    index: std::sync::OnceLock<Arc<SessionIndex>>,
    history: Arc<IndexedHistory>,
    search: Arc<ClaudeSearch>,
    resources: Arc<ClaudeResources>,
    freshness: Arc<Freshness>,
    finished: Mutex<Option<mpsc::Sender<AppThreadId>>>,
    relist: Mutex<Option<mpsc::Sender<()>>>,
    projects_root: Option<PathBuf>,
    journal_directory: PathBuf,
    history_changes: mpsc::Sender<HistoryChange>,
    history_changes_rx: Mutex<Option<mpsc::Receiver<HistoryChange>>>,
    subagent_changes: mpsc::Sender<SubagentsChange>,
    subagent_changes_rx: Mutex<Option<mpsc::Receiver<SubagentsChange>>>,
}

impl ClaudeStorage {
    /// Attaches the session index and opens the search index.
    ///
    /// # Errors
    /// Returns an error when either index cannot be opened.
    pub fn open(host: ClaudeStorageHost) -> Result<Self, ClaudeStorageError> {
        let store = Arc::new(ClaudeStore::attach(host.database, host.threads)?);
        let history = Arc::new(IndexedHistory::new(
            store.clone(),
            Arc::new(HostStateCache::new(host.journal_directory.clone())),
        ));
        let search = Arc::new(ClaudeSearch::open(
            &host.search_path,
            store.clone(),
            history.clone(),
        )?);
        let mut resources = ThreadResources::new(
            Arc::new(IndexedProjections::new(history.clone())),
            host.files,
        );
        if let Some(vcs) = host.vcs {
            resources = resources.with_vcs(vcs);
        }
        let (history_changes, history_changes_rx) = mpsc::channel(HISTORY_CHANGE_CAPACITY);
        let (subagent_changes, subagent_changes_rx) = mpsc::channel(HISTORY_CHANGE_CAPACITY);
        Ok(Self {
            store,
            index: std::sync::OnceLock::new(),
            history,
            search,
            resources: Arc::new(ClaudeResources::new(resources)),
            freshness: Arc::new(Freshness::default()),
            finished: Mutex::new(None),
            relist: Mutex::new(None),
            projects_root: host.projects_root,
            journal_directory: host.journal_directory,
            history_changes,
            history_changes_rx: Mutex::new(Some(history_changes_rx)),
            subagent_changes,
            subagent_changes_rx: Mutex::new(Some(subagent_changes_rx)),
        })
    }

    /// Starts the watcher and the indexer over Claude's files
    /// ([`crate::native::LocalSessions`]). Without a known session store
    /// nothing is indexed. Must be called inside a Tokio runtime, once.
    pub fn start(&self, status: watch::Receiver<ProviderStatus>, activity: Arc<OpenElsewhere>) {
        let Some(root) = &self.projects_root else {
            warn!("Claude's session store is unknown; Claude sessions are not indexed");
            return;
        };
        let sessions = LocalSessions::new(root.clone(), self.journal_directory.clone(), activity);
        self.start_with(sessions, status);
    }

    /// Starts the watcher (when the session store is known) and the indexer
    /// over `sessions`.
    pub(crate) fn start_with(
        &self,
        sessions: LocalSessions,
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
        let index = Arc::new(SessionIndex::new(
            self.store.clone(),
            self.history.clone(),
            Some(self.search.clone()),
            sessions,
            self.freshness.clone(),
        ));
        index.publish_to(self.history_changes.clone(), self.subagent_changes.clone());
        let _ = self.index.set(index.clone());
        let indexer = ClaudeIndexer::new(index, self.freshness.clone());
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

    /// Threads whose indexed sub-agents changed, live turn or not; taken
    /// once by the companion.
    pub fn take_subagent_changes(&self) -> Option<mpsc::Receiver<SubagentsChange>> {
        self.subagent_changes_rx
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
                // OpenElsewhere publishes not only lease acquisition/release,
                // but also a replacement process generation for the same
                // session. Its visible thread status then stays unchanged,
                // while unfinished sub-agents must be reconstructed against
                // the new process start.
                if thread.status == ThreadStatus::OpenElsewhere || !self.lists_as(thread) {
                    self.request_relist();
                }
            }
            _ => {}
        }
    }

    /// Re-indexes sessions whose Claude execution lease appeared,
    /// disappeared or changed generation. This signal is independent of the
    /// visible thread status: the companion's own process can restart while
    /// its session id and status stay unchanged.
    pub fn observe_session_activity(&self, session_ids: &HashSet<String>) {
        let sender = self
            .finished
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .clone();
        let mut threads = HashSet::new();
        let mut relist = false;
        for session_id in session_ids {
            match self.store.session(session_id) {
                Ok(Some(stored)) => {
                    threads.insert(stored.session.app_thread_id);
                }
                Ok(None) => relist = true,
                Err(err) => {
                    warn!(err = %err, session_id, "Claude session activity could not be resolved");
                    relist = true;
                }
            }
        }
        if relist {
            self.request_relist();
        }
        for thread in threads {
            self.freshness.mark_stale(&thread);
            if sender
                .as_ref()
                .is_none_or(|sender| sender.try_send(thread).is_err())
            {
                self.request_relist();
            }
        }
    }

    /// Whether the index lists `thread` exactly as the host reported it. The
    /// preview is the index's own (the host only knows the first prompt), so
    /// it never asks for a listing pass.
    fn lists_as(&self, thread: &AgentThread) -> bool {
        let Ok(sessions) = self.store.thread_sessions(&thread.app_thread_id) else {
            return false;
        };
        let indexed = catalog::threads(&sessions);
        indexed
            .first()
            .and_then(|indexed| catalog::row(indexed, &thread.provider, thread.status))
            .is_some_and(|mut row| {
                row.thread.preview.clone_from(&thread.preview);
                &row.thread == thread
            })
    }

    /// Replaces the preview of host-projected threads with the indexed one,
    /// so every `AgentThread.preview` is the thread's newest conversation
    /// message whichever side answered. A thread the index does not know yet
    /// keeps the host's (its first prompt, then the only message).
    pub fn overlay_previews<'a>(&self, threads: impl IntoIterator<Item = &'a mut AgentThread>) {
        for thread in threads {
            let sessions = match self.store.thread_sessions(&thread.app_thread_id) {
                Ok(sessions) => sessions,
                Err(err) => {
                    warn!(err = %err, "Claude session index cannot be read; keeping the host preview");
                    return;
                }
            };
            if let Some(preview) = catalog::threads(&sessions)
                .first()
                .and_then(catalog::thread_preview)
            {
                thread.preview = preview;
            }
        }
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
    /// `None` sends the call to the thread service. A page reads only its
    /// own turns' byte ranges, off the async runtime.
    pub async fn turns(
        &self,
        params: &ThreadTurnsParams,
    ) -> Option<Result<ThreadTurnsResult, RpcError>> {
        if !self.freshness.is_fresh(&params.app_thread_id) {
            return None;
        }
        if !self.owns(&params.app_thread_id) {
            return None;
        }
        let history = self.history.clone();
        let params = params.clone();
        let page = tokio::task::spawn_blocking(move || {
            history.page(
                &params.app_thread_id,
                &PageRequest {
                    cursor: params.cursor.as_deref(),
                    limit: params.limit,
                    direction: params.sort_direction,
                    view: params.items_view,
                },
            )
        })
        .await;
        match page {
            Ok(Ok(Some(page))) => Some(Ok(page)),
            Ok(Ok(None)) => None,
            Ok(Err(ReadError::InvalidParams(message))) => Some(Err(RpcError::new(
                agent_core::model::ERROR_INVALID_PARAMS,
                message,
            ))),
            Ok(Err(err)) => {
                warn!(err = %err, "Claude session index cannot be read; asking the thread service");
                None
            }
            Err(err) => {
                warn!(err = %err, "Claude session index read failed; asking the thread service");
                None
            }
        }
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

    /// The owner of session passes; `None` before [`Self::start`].
    #[must_use]
    pub fn session_index(&self) -> Option<Arc<SessionIndex>> {
        self.index.get().cloned()
    }

    /// Reads of indexed history (pages, child threads, windows).
    #[must_use]
    pub fn history(&self) -> Arc<IndexedHistory> {
        self.history.clone()
    }
}

#[cfg(test)]
mod tests {
    use agent_core::model::{ItemsView, SortDirection, ThreadSortKey};

    use super::*;
    use crate::test_support::{MemoryThreadIndex, session_id, turn};

    const CWD: &str = "/work";

    struct Fixture {
        files: crate::test_support::StoreFixture,
        storage: ClaudeStorage,
    }

    impl Fixture {
        fn new() -> Result<Self, Box<dyn std::error::Error>> {
            let files = crate::test_support::StoreFixture::new()?;
            let storage = ClaudeStorage::open(ClaudeStorageHost {
                database: companion_host::database::open(
                    files.directory.path().join("storage.redb"),
                    "test",
                )?,
                threads: Arc::new(MemoryThreadIndex::default()),
                search_path: files.directory.path().join("storage-search.sqlite"),
                projects_root: None,
                journal_directory: files.journal(),
                files: Arc::new(crate::test_support::RecordingPreviewFiles),
                vcs: None,
            })?;
            Ok(Self { files, storage })
        }

        /// Writes one exchange per prompt and indexes the session into the storage.
        fn session(
            &self,
            session: &str,
            prompts: &[&str],
        ) -> Result<(), Box<dyn std::error::Error>> {
            self.files.exchange(session, CWD, 1, prompts)?;
            let threads = self.storage.history.host().threads();
            let (file, listed) = self
                .files
                .sessions()
                .listed_session(session, &threads)
                .ok_or("listed session")?;
            let changes = crate::index::session::index_session(
                &self.storage.store,
                &crate::index::session::ListedSession {
                    file: &file,
                    session: listed,
                    owner: threads.owner_of(session),
                },
                crate::runtime::open_elsewhere::SessionActivity::Stopped,
            )?;
            self.storage.search.apply(&changes)?;
            Ok(())
        }
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

    #[tokio::test]
    async fn indexed_history_answers_only_while_no_turn_runs()
    -> Result<(), Box<dyn std::error::Error>> {
        let fixture = Fixture::new()?;
        let session = session_id(1);
        assert!(fixture.storage.turns(&params(&session)).await.is_none());
        fixture.session(&session, &["one", "two"])?;
        let page = fixture
            .storage
            .turns(&params(&session))
            .await
            .ok_or("served")?
            .map_err(|error| error.message)?;
        assert_eq!(page.turns.len(), 2);
        let thread = AppThreadId::parse(&session).ok_or("thread id")?;
        assert!(fixture.storage.owns(&thread));

        fixture.storage.observe_event(&AgentEvent::TurnStarted {
            app_thread_id: thread.clone(),
            turn: turn("session", "three", 30),
        });
        assert!(fixture.storage.turns(&params(&session)).await.is_none());
        fixture.storage.observe_event(&AgentEvent::TurnCompleted {
            app_thread_id: thread.clone(),
            turn: turn("session", "three", 30),
        });
        // Still stale until the finished turn is indexed.
        assert!(fixture.storage.turns(&params(&session)).await.is_none());
        fixture.storage.freshness.mark_fresh(&thread);
        assert!(fixture.storage.turns(&params(&session)).await.is_some());

        // An activity change of the session makes it stale again.
        fixture
            .storage
            .observe_session_activity(&HashSet::from([session.clone()]));
        assert!(fixture.storage.turns(&params(&session)).await.is_none());
        Ok(())
    }

    #[tokio::test]
    async fn the_catalog_answers_only_while_it_matches_the_listing()
    -> Result<(), Box<dyn std::error::Error>> {
        let fixture = Fixture::new()?;
        let session = session_id(2);
        fixture.session(&session, &["hello"])?;
        let provider = ProviderId::from_static("claude");
        let list = ThreadListParams {
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
            fixture.storage.list(&list, &provider).is_none(),
            "before the first listing"
        );
        fixture.storage.freshness.set_catalog_current(true);
        let page = fixture
            .storage
            .list(&list, &provider)
            .ok_or("served")?
            .map_err(|error| error.message)?;
        assert_eq!(page.threads.len(), 1);
        // The preview is the newest message, not the first prompt.
        assert_eq!(page.threads[0].preview, "answer to hello");

        let mut reported = page.threads[0].clone();
        reported.status = ThreadStatus::Idle;
        reported.preview = "hello".into();
        fixture.storage.observe_event(&AgentEvent::ThreadUpdated {
            thread: reported.clone(),
        });
        assert!(fixture.storage.list(&list, &provider).is_some());

        reported.name = Some("Renamed".into());
        fixture
            .storage
            .observe_event(&AgentEvent::ThreadUpdated { thread: reported });
        assert!(fixture.storage.list(&list, &provider).is_none());
        Ok(())
    }

    #[tokio::test]
    async fn started_storage_indexes_the_store_and_hides_programmatic_sessions()
    -> Result<(), Box<dyn std::error::Error>> {
        let fixture = Fixture::new()?;
        let terminal = session_id(3);
        fixture.files.exchange(&terminal, CWD, 1, &["hello"])?;
        fixture.files.append(
            &session_id(4),
            "/other",
            &[
                serde_json::json!({"type": "user", "uuid": "q1", "parentUuid": null,
                "timestamp": crate::test_support::timestamp(9), "entrypoint": "sdk-ts",
                "cwd": "/other", "message": {"role": "user", "content": "Programmatic"}}),
            ],
        )?;
        let (_status, status) = watch::channel(ProviderStatus::Live);
        fixture.storage.start_with(fixture.files.sessions(), status);
        let list = ThreadListParams {
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
                if let Some(page) = fixture.storage.list(&list, &provider) {
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
        assert_eq!(
            listed,
            [terminal.as_str()],
            "programmatic sessions stay hidden"
        );
        let turns = fixture
            .storage
            .turns(&params(&terminal))
            .await
            .ok_or("served")?
            .map_err(|error| error.message)?;
        assert_eq!(turns.turns.len(), 1);
        Ok(())
    }
}
