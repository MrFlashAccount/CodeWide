use std::{
    collections::{HashMap, HashSet, VecDeque},
    sync::Arc,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

use axum::extract::ws::{Message, WebSocket};
use futures_util::{
    SinkExt, StreamExt,
    stream::{SplitSink, SplitStream},
};
use rand::Rng;
use serde_json::{Map, Value, json};
use tracing::{debug, info, warn};

use crate::{
    account_pool::{AccountPoolError, AccountPoolService},
    auth::{AuthorizationChange, AuthorizationContext},
    content::ContentProjector,
    dictation::DictationService,
    files::FileService,
    history_service::HistoryService,
    projects::ProjectService,
    remote_inputs::{RemoteInputError, prepare_remote_file_inputs},
    resources::ResourceService,
    store::{
        IndexStore, IndexedThreadMetadata, OutboxCommand, OutboxPresentation, OutboxState,
        ReplayPage,
    },
    thread_view::ThreadViewService,
    upstream::{ConnectionStatus, UpstreamError, UpstreamHandle},
    workspaces::{WorkspacePhase, WorkspaceService},
};

const MAX_REPLAY_ENTRIES: usize = 2_048;
const MAX_REPLAY_BYTES: u64 = 4 * 1024 * 1024;
const MAX_LIVE_SIGNALS: usize = 128;
const MAX_REPLAY_BATCH_ENTRIES: usize = 256;
const REPLAY_BATCH_DELAY: Duration = Duration::from_millis(16);
const MAX_COALESCED_TEXT_DELTA_BYTES: usize = 64 * 1024;
const MAX_STREAM_DIAGNOSTIC_TURNS: usize = 4_096;
const MAX_PENDING_SERVER_REQUESTS: usize = 1_024;
const MAX_PENDING_SERVER_REQUEST_BYTES: usize = 4 * 1024 * 1024;
const MAX_SINGLE_SERVER_REQUEST_BYTES: usize = 1024 * 1024;
const MAX_RECENT_TURN_STARTS: usize = 4_096;
const OUTBOX_POLL_INTERVAL: Duration = Duration::from_millis(500);
const OUTBOX_RETRY_BASE_MS: u64 = 1_000;
const OUTBOX_RETRY_MAX_MS: u64 = 30_000;
const OUTBOX_ACCOUNT_SWITCH_WAIT_MS: u64 = 1_000;
const OUTBOX_RECONCILE_PAGE_SIZE: u64 = 100;
const ROLLOUT_UPSTREAM_SUPPRESSION: Duration = Duration::from_secs(2);
const ROLLOUT_RECONCILIATION_POLL: Duration = Duration::from_millis(50);
const MAX_RECENT_UPSTREAM_THREADS: usize = 4_096;
const MAX_CONCURRENT_SESSION_RPCS: usize = 32;
const USER_SERVER_REQUEST_METHODS: [&str; 5] = [
    "item/commandExecution/requestApproval",
    "item/fileChange/requestApproval",
    "item/tool/requestUserInput",
    "item/permissions/requestApproval",
    "mcpServer/elicitation/request",
];

#[derive(Clone)]
pub struct SyncHub {
    upstream: UpstreamHandle,
    store: Arc<IndexStore>,
    history: HistoryService,
    thread_view: ThreadViewService,
    events: tokio::sync::broadcast::Sender<DurableSignal>,
    local_events: tokio::sync::mpsc::Sender<Value>,
    server_requests: Arc<tokio::sync::Mutex<PendingServerRequests>>,
    recent_turn_starts: Arc<tokio::sync::Mutex<RecentTurnStarts>>,
    mutation_mode: MutationMode,
    outbox_wakeup: Arc<tokio::sync::Notify>,
    content_projector: Arc<std::sync::RwLock<Option<Arc<ContentProjector>>>>,
    dictation: Arc<std::sync::RwLock<Option<Arc<DictationService>>>>,
    files: Arc<std::sync::RwLock<Option<Arc<FileService>>>>,
    resources: Arc<std::sync::RwLock<Option<Arc<ResourceService>>>>,
    account_pool: Arc<std::sync::RwLock<Option<Arc<AccountPoolService>>>>,
    projects: Arc<std::sync::RwLock<Option<Arc<ProjectService>>>>,
    workspaces: Arc<std::sync::RwLock<Option<Arc<WorkspaceService>>>>,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum MutationMode {
    ReadOnlyShadow,
    Active,
}

#[derive(Clone)]
enum DurableSignal {
    Committed(u64),
    Failed,
}

struct InitialSession {
    ready: bool,
    snapshot_cursor: Option<u64>,
    snapshot_started_at: Option<Instant>,
    delivered_cursor: u64,
}

enum AuthorizationChangeOutcome {
    Continue,
    Disable,
    Close,
}

enum OutboxDeliveryError {
    Deferred(String),
    Uncertain(String),
}

enum TurnStartDispatchError {
    AccountPool(AccountPoolError),
    Upstream(UpstreamError),
}

impl TurnStartDispatchError {
    fn message(&self) -> String {
        match self {
            Self::AccountPool(error) => error.to_string(),
            Self::Upstream(error) => error.to_string(),
        }
    }

    fn into_outbox(self) -> OutboxDeliveryError {
        match self {
            Self::AccountPool(AccountPoolError::Deferred(reason)) => {
                OutboxDeliveryError::Deferred(reason)
            }
            Self::AccountPool(error) => OutboxDeliveryError::Uncertain(error.to_string()),
            Self::Upstream(error @ (UpstreamError::Reconnecting | UpstreamError::Backpressure)) => {
                OutboxDeliveryError::Deferred(error.to_string())
            }
            Self::Upstream(error) => OutboxDeliveryError::Uncertain(error.to_string()),
        }
    }
}

enum LiveReplayError {
    Journal,
    SnapshotRequired,
    Socket,
}

fn log_replay_selection(phase: &'static str, requested_cursor: Option<u64>, replay: &ReplayPage) {
    info!(
        phase,
        requested_cursor = ?requested_cursor,
        head_cursor = replay.head_cursor,
        oldest_cursor = ?replay.oldest_cursor,
        retained_entries = replay.retained_entries,
        retained_bytes = replay.retained_bytes,
        replay_entries = replay.entries.len(),
        snapshot_required = replay.snapshot_required,
        "sync client replay selected"
    );
}

/// Cloneable, single-writer half of a sync WebSocket.
///
/// The receive loop must never await an RPC or a replay write: either can be
/// delayed by App Server work or network backpressure. Splitting the socket
/// lets the reader continue dispatching independent requests while this small
/// mutex preserves WebSocket frame integrity.
#[derive(Clone)]
struct SessionSocket {
    sink: Arc<tokio::sync::Mutex<SplitSink<WebSocket, Message>>>,
}

impl SessionSocket {
    fn new(sink: SplitSink<WebSocket, Message>) -> Self {
        Self {
            sink: Arc::new(tokio::sync::Mutex::new(sink)),
        }
    }

    async fn send(&self, message: Message) -> Result<(), axum::Error> {
        self.sink.lock().await.send(message).await
    }
}

#[derive(Clone, Default)]
struct ThreadMutationLanes {
    lanes: Arc<std::sync::Mutex<HashMap<String, Arc<tokio::sync::Mutex<()>>>>>,
}

impl ThreadMutationLanes {
    fn for_request(&self, request: Option<&Value>) -> Option<Arc<tokio::sync::Mutex<()>>> {
        let thread_id = rpc_thread_mutation_id(request?)?;
        let mut lanes = match self.lanes.lock() {
            Ok(lanes) => lanes,
            Err(poisoned) => poisoned.into_inner(),
        };
        Some(
            lanes
                .entry(thread_id.to_owned())
                .or_insert_with(|| Arc::new(tokio::sync::Mutex::new(())))
                .clone(),
        )
    }
}

#[derive(Default)]
struct PendingServerRequests {
    requests: HashMap<String, Value>,
    resolving: HashSet<String>,
    bytes: usize,
}

#[derive(Default)]
struct RecentTurnStarts {
    keys: HashSet<String>,
    order: VecDeque<String>,
}

#[derive(Clone, Debug, Eq, Hash, PartialEq)]
struct AgentStreamKey {
    thread_id: String,
    turn_id: String,
}

#[derive(Default)]
struct AgentStreamTurnDiagnostics {
    first_delta_at: Option<Instant>,
    input_delta_events: u64,
    emitted_delta_events: u64,
    delta_chars: u64,
    delta_bytes: u64,
    ingest_batches: u64,
}

#[derive(Default)]
struct AgentStreamDiagnostics {
    turns: HashMap<AgentStreamKey, AgentStreamTurnDiagnostics>,
}

impl AgentStreamDiagnostics {
    fn observe_input_batch(&mut self, payloads: &[Value]) {
        let mut batch_keys = HashSet::new();
        for payload in payloads {
            let Some((key, delta)) = agent_message_delta(payload) else {
                continue;
            };
            let entry = self.turns.entry(key.clone()).or_default();
            entry.first_delta_at.get_or_insert_with(Instant::now);
            entry.input_delta_events = entry.input_delta_events.saturating_add(1);
            entry.delta_chars = entry
                .delta_chars
                .saturating_add(u64::try_from(delta.chars().count()).unwrap_or(u64::MAX));
            entry.delta_bytes = entry
                .delta_bytes
                .saturating_add(u64::try_from(delta.len()).unwrap_or(u64::MAX));
            batch_keys.insert(key);
        }
        for key in batch_keys {
            if let Some(entry) = self.turns.get_mut(&key) {
                entry.ingest_batches = entry.ingest_batches.saturating_add(1);
            }
        }
        if self.turns.len() > MAX_STREAM_DIAGNOSTIC_TURNS {
            warn!(
                turns = self.turns.len(),
                "agent stream diagnostic state exceeded its bound; resetting aggregates"
            );
            self.turns.clear();
        }
    }

    fn observe_emitted_batch(&mut self, payloads: &[Value]) {
        for payload in payloads {
            let Some((key, _)) = agent_message_delta(payload) else {
                continue;
            };
            let entry = self.turns.entry(key).or_default();
            entry.emitted_delta_events = entry.emitted_delta_events.saturating_add(1);
        }
    }

    fn finish_completed_turns(&mut self, payloads: &[Value]) {
        for payload in payloads {
            if payload.get("method").and_then(Value::as_str) != Some("turn/completed") {
                continue;
            }
            let Some(key) = agent_stream_key(payload) else {
                continue;
            };
            let Some(diagnostic) = self.turns.remove(&key) else {
                continue;
            };
            info!(
                thread_id = %key.thread_id,
                turn_id = %key.turn_id,
                input_delta_events = diagnostic.input_delta_events,
                emitted_delta_events = diagnostic.emitted_delta_events,
                delta_chars = diagnostic.delta_chars,
                delta_bytes = diagnostic.delta_bytes,
                ingest_batches = diagnostic.ingest_batches,
                stream_duration_ms = diagnostic.first_delta_at.map_or(0, |started| u64::try_from(started.elapsed().as_millis()).unwrap_or(u64::MAX)),
                "agent stream completed"
            );
        }
    }
}

impl RecentTurnStarts {
    fn seen_or_insert(&mut self, params: &Value) -> bool {
        let Some(thread_id) = params.get("threadId").and_then(Value::as_str) else {
            return false;
        };
        let Some(client_id) = params.get("clientUserMessageId").and_then(Value::as_str) else {
            return false;
        };
        let key = format!("{thread_id}\0{client_id}");
        if self.keys.contains(&key) {
            return true;
        }
        self.keys.insert(key.clone());
        self.order.push_back(key);
        while self.order.len() > MAX_RECENT_TURN_STARTS {
            if let Some(expired) = self.order.pop_front() {
                self.keys.remove(&expired);
            }
        }
        false
    }
}

fn spawn_live_replay_task(
    socket: SessionSocket,
    store: Arc<IndexStore>,
    mut events: tokio::sync::broadcast::Receiver<DurableSignal>,
    mut delivered_cursor: u64,
    task_failed: tokio::sync::mpsc::UnboundedSender<()>,
) -> tokio::task::JoinHandle<()> {
    tokio::spawn(async move {
        loop {
            let replay_result = match events.recv().await {
                Ok(DurableSignal::Committed(head)) => {
                    if head <= delivered_cursor {
                        continue;
                    }
                    let result =
                        send_live_replay_after(&socket, store.clone(), delivered_cursor).await;
                    if matches!(result, Err(LiveReplayError::SnapshotRequired)) {
                        warn!(
                            delivered_cursor,
                            head, "sync client fell behind durable replay window"
                        );
                    }
                    result
                }
                Ok(DurableSignal::Failed) => Err(LiveReplayError::Journal),
                Err(tokio::sync::broadcast::error::RecvError::Lagged(skipped)) => {
                    debug!(skipped, "sync client coalesced live wake-up signals");
                    send_live_replay_after(&socket, store.clone(), delivered_cursor).await
                }
                Err(tokio::sync::broadcast::error::RecvError::Closed) => break,
            };
            match replay_result {
                Ok(cursor) => delivered_cursor = cursor,
                Err(LiveReplayError::Socket) => {
                    let _ = task_failed.send(());
                    break;
                }
                Err(LiveReplayError::Journal | LiveReplayError::SnapshotRequired) => {
                    let _ = send_json(&socket, &json!({ "type": "status", "status": "degraded" }))
                        .await;
                    let _ = task_failed.send(());
                    break;
                }
            }
        }
    })
}

impl SyncHub {
    #[must_use]
    pub fn new(upstream: UpstreamHandle, store: Arc<IndexStore>, history: HistoryService) -> Self {
        Self::build(upstream, store, history, MutationMode::ReadOnlyShadow)
    }

    /// Creates a companion whose explicitly exposed mutation methods are live.
    /// This constructor must only be used by an intentional canary or cutover.
    #[must_use]
    pub fn with_mutations(
        upstream: UpstreamHandle,
        store: Arc<IndexStore>,
        history: HistoryService,
    ) -> Self {
        Self::build(upstream, store, history, MutationMode::Active)
    }

    fn build(
        upstream: UpstreamHandle,
        store: Arc<IndexStore>,
        history: HistoryService,
        mutation_mode: MutationMode,
    ) -> Self {
        let thread_view = ThreadViewService::new(upstream.clone(), history.clone());
        // The durable replay journal owns payload bytes. The live channel is
        // only a wake-up edge; tokio broadcast retains its full ring even
        // after every receiver has consumed an entry, so putting JSON Values
        // here would pin the last 2,048 events in RSS indefinitely.
        let (events, _) = tokio::sync::broadcast::channel(MAX_LIVE_SIGNALS);
        let (local_events, ingest_rx) = tokio::sync::mpsc::channel(MAX_REPLAY_ENTRIES);
        let server_requests = Arc::new(tokio::sync::Mutex::new(PendingServerRequests::default()));
        let recent_turn_starts = Arc::new(tokio::sync::Mutex::new(RecentTurnStarts::default()));
        let outbox_wakeup = Arc::new(tokio::sync::Notify::new());
        let content_projector = Arc::new(std::sync::RwLock::new(None));
        let dictation = Arc::new(std::sync::RwLock::new(None));
        let files = Arc::new(std::sync::RwLock::new(None));
        let resources = Arc::new(std::sync::RwLock::new(None));
        let account_pool = Arc::new(std::sync::RwLock::new(None));
        let projects = Arc::new(std::sync::RwLock::new(None));
        let workspaces = Arc::new(std::sync::RwLock::new(None));
        let usage_projector = Arc::new(std::sync::Mutex::new(
            crate::usage::LiveUsageProjector::new(store.clone()),
        ));
        let recent_upstream_threads = Arc::new(std::sync::Mutex::new(HashMap::new()));
        tokio::spawn(forward_upstream_events(
            upstream.subscribe_events(),
            local_events.clone(),
            outbox_wakeup.clone(),
            recent_upstream_threads.clone(),
        ));
        match history.spawn_rollout_monitor() {
            Ok(changes) => {
                tokio::spawn(forward_rollout_changes(
                    changes,
                    history.clone(),
                    local_events.clone(),
                    recent_upstream_threads,
                    resources.clone(),
                ));
            }
            Err(error) => warn!(%error, "canonical rollout monitor is unavailable"),
        }
        tokio::spawn(ingest_events(
            ingest_rx,
            store.clone(),
            events.clone(),
            server_requests.clone(),
            content_projector.clone(),
            resources.clone(),
            usage_projector.clone(),
        ));
        tokio::spawn(clear_server_requests_on_disconnect(
            upstream.subscribe_status(),
            server_requests.clone(),
            local_events.clone(),
        ));
        if mutation_mode == MutationMode::Active {
            tokio::spawn(run_outbox_pump(
                upstream.clone(),
                store.clone(),
                history.clone(),
                outbox_wakeup.clone(),
                local_events.clone(),
                files.clone(),
                account_pool.clone(),
                workspaces.clone(),
            ));
        }
        Self {
            upstream,
            store,
            history,
            thread_view,
            events,
            local_events,
            server_requests,
            recent_turn_starts,
            mutation_mode,
            outbox_wakeup,
            content_projector,
            dictation,
            files,
            resources,
            account_pool,
            projects,
            workspaces,
        }
    }

    #[must_use]
    pub fn upstream_status(&self) -> ConnectionStatus {
        self.upstream.status()
    }

    /// Installs the private-content projector used by both live notifications
    /// and RPC responses. The shared slot is also observed by the already
    /// running ingest task, so no transport task needs to be restarted.
    #[must_use]
    pub fn with_content_projector(self, projector: Arc<ContentProjector>) -> Self {
        match self.content_projector.write() {
            Ok(mut slot) => *slot = Some(projector),
            Err(poisoned) => *poisoned.into_inner() = Some(projector),
        }
        self
    }

    /// Installs the companion-owned dictation RPC service. It stays local and never
    /// forwards OAuth credentials or raw audio to the Codex App Server.
    #[must_use]
    pub fn with_dictation(self, dictation: Arc<DictationService>) -> Self {
        match self.dictation.write() {
            Ok(mut slot) => *slot = Some(dictation),
            Err(poisoned) => *poisoned.into_inner() = Some(dictation),
        }
        self
    }

    /// Installs the scoped file resolver used to prepare Android attachments
    /// for direct and durable App Server mutations.
    #[must_use]
    pub fn with_files(self, files: Arc<FileService>) -> Self {
        match self.files.write() {
            Ok(mut slot) => *slot = Some(files),
            Err(poisoned) => *poisoned.into_inner() = Some(files),
        }
        self
    }

    /// Installs the canonical rollout resource projector and its active-turn
    /// in-memory overlay.
    #[must_use]
    pub fn with_resources(self, resources: Arc<ResourceService>) -> Self {
        match self.resources.write() {
            Ok(mut slot) => *slot = Some(resources),
            Err(poisoned) => *poisoned.into_inner() = Some(resources),
        }
        self
    }

    /// Installs the companion-owned multi-account scheduler. Its event stream
    /// is projected through the same durable client channel as other local
    /// companion services.
    #[must_use]
    pub fn with_account_pool(self, account_pool: &Arc<AccountPoolService>) -> Self {
        match self.account_pool.write() {
            Ok(mut slot) => *slot = Some(account_pool.clone()),
            Err(poisoned) => *poisoned.into_inner() = Some(account_pool.clone()),
        }
        tokio::spawn(forward_account_pool_events(
            account_pool.subscribe_events(),
            self.local_events.clone(),
            self.outbox_wakeup.clone(),
        ));
        self
    }

    /// Installs the companion-owned explicit project registry.
    #[must_use]
    pub fn with_projects(self, projects: Arc<ProjectService>) -> Self {
        match self.projects.write() {
            Ok(mut slot) => *slot = Some(projects),
            Err(poisoned) => *poisoned.into_inner() = Some(projects),
        }
        self
    }

    /// Installs application-level workspace orchestration. Provider-specific
    /// checkout logic remains behind the VCS plugin capability contract.
    #[must_use]
    pub fn with_workspaces(self, workspaces: Arc<WorkspaceService>) -> Self {
        match self.workspaces.write() {
            Ok(mut slot) => *slot = Some(workspaces),
            Err(poisoned) => *poisoned.into_inner() = Some(workspaces),
        }
        self
    }

    fn projector(&self) -> Option<Arc<ContentProjector>> {
        match self.content_projector.read() {
            Ok(slot) => slot.clone(),
            Err(poisoned) => poisoned.into_inner().clone(),
        }
    }

    fn dictation(&self) -> Option<Arc<DictationService>> {
        match self.dictation.read() {
            Ok(slot) => slot.clone(),
            Err(poisoned) => poisoned.into_inner().clone(),
        }
    }

    /// Returns the internal transcription service for the closed V2 Voice adapter.
    #[must_use]
    pub(crate) fn v2_dictation(&self) -> Option<Arc<DictationService>> {
        self.dictation()
    }

    fn files(&self) -> Option<Arc<FileService>> {
        match self.files.read() {
            Ok(slot) => slot.clone(),
            Err(poisoned) => poisoned.into_inner().clone(),
        }
    }

    fn resources(&self) -> Option<Arc<ResourceService>> {
        match self.resources.read() {
            Ok(slot) => slot.clone(),
            Err(poisoned) => poisoned.into_inner().clone(),
        }
    }

    fn account_pool(&self) -> Option<Arc<AccountPoolService>> {
        match self.account_pool.read() {
            Ok(slot) => slot.clone(),
            Err(poisoned) => poisoned.into_inner().clone(),
        }
    }

    fn projects(&self) -> Option<Arc<ProjectService>> {
        match self.projects.read() {
            Ok(slot) => slot.clone(),
            Err(poisoned) => poisoned.into_inner().clone(),
        }
    }

    fn workspaces(&self) -> Option<Arc<WorkspaceService>> {
        match self.workspaces.read() {
            Ok(slot) => slot.clone(),
            Err(poisoned) => poisoned.into_inner().clone(),
        }
    }

    pub async fn serve(
        self,
        socket: WebSocket,
        authorization: AuthorizationContext,
        authorization_changes: Option<tokio::sync::broadcast::Receiver<AuthorizationChange>>,
    ) {
        // Subscribe before reading the replay head. Events committed between
        // replay selection and the live loop remain buffered and are safely
        // de-duplicated by the cursor-aware client projection.
        let events = self.events.subscribe();
        let (sink, mut incoming) = socket.split();
        let socket = SessionSocket::new(sink);
        let Some(session) = self.accept_hello(&socket, &mut incoming).await else {
            return;
        };
        self.run_session(
            socket,
            incoming,
            session,
            events,
            authorization,
            authorization_changes,
        )
        .await;
    }

    async fn accept_hello(
        &self,
        socket: &SessionSocket,
        incoming: &mut SplitStream<WebSocket>,
    ) -> Option<InitialSession> {
        let Some(Ok(Message::Text(raw))) = incoming.next().await else {
            close_with(socket, 1000, "hello_not_received").await;
            return None;
        };
        let Ok(hello) = serde_json::from_str::<Value>(&raw) else {
            close_with(socket, 1007, "invalid_json_object").await;
            return None;
        };
        if hello.get("type").and_then(Value::as_str) != Some("hello")
            || hello.get("protocolVersion").and_then(Value::as_u64) != Some(1)
        {
            close_with(socket, 1008, "hello_required").await;
            return None;
        }
        let cursor = hello.get("cursor").and_then(Value::as_u64);
        let store = self.store.clone();
        let Ok(Ok(replay)) = tokio::task::spawn_blocking(move || store.replay_after(cursor)).await
        else {
            close_with(socket, 1011, "replay_journal_failed").await;
            return None;
        };
        let head = replay.head_cursor;
        let snapshot_required = replay.snapshot_required;
        log_replay_selection("initial", cursor, &replay);
        let pending_requests = self
            .server_requests
            .lock()
            .await
            .requests
            .values()
            .cloned()
            .collect::<Vec<_>>();
        if send_json(
            socket,
            &json!({
                "type": "hello",
                "protocolVersion": 1,
                "headCursor": head,
                "snapshotRequired": snapshot_required,
                "pendingRequests": pending_requests
            }),
        )
        .await
        .is_err()
        {
            return None;
        }
        let status = if self.upstream.status() == ConnectionStatus::Live {
            "live"
        } else {
            "reconnecting"
        };
        if send_json(socket, &json!({ "type": "status", "status": status }))
            .await
            .is_err()
        {
            return None;
        }

        let mut ready = false;
        if !snapshot_required {
            for (cursor, payload) in replay.entries {
                let Ok(payload) = serde_json::from_slice::<Value>(&payload) else {
                    close_with(socket, 1011, "replay_journal_failed").await;
                    return None;
                };
                if send_json(
                    socket,
                    &json!({ "type": "event", "cursor": cursor, "payload": payload }),
                )
                .await
                .is_err()
                {
                    return None;
                }
            }
            ready = true;
            if send_json(socket, &json!({ "type": "caughtUp", "cursor": head }))
                .await
                .is_err()
            {
                return None;
            }
            info!(cursor = head, "sync client caught up");
        }

        Some(InitialSession {
            ready,
            snapshot_cursor: snapshot_required.then_some(head),
            snapshot_started_at: snapshot_required.then(Instant::now),
            delivered_cursor: head,
        })
    }

    #[allow(clippy::too_many_lines)]
    async fn run_session(
        &self,
        socket: SessionSocket,
        mut incoming: SplitStream<WebSocket>,
        session: InitialSession,
        events: tokio::sync::broadcast::Receiver<DurableSignal>,
        authorization: AuthorizationContext,
        mut authorization_changes: Option<tokio::sync::broadcast::Receiver<AuthorizationChange>>,
    ) {
        let mut snapshot_cursor = session.snapshot_cursor;
        let mut snapshot_started_at = session.snapshot_started_at;
        let mut upstream_status = self.upstream.subscribe_status();
        let rpc_permits = Arc::new(tokio::sync::Semaphore::new(MAX_CONCURRENT_SESSION_RPCS));
        let thread_mutation_lanes = ThreadMutationLanes::default();
        let (task_failed_tx, mut task_failed_rx) = tokio::sync::mpsc::unbounded_channel();
        let mut session_tasks = tokio::task::JoinSet::new();
        let mut replay_events = Some(events);
        let mut replay_task = None;
        if session.ready {
            let Some(events) = replay_events.take() else {
                close_with(&socket, 1011, "replay_receiver_missing").await;
                return;
            };
            replay_task = Some(spawn_live_replay_task(
                socket.clone(),
                self.store.clone(),
                events,
                session.delivered_cursor,
                task_failed_tx.clone(),
            ));
        }
        loop {
            tokio::select! {
                message = incoming.next() => {
                    let Some(Ok(message)) = message else { break; };
                    match message {
                        Message::Text(raw) => {
                            let Ok(message) = serde_json::from_str::<Value>(&raw) else {
                                close_with(&socket, 1007, "invalid_json_object").await;
                                break;
                            };
                            match message.get("type").and_then(Value::as_str) {
                                Some("ping") => {
                                    let mut pong = Map::from_iter([("type".into(), Value::String("pong".into()))]);
                                    if let Some(nonce) = message.get("nonce") { pong.insert("nonce".into(), nonce.clone()); }
                                    if send_json(&socket, &Value::Object(pong)).await.is_err() { break; }
                                }
                                Some("snapshotApplied") => {
                                    let Some(applied_cursor) = message.get("cursor").and_then(Value::as_u64) else {
                                        close_with(&socket, 1008, "invalid_snapshot_cursor").await;
                                        break;
                                    };
                                    if snapshot_cursor != Some(applied_cursor) {
                                        close_with(&socket, 1008, "unexpected_snapshot_cursor").await;
                                        break;
                                    }
                                    info!(
                                        cursor = applied_cursor,
                                        duration_ms = snapshot_started_at
                                            .map_or(0, |started| started.elapsed().as_millis()),
                                        "sync client snapshot applied"
                                    );
                                    let store = self.store.clone();
                                    let Ok(Ok(replay)) = tokio::task::spawn_blocking(move || store.replay_after(Some(applied_cursor))).await else {
                                        close_with(&socket, 1011, "replay_journal_failed").await;
                                        break;
                                    };
                                    let head = replay.head_cursor;
                                    let snapshot_required = replay.snapshot_required;
                                    log_replay_selection("post_snapshot", Some(applied_cursor), &replay);
                                    let pending_requests = self
                                        .server_requests
                                        .lock()
                                        .await
                                        .requests
                                        .values()
                                        .cloned()
                                        .collect::<Vec<_>>();
                                    if send_json(
                                        &socket,
                                        &json!({
                                            "type": "hello",
                                            "protocolVersion": 1,
                                            "headCursor": head,
                                            "snapshotRequired": snapshot_required,
                                            "pendingRequests": pending_requests
                                        }),
                                    )
                                    .await
                                    .is_err()
                                    {
                                        break;
                                    }
                                    if snapshot_required {
                                        snapshot_cursor = Some(head);
                                        snapshot_started_at = Some(Instant::now());
                                        continue;
                                    }
                                    for (cursor, payload) in replay.entries {
                                        let Ok(payload) = serde_json::from_slice::<Value>(&payload) else {
                                            close_with(&socket, 1011, "replay_journal_failed").await;
                                            return;
                                        };
                                        if send_json(
                                            &socket,
                                            &json!({ "type": "event", "cursor": cursor, "payload": payload }),
                                        )
                                        .await
                                        .is_err()
                                        {
                                            return;
                                        }
                                    }
                                    if send_json(&socket, &json!({ "type": "caughtUp", "cursor": head })).await.is_err() { break; }
                                    info!(cursor = head, "sync client caught up");
                                    snapshot_cursor = None;
                                    snapshot_started_at = None;
                                    if replay_task.is_none()
                                        && let Some(events) = replay_events.take()
                                    {
                                        replay_task = Some(spawn_live_replay_task(
                                            socket.clone(),
                                            self.store.clone(),
                                            events,
                                            head,
                                            task_failed_tx.clone(),
                                        ));
                                    }
                                }
                                Some("ack") => {}
                                Some("rpc") => {
                                    let request = message.get("request").cloned();
                                    let mutation_lane = thread_mutation_lanes.for_request(request.as_ref());
                                    let Ok(permit) = rpc_permits.clone().try_acquire_owned() else {
                                        let id = request
                                            .as_ref()
                                            .and_then(|request| request.get("id"))
                                            .cloned()
                                            .unwrap_or(Value::Null);
                                        if send_rpc_error(&socket, id, -32004, "Too many concurrent sync RPCs").await.is_err() { break; }
                                        continue;
                                    };
                                    let hub = self.clone();
                                    let task_socket = socket.clone();
                                    let task_authorization = authorization.clone();
                                    let task_failed = task_failed_tx.clone();
                                    session_tasks.spawn(async move {
                                        let _permit = permit;
                                        let result = if let Some(mutation_lane) = mutation_lane {
                                            let _guard = mutation_lane.lock().await;
                                            hub.handle_rpc(&task_socket, request, &task_authorization).await
                                        } else {
                                            hub.handle_rpc(&task_socket, request, &task_authorization).await
                                        };
                                        if result.is_err() {
                                            let _ = task_failed.send(());
                                        }
                                    });
                                }
                                Some("serverResponse") => {
                                    if !authorization_has_scope(&authorization, "approvals.respond") {
                                        close_with(&socket, 1008, "scope_required").await;
                                        break;
                                    }
                                    let Ok(permit) = rpc_permits.clone().try_acquire_owned() else {
                                        close_with(&socket, 1013, "too_many_concurrent_requests").await;
                                        break;
                                    };
                                    let hub = self.clone();
                                    let task_socket = socket.clone();
                                    let response = message.get("response").cloned();
                                    let task_failed = task_failed_tx.clone();
                                    session_tasks.spawn(async move {
                                        let _permit = permit;
                                        if hub.handle_server_response(&task_socket, response).await.is_err() {
                                            let _ = task_failed.send(());
                                        }
                                    });
                                }
                                Some("hello") => {
                                    close_with(&socket, 1008, "duplicate_hello").await;
                                    break;
                                }
                                _ => {
                                    close_with(&socket, 1008, "unknown_sync_message").await;
                                    break;
                                }
                            }
                        }
                        Message::Close(_) => break,
                        Message::Binary(_) => {
                            close_with(&socket, 1003, "text_frames_only").await;
                            break;
                        }
                        Message::Ping(payload) => {
                            if socket.send(Message::Pong(payload)).await.is_err() { break; }
                        }
                        Message::Pong(_) => {}
                    }
                }
                changed = upstream_status.changed() => {
                    if changed.is_err() { break; }
                    let status = if *upstream_status.borrow() == ConnectionStatus::Live { "live" } else { "reconnecting" };
                    if send_json(&socket, &json!({ "type": "status", "status": status })).await.is_err() { break; }
                }
                change = receive_authorization_change(&mut authorization_changes), if authorization_changes.is_some() => {
                    match handle_authorization_change(&socket, &authorization, change).await {
                        AuthorizationChangeOutcome::Close => break,
                        AuthorizationChangeOutcome::Disable => authorization_changes = None,
                        AuthorizationChangeOutcome::Continue => {}
                    }
                }
                Some(result) = session_tasks.join_next(), if !session_tasks.is_empty() => {
                    if let Err(error) = result {
                        warn!(%error, "sync RPC task failed");
                    }
                }
                Some(()) = task_failed_rx.recv() => break,
            }
        }
        if let Some(replay_task) = replay_task {
            replay_task.abort();
        }
        session_tasks.abort_all();
    }

    async fn handle_server_response(
        &self,
        socket: &SessionSocket,
        response: Option<Value>,
    ) -> Result<(), ()> {
        let Some(response) = response else {
            close_with(socket, 1008, "invalid_server_response").await;
            return Err(());
        };
        let Some(id) = response.get("id").cloned() else {
            close_with(socket, 1008, "invalid_server_response").await;
            return Err(());
        };
        if response.get("method").is_some()
            || (response.get("result").is_none() && response.get("error").is_none())
        {
            close_with(socket, 1008, "invalid_server_response").await;
            return Err(());
        }
        let key = rpc_id_key(&id);
        {
            let mut pending = self.server_requests.lock().await;
            if !pending.requests.contains_key(&key) {
                return send_json(
                    socket,
                    &json!({"type": "serverResponseRejected", "id": id, "reason": "already_resolved_or_unknown"}),
                )
                .await
                .map_err(|_| ());
            }
            if !pending.resolving.insert(key.clone()) {
                return send_json(
                    socket,
                    &json!({"type": "serverResponseRejected", "id": id, "reason": "already_resolving"}),
                )
                .await
                .map_err(|_| ());
            }
        }
        match self.upstream.respond(response).await {
            Ok(()) => {
                remove_server_request(&self.server_requests, &key).await;
                if self
                    .local_events
                    .send(json!({
                        "method": "serverRequest/resolved",
                        "params": {"requestId": id, "reason": "responded"}
                    }))
                    .await
                    .is_err()
                {
                    warn!("local replay ingestor closed after server response");
                }
                send_json(socket, &json!({"type": "serverResponseAccepted", "id": id}))
                    .await
                    .map_err(|_| ())
            }
            Err(error) => {
                self.server_requests.lock().await.resolving.remove(&key);
                let reason = match error {
                    UpstreamError::Backpressure => "upstream_backpressure",
                    UpstreamError::Reconnecting | UpstreamError::Disconnected => {
                        "app_server_reconnecting"
                    }
                    UpstreamError::Protocol(_) => "upstream_delivery_failed",
                };
                send_json(
                    socket,
                    &json!({"type": "serverResponseRejected", "id": id, "reason": reason}),
                )
                .await
                .map_err(|_| ())
            }
        }
    }

    #[allow(clippy::too_many_lines)]
    async fn handle_rpc(
        &self,
        socket: &SessionSocket,
        request: Option<Value>,
        authorization: &AuthorizationContext,
    ) -> Result<(), ()> {
        let Some(mut request) = request else {
            return send_rpc_error(socket, Value::Null, -32600, "Sync RPC request is missing")
                .await;
        };
        let id = request.get("id").cloned().unwrap_or(Value::Null);
        let method = request
            .get("method")
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_owned();
        if id.is_null() {
            return send_rpc_error(socket, id, -32600, "Sync RPC requests require an id").await;
        }
        let params = request.get("params").cloned().unwrap_or_else(|| json!({}));
        let Some(required_scope) = required_scope_for_rpc(&method) else {
            return send_rpc_error(socket, id, -32601, "Method is not exposed by CodeWide").await;
        };
        if !authorization_has_scope(authorization, required_scope) {
            return send_rpc_error(socket, id, -32001, "Device scope is not granted").await;
        }
        if matches!(
            method.as_str(),
            "thread/read" | "thread/resume" | "thread/turns/list" | "thread/items/list"
        ) && let Some(thread_id) = params.get("threadId").and_then(Value::as_str)
            && let Some(resources) = self.resources()
        {
            resources.schedule_prewarm(thread_id);
        }
        if self
            .try_handle_local_service_rpc(socket, &id, &method, &params, authorization)
            .await?
        {
            return Ok(());
        }
        if method.starts_with("companion/queue/") {
            if self.mutation_mode != MutationMode::Active && method != "companion/queue/list" {
                return send_rpc_error(socket, id, -32010, "companion is read-only").await;
            }
            return self.handle_queue_rpc(socket, id, &method, &params).await;
        }
        if !is_read_only_method(&method) && self.mutation_mode != MutationMode::Active {
            return send_rpc_error(socket, id, -32010, "companion is read-only").await;
        }
        if !is_read_only_method(&method) && !is_mutating_method(&method) {
            return send_rpc_error(socket, id, -32601, "Method is not exposed by CodeWide").await;
        }
        if self
            .try_handle_thread_read_rpc(socket, &id, &method, &params)
            .await?
        {
            return Ok(());
        }
        if method == "turn/start" && self.recent_turn_starts.lock().await.seen_or_insert(&params) {
            match reconcile_direct_turn_start(&self.upstream, &params).await {
                Ok(Some(turn)) => {
                    return forward_rpc_response(
                        socket,
                        json!({"id": "turn-start-reconcile", "result": {"turn": turn}}),
                        id,
                        &method,
                        self.projector(),
                        &self.history,
                        RpcResultObservers {
                            resources: self.resources(),
                            projects: self.projects(),
                        },
                    )
                    .await;
                }
                Ok(None) => {}
                Err(error) => {
                    return send_rpc_error(socket, id, -32042, &error).await;
                }
            }
        }
        if matches!(method.as_str(), "turn/start" | "turn/steer") {
            let prepared = match prepare_remote_file_inputs(&method, params, self.files()).await {
                Ok(prepared) => prepared,
                Err(error) => {
                    return send_rpc_error(socket, id, -32602, &error.to_string()).await;
                }
            };
            if let Some(object) = request.as_object_mut() {
                object.insert("params".into(), prepared);
            }
        }
        if method == "turn/start" {
            let account_pool = self.account_pool();
            return match dispatch_turn_start_with_resume(
                &self.upstream,
                account_pool.as_ref(),
                request.take(),
            )
            .await
            {
                Ok(response) => {
                    forward_rpc_response(
                        socket,
                        response,
                        id,
                        &method,
                        self.projector(),
                        &self.history,
                        RpcResultObservers {
                            resources: self.resources(),
                            projects: self.projects(),
                        },
                    )
                    .await
                }
                Err(error) => send_rpc_error(socket, id, -32040, &error.message()).await,
            };
        }
        forward_rpc(
            &self.upstream,
            socket,
            request.take(),
            id,
            &method,
            self.projector(),
            &self.history,
            RpcResultObservers {
                resources: self.resources(),
                projects: self.projects(),
            },
        )
        .await
    }

    async fn try_handle_local_service_rpc(
        &self,
        socket: &SessionSocket,
        id: &Value,
        method: &str,
        params: &Value,
        authorization: &AuthorizationContext,
    ) -> Result<bool, ()> {
        if method == "companion/threadSubagents/read" {
            match self.history.subagent_descendants(params) {
                Ok(result) => send_local_rpc_result(socket, id, result).await?,
                Err(error) => {
                    send_rpc_error(socket, id.clone(), -32020, &error.to_string()).await?;
                }
            }
            return Ok(true);
        }
        if DictationService::handles(method) {
            let Some(dictation) = self.dictation() else {
                send_rpc_error(
                    socket,
                    id.clone(),
                    -32030,
                    "Dictation service is unavailable",
                )
                .await?;
                return Ok(true);
            };
            let client_id = authorization.device_id().unwrap_or("admin");
            match dictation.handle(client_id, method, params).await {
                Ok(result) => send_local_rpc_result(socket, id, result).await?,
                Err(error) => {
                    send_rpc_error(socket, id.clone(), -32030, &error.to_string()).await?;
                }
            }
            return Ok(true);
        }
        if ResourceService::handles(method) {
            let Some(resources) = self.resources() else {
                send_rpc_error(
                    socket,
                    id.clone(),
                    -32020,
                    "Resource service is unavailable",
                )
                .await?;
                return Ok(true);
            };
            match resources.handle(method, params).await {
                Ok(result) => send_local_rpc_result(socket, id, result).await?,
                Err(error) => {
                    send_rpc_error(socket, id.clone(), -32020, &error.to_string()).await?;
                }
            }
            return Ok(true);
        }
        if ProjectService::handles(method) {
            if self.mutation_mode != MutationMode::Active && method != "companion/project/list" {
                send_rpc_error(socket, id.clone(), -32010, "companion is read-only").await?;
                return Ok(true);
            }
            let Some(projects) = self.projects() else {
                send_rpc_error(
                    socket,
                    id.clone(),
                    -32050,
                    "Project registry is unavailable",
                )
                .await?;
                return Ok(true);
            };
            match projects.handle(method, params).await {
                Ok(result) => send_local_rpc_result(socket, id, result).await?,
                Err(error) => {
                    send_rpc_error(socket, id.clone(), -32050, &error.to_string()).await?;
                }
            }
            return Ok(true);
        }
        if WorkspaceService::handles(method) {
            return self.handle_workspace_rpc(socket, id, method, params).await;
        }
        if !AccountPoolService::handles(method) {
            return Ok(false);
        }
        if self.mutation_mode != MutationMode::Active && method != "companion/accountPool/list" {
            send_rpc_error(socket, id.clone(), -32010, "companion is read-only").await?;
            return Ok(true);
        }
        let Some(account_pool) = self.account_pool() else {
            send_rpc_error(socket, id.clone(), -32040, "Account pool is unavailable").await?;
            return Ok(true);
        };
        match account_pool.handle(method, params).await {
            Ok(result) => send_local_rpc_result(socket, id, result).await?,
            Err(error) => {
                send_rpc_error(socket, id.clone(), -32040, &error.to_string()).await?;
            }
        }
        Ok(true)
    }

    async fn handle_workspace_rpc(
        &self,
        socket: &SessionSocket,
        id: &Value,
        method: &str,
        params: &Value,
    ) -> Result<bool, ()> {
        if self.mutation_mode != MutationMode::Active
            && !matches!(
                method,
                "companion/workspace/inspect" | "companion/workspace/read"
            )
        {
            send_rpc_error(socket, id.clone(), -32010, "companion is read-only").await?;
            return Ok(true);
        }
        let Some(workspaces) = self.workspaces() else {
            send_rpc_error(
                socket,
                id.clone(),
                -32060,
                "Workspace service is unavailable",
            )
            .await?;
            return Ok(true);
        };
        match workspaces.handle(method, params).await {
            Ok(result) => send_local_rpc_result(socket, id, result).await?,
            Err(error) => {
                warn!(method, %error, "workspace RPC failed");
                send_rpc_error(socket, id.clone(), -32060, &error.to_string()).await?;
            }
        }
        Ok(true)
    }

    async fn try_handle_thread_read_rpc(
        &self,
        socket: &SessionSocket,
        id: &Value,
        method: &str,
        params: &Value,
    ) -> Result<bool, ()> {
        if method == "companion/thread/observe" {
            match self.thread_view.observe(params).await {
                Ok(result) => {
                    self.send_projected_rpc_result(socket, id, method, result)
                        .await?;
                }
                Err(error) => {
                    send_rpc_error(socket, id.clone(), -32020, &error.to_string()).await?;
                }
            }
            return Ok(true);
        }
        if method == "companion/threadWindow/read" {
            match self.thread_view.read_window(params).await {
                Ok(result) => {
                    self.send_projected_rpc_result(socket, id, method, result)
                        .await?;
                }
                Err(error) => {
                    send_rpc_error(socket, id.clone(), -32020, &error.to_string()).await?;
                }
            }
            return Ok(true);
        }
        if method == "thread/resume" && params.get("initialTurnsPage").is_some() {
            match self.thread_view.resume(params).await {
                Ok(result) => {
                    self.send_projected_rpc_result(socket, id, method, result)
                        .await?;
                }
                Err(error) => {
                    send_rpc_error(socket, id.clone(), -32020, &error.to_string()).await?;
                }
            }
            return Ok(true);
        }
        let Some(result) = self.history.try_turns_page(method, params).await else {
            return Ok(false);
        };
        match result {
            Ok(result) => {
                self.send_projected_rpc_result(socket, id, method, result)
                    .await?;
            }
            Err(error) => send_rpc_error(socket, id.clone(), -32020, &error.to_string()).await?,
        }
        Ok(true)
    }

    async fn send_projected_rpc_result(
        &self,
        socket: &SessionSocket,
        id: &Value,
        method: &str,
        result: Value,
    ) -> Result<(), ()> {
        if let Some(resources) = self.resources() {
            resources.observe_rpc_result(method, &result).await;
        }
        let result = match self.projector() {
            Some(projector) => projector.project_rpc_result(method, result),
            None => result,
        };
        send_json(
            socket,
            &json!({ "type": "rpc", "response": { "id": id, "result": result } }),
        )
        .await
        .map_err(|_| ())
    }

    async fn handle_queue_rpc(
        &self,
        socket: &SessionSocket,
        id: Value,
        method: &str,
        params: &Value,
    ) -> Result<(), ()> {
        if method == "companion/queue/steer" {
            return self.handle_queued_steer(socket, id, params).await;
        }
        if method == "companion/queue/put"
            && let Some(command) = queue_command(params)
        {
            let command_method = command.get("method").and_then(Value::as_str).unwrap_or("");
            let command_params = command.get("params").cloned().unwrap_or_else(|| json!({}));
            if let Err(error) =
                prepare_remote_file_inputs(command_method, command_params, self.files()).await
            {
                return send_rpc_error(socket, id, -32010, &error.to_string()).await;
            }
        }
        if method == "companion/queue/edit"
            && let Some(input) = params.get("input").and_then(Value::as_array)
            && let Err(error) =
                prepare_remote_file_inputs("turn/start", json!({"input": input}), self.files())
                    .await
        {
            return send_rpc_error(socket, id, -32010, &error.to_string()).await;
        }
        let changed_thread_id = queue_changed_thread_id(&self.store, method, params);
        let store = self.store.clone();
        let params = params.clone();
        let method = method.to_owned();
        let result = tokio::task::spawn_blocking(move || queue_rpc(&store, &method, &params)).await;
        match result {
            Ok(Ok(result)) => {
                send_json(
                    socket,
                    &json!({"type": "rpc", "response": {"id": id, "result": result}}),
                )
                .await
                .map_err(|_| ())?;
                if let Some(thread_id) = changed_thread_id {
                    emit_queue_changed(&self.store, &self.local_events, &thread_id).await;
                }
                self.outbox_wakeup.notify_one();
                Ok(())
            }
            Ok(Err(error)) => send_rpc_error(socket, id, -32010, &error.to_string()).await,
            Err(error) => send_rpc_error(socket, id, -32020, &error.to_string()).await,
        }
    }

    async fn handle_queued_steer(
        &self,
        socket: &SessionSocket,
        id: Value,
        params: &Value,
    ) -> Result<(), ()> {
        let Some(command_id) = params.get("commandId").and_then(Value::as_str) else {
            return send_rpc_error(socket, id, -32602, "commandId is required").await;
        };
        let Some(expected_turn_id) = params.get("expectedTurnId").and_then(Value::as_str) else {
            return send_rpc_error(socket, id, -32602, "expectedTurnId is required").await;
        };
        let command = match self.store.outbox_list(None).and_then(|commands| {
            commands
                .into_iter()
                .find(|command| command.command_id == command_id)
                .ok_or_else(|| {
                    crate::store::StoreError::CorruptedIndex("queued command not found".into())
                })
        }) {
            Ok(command) if command.state == OutboxState::Queued => command,
            Ok(_) => {
                return send_rpc_error(
                    socket,
                    id,
                    -32010,
                    "queued command is already dispatching or no longer exists",
                )
                .await;
            }
            Err(error) => return send_rpc_error(socket, id, -32010, &error.to_string()).await,
        };
        let prepared =
            match prepare_remote_file_inputs("turn/steer", command.params.clone(), self.files())
                .await
            {
                Ok(prepared) => prepared,
                Err(error) => return send_rpc_error(socket, id, -32602, &error.to_string()).await,
            };
        let steer = json!({
            "id": "outbox-steer",
            "method": "turn/steer",
            "params": {
                "threadId": command.remote_thread_id,
                "clientUserMessageId": command.command_id,
                "input": prepared.get("input").cloned().unwrap_or_else(|| json!([])),
                "expectedTurnId": expected_turn_id,
            }
        });
        let response = match self.upstream.request(steer).await {
            Ok(response) => response,
            Err(error) => {
                set_outbox_state(
                    &self.store,
                    &self.local_events,
                    &command.remote_thread_id,
                    &command.command_id,
                    OutboxState::Uncertain,
                    Some(&error.to_string()),
                )
                .await;
                return send_rpc_error(socket, id, -32042, &error.to_string()).await;
            }
        };
        if response.get("error").is_none() {
            set_outbox_state(
                &self.store,
                &self.local_events,
                &command.remote_thread_id,
                &command.command_id,
                OutboxState::Delivered,
                None,
            )
            .await;
        }
        let response = response.as_object().map_or_else(
            || json!({"id": id, "error": {"message": "invalid App Server response"}}),
            |object| {
                let mut object = object.clone();
                object.insert("id".into(), id.clone());
                Value::Object(object)
            },
        );
        send_json(socket, &json!({"type": "rpc", "response": response}))
            .await
            .map_err(|_| ())
    }
}

async fn send_live_replay_after(
    socket: &SessionSocket,
    store: Arc<IndexStore>,
    cursor: u64,
) -> Result<u64, LiveReplayError> {
    let replay = tokio::task::spawn_blocking(move || store.replay_after(Some(cursor)))
        .await
        .map_err(|_| LiveReplayError::Journal)?
        .map_err(|_| LiveReplayError::Journal)?;
    if replay.snapshot_required {
        return Err(LiveReplayError::SnapshotRequired);
    }
    for (event_cursor, payload) in replay.entries {
        let payload =
            serde_json::from_slice::<Value>(&payload).map_err(|_| LiveReplayError::Journal)?;
        send_json(
            socket,
            &json!({ "type": "event", "cursor": event_cursor, "payload": payload }),
        )
        .await
        .map_err(|_| LiveReplayError::Socket)?;
    }
    Ok(replay.head_cursor)
}

async fn forward_upstream_events(
    mut upstream: tokio::sync::broadcast::Receiver<Value>,
    ingest: tokio::sync::mpsc::Sender<Value>,
    outbox_wakeup: Arc<tokio::sync::Notify>,
    recent_upstream_threads: Arc<std::sync::Mutex<HashMap<String, Instant>>>,
) {
    loop {
        match upstream.recv().await {
            Ok(payload) => {
                if let Some(thread_id) = event_thread_id(&payload) {
                    remember_upstream_thread(&recent_upstream_threads, thread_id);
                }
                if payload.get("method").and_then(Value::as_str) == Some("turn/completed") {
                    outbox_wakeup.notify_one();
                }
                if ingest.send(payload).await.is_err() {
                    break;
                }
            }
            Err(tokio::sync::broadcast::error::RecvError::Lagged(skipped)) => {
                warn!(skipped, "central App Server event forwarder lagged");
            }
            Err(tokio::sync::broadcast::error::RecvError::Closed) => break,
        }
    }
}

async fn forward_rollout_changes(
    mut changes: tokio::sync::mpsc::Receiver<crate::rollout_monitor::RolloutChange>,
    history: HistoryService,
    ingest: tokio::sync::mpsc::Sender<Value>,
    recent_upstream_threads: Arc<std::sync::Mutex<HashMap<String, Instant>>>,
    resources: Arc<std::sync::RwLock<Option<Arc<ResourceService>>>>,
) {
    forward_rollout_changes_with_suppression(
        &mut changes,
        history,
        ingest,
        recent_upstream_threads,
        resources,
        ROLLOUT_UPSTREAM_SUPPRESSION,
    )
    .await;
}

async fn forward_rollout_changes_with_suppression(
    changes: &mut tokio::sync::mpsc::Receiver<crate::rollout_monitor::RolloutChange>,
    history: HistoryService,
    ingest: tokio::sync::mpsc::Sender<Value>,
    recent_upstream_threads: Arc<std::sync::Mutex<HashMap<String, Instant>>>,
    resources: Arc<std::sync::RwLock<Option<Arc<ResourceService>>>>,
    suppression: Duration,
) {
    let mut pending = HashMap::<String, crate::rollout_monitor::RolloutChange>::new();
    let mut changes_open = true;
    let poll_interval = ROLLOUT_RECONCILIATION_POLL
        .min(suppression)
        .max(Duration::from_millis(1));
    let mut poll = tokio::time::interval(poll_interval);
    poll.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
    loop {
        tokio::select! {
            change = changes.recv(), if changes_open => {
                match change {
                    Some(change) => {
                        history.observe_rollout_change(&change);
                        let resource_service = match resources.read() {
                            Ok(slot) => slot.clone(),
                            Err(poisoned) => poisoned.into_inner().clone(),
                        };
                        if let Some(resource_service) = resource_service {
                            resource_service.schedule_prewarm(&change.thread_id);
                        }
                        // Coalesce every filesystem echo for one thread, but
                        // never discard the trailing write. That final write is
                        // the canonical repair boundary for a live projection.
                        pending.insert(change.thread_id.clone(), change);
                    }
                    None => changes_open = false,
                }
            }
            _ = poll.tick(), if !pending.is_empty() => {
                let due = pending
                    .keys()
                    .filter(|thread_id| !recently_seen_upstream_for(
                        &recent_upstream_threads,
                        thread_id,
                        suppression,
                    ))
                    .cloned()
                    .collect::<Vec<_>>();
                for thread_id in due {
                    let Some(change) = pending.remove(&thread_id) else {
                        continue;
                    };
                    let payload = history.rollout_invalidation_event(change).await;
                    if ingest.send(payload).await.is_err() {
                        return;
                    }
                }
            }
        }
        if !changes_open && pending.is_empty() {
            return;
        }
    }
}

fn event_thread_id(payload: &Value) -> Option<&str> {
    payload
        .get("params")
        .and_then(Value::as_object)
        .and_then(|params| {
            params.get("threadId").and_then(Value::as_str).or_else(|| {
                params
                    .get("thread")
                    .and_then(Value::as_object)
                    .and_then(|thread| thread.get("id"))
                    .and_then(Value::as_str)
            })
        })
        .or_else(|| {
            payload
                .get(crate::thread_patch::THREAD_PATCH_FIELD)
                .and_then(Value::as_object)
                .and_then(|patch| patch.get("threadId"))
                .and_then(Value::as_str)
        })
}

fn remember_upstream_thread(recent: &std::sync::Mutex<HashMap<String, Instant>>, thread_id: &str) {
    let now = Instant::now();
    let mut recent = match recent.lock() {
        Ok(recent) => recent,
        Err(poisoned) => poisoned.into_inner(),
    };
    if recent.len() >= MAX_RECENT_UPSTREAM_THREADS {
        recent.retain(|_thread_id, seen_at| {
            now.saturating_duration_since(*seen_at) <= ROLLOUT_UPSTREAM_SUPPRESSION
        });
    }
    recent.insert(thread_id.to_owned(), now);
}

fn recently_seen_upstream_for(
    recent: &std::sync::Mutex<HashMap<String, Instant>>,
    thread_id: &str,
    suppression: Duration,
) -> bool {
    let now = Instant::now();
    let mut recent = match recent.lock() {
        Ok(recent) => recent,
        Err(poisoned) => poisoned.into_inner(),
    };
    let is_recent = recent
        .get(thread_id)
        .is_some_and(|seen_at| now.saturating_duration_since(*seen_at) <= suppression);
    if !is_recent {
        recent.remove(thread_id);
    }
    is_recent
}

async fn send_local_rpc_result(
    socket: &SessionSocket,
    id: &Value,
    result: Value,
) -> Result<(), ()> {
    send_json(
        socket,
        &json!({"type": "rpc", "response": {"id": id, "result": result}}),
    )
    .await
    .map_err(|_| ())
}

async fn forward_account_pool_events(
    mut account_events: tokio::sync::broadcast::Receiver<Value>,
    ingest: tokio::sync::mpsc::Sender<Value>,
    outbox_wakeup: Arc<tokio::sync::Notify>,
) {
    loop {
        match account_events.recv().await {
            Ok(payload) => {
                outbox_wakeup.notify_one();
                if ingest.send(payload).await.is_err() {
                    break;
                }
            }
            Err(tokio::sync::broadcast::error::RecvError::Lagged(skipped)) => {
                warn!(skipped, "account pool event forwarder lagged");
            }
            Err(tokio::sync::broadcast::error::RecvError::Closed) => break,
        }
    }
}

async fn ingest_events(
    mut ingest: tokio::sync::mpsc::Receiver<Value>,
    store: Arc<IndexStore>,
    events: tokio::sync::broadcast::Sender<DurableSignal>,
    server_requests: Arc<tokio::sync::Mutex<PendingServerRequests>>,
    content_projector: Arc<std::sync::RwLock<Option<Arc<ContentProjector>>>>,
    resources: Arc<std::sync::RwLock<Option<Arc<ResourceService>>>>,
    usage_projector: Arc<std::sync::Mutex<crate::usage::LiveUsageProjector>>,
) {
    let mut stream_diagnostics = AgentStreamDiagnostics::default();
    while let Some(first) = ingest.recv().await {
        let mut payloads = vec![first];
        let deadline = tokio::time::Instant::now() + REPLAY_BATCH_DELAY;
        while payloads.len() < MAX_REPLAY_BATCH_ENTRIES {
            let remaining = deadline.saturating_duration_since(tokio::time::Instant::now());
            if remaining.is_zero() {
                break;
            }
            match tokio::time::timeout(remaining, ingest.recv()).await {
                Ok(Some(payload)) => payloads.push(payload),
                Ok(None) | Err(_) => break,
            }
        }
        if observe_server_requests(&server_requests, &payloads)
            .await
            .is_err()
        {
            warn!("pending App Server request limits exceeded");
            let _ = events.send(DurableSignal::Failed);
            break;
        }
        for payload in &payloads {
            if let Err(error) = observe_subagent_metadata(&store, payload) {
                warn!(%error, "live subagent metadata index update failed");
            }
        }
        let resource_service = match resources.read() {
            Ok(slot) => slot.clone(),
            Err(poisoned) => poisoned.into_inner().clone(),
        };
        if let Some(resource_service) = resource_service {
            for payload in &payloads {
                resource_service.observe(payload).await;
            }
        }
        let projector = match content_projector.read() {
            Ok(slot) => slot.clone(),
            Err(poisoned) => poisoned.into_inner().clone(),
        };
        if let Some(projector) = projector {
            payloads = payloads
                .into_iter()
                .map(|payload| projector.project_notification(payload))
                .collect();
        }
        stream_diagnostics.observe_input_batch(&payloads);
        payloads = coalesce_stream_text_deltas(payloads);
        stream_diagnostics.observe_emitted_batch(&payloads);
        let mut projected_payloads = Vec::with_capacity(payloads.len());
        for payload in payloads {
            let usage = match usage_projector.lock() {
                Ok(mut projector) => projector.observe(&payload),
                Err(poisoned) => poisoned.into_inner().observe(&payload),
            };
            let Ok(usage) = usage else {
                warn!("usage projection persistence failed");
                let _ = events.send(DurableSignal::Failed);
                return;
            };
            projected_payloads.push(crate::thread_patch::attach_thread_patch_with_usage(
                payload, usage,
            ));
        }
        payloads = projected_payloads;
        let Ok(encoded) = payloads
            .iter()
            .map(serde_json::to_vec)
            .collect::<Result<Vec<Vec<u8>>, _>>()
        else {
            warn!("replay payload serialization failed");
            let _ = events.send(DurableSignal::Failed);
            break;
        };
        let durable_store = store.clone();
        let committed = tokio::task::spawn_blocking(move || {
            durable_store.append_replay_batch(&encoded, MAX_REPLAY_ENTRIES, MAX_REPLAY_BYTES)
        })
        .await;
        let Ok(Ok(cursors)) = committed else {
            warn!("durable replay journal failed");
            let _ = events.send(DurableSignal::Failed);
            break;
        };
        stream_diagnostics.finish_completed_turns(&payloads);
        if let Some(cursor) = cursors.last().copied() {
            let _ = events.send(DurableSignal::Committed(cursor));
        }
    }
}

fn observe_subagent_metadata(
    store: &IndexStore,
    payload: &Value,
) -> Result<(), crate::store::StoreError> {
    if payload.get("method").and_then(Value::as_str) != Some("item/completed") {
        return Ok(());
    }
    let Some(params) = payload.get("params") else {
        return Ok(());
    };
    let Some(item) = params.get("item") else {
        return Ok(());
    };
    if item.get("type").and_then(Value::as_str) != Some("subAgentActivity") {
        return Ok(());
    }
    let Some(thread_id) = item
        .get("agentThreadId")
        .and_then(Value::as_str)
        .filter(|value| !value.is_empty())
    else {
        return Ok(());
    };
    if store.thread_metadata(thread_id)?.is_some() {
        return Ok(());
    }
    let Some(parent_thread_id) = params
        .get("threadId")
        .and_then(Value::as_str)
        .filter(|value| !value.is_empty())
    else {
        return Ok(());
    };
    let parent_metadata = store.thread_metadata(parent_thread_id)?;
    let agent_path = item.get("agentPath").and_then(Value::as_str);
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |duration| {
            i64::try_from(duration.as_secs()).unwrap_or(i64::MAX)
        });
    store.put_thread_metadata(&IndexedThreadMetadata {
        id: thread_id.to_owned(),
        parent_thread_id: Some(parent_thread_id.to_owned()),
        cwd: parent_metadata
            .as_ref()
            .map_or_else(|| "/".into(), |metadata| metadata.cwd.clone()),
        created_at: now,
        updated_at: now,
        model_provider: parent_metadata.as_ref().map_or_else(
            || "openai".into(),
            |metadata| metadata.model_provider.clone(),
        ),
        cli_version: parent_metadata
            .as_ref()
            .map_or_else(String::new, |metadata| metadata.cli_version.clone()),
        source: json!({
            "subagent": {
                "thread_spawn": {
                    "parent_thread_id": parent_thread_id,
                    "depth": 1,
                    "agent_path": agent_path,
                    "agent_nickname": null,
                    "agent_role": null
                }
            }
        }),
        agent_nickname: None,
        agent_role: None,
        archived: false,
    })
}

fn coalesce_stream_text_deltas(payloads: Vec<Value>) -> Vec<Value> {
    let mut coalesced = Vec::with_capacity(payloads.len());
    for payload in payloads {
        if let Some(previous) = coalesced.last_mut()
            && merge_adjacent_stream_text_delta(previous, &payload)
        {
            continue;
        }
        coalesced.push(payload);
    }
    coalesced
}

fn merge_adjacent_stream_text_delta(previous: &mut Value, next: &Value) -> bool {
    if !same_stream_text_delta_envelope(previous, next) {
        return false;
    }
    let Some(next_delta) = next
        .get("params")
        .and_then(Value::as_object)
        .and_then(|params| params.get("delta"))
        .and_then(Value::as_str)
    else {
        return false;
    };
    let Some(previous_delta) = previous
        .get_mut("params")
        .and_then(Value::as_object_mut)
        .and_then(|params| params.get_mut("delta"))
        .and_then(|delta| delta.as_str())
    else {
        return false;
    };
    if previous_delta.len().saturating_add(next_delta.len()) > MAX_COALESCED_TEXT_DELTA_BYTES {
        return false;
    }
    let mut merged = String::with_capacity(previous_delta.len() + next_delta.len());
    merged.push_str(previous_delta);
    merged.push_str(next_delta);
    if let Some(delta) = previous
        .get_mut("params")
        .and_then(Value::as_object_mut)
        .and_then(|params| params.get_mut("delta"))
    {
        *delta = Value::String(merged);
        return true;
    }
    false
}

fn same_stream_text_delta_envelope(left: &Value, right: &Value) -> bool {
    let left_method = left.get("method").and_then(Value::as_str);
    let right_method = right.get("method").and_then(Value::as_str);
    if left_method != right_method || !left_method.is_some_and(is_coalescible_text_delta_method) {
        return false;
    }
    let (Some(left), Some(right)) = (left.as_object(), right.as_object()) else {
        return false;
    };
    if left.len() != right.len() {
        return false;
    }
    left.iter().all(|(key, left_value)| {
        let Some(right_value) = right.get(key) else {
            return false;
        };
        if key == "params" {
            same_stream_text_delta_params(left_value, right_value)
        } else {
            left_value == right_value
        }
    })
}

fn same_stream_text_delta_params(left: &Value, right: &Value) -> bool {
    let (Some(left), Some(right)) = (left.as_object(), right.as_object()) else {
        return false;
    };
    if left.len() != right.len()
        || left.get("delta").and_then(Value::as_str).is_none()
        || right.get("delta").and_then(Value::as_str).is_none()
    {
        return false;
    }
    left.iter().all(|(key, left_value)| {
        key == "delta"
            || right
                .get(key)
                .is_some_and(|right_value| right_value == left_value)
    })
}

fn is_coalescible_text_delta_method(method: &str) -> bool {
    matches!(
        method,
        "item/agentMessage/delta"
            | "item/plan/delta"
            | "item/reasoning/summaryTextDelta"
            | "item/reasoning/textDelta"
    )
}

fn agent_message_delta(payload: &Value) -> Option<(AgentStreamKey, &str)> {
    if payload.get("method").and_then(Value::as_str) != Some("item/agentMessage/delta") {
        return None;
    }
    let key = agent_stream_key(payload)?;
    let delta = payload.get("params")?.get("delta")?.as_str()?;
    Some((key, delta))
}

fn agent_stream_key(payload: &Value) -> Option<AgentStreamKey> {
    let params = payload.get("params")?.as_object()?;
    let thread_id = params.get("threadId")?.as_str()?;
    let turn_id = params.get("turnId").and_then(Value::as_str).or_else(|| {
        params
            .get("turn")
            .and_then(Value::as_object)
            .and_then(|turn| turn.get("id"))
            .and_then(Value::as_str)
    })?;
    Some(AgentStreamKey {
        thread_id: thread_id.to_owned(),
        turn_id: turn_id.to_owned(),
    })
}

async fn observe_server_requests(
    state: &Arc<tokio::sync::Mutex<PendingServerRequests>>,
    payloads: &[Value],
) -> Result<(), ()> {
    let mut pending = state.lock().await;
    for payload in payloads {
        let method = payload.get("method").and_then(Value::as_str);
        if method == Some("serverRequest/resolved") {
            if let Some(id) = payload
                .get("params")
                .and_then(|params| params.get("requestId"))
            {
                remove_server_request_locked(&mut pending, &rpc_id_key(id));
            }
            continue;
        }
        if !method.is_some_and(|method| USER_SERVER_REQUEST_METHODS.contains(&method)) {
            continue;
        }
        if payload.get("params").and_then(Value::as_object).is_none() {
            continue;
        }
        let Some(id) = payload.get("id") else {
            continue;
        };
        let bytes = serde_json::to_vec(payload).map_err(|_| ())?.len();
        let key = rpc_id_key(id);
        let previous_bytes = pending
            .requests
            .get(&key)
            .and_then(|value| serde_json::to_vec(value).ok())
            .map_or(0, |value| value.len());
        let next_bytes = pending
            .bytes
            .saturating_sub(previous_bytes)
            .saturating_add(bytes);
        if bytes > MAX_SINGLE_SERVER_REQUEST_BYTES
            || (previous_bytes == 0 && pending.requests.len() >= MAX_PENDING_SERVER_REQUESTS)
            || next_bytes > MAX_PENDING_SERVER_REQUEST_BYTES
        {
            return Err(());
        }
        pending.requests.insert(key, payload.clone());
        pending.bytes = next_bytes;
    }
    Ok(())
}

async fn clear_server_requests_on_disconnect(
    mut status: tokio::sync::watch::Receiver<ConnectionStatus>,
    state: Arc<tokio::sync::Mutex<PendingServerRequests>>,
    local_events: tokio::sync::mpsc::Sender<Value>,
) {
    while status.changed().await.is_ok() {
        if *status.borrow() != ConnectionStatus::Reconnecting {
            continue;
        }
        let ids = {
            let mut pending = state.lock().await;
            let ids = pending
                .requests
                .values()
                .filter_map(|request| request.get("id").cloned())
                .collect::<Vec<_>>();
            *pending = PendingServerRequests::default();
            ids
        };
        for id in ids {
            if local_events
                .send(json!({
                    "method": "serverRequest/resolved",
                    "params": {"requestId": id, "reason": "upstream_disconnected"}
                }))
                .await
                .is_err()
            {
                return;
            }
        }
    }
}

async fn remove_server_request(state: &Arc<tokio::sync::Mutex<PendingServerRequests>>, key: &str) {
    let mut pending = state.lock().await;
    remove_server_request_locked(&mut pending, key);
}

fn remove_server_request_locked(state: &mut PendingServerRequests, key: &str) {
    if let Some(request) = state.requests.remove(key) {
        state.bytes = state
            .bytes
            .saturating_sub(serde_json::to_vec(&request).map_or(0, |serialized| serialized.len()));
    }
    state.resolving.remove(key);
}

fn rpc_id_key(id: &Value) -> String {
    let kind = match id {
        Value::Null => "null",
        Value::Bool(_) => "bool",
        Value::Number(_) => "number",
        Value::String(_) => "string",
        Value::Array(_) => "array",
        Value::Object(_) => "object",
    };
    format!("{kind}:{id}")
}

struct RpcResultObservers {
    resources: Option<Arc<ResourceService>>,
    projects: Option<Arc<ProjectService>>,
}

#[allow(clippy::too_many_arguments)]
async fn forward_rpc(
    upstream: &UpstreamHandle,
    socket: &SessionSocket,
    request: Value,
    id: Value,
    method: &str,
    projector: Option<Arc<ContentProjector>>,
    history: &HistoryService,
    observers: RpcResultObservers,
) -> Result<(), ()> {
    let result = upstream.request(request).await;
    match result {
        Ok(response) => {
            forward_rpc_response(socket, response, id, method, projector, history, observers).await
        }
        Err(error) => {
            let code = match error {
                UpstreamError::Backpressure => -32004,
                UpstreamError::Reconnecting | UpstreamError::Disconnected => -32003,
                UpstreamError::Protocol(_) => -32020,
            };
            send_rpc_error(socket, id, code, &error.to_string()).await
        }
    }
}

async fn forward_rpc_response(
    socket: &SessionSocket,
    mut response: Value,
    id: Value,
    method: &str,
    projector: Option<Arc<ContentProjector>>,
    history: &HistoryService,
    observers: RpcResultObservers,
) -> Result<(), ()> {
    if !is_read_only_method(method)
        && let Some(error) = response.get("error")
    {
        let code = error.get("code").and_then(Value::as_i64);
        let message = error
            .get("message")
            .and_then(Value::as_str)
            .unwrap_or("upstream rejected the mutation");
        warn!(
            rpc_method = method,
            rpc_code = code,
            rpc_error = message,
            "App Server mutation rejected"
        );
    }
    if method == "thread/list"
        && let Some(result) = response.get_mut("result")
    {
        *result = history.enrich_thread_list(result.take()).await;
    }
    if let (Some(projects), Some(result)) = (observers.projects, response.get("result")) {
        projects.observe_rpc_result(method, result).await;
    }
    if let (Some(resources), Some(result)) = (observers.resources, response.get("result")) {
        resources.observe_rpc_result(method, result).await;
    }
    if let (Some(projector), Some(result)) = (projector, response.get_mut("result")) {
        *result = projector.project_rpc_result(method, result.take());
    }
    if let Some(object) = response.as_object_mut() {
        object.insert("id".into(), id);
    }
    send_json(socket, &json!({ "type": "rpc", "response": response }))
        .await
        .map_err(|_| ())
}

fn queue_rpc(
    store: &IndexStore,
    method: &str,
    params: &Value,
) -> Result<Value, crate::store::StoreError> {
    let object = params.as_object().ok_or_else(|| {
        crate::store::StoreError::CorruptedIndex("queue params must be an object".into())
    })?;
    match method {
        "companion/queue/put" => queue_put(store, object),
        "companion/queue/list" => {
            let thread_id = object.get("threadId").and_then(Value::as_str);
            // Delivered queue rows are durable handoff receipts. The client
            // projects them as accepted chat deliveries (not queued prompts)
            // until the canonical user item with the same command id arrives.
            Ok(json!({"data": store.outbox_list(thread_id)? }))
        }
        "companion/queue/edit" => {
            let command_id = required_string(object.get("commandId"), "commandId")?;
            let input = object.get("input").cloned().ok_or_else(|| {
                crate::store::StoreError::CorruptedIndex("queue input is required".into())
            })?;
            serde_json::to_value(store.outbox_edit_prompt(command_id, &input)?).map_err(Into::into)
        }
        "companion/queue/cancel" => {
            let command_id = required_string(object.get("commandId"), "commandId")?;
            Ok(json!({"cancelled": store.outbox_cancel(command_id)?}))
        }
        "companion/queue/retry" => {
            let command_id = required_string(object.get("commandId"), "commandId")?;
            serde_json::to_value(store.outbox_retry_failed(command_id)?).map_err(Into::into)
        }
        "companion/queue/move" => queue_move(store, object),
        _ => Err(crate::store::StoreError::CorruptedIndex(
            "unknown companion queue method".into(),
        )),
    }
}

fn queue_command(params: &Value) -> Option<&Map<String, Value>> {
    let object = params.as_object()?;
    object
        .get("command")
        .and_then(Value::as_object)
        .or(Some(object))
}

fn queue_changed_thread_id(store: &IndexStore, method: &str, params: &Value) -> Option<String> {
    if method == "companion/queue/list" {
        return None;
    }
    if method == "companion/queue/put" {
        return queue_command(params)?
            .get("remoteThreadId")
            .and_then(Value::as_str)
            .map(str::to_owned);
    }
    let command_id = params.get("commandId").and_then(Value::as_str)?;
    store
        .outbox_list(None)
        .ok()?
        .into_iter()
        .find(|command| command.command_id == command_id)
        .map(|command| command.remote_thread_id)
}

fn queue_put(
    store: &IndexStore,
    object: &Map<String, Value>,
) -> Result<Value, crate::store::StoreError> {
    let command = object
        .get("command")
        .and_then(Value::as_object)
        .unwrap_or(object);
    let command_id = required_string(command.get("commandId"), "commandId")?;
    let thread_id = required_string(command.get("remoteThreadId"), "remoteThreadId")?;
    if required_string(command.get("method"), "method")? != "turn/start" {
        return Err(crate::store::StoreError::CorruptedIndex(
            "only turn/start can be queued".into(),
        ));
    }
    let rpc_params = command.get("params").cloned().unwrap_or_else(|| json!({}));
    let created_at = command.get("createdAt").and_then(Value::as_u64);
    let workspace_request_id = command.get("workspaceRequestId").and_then(Value::as_str);
    let presentation = match command.get("presentation").and_then(Value::as_str) {
        None | Some("queue") => OutboxPresentation::Queue,
        Some("delivery") => OutboxPresentation::Delivery,
        Some(_) => {
            return Err(crate::store::StoreError::CorruptedIndex(
                "queue presentation must be queue or delivery".into(),
            ));
        }
    };
    serde_json::to_value(store.outbox_put_turn_start_with_workspace(
        command_id,
        thread_id,
        rpc_params,
        created_at,
        presentation,
        workspace_request_id,
    )?)
    .map_err(Into::into)
}

fn queue_move(
    store: &IndexStore,
    object: &Map<String, Value>,
) -> Result<Value, crate::store::StoreError> {
    let command_id = required_string(object.get("commandId"), "commandId")?;
    let moved = if let Some(before) = object.get("beforeCommandId") {
        let before = match before {
            Value::Null => None,
            value => Some(required_string(Some(value), "beforeCommandId")?),
        };
        store.outbox_place(command_id, before)?
    } else {
        queue_move_relative(store, command_id, object)?
    };
    Ok(json!({"moved": moved}))
}

fn queue_move_relative(
    store: &IndexStore,
    command_id: &str,
    object: &Map<String, Value>,
) -> Result<bool, crate::store::StoreError> {
    let commands = store.outbox_list(None)?;
    let selected = commands
        .iter()
        .find(|command| command.command_id == command_id)
        .ok_or_else(|| {
            crate::store::StoreError::CorruptedIndex("outbox command not found".into())
        })?;
    let same_thread = commands
        .iter()
        .filter(|command| {
            command.remote_thread_id == selected.remote_thread_id
                && command.state == OutboxState::Queued
        })
        .collect::<Vec<_>>();
    let index = same_thread
        .iter()
        .position(|command| command.command_id == command_id)
        .ok_or_else(|| {
            crate::store::StoreError::CorruptedIndex("outbox command is not queued".into())
        })?;
    let direction = object
        .get("direction")
        .and_then(Value::as_i64)
        .filter(|direction| matches!(direction, -1 | 1))
        .ok_or_else(|| {
            crate::store::StoreError::CorruptedIndex("queue direction must be -1 or 1".into())
        })?;
    let target = i64::try_from(index)
        .unwrap_or(i64::MAX)
        .saturating_add(direction);
    let Ok(target) = usize::try_from(target) else {
        return Ok(false);
    };
    if target >= same_thread.len() {
        return Ok(false);
    }
    let before = if direction < 0 {
        Some(same_thread[target].command_id.as_str())
    } else {
        same_thread
            .get(target.saturating_add(1))
            .map(|command| command.command_id.as_str())
    };
    store.outbox_place(command_id, before)
}

fn required_string<'a>(
    value: Option<&'a Value>,
    label: &str,
) -> Result<&'a str, crate::store::StoreError> {
    value.and_then(Value::as_str).ok_or_else(|| {
        crate::store::StoreError::CorruptedIndex(format!("{label} must be a string"))
    })
}

#[allow(clippy::too_many_arguments)]
async fn run_outbox_pump(
    upstream: UpstreamHandle,
    store: Arc<IndexStore>,
    history: HistoryService,
    wakeup: Arc<tokio::sync::Notify>,
    local_events: tokio::sync::mpsc::Sender<Value>,
    files: Arc<std::sync::RwLock<Option<Arc<FileService>>>>,
    account_pool: Arc<std::sync::RwLock<Option<Arc<AccountPoolService>>>>,
    workspaces: Arc<std::sync::RwLock<Option<Arc<WorkspaceService>>>>,
) {
    let mut status = upstream.subscribe_status();
    let prune_store = store.clone();
    match tokio::task::spawn_blocking(move || prune_store.outbox_prune_delivered_receipts()).await {
        Ok(Ok(removed)) if removed > 0 => {
            info!(removed, "pruned delivered outbox receipts");
        }
        Ok(Ok(_)) => {}
        Ok(Err(error)) => warn!(%error, "delivered outbox receipt pruning failed"),
        Err(error) => warn!(%error, "delivered outbox receipt pruning worker failed"),
    }
    let recovery_store = store.clone();
    match tokio::task::spawn_blocking(move || {
        recovery_store.outbox_recover_legacy_account_pool_failures()
    })
    .await
    {
        Ok(Ok(thread_ids)) => {
            if !thread_ids.is_empty() {
                info!(
                    recovered_threads = thread_ids.len(),
                    "requeued commands failed by legacy account switching"
                );
            }
            for thread_id in thread_ids {
                emit_queue_changed(&store, &local_events, &thread_id).await;
            }
        }
        Ok(Err(error)) => warn!(%error, "legacy account-pool queue recovery failed"),
        Err(error) => warn!(%error, "legacy account-pool recovery worker failed"),
    }
    loop {
        if *status.borrow() == ConnectionStatus::Live {
            let store_for_read = store.clone();
            let heads =
                tokio::task::spawn_blocking(move || store_for_read.outbox_ready_heads()).await;
            match heads {
                Ok(Ok(heads)) => {
                    for command in heads {
                        reconcile_outbox_command(
                            &upstream,
                            &store,
                            &history,
                            &local_events,
                            &files,
                            &account_pool,
                            &workspaces,
                            command,
                        )
                        .await;
                    }
                }
                Ok(Err(error)) => warn!(%error, "durable outbox read failed"),
                Err(error) => warn!(%error, "durable outbox worker failed"),
            }
        }
        tokio::select! {
            () = wakeup.notified() => {}
            changed = status.changed() => {
                if changed.is_err() {
                    break;
                }
            }
            () = tokio::time::sleep(OUTBOX_POLL_INTERVAL), if *status.borrow() == ConnectionStatus::Live => {}
        }
    }
}

#[allow(clippy::too_many_arguments, clippy::too_many_lines)]
async fn reconcile_outbox_command(
    upstream: &UpstreamHandle,
    store: &Arc<IndexStore>,
    history: &HistoryService,
    local_events: &tokio::sync::mpsc::Sender<Value>,
    files: &Arc<std::sync::RwLock<Option<Arc<FileService>>>>,
    account_pool: &Arc<std::sync::RwLock<Option<Arc<AccountPoolService>>>>,
    workspaces: &Arc<std::sync::RwLock<Option<Arc<WorkspaceService>>>>,
    command: OutboxCommand,
) {
    if let Some(request_id) = command.workspace_request_id.as_deref() {
        let workspace_service = match workspaces.read() {
            Ok(slot) => slot.clone(),
            Err(poisoned) => poisoned.into_inner().clone(),
        };
        let Some(workspace_service) = workspace_service else {
            wait_outbox(
                store,
                local_events,
                &command.remote_thread_id,
                &command.command_id,
                OutboxState::Queued,
                None,
                u64::try_from(OUTBOX_POLL_INTERVAL.as_millis()).unwrap_or(500),
            )
            .await;
            return;
        };
        match workspace_service.operation_status(request_id).await {
            Ok(Some(operation)) if operation.phase == WorkspacePhase::Ready => {}
            Ok(Some(operation)) if operation.phase == WorkspacePhase::Failed => {
                set_outbox_state(
                    store,
                    local_events,
                    &command.remote_thread_id,
                    &command.command_id,
                    OutboxState::Failed,
                    operation
                        .error
                        .as_deref()
                        .or(Some("workspace preparation failed")),
                )
                .await;
                return;
            }
            Ok(Some(_)) => {
                wait_outbox(
                    store,
                    local_events,
                    &command.remote_thread_id,
                    &command.command_id,
                    OutboxState::Queued,
                    None,
                    u64::try_from(OUTBOX_POLL_INTERVAL.as_millis()).unwrap_or(500),
                )
                .await;
                return;
            }
            Ok(None) => {
                set_outbox_state(
                    store,
                    local_events,
                    &command.remote_thread_id,
                    &command.command_id,
                    OutboxState::Failed,
                    Some("workspace operation was not found"),
                )
                .await;
                return;
            }
            Err(error) => {
                defer_outbox(
                    store,
                    local_events,
                    &command.remote_thread_id,
                    &command.command_id,
                    OutboxState::Queued,
                    &error.to_string(),
                    retry_delay_ms(command.attempts),
                )
                .await;
                return;
            }
        }
    }
    let account_pool_service = match account_pool.read() {
        Ok(slot) => slot.clone(),
        Err(poisoned) => poisoned.into_inner().clone(),
    };
    if let Some(account_pool) = &account_pool_service {
        match account_pool.prepare_for_turn().await {
            Ok(()) => {}
            Err(AccountPoolError::Deferred(reason)) => {
                wait_outbox(
                    store,
                    local_events,
                    &command.remote_thread_id,
                    &command.command_id,
                    OutboxState::Queued,
                    None,
                    OUTBOX_ACCOUNT_SWITCH_WAIT_MS,
                )
                .await;
                debug!(command_id = %command.command_id, %reason, "outbox is waiting to switch Codex accounts");
                return;
            }
            Err(error) if error.is_retryable() => {
                warn!(command_id = %command.command_id, %error, "outbox account preparation will retry");
                defer_outbox(
                    store,
                    local_events,
                    &command.remote_thread_id,
                    &command.command_id,
                    OutboxState::Queued,
                    &error.to_string(),
                    retry_delay_ms(command.attempts),
                )
                .await;
                return;
            }
            Err(error) => {
                set_outbox_state(
                    store,
                    local_events,
                    &command.remote_thread_id,
                    &command.command_id,
                    OutboxState::Failed,
                    Some(&error.to_string()),
                )
                .await;
                return;
            }
        }
    }
    if command.state == OutboxState::Uncertain {
        match local_history_contains_client_message(history, &command).await {
            Ok(true) => {
                set_outbox_state(
                    store,
                    local_events,
                    &command.remote_thread_id,
                    &command.command_id,
                    OutboxState::Delivered,
                    None,
                )
                .await;
            }
            Ok(false) | Err(_) => {
                // A lost App Server response is genuinely ambiguous because
                // clientUserMessageId is projection metadata, not an
                // idempotency key. Never resend blindly. The canonical rollout
                // monitor advances the local tail index; once the accepted
                // message appears there, the command is acknowledged without
                // touching App Server history or risking a duplicate prompt.
                wait_outbox(
                    store,
                    local_events,
                    &command.remote_thread_id,
                    &command.command_id,
                    OutboxState::Uncertain,
                    command.last_error.as_deref(),
                    u64::try_from(OUTBOX_POLL_INTERVAL.as_millis()).unwrap_or(500),
                )
                .await;
            }
        }
        return;
    }
    if command.presentation == OutboxPresentation::Queue {
        match history.thread_active(&command.remote_thread_id).await {
            Ok(true) => {
                // Explicit queue means "the next turn", never an implicit
                // steer into the current one. App Server accepts turn/start
                // while another client owns the active turn, so the durable
                // Companion lane must hold the head until the indexed
                // lifecycle becomes idle.
                wait_outbox(
                    store,
                    local_events,
                    &command.remote_thread_id,
                    &command.command_id,
                    OutboxState::Queued,
                    None,
                    u64::try_from(OUTBOX_POLL_INTERVAL.as_millis()).unwrap_or(500),
                )
                .await;
                return;
            }
            Ok(false) => {}
            Err(error) => {
                // Unknown lifecycle cannot safely be interpreted as idle: a
                // false negative would consume a queued prompt as a steer.
                debug!(command_id = %command.command_id, %error, "queued turn is waiting for canonical lifecycle");
                wait_outbox(
                    store,
                    local_events,
                    &command.remote_thread_id,
                    &command.command_id,
                    OutboxState::Queued,
                    None,
                    u64::try_from(OUTBOX_POLL_INTERVAL.as_millis()).unwrap_or(500),
                )
                .await;
                return;
            }
        }
    }
    deliver_outbox_start(
        upstream,
        store,
        local_events,
        files,
        account_pool_service,
        command,
    )
    .await;
}

async fn local_history_contains_client_message(
    history: &HistoryService,
    command: &OutboxCommand,
) -> Result<bool, String> {
    let params = json!({
        "threadId": command.remote_thread_id,
        "cursor": null,
        "limit": OUTBOX_RECONCILE_PAGE_SIZE,
        "sortDirection": "desc",
        "itemsView": "summary"
    });
    let page = history
        .try_turns_page("thread/turns/list", &params)
        .await
        .ok_or_else(|| "local summary history is unavailable".to_string())?
        .map_err(|error| error.to_string())?;
    let turns = page
        .get("data")
        .and_then(Value::as_array)
        .ok_or_else(|| "local summary history returned no turns page".to_string())?;
    Ok(turns_contain_client_message(turns, &command.command_id))
}

#[allow(clippy::too_many_lines)]
async fn deliver_outbox_start(
    upstream: &UpstreamHandle,
    store: &Arc<IndexStore>,
    local_events: &tokio::sync::mpsc::Sender<Value>,
    files: &Arc<std::sync::RwLock<Option<Arc<FileService>>>>,
    account_pool: Option<Arc<AccountPoolService>>,
    command: OutboxCommand,
) {
    let file_service = match files.read() {
        Ok(slot) => slot.clone(),
        Err(poisoned) => poisoned.into_inner().clone(),
    };
    let prepared_params =
        match prepare_remote_file_inputs(&command.method, command.params.clone(), file_service)
            .await
        {
            Ok(params) => params,
            Err(RemoteInputError::FileServiceUnavailable) => {
                // The active pump is spawned before main installs optional
                // services. Keep a restored command queued across that startup
                // window instead of turning a valid attachment into a failure.
                return;
            }
            Err(error) => {
                set_outbox_state(
                    store,
                    local_events,
                    &command.remote_thread_id,
                    &command.command_id,
                    OutboxState::Failed,
                    Some(&error.to_string()),
                )
                .await;
                return;
            }
        };
    set_outbox_state(
        store,
        local_events,
        &command.remote_thread_id,
        &command.command_id,
        OutboxState::Uncertain,
        None,
    )
    .await;
    let start = json!({
        "id": "outbox-start",
        "method": command.method,
        "params": prepared_params
    });
    let delivered = dispatch_turn_start_with_resume(upstream, account_pool.as_ref(), start)
        .await
        .map_err(TurnStartDispatchError::into_outbox);
    match delivered {
        Ok(response) if response.get("error").is_some() => {
            set_outbox_state(
                store,
                local_events,
                &command.remote_thread_id,
                &command.command_id,
                OutboxState::Failed,
                Some(&rpc_error_message(&response)),
            )
            .await;
        }
        Ok(_) => {
            set_outbox_state(
                store,
                local_events,
                &command.remote_thread_id,
                &command.command_id,
                OutboxState::Delivered,
                None,
            )
            .await;
        }
        Err(OutboxDeliveryError::Deferred(reason)) => {
            wait_outbox(
                store,
                local_events,
                &command.remote_thread_id,
                &command.command_id,
                OutboxState::Queued,
                None,
                OUTBOX_ACCOUNT_SWITCH_WAIT_MS,
            )
            .await;
            debug!(command_id = %command.command_id, %reason, "turn/start waited for upstream delivery");
        }
        Err(OutboxDeliveryError::Uncertain(error)) => {
            warn!(command_id = %command.command_id, %error, "turn/start delivery is uncertain");
            defer_outbox(
                store,
                local_events,
                &command.remote_thread_id,
                &command.command_id,
                OutboxState::Uncertain,
                &error,
                retry_delay_ms(command.attempts),
            )
            .await;
        }
    }
}

async fn dispatch_turn_start_with_resume(
    upstream: &UpstreamHandle,
    account_pool: Option<&Arc<AccountPoolService>>,
    request: Value,
) -> Result<Value, TurnStartDispatchError> {
    let response = dispatch_turn_start_once(upstream, account_pool, request.clone()).await?;
    let Some(thread_id) = request.pointer("/params/threadId").and_then(Value::as_str) else {
        return Ok(response);
    };
    if !is_thread_not_found_response(&response, thread_id) {
        return Ok(response);
    }

    // `thread not found` is a conclusive pre-acceptance rejection. A Companion
    // reconnect can replace the App Server runtime while indexed history keeps
    // the chat readable, so mutation ownership must rehydrate that runtime
    // before the one safe retry. No turn history is returned to the phone.
    let resumed = match account_pool {
        Some(account_pool) => account_pool
            .resume_thread_for_turn(thread_id)
            .await
            .map_err(TurnStartDispatchError::AccountPool)?,
        None => upstream
            .request(json!({
                "id": "turn-start-resume",
                "method": "thread/resume",
                "params": {
                    "threadId": thread_id,
                    "excludeTurns": true
                }
            }))
            .await
            .map_err(TurnStartDispatchError::Upstream)?,
    };
    if resumed.get("error").is_some() {
        return Ok(resumed);
    }
    dispatch_turn_start_once(upstream, account_pool, request).await
}

async fn dispatch_turn_start_once(
    upstream: &UpstreamHandle,
    account_pool: Option<&Arc<AccountPoolService>>,
    request: Value,
) -> Result<Value, TurnStartDispatchError> {
    match account_pool {
        Some(account_pool) => account_pool
            .send_turn_start(request)
            .await
            .map_err(TurnStartDispatchError::AccountPool),
        None => upstream
            .request(request)
            .await
            .map_err(TurnStartDispatchError::Upstream),
    }
}

fn is_thread_not_found_response(response: &Value, thread_id: &str) -> bool {
    response
        .pointer("/error/message")
        .and_then(Value::as_str)
        .and_then(|message| message.strip_prefix("thread not found: "))
        == Some(thread_id)
}

fn retry_delay_ms(attempts: u32) -> u64 {
    let exponent = attempts.min(6);
    let cap = OUTBOX_RETRY_BASE_MS
        .saturating_mul(1_u64 << exponent)
        .min(OUTBOX_RETRY_MAX_MS);
    let floor = (cap / 2).max(1);
    rand::rng().random_range(floor..=cap)
}

async fn set_outbox_state(
    store: &Arc<IndexStore>,
    local_events: &tokio::sync::mpsc::Sender<Value>,
    thread_id: &str,
    command_id: &str,
    state: OutboxState,
    error: Option<&str>,
) {
    let store = store.clone();
    let command_id = command_id.to_owned();
    let error = error.map(str::to_owned);
    let update_store = store.clone();
    let result = tokio::task::spawn_blocking(move || {
        update_store.outbox_set_state(&command_id, state, error.as_deref())
    })
    .await;
    match result {
        Ok(Ok(_)) => emit_queue_changed(&store, local_events, thread_id).await,
        Ok(Err(error)) => warn!(%error, "durable outbox update failed"),
        Err(error) => warn!(%error, "durable outbox update worker failed"),
    }
}

async fn defer_outbox(
    store: &Arc<IndexStore>,
    local_events: &tokio::sync::mpsc::Sender<Value>,
    thread_id: &str,
    command_id: &str,
    state: OutboxState,
    error: &str,
    delay_ms: u64,
) {
    let store = store.clone();
    let command_id = command_id.to_owned();
    let error = error.to_owned();
    let update_store = store.clone();
    let result = tokio::task::spawn_blocking(move || {
        update_store.outbox_defer(&command_id, state, &error, delay_ms)
    })
    .await;
    match result {
        Ok(Ok(_)) => emit_queue_changed(&store, local_events, thread_id).await,
        Ok(Err(error)) => warn!(%error, "durable outbox retry scheduling failed"),
        Err(error) => warn!(%error, "durable outbox retry worker failed"),
    }
}

async fn wait_outbox(
    store: &Arc<IndexStore>,
    local_events: &tokio::sync::mpsc::Sender<Value>,
    thread_id: &str,
    command_id: &str,
    state: OutboxState,
    error: Option<&str>,
    delay_ms: u64,
) {
    let store = store.clone();
    let command_id = command_id.to_owned();
    let error = error.map(str::to_owned);
    let update_store = store.clone();
    let result = tokio::task::spawn_blocking(move || {
        update_store.outbox_wait(&command_id, state, error.as_deref(), delay_ms)
    })
    .await;
    match result {
        Ok(Ok((_, true))) => emit_queue_changed(&store, local_events, thread_id).await,
        Ok(Ok((_, false))) => {}
        Ok(Err(error)) => warn!(%error, "durable outbox wait scheduling failed"),
        Err(error) => warn!(%error, "durable outbox wait worker failed"),
    }
}

async fn emit_queue_changed(
    store: &Arc<IndexStore>,
    local_events: &tokio::sync::mpsc::Sender<Value>,
    thread_id: &str,
) {
    let store = store.clone();
    let thread_id = thread_id.to_owned();
    let listed = tokio::task::spawn_blocking({
        let thread_id = thread_id.clone();
        move || store.outbox_list(Some(&thread_id))
    })
    .await;
    let Ok(Ok(data)) = listed else {
        warn!(thread_id, "durable outbox notification read failed");
        return;
    };
    let _ = local_events
        .send(json!({
            "method": "companion/queue/changed",
            "params": {"threadId": thread_id, "data": data}
        }))
        .await;
}

/// `clientUserMessageId` is projection metadata in App Server, not an
/// idempotency key: repeating `turn/start` would append the same prompt again.
/// Reconcile before every direct start so a retry after a lost RPC response is
/// acknowledged with the already-created turn instead of being forwarded.
async fn reconcile_direct_turn_start(
    upstream: &UpstreamHandle,
    params: &Value,
) -> Result<Option<Value>, String> {
    let Some(thread_id) = params.get("threadId").and_then(Value::as_str) else {
        return Ok(None);
    };
    let Some(client_id) = params.get("clientUserMessageId").and_then(Value::as_str) else {
        return Ok(None);
    };
    let response = upstream
        .request(json!({
            "id": "turn-start-reconcile",
            "method": "thread/turns/list",
            "params": {
                "threadId": thread_id,
                "cursor": null,
                "limit": 16,
                "sortDirection": "desc",
                "itemsView": "summary"
            }
        }))
        .await
        .map_err(|error| format!("Could not verify prior message delivery: {error}"))?;
    if response.get("error").is_some() {
        return Err(format!(
            "Could not verify prior message delivery: {}",
            rpc_error_message(&response)
        ));
    }
    let turns = response
        .get("result")
        .and_then(|result| result.get("data"))
        .and_then(Value::as_array)
        .ok_or_else(|| "Could not verify prior message delivery: invalid turns page".to_string())?;
    Ok(turn_with_client_message(turns, client_id).cloned())
}

fn turns_contain_client_message(turns: &[Value], client_id: &str) -> bool {
    turn_with_client_message(turns, client_id).is_some()
}

fn turn_with_client_message<'a>(turns: &'a [Value], client_id: &str) -> Option<&'a Value> {
    turns.iter().find(|turn| {
        turn.get("items")
            .and_then(Value::as_array)
            .is_some_and(|items| {
                items.iter().any(|item| {
                    item.get("type").and_then(Value::as_str) == Some("userMessage")
                        && item.get("clientId").and_then(Value::as_str) == Some(client_id)
                })
            })
    })
}

fn rpc_error_message(response: &Value) -> String {
    response
        .get("error")
        .and_then(|error| error.get("message"))
        .and_then(Value::as_str)
        .unwrap_or("App Server request failed")
        .chars()
        .take(500)
        .collect()
}

fn is_read_only_method(method: &str) -> bool {
    matches!(
        method,
        "account/rateLimits/read"
            | "companion/thread/observe"
            | "companion/threadWindow/read"
            | "companion/threadSubagents/read"
            | "config/read"
            | "fs/readDirectory"
            | "app/installed"
            | "app/list"
            | "app/read"
            | "collaborationMode/list"
            | "hooks/list"
            | "mcpServer/resource/read"
            | "mcpServerStatus/list"
            | "model/list"
            | "modelProvider/capabilities/read"
            | "permissionProfile/list"
            | "plugin/installed"
            | "plugin/list"
            | "plugin/read"
            | "plugin/search"
            | "plugin/skill/read"
            | "skills/list"
            | "thread/backgroundTerminals/list"
            | "thread/goal/get"
            | "thread/items/list"
            | "thread/list"
            | "thread/loaded/list"
            | "thread/read"
            | "thread/search"
            | "thread/searchOccurrences"
            | "thread/turns/list"
            | "threadSection/list"
    )
}

fn required_scope_for_rpc(method: &str) -> Option<&'static str> {
    if matches!(
        method,
        "companion/workspace/inspect" | "companion/workspace/read"
    ) {
        return Some("threads.read");
    }
    if method == "companion/workspace/create" {
        return Some("threads.write");
    }
    if method == "companion/project/list" {
        return Some("threads.read");
    }
    if method == "companion/project/add" {
        return Some("threads.write");
    }
    if matches!(
        method,
        "companion/accountPool/list" | "companion/accountPool/refresh"
    ) {
        return Some("threads.read");
    }
    if method.starts_with("companion/accountPool/") {
        return Some("threads.write");
    }
    if matches!(
        method,
        "companion/threadWindow/read"
            | "companion/threadSubagents/read"
            | "companion/threadResources/read"
            | "companion/threadChanges/read"
            | "companion/threadAttachments/read"
            | "companion/threadChange/read"
    ) || is_read_only_method(method)
    {
        return Some("threads.read");
    }
    if method.starts_with("companion/queue/")
        || method.starts_with("companion/dictation/")
        || method.starts_with("thread/realtime/")
        || matches!(method, "turn/start" | "turn/interrupt" | "review/start")
    {
        return Some("turns.start");
    }
    if is_thread_write_method(method) {
        return Some("threads.write");
    }
    if method == "turn/steer" {
        return Some("turns.steer");
    }
    if matches!(
        method,
        "thread/backgroundTerminals/clean" | "thread/backgroundTerminals/terminate"
    ) {
        return Some("processes.manage");
    }
    if method == "mcpServer/tool/call" {
        return Some("tools.call");
    }
    if method == "thread/shellCommand" || method.starts_with("command/exec") {
        return Some("shell.explicit");
    }
    None
}

/// Returns the V1 authorization scope used for one sync RPC. Raw bridge-only
/// initialize notifications deliberately have no device scope.
#[must_use]
pub fn contract_scope_for_rpc(method: &str) -> Option<&'static str> {
    required_scope_for_rpc(method)
}

fn authorization_has_scope(authorization: &AuthorizationContext, scope: &str) -> bool {
    match authorization {
        AuthorizationContext::Admin => true,
        AuthorizationContext::Session { scopes, .. } => {
            scopes.iter().any(|candidate| candidate == scope)
        }
        AuthorizationContext::Device { .. } => false,
    }
}

fn rpc_requires_ordered_lane(method: &str) -> bool {
    // Observer attachment does not mutate persisted thread data, so it keeps
    // the read scope. It still has to precede a turn/start for the same thread:
    // otherwise the first live deltas can be emitted before Companion has
    // subscribed to that thread.
    method == "companion/thread/observe"
        || (!is_read_only_method(method)
            && !matches!(
                method,
                "companion/accountPool/list"
                    | "companion/project/list"
                    | "companion/queue/list"
                    | "companion/threadAttachments/read"
                    | "companion/threadChange/read"
                    | "companion/threadChanges/read"
                    | "companion/threadResources/read"
                    | "companion/threadSubagents/read"
                    | "companion/threadWindow/read"
                    | "companion/workspace/inspect"
                    | "companion/workspace/read"
            ))
}

fn rpc_thread_mutation_id(request: &Value) -> Option<&str> {
    let method = request.get("method").and_then(Value::as_str)?;
    if !rpc_requires_ordered_lane(method) {
        return None;
    }
    let params = request.get("params")?;
    params
        .get("threadId")
        .and_then(Value::as_str)
        .or_else(|| params.get("remoteThreadId").and_then(Value::as_str))
        .or_else(|| {
            params
                .get("command")
                .and_then(|command| command.get("remoteThreadId"))
                .and_then(Value::as_str)
        })
}

fn is_thread_write_method(method: &str) -> bool {
    matches!(
        method,
        "thread/start"
            | "thread/resume"
            | "thread/fork"
            | "thread/archive"
            | "thread/delete"
            | "thread/unsubscribe"
            | "thread/name/set"
            | "thread/goal/set"
            | "thread/goal/clear"
            | "thread/metadata/update"
            | "thread/section/move"
            | "thread/settings/update"
            | "thread/memoryMode/set"
            | "thread/unarchive"
            | "thread/compact/start"
            | "thread/rollback"
            | "threadSection/create"
            | "threadSection/update"
            | "threadSection/delete"
    )
}

fn is_mutating_method(method: &str) -> bool {
    matches!(
        method,
        "thread/start"
            | "thread/resume"
            | "thread/fork"
            | "thread/archive"
            | "thread/delete"
            | "thread/unsubscribe"
            | "thread/name/set"
            | "thread/goal/set"
            | "thread/goal/clear"
            | "thread/metadata/update"
            | "thread/section/move"
            | "thread/settings/update"
            | "thread/memoryMode/set"
            | "thread/unarchive"
            | "thread/compact/start"
            | "thread/rollback"
            | "threadSection/create"
            | "threadSection/update"
            | "threadSection/delete"
            | "turn/start"
            | "turn/steer"
            | "turn/interrupt"
            | "thread/realtime/start"
            | "thread/realtime/appendAudio"
            | "thread/realtime/stop"
            | "review/start"
            | "mcpServer/tool/call"
            | "thread/backgroundTerminals/clean"
            | "thread/backgroundTerminals/terminate"
            | "thread/shellCommand"
            | "command/exec"
            | "command/exec/write"
            | "command/exec/terminate"
            | "command/exec/resize"
    )
}

async fn send_rpc_error(
    socket: &SessionSocket,
    id: Value,
    code: i64,
    message: &str,
) -> Result<(), ()> {
    send_json(
        socket,
        &json!({ "type": "rpc", "response": { "id": id, "error": { "code": code, "message": message } } }),
    )
    .await
    .map_err(|_| ())
}

async fn send_json(socket: &SessionSocket, value: &Value) -> Result<(), axum::Error> {
    socket.send(Message::Text(value.to_string().into())).await
}

async fn receive_authorization_change(
    changes: &mut Option<tokio::sync::broadcast::Receiver<AuthorizationChange>>,
) -> Result<AuthorizationChange, tokio::sync::broadcast::error::RecvError> {
    match changes {
        Some(changes) => changes.recv().await,
        None => std::future::pending().await,
    }
}

async fn handle_authorization_change(
    socket: &SessionSocket,
    authorization: &AuthorizationContext,
    change: Result<AuthorizationChange, tokio::sync::broadcast::error::RecvError>,
) -> AuthorizationChangeOutcome {
    match change {
        Ok(change) if authorization.device_id() == Some(change.device_id.as_str()) => {
            close_with(socket, 4003, change.reason.close_reason()).await;
            AuthorizationChangeOutcome::Close
        }
        Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => {
            close_with(socket, 4003, "authorization_changed").await;
            AuthorizationChangeOutcome::Close
        }
        Ok(_) => AuthorizationChangeOutcome::Continue,
        Err(tokio::sync::broadcast::error::RecvError::Closed) => {
            AuthorizationChangeOutcome::Disable
        }
    }
}

async fn close_with(socket: &SessionSocket, code: u16, reason: &str) {
    let _ = socket
        .send(Message::Close(Some(axum::extract::ws::CloseFrame {
            code,
            reason: reason.into(),
        })))
        .await;
}

#[cfg(test)]
mod tests {
    use std::io::Write;

    use super::*;

    #[test]
    fn read_only_mode_refuses_mutations() {
        assert!(is_read_only_method("thread/list"));
        assert!(is_read_only_method("companion/threadSubagents/read"));
        assert!(is_read_only_method("fs/readDirectory"));
        assert!(is_read_only_method("config/read"));
        assert_eq!(contract_scope_for_rpc("config/read"), Some("threads.read"));
        assert_eq!(
            contract_scope_for_rpc("companion/threadSubagents/read"),
            Some("threads.read")
        );
        assert!(!is_read_only_method("turn/start"));
        assert!(!is_read_only_method("thread/delete"));
    }

    #[test]
    fn completed_subagent_activity_updates_the_parent_index_immediately()
    -> Result<(), Box<dyn std::error::Error>> {
        let directory = tempfile::tempdir()?;
        let store = IndexStore::open(directory.path().join("index.redb"))?;
        store.put_thread_metadata(&IndexedThreadMetadata {
            id: "root".into(),
            parent_thread_id: None,
            cwd: "/repo".into(),
            created_at: 1,
            updated_at: 1,
            model_provider: "openai_no_ws".into(),
            cli_version: "0.147.0".into(),
            source: Value::String("cli".into()),
            agent_nickname: None,
            agent_role: None,
            archived: false,
        })?;

        observe_subagent_metadata(
            &store,
            &json!({
                "method": "item/completed",
                "params": {
                    "threadId": "root",
                    "item": {
                        "type": "subAgentActivity",
                        "agentThreadId": "child",
                        "agentPath": "/root/worker"
                    }
                }
            }),
        )?;

        let descendants = store.thread_descendants("root")?;
        assert_eq!(descendants.len(), 1);
        assert_eq!(descendants[0].id, "child");
        assert_eq!(descendants[0].cwd, "/repo");
        assert_eq!(descendants[0].model_provider, "openai_no_ws");
        Ok(())
    }

    #[test]
    fn mutations_are_ordered_only_within_their_thread() {
        assert_eq!(
            rpc_thread_mutation_id(&json!({
                "method": "companion/thread/observe",
                "params": {"threadId": "thread-a"}
            })),
            Some("thread-a")
        );
        assert_eq!(
            rpc_thread_mutation_id(&json!({
                "method": "turn/start",
                "params": {"threadId": "thread-a"}
            })),
            Some("thread-a")
        );
        assert_eq!(
            rpc_thread_mutation_id(&json!({
                "method": "companion/queue/put",
                "params": {"command": {"remoteThreadId": "thread-b"}}
            })),
            Some("thread-b")
        );
        assert_eq!(
            rpc_thread_mutation_id(&json!({
                "method": "thread/list",
                "params": {"threadId": "thread-a"}
            })),
            None
        );
        assert_eq!(
            rpc_thread_mutation_id(&json!({
                "method": "companion/dictation/appendBatch",
                "params": {"sessionId": "dictation-a"}
            })),
            None
        );
    }

    #[test]
    fn finds_a_turn_by_stable_client_message_id() {
        let turns = vec![
            json!({"id": "older", "items": []}),
            json!({
                "id": "accepted",
                "items": [{"type": "userMessage", "clientId": "android-stable"}]
            }),
        ];

        assert_eq!(
            turn_with_client_message(&turns, "android-stable")
                .and_then(|turn| turn.get("id"))
                .and_then(Value::as_str),
            Some("accepted")
        );
        assert!(turn_with_client_message(&turns, "another-id").is_none());
    }

    #[test]
    fn queue_list_keeps_delivered_explicit_queue_handoff_receipts()
    -> Result<(), Box<dyn std::error::Error>> {
        let directory = tempfile::tempdir()?;
        let store = IndexStore::open(directory.path().join("index.redb"))?;
        let params = |command_id: &str| {
            json!({
                "threadId": "thread",
                "clientUserMessageId": command_id,
                "input": [{"type": "text", "text": command_id}]
            })
        };
        store.outbox_put_turn_start_with_presentation(
            "queued-receipt",
            "thread",
            params("queued-receipt"),
            Some(1),
            OutboxPresentation::Queue,
        )?;
        store.outbox_set_state("queued-receipt", OutboxState::Delivered, None)?;
        store.outbox_put_turn_start_with_presentation(
            "direct-receipt",
            "thread",
            params("direct-receipt"),
            Some(2),
            OutboxPresentation::Delivery,
        )?;
        store.outbox_set_state("direct-receipt", OutboxState::Delivered, None)?;

        let listed = queue_rpc(
            &store,
            "companion/queue/list",
            &json!({"threadId": "thread"}),
        )?;
        assert_eq!(listed["data"].as_array().map(Vec::len), Some(2));
        assert_eq!(listed["data"][0]["commandId"], "queued-receipt");
        assert_eq!(listed["data"][1]["commandId"], "direct-receipt");
        Ok(())
    }

    #[test]
    fn extracts_thread_ids_from_raw_and_projected_events() {
        assert_eq!(
            event_thread_id(&json!({"params": {"threadId": "raw"}})),
            Some("raw")
        );
        assert_eq!(
            event_thread_id(&json!({
                "params": {},
                "codewideThreadPatch": {
                    "version": 1,
                    "threadId": "projected",
                    "operation": {"kind": "threadInvalidated"}
                }
            })),
            Some("projected")
        );
    }

    #[test]
    fn live_broadcast_signal_cannot_retain_event_payloads() {
        assert!(
            std::mem::size_of::<DurableSignal>() <= 16,
            "the live ring must contain only a cursor-sized wake-up signal"
        );
    }

    #[test]
    fn coalesces_only_adjacent_stream_text_deltas_for_the_same_envelope() {
        let delta = |item_id: &str, text: &str| {
            json!({
                "method": "item/agentMessage/delta",
                "params": {
                    "threadId": "thread",
                    "turnId": "turn",
                    "itemId": item_id,
                    "delta": text,
                },
                "subscriptionId": "live",
            })
        };
        let payloads = coalesce_stream_text_deltas(vec![
            delta("message", "one "),
            delta("message", "two"),
            delta("other", "separate"),
            delta("message", " tail"),
            json!({"method": "item/completed", "params": {"threadId": "thread"}}),
        ]);

        assert_eq!(payloads.len(), 4);
        assert_eq!(payloads[0]["params"]["delta"], "one two");
        assert_eq!(payloads[1]["params"]["delta"], "separate");
        assert_eq!(payloads[2]["params"]["delta"], " tail");
        assert_eq!(payloads[3]["method"], "item/completed");
    }

    #[test]
    fn coalesces_reasoning_text_without_crossing_a_method_boundary() {
        let payloads = coalesce_stream_text_deltas(vec![
            json!({
                "method": "item/reasoning/textDelta",
                "params": {"threadId": "thread", "turnId": "turn", "itemId": "reasoning", "delta": "one"},
            }),
            json!({
                "method": "item/reasoning/textDelta",
                "params": {"threadId": "thread", "turnId": "turn", "itemId": "reasoning", "delta": "two"},
            }),
            json!({
                "method": "item/reasoning/summaryTextDelta",
                "params": {"threadId": "thread", "turnId": "turn", "itemId": "reasoning", "delta": "summary"},
            }),
        ]);

        assert_eq!(payloads.len(), 2);
        assert_eq!(payloads[0]["params"]["delta"], "onetwo");
        assert_eq!(payloads[1]["params"]["delta"], "summary");
    }

    #[test]
    fn preserves_unknown_stream_delta_envelope_fields() {
        let payloads = coalesce_stream_text_deltas(vec![
            json!({
                "method": "item/agentMessage/delta",
                "params": {"threadId": "thread", "turnId": "turn", "itemId": "message", "delta": "one"},
                "futureField": 1,
            }),
            json!({
                "method": "item/agentMessage/delta",
                "params": {"threadId": "thread", "turnId": "turn", "itemId": "message", "delta": "two"},
                "futureField": 2,
            }),
        ]);

        assert_eq!(payloads.len(), 2);
        assert_eq!(payloads[0]["futureField"], 1);
        assert_eq!(payloads[1]["futureField"], 2);
    }

    #[test]
    fn suppresses_only_recent_upstream_rollout_echoes() {
        let recent = std::sync::Mutex::new(HashMap::new());
        remember_upstream_thread(&recent, "thread");
        assert!(recently_seen_upstream_for(
            &recent,
            "thread",
            ROLLOUT_UPSTREAM_SUPPRESSION
        ));
        assert!(!recently_seen_upstream_for(
            &recent,
            "other",
            ROLLOUT_UPSTREAM_SUPPRESSION
        ));
    }

    #[tokio::test]
    async fn recent_rollout_echo_becomes_one_trailing_reconciliation()
    -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        let directory = tempfile::tempdir()?;
        let thread_id = "019fe7af-e2fa-70f3-88e8-99d59e10bd63";
        let sessions = directory.path().join("sessions/2026/08/18");
        std::fs::create_dir_all(&sessions)?;
        let path = sessions.join(format!("rollout-2026-08-18T12-00-00-{thread_id}.jsonl"));
        let mut rollout = std::fs::File::create(&path)?;
        for line in [
            json!({"type":"event_msg","payload":{"type":"task_started","turn_id":"turn"}}),
            json!({"type":"event_msg","payload":{"type":"user_message","message":"Question"}}),
            json!({"type":"event_msg","payload":{"type":"agent_message","message":"Complete answer"}}),
            json!({"type":"event_msg","payload":{"type":"task_complete","turn_id":"turn","last_agent_message":"Complete answer"}}),
        ] {
            writeln!(rollout, "{line}")?;
        }
        rollout.sync_all()?;

        let store = Arc::new(IndexStore::open(directory.path().join("state.redb"))?);
        let history = HistoryService::new(
            Arc::new(crate::catalog::SessionCatalog::scan(directory.path())),
            store,
        );
        let recent = Arc::new(std::sync::Mutex::new(HashMap::new()));
        remember_upstream_thread(&recent, thread_id);
        let (change_tx, mut change_rx) = tokio::sync::mpsc::channel(4);
        let (ingest_tx, mut ingest_rx) = tokio::sync::mpsc::channel(4);
        for _ in 0..2 {
            change_tx
                .send(crate::rollout_monitor::RolloutChange {
                    thread_id: thread_id.to_owned(),
                    path: path.clone(),
                    archived: false,
                })
                .await?;
        }
        drop(change_tx);
        let forwarder = tokio::spawn(async move {
            forward_rollout_changes_with_suppression(
                &mut change_rx,
                history,
                ingest_tx,
                recent,
                Arc::new(std::sync::RwLock::new(None)),
                Duration::from_millis(30),
            )
            .await;
        });

        assert!(
            tokio::time::timeout(Duration::from_millis(10), ingest_rx.recv())
                .await
                .is_err(),
            "an upstream echo must stay suppressed during its live window"
        );
        let repaired = tokio::time::timeout(Duration::from_millis(300), ingest_rx.recv())
            .await?
            .ok_or("trailing reconciliation was not emitted")?;
        assert_eq!(repaired["method"], "companion/thread/invalidated");
        assert_eq!(repaired["params"]["threadId"], thread_id);
        forwarder.await?;
        assert!(
            ingest_rx.recv().await.is_none(),
            "coalesced rollout writes must not emit duplicate reconciliation events"
        );
        Ok(())
    }
}
