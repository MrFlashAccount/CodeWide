//! Thread history from Claude's own session store, mapped to the same
//! neutral turns and items the live path emits.
//!
//! Each derived turn segment is replayed through the live `TurnBuilder`, so
//! item ids (`{message.id}:{block}`, `tool_use.id`, `{turnId}:user:{n}`,
//! `{turnId}:notification:{n}`), item types, ordering and the final-answer
//! rule are identical to live. A segment's background task reports are
//! replayed before the entry they precede. The
//! turn index adds what the store lacks: turn ids and origins of
//! companion-driven turns, their outcomes (failed, interrupted) and the
//! `clientMessageId` of each prompt. A turn the companion did not drive (for
//! example, typed in a terminal) gets the uuid of its first message as id.
//!
//! Known losses compared with live: reasoning text (the store keeps only
//! thinking signatures), Bash stdout/stderr split and exit details (the
//! `tool_result` text is used), file diffs (rebuilt from Edit/Write input
//! instead of the applied patch), sub-agent internals and tool durations
//! other than `tool_use` → `tool_result` timestamps. Pure; no I/O.

use std::collections::{HashMap, HashSet};

use agent_core::model::{
    AgentItem, AgentTurn, AppThreadId, ClientMessageId, MessagePhase, SubagentStatus, TurnId,
    TurnOrigin, TurnStatus, UserContent,
};

use super::{
    agents::{SubagentItem, SubagentRuns, is_send_message_tool, resumed_agent_id, with_status},
    builder::{TurnBuilder, TurnBuilderContext, UserMessage},
    entries::{HistoryEntry, history_entries},
    frames::{AssistantBlock, ClaudeFrame},
    json::{JsonRecord, record_of as json_record, str_of},
    result::TurnOutcome,
    segments::{HistorySegment, SegmentHints, SegmentReport, history_segments},
    task_notifications::reported_identity,
    task_reports::stored_task_reports,
    turn_index::{PromptRole, TurnOutcomeRecord, TurnRecord},
};

/// Tool results Claude or the companion wrote for a call the user or a profile refused.
const DECLINED_RESULT_PREFIXES: [&str; 4] = [
    "The user doesn't want to proceed with this tool use",
    super::DECLINE_MESSAGE,
    super::CANCEL_MESSAGE,
    super::READ_ONLY_DENY_PREFIX,
];

#[derive(Clone, Debug)]
pub struct HistoryContext {
    pub app_thread_id: AppThreadId,
    pub cwd: String,
}

fn segment_hints(records: &[TurnRecord]) -> SegmentHints {
    let mut hints = SegmentHints::default();
    for record in records {
        if let Some(start) = record.start_anchor() {
            hints.starts.insert(start.to_owned(), record.origin);
        }
        for prompt in &record.prompts {
            if prompt.role != PromptRole::First
                && let Some(uuid) = &prompt.uuid
            {
                hints.continuations.insert(uuid.clone());
            }
        }
    }
    hints
}

fn record_of<'a>(segment: &HistorySegment, records: &'a [TurnRecord]) -> Option<&'a TurnRecord> {
    let uuids = segment
        .entries
        .iter()
        .map(HistoryEntry::uuid)
        .collect::<HashSet<_>>();
    records.iter().find(|record| {
        record
            .anchors
            .iter()
            .any(|anchor| uuids.contains(anchor.as_str()))
    })
}

fn outcome_of(segment: &HistorySegment, record: Option<&TurnRecord>) -> TurnOutcome {
    match record.map(|record| &record.outcome) {
        None | Some(TurnOutcomeRecord::InProgress) => {
            if segment.interrupted || record.is_some() {
                TurnOutcome::Interrupted
            } else {
                TurnOutcome::Completed
            }
        }
        Some(TurnOutcomeRecord::Completed) => TurnOutcome::Completed,
        Some(TurnOutcomeRecord::Interrupted) => TurnOutcome::Interrupted,
        Some(TurnOutcomeRecord::Failed { error }) => TurnOutcome::Failed(error.clone()),
    }
}

fn declined_tool_uses(frame: &ClaudeFrame) -> Vec<String> {
    let ClaudeFrame::User(user) = frame else {
        return Vec::new();
    };
    user.tool_results
        .iter()
        .filter(|result| {
            result.is_error
                && DECLINED_RESULT_PREFIXES
                    .iter()
                    .any(|prefix| result.text.starts_with(prefix))
        })
        .map(|result| result.tool_use_id.clone())
        .collect()
}

/// What the turn index says about the prompts of one turn.
struct PromptIndex {
    /// `clientMessageId` by persisted prompt uuid; a resent prompt carries the first prompt's id.
    client_message_ids: HashMap<String, ClientMessageId>,
    /// Uuids of the first prompt resent to a replacement session: not a new user message.
    resent: HashSet<String>,
}

fn prompt_index(record: Option<&TurnRecord>) -> PromptIndex {
    let prompts = record
        .map(|record| record.prompts.as_slice())
        .unwrap_or_default();
    let first_client_id = prompts
        .iter()
        .find(|prompt| prompt.role == PromptRole::First)
        .and_then(|prompt| prompt.client_message_id.as_deref());
    let mut client_message_ids = HashMap::new();
    let mut resent = HashSet::new();
    for prompt in prompts {
        let Some(uuid) = &prompt.uuid else {
            continue;
        };
        let client_id = if prompt.role == PromptRole::Resend {
            first_client_id
        } else {
            prompt.client_message_id.as_deref()
        };
        if let Some(client_id) = client_id.and_then(ClientMessageId::parse) {
            client_message_ids.insert(uuid.clone(), client_id);
        }
        if prompt.role == PromptRole::Resend {
            resent.insert(uuid.clone());
        }
    }
    PromptIndex {
        client_message_ids,
        resent,
    }
}

/// Identity of a rebuilt turn: from the index, else derived from its first message.
fn turn_identity(segment: &HistorySegment, record: Option<&TurnRecord>) -> (TurnOrigin, TurnId) {
    if let Some(record) = record
        && let Some(turn_id) = TurnId::parse(&record.turn_id)
    {
        return (record.origin, turn_id);
    }
    let first = segment.entries.first().map_or("", HistoryEntry::uuid);
    (
        segment.origin,
        TurnId::parse(first).unwrap_or_else(|| TurnId::from_static("turn")),
    )
}

/// Replays one segment through a turn builder whose clock reads entry timestamps.
struct SegmentReplay {
    builder: TurnBuilder,
    prompts: PromptIndex,
}

impl SegmentReplay {
    fn new(
        identity: (TurnOrigin, TurnId),
        prompts: PromptIndex,
        context: &HistoryContext,
        start_ms: i64,
    ) -> Self {
        Self {
            builder: TurnBuilder::new(TurnBuilderContext {
                app_thread_id: context.app_thread_id.clone(),
                cwd: context.cwd.clone(),
                now_ms: start_ms,
                origin: identity.0,
                turn_id: identity.1,
            }),
            prompts,
        }
    }

    fn user_message<'a>(&self, uuid: &str, content: &'a [UserContent]) -> UserMessage<'a> {
        UserMessage {
            client_message_id: self.prompts.client_message_ids.get(uuid).cloned(),
            content,
        }
    }

    /// Begins the turn; returns whether `first` became its first user message.
    fn begin(&mut self, first: Option<&HistoryEntry>) -> bool {
        let opening = match first {
            Some(HistoryEntry::Prompt { content, uuid, .. })
                if self.builder.origin() == TurnOrigin::User =>
            {
                Some(self.user_message(uuid, content))
            }
            _ => None,
        };
        let consumed = opening.is_some();
        self.builder.begin(opening);
        consumed
    }

    fn apply(&mut self, entry: &HistoryEntry) {
        self.builder.set_now(entry.timestamp_ms());
        match entry {
            HistoryEntry::Prompt { content, uuid, .. } => {
                if !self.prompts.resent.contains(uuid) {
                    let message = self.user_message(uuid, content);
                    self.builder
                        .add_user_message(message.client_message_id, message.content);
                }
            }
            HistoryEntry::Frame { frame, .. } => {
                for tool_use_id in declined_tool_uses(frame) {
                    self.builder.mark_declined(&tool_use_id);
                }
                self.builder.on_frame(frame);
            }
            HistoryEntry::Compaction { uuid, .. } => {
                self.builder.on_frame(&ClaudeFrame::CompactBoundary {
                    uuid: Some(uuid.clone()),
                });
            }
            HistoryEntry::Interrupt { .. } | HistoryEntry::Wake { .. } => {}
        }
    }

    /// A background task report delivered in the turn; the store names the
    /// task only by its summary.
    fn report(&mut self, report: &SegmentReport) {
        self.builder.add_task_notification(
            &report.report,
            report.delivery,
            reported_identity(&report.report),
        );
    }

    fn finish(mut self, outcome: &TurnOutcome) -> AgentTurn {
        self.builder.finish(outcome, None).1
    }

    /// The turn as still running: open items stay open.
    fn snapshot(&self) -> AgentTurn {
        self.builder.snapshot()
    }
}

/// Index timestamps win over the ones read from the store; the index adds the turn's usage.
fn with_record(mut turn: AgentTurn, record: Option<&TurnRecord>) -> AgentTurn {
    if let Some(record) = record {
        turn.completed_at = record.completed_at.or(turn.completed_at);
        turn.started_at = record.started_at;
        if record.usage.is_some() {
            turn.usage.clone_from(&record.usage);
        }
    }
    turn
}

/// Replays every entry of a segment, each task report before the entry it
/// precedes (wake reports right after the turn begins); the caller finishes
/// the turn.
fn replay_entries(
    segment: &HistorySegment,
    record: Option<&TurnRecord>,
    context: &HistoryContext,
) -> SegmentReplay {
    let first = segment.entries.first();
    let mut replay = SegmentReplay::new(
        turn_identity(segment, record),
        prompt_index(record),
        context,
        first.map_or(0, HistoryEntry::timestamp_ms),
    );
    let mut reports = segment.reports.iter().peekable();
    let mut report_up_to = |replay: &mut SegmentReplay, position: usize| {
        while let Some(report) = reports.next_if(|report| report.position <= position) {
            replay.report(report);
        }
    };
    let consumed_first = replay.begin(first);
    for (position, entry) in segment
        .entries
        .iter()
        .enumerate()
        .skip(usize::from(consumed_first))
    {
        report_up_to(&mut replay, position);
        replay.apply(entry);
    }
    report_up_to(&mut replay, segment.entries.len());
    replay
}

fn replay_segment(
    segment: &HistorySegment,
    records: &[TurnRecord],
    context: &HistoryContext,
) -> AgentTurn {
    let record = record_of(segment, records);
    with_record(
        replay_entries(segment, record, context).finish(&outcome_of(segment, record)),
        record,
    )
}

/// The last turn of a sub-agent that still works: open items stay open.
fn replay_running_segment(segment: &HistorySegment, context: &HistoryContext) -> AgentTurn {
    replay_entries(segment, None, context).snapshot()
}

/// Sub-agent items carry the status of their agent's latest run at the same
/// conversation level: the final status a later task report reported (a
/// background agent finishes after the turn that started it), or running
/// again when a resume is its newest status fact.
fn with_subagent_runs(turns: Vec<AgentTurn>, entries: &[HistoryEntry]) -> Vec<AgentTurn> {
    let mut runs = SubagentRuns::default();
    record_runs(&mut runs, entries);
    settle_subagent_items(turns, &runs)
}

fn record_runs(runs: &mut SubagentRuns, entries: &[HistoryEntry]) {
    let mut send_message_calls = HashSet::new();
    for entry in entries {
        match entry {
            HistoryEntry::Wake {
                reports,
                timestamp_ms,
                ..
            } => {
                for report in reports {
                    runs.record(report, *timestamp_ms);
                }
            }
            HistoryEntry::Frame {
                frame: ClaudeFrame::Assistant(assistant),
                ..
            } => {
                for block in &assistant.blocks {
                    if let AssistantBlock::ToolUse { id, name, .. } = block
                        && is_send_message_tool(name)
                    {
                        send_message_calls.insert(id.as_str());
                    }
                }
            }
            HistoryEntry::Frame {
                frame: ClaudeFrame::User(user),
                timestamp_ms,
                ..
            } => {
                for result in &user.tool_results {
                    if send_message_calls.contains(result.tool_use_id.as_str())
                        && let Some(agent_id) = resumed_agent_id(result, &user.tool_use_result)
                    {
                        runs.record_resume(&result.tool_use_id, &agent_id, *timestamp_ms);
                    }
                }
            }
            _ => {}
        }
    }
}

/// Records the sub-agent runs one stored transcript of a session holds: the
/// final status of its task report messages and of the reports Claude queued
/// into it as `queued_command` attachments, and its resuming `SendMessage`
/// calls. A report may reach a conversation other than the one that spawned
/// its agent: a nested background agent reports to its parent sub-agent (a
/// sub-agent transcript keeps that report only as an attachment) or, when
/// that one is busy or done, to the main conversation.
pub fn record_transcript_runs(runs: &mut SubagentRuns, rows: &[&JsonRecord]) {
    record_runs(runs, &history_entries(rows, subagent_parent(rows)));
    for row in rows {
        let Some(prompt) = queued_task_notification(row) else {
            continue;
        };
        let Some(timestamp_ms) = str_of(row, "timestamp").and_then(super::entries::timestamp_ms)
        else {
            continue;
        };
        for report in stored_task_reports(prompt) {
            runs.record(&report, timestamp_ms);
        }
    }
}

/// The prompt of a queued background task report attachment.
fn queued_task_notification(row: &JsonRecord) -> Option<&str> {
    json_record(row, "attachment")
        .filter(|attachment| str_of(attachment, "type") == Some("queued_command"))
        .filter(|attachment| str_of(attachment, "commandMode") == Some("task-notification"))
        .and_then(|attachment| str_of(attachment, "prompt"))
}

/// The turns with every sub-agent item carrying the status of its agent's
/// latest run in `runs` (see [`SubagentRuns::apply`]).
#[must_use]
pub fn settle_subagent_items(turns: Vec<AgentTurn>, runs: &SubagentRuns) -> Vec<AgentTurn> {
    turns
        .into_iter()
        .map(|mut turn| {
            for item in &mut turn.items {
                if let Some(subagent) = SubagentItem::from_item(item) {
                    let provenance = item.provenance().cloned();
                    let mut updated = runs.apply(subagent).into_item();
                    if let Some(provenance) = provenance {
                        updated.stamp(&provenance);
                    }
                    *item = updated;
                }
            }
            turn
        })
        .collect()
}

/// Turns after the Claude process that owned their still-running sub-agents
/// is known to be gone. An unresolved transcript is historical evidence, not
/// a live execution lease.
#[must_use]
pub fn settle_orphaned_subagent_items(turns: Vec<AgentTurn>) -> Vec<AgentTurn> {
    turns
        .into_iter()
        .map(|mut turn| {
            for item in &mut turn.items {
                let Some(subagent) = SubagentItem::from_item(item) else {
                    continue;
                };
                if subagent.status != SubagentStatus::Running {
                    continue;
                }
                let provenance = item.provenance().cloned();
                let mut updated = with_status(subagent, SubagentStatus::Stopped).into_item();
                if let Some(provenance) = provenance {
                    updated.stamp(&provenance);
                }
                *item = updated;
            }
            turn
        })
        .collect()
}

/// Stops only still-running sub-agents whose transcript belongs to an earlier
/// process generation. Items without a resolved child id remain untouched
/// because the transcript store cannot assign them to a generation.
#[must_use]
pub fn settle_named_orphaned_subagent_items<S: std::hash::BuildHasher>(
    turns: Vec<AgentTurn>,
    orphaned: &HashSet<String, S>,
) -> Vec<AgentTurn> {
    turns
        .into_iter()
        .map(|mut turn| {
            for item in &mut turn.items {
                let Some(subagent) = SubagentItem::from_item(item) else {
                    continue;
                };
                let is_orphaned = subagent
                    .agent_thread_id
                    .as_ref()
                    .and_then(super::agents::agent_id_of)
                    .is_some_and(|agent_id| orphaned.contains(agent_id));
                if subagent.status != SubagentStatus::Running || !is_orphaned {
                    continue;
                }
                let provenance = item.provenance().cloned();
                let mut updated = with_status(subagent, SubagentStatus::Stopped).into_item();
                if let Some(provenance) = provenance {
                    updated.stamp(&provenance);
                }
                *item = updated;
            }
            turn
        })
        .collect()
}

/// Rebuilds the turns of a thread from the stored messages of its session
/// chain (oldest first) and the companion's turn index.
#[must_use]
pub fn reconstruct_turns(
    messages: &[&JsonRecord],
    records: &[TurnRecord],
    context: &HistoryContext,
) -> Vec<AgentTurn> {
    let entries = history_entries(messages, None);
    let hints = segment_hints(records);
    let turns = history_segments(entries.clone(), &hints)
        .iter()
        .map(|segment| replay_segment(segment, records, context))
        .collect();
    with_subagent_runs(turns, &entries)
}

/// Where one rebuilt turn ends in the stored messages.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct TurnEnd {
    /// Uuid of the turn's last stored top-level message.
    pub last_uuid: String,
    pub turn_id: TurnId,
}

/// The turns of a thread in order, each with its last stored message: the
/// point a fork through that turn copies the session to. Same segmentation
/// and identities as [`reconstruct_turns`].
#[must_use]
pub fn turn_ends(messages: &[&JsonRecord], records: &[TurnRecord]) -> Vec<TurnEnd> {
    let hints = segment_hints(records);
    history_segments(history_entries(messages, None), &hints)
        .iter()
        .filter_map(|segment| {
            let last = segment.entries.last()?;
            Some(TurnEnd {
                last_uuid: last.uuid().to_owned(),
                turn_id: turn_identity(segment, record_of(segment, records)).1,
            })
        })
        .collect()
}

/// The tool call that spawned a sub-agent, read from its first stored message
/// (SDK-shaped messages; sidecar rows name none).
#[must_use]
pub fn subagent_parent<'a>(messages: &[&'a JsonRecord]) -> Option<&'a str> {
    messages
        .first()
        .and_then(|first| super::json::str_of(first, "parent_tool_use_id"))
}

/// Rebuilds the turns of one sub-agent transcript. Sub-agents are never
/// companion-driven, so their turn ids come from their messages alone. The
/// last turn of a sub-agent its parent still reports `running` stays in
/// progress.
#[must_use]
pub fn reconstruct_subagent_turns(
    messages: &[&JsonRecord],
    context: &HistoryContext,
    running: bool,
) -> Vec<AgentTurn> {
    let hints = SegmentHints::default();
    let entries = history_entries(messages, subagent_parent(messages));
    let segments = history_segments(entries.clone(), &hints);
    let count = segments.len();
    let turns = segments
        .iter()
        .enumerate()
        .map(|(index, segment)| {
            if running && index + 1 == count {
                replay_running_segment(segment, context)
            } else {
                replay_segment(segment, &[], context)
            }
        })
        .collect::<Vec<_>>();
    let turns = if running {
        turns
    } else {
        with_cut_off_last_turn_interrupted(turns)
    };
    with_subagent_runs(turns, &entries)
}

/// A sub-agent that no longer runs answers its spawner with a final message
/// before it ends. A last turn without one was cut off (its process ended
/// mid-step), so it did not complete.
fn with_cut_off_last_turn_interrupted(mut turns: Vec<AgentTurn>) -> Vec<AgentTurn> {
    if let Some(last) = turns.last_mut()
        && last.status == TurnStatus::Completed
        && !last.items.iter().any(|item| {
            matches!(
                item,
                AgentItem::AgentMessage {
                    phase: MessagePhase::Final,
                    ..
                }
            )
        })
    {
        last.status = TurnStatus::Interrupted;
    }
    turns
}

/// Agent ids whose spawning item, in any of `turns`, still reports `running`.
#[must_use]
pub fn running_agents(turns: &[AgentTurn]) -> Vec<String> {
    let mut running = Vec::new();
    for turn in turns {
        for item in &turn.items {
            if let AgentItem::Subagent {
                status: agent_core::model::SubagentStatus::Running,
                agent_thread_id: Some(agent_thread_id),
                ..
            } = item
                && let Some(agent_id) = super::agents::agent_id_of(agent_thread_id)
            {
                running.push(agent_id.to_owned());
            }
        }
    }
    running
}
