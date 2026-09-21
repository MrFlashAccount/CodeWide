use std::{
    collections::HashMap,
    sync::Arc,
    time::{Duration, SystemTime, UNIX_EPOCH},
};

use axum::{
    body::Body,
    extract::ws::{Message as AxumMessage, WebSocket},
    http::{HeaderMap, HeaderName, HeaderValue, Method, StatusCode, header},
    response::{IntoResponse, Response},
};
use base64::{Engine as _, engine::general_purpose::URL_SAFE_NO_PAD};
use futures_util::{SinkExt, StreamExt, stream};
use rand::TryRngCore;
use serde::Serialize;
use tokio::sync::{Mutex, OwnedSemaphorePermit, Semaphore, watch};
use tokio_tungstenite::{
    MaybeTlsStream, WebSocketStream, connect_async_with_config,
    tungstenite::{
        Message as TungsteniteMessage,
        client::IntoClientRequest,
        protocol::{CloseFrame, WebSocketConfig, frame::coding::CloseCode},
    },
};

use crate::auth::AuthorizationChange;

const MIN_TTL_SECONDS: u64 = 30;
const MAX_TTL_SECONDS: u64 = 60 * 60;
const DEFAULT_TTL_SECONDS: u64 = 300;
const TUNNEL_PURGE_INTERVAL: Duration = Duration::from_secs(30);
const TRANSFER_IDLE_TIMEOUT: Duration = Duration::from_secs(30);
const MAX_TRANSFER_DURATION: Duration = Duration::from_mins(5);
const MAX_TRANSFER_BYTES: u64 = 512 * 1024 * 1024;
const MAX_WEBSOCKET_MESSAGE_BYTES: usize = 16 * 1024 * 1024;

#[derive(Clone, Copy)]
struct TunnelLimits {
    global_tunnels: usize,
    owner_tunnels: usize,
    global_active: usize,
    owner_active: usize,
}

impl Default for TunnelLimits {
    fn default() -> Self {
        Self {
            global_tunnels: 256,
            owner_tunnels: 16,
            global_active: 128,
            owner_active: 16,
        }
    }
}

#[derive(Clone)]
pub struct LocalhostTunnelService {
    tunnels: Arc<Mutex<HashMap<String, Tunnel>>>,
    owner_limiters: Arc<Mutex<HashMap<Arc<str>, Arc<Semaphore>>>>,
    active_global: Arc<Semaphore>,
    limits: TunnelLimits,
    client: reqwest::Client,
}

#[derive(Clone)]
pub struct Tunnel {
    pub id: String,
    pub port: u16,
    pub expires_at: u64,
    browser_token: Arc<str>,
    revoked: watch::Receiver<bool>,
    revoke: watch::Sender<bool>,
    owner_device_id: Option<String>,
    owner_key: Arc<str>,
}

struct TunnelTrafficPermit {
    _global: OwnedSemaphorePermit,
    _owner: OwnedSemaphorePermit,
}

pub struct TunnelWebSocket {
    socket: WebSocketStream<MaybeTlsStream<tokio::net::TcpStream>>,
    deadline: tokio::time::Instant,
    _permit: TunnelTrafficPermit,
}

impl Tunnel {
    #[must_use]
    pub fn revoked(&self) -> watch::Receiver<bool> {
        self.revoked.clone()
    }

    #[must_use]
    pub fn owner_device_id(&self) -> Option<&str> {
        self.owner_device_id.as_deref()
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CreatedTunnel {
    pub id: String,
    pub expires_at: u64,
    pub base_path: String,
}

#[derive(Debug, thiserror::Error)]
pub enum TunnelError {
    #[error("invalid_port")]
    InvalidPort,
    #[error("invalid_ttl")]
    InvalidTtl,
    #[error("tunnel_not_found")]
    NotFound,
    #[error("unauthorized")]
    Unauthorized,
    #[error("localhost_unavailable")]
    Unavailable,
    #[error("localhost_timeout")]
    Timeout,
    #[error("tunnel_capacity_exceeded")]
    Capacity,
    #[error("tunnel_body_too_large")]
    TooLarge,
}

impl IntoResponse for TunnelError {
    fn into_response(self) -> Response {
        let status = match self {
            Self::InvalidPort | Self::InvalidTtl => StatusCode::BAD_REQUEST,
            Self::NotFound => StatusCode::NOT_FOUND,
            Self::Unauthorized => StatusCode::UNAUTHORIZED,
            Self::Unavailable => StatusCode::BAD_GATEWAY,
            Self::Timeout => StatusCode::GATEWAY_TIMEOUT,
            Self::Capacity => StatusCode::TOO_MANY_REQUESTS,
            Self::TooLarge => StatusCode::PAYLOAD_TOO_LARGE,
        };
        (
            status,
            axum::Json(serde_json::json!({"error": self.to_string()})),
        )
            .into_response()
    }
}

impl LocalhostTunnelService {
    /// Creates an isolated in-memory tunnel registry.
    ///
    /// # Errors
    ///
    /// Returns an error if the HTTP forwarding client cannot be constructed.
    pub fn new() -> Result<Self, TunnelError> {
        Self::new_with_limits(TunnelLimits::default())
    }

    fn new_with_limits(limits: TunnelLimits) -> Result<Self, TunnelError> {
        let client = reqwest::Client::builder()
            .no_proxy()
            .connect_timeout(Duration::from_secs(10))
            .timeout(MAX_TRANSFER_DURATION)
            .redirect(reqwest::redirect::Policy::none())
            .build()
            .map_err(|_| TunnelError::Unavailable)?;
        Ok(Self {
            tunnels: Arc::new(Mutex::new(HashMap::new())),
            owner_limiters: Arc::new(Mutex::new(HashMap::new())),
            active_global: Arc::new(Semaphore::new(limits.global_active)),
            limits,
            client,
        })
    }

    /// Starts periodic expiry enforcement even when no new request arrives.
    pub fn start_periodic_cleanup(&self) {
        let Ok(runtime) = tokio::runtime::Handle::try_current() else {
            tracing::warn!("tunnel cleanup requires an async runtime");
            return;
        };
        let service = self.clone();
        std::mem::drop(runtime.spawn(async move {
            let mut interval = tokio::time::interval(TUNNEL_PURGE_INTERVAL);
            interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
            interval.tick().await;
            loop {
                interval.tick().await;
                service.purge_expired().await;
            }
        }));
    }

    /// Revokes every tunnel owned by a device as soon as its authorization changes.
    pub fn start_revocation_cleanup(
        &self,
        mut changes: tokio::sync::broadcast::Receiver<AuthorizationChange>,
    ) {
        let Ok(runtime) = tokio::runtime::Handle::try_current() else {
            tracing::warn!("tunnel revocation cleanup requires an async runtime");
            return;
        };
        let service = self.clone();
        std::mem::drop(runtime.spawn(async move {
            loop {
                match changes.recv().await {
                    Ok(change) => service.revoke_device_tunnels(&change.device_id).await,
                    Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => {
                        service.revoke_all_tunnels().await;
                    }
                    Err(tokio::sync::broadcast::error::RecvError::Closed) => return,
                }
            }
        }));
    }

    /// Creates a temporary tunnel for a loopback TCP port.
    ///
    /// # Errors
    ///
    /// Rejects invalid ports, TTLs outside 30..=3600 seconds, and failures to
    /// obtain cryptographically secure random identifiers.
    pub async fn create(
        &self,
        port: u32,
        ttl_seconds: Option<u64>,
    ) -> Result<CreatedTunnel, TunnelError> {
        self.create_for_device(port, ttl_seconds, None).await
    }

    /// Creates a tunnel bound to the device transport policy that created it.
    ///
    /// # Errors
    ///
    /// Rejects the same invalid port, TTL, and randomness failures as
    /// [`Self::create`].
    pub async fn create_for_device(
        &self,
        port: u32,
        ttl_seconds: Option<u64>,
        owner_device_id: Option<String>,
    ) -> Result<CreatedTunnel, TunnelError> {
        let port = u16::try_from(port)
            .ok()
            .filter(|port| *port != 0)
            .ok_or(TunnelError::InvalidPort)?;
        let ttl_seconds = ttl_seconds.unwrap_or(DEFAULT_TTL_SECONDS);
        if !(MIN_TTL_SECONDS..=MAX_TTL_SECONDS).contains(&ttl_seconds) {
            return Err(TunnelError::InvalidTtl);
        }
        let id = random_token(16)?;
        let browser_token: Arc<str> = Arc::from(random_token(32)?);
        let expires_at = unix_time_ms().saturating_add(ttl_seconds.saturating_mul(1_000));
        let (revoke, revoked) = watch::channel(false);
        let owner_key: Arc<str> = Arc::from(owner_device_id.as_deref().unwrap_or("local-admin"));
        let tunnel = Tunnel {
            id: id.clone(),
            port,
            expires_at,
            browser_token,
            revoked,
            revoke,
            owner_device_id,
            owner_key,
        };
        let mut tunnels = self.tunnels.lock().await;
        purge_expired_locked(&mut tunnels);
        let owner_count = tunnels
            .values()
            .filter(|current| current.owner_key == tunnel.owner_key)
            .count();
        if tunnels.len() >= self.limits.global_tunnels || owner_count >= self.limits.owner_tunnels {
            return Err(TunnelError::Capacity);
        }
        tunnels.insert(id.clone(), tunnel);
        Ok(CreatedTunnel {
            id: id.clone(),
            expires_at,
            base_path: format!("/v1/tunnels/{id}/"),
        })
    }

    pub async fn revoke(&self, id: &str) -> bool {
        let removed = self.tunnels.lock().await.remove(id);
        if let Some(tunnel) = removed {
            let _ = tunnel.revoke.send(true);
            true
        } else {
            false
        }
    }

    #[cfg(feature = "e2e-command-fault")]
    /// Advances an owned tunnel to its normal expiry boundary for an authenticated E2E run.
    ///
    /// # Errors
    ///
    /// Returns `NotFound` for an unknown tunnel and `Unauthorized` when the expected owner differs.
    pub(crate) async fn expire_for_e2e(
        &self,
        id: &str,
        owner_device_id: &str,
    ) -> Result<(), TunnelError> {
        {
            let mut tunnels = self.tunnels.lock().await;
            let tunnel = tunnels.get_mut(id).ok_or(TunnelError::NotFound)?;
            if tunnel.owner_device_id.as_deref() != Some(owner_device_id) {
                return Err(TunnelError::Unauthorized);
            }
            tunnel.expires_at = unix_time_ms();
        }
        self.purge_expired().await;
        Ok(())
    }

    pub async fn revoke_device_tunnels(&self, device_id: &str) {
        let mut tunnels = self.tunnels.lock().await;
        let ids = tunnels
            .iter()
            .filter(|(_, tunnel)| tunnel.owner_device_id.as_deref() == Some(device_id))
            .map(|(id, _)| id.clone())
            .collect::<Vec<_>>();
        for id in ids {
            if let Some(tunnel) = tunnels.remove(&id) {
                let _ = tunnel.revoke.send(true);
            }
        }
    }

    async fn revoke_all_tunnels(&self) {
        let tunnels = std::mem::take(&mut *self.tunnels.lock().await);
        for tunnel in tunnels.into_values() {
            let _ = tunnel.revoke.send(true);
        }
    }

    /// Resolves an active tunnel.
    ///
    /// # Errors
    ///
    /// Returns [`TunnelError::NotFound`] for unknown, expired, or revoked IDs.
    pub async fn tunnel(&self, id: &str) -> Result<Tunnel, TunnelError> {
        self.purge_expired().await;
        self.tunnels
            .lock()
            .await
            .get(id)
            .cloned()
            .ok_or(TunnelError::NotFound)
    }

    pub fn browser_authorized(&self, tunnel: &Tunnel, headers: &HeaderMap) -> bool {
        let Some(candidate) = cookie(headers, &cookie_name(&tunnel.id)) else {
            return false;
        };
        if !constant_time_eq(candidate.as_bytes(), tunnel.browser_token.as_bytes()) {
            return false;
        }
        let Some(origin) = headers.get(header::ORIGIN) else {
            return true;
        };
        let Some(host) = headers
            .get(header::HOST)
            .and_then(|value| value.to_str().ok())
        else {
            return false;
        };
        origin
            .to_str()
            .ok()
            .and_then(|value| reqwest::Url::parse(value).ok())
            .and_then(|url| url.host_str().map(|name| (name.to_owned(), url.port())))
            .is_some_and(|(name, port)| {
                let expected = port.map_or(name.clone(), |port| format!("{name}:{port}"));
                expected == host
            })
    }

    /// Streams one HTTP request and response through the selected tunnel.
    ///
    /// # Errors
    ///
    /// Reports target connection failures, timeouts, and revocation.
    pub async fn proxy_http(
        &self,
        tunnel: Tunnel,
        method: Method,
        target_path: &str,
        headers: &HeaderMap,
        body: Body,
        browser_cookie_path: Option<&str>,
    ) -> Result<Response, TunnelError> {
        if content_length(headers).is_some_and(|length| length > MAX_TRANSFER_BYTES) {
            return Err(TunnelError::TooLarge);
        }
        let permit = self.acquire_traffic(&tunnel).await?;
        let url = format!("http://127.0.0.1:{}{target_path}", tunnel.port);
        let mut request = self
            .client
            .request(method, url)
            .headers(filtered_headers(headers, Some(&tunnel)))
            .body(reqwest::Body::wrap_stream(bounded_request_stream(
                body,
                MAX_TRANSFER_BYTES,
                TRANSFER_IDLE_TIMEOUT,
                MAX_TRANSFER_DURATION,
            )));
        if let Ok(value) = HeaderValue::from_str(&format!("127.0.0.1:{}", tunnel.port)) {
            request = request.header(header::HOST, value);
        }
        let response = tokio::select! {
            result = request.send() => result.map_err(|error| {
                if error.is_timeout() { TunnelError::Timeout } else { TunnelError::Unavailable }
            })?,
            () = wait_revoked(tunnel.revoked.clone()) => return Err(TunnelError::NotFound),
        };
        if content_length(response.headers()).is_some_and(|length| length > MAX_TRANSFER_BYTES) {
            return Err(TunnelError::TooLarge);
        }
        let status = response.status();
        let mut response_headers = filtered_headers(response.headers(), None);
        if let Some(path) = browser_cookie_path {
            let value = browser_cookie(headers, &tunnel, path);
            if let Ok(value) = HeaderValue::from_str(&value) {
                response_headers.insert(header::SET_COOKIE, value);
            }
        }
        let deadline = tokio::time::Instant::now()
            + Duration::from_millis(tunnel.expires_at.saturating_sub(unix_time_ms()))
                .min(MAX_TRANSFER_DURATION);
        let stream = cancellable_response_stream(
            response.bytes_stream().boxed(),
            tunnel.revoked.clone(),
            deadline,
            Some(permit),
            MAX_TRANSFER_BYTES,
            TRANSFER_IDLE_TIMEOUT,
        );
        let mut output = Response::new(Body::from_stream(stream));
        *output.status_mut() = status;
        *output.headers_mut() = response_headers;
        Ok(output)
    }

    /// Connects to a WebSocket endpoint on the tunnel's loopback port.
    ///
    /// # Errors
    ///
    /// Reports invalid target requests, connection failures, and timeouts.
    pub async fn connect_websocket(
        &self,
        tunnel: &Tunnel,
        target_path: &str,
        headers: &HeaderMap,
    ) -> Result<TunnelWebSocket, TunnelError> {
        let permit = self.acquire_traffic(tunnel).await?;
        let url = format!("ws://127.0.0.1:{}{target_path}", tunnel.port);
        let mut request = url
            .into_client_request()
            .map_err(|_| TunnelError::Unavailable)?;
        for (name, value) in &filtered_headers(headers, Some(tunnel)) {
            request.headers_mut().append(name, value.clone());
        }
        request.headers_mut().remove(header::HOST);
        request.headers_mut().insert(
            header::HOST,
            HeaderValue::from_str(&format!("127.0.0.1:{}", tunnel.port))
                .map_err(|_| TunnelError::Unavailable)?,
        );
        let deadline = tokio::time::Instant::now()
            + Duration::from_millis(tunnel.expires_at.saturating_sub(unix_time_ms()));
        let config = WebSocketConfig::default()
            .max_message_size(Some(MAX_WEBSOCKET_MESSAGE_BYTES))
            .max_frame_size(Some(MAX_WEBSOCKET_MESSAGE_BYTES));
        let connection = connect_async_with_config(request, Some(config), false);
        let (socket, _) = tokio::select! {
            biased;
            () = wait_revoked(tunnel.revoked.clone()) => return Err(TunnelError::NotFound),
            () = tokio::time::sleep_until(deadline) => return Err(TunnelError::NotFound),
            result = tokio::time::timeout(Duration::from_secs(10), connection) => {
                result
                    .map_err(|_| TunnelError::Timeout)?
                    .map_err(|_| TunnelError::Unavailable)?
            }
        };
        Ok(TunnelWebSocket {
            socket,
            deadline,
            _permit: permit,
        })
    }

    async fn purge_expired(&self) {
        let retained_owners = {
            let mut tunnels = self.tunnels.lock().await;
            purge_expired_locked(&mut tunnels);
            tunnels
                .values()
                .map(|tunnel| tunnel.owner_key.clone())
                .collect::<std::collections::HashSet<_>>()
        };
        self.owner_limiters.lock().await.retain(|owner, limiter| {
            retained_owners.contains(owner)
                || limiter.available_permits() < self.limits.owner_active
        });
    }

    async fn acquire_traffic(&self, tunnel: &Tunnel) -> Result<TunnelTrafficPermit, TunnelError> {
        if tunnel.expires_at <= unix_time_ms() || *tunnel.revoked.borrow() {
            return Err(TunnelError::NotFound);
        }
        let global = self
            .active_global
            .clone()
            .try_acquire_owned()
            .map_err(|_| TunnelError::Capacity)?;
        let owner = {
            let mut limiters = self.owner_limiters.lock().await;
            limiters
                .entry(tunnel.owner_key.clone())
                .or_insert_with(|| Arc::new(Semaphore::new(self.limits.owner_active)))
                .clone()
        };
        let owner = owner
            .try_acquire_owned()
            .map_err(|_| TunnelError::Capacity)?;
        Ok(TunnelTrafficPermit {
            _global: global,
            _owner: owner,
        })
    }
}

fn cancellable_response_stream(
    mut upstream: futures_util::stream::BoxStream<'static, Result<bytes::Bytes, reqwest::Error>>,
    mut revoked: watch::Receiver<bool>,
    deadline: tokio::time::Instant,
    permit: Option<TunnelTrafficPermit>,
    max_bytes: u64,
    idle_timeout: Duration,
) -> impl futures_util::Stream<Item = Result<bytes::Bytes, std::io::Error>> {
    let output_revoked = revoked.clone();
    let (sender, receiver) = tokio::sync::mpsc::channel(1);
    std::mem::drop(tokio::spawn(async move {
        let _permit = permit;
        let mut bytes = 0_u64;
        loop {
            if *revoked.borrow() || tokio::time::Instant::now() >= deadline {
                break;
            }
            let item = tokio::select! {
                biased;
                _ = revoked.changed() => break,
                () = tokio::time::sleep_until(deadline) => break,
                item = tokio::time::timeout(idle_timeout, upstream.next()) => match item {
                    Ok(Some(Ok(chunk))) => Ok(chunk),
                    Ok(Some(Err(error))) => Err(std::io::Error::other(error)),
                    Ok(None) => break,
                    Err(_) => Err(std::io::Error::new(
                        std::io::ErrorKind::TimedOut,
                        "tunnel response idle timeout",
                    )),
                },
            };
            if let Ok(chunk) = &item {
                bytes = bytes.saturating_add(u64::try_from(chunk.len()).unwrap_or(u64::MAX));
                if bytes > max_bytes {
                    let _ = sender
                        .send(Err(std::io::Error::other(
                            "tunnel response body limit exceeded",
                        )))
                        .await;
                    break;
                }
            }
            let failed = item.is_err();
            tokio::select! {
                biased;
                _ = revoked.changed() => break,
                () = tokio::time::sleep_until(deadline) => break,
                result = sender.send(item) => {
                    if result.is_err() {
                        break;
                    }
                }
            }
            if failed {
                break;
            }
        }
    }));
    stream::unfold(
        (receiver, output_revoked, deadline),
        |(mut receiver, mut revoked, deadline)| async move {
            if *revoked.borrow() || tokio::time::Instant::now() >= deadline {
                return None;
            }
            tokio::select! {
                biased;
                _ = revoked.changed() => None,
                () = tokio::time::sleep_until(deadline) => None,
                item = receiver.recv() => item.map(|item| (item, (receiver, revoked, deadline))),
            }
        },
    )
}

fn bounded_request_stream(
    body: Body,
    max_bytes: u64,
    idle_timeout: Duration,
    total_duration: Duration,
) -> impl futures_util::Stream<Item = Result<bytes::Bytes, std::io::Error>> {
    let upstream = body
        .into_data_stream()
        .map(|item| item.map_err(std::io::Error::other))
        .boxed();
    let deadline = tokio::time::Instant::now() + total_duration;
    stream::unfold(
        (upstream, 0_u64, deadline, false),
        move |(mut upstream, bytes, deadline, failed)| async move {
            if failed || tokio::time::Instant::now() >= deadline {
                return None;
            }
            let item = tokio::select! {
                () = tokio::time::sleep_until(deadline) => {
                    Err(std::io::Error::new(std::io::ErrorKind::TimedOut, "tunnel body deadline exceeded"))
                }
                item = tokio::time::timeout(idle_timeout, upstream.next()) => match item {
                    Ok(Some(item)) => item,
                    Ok(None) => return None,
                    Err(_) => Err(std::io::Error::new(std::io::ErrorKind::TimedOut, "tunnel body idle timeout")),
                },
            };
            match item {
                Ok(chunk) => {
                    let next = bytes.saturating_add(u64::try_from(chunk.len()).unwrap_or(u64::MAX));
                    if next > max_bytes {
                        Some((
                            Err(std::io::Error::other("tunnel body limit exceeded")),
                            (upstream, next, deadline, true),
                        ))
                    } else {
                        Some((Ok(chunk), (upstream, next, deadline, false)))
                    }
                }
                Err(error) => Some((Err(error), (upstream, bytes, deadline, true))),
            }
        },
    )
}

fn purge_expired_locked(tunnels: &mut HashMap<String, Tunnel>) {
    let now = unix_time_ms();
    tunnels.retain(|_, tunnel| {
        let keep = tunnel.expires_at > now && !*tunnel.revoked.borrow();
        if !keep {
            let _ = tunnel.revoke.send(true);
        }
        keep
    });
}

fn content_length(headers: &HeaderMap) -> Option<u64> {
    headers
        .get(header::CONTENT_LENGTH)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.parse().ok())
}

pub async fn bridge_websocket(
    mut client: WebSocket,
    upstream: TunnelWebSocket,
    mut revoked: watch::Receiver<bool>,
) {
    let TunnelWebSocket {
        socket: mut upstream,
        deadline,
        _permit,
    } = upstream;
    loop {
        tokio::select! {
            message = client.recv() => {
                let Some(Ok(message)) = message else { break };
                if websocket_message_bytes_axum(&message) > MAX_WEBSOCKET_MESSAGE_BYTES { break; }
                let message = axum_to_tungstenite(message);
                let sent = tokio::select! {
                    biased;
                    changed = revoked.changed() => {
                        let _ = changed;
                        false
                    },
                    () = tokio::time::sleep_until(deadline) => false,
                    result = tokio::time::timeout(TRANSFER_IDLE_TIMEOUT, upstream.send(message)) => {
                        result.is_ok_and(|result| result.is_ok())
                    }
                };
                if !sent { break; }
            }
            message = upstream.next() => {
                let Some(Ok(message)) = message else { break };
                if websocket_message_bytes_tungstenite(&message) > MAX_WEBSOCKET_MESSAGE_BYTES { break; }
                let Some(message) = tungstenite_to_axum(message) else { break };
                let sent = tokio::select! {
                    biased;
                    changed = revoked.changed() => {
                        let _ = changed;
                        false
                    },
                    () = tokio::time::sleep_until(deadline) => false,
                    result = tokio::time::timeout(TRANSFER_IDLE_TIMEOUT, client.send(message)) => {
                        result.is_ok_and(|result| result.is_ok())
                    }
                };
                if !sent { break; }
            }
            changed = revoked.changed() => {
                if changed.is_err() || *revoked.borrow() { break; }
            }
            () = tokio::time::sleep_until(deadline) => break,
        }
    }
    let _ = tokio::time::timeout(
        Duration::from_secs(1),
        client.send(AxumMessage::Close(Some(axum::extract::ws::CloseFrame {
            code: 1000,
            reason: "tunnel_closed".into(),
        }))),
    )
    .await;
    let _ = tokio::time::timeout(
        Duration::from_secs(1),
        upstream.send(TungsteniteMessage::Close(Some(CloseFrame {
            code: CloseCode::Normal,
            reason: "tunnel_closed".into(),
        }))),
    )
    .await;
}

fn websocket_message_bytes_axum(message: &AxumMessage) -> usize {
    match message {
        AxumMessage::Text(text) => text.len(),
        AxumMessage::Binary(bytes) | AxumMessage::Ping(bytes) | AxumMessage::Pong(bytes) => {
            bytes.len()
        }
        AxumMessage::Close(frame) => frame.as_ref().map_or(0, |frame| frame.reason.len()),
    }
}

fn websocket_message_bytes_tungstenite(message: &TungsteniteMessage) -> usize {
    match message {
        TungsteniteMessage::Text(text) => text.len(),
        TungsteniteMessage::Binary(bytes)
        | TungsteniteMessage::Ping(bytes)
        | TungsteniteMessage::Pong(bytes) => bytes.len(),
        TungsteniteMessage::Close(frame) => frame.as_ref().map_or(0, |frame| frame.reason.len()),
        TungsteniteMessage::Frame(frame) => frame.payload().len(),
    }
}

fn axum_to_tungstenite(message: AxumMessage) -> TungsteniteMessage {
    match message {
        AxumMessage::Text(text) => TungsteniteMessage::Text(text.to_string().into()),
        AxumMessage::Binary(bytes) => TungsteniteMessage::Binary(bytes),
        AxumMessage::Ping(bytes) => TungsteniteMessage::Ping(bytes),
        AxumMessage::Pong(bytes) => TungsteniteMessage::Pong(bytes),
        AxumMessage::Close(frame) => TungsteniteMessage::Close(frame.map(|frame| CloseFrame {
            code: CloseCode::from(frame.code),
            reason: frame.reason.to_string().into(),
        })),
    }
}

fn tungstenite_to_axum(message: TungsteniteMessage) -> Option<AxumMessage> {
    match message {
        TungsteniteMessage::Text(text) => Some(AxumMessage::Text(text.to_string().into())),
        TungsteniteMessage::Binary(bytes) => Some(AxumMessage::Binary(bytes)),
        TungsteniteMessage::Ping(bytes) => Some(AxumMessage::Ping(bytes)),
        TungsteniteMessage::Pong(bytes) => Some(AxumMessage::Pong(bytes)),
        TungsteniteMessage::Close(frame) => Some(AxumMessage::Close(frame.map(|frame| {
            axum::extract::ws::CloseFrame {
                code: frame.code.into(),
                reason: frame.reason.to_string().into(),
            }
        }))),
        TungsteniteMessage::Frame(_) => None,
    }
}

fn filtered_headers(headers: &HeaderMap, tunnel: Option<&Tunnel>) -> HeaderMap {
    let mut filtered = HeaderMap::new();
    for (name, value) in headers {
        if hop_by_hop(name) || name.as_str().starts_with("sec-websocket-") {
            continue;
        }
        if name == header::COOKIE
            && let Some(tunnel) = tunnel
        {
            let retained = value
                .to_str()
                .unwrap_or_default()
                .split(';')
                .map(str::trim)
                .filter(|pair| !pair.starts_with(&format!("{}=", cookie_name(&tunnel.id))))
                .collect::<Vec<_>>()
                .join("; ");
            if !retained.is_empty()
                && let Ok(value) = HeaderValue::from_str(&retained)
            {
                filtered.append(name, value);
            }
            continue;
        }
        filtered.append(name, value.clone());
    }
    filtered
}

fn hop_by_hop(name: &HeaderName) -> bool {
    matches!(
        name.as_str(),
        "authorization"
            | "connection"
            | "host"
            | "keep-alive"
            | "proxy-authenticate"
            | "proxy-authorization"
            | "te"
            | "trailer"
            | "transfer-encoding"
            | "upgrade"
    )
}

fn browser_cookie(headers: &HeaderMap, tunnel: &Tunnel, path: &str) -> String {
    let secure = headers
        .get("x-forwarded-proto")
        .and_then(|value| value.to_str().ok())
        .is_some_and(|value| value.eq_ignore_ascii_case("https"));
    let max_age = ((tunnel.expires_at.saturating_sub(unix_time_ms())) / 1_000).max(1);
    format!(
        "{}={}; Path={path}; HttpOnly; SameSite=Strict{}; Max-Age={max_age}",
        cookie_name(&tunnel.id),
        tunnel.browser_token,
        if secure { "; Secure" } else { "" },
    )
}

fn cookie(headers: &HeaderMap, name: &str) -> Option<String> {
    headers
        .get_all(header::COOKIE)
        .iter()
        .filter_map(|value| value.to_str().ok())
        .flat_map(|value| value.split(';'))
        .find_map(|pair| {
            let (candidate, value) = pair.trim().split_once('=')?;
            (candidate == name).then(|| value.to_owned())
        })
}

fn cookie_name(id: &str) -> String {
    format!("codex_tunnel_{id}")
}

fn random_token(bytes: usize) -> Result<String, TunnelError> {
    let mut value = vec![0_u8; bytes];
    rand::rngs::OsRng
        .try_fill_bytes(&mut value)
        .map_err(|_| TunnelError::Unavailable)?;
    Ok(URL_SAFE_NO_PAD.encode(value))
}

fn unix_time_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
        .try_into()
        .unwrap_or(u64::MAX)
}

async fn wait_revoked(mut revoked: watch::Receiver<bool>) {
    if *revoked.borrow() {
        return;
    }
    while revoked.changed().await.is_ok() {
        if *revoked.borrow() {
            return;
        }
    }
}

fn constant_time_eq(left: &[u8], right: &[u8]) -> bool {
    if left.len() != right.len() {
        return false;
    }
    left.iter()
        .zip(right)
        .fold(0_u8, |difference, (left, right)| {
            difference | (left ^ right)
        })
        == 0
}

#[cfg(test)]
mod tests {
    use super::*;

    fn two_phase_stream()
    -> futures_util::stream::BoxStream<'static, Result<bytes::Bytes, reqwest::Error>> {
        stream::unfold(0_u8, |phase| async move {
            match phase {
                0 => Some((Ok(bytes::Bytes::from_static(b"first")), 1)),
                _ => std::future::pending().await,
            }
        })
        .boxed()
    }

    #[tokio::test]
    async fn browser_cookie_is_scoped_to_the_requested_versioned_tunnel_path() {
        let Ok(service) = LocalhostTunnelService::new() else {
            panic!("localhost proxy client should be constructible");
        };
        let Ok(created) = service.create(80, Some(30)).await else {
            panic!("tunnel should be constructible");
        };
        let Ok(tunnel) = service.tunnel(&created.id).await else {
            panic!("created tunnel should be readable");
        };
        let headers = HeaderMap::new();

        let v1_path = format!("/v1/tunnels/{}/", created.id);
        let v2_path = format!("/v2/tunnels/{}/", created.id);

        assert!(browser_cookie(&headers, &tunnel, &v1_path).contains(&format!("Path={v1_path};")));
        assert!(browser_cookie(&headers, &tunnel, &v2_path).contains(&format!("Path={v2_path};")));
    }

    #[tokio::test]
    async fn ttl_and_port_validation_are_strict() {
        let Ok(service) = LocalhostTunnelService::new() else {
            panic!("localhost proxy client should be constructible");
        };
        assert!(matches!(
            service.create(0, None).await,
            Err(TunnelError::InvalidPort)
        ));
        assert!(matches!(
            service.create(80, Some(29)).await,
            Err(TunnelError::InvalidTtl)
        ));
        assert!(matches!(
            service.create(80, Some(3601)).await,
            Err(TunnelError::InvalidTtl)
        ));
        assert!(service.create(80, Some(30)).await.is_ok());
    }

    #[tokio::test]
    async fn revoke_ends_an_already_streaming_http_response() {
        let (revoke, revoked) = watch::channel(false);
        let output = cancellable_response_stream(
            two_phase_stream(),
            revoked,
            tokio::time::Instant::now() + Duration::from_secs(30),
            None,
            MAX_TRANSFER_BYTES,
            TRANSFER_IDLE_TIMEOUT,
        );
        futures_util::pin_mut!(output);
        assert_eq!(
            output
                .next()
                .await
                .transpose()
                .unwrap_or_else(|error| panic!("{error}")),
            Some(bytes::Bytes::from_static(b"first"))
        );
        assert!(revoke.send(true).is_ok());
        assert!(
            tokio::time::timeout(Duration::from_secs(1), output.next())
                .await
                .is_ok_and(|item| item.is_none())
        );
    }

    #[tokio::test]
    async fn expiry_ends_an_already_streaming_http_response() {
        let (_revoke, revoked) = watch::channel(false);
        let output = cancellable_response_stream(
            two_phase_stream(),
            revoked,
            tokio::time::Instant::now() + Duration::from_millis(10),
            None,
            MAX_TRANSFER_BYTES,
            TRANSFER_IDLE_TIMEOUT,
        );
        futures_util::pin_mut!(output);
        assert_eq!(
            output
                .next()
                .await
                .transpose()
                .unwrap_or_else(|error| panic!("{error}")),
            Some(bytes::Bytes::from_static(b"first"))
        );
        assert!(
            tokio::time::timeout(Duration::from_secs(1), output.next())
                .await
                .is_ok_and(|item| item.is_none())
        );
    }

    #[tokio::test]
    async fn tunnel_registry_enforces_owner_and_global_caps_atomically() {
        let service = LocalhostTunnelService::new_with_limits(TunnelLimits {
            global_tunnels: 2,
            owner_tunnels: 1,
            global_active: 2,
            owner_active: 1,
        })
        .unwrap_or_else(|error| panic!("{error}"));
        assert!(
            service
                .create_for_device(80, Some(30), Some("device-a".to_owned()))
                .await
                .is_ok()
        );
        assert!(matches!(
            service
                .create_for_device(81, Some(30), Some("device-a".to_owned()))
                .await,
            Err(TunnelError::Capacity)
        ));
        assert!(
            service
                .create_for_device(82, Some(30), Some("device-b".to_owned()))
                .await
                .is_ok()
        );
        assert!(matches!(
            service
                .create_for_device(83, Some(30), Some("device-c".to_owned()))
                .await,
            Err(TunnelError::Capacity)
        ));
    }

    #[tokio::test]
    async fn concurrent_tunnel_creation_cannot_overbook_capacity() {
        let service = LocalhostTunnelService::new_with_limits(TunnelLimits {
            global_tunnels: 1,
            owner_tunnels: 1,
            global_active: 1,
            owner_active: 1,
        })
        .unwrap_or_else(|error| panic!("{error}"));
        let barrier = Arc::new(tokio::sync::Barrier::new(8));
        let mut tasks = Vec::new();
        for port in 80_u32..88 {
            let service = service.clone();
            let barrier = barrier.clone();
            tasks.push(tokio::spawn(async move {
                barrier.wait().await;
                service
                    .create_for_device(port, Some(30), Some("device-a".to_owned()))
                    .await
            }));
        }
        let mut admitted = 0;
        for task in tasks {
            match task.await.unwrap_or_else(|error| panic!("{error}")) {
                Ok(_) => admitted += 1,
                Err(TunnelError::Capacity) => {}
                Err(error) => panic!("unexpected error: {error}"),
            }
        }
        assert_eq!(admitted, 1);
    }

    #[cfg(feature = "e2e-command-fault")]
    #[tokio::test]
    async fn e2e_expiry_requires_the_exact_tunnel_owner() -> Result<(), Box<dyn std::error::Error>>
    {
        let service = LocalhostTunnelService::new()?;
        let created = service
            .create_for_device(80, Some(300), Some("device-a".to_owned()))
            .await?;
        assert!(matches!(
            service.expire_for_e2e(&created.id, "device-b").await,
            Err(TunnelError::Unauthorized)
        ));
        assert!(service.tunnel(&created.id).await.is_ok());
        service.expire_for_e2e(&created.id, "device-a").await?;
        assert!(matches!(
            service.tunnel(&created.id).await,
            Err(TunnelError::NotFound)
        ));
        Ok(())
    }

    #[tokio::test]
    async fn expiry_cleanup_revokes_active_handles_and_releases_registry_capacity() {
        let service = LocalhostTunnelService::new_with_limits(TunnelLimits {
            global_tunnels: 1,
            owner_tunnels: 1,
            global_active: 1,
            owner_active: 1,
        })
        .unwrap_or_else(|error| panic!("{error}"));
        let created = service
            .create_for_device(80, Some(30), Some("device-a".to_owned()))
            .await
            .unwrap_or_else(|error| panic!("{error}"));
        let mut revoked = service
            .tunnel(&created.id)
            .await
            .unwrap_or_else(|error| panic!("{error}"))
            .revoked();
        if let Some(tunnel) = service.tunnels.lock().await.get_mut(&created.id) {
            tunnel.expires_at = 0;
        }
        service.purge_expired().await;
        revoked
            .changed()
            .await
            .unwrap_or_else(|error| panic!("{error}"));
        assert!(*revoked.borrow());
        assert!(
            service
                .create_for_device(81, Some(30), Some("device-a".to_owned()))
                .await
                .is_ok()
        );
    }

    #[tokio::test]
    async fn device_revocation_signals_every_owned_tunnel_handle() {
        let service = LocalhostTunnelService::new().unwrap_or_else(|error| panic!("{error}"));
        let first = service
            .create_for_device(80, Some(30), Some("device-a".to_owned()))
            .await
            .unwrap_or_else(|error| panic!("{error}"));
        let second = service
            .create_for_device(81, Some(30), Some("device-b".to_owned()))
            .await
            .unwrap_or_else(|error| panic!("{error}"));
        let mut revoked = service
            .tunnel(&first.id)
            .await
            .unwrap_or_else(|error| panic!("{error}"))
            .revoked();
        service.revoke_device_tunnels("device-a").await;
        revoked
            .changed()
            .await
            .unwrap_or_else(|error| panic!("{error}"));
        assert!(*revoked.borrow());
        assert!(matches!(
            service.tunnel(&first.id).await,
            Err(TunnelError::NotFound)
        ));
        assert!(service.tunnel(&second.id).await.is_ok());
    }

    #[tokio::test]
    async fn active_traffic_caps_are_per_owner_and_global() {
        let service = LocalhostTunnelService::new_with_limits(TunnelLimits {
            global_tunnels: 4,
            owner_tunnels: 2,
            global_active: 2,
            owner_active: 1,
        })
        .unwrap_or_else(|error| panic!("{error}"));
        let first_id = service
            .create_for_device(80, Some(30), Some("device-a".to_owned()))
            .await
            .unwrap_or_else(|error| panic!("{error}"))
            .id;
        let second_id = service
            .create_for_device(81, Some(30), Some("device-a".to_owned()))
            .await
            .unwrap_or_else(|error| panic!("{error}"))
            .id;
        let third_id = service
            .create_for_device(82, Some(30), Some("device-b".to_owned()))
            .await
            .unwrap_or_else(|error| panic!("{error}"))
            .id;
        let first = service
            .tunnel(&first_id)
            .await
            .unwrap_or_else(|error| panic!("{error}"));
        let second = service
            .tunnel(&second_id)
            .await
            .unwrap_or_else(|error| panic!("{error}"));
        let third = service
            .tunnel(&third_id)
            .await
            .unwrap_or_else(|error| panic!("{error}"));
        let first_permit = service
            .acquire_traffic(&first)
            .await
            .unwrap_or_else(|error| panic!("{error}"));
        assert!(matches!(
            service.acquire_traffic(&second).await,
            Err(TunnelError::Capacity)
        ));
        let third_permit = service
            .acquire_traffic(&third)
            .await
            .unwrap_or_else(|error| panic!("{error}"));
        drop(first_permit);
        drop(third_permit);
        assert!(service.acquire_traffic(&second).await.is_ok());
    }

    #[tokio::test]
    async fn response_stream_enforces_size_and_idle_bounds() {
        let (_revoke, revoked) = watch::channel(false);
        let oversized = cancellable_response_stream(
            two_phase_stream(),
            revoked,
            tokio::time::Instant::now() + Duration::from_secs(1),
            None,
            4,
            Duration::from_secs(1),
        );
        futures_util::pin_mut!(oversized);
        assert!(oversized.next().await.is_some_and(|item| item.is_err()));

        let (_revoke, revoked) = watch::channel(false);
        let idle = cancellable_response_stream(
            stream::pending().boxed(),
            revoked,
            tokio::time::Instant::now() + Duration::from_secs(1),
            None,
            16,
            Duration::from_millis(10),
        );
        futures_util::pin_mut!(idle);
        assert!(
            tokio::time::timeout(Duration::from_secs(1), idle.next())
                .await
                .is_ok_and(|item| item.is_some_and(|item| item.is_err()))
        );
    }

    #[tokio::test]
    async fn request_stream_enforces_size_and_idle_bounds() {
        let oversized = bounded_request_stream(
            Body::from("hello"),
            4,
            Duration::from_secs(1),
            Duration::from_secs(1),
        );
        futures_util::pin_mut!(oversized);
        assert!(oversized.next().await.is_some_and(|item| item.is_err()));

        let idle_body =
            Body::from_stream(stream::pending::<Result<bytes::Bytes, std::io::Error>>());
        let idle = bounded_request_stream(
            idle_body,
            16,
            Duration::from_millis(10),
            Duration::from_secs(1),
        );
        futures_util::pin_mut!(idle);
        assert!(
            tokio::time::timeout(Duration::from_secs(1), idle.next())
                .await
                .is_ok_and(|item| item.is_some_and(|item| item.is_err()))
        );
    }
}
