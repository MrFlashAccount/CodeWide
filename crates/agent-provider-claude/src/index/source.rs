//! Claude's session files on the shared segmented index: where turns start
//! and end, which records later rows name, and the facts later rows report.
//!
//! A turn is a contiguous byte range of one file, started by the record
//! `transcript::segments::decide` starts a turn with (a person's prompt, a
//! wake, Claude's resume prompt, the first record the companion's turn index
//! names) and ended by the next start or by an interrupt marker. A turn
//! woken by task notifications before its first message starts at the first
//! of those wakes. Rows of no turn decision (metadata rows, hidden messages)
//! fall in the turn open around them; reading a turn replays its rows with
//! the same rule from the state it started in, so they never move a
//! boundary.
//!
//! A main conversation prompt that starts a turn and whose `parentUuid` is a
//! row stored before the newest answer or prompt returns to that row (a
//! rewind or an edited prompt): the turns after it are removed and its turn
//! ends after it, as Claude's own reader would show only the new branch.
//!
//! Facts are kept per session (its file and its sub-agent transcripts): the
//! newest status a task report, a queued report or a resuming `SendMessage`
//! records per sub-agent and spawning call, the first final state a report
//! records per background task, and which queued prompts a reply followed
//! (Claude delivered them into the running turn). Ids only, never content.

use std::{borrow::Cow, collections::HashMap, fmt::Write as _};

use agent_core::model::{BackgroundCommandState, SubagentStatus, TurnId, TurnOrigin};
use agent_index::{
    Observation, Record, RecordKeys, SegmentBoundary, SegmentSource, SegmentSourceError,
};
use serde::{Deserialize, Serialize};
use serde_json::Value;

use super::line::{Kind, Row};
use crate::transcript::{
    agents::{SubagentRuns, is_send_message_tool, resumed_agent_id},
    background_commands::BackgroundCommandRuns,
    chain::preserved,
    frames::{ClaudeFrame, classify_message},
    reconstruct::segment_hints,
    segments::{EntryKind, OpenView, SegmentHints, Step, decide},
    task_reports::TaskReport,
    turn_index::TurnRecord,
};

/// Which conversation a file holds.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum Conversation {
    /// A session file: its main conversation, with the companion's hints.
    Main,
    /// A sub-agent transcript: file order, no rewinds, no hints.
    Sidecar,
}

/// What the companion's turn index tells the index of one session (ids only).
#[derive(Debug, Default)]
pub struct SessionHints {
    pub segments: SegmentHints,
    /// Persisted message uuid → (position of its record, the record's turn id).
    anchors: HashMap<String, (usize, String)>,
}

impl SessionHints {
    #[must_use]
    pub fn new(records: &[TurnRecord]) -> Self {
        let mut anchors = HashMap::new();
        for (index, record) in records.iter().enumerate() {
            if TurnId::parse(&record.turn_id).is_none() {
                continue;
            }
            for anchor in &record.anchors {
                anchors
                    .entry(anchor.clone())
                    .or_insert_with(|| (index, record.turn_id.clone()));
            }
        }
        Self {
            segments: segment_hints(records),
            anchors,
        }
    }

    /// Every hint by the uuid it names, as one comparable value each: a
    /// change in any of them is a change in what that record means.
    #[must_use]
    pub fn by_uuid(&self) -> std::collections::BTreeMap<String, String> {
        let mut hints = std::collections::BTreeMap::<String, String>::new();
        for (uuid, origin) in &self.segments.starts {
            hints
                .entry(uuid.clone())
                .or_default()
                .push_str(match origin {
                    TurnOrigin::User => "start:user;",
                    TurnOrigin::Provider => "start:provider;",
                });
        }
        for uuid in &self.segments.continuations {
            hints
                .entry(uuid.clone())
                .or_default()
                .push_str("continuation;");
        }
        for (uuid, (index, turn_id)) in &self.anchors {
            let hint = hints.entry(uuid.clone()).or_default();
            // WHY: writing into a String cannot fail.
            let _ = write!(hint, "anchor:{index}:{turn_id};");
        }
        hints
    }
}

/// While wakes wait for their turn's first message: where that turn will
/// start and the state before it.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Pending {
    start_offset: u64,
    resume: ScanState,
}

/// A prompt Claude queued while no turn with messages was open: whether it
/// starts (or joins) a turn depends on whether Claude delivered it, which
/// the next reply or person's message shows (`chain::with_queued_prompts`).
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Deferred {
    kind: EntryKind,
    uuid: String,
    offset: u64,
    length: u32,
    /// The state before the attachment row.
    before: ScanState,
}

/// What the scan remembers between records of one file.
#[derive(Clone, Debug, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanState {
    /// A sidecar's conversation level, read from its first message.
    level: Level,
    pub(crate) open: OpenView,
    /// Position in the turn index of the record the open turn's id comes from.
    record: Option<usize>,
    pending: Option<Box<Pending>>,
    /// Offset of the newest entry of the main conversation.
    tip: Option<u64>,
    /// Offset of the newest user or assistant row of the main conversation.
    pub(crate) last_conversation: Option<u64>,
    /// The system row just before the next entry, if the row before it was one.
    pub(crate) previous_system: Option<String>,
    /// Rows the newest compaction preserved: a prompt continuing one of them
    /// continues the conversation.
    preserved: Vec<String>,
    /// `SendMessage` calls awaiting their result.
    send_messages: Vec<String>,
    /// Queued prompts awaiting the row that shows whether a reply followed.
    pub(crate) awaiting_reply: Vec<String>,
    /// Queued prompts whose turn waits for that row, oldest first.
    deferred: Vec<Deferred>,
    /// The newest main-loop answer of the file's conversation: model and effort.
    pub(crate) answer: Option<(String, Option<String>)>,
    /// A sidecar's newest row time.
    pub(crate) updated_at_ms: Option<i64>,
}

/// The conversation level a sidecar's rows are read at: the spawning tool
/// call its first message names (`reconstruct::subagent_parent`).
#[derive(Clone, Debug, Default, Deserialize, Serialize)]
#[serde(tag = "level", content = "parentToolUseId", rename_all = "camelCase")]
enum Level {
    /// No message read yet (and every main conversation).
    #[default]
    Unread,
    /// The first message named this spawning call, or none.
    Read(Option<String>),
}

impl ScanState {
    /// The conversation level a projection of this file reads.
    pub(crate) fn level(&self) -> Option<&str> {
        match &self.level {
            Level::Unread => None,
            Level::Read(level) => level.as_deref(),
        }
    }
}

/// Keys of facts, by what they are about.
pub(crate) mod fact_key {
    pub(crate) fn agent(agent_id: &str) -> Vec<u8> {
        [b"a/".as_slice(), agent_id.as_bytes()].concat()
    }

    pub(crate) fn spawn(tool_use_id: &str) -> Vec<u8> {
        [b"t/".as_slice(), tool_use_id.as_bytes()].concat()
    }

    pub(crate) fn task(task_id: &str) -> Vec<u8> {
        [b"b/".as_slice(), task_id.as_bytes()].concat()
    }

    pub(crate) fn delivered(attachment_uuid: &str) -> Vec<u8> {
        [b"q/".as_slice(), attachment_uuid.as_bytes()].concat()
    }
}

/// A timed fact: the time it was stored at, then its value.
pub(crate) fn timed<T: Serialize>(timestamp_ms: i64, value: &T) -> Vec<u8> {
    let mut encoded = timestamp_ms.to_be_bytes().to_vec();
    // WHY: serializing a plain enum into a vector cannot fail.
    if let Ok(value) = serde_json::to_vec(value) {
        encoded.extend(value);
    }
    encoded
}

/// The time and value of a timed fact; `None` for a malformed one.
pub(crate) fn untimed<T: for<'de> Deserialize<'de>>(encoded: &[u8]) -> Option<(i64, T)> {
    let (time, value) = encoded.split_at_checked(8)?;
    Some((
        i64::from_be_bytes(time.try_into().ok()?),
        serde_json::from_slice(value).ok()?,
    ))
}

fn time_of(encoded: &[u8]) -> Option<i64> {
    Some(i64::from_be_bytes(encoded.get(..8)?.try_into().ok()?))
}

/// The status facts one report records.
fn report_facts(report: &TaskReport, timestamp_ms: i64, facts: &mut Vec<(Vec<u8>, Vec<u8>)>) {
    let mut runs = SubagentRuns::default();
    runs.record(report, timestamp_ms);
    for (by_tool_use, key, time, status) in runs.facts() {
        let key = if by_tool_use {
            fact_key::spawn(key)
        } else {
            fact_key::agent(key)
        };
        facts.push((key, timed::<SubagentStatus>(time, &status)));
    }
    let mut commands = BackgroundCommandRuns::default();
    commands.record(report, timestamp_ms);
    for (task, state) in commands.ended() {
        facts.push((
            fact_key::task(task),
            timed::<BackgroundCommandState>(timestamp_ms, &state),
        ));
    }
}

/// One Claude file's format on the index.
pub struct ClaudeSource<'a> {
    conversation: Conversation,
    hints: &'a SessionHints,
}

impl<'a> ClaudeSource<'a> {
    #[must_use]
    pub const fn new(conversation: Conversation, hints: &'a SessionHints) -> Self {
        Self {
            conversation,
            hints,
        }
    }

    /// The id of a turn whose first entry is `uuid`: its turn index record's,
    /// else the uuid.
    fn turn_id(&self, uuid: &str) -> (String, Option<usize>) {
        match self.hints.anchors.get(uuid) {
            Some((index, turn_id)) => (turn_id.clone(), Some(*index)),
            None => (
                TurnId::parse(uuid).map_or_else(|| "turn".to_owned(), TurnId::into_string),
                None,
            ),
        }
    }

    fn start(
        &self,
        state: &mut ScanState,
        before: ScanState,
        uuid: &str,
        offset: u64,
    ) -> SegmentBoundary<ScanState> {
        let (start_offset, resume) = match state.pending.take() {
            Some(pending) => (pending.start_offset, pending.resume),
            None => (offset, before),
        };
        let (turn_id, record) = self.turn_id(uuid);
        state.record = record;
        SegmentBoundary::Started {
            turn_id,
            start_offset,
            resume,
        }
    }

    /// The boundaries of one entry.
    #[allow(clippy::too_many_arguments)] // One entry's context, read once.
    fn entry(
        &self,
        state: &mut ScanState,
        before: ScanState,
        kind: EntryKind,
        uuid: &str,
        parent: Option<&str>,
        record: Record<'_>,
        keys: &dyn RecordKeys,
    ) -> Result<Vec<SegmentBoundary<ScanState>>, SegmentSourceError> {
        let hints = match self.conversation {
            Conversation::Main => &self.hints.segments,
            Conversation::Sidecar => &EMPTY_HINTS,
        };
        let step = decide(&state.open, kind, uuid, hints);
        let mut boundaries = Vec::new();
        match step {
            Step::Start(_) => {
                if self.conversation == Conversation::Main
                    && matches!(kind, EntryKind::Prompt { .. } | EntryKind::Resume)
                    && let Some(parent) = parent
                    && !state.preserved.iter().any(|kept| kept == parent)
                    && let Some(span) =
                        keys.span(parent.as_bytes())
                            .map_err(|error| SegmentSourceError {
                                offset: record.offset,
                                reason: error.to_string(),
                            })?
                    && state.tip.is_some_and(|tip| span.offset < tip)
                {
                    boundaries.push(SegmentBoundary::RolledBackTo {
                        key: parent.as_bytes().to_vec(),
                    });
                    state.open = OpenView::None;
                    state.pending = None;
                }
                let before = if boundaries.is_empty() {
                    before
                } else {
                    state.clone()
                };
                boundaries.push(self.start(state, before, uuid, record.offset));
                state.open = OpenView::None.with_entry(kind, uuid, hints);
            }
            Step::Append(_) => match &state.open {
                OpenView::Turn { .. } => {
                    state.open = std::mem::take(&mut state.open).with_entry(kind, uuid, hints);
                    if let Some((index, turn_id)) = self.hints.anchors.get(uuid)
                        && self.conversation == Conversation::Main
                        && state.record.is_none_or(|current| *index < current)
                    {
                        state.record = Some(*index);
                        boundaries.push(SegmentBoundary::Renamed {
                            turn_id: turn_id.clone(),
                        });
                    }
                }
                OpenView::None | OpenView::Pending => {
                    boundaries.push(self.start(state, before, uuid, record.offset));
                    state.open = OpenView::None.with_entry(kind, uuid, hints);
                }
            },
            Step::MidTurnReport | Step::CollectWake => {}
            Step::NewPending => {
                state.pending = Some(Box::new(Pending {
                    start_offset: record.offset,
                    resume: before,
                }));
                state.open = OpenView::Pending;
                state.record = None;
            }
            Step::Interrupt => {
                match &state.open {
                    OpenView::Turn { .. } => {
                        boundaries.push(SegmentBoundary::Ended { completed: false });
                    }
                    OpenView::Pending => {
                        boundaries.push(self.start(state, before, uuid, record.offset));
                        boundaries.push(SegmentBoundary::Ended { completed: false });
                    }
                    OpenView::None => {}
                }
                state.open = OpenView::None;
                state.pending = None;
                state.record = None;
            }
        }
        if self.conversation == Conversation::Main {
            state.tip = Some(record.offset);
        }
        Ok(boundaries)
    }

    /// Facts every row may carry, whatever its level: stored task reports
    /// and queued ones, and the result of a resuming `SendMessage` call.
    fn facts(
        state: &mut ScanState,
        row: &Row<'_>,
        line: &[u8],
        facts: &mut Vec<(Vec<u8>, Vec<u8>)>,
    ) {
        let Some(timestamp_ms) = row.timestamp_ms() else {
            return;
        };
        for report in row.task_reports() {
            report_facts(&report, timestamp_ms, facts);
        }
        if let Some(queued) = row.queued() {
            for report in queued.task_reports() {
                report_facts(&report, timestamp_ms, facts);
            }
        }
        for (id, name) in row.tool_uses() {
            if is_send_message_tool(&name) {
                state.send_messages.push(id.into_owned());
            }
        }
        if state.send_messages.is_empty() {
            return;
        }
        let answered = row
            .tool_result_ids()
            .into_iter()
            .filter(|id| state.send_messages.iter().any(|call| call == id))
            .map(Cow::into_owned)
            .collect::<Vec<_>>();
        if answered.is_empty() {
            return;
        }
        state
            .send_messages
            .retain(|call| !answered.iter().any(|id| id == call));
        // A rare row: read whole to reuse the transcript's own rule.
        let Ok(Value::Object(value)) = serde_json::from_slice::<Value>(line) else {
            return;
        };
        let ClaudeFrame::User(user) = classify_message(&value) else {
            return;
        };
        for result in &user.tool_results {
            if answered.contains(&result.tool_use_id)
                && let Some(agent_id) = resumed_agent_id(result, &user.tool_use_result)
            {
                let mut runs = SubagentRuns::default();
                runs.record_resume(&result.tool_use_id, &agent_id, timestamp_ms);
                for (by_tool_use, key, time, status) in runs.facts() {
                    let key = if by_tool_use {
                        fact_key::spawn(key)
                    } else {
                        fact_key::agent(key)
                    };
                    facts.push((key, timed::<SubagentStatus>(time, &status)));
                }
            }
        }
    }

    fn observe_main(
        &self,
        state: &mut ScanState,
        row: &Row<'_>,
        record: Record<'_>,
        keys: &dyn RecordKeys,
        observation: &mut Observation<ScanState>,
    ) -> Result<(), SegmentSourceError> {
        if !row.is_main_level() {
            return Ok(());
        }
        let Some(uuid) = row.uuid() else {
            return Ok(());
        };
        observation.key = Some(uuid.as_bytes().to_vec());
        if let Some(answer) = row.recorded_answer() {
            state.answer = Some(answer);
        }
        // Whether Claude delivered the queued prompts before this row.
        if row.kind().as_deref() == Some("assistant") || row.is_tool_result() {
            for queued in state.awaiting_reply.drain(..) {
                observation
                    .facts
                    .push((fact_key::delivered(&queued), vec![1]));
            }
            // Delivered: each takes the place in the turns it was stored at.
            for deferred in std::mem::take(&mut state.deferred) {
                let boundaries = self.entry(
                    state,
                    deferred.before,
                    deferred.kind,
                    &deferred.uuid,
                    None,
                    Record {
                        line: &[],
                        offset: deferred.offset,
                        length: deferred.length,
                    },
                    keys,
                )?;
                observation.boundaries.extend(boundaries);
                state.previous_system = None;
            }
        } else if row.is_plain_user() {
            // Not delivered: Claude sent the person's message instead.
            state.awaiting_reply.clear();
            state.deferred.clear();
        }
        if row.is_conversation() {
            state.last_conversation = Some(record.offset);
        }
        let before = state.clone();
        if let Some(queued) = row.queued() {
            let Some(kind) = queued.entry() else {
                return Ok(());
            };
            if row.timestamp_ms().is_none() {
                return Ok(());
            }
            let source = queued.source_uuid();
            let entry_uuid = source.clone().unwrap_or_else(|| uuid.clone());
            // A prompt stored as its own message is not repeated.
            if source.is_some_and(|source| {
                source != uuid && keys.span(source.as_bytes()).ok().flatten().is_some()
            }) {
                return Ok(());
            }
            if matches!(state.open, OpenView::None | OpenView::Pending)
                && !matches!(kind, EntryKind::Wake { .. })
            {
                // Whether it starts a turn waits for the next reply.
                state.deferred.push(Deferred {
                    kind,
                    uuid: entry_uuid.into_owned(),
                    offset: record.offset,
                    length: record.length,
                    before,
                });
                state.awaiting_reply.push(uuid.into_owned());
                return Ok(());
            }
            state.awaiting_reply.push(uuid.into_owned());
            let boundaries = self.entry(state, before, kind, &entry_uuid, None, record, keys)?;
            observation.boundaries.extend(boundaries);
            state.previous_system = None;
            return Ok(());
        }
        if row.is_compact_boundary()
            && let Ok(Value::Object(value)) = serde_json::from_slice::<Value>(record.line)
        {
            state.preserved = preserved(&value)
                .map(|(uuids, _anchor)| uuids.into_iter().map(ToOwned::to_owned).collect())
                .unwrap_or_default();
        }
        self.observe_level(state, before, row, &uuid, None, record, keys, observation)
    }

    #[allow(clippy::too_many_arguments)] // One row's context, read once.
    fn observe_level(
        &self,
        state: &mut ScanState,
        before: ScanState,
        row: &Row<'_>,
        uuid: &str,
        level: Option<&str>,
        record: Record<'_>,
        keys: &dyn RecordKeys,
        observation: &mut Observation<ScanState>,
    ) -> Result<(), SegmentSourceError> {
        match row.classify(level) {
            Kind::Entry(kind) => {
                let uuid = if kind == EntryKind::Compaction {
                    state
                        .previous_system
                        .clone()
                        .unwrap_or_else(|| uuid.to_owned())
                } else {
                    uuid.to_owned()
                };
                let parent = row.parent_uuid();
                let boundaries =
                    self.entry(state, before, kind, &uuid, parent.as_deref(), record, keys)?;
                observation.boundaries.extend(boundaries);
                state.previous_system = None;
            }
            Kind::System => state.previous_system = Some(uuid.to_owned()),
            Kind::Other => {
                // Only the level's stored messages move the compaction's
                // system row (`entries::history_entries`).
                if row.level().as_deref() == level
                    && row.timestamp_ms().is_some()
                    && matches!(row.kind().as_deref(), Some("user" | "assistant"))
                {
                    state.previous_system = None;
                }
            }
        }
        Ok(())
    }

    fn observe_sidecar(
        &self,
        state: &mut ScanState,
        row: &Row<'_>,
        record: Record<'_>,
        keys: &dyn RecordKeys,
        observation: &mut Observation<ScanState>,
    ) -> Result<(), SegmentSourceError> {
        if let Some(time) = row.timestamp_ms() {
            state.updated_at_ms = Some(state.updated_at_ms.map_or(time, |newest| newest.max(time)));
        }
        if let Some(answer) = row.recorded_answer() {
            state.answer = Some(answer);
        }
        if !matches!(row.kind().as_deref(), Some("user" | "assistant" | "system")) {
            return Ok(());
        }
        let Some(uuid) = row.uuid() else {
            return Ok(());
        };
        if matches!(state.level, Level::Unread) {
            state.level = Level::Read(row.level().map(Cow::into_owned));
        }
        let level = state.level().map(ToOwned::to_owned);
        let before = state.clone();
        self.observe_level(
            state,
            before,
            row,
            &uuid,
            level.as_deref(),
            record,
            keys,
            observation,
        )
    }
}

static EMPTY_HINTS: std::sync::LazyLock<SegmentHints> =
    std::sync::LazyLock::new(SegmentHints::default);

impl SegmentSource for ClaudeSource<'_> {
    type State = ScanState;

    fn observe(
        &self,
        state: &mut ScanState,
        record: Record<'_>,
        keys: &dyn RecordKeys,
    ) -> Result<Observation<ScanState>, SegmentSourceError> {
        let mut observation = Observation::default();
        // A malformed row is skipped, as Claude's own reader skips it.
        let Some(row) = Row::parse(record.line) else {
            return Ok(observation);
        };
        Self::facts(state, &row, record.line, &mut observation.facts);
        match self.conversation {
            Conversation::Main => self.observe_main(state, &row, record, keys, &mut observation)?,
            Conversation::Sidecar => {
                self.observe_sidecar(state, &row, record, keys, &mut observation)?;
            }
        }
        Ok(observation)
    }

    fn merge_fact(&self, key: &[u8], recorded: &[u8], observed: &[u8]) -> Vec<u8> {
        match key.get(..2) {
            // The newest status wins; of two at one time, the later stored.
            Some(b"a/" | b"t/") => {
                if time_of(observed) >= time_of(recorded) {
                    observed.to_vec()
                } else {
                    recorded.to_vec()
                }
            }
            // The first final state wins.
            Some(b"b/") => {
                if time_of(observed) < time_of(recorded) {
                    observed.to_vec()
                } else {
                    recorded.to_vec()
                }
            }
            _ => recorded.to_vec(),
        }
    }
}
