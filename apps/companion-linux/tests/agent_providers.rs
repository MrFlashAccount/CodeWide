//! Contract tests of the agent provider layer through the real sync
//! transport: a fake Codex App Server behind the Codex adapter is the
//! primary provider and an in-process fake neutral provider is the second
//! one. They prove routing by binding, capability degradation, busy-start
//! requeue, runtime request namespacing and per-provider cleanup, and the
//! multi-provider list and catalog merges.
#![cfg(unix)]
#![allow(clippy::too_many_lines)]

#[path = "agent_providers/usage_replay.rs"]
mod usage_replay;

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
            NativeRequestId, PermissionProfileCatalog, PermissionProfileEntry, ProviderDescriptor,
            ProviderId, RequestRespondParams, RpcError, RuntimeRequest, RuntimeResponse,
            StartWhileActiveMode, ThreadCreateParams, ThreadListParams, ThreadListResult,
            ThreadOrigin, ThreadReadResult, ThreadSettings, ThreadStatus, ThreadTurnsParams,
            ThreadTurnsResult, ThreadUpdateParams, ThreadUpdateResult, TurnId, TurnInterruptParams,
            TurnOrigin, TurnStartParams, TurnStartResult, TurnStatus, TurnSteerParams,
            TurnSteerResult,
        },
        provider::{
            AgentProvider, NativeThreadResources, ProviderError, ProviderEvent, ProviderFence,
            ProviderStatus, SearchWindow, StoredMessageSearch,
        },
        providers::codex::{CodexProvider, storage::CodexStorage},
        registry::ProviderRegistry,
    },
    catalog::SessionCatalog,
    history_service::HistoryService,
    rollout_store::RolloutStore,
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

use live_provider::{
    connect_client_with_hello, receive_any, receive_type_where, receive_value, send_json,
    send_value, wait_for_live, wait_for_state,
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
    capabilities.threads_cross_provider_fork = true;
    capabilities
}

/// In-process neutral provider with scripted answers.
struct FakeNeutral {
    calls: Mutex<Vec<String>>,
    threads: Mutex<Vec<AgentThread>>,
    turn_starts: Mutex<VecDeque<TurnStartResult>>,
    started: Mutex<Vec<TurnStartParams>>,
    /// Every `thread.update` change, serialized.
    updates: Mutex<Vec<Value>>,
    active: Mutex<bool>,
    responses: Mutex<Vec<RequestRespondParams>>,
    events: Mutex<Option<mpsc::Receiver<ProviderEvent>>>,
    status: watch::Sender<ProviderStatus>,
    /// Stored history of a provider with its own index (Claude-like).
    stored: std::sync::OnceLock<Arc<FakeStored>>,
    pricing: Arc<agent_core::usage::CatalogPricing>,
}

/// Thread resources and message search of a provider's own index.
#[derive(Default)]
struct FakeStored {
    reads: Mutex<Vec<(String, String)>>,
    observed: Mutex<Vec<String>>,
}

impl FakeStored {
    fn reads(&self) -> Vec<(String, String)> {
        self.reads
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .clone()
    }

    fn observed(&self) -> Vec<String> {
        self.observed
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .clone()
    }

    fn record(&self, method: &str, params: &Value) {
        self.reads
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .push((
                method.to_owned(),
                params["threadId"].as_str().unwrap_or_default().to_owned(),
            ));
    }
}

#[async_trait]
impl NativeThreadResources for FakeStored {
    fn handles(&self, method: &str) -> bool {
        method.starts_with("companion/thread") && method.ends_with("/read")
    }

    async fn read(&self, method: &str, params: &Value) -> Result<Value, String> {
        self.record(method, params);
        Ok(json!({"threadId": params["threadId"], "from": "fake-index"}))
    }

    fn prewarm(&self, _thread_id: &str) {}

    async fn observe_event(&self, payload: &Value) {
        self.observed
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .push(payload["method"].as_str().unwrap_or_default().to_owned());
    }

    async fn observe_rpc_result(&self, _method: &str, _result: &Value) {}
}

#[async_trait]
impl StoredMessageSearch for FakeStored {
    async fn search(&self, params: &Value) -> Result<Value, String> {
        self.record("companion/search", params);
        Ok(
            json!({"data": [{"messageId": 7, "threadId": "fake-hit", "turnId": "t",
            "title": "", "project": "/work", "timestamp": "2099-01-01T00:00:00Z",
            "sourceOffset": 1, "kind": "user_message", "excerpt": "hello"}],
            "nextOffset": null, "indexing": false, "failedSources": 0}),
        )
    }

    async fn context(&self, params: &Value) -> Result<Value, String> {
        self.record("companion/search/context", params);
        Ok(json!({"messages": [], "older": null, "newer": null}))
    }

    async fn window(&self, params: &Value) -> Result<SearchWindow, String> {
        self.record("companion/search/window", params);
        Ok(SearchWindow {
            page: json!({"messages": [], "older": null, "newer": null}),
            turns: vec![AgentTurn {
                turn_id: TurnId::from_static("window-turn"),
                status: TurnStatus::Completed,
                origin: TurnOrigin::User,
                started_at: 1,
                completed_at: Some(2),
                error: None,
                items: Vec::new(),
                provenance: None,
                usage: None,
            }],
        })
    }
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
                started: Mutex::new(Vec::new()),
                updates: Mutex::new(Vec::new()),
                active: Mutex::new(false),
                responses: Mutex::new(Vec::new()),
                events: Mutex::new(Some(receiver)),
                status,
                stored: std::sync::OnceLock::new(),
                pricing: Arc::new(agent_core::usage::CatalogPricing::default()),
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
        spawn: None,
    }
}

fn not_found(id: &AppThreadId) -> ProviderError {
    ProviderError::Rejected(RpcError::new(-32_600, format!("thread not found: {id}")))
}

#[async_trait]
impl AgentProvider for FakeNeutral {
    fn usage_pricing(&self) -> Option<Arc<dyn agent_core::usage::ModelPricing>> {
        Some(self.pricing.clone())
    }

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
        let mut capabilities = neutral_capabilities();
        let stored = self.stored.get().is_some();
        capabilities.history_thread_resources = stored;
        capabilities.history_message_search = stored;
        capabilities
    }

    fn thread_resources(&self) -> Option<Arc<dyn NativeThreadResources>> {
        let stored: Arc<dyn NativeThreadResources> = self.stored.get()?.clone();
        Some(stored)
    }

    fn message_search(&self) -> Option<Arc<dyn StoredMessageSearch>> {
        let stored: Arc<dyn StoredMessageSearch> = self.stored.get()?.clone();
        Some(stored)
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
            prices: std::collections::BTreeMap::new(),
        })
    }

    async fn catalog_permission_profiles(&self) -> Result<PermissionProfileCatalog, ProviderError> {
        Ok(PermissionProfileCatalog {
            profiles: [":read-only", ":workspace", ":danger-full-access"]
                .into_iter()
                .map(|id| PermissionProfileEntry {
                    id: id.into(),
                    display_name: id.into(),
                    description: String::new(),
                })
                .collect(),
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
        params: ThreadUpdateParams,
    ) -> Result<ThreadUpdateResult, ProviderError> {
        self.record("thread.update");
        self.updates
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .push(serde_json::to_value(&params.change).unwrap_or(Value::Null));
        Ok(ThreadUpdateResult { thread: None })
    }

    async fn thread_owns(&self, thread: &AppThreadId) -> Result<bool, ProviderError> {
        Ok(self.thread(thread).is_some())
    }

    async fn thread_compact(&self, _: &AppThreadId) -> Result<(), ProviderError> {
        self.record("thread.compact");
        Ok(())
    }

    async fn turn_start(&self, params: TurnStartParams) -> Result<TurnStartResult, ProviderError> {
        self.record("turn.start");
        self.started
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .push(params);
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
        Some("permissionProfile/list") => json!({"result": {
            "data": [
                {"id": ":read-only", "displayName": "Read only", "description": ""},
                {"id": ":workspace", "displayName": "Workspace", "description": ""},
                {"id": ":danger-full-access", "displayName": "Full access", "description": ""}
            ]
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
        Self::start_with(answer, prepare, None).await
    }

    async fn start_with(
        answer: fn(&Value) -> Value,
        prepare: impl FnOnce(&Arc<IndexStore>) -> Vec<(AppThreadId, ProviderId)>,
        stored: Option<Arc<FakeStored>>,
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
            Arc::new(RolloutStore::attach(store.database(), store.clone())?),
        );
        let (fake, events) = FakeNeutral::new();
        if let Some(stored) = stored {
            let _ = fake.stored.set(stored);
        }
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

#[path = "agent_providers/cross_provider.rs"]
mod cross_provider;
#[path = "agent_providers/live_provider.rs"]
mod live_provider;
#[path = "agent_providers/routing.rs"]
mod routing;
