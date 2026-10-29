//! The thread service over a throwaway Claude store and state directory,
//! with a hand-driven query runtime (the host's `test/support/scripted.ts`):
//! each opened query records its offers and permission modes, and the test
//! pushes Claude's frames, ends or fails it. Offers and persisted frames
//! are appended to the session's JSONL file as Claude writes them, so
//! listings and history read them back.

mod background_tasks;
mod forks;
mod golden;
mod sessions;
mod subagent_requests;
mod task_reports;
mod threads;

use std::{
    path::{Path, PathBuf},
    sync::{
        Arc, Mutex, PoisonError,
        atomic::{AtomicBool, AtomicI64, AtomicU64, Ordering},
    },
    time::{Duration, SystemTime},
};

use agent_core::model::{
    AgentEvent, AgentThread, AppThreadId, ClientToolSpec, ProviderRateLimitWindow, SortDirection,
    ThreadCreateParams, ThreadListParams, ThreadSettings, ThreadSortKey, ToolCallParams,
    ToolCallResult, TurnId, TurnStartParams, TurnStartResult, UserContent,
};
use async_trait::async_trait;
use serde_json::{Value, json};
use tokio::sync::mpsc;

use super::{ServiceDeps, ServiceOutput, ThreadService};
use crate::{
    cli::{
        command::{QueryOptions, SessionIdentity},
        process::{ProcessError, ProcessEvent},
        protocol::{Author, ControlRequest},
    },
    native::{files, write::project_dir_name},
    runtime::running_sessions::{
        RunningProcess, RunningSessionMap, RunningSessions, RunningSessionsError,
    },
    session::{
        ports::{ClientTools, RateLimitSink, SessionConfig},
        query::{BoxFuture, Offer, Query, QueryRuntime},
    },
};

pub(super) type TestResult = Result<(), Box<dyn std::error::Error>>;

pub(super) const THREAD: &str = "0199a3c4-7a8e-7b2c-9d1e-2f3a4b5c6d7e";
pub(super) const OTHER_THREAD: &str = "0199a3c4-7a8e-7b2c-9d1e-2f3a4b5c6d7f";
pub(super) const TERMINAL: &str = "5a501bd2-3572-4b52-8537-b26e7278a1b5";
pub(super) const PROGRAMMATIC: &str = "49a1d081-235d-4f24-8144-d47c4b9c323d";

fn lock<T>(mutex: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(PoisonError::into_inner)
}

pub(super) fn id(value: &str) -> Result<AppThreadId, Box<dyn std::error::Error>> {
    AppThreadId::parse(value).ok_or_else(|| "invalid thread id".into())
}

/// The newest `uuid` among the rows of a session file.
fn last_uuid(path: &Path) -> Option<String> {
    let text = std::fs::read_to_string(path).ok()?;
    text.lines().rev().find_map(|line| {
        serde_json::from_str::<Value>(line)
            .ok()?
            .get("uuid")?
            .as_str()
            .map(ToOwned::to_owned)
    })
}

/// Appends `row` to a session file, linked to the newest row before it.
pub(super) fn append_row(path: &Path, mut row: Value) -> std::io::Result<()> {
    use std::io::Write;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    if row.get("parentUuid").is_none() {
        row["parentUuid"] = last_uuid(path).map_or(Value::Null, Value::from);
    }
    let mut file = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(path)?;
    writeln!(file, "{row}")
}

/// A stored prompt row as Claude writes it.
pub(super) fn stored_prompt(session_id: &str, cwd: &str, uuid: &str, text: &str) -> Value {
    json!({"type": "user", "uuid": uuid, "sessionId": session_id, "cwd": cwd,
        "timestamp": "2026-10-01T10:00:00.000Z", "entrypoint": "cli", "isSidechain": false,
        "message": {"role": "user", "content": text}})
}

/// A stored answer row as Claude writes it.
pub(super) fn stored_answer(session_id: &str, uuid: &str, text: &str, model: &str) -> Value {
    json!({"type": "assistant", "uuid": uuid, "sessionId": session_id,
        "timestamp": "2026-10-01T10:00:05.000Z", "isSidechain": false,
        "message": {"id": format!("msg_{uuid}"), "model": model, "role": "assistant",
            "content": [{"type": "text", "text": text}]}})
}

/// Writes a session file under `<projects>/<project of cwd>/` with the given
/// modification time.
pub(super) fn write_session(
    projects: &Path,
    cwd: &str,
    session_id: &str,
    rows: &[Value],
    modified_ms: u64,
) -> std::io::Result<PathBuf> {
    let path = projects
        .join(project_dir_name(cwd))
        .join(format!("{session_id}.jsonl"));
    for row in rows {
        append_row(&path, row.clone())?;
    }
    let file = std::fs::OpenOptions::new().write(true).open(&path)?;
    file.set_modified(SystemTime::UNIX_EPOCH + Duration::from_millis(modified_ms))?;
    Ok(path)
}

/// One opened query, driven by the test.
pub(super) struct FakeQuery {
    pub options: QueryOptions,
    pub offers: Mutex<Vec<Offer>>,
    pub modes: Mutex<Vec<&'static str>>,
    /// The session's answers to Claude's control requests, in order.
    pub answers: Mutex<Vec<(String, Result<Value, String>)>>,
    pub closed: AtomicBool,
    events: mpsc::Sender<ProcessEvent>,
    file: PathBuf,
    session_id: String,
    rows: AtomicU64,
}

impl FakeQuery {
    fn persist(&self, row: Value) {
        // A failed append shows up as a missing history row in the test.
        let _ = append_row(&self.file, row);
    }

    /// Delivers `frame`; content frames are persisted first, as Claude does.
    pub async fn push(&self, frame: Value) {
        let kind = frame["type"].as_str().unwrap_or_default();
        if matches!(kind, "assistant" | "user") && frame["parent_tool_use_id"].is_null() {
            let uuid = frame["uuid"].as_str().map_or_else(
                || {
                    format!(
                        "row-{}-{}",
                        self.session_id,
                        self.rows.fetch_add(1, Ordering::SeqCst)
                    )
                },
                ToOwned::to_owned,
            );
            let mut row = json!({"type": kind, "uuid": uuid, "sessionId": self.session_id,
                "cwd": self.options.cwd.to_string_lossy(), "timestamp": "2026-10-01T10:00:05.000Z",
                "message": frame["message"]});
            // Claude stores a tool's structured result beside its message.
            if let Some(result) = frame.get("tool_use_result") {
                row["toolUseResult"] = result.clone();
            }
            self.persist(row);
        }
        let _ = self.events.send(ProcessEvent::Message(frame)).await;
    }

    /// Claude asks the session `request` under `request_id`.
    pub async fn request(&self, request_id: &str, request: ControlRequest) {
        let _ = self
            .events
            .send(ProcessEvent::Request {
                request_id: request_id.to_owned(),
                request,
            })
            .await;
    }

    pub fn answers(&self) -> Vec<(String, Result<Value, String>)> {
        lock(&self.answers).clone()
    }

    /// The process ends cleanly.
    pub async fn end(&self) {
        let _ = self.events.send(ProcessEvent::Exited { error: None }).await;
    }

    /// The process ends with `stderr`.
    pub async fn fail(&self, stderr: &str) {
        let _ = self
            .events
            .send(ProcessEvent::Exited {
                error: Some(stderr.to_owned()),
            })
            .await;
    }

    pub fn offer_count(&self) -> usize {
        lock(&self.offers).len()
    }
}

impl Query for FakeQuery {
    fn offer(&self, offer: Offer) {
        let mut row = json!({"type": "user", "uuid": offer.uuid, "sessionId": self.session_id,
            "cwd": self.options.cwd.to_string_lossy(), "timestamp": "2026-10-01T10:00:00.000Z",
            "entrypoint": "cli", "message": {"role": "user", "content": offer.content}});
        // Claude stores an adapter message as a meta message.
        if offer.author == Author::Adapter {
            row["isMeta"] = json!(true);
        }
        self.persist(row);
        lock(&self.offers).push(offer);
    }

    fn respond(&self, request_id: String, outcome: Result<Value, String>) {
        lock(&self.answers).push((request_id, outcome));
    }

    fn interrupt(&self) -> BoxFuture<'static, Result<(), ProcessError>> {
        Box::pin(async { Ok(()) })
    }

    fn set_permission_mode(
        &self,
        mode: &'static str,
    ) -> BoxFuture<'static, Result<(), ProcessError>> {
        lock(&self.modes).push(mode);
        Box::pin(async { Ok(()) })
    }

    fn read_usage(&self) -> BoxFuture<'static, Result<Value, ProcessError>> {
        Box::pin(async { Err(ProcessError::Ended) })
    }

    fn close(&self) {
        self.closed.store(true, Ordering::SeqCst);
        let events = self.events.clone();
        tokio::spawn(async move {
            let _ = events.send(ProcessEvent::Exited { error: None }).await;
        });
    }
}

/// Opens [`FakeQuery`]s over the test's store.
pub(super) struct FakeRuntime {
    projects: PathBuf,
    queries: Mutex<Vec<Arc<FakeQuery>>>,
}

impl FakeRuntime {
    pub fn queries(&self) -> Vec<Arc<FakeQuery>> {
        lock(&self.queries).clone()
    }

    pub fn query(&self, index: usize) -> Result<Arc<FakeQuery>, Box<dyn std::error::Error>> {
        self.queries()
            .get(index)
            .cloned()
            .ok_or_else(|| format!("query {index} was not opened").into())
    }
}

impl QueryRuntime for FakeRuntime {
    fn open(
        &self,
        options: &QueryOptions,
    ) -> Result<(Arc<dyn Query>, mpsc::Receiver<ProcessEvent>), ProcessError> {
        let session_id = match &options.identity {
            SessionIdentity::New(id) | SessionIdentity::Resume(id) => id.clone(),
            SessionIdentity::Probe => String::new(),
        };
        let file = files::find_session(&self.projects, &session_id).map_or_else(
            || {
                self.projects
                    .join(project_dir_name(&options.cwd.to_string_lossy()))
                    .join(format!("{session_id}.jsonl"))
            },
            |found| found.path,
        );
        let (events, receiver) = mpsc::channel(64);
        let query = Arc::new(FakeQuery {
            options: options.clone(),
            offers: Mutex::new(Vec::new()),
            modes: Mutex::new(Vec::new()),
            answers: Mutex::new(Vec::new()),
            closed: AtomicBool::new(false),
            events,
            file,
            session_id,
            rows: AtomicU64::new(0),
        });
        lock(&self.queries).push(query.clone());
        Ok((query, receiver))
    }
}

/// What `claude agents --json` lists, set by the test.
#[derive(Default)]
pub(super) struct FakeRunning(Mutex<RunningSessionMap>, AtomicBool);

impl FakeRunning {
    pub fn add(&self, session_id: &str) {
        lock(&self.0).insert(session_id.to_owned(), RunningProcess::StartUnknown);
    }

    pub fn remove(&self, session_id: &str) {
        lock(&self.0).remove(session_id);
    }

    /// Makes every read fail (`true`) or succeed again.
    pub fn fail(&self, failing: bool) {
        self.1.store(failing, Ordering::SeqCst);
    }

    /// Lists `session_id` as held by a process that started at `started_at_ms`.
    pub fn add_started(&self, session_id: &str, started_at_ms: i64) {
        lock(&self.0).insert(
            session_id.to_owned(),
            RunningProcess::StartedAt(started_at_ms),
        );
    }
}

#[async_trait]
impl RunningSessions for FakeRunning {
    async fn list(&self) -> Result<RunningSessionMap, RunningSessionsError> {
        if self.1.load(Ordering::SeqCst) {
            return Err(RunningSessionsError::NotAnArray);
        }
        Ok(lock(&self.0).clone())
    }
}

struct NoClientTools;

impl ClientTools for NoClientTools {
    fn specs(&self) -> Vec<ClientToolSpec> {
        Vec::new()
    }

    fn call(&self, _: ToolCallParams) -> BoxFuture<'static, ToolCallResult> {
        Box::pin(async { ToolCallResult::failure("no client tools".into()) })
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

/// How a harness is built.
pub(super) struct Options {
    pub root: Option<Arc<tempfile::TempDir>>,
    pub poll: Duration,
    pub model_id_for: Arc<dyn Fn(&str) -> String + Send + Sync>,
    /// Advance the clock one second per read (the golden replays).
    pub ticking_clock: bool,
}

impl Default for Options {
    fn default() -> Self {
        Self {
            root: None,
            poll: Duration::from_mins(1),
            model_id_for: Arc::new(ToOwned::to_owned),
            ticking_clock: false,
        }
    }
}

/// A service over a throwaway store, with every output it published.
pub(super) struct Harness {
    pub service: ThreadService,
    pub runtime: Arc<FakeRuntime>,
    pub running: Arc<FakeRunning>,
    pub events: Arc<Mutex<Vec<AgentEvent>>>,
    pub root: Arc<tempfile::TempDir>,
    collector: tokio::task::JoinHandle<()>,
}

impl Harness {
    pub fn projects(&self) -> PathBuf {
        self.root.path().join("projects")
    }

    pub fn state_directory(&self) -> PathBuf {
        self.root.path().join("journal")
    }

    pub fn events(&self) -> Vec<AgentEvent> {
        lock(&self.events).clone()
    }

    /// The `thread.updated` statuses of one thread, in order.
    pub fn statuses(&self, app_thread_id: &str) -> Vec<agent_core::model::ThreadStatus> {
        self.events()
            .iter()
            .filter_map(|event| match event {
                AgentEvent::ThreadUpdated { thread }
                    if thread.app_thread_id.as_str() == app_thread_id =>
                {
                    Some(thread.status)
                }
                _ => None,
            })
            .collect()
    }

    /// The `turn.completed` events.
    pub fn completions(&self) -> Vec<agent_core::model::AgentTurn> {
        self.events()
            .into_iter()
            .filter_map(|event| match event {
                AgentEvent::TurnCompleted { turn, .. } => Some(turn),
                _ => None,
            })
            .collect()
    }

    /// Ends the service and stops collecting.
    pub async fn close(self) {
        self.service.shutdown().await;
        settle().await;
        self.collector.abort();
    }
}

pub(super) fn harness(options: Options) -> Result<Harness, Box<dyn std::error::Error>> {
    let root = match options.root {
        Some(root) => root,
        None => Arc::new(tempfile::tempdir()?),
    };
    let projects = root.path().join("projects");
    std::fs::create_dir_all(&projects)?;
    let runtime = Arc::new(FakeRuntime {
        projects: projects.clone(),
        queries: Mutex::new(Vec::new()),
    });
    let running = Arc::new(FakeRunning::default());
    let clock = Arc::new(AtomicI64::new(1_760_000_000_000));
    let ticking = options.ticking_clock;
    let ids = AtomicU64::new(0);
    let (service, mut outputs) = ThreadService::new(ServiceDeps {
        projects_root: projects,
        state_directory: root.path().join("journal"),
        runtime: runtime.clone(),
        executable: "/usr/bin/claude".into(),
        clock: Arc::new(move || {
            if ticking {
                clock.fetch_add(1000, Ordering::SeqCst) + 1000
            } else {
                clock.load(Ordering::SeqCst)
            }
        }),
        new_uuid: Arc::new(move || {
            format!(
                "00000000-0000-4000-8000-{:012}",
                ids.fetch_add(1, Ordering::SeqCst) + 1
            )
        }),
        client_tools: Arc::new(NoClientTools),
        rate_limits: Arc::new(NoRateLimits),
        session_config: SessionConfig {
            idle_release: Duration::from_mins(30),
            background_defer_max: Duration::from_hours(4),
            interrupt_timeout: Duration::from_millis(50),
        },
        running_sessions: running.clone(),
        open_elsewhere_poll: options.poll,
        model_id_for: options.model_id_for,
    })?;
    let events = Arc::new(Mutex::new(Vec::new()));
    let sink = events.clone();
    let collector = tokio::spawn(async move {
        let mut position = 0;
        while let Some(output) = outputs.recv().await {
            match output {
                ServiceOutput::Event(event) => {
                    position += 1;
                    lock(&sink).push(*event);
                }
                ServiceOutput::Fence(fence) => {
                    let _ = fence.send(Ok(position));
                }
                ServiceOutput::SessionActivityChanged(_) => {}
            }
        }
    });
    Ok(Harness {
        service,
        runtime,
        running,
        events,
        root,
        collector,
    })
}

/// Lets background work (session loops, refreshes, file I/O) finish.
pub(super) async fn settle() {
    tokio::time::sleep(Duration::from_millis(60)).await;
}

pub(super) fn text(value: &str) -> Vec<UserContent> {
    vec![UserContent::Text {
        text: value.to_owned(),
    }]
}

pub(super) fn settings(permission_profile: &str) -> ThreadSettings {
    ThreadSettings {
        model: "sonnet".into(),
        effort: None,
        permission_profile: permission_profile.into(),
        service_tier: None,
    }
}

pub(super) async fn create_thread(service: &ThreadService, app_thread_id: &str) -> TestResult {
    service
        .create(ThreadCreateParams {
            app_thread_id: Some(id(app_thread_id)?),
            cwd: "/workspace".into(),
            settings: settings(":workspace"),
            client_tools: None,
        })
        .await?;
    Ok(())
}

/// Starts a user turn and returns its id; fails unless it started.
pub(super) async fn start(
    service: &ThreadService,
    app_thread_id: &str,
    prompt: &str,
) -> Result<TurnId, Box<dyn std::error::Error>> {
    match service
        .turn_start(TurnStartParams {
            app_thread_id: id(app_thread_id)?,
            client_message_id: None,
            input: text(prompt),
            client_tools: None,
        })
        .await?
    {
        TurnStartResult::Started { turn_id } => Ok(turn_id),
        TurnStartResult::Busy { .. } => Err("the thread was busy".into()),
    }
}

pub(super) fn list_params() -> ThreadListParams {
    ThreadListParams {
        archived: false,
        cwd: None,
        search_term: None,
        sort_key: ThreadSortKey::UpdatedAt,
        sort_direction: SortDirection::Desc,
        window: None,
        cursor: None,
        limit: 50,
    }
}

pub(super) async fn listed(
    service: &ThreadService,
    params: ThreadListParams,
) -> Result<Vec<AgentThread>, Box<dyn std::error::Error>> {
    Ok(service.list(params).await?.threads)
}

pub(super) fn ids(threads: &[AgentThread]) -> Vec<&str> {
    threads
        .iter()
        .map(|thread| thread.app_thread_id.as_str())
        .collect()
}

/// Claude's frames as the scripted host tests write them.
pub(super) mod frames {
    use serde_json::{Value, json};

    pub fn init() -> Value {
        json!({"type": "system", "subtype": "init", "mcp_servers": [], "session_id": "s"})
    }

    pub fn text(message_id: &str, text: &str) -> Value {
        json!({"type": "assistant", "message": {"id": message_id, "role": "assistant",
            "content": [{"type": "text", "text": text}]}, "parent_tool_use_id": null})
    }

    pub fn tool_use(message_id: &str, tool_use_id: &str, name: &str, input: &Value) -> Value {
        json!({"type": "assistant", "message": {"id": message_id, "role": "assistant",
            "content": [{"type": "tool_use", "id": tool_use_id, "name": name, "input": input}]},
            "parent_tool_use_id": null})
    }

    pub fn result() -> Value {
        json!({"type": "result", "subtype": "success", "is_error": false,
            "terminal_reason": "completed", "num_turns": 1, "result": "ok"})
    }
}
