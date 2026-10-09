//! Contract tests of the agent provider layer through the real sync
//! transport: a fake Codex App Server behind the Codex adapter is the
//! primary provider and an in-process fake neutral provider is the second
//! one. They prove routing by binding, capability degradation, busy-start
//! requeue, runtime request namespacing and per-provider cleanup, and the
//! multi-provider list and catalog merges.
#![cfg(unix)]
#![allow(clippy::too_many_lines)]

use std::{
    collections::VecDeque,
    path::PathBuf,
    sync::{Arc, Mutex},
    time::Duration,
};

use async_trait::async_trait;
use codewide_companion::{
    agent::{
        bindings::{BindingOrigin, BindingStore},
        model::{
            AgentEvent, AgentThread, AgentTurn, AppThreadId, ApprovalDecision, ApprovalKind,
            CapabilityInvokeParams, CapabilitySet, ItemId, ModelCatalog, ModelEntry,
            NativeRequestId, PermissionProfileCatalog, ProviderDescriptor, ProviderId,
            RequestRespondParams, RpcError, RuntimeRequest, RuntimeResponse, StartWhileActiveMode,
            ThreadCreateParams, ThreadListParams, ThreadListResult, ThreadOrigin, ThreadReadResult,
            ThreadSettings, ThreadStatus, ThreadTurnsParams, ThreadTurnsResult, ThreadUpdateParams,
            ThreadUpdateResult, TurnId, TurnInterruptParams, TurnOrigin, TurnStartParams,
            TurnStartResult, TurnStatus, TurnSteerParams, TurnSteerResult,
        },
        provider::{AgentProvider, ProviderError, ProviderEvent, ProviderFence, ProviderStatus},
        providers::codex::{CodexProvider, storage::CodexStorage},
        registry::ProviderRegistry,
    },
    catalog::SessionCatalog,
    history_service::HistoryService,
    server,
    store::{IndexStore, OutboxState},
    sync::SyncHub,
    upstream::{ConnectionStatus, UpstreamHandle},
};
use futures_util::{SinkExt, StreamExt};
use http::HeaderValue;
use serde_json::{Value, json};
use tokio::{
    net::{TcpListener, UnixListener, UnixStream},
    sync::{mpsc, watch},
    task::JoinHandle,
    time::timeout,
};
use tokio_tungstenite::{
    WebSocketStream, accept_async, connect_async,
    tungstenite::{Message, client::IntoClientRequest},
};

const TOKEN: &str = "test-token-that-is-long-enough-for-production-shape";
const FAKE: &str = "fake";
type ClientSocket = WebSocketStream<tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>>;
type TestResult = Result<(), Box<dyn std::error::Error>>;

/// Capabilities of a Claude-like provider.
fn neutral_capabilities() -> CapabilitySet {
    let mut capabilities = CapabilitySet::none(StartWhileActiveMode::Busy);
    capabilities.turns_steer = true;
    capabilities.turns_provider_initiated = true;
    capabilities.threads_host_minted_ids = true;
    capabilities.threads_compact = true;
    capabilities.requests_user_input = true;
    capabilities
}

/// In-process neutral provider with scripted answers.
struct FakeNeutral {
    calls: Mutex<Vec<String>>,
    threads: Mutex<Vec<AgentThread>>,
    turn_starts: Mutex<VecDeque<TurnStartResult>>,
    active: Mutex<bool>,
    responses: Mutex<Vec<RequestRespondParams>>,
    events: Mutex<Option<mpsc::Receiver<ProviderEvent>>>,
    status: watch::Sender<ProviderStatus>,
}

impl FakeNeutral {
    fn new() -> (Arc<Self>, mpsc::Sender<ProviderEvent>) {
        let (sender, receiver) = mpsc::channel(64);
        let (status, _) = watch::channel(ProviderStatus::Live);
        (
            Arc::new(Self {
                calls: Mutex::new(Vec::new()),
                threads: Mutex::new(Vec::new()),
                turn_starts: Mutex::new(VecDeque::new()),
                active: Mutex::new(false),
                responses: Mutex::new(Vec::new()),
                events: Mutex::new(Some(receiver)),
                status,
            }),
            sender,
        )
    }

    fn record(&self, call: &str) {
        self.calls
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .push(call.to_owned());
    }

    fn calls(&self) -> Vec<String> {
        self.calls
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .clone()
    }

    fn set_active(&self, active: bool) {
        *self
            .active
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner) = active;
    }

    fn thread(&self, id: &AppThreadId) -> Option<AgentThread> {
        let active = *self
            .active
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        self.threads
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .iter()
            .find(|thread| &thread.app_thread_id == id)
            .cloned()
            .map(|mut thread| {
                thread.status = if active {
                    ThreadStatus::Active
                } else {
                    ThreadStatus::Idle
                };
                thread
            })
    }
}

fn agent_thread(id: AppThreadId, key: i64) -> AgentThread {
    AgentThread {
        app_thread_id: id,
        provider: ProviderId::from_static(FAKE),
        cwd: "/work".into(),
        name: None,
        preview: "fake thread".into(),
        created_at: key,
        updated_at: key,
        recency_at: Some(key),
        archived: false,
        origin: ThreadOrigin::Interactive,
        status: ThreadStatus::Idle,
        settings: ThreadSettings {
            model: "fake-model".into(),
            effort: None,
            permission_profile: ":workspace".into(),
            service_tier: None,
        },
    }
}

fn not_found(id: &AppThreadId) -> ProviderError {
    ProviderError::Rejected(RpcError::new(-32_600, format!("thread not found: {id}")))
}

#[async_trait]
impl AgentProvider for FakeNeutral {
    fn descriptor(&self) -> ProviderDescriptor {
        ProviderDescriptor {
            id: ProviderId::from_static(FAKE),
            display_name: "Fake".into(),
            model_provider: "fake-models".into(),
            version: "1.0".into(),
        }
    }

    fn as_any(&self) -> &dyn std::any::Any {
        self
    }

    fn capabilities(&self) -> CapabilitySet {
        neutral_capabilities()
    }

    fn status(&self) -> ProviderStatus {
        *self.status.borrow()
    }

    fn subscribe_status(&self) -> watch::Receiver<ProviderStatus> {
        self.status.subscribe()
    }

    fn take_events(&self) -> mpsc::Receiver<ProviderEvent> {
        self.events
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .take()
            .unwrap_or_else(|| mpsc::channel(1).1)
    }

    async fn catalog_models(&self) -> Result<ModelCatalog, ProviderError> {
        Ok(ModelCatalog {
            models: vec![ModelEntry {
                id: "fake-model".into(),
                model: "fake-model".into(),
                display_name: "Default (recommended)".into(),
                description: "Fake".into(),
                is_default: true,
                hidden: false,
                efforts: Vec::new(),
                default_effort: None,
                input_modalities: Vec::new(),
            }],
        })
    }

    async fn catalog_permission_profiles(&self) -> Result<PermissionProfileCatalog, ProviderError> {
        Ok(PermissionProfileCatalog {
            profiles: Vec::new(),
        })
    }

    async fn thread_create(
        &self,
        params: ThreadCreateParams,
    ) -> Result<AgentThread, ProviderError> {
        self.record("thread.create");
        let id = params
            .app_thread_id
            .ok_or_else(|| ProviderError::Protocol("host-minted id expected".into()))?;
        let mut thread = agent_thread(id, 1_000);
        thread.cwd = params.cwd;
        thread.settings = params.settings;
        self.threads
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .push(thread.clone());
        Ok(thread)
    }

    async fn thread_read(&self, thread: &AppThreadId) -> Result<ThreadReadResult, ProviderError> {
        self.record("thread.read");
        let found = self.thread(thread).ok_or_else(|| not_found(thread))?;
        let active = found.status == ThreadStatus::Active;
        Ok(ThreadReadResult {
            thread: found,
            active_turn_id: active.then(|| TurnId::from_static("turn-active")),
        })
    }

    async fn thread_read_fenced(
        &self,
        thread: &AppThreadId,
    ) -> Result<(ThreadReadResult, ProviderFence), ProviderError> {
        let read = self.thread_read(thread).await?;
        Ok((read, ProviderFence::new(async { Ok(0) })))
    }

    async fn thread_list(
        &self,
        params: ThreadListParams,
    ) -> Result<ThreadListResult, ProviderError> {
        self.record("thread.list");
        let window = params.window;
        let mut threads = self
            .threads
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .iter()
            .filter(|thread| {
                let key = thread.recency_at.unwrap_or(thread.updated_at);
                window.is_none_or(|window| {
                    window.lower.is_none_or(|lower| key >= lower)
                        && window.upper.is_none_or(|upper| key < upper)
                })
            })
            .cloned()
            .collect::<Vec<_>>();
        threads.sort_by_key(|thread| std::cmp::Reverse(thread.updated_at));
        Ok(ThreadListResult {
            threads,
            next_cursor: None,
        })
    }

    async fn thread_turns(&self, _: ThreadTurnsParams) -> Result<ThreadTurnsResult, ProviderError> {
        self.record("thread.turns");
        Ok(ThreadTurnsResult {
            turns: Vec::new(),
            next_cursor: None,
        })
    }

    async fn thread_turns_fenced(
        &self,
        params: ThreadTurnsParams,
    ) -> Result<(ThreadTurnsResult, ProviderFence), ProviderError> {
        let turns = self.thread_turns(params).await?;
        Ok((turns, ProviderFence::new(async { Ok(0) })))
    }

    async fn thread_update(
        &self,
        _: ThreadUpdateParams,
    ) -> Result<ThreadUpdateResult, ProviderError> {
        self.record("thread.update");
        Ok(ThreadUpdateResult { thread: None })
    }

    async fn thread_owns(&self, thread: &AppThreadId) -> Result<bool, ProviderError> {
        Ok(self.thread(thread).is_some())
    }

    async fn thread_compact(&self, _: &AppThreadId) -> Result<(), ProviderError> {
        self.record("thread.compact");
        Ok(())
    }

    async fn turn_start(&self, _: TurnStartParams) -> Result<TurnStartResult, ProviderError> {
        self.record("turn.start");
        let outcome = self
            .turn_starts
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .pop_front()
            .unwrap_or(TurnStartResult::Started {
                turn_id: TurnId::from_static("turn-started"),
            });
        if matches!(outcome, TurnStartResult::Busy { .. }) {
            self.set_active(true);
        }
        Ok(outcome)
    }

    async fn turn_steer(&self, params: TurnSteerParams) -> Result<TurnSteerResult, ProviderError> {
        self.record("turn.steer");
        Ok(TurnSteerResult {
            turn_id: params.expected_turn_id,
        })
    }

    async fn turn_interrupt(&self, _: TurnInterruptParams) -> Result<(), ProviderError> {
        self.record("turn.interrupt");
        Ok(())
    }

    async fn request_respond(&self, params: RequestRespondParams) -> Result<(), ProviderError> {
        self.record("request.respond");
        self.responses
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .push(params);
        Ok(())
    }

    async fn capability_invoke(&self, _: CapabilityInvokeParams) -> Result<Value, ProviderError> {
        self.record("capability.invoke");
        Ok(Value::Null)
    }
}

/// A scripted Codex App Server: answers with `answer`, records methods, and
/// forwards pushed notifications or server requests.
async fn run_app_server(
    socket_path: PathBuf,
    mut pushed: mpsc::Receiver<Value>,
    observed: mpsc::UnboundedSender<Value>,
    answer: fn(&Value) -> Value,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let listener = UnixListener::bind(socket_path)?;
    let (stream, _) = listener.accept().await?;
    let mut socket = accept_async::<UnixStream>(stream).await?;
    let initialize = receive_value(&mut socket).await?;
    send_value(&mut socket, &json!({"id": initialize["id"], "result": {}})).await?;
    let _initialized = receive_value(&mut socket).await?;
    loop {
        tokio::select! {
            value = pushed.recv() => {
                let Some(value) = value else { return Ok(()); };
                send_value(&mut socket, &value).await?;
            }
            frame = socket.next() => {
                let Some(frame) = frame else { return Ok(()); };
                let Message::Text(raw) = frame? else { continue; };
                let request: Value = serde_json::from_str(&raw)?;
                observed.send(request.clone())?;
                if request.get("method").is_none() {
                    continue;
                }
                let mut response = answer(&request);
                response["id"] = request["id"].clone();
                send_value(&mut socket, &response).await?;
            }
        }
    }
}

fn default_answer(request: &Value) -> Value {
    match request["method"].as_str() {
        Some("thread/list") => json!({"result": {
            "data": [
                {"id": "codex-1", "createdAt": 300, "updatedAt": 300, "recencyAt": 300, "preview": "codex one", "cwd": "/work"},
                {"id": "codex-2", "createdAt": 100, "updatedAt": 100, "recencyAt": 100, "preview": "codex two", "cwd": "/work"}
            ],
            "nextCursor": "lead-2",
            "backwardsCursor": null
        }}),
        Some("model/list") => json!({"result": {
            "data": [{"id": "gpt-5.5", "model": "gpt-5.5", "displayName": "GPT-5.5", "isDefault": true}],
            "nextCursor": null
        }}),
        Some(method) if method.starts_with("thread/") || method.starts_with("turn/") => {
            let thread_id = request["params"]["threadId"].as_str().unwrap_or_default();
            json!({"error": {"code": -32600, "message": format!("thread not found: {thread_id}")}})
        }
        _ => json!({"result": {}}),
    }
}

struct Harness {
    client: ClientSocket,
    fake: Arc<FakeNeutral>,
    events: mpsc::Sender<ProviderEvent>,
    pushed: mpsc::Sender<Value>,
    observed: mpsc::UnboundedReceiver<Value>,
    store: Arc<IndexStore>,
    url: String,
    tasks: Vec<JoinHandle<()>>,
    _directory: tempfile::TempDir,
}

impl Harness {
    async fn start(
        answer: fn(&Value) -> Value,
        prepare: impl FnOnce(&Arc<IndexStore>) -> Vec<(AppThreadId, ProviderId)>,
    ) -> Result<Self, Box<dyn std::error::Error>> {
        let directory = tempfile::tempdir()?;
        let socket_path = directory.path().join("app-server.sock");
        let upstream_path = socket_path.clone();
        let (pushed, pushed_rx) = mpsc::channel(16);
        let (observed_tx, observed) = mpsc::unbounded_channel();
        let app_server = tokio::spawn(async move {
            let _ = run_app_server(socket_path, pushed_rx, observed_tx, answer).await;
        });
        let upstream = UpstreamHandle::spawn(upstream_path);
        wait_for_live(&upstream).await?;
        let store = Arc::new(IndexStore::open(directory.path().join("state.redb"))?);
        let bindings = BindingStore::new(store.clone());
        for (thread, provider) in prepare(&store) {
            bindings
                .bind(&thread, &provider, BindingOrigin::Created)
                .await?;
        }
        let history = HistoryService::new(
            Arc::new(SessionCatalog::scan(directory.path())),
            store.clone(),
        );
        let (fake, events) = FakeNeutral::new();
        let registry = ProviderRegistry::new(
            vec![
                Arc::new(CodexProvider::new(upstream).with_storage(CodexStorage::new(history)))
                    as Arc<dyn AgentProvider>,
                fake.clone() as Arc<dyn AgentProvider>,
            ],
            &ProviderId::from_static("codex"),
            Vec::new(),
        )?;
        let sync = SyncHub::with_registry(Arc::new(registry), store.clone(), true);
        let listener = TcpListener::bind("127.0.0.1:0").await?;
        let address = listener.local_addr()?;
        let app = server::router(store.clone(), Arc::from(TOKEN), sync);
        let server_task = tokio::spawn(async move {
            let _ = axum::serve(listener, app).await;
        });
        let url = format!("ws://{address}/v1/sync");
        let (client, _) = connect_client_with_hello(&url).await?;
        Ok(Self {
            client,
            fake,
            events,
            pushed,
            observed,
            store,
            url,
            tasks: vec![app_server, server_task],
            _directory: directory,
        })
    }

    async fn rpc(
        &mut self,
        id: &str,
        method: &str,
        params: Value,
    ) -> Result<Value, Box<dyn std::error::Error>> {
        send_json(
            &mut self.client,
            &json!({"type": "rpc", "request": {"id": id, "method": method, "params": params}}),
        )
        .await?;
        timeout(Duration::from_secs(3), async {
            loop {
                let value = receive_any(&mut self.client).await?;
                if value["type"] == "rpc" && value["response"]["id"] == id {
                    return Ok(value["response"].clone());
                }
            }
        })
        .await?
    }

    async fn event_where(
        &mut self,
        predicate: impl Fn(&Value) -> bool,
    ) -> Result<Value, Box<dyn std::error::Error>> {
        timeout(Duration::from_secs(3), async {
            loop {
                let value = receive_any(&mut self.client).await?;
                if value["type"] == "event" && predicate(&value["payload"]) {
                    return Ok(value["payload"].clone());
                }
            }
        })
        .await?
    }

    fn observed_methods(&mut self) -> Vec<String> {
        let mut methods = Vec::new();
        while let Ok(value) = self.observed.try_recv() {
            methods.push(
                value["method"]
                    .as_str()
                    .map_or_else(|| "serverResponse".to_owned(), str::to_owned),
            );
        }
        methods
    }

    async fn new_fake_thread(&mut self) -> Result<String, Box<dyn std::error::Error>> {
        let started = self
            .rpc(
                "start",
                "thread/start",
                json!({"cwd": "/work", "model": "fake-model", "codewideAgentProvider": FAKE}),
            )
            .await?;
        Ok(started["result"]["thread"]["id"]
            .as_str()
            .ok_or("thread/start returned no id")?
            .to_owned())
    }

    fn stop(self) {
        for task in self.tasks {
            task.abort();
        }
    }
}

#[tokio::test]
async fn thread_start_binds_the_requested_provider_and_turns_bypass_the_primary() -> TestResult {
    let mut harness = Harness::start(default_answer, |_| Vec::new()).await?;
    let started = harness
        .rpc(
            "start",
            "thread/start",
            json!({"cwd": "/work", "model": "fake-model", "codewideAgentProvider": FAKE}),
        )
        .await?;
    let result = &started["result"];
    let thread_id = result["thread"]["id"]
        .as_str()
        .ok_or("no thread id")?
        .to_owned();
    assert_eq!(thread_id.len(), 36);
    assert_eq!(&thread_id[14..15], "7", "host-minted ids are UUIDv7");
    assert_eq!(result["model"], "fake-model");
    assert_eq!(result["sandbox"]["type"], "workspaceWrite");
    assert_eq!(result["activePermissionProfile"]["id"], ":workspace");
    assert_eq!(result["thread"]["modelProvider"], "fake-models");
    assert_eq!(result["thread"]["codewideAgent"]["provider"], FAKE);
    assert_eq!(result["thread"]["codewideAgent"]["primary"], false);
    assert_eq!(
        result["thread"]["codewideAgent"]["capabilities"]["review"],
        false
    );
    let binding = harness
        .store
        .agent_binding(&thread_id)?
        .ok_or("binding was not written before the response")?;
    let binding: Value = serde_json::from_slice(&binding)?;
    assert_eq!(binding["activeProvider"], FAKE);
    assert_eq!(binding["origin"], "created");

    let queued = harness
        .rpc(
            "put",
            "companion/queue/put",
            json!({"command": {
                "commandId": "message-1",
                "remoteThreadId": thread_id,
                "method": "turn/start",
                "presentation": "delivery",
                "params": {
                    "threadId": thread_id,
                    "clientUserMessageId": "message-1",
                    "input": [{"type": "text", "text": "hello", "text_elements": []}]
                }
            }}),
        )
        .await?;
    assert!(queued.get("error").is_none(), "{queued}");
    wait_for_state(&harness.store, "message-1", OutboxState::Delivered).await?;
    assert_eq!(
        harness
            .fake
            .calls()
            .iter()
            .filter(|call| *call == "turn.start")
            .count(),
        1
    );
    // The primary provider never saw the thread: no admission read, no
    // turn/start, no thread/read.
    let primary_methods = harness.observed_methods();
    assert!(
        !primary_methods
            .iter()
            .any(|method| method.starts_with("turn/") || method == "thread/read"),
        "{primary_methods:?}"
    );
    harness.stop();
    Ok(())
}

#[tokio::test]
async fn busy_start_stays_queued_and_is_delivered_once_after_turn_completed() -> TestResult {
    let mut harness = Harness::start(default_answer, |_| Vec::new()).await?;
    let thread_id = harness.new_fake_thread().await?;
    harness
        .fake
        .turn_starts
        .lock()
        .map_err(|_| "lock")?
        .push_back(TurnStartResult::Busy {
            active_turn_id: TurnId::from_static("turn-wake"),
        });
    harness
        .rpc(
            "put",
            "companion/queue/put",
            json!({"command": {
                "commandId": "message-busy",
                "remoteThreadId": thread_id,
                "method": "turn/start",
                "presentation": "delivery",
                "params": {
                    "threadId": thread_id,
                    "clientUserMessageId": "message-busy",
                    "input": [{"type": "text", "text": "while active", "text_elements": []}]
                }
            }}),
        )
        .await?;
    // After `busy` the command is queued again as "deliver after idle".
    timeout(Duration::from_secs(3), async {
        loop {
            let command = harness
                .store
                .outbox_list(None)?
                .into_iter()
                .find(|command| command.command_id == "message-busy");
            if let Some(command) = command
                && command.state == OutboxState::Queued
                && command.presentation == codewide_companion::store::OutboxPresentation::Queue
                && command.attempts == 0
            {
                return Ok::<(), Box<dyn std::error::Error>>(());
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    })
    .await??;
    tokio::time::sleep(Duration::from_millis(700)).await;
    assert_eq!(
        harness
            .fake
            .calls()
            .iter()
            .filter(|call| *call == "turn.start")
            .count(),
        1,
        "nothing is redelivered while the thread is active"
    );
    harness.fake.set_active(false);
    harness
        .events
        .send(ProviderEvent::Event(Box::new(AgentEvent::TurnCompleted {
            app_thread_id: AppThreadId::parse(&thread_id).ok_or("id")?,
            turn: AgentTurn {
                turn_id: TurnId::from_static("turn-wake"),
                status: TurnStatus::Completed,
                origin: TurnOrigin::Provider,
                started_at: 1,
                completed_at: Some(2),
                error: None,
                items: Vec::new(),
            },
        })))
        .await?;
    let completed = harness
        .event_where(|payload| payload["method"] == "turn/completed")
        .await?;
    assert_eq!(completed["params"]["turn"]["itemsView"], "full");
    wait_for_state(&harness.store, "message-busy", OutboxState::Delivered).await?;
    assert_eq!(
        harness
            .fake
            .calls()
            .iter()
            .filter(|call| *call == "turn.start")
            .count(),
        2
    );
    let failed = harness
        .store
        .outbox_list(None)?
        .iter()
        .any(|command| command.state == OutboxState::Failed);
    assert!(!failed);
    harness.stop();
    Ok(())
}

#[tokio::test]
async fn missing_capability_answers_32072_without_contacting_the_provider() -> TestResult {
    let mut harness = Harness::start(default_answer, |_| Vec::new()).await?;
    let thread_id = harness.new_fake_thread().await?;
    let before = harness.fake.calls();
    for (method, capability) in [
        ("review/start", "review"),
        ("thread/fork", "threads.fork"),
        ("thread/goal/get", "goals"),
        ("thread/backgroundTerminals/list", "backgroundTerminals"),
        ("companion/threadResources/read", "history.threadResources"),
    ] {
        let response = harness
            .rpc(method, method, json!({"threadId": thread_id}))
            .await?;
        assert_eq!(response["error"]["code"], -32072, "{method}");
        assert_eq!(
            response["error"]["message"],
            format!("{capability} is not supported by this thread's agent")
        );
        assert_eq!(response["error"]["data"]["capability"], capability);
        assert_eq!(response["error"]["data"]["provider"], FAKE);
    }
    assert_eq!(harness.fake.calls(), before);
    harness.stop();
    Ok(())
}

#[tokio::test]
async fn a_thread_of_a_disabled_provider_answers_32070() -> TestResult {
    let ghost_thread = AppThreadId::parse("0199a3c4-7a8e-7b2c-9d1e-2f3a4b5c6d7e").ok_or("id")?;
    let bound = ghost_thread.clone();
    let mut harness = Harness::start(default_answer, move |_| {
        vec![(bound, ProviderId::from_static("ghost"))]
    })
    .await?;
    let response = harness
        .rpc(
            "read",
            "thread/read",
            json!({"threadId": ghost_thread.as_str()}),
        )
        .await?;
    assert_eq!(response["error"]["code"], -32070);
    assert_eq!(
        response["error"]["message"],
        "Ghost provider is disabled on this host"
    );
    assert!(harness.observed_methods().is_empty());
    harness.stop();
    Ok(())
}

#[tokio::test]
async fn an_unknown_thread_answers_the_primary_not_found_and_is_not_bound() -> TestResult {
    let mut harness = Harness::start(default_answer, |_| Vec::new()).await?;
    let response = harness
        .rpc(
            "interrupt",
            "turn/interrupt",
            json!({"threadId": "missing-thread", "turnId": "t"}),
        )
        .await?;
    assert_eq!(response["error"]["code"], -32600);
    assert_eq!(
        response["error"]["message"],
        "thread not found: missing-thread"
    );
    assert!(harness.store.agent_binding("missing-thread")?.is_none());
    harness.stop();
    Ok(())
}

#[tokio::test]
async fn runtime_request_ids_are_namespaced_and_answers_reach_the_asking_provider() -> TestResult {
    let mut harness = Harness::start(default_answer, |_| Vec::new()).await?;
    let thread_id = harness.new_fake_thread().await?;
    let app_thread_id = AppThreadId::parse(&thread_id).ok_or("id")?;
    harness
        .events
        .send(ProviderEvent::Event(Box::new(AgentEvent::RequestOpened {
            app_thread_id: app_thread_id.clone(),
            turn_id: TurnId::from_static("turn-1"),
            request_id: NativeRequestId::Text("perm-1".into()),
            request: RuntimeRequest::Approval {
                kind: ApprovalKind::Tool,
                item_id: ItemId::from_static("toolu_1"),
                title: "Fetch https://example.com".into(),
                detail: Some("WebFetch".into()),
                command: Some("WebFetch https://example.com".into()),
                cwd: None,
                decisions: vec![ApprovalDecision::Accept, ApprovalDecision::Decline],
            },
        })))
        .await?;
    let approval = harness
        .event_where(|payload| payload["method"] == "item/commandExecution/requestApproval")
        .await?;
    assert_eq!(approval["id"], "cw-fake:\"perm-1\"");
    assert_eq!(
        approval["params"]["codewideApprovalTitle"],
        "Fetch https://example.com"
    );
    harness
        .pushed
        .send(json!({
            "id": 7,
            "method": "item/tool/requestUserInput",
            "params": {"threadId": "codex-1", "turnId": "t", "itemId": "i", "questions": [], "isBlocking": true, "autoResolutionMs": null}
        }))
        .await?;
    let codex_question = harness
        .event_where(|payload| payload["method"] == "item/tool/requestUserInput")
        .await?;
    assert_eq!(
        codex_question["id"], 7,
        "primary ids pass through unchanged"
    );

    send_json(
        &mut harness.client,
        &json!({"type": "serverResponse", "response": {"id": "cw-fake:\"perm-1\"", "result": {"decision": "accept"}}}),
    )
    .await?;
    receive_type_where(&mut harness.client, "serverResponseAccepted").await?;
    let responses = harness.fake.responses.lock().map_err(|_| "lock")?.clone();
    assert_eq!(responses.len(), 1);
    assert_eq!(
        responses[0].request_id,
        NativeRequestId::Text("perm-1".into())
    );
    assert_eq!(
        responses[0].response,
        RuntimeResponse::Approval {
            decision: ApprovalDecision::Accept
        }
    );
    send_json(
        &mut harness.client,
        &json!({"type": "serverResponse", "response": {"id": 7, "result": {"answers": {}}}}),
    )
    .await?;
    receive_type_where(&mut harness.client, "serverResponseAccepted").await?;
    timeout(Duration::from_secs(2), async {
        loop {
            if harness
                .observed_methods()
                .iter()
                .any(|method| method == "serverResponse")
            {
                return;
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    })
    .await?;
    harness.stop();
    Ok(())
}

#[tokio::test]
async fn a_provider_reconnect_resolves_only_its_own_user_requests() -> TestResult {
    let mut harness = Harness::start(default_answer, |_| Vec::new()).await?;
    let thread_id = harness.new_fake_thread().await?;
    harness
        .events
        .send(ProviderEvent::Event(Box::new(AgentEvent::RequestOpened {
            app_thread_id: AppThreadId::parse(&thread_id).ok_or("id")?,
            turn_id: TurnId::from_static("turn-1"),
            request_id: NativeRequestId::Text("perm-9".into()),
            request: RuntimeRequest::UserInput {
                item_id: ItemId::from_static("toolu_9"),
                questions: Vec::new(),
            },
        })))
        .await?;
    harness
        .event_where(|payload| payload["id"] == "cw-fake:\"perm-9\"")
        .await?;
    harness
        .pushed
        .send(json!({
            "id": 8,
            "method": "item/tool/requestUserInput",
            "params": {"threadId": "codex-1", "turnId": "t", "itemId": "i", "questions": [], "isBlocking": true, "autoResolutionMs": null}
        }))
        .await?;
    harness.event_where(|payload| payload["id"] == 8).await?;
    harness.fake.status.send(ProviderStatus::Reconnecting)?;
    let resolved = harness
        .event_where(|payload| payload["method"] == "serverRequest/resolved")
        .await?;
    assert_eq!(resolved["params"]["requestId"], "cw-fake:\"perm-9\"");
    assert_eq!(resolved["params"]["reason"], "upstream_disconnected");
    // The primary provider's question is still pending for a new client.
    let (_second, hello) = connect_client_with_hello(&harness.url).await?;
    let pending = hello["pendingRequests"]
        .as_array()
        .map(|requests| {
            requests
                .iter()
                .map(|request| request["id"].clone())
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    assert_eq!(pending, vec![json!(8)]);
    harness.stop();
    Ok(())
}

#[tokio::test]
async fn thread_list_merges_non_primary_rows_inside_the_lead_window() -> TestResult {
    let mut harness = Harness::start(default_answer, |_| Vec::new()).await?;
    {
        let mut threads = harness.fake.threads.lock().map_err(|_| "lock")?;
        for (id, key) in [
            ("0199a3c4-0000-7000-8000-000000000001", 250),
            ("0199a3c4-0000-7000-8000-000000000002", 50),
        ] {
            threads.push(agent_thread(AppThreadId::parse(id).ok_or("id")?, key));
        }
    }
    let first = harness
        .rpc(
            "list",
            "thread/list",
            json!({"archived": false, "cursor": null, "limit": 2, "modelProviders": [],
                   "sortDirection": "desc", "sortKey": "recency_at", "sourceKinds": ["cli", "vscode"],
                   "useStateDbOnly": true}),
        )
        .await?;
    let rows = first["result"]["data"]
        .as_array()
        .cloned()
        .unwrap_or_default();
    let ids = rows
        .iter()
        .filter_map(|row| row["id"].as_str())
        .collect::<Vec<_>>();
    assert_eq!(
        ids,
        ["codex-1", "0199a3c4-0000-7000-8000-000000000001", "codex-2"]
    );
    assert!(
        rows.iter()
            .all(|row| row["codewideAgent"]["provider"].is_string())
    );
    assert_eq!(rows[1]["modelProvider"], "fake-models");
    let cursor = first["result"]["nextCursor"]
        .as_str()
        .ok_or("composite cursor")?
        .to_owned();
    assert!(cursor.starts_with("cwl1."));
    let lead_requests = harness
        .observed
        .try_recv()
        .ok()
        .filter(|request| request["method"] == "thread/list")
        .ok_or("lead thread/list was not forwarded")?;
    assert_eq!(lead_requests["params"]["cursor"], Value::Null);
    harness.stop();
    Ok(())
}

#[tokio::test]
async fn model_list_merges_catalogs_with_one_default() -> TestResult {
    let mut harness = Harness::start(default_answer, |_| Vec::new()).await?;
    let models = harness
        .rpc("models", "model/list", json!({"limit": 100}))
        .await?;
    let rows = models["result"]["data"]
        .as_array()
        .cloned()
        .unwrap_or_default();
    assert_eq!(rows.len(), 2);
    assert_eq!(rows[0]["codewideAgentProvider"], "codex");
    assert_eq!(rows[1]["codewideAgentProvider"], FAKE);
    assert_eq!(rows[1]["displayName"], "Fake · Default (recommended)");
    assert_eq!(
        rows.iter().filter(|row| row["isDefault"] == true).count(),
        1
    );
    assert_eq!(rows[0]["isDefault"], true);
    harness.stop();
    Ok(())
}

async fn wait_for_state(
    store: &Arc<IndexStore>,
    command_id: &str,
    state: OutboxState,
) -> TestResult {
    timeout(Duration::from_secs(3), async {
        loop {
            if store
                .outbox_list(None)?
                .iter()
                .any(|command| command.command_id == command_id && command.state == state)
            {
                return Ok::<(), Box<dyn std::error::Error>>(());
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    })
    .await??;
    Ok(())
}

async fn connect_client_with_hello(
    url: &str,
) -> Result<(ClientSocket, Value), Box<dyn std::error::Error>> {
    let mut request = url.into_client_request()?;
    request.headers_mut().insert(
        "authorization",
        HeaderValue::from_str(&format!("Bearer {TOKEN}"))?,
    );
    let (mut socket, _response) = connect_async(request).await?;
    send_json(
        &mut socket,
        &json!({"type": "hello", "protocolVersion": 1, "cursor": null}),
    )
    .await?;
    let hello = receive_type_where(&mut socket, "hello").await?;
    send_json(
        &mut socket,
        &json!({"type": "snapshotApplied", "cursor": hello["headCursor"]}),
    )
    .await?;
    receive_type_where(&mut socket, "caughtUp").await?;
    Ok((socket, hello))
}

async fn receive_any(socket: &mut ClientSocket) -> Result<Value, Box<dyn std::error::Error>> {
    loop {
        let frame = socket.next().await.ok_or("WebSocket closed")??;
        if let Message::Text(raw) = frame {
            return Ok(serde_json::from_str(&raw)?);
        }
    }
}

async fn receive_type_where(
    socket: &mut ClientSocket,
    expected: &str,
) -> Result<Value, Box<dyn std::error::Error>> {
    timeout(Duration::from_secs(3), async {
        loop {
            let value = receive_any(socket).await?;
            if value["type"] == expected {
                return Ok(value);
            }
        }
    })
    .await?
}

async fn send_json(socket: &mut ClientSocket, value: &Value) -> TestResult {
    socket.send(Message::Text(value.to_string().into())).await?;
    Ok(())
}

async fn wait_for_live(upstream: &UpstreamHandle) -> TestResult {
    let mut status = upstream.subscribe_status();
    timeout(Duration::from_secs(2), async {
        loop {
            if *status.borrow() == ConnectionStatus::Live {
                return Ok::<(), Box<dyn std::error::Error>>(());
            }
            status.changed().await?;
        }
    })
    .await??;
    Ok(())
}

async fn receive_value(
    socket: &mut WebSocketStream<UnixStream>,
) -> Result<Value, Box<dyn std::error::Error + Send + Sync>> {
    loop {
        let frame = socket.next().await.ok_or("WebSocket closed")??;
        if let Message::Text(raw) = frame {
            return Ok(serde_json::from_str(&raw)?);
        }
    }
}

async fn send_value(
    socket: &mut WebSocketStream<UnixStream>,
    value: &Value,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    socket.send(Message::Text(value.to_string().into())).await?;
    Ok(())
}

/// Real sidecar smoke without any model call. Run with
/// `CODEWIDE_SMOKE_NODE=<node> CODEWIDE_SMOKE_SIDECAR=<dist/main.js>
/// CODEWIDE_SMOKE_CLAUDE=<claude> cargo test -p codewide-companion --test
/// agent_providers -- --ignored real_sidecar`.
#[tokio::test]
#[ignore = "needs a built sidecar, Node and the claude CLI on the host"]
async fn real_sidecar_serves_threads_catalogs_and_degradation_without_a_turn() -> TestResult {
    use codewide_companion::agent::{
        providers::claude::{ClaudeConfig, ClaudeProvider},
        registry::ProviderRegistry,
    };

    let variable = |name: &str| std::env::var(name).map_err(|_| format!("{name} is not set"));
    let directory = tempfile::tempdir()?;
    let socket_path = directory.path().join("app-server.sock");
    let upstream_path = socket_path.clone();
    let (_pushed, pushed_rx) = mpsc::channel(4);
    let (observed_tx, _observed) = mpsc::unbounded_channel();
    let app_server = tokio::spawn(async move {
        let _ = run_app_server(socket_path, pushed_rx, observed_tx, default_answer).await;
    });
    let upstream = UpstreamHandle::spawn(upstream_path);
    wait_for_live(&upstream).await?;
    let claude = ClaudeProvider::spawn(&ClaudeConfig::parse(&json!({
        "runtimeExecutable": variable("CODEWIDE_SMOKE_NODE")?,
        "sidecarEntry": variable("CODEWIDE_SMOKE_SIDECAR")?,
        "claudeExecutable": variable("CODEWIDE_SMOKE_CLAUDE")?,
        "journalDirectory": directory.path().join("journal"),
    }))?);
    let mut status = claude.subscribe_status();
    timeout(Duration::from_secs(30), async {
        while *status.borrow() != ProviderStatus::Live {
            status.changed().await?;
        }
        Ok::<(), Box<dyn std::error::Error>>(())
    })
    .await??;
    let store = Arc::new(IndexStore::open(directory.path().join("state.redb"))?);
    let history = HistoryService::new(
        Arc::new(SessionCatalog::scan(directory.path())),
        store.clone(),
    );
    let registry = ProviderRegistry::new(
        vec![
            Arc::new(CodexProvider::new(upstream).with_storage(CodexStorage::new(history)))
                as Arc<dyn AgentProvider>,
            claude.clone() as Arc<dyn AgentProvider>,
        ],
        &ProviderId::from_static("codex"),
        Vec::new(),
    )?;
    let sync = SyncHub::with_registry(Arc::new(registry), store.clone(), true);
    let listener = TcpListener::bind("127.0.0.1:0").await?;
    let address = listener.local_addr()?;
    let app = server::router(store.clone(), Arc::from(TOKEN), sync);
    let server_task = tokio::spawn(async move {
        let _ = axum::serve(listener, app).await;
    });
    let (client, _) = connect_client_with_hello(&format!("ws://{address}/v1/sync")).await?;
    let (fake, events) = FakeNeutral::new();
    let (pushed, _) = mpsc::channel(1);
    let (_, observed) = mpsc::unbounded_channel();
    let mut harness = Harness {
        client,
        fake,
        events,
        pushed,
        observed,
        store,
        url: String::new(),
        tasks: vec![app_server, server_task],
        _directory: directory,
    };
    let models = harness
        .rpc("models", "model/list", json!({"limit": 100}))
        .await?;
    let claude_rows = models["result"]["data"]
        .as_array()
        .map(|rows| {
            rows.iter()
                .filter(|row| row["codewideAgentProvider"] == "claude")
                .cloned()
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    assert!(!claude_rows.is_empty(), "{models}");
    assert!(claude_rows.iter().all(|row| {
        row["displayName"]
            .as_str()
            .is_some_and(|name| name.starts_with("Claude · "))
    }));
    let model = claude_rows[0]["model"].clone();
    let started = harness
        .rpc(
            "start",
            "thread/start",
            json!({"cwd": "/tmp", "model": model, "codewideAgentProvider": "claude"}),
        )
        .await?;
    let thread_id = started["result"]["thread"]["id"]
        .as_str()
        .ok_or_else(|| format!("thread/start failed: {started}"))?
        .to_owned();
    assert_eq!(
        started["result"]["thread"]["codewideAgent"]["provider"],
        "claude"
    );
    let read = harness
        .rpc("read", "thread/read", json!({"threadId": thread_id}))
        .await?;
    assert_eq!(read["result"]["thread"]["id"], thread_id);
    let interrupted = harness
        .rpc(
            "interrupt",
            "turn/interrupt",
            json!({"threadId": thread_id, "turnId": null}),
        )
        .await?;
    assert_eq!(interrupted["result"], json!({}), "{interrupted}");
    let review = harness
        .rpc("review", "review/start", json!({"threadId": thread_id}))
        .await?;
    assert_eq!(review["error"]["code"], -32072);
    let synced = harness
        .rpc(
            "sync",
            "companion/thread/sync",
            json!({"threadId": thread_id, "limit": 20}),
        )
        .await?;
    assert_eq!(synced["result"]["history"]["kind"], "reset", "{synced}");
    harness.stop();
    Ok(())
}
