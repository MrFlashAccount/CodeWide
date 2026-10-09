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
use serde_json::{Map, Value, json};
use tracing::{debug, info, warn};

use crate::{
    agent::{
        bindings::BindingStore,
        client_wire::{
            decode::{self, MergedMethod, MethodRoute},
            events::EventProjector,
            gateway::{ClientWireGateway, RpcFailure},
            history::{self as provider_history, Anchor},
        },
        model::{Capability, ProviderId},
        provider::{
            HistoryPageError, NativeThreadResources, NativeThreadStore, ProviderError,
            ProviderEvent, ProviderStatus,
        },
        registry::ProviderRegistry,
    },
    auth::{AuthorizationChange, AuthorizationContext},
    content::{ContentProjector, MAX_INLINE_TEXT_BYTES},
    dictation::DictationService,
    files::FileService,
    global_supervisor_limits::GLOBAL_SUPERVISOR_LIMITS_V1,
    projects::ProjectService,
    remote_inputs::prepare_remote_file_inputs,
    store::{
        IndexStore, IndexedThreadMetadata, OutboxClaimOutcome, OutboxCommand, OutboxState,
        ReplayPage,
    },
    sync_live::{
        LiveChannelRegistry, LiveControlResult, classify_pending_request_method,
        is_realtime_notification, realtime_startup_notification_method,
    },
    sync_pending::{
        PendingServerRequests, clear_user_requests_on_disconnect,
        enforce_dynamic_tool_output_limit, observe_server_requests,
        reject_oversized_dynamic_tool_requests, remove_server_request,
        retry_oversized_dynamic_tool_rejections, rpc_id_key,
    },
    thread_view::ThreadViewService,
    workspaces::WorkspaceService,
};

mod outbox;
mod outbox_state;
mod provider_rpc;
mod queue;

use outbox::{PumpContext, reconcile_direct_turn_start, run_outbox_pump};
#[cfg(test)]
use outbox_state::turn_with_client_message;
use outbox_state::{
    OwnedClaimResolution, emit_queue_changed, resolve_outbox_claim, retry_delay_ms,
    rpc_error_message,
};
use provider_rpc::{RpcResultObservers, forward_rpc_response};
use queue::{queue_changed_thread_id, queue_command, queue_rpc};

const MAX_REPLAY_ENTRIES: usize = 2_048;
const MAX_REPLAY_BYTES: u64 = 4 * 1024 * 1024;
const MAX_LIVE_SIGNALS: usize = 128;
const MAX_REPLAY_BATCH_ENTRIES: usize = 256;
const REPLAY_BATCH_DELAY: Duration = Duration::from_millis(16);
const MAX_COALESCED_TEXT_DELTA_BYTES: usize = MAX_INLINE_TEXT_BYTES;
const MAX_STREAM_DIAGNOSTIC_TURNS: usize = 4_096;
const MAX_RECENT_TURN_STARTS: usize = 4_096;
const MAX_CONCURRENT_SESSION_RPCS: usize = 32;
const SESSION_KEEPALIVE_INTERVAL: Duration = Duration::from_secs(5);
/// Delay before the one-time binding backfill starts, so it never competes
/// with clients reconnecting right after a companion restart.
const BINDING_BACKFILL_DELAY: Duration = Duration::from_secs(30);
/// Answer of a storage-backed method when no provider exposes the storage.
const STORAGE_UNAVAILABLE: &str = "Thread history storage is unavailable";
#[derive(Clone)]
pub struct SyncHub {
    port_inventory: Option<crate::port_inventory::PortInventory>,
    gateway: Arc<ClientWireGateway>,
    store: Arc<IndexStore>,
    thread_view: ThreadViewService,
    events: tokio::sync::broadcast::Sender<DurableSignal>,
    local_events: tokio::sync::mpsc::Sender<Value>,
    ordered_ingest: tokio::sync::mpsc::Sender<IngestInput>,
    server_requests: Arc<tokio::sync::Mutex<PendingServerRequests>>,
    live_channels: Arc<LiveChannelRegistry>,
    recent_turn_starts: Arc<tokio::sync::Mutex<RecentTurnStarts>>,
    mutation_mode: MutationMode,
    outbox_wakeup: Arc<tokio::sync::Notify>,
    content_projector: Arc<std::sync::RwLock<Option<Arc<ContentProjector>>>>,
    dictation: Arc<std::sync::RwLock<Option<Arc<DictationService>>>>,
    files: Arc<std::sync::RwLock<Option<Arc<FileService>>>>,
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

enum IngestInput {
    Payload(Value),
    /// A provider payload; `observe_resources` is false for providers
    /// without `history.threadResources`, whose threads have no stored
    /// history the resource owner could ever read or evict.
    ProviderPayload {
        payload: Value,
        observe_resources: bool,
    },
    Fence(tokio::sync::oneshot::Sender<Result<u64, ProviderError>>),
    ThreadPinImport(
        crate::thread_pins::ThreadPinImportRequest,
        tokio::sync::oneshot::Sender<Result<u64, String>>,
    ),
    ThreadPin(
        crate::thread_pins::ThreadPinRequest,
        tokio::sync::oneshot::Sender<Result<u64, String>>,
    ),
}

struct IngestContext {
    store: Arc<IndexStore>,
    events: tokio::sync::broadcast::Sender<DurableSignal>,
    server_requests: Arc<tokio::sync::Mutex<PendingServerRequests>>,
    content_projector: Arc<std::sync::RwLock<Option<Arc<ContentProjector>>>>,
    /// Owner of `history.threadResources`, resolved once at build.
    resources: Option<Arc<dyn NativeThreadResources>>,
    usage_projector: Arc<std::sync::Mutex<crate::usage::LiveUsageProjector>>,
}

struct InitialSession {
    port_inventory: bool,
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
    thread_store: Option<Arc<dyn NativeThreadStore>>,
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
                    let result = send_live_replay_after(
                        &socket,
                        store.clone(),
                        delivered_cursor,
                        thread_store.as_deref(),
                    )
                    .await;
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
                    send_live_replay_after(
                        &socket,
                        store.clone(),
                        delivered_cursor,
                        thread_store.as_deref(),
                    )
                    .await
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
    pub fn with_port_inventory(mut self, inventory: crate::port_inventory::PortInventory) -> Self {
        self.port_inventory = Some(inventory);
        self
    }
    /// Creates a companion over a provider registry. `mutations` enables
    /// authenticated RPC execution and durable command delivery; without it
    /// the hub is a passive event/replay shadow that never executes RPC.
    #[must_use]
    pub fn with_registry(
        registry: Arc<ProviderRegistry>,
        store: Arc<IndexStore>,
        mutations: bool,
    ) -> Self {
        let mode = if mutations {
            MutationMode::Active
        } else {
            MutationMode::ReadOnlyShadow
        };
        Self::build(registry, store, mode)
    }

    #[allow(clippy::too_many_lines)]
    fn build(
        registry: Arc<ProviderRegistry>,
        store: Arc<IndexStore>,
        mutation_mode: MutationMode,
    ) -> Self {
        let bindings = Arc::new(BindingStore::new(store.clone()));
        let gateway = Arc::new(ClientWireGateway::new(registry, bindings.clone()));
        let registry = gateway.registry().clone();
        let thread_view = ThreadViewService::new(gateway.clone());
        // The durable replay journal owns payload bytes. The live channel is
        // only a wake-up edge; tokio broadcast retains its full ring even
        // after every receiver has consumed an entry, so putting JSON Values
        // here would pin the last 2,048 events in RSS indefinitely.
        let (events, _) = tokio::sync::broadcast::channel(MAX_LIVE_SIGNALS);
        let (local_events, ingest_rx) = tokio::sync::mpsc::channel(MAX_REPLAY_ENTRIES);
        let (ordered_ingest, ordered_ingest_rx) = tokio::sync::mpsc::channel(MAX_REPLAY_ENTRIES);
        let server_requests = Arc::new(tokio::sync::Mutex::new(PendingServerRequests::default()));
        let live_channels = Arc::new(LiveChannelRegistry::default());
        let recent_turn_starts = Arc::new(tokio::sync::Mutex::new(RecentTurnStarts::default()));
        let outbox_wakeup = Arc::new(tokio::sync::Notify::new());
        let content_projector = Arc::new(std::sync::RwLock::new(None));
        let dictation = Arc::new(std::sync::RwLock::new(None));
        let files = Arc::new(std::sync::RwLock::new(None));
        let projects = Arc::new(std::sync::RwLock::new(None));
        let workspaces = Arc::new(std::sync::RwLock::new(None));
        let usage_projector = Arc::new(std::sync::Mutex::new(
            crate::usage::LiveUsageProjector::new(store.clone()),
        ));
        // One ordered forwarder per provider; each keeps its own fence order.
        for provider in registry.enabled() {
            tokio::spawn(forward_provider_events(
                provider.take_events(),
                EventProjector::new(gateway.wire(provider)),
                gateway.clone(),
                ordered_ingest.clone(),
                outbox_wakeup.clone(),
                live_channels.clone(),
            ));
            let owner = provider.descriptor().id;
            let request_gateway = gateway.clone();
            tokio::spawn(clear_user_requests_on_disconnect(
                provider.subscribe_status(),
                server_requests.clone(),
                local_events.clone(),
                Arc::new(move |id: &Value| {
                    request_gateway
                        .decode_request_id(id)
                        .is_some_and(|decoded| decoded.provider == owner)
                }),
            ));
        }
        tokio::spawn(forward_local_events(ingest_rx, ordered_ingest.clone()));
        // Changes written outside the companion (other App Server processes)
        // become semantic invalidations through the provider's own storage.
        for store in registry
            .enabled()
            .filter_map(|provider| provider.native_surface()?.thread_store())
        {
            store.spawn_change_monitor(local_events.clone());
        }
        let ingest_context = IngestContext {
            store: store.clone(),
            events: events.clone(),
            server_requests: server_requests.clone(),
            content_projector: content_projector.clone(),
            resources: registry
                .owner(Capability::HistoryThreadResources)
                .and_then(|provider| provider.native_surface()?.thread_resources()),
            usage_projector: usage_projector.clone(),
        };
        tokio::spawn(ingest_events(ordered_ingest_rx, ingest_context));
        if let Some(owner) = registry.owner(Capability::RequestsDynamicToolCall) {
            tokio::spawn(retry_oversized_dynamic_tool_rejections(
                owner.clone(),
                server_requests.clone(),
            ));
        }
        if mutation_mode == MutationMode::Active {
            for provider in registry.discovery_providers() {
                tokio::spawn(crate::agent::bindings::run_backfill(
                    bindings.clone(),
                    provider.clone(),
                    BINDING_BACKFILL_DELAY,
                ));
            }
            tokio::spawn(run_outbox_pump(
                PumpContext {
                    gateway: gateway.clone(),
                    store: store.clone(),
                    thread_view: thread_view.clone(),
                    local_events: local_events.clone(),
                    files: files.clone(),
                    workspaces: workspaces.clone(),
                },
                outbox_wakeup.clone(),
            ));
        }
        Self {
            port_inventory: None,
            gateway,
            store,
            thread_view,
            events,
            local_events,
            ordered_ingest,
            server_requests,
            live_channels,
            recent_turn_starts,
            mutation_mode,
            outbox_wakeup,
            content_projector,
            dictation,
            files,
            projects,
            workspaces,
        }
    }

    /// The provider registry this hub routes through.
    #[must_use]
    pub fn registry(&self) -> &Arc<ProviderRegistry> {
        self.gateway.registry()
    }

    /// Transport state of the primary provider, which the client sees as
    /// the companion status.
    #[must_use]
    pub fn upstream_status(&self) -> ProviderStatus {
        self.gateway.registry().primary().status()
    }

    /// Journals a provider-owned local event stream (for example account-pool
    /// changes) through the durable client channel; each event also wakes the
    /// outbox, which may be waiting for admission.
    pub fn forward_provider_local_events(&self, events: tokio::sync::broadcast::Receiver<Value>) {
        tokio::spawn(forward_provider_local_events(
            events,
            self.local_events.clone(),
            self.outbox_wakeup.clone(),
        ));
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

    fn files(&self) -> Option<Arc<FileService>> {
        match self.files.read() {
            Ok(slot) => slot.clone(),
            Err(poisoned) => poisoned.into_inner().clone(),
        }
    }

    /// Stored thread resources of the `history.threadResources` owner.
    fn thread_resources(&self) -> Option<Arc<dyn NativeThreadResources>> {
        self.registry()
            .owner(Capability::HistoryThreadResources)?
            .native_surface()?
            .thread_resources()
    }

    /// Stored threads of the `capability` owner.
    fn thread_store(&self, capability: Capability) -> Option<Arc<dyn NativeThreadStore>> {
        self.registry()
            .owner(capability)?
            .native_surface()?
            .thread_store()
    }

    /// Prepares one journaled event for replay through the thread store of the
    /// `codex.native` owner; without one the event is replayed unchanged.
    fn replay_event(
        thread_store: Option<&dyn NativeThreadStore>,
        payload: Value,
    ) -> Result<Value, String> {
        match thread_store {
            Some(thread_store) => thread_store.replay_event(payload),
            None => Ok(payload),
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
        let status = if self.upstream_status() == ProviderStatus::Live {
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
            let thread_store = self.thread_store(Capability::CodexNative);
            for (cursor, payload) in replay.entries {
                let Ok(payload) = serde_json::from_slice::<Value>(&payload)
                    .map_err(|_| ())
                    .and_then(|payload| {
                        Self::replay_event(thread_store.as_deref(), payload).map_err(|_| ())
                    })
                else {
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
            port_inventory: hello.get("portInventory").and_then(Value::as_bool) == Some(true),
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
        let mut port_inventory = if session.port_inventory {
            self.port_inventory
                .as_ref()
                .map(crate::port_inventory::PortInventory::subscribe)
        } else {
            None
        };
        let mut snapshot_started_at = session.snapshot_started_at;
        let mut upstream_status = self.gateway.registry().primary().subscribe_status();
        let rpc_permits = Arc::new(tokio::sync::Semaphore::new(MAX_CONCURRENT_SESSION_RPCS));
        let thread_mutation_lanes = ThreadMutationLanes::default();
        let (task_failed_tx, mut task_failed_rx) = tokio::sync::mpsc::unbounded_channel();
        let mut session_tasks = tokio::task::JoinSet::new();
        let mut replay_events = Some(events);
        let mut replay_task = None;
        let live_owner_id = hex::encode(rand::random::<[u8; 16]>());
        let (live_sender, mut live_receiver) =
            tokio::sync::mpsc::channel(GLOBAL_SUPERVISOR_LIMITS_V1.live_channel_max_envelopes);
        let (live_terminal_sender, mut live_terminal_receiver) =
            tokio::sync::mpsc::unbounded_channel();
        let mut live_channel_id: Option<String> = None;
        let mut keepalive = tokio::time::interval(SESSION_KEEPALIVE_INTERVAL);
        keepalive.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
        keepalive.tick().await;
        if session.ready {
            let Some(events) = replay_events.take() else {
                close_with(&socket, 1011, "replay_receiver_missing").await;
                return;
            };
            replay_task = Some(spawn_live_replay_task(
                self.thread_store(Capability::CodexNative),
                socket.clone(),
                self.store.clone(),
                events,
                session.delivered_cursor,
                task_failed_tx.clone(),
            ));
        }
        'session: loop {
            tokio::select! {
                _ = keepalive.tick() => {
                    if socket.send(Message::Ping(Vec::new().into())).await.is_err() { break; }
                }
                inventory = crate::port_inventory::next_inventory(&mut port_inventory) => {
                    if send_json(&socket, &json!({
                        "type": "portInventory", "revision": inventory.revision,
                        "inventory": {"ports": inventory.ports, "scannedAt": inventory.scanned_at}
                    })).await.is_err() { break; }
                }
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
                                    let thread_store = self.thread_store(Capability::CodexNative);
                                    for (cursor, payload) in replay.entries {
                                        let Ok(payload) = serde_json::from_slice::<Value>(&payload)
                    .map_err(|_| ())
                    .and_then(|payload| Self::replay_event(thread_store.as_deref(), payload).map_err(|_| ())) else {
                                            close_with(&socket, 1011, "replay_journal_failed").await;
                                            break 'session;
                                        };
                                        if send_json(
                                            &socket,
                                            &json!({ "type": "event", "cursor": cursor, "payload": payload }),
                                        )
                                        .await
                                        .is_err()
                                        {
                                            break 'session;
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
                            self.thread_store(Capability::CodexNative),
                                            socket.clone(),
                                            self.store.clone(),
                                            events,
                                            head,
                                            task_failed_tx.clone(),
                                        ));
                                    }
                                }
                                Some("ack") => {}
                                Some("liveSubscribe" | "liveUnsubscribe") => {
                                    match self.live_channels.handle_control(
                                        &live_owner_id,
                                        &mut live_channel_id,
                                        &message,
                                        &live_sender,
                                        &live_terminal_sender,
                                    ).await {
                                        LiveControlResult::Reply(reply) => {
                                            if send_json(&socket, &reply).await.is_err() { break; }
                                        }
                                        LiveControlResult::Invalid => {
                                            close_with(&socket, 1008, "invalid_live_control").await;
                                            break;
                                        }
                                    }
                                }
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
                    let status = if *upstream_status.borrow() == ProviderStatus::Live { "live" } else { "reconnecting" };
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
                Some(envelope) = live_receiver.recv() => {
                    if live_channel_id.as_deref() != Some(envelope.channel_id.as_str()) {
                        continue;
                    }
                    let closes_channel = envelope.value["payload"]["method"] == "thread/realtime/closed";
                    let startup_method = envelope
                        .value
                        .get("payload")
                        .and_then(realtime_startup_notification_method);
                    if send_json(&socket, &envelope.value).await.is_err() { break; }
                    if let Some(method) = startup_method {
                        info!(
                            channel_id = %envelope.channel_id,
                            method,
                            companion_delivery_ms = u64::try_from(envelope.received_at.elapsed().as_millis())
                                .unwrap_or(u64::MAX),
                            "global voice startup notification delivered to device"
                        );
                    }
                    self.live_channels
                        .acknowledge_delivery(&envelope.channel_id, envelope.encoded_bytes)
                        .await;
                    if closes_channel {
                        live_channel_id = None;
                    }
                }
                Some(terminal) = live_terminal_receiver.recv() => {
                    let channel_id = terminal.get("channelId").and_then(Value::as_str);
                    if channel_id != live_channel_id.as_deref() {
                        continue;
                    }
                    live_channel_id = None;
                    if send_json(&socket, &terminal).await.is_err() { break; }
                }
            }
        }
        if let Some(replay_task) = replay_task {
            replay_task.abort();
        }
        session_tasks.abort_all();
        self.live_channels.unsubscribe_owner(&live_owner_id).await;
    }

    async fn handle_server_response(
        &self,
        socket: &SessionSocket,
        response: Option<Value>,
    ) -> Result<(), ()> {
        let Some(mut response) = response else {
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
        let (request_class, request_method, request_thread_id) = {
            let mut pending = self.server_requests.lock().await;
            let Some(request) = pending.requests.get(&key) else {
                return send_json(
                    socket,
                    &json!({"type": "serverResponseRejected", "id": id, "reason": "already_resolved_or_unknown"}),
                )
                .await
                .map_err(|_| ());
            };
            let request_method = request
                .get("method")
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_owned();
            let request_thread_id = request
                .pointer("/params/threadId")
                .and_then(Value::as_str)
                .map(str::to_owned);
            let request_class = classify_pending_request_method(&request_method);
            if !pending.resolving.insert(key.clone()) {
                return send_json(
                    socket,
                    &json!({"type": "serverResponseRejected", "id": id, "reason": "already_resolving"}),
                )
                .await
                .map_err(|_| ());
            }
            (request_class, request_method, request_thread_id)
        };
        response = enforce_dynamic_tool_output_limit(response, request_class);
        let delivered = provider_rpc::deliver_server_response(
            &self.gateway,
            &request_method,
            request_thread_id.as_deref(),
            response,
        )
        .await;
        match delivered {
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
                    ProviderError::Backpressure(_) => "upstream_backpressure",
                    ProviderError::Reconnecting(_) | ProviderError::Disconnected(_) => {
                        "app_server_reconnecting"
                    }
                    ProviderError::Protocol(_) | ProviderError::Rejected(_) => {
                        "upstream_delivery_failed"
                    }
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
        if method.is_empty() {
            return send_rpc_error(socket, id, -32600, "Sync RPC requests require a method").await;
        }
        // A passive shadow must never execute requests: unknown future methods
        // cannot be classified as safe to read without recreating an allowlist.
        if self.mutation_mode != MutationMode::Active {
            return send_rpc_error(socket, id, -32010, "Passive companion does not execute RPC")
                .await;
        }
        if matches!(
            method.as_str(),
            "thread/read" | "thread/turns/list" | "thread/items/list"
        ) && let Some(thread_id) = params.get("threadId").and_then(Value::as_str)
            && let Some(resources) = self.thread_resources()
            && self
                .gateway
                .resolve_thread(thread_id, Some(Capability::HistoryThreadResources))
                .await
                .is_ok()
        {
            // Only threads whose provider declares `history.threadResources`
            // reach the resource owner's storage.
            resources.prewarm(thread_id);
        }
        if self
            .try_handle_local_service_rpc(socket, &id, &method, &params, authorization)
            .await?
        {
            return Ok(());
        }
        if matches!(
            method.as_str(),
            "companion/queue/steer"
                | "companion/queue/put"
                | "companion/queue/list"
                | "companion/queue/edit"
                | "companion/queue/cancel"
                | "companion/queue/retry"
                | "companion/queue/move"
        ) {
            return self.handle_queue_rpc(socket, id, &method, &params).await;
        }
        if self
            .try_handle_thread_read_rpc(socket, &id, &method, &params)
            .await?
        {
            return Ok(());
        }
        let target = match decode::route(&method, &params) {
            MethodRoute::ThreadStart => {
                return provider_rpc::handle_thread_start(self, socket, request.take(), id).await;
            }
            MethodRoute::Merged(merged) => {
                return provider_rpc::handle_merged(
                    self,
                    socket,
                    request.take(),
                    id,
                    &method,
                    merged,
                )
                .await;
            }
            MethodRoute::Host { owner } => {
                return provider_rpc::handle_host(self, socket, request.take(), id, &method, owner)
                    .await;
            }
            MethodRoute::Thread {
                thread_id,
                requires,
            } => match self.gateway.resolve_thread(&thread_id, requires).await {
                Ok(target) => target,
                Err(failure) => return send_rpc_failure(socket, id, &failure).await,
            },
        };
        if method == "turn/start" && self.recent_turn_starts.lock().await.seen_or_insert(&params) {
            match reconcile_direct_turn_start(&target, &params).await {
                Ok(Some(turn)) => {
                    return forward_rpc_response(
                        socket,
                        json!({"id": "turn-start-reconcile", "result": {"turn": turn}}),
                        id,
                        &method,
                        self.projector(),
                        self.observers(&target.wire),
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
        if target.native().is_none() {
            return provider_rpc::handle_neutral_thread_rpc(
                self,
                socket,
                &target,
                request.take(),
                id,
                &method,
            )
            .await;
        }
        provider_rpc::handle_native_thread_rpc(self, socket, &target, request.take(), id, &method)
            .await
    }

    fn observers(&self, wire: &crate::agent::client_wire::WireProvider) -> RpcResultObservers {
        RpcResultObservers {
            thread_store: self.thread_store(Capability::CodexNative),
            pins: self.store.clone(),
            resources: self.thread_resources(),
            projects: self.projects(),
            wire: wire.clone(),
        }
    }

    async fn handle_thread_pin_import_rpc(
        &self,
        socket: &SessionSocket,
        id: &Value,
        params: &Value,
    ) -> Result<(), ()> {
        let Some(request) = crate::thread_pins::ThreadPinImportRequest::parse(params) else {
            return send_rpc_error(socket, id.clone(), -32602, "Invalid thread pin import").await;
        };
        let (completion, committed) = tokio::sync::oneshot::channel();
        if self
            .ordered_ingest
            .send(IngestInput::ThreadPinImport(request, completion))
            .await
            .is_err()
        {
            return send_rpc_error(socket, id.clone(), -32020, "Thread pin writer unavailable")
                .await;
        }
        match committed.await {
            Ok(Ok(cursor)) => send_local_rpc_result(socket, id, json!({"cursor": cursor})).await,
            _ => send_rpc_error(socket, id.clone(), -32020, "Thread pin import failed").await,
        }
    }

    async fn handle_thread_pin_rpc(
        &self,
        socket: &SessionSocket,
        id: &Value,
        params: &Value,
    ) -> Result<(), ()> {
        let Some(request) = crate::thread_pins::ThreadPinRequest::parse(params) else {
            return send_rpc_error(socket, id.clone(), -32602, "Invalid thread pin request").await;
        };
        let thread_id = request.thread_id.clone();
        let pinned = request.pinned;
        let (completion, committed) = tokio::sync::oneshot::channel();
        if self
            .ordered_ingest
            .send(IngestInput::ThreadPin(request, completion))
            .await
            .is_err()
        {
            return send_rpc_error(socket, id.clone(), -32020, "Thread pin writer unavailable")
                .await;
        }
        match committed.await {
            Ok(Ok(cursor)) => {
                send_local_rpc_result(
                    socket,
                    id,
                    json!({"threadId": thread_id, "pinned": pinned, "pinCursor": cursor}),
                )
                .await
            }
            _ => send_rpc_error(socket, id.clone(), -32020, "Thread pin commit failed").await,
        }
    }

    async fn try_handle_local_service_rpc(
        &self,
        socket: &SessionSocket,
        id: &Value,
        method: &str,
        params: &Value,
        authorization: &AuthorizationContext,
    ) -> Result<bool, ()> {
        if method == "companion/thread/pins/import" {
            self.handle_thread_pin_import_rpc(socket, id, params)
                .await?;
            return Ok(true);
        }
        if method == "companion/thread/pin/set" {
            self.handle_thread_pin_rpc(socket, id, params).await?;
            return Ok(true);
        }
        if method == "companion/thread/pins/list" {
            match provider_rpc::thread_pin_snapshot(self).await {
                Ok(snapshot) => send_local_rpc_result(socket, id, snapshot).await?,
                _ => {
                    send_rpc_error(
                        socket,
                        id.clone(),
                        -32020,
                        "Thread pin snapshot unavailable",
                    )
                    .await?;
                }
            }
            return Ok(true);
        }
        if method == "companion/threadSubagents/read" {
            if let Err(failure) = self
                .gate_thread_capability(params, Capability::SubagentThreads)
                .await
            {
                send_rpc_failure(socket, id.clone(), &failure).await?;
                return Ok(true);
            }
            self.handle_thread_subagents_rpc(socket, id, params).await?;
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
        if let Some(resources) = self
            .thread_resources()
            .filter(|resources| resources.handles(method))
        {
            if let Err(failure) = self
                .gate_thread_capability(params, Capability::HistoryThreadResources)
                .await
            {
                send_rpc_failure(socket, id.clone(), &failure).await?;
                return Ok(true);
            }
            match resources.read(method, params).await {
                Ok(result) => send_local_rpc_result(socket, id, result).await?,
                Err(error) => send_rpc_error(socket, id.clone(), -32020, &error).await?,
            }
            return Ok(true);
        }
        if ProjectService::handles(method) {
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
        self.try_handle_accounts_rpc(socket, id, method, params)
            .await
    }

    /// Account methods go to the provider owning `accounts.pool`.
    async fn try_handle_accounts_rpc(
        &self,
        socket: &SessionSocket,
        id: &Value,
        method: &str,
        params: &Value,
    ) -> Result<bool, ()> {
        let Some((owner, _)) = self.gateway.owner(Capability::AccountsPool) else {
            return Ok(false);
        };
        let Some(native) = owner.native_surface() else {
            return Ok(false);
        };
        let Some(result) = native.handle_host_rpc(method, params).await else {
            return Ok(false);
        };
        match result {
            Ok(result) => send_local_rpc_result(socket, id, result).await?,
            Err(error) => send_rpc_error(socket, id.clone(), -32040, &error).await?,
        }
        Ok(true)
    }

    /// Thread-scoped companion services read the capability owner's stored
    /// history; a thread whose provider lacks the capability gets `-32072`
    /// without touching it.
    async fn gate_thread_capability(
        &self,
        params: &Value,
        capability: Capability,
    ) -> Result<(), RpcFailure> {
        let Some(thread_id) = params.get("threadId").and_then(Value::as_str) else {
            return Ok(());
        };
        match self
            .gateway
            .resolve_thread(thread_id, Some(capability))
            .await
        {
            Ok(_) => Ok(()),
            // Unknown threads keep the service's own not-found behavior.
            Err(failure) if failure.code == -32_600 => Ok(()),
            Err(failure) => Err(failure),
        }
    }

    async fn handle_thread_subagents_rpc(
        &self,
        socket: &SessionSocket,
        id: &Value,
        params: &Value,
    ) -> Result<(), ()> {
        let Some(store) = self.thread_store(Capability::SubagentThreads) else {
            return send_rpc_error(socket, id.clone(), -32020, STORAGE_UNAVAILABLE).await;
        };
        match store.subagent_descendants(params) {
            Ok(result) => send_local_rpc_result(socket, id, result).await,
            Err(error) => send_rpc_error(socket, id.clone(), -32020, &error).await,
        }
    }

    async fn handle_workspace_rpc(
        &self,
        socket: &SessionSocket,
        id: &Value,
        method: &str,
        params: &Value,
    ) -> Result<bool, ()> {
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
        if method.starts_with("companion/search")
            && let Err(failure) = self
                .gate_thread_capability(params, Capability::HistoryMessageSearch)
                .await
        {
            send_rpc_failure(socket, id.clone(), &failure).await?;
            return Ok(true);
        }
        if let Some(searched) = self.search(method, params).await {
            match searched {
                Ok(result) => {
                    self.send_projected_rpc_result(socket, id, method, result)
                        .await?;
                }
                Err(error) => send_rpc_error(socket, id.clone(), -32020, &error).await?,
            }
            return Ok(true);
        }
        if method == "companion/thread/sync" {
            match self.thread_view.sync(params).await {
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
        if let Some(handled) = self
            .try_handle_provider_history_rpc(socket, id, method, params)
            .await?
        {
            return Ok(handled);
        }
        // Native threads (and unknown ids) read the stored history of the
        // `codex.native` owner, as the pass-through wire always did.
        let store = self.thread_store(Capability::CodexNative);
        if matches!(
            method,
            "companion/thread/history/after" | "companion/thread/history/before"
        ) {
            let page = match &store {
                Some(store) => store.history_page(method, params).await,
                None => None,
            };
            match page {
                Some(Ok(result)) => {
                    self.send_projected_rpc_result(socket, id, method, result)
                        .await?;
                }
                Some(Err(HistoryPageError::Stale(message))) => {
                    send_rpc_error(socket, id.clone(), -32021, &message).await?;
                }
                Some(Err(HistoryPageError::Failed(message))) => {
                    send_rpc_error(socket, id.clone(), -32020, &message).await?;
                }
                None => {
                    send_rpc_error(socket, id.clone(), -32020, STORAGE_UNAVAILABLE).await?;
                }
            }
            return Ok(true);
        }
        let Some(store) = store else {
            return Ok(false);
        };
        let Some(result) = store.turns_page(method, params).await else {
            return Ok(false);
        };
        match result {
            Ok(result) => {
                self.send_projected_rpc_result(socket, id, method, result)
                    .await?;
            }
            Err(error) => send_rpc_error(socket, id.clone(), -32020, &error).await?,
        }
        Ok(true)
    }

    /// `companion/search*` through the `history.messageSearch` owner; `None`
    /// for methods it does not answer.
    async fn search(&self, method: &str, params: &Value) -> Option<Result<Value, String>> {
        let search = self
            .registry()
            .owner(Capability::HistoryMessageSearch)
            .and_then(|owner| owner.native_surface()?.message_search());
        match search {
            Some(search) => search.search(method, params).await,
            None if matches!(
                method,
                "companion/search" | "companion/search/context" | "companion/search/window"
            ) =>
            {
                Some(Err(STORAGE_UNAVAILABLE.to_owned()))
            }
            None => None,
        }
    }

    /// History reads of threads whose provider has no native stored history.
    /// `Some(handled)` decides the request; `None` continues locally.
    async fn try_handle_provider_history_rpc(
        &self,
        socket: &SessionSocket,
        id: &Value,
        method: &str,
        params: &Value,
    ) -> Result<Option<bool>, ()> {
        let routed = match params.get("threadId").and_then(Value::as_str) {
            Some(thread_id)
                if matches!(
                    method,
                    "companion/thread/history/after"
                        | "companion/thread/history/before"
                        | "thread/turns/list"
                ) =>
            {
                match self.gateway.resolve_thread(thread_id, None).await {
                    Ok(target) => Some(target),
                    Err(failure) if failure.code == -32_600 => None,
                    Err(failure) => {
                        send_rpc_failure(socket, id.clone(), &failure).await?;
                        return Ok(Some(true));
                    }
                }
            }
            _ => None,
        };
        if let Some(target) = routed.as_ref().filter(|target| target.native().is_none()) {
            if method == "thread/turns/list" {
                // Served by the provider through the routed RPC path.
                return Ok(Some(false));
            }
            let anchor = if method == "companion/thread/history/after" {
                Anchor::After
            } else {
                Anchor::Before
            };
            match provider_history::page(target, params, anchor).await {
                Ok(result) => {
                    self.send_projected_rpc_result(socket, id, method, result)
                        .await?;
                }
                Err(failure) => send_rpc_failure(socket, id.clone(), &failure).await?,
            }
            return Ok(Some(true));
        }
        Ok(None)
    }

    async fn send_projected_rpc_result(
        &self,
        socket: &SessionSocket,
        id: &Value,
        method: &str,
        mut result: Value,
    ) -> Result<(), ()> {
        if let Some(thread) = result.get_mut("thread")
            && let Some(thread_store) = self.thread_store(Capability::CodexNative)
        {
            // List exclusion controls discovery only. A direct thread route
            // reads the same bounded history as any other thread.
            thread_store.annotate_thread(thread);
        }
        if let Err(error) = crate::thread_pins::annotate_result(&self.store, method, &mut result) {
            warn!(err = ?error, "thread pin projection failed");
            return send_rpc_error(
                socket,
                id.clone(),
                -32020,
                "Thread pin projection unavailable",
            )
            .await;
        }
        if let Some(resources) = self.thread_resources() {
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
        let mut prepared =
            match prepare_remote_file_inputs("turn/steer", command.params.clone(), self.files())
                .await
            {
                Ok(prepared) => prepared,
                Err(error) => return send_rpc_error(socket, id, -32602, &error.to_string()).await,
            };
        let operation_id = legacy_steer_operation_id(&id, &command.command_id, expected_turn_id);
        let claim_store = Arc::clone(&self.store);
        let claim_command_id = command.command_id.clone();
        let claim = tokio::task::spawn_blocking(move || {
            claim_store.outbox_claim_steer(&claim_command_id, &operation_id)
        })
        .await;
        let (claimed, claim_token) = match claim {
            Ok(Ok(OutboxClaimOutcome::Acquired { command, token })) => (command, token),
            Ok(Ok(OutboxClaimOutcome::Duplicate(_) | OutboxClaimOutcome::Unavailable(_))) => {
                return send_rpc_error(
                    socket,
                    id,
                    -32010,
                    "queued command is already dispatching or no longer exists",
                )
                .await;
            }
            Ok(Err(error)) => {
                return send_rpc_error(socket, id, -32010, &error.to_string()).await;
            }
            Err(error) => return send_rpc_error(socket, id, -32020, &error.to_string()).await,
        };
        emit_queue_changed(&self.store, &self.local_events, &claimed.remote_thread_id).await;
        if claimed.params != command.params {
            prepared = match prepare_remote_file_inputs(
                "turn/steer",
                claimed.params.clone(),
                self.files(),
            )
            .await
            {
                Ok(prepared) => prepared,
                Err(error) => {
                    resolve_outbox_claim(
                        &self.store,
                        &self.local_events,
                        &claimed.remote_thread_id,
                        &claimed.command_id,
                        claim_token,
                        OwnedClaimResolution::Rejected(error.to_string()),
                    )
                    .await;
                    return send_rpc_error(socket, id, -32602, &error.to_string()).await;
                }
            };
        }
        let steer = json!({
            "id": "outbox-steer",
            "method": "turn/steer",
            "params": {
                "threadId": claimed.remote_thread_id.as_str(),
                "clientUserMessageId": claimed.command_id.as_str(),
                "input": prepared.get("input").cloned().unwrap_or_else(|| json!([])),
                "expectedTurnId": expected_turn_id,
            }
        });
        let response = match self.send_claimed_steer(&claimed, claim_token, steer).await {
            Ok(response) => response,
            Err(error) => {
                return send_rpc_error(socket, id, -32042, &error.to_string()).await;
            }
        };
        send_passthrough_rpc_response(socket, id, &response).await
    }

    async fn send_claimed_steer(
        &self,
        claimed: &OutboxCommand,
        claim_token: u64,
        request: Value,
    ) -> Result<Value, ProviderError> {
        let response = match provider_rpc::send_steer(&self.gateway, request).await {
            Ok(response) => response,
            Err(error) => {
                resolve_outbox_claim(
                    &self.store,
                    &self.local_events,
                    &claimed.remote_thread_id,
                    &claimed.command_id,
                    claim_token,
                    OwnedClaimResolution::Indeterminate {
                        error: error.to_string(),
                        retry_after_ms: retry_delay_ms(claimed.attempts),
                    },
                )
                .await;
                return Err(error);
            }
        };
        let resolution = response
            .get("error")
            .map_or(OwnedClaimResolution::Delivered, |_| {
                OwnedClaimResolution::Rejected(rpc_error_message(&response))
            });
        resolve_outbox_claim(
            &self.store,
            &self.local_events,
            &claimed.remote_thread_id,
            &claimed.command_id,
            claim_token,
            resolution,
        )
        .await;
        Ok(response)
    }
}

fn legacy_steer_operation_id(id: &Value, command_id: &str, expected_turn_id: &str) -> String {
    let identity = format!("{id}\0{command_id}\0{expected_turn_id}");
    format!("legacy:{}", blake3::hash(identity.as_bytes()).to_hex())
}

async fn send_passthrough_rpc_response(
    socket: &SessionSocket,
    id: Value,
    upstream_response: &Value,
) -> Result<(), ()> {
    let response = upstream_response.as_object().map_or_else(
        || json!({"id": id.clone(), "error": {"message": "invalid App Server response"}}),
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

async fn send_live_replay_after(
    socket: &SessionSocket,
    store: Arc<IndexStore>,
    cursor: u64,
    thread_store: Option<&dyn NativeThreadStore>,
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
        let payload =
            SyncHub::replay_event(thread_store, payload).map_err(|_| LiveReplayError::Journal)?;
        send_json(
            socket,
            &json!({ "type": "event", "cursor": event_cursor, "payload": payload }),
        )
        .await
        .map_err(|_| LiveReplayError::Socket)?;
    }
    Ok(replay.head_cursor)
}

/// One provider's ordered forwarder: observes thread bindings, projects
/// neutral events onto the client wire, routes realtime traffic to live
/// channels, wakes the outbox on `turn/completed`, and keeps fences in order.
async fn forward_provider_events(
    mut provider_events: tokio::sync::mpsc::Receiver<ProviderEvent>,
    mut projector: EventProjector,
    gateway: Arc<ClientWireGateway>,
    ingest: tokio::sync::mpsc::Sender<IngestInput>,
    outbox_wakeup: Arc<tokio::sync::Notify>,
    live_channels: Arc<LiveChannelRegistry>,
) {
    let provider_id: ProviderId = projector.provider_id().clone();
    let observe_resources = gateway
        .registry()
        .get(&provider_id)
        .is_some_and(|provider| {
            provider
                .capabilities()
                .supports(Capability::HistoryThreadResources)
        });
    while let Some(event) = provider_events.recv().await {
        match event {
            ProviderEvent::Event(event) => {
                if let Some(thread_id) = event.app_thread_id() {
                    let known = gateway
                        .bindings()
                        .provider_of(thread_id)
                        .await
                        .is_ok_and(|bound| bound.is_some());
                    if !known {
                        gateway
                            .observe_threads(&provider_id, &[thread_id.to_string()])
                            .await;
                    }
                }
                for payload in projector.project(*event) {
                    if is_realtime_notification(&payload) {
                        live_channels.route(payload).await;
                        continue;
                    }
                    if payload.get("method").and_then(Value::as_str) == Some("turn/completed") {
                        outbox_wakeup.notify_one();
                    }
                    let input = IngestInput::ProviderPayload {
                        payload,
                        observe_resources,
                    };
                    if ingest.send(input).await.is_err() {
                        return;
                    }
                }
            }
            ProviderEvent::Fence(fence) => {
                if let Err(error) = ingest.send(IngestInput::Fence(fence)).await {
                    if let IngestInput::Fence(fence) = error.0 {
                        let _ = fence.send(Err(ProviderError::Disconnected(
                            "replay ingest stopped".into(),
                        )));
                    }
                    return;
                }
            }
        }
    }
}

async fn forward_local_events(
    mut local: tokio::sync::mpsc::Receiver<Value>,
    ingest: tokio::sync::mpsc::Sender<IngestInput>,
) {
    while let Some(payload) = local.recv().await {
        if ingest.send(IngestInput::Payload(payload)).await.is_err() {
            break;
        }
    }
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

async fn forward_provider_local_events(
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
                warn!(skipped, "provider local event forwarder lagged");
            }
            Err(tokio::sync::broadcast::error::RecvError::Closed) => break,
        }
    }
}

fn complete_pin_commit(
    context: &IngestContext,
    completion: tokio::sync::oneshot::Sender<Result<u64, String>>,
    result: Result<Result<u64, crate::store::StoreError>, tokio::task::JoinError>,
) -> Result<(), ()> {
    match result {
        Ok(Ok(cursor)) => {
            let _ = context.events.send(DurableSignal::Committed(cursor));
            let _ = completion.send(Ok(cursor));
            Ok(())
        }
        error => {
            warn!(err = ?error, "durable thread pin commit failed");
            let _ = completion.send(Err("Thread pin storage unavailable".into()));
            let _ = context.events.send(DurableSignal::Failed);
            Err(())
        }
    }
}

async fn process_ingest_control(context: &IngestContext, control: IngestInput) -> Result<(), ()> {
    match control {
        IngestInput::Fence(fence) => {
            resolve_replay_fence(&context.store, fence).await;
            Ok(())
        }
        IngestInput::ThreadPinImport(request, completion) => {
            let store = context.store.clone();
            let result = tokio::task::spawn_blocking(move || {
                store.import_thread_pins(&request, MAX_REPLAY_ENTRIES, MAX_REPLAY_BYTES)
            })
            .await;
            complete_pin_commit(context, completion, result)
        }
        IngestInput::ThreadPin(request, completion) => {
            let store = context.store.clone();
            let result = tokio::task::spawn_blocking(move || {
                store.commit_thread_pin(&request, MAX_REPLAY_ENTRIES, MAX_REPLAY_BYTES)
            })
            .await;
            complete_pin_commit(context, completion, result)
        }
        IngestInput::Payload(_) | IngestInput::ProviderPayload { .. } => Err(()),
    }
}

async fn ingest_events(
    mut ingest: tokio::sync::mpsc::Receiver<IngestInput>,
    context: IngestContext,
) {
    let mut stream_diagnostics = AgentStreamDiagnostics::default();
    while let Some(first) = ingest.recv().await {
        let first = match first {
            IngestInput::Payload(payload) => (payload, true),
            IngestInput::ProviderPayload {
                payload,
                observe_resources,
            } => (payload, observe_resources),
            control => {
                if process_ingest_control(&context, control).await.is_err() {
                    break;
                }
                continue;
            }
        };
        let mut payloads = vec![first];
        let mut control = None;
        let deadline = tokio::time::Instant::now() + REPLAY_BATCH_DELAY;
        while payloads.len() < MAX_REPLAY_BATCH_ENTRIES {
            let remaining = deadline.saturating_duration_since(tokio::time::Instant::now());
            if remaining.is_zero() {
                break;
            }
            match tokio::time::timeout(remaining, ingest.recv()).await {
                Ok(Some(IngestInput::Payload(payload))) => payloads.push((payload, true)),
                Ok(Some(IngestInput::ProviderPayload {
                    payload,
                    observe_resources,
                })) => payloads.push((payload, observe_resources)),
                Ok(Some(command)) => {
                    control = Some(command);
                    break;
                }
                Ok(None) | Err(_) => break,
            }
        }
        if ingest_payload_batch(&context, &mut stream_diagnostics, payloads)
            .await
            .is_err()
        {
            break;
        }
        if let Some(control) = control
            && process_ingest_control(&context, control).await.is_err()
        {
            break;
        }
    }
}

async fn ingest_payload_batch(
    context: &IngestContext,
    stream_diagnostics: &mut AgentStreamDiagnostics,
    batch: Vec<(Value, bool)>,
) -> Result<(), ()> {
    let mut without_resources = HashSet::new();
    let mut payloads = Vec::with_capacity(batch.len());
    for (payload, observe_resources) in batch {
        if !observe_resources && let Some(thread_id) = payload_thread_id(&payload) {
            without_resources.insert(thread_id.to_owned());
        }
        payloads.push(payload);
    }
    payloads = reject_oversized_dynamic_tool_requests(&context.server_requests, payloads)
        .await
        .map_err(|()| {
            warn!("pending oversized dynamic tool rejection limits exceeded");
            let _ = context.events.send(DurableSignal::Failed);
        })?;
    if payloads.is_empty() {
        return Ok(());
    }
    if observe_server_requests(&context.server_requests, &payloads)
        .await
        .is_err()
    {
        warn!("pending App Server request limits exceeded");
        let _ = context.events.send(DurableSignal::Failed);
        return Err(());
    }
    observe_batch(context, &payloads, &without_resources).await;
    let projector = match context.content_projector.read() {
        Ok(slot) => slot.clone(),
        Err(poisoned) => poisoned.into_inner().clone(),
    };
    // Coalesce bytes before externalizing them. Merging empty projected
    // deltas can otherwise discard a repeated content reference.
    stream_diagnostics.observe_input_batch(&payloads);
    payloads = coalesce_stream_text_deltas(payloads);
    let mut projected_payloads = Vec::with_capacity(payloads.len());
    for payload in payloads {
        let (usage, replay_pricing) = {
            let mut projector = match context.usage_projector.lock() {
                Ok(projector) => projector,
                Err(poisoned) => poisoned.into_inner(),
            };
            let usage = projector.observe(&payload);
            let replay_pricing = projector.replay_pricing(&payload);
            (usage, replay_pricing)
        };
        let Ok(usage) = usage else {
            warn!("usage projection persistence failed");
            let _ = context.events.send(DurableSignal::Failed);
            return Err(());
        };
        let metrics =
            crate::activity_metrics_live::observe(&context.store, &payload, usage.as_ref())
                .map_err(|_| {
                    let _ = context.events.send(DurableSignal::Failed);
                })?;
        let payload = match &projector {
            Some(projector) => projector.project_notification(payload),
            None => payload,
        };
        let projected = crate::activity_metrics_live::attach(
            crate::thread_patch::attach_thread_patch_with_usage(payload, usage),
            metrics,
        );
        projected_payloads.push(crate::usage::prepare_replay_payload(
            projected,
            replay_pricing,
        ));
    }
    payloads = projected_payloads;
    stream_diagnostics.observe_emitted_batch(&payloads);
    let Ok(encoded) = payloads
        .iter()
        .map(serde_json::to_vec)
        .collect::<Result<Vec<Vec<u8>>, _>>()
    else {
        warn!("replay payload serialization failed");
        let _ = context.events.send(DurableSignal::Failed);
        return Err(());
    };
    let durable_store = context.store.clone();
    let committed = tokio::task::spawn_blocking(move || {
        durable_store.append_replay_batch(&encoded, MAX_REPLAY_ENTRIES, MAX_REPLAY_BYTES)
    })
    .await;
    let Ok(Ok(cursors)) = committed else {
        warn!("durable replay journal failed");
        let _ = context.events.send(DurableSignal::Failed);
        return Err(());
    };
    stream_diagnostics.finish_completed_turns(&payloads);
    if let Some(cursor) = cursors.last().copied() {
        let _ = context.events.send(DurableSignal::Committed(cursor));
    }
    Ok(())
}

/// Index observers that run before projection: live subagent metadata and
/// the stored resource overlay (skipped for threads whose provider lacks
/// `history.threadResources`).
async fn observe_batch(
    context: &IngestContext,
    payloads: &[Value],
    without_resources: &HashSet<String>,
) {
    for payload in payloads {
        if let Err(error) = observe_subagent_metadata(&context.store, payload) {
            warn!(%error, "live subagent metadata index update failed");
        }
    }
    if let Some(resources) = &context.resources {
        for payload in payloads {
            if payload_thread_id(payload).is_some_and(|id| without_resources.contains(id)) {
                continue;
            }
            resources.observe_event(payload).await;
        }
    }
}

fn payload_thread_id(payload: &Value) -> Option<&str> {
    let params = payload.get("params")?;
    params
        .get("threadId")
        .and_then(Value::as_str)
        .or_else(|| params.pointer("/thread/id").and_then(Value::as_str))
}

async fn resolve_replay_fence(
    store: &Arc<IndexStore>,
    fence: tokio::sync::oneshot::Sender<Result<u64, ProviderError>>,
) {
    let durable_store = store.clone();
    let cursor = tokio::task::spawn_blocking(move || durable_store.replay_head()).await;
    let result = match cursor {
        Ok(Ok(cursor)) => Ok(cursor),
        Ok(Err(error)) => Err(ProviderError::Protocol(error.to_string())),
        Err(error) => Err(ProviderError::Protocol(error.to_string())),
    };
    let _ = fence.send(result);
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
    for payload in payloads.into_iter().flat_map(split_stream_text_delta) {
        if let Some(previous) = coalesced.last_mut()
            && merge_adjacent_stream_text_delta(previous, &payload)
        {
            continue;
        }
        coalesced.push(payload);
    }
    coalesced
}

fn split_stream_text_delta(payload: Value) -> Vec<Value> {
    let Some(delta) = payload
        .get("params")
        .and_then(Value::as_object)
        .and_then(|params| params.get("delta"))
        .and_then(Value::as_str)
        .filter(|delta| delta.len() > MAX_COALESCED_TEXT_DELTA_BYTES)
    else {
        return vec![payload];
    };
    if !payload
        .get("method")
        .and_then(Value::as_str)
        .is_some_and(is_coalescible_text_delta_method)
    {
        return vec![payload];
    }

    let mut chunks = Vec::with_capacity(delta.len().div_ceil(MAX_COALESCED_TEXT_DELTA_BYTES));
    let mut start = 0;
    while start < delta.len() {
        let mut end = start
            .saturating_add(MAX_COALESCED_TEXT_DELTA_BYTES)
            .min(delta.len());
        while end > start && !delta.is_char_boundary(end) {
            end -= 1;
        }
        let mut chunk = payload.clone();
        if let Some(value) = chunk
            .get_mut("params")
            .and_then(Value::as_object_mut)
            .and_then(|params| params.get_mut("delta"))
        {
            *value = Value::String(delta[start..end].to_owned());
        }
        chunks.push(chunk);
        start = end;
    }
    chunks
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
            | "item/commandExecution/outputDelta"
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

// Scheduling and diagnostic hints only: unknown methods are forwarded too,
// but conservatively share the ordered lane when they target a thread.
fn rpc_is_known_read(method: &str) -> bool {
    matches!(
        method,
        "account/rateLimits/read"
            | "companion/search"
            | "companion/search/context"
            | "companion/search/window"
            | "companion/project/home"
            | "companion/thread/sync"
            | "companion/thread/pins/list"
            | "companion/thread/history/after"
            | "companion/thread/history/before"
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
            | "companion/supervisor/threadList"
            | "thread/loaded/list"
            | "thread/read"
            | "thread/search"
            | "thread/searchOccurrences"
            | "thread/turns/list"
            | "threadSection/list"
    )
}

fn rpc_requires_ordered_lane(method: &str) -> bool {
    // Observer attachment does not mutate persisted thread data, but it
    // still has to precede a turn/start for the same thread:
    // otherwise the first live deltas can be emitted before Companion has
    // subscribed to that thread.
    method == "companion/thread/sync"
        || (!rpc_is_known_read(method)
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

async fn send_rpc_failure(
    socket: &SessionSocket,
    id: Value,
    failure: &RpcFailure,
) -> Result<(), ()> {
    send_json(
        socket,
        &json!({ "type": "rpc", "response": { "id": id, "error": failure.to_json() } }),
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

    use super::*;
    use crate::store::OutboxPresentation;

    #[tokio::test]
    async fn durable_fence_resolves_after_every_preceding_payload_is_committed()
    -> Result<(), Box<dyn std::error::Error>> {
        let directory = tempfile::tempdir()?;
        let store = Arc::new(IndexStore::open(directory.path().join("fence.redb"))?);
        let (ingest, receiver) = tokio::sync::mpsc::channel(4);
        let (signals, _) = tokio::sync::broadcast::channel(4);
        let (fence, resolved) = tokio::sync::oneshot::channel();
        let context = IngestContext {
            store: store.clone(),
            events: signals,
            server_requests: Arc::new(tokio::sync::Mutex::new(PendingServerRequests::default())),
            content_projector: Arc::new(std::sync::RwLock::new(None)),
            resources: None,
            usage_projector: Arc::new(std::sync::Mutex::new(
                crate::usage::LiveUsageProjector::new(store.clone()),
            )),
        };
        let task = tokio::spawn(ingest_events(receiver, context));
        ingest
            .send(IngestInput::Payload(json!({
                "method": "item/agentMessage/delta",
                "params": {
                    "threadId": "thread",
                    "turnId": "turn",
                    "itemId": "agent",
                    "delta": "tail"
                }
            })))
            .await?;
        ingest.send(IngestInput::Fence(fence)).await?;

        assert_eq!(resolved.await??, 1);
        assert_eq!(store.replay_head()?, 1);
        drop(ingest);
        task.await?;
        Ok(())
    }

    #[test]
    fn scheduling_distinguishes_known_reads_from_possible_writes() {
        assert!(rpc_is_known_read("thread/list"));
        assert!(rpc_is_known_read("companion/threadSubagents/read"));
        assert!(rpc_is_known_read("fs/readDirectory"));
        assert!(rpc_is_known_read("config/read"));
        assert!(!rpc_is_known_read("turn/start"));
        assert!(!rpc_is_known_read("thread/delete"));
    }

    #[test]
    fn project_browser_home_does_not_require_the_ordered_lane() {
        let method = "companion/project/home";
        assert!(ProjectService::handles(method));
        assert!(rpc_is_known_read(method));
        assert!(!rpc_requires_ordered_lane(method));
        assert!(rpc_requires_ordered_lane("companion/project/unknown"));
        assert!(rpc_requires_ordered_lane("future/unknown"));
        assert!(!rpc_is_known_read("companion/project/add"));
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
            cli_version: "0.155.1".into(),
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
                "method": "companion/thread/sync",
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
    fn queue_failure_preserves_the_bounded_app_server_error() {
        let detailed = "observer rejected operation: invalid cwd `/srv/project` (code E_CWD_17)";
        assert_eq!(
            rpc_error_message(&json!({"error": {"code": -32001, "message": detailed}})),
            detailed
        );

        let structured = json!({"code": -32002, "data": {"reason": "device lease lost"}});
        assert_eq!(
            rpc_error_message(&json!({"error": structured.clone()})),
            structured.to_string()
        );

        let long = "x".repeat(600);
        assert_eq!(
            rpc_error_message(&json!({"error": {"message": long}})),
            "x".repeat(500)
        );
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
    fn splits_large_unicode_stream_deltas_before_content_projection() {
        let source = "🦀".repeat(MAX_INLINE_TEXT_BYTES);
        let payloads = coalesce_stream_text_deltas(vec![json!({
            "method": "item/agentMessage/delta",
            "params": {
                "threadId": "thread",
                "turnId": "turn",
                "itemId": "message",
                "delta": source,
            },
        })]);

        assert!(payloads.len() > 1);
        assert!(payloads.iter().all(|payload| {
            payload["params"]["delta"]
                .as_str()
                .is_some_and(|delta| delta.len() <= MAX_INLINE_TEXT_BYTES)
        }));
        assert_eq!(
            payloads
                .iter()
                .filter_map(|payload| payload["params"]["delta"].as_str())
                .collect::<String>(),
            source,
        );
    }

    #[test]
    fn coalesces_repeated_command_output_before_private_content_projection() {
        let delta = |item_id: &str| {
            json!({
                "method": "item/commandExecution/outputDelta",
                "params": {"threadId": "thread", "turnId": "turn", "itemId": item_id, "delta": "same\n"}
            })
        };
        let result = coalesce_stream_text_deltas(vec![delta("one"), delta("one"), delta("two")]);
        assert_eq!(result.len(), 2);
        assert_eq!(result[0]["params"]["delta"], "same\nsame\n");
        assert_eq!(result[1]["params"]["delta"], "same\n");
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
}
