//! The session actor: one task per thread that owns the thread's state, its
//! query and its active turn, and handles commands, query events, finished
//! background work and timers one at a time.
//!
//! Lifecycle: no query → a turn opens one (the first open uses the session
//! id, every later one resumes it) → idle after the turn → closed after the
//! idle release, an interrupt that did not settle, a settings change that
//! needs a reopen, or process loss.

use std::{
    collections::HashMap,
    sync::{Arc, atomic::Ordering},
};

use agent_core::model::{
    AgentEvent, AppThreadId, RequestResolution, ThreadSettings, TokenUsage, TurnId,
};
use serde_json::Value;
use tokio::{
    sync::{mpsc, watch},
    time::Instant,
};
use tracing::{error, info, warn};

use super::{
    client_tools::ClientToolCalls,
    handle::{Command, SessionStatus},
    ports::{SessionDeps, SessionOutput},
    query::Query,
    task_reports::LiveTaskReports,
    turn::ActiveTurn,
};
use crate::{
    cli::{
        command::{QueryOptions, SessionIdentity},
        process::ProcessEvent,
    },
    live::permissions::profile_of,
    state::thread_state::ThreadState,
    transcript::{
        json::JsonRecord,
        result::{PROCESS_EXITED_MESSAGE, TurnOutcome, process_exited_error},
    },
};
use agent_core::model::{ClientToolSpec, TurnError, TurnErrorKind, UserInputQuestion};

pub(super) const MS_PER_SECOND: i64 = 1000;

pub(super) const fn seconds(ms: i64) -> i64 {
    ms.div_euclid(MS_PER_SECOND)
}

/// The open query and its event stream.
pub(super) struct LiveQuery {
    pub handle: Arc<dyn Query>,
    pub events: mpsc::Receiver<ProcessEvent>,
}

/// A runtime request waiting for the user's answer.
pub(super) struct PendingRequest {
    /// The `can_use_tool` request it answers.
    pub claude_request_id: String,
    pub tool_use_id: String,
    pub input: JsonRecord,
    pub kind: PendingKind,
}

pub(super) enum PendingKind {
    Approval { suggestions: Vec<Value> },
    UserInput { questions: Vec<UserInputQuestion> },
}

/// Background work that reports back to the actor.
pub(super) enum Internal {
    ToolCallDone {
        call_id: String,
        request_id: String,
        mcp_id: Value,
        result: agent_core::model::ToolCallResult,
    },
    ModeChangeFailed {
        generation: u64,
        error: String,
    },
    UsageRead(Value),
    HistoryLines {
        turn_id: TurnId,
        lines: Vec<String>,
    },
}

pub(super) struct Session {
    pub deps: Arc<SessionDeps>,
    pub app_thread_id: AppThreadId,
    pub state: ThreadState,
    state_tx: watch::Sender<Arc<ThreadState>>,
    status_tx: watch::Sender<SessionStatus>,
    pub internal: mpsc::UnboundedSender<Internal>,
    pub query: Option<LiveQuery>,
    /// Bumped whenever the query is opened or closed; late results of an
    /// earlier query compare against it.
    pub generation: u64,
    pub active: Option<ActiveTurn>,
    pub pending: HashMap<String, PendingRequest>,
    pub background_tasks: usize,
    /// Background tasks of the open query and their reports waiting for a turn.
    pub task_reports: LiveTaskReports,
    /// The context size of the session's latest top-level model request.
    pub last_request: Option<TokenUsage>,
    /// The context window Claude last reported for the thread's model.
    pub context_window: Option<i64>,
    pub mcp_servers: Vec<String>,
    pub idle_deadline: Option<Instant>,
    pub idle_since_ms: Option<i64>,
    pub disposed: bool,
    pub tool_calls: ClientToolCalls,
    /// The client tools the open query was opened with.
    pub query_tools: Vec<ClientToolSpec>,
    /// Whether the open query may enter `bypassPermissions`.
    pub query_allows_bypass: bool,
    /// A live permission mode change failed: the query is closed at the next boundary.
    pub query_mode_outdated: bool,
}

impl Session {
    pub(super) fn new(
        deps: Arc<SessionDeps>,
        state: ThreadState,
        state_tx: watch::Sender<Arc<ThreadState>>,
        status_tx: watch::Sender<SessionStatus>,
        internal: mpsc::UnboundedSender<Internal>,
    ) -> Self {
        Self {
            app_thread_id: state.app_thread_id.clone(),
            deps,
            state,
            state_tx,
            status_tx,
            internal,
            query: None,
            generation: 0,
            active: None,
            pending: HashMap::new(),
            background_tasks: 0,
            task_reports: LiveTaskReports::default(),
            last_request: None,
            context_window: None,
            mcp_servers: Vec::new(),
            idle_deadline: None,
            idle_since_ms: None,
            disposed: false,
            tool_calls: ClientToolCalls::default(),
            query_tools: Vec::new(),
            query_allows_bypass: false,
            query_mode_outdated: false,
        }
    }

    /// Runs until the owner drops every handle.
    pub(super) async fn run(
        mut self,
        mut commands: mpsc::UnboundedReceiver<Command>,
        mut internal: mpsc::UnboundedReceiver<Internal>,
    ) {
        loop {
            let interrupt_deadline = self
                .active
                .as_ref()
                .and_then(|active| active.interrupt_deadline);
            // Claude's output first, then finished background work, then
            // commands: a command sees every event Claude wrote before it
            // was handled, so its answer reflects them.
            tokio::select! {
                biased;
                event = next_event(self.query.as_mut()) => self.on_query_event(event).await,
                Some(done) = internal.recv() => self.on_internal(done).await,
                command = commands.recv() => {
                    let Some(command) = command else {
                        self.dispose().await;
                        return;
                    };
                    self.on_command(command).await;
                }
                () = sleep_until(interrupt_deadline) => self.on_interrupt_timeout().await,
                () = sleep_until(self.idle_deadline) => self.on_idle_timer().await,
            }
        }
    }

    async fn on_command(&mut self, command: Command) {
        match command {
            Command::StartTurn { request, reply } => {
                let _ = reply.send(self.start_turn(request).await);
            }
            Command::Steer {
                expected,
                message,
                reply,
            } => {
                let _ = reply.send(self.steer(&expected, message).await);
            }
            Command::Interrupt {
                turn_id,
                known_turn,
                reply,
            } => {
                let _ = reply.send(self.interrupt(turn_id.as_ref(), known_turn).await);
            }
            Command::Respond {
                request_id,
                response,
                reply,
            } => {
                let _ = reply.send(self.respond(&request_id, &response).await);
            }
            Command::UpdateSettings { next, reply } => {
                let _ = reply.send(self.update_settings(next).await);
            }
            Command::Edit { change, reply } => {
                change(&mut self.state);
                self.persist();
                let _ = reply.send(self.state_tx.borrow().clone());
            }
            Command::Read { fenced, reply } => {
                let fence = if fenced {
                    let (sender, receiver) = tokio::sync::oneshot::channel();
                    self.output(SessionOutput::Fence(sender)).await;
                    Some(receiver)
                } else {
                    None
                };
                let active = self.active.as_ref().map(|active| active.builder.snapshot());
                let _ = reply.send((self.state_tx.borrow().clone(), active, fence));
            }
            Command::BackgroundTask { task_id, reply } => {
                let _ = reply.send(self.task_reports.state(&task_id));
            }
            Command::Dispose { reply } => {
                self.dispose().await;
                let _ = reply.send(());
            }
        }
    }

    async fn on_query_event(&mut self, event: Option<ProcessEvent>) {
        match event {
            Some(ProcessEvent::Message(message)) => self.on_message(&message).await,
            Some(ProcessEvent::Request {
                request_id,
                request,
            }) => self.on_control_request(request_id, request).await,
            Some(ProcessEvent::Cancelled { request_id }) => {
                self.on_request_cancelled(&request_id).await;
            }
            Some(ProcessEvent::Exited { error }) => self.on_query_ended(error).await,
            // The stream ends after `Exited`; a stream that ends without it
            // ended the same way.
            None => self.on_query_ended(None).await,
        }
    }

    async fn on_internal(&mut self, done: Internal) {
        match done {
            Internal::ToolCallDone {
                call_id,
                request_id,
                mcp_id,
                result,
            } => self.on_tool_call_done(&call_id, request_id, &mcp_id, &result),
            Internal::ModeChangeFailed { generation, error } => {
                if generation == self.generation {
                    self.query_mode_outdated = true;
                    error!(
                        app_thread_id = %self.app_thread_id,
                        err = %error,
                        "claude permission mode change failed; the session reopens at the next turn"
                    );
                    self.apply_pending_settings_if_possible().await;
                }
            }
            Internal::UsageRead(response) => self.deps.rate_limits.usage_read(&response),
            Internal::HistoryLines { turn_id, lines } => {
                self.offer_replacement(&turn_id, &lines);
            }
        }
    }

    // ------------------------------------------------------------ outputs

    pub(super) fn now_ms(&self) -> i64 {
        (self.deps.clock)()
    }

    pub(super) fn new_uuid(&self) -> String {
        (self.deps.new_uuid)()
    }

    pub(super) async fn output(&self, output: SessionOutput) {
        // The owner keeps the receiver for as long as any session runs.
        let _ = self.deps.outputs.send(output).await;
    }

    /// Emits events in order. When an item started or completed, the
    /// in-flight snapshot is persisted first, so a restart can finalize the
    /// turn with every item the client has already seen.
    pub(super) async fn emit_all(&self, events: Vec<AgentEvent>) {
        if let Some(active) = &self.active
            && events.iter().any(|event| {
                matches!(
                    event,
                    AgentEvent::ItemStarted { .. } | AgentEvent::ItemCompleted { .. }
                )
            })
        {
            self.write_active_turn(Some(&active.builder.snapshot()));
        }
        for event in events {
            self.output(SessionOutput::Event(Box::new(event))).await;
        }
    }

    pub(super) async fn emit_thread_updated(&self) {
        self.output(SessionOutput::ThreadUpdated(self.app_thread_id.clone()))
            .await;
    }

    pub(super) async fn resolve_request(&self, request_id: &str, reason: RequestResolution) {
        self.emit_all(vec![AgentEvent::RequestResolved {
            app_thread_id: self.app_thread_id.clone(),
            request_id: agent_core::model::NativeRequestId::Text(request_id.to_owned()),
            reason,
        }])
        .await;
    }

    /// Persists and publishes the state.
    pub(super) fn persist(&self) {
        if let Err(err) = self.deps.persistence.write(&self.state) {
            error!(app_thread_id = %self.app_thread_id, err = %err, "thread state could not be written");
        }
        self.state_tx.send_replace(Arc::new(self.state.clone()));
    }

    pub(super) fn write_active_turn(&self, turn: Option<&agent_core::model::AgentTurn>) {
        if let Err(err) = self
            .deps
            .persistence
            .write_active_turn(&self.app_thread_id, turn)
        {
            error!(app_thread_id = %self.app_thread_id, err = %err, "in-flight turn could not be written");
        }
    }

    pub(super) fn publish_status(&self) {
        self.status_tx.send_replace(SessionStatus {
            active_turn_id: self
                .active
                .as_ref()
                .map(|active| active.builder.turn_id().clone()),
            live: self.query.is_some(),
        });
    }

    // -------------------------------------------------------------- query

    /// The open query, opened when none is.
    pub(super) fn ensure_query(&mut self) -> Option<Arc<dyn Query>> {
        if let Some(query) = &self.query {
            return Some(query.handle.clone());
        }
        let settings = self.state.settings.clone();
        let profile = profile_of(&settings.permission_profile).options();
        let session_id = self.state.current_session_id().to_owned();
        let tools = self.deps.client_tools.specs();
        let options = QueryOptions {
            executable: self.deps.executable.clone(),
            cwd: self.state.cwd.clone().into(),
            model: settings.model,
            effort: settings.effort,
            identity: if self.state.session_started {
                SessionIdentity::Resume(session_id)
            } else {
                SessionIdentity::New(session_id)
            },
            client_tools: !tools.is_empty(),
            profile,
        };
        match self.deps.runtime.open(&options) {
            Ok((handle, events)) => {
                self.query = Some(LiveQuery {
                    handle: handle.clone(),
                    events,
                });
                self.query_tools = tools;
                self.query_allows_bypass = options.profile.allow_dangerously_skip_permissions;
                self.query_mode_outdated = false;
                self.generation += 1;
                let live = self.deps.live_sessions.fetch_add(1, Ordering::Relaxed) + 1;
                info!(
                    app_thread_id = %self.app_thread_id,
                    live_sessions = live,
                    resumed = self.state.session_started,
                    "claude session opened"
                );
                self.publish_status();
                Some(handle)
            }
            Err(err) => {
                error!(app_thread_id = %self.app_thread_id, err = %err, "claude session could not be started");
                None
            }
        }
    }

    /// Closes the current query and ignores its remaining output.
    pub(super) async fn close_query(&mut self) {
        let Some(query) = self.query.take() else {
            return;
        };
        self.generation += 1;
        self.task_reports.forget();
        query.handle.close();
        self.released().await;
        info!(
            app_thread_id = %self.app_thread_id,
            live_sessions = self.deps.live_sessions.load(Ordering::Relaxed),
            "claude session released"
        );
    }

    /// Reports the release before the process stops counting as live, so a
    /// running-sessions read in between does not take the exiting process
    /// for another one.
    async fn released(&self) {
        self.output(SessionOutput::Released {
            app_thread_id: self.app_thread_id.clone(),
            session_id: self.state.current_session_id().to_owned(),
        })
        .await;
        self.deps.live_sessions.fetch_sub(1, Ordering::Relaxed);
        self.publish_status();
    }

    async fn on_query_ended(&mut self, error: Option<String>) {
        if self.query.take().is_none() {
            return;
        }
        self.generation += 1;
        self.task_reports.forget();
        self.released().await;
        match &error {
            None => info!(app_thread_id = %self.app_thread_id, "claude session ended"),
            Some(stderr) => warn!(
                app_thread_id = %self.app_thread_id,
                stderr_bytes = stderr.len(),
                "claude session ended with errors"
            ),
        }
        let Some(active) = &self.active else {
            self.idle_deadline = None;
            self.idle_since_ms = None;
            self.emit_thread_updated().await;
            return;
        };
        let outcome = if active.interrupt_requested {
            TurnOutcome::Interrupted
        } else {
            TurnOutcome::Failed(match error {
                None => TurnError {
                    kind: TurnErrorKind::ProcessExited,
                    message: PROCESS_EXITED_MESSAGE.into(),
                },
                Some(stderr) => process_exited_error(&stderr),
            })
        };
        self.finish_turn(outcome).await;
    }

    // --------------------------------------------------------------- idle

    pub(super) fn clear_idle_timer(&mut self) {
        self.idle_deadline = None;
        self.idle_since_ms = None;
    }

    pub(super) fn arm_idle_timer(&mut self) {
        if self.disposed || self.query.is_none() {
            return;
        }
        if self.idle_since_ms.is_none() {
            self.idle_since_ms = Some(self.now_ms());
        }
        self.idle_deadline = Some(Instant::now() + self.deps.config.idle_release);
    }

    async fn on_idle_timer(&mut self) {
        self.idle_deadline = None;
        if self.active.is_some() || !self.pending.is_empty() || self.query.is_none() {
            return;
        }
        let now = self.now_ms();
        let idle_for = now - self.idle_since_ms.unwrap_or(now);
        let defer_max =
            i64::try_from(self.deps.config.background_defer_max.as_millis()).unwrap_or(i64::MAX);
        if self.background_tasks > 0 && idle_for < defer_max {
            self.idle_deadline = Some(Instant::now() + self.deps.config.idle_release);
            return;
        }
        self.idle_since_ms = None;
        self.close_query().await;
        self.emit_thread_updated().await;
    }

    /// Ends the session for good (thread deleted or shutdown).
    pub(super) async fn dispose(&mut self) {
        self.disposed = true;
        self.clear_idle_timer();
        if let Some(active) = &mut self.active {
            active.interrupt_requested = true;
            self.close_query().await;
            self.finish_turn(TurnOutcome::Interrupted).await;
        }
        self.close_query().await;
    }

    pub(super) fn settings_differ(left: &ThreadSettings, right: &ThreadSettings) -> bool {
        left.effort != right.effort
            || left.model != right.model
            || left.permission_profile != right.permission_profile
            || left.service_tier != right.service_tier
    }
}

async fn next_event(query: Option<&mut LiveQuery>) -> Option<ProcessEvent> {
    match query {
        Some(query) => query.events.recv().await,
        None => std::future::pending().await,
    }
}

async fn sleep_until(deadline: Option<Instant>) {
    match deadline {
        Some(deadline) => tokio::time::sleep_until(deadline).await,
        None => std::future::pending().await,
    }
}
