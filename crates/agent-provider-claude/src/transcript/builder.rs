//! Builds one neutral turn from classified Claude frames.
//!
//! Owns the neutral ordering invariants of a single turn:
//! 1. `turn.started` precedes every item event;
//! 2. a user turn's first item is its `userMessage`;
//! 3. every started item is completed before `turn.completed`;
//! 4. at most one `agentMessage` has phase `final`: the latest completed agent
//!    message is held back and released as `commentary` when another item
//!    starts, or as `final` when the turn completes successfully;
//! 5. `item.completed` carries the full item; deltas only reference started,
//!    still-open items of the matching type;
//! 6. a background task report is a complete item at its delivery position
//!    and does not release the held agent message: it is not the agent's
//!    output, so the answer before it can still be the final one.
//!
//! Holds state but performs no I/O; the caller decides what to do with the
//! events it returns. The caller also owns the clock: `set_now` before each
//! frame (stored timestamps in history, the wall clock live).

use std::collections::HashMap;

use agent_core::model::{
    AgentEvent, AgentItem, AgentTurn, AppThreadId, CallStatus, ClientMessageId, ExecutionStatus,
    ItemDelta, ItemId, MessagePhase, Provenance, ProviderId, ProviderThreadRef,
    TaskNotificationDelivery, TokenUsage, TurnId, TurnOrigin, TurnStatus, TurnUsageRecord,
    UserContent,
};

use super::{
    agents::{SubagentItem, notified_status, with_agent, with_status},
    frames::{
        AssistantBlock, AssistantFrame, BlockKind, ClaudeFrame, StreamEvent, TaskStartedFrame,
        UserFrame,
    },
    json::JsonRecord,
    result::TurnOutcome,
    task_notifications::{Delivered, TaskIdentity, task_notification_item},
    task_reports::TaskReport,
    tools::{
        ToolCallInput, ToolContext, ToolDisposition, ToolOutcome, block_item_id, complete_item,
        execution_status, fail_open_item, image_view_for, start_item, todo_plan, tool_disposition,
    },
};

const MS_PER_SECOND: i64 = 1000;

struct ItemSlot {
    completed: bool,
    item: AgentItem,
}

struct ToolCall {
    input: JsonRecord,
    name: String,
    started_at_ms: i64,
}

/// What a builder needs to know about its turn.
pub struct TurnBuilderContext {
    pub app_thread_id: AppThreadId,
    pub cwd: String,
    /// The clock at construction, in milliseconds.
    pub now_ms: i64,
    pub origin: TurnOrigin,
    pub turn_id: TurnId,
}

/// A user message inside a turn.
pub struct UserMessage<'a> {
    pub client_message_id: Option<ClientMessageId>,
    pub content: &'a [UserContent],
}

/// The usage of one complete model request while the turn runs.
pub struct LiveUsage {
    pub context_window: Option<i64>,
    pub last: TokenUsage,
    pub model: Option<String>,
    pub total: TokenUsage,
}

pub struct TurnBuilder {
    slots: HashMap<ItemId, ItemSlot>,
    order: Vec<ItemId>,
    tools: HashMap<String, ToolCall>,
    declined: std::collections::HashSet<String>,
    snapshot_ordinals: HashMap<String, usize>,
    stream_blocks: HashMap<i64, ItemId>,
    current_message_id: Option<String>,
    held_agent_message: Option<ItemId>,
    user_message_count: usize,
    /// Task reports of this turn so far; numbers their items.
    notification_count: usize,
    /// Compactions of this turn so far; numbers their items.
    compaction_count: usize,
    open_compaction: Option<AgentItem>,
    last_assistant_error: Option<String>,
    mcp_servers: Vec<String>,
    now_ms: i64,
    started_at: i64,
    context: TurnBuilderContext,
    provenance: Provenance,
}

fn seconds(ms: i64) -> i64 {
    ms.div_euclid(MS_PER_SECOND)
}

impl TurnBuilder {
    #[must_use]
    pub fn new(context: TurnBuilderContext) -> Self {
        let provenance = Provenance {
            provider: ProviderId::from_static(crate::PROVIDER_ID),
            native_thread_id: ProviderThreadRef::same_as(&context.app_thread_id),
        };
        Self {
            slots: HashMap::new(),
            order: Vec::new(),
            tools: HashMap::new(),
            declined: std::collections::HashSet::new(),
            snapshot_ordinals: HashMap::new(),
            stream_blocks: HashMap::new(),
            current_message_id: None,
            held_agent_message: None,
            user_message_count: 0,
            notification_count: 0,
            compaction_count: 0,
            open_compaction: None,
            last_assistant_error: None,
            mcp_servers: Vec::new(),
            now_ms: context.now_ms,
            started_at: seconds(context.now_ms),
            context,
            provenance,
        }
    }

    /// Moves the builder's clock; durations and `completedAt` read it.
    pub fn set_now(&mut self, now_ms: i64) {
        self.now_ms = now_ms;
    }

    #[must_use]
    pub fn turn_id(&self) -> &TurnId {
        &self.context.turn_id
    }

    #[must_use]
    pub fn origin(&self) -> TurnOrigin {
        self.context.origin
    }

    #[must_use]
    pub fn started_at(&self) -> i64 {
        self.started_at
    }

    /// `usage.updated` for one complete model request while the turn runs.
    #[must_use]
    pub fn live_usage(&self, update: LiveUsage) -> AgentEvent {
        AgentEvent::UsageUpdated {
            app_thread_id: self.context.app_thread_id.clone(),
            turn_id: self.context.turn_id.clone(),
            last: update.last,
            total: update.total,
            context_window: update.context_window,
            cost: None,
            model: update.model,
        }
    }

    /// `error` field of the most recent top-level assistant frame.
    #[must_use]
    pub fn assistant_error(&self) -> Option<&str> {
        self.last_assistant_error.as_deref()
    }

    /// Whether a command (Bash) item is still running; used by the interrupt fallback.
    #[must_use]
    pub fn has_running_command(&self) -> bool {
        self.slots
            .values()
            .any(|slot| !slot.completed && matches!(slot.item, AgentItem::Command { .. }))
    }

    pub fn set_mcp_servers(&mut self, servers: Vec<String>) {
        self.mcp_servers = servers;
    }

    fn turn_shape(
        &self,
        status: TurnStatus,
        completed_at: Option<i64>,
        error: Option<agent_core::model::TurnError>,
        items: Vec<AgentItem>,
    ) -> AgentTurn {
        AgentTurn {
            turn_id: self.context.turn_id.clone(),
            status,
            origin: self.context.origin,
            started_at: self.started_at,
            completed_at,
            error,
            items,
            provenance: Some(self.provenance.clone()),
            usage: None,
        }
    }

    /// `turn.started` plus, for a user turn, its first `userMessage`.
    pub fn begin(&mut self, user_message: Option<UserMessage<'_>>) -> Vec<AgentEvent> {
        let mut events = vec![AgentEvent::TurnStarted {
            app_thread_id: self.context.app_thread_id.clone(),
            turn: self.turn_shape(TurnStatus::InProgress, None, None, Vec::new()),
        }];
        if let Some(message) = user_message {
            events.extend(self.add_user_message(message.client_message_id, message.content));
        }
        events
    }

    /// A user message inside this turn (the first one, or an explicit steer).
    pub fn add_user_message(
        &mut self,
        client_message_id: Option<ClientMessageId>,
        content: &[UserContent],
    ) -> Vec<AgentEvent> {
        let Some(item_id) = ItemId::parse(&format!(
            "{}:user:{}",
            self.context.turn_id, self.user_message_count
        )) else {
            return Vec::new();
        };
        self.user_message_count += 1;
        let item = AgentItem::UserMessage {
            item_id,
            provenance: None,
            client_message_id,
            content: content.to_vec(),
        };
        let mut events = self.start(item.clone());
        events.extend(self.complete(item));
        events
    }

    fn event_started(&self, item: AgentItem) -> AgentEvent {
        AgentEvent::ItemStarted {
            app_thread_id: self.context.app_thread_id.clone(),
            turn_id: self.context.turn_id.clone(),
            item,
        }
    }

    fn event_completed(&self, item: AgentItem) -> AgentEvent {
        AgentEvent::ItemCompleted {
            app_thread_id: self.context.app_thread_id.clone(),
            turn_id: self.context.turn_id.clone(),
            item,
        }
    }

    fn flush_held(&mut self, phase: MessagePhase) -> Vec<AgentEvent> {
        let Some(held) = self.held_agent_message.take() else {
            return Vec::new();
        };
        let Some(slot) = self.slots.get_mut(&held) else {
            return Vec::new();
        };
        let AgentItem::AgentMessage {
            item_id,
            provenance,
            text,
            ..
        } = &slot.item
        else {
            return Vec::new();
        };
        slot.item = AgentItem::AgentMessage {
            item_id: item_id.clone(),
            provenance: provenance.clone(),
            text: text.clone(),
            phase,
        };
        slot.completed = true;
        let item = slot.item.clone();
        vec![self.event_completed(item)]
    }

    /// The item with this turn's origin.
    fn stamped(&self, mut item: AgentItem) -> AgentItem {
        item.stamp(&self.provenance);
        item
    }

    fn start(&mut self, body: AgentItem) -> Vec<AgentEvent> {
        let item = self.stamped(body);
        let item_id = item.item_id().clone();
        if self.slots.contains_key(&item_id) {
            return Vec::new();
        }
        let mut events = self.flush_held(MessagePhase::Commentary);
        self.slots.insert(
            item_id.clone(),
            ItemSlot {
                completed: false,
                item: item.clone(),
            },
        );
        self.order.push(item_id);
        events.push(self.event_started(item));
        events
    }

    fn complete(&mut self, body: AgentItem) -> Vec<AgentEvent> {
        let item = self.stamped(body);
        let item_id = item.item_id().clone();
        let Some(slot) = self.slots.get_mut(&item_id) else {
            return Vec::new();
        };
        if slot.completed {
            return Vec::new();
        }
        slot.item = item.clone();
        if matches!(item, AgentItem::AgentMessage { .. }) {
            let events = if self.held_agent_message.as_ref() == Some(&item_id) {
                Vec::new()
            } else {
                self.flush_held(MessagePhase::Commentary)
            };
            self.held_agent_message = Some(item_id);
            return events;
        }
        slot.completed = true;
        vec![self.event_completed(item)]
    }

    fn delta_event(&self, item_id: ItemId, delta: ItemDelta) -> AgentEvent {
        AgentEvent::ItemDelta {
            app_thread_id: self.context.app_thread_id.clone(),
            turn_id: self.context.turn_id.clone(),
            item_id,
            delta,
        }
    }

    fn text_delta(&mut self, item_id: &ItemId, text: &str) -> Vec<AgentEvent> {
        if text.is_empty() || self.held_agent_message.as_ref() == Some(item_id) {
            return Vec::new();
        }
        let Some(slot) = self.slots.get_mut(item_id) else {
            return Vec::new();
        };
        if slot.completed {
            return Vec::new();
        }
        let AgentItem::AgentMessage { text: current, .. } = &mut slot.item else {
            return Vec::new();
        };
        current.push_str(text);
        vec![self.delta_event(
            item_id.clone(),
            ItemDelta::Text {
                text: text.to_owned(),
            },
        )]
    }

    fn reasoning_delta(&mut self, item_id: &ItemId, text: &str) -> Vec<AgentEvent> {
        if text.is_empty() {
            return Vec::new();
        }
        let Some(slot) = self.slots.get_mut(item_id) else {
            return Vec::new();
        };
        if slot.completed {
            return Vec::new();
        }
        let AgentItem::Reasoning { summary, .. } = &mut slot.item else {
            return Vec::new();
        };
        match summary.first_mut() {
            Some(first) => first.push_str(text),
            None => summary.push(text.to_owned()),
        }
        vec![self.delta_event(
            item_id.clone(),
            ItemDelta::Reasoning {
                text: text.to_owned(),
                summary_index: 0,
            },
        )]
    }

    fn start_block(&mut self, item_id: ItemId, kind: BlockKind) -> Vec<AgentEvent> {
        let item = match kind {
            BlockKind::Text => AgentItem::AgentMessage {
                item_id,
                provenance: None,
                text: String::new(),
                phase: MessagePhase::Commentary,
            },
            BlockKind::Thinking => AgentItem::Reasoning {
                item_id,
                provenance: None,
                summary: Vec::new(),
                content: Vec::new(),
            },
            BlockKind::ToolUse | BlockKind::Other => return Vec::new(),
        };
        self.start(item)
    }

    /// Starts the item of a tool call if it has not started yet (from a snapshot or `canUseTool`).
    pub fn start_tool(
        &mut self,
        tool_use_id: &str,
        name: &str,
        input: &JsonRecord,
    ) -> Vec<AgentEvent> {
        if self.tools.contains_key(tool_use_id) {
            return Vec::new();
        }
        self.tools.insert(
            tool_use_id.to_owned(),
            ToolCall {
                input: input.clone(),
                name: name.to_owned(),
                started_at_ms: self.now_ms,
            },
        );
        match tool_disposition(name) {
            ToolDisposition::Plan => vec![AgentEvent::PlanUpdated {
                app_thread_id: self.context.app_thread_id.clone(),
                turn_id: self.context.turn_id.clone(),
                explanation: None,
                plan: todo_plan(input),
            }],
            ToolDisposition::ExitPlan => {
                let Some(item_id) = ItemId::parse(tool_use_id) else {
                    return Vec::new();
                };
                let item = AgentItem::Plan {
                    item_id,
                    provenance: None,
                    text: super::json::str_of(input, "plan")
                        .unwrap_or_default()
                        .to_owned(),
                };
                let mut events = self.start(item.clone());
                events.extend(self.complete(item));
                events
            }
            ToolDisposition::Question => Vec::new(),
            ToolDisposition::Item => {
                let call = ToolCallInput {
                    id: tool_use_id.to_owned(),
                    input: input.clone(),
                    name: name.to_owned(),
                };
                let context = ToolContext {
                    cwd: &self.context.cwd,
                    mcp_servers: &self.mcp_servers,
                };
                match start_item(&call, &context) {
                    Some(item) => self.start(item),
                    None => Vec::new(),
                }
            }
        }
    }

    /// Ids of started tool calls named `name` that have no result yet, oldest first.
    #[must_use]
    pub fn open_tool_calls(&self, name: &str) -> Vec<String> {
        let mut open = self
            .tools
            .iter()
            .filter(|(id, call)| {
                call.name == name
                    && ItemId::parse(id).is_some_and(|item_id| {
                        self.slots.get(&item_id).is_none_or(|slot| !slot.completed)
                    })
            })
            .map(|(id, call)| (call.started_at_ms, id.clone()))
            .collect::<Vec<_>>();
        open.sort();
        open.into_iter().map(|(_, id)| id).collect()
    }

    pub fn mark_declined(&mut self, tool_use_id: &str) {
        self.declined.insert(tool_use_id.to_owned());
    }

    /// A background task report delivered in this turn: `wake` reports lead
    /// a provider turn, `midTurn` ones sit where they arrived. Its id is the
    /// turn's report ordinal, so a replay of the stored history gives it the
    /// same id. It does not release the held agent message.
    pub fn add_task_notification(
        &mut self,
        report: &TaskReport,
        delivery: TaskNotificationDelivery,
        identity: TaskIdentity,
    ) -> Vec<AgentEvent> {
        let Some(item_id) = ItemId::parse(&format!(
            "{}:notification:{}",
            self.context.turn_id, self.notification_count
        )) else {
            return Vec::new();
        };
        self.notification_count += 1;
        let item = self.stamped(task_notification_item(
            report,
            Delivered {
                app_thread_id: &self.context.app_thread_id,
                delivery,
                identity,
                item_id: item_id.clone(),
            },
        ));
        self.slots.insert(
            item_id.clone(),
            ItemSlot {
                completed: true,
                item: item.clone(),
            },
        );
        self.order.push(item_id);
        vec![self.event_started(item.clone()), self.event_completed(item)]
    }

    /// Whether a tool call of this turn has started and not returned yet.
    #[must_use]
    pub fn is_open_tool_call(&self, tool_use_id: &str) -> bool {
        self.tools.contains_key(tool_use_id)
            && ItemId::parse(tool_use_id)
                .is_none_or(|item_id| self.slots.get(&item_id).is_none_or(|slot| !slot.completed))
    }

    /// The sub-agent item a task's spawning call started in this turn.
    fn subagent_slot(
        &mut self,
        tool_use_id: Option<&str>,
    ) -> Option<(&mut ItemSlot, SubagentItem)> {
        let item_id = tool_use_id.and_then(ItemId::parse)?;
        let slot = self.slots.get_mut(&item_id)?;
        let subagent = SubagentItem::from_item(&slot.item)?;
        Some((slot, subagent))
    }

    /// A sub-agent of this turn started: its item learns the agent thread.
    /// No event: the spawning call's completion carries the item.
    fn on_task_started(&mut self, frame: &TaskStartedFrame) {
        let app_thread_id = self.context.app_thread_id.clone();
        let provenance = self.provenance.clone();
        if let Some((slot, subagent)) = self.subagent_slot(frame.tool_use_id.as_deref()) {
            slot.item = with_agent(subagent, &app_thread_id, &frame.task_id).into_item();
            // The rebuilt item lost its provenance stamp.
            slot.item.stamp(&provenance);
        }
    }

    /// A sub-agent of this turn reported: a returned spawning call's item
    /// takes its final status. No event: the turn's completion carries the
    /// item. The report's own item is the caller's to add
    /// ([`Self::add_task_notification`]).
    fn on_task_reported(&mut self, report: &TaskReport) {
        let provenance = self.provenance.clone();
        let Some(status) = notified_status(report.status.as_deref()) else {
            return;
        };
        if let Some((slot, subagent)) = self.subagent_slot(report.tool_use_id.as_deref())
            && slot.completed
        {
            slot.item = with_status(subagent, status).into_item();
            slot.item.stamp(&provenance);
        }
    }

    /// Claude started compacting: the item runs until the compact boundary.
    /// Its id is the turn's compaction ordinal, so a replay of the stored
    /// history, which keeps only the boundary, gives the same item the same id.
    fn start_compaction(&mut self) -> Vec<AgentEvent> {
        if self.open_compaction.is_some() {
            return Vec::new();
        }
        self.compaction_count += 1;
        let Some(item_id) = ItemId::parse(&format!(
            "{}:compaction:{}",
            self.context.turn_id, self.compaction_count
        )) else {
            return Vec::new();
        };
        let item = AgentItem::Compaction {
            item_id,
            provenance: None,
        };
        self.open_compaction = Some(item.clone());
        self.start(item)
    }

    /// The compact boundary: completes the running compaction, or a compaction never seen starting.
    fn complete_compaction(&mut self) -> Vec<AgentEvent> {
        let mut events = if self.open_compaction.is_none() {
            self.start_compaction()
        } else {
            Vec::new()
        };
        if let Some(item) = self.open_compaction.take() {
            events.extend(self.complete(item));
        }
        events
    }

    /// Applies one classified top-level frame. Sub-agent frames must be filtered by the caller.
    pub fn on_frame(&mut self, frame: &ClaudeFrame) -> Vec<AgentEvent> {
        match frame {
            ClaudeFrame::Stream { event, .. } => self.on_stream(event),
            ClaudeFrame::Assistant(frame) => self.on_assistant(frame),
            ClaudeFrame::User(frame) => self.on_user(frame),
            ClaudeFrame::Compacting => self.start_compaction(),
            ClaudeFrame::CompactBoundary { .. } => self.complete_compaction(),
            ClaudeFrame::TaskStarted(frame) => {
                self.on_task_started(frame);
                Vec::new()
            }
            ClaudeFrame::TaskNotification(report) => {
                self.on_task_reported(report);
                Vec::new()
            }
            ClaudeFrame::Init { .. }
            | ClaudeFrame::BackgroundTasks { .. }
            | ClaudeFrame::RateLimit { .. }
            | ClaudeFrame::Result(_)
            | ClaudeFrame::Other { .. } => Vec::new(),
        }
    }

    fn on_stream(&mut self, event: &StreamEvent) -> Vec<AgentEvent> {
        match event {
            StreamEvent::MessageStart { message_id } => {
                self.current_message_id = Some(message_id.clone());
                self.stream_blocks.clear();
                Vec::new()
            }
            StreamEvent::BlockStart { block, index } => {
                let Some(message_id) = self.current_message_id.clone() else {
                    return Vec::new();
                };
                if !matches!(block, BlockKind::Text | BlockKind::Thinking) {
                    return Vec::new();
                }
                let Some(item_id) = usize::try_from(*index)
                    .ok()
                    .and_then(|index| block_item_id(&message_id, index))
                else {
                    return Vec::new();
                };
                self.stream_blocks.insert(*index, item_id.clone());
                self.start_block(item_id, *block)
            }
            StreamEvent::TextDelta { index, text } => {
                match self.stream_blocks.get(index).cloned() {
                    Some(item_id) => self.text_delta(&item_id, text),
                    None => Vec::new(),
                }
            }
            StreamEvent::ThinkingDelta { index, text } => {
                match self.stream_blocks.get(index).cloned() {
                    Some(item_id) => self.reasoning_delta(&item_id, text),
                    None => Vec::new(),
                }
            }
            StreamEvent::BlockStop { .. } | StreamEvent::Other => Vec::new(),
        }
    }

    /// The completed item of a text or thinking snapshot block. Snapshots are
    /// authoritative, except that a summarized thinking block may arrive empty
    /// after its text was streamed as deltas.
    fn snapshot_item(&self, item_id: ItemId, block: &AssistantBlock) -> Option<AgentItem> {
        let streamed = self.slots.get(&item_id).map(|slot| &slot.item);
        match block {
            AssistantBlock::Text { text } => {
                let text = match streamed {
                    Some(AgentItem::AgentMessage { text: streamed, .. }) if text.is_empty() => {
                        streamed.clone()
                    }
                    _ => text.clone(),
                };
                Some(AgentItem::AgentMessage {
                    item_id,
                    provenance: None,
                    text,
                    phase: MessagePhase::Commentary,
                })
            }
            AssistantBlock::Thinking { text } => {
                let summary = match streamed {
                    Some(AgentItem::Reasoning { summary, .. }) if text.is_empty() => {
                        summary.clone()
                    }
                    _ if text.is_empty() => Vec::new(),
                    _ => vec![text.clone()],
                };
                Some(AgentItem::Reasoning {
                    item_id,
                    provenance: None,
                    summary,
                    content: Vec::new(),
                })
            }
            AssistantBlock::ToolUse { .. } | AssistantBlock::Other => None,
        }
    }

    fn on_assistant(&mut self, frame: &AssistantFrame) -> Vec<AgentEvent> {
        self.last_assistant_error.clone_from(&frame.error);
        let mut events = Vec::new();
        for block in &frame.blocks {
            let ordinal = self
                .snapshot_ordinals
                .entry(frame.message_id.clone())
                .or_insert(0);
            let index = *ordinal;
            *ordinal += 1;
            match block {
                AssistantBlock::ToolUse { id, name, input } => {
                    events.extend(self.start_tool(id, name, input));
                }
                AssistantBlock::Other => {}
                AssistantBlock::Text { .. } | AssistantBlock::Thinking { .. } => {
                    let Some(item_id) = block_item_id(&frame.message_id, index) else {
                        continue;
                    };
                    let kind = if matches!(block, AssistantBlock::Text { .. }) {
                        BlockKind::Text
                    } else {
                        BlockKind::Thinking
                    };
                    events.extend(self.start_block(item_id.clone(), kind));
                    if let Some(item) = self.snapshot_item(item_id, block) {
                        events.extend(self.complete(item));
                    }
                }
            }
        }
        events
    }

    fn on_user(&mut self, frame: &UserFrame) -> Vec<AgentEvent> {
        let mut events = Vec::new();
        for result in &frame.tool_results {
            let Some(item_id) = ItemId::parse(&result.tool_use_id) else {
                continue;
            };
            let Some(call) = self.tools.get(&result.tool_use_id) else {
                continue;
            };
            let Some(slot) = self.slots.get(&item_id) else {
                continue;
            };
            if slot.completed {
                continue;
            }
            let status = execution_status(
                result,
                frame
                    .non_execution
                    .get(&result.tool_use_id)
                    .map(String::as_str),
                self.declined.contains(&result.tool_use_id),
            );
            let duration_ms = (self.now_ms - call.started_at_ms).max(0);
            let input = ToolCallInput {
                id: result.tool_use_id.clone(),
                input: call.input.clone(),
                name: call.name.clone(),
            };
            let completed = complete_item(
                slot.item.clone(),
                &input,
                &ToolOutcome {
                    app_thread_id: &self.context.app_thread_id,
                    duration_ms,
                    result,
                    status,
                    tool_use_result: &frame.tool_use_result,
                },
            );
            events.extend(self.complete(completed));
            if status == ExecutionStatus::Completed
                && let Some(image) = image_view_for(&input.id, &input.name, &input.input)
            {
                events.extend(self.start(image.clone()));
                events.extend(self.complete(image));
            }
        }
        events
    }

    /// Whether no item has started yet: a task report then leads the turn.
    #[must_use]
    pub fn is_empty(&self) -> bool {
        self.order.is_empty()
    }

    fn items(&self) -> Vec<AgentItem> {
        self.order
            .iter()
            .filter_map(|id| self.slots.get(id).map(|slot| slot.item.clone()))
            .collect()
    }

    /// The in-progress turn with its items so far.
    #[must_use]
    pub fn snapshot(&self) -> AgentTurn {
        self.turn_shape(TurnStatus::InProgress, None, None, self.items())
    }

    /// Closes the turn: releases the held agent message (as `final` only for a
    /// completed turn), fails every still-open item, emits `usage.updated`
    /// when figures are known and finally `turn.completed` with every item.
    pub fn finish(
        &mut self,
        outcome: &TurnOutcome,
        usage: Option<&TurnUsageRecord>,
    ) -> (Vec<AgentEvent>, AgentTurn) {
        let mut events = self.flush_held(if matches!(outcome, TurnOutcome::Completed) {
            MessagePhase::Final
        } else {
            MessagePhase::Commentary
        });
        for id in self.order.clone() {
            let Some(slot) = self.slots.get_mut(&id) else {
                continue;
            };
            if slot.completed {
                continue;
            }
            slot.item = fail_open_item(slot.item.clone());
            slot.completed = true;
            let item = slot.item.clone();
            events.push(self.event_completed(item));
        }
        if let Some(usage) = usage {
            events.push(AgentEvent::UsageUpdated {
                app_thread_id: self.context.app_thread_id.clone(),
                turn_id: self.context.turn_id.clone(),
                last: usage.last,
                total: usage.total,
                context_window: usage.context_window,
                cost: usage.cost.clone(),
                model: None,
            });
        }
        let error = match outcome {
            TurnOutcome::Failed(error) => Some(error.clone()),
            TurnOutcome::Completed | TurnOutcome::Interrupted => None,
        };
        let turn = self.turn_shape(
            outcome.status(),
            Some(seconds(self.now_ms)),
            error,
            self.items(),
        );
        events.push(AgentEvent::TurnCompleted {
            app_thread_id: self.context.app_thread_id.clone(),
            turn: turn.clone(),
        });
        (events, turn)
    }
}

/// Whether an item still reports itself in progress.
#[must_use]
pub fn item_in_progress(item: &AgentItem) -> bool {
    match item {
        AgentItem::Command { status, .. } | AgentItem::FileChange { status, .. } => {
            *status == ExecutionStatus::InProgress
        }
        AgentItem::ToolCall { status, .. } | AgentItem::McpToolCall { status, .. } => {
            *status == CallStatus::InProgress
        }
        _ => false,
    }
}
