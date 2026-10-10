//! Keeps the Claude session index current. A changed session record (from
//! the watcher), a finished live turn and the startup backfill each ask the
//! Claude host for a fresh neutral read (`nativeSession.read`); the index and
//! the search documents are replaced only when the read differs. Reads that
//! fail while the host is unavailable are retried once it is live again. A
//! watcher change that rewrites a thread with no live turn is published as a
//! [`HistoryChange`], so open conversations of a session driven elsewhere (a
//! terminal) refresh at once.

use std::{collections::BTreeSet, sync::Arc, time::Duration};

use agent_core::{
    model::{
        AppThreadId, ERROR_INVALID_REQUEST, NativeSessionCodewide, NativeSessionListParams,
        NativeSessionListResult, NativeSessionReadResult, NativeThreadPresence,
    },
    provider::{HistoryChange, ProviderError, ProviderStatus},
};
use async_trait::async_trait;
use tokio::sync::{mpsc, watch};
use tracing::{debug, error, info, warn};

use crate::{
    search::ClaudeSearch,
    storage::Freshness,
    store::{ClaudeStore, Observation, Replaced},
    watcher::SessionChange,
};

/// Sessions per `nativeSession.list` page (the host's maximum).
const LIST_PAGE: u32 = 500;
/// Newest sessions scanned for a finished turn of a thread not indexed yet.
const RECENT_PAGE: u32 = 20;
const RETRY_DELAY: Duration = Duration::from_secs(5);

/// The Claude host's native-session reads.
#[async_trait]
pub trait NativeSessions: Send + Sync {
    async fn list(
        &self,
        params: NativeSessionListParams,
    ) -> Result<NativeSessionListResult, ProviderError>;

    async fn read(&self, session_id: &str) -> Result<NativeSessionReadResult, ProviderError>;
}

#[derive(Debug, thiserror::Error)]
pub enum IndexError {
    #[error(transparent)]
    Host(#[from] ProviderError),
    #[error(transparent)]
    Store(#[from] companion_host::index::StoreError),
    #[error(transparent)]
    Search(#[from] crate::search::ClaudeSearchError),
}

impl IndexError {
    /// Whether the host could not be asked; the read is retried later.
    fn host_unavailable(&self) -> bool {
        matches!(self, Self::Host(error) if error.not_sent() || matches!(error, ProviderError::Disconnected(_)))
    }
}

pub struct ClaudeIndexer {
    store: Arc<ClaudeStore>,
    search: Arc<ClaudeSearch>,
    sessions: Arc<dyn NativeSessions>,
    freshness: Arc<Freshness>,
    history_changes: Option<mpsc::Sender<HistoryChange>>,
}

/// What one session read did to the index.
struct Indexed {
    /// The session's thread; `None` for a session that left the store unindexed.
    thread: Option<AppThreadId>,
    /// The thread whose indexed turns or listed facts were rewritten from Claude's store.
    rewritten: Option<HistoryChange>,
}

/// The change to publish for a rewritten session; a deleted thread has none.
fn history_change(
    thread: &AppThreadId,
    codewide: Option<&NativeSessionCodewide>,
) -> Option<HistoryChange> {
    let archived = match codewide.map(|codewide| &codewide.presence) {
        Some(NativeThreadPresence::Deleted { .. }) => return None,
        Some(NativeThreadPresence::Listed { archived }) => *archived,
        None => false,
    };
    Some(HistoryChange {
        app_thread_id: thread.clone(),
        archived,
    })
}

impl ClaudeIndexer {
    #[must_use]
    pub fn new(
        store: Arc<ClaudeStore>,
        search: Arc<ClaudeSearch>,
        sessions: Arc<dyn NativeSessions>,
        freshness: Arc<Freshness>,
    ) -> Self {
        Self {
            store,
            search,
            sessions,
            freshness,
            history_changes: None,
        }
    }

    /// Publishes every thread a watcher change rewrote while no live turn of
    /// it runs (a live turn reaches clients through its own events).
    #[must_use]
    pub fn with_history_changes(mut self, changes: mpsc::Sender<HistoryChange>) -> Self {
        self.history_changes = Some(changes);
        self
    }

    /// Reads one session and replaces its indexed turns; a session the host
    /// no longer has is removed. Returns the session's thread.
    ///
    /// # Errors
    /// Returns host, index or search failures.
    pub async fn index_session(&self, session_id: &str) -> Result<Option<AppThreadId>, IndexError> {
        self.read_session(session_id)
            .await
            .map(|indexed| indexed.thread)
    }

    async fn read_session(&self, session_id: &str) -> Result<Indexed, IndexError> {
        let previous = self
            .store
            .session(session_id)?
            .map(|stored| stored.session.app_thread_id);
        if let Some(thread) = &previous {
            self.freshness.mark_stale(thread);
        }
        match self.sessions.read(session_id).await {
            Ok(read) => {
                let thread = read.session.app_thread_id.clone();
                self.freshness.mark_stale(&thread);
                let replaced = self.store.replace_session(&read)?;
                self.search.reindex_thread(&thread)?;
                if let Some(previous) = previous.filter(|previous| previous != &thread) {
                    self.search.reindex_thread(&previous)?;
                    self.freshness.mark_fresh(&previous);
                }
                self.freshness.mark_fresh(&thread);
                let rewritten = (replaced == Replaced::Written)
                    .then(|| history_change(&thread, read.session.codewide.as_ref()))
                    .flatten();
                Ok(Indexed {
                    thread: Some(thread),
                    rewritten,
                })
            }
            Err(ProviderError::Rejected(rejection))
                if rejection.code == ERROR_INVALID_REQUEST
                    && rejection.message.starts_with("native session not found:") =>
            {
                let removed = self.store.remove_session(session_id)?;
                if let Some(thread) = &removed {
                    self.search.reindex_thread(thread)?;
                    self.freshness.mark_fresh(thread);
                }
                Ok(Indexed {
                    rewritten: removed
                        .as_ref()
                        .and_then(|thread| history_change(thread, None)),
                    thread: removed,
                })
            }
            Err(error) => Err(error.into()),
        }
    }

    /// Indexes every listed session that changed and drops indexed sessions
    /// the store no longer lists. A session whose read fails while the host
    /// is live is logged with its id and skipped, so one unreadable session
    /// cannot keep every other session out of the index; the skipped ids are
    /// returned for a retry.
    ///
    /// # Errors
    /// Returns a listing failure, an unavailable host, or an index or search
    /// failure.
    pub async fn backfill(&self) -> Result<BTreeSet<String>, IndexError> {
        let mut cursor = None;
        let mut listed = BTreeSet::new();
        let mut failed = BTreeSet::new();
        let mut read = 0_usize;
        loop {
            let page = self
                .sessions
                .list(NativeSessionListParams {
                    cursor,
                    dir: None,
                    limit: LIST_PAGE,
                })
                .await?;
            for session in &page.sessions {
                listed.insert(session.session_id.clone());
                let observed = session
                    .file_size
                    .and_then(|size| u64::try_from(size).ok())
                    .map(|file_size| Observation {
                        file_size,
                        last_modified_ms: session.last_modified_ms,
                    });
                if let Some(observed) = observed
                    && self.store.is_current(&session.session_id, observed)?
                {
                    // The record is unchanged; its listed facts may not be.
                    if self.store.update_session(session)? {
                        self.search.reindex_thread(&session.app_thread_id)?;
                    }
                    continue;
                }
                read += 1;
                self.index_or_skip(&session.session_id, &mut failed).await?;
            }
            cursor = page.next_cursor;
            if cursor.is_none() {
                break;
            }
        }
        for session_id in self.store.session_ids()? {
            if !listed.contains(&session_id) {
                self.index_or_skip(&session_id, &mut failed).await?;
            }
        }
        info!(
            listed = listed.len(),
            read,
            failed = failed.len(),
            "Claude session index pass finished"
        );
        Ok(failed)
    }

    /// Indexes one session during a pass; a failure other than an
    /// unavailable host is logged and recorded instead of ending the pass.
    async fn index_or_skip(
        &self,
        session_id: &str,
        failed: &mut BTreeSet<String>,
    ) -> Result<(), IndexError> {
        match self.index_session(session_id).await {
            Ok(_thread) => Ok(()),
            Err(err) if err.host_unavailable() => Err(err),
            Err(err) => {
                report(&err, Some(session_id), "Claude session indexing failed");
                failed.insert(session_id.to_owned());
                Ok(())
            }
        }
    }

    /// Re-reads a thread's sessions after its live turn finished. A thread
    /// not indexed yet is looked up among the newest sessions.
    ///
    /// # Errors
    /// Returns host, index or search failures.
    pub async fn refresh_thread(&self, thread: &AppThreadId) -> Result<(), IndexError> {
        let known = self.store.thread_sessions(thread)?;
        let session_ids = if known.is_empty() {
            self.sessions
                .list(NativeSessionListParams {
                    cursor: None,
                    dir: None,
                    limit: RECENT_PAGE,
                })
                .await?
                .sessions
                .into_iter()
                .filter(|session| &session.app_thread_id == thread)
                .map(|session| session.session_id)
                .collect::<Vec<_>>()
        } else {
            known
                .into_iter()
                .map(|stored| stored.session.session_id)
                .collect()
        };
        for session_id in session_ids {
            self.index_session(&session_id).await?;
        }
        self.freshness.mark_fresh(thread);
        Ok(())
    }

    /// Applies one watcher change.
    ///
    /// # Errors
    /// Returns host, index or search failures.
    pub async fn apply(&self, change: &SessionChange) -> Result<(), IndexError> {
        if let Some(observed) = change.observed
            && !change.subagents_changed
            && self.store.is_current(&change.session_id, observed)?
        {
            return Ok(());
        }
        let indexed = self.read_session(&change.session_id).await?;
        if let (Some(sender), Some(rewritten)) = (&self.history_changes, indexed.rewritten)
            && !self.freshness.is_running(&rewritten.app_thread_id)
            && sender.try_send(rewritten).is_err()
        {
            warn!(
                session_id = %change.session_id,
                "Claude history change queue is full; the next change or open repairs the thread"
            );
        }
        Ok(())
    }

    /// Runs until both input streams end: the backfill once the host is
    /// live, then watcher changes and finished turns. Work the host could
    /// not serve is retried after it is live again.
    pub async fn run(
        self,
        mut changes: mpsc::Receiver<SessionChange>,
        mut finished: mpsc::Receiver<AppThreadId>,
        mut relist: mpsc::Receiver<()>,
        mut status: watch::Receiver<ProviderStatus>,
    ) {
        let mut backfilled = false;
        let mut relist_open = true;
        let mut pending_sessions = BTreeSet::<String>::new();
        let mut pending_threads = BTreeSet::<AppThreadId>::new();
        let mut changes_open = true;
        let mut finished_open = true;
        loop {
            if *status.borrow() == ProviderStatus::Live {
                if !backfilled {
                    self.search.set_indexing(true);
                    match self.backfill().await {
                        Ok(failed) => {
                            backfilled = true;
                            self.search.set_indexing(false);
                            // A listing requested during the pass runs again;
                            // a skipped session keeps the host answering the
                            // list until its retry succeeds.
                            if relist.try_recv().is_ok() {
                                backfilled = false;
                            } else if failed.is_empty() {
                                self.freshness.set_catalog_current(true);
                            }
                            pending_sessions.extend(failed);
                        }
                        Err(err) => report(&err, None, "Claude session backfill failed"),
                    }
                }
                let had_pending = !pending_sessions.is_empty();
                for session_id in std::mem::take(&mut pending_sessions) {
                    if let Err(err) = self.index_session(&session_id).await {
                        report(&err, Some(&session_id), "Claude session indexing failed");
                        pending_sessions.insert(session_id);
                    }
                }
                if had_pending && pending_sessions.is_empty() {
                    // Every skipped session is indexed: one more pass marks
                    // the catalog current.
                    backfilled = false;
                    continue;
                }
                for thread in std::mem::take(&mut pending_threads) {
                    if let Err(err) = self.refresh_thread(&thread).await {
                        report_thread(&err, &thread, "Claude thread re-indexing failed");
                        pending_threads.insert(thread);
                    }
                }
            }
            if !changes_open && !finished_open {
                return;
            }
            let retry = !backfilled || !pending_sessions.is_empty() || !pending_threads.is_empty();
            tokio::select! {
                change = changes.recv(), if changes_open => match change {
                    Some(change) => {
                        // A large session takes a while to read; the echoes
                        // queued meanwhile collapse into one read each.
                        for change in coalesce(change, &mut changes) {
                            if let Err(err) = self.apply(&change).await {
                                report(&err, Some(&change.session_id), "Claude session indexing failed");
                                pending_sessions.insert(change.session_id);
                            }
                        }
                    }
                    None => changes_open = false,
                },
                thread = finished.recv(), if finished_open => match thread {
                    Some(thread) => {
                        if let Err(err) = self.refresh_thread(&thread).await {
                            report_thread(&err, &thread, "Claude thread re-indexing failed");
                            pending_threads.insert(thread);
                        }
                    }
                    None => finished_open = false,
                },
                signal = relist.recv(), if relist_open => match signal {
                    Some(()) => backfilled = false,
                    None => relist_open = false,
                },
                live = status.changed() => {
                    if live.is_err() {
                        return;
                    }
                }
                () = tokio::time::sleep(RETRY_DELAY), if retry => {}
            }
        }
    }
}

/// `first` and every change already queued behind it, one per session: the
/// newest observation wins and a sub-agent change is kept.
fn coalesce(
    first: SessionChange,
    queued: &mut mpsc::Receiver<SessionChange>,
) -> Vec<SessionChange> {
    let mut changes = vec![first];
    while let Ok(next) = queued.try_recv() {
        match changes
            .iter_mut()
            .find(|change| change.session_id == next.session_id)
        {
            Some(change) => {
                change.subagents_changed |= next.subagents_changed;
                change.observed = next.observed;
            }
            None => changes.push(next),
        }
    }
    changes
}

/// Logs a failed index step with the session it concerns (an opaque id,
/// never content): an unavailable host is expected and retried.
fn report(err: &IndexError, session_id: Option<&str>, message: &'static str) {
    let session_id = session_id.unwrap_or("");
    if err.host_unavailable() {
        debug!(err = %err, session_id, "{message}; retrying when the Claude host is live");
    } else if matches!(err, IndexError::Host(_)) {
        warn!(err = %err, session_id, "{message}");
    } else {
        error!(err = %err, session_id, "{message}");
    }
}

/// Logs a failed thread re-read with its thread id.
fn report_thread(err: &IndexError, thread: &AppThreadId, message: &'static str) {
    if err.host_unavailable() {
        debug!(err = %err, thread_id = %thread, "{message}; retrying when the Claude host is live");
    } else if matches!(err, IndexError::Host(_)) {
        warn!(err = %err, thread_id = %thread, "{message}");
    } else {
        error!(err = %err, thread_id = %thread, "{message}");
    }
}

#[cfg(test)]
mod tests {
    use std::{collections::HashMap, sync::Mutex};

    use agent_core::model::{NativeSession, RpcError};

    use super::*;
    use crate::test_support::{MemoryThreadIndex, session_read};

    /// A Claude host over fixture reads, counting reads per session.
    #[derive(Default)]
    pub(crate) struct FakeHost {
        pub(crate) sessions: Mutex<HashMap<String, NativeSessionReadResult>>,
        pub(crate) reads: Mutex<Vec<String>>,
        /// Sessions whose read fails although the host is live.
        pub(crate) unreadable: Mutex<Vec<String>>,
    }

    impl FakeHost {
        fn put(&self, read: NativeSessionReadResult) {
            self.sessions
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner)
                .insert(read.session.session_id.clone(), read);
        }

        fn remove(&self, session_id: &str) {
            self.sessions
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner)
                .remove(session_id);
        }

        fn reads(&self) -> Vec<String> {
            self.reads
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner)
                .clone()
        }
    }

    #[async_trait]
    impl NativeSessions for FakeHost {
        async fn list(
            &self,
            _params: NativeSessionListParams,
        ) -> Result<NativeSessionListResult, ProviderError> {
            let mut sessions = self
                .sessions
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner)
                .values()
                .map(|read| read.session.clone())
                .collect::<Vec<NativeSession>>();
            sessions.sort_by_key(|session| std::cmp::Reverse(session.last_modified_ms));
            Ok(NativeSessionListResult {
                next_cursor: None,
                sessions,
            })
        }

        async fn read(&self, session_id: &str) -> Result<NativeSessionReadResult, ProviderError> {
            self.reads
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner)
                .push(session_id.to_owned());
            if self
                .unreadable
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner)
                .iter()
                .any(|unreadable| unreadable == session_id)
            {
                return Err(ProviderError::Rejected(RpcError {
                    code: -32_603,
                    message: "session record cannot be parsed".into(),
                    data: None,
                }));
            }
            self.sessions
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner)
                .get(session_id)
                .cloned()
                .ok_or_else(|| {
                    ProviderError::Rejected(RpcError {
                        code: ERROR_INVALID_REQUEST,
                        message: format!("native session not found: {session_id}"),
                        data: None,
                    })
                })
        }
    }

    fn indexer(
        directory: &std::path::Path,
        host: Arc<FakeHost>,
    ) -> Result<(ClaudeIndexer, Arc<ClaudeStore>), Box<dyn std::error::Error>> {
        let database = companion_host::database::open(directory.join("index.redb"), "test")?;
        let store = Arc::new(ClaudeStore::attach(
            database,
            Arc::new(MemoryThreadIndex::default()),
        )?);
        let search = Arc::new(ClaudeSearch::open(
            &directory.join("search.sqlite"),
            store.clone(),
        )?);
        Ok((
            ClaudeIndexer::new(store.clone(), search, host, Arc::new(Freshness::default())),
            store,
        ))
    }

    #[test]
    fn queued_echoes_of_one_session_collapse_into_its_newest_observation() {
        let (sender, mut queued) = mpsc::channel(8);
        for next in [
            change("a", 20),
            SessionChange {
                subagents_changed: true,
                ..change("b", 5)
            },
            change("a", 30),
            change("b", 6),
        ] {
            assert!(sender.try_send(next).is_ok());
        }
        let collapsed = coalesce(change("a", 10), &mut queued);
        assert_eq!(
            collapsed,
            [
                change("a", 30),
                SessionChange {
                    subagents_changed: true,
                    ..change("b", 6)
                },
            ]
        );
    }

    fn change(session_id: &str, size: u64) -> SessionChange {
        SessionChange {
            session_id: session_id.into(),
            observed: Some(Observation {
                file_size: size,
                last_modified_ms: i64::try_from(size).unwrap_or(0) * 1000,
            }),
            subagents_changed: false,
        }
    }

    #[tokio::test]
    async fn a_session_written_elsewhere_publishes_its_thread_unless_a_live_turn_runs()
    -> Result<(), Box<dyn std::error::Error>> {
        let directory = tempfile::tempdir()?;
        let host = Arc::new(FakeHost::default());
        host.put(session_read("terminal", "terminal", 10, &["hello"]));
        let database = companion_host::database::open(directory.path().join("index.redb"), "test")?;
        let store = Arc::new(ClaudeStore::attach(
            database,
            Arc::new(MemoryThreadIndex::default()),
        )?);
        let search = Arc::new(ClaudeSearch::open(
            &directory.path().join("search.sqlite"),
            store.clone(),
        )?);
        let freshness = Arc::new(Freshness::default());
        let (sender, mut changes) = mpsc::channel(8);
        let indexer = ClaudeIndexer::new(store, search, host.clone(), freshness.clone())
            .with_history_changes(sender);
        let thread = AppThreadId::from_static("terminal");

        // The startup backfill indexes without publishing.
        indexer.backfill().await?;
        assert!(changes.try_recv().is_err());

        // A terminal appends a prompt: the open conversation must refresh.
        host.put(session_read(
            "terminal",
            "terminal",
            20,
            &["hello", "again"],
        ));
        indexer.apply(&change("terminal", 20)).await?;
        assert_eq!(
            changes.try_recv()?,
            HistoryChange {
                app_thread_id: thread.clone(),
                archived: false,
            }
        );

        // An echo of the same record rewrites nothing and publishes nothing.
        indexer.apply(&change("terminal", 20)).await?;
        assert!(changes.try_recv().is_err());

        // A turn the companion drives reaches clients through its own events.
        freshness.started(&thread);
        host.put(session_read(
            "terminal",
            "terminal",
            30,
            &["hello", "again", "live"],
        ));
        indexer.apply(&change("terminal", 30)).await?;
        assert!(changes.try_recv().is_err());
        freshness.finished(&thread);
        Ok(())
    }

    #[tokio::test]
    async fn backfill_indexes_a_terminal_session_once_and_follows_changes()
    -> Result<(), Box<dyn std::error::Error>> {
        let directory = tempfile::tempdir()?;
        let host = Arc::new(FakeHost::default());
        host.put(session_read("terminal", "terminal", 10, &["hello"]));
        let (indexer, store) = indexer(directory.path(), host.clone())?;

        indexer.backfill().await?;
        indexer.backfill().await?;
        assert_eq!(host.reads(), ["terminal"]);
        assert!(
            store
                .thread_turns(&AppThreadId::from_static("terminal"))?
                .is_some()
        );

        // An unchanged observation needs no read; a changed one re-reads.
        let unchanged = SessionChange {
            session_id: "terminal".into(),
            observed: Some(Observation {
                file_size: 10,
                last_modified_ms: 10_000,
            }),
            subagents_changed: false,
        };
        indexer.apply(&unchanged).await?;
        assert_eq!(host.reads().len(), 1);
        host.put(session_read(
            "terminal",
            "terminal",
            20,
            &["hello", "again"],
        ));
        indexer
            .apply(&SessionChange {
                session_id: "terminal".into(),
                observed: Some(Observation {
                    file_size: 20,
                    last_modified_ms: 20_000,
                }),
                subagents_changed: false,
            })
            .await?;
        assert_eq!(
            store
                .thread_turns(&AppThreadId::from_static("terminal"))?
                .map(|turns| turns.len()),
            Some(2)
        );

        host.remove("terminal");
        indexer
            .apply(&SessionChange {
                session_id: "terminal".into(),
                observed: None,
                subagents_changed: false,
            })
            .await?;
        assert!(store.session_ids()?.is_empty());
        Ok(())
    }

    #[tokio::test]
    async fn an_unreadable_session_is_skipped_and_reported_without_blocking_the_rest()
    -> Result<(), Box<dyn std::error::Error>> {
        let directory = tempfile::tempdir()?;
        let host = Arc::new(FakeHost::default());
        host.put(session_read("broken", "broken", 30, &["big"]));
        host.put(session_read("terminal", "terminal", 10, &["hello"]));
        host.unreadable
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .push("broken".into());
        let (indexer, store) = indexer(directory.path(), host)?;
        let failed = indexer.backfill().await?;
        assert_eq!(failed.into_iter().collect::<Vec<_>>(), ["broken"]);
        assert!(
            store
                .thread_turns(&AppThreadId::from_static("terminal"))?
                .is_some(),
            "a later session is indexed despite the failed one"
        );
        Ok(())
    }

    #[tokio::test]
    async fn backfill_refreshes_codewide_metadata_without_reading_turns()
    -> Result<(), Box<dyn std::error::Error>> {
        use agent_core::model::{
            NativeSessionCodewide, NativeThreadOrigin, NativeThreadPresence, NativeTitleOverride,
            ThreadSettings,
        };
        let directory = tempfile::tempdir()?;
        let host = Arc::new(FakeHost::default());
        host.put(session_read("session", "thread", 10, &["hello"]));
        let (indexer, store) = indexer(directory.path(), host.clone())?;
        indexer.backfill().await?;
        let mut archived = session_read("session", "thread", 10, &["hello"]);
        archived.session.codewide = Some(NativeSessionCodewide {
            created_at: 1,
            cwd: "/work".into(),
            origin: NativeThreadOrigin::Interactive,
            presence: NativeThreadPresence::Listed { archived: true },
            recency_at: None,
            settings: ThreadSettings {
                model: "default".into(),
                effort: None,
                permission_profile: ":read-only".into(),
                service_tier: None,
            },
            title: NativeTitleOverride::None,
            updated_at: 2,
        });
        host.put(archived.clone());
        indexer.backfill().await?;
        assert_eq!(
            host.reads(),
            ["session"],
            "an unchanged record is not read again"
        );
        assert_eq!(
            store
                .session("session")?
                .and_then(|stored| stored.session.codewide),
            archived.session.codewide
        );
        Ok(())
    }

    #[tokio::test]
    async fn a_finished_turn_of_a_new_thread_is_found_among_recent_sessions()
    -> Result<(), Box<dyn std::error::Error>> {
        let directory = tempfile::tempdir()?;
        let host = Arc::new(FakeHost::default());
        host.put(session_read("session-x", "thread-x", 10, &["first"]));
        let (indexer, store) = indexer(directory.path(), host)?;
        let thread = AppThreadId::from_static("thread-x");
        indexer.refresh_thread(&thread).await?;
        assert_eq!(
            store.thread_turns(&thread)?.map(|turns| turns.len()),
            Some(1)
        );
        Ok(())
    }
}
