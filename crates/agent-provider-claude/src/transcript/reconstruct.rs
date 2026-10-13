//! Thread history from Claude's own session store, mapped to the same
//! neutral turns and items the live path emits.
//!
//! Each derived turn segment is replayed through the live `TurnBuilder`, so
//! item ids (`{message.id}:{block}`, `tool_use.id`, `{turnId}:user:{n}`),
//! item types, ordering and the final-answer rule are identical to live. The
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
    AgentItem, AgentTurn, AppThreadId, ClientMessageId, TurnId, TurnOrigin, UserContent,
};
use serde_json::Value;

use super::{
    agents::{NotifiedStatuses, SubagentItem},
    builder::{TurnBuilder, TurnBuilderContext, UserMessage},
    entries::{HistoryEntry, history_entries},
    frames::ClaudeFrame,
    result::TurnOutcome,
    segments::{HistorySegment, SegmentHints, history_segments},
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

/// Replays every entry of a segment; the caller finishes the turn.
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
    let consumed_first = replay.begin(first);
    let rest = if consumed_first {
        &segment.entries[1..]
    } else {
        &segment.entries[..]
    };
    for entry in rest {
        replay.apply(entry);
    }
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

/// Sub-agent items carry the final status a later task notification of the
/// same conversation level reported (a background agent finishes after the
/// turn that started it).
fn with_notified_statuses(turns: Vec<AgentTurn>, entries: &[HistoryEntry]) -> Vec<AgentTurn> {
    let mut statuses = NotifiedStatuses::default();
    for entry in entries {
        if let HistoryEntry::Wake {
            notification: Some(notification),
            ..
        } = entry
        {
            statuses.record(notification);
        }
    }
    turns
        .into_iter()
        .map(|mut turn| {
            for item in &mut turn.items {
                if let Some(subagent) = SubagentItem::from_item(item) {
                    let provenance = item.provenance().cloned();
                    let mut updated = statuses.apply(subagent).into_item();
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

/// Rebuilds the turns of a thread from the stored messages of its session
/// chain (oldest first) and the companion's turn index.
#[must_use]
pub fn reconstruct_turns(
    messages: &[Value],
    records: &[TurnRecord],
    context: &HistoryContext,
) -> Vec<AgentTurn> {
    let entries = history_entries(messages, None);
    let hints = segment_hints(records);
    let turns = history_segments(entries.clone(), &hints)
        .iter()
        .map(|segment| replay_segment(segment, records, context))
        .collect();
    with_notified_statuses(turns, &entries)
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
pub fn turn_ends(messages: &[Value], records: &[TurnRecord]) -> Vec<TurnEnd> {
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
pub fn subagent_parent(messages: &[Value]) -> Option<&str> {
    messages
        .first()
        .and_then(Value::as_object)
        .and_then(|first| super::json::str_of(first, "parent_tool_use_id"))
}

/// Rebuilds the turns of one sub-agent transcript. Sub-agents are never
/// companion-driven, so their turn ids come from their messages alone. The
/// last turn of a sub-agent its parent still reports `running` stays in
/// progress.
#[must_use]
pub fn reconstruct_subagent_turns(
    messages: &[Value],
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
        .collect();
    with_notified_statuses(turns, &entries)
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
