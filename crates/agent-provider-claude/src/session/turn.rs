//! Turns of a session: start, steer, interrupt, Claude's frames, results,
//! a lost session's replacement, usage and the end of a turn.
//!
//! Rules owned here:
//! - `turn.start` on an active thread answers `busy`; it never steers.
//! - A user turn's id is the uuid of its first prompt offer, which Claude
//!   persists, so the turn keeps its id when history is read back.
//! - Steer is explicit and offered with priority `now`; the `aborted_*`
//!   result a steer causes does not end the turn.
//! - Interrupt answers at once; without an `aborted_*` result within the
//!   timeout the query is closed and the turn finalized as interrupted.
//!   Open requests are resolved before `turn.completed`.
//! - A provider-started turn (background task wake) is a separate turn with
//!   origin `provider` and no user message.
//! - A background task report delivered to this conversation
//!   (`task_reports.rs`) becomes a `taskNotification` item: while a turn
//!   runs, a `midTurn` item at once (a `wake` item while a provider turn has
//!   nothing yet); while idle it waits and the next turn delivers it once,
//!   as `wake` items leading a provider turn or `midTurn` items after a user
//!   turn's prompt. A report never starts a turn: Claude's output does.
//! - A lost session is replaced once per turn by a new session whose first
//!   offer carries a bounded history prefix; a second loss fails the turn.
//! - The turn index entry is written when a turn starts, on a steer and when
//!   it ends; the in-flight snapshot whenever an item starts or completes.

use agent_core::model::{
    ClientMessageId, RequestResolution, TaskNotificationDelivery, TokenUsage, TurnError,
    TurnErrorKind, TurnId, TurnOrigin, TurnStartResult, TurnUsageRecord, UserContent,
};
use serde_json::{Value, json};
use tokio::time::Instant;
use tracing::{info, warn};

use super::{
    actor::{Internal, Session, seconds},
    query::Offer,
};
use crate::{
    cli::protocol::Priority,
    live::{
        prompt::{history_prefix, prompt_content},
        usage::{
            LiveUsageMeter, NEW_SESSION_BASELINE, ResultFigures, UsageDelta, ZERO_USAGE, add_delta,
            add_usage, meter_result, model_context_window, provider_cost, request_usage,
            thread_cost_after,
        },
    },
    state::thread_state::{PromptRecord, PromptRole, TurnOutcomeRecord, TurnRecord},
    transcript::{
        builder::{LiveUsage, TurnBuilder, TurnBuilderContext, UserMessage},
        frames::{ClaudeFrame, ResultFrame, StreamEvent, classify_frame},
        result::{TurnOutcome, is_interruption, is_lost_session, turn_outcome},
        task_reports::TaskReport,
    },
};

/// The turn that runs.
pub(super) struct ActiveTurn {
    /// Persisted message uuids identifying the turn in Claude's store.
    pub anchors: Vec<String>,
    pub builder: TurnBuilder,
    /// The first offer, kept to resend after a lost session.
    pub first_offer: Option<Vec<Value>>,
    /// Whether the first persisted frame's uuid is among the anchors.
    pub frame_anchored: bool,
    pub interrupt_requested: bool,
    pub interrupt_deadline: Option<Instant>,
    /// The context size of the turn's latest top-level model request.
    pub last_request: Option<TokenUsage>,
    /// Requests reported live since the turn's last result.
    pub live_usage: LiveUsageMeter,
    /// Steers whose `aborted_*` restart result must not end the turn.
    pub pending_steer_aborts: usize,
    pub prompts: Vec<PromptRecord>,
    /// Release the process after this turn (an interrupt during a command).
    pub release_after: bool,
    pub session_replacements: usize,
    /// Usage measured from this turn's results so far.
    pub usage: Option<UsageDelta>,
}

/// A user turn or the `/compact` turn.
pub enum TurnRequest {
    User {
        client_message_id: Option<ClientMessageId>,
        input: Vec<UserContent>,
    },
    Compact,
}

/// A steer's message.
pub struct SteerMessage {
    pub client_message_id: Option<ClientMessageId>,
    pub input: Vec<UserContent>,
}

pub const EXPECTED_TURN_NOT_ACTIVE: &str = "expected turn is not active";
/// The session's id generator produced a value that is not an id.
const INVALID_UUID: &str = "the session's uuid generator produced an invalid id";

struct TurnStart {
    first_offer: Option<Vec<Value>>,
    origin: TurnOrigin,
    /// How the turn delivers the task reports that arrived while idle.
    waiting_reports: TaskNotificationDelivery,
    prompts: Vec<PromptRecord>,
    turn_id: TurnId,
    user_message: Option<(Option<ClientMessageId>, Vec<UserContent>)>,
}

/// Whether a content frame belongs to the top-level conversation.
fn is_top_level_content(frame: &ClaudeFrame) -> bool {
    match frame {
        ClaudeFrame::Stream {
            event,
            parent_tool_use_id,
        } => parent_tool_use_id.is_none() && !matches!(event, StreamEvent::Other),
        ClaudeFrame::Assistant(frame) => frame.parent_tool_use_id.is_none(),
        ClaudeFrame::User(frame) => {
            frame.parent_tool_use_id.is_none()
                && !frame.is_synthetic
                && !frame.tool_results.is_empty()
        }
        ClaudeFrame::CompactBoundary { .. } | ClaudeFrame::Compacting => true,
        _ => false,
    }
}

/// The uuid Claude persists a content frame under.
fn persisted_uuid(frame: &ClaudeFrame) -> Option<&str> {
    match frame {
        ClaudeFrame::Assistant(frame) => frame.uuid.as_deref(),
        ClaudeFrame::User(frame) => frame.uuid.as_deref(),
        ClaudeFrame::CompactBoundary { uuid } => uuid.as_deref(),
        _ => None,
    }
}

fn outcome_record(outcome: &TurnOutcome) -> TurnOutcomeRecord {
    match outcome {
        TurnOutcome::Completed => TurnOutcomeRecord::Completed,
        TurnOutcome::Interrupted => TurnOutcomeRecord::Interrupted,
        TurnOutcome::Failed(error) => TurnOutcomeRecord::Failed {
            error: error.clone(),
        },
    }
}

impl Session {
    /// Starts a user turn (or the `/compact` turn). Never steers.
    pub(super) async fn start_turn(
        &mut self,
        request: TurnRequest,
    ) -> Result<TurnStartResult, String> {
        if let Some(active) = &self.active {
            return Ok(TurnStartResult::Busy {
                active_turn_id: active.builder.turn_id().clone(),
            });
        }
        self.clear_idle_timer();
        self.apply_pending_settings_if_possible().await;
        self.reopen_for_client_tools().await;
        let offer_uuid = self.new_uuid();
        let Some(turn_id) = TurnId::parse(&offer_uuid) else {
            return Err(INVALID_UUID.into());
        };
        let (first_offer, origin, client_message_id, user_message) = match request {
            TurnRequest::Compact => (
                vec![json!({"type": "text", "text": "/compact"})],
                TurnOrigin::Provider,
                None,
                None,
            ),
            TurnRequest::User {
                client_message_id,
                input,
            } => (
                prompt_content(&input),
                TurnOrigin::User,
                client_message_id.clone(),
                Some((client_message_id, input)),
            ),
        };
        self.begin_turn(TurnStart {
            first_offer: Some(first_offer.clone()),
            origin,
            waiting_reports: TaskNotificationDelivery::MidTurn,
            prompts: vec![PromptRecord {
                client_message_id: client_message_id.map(ClientMessageId::into_string),
                role: PromptRole::First,
                uuid: Some(offer_uuid.clone()),
            }],
            turn_id: turn_id.clone(),
            user_message,
        })
        .await;
        match self.ensure_query() {
            Some(query) => query.offer(Offer {
                content: first_offer,
                uuid: Some(offer_uuid),
                priority: Priority::Queued,
            }),
            None => {
                self.finish_turn(TurnOutcome::Failed(TurnError {
                    kind: TurnErrorKind::ProcessExited,
                    message: crate::transcript::result::PROCESS_EXITED_MESSAGE.into(),
                }))
                .await;
            }
        }
        Ok(TurnStartResult::Started { turn_id })
    }

    async fn begin_turn(&mut self, start: TurnStart) {
        let now = self.now_ms();
        let mut builder = TurnBuilder::new(TurnBuilderContext {
            app_thread_id: self.app_thread_id.clone(),
            cwd: self.state.cwd.clone(),
            now_ms: now,
            origin: start.origin,
            turn_id: start.turn_id,
        });
        builder.set_mcp_servers(self.mcp_servers.clone());
        self.active = Some(ActiveTurn {
            anchors: start
                .prompts
                .iter()
                .filter_map(|prompt| prompt.uuid.clone())
                .collect(),
            builder,
            first_offer: start.first_offer,
            frame_anchored: false,
            interrupt_requested: false,
            interrupt_deadline: None,
            last_request: None,
            live_usage: LiveUsageMeter::new(),
            pending_steer_aborts: 0,
            prompts: start.prompts,
            release_after: false,
            session_replacements: 0,
            usage: None,
        });
        if start.user_message.is_some() {
            self.state.recency_at = Some(seconds(now));
        }
        self.state.updated_at = seconds(now);
        self.record_active_turn(TurnOutcomeRecord::InProgress, None);
        let waiting = self.task_reports.take_waiting();
        let Some(active) = &mut self.active else {
            return;
        };
        let mut events = active.builder.begin(start.user_message.as_ref().map(
            |(client_message_id, content)| UserMessage {
                client_message_id: client_message_id.clone(),
                content,
            },
        ));
        for delivered in waiting {
            events.extend(active.builder.add_task_notification(
                &delivered.report,
                start.waiting_reports,
                delivered.identity,
            ));
        }
        let snapshot = active.builder.snapshot();
        self.write_active_turn(Some(&snapshot));
        self.publish_status();
        self.emit_all(events).await;
        self.emit_thread_updated().await;
    }

    /// Writes the active turn's index entry with `outcome` and, when it
    /// ended, its usage; persists the state.
    fn record_active_turn(&mut self, outcome: TurnOutcomeRecord, usage: Option<TurnUsageRecord>) {
        let Some(active) = &self.active else {
            return;
        };
        let completed_at =
            (!matches!(outcome, TurnOutcomeRecord::InProgress)).then(|| seconds(self.now_ms()));
        let record = TurnRecord {
            anchors: active.anchors.clone(),
            completed_at,
            origin: active.builder.origin(),
            outcome,
            prompts: active.prompts.clone(),
            started_at: active.builder.started_at(),
            turn_id: active.builder.turn_id().as_str().to_owned(),
            usage,
        };
        self.state.put_turn_record(record);
        self.persist();
    }

    /// Explicit steer into the active turn.
    pub(super) async fn steer(
        &mut self,
        expected: &TurnId,
        message: SteerMessage,
    ) -> Result<TurnId, String> {
        let Some(query) = self.query.as_ref().map(|query| query.handle.clone()) else {
            return Err(EXPECTED_TURN_NOT_ACTIVE.into());
        };
        if !self.active.as_ref().is_some_and(|active| {
            active.builder.turn_id() == expected && !active.interrupt_requested
        }) {
            return Err(EXPECTED_TURN_NOT_ACTIVE.into());
        }
        let uuid = self.new_uuid();
        let Some(active) = self
            .active
            .as_mut()
            .filter(|active| active.builder.turn_id() == expected && !active.interrupt_requested)
        else {
            return Err(EXPECTED_TURN_NOT_ACTIVE.into());
        };
        active.prompts.push(PromptRecord {
            client_message_id: message
                .client_message_id
                .clone()
                .map(ClientMessageId::into_string),
            role: PromptRole::Steer,
            uuid: Some(uuid.clone()),
        });
        active.anchors.push(uuid.clone());
        active.pending_steer_aborts += 1;
        let turn_id = active.builder.turn_id().clone();
        self.record_active_turn(TurnOutcomeRecord::InProgress, None);
        let now = self.now_ms();
        let Some(active) = &mut self.active else {
            return Err(EXPECTED_TURN_NOT_ACTIVE.into());
        };
        active.builder.set_now(now);
        let events = active
            .builder
            .add_user_message(message.client_message_id, &message.input);
        self.emit_all(events).await;
        query.offer(Offer {
            content: prompt_content(&message.input),
            uuid: Some(uuid),
            priority: Priority::Now,
        });
        Ok(turn_id)
    }

    /// Answers at once in every state. Errors only for a foreign turn id
    /// while a turn is active (`known_turn`: the id is a past turn of this
    /// thread).
    pub(super) async fn interrupt(
        &mut self,
        turn_id: Option<&TurnId>,
        known_turn: bool,
    ) -> Result<(), String> {
        let Some(active) = &self.active else {
            return Ok(());
        };
        if let Some(turn_id) = turn_id
            && turn_id != active.builder.turn_id()
        {
            return if known_turn {
                Ok(())
            } else {
                Err(EXPECTED_TURN_NOT_ACTIVE.into())
            };
        }
        if !active.interrupt_requested {
            self.request_interrupt().await;
        }
        Ok(())
    }

    async fn request_interrupt(&mut self) {
        self.cancel_tool_calls();
        let timeout = self.deps.config.interrupt_timeout;
        let Some(active) = &mut self.active else {
            return;
        };
        active.interrupt_requested = true;
        active.release_after = active.builder.has_running_command();
        let Some(query) = self.query.as_ref().map(|query| query.handle.clone()) else {
            self.finish_turn(TurnOutcome::Interrupted).await;
            return;
        };
        active.interrupt_deadline = Some(Instant::now() + timeout);
        let app_thread_id = self.app_thread_id.clone();
        tokio::spawn(async move {
            if let Err(err) = query.interrupt().await {
                warn!(app_thread_id = %app_thread_id, err = %err, "claude interrupt request failed");
            }
        });
    }

    pub(super) async fn on_interrupt_timeout(&mut self) {
        if let Some(active) = &mut self.active {
            active.interrupt_deadline = None;
        }
        warn!(app_thread_id = %self.app_thread_id, "claude interrupt did not settle; closing the session");
        self.close_query().await;
        self.finish_turn(TurnOutcome::Interrupted).await;
    }

    // ------------------------------------------------------------- frames

    pub(super) async fn on_message(&mut self, raw: &Value) {
        let frame = classify_frame(raw);
        match &frame {
            ClaudeFrame::Init { mcp_servers, .. } => self.on_init(mcp_servers.clone()).await,
            ClaudeFrame::BackgroundTasks { count } => {
                self.background_tasks = *count;
                if *count == 0 && self.active.is_none() {
                    self.apply_pending_settings_if_possible().await;
                }
            }
            ClaudeFrame::RateLimit { status, info } => {
                info!(app_thread_id = %self.app_thread_id, status = status.as_deref().unwrap_or("unknown"), "claude rate limit status");
                if let Some(window) = crate::live::rate_limits::rate_limit_event_window(info) {
                    self.deps.rate_limits.reported(window);
                }
            }
            ClaudeFrame::Result(result) => {
                self.on_result(result).await;
                self.result_seen();
            }
            // Sub-agent progress updates the active turn's item; it never wakes a turn.
            ClaudeFrame::TaskStarted(started) => {
                self.task_reports.started(started);
                let events = match &mut self.active {
                    Some(active) => active.builder.on_frame(&frame),
                    None => Vec::new(),
                };
                self.emit_all(events).await;
            }
            ClaudeFrame::TaskNotification(report) => self.on_task_report(&frame, report).await,
            ClaudeFrame::Other { .. } => {}
            ClaudeFrame::Assistant(_)
            | ClaudeFrame::CompactBoundary { .. }
            | ClaudeFrame::Compacting
            | ClaudeFrame::Stream { .. }
            | ClaudeFrame::User(_) => self.on_content(&frame).await,
        }
    }

    /// A task report: the active turn's sub-agent item takes its status, and
    /// a report delivered to this conversation becomes an item now (a turn
    /// runs) or when the next turn begins. It never wakes a turn by itself:
    /// Claude's own output for the wake does.
    async fn on_task_report(&mut self, frame: &ClaudeFrame, report: &TaskReport) {
        let delivered = self.task_reports.delivered(report, |tool_use_id| {
            self.active
                .as_ref()
                .is_some_and(|active| active.builder.is_open_tool_call(tool_use_id))
        });
        let Some(active) = &mut self.active else {
            if let Some(delivered) = delivered {
                self.task_reports.wait(delivered);
            }
            return;
        };
        let mut events = active.builder.on_frame(frame);
        if let Some(delivered) = delivered {
            // A provider turn that has nothing yet is the turn the report wakes.
            let delivery =
                if active.builder.origin() == TurnOrigin::Provider && active.builder.is_empty() {
                    TaskNotificationDelivery::Wake
                } else {
                    TaskNotificationDelivery::MidTurn
                };
            events.extend(active.builder.add_task_notification(
                &delivered.report,
                delivery,
                delivered.identity,
            ));
        }
        self.emit_all(events).await;
    }

    /// Lets the rate-limit owner read usage through this query when a read is due.
    fn result_seen(&self) {
        let Some(query) = &self.query else {
            return;
        };
        if !self.deps.rate_limits.claim_usage_read() {
            return;
        }
        let read = query.handle.read_usage();
        let internal = self.internal.clone();
        tokio::spawn(async move {
            match read.await {
                Ok(response) => {
                    let _ = internal.send(Internal::UsageRead(response));
                }
                Err(err) => tracing::debug!(err = %err, "claude usage read failed"),
            }
        });
    }

    async fn on_init(&mut self, mcp_servers: Vec<String>) {
        if let Some(active) = &mut self.active {
            active.builder.set_mcp_servers(mcp_servers.clone());
        }
        self.mcp_servers = mcp_servers;
        if !self.state.session_started {
            self.state.session_started = true;
            self.persist();
        }
        self.output(super::ports::SessionOutput::SessionReady(
            self.app_thread_id.clone(),
        ))
        .await;
    }

    /// The active turn, or a provider turn started for Claude's own work.
    pub(super) async fn active_or_wake(&mut self) {
        if self.active.is_some() {
            return;
        }
        self.clear_idle_timer();
        let uuid = self.new_uuid();
        let Some(turn_id) = TurnId::parse(&uuid) else {
            tracing::error!(app_thread_id = %self.app_thread_id, "{INVALID_UUID}");
            return;
        };
        self.begin_turn(TurnStart {
            first_offer: None,
            origin: TurnOrigin::Provider,
            waiting_reports: TaskNotificationDelivery::Wake,
            prompts: Vec::new(),
            turn_id,
            user_message: None,
        })
        .await;
    }

    async fn on_content(&mut self, frame: &ClaudeFrame) {
        if !is_top_level_content(frame) {
            return;
        }
        self.active_or_wake().await;
        let now = self.now_ms();
        let Some(active) = &mut self.active else {
            return;
        };
        if let Some(uuid) = persisted_uuid(frame)
            && !active.frame_anchored
        {
            active.frame_anchored = true;
            active.anchors.push(uuid.to_owned());
        }
        // The context size of the latest top-level request; a compaction
        // makes the earlier size meaningless until the next request.
        match frame {
            ClaudeFrame::Assistant(assistant) => {
                if let Some(usage) = &assistant.usage {
                    active.last_request = Some(request_usage(usage));
                    self.last_request = active.last_request;
                }
            }
            ClaudeFrame::CompactBoundary { .. } => {
                active.last_request = None;
                self.last_request = None;
            }
            _ => {}
        }
        let mut events = Vec::new();
        if let Some(request) = active.live_usage.observe(frame) {
            let measured = add_usage(
                self.state.total_usage,
                active
                    .usage
                    .as_ref()
                    .map_or(ZERO_USAGE, |usage| usage.usage),
            );
            let context_window = self
                .context_window
                .or_else(|| request.model.as_deref().and_then(model_context_window));
            events.push(active.builder.live_usage(LiveUsage {
                context_window,
                last: request.usage,
                total: add_usage(measured, active.live_usage.since_result()),
                model: request.model,
            }));
        }
        active.builder.set_now(now);
        events.extend(active.builder.on_frame(frame));
        self.emit_all(events).await;
    }

    /// Adds the usage a result measures (against the session's persisted
    /// totals) to the active turn, including results that do not end it.
    fn meter(&mut self, frame: &ResultFrame) {
        let Some(active) = &mut self.active else {
            return;
        };
        active.live_usage.result_measured();
        let Some(delta) = meter_result(&mut self.state.usage_baseline, ResultFigures::of(frame))
        else {
            return;
        };
        if delta.context_window.is_some() {
            self.context_window = delta.context_window;
        }
        active.usage = Some(add_delta(active.usage.take(), delta));
        self.persist();
    }

    /// A result that does not end the active turn: the `aborted_*` restart a
    /// steer causes, or a provider-initiated result inside a user turn.
    fn is_intermediate_result(&mut self, frame: &ResultFrame) -> bool {
        let Some(active) = &mut self.active else {
            return false;
        };
        if active.interrupt_requested {
            return false;
        }
        if is_interruption(frame) && active.pending_steer_aborts > 0 {
            active.pending_steer_aborts -= 1;
            return true;
        }
        active.builder.origin() == TurnOrigin::User && frame.origin.is_some()
    }

    async fn on_result(&mut self, frame: &ResultFrame) {
        if self.active.is_none() {
            // Not measured: the baseline stays, so the next turn's first result counts it.
            return;
        }
        self.meter(frame);
        if is_lost_session(frame) {
            self.replace_lost_session().await;
            return;
        }
        if self.is_intermediate_result(frame) {
            return;
        }
        let Some(active) = &self.active else {
            return;
        };
        let outcome = if active.interrupt_requested && is_interruption(frame) {
            TurnOutcome::Interrupted
        } else {
            turn_outcome(frame, active.builder.assistant_error())
        };
        self.finish_turn(outcome).await;
    }

    async fn replace_lost_session(&mut self) {
        let Some(active) = &mut self.active else {
            return;
        };
        if active.session_replacements >= 1 || active.first_offer.is_none() {
            self.close_query().await;
            self.finish_turn(TurnOutcome::Failed(TurnError {
                kind: TurnErrorKind::SessionLost,
                message: "The Claude session for this thread was lost.".into(),
            }))
            .await;
            return;
        }
        active.session_replacements += 1;
        let turn_id = active.builder.turn_id().clone();
        self.close_query().await;
        let session_id = self.new_uuid();
        warn!(app_thread_id = %self.app_thread_id, claude_session_id = %session_id, "claude session was lost; starting a replacement session");
        self.state.session_ids.push(session_id);
        self.state.session_started = false;
        self.state.usage_baseline = NEW_SESSION_BASELINE;
        self.persist();
        let lines = self.deps.history.lines(&self.state);
        let internal = self.internal.clone();
        tokio::spawn(async move {
            let lines = lines.await;
            let _ = internal.send(Internal::HistoryLines { turn_id, lines });
        });
    }

    pub(super) fn offer_replacement(&mut self, turn_id: &TurnId, lines: &[String]) {
        if self.disposed {
            return;
        }
        let uuid = self.new_uuid();
        let Some(active) = self
            .active
            .as_mut()
            .filter(|active| active.builder.turn_id() == turn_id)
        else {
            return;
        };
        let Some(first_offer) = active.first_offer.clone() else {
            return;
        };
        let content = match history_prefix(lines) {
            Some(prefix) => std::iter::once(json!({"type": "text", "text": prefix}))
                .chain(first_offer)
                .collect(),
            None => first_offer,
        };
        active.prompts.push(PromptRecord {
            client_message_id: None,
            role: PromptRole::Resend,
            uuid: Some(uuid.clone()),
        });
        active.anchors.push(uuid.clone());
        self.record_active_turn(TurnOutcomeRecord::InProgress, None);
        if let Some(query) = self.ensure_query() {
            query.offer(Offer {
                content,
                uuid: Some(uuid),
                priority: Priority::Queued,
            });
        }
    }

    /// The usage a finished turn reports and the thread's totals after it;
    /// `None` when no result measured anything (the next turn counts it).
    fn turn_usage(&self, active: &ActiveTurn) -> Option<TurnUsageRecord> {
        let measured = active.usage.as_ref()?;
        let total_cost = thread_cost_after(self.state.total_cost, &measured.cost);
        Some(TurnUsageRecord {
            last: active
                .last_request
                .or(self.last_request)
                .unwrap_or(ZERO_USAGE),
            turn: measured.usage,
            total: add_usage(self.state.total_usage, measured.usage),
            context_window: measured.context_window,
            cost: provider_cost(&measured.cost, total_cost),
        })
    }

    pub(super) async fn finish_turn(&mut self, outcome: TurnOutcome) {
        let Some(mut active) = self.active.take() else {
            return;
        };
        let reason = if matches!(outcome, TurnOutcome::Interrupted) {
            RequestResolution::Cancelled
        } else {
            RequestResolution::TurnEnded
        };
        self.cancel_tool_calls();
        self.resolve_all_pending(reason).await;
        let usage = self.turn_usage(&active);
        if let Some(measured) = &active.usage {
            self.state.total_cost = thread_cost_after(self.state.total_cost, &measured.cost);
            self.state.total_usage = add_usage(self.state.total_usage, measured.usage);
        }
        let now = self.now_ms();
        active.builder.set_now(now);
        let (events, _) = active.builder.finish(&outcome, usage.as_ref());
        let release_after = active.release_after;
        self.active = Some(active);
        self.record_active_turn(outcome_record(&outcome), usage);
        self.active = None;
        self.state.updated_at = seconds(now);
        self.persist();
        self.write_active_turn(None);
        self.publish_status();
        self.emit_all(events).await;
        self.emit_thread_updated().await;
        if release_after {
            self.close_query().await;
        }
        self.apply_pending_settings_if_possible().await;
        self.arm_idle_timer();
    }
}
