//! Turns read from the index: each one from its byte range of Claude's file,
//! settled with the facts its session recorded and the process activity the
//! index last saw. A page reads its own turns' ranges and nothing else.

use std::{collections::HashSet, fs::File, path::Path};

use agent_core::model::{
    AgentItem, AgentTurn, BackgroundCommandState, ItemsView, SortDirection, SubagentStatus,
    ThreadTurnsResult,
    turns::{MAX_TURNS_PAGE, view_items},
};
use agent_index::{FileState, TurnRef, checkpoint_state, current_checkpoint, turn_resume_state};
use companion_host::index::StoreError;

use super::{
    project::{TurnRead, read_turn, read_turn_end},
    source::{Conversation, ScanState, SessionHints, fact_key, untimed},
};
use crate::{
    native::host_state::HostThread,
    runtime::{open_elsewhere::SessionActivity, running_sessions::RunningProcess},
    store::{ClaudeStore, StoredSession, session_group},
    transcript::{
        agents::{SubagentItem, SubagentRuns, agent_id_of},
        background_commands::{BackgroundCommandRuns, settle_background_commands},
        reconstruct::{
            HistoryContext, settle_named_orphaned_subagent_items, settle_orphaned_subagent_items,
            settle_subagent_items, with_cut_off_last_turn_interrupted,
        },
        segments::SegmentHints,
        turn_index::TurnRecord,
    },
};

/// Why indexed turns cannot be read.
#[derive(Debug, thiserror::Error)]
pub enum ReadError {
    #[error(transparent)]
    Store(#[from] StoreError),
    #[error(transparent)]
    Io(#[from] std::io::Error),
    #[error(transparent)]
    Index(#[from] agent_index::IndexError),
    /// The file changed since it was indexed: the index is behind.
    #[error("Claude session file changed since it was indexed")]
    Behind,
    #[error("{0}")]
    InvalidParams(&'static str),
}

const INVALID_TURNS_CURSOR: &str = "invalid turns cursor";

/// One indexed file opened for reads at its checkpoint.
pub(crate) struct IndexedFile<'a> {
    store: &'a ClaudeStore,
    file: File,
    file_id: [u8; 32],
    checkpoint: FileState,
    state: ScanState,
    conversation: Conversation,
    hints: &'a SegmentHints,
    records: &'a [TurnRecord],
    context: HistoryContext,
    group: [u8; 32],
    /// A sub-agent whose last turn still runs.
    running: bool,
}

impl<'a> IndexedFile<'a> {
    /// Opens `path` when its checkpoint still describes its bytes; `None`
    /// for a file the index does not know.
    ///
    /// # Errors
    ///
    /// [`ReadError::Behind`] for a file that changed since it was indexed.
    #[allow(clippy::too_many_arguments)] // One file's read context, assembled once.
    pub(crate) fn open(
        store: &'a ClaudeStore,
        path: &Path,
        conversation: Conversation,
        hints: &'a SegmentHints,
        records: &'a [TurnRecord],
        context: HistoryContext,
        group: [u8; 32],
        running: bool,
    ) -> Result<Option<Self>, ReadError> {
        let file_id = agent_index::file_id(path);
        if store.segments().index().file_state(&file_id)?.is_none() {
            return Ok(None);
        }
        let file = File::open(path)?;
        let checkpoint =
            current_checkpoint(store.segments(), path, &file)?.ok_or(ReadError::Behind)?;
        let state = checkpoint_state::<ScanState>(store.segments(), &file_id)?.unwrap_or_default();
        Ok(Some(Self {
            store,
            file,
            file_id,
            checkpoint,
            state,
            conversation,
            hints,
            records,
            context,
            group,
            running,
        }))
    }

    pub(crate) const fn file_id(&self) -> &[u8; 32] {
        &self.file_id
    }

    /// Where an indexed turn ends: its end, or the checkpoint for the open one.
    pub(crate) const fn end_of(&self, turn: &TurnRef) -> u64 {
        if turn.end_offset == 0 {
            self.checkpoint.indexed_bytes
        } else {
            turn.end_offset
        }
    }

    fn is_last(&self, turn: &TurnRef) -> Result<bool, StoreError> {
        Ok(self
            .store
            .segments()
            .index()
            .turns_asc_after(&self.file_id, turn.start_offset, 1)?
            .is_empty())
    }

    /// Calls `with` with what reading `turn` needs.
    fn with_read<T>(
        &self,
        turn: &TurnRef,
        with: impl FnOnce(&TurnRead<'_>, bool) -> std::io::Result<T>,
    ) -> Result<T, ReadError> {
        let resume = turn_resume_state::<ScanState>(
            self.store.segments(),
            &self.file_id,
            turn.start_offset,
        )?
        .unwrap_or_default();
        let last = self.is_last(turn)?;
        let delivered = |uuid: &str, offset: u64| {
            self.store
                .segments()
                .fact(&self.group, &fact_key::delivered(uuid))
                .ok()
                .flatten()
                .is_some()
                // Queued after the last message: delivered to the turn that
                // has not answered yet (`chain::trailing_queued`).
                || (last
                    && self.state.awaiting_reply.iter().any(|queued| queued == uuid)
                    && self
                        .state
                        .last_conversation
                        .is_none_or(|newest| offset > newest))
        };
        let stored = |uuid: &str| {
            self.store
                .segments()
                .record_span(&self.file_id, uuid.as_bytes())
                .ok()
                .flatten()
                .is_some()
        };
        let read = TurnRead {
            conversation: self.conversation,
            resume,
            hints: self.hints,
            records: self.records,
            context: &self.context,
            delivered: &delivered,
            stored: &stored,
            running: self.running && last,
        };
        Ok(with(&read, last)?)
    }

    /// The turn as stored; `None` when its rows hold no entry.
    ///
    /// # Errors
    ///
    /// Returns an error when the file or the index cannot be read.
    pub(crate) fn read(&self, turn: &TurnRef) -> Result<Option<AgentTurn>, ReadError> {
        let end = self.end_of(turn);
        self.with_read(turn, |read, last| {
            let projected = read_turn(&self.file, turn.start_offset, end, read)?;
            Ok(
                if self.conversation == Conversation::Sidecar && last && !read.running {
                    projected
                        .map(|turn| with_cut_off_last_turn_interrupted(vec![turn]))
                        .and_then(|mut turns| turns.pop())
                } else {
                    projected
                },
            )
        })
    }

    /// The uuid of the turn's last stored message.
    ///
    /// # Errors
    ///
    /// Returns an error when the file or the index cannot be read.
    pub(crate) fn last_uuid(&self, turn: &TurnRef) -> Result<Option<String>, ReadError> {
        let end = self.end_of(turn);
        self.with_read(turn, |read, _last| {
            read_turn_end(&self.file, turn.start_offset, end, read)
        })
    }
}

/// The settlement of a session's items: the facts its files recorded and
/// the process activity the index saw.
pub(crate) struct Settlement<'a> {
    pub store: &'a ClaudeStore,
    pub group: [u8; 32],
    pub activity: SessionActivity,
    /// Sub-agents whose transcripts only an earlier process generation wrote.
    pub orphaned: HashSet<String>,
}

impl<'a> Settlement<'a> {
    pub(crate) fn of(store: &'a ClaudeStore, stored: &StoredSession) -> Self {
        let orphaned = match stored.activity {
            SessionActivity::Running(RunningProcess::StartedAt(started_at_ms)) => stored
                .sidecars
                .iter()
                .filter(|sidecar| {
                    sidecar
                        .updated_at_ms
                        .is_some_and(|updated| updated < started_at_ms)
                })
                .map(|sidecar| sidecar.agent_id.clone())
                .collect(),
            SessionActivity::Running(RunningProcess::StartUnknown) | SessionActivity::Stopped => {
                HashSet::new()
            }
        };
        Self {
            store,
            group: session_group(&stored.session.session_id),
            activity: stored.activity,
            orphaned,
        }
    }

    fn subagent_status(&self, by_tool_use: bool, key: &str, runs: &mut SubagentRuns) {
        let fact = if by_tool_use {
            fact_key::spawn(key)
        } else {
            fact_key::agent(key)
        };
        if let Ok(Some(encoded)) = self.store.segments().fact(&self.group, &fact)
            && let Some((time, status)) = untimed::<SubagentStatus>(&encoded)
        {
            runs.insert(by_tool_use, key, time, status);
        }
    }

    /// The status a spawning item carries once settled.
    pub(crate) fn spawn_status(
        &self,
        item_id: &str,
        agent_id: Option<&str>,
        status: SubagentStatus,
    ) -> SubagentStatus {
        let mut runs = SubagentRuns::default();
        self.subagent_status(true, item_id, &mut runs);
        if let Some(agent_id) = agent_id {
            self.subagent_status(false, agent_id, &mut runs);
        }
        let settled = runs.status_of(agent_id, item_id, status);
        if settled != SubagentStatus::Running {
            return settled;
        }
        match self.activity {
            SessionActivity::Stopped => SubagentStatus::Stopped,
            SessionActivity::Running(_)
                if agent_id.is_some_and(|agent_id| self.orphaned.contains(agent_id)) =>
            {
                SubagentStatus::Stopped
            }
            SessionActivity::Running(_) => SubagentStatus::Running,
        }
    }

    /// The turns with every sub-agent and background command item settled.
    pub(crate) fn settle(&self, turns: Vec<AgentTurn>) -> Vec<AgentTurn> {
        let mut runs = SubagentRuns::default();
        let mut commands = BackgroundCommandRuns::default();
        for item in turns.iter().flat_map(|turn| turn.items.iter()) {
            if let Some(subagent) = SubagentItem::from_item(item) {
                self.subagent_status(true, subagent.item_id.as_str(), &mut runs);
                if let Some(agent_id) = subagent.agent_thread_id.as_ref().and_then(agent_id_of) {
                    self.subagent_status(false, agent_id, &mut runs);
                }
            }
            if let AgentItem::Command {
                background: Some(background),
                ..
            } = item
                && let Ok(Some(encoded)) = self
                    .store
                    .segments()
                    .fact(&self.group, &fact_key::task(&background.task_id))
                && let Some((_time, state)) = untimed::<BackgroundCommandState>(&encoded)
            {
                commands.insert(&background.task_id, state);
            }
        }
        let turns = settle_background_commands(settle_subagent_items(turns, &runs), &commands);
        match self.activity {
            SessionActivity::Stopped => settle_orphaned_subagent_items(turns),
            SessionActivity::Running(_) => {
                settle_named_orphaned_subagent_items(turns, &self.orphaned)
            }
        }
    }
}

/// What reading a session's main file needs from the host.
pub(crate) struct SessionContext {
    pub hints: SessionHints,
    pub records: Vec<TurnRecord>,
    pub context: HistoryContext,
}

impl SessionContext {
    pub(crate) fn of(stored: &StoredSession, owner: Option<&HostThread>) -> Self {
        let records = owner.map(|owner| owner.turns.clone()).unwrap_or_default();
        Self {
            hints: SessionHints::new(&records),
            records,
            context: HistoryContext {
                app_thread_id: stored.session.app_thread_id.clone(),
                cwd: owner.map_or_else(
                    || stored.session.cwd.clone().unwrap_or_default(),
                    |owner| owner.cwd.clone(),
                ),
            },
        }
    }
}

/// Where a fork cuts a thread.
pub(crate) enum ForkPoint<'a> {
    /// No turn of the thread carries the boundary's id.
    UnknownTurn,
    /// No turn comes before the boundary.
    NothingBefore,
    /// The last kept turn lies in `session_id` and ends with `last_uuid`.
    At {
        session_id: &'a str,
        last_uuid: String,
    },
}

/// A place in a thread's history: a session (by position) and a turn start.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
struct Position {
    session: usize,
    start_offset: u64,
}

/// The main files of a thread's sessions, oldest first, open at their
/// checkpoints.
pub(crate) struct ThreadFiles<'a> {
    /// The session of each file.
    session_ids: Vec<&'a str>,
    files: Vec<IndexedFile<'a>>,
    settlements: Vec<Settlement<'a>>,
    /// The snapshot of the turn the host left running in the thread's
    /// current session, with the turn index it belongs to.
    active: Option<(AgentTurn, &'a [TurnRecord])>,
}

impl<'a> ThreadFiles<'a> {
    /// Opens every session file of a thread; `None` when one is not indexed.
    ///
    /// # Errors
    ///
    /// [`ReadError::Behind`] when a file changed since it was indexed.
    pub(crate) fn open(
        store: &'a ClaudeStore,
        sessions: &'a [StoredSession],
        contexts: &'a [SessionContext],
        active: Option<(AgentTurn, &'a [TurnRecord])>,
    ) -> Result<Option<Self>, ReadError> {
        let mut files = Vec::with_capacity(sessions.len());
        let mut settlements = Vec::with_capacity(sessions.len());
        for (stored, context) in sessions.iter().zip(contexts) {
            let Some(file) = IndexedFile::open(
                store,
                &stored.path,
                Conversation::Main,
                &context.hints.segments,
                &context.records,
                context.context.clone(),
                session_group(&stored.session.session_id),
                false,
            )?
            else {
                return Ok(None);
            };
            files.push(file);
            settlements.push(Settlement::of(store, stored));
        }
        Ok(Some(Self {
            session_ids: sessions
                .iter()
                .map(|stored| stored.session.session_id.as_str())
                .collect(),
            files,
            settlements,
            active,
        }))
    }

    /// One file read alone (a sub-agent transcript).
    pub(crate) fn single(file: IndexedFile<'a>, settlement: Settlement<'a>) -> Self {
        Self {
            session_ids: Vec::new(),
            files: vec![file],
            settlements: vec![settlement],
            active: None,
        }
    }

    /// Whether a later session holds a turn with this id: the later share wins.
    fn hidden(&self, session: usize, turn_id: &str) -> Result<bool, StoreError> {
        for file in &self.files[session + 1..] {
            if file
                .store
                .segments()
                .index()
                .turn_by_id(file.file_id(), turn_id)?
                .is_some()
            {
                return Ok(true);
            }
        }
        Ok(false)
    }

    /// The turn with id `turn_id`, from the latest session holding it.
    fn find(&self, turn_id: &str) -> Result<Option<(Position, TurnRef)>, StoreError> {
        for (session, file) in self.files.iter().enumerate().rev() {
            if let Some(turn) = file
                .store
                .segments()
                .index()
                .turn_by_id(file.file_id(), turn_id)?
            {
                return Ok(Some((
                    Position {
                        session,
                        start_offset: turn.start_offset,
                    },
                    turn,
                )));
            }
        }
        Ok(None)
    }

    /// Up to `limit` turn refs after (or before, descending) `from`, with
    /// the session each lies in; turns a later session holds are skipped.
    fn refs(
        &self,
        from: Option<Position>,
        direction: SortDirection,
        limit: usize,
    ) -> Result<Vec<(usize, TurnRef)>, StoreError> {
        let mut found = Vec::new();
        let count = self.files.len();
        let order: Vec<usize> = match direction {
            SortDirection::Asc => (from.map_or(0, |from| from.session)..count).collect(),
            SortDirection::Desc => (0..=from.map_or(count.saturating_sub(1), |from| from.session))
                .rev()
                .collect(),
        };
        if count == 0 {
            return Ok(found);
        }
        for session in order {
            let index = self.files[session].store.segments().index();
            let file_id = self.files[session].file_id();
            let within = from.filter(|from| from.session == session);
            let mut cursor = within.map(|from| from.start_offset);
            loop {
                let batch = match (direction, cursor) {
                    (SortDirection::Asc, None) => index.turns_asc_from(file_id, 0, limit)?,
                    (SortDirection::Asc, Some(after)) => {
                        index.turns_asc_after(file_id, after, limit)?
                    }
                    (SortDirection::Desc, before) => index.turns_desc(file_id, before, limit)?,
                };
                let Some(next) = batch.last().map(|turn| turn.start_offset) else {
                    break;
                };
                cursor = Some(next);
                for turn in batch {
                    if !self.hidden(session, &turn.id)? {
                        found.push((session, turn));
                        if found.len() == limit {
                            return Ok(found);
                        }
                    }
                }
            }
        }
        Ok(found)
    }

    fn read(&self, session: usize, turn: &TurnRef) -> Result<Option<AgentTurn>, ReadError> {
        let Some(read) = self.files[session].read(turn)? else {
            return Ok(None);
        };
        Ok(self.settlements[session].settle(vec![read]).pop())
    }

    /// One `thread.turns` page.
    ///
    /// # Errors
    ///
    /// [`ReadError::InvalidParams`] for an unknown cursor; read failures.
    pub(crate) fn page(
        &self,
        cursor: Option<&str>,
        limit: u32,
        direction: SortDirection,
        view: ItemsView,
    ) -> Result<ThreadTurnsResult, ReadError> {
        let size = usize::try_from(limit)
            .unwrap_or(MAX_TURNS_PAGE)
            .clamp(1, MAX_TURNS_PAGE);
        let mut from = match cursor {
            None => None,
            Some(cursor) => Some(
                self.find(cursor)?
                    .ok_or(ReadError::InvalidParams(INVALID_TURNS_CURSOR))?
                    .0,
            ),
        };
        let mut turns = Vec::with_capacity(size + 1);
        // One more than the page, to know whether another follows.
        while turns.len() <= size {
            let refs = self.refs(from, direction, size + 1 - turns.len())?;
            let Some((session, last)) = refs
                .last()
                .map(|(session, turn)| (*session, turn.start_offset))
            else {
                break;
            };
            from = Some(Position {
                session,
                start_offset: last,
            });
            for (session, turn) in refs {
                if let Some(read) = self.read(session, &turn)? {
                    turns.push((session, read));
                }
            }
        }
        let has_more = turns.len() > size;
        turns.truncate(size);
        let mut turns = turns.into_iter().map(|(_, turn)| turn).collect::<Vec<_>>();
        let includes_newest = match direction {
            SortDirection::Asc => !has_more,
            SortDirection::Desc => cursor.is_none(),
        };
        if includes_newest && let Some((active, records)) = &self.active {
            let active = match self.settlements.last() {
                Some(settlement) => settlement.settle(vec![active.clone()]).pop(),
                None => Some(active.clone()),
            };
            if let Some(active) = active {
                turns = with_active_in_page(turns, active, direction, records);
                turns.truncate(size);
            }
        }
        let next_cursor = turns
            .last()
            .filter(|_| has_more)
            .map(|turn| turn.turn_id.as_str().to_owned());
        Ok(ThreadTurnsResult {
            turns: turns.iter().map(|turn| view_items(turn, view)).collect(),
            next_cursor,
        })
    }

    /// Whether a turn of the thread carries `turn_id`.
    ///
    /// # Errors
    ///
    /// Index read failures.
    pub(crate) fn contains(&self, turn_id: &str) -> Result<bool, StoreError> {
        Ok(self.find(turn_id)?.is_some())
    }

    /// Where a fork through (or before) `turn_id` cuts the thread.
    ///
    /// # Errors
    ///
    /// Read failures.
    pub(crate) fn fork_point(
        &self,
        turn_id: &str,
        through: bool,
    ) -> Result<ForkPoint<'a>, ReadError> {
        let Some((position, turn)) = self.find(turn_id)? else {
            return Ok(ForkPoint::UnknownTurn);
        };
        let mut from = Some(position);
        let mut candidate = through.then_some((position.session, turn));
        loop {
            let (session, turn) = match candidate.take() {
                Some(found) => found,
                None => match self.refs(from, SortDirection::Desc, 1)?.pop() {
                    Some(found) => found,
                    None => return Ok(ForkPoint::NothingBefore),
                },
            };
            from = Some(Position {
                session,
                start_offset: turn.start_offset,
            });
            // A turn whose rows show nothing is no turn: the cut is the one before.
            if let Some(last) = self.files[session].last_uuid(&turn)? {
                return Ok(match self.session_ids.get(session) {
                    Some(session_id) => ForkPoint::At {
                        session_id,
                        last_uuid: last,
                    },
                    None => ForkPoint::UnknownTurn,
                });
            }
        }
    }

    /// The turns with these ids, from the latest session holding each.
    ///
    /// # Errors
    ///
    /// Read failures.
    pub(crate) fn turns_by_id<'i>(
        &self,
        ids: impl IntoIterator<Item = &'i str>,
    ) -> Result<Vec<AgentTurn>, ReadError> {
        let mut turns = Vec::new();
        for id in ids {
            if let Some((position, turn)) = self.find(id)?
                && let Some(read) = self.read(position.session, &turn)?
            {
                turns.push(read);
            }
        }
        Ok(turns)
    }

    /// Every turn, oldest first (tests and the parity harness).
    #[cfg(test)]
    pub(crate) fn all(&self) -> Result<Vec<AgentTurn>, ReadError> {
        let mut turns = Vec::new();
        for (session, turn) in self.refs(None, SortDirection::Asc, usize::MAX)? {
            if let Some(read) = self.read(session, &turn)? {
                turns.push(read);
            }
        }
        Ok(turns)
    }
}

/// A page that holds the newest turns with the running turn's snapshot in
/// place (`native::with_active_turn`), in the page's order.
fn with_active_in_page(
    turns: Vec<AgentTurn>,
    active: AgentTurn,
    direction: SortDirection,
    records: &[TurnRecord],
) -> Vec<AgentTurn> {
    match direction {
        SortDirection::Asc => crate::native::with_active_turn(turns, Some(active), records),
        SortDirection::Desc => {
            let mut ascending = turns;
            ascending.reverse();
            let mut placed = crate::native::with_active_turn(ascending, Some(active), records);
            placed.reverse();
            placed
        }
    }
}
