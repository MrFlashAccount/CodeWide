use std::{
    collections::HashMap,
    path::{Path, PathBuf},
    sync::{
        Arc,
        atomic::{AtomicU64, Ordering},
    },
    time::Duration,
};

use futures_util::{SinkExt, StreamExt};
use serde_json::{Value, json};
use tokio::{
    io::{AsyncBufReadExt, AsyncWriteExt, BufReader},
    net::UnixStream,
    process::{Child, ChildStdin, ChildStdout},
    sync::{broadcast, mpsc, oneshot, watch},
    time::sleep,
};
use tokio_tungstenite::{
    client_async_with_config,
    tungstenite::{Message, protocol::WebSocketConfig},
};
use tracing::{info, warn};

use axum::extract::ws::{CloseFrame, Message as AxumMessage, WebSocket as AxumWebSocket};

const INITIALIZE_ID: &str = "codewide-companion-initialize";
const REQUEST_QUEUE_CAPACITY: usize = 256;
const EVENT_CHANNEL_CAPACITY: usize = 2_048;
const APP_SERVER_MAX_FRAME_BYTES: usize = 64 * 1024 * 1024;
const APP_SERVER_MAX_MESSAGE_BYTES: usize = 64 * 1024 * 1024;
const LARGE_APP_SERVER_FRAME_BYTES: usize = 1024 * 1024;
const LARGE_STRING_FIELD_BYTES: usize = 256 * 1024;
type AppServerSocket = tokio_tungstenite::WebSocketStream<UnixStream>;

pub type RawAppServerSocket = tokio_tungstenite::WebSocketStream<UnixStream>;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ConnectionStatus {
    Reconnecting,
    Live,
}

/// Opens an uninitialized App Server WebSocket for the admin-only raw bridge.
/// The downstream client owns the initialize handshake exactly as it does in
/// the companion protocol boundary.
///
/// # Errors
///
/// Returns a protocol error when the Unix socket or WebSocket handshake fails.
pub async fn connect_raw_app_server(
    socket_path: &PathBuf,
) -> Result<RawAppServerSocket, UpstreamError> {
    let stream = UnixStream::connect(socket_path)
        .await
        .map_err(|error| UpstreamError::Protocol(error.to_string()))?;
    client_async_with_config(
        "ws://localhost/",
        stream,
        Some(app_server_websocket_config(APP_SERVER_MAX_MESSAGE_BYTES)),
    )
    .await
    .map(|(socket, _response)| socket)
    .map_err(|error| UpstreamError::Protocol(error.to_string()))
}

/// Pumps text JSON frames between an authenticated admin client and its own
/// App Server connection. Binary frames are rejected on both sides.
pub async fn bridge_raw_app_server(
    mut downstream: AxumWebSocket,
    mut upstream: RawAppServerSocket,
) {
    loop {
        tokio::select! {
            phone = downstream.recv() => {
                match phone {
                    Some(Ok(AxumMessage::Text(text))) => {
                        if upstream.send(Message::Text(text.to_string().into())).await.is_err() { break; }
                    }
                    Some(Ok(AxumMessage::Close(_)) | Err(_)) | None => break,
                    Some(Ok(AxumMessage::Ping(bytes))) => {
                        if upstream.send(Message::Ping(bytes)).await.is_err() { break; }
                    }
                    Some(Ok(AxumMessage::Pong(bytes))) => {
                        if upstream.send(Message::Pong(bytes)).await.is_err() { break; }
                    }
                    Some(Ok(AxumMessage::Binary(_))) => {
                        let _ = downstream.send(AxumMessage::Close(Some(CloseFrame {
                            code: 1003,
                            reason: "text_frames_required".into(),
                        }))).await;
                        break;
                    }
                }
            }
            host = upstream.next() => {
                match host {
                    Some(Ok(Message::Text(text))) => {
                        if downstream.send(AxumMessage::Text(text.to_string().into())).await.is_err() { break; }
                    }
                    Some(Ok(Message::Close(_)) | Err(_)) | None => break,
                    Some(Ok(Message::Ping(bytes))) => {
                        if downstream.send(AxumMessage::Ping(bytes)).await.is_err() { break; }
                    }
                    Some(Ok(Message::Pong(bytes))) => {
                        if downstream.send(AxumMessage::Pong(bytes)).await.is_err() { break; }
                    }
                    Some(Ok(Message::Binary(_) | Message::Frame(_))) => {
                        let _ = downstream.send(AxumMessage::Close(Some(CloseFrame {
                            code: 1003,
                            reason: "upstream_text_frames_required".into(),
                        }))).await;
                        break;
                    }
                }
            }
        }
    }
    let _ = downstream.close().await;
    let _ = upstream.close(None).await;
}

#[derive(Clone)]
pub struct UpstreamHandle {
    commands: mpsc::Sender<UpstreamCommand>,
    events: broadcast::Sender<Value>,
    ordered_events: Arc<std::sync::Mutex<Option<mpsc::Sender<OrderedUpstreamEvent>>>>,
    status: watch::Receiver<ConnectionStatus>,
    version: watch::Receiver<Option<String>>,
    generation: Arc<AtomicU64>,
}

struct UpstreamRequest {
    request: Value,
    response: oneshot::Sender<Result<Value, UpstreamError>>,
    fence: Option<oneshot::Sender<Result<u64, UpstreamError>>>,
}

struct PendingUpstreamRequest {
    response: oneshot::Sender<Result<Value, UpstreamError>>,
    fence: Option<oneshot::Sender<Result<u64, UpstreamError>>>,
}

pub(crate) enum OrderedUpstreamEvent {
    Notification(Value),
    Fence(oneshot::Sender<Result<u64, UpstreamError>>),
}

pub(crate) struct UpstreamFence {
    receiver: oneshot::Receiver<Result<u64, UpstreamError>>,
}

impl UpstreamFence {
    pub(crate) async fn wait(self) -> Result<u64, UpstreamError> {
        self.receiver
            .await
            .map_err(|_| UpstreamError::Disconnected)?
    }
}

struct UpstreamResponse {
    response: Value,
    delivered: oneshot::Sender<Result<(), UpstreamError>>,
}

#[derive(Clone)]
struct ConnectionStateWriter {
    status: watch::Sender<ConnectionStatus>,
    version: watch::Sender<Option<String>>,
    generation: Arc<AtomicU64>,
}

enum UpstreamCommand {
    Request(UpstreamRequest),
    ServerResponse(UpstreamResponse),
}

#[derive(Debug, thiserror::Error)]
pub enum UpstreamError {
    #[error("App Server is reconnecting")]
    Reconnecting,
    #[error("App Server request queue is full")]
    Backpressure,
    #[error("App Server disconnected")]
    Disconnected,
    #[error("App Server protocol error: {0}")]
    Protocol(String),
}

impl UpstreamHandle {
    #[must_use]
    pub fn spawn(socket_path: PathBuf) -> Self {
        Self::spawn_with_message_limit(socket_path, APP_SERVER_MAX_MESSAGE_BYTES)
    }

    #[must_use]
    pub fn spawn_with_message_limit(socket_path: PathBuf, max_message_bytes: usize) -> Self {
        let (commands, command_rx) = mpsc::channel(REQUEST_QUEUE_CAPACITY);
        let (events, _) = broadcast::channel(EVENT_CHANNEL_CAPACITY);
        let ordered_events = Arc::new(std::sync::Mutex::new(None));
        let (status_tx, status) = watch::channel(ConnectionStatus::Reconnecting);
        let (version_tx, version) = watch::channel(None);
        let generation = Arc::new(AtomicU64::new(0));
        let handle = Self {
            commands,
            events: events.clone(),
            ordered_events: ordered_events.clone(),
            status,
            version,
            generation: generation.clone(),
        };
        let connection_state = ConnectionStateWriter {
            status: status_tx,
            version: version_tx,
            generation,
        };
        tokio::spawn(run(
            socket_path,
            command_rx,
            events,
            ordered_events,
            connection_state,
            max_message_bytes,
        ));
        handle
    }

    /// Attaches the normal request/event coordinator to a private App Server
    /// child over JSONL stdio. Closing the companion closes the pipe, so the
    /// enrollment-only child cannot outlive its parent as an orphan daemon.
    ///
    /// # Errors
    ///
    /// Returns a protocol error when the child was not spawned with piped
    /// stdin and stdout.
    pub fn spawn_stdio(child: &mut Child) -> Result<Self, UpstreamError> {
        let stdin = child
            .stdin
            .take()
            .ok_or_else(|| UpstreamError::Protocol("App Server stdin is not piped".into()))?;
        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| UpstreamError::Protocol("App Server stdout is not piped".into()))?;
        let (commands, command_rx) = mpsc::channel(REQUEST_QUEUE_CAPACITY);
        let (events, _) = broadcast::channel(EVENT_CHANNEL_CAPACITY);
        let ordered_events = Arc::new(std::sync::Mutex::new(None));
        let (status_tx, status) = watch::channel(ConnectionStatus::Reconnecting);
        let (version_tx, version) = watch::channel(None);
        let generation = Arc::new(AtomicU64::new(0));
        let handle = Self {
            commands,
            events: events.clone(),
            ordered_events: ordered_events.clone(),
            status,
            version,
            generation: generation.clone(),
        };
        let connection_state = ConnectionStateWriter {
            status: status_tx,
            version: version_tx,
            generation,
        };
        tokio::spawn(run_stdio(
            stdin,
            stdout,
            command_rx,
            events,
            ordered_events,
            connection_state,
        ));
        Ok(handle)
    }

    #[must_use]
    pub fn status(&self) -> ConnectionStatus {
        *self.status.borrow()
    }

    #[must_use]
    pub fn version(&self) -> Option<String> {
        self.version.borrow().clone()
    }

    /// Monotonically increases after each successful App Server connection.
    #[must_use]
    pub fn generation(&self) -> u64 {
        self.generation.load(Ordering::Acquire)
    }

    #[must_use]
    pub fn subscribe_status(&self) -> watch::Receiver<ConnectionStatus> {
        self.status.clone()
    }

    #[must_use]
    pub fn subscribe_events(&self) -> broadcast::Receiver<Value> {
        self.events.subscribe()
    }

    /// Installs the single lossless event stream used to fence durable replay.
    pub(crate) fn take_ordered_events(&self) -> mpsc::Receiver<OrderedUpstreamEvent> {
        let (sender, receiver) = mpsc::channel(EVENT_CHANNEL_CAPACITY);
        let mut slot = match self.ordered_events.lock() {
            Ok(slot) => slot,
            Err(poisoned) => poisoned.into_inner(),
        };
        assert!(
            slot.is_none(),
            "ordered App Server event stream already attached"
        );
        *slot = Some(sender);
        receiver
    }

    /// Forwards one JSON-RPC request through the connected App Server stream.
    ///
    /// # Errors
    ///
    /// Returns an explicit reconnect, backpressure, disconnect, or protocol
    /// error without buffering an unbounded request backlog.
    pub async fn request(&self, request: Value) -> Result<Value, UpstreamError> {
        self.request_with_fence(request, None).await
    }

    /// Sends a request whose response position can be resolved to the exact
    /// durable replay cursor after every preceding notification is committed.
    pub(crate) async fn request_fenced(
        &self,
        request: Value,
    ) -> Result<(Value, UpstreamFence), UpstreamError> {
        let (fence, receiver) = oneshot::channel();
        let response = self.request_with_fence(request, Some(fence)).await?;
        Ok((response, UpstreamFence { receiver }))
    }

    async fn request_with_fence(
        &self,
        request: Value,
        fence: Option<oneshot::Sender<Result<u64, UpstreamError>>>,
    ) -> Result<Value, UpstreamError> {
        if self.status() != ConnectionStatus::Live {
            return Err(UpstreamError::Reconnecting);
        }
        let (response, receiver) = oneshot::channel();
        self.commands
            .try_send(UpstreamCommand::Request(UpstreamRequest {
                request,
                response,
                fence,
            }))
            .map_err(|error| match error {
                mpsc::error::TrySendError::Full(_) => UpstreamError::Backpressure,
                // The bounded queue rejected this request before the transport
                // task could observe or write it. Preserve that proven
                // not-accepted outcome instead of reporting ambiguous loss.
                mpsc::error::TrySendError::Closed(_) => UpstreamError::Reconnecting,
            })?;
        receiver.await.map_err(|_| UpstreamError::Disconnected)?
    }

    /// Delivers one response to an App Server initiated request without
    /// rewriting its id.
    ///
    /// # Errors
    ///
    /// Returns before accepting the response when the App Server is not live
    /// or the bounded transport queue cannot accept it.
    pub async fn respond(&self, response: Value) -> Result<(), UpstreamError> {
        if self.status() != ConnectionStatus::Live {
            return Err(UpstreamError::Reconnecting);
        }
        let (delivered, receiver) = oneshot::channel();
        self.commands
            .try_send(UpstreamCommand::ServerResponse(UpstreamResponse {
                response,
                delivered,
            }))
            .map_err(|error| match error {
                mpsc::error::TrySendError::Full(_) => UpstreamError::Backpressure,
                // A closed sender is a pre-admission rejection. The caller can
                // safely distinguish it from a disconnect after queueing.
                mpsc::error::TrySendError::Closed(_) => UpstreamError::Reconnecting,
            })?;
        receiver.await.map_err(|_| UpstreamError::Disconnected)?
    }
}

async fn run(
    socket_path: PathBuf,
    mut commands: mpsc::Receiver<UpstreamCommand>,
    events: broadcast::Sender<Value>,
    ordered_events: Arc<std::sync::Mutex<Option<mpsc::Sender<OrderedUpstreamEvent>>>>,
    connection_state: ConnectionStateWriter,
    max_message_bytes: usize,
) {
    let mut attempt = 0_u32;
    loop {
        let _ = connection_state.status.send(ConnectionStatus::Reconnecting);
        match run_connection(
            &socket_path,
            &mut commands,
            &events,
            &ordered_events,
            &connection_state,
            max_message_bytes,
        )
        .await
        {
            Ok(()) => {
                attempt = 0;
                warn!("App Server WebSocket closed");
            }
            Err(error) => {
                attempt = attempt.saturating_add(1);
                warn!(%error, "App Server connection failed");
            }
        }
        while let Ok(command) = commands.try_recv() {
            reject_command(command, UpstreamError::Disconnected);
        }
        let exponent = attempt.min(7);
        let delay = Duration::from_millis((250_u64 * 2_u64.pow(exponent)).min(30_000));
        sleep(delay).await;
    }
}

async fn run_stdio(
    mut stdin: ChildStdin,
    stdout: ChildStdout,
    mut commands: mpsc::Receiver<UpstreamCommand>,
    events: broadcast::Sender<Value>,
    ordered_events: Arc<std::sync::Mutex<Option<mpsc::Sender<OrderedUpstreamEvent>>>>,
    connection_state: ConnectionStateWriter,
) {
    let mut lines = BufReader::new(stdout).lines();
    let result = run_stdio_connection(
        &mut stdin,
        &mut lines,
        &mut commands,
        &events,
        &ordered_events,
        &connection_state,
    )
    .await;
    let _ = connection_state.status.send(ConnectionStatus::Reconnecting);
    if let Err(error) = result {
        warn!(%error, "private App Server stdio connection failed");
    }
    while let Ok(command) = commands.try_recv() {
        reject_command(command, UpstreamError::Disconnected);
    }
}

#[allow(clippy::too_many_lines)]
async fn run_stdio_connection(
    stdin: &mut ChildStdin,
    lines: &mut tokio::io::Lines<BufReader<ChildStdout>>,
    commands: &mut mpsc::Receiver<UpstreamCommand>,
    events: &broadcast::Sender<Value>,
    ordered_events: &Arc<std::sync::Mutex<Option<mpsc::Sender<OrderedUpstreamEvent>>>>,
    connection_state: &ConnectionStateWriter,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    write_json_line(
        stdin,
        &json!({
            "id": INITIALIZE_ID,
            "method": "initialize",
            "params": {
                "clientInfo": {
                    "name": "codewide_account_enrollment",
                    "title": "CodeWide Account Enrollment",
                    "version": env!("CARGO_PKG_VERSION")
                },
                "capabilities": { "experimentalApi": true }
            }
        }),
    )
    .await?;
    let initialized = loop {
        let Some(line) = lines.next_line().await? else {
            return Err(UpstreamError::Disconnected.into());
        };
        let value: Value = serde_json::from_str(&line)?;
        if value.get("id").and_then(Value::as_str) == Some(INITIALIZE_ID) {
            break value;
        }
        if value.get("method").and_then(Value::as_str).is_some() {
            publish_notification(events, ordered_events, value).await;
        }
    };
    if initialized.get("error").is_some() {
        return Err(UpstreamError::Protocol(initialized.to_string()).into());
    }
    write_json_line(stdin, &json!({"method": "initialized"})).await?;
    let _ = connection_state
        .version
        .send(app_server_version(&initialized));
    connection_state.generation.fetch_add(1, Ordering::AcqRel);
    let _ = connection_state.status.send(ConnectionStatus::Live);
    info!("Connected to private Codex App Server over stdio");

    let mut counter = 0_u64;
    let mut pending: HashMap<String, PendingUpstreamRequest> = HashMap::new();
    let mut pending_cleanup = tokio::time::interval(Duration::from_secs(1));
    loop {
        tokio::select! {
            _ = pending_cleanup.tick() => {
                pending.retain(|_, request| !request.response.is_closed());
            }
            outbound = commands.recv() => {
                let Some(outbound) = outbound else { break; };
                match outbound {
                    UpstreamCommand::Request(mut outbound) => {
                        if outbound.response.is_closed() {
                            continue;
                        }
                        counter = counter.wrapping_add(1);
                        let upstream_id = format!("codewide-stdio:{counter}");
                        let Some(object) = outbound.request.as_object_mut() else {
                            let _ = outbound.response.send(Err(UpstreamError::Protocol("request is not an object".into())));
                            continue;
                        };
                        object.insert("id".into(), Value::String(upstream_id.clone()));
                        if write_json_line(stdin, &outbound.request).await.is_err() {
                            let _ = outbound.response.send(Err(UpstreamError::Disconnected));
                            break;
                        }
                        pending.insert(upstream_id, PendingUpstreamRequest {
                            response: outbound.response,
                            fence: outbound.fence,
                        });
                    }
                    UpstreamCommand::ServerResponse(outbound) => {
                        let valid = outbound.response.get("id").is_some()
                            && (outbound.response.get("result").is_some() || outbound.response.get("error").is_some())
                            && outbound.response.get("method").is_none();
                        if !valid {
                            let _ = outbound.delivered.send(Err(UpstreamError::Protocol("invalid server response".into())));
                            continue;
                        }
                        if write_json_line(stdin, &outbound.response).await.is_ok() {
                            let _ = outbound.delivered.send(Ok(()));
                        } else {
                            let _ = outbound.delivered.send(Err(UpstreamError::Disconnected));
                            break;
                        }
                    }
                }
            }
            line = lines.next_line() => {
                let Some(line) = line? else { break; };
                let value: Value = serde_json::from_str(&line)?;
                if value.get("method").and_then(Value::as_str).is_some() {
                    publish_notification(events, ordered_events, value).await;
                    continue;
                }
                let id = match value.get("id") {
                    Some(Value::String(id)) => id.clone(),
                    Some(id) => id.to_string(),
                    None => continue,
                };
                if let Some(request) = pending.remove(&id) {
                    complete_pending_request(request, value, ordered_events).await;
                }
            }
        }
    }
    for (_, request) in pending {
        let _ = request.response.send(Err(UpstreamError::Disconnected));
    }
    Ok(())
}

async fn write_json_line(stdin: &mut ChildStdin, value: &Value) -> std::io::Result<()> {
    stdin.write_all(value.to_string().as_bytes()).await?;
    stdin.write_all(b"\n").await?;
    stdin.flush().await
}

async fn run_connection(
    socket_path: &Path,
    commands: &mut mpsc::Receiver<UpstreamCommand>,
    events: &broadcast::Sender<Value>,
    ordered_events: &Arc<std::sync::Mutex<Option<mpsc::Sender<OrderedUpstreamEvent>>>>,
    connection_state: &ConnectionStateWriter,
    max_message_bytes: usize,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let initialized = connect_initialized(socket_path, max_message_bytes).await?;
    let mut socket = initialized.socket;
    let _ = connection_state.version.send(initialized.version);
    connection_state.generation.fetch_add(1, Ordering::AcqRel);
    let _ = connection_state.status.send(ConnectionStatus::Live);
    info!(socket = %socket_path.display(), "Connected to Codex App Server");

    let mut counter = 0_u64;
    let mut pending: HashMap<String, PendingUpstreamRequest> = HashMap::new();
    let mut pending_cleanup = tokio::time::interval(Duration::from_secs(1));
    loop {
        tokio::select! {
            _ = pending_cleanup.tick() => {
                pending.retain(|_, request| !request.response.is_closed());
            }
            outbound = commands.recv() => {
                let Some(outbound) = outbound else { return Ok(()); };
                match outbound {
                    UpstreamCommand::Request(mut outbound) => {
                        if outbound.response.is_closed() {
                            continue;
                        }
                        counter = counter.wrapping_add(1);
                        let upstream_id = format!("codewide-rs:{counter}");
                        let Some(object) = outbound.request.as_object_mut() else {
                            let _ = outbound.response.send(Err(UpstreamError::Protocol("request is not an object".into())));
                            continue;
                        };
                        object.insert("id".into(), Value::String(upstream_id.clone()));
                        if socket.send(Message::Text(outbound.request.to_string().into())).await.is_err() {
                            let _ = outbound.response.send(Err(UpstreamError::Disconnected));
                            return Ok(());
                        }
                        pending.insert(upstream_id, PendingUpstreamRequest {
                            response: outbound.response,
                            fence: outbound.fence,
                        });
                    }
                    UpstreamCommand::ServerResponse(outbound) => {
                        let valid = outbound.response.get("id").is_some()
                            && (outbound.response.get("result").is_some() || outbound.response.get("error").is_some())
                            && outbound.response.get("method").is_none();
                        if !valid {
                            let _ = outbound.delivered.send(Err(UpstreamError::Protocol("invalid server response".into())));
                            continue;
                        }
                        if socket.send(Message::Text(outbound.response.to_string().into())).await.is_err() {
                            let _ = outbound.delivered.send(Err(UpstreamError::Disconnected));
                            return Ok(());
                        }
                        let _ = outbound.delivered.send(Ok(()));
                    }
                }
            }
            inbound = socket.next() => {
                let Some(inbound) = inbound else { break; };
                let inbound = inbound?;
                let frame_bytes = message_payload_len(&inbound);
                let Some(value) = parse_text_frame(inbound)? else { continue; };
                if frame_bytes >= LARGE_APP_SERVER_FRAME_BYTES {
                    log_large_app_server_frame(frame_bytes, &value);
                }
                if value.get("method").and_then(Value::as_str).is_some() {
                    publish_notification(events, ordered_events, value).await;
                    continue;
                }
                let id = match value.get("id") {
                    Some(Value::String(id)) => id.clone(),
                    Some(id) => id.to_string(),
                    None => continue,
                };
                if let Some(request) = pending.remove(&id) {
                    complete_pending_request(request, value, ordered_events).await;
                }
            }
        }
    }
    let _ = connection_state.status.send(ConnectionStatus::Reconnecting);
    for (_, request) in pending {
        let _ = request.response.send(Err(UpstreamError::Disconnected));
    }
    Ok(())
}

async fn publish_notification(
    events: &broadcast::Sender<Value>,
    ordered_events: &Arc<std::sync::Mutex<Option<mpsc::Sender<OrderedUpstreamEvent>>>>,
    value: Value,
) {
    let ordered = ordered_event_sender(ordered_events);
    if let Some(ordered) = ordered
        && ordered
            .send(OrderedUpstreamEvent::Notification(value.clone()))
            .await
            .is_err()
    {
        clear_ordered_event_sender(ordered_events);
    }
    let _ = events.send(value);
}

async fn complete_pending_request(
    request: PendingUpstreamRequest,
    value: Value,
    ordered_events: &Arc<std::sync::Mutex<Option<mpsc::Sender<OrderedUpstreamEvent>>>>,
) {
    let Some(fence) = request.fence else {
        let _ = request.response.send(Ok(value));
        return;
    };
    let Some(ordered) = ordered_event_sender(ordered_events) else {
        let _ = fence.send(Err(UpstreamError::Protocol(
            "durable event fence is unavailable".into(),
        )));
        let _ = request.response.send(Err(UpstreamError::Protocol(
            "durable event fence is unavailable".into(),
        )));
        return;
    };
    if let Err(error) = ordered.send(OrderedUpstreamEvent::Fence(fence)).await {
        clear_ordered_event_sender(ordered_events);
        let OrderedUpstreamEvent::Fence(fence) = error.0 else {
            unreachable!("only a fence is sent from this branch");
        };
        let _ = fence.send(Err(UpstreamError::Disconnected));
        let _ = request.response.send(Err(UpstreamError::Disconnected));
        return;
    }
    let _ = request.response.send(Ok(value));
}

fn ordered_event_sender(
    ordered_events: &Arc<std::sync::Mutex<Option<mpsc::Sender<OrderedUpstreamEvent>>>>,
) -> Option<mpsc::Sender<OrderedUpstreamEvent>> {
    match ordered_events.lock() {
        Ok(slot) => slot.clone(),
        Err(poisoned) => poisoned.into_inner().clone(),
    }
}

fn clear_ordered_event_sender(
    ordered_events: &Arc<std::sync::Mutex<Option<mpsc::Sender<OrderedUpstreamEvent>>>>,
) {
    match ordered_events.lock() {
        Ok(mut slot) => *slot = None,
        Err(poisoned) => *poisoned.into_inner() = None,
    }
}

struct InitializedAppServerSocket {
    socket: AppServerSocket,
    version: Option<String>,
}

async fn connect_initialized(
    socket_path: &Path,
    max_message_bytes: usize,
) -> Result<InitializedAppServerSocket, Box<dyn std::error::Error + Send + Sync>> {
    let stream = UnixStream::connect(socket_path).await?;
    let (mut socket, _) = client_async_with_config(
        "ws://localhost/",
        stream,
        Some(app_server_websocket_config(max_message_bytes)),
    )
    .await?;
    socket
        .send(Message::Text(
            json!({
                "id": INITIALIZE_ID,
                "method": "initialize",
                "params": {
                    "clientInfo": {
                        "name": "codewide_companion",
                        "title": "CodeWide Companion",
                        "version": env!("CARGO_PKG_VERSION")
                    },
                    "capabilities": { "experimentalApi": true }
                }
            })
            .to_string()
            .into(),
        ))
        .await?;

    let initialized = loop {
        let Some(frame) = socket.next().await else {
            return Err(UpstreamError::Disconnected.into());
        };
        let frame = frame?;
        if let Some(value) = parse_text_frame(frame)?
            && value.get("id").and_then(Value::as_str) == Some(INITIALIZE_ID)
        {
            break value;
        }
    };
    if initialized.get("error").is_some() {
        return Err(UpstreamError::Protocol(initialized.to_string()).into());
    }
    socket
        .send(Message::Text(
            json!({ "method": "initialized" }).to_string().into(),
        ))
        .await?;
    Ok(InitializedAppServerSocket {
        socket,
        version: app_server_version(&initialized),
    })
}

/// Passively verifies one Codex App Server endpoint and returns its version.
///
/// # Errors
/// Returns when the endpoint cannot complete the initialize handshake within
/// two seconds or omits the version required by the discovery contract.
pub async fn probe_app_server_version(
    socket_path: &Path,
) -> Result<String, Box<dyn std::error::Error + Send + Sync>> {
    tokio::time::timeout(Duration::from_secs(2), async {
        let initialized = connect_initialized(socket_path, APP_SERVER_MAX_MESSAGE_BYTES).await?;
        let version = initialized
            .version
            .ok_or("App Server initialize response omitted userAgent")?;
        let mut socket = initialized.socket;
        let _ = socket.close(None).await;
        Ok::<_, Box<dyn std::error::Error + Send + Sync>>(version)
    })
    .await
    .map_err(|_| "timed out probing Codex App Server")?
}

fn app_server_version(initialize_response: &Value) -> Option<String> {
    initialize_response
        .pointer("/result/userAgent")
        .and_then(Value::as_str)
        .and_then(|user_agent| user_agent.split_once('/').map(|(_, suffix)| suffix))
        .and_then(|suffix| suffix.split_whitespace().next())
        .filter(|version| !version.is_empty())
        .map(str::to_owned)
}

fn app_server_websocket_config(max_message_bytes: usize) -> WebSocketConfig {
    WebSocketConfig::default()
        .max_frame_size(Some(max_message_bytes.min(APP_SERVER_MAX_FRAME_BYTES)))
        .max_message_size(Some(max_message_bytes))
}

fn message_payload_len(message: &Message) -> usize {
    match message {
        Message::Text(text) => text.len(),
        Message::Binary(bytes) | Message::Ping(bytes) | Message::Pong(bytes) => bytes.len(),
        Message::Close(_) | Message::Frame(_) => 0,
    }
}

fn log_large_app_server_frame(frame_bytes: usize, value: &Value) {
    let method = value
        .get("method")
        .and_then(Value::as_str)
        .unwrap_or("rpc-response");
    let item_type = value
        .pointer("/params/item/type")
        .or_else(|| value.pointer("/params/turn/status"))
        .and_then(Value::as_str)
        .unwrap_or("unknown");
    let mut large_strings = Vec::new();
    collect_large_string_fields(value, "$", &mut large_strings);
    large_strings.sort_unstable_by_key(|entry| std::cmp::Reverse(entry.1));
    large_strings.truncate(8);
    let large_fields = large_strings
        .into_iter()
        .map(|(path, bytes)| format!("{path}:{bytes}"))
        .collect::<Vec<_>>()
        .join(",");
    info!(
        frame_bytes,
        method, item_type, large_fields, "Received large App Server frame"
    );
}

fn collect_large_string_fields(value: &Value, path: &str, output: &mut Vec<(String, usize)>) {
    match value {
        Value::String(text) if text.len() >= LARGE_STRING_FIELD_BYTES => {
            output.push((path.to_owned(), text.len()));
        }
        Value::Array(values) => {
            for (index, value) in values.iter().enumerate() {
                collect_large_string_fields(value, &format!("{path}[{index}]"), output);
            }
        }
        Value::Object(values) => {
            for (key, value) in values {
                collect_large_string_fields(value, &format!("{path}.{key}"), output);
            }
        }
        _ => {}
    }
}

fn reject_command(command: UpstreamCommand, error: UpstreamError) {
    match command {
        UpstreamCommand::Request(request) => {
            let _ = request.response.send(Err(error));
        }
        UpstreamCommand::ServerResponse(response) => {
            let _ = response.delivered.send(Err(error));
        }
    }
}

fn parse_text_frame(
    frame: Message,
) -> Result<Option<Value>, Box<dyn std::error::Error + Send + Sync>> {
    match frame {
        Message::Text(text) => Ok(Some(serde_json::from_str(&text)?)),
        Message::Binary(_) => Err(UpstreamError::Protocol("binary frame".into()).into()),
        Message::Close(_) => Err(UpstreamError::Disconnected.into()),
        Message::Ping(_) | Message::Pong(_) | Message::Frame(_) => Ok(None),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::process::Stdio;
    use tokio::net::UnixListener;
    use tokio::process::Command;
    use tokio_tungstenite::accept_async;

    #[tokio::test]
    async fn rejects_requests_while_reconnecting() {
        let handle = UpstreamHandle::spawn(PathBuf::from("/definitely/missing/socket"));
        let result = handle
            .request(json!({"id": 1, "method": "thread/list", "params": {}}))
            .await;
        assert!(matches!(result, Err(UpstreamError::Reconnecting)));
    }

    #[tokio::test]
    async fn probe_requires_and_returns_the_reported_app_server_version()
    -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        let directory = tempfile::tempdir()?;
        let socket_path = directory.path().join("app-server.sock");
        let listener = UnixListener::bind(&socket_path)?;
        let fake = tokio::spawn(async move {
            let (stream, _) = listener.accept().await?;
            let mut socket = accept_async(stream).await?;
            let initialize = receive_json(&mut socket).await?;
            socket
                .send(Message::Text(
                    json!({
                        "id": initialize["id"].clone(),
                        "result": {"userAgent": "codex_cli_rs/0.156.1 (macOS 26)"}
                    })
                    .to_string()
                    .into(),
                ))
                .await?;
            let initialized = receive_json(&mut socket).await?;
            assert_eq!(initialized["method"], "initialized");
            Ok::<(), Box<dyn std::error::Error + Send + Sync>>(())
        });

        assert_eq!(probe_app_server_version(&socket_path).await?, "0.156.1");
        fake.await??;
        Ok(())
    }

    #[test]
    fn initialize_version_parser_rejects_missing_or_empty_versions() {
        assert_eq!(
            app_server_version(&json!({
                "result": {"userAgent": "codex_cli_rs/1.2.3 (macOS)"}
            })),
            Some("1.2.3".to_owned())
        );
        assert_eq!(
            app_server_version(&json!({"result": {"userAgent": "codex_cli_rs/"}})),
            None
        );
        assert_eq!(app_server_version(&json!({"result": {}})), None);
    }

    #[tokio::test]
    async fn stdio_child_supports_initialized_requests()
    -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        let mut child = Command::new("sh")
            .arg("-c")
            .arg(
                r#"
                IFS= read -r initialize
                printf '%s\n' '{"id":"codewide-companion-initialize","result":{}}'
                IFS= read -r initialized
                IFS= read -r request
                printf '%s\n' '{"id":"codewide-stdio:1","result":{"ok":true}}'
                "#,
            )
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()?;
        let handle = UpstreamHandle::spawn_stdio(&mut child)?;
        wait_for_status(&handle, ConnectionStatus::Live).await?;
        let response = handle
            .request(json!({"method": "account/read", "params": {}}))
            .await?;
        assert_eq!(
            response.pointer("/result/ok").and_then(Value::as_bool),
            Some(true)
        );
        assert!(child.wait().await?.success());
        Ok(())
    }

    #[tokio::test]
    async fn reconnects_after_socket_loss_and_serves_the_next_request()
    -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        let directory = tempfile::tempdir()?;
        let socket_path = directory.path().join("app-server.sock");
        let handle = UpstreamHandle::spawn(socket_path.clone());
        assert_eq!(handle.status(), ConnectionStatus::Reconnecting);

        let listener = UnixListener::bind(&socket_path)?;
        let fake = tokio::spawn(async move {
            for cycle in 1..=2 {
                let (stream, _) = listener.accept().await?;
                let mut socket = accept_async(stream).await?;
                let initialize = receive_json(&mut socket).await?;
                let id = initialize
                    .get("id")
                    .cloned()
                    .ok_or_else(|| std::io::Error::other("initialize id missing"))?;
                socket
                    .send(Message::Text(
                        json!({
                            "id": id,
                            "result": {"userAgent": format!("codex_cli_rs/1.0.{cycle}")}
                        })
                        .to_string()
                        .into(),
                    ))
                    .await?;
                let initialized = receive_json(&mut socket).await?;
                assert_eq!(initialized["method"], "initialized");
                let request = receive_json(&mut socket).await?;
                let id = request
                    .get("id")
                    .cloned()
                    .ok_or_else(|| std::io::Error::other("request id missing"))?;
                socket
                    .send(Message::Text(
                        json!({"id": id, "result": {"cycle": cycle}})
                            .to_string()
                            .into(),
                    ))
                    .await?;
                socket.close(None).await?;
            }
            Ok::<(), Box<dyn std::error::Error + Send + Sync>>(())
        });

        wait_for_status(&handle, ConnectionStatus::Live).await?;
        assert_eq!(handle.version().as_deref(), Some("1.0.1"));
        assert_eq!(
            handle
                .request(json!({"method":"thread/list","params":{}}))
                .await?["result"]["cycle"],
            1
        );
        wait_for_status(&handle, ConnectionStatus::Reconnecting).await?;
        wait_for_status(&handle, ConnectionStatus::Live).await?;
        assert_eq!(handle.version().as_deref(), Some("1.0.2"));
        assert_eq!(
            handle
                .request(json!({"method":"thread/list","params":{}}))
                .await?["result"]["cycle"],
            2
        );
        fake.await??;
        Ok(())
    }

    #[tokio::test]
    async fn accepts_a_single_app_server_frame_larger_than_the_library_default()
    -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        const LARGE_FRAME_BYTES: usize = 32 * 1024 * 1024;

        let directory = tempfile::tempdir()?;
        let socket_path = directory.path().join("app-server.sock");
        let handle = UpstreamHandle::spawn(socket_path.clone());
        let mut events = handle.subscribe_events();
        let listener = UnixListener::bind(&socket_path)?;
        let fake = tokio::spawn(async move {
            let (stream, _) = listener.accept().await?;
            let mut socket = accept_async(stream).await?;
            let initialize = receive_json(&mut socket).await?;
            let id = initialize
                .get("id")
                .cloned()
                .ok_or_else(|| std::io::Error::other("initialize id missing"))?;
            socket
                .send(Message::Text(
                    json!({"id": id, "result": {}}).to_string().into(),
                ))
                .await?;
            let initialized = receive_json(&mut socket).await?;
            assert_eq!(initialized["method"], "initialized");

            socket
                .send(Message::Text(
                    json!({
                        "method": "item/completed",
                        "params": {"payload": "x".repeat(LARGE_FRAME_BYTES)}
                    })
                    .to_string()
                    .into(),
                ))
                .await?;

            let request = receive_json(&mut socket).await?;
            let id = request
                .get("id")
                .cloned()
                .ok_or_else(|| std::io::Error::other("request id missing"))?;
            socket
                .send(Message::Text(
                    json!({"id": id, "result": {"ok": true}}).to_string().into(),
                ))
                .await?;
            Ok::<(), Box<dyn std::error::Error + Send + Sync>>(())
        });

        wait_for_status(&handle, ConnectionStatus::Live).await?;
        let event = tokio::time::timeout(Duration::from_secs(10), events.recv()).await??;
        assert_eq!(event["method"], "item/completed");
        assert_eq!(
            event["params"]["payload"].as_str().map(str::len),
            Some(LARGE_FRAME_BYTES)
        );
        assert_eq!(
            handle
                .request(json!({"method":"thread/list","params":{}}))
                .await?["result"]["ok"],
            true
        );
        fake.await??;
        Ok(())
    }

    #[tokio::test]
    async fn fenced_request_orders_prior_notifications_before_its_cursor()
    -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        let directory = tempfile::tempdir()?;
        let socket_path = directory.path().join("fenced-app-server.sock");
        let handle = UpstreamHandle::spawn(socket_path.clone());
        let mut ordered = handle.take_ordered_events();
        let listener = UnixListener::bind(&socket_path)?;
        let fake = tokio::spawn(async move {
            let (stream, _) = listener.accept().await?;
            let mut socket = accept_async(stream).await?;
            let initialize = receive_json(&mut socket).await?;
            socket
                .send(Message::Text(
                    json!({"id": initialize["id"].clone(), "result": {}})
                        .to_string()
                        .into(),
                ))
                .await?;
            let initialized = receive_json(&mut socket).await?;
            assert_eq!(initialized["method"], "initialized");
            let request = receive_json(&mut socket).await?;
            socket
                .send(Message::Text(
                    json!({"method":"item/agentMessage/delta","params":{"delta":"tail"}})
                        .to_string()
                        .into(),
                ))
                .await?;
            socket
                .send(Message::Text(
                    json!({"id": request["id"].clone(), "result": {"ok": true}})
                        .to_string()
                        .into(),
                ))
                .await?;
            Ok::<(), Box<dyn std::error::Error + Send + Sync>>(())
        });

        wait_for_status(&handle, ConnectionStatus::Live).await?;
        let (response, fence) = handle
            .request_fenced(json!({"method":"thread/read","params":{}}))
            .await?;
        assert_eq!(response["result"]["ok"], true);
        let Some(OrderedUpstreamEvent::Notification(notification)) = ordered.recv().await else {
            return Err("notification did not precede fence".into());
        };
        assert_eq!(notification["method"], "item/agentMessage/delta");
        let Some(OrderedUpstreamEvent::Fence(completion)) = ordered.recv().await else {
            return Err("fence was not emitted after notification".into());
        };
        let _ = completion.send(Ok(41));
        assert_eq!(fence.wait().await?, 41);
        fake.await??;
        Ok(())
    }

    #[tokio::test]
    async fn configured_message_limit_rejects_oversized_source_before_json_delivery()
    -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        let directory = tempfile::tempdir()?;
        let socket_path = directory.path().join("bounded-app-server.sock");
        let handle = UpstreamHandle::spawn_with_message_limit(socket_path.clone(), 512);
        let mut events = handle.subscribe_events();
        let listener = UnixListener::bind(&socket_path)?;
        let fake = tokio::spawn(async move {
            let (stream, _) = listener.accept().await?;
            let mut socket = accept_async(stream).await?;
            let initialize = receive_json(&mut socket).await?;
            let id = initialize
                .get("id")
                .cloned()
                .ok_or_else(|| std::io::Error::other("initialize id missing"))?;
            socket
                .send(Message::Text(
                    json!({"id": id, "result": {}}).to_string().into(),
                ))
                .await?;
            let initialized = receive_json(&mut socket).await?;
            assert_eq!(initialized["method"], "initialized");
            socket
                .send(Message::Text(
                    json!({
                        "method": "item/completed",
                        "params": {"payload": "x".repeat(2_048)}
                    })
                    .to_string()
                    .into(),
                ))
                .await?;
            Ok::<(), Box<dyn std::error::Error + Send + Sync>>(())
        });

        wait_for_status(&handle, ConnectionStatus::Live).await?;
        fake.await??;
        wait_for_status(&handle, ConnectionStatus::Reconnecting).await?;
        assert!(
            tokio::time::timeout(Duration::from_millis(100), events.recv())
                .await
                .is_err()
        );
        Ok(())
    }

    async fn wait_for_status(
        handle: &UpstreamHandle,
        expected: ConnectionStatus,
    ) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        let mut status = handle.subscribe_status();
        tokio::time::timeout(Duration::from_secs(5), async {
            loop {
                if *status.borrow() == expected {
                    return Ok::<(), tokio::sync::watch::error::RecvError>(());
                }
                status.changed().await?;
            }
        })
        .await??;
        Ok(())
    }

    async fn receive_json(
        socket: &mut AppServerSocket,
    ) -> Result<Value, Box<dyn std::error::Error + Send + Sync>> {
        loop {
            let frame = socket
                .next()
                .await
                .ok_or_else(|| std::io::Error::other("fake socket closed"))??;
            if let Message::Text(text) = frame {
                return Ok(serde_json::from_str(&text)?);
            }
        }
    }
}
