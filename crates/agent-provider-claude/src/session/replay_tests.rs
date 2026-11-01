//! Fixture replay: every recorded Claude transcript through a real session
//! with a scripted query, compared with the neutral golden event streams.
//!
//! The transcript is one shared cursor, as in the host's replay harness. A
//! scripted query feeds `emit_inbound` frames to the session and turns
//! `permission.request` frames into `can_use_tool` requests (waiting for the
//! session's answer); the driver performs `expect_outbound` actions through
//! the session handle: `prompt.offer` → start (or steer for priority `now`,
//! or `/compact`), `query.interrupt` → interrupt. Runtime requests are
//! answered from the recorded `permission.response`; a start answered
//! `busy` is reissued after that turn completes. Ids are deterministic.
//! Times are not compared: the clock is read at different points than in
//! the host, so time fields are blanked on both sides.

use std::{
    path::{Path, PathBuf},
    sync::{
        Arc, Mutex, PoisonError,
        atomic::{AtomicI64, AtomicU64, AtomicUsize, Ordering},
    },
    time::Duration,
};

use agent_core::model::{
    AgentEvent, AgentItem, AgentTurn, AppThreadId, ClientMessageId, ClientToolSpec,
    NativeThreadPresence, NativeTitleOverride, ProviderRateLimitWindow, RuntimeRequest,
    RuntimeResponse, ThreadSettings, ToolCallParams, ToolCallResult, TurnStartResult, UserContent,
    UserInputAnswer,
};
use serde_json::{Value, json};
use tokio::sync::{Notify, mpsc, watch};

use super::{
    handle::SessionHandle,
    ports::{
        ClientTools, HistoryLines, RateLimitSink, SessionConfig, SessionDeps, SessionOutput,
        StatePersistence,
    },
    query::{BoxFuture, Offer, Query, QueryRuntime},
    turn::{SteerMessage, TurnRequest},
};
use crate::{
    cli::{
        command::QueryOptions,
        process::{ProcessError, ProcessEvent},
        protocol::{ControlRequest, Priority},
    },
    live::usage::{NEW_SESSION_BASELINE, ThreadCost, ZERO_USAGE},
    state::thread_state::{SessionChain, StateVersion, ThreadState, ThreadStateOrigin},
};

const THREAD: &str = "00000000-0000-4000-8000-0000000000aa";
type TestResult = Result<(), Box<dyn std::error::Error>>;

fn fixtures() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("fixtures")
}

/// The shared transcript cursor.
struct Script {
    entries: Vec<Value>,
    cursor: watch::Sender<usize>,
    /// Set while a busy start waits for the turn to end; frames after a
    /// result wait for it.
    deferred: Mutex<Option<Vec<UserContent>>>,
    gate: Notify,
    gated: std::sync::atomic::AtomicBool,
    /// Answers the scripted query received, by request id.
    answered: Notify,
    answers: Mutex<Vec<(String, Result<Value, String>)>>,
    opens: Mutex<Vec<QueryOptions>>,
    offers: Mutex<Vec<Offer>>,
    next_request: AtomicU64,
    session: std::sync::OnceLock<SessionHandle>,
}

impl Script {
    fn entry(&self, at: usize) -> Option<&Value> {
        self.entries.get(at)
    }

    fn at(&self) -> usize {
        *self.cursor.borrow()
    }

    fn advance(&self) {
        self.cursor.send_modify(|cursor| *cursor += 1);
    }

    /// Returns once the session handled every event sent before: its loop
    /// takes Claude's output before commands.
    async fn handled(&self) {
        if let Some(session) = self.session.get() {
            let _ = session.read(false).await;
        }
    }
}

fn kind(entry: &Value) -> &str {
    entry["type"].as_str().unwrap_or_default()
}

fn frame_kind(entry: &Value) -> &str {
    entry["frame"]["type"].as_str().unwrap_or_default()
}

struct ScriptedRuntime(Arc<Script>);

struct ScriptedQuery {
    script: Arc<Script>,
    closed: Arc<Notify>,
    is_closed: Arc<std::sync::atomic::AtomicBool>,
}

impl QueryRuntime for ScriptedRuntime {
    fn open(
        &self,
        options: &QueryOptions,
    ) -> Result<(Arc<dyn Query>, mpsc::Receiver<ProcessEvent>), ProcessError> {
        self.0
            .opens
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .push(options.clone());
        let (events, receiver) = mpsc::channel(64);
        let closed = Arc::new(Notify::new());
        let is_closed = Arc::new(std::sync::atomic::AtomicBool::new(false));
        tokio::spawn(feed(
            self.0.clone(),
            events,
            closed.clone(),
            is_closed.clone(),
        ));
        Ok((
            Arc::new(ScriptedQuery {
                script: self.0.clone(),
                closed,
                is_closed,
            }),
            receiver,
        ))
    }
}

impl Query for ScriptedQuery {
    fn offer(&self, offer: Offer) {
        self.script
            .offers
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .push(offer);
    }

    fn respond(&self, request_id: String, outcome: Result<Value, String>) {
        self.script
            .answers
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .push((request_id, outcome));
        self.script.answered.notify_waiters();
    }

    fn interrupt(&self) -> BoxFuture<'static, Result<(), ProcessError>> {
        Box::pin(async { Ok(()) })
    }

    fn set_permission_mode(&self, _: &'static str) -> BoxFuture<'static, Result<(), ProcessError>> {
        Box::pin(async { Ok(()) })
    }

    fn read_usage(&self) -> BoxFuture<'static, Result<Value, ProcessError>> {
        Box::pin(async { Err(ProcessError::Ended) })
    }

    fn close(&self) {
        self.is_closed.store(true, Ordering::SeqCst);
        self.closed.notify_waiters();
    }
}

/// The scripted query's output: walks the shared cursor like Claude's
/// stdout, waiting at every `expect_outbound` for the driver.
async fn feed(
    script: Arc<Script>,
    events: mpsc::Sender<ProcessEvent>,
    closed: Arc<Notify>,
    is_closed: Arc<std::sync::atomic::AtomicBool>,
) {
    let mut cursor = script.cursor.subscribe();
    loop {
        if is_closed.load(Ordering::SeqCst) {
            return;
        }
        let at = script.at();
        let Some(entry) = script.entry(at).cloned() else {
            let _ = events.send(ProcessEvent::Exited { error: None }).await;
            return;
        };
        match kind(&entry) {
            "transcript_start" => script.advance(),
            "expect_outbound" => {
                tokio::select! {
                    _ = cursor.changed() => {}
                    () = closed.notified() => return,
                }
            }
            "runtime_exit" => {
                let error = (entry["status"] != "success").then(|| {
                    format!(
                        "recorded runtime exit: {}",
                        entry["status"].as_str().unwrap_or("unknown")
                    )
                });
                let _ = events.send(ProcessEvent::Exited { error }).await;
                script.advance();
                return;
            }
            _ => {
                if script.gated.load(Ordering::SeqCst) {
                    script.gate.notified().await;
                    continue;
                }
                let frame = entry["frame"].clone();
                if frame["type"] == "permission.request" {
                    if !ask_permission(&script, &events, &frame).await {
                        return;
                    }
                    continue;
                }
                script.advance();
                if frame["type"] == "result"
                    && script
                        .deferred
                        .lock()
                        .unwrap_or_else(PoisonError::into_inner)
                        .is_some()
                {
                    script.gated.store(true, Ordering::SeqCst);
                }
                if events.send(ProcessEvent::Message(frame)).await.is_err() {
                    return;
                }
                // Like Claude's stdout read by the session: the next frame
                // is taken only after this one was handled, so a query the
                // frame closed takes no further frames.
                script.handled().await;
            }
        }
    }
}

/// Sends a recorded `permission.request` as `can_use_tool` and waits for
/// the session's answer; `false` when the session's query is gone.
async fn ask_permission(
    script: &Script,
    events: &mpsc::Sender<ProcessEvent>,
    frame: &Value,
) -> bool {
    script.advance();
    let request_id = format!("req-{}", script.next_request.fetch_add(1, Ordering::SeqCst));
    let options = &frame["options"];
    let request = ControlRequest::CanUseTool {
        tool_name: frame["toolName"].as_str().unwrap_or_default().to_owned(),
        input: frame["input"].as_object().cloned().unwrap_or_default(),
        tool_use_id: options["toolUseID"].as_str().map(ToOwned::to_owned),
        decision_reason: options["decisionReason"].as_str().map(ToOwned::to_owned),
        suggestions: options["suggestions"]
            .as_array()
            .cloned()
            .unwrap_or_default(),
        agent_id: options["agentID"].as_str().map(ToOwned::to_owned),
    };
    let answered = script.answered.notified();
    tokio::pin!(answered);
    answered.as_mut().enable();
    if events
        .send(ProcessEvent::Request {
            request_id: request_id.clone(),
            request,
        })
        .await
        .is_err()
    {
        return false;
    }
    loop {
        let done = script
            .answers
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .iter()
            .any(|(id, _)| *id == request_id);
        if done {
            break;
        }
        answered.as_mut().await;
        answered.set(script.answered.notified());
        answered.as_mut().enable();
    }
    if script
        .entry(script.at())
        .is_some_and(|next| frame_kind(next) == "permission.response")
    {
        script.advance();
    }
    true
}

struct MemoryPersistence;

impl StatePersistence for MemoryPersistence {
    fn write(&self, _: &ThreadState) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        Ok(())
    }

    fn write_active_turn(
        &self,
        _: &AppThreadId,
        _: Option<&AgentTurn>,
    ) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        Ok(())
    }
}

struct NoClientTools;

impl ClientTools for NoClientTools {
    fn specs(&self) -> Vec<ClientToolSpec> {
        Vec::new()
    }

    fn call(&self, _: ToolCallParams) -> BoxFuture<'static, ToolCallResult> {
        Box::pin(async { ToolCallResult::failure("replays declare no client tools".into()) })
    }
}

/// History lines from the turns the replay completed.
struct CompletedHistory(Arc<Mutex<Vec<AgentTurn>>>);

impl HistoryLines for CompletedHistory {
    fn lines(&self, _: &ThreadState) -> BoxFuture<'static, Vec<String>> {
        let lines = self
            .0
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .iter()
            .flat_map(|turn| turn.items.iter())
            .filter_map(|item| match item {
                AgentItem::UserMessage { content, .. } => {
                    let text = content
                        .iter()
                        .filter_map(|content| match content {
                            UserContent::Text { text } => Some(text.as_str()),
                            _ => None,
                        })
                        .collect::<Vec<_>>()
                        .join("\n");
                    (!text.is_empty()).then(|| format!("User: {text}"))
                }
                AgentItem::AgentMessage {
                    text,
                    phase: agent_core::model::MessagePhase::Final,
                    ..
                } => Some(format!("Claude: {text}")),
                _ => None,
            })
            .collect();
        Box::pin(async move { lines })
    }
}

struct NoRateLimits;

impl RateLimitSink for NoRateLimits {
    fn reported(&self, _: ProviderRateLimitWindow) {}

    fn claim_usage_read(&self) -> bool {
        false
    }

    fn usage_read(&self, _: &Value) {}
}

fn profile_for(entries: &[Value]) -> &'static str {
    let open = entries
        .iter()
        .find(|entry| kind(entry) == "expect_outbound" && frame_kind(entry) == "query.open");
    let options = open.map(|entry| &entry["frame"]["options"]);
    match options {
        Some(options) if options["tools"].is_array() => ":read-only",
        Some(options) if options["permissionMode"] == "bypassPermissions" => ":full-access",
        _ => ":workspace",
    }
}

fn thread_state(profile: &str) -> Result<ThreadState, Box<dyn std::error::Error>> {
    Ok(ThreadState {
        app_thread_id: AppThreadId::parse(THREAD).ok_or("thread id")?,
        created_at: 1_760_000_001,
        cwd: "/workspace".into(),
        origin: ThreadStateOrigin::Created,
        pending_settings: None,
        presence: NativeThreadPresence::Listed { archived: false },
        recency_at: None,
        session_ids: SessionChain::new(THREAD.into()),
        session_started: false,
        settings: ThreadSettings {
            model: "claude-sonnet-4-6".into(),
            effort: None,
            permission_profile: profile.into(),
            service_tier: None,
        },
        title: NativeTitleOverride::None,
        total_cost: ThreadCost::Known { usd: 0.0 },
        total_usage: ZERO_USAGE,
        turns: Vec::new(),
        updated_at: 1_760_000_001,
        usage_baseline: NEW_SESSION_BASELINE,
        version: StateVersion::default(),
    })
}

/// The recorded answer to an opened request.
fn response_for(recorded: Option<&Value>, request: &RuntimeRequest) -> RuntimeResponse {
    let result = recorded.map(|entry| &entry["frame"]["result"]);
    if let RuntimeRequest::UserInput { questions, .. } = request {
        let answers = result.map(|result| &result["updatedInput"]["answers"]);
        return RuntimeResponse::UserInput {
            answers: questions
                .iter()
                .map(|question| {
                    let answer = answers
                        .and_then(|answers| answers[question.question.as_str()].as_str())
                        .map(ToOwned::to_owned)
                        .or_else(|| question.options.first().map(|option| option.label.clone()))
                        .unwrap_or_default();
                    (
                        question.id.clone(),
                        UserInputAnswer {
                            answers: vec![answer],
                        },
                    )
                })
                .collect(),
        };
    }
    let decision = match result.map(|result| (&result["behavior"], &result["interrupt"])) {
        Some((behavior, interrupt)) if behavior == "deny" => {
            if interrupt == true {
                agent_core::model::ApprovalDecision::Cancel
            } else {
                agent_core::model::ApprovalDecision::Decline
            }
        }
        _ => agent_core::model::ApprovalDecision::Accept,
    };
    RuntimeResponse::Approval { decision }
}

fn offer_input(entry: &Value) -> (Vec<UserContent>, bool) {
    let message = &entry["frame"]["message"];
    let content = &message["message"]["content"];
    let text = match content {
        Value::String(text) => text.clone(),
        Value::Array(blocks) => blocks
            .iter()
            .map(|block| block["text"].as_str().unwrap_or_default())
            .collect::<Vec<_>>()
            .join("\n"),
        _ => String::new(),
    };
    (
        vec![UserContent::Text { text }],
        message["priority"] == "now",
    )
}

struct Replay {
    events: Vec<AgentEvent>,
    opens: Vec<QueryOptions>,
    offers: Vec<Offer>,
}

fn script_of(entries: Vec<Value>) -> Arc<Script> {
    let (cursor, _) = watch::channel(0);
    Arc::new(Script {
        entries,
        cursor,
        deferred: Mutex::new(None),
        gate: Notify::new(),
        gated: std::sync::atomic::AtomicBool::new(false),
        answered: Notify::new(),
        answers: Mutex::new(Vec::new()),
        opens: Mutex::new(Vec::new()),
        offers: Mutex::new(Vec::new()),
        next_request: AtomicU64::new(1),
        session: std::sync::OnceLock::new(),
    })
}

/// Deterministic ids and a clock advancing one second per read.
fn session_deps(
    script: &Arc<Script>,
    outputs: mpsc::Sender<SessionOutput>,
    completed: Arc<Mutex<Vec<AgentTurn>>>,
) -> Arc<SessionDeps> {
    let ids = AtomicU64::new(0);
    let clock = AtomicI64::new(1_760_000_000_000);
    Arc::new(SessionDeps {
        runtime: Arc::new(ScriptedRuntime(script.clone())),
        executable: "/usr/bin/claude".into(),
        clock: Arc::new(move || clock.fetch_add(1000, Ordering::SeqCst) + 1000),
        new_uuid: Arc::new(move || {
            format!(
                "00000000-0000-4000-8000-{:012}",
                ids.fetch_add(1, Ordering::SeqCst) + 1
            )
        }),
        persistence: Arc::new(MemoryPersistence),
        outputs,
        client_tools: Arc::new(NoClientTools),
        history: Arc::new(CompletedHistory(completed)),
        rate_limits: Arc::new(NoRateLimits),
        config: SessionConfig {
            idle_release: Duration::from_hours(1),
            background_defer_max: Duration::from_hours(4),
            interrupt_timeout: Duration::from_millis(200),
        },
        live_sessions: Arc::new(AtomicUsize::new(0)),
    })
}

/// Collects events, answers opened requests from the recording and
/// reissues a busy start once the turn completed.
async fn collect(
    mut outputs: mpsc::Receiver<SessionOutput>,
    script: Arc<Script>,
    session: SessionHandle,
    events: Arc<Mutex<Vec<AgentEvent>>>,
    completed: Arc<Mutex<Vec<AgentTurn>>>,
) {
    while let Some(output) = outputs.recv().await {
        let SessionOutput::Event(event) = output else {
            continue;
        };
        let event = *event;
        if let AgentEvent::RequestOpened {
            request_id,
            request,
            ..
        } = &event
        {
            let recorded = script.entries[script.at()..]
                .iter()
                .find(|entry| frame_kind(entry) == "permission.response");
            let response = response_for(recorded, request);
            let session = session.clone();
            let request_id = request_id.clone();
            tokio::spawn(async move {
                let _ = session.respond(request_id, response).await;
            });
        }
        if let AgentEvent::TurnCompleted { turn, .. } = &event {
            completed
                .lock()
                .unwrap_or_else(PoisonError::into_inner)
                .push(turn.clone());
            let deferred = script
                .deferred
                .lock()
                .unwrap_or_else(PoisonError::into_inner)
                .take();
            if let Some(input) = deferred {
                let session = session.clone();
                let script = script.clone();
                tokio::spawn(async move {
                    let _ = session
                        .start_turn(TurnRequest::User {
                            client_message_id: None,
                            input,
                        })
                        .await;
                    script.gated.store(false, Ordering::SeqCst);
                    script.gate.notify_waiters();
                });
            }
        }
        events
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .push(event);
    }
}

/// Performs one recorded `prompt.offer` through the session.
async fn offer(
    script: &Script,
    session: &SessionHandle,
    entry: &Value,
    client_message: usize,
) -> TestResult {
    let (input, now) = offer_input(entry);
    let client_message_id = ClientMessageId::parse(&format!("replay-{client_message}"));
    let compact = matches!(input.first(), Some(UserContent::Text { text }) if text == "/compact");
    if compact {
        let _ = session.start_turn(TurnRequest::Compact).await?;
    } else if let (true, Some(active)) = (now, session.status().active_turn_id) {
        let _ = session
            .steer(
                active,
                SteerMessage {
                    client_message_id,
                    input,
                },
            )
            .await?;
    } else {
        let started = session
            .start_turn(TurnRequest::User {
                client_message_id,
                input: input.clone(),
            })
            .await?;
        if matches!(started, Ok(TurnStartResult::Busy { .. })) {
            *script
                .deferred
                .lock()
                .unwrap_or_else(PoisonError::into_inner) = Some(input);
        }
    }
    Ok(())
}

/// Walks the transcript: performs the outbound actions and waits for the
/// scripted query to take every inbound entry.
async fn drive(script: &Script, session: &SessionHandle) -> TestResult {
    let mut client_messages = 0;
    let mut cursor = script.cursor.subscribe();
    while let Some(entry) = script.entry(script.at()) {
        let at = script.at();
        match (kind(entry), frame_kind(entry)) {
            ("transcript_start", _) | ("expect_outbound", "query.open") => {}
            ("expect_outbound", "prompt.offer") => {
                client_messages += 1;
                offer(script, session, entry, client_messages).await?;
            }
            ("expect_outbound", "query.interrupt") => {
                let _ = session
                    .interrupt(session.status().active_turn_id, true)
                    .await?;
            }
            _ => {
                let moved = tokio::time::timeout(
                    Duration::from_secs(2),
                    cursor.wait_for(|cursor| *cursor != at),
                )
                .await;
                if moved.is_err() {
                    return Err(format!(
                        "replay stalled at entry {at} ({} {})",
                        kind(entry),
                        entry["label"]
                    )
                    .into());
                }
                continue;
            }
        }
        script.advance();
    }
    Ok(())
}

async fn replay(entries: Vec<Value>) -> Result<Replay, Box<dyn std::error::Error>> {
    let profile = profile_for(&entries);
    let script = script_of(entries);
    let (outputs, output_queue) = mpsc::channel(1024);
    let completed = Arc::new(Mutex::new(Vec::new()));
    let deps = session_deps(&script, outputs, completed.clone());
    let session = SessionHandle::spawn(thread_state(profile)?, deps);
    let _ = script.session.set(session.clone());
    let events = Arc::new(Mutex::new(Vec::new()));
    let collector = tokio::spawn(collect(
        output_queue,
        script.clone(),
        session.clone(),
        events.clone(),
        completed,
    ));
    drive(&script, &session).await?;
    // Let the last frames, timers and background work settle.
    tokio::time::sleep(Duration::from_millis(250)).await;
    session.dispose().await?;
    tokio::time::sleep(Duration::from_millis(50)).await;
    collector.abort();
    let events = std::mem::take(&mut *events.lock().unwrap_or_else(PoisonError::into_inner));
    Ok(Replay {
        events,
        opens: std::mem::take(&mut *script.opens.lock().unwrap_or_else(PoisonError::into_inner)),
        offers: std::mem::take(&mut *script.offers.lock().unwrap_or_else(PoisonError::into_inner)),
    })
}

fn load(path: &Path) -> Result<Vec<Value>, Box<dyn std::error::Error>> {
    std::fs::read_to_string(path)?
        .lines()
        .filter(|line| !line.trim().is_empty())
        .map(|line| serde_json::from_str(line).map_err(Into::into))
        .collect()
}

const TIME_FIELDS: [&str; 6] = [
    "startedAt",
    "completedAt",
    "durationMs",
    "createdAt",
    "updatedAt",
    "endedAt",
];

/// Blanks the clock's readings: they depend on how often each
/// implementation reads its clock, not on the event stream's meaning.
fn without_times(value: &mut Value) {
    match value {
        Value::Object(record) => {
            for (key, field) in record.iter_mut() {
                if TIME_FIELDS.contains(&key.as_str()) && !field.is_null() {
                    *field = json!(0);
                } else {
                    without_times(field);
                }
            }
        }
        Value::Array(values) => values.iter_mut().for_each(without_times),
        _ => {}
    }
}

fn neutral(events: &[AgentEvent]) -> Result<Vec<Value>, serde_json::Error> {
    events
        .iter()
        .map(|event| {
            let mut value = serde_json::to_value(event)?;
            without_times(&mut value);
            Ok(value)
        })
        .collect()
}

fn golden(scenario: &str) -> Result<Vec<Value>, Box<dyn std::error::Error>> {
    Ok(load(
        &fixtures()
            .join("golden")
            .join(format!("{scenario}.neutral.jsonl")),
    )?
    .into_iter()
    .filter(|event| event["type"] != "thread.updated")
    .map(|mut event| {
        without_times(&mut event);
        event
    })
    .collect())
}

fn scenarios() -> Result<Vec<String>, Box<dyn std::error::Error>> {
    let mut names: Vec<String> = std::fs::read_dir(fixtures().join("replay"))?
        .filter_map(Result::ok)
        .filter_map(|entry| {
            entry
                .file_name()
                .to_str()
                .and_then(|name| name.strip_suffix(".ndjson"))
                .map(ToOwned::to_owned)
        })
        .collect();
    names.sort();
    Ok(names)
}

#[tokio::test]
async fn every_recorded_transcript_replays_to_its_golden_events() -> TestResult {
    let mut failures = Vec::new();
    for scenario in scenarios()? {
        let entries = load(&fixtures().join("replay").join(format!("{scenario}.ndjson")))?;
        let replayed = match replay(entries).await {
            Ok(replayed) => replayed,
            Err(error) => {
                failures.push(format!("{scenario}: {error}"));
                continue;
            }
        };
        let actual = neutral(&replayed.events)?;
        let expected = golden(&scenario)?;
        if actual != expected {
            let at = actual
                .iter()
                .zip(&expected)
                .position(|(actual, expected)| actual != expected)
                .unwrap_or(actual.len().min(expected.len()));
            failures.push(format!(
                "{scenario}: {} events, golden {}; first difference at {at}:\n  actual: {}\n  golden: {}",
                actual.len(),
                expected.len(),
                actual.get(at).map_or_else(String::new, ToString::to_string),
                expected.get(at).map_or_else(String::new, ToString::to_string),
            ));
        }
    }
    assert!(
        failures.is_empty(),
        "{} scenarios differ:\n{}",
        failures.len(),
        failures.join("\n\n")
    );
    Ok(())
}

#[tokio::test]
async fn replaces_a_lost_session_once_with_a_bounded_history_prefix() -> TestResult {
    let replayed = replay(load(
        &fixtures().join("replay/codewide_lost_session.ndjson"),
    )?)
    .await?;
    let identities: Vec<_> = replayed
        .opens
        .iter()
        .map(|open| open.identity.clone())
        .collect();
    assert_eq!(identities.len(), 3);
    assert!(matches!(
        identities[0],
        crate::cli::command::SessionIdentity::New(_)
    ));
    assert!(matches!(
        identities[1],
        crate::cli::command::SessionIdentity::Resume(_)
    ));
    assert!(matches!(
        identities[2],
        crate::cli::command::SessionIdentity::New(_)
    ));
    assert_ne!(identities[2], identities[0]);
    let replacement = replayed
        .offers
        .last()
        .map(|offer| offer.content[0]["text"].clone());
    assert!(
        replacement
            .as_ref()
            .and_then(Value::as_str)
            .is_some_and(|text| text.contains("[Historical conversation from this thread]\nUser: Remember the codeword\nClaude: Noted."))
    );
    let statuses: Vec<_> = replayed
        .events
        .iter()
        .filter_map(|event| match event {
            AgentEvent::TurnCompleted { turn, .. } => Some(turn.status),
            _ => None,
        })
        .collect();
    assert_eq!(statuses, vec![agent_core::model::TurnStatus::Completed; 2]);
    assert!(
        replayed
            .offers
            .iter()
            .all(|offer| offer.priority == Priority::Queued)
    );
    Ok(())
}
