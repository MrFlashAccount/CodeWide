use std::{
    collections::{HashMap, HashSet, VecDeque},
    sync::Arc,
    time::{Duration, Instant},
};

use axum::extract::ws::{Message, WebSocket};
use futures_util::SinkExt;
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
    remote_inputs::{RemoteInputError, prepare_remote_file_inputs},
    resources::ResourceService,
    store::{IndexStore, OutboxCommand, OutboxPresentation, OutboxState},
    thread_view::ThreadViewService,
    upstream::{ConnectionStatus, UpstreamError, UpstreamHandle},
};

const MAX_REPLAY_ENTRIES: usize = 2_048;
const MAX_REPLAY_BYTES: u64 = 4 * 1024 * 1024;
const MAX_REPLAY_BATCH_ENTRIES: usize = 256;
const REPLAY_BATCH_DELAY: Duration = Duration::from_millis(16);
const MAX_PENDING_SERVER_REQUESTS: usize = 1_024;
const MAX_PENDING_SERVER_REQUEST_BYTES: usize = 4 * 1024 * 1024;
const MAX_SINGLE_SERVER_REQUEST_BYTES: usize = 1024 * 1024;
const MAX_RECENT_TURN_STARTS: usize = 4_096;
const OUTBOX_POLL_INTERVAL: Duration = Duration::from_millis(500);
const OUTBOX_RETRY_BASE_MS: u64 = 1_000;
const OUTBOX_RETRY_MAX_MS: u64 = 30_000;
const OUTBOX_ACCOUNT_SWITCH_WAIT_MS: u64 = 1_000;
const OUTBOX_RECONCILE_PAGE_SIZE: u64 = 32;
const OUTBOX_RECONCILE_MAX_PAGES: usize = 128;
const ROLLOUT_UPSTREAM_SUPPRESSION: Duration = Duration::from_secs(2);
const ROLLOUT_RECONCILIATION_POLL: Duration = Duration::from_millis(50);
const MAX_RECENT_UPSTREAM_THREADS: usize = 4_096;
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
    events: tokio::sync::broadcast::Sender<DurableEvent>,
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
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum MutationMode {
    ReadOnlyShadow,
    Active,
}

#[derive(Clone)]
enum DurableEvent {
    Entry(u64, Value),
    Failed,
}

struct InitialSession {
    ready: bool,
    snapshot_cursor: Option<u64>,
}

enum AuthorizationChangeOutcome {
    Continue,
    Disable,
    Close,
}

enum OutboxReconcileError {
    Retry(String),
    Fatal(String),
}

enum OutboxDeliveryError {
    Deferred(String),
    Uncertain(String),
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
        let (events, _) = tokio::sync::broadcast::channel(MAX_REPLAY_ENTRIES);
        let (local_events, ingest_rx) = tokio::sync::mpsc::channel(MAX_REPLAY_ENTRIES);
        let server_requests = Arc::new(tokio::sync::Mutex::new(PendingServerRequests::default()));
        let recent_turn_starts = Arc::new(tokio::sync::Mutex::new(RecentTurnStarts::default()));
        let outbox_wakeup = Arc::new(tokio::sync::Notify::new());
        let content_projector = Arc::new(std::sync::RwLock::new(None));
        let dictation = Arc::new(std::sync::RwLock::new(None));
        let files = Arc::new(std::sync::RwLock::new(None));
        let resources = Arc::new(std::sync::RwLock::new(None));
        let account_pool = Arc::new(std::sync::RwLock::new(None));
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
                outbox_wakeup.clone(),
                local_events.clone(),
                files.clone(),
                account_pool.clone(),
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

    /// Installs the host-owned dictation RPC service. It stays local and never
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

    pub async fn serve(
        self,
        mut socket: WebSocket,
        authorization: AuthorizationContext,
        authorization_changes: Option<tokio::sync::broadcast::Receiver<AuthorizationChange>>,
    ) {
        // Subscribe before reading the replay head. Events committed between
        // replay selection and the live loop remain buffered and are safely
        // de-duplicated by the cursor-aware client projection.
        let events = self.events.subscribe();
        let Some(session) = self.accept_hello(&mut socket).await else {
            return;
        };
        self.run_session(
            socket,
            session,
            events,
            authorization,
            authorization_changes,
        )
        .await;
    }

    async fn accept_hello(&self, socket: &mut WebSocket) -> Option<InitialSession> {
        let Some(Ok(Message::Text(raw))) = socket.recv().await else {
            let _ = socket.close().await;
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
        }

        Some(InitialSession {
            ready,
            snapshot_cursor: snapshot_required.then_some(head),
        })
    }

    #[allow(clippy::too_many_lines)]
    async fn run_session(
        &self,
        mut socket: WebSocket,
        session: InitialSession,
        mut events: tokio::sync::broadcast::Receiver<DurableEvent>,
        authorization: AuthorizationContext,
        mut authorization_changes: Option<tokio::sync::broadcast::Receiver<AuthorizationChange>>,
    ) {
        let mut ready = session.ready;
        let mut snapshot_cursor = session.snapshot_cursor;
        let mut upstream_status = self.upstream.subscribe_status();
        loop {
            tokio::select! {
                message = socket.recv() => {
                    let Some(Ok(message)) = message else { break; };
                    match message {
                        Message::Text(raw) => {
                            let Ok(message) = serde_json::from_str::<Value>(&raw) else {
                                close_with(&mut socket, 1007, "invalid_json_object").await;
                                break;
                            };
                            match message.get("type").and_then(Value::as_str) {
                                Some("ping") => {
                                    let mut pong = Map::from_iter([("type".into(), Value::String("pong".into()))]);
                                    if let Some(nonce) = message.get("nonce") { pong.insert("nonce".into(), nonce.clone()); }
                                    if send_json(&mut socket, &Value::Object(pong)).await.is_err() { break; }
                                }
                                Some("snapshotApplied") => {
                                    let Some(applied_cursor) = message.get("cursor").and_then(Value::as_u64) else {
                                        close_with(&mut socket, 1008, "invalid_snapshot_cursor").await;
                                        break;
                                    };
                                    if snapshot_cursor != Some(applied_cursor) {
                                        close_with(&mut socket, 1008, "unexpected_snapshot_cursor").await;
                                        break;
                                    }
                                    let store = self.store.clone();
                                    let Ok(Ok(replay)) = tokio::task::spawn_blocking(move || store.replay_after(Some(applied_cursor))).await else {
                                        close_with(&mut socket, 1011, "replay_journal_failed").await;
                                        break;
                                    };
                                    let head = replay.head_cursor;
                                    let snapshot_required = replay.snapshot_required;
                                    let pending_requests = self
                                        .server_requests
                                        .lock()
                                        .await
                                        .requests
                                        .values()
                                        .cloned()
                                        .collect::<Vec<_>>();
                                    if send_json(
                                        &mut socket,
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
                                        ready = false;
                                        snapshot_cursor = Some(head);
                                        continue;
                                    }
                                    for (cursor, payload) in replay.entries {
                                        let Ok(payload) = serde_json::from_slice::<Value>(&payload) else {
                                            close_with(&mut socket, 1011, "replay_journal_failed").await;
                                            return;
                                        };
                                        if send_json(
                                            &mut socket,
                                            &json!({ "type": "event", "cursor": cursor, "payload": payload }),
                                        )
                                        .await
                                        .is_err()
                                        {
                                            return;
                                        }
                                    }
                                    if send_json(&mut socket, &json!({ "type": "caughtUp", "cursor": head })).await.is_err() { break; }
                                    snapshot_cursor = None;
                                    ready = true;
                                }
                                Some("ack") => {}
                                Some("rpc") => {
                                    if self.handle_rpc(&mut socket, message.get("request").cloned(), &authorization).await.is_err() { break; }
                                }
                                Some("serverResponse") => {
                                    if !authorization_has_scope(&authorization, "approvals.respond") {
                                        close_with(&mut socket, 1008, "scope_required").await;
                                        break;
                                    }
                                    if self.handle_server_response(&mut socket, message.get("response").cloned()).await.is_err() { break; }
                                }
                                Some("hello") => {
                                    close_with(&mut socket, 1008, "duplicate_hello").await;
                                    break;
                                }
                                _ => {
                                    close_with(&mut socket, 1008, "unknown_sync_message").await;
                                    break;
                                }
                            }
                        }
                        Message::Close(_) => break,
                        Message::Binary(_) => {
                            close_with(&mut socket, 1003, "text_frames_only").await;
                            break;
                        }
                        Message::Ping(payload) => {
                            if socket.send(Message::Pong(payload)).await.is_err() { break; }
                        }
                        Message::Pong(_) => {}
                    }
                }
                event = events.recv(), if ready => {
                    match event {
                        Ok(DurableEvent::Entry(cursor, payload)) => {
                            if ready && send_json(&mut socket, &json!({ "type": "event", "cursor": cursor, "payload": payload })).await.is_err() { break; }
                        }
                        Ok(DurableEvent::Failed) => {
                            let _ = send_json(&mut socket, &json!({ "type": "status", "status": "degraded" })).await;
                            break;
                        }
                        Err(tokio::sync::broadcast::error::RecvError::Lagged(skipped)) => {
                            warn!(skipped, "sync client lagged behind upstream broadcast");
                            let _ = send_json(&mut socket, &json!({ "type": "status", "status": "degraded" })).await;
                            break;
                        }
                        Err(tokio::sync::broadcast::error::RecvError::Closed) => break,
                    }
                }
                changed = upstream_status.changed() => {
                    if changed.is_err() { break; }
                    let status = if *upstream_status.borrow() == ConnectionStatus::Live { "live" } else { "reconnecting" };
                    if send_json(&mut socket, &json!({ "type": "status", "status": status })).await.is_err() { break; }
                }
                change = receive_authorization_change(&mut authorization_changes), if authorization_changes.is_some() => {
                    match handle_authorization_change(&mut socket, &authorization, change).await {
                        AuthorizationChangeOutcome::Close => break,
                        AuthorizationChangeOutcome::Disable => authorization_changes = None,
                        AuthorizationChangeOutcome::Continue => {}
                    }
                }
            }
        }
    }

    async fn handle_server_response(
        &self,
        socket: &mut WebSocket,
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
        socket: &mut WebSocket,
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
                return send_rpc_error(socket, id, -32010, "Rust shadow is read-only").await;
            }
            return self.handle_queue_rpc(socket, id, &method, &params).await;
        }
        if !is_read_only_method(&method) && self.mutation_mode != MutationMode::Active {
            return send_rpc_error(socket, id, -32010, "Rust shadow is read-only").await;
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
                        self.resources(),
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
        if method == "turn/start"
            && let Some(account_pool) = self.account_pool()
        {
            return match account_pool.send_turn_start(request.take()).await {
                Ok(response) => {
                    forward_rpc_response(
                        socket,
                        response,
                        id,
                        &method,
                        self.projector(),
                        &self.history,
                        self.resources(),
                    )
                    .await
                }
                Err(error) => send_rpc_error(socket, id, -32040, &error.to_string()).await,
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
            self.resources(),
        )
        .await
    }

    async fn try_handle_local_service_rpc(
        &self,
        socket: &mut WebSocket,
        id: &Value,
        method: &str,
        params: &Value,
        authorization: &AuthorizationContext,
    ) -> Result<bool, ()> {
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
        if !AccountPoolService::handles(method) {
            return Ok(false);
        }
        if self.mutation_mode != MutationMode::Active && method != "companion/accountPool/list" {
            send_rpc_error(socket, id.clone(), -32010, "Rust shadow is read-only").await?;
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

    async fn try_handle_thread_read_rpc(
        &self,
        socket: &mut WebSocket,
        id: &Value,
        method: &str,
        params: &Value,
    ) -> Result<bool, ()> {
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
        socket: &mut WebSocket,
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
        socket: &mut WebSocket,
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
        socket: &mut WebSocket,
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
) {
    forward_rollout_changes_with_suppression(
        &mut changes,
        history,
        ingest,
        recent_upstream_threads,
        ROLLOUT_UPSTREAM_SUPPRESSION,
    )
    .await;
}

async fn forward_rollout_changes_with_suppression(
    changes: &mut tokio::sync::mpsc::Receiver<crate::rollout_monitor::RolloutChange>,
    history: HistoryService,
    ingest: tokio::sync::mpsc::Sender<Value>,
    recent_upstream_threads: Arc<std::sync::Mutex<HashMap<String, Instant>>>,
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
    socket: &mut WebSocket,
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
    events: tokio::sync::broadcast::Sender<DurableEvent>,
    server_requests: Arc<tokio::sync::Mutex<PendingServerRequests>>,
    content_projector: Arc<std::sync::RwLock<Option<Arc<ContentProjector>>>>,
    resources: Arc<std::sync::RwLock<Option<Arc<ResourceService>>>>,
    usage_projector: Arc<std::sync::Mutex<crate::usage::LiveUsageProjector>>,
) {
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
            let _ = events.send(DurableEvent::Failed);
            break;
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
        let mut projected_payloads = Vec::with_capacity(payloads.len());
        for payload in payloads {
            let usage = match usage_projector.lock() {
                Ok(mut projector) => projector.observe(&payload),
                Err(poisoned) => poisoned.into_inner().observe(&payload),
            };
            let Ok(usage) = usage else {
                warn!("usage projection persistence failed");
                let _ = events.send(DurableEvent::Failed);
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
            let _ = events.send(DurableEvent::Failed);
            break;
        };
        let durable_store = store.clone();
        let committed = tokio::task::spawn_blocking(move || {
            durable_store.append_replay_batch(&encoded, MAX_REPLAY_ENTRIES, MAX_REPLAY_BYTES)
        })
        .await;
        let Ok(Ok(cursors)) = committed else {
            warn!("durable replay journal failed");
            let _ = events.send(DurableEvent::Failed);
            break;
        };
        for (cursor, payload) in cursors.into_iter().zip(payloads) {
            let _ = events.send(DurableEvent::Entry(cursor, payload));
        }
    }
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

#[allow(clippy::too_many_arguments)]
async fn forward_rpc(
    upstream: &UpstreamHandle,
    socket: &mut WebSocket,
    request: Value,
    id: Value,
    method: &str,
    projector: Option<Arc<ContentProjector>>,
    history: &HistoryService,
    resources: Option<Arc<ResourceService>>,
) -> Result<(), ()> {
    let result = upstream.request(request).await;
    match result {
        Ok(response) => {
            forward_rpc_response(socket, response, id, method, projector, history, resources).await
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
    socket: &mut WebSocket,
    mut response: Value,
    id: Value,
    method: &str,
    projector: Option<Arc<ContentProjector>>,
    history: &HistoryService,
    resources: Option<Arc<ResourceService>>,
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
    if let (Some(resources), Some(result)) = (resources, response.get("result")) {
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
            Ok(json!({"data": store.outbox_list(thread_id)?}))
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
    let presentation = match command.get("presentation").and_then(Value::as_str) {
        None | Some("queue") => OutboxPresentation::Queue,
        Some("delivery") => OutboxPresentation::Delivery,
        Some(_) => {
            return Err(crate::store::StoreError::CorruptedIndex(
                "queue presentation must be queue or delivery".into(),
            ));
        }
    };
    serde_json::to_value(store.outbox_put_turn_start_with_presentation(
        command_id,
        thread_id,
        rpc_params,
        created_at,
        presentation,
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

async fn run_outbox_pump(
    upstream: UpstreamHandle,
    store: Arc<IndexStore>,
    wakeup: Arc<tokio::sync::Notify>,
    local_events: tokio::sync::mpsc::Sender<Value>,
    files: Arc<std::sync::RwLock<Option<Arc<FileService>>>>,
    account_pool: Arc<std::sync::RwLock<Option<Arc<AccountPoolService>>>>,
) {
    let mut status = upstream.subscribe_status();
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
                            &local_events,
                            &files,
                            &account_pool,
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

#[allow(clippy::too_many_lines)]
async fn reconcile_outbox_command(
    upstream: &UpstreamHandle,
    store: &Arc<IndexStore>,
    local_events: &tokio::sync::mpsc::Sender<Value>,
    files: &Arc<std::sync::RwLock<Option<Arc<FileService>>>>,
    account_pool: &Arc<std::sync::RwLock<Option<Arc<AccountPoolService>>>>,
    command: OutboxCommand,
) {
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
    let turns = match read_outbox_turns(upstream, &command).await {
        Ok(turns) => turns,
        Err(OutboxReconcileError::Retry(error)) => {
            defer_outbox(
                store,
                local_events,
                &command.remote_thread_id,
                &command.command_id,
                command.state,
                &error,
                retry_delay_ms(command.attempts),
            )
            .await;
            return;
        }
        Err(OutboxReconcileError::Fatal(error)) => {
            set_outbox_state(
                store,
                local_events,
                &command.remote_thread_id,
                &command.command_id,
                OutboxState::Failed,
                Some(&error),
            )
            .await;
            return;
        }
    };
    if turns_contain_client_message(&turns, &command.command_id) {
        set_outbox_state(
            store,
            local_events,
            &command.remote_thread_id,
            &command.command_id,
            OutboxState::Delivered,
            None,
        )
        .await;
        return;
    }
    if turns.iter().any(turn_is_active) {
        return;
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

async fn read_outbox_turns(
    upstream: &UpstreamHandle,
    command: &OutboxCommand,
) -> Result<Vec<Value>, OutboxReconcileError> {
    let mut cursor = Value::Null;
    let mut turns = Vec::new();
    for page_index in 0..OUTBOX_RECONCILE_MAX_PAGES {
        let read = json!({
            "id": "outbox-reconcile",
            "method": "thread/turns/list",
            "params": {
                "threadId": command.remote_thread_id,
                "cursor": cursor,
                "limit": OUTBOX_RECONCILE_PAGE_SIZE,
                "sortDirection": "desc",
                "itemsView": "summary"
            }
        });
        let response = upstream
            .request(read)
            .await
            .map_err(|error| OutboxReconcileError::Retry(error.to_string()))?;
        if response.get("error").is_some() {
            // `thread/start` creates an authoritative empty shell before the
            // first user turn creates a rollout. App Server deliberately
            // rejects history reads in that state. For a queued command this
            // is proof of empty history, not a transient read failure;
            // retrying the read would deadlock the first message forever.
            if command.state == OutboxState::Queued
                && is_unmaterialized_empty_thread_error(&response)
            {
                return Ok(Vec::new());
            }
            return Err(OutboxReconcileError::Retry(rpc_error_message(&response)));
        }
        let result = response.get("result").ok_or_else(|| {
            OutboxReconcileError::Fatal("thread/turns/list returned no result".into())
        })?;
        let page = result
            .get("data")
            .and_then(Value::as_array)
            .ok_or_else(|| {
                OutboxReconcileError::Fatal("thread/turns/list returned no turns page".into())
            })?;
        turns.extend(page.iter().cloned());

        // A never-attempted command cannot already exist upstream. Its first
        // page is enough to enforce the active-turn gate without scanning a
        // long thread. An uncertain command must prove absence across the
        // complete history before another turn/start is allowed.
        if command.state == OutboxState::Queued
            || turns_contain_client_message(&turns, &command.command_id)
        {
            return Ok(turns);
        }
        let next_cursor = result.get("nextCursor").cloned().unwrap_or(Value::Null);
        if next_cursor.is_null() {
            return Ok(turns);
        }
        cursor = next_cursor;
        if page_index + 1 == OUTBOX_RECONCILE_MAX_PAGES {
            return Err(OutboxReconcileError::Retry(
                "turn reconciliation exceeded its safe scan bound".into(),
            ));
        }
    }
    unreachable!("reconciliation loop returns at its configured bound")
}

fn is_unmaterialized_empty_thread_error(response: &Value) -> bool {
    let message = response
        .get("error")
        .and_then(|error| error.get("message"))
        .and_then(Value::as_str)
        .unwrap_or_default();
    message.contains("not materialized yet") && message.contains("before first user message")
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
    let delivered = if let Some(account_pool) = account_pool {
        account_pool.send_turn_start(start).await.map_err(|error| {
            if let AccountPoolError::Deferred(reason) = error {
                OutboxDeliveryError::Deferred(reason)
            } else {
                OutboxDeliveryError::Uncertain(error.to_string())
            }
        })
    } else {
        upstream
            .request(start)
            .await
            .map_err(|error| OutboxDeliveryError::Uncertain(error.to_string()))
    };
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
            debug!(command_id = %command.command_id, %reason, "turn/start waited for an account switch before upstream delivery");
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

fn turn_is_active(turn: &Value) -> bool {
    turn.get("status").and_then(Value::as_str) == Some("inProgress")
        || turn
            .get("status")
            .and_then(Value::as_object)
            .and_then(|status| status.get("type"))
            .and_then(Value::as_str)
            .is_some_and(|status| matches!(status, "active" | "inProgress"))
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
        "companion/accountPool/list" | "companion/accountPool/refresh"
    ) {
        return Some("threads.read");
    }
    if method.starts_with("companion/accountPool/") {
        return Some("threads.write");
    }
    if matches!(
        method,
        "companion/threadResources/read" | "companion/threadChange/read"
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
    socket: &mut WebSocket,
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

async fn send_json(socket: &mut WebSocket, value: &Value) -> Result<(), axum::Error> {
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
    socket: &mut WebSocket,
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

async fn close_with(socket: &mut WebSocket, code: u16, reason: &str) {
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
    fn shadow_refuses_mutations() {
        assert!(is_read_only_method("thread/list"));
        assert!(!is_read_only_method("turn/start"));
        assert!(!is_read_only_method("thread/delete"));
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

        let history = HistoryService::new(Arc::new(crate::catalog::SessionCatalog::scan(
            directory.path(),
        )));
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

    #[test]
    fn recognizes_only_the_empty_new_thread_history_error() {
        assert!(is_unmaterialized_empty_thread_error(&json!({
            "error": {
                "code": -32600,
                "message": "thread new is not materialized yet; thread/turns/list is unavailable before first user message"
            }
        })));
        assert!(!is_unmaterialized_empty_thread_error(&json!({
            "error": {"code": -32600, "message": "thread rollout was not found"}
        })));
        assert!(!is_unmaterialized_empty_thread_error(&json!({
            "result": {"data": []}
        })));
    }
}
