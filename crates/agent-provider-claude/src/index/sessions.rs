//! The one owner of advancing Claude sessions on the index: the indexer's
//! passes and the thread service's reads both go through [`SessionIndex`],
//! one pass per session at a time. A pass reads only what was appended to a
//! session's files since their checkpoints, so a read that must see the
//! newest records catches the index up instead of reading the session whole.
//!
//! A pass that rewrote a session publishes what changed: the thread whose
//! sub-agents now list differently, and, when asked and no live turn of the
//! thread runs, the thread whose history changed (a session driven
//! elsewhere).

use std::{
    collections::HashMap,
    path::PathBuf,
    sync::{Arc, Mutex, OnceLock, PoisonError},
};

use agent_core::{
    model::{AppThreadId, NativeSessionCodewide, NativeThreadPresence},
    provider::{HistoryChange, ProviderError, SubagentsChange},
};
use tokio::sync::mpsc;
use tracing::warn;

use super::{
    history::IndexedHistory,
    session::{ListedSession, SessionChanges, index_session},
};
use crate::{
    catalog,
    indexer::IndexError,
    native::{LocalSessions, host_state::HostStateCache},
    runtime::{open_elsewhere::SessionActivity, running_sessions::RunningProcess},
    search::ClaudeSearch,
    storage::Freshness,
    store::ClaudeStore,
    subagents,
};

/// Where a pass takes the process activity it settles sub-agents with.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ActivitySource {
    /// Only a confirmed running-session read: an unavailable one fails the
    /// pass, which is retried later (the indexer).
    Confirmed,
    /// A confirmed read, else what the last pass saw, else a held process of
    /// unknown start (a read must not settle an agent as stopped without
    /// evidence).
    Latest,
}

/// Which changes a pass publishes.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum Publish {
    /// Sub-agent changes only (the backfill and finished turns, which
    /// clients learn of otherwise).
    Subagents,
    /// Sub-agent changes and, unless a live turn runs, the rewritten thread.
    HistoryAndSubagents,
}

/// What one session pass found.
pub enum Pass {
    Indexed(Box<SessionChanges>),
    /// The store no longer has the session; its thread, when it was indexed.
    Removed(Option<AppThreadId>),
}

/// Where a pass publishes.
struct Publishers {
    history: mpsc::Sender<HistoryChange>,
    subagents: mpsc::Sender<SubagentsChange>,
}

/// Claude's sessions on the index.
pub struct SessionIndex {
    store: Arc<ClaudeStore>,
    history: Arc<IndexedHistory>,
    search: Option<Arc<ClaudeSearch>>,
    sessions: LocalSessions,
    freshness: Arc<Freshness>,
    publishers: OnceLock<Publishers>,
    /// One pass per session at a time.
    lanes: Mutex<HashMap<String, Arc<tokio::sync::Mutex<()>>>>,
}

/// The change to publish for a rewritten session, with the thread's preview
/// from the index it was written to; a deleted thread has none.
fn history_change(
    store: &ClaudeStore,
    thread: &AppThreadId,
    codewide: Option<&NativeSessionCodewide>,
) -> Result<Option<HistoryChange>, IndexError> {
    let archived = match codewide.map(|codewide| &codewide.presence) {
        Some(NativeThreadPresence::Deleted { .. }) => return Ok(None),
        Some(NativeThreadPresence::Listed { archived }) => *archived,
        None => false,
    };
    let sessions = store.thread_sessions(thread)?;
    let preview = catalog::threads(&sessions)
        .first()
        .and_then(catalog::thread_preview);
    Ok(Some(HistoryChange {
        app_thread_id: thread.clone(),
        archived,
        preview,
    }))
}

impl SessionIndex {
    #[must_use]
    pub fn new(
        store: Arc<ClaudeStore>,
        history: Arc<IndexedHistory>,
        search: Option<Arc<ClaudeSearch>>,
        sessions: LocalSessions,
        freshness: Arc<Freshness>,
    ) -> Self {
        Self {
            store,
            history,
            search,
            sessions,
            freshness,
            publishers: OnceLock::new(),
            lanes: Mutex::new(HashMap::new()),
        }
    }

    /// An index kept in memory only, for a provider without host storage:
    /// its reads still never read a session whole. Nothing is searchable.
    ///
    /// # Errors
    ///
    /// Returns an error when the in-memory tables cannot be created.
    pub fn in_memory(sessions: LocalSessions) -> Result<Self, companion_host::index::StoreError> {
        let database = Arc::new(
            redb::Database::builder()
                .create_with_backend(redb::backends::InMemoryBackend::new())
                .map_err(companion_host::index::StoreError::from)?,
        );
        let store = Arc::new(ClaudeStore::attach(database, Arc::new(NoThreadIndex))?);
        let history = Arc::new(IndexedHistory::new(
            store.clone(),
            Arc::new(HostStateCache::new(PathBuf::from(
                sessions.journal_directory(),
            ))),
        ));
        Ok(Self::new(
            store,
            history,
            None,
            sessions,
            Arc::new(Freshness::default()),
        ))
    }

    /// Publishes later passes' changes; set once by the indexer.
    pub fn publish_to(
        &self,
        history: mpsc::Sender<HistoryChange>,
        subagents: mpsc::Sender<SubagentsChange>,
    ) {
        let _ = self.publishers.set(Publishers { history, subagents });
    }

    #[must_use]
    pub fn store(&self) -> &Arc<ClaudeStore> {
        &self.store
    }

    #[must_use]
    pub fn history(&self) -> &Arc<IndexedHistory> {
        &self.history
    }

    /// The search index the passes write, when the provider has one.
    #[must_use]
    pub fn search(&self) -> Option<&Arc<ClaudeSearch>> {
        self.search.as_ref()
    }

    #[must_use]
    pub fn sessions(&self) -> &LocalSessions {
        &self.sessions
    }

    fn lane(&self, session_id: &str) -> Arc<tokio::sync::Mutex<()>> {
        self.lanes
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .entry(session_id.to_owned())
            .or_default()
            .clone()
    }

    async fn activity(
        &self,
        session_id: &str,
        source: ActivitySource,
    ) -> Result<SessionActivity, IndexError> {
        if let Some(activity) = self.sessions.activity(session_id).await {
            return Ok(activity);
        }
        match source {
            ActivitySource::Confirmed => Err(ProviderError::Disconnected(
                "Claude running-session state is unavailable".into(),
            )
            .into()),
            ActivitySource::Latest => Ok(self.store.session(session_id)?.map_or(
                SessionActivity::Running(RunningProcess::StartUnknown),
                |stored| stored.activity,
            )),
        }
    }

    async fn pass(&self, session_id: &str, activity: SessionActivity) -> Result<Pass, IndexError> {
        let store = self.store.clone();
        let search = self.search.clone();
        let sessions = self.sessions.clone();
        let host = self.history.host().clone();
        let session_id = session_id.to_owned();
        tokio::task::spawn_blocking(move || -> Result<Pass, IndexError> {
            let threads = host.threads();
            let Some((file, session)) = sessions.listed_session(&session_id, &threads) else {
                let removed = store.remove_session(&session_id)?;
                if let (Some(thread), Some(search)) = (&removed, &search) {
                    search.reindex_thread(thread)?;
                }
                return Ok(Pass::Removed(removed));
            };
            let changes = index_session(
                &store,
                &ListedSession {
                    file: &file,
                    session,
                    owner: threads.owner_of(&session_id),
                },
                activity,
            )?;
            if let Some(search) = &search {
                search.apply(&changes)?;
            }
            Ok(Pass::Indexed(Box::new(changes)))
        })
        .await
        .map_err(|error| IndexError::Worker(error.to_string()))?
    }

    /// Advances one session on the index (a session the store no longer has
    /// is removed) and publishes what changed. Returns the session's thread.
    ///
    /// # Errors
    ///
    /// Returns source, index or search failures.
    pub async fn advance(
        &self,
        session_id: &str,
        source: ActivitySource,
        publish: Publish,
    ) -> Result<Option<AppThreadId>, IndexError> {
        let lane = self.lane(session_id);
        let _pass = lane.lock().await;
        let (previous, previous_subagents) = self
            .store
            .session(session_id)?
            .map(|stored| (Some(stored.session.app_thread_id), stored.subagents))
            .unwrap_or_default();
        if let Some(thread) = &previous {
            self.freshness.mark_stale(thread);
        }
        let activity = match self.activity(session_id, source).await {
            Ok(activity) => activity,
            Err(error) => {
                if let Some(thread) = &previous {
                    self.freshness.mark_fresh(thread);
                }
                return Err(error);
            }
        };
        let (thread, rewritten, subagents_changed) = match self.pass(session_id, activity).await? {
            Pass::Indexed(changes) => {
                let thread = changes.stored.session.app_thread_id.clone();
                if let Some(previous) = previous.filter(|previous| previous != &thread) {
                    self.freshness.mark_fresh(&previous);
                }
                self.freshness.mark_fresh(&thread);
                if changes.written() {
                    (
                        Some(thread.clone()),
                        history_change(
                            &self.store,
                            &thread,
                            changes.stored.session.codewide.as_ref(),
                        )?,
                        subagents::listed_differently(
                            &previous_subagents,
                            &changes.stored.subagents,
                        )
                        .then_some(thread),
                    )
                } else {
                    (Some(thread), None, None)
                }
            }
            Pass::Removed(removed) => {
                if let Some(thread) = &removed {
                    self.freshness.mark_fresh(thread);
                }
                let rewritten = match &removed {
                    Some(thread) => history_change(&self.store, thread, None)?,
                    None => None,
                };
                let subagents_changed = removed.clone().filter(|_| !previous_subagents.is_empty());
                (removed, rewritten, subagents_changed)
            }
        };
        if let Some(publishers) = self.publishers.get() {
            if let Some(app_thread_id) = subagents_changed
                && publishers
                    .subagents
                    .try_send(SubagentsChange { app_thread_id })
                    .is_err()
            {
                warn!(
                    session_id,
                    "Claude sub-agent change queue is full; the next change or open repairs the thread"
                );
            }
            if publish == Publish::HistoryAndSubagents
                && let Some(rewritten) = rewritten
                && !self.freshness.is_running(&rewritten.app_thread_id)
                && publishers.history.try_send(rewritten).is_err()
            {
                warn!(
                    session_id,
                    "Claude history change queue is full; the next change or open repairs the thread"
                );
            }
        }
        Ok(thread)
    }

    /// Catches the index up with these sessions' files before a read that
    /// must see their newest records: only what was appended since each
    /// checkpoint is read.
    ///
    /// # Errors
    ///
    /// Returns index or search failures.
    pub async fn catch_up<'s>(
        &self,
        session_ids: impl IntoIterator<Item = &'s str>,
    ) -> Result<(), IndexError> {
        for session_id in session_ids {
            self.advance(
                session_id,
                ActivitySource::Latest,
                Publish::HistoryAndSubagents,
            )
            .await?;
        }
        Ok(())
    }
}

/// The companion thread index of an index kept in memory: nothing is
/// published (a provider without host storage has no thread index).
struct NoThreadIndex;

impl companion_host::thread_index::HostThreadIndex for NoThreadIndex {
    fn put_thread_metadata(
        &self,
        _metadata: &companion_host::thread_index::IndexedThreadMetadata,
    ) -> Result<(), companion_host::index::StoreError> {
        Ok(())
    }

    fn put_thread_metadata_batch(
        &self,
        _metadata: &[companion_host::thread_index::IndexedThreadMetadata],
    ) -> Result<(), companion_host::index::StoreError> {
        Ok(())
    }

    fn thread_descendants(
        &self,
        _root: &str,
    ) -> Result<
        Vec<companion_host::thread_index::IndexedThreadMetadata>,
        companion_host::index::StoreError,
    > {
        Ok(Vec::new())
    }

    fn thread_pin_snapshot(
        &self,
    ) -> Result<companion_host::thread_index::ThreadPinSnapshot, companion_host::index::StoreError>
    {
        Ok(companion_host::thread_index::ThreadPinSnapshot {
            cursor: 0,
            thread_ids: Vec::new(),
        })
    }
}
