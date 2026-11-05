//! Keeps the Claude session index current. A changed session record (from
//! the watcher), a finished live turn and the startup backfill each advance
//! the session's files on the index from their checkpoints
//! ([`crate::index::session`]): only appended records are read, and only the
//! turns whose range moved are read back for their digests and search
//! documents. Work that fails while the running-session authority is
//! unavailable is retried once it is live again. A watcher change that
//! rewrites a thread with no live turn is published as a [`HistoryChange`],
//! so open conversations of a session driven elsewhere (a terminal) refresh
//! at once.

use std::{collections::BTreeSet, sync::Arc, time::Duration};

use agent_core::{
    model::{AppThreadId, NativeSessionListParams},
    provider::{ProviderError, ProviderStatus},
};
use tokio::sync::{mpsc, watch};
use tracing::{debug, error, info, warn};

use crate::{
    index::{
        session::SessionIndexError,
        sessions::{ActivitySource, Publish, SessionIndex},
    },
    storage::Freshness,
    store::Observation,
    watcher::SessionChange,
};

/// Sessions per listing page.
const LIST_PAGE: u32 = 500;
/// Newest sessions scanned for a finished turn of a thread not indexed yet.
const RECENT_PAGE: u32 = 20;
const RETRY_DELAY: Duration = Duration::from_secs(5);

#[derive(Debug, thiserror::Error)]
pub enum IndexError {
    #[error(transparent)]
    Host(#[from] ProviderError),
    #[error(transparent)]
    Store(#[from] companion_host::index::StoreError),
    #[error(transparent)]
    Search(#[from] crate::search::ClaudeSearchError),
    #[error(transparent)]
    Session(#[from] SessionIndexError),
    #[error("Claude session indexing worker failed: {0}")]
    Worker(String),
}

impl IndexError {
    /// Whether the session source could not be asked; the read is retried later.
    fn host_unavailable(&self) -> bool {
        matches!(self, Self::Host(error) if error.not_sent() || matches!(error, ProviderError::Disconnected(_)))
    }
}

pub struct ClaudeIndexer {
    index: Arc<SessionIndex>,
    freshness: Arc<Freshness>,
}

impl ClaudeIndexer {
    #[must_use]
    pub fn new(index: Arc<SessionIndex>, freshness: Arc<Freshness>) -> Self {
        Self { index, freshness }
    }

    fn set_indexing(&self, indexing: bool) {
        if let Some(search) = self.index.search() {
            search.set_indexing(indexing);
        }
    }

    /// Advances one session on the index; a session the store no longer
    /// has is removed. Returns the session's thread.
    ///
    /// # Errors
    /// Returns source, index or search failures.
    pub async fn index_session(&self, session_id: &str) -> Result<Option<AppThreadId>, IndexError> {
        self.index
            .advance(session_id, ActivitySource::Confirmed, Publish::Subagents)
            .await
    }

    /// Indexes every listed session that changed and drops indexed sessions
    /// the store no longer lists. A session whose pass fails while the
    /// source is live is logged with its id and skipped, so one unreadable
    /// session cannot keep every other session out of the index; the
    /// skipped ids are returned for a retry. A session whose record is
    /// unchanged but whose sub-agents still run is passed again: its files
    /// are not read (their checkpoints match), but its sub-agents' state is
    /// settled again against the facts and the process activity.
    ///
    /// # Errors
    /// Returns a listing failure, an unavailable source, or an index or
    /// search failure.
    pub async fn backfill(&self) -> Result<BTreeSet<String>, IndexError> {
        let mut cursor = None;
        let mut listed = BTreeSet::new();
        let mut failed = BTreeSet::new();
        let mut read = 0_usize;
        loop {
            let page = self
                .index
                .sessions()
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
                let has_running_subagents = self
                    .index
                    .store()
                    .session(&session.session_id)?
                    .is_some_and(|stored| stored.subagents.iter().any(|agent| agent.running));
                if let Some(observed) = observed
                    && self
                        .index
                        .store()
                        .is_current(&session.session_id, observed)?
                    && !has_running_subagents
                {
                    // The record is unchanged; its listed facts may not be.
                    if self.index.store().update_session(session)?
                        && let Some(search) = self.index.search()
                    {
                        search.update_info(&session.app_thread_id)?;
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
        for session_id in self.index.store().session_ids()? {
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
    /// unavailable source is logged and recorded instead of ending the pass.
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

    /// Advances a thread's sessions after its live turn finished. A thread
    /// not indexed yet is looked up among the newest sessions.
    ///
    /// # Errors
    /// Returns source, index or search failures.
    pub async fn refresh_thread(&self, thread: &AppThreadId) -> Result<(), IndexError> {
        let known = self.index.store().thread_sessions(thread)?;
        let session_ids = if known.is_empty() {
            self.index
                .sessions()
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
    /// Returns source, index or search failures.
    pub async fn apply(&self, change: &SessionChange) -> Result<(), IndexError> {
        if let Some(observed) = change.observed
            && !change.subagents_changed
            && self
                .index
                .store()
                .is_current(&change.session_id, observed)?
        {
            return Ok(());
        }
        self.index
            .advance(
                &change.session_id,
                ActivitySource::Confirmed,
                Publish::HistoryAndSubagents,
            )
            .await?;
        Ok(())
    }

    /// Runs until both input streams end: the backfill once the provider is
    /// live, then watcher changes and finished turns. Work the source could
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
                    self.set_indexing(true);
                    match self.backfill().await {
                        Ok(failed) => {
                            backfilled = true;
                            self.set_indexing(false);
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
        debug!(err = %err, session_id, "{message}; retrying when the Claude session source is live");
    } else if matches!(err, IndexError::Host(_)) {
        warn!(err = %err, session_id, "{message}");
    } else {
        error!(err = %err, session_id, "{message}");
    }
}

/// Logs a failed thread re-read with its thread id.
fn report_thread(err: &IndexError, thread: &AppThreadId, message: &'static str) {
    if err.host_unavailable() {
        debug!(err = %err, thread_id = %thread, "{message}; retrying when the Claude session source is live");
    } else if matches!(err, IndexError::Host(_)) {
        warn!(err = %err, thread_id = %thread, "{message}");
    } else {
        error!(err = %err, thread_id = %thread, "{message}");
    }
}

#[cfg(test)]
mod tests {
    use agent_core::provider::HistoryChange;

    use super::*;
    use crate::test_support::{StoreFixture, session_id};

    const CWD: &str = "/work";

    fn indexer(fixture: &StoreFixture, freshness: Arc<Freshness>) -> ClaudeIndexer {
        ClaudeIndexer::new(
            Arc::new(fixture.session_index(freshness.clone())),
            freshness,
        )
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

    #[tokio::test]
    async fn a_session_written_elsewhere_publishes_its_thread_unless_a_live_turn_runs()
    -> Result<(), Box<dyn std::error::Error>> {
        let fixture = StoreFixture::new()?;
        let session = session_id(1);
        fixture.exchange(&session, CWD, 1, &["hello"])?;
        let freshness = Arc::new(Freshness::default());
        let (sender, mut changes) = mpsc::channel(8);
        let index = Arc::new(fixture.session_index(freshness.clone()));
        let (subagents, _subagent_changes) = mpsc::channel(8);
        index.publish_to(sender, subagents);
        let indexer = ClaudeIndexer::new(index, freshness.clone());
        let thread = AppThreadId::parse(&session).ok_or("thread id")?;

        // The startup backfill indexes without publishing.
        indexer.backfill().await?;
        assert!(changes.try_recv().is_err());

        // A terminal appends a prompt: the open conversation must refresh.
        fixture.exchange(&session, CWD, 10, &["again"])?;
        let unobserved = SessionChange {
            session_id: session.clone(),
            observed: None,
            subagents_changed: false,
        };
        indexer.apply(&unobserved).await?;
        assert_eq!(
            changes.try_recv()?,
            HistoryChange {
                app_thread_id: thread.clone(),
                archived: false,
                // The list row shows the newest message, not the first prompt.
                preview: Some("answer to again".into()),
            }
        );

        // An echo of the same record rewrites nothing and publishes nothing.
        indexer.apply(&unobserved).await?;
        assert!(changes.try_recv().is_err());

        // A turn the companion drives reaches clients through its own events.
        freshness.started(&thread);
        fixture.exchange(&session, CWD, 20, &["live"])?;
        indexer.apply(&unobserved).await?;
        assert!(changes.try_recv().is_err());
        freshness.finished(&thread);
        Ok(())
    }

    #[tokio::test]
    async fn a_session_gone_from_the_store_leaves_the_index_and_its_search()
    -> Result<(), Box<dyn std::error::Error>> {
        use agent_core::provider::StoredMessageSearch as _;
        let fixture = StoreFixture::new()?;
        let session = session_id(2);
        fixture.exchange(&session, CWD, 1, &["temporary note"])?;
        let indexer = indexer(&fixture, Arc::new(Freshness::default()));
        indexer.backfill().await?;
        assert_eq!(fixture.store.session_ids()?, std::slice::from_ref(&session));
        std::fs::remove_file(fixture.path(&session, CWD))?;
        indexer
            .apply(&SessionChange {
                session_id: session.clone(),
                observed: None,
                subagents_changed: false,
            })
            .await?;
        assert!(fixture.store.session_ids()?.is_empty());
        let page = fixture
            .search
            .search(&serde_json::json!({"query": "temporary"}))
            .await?;
        assert_eq!(page["data"].as_array().map(Vec::len), Some(0));
        Ok(())
    }

    #[tokio::test]
    async fn a_finished_turn_of_a_new_thread_is_found_among_recent_sessions()
    -> Result<(), Box<dyn std::error::Error>> {
        let fixture = StoreFixture::new()?;
        let session = session_id(3);
        fixture.exchange(&session, CWD, 1, &["first"])?;
        let indexer = indexer(&fixture, Arc::new(Freshness::default()));
        let thread = AppThreadId::parse(&session).ok_or("thread id")?;
        indexer.refresh_thread(&thread).await?;
        assert_eq!(fixture.store.thread_sessions(&thread)?.len(), 1);
        Ok(())
    }
}
