//! What the adapter reads from the index: `thread.turns` pages, the turns
//! of a search window, a sub-agent's child thread and its pages, and a
//! thread's resources. Every read opens the thread's files at their
//! checkpoints and reads the byte ranges of the turns it returns; resources
//! come from the turn digests alone.

use std::{path::PathBuf, sync::Arc};

use agent_core::model::{
    AgentTurn, AppThreadId, ForkBoundary, ItemsView, SortDirection, ThreadTurnsResult, TurnStatus,
};
use agent_resources::ResourceProjection;

use super::{
    read::{ForkPoint, IndexedFile, ReadError, SessionContext, Settlement, ThreadFiles},
    source::Conversation,
};
use crate::{
    native::{
        fork_cut::{ForkCut, SessionCut},
        host_state::{HostStateCache, HostThreads},
    },
    store::{ClaudeStore, StoredSession, session_group},
    subagents::{self, ChildThread},
    transcript::{reconstruct::HistoryContext, segments::SegmentHints, turn_index::TurnRecord},
};

/// Reads of indexed Claude history.
pub struct IndexedHistory {
    store: Arc<ClaudeStore>,
    host: Arc<HostStateCache>,
}

/// Which snapshot of a running turn a page shows.
pub enum ActiveTurn<'a> {
    /// The one the thread's host state left (`active-turn.json`).
    Host,
    /// The live session's, placed with that session's turn index.
    Live {
        turn: Option<Box<AgentTurn>>,
        records: &'a [TurnRecord],
    },
}

/// One `thread.turns` request.
pub struct PageRequest<'a> {
    pub cursor: Option<&'a str>,
    pub limit: u32,
    pub direction: SortDirection,
    pub view: ItemsView,
}

impl IndexedHistory {
    #[must_use]
    pub fn new(store: Arc<ClaudeStore>, host: Arc<HostStateCache>) -> Self {
        Self { store, host }
    }

    /// The host thread state the reads use.
    #[must_use]
    pub fn host(&self) -> &Arc<HostStateCache> {
        &self.host
    }

    fn contexts(sessions: &[StoredSession], host: &HostThreads) -> Vec<SessionContext> {
        sessions
            .iter()
            .map(|stored| SessionContext::of(stored, host.owner_of(&stored.session.session_id)))
            .collect()
    }

    /// The snapshot of the turn the host left running in the thread's
    /// current session, when that session is indexed.
    fn active_turn(sessions: &[StoredSession], host: &HostThreads) -> Option<AgentTurn> {
        sessions.iter().rev().find_map(|stored| {
            host.owner_of(&stored.session.session_id)
                .filter(|owner| owner.is_current(&stored.session.session_id))
                .and_then(crate::native::host_state::HostThread::active_turn)
        })
    }

    /// One page of the thread's turns; `None` when no session of the
    /// thread is indexed.
    ///
    /// # Errors
    ///
    /// [`ReadError::Behind`] when a file changed since it was indexed;
    /// [`ReadError::InvalidParams`] for an unknown cursor.
    pub fn page(
        &self,
        thread: &AppThreadId,
        request: &PageRequest<'_>,
    ) -> Result<Option<ThreadTurnsResult>, ReadError> {
        self.page_with(thread, request, ActiveTurn::Host)
    }

    /// [`Self::page`] with the running turn's snapshot from `active`.
    ///
    /// # Errors
    ///
    /// As [`Self::page`].
    pub fn page_with(
        &self,
        thread: &AppThreadId,
        request: &PageRequest<'_>,
        active: ActiveTurn<'_>,
    ) -> Result<Option<ThreadTurnsResult>, ReadError> {
        let sessions = self.store.thread_sessions(thread)?;
        if sessions.is_empty() {
            return Ok(None);
        }
        let host = self.host.threads();
        let contexts = Self::contexts(&sessions, &host);
        let active = match active {
            ActiveTurn::Host => Self::active_turn(&sessions, &host).map(|turn| {
                (
                    turn,
                    contexts
                        .last()
                        .map_or(&[][..], |context| context.records.as_slice()),
                )
            }),
            ActiveTurn::Live { turn, records } => turn.map(|turn| (*turn, records)),
        };
        let Some(files) = ThreadFiles::open(&self.store, &sessions, &contexts, active)? else {
            return Ok(None);
        };
        files
            .page(
                request.cursor,
                request.limit,
                request.direction,
                request.view,
            )
            .map(Some)
    }

    fn with_files<T>(
        &self,
        thread: &AppThreadId,
        with: impl FnOnce(Option<&ThreadFiles<'_>>) -> Result<T, ReadError>,
    ) -> Result<T, ReadError> {
        let sessions = self.store.thread_sessions(thread)?;
        let host = self.host.threads();
        let contexts = Self::contexts(&sessions, &host);
        let files = ThreadFiles::open(&self.store, &sessions, &contexts, None)?;
        with(files.as_ref())
    }

    /// Whether a turn of the thread carries `turn_id`.
    ///
    /// # Errors
    ///
    /// Read failures.
    pub fn contains_turn(&self, thread: &AppThreadId, turn_id: &str) -> Result<bool, ReadError> {
        self.with_files(thread, |files| match files {
            Some(files) => Ok(files.contains(turn_id)?),
            None => Ok(false),
        })
    }

    /// Which sessions of `chain` (the thread's session ids, oldest first) a
    /// fork at `boundary` copies, and through which message: the boundary
    /// turn is found by its id and its last stored message read from its
    /// byte range alone.
    ///
    /// # Errors
    ///
    /// Read failures.
    pub fn fork_cut(
        &self,
        thread: &AppThreadId,
        chain: &[String],
        boundary: &ForkBoundary,
    ) -> Result<ForkCut, ReadError> {
        let (turn_id, through) = match boundary {
            ForkBoundary::All => {
                let Some((last, before)) = chain.split_last() else {
                    return Ok(ForkCut::NothingBefore);
                };
                return Ok(ForkCut::Cut {
                    whole: before.to_vec(),
                    last: SessionCut {
                        session_id: last.clone(),
                        up_to_message_id: None,
                    },
                });
            }
            ForkBoundary::Before { turn_id } => (turn_id, false),
            ForkBoundary::Through { turn_id } => (turn_id, true),
        };
        self.with_files(thread, |files| {
            let Some(files) = files else {
                return Ok(ForkCut::UnknownTurn);
            };
            Ok(match files.fork_point(turn_id.as_str(), through)? {
                ForkPoint::UnknownTurn => ForkCut::UnknownTurn,
                ForkPoint::NothingBefore => ForkCut::NothingBefore,
                ForkPoint::At {
                    session_id,
                    last_uuid,
                } => {
                    let Some(holder) = chain.iter().position(|id| id == session_id) else {
                        return Ok(ForkCut::UnknownTurn);
                    };
                    ForkCut::Cut {
                        whole: chain[..holder].to_vec(),
                        last: SessionCut {
                            session_id: session_id.to_owned(),
                            up_to_message_id: Some(last_uuid),
                        },
                    }
                }
            })
        })
    }

    /// The thread's most recent transcript lines (user prompts and final
    /// answers, `threads::history::history_lines`), newest pages first until
    /// they hold at least `bytes`, returned oldest first.
    ///
    /// # Errors
    ///
    /// Read failures.
    pub fn recent_lines(
        &self,
        thread: &AppThreadId,
        bytes: usize,
    ) -> Result<Vec<String>, ReadError> {
        let mut lines = Vec::new();
        let mut held = 0_usize;
        let mut cursor = None::<String>;
        loop {
            let Some(page) = self.page(
                thread,
                &PageRequest {
                    cursor: cursor.as_deref(),
                    limit: RECENT_PAGE,
                    direction: SortDirection::Desc,
                    view: ItemsView::Summary,
                },
            )?
            else {
                break;
            };
            for turn in &page.turns {
                let mut turn_lines =
                    crate::threads::history::history_lines(std::slice::from_ref(turn));
                held += turn_lines.iter().map(|line| line.len() + 1).sum::<usize>();
                turn_lines.reverse();
                lines.extend(turn_lines);
            }
            match page.next_cursor {
                Some(next) if held < bytes => cursor = Some(next),
                _ => break,
            }
        }
        lines.reverse();
        Ok(lines)
    }

    /// The `command` item that launched background task `task_id`, with its
    /// turn: the thread's turns newest first until it is found, at most
    /// [`LAUNCH_SEARCH_TURNS`] of them (a task is reported to the session
    /// that launched it, soon after a recent turn).
    ///
    /// # Errors
    ///
    /// Read failures.
    pub fn find_launch(
        &self,
        thread: &AppThreadId,
        task_id: &str,
    ) -> Result<Option<(agent_core::model::TurnId, agent_core::model::AgentItem)>, ReadError> {
        let mut cursor = None::<String>;
        let mut searched = 0_usize;
        while searched < LAUNCH_SEARCH_TURNS {
            let Some(page) = self.page(
                thread,
                &PageRequest {
                    cursor: cursor.as_deref(),
                    limit: RECENT_PAGE,
                    direction: SortDirection::Desc,
                    view: ItemsView::Full,
                },
            )?
            else {
                return Ok(None);
            };
            searched += page.turns.len();
            for turn in page.turns {
                let launch = turn.items.into_iter().find(|item| {
                    matches!(
                        item,
                        agent_core::model::AgentItem::Command {
                            background: Some(background),
                            ..
                        } if background.task_id == task_id
                    )
                });
                if let Some(item) = launch {
                    return Ok(Some((turn.turn_id, item)));
                }
            }
            match page.next_cursor {
                Some(next) => cursor = Some(next),
                None => return Ok(None),
            }
        }
        Ok(None)
    }

    /// The model the session's newest main-loop answer recorded, from the
    /// index's state at the session file's checkpoint.
    ///
    /// # Errors
    ///
    /// Index read failures.
    pub fn recorded_model(&self, session_id: &str) -> Result<Option<String>, ReadError> {
        let Some(stored) = self.store.session(session_id)? else {
            return Ok(None);
        };
        Ok(agent_index::checkpoint_state::<super::source::ScanState>(
            self.store.segments(),
            &agent_index::file_id(&stored.path),
        )?
        .and_then(|state| state.answer.map(|(model, _effort)| model)))
    }

    /// The thread's turns with these ids, each from the latest session that
    /// holds it; ids no turn carries are left out.
    ///
    /// # Errors
    ///
    /// Read failures.
    pub fn turns_by_id<'i>(
        &self,
        thread: &AppThreadId,
        ids: impl IntoIterator<Item = &'i str>,
    ) -> Result<Vec<AgentTurn>, ReadError> {
        let sessions = self.store.thread_sessions(thread)?;
        let host = self.host.threads();
        let contexts = Self::contexts(&sessions, &host);
        match ThreadFiles::open(&self.store, &sessions, &contexts, None)? {
            Some(files) => files.turns_by_id(ids),
            None => Ok(Vec::new()),
        }
    }

    /// One session read whole from the index, as `nativeSession.read`
    /// answered it (tests and the parity harness).
    #[cfg(test)]
    pub(crate) fn session_read(
        &self,
        stored: &StoredSession,
    ) -> Result<agent_core::model::NativeSessionReadResult, ReadError> {
        let host = self.host.threads();
        let sessions = std::slice::from_ref(stored);
        let contexts = Self::contexts(sessions, &host);
        let active = Self::active_turn(sessions, &host);
        let turns = match ThreadFiles::open(&self.store, sessions, &contexts, None)? {
            Some(files) => {
                let turns = files.all()?;
                match active {
                    Some(active) => {
                        let settled = Settlement::of(&self.store, stored)
                            .settle(vec![active])
                            .pop();
                        crate::native::with_active_turn(turns, settled, &contexts[0].records)
                    }
                    None => turns,
                }
            }
            None => Vec::new(),
        };
        let mut subagents = Vec::new();
        for subagent in &stored.subagents {
            let sidecar = stored
                .sidecars
                .iter()
                .find(|sidecar| sidecar.agent_id == subagent.agent_id);
            let turns = match self.sidecar_files(stored, &subagent.agent_id)? {
                Some(files) => files.all()?,
                None => Vec::new(),
            };
            subagents.push(agent_core::model::NativeSubagent {
                agent_id: subagent.agent_id.clone(),
                effort: subagent.effort.clone(),
                model: subagent.model.clone(),
                parent_agent_id: sidecar.and_then(|sidecar| sidecar.parent_agent_id.clone()),
                parent_tool_use_id: sidecar.and_then(|sidecar| sidecar.parent_tool_use_id.clone()),
                turns,
            });
        }
        Ok(agent_core::model::NativeSessionReadResult {
            session: stored.session.clone(),
            subagents,
            turns,
        })
    }

    /// The indexed child thread of a sub-agent (`<parent>:agent:<agent
    /// id>`); `None` for any other id, an unknown agent or a deleted parent.
    ///
    /// # Errors
    ///
    /// Read failures.
    pub fn child(&self, thread: &AppThreadId) -> Result<Option<ChildThread>, ReadError> {
        let Some((parent, agent_id)) = subagents::parse_child_thread_id(thread) else {
            return Ok(None);
        };
        let sessions = self.store.thread_sessions(&parent)?;
        let chain = sessions.iter().collect::<Vec<_>>();
        if crate::catalog::is_deleted(&chain) {
            return Ok(None);
        }
        let parent_settings = crate::catalog::thread_settings(&chain);
        for stored in &sessions {
            let Some(subagent) = stored
                .subagents
                .iter()
                .find(|subagent| subagent.agent_id == agent_id)
            else {
                continue;
            };
            let newest = self.sidecar_turns(stored, agent_id, SortDirection::Desc)?;
            let last = newest.as_ref().and_then(|turns| turns.first());
            return Ok(Some(ChildThread {
                thread_id: thread.clone(),
                parent,
                cwd: crate::store::thread_cwd(stored),
                subagent: subagent.clone(),
                preview: last
                    .and_then(|turn| crate::preview::newest_message(std::slice::from_ref(turn))),
                active_turn_id: last
                    .filter(|turn| turn.status == TurnStatus::InProgress)
                    .map(|turn| turn.turn_id.clone()),
                parent_settings,
            }));
        }
        Ok(None)
    }

    /// The newest (or oldest) turn of a sub-agent's transcript.
    fn sidecar_turns(
        &self,
        stored: &StoredSession,
        agent_id: &str,
        direction: SortDirection,
    ) -> Result<Option<Vec<AgentTurn>>, ReadError> {
        let Some(files) = self.sidecar_files(stored, agent_id)? else {
            return Ok(None);
        };
        Ok(Some(files.page(None, 1, direction, ItemsView::Full)?.turns))
    }

    fn sidecar_files<'a>(
        &'a self,
        stored: &'a StoredSession,
        agent_id: &str,
    ) -> Result<Option<ThreadFiles<'a>>, ReadError> {
        let Some(sidecar) = stored
            .sidecars
            .iter()
            .find(|sidecar| sidecar.agent_id == agent_id)
        else {
            return Ok(None);
        };
        let running = stored
            .subagents
            .iter()
            .any(|subagent| subagent.agent_id == agent_id && subagent.running);
        let Some(file) = IndexedFile::open(
            &self.store,
            &sidecar.path,
            Conversation::Sidecar,
            &SIDECAR_HINTS,
            &[],
            HistoryContext {
                app_thread_id: stored.session.app_thread_id.clone(),
                cwd: SessionContext::of(
                    stored,
                    self.host.threads().owner_of(&stored.session.session_id),
                )
                .context
                .cwd,
            },
            session_group(&stored.session.session_id),
            running,
        )?
        else {
            return Ok(None);
        };
        Ok(Some(ThreadFiles::single(
            file,
            Settlement::of(&self.store, stored),
        )))
    }

    /// One page of a child thread's turns.
    ///
    /// # Errors
    ///
    /// Read failures; [`ReadError::InvalidParams`] for an unknown cursor.
    pub fn child_page(
        &self,
        child: &ChildThread,
        request: &PageRequest<'_>,
    ) -> Result<ThreadTurnsResult, ReadError> {
        let sessions = self.store.thread_sessions(&child.parent)?;
        for stored in &sessions {
            if let Some(files) = self.sidecar_files(stored, &child.subagent.agent_id)? {
                return files.page(
                    request.cursor,
                    request.limit,
                    request.direction,
                    request.view,
                );
            }
        }
        Ok(ThreadTurnsResult {
            turns: Vec::new(),
            next_cursor: None,
        })
    }

    /// The thread's resource projection from its turn digests; `None` when
    /// no session of the thread is indexed.
    ///
    /// # Errors
    ///
    /// Index read failures.
    pub fn resources(
        &self,
        thread: &AppThreadId,
        live_cwd: Option<PathBuf>,
    ) -> Result<Option<ResourceProjection>, ReadError> {
        let sessions = self.store.thread_sessions(thread)?;
        if sessions.is_empty() {
            return Ok(None);
        }
        let cwd = sessions
            .iter()
            .rev()
            .find_map(|stored| stored.session.cwd.clone())
            .map(PathBuf::from)
            .filter(|cwd| cwd.is_absolute())
            .or(live_cwd);
        let mut projection = ResourceProjection {
            cwd,
            ..ResourceProjection::default()
        };
        let files = sessions
            .iter()
            .map(|stored| agent_index::file_id(&stored.path))
            .collect::<Vec<_>>();
        for (position, file_id) in files.iter().enumerate() {
            for turn in self.store.file_turns(file_id)? {
                // A later session's share of a turn wins.
                let hidden = files[position + 1..]
                    .iter()
                    .try_fold(false, |hidden, later| {
                        Ok::<_, ReadError>(
                            hidden
                                || self
                                    .store
                                    .segments()
                                    .index()
                                    .turn_by_id(later, &turn.id)?
                                    .is_some(),
                        )
                    })?;
                if hidden {
                    continue;
                }
                let Some(digest) = self
                    .store
                    .digest(file_id, turn.start_offset)?
                    .filter(|digest| digest.turn_id == turn.id && !digest.empty)
                else {
                    continue;
                };
                projection.started(&turn.id);
                if let (Some(data), Some(pending)) =
                    (digest.resources, projection.pending_for(&turn.id))
                {
                    *pending = data;
                }
                projection.completed(&turn.id);
            }
        }
        Ok(Some(projection))
    }
}

/// Turns per page while the newest transcript lines are gathered.
const RECENT_PAGE: u32 = 20;
/// The newest turns searched for the launch of a reported task.
const LAUNCH_SEARCH_TURNS: usize = 400;

static SIDECAR_HINTS: std::sync::LazyLock<SegmentHints> =
    std::sync::LazyLock::new(SegmentHints::default);
