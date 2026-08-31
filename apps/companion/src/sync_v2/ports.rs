//! Versioned V2 localhost port and tunnel adapters.

use std::time::Duration;

use axum::{
    Json, Router,
    extract::{
        FromRequestParts, Path, Request, State, WebSocketUpgrade,
        ws::{CloseFrame, Message, WebSocket},
    },
    http::{HeaderMap, Method, StatusCode},
    response::{IntoResponse, Response},
    routing::{any, get, post},
};
use futures_util::SinkExt;
use serde_json::Value;
use tokio::io::{AsyncReadExt, AsyncWriteExt};

use crate::{
    ports,
    server::{AppState, Authorization, authorization_for_scope},
    session_authority::SessionAuthority,
    tunnels::TunnelError,
};

use super::{
    http,
    protocol::{
        PortDescriptor, PortsResponse, TransportErrorCode, TunnelCreateRequest,
        TunnelCreateResponse,
    },
};

pub(crate) fn routes() -> Router<AppState> {
    Router::new()
        .route("/v2/ports", get(port_discovery))
        .route("/v2/ports/{port}", get(port_forward_upgrade))
        .route("/v2/tunnels", post(tunnel_create))
        .route("/v2/tunnels/{id}", any(tunnel_exact))
        .route("/v2/tunnels/{id}/", any(tunnel_proxy_root))
        .route("/v2/tunnels/{id}/{*path}", any(tunnel_proxy))
}

async fn port_discovery(State(state): State<AppState>, headers: HeaderMap) -> Response {
    if authorization(&state, &headers).await.is_none() {
        return unauthorized();
    }
    let discovered = ports::discover(state.services.excluded_ports.into_iter().collect()).await;
    let response = PortsResponse {
        ports: discovered
            .into_iter()
            .map(|port| PortDescriptor {
                port: port.port,
                name: port.name,
                group: port.group,
                details: port.details,
                process: port.process,
                pid: port.pid,
                cwd: port.cwd,
                kind: port.kind.to_owned(),
                forwarding_key: port.forwarding_key,
                default_forwarding_enabled: port.default_forwarding_enabled,
            })
            .collect(),
        scanned_at: ports::unix_time_ms(),
    };
    http::response(StatusCode::OK, "portsResponse", &response)
}

async fn port_forward_upgrade(
    State(state): State<AppState>,
    Path(port): Path<u16>,
    upgrade: WebSocketUpgrade,
    headers: HeaderMap,
) -> Response {
    let Some(authorization) = authorization(&state, &headers).await else {
        return unauthorized();
    };
    let changes = match &state.authorization {
        Authorization::Registry(registry) => Some(registry.subscribe_authorization_changes()),
        Authorization::AdminOnly(_) => None,
    };
    let Some(mut authority) = SessionAuthority::new(&authorization, changes) else {
        return unauthorized();
    };
    let stream = match tokio::time::timeout(
        Duration::from_secs(10),
        tokio::net::TcpStream::connect(("127.0.0.1", port)),
    )
    .await
    {
        Ok(Ok(stream)) => stream,
        Ok(Err(_)) => return unavailable("localhost unavailable"),
        Err(_) => return unavailable("localhost timeout"),
    };
    if !authority.is_valid() {
        return http::error(
            StatusCode::FORBIDDEN,
            TransportErrorCode::Forbidden,
            "port forwarding session authorization unavailable",
        );
    }
    upgrade
        .max_message_size(1024 * 1024)
        .max_frame_size(1024 * 1024)
        .on_upgrade(move |socket| async move {
            bridge_port(socket, stream, &mut authority, Duration::from_secs(15)).await;
        })
}

async fn tunnel_create(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(value): Json<Value>,
) -> Response {
    let request: TunnelCreateRequest = match http::parse("tunnelCreateRequest", value) {
        Ok(request) => request,
        Err(_) => return http::InvalidRequest::response(),
    };
    let Some(tunnels) = state.services.tunnels.clone() else {
        return unavailable("tunnel service unavailable");
    };
    let Some(authorization) = authorization(&state, &headers).await else {
        return unauthorized();
    };
    let changes = match &state.authorization {
        Authorization::Registry(registry) => Some(registry.subscribe_authorization_changes()),
        Authorization::AdminOnly(_) => None,
    };
    let Some(mut authority) = SessionAuthority::new(&authorization, changes) else {
        return unauthorized();
    };
    match tunnels
        .create_for_device(
            u32::from(request.port),
            request.ttl_seconds,
            authorization.device_id().map(str::to_owned),
        )
        .await
    {
        Ok(created) => {
            let created = TunnelCreateResponse {
                id: created.id.clone(),
                expires_at: created.expires_at,
                base_path: format!("/v2/tunnels/{}/", created.id),
            };
            if !authority.is_valid() {
                let _ = tunnels.revoke(&created.id).await;
                return http::error(
                    StatusCode::FORBIDDEN,
                    TransportErrorCode::Forbidden,
                    "tunnel session authorization unavailable",
                );
            }
            let tunnel_id = created.id.clone();
            let tunnels = tunnels.clone();
            tokio::spawn(async move {
                authority.revoked().await;
                let _ = tunnels.revoke(&tunnel_id).await;
            });
            http::response(StatusCode::CREATED, "tunnelCreateResponse", &created)
        }
        Err(error) => tunnel_error(&error),
    }
}

async fn tunnel_exact(
    State(state): State<AppState>,
    Path(id): Path<String>,
    method: Method,
    headers: HeaderMap,
) -> Response {
    if method != Method::DELETE {
        return not_found();
    }
    let Some(tunnels) = state.services.tunnels.clone() else {
        return unavailable("tunnel service unavailable");
    };
    let Some(authorization) = authorization(&state, &headers).await else {
        return unauthorized();
    };
    let tunnel = match tunnels.tunnel(&id).await {
        Ok(tunnel) => tunnel,
        Err(error) => return tunnel_error(&error),
    };
    if !same_owner(tunnel.owner_device_id(), authorization.device_id()) {
        return forbidden();
    }
    let revoked = tunnels.revoke(&id).await;
    let status = if revoked {
        StatusCode::NO_CONTENT
    } else {
        StatusCode::NOT_FOUND
    };
    status.into_response()
}

async fn tunnel_proxy_root(
    state: State<AppState>,
    path: Path<String>,
    request: Request,
) -> Response {
    tunnel_proxy_inner(state.0, path.0, String::new(), request).await
}

async fn tunnel_proxy(
    State(state): State<AppState>,
    Path((id, path)): Path<(String, String)>,
    request: Request,
) -> Response {
    tunnel_proxy_inner(state, id, path, request).await
}

async fn tunnel_proxy_inner(
    state: AppState,
    id: String,
    path: String,
    request: Request,
) -> Response {
    let Some(tunnels) = state.services.tunnels.clone() else {
        return unavailable("tunnel service unavailable");
    };
    let tunnel = match tunnels.tunnel(&id).await {
        Ok(tunnel) => tunnel,
        Err(error) => return tunnel_error(&error),
    };
    let (mut parts, body) = request.into_parts();
    let bearer = if parts.headers.get("origin").is_none() {
        authorization_for_scope(&state, &parts.headers, "localhost.forward").await
    } else {
        None
    };
    let bearer_authorized = bearer.as_ref().is_some_and(|authorization| {
        same_owner(tunnel.owner_device_id(), authorization.device_id())
    });
    if !bearer_authorized && !tunnels.browser_authorized(&tunnel, &parts.headers) {
        return unauthorized();
    }
    let target_path = format!(
        "/{}{}",
        path,
        parts
            .uri
            .query()
            .map_or(String::new(), |query| format!("?{query}"))
    );
    let websocket_requested = parts
        .headers
        .get("upgrade")
        .and_then(|value| value.to_str().ok())
        .is_some_and(|value| value.eq_ignore_ascii_case("websocket"));
    if websocket_requested {
        let upgrade = match WebSocketUpgrade::from_request_parts(&mut parts, &state).await {
            Ok(upgrade) => upgrade,
            Err(rejection) => return rejection.into_response(),
        };
        let upstream = match tunnels
            .connect_websocket(&tunnel, &target_path, &parts.headers)
            .await
        {
            Ok(upstream) => upstream,
            Err(error) => return tunnel_error(&error),
        };
        let revoked = tunnel.revoked();
        return upgrade
            .max_message_size(16 * 1024 * 1024)
            .max_frame_size(16 * 1024 * 1024)
            .on_upgrade(move |client| crate::tunnels::bridge_websocket(client, upstream, revoked));
    }
    tunnels
        .proxy_http(
            tunnel,
            parts.method,
            &target_path,
            &parts.headers,
            body,
            bearer_authorized,
        )
        .await
        .unwrap_or_else(|error| tunnel_error(&error))
}

async fn authorization(
    state: &AppState,
    headers: &HeaderMap,
) -> Option<crate::auth::AuthorizationContext> {
    if headers.get("origin").is_some() {
        return None;
    }
    authorization_for_scope(state, headers, "localhost.forward").await
}

fn same_owner(tunnel_owner: Option<&str>, requester: Option<&str>) -> bool {
    tunnel_owner == requester || tunnel_owner.is_none() && requester.is_none()
}

fn tunnel_error(error: &TunnelError) -> Response {
    match error {
        TunnelError::InvalidPort | TunnelError::InvalidTtl => http::error(
            StatusCode::BAD_REQUEST,
            TransportErrorCode::InvalidRequest,
            "invalid tunnel request",
        ),
        TunnelError::NotFound => not_found(),
        TunnelError::Unauthorized => unauthorized(),
        TunnelError::Unavailable | TunnelError::Timeout => unavailable("tunnel unavailable"),
    }
}

fn unauthorized() -> Response {
    http::error(
        StatusCode::UNAUTHORIZED,
        TransportErrorCode::Unauthorized,
        "session authorization required",
    )
}

fn forbidden() -> Response {
    http::error(
        StatusCode::FORBIDDEN,
        TransportErrorCode::Forbidden,
        "tunnel belongs to another audience",
    )
}

fn not_found() -> Response {
    http::error(
        StatusCode::NOT_FOUND,
        TransportErrorCode::NotFound,
        "tunnel not found",
    )
}

fn unavailable(message: &'static str) -> Response {
    http::error(
        StatusCode::SERVICE_UNAVAILABLE,
        TransportErrorCode::Unavailable,
        message,
    )
}

async fn bridge_port(
    mut socket: WebSocket,
    mut stream: tokio::net::TcpStream,
    authority: &mut SessionAuthority,
    idle_timeout: Duration,
) {
    const MAX_FRAME_BYTES: usize = 1024 * 1024;
    let mut host_buffer = vec![0_u8; 64 * 1024];
    let idle = tokio::time::sleep(idle_timeout);
    tokio::pin!(idle);
    loop {
        tokio::select! {
            phone = socket.recv() => match phone {
                Some(Ok(Message::Binary(bytes))) if bytes.len() <= MAX_FRAME_BYTES => {
                    if !authority.is_valid() || stream.write_all(&bytes).await.is_err() { break; }
                    idle.as_mut().reset(tokio::time::Instant::now() + idle_timeout);
                }
                Some(Ok(Message::Ping(bytes))) => {
                    if socket.send(Message::Pong(bytes)).await.is_err() { break; }
                }
                Some(Ok(Message::Pong(_))) => {}
                Some(Ok(Message::Close(_)) | Err(_)) | None => break,
                Some(Ok(Message::Text(_) | Message::Binary(_))) => {
                    let _ = socket.send(Message::Close(Some(CloseFrame { code: 1003, reason: "binary_frames_required".into() }))).await;
                    break;
                }
            },
            host = stream.read(&mut host_buffer) => match host {
                Ok(0) | Err(_) => break,
                Ok(bytes) => {
                    if !authority.is_valid() || socket.send(Message::Binary(host_buffer[..bytes].to_vec().into())).await.is_err() { break; }
                    idle.as_mut().reset(tokio::time::Instant::now() + idle_timeout);
                }
            },
            () = authority.revoked() => break,
            () = &mut idle => break,
        }
    }
    let _ = stream.shutdown().await;
    let _ = socket.close().await;
}
