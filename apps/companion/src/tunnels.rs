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
use futures_util::{SinkExt, StreamExt};
use rand::TryRngCore;
use serde::Serialize;
use tokio::sync::{Mutex, watch};
use tokio_tungstenite::{
    MaybeTlsStream, WebSocketStream, connect_async,
    tungstenite::{
        Message as TungsteniteMessage,
        client::IntoClientRequest,
        protocol::{CloseFrame, frame::coding::CloseCode},
    },
};

const MIN_TTL_SECONDS: u64 = 30;
const MAX_TTL_SECONDS: u64 = 60 * 60;
const DEFAULT_TTL_SECONDS: u64 = 300;

#[derive(Clone)]
pub struct LocalhostTunnelService {
    tunnels: Arc<Mutex<HashMap<String, Tunnel>>>,
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
}

impl Tunnel {
    #[must_use]
    pub fn revoked(&self) -> watch::Receiver<bool> {
        self.revoked.clone()
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
}

impl IntoResponse for TunnelError {
    fn into_response(self) -> Response {
        let status = match self {
            Self::InvalidPort | Self::InvalidTtl => StatusCode::BAD_REQUEST,
            Self::NotFound => StatusCode::NOT_FOUND,
            Self::Unauthorized => StatusCode::UNAUTHORIZED,
            Self::Unavailable => StatusCode::BAD_GATEWAY,
            Self::Timeout => StatusCode::GATEWAY_TIMEOUT,
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
        let client = reqwest::Client::builder()
            .connect_timeout(Duration::from_secs(10))
            .timeout(Duration::from_hours(1))
            .redirect(reqwest::redirect::Policy::none())
            .build()
            .map_err(|_| TunnelError::Unavailable)?;
        Ok(Self {
            tunnels: Arc::new(Mutex::new(HashMap::new())),
            client,
        })
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
        let tunnel = Tunnel {
            id: id.clone(),
            port,
            expires_at,
            browser_token,
            revoked,
            revoke,
        };
        self.purge_expired().await;
        self.tunnels.lock().await.insert(id.clone(), tunnel);
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
        set_browser_cookie: bool,
    ) -> Result<Response, TunnelError> {
        let url = format!("http://127.0.0.1:{}{target_path}", tunnel.port);
        let mut request = self
            .client
            .request(method, url)
            .headers(filtered_headers(headers, Some(&tunnel)))
            .body(reqwest::Body::wrap_stream(body.into_data_stream()));
        if let Ok(value) = HeaderValue::from_str(&format!("127.0.0.1:{}", tunnel.port)) {
            request = request.header(header::HOST, value);
        }
        let response = tokio::select! {
            result = request.send() => result.map_err(|error| {
                if error.is_timeout() { TunnelError::Timeout } else { TunnelError::Unavailable }
            })?,
            () = wait_revoked(tunnel.revoked.clone()) => return Err(TunnelError::NotFound),
        };
        let status = response.status();
        let mut response_headers = filtered_headers(response.headers(), None);
        if set_browser_cookie {
            let value = browser_cookie(headers, &tunnel);
            if let Ok(value) = HeaderValue::from_str(&value) {
                response_headers.insert(header::SET_COOKIE, value);
            }
        }
        let stream = response.bytes_stream();
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
    ) -> Result<WebSocketStream<MaybeTlsStream<tokio::net::TcpStream>>, TunnelError> {
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
        let (socket, _) = tokio::time::timeout(Duration::from_secs(10), connect_async(request))
            .await
            .map_err(|_| TunnelError::Timeout)?
            .map_err(|_| TunnelError::Unavailable)?;
        Ok(socket)
    }

    async fn purge_expired(&self) {
        let now = unix_time_ms();
        let mut tunnels = self.tunnels.lock().await;
        tunnels.retain(|_, tunnel| {
            let keep = tunnel.expires_at > now && !*tunnel.revoked.borrow();
            if !keep {
                let _ = tunnel.revoke.send(true);
            }
            keep
        });
    }
}

pub async fn bridge_websocket(
    mut client: WebSocket,
    mut upstream: WebSocketStream<MaybeTlsStream<tokio::net::TcpStream>>,
    mut revoked: watch::Receiver<bool>,
) {
    loop {
        tokio::select! {
            message = client.recv() => {
                let Some(Ok(message)) = message else { break };
                let message = axum_to_tungstenite(message);
                if upstream.send(message).await.is_err() { break; }
                if upstream.flush().await.is_err() { break; }
            }
            message = upstream.next() => {
                let Some(Ok(message)) = message else { break };
                let Some(message) = tungstenite_to_axum(message) else { break };
                if client.send(message).await.is_err() { break; }
            }
            changed = revoked.changed() => {
                if changed.is_err() || *revoked.borrow() { break; }
            }
        }
    }
    let _ = client
        .send(AxumMessage::Close(Some(axum::extract::ws::CloseFrame {
            code: 1000,
            reason: "tunnel_closed".into(),
        })))
        .await;
    let _ = upstream
        .send(TungsteniteMessage::Close(Some(CloseFrame {
            code: CloseCode::Normal,
            reason: "tunnel_closed".into(),
        })))
        .await;
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

fn browser_cookie(headers: &HeaderMap, tunnel: &Tunnel) -> String {
    let secure = headers
        .get("x-forwarded-proto")
        .and_then(|value| value.to_str().ok())
        .is_some_and(|value| value.eq_ignore_ascii_case("https"));
    let max_age = ((tunnel.expires_at.saturating_sub(unix_time_ms())) / 1_000).max(1);
    format!(
        "{}={}; Path=/v1/tunnels/{}/; HttpOnly; SameSite=Strict{}; Max-Age={max_age}",
        cookie_name(&tunnel.id),
        tunnel.browser_token,
        tunnel.id,
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
}
