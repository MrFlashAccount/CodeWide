use std::{collections::HashSet, path::PathBuf, sync::Arc, time::Duration};

use axum::{
    Json, Router,
    body::Body,
    extract::{DefaultBodyLimit, FromRequestParts, Path, Query, Request, State, WebSocketUpgrade},
    http::{HeaderMap, Method, StatusCode},
    response::{IntoResponse, Response},
    routing::{any, get, patch, post},
};
use serde::{Deserialize, Serialize};
use serde_json::json;
use tokio::sync::Semaphore;

use crate::{
    auth::{AuthError, AuthorizationContext, DeviceRegistry, PairingClaim, SessionProof},
    build_shelf::BuildShelfProxy,
    content::{ContentQuery, PrivateContentService},
    files::{FileQuery, FileService},
    media::MediaProxyService,
    ports,
    store::IndexStore,
    sync::SyncHub,
    terminal::{self, TerminalQuery},
    tunnels::{LocalhostTunnelService, TunnelError},
    upstream,
};

#[derive(Clone)]
struct AppState {
    store: Arc<IndexStore>,
    authorization: Authorization,
    sync: SyncHub,
    services: CompanionServices,
    allow_admin_data_plane: bool,
    terminal_slots: Arc<Semaphore>,
}

/// Separates the remotely reachable authenticated data plane from the
/// OS-local administrative control plane.
pub struct CompanionRouters {
    pub public: Router,
    pub control: Router,
}

#[derive(Clone, Default)]
pub struct CompanionServices {
    pub build_shelf: Option<BuildShelfProxy>,
    pub files: Option<Arc<FileService>>,
    pub content: Option<Arc<PrivateContentService>>,
    pub media: Option<Arc<MediaProxyService>>,
    pub tunnels: Option<Arc<LocalhostTunnelService>>,
    pub app_server_socket_path: Option<PathBuf>,
    pub excluded_ports: HashSet<u16>,
}

#[derive(Clone)]
enum Authorization {
    AdminOnly(Arc<str>),
    Registry(Arc<DeviceRegistry>),
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Health {
    status: &'static str,
    implementation: &'static str,
    schema_version: u32,
    upstream: &'static str,
}

/// Builds the loopback HTTP and WebSocket surface for one companion instance.
pub fn router(store: Arc<IndexStore>, token: Arc<str>, sync: SyncHub) -> Router {
    build_router(
        store,
        Authorization::AdminOnly(token),
        sync,
        CompanionServices::default(),
    )
}

/// Builds the V1 router with admin-token authorization and host services.
pub fn router_with_services(
    store: Arc<IndexStore>,
    token: Arc<str>,
    sync: SyncHub,
    services: CompanionServices,
) -> Router {
    build_router(store, Authorization::AdminOnly(token), sync, services)
}

/// Builds the complete V1 router backed by durable device pairing and
/// short-lived proof-of-possession sessions.
pub fn router_with_registry(
    store: Arc<IndexStore>,
    registry: Arc<DeviceRegistry>,
    sync: SyncHub,
) -> Router {
    build_router(
        store,
        Authorization::Registry(registry),
        sync,
        CompanionServices::default(),
    )
}

/// Builds the V1 router with host-owned file/media/dictation services.
pub fn router_with_registry_and_services(
    store: Arc<IndexStore>,
    registry: Arc<DeviceRegistry>,
    sync: SyncHub,
    services: CompanionServices,
) -> Router {
    build_router(store, Authorization::Registry(registry), sync, services)
}

/// Builds the production routers. The public router contains one bootstrap
/// auth endpoint plus session-authorized transports. Administrative routes do
/// not exist on it, even when an admin bearer is supplied.
pub fn split_routers_with_registry_and_services(
    store: Arc<IndexStore>,
    registry: Arc<DeviceRegistry>,
    sync: SyncHub,
    services: CompanionServices,
) -> CompanionRouters {
    let state = AppState {
        store,
        authorization: Authorization::Registry(registry),
        sync,
        services,
        allow_admin_data_plane: false,
        terminal_slots: Arc::new(Semaphore::new(8)),
    };
    CompanionRouters {
        public: build_public_router(state.clone()),
        control: build_control_router(state),
    }
}

fn build_router(
    store: Arc<IndexStore>,
    authorization: Authorization,
    sync: SyncHub,
    services: CompanionServices,
) -> Router {
    let state = AppState {
        store,
        authorization,
        sync,
        services,
        allow_admin_data_plane: true,
        terminal_slots: Arc::new(Semaphore::new(8)),
    };
    let core = Router::new()
        .route("/healthz", get(health))
        .route("/readyz", get(readiness))
        .route("/v1/app-server", get(app_server_upgrade))
        .route("/v1/sync", get(sync_upgrade))
        .route("/v1/port-forwards/discovery", get(port_discovery))
        .route("/v1/port-forwards/{port}", get(port_forward_upgrade))
        .route("/v1/terminals", get(terminal_upgrade))
        .route("/v1/tunnels", post(tunnel_create))
        .route("/v1/tunnels/{id}", any(tunnel_exact))
        .route("/v1/tunnels/{id}/", any(tunnel_proxy_root))
        .route("/v1/tunnels/{id}/{*path}", any(tunnel_proxy))
        .route("/v1/pairing/start", post(pairing_start))
        .route("/v1/pairing/claim", post(pairing_claim))
        .route("/v1/sessions/challenge", post(session_challenge))
        .route("/v1/sessions", post(session_create))
        .route("/v1/devices", get(devices_list))
        .route(
            "/v1/devices/{device_id}",
            patch(device_update).delete(device_revoke),
        )
        .layer(DefaultBodyLimit::max(8 * 1024));
    let files = Router::new()
        .route("/v1/files/download", get(file_download).head(file_download))
        .route("/v1/files/preview", get(file_preview).head(file_preview))
        .route(
            "/v1/files/upload",
            axum::routing::put(file_upload)
                .head(file_upload_status)
                .delete(file_upload_cancel),
        )
        .route("/v1/content/{digest}", get(content_read).head(content_read))
        .layer(DefaultBodyLimit::max(512 * 1024 * 1024));
    let media = Router::new()
        .route("/v1/media/materialize", post(media_materialize))
        .route("/v1/media/{id}", get(media_read).head(media_read))
        .layer(DefaultBodyLimit::max(20 * 1024));
    let build_shelf = Router::new()
        .route("/", any(build_shelf_proxy))
        .route("/api/builds", any(build_shelf_proxy))
        .route("/api/updates", any(build_shelf_proxy))
        .route("/api/updates/assets/", any(build_shelf_proxy))
        .route("/api/updates/assets/{*path}", any(build_shelf_proxy))
        .route("/latest.apk", any(build_shelf_proxy))
        .route("/CodeWide.apk", any(build_shelf_proxy))
        .route("/download/", any(build_shelf_proxy))
        .route("/download/{*path}", any(build_shelf_proxy));
    core.merge(files)
        .merge(media)
        .merge(build_shelf)
        .with_state(state)
}

fn build_public_router(state: AppState) -> Router {
    let transport = Router::new()
        .route("/v1/auth", post(authenticate))
        .route("/v1/sync", get(sync_upgrade))
        .route("/v1/port-forwards/discovery", get(port_discovery))
        .route("/v1/port-forwards/{port}", get(port_forward_upgrade))
        .route("/v1/terminals", get(terminal_upgrade))
        .route("/v1/tunnels", post(tunnel_create))
        .route("/v1/tunnels/{id}", any(tunnel_exact))
        .route("/v1/tunnels/{id}/", any(tunnel_proxy_root))
        .route("/v1/tunnels/{id}/{*path}", any(tunnel_proxy))
        .layer(DefaultBodyLimit::max(8 * 1024));
    let files = Router::new()
        .route("/v1/files/download", get(file_download).head(file_download))
        .route("/v1/files/preview", get(file_preview).head(file_preview))
        .route(
            "/v1/files/upload",
            axum::routing::put(file_upload)
                .head(file_upload_status)
                .delete(file_upload_cancel),
        )
        .route("/v1/content/{digest}", get(content_read).head(content_read))
        .layer(DefaultBodyLimit::max(512 * 1024 * 1024));
    let media = Router::new()
        .route("/v1/media/materialize", post(media_materialize))
        .route("/v1/media/{id}", get(media_read).head(media_read))
        .layer(DefaultBodyLimit::max(20 * 1024));
    let build_shelf = Router::new()
        .route("/", any(build_shelf_proxy))
        .route("/api/builds", any(build_shelf_proxy))
        .route("/api/updates", any(build_shelf_proxy))
        .route("/api/updates/assets/", any(build_shelf_proxy))
        .route("/api/updates/assets/{*path}", any(build_shelf_proxy))
        .route("/latest.apk", any(build_shelf_proxy))
        .route("/CodeWide.apk", any(build_shelf_proxy))
        .route("/download/", any(build_shelf_proxy))
        .route("/download/{*path}", any(build_shelf_proxy));
    transport
        .merge(files)
        .merge(media)
        .merge(build_shelf)
        .with_state(state)
}

fn build_control_router(state: AppState) -> Router {
    Router::new()
        .route("/healthz", get(health))
        .route("/readyz", get(readiness))
        .route("/v1/app-server", get(app_server_upgrade))
        .route("/v1/pairing/start", post(pairing_start))
        .route("/v1/devices", get(devices_list))
        .route(
            "/v1/devices/{device_id}",
            patch(device_update).delete(device_revoke),
        )
        .layer(DefaultBodyLimit::max(8 * 1024))
        .with_state(state)
}

async fn build_shelf_proxy(State(state): State<AppState>, request: Request) -> Response {
    let Some(proxy) = state.services.build_shelf else {
        return StatusCode::NOT_FOUND.into_response();
    };
    proxy.proxy(request).await
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CreateTunnelRequest {
    port: u32,
    ttl_seconds: Option<u64>,
}

async fn tunnel_create(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(request): Json<CreateTunnelRequest>,
) -> Response {
    let Some(tunnels) = state.services.tunnels.clone() else {
        return StatusCode::NOT_FOUND.into_response();
    };
    if headers.get("origin").is_some()
        || !authorize_scope(&state, &headers, "localhost.forward").await
    {
        return TunnelError::Unauthorized.into_response();
    }
    tunnels
        .create(request.port, request.ttl_seconds)
        .await
        .map_or_else(IntoResponse::into_response, |created| {
            (StatusCode::CREATED, Json(created)).into_response()
        })
}

async fn tunnel_exact(
    State(state): State<AppState>,
    Path(id): Path<String>,
    method: Method,
    headers: HeaderMap,
) -> Response {
    let Some(tunnels) = state.services.tunnels.clone() else {
        return StatusCode::NOT_FOUND.into_response();
    };
    if method != Method::DELETE {
        return TunnelError::NotFound.into_response();
    }
    if headers.get("origin").is_some()
        || !authorize_scope(&state, &headers, "localhost.forward").await
    {
        return TunnelError::Unauthorized.into_response();
    }
    let revoked = tunnels.revoke(&id).await;
    let status = if revoked {
        StatusCode::OK
    } else {
        StatusCode::NOT_FOUND
    };
    (status, Json(json!({"revoked": revoked}))).into_response()
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
        return StatusCode::NOT_FOUND.into_response();
    };
    let tunnel = match tunnels.tunnel(&id).await {
        Ok(tunnel) => tunnel,
        Err(error) => return error.into_response(),
    };
    let (mut parts, body) = request.into_parts();
    let bearer_authorized = parts.headers.get("origin").is_none()
        && authorize_scope(&state, &parts.headers, "localhost.forward").await;
    if !bearer_authorized && !tunnels.browser_authorized(&tunnel, &parts.headers) {
        return TunnelError::Unauthorized.into_response();
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
            Err(error) => return error.into_response(),
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
        .unwrap_or_else(IntoResponse::into_response)
}

#[derive(Deserialize)]
struct MaterializeMediaRequest {
    url: String,
}

async fn media_materialize(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(request): Json<MaterializeMediaRequest>,
) -> Response {
    let Some(media) = state.services.media.clone() else {
        return StatusCode::NOT_FOUND.into_response();
    };
    if headers.get("origin").is_some()
        || !authorize_scope(&state, &headers, "files.download.workspace").await
    {
        return json_error(StatusCode::UNAUTHORIZED, "unauthorized");
    }
    match media.materialize(&request.url).await {
        Ok(result) => {
            let status = if result.reused {
                StatusCode::OK
            } else {
                StatusCode::CREATED
            };
            (status, Json(result)).into_response()
        }
        Err(error) => error.into_response(),
    }
}

async fn media_read(
    State(state): State<AppState>,
    Path(id): Path<String>,
    headers: HeaderMap,
    method: Method,
) -> Response {
    let Some(media) = state.services.media.clone() else {
        return StatusCode::NOT_FOUND.into_response();
    };
    if headers.get("origin").is_some()
        || !authorize_scope(&state, &headers, "files.download.workspace").await
    {
        return json_error(StatusCode::UNAUTHORIZED, "unauthorized");
    }
    media
        .serve(&id, method == Method::HEAD)
        .unwrap_or_else(IntoResponse::into_response)
}

async fn app_server_upgrade(
    State(state): State<AppState>,
    upgrade: WebSocketUpgrade,
    headers: HeaderMap,
) -> Response {
    if headers.get("origin").is_some() || !authorize_admin(&state.authorization, &headers).await {
        return json_error(StatusCode::UNAUTHORIZED, "admin_authorization_required");
    }
    let Some(path) = state.services.app_server_socket_path else {
        return json_error(StatusCode::SERVICE_UNAVAILABLE, "app_server_unavailable");
    };
    let Ok(Ok(upstream)) = tokio::time::timeout(
        Duration::from_secs(10),
        upstream::connect_raw_app_server(&path),
    )
    .await
    else {
        return json_error(StatusCode::BAD_GATEWAY, "app_server_unavailable");
    };
    upgrade
        .max_message_size(16 * 1024 * 1024)
        .on_upgrade(move |socket| upstream::bridge_raw_app_server(socket, upstream))
}

async fn port_discovery(State(state): State<AppState>, headers: HeaderMap) -> Response {
    if headers.get("origin").is_some()
        || !authorize_scope(&state, &headers, "localhost.forward").await
    {
        return json_error(StatusCode::UNAUTHORIZED, "unauthorized");
    }
    let ports = ports::discover(state.services.excluded_ports.into_iter().collect()).await;
    (
        [("cache-control", "no-store")],
        Json(json!({"ports": ports, "scannedAt": ports::unix_time_ms()})),
    )
        .into_response()
}

async fn port_forward_upgrade(
    State(state): State<AppState>,
    Path(port): Path<u16>,
    upgrade: WebSocketUpgrade,
    headers: HeaderMap,
) -> Response {
    if headers.get("origin").is_some()
        || !authorize_scope(&state, &headers, "localhost.forward").await
    {
        return json_error(StatusCode::UNAUTHORIZED, "unauthorized");
    }
    let target = match tokio::time::timeout(
        Duration::from_secs(10),
        tokio::net::TcpStream::connect(("127.0.0.1", port)),
    )
    .await
    {
        Ok(Ok(target)) => target,
        Ok(Err(_)) => return json_error(StatusCode::BAD_GATEWAY, "localhost_unavailable"),
        Err(_) => return json_error(StatusCode::GATEWAY_TIMEOUT, "localhost_timeout"),
    };
    upgrade
        .max_message_size(1024 * 1024)
        .on_upgrade(move |socket| ports::bridge_tcp(socket, target))
}

async fn terminal_upgrade(
    State(state): State<AppState>,
    Query(query): Query<TerminalQuery>,
    upgrade: WebSocketUpgrade,
    headers: HeaderMap,
) -> Response {
    if headers.get("origin").is_some() || !authorize_scope(&state, &headers, "shell.explicit").await
    {
        return json_error(StatusCode::FORBIDDEN, "shell_explicit_scope_required");
    }
    let Ok(permit) = state.terminal_slots.clone().try_acquire_owned() else {
        return json_error(StatusCode::TOO_MANY_REQUESTS, "terminal_limit_reached");
    };
    let session = match terminal::TerminalSession::spawn(&query) {
        Ok(session) => session,
        Err(error) => return json_error(error.status(), error.code()),
    };
    upgrade
        .max_message_size(1024 * 1024)
        .on_upgrade(move |socket| async move {
            let _permit = permit;
            terminal::bridge(socket, session).await;
        })
}

async fn content_read(
    State(state): State<AppState>,
    Path(digest): Path<String>,
    Query(query): Query<ContentQuery>,
    headers: HeaderMap,
    method: Method,
) -> Response {
    let Some(content) = state.services.content.clone() else {
        return StatusCode::NOT_FOUND.into_response();
    };
    if headers.get("origin").is_some()
        || !authorize_scope(&state, &headers, "files.download.workspace").await
    {
        return json_error(StatusCode::UNAUTHORIZED, "unauthorized");
    }
    content
        .serve(&digest, query, &headers, method == Method::HEAD)
        .await
        .unwrap_or_else(IntoResponse::into_response)
}

async fn file_download(
    State(state): State<AppState>,
    Query(query): Query<FileQuery>,
    headers: HeaderMap,
    method: Method,
) -> Response {
    file_read(state, query, headers, method == Method::HEAD, false).await
}

async fn file_preview(
    State(state): State<AppState>,
    Query(query): Query<FileQuery>,
    headers: HeaderMap,
    method: Method,
) -> Response {
    file_read(state, query, headers, method == Method::HEAD, true).await
}

async fn file_read(
    state: AppState,
    query: FileQuery,
    headers: HeaderMap,
    head_only: bool,
    preview: bool,
) -> Response {
    let Some(files) = state.services.files.clone() else {
        return StatusCode::NOT_FOUND.into_response();
    };
    if headers.get("origin").is_some()
        || !authorize_scope(&state, &headers, "files.download.workspace").await
    {
        return json_error(StatusCode::UNAUTHORIZED, "unauthorized");
    }
    match files.download(query, &headers, head_only, preview).await {
        Ok(response) => response,
        Err(error) => error.into_response(),
    }
}

async fn file_upload_status(
    State(state): State<AppState>,
    Query(query): Query<FileQuery>,
    headers: HeaderMap,
) -> Response {
    let Some(files) = state.services.files.clone() else {
        return StatusCode::NOT_FOUND.into_response();
    };
    if !file_upload_authorized(&state, &headers).await {
        return json_error(StatusCode::UNAUTHORIZED, "unauthorized");
    }
    files
        .upload_status(query, &headers)
        .await
        .unwrap_or_else(IntoResponse::into_response)
}

async fn file_upload_cancel(
    State(state): State<AppState>,
    Query(query): Query<FileQuery>,
    headers: HeaderMap,
) -> Response {
    let Some(files) = state.services.files.clone() else {
        return StatusCode::NOT_FOUND.into_response();
    };
    if !file_upload_authorized(&state, &headers).await {
        return json_error(StatusCode::UNAUTHORIZED, "unauthorized");
    }
    files
        .cancel_upload(query, &headers)
        .await
        .unwrap_or_else(IntoResponse::into_response)
}

async fn file_upload(
    State(state): State<AppState>,
    Query(query): Query<FileQuery>,
    headers: HeaderMap,
    body: Body,
) -> Response {
    let Some(files) = state.services.files.clone() else {
        return StatusCode::NOT_FOUND.into_response();
    };
    if !file_upload_authorized(&state, &headers).await {
        return json_error(StatusCode::UNAUTHORIZED, "unauthorized");
    }
    files
        .upload(query, &headers, body)
        .await
        .unwrap_or_else(IntoResponse::into_response)
}

async fn file_upload_authorized(state: &AppState, headers: &HeaderMap) -> bool {
    headers.get("origin").is_none()
        && authorize_scope(state, headers, "files.upload.workspace").await
}

async fn sync_upgrade(
    State(state): State<AppState>,
    headers: HeaderMap,
    upgrade: WebSocketUpgrade,
) -> Response {
    let mut authorization_changes = match &state.authorization {
        Authorization::Registry(registry) => Some(registry.subscribe_authorization_changes()),
        Authorization::AdminOnly(_) => None,
    };
    let authorization = authorize_sync(&state, &headers).await;
    if headers.get("origin").is_some() || authorization.is_none() {
        return StatusCode::UNAUTHORIZED.into_response();
    }
    let authorization = authorization.unwrap_or(AuthorizationContext::Admin);
    if authorization.device_id().is_none() {
        authorization_changes = None;
    }
    upgrade
        .max_message_size(64 * 1024 * 1024)
        .max_frame_size(64 * 1024 * 1024)
        .on_upgrade(move |socket| {
            state
                .sync
                .serve(socket, authorization, authorization_changes)
        })
}

#[derive(Deserialize)]
#[serde(
    tag = "action",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
enum AuthRequest {
    Register {
        pairing_token: String,
        device_name: String,
        public_key_spki: String,
        proof: String,
    },
    Challenge,
    Session {
        challenge_id: String,
        signature: String,
    },
}

/// The only remotely reachable authentication bootstrap. Registration consumes
/// a one-use invitation and proves possession of the submitted device key;
/// subsequent actions mint short-lived sessions for that same registered key.
async fn authenticate(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(request): Json<AuthRequest>,
) -> Response {
    let Some(registry) = registry(&state.authorization) else {
        return StatusCode::NOT_FOUND.into_response();
    };
    if headers.get("origin").is_some() {
        return json_error(StatusCode::UNAUTHORIZED, "browser_origin_rejected");
    }
    match request {
        AuthRequest::Register {
            pairing_token,
            device_name,
            public_key_spki,
            proof,
        } => registry
            .claim(PairingClaim {
                pairing_token,
                device_name,
                public_key_spki,
                proof,
            })
            .await
            .map_or_else(
                |error| auth_error(&error),
                |result| (StatusCode::CREATED, Json(result)).into_response(),
            ),
        AuthRequest::Challenge => registry.challenge(header_auth(&headers)).await.map_or_else(
            |error| auth_error(&error),
            |result| (StatusCode::CREATED, Json(result)).into_response(),
        ),
        AuthRequest::Session {
            challenge_id,
            signature,
        } => registry
            .create_session(
                header_auth(&headers),
                SessionProof {
                    challenge_id,
                    signature,
                },
            )
            .await
            .map_or_else(
                |error| auth_error(&error),
                |result| (StatusCode::CREATED, Json(result)).into_response(),
            ),
    }
}

async fn pairing_start(State(state): State<AppState>, headers: HeaderMap) -> Response {
    let Some(registry) = registry(&state.authorization) else {
        return StatusCode::NOT_FOUND.into_response();
    };
    if headers.get("origin").is_some() || !registry.authorize_admin(header_auth(&headers)).await {
        return json_error(StatusCode::UNAUTHORIZED, "admin_authorization_required");
    }
    match registry.create_pairing().await {
        Ok(pairing) => (StatusCode::CREATED, Json(pairing)).into_response(),
        Err(error) => auth_error(&error),
    }
}

async fn pairing_claim(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(claim): Json<PairingClaim>,
) -> Response {
    let Some(registry) = registry(&state.authorization) else {
        return StatusCode::NOT_FOUND.into_response();
    };
    if headers.get("origin").is_some() {
        return json_error(StatusCode::UNAUTHORIZED, "browser_origin_rejected");
    }
    match registry.claim(claim).await {
        Ok(result) => (StatusCode::CREATED, Json(result)).into_response(),
        Err(error) => auth_error(&error),
    }
}

async fn session_challenge(State(state): State<AppState>, headers: HeaderMap) -> Response {
    let Some(registry) = registry(&state.authorization) else {
        return StatusCode::NOT_FOUND.into_response();
    };
    if headers.get("origin").is_some() {
        return json_error(StatusCode::UNAUTHORIZED, "browser_origin_rejected");
    }
    match registry.challenge(header_auth(&headers)).await {
        Ok(result) => (StatusCode::CREATED, Json(result)).into_response(),
        Err(error) => auth_error(&error),
    }
}

async fn session_create(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(proof): Json<SessionProof>,
) -> Response {
    let Some(registry) = registry(&state.authorization) else {
        return StatusCode::NOT_FOUND.into_response();
    };
    if headers.get("origin").is_some() {
        return json_error(StatusCode::UNAUTHORIZED, "browser_origin_rejected");
    }
    match registry.create_session(header_auth(&headers), proof).await {
        Ok(result) => (StatusCode::CREATED, Json(result)).into_response(),
        Err(error) => auth_error(&error),
    }
}

async fn devices_list(State(state): State<AppState>, headers: HeaderMap) -> Response {
    let Some(registry) = registry(&state.authorization) else {
        return StatusCode::NOT_FOUND.into_response();
    };
    if headers.get("origin").is_some() || !registry.authorize_admin(header_auth(&headers)).await {
        return json_error(StatusCode::UNAUTHORIZED, "admin_authorization_required");
    }
    Json(json!({"devices": registry.devices().await})).into_response()
}

#[derive(Deserialize)]
struct ScopeUpdate {
    scopes: Vec<String>,
}

async fn device_update(
    State(state): State<AppState>,
    Path(device_id): Path<String>,
    headers: HeaderMap,
    Json(update): Json<ScopeUpdate>,
) -> Response {
    let Some(registry) = registry(&state.authorization) else {
        return StatusCode::NOT_FOUND.into_response();
    };
    if headers.get("origin").is_some() || !registry.authorize_admin(header_auth(&headers)).await {
        return json_error(StatusCode::UNAUTHORIZED, "admin_authorization_required");
    }
    match registry.update_scopes(&device_id, update.scopes).await {
        Ok(device) => Json(device).into_response(),
        Err(error) => auth_error(&error),
    }
}

async fn device_revoke(
    State(state): State<AppState>,
    Path(device_id): Path<String>,
    headers: HeaderMap,
) -> Response {
    let Some(registry) = registry(&state.authorization) else {
        return StatusCode::NOT_FOUND.into_response();
    };
    if headers.get("origin").is_some() || !registry.authorize_admin(header_auth(&headers)).await {
        return json_error(StatusCode::UNAUTHORIZED, "admin_authorization_required");
    }
    match registry.revoke(&device_id).await {
        Ok(revoked) => {
            let status = if revoked {
                StatusCode::OK
            } else {
                StatusCode::NOT_FOUND
            };
            (status, Json(json!({"revoked": revoked}))).into_response()
        }
        Err(error) => auth_error(&error),
    }
}

fn authorized(headers: &HeaderMap, token: &str) -> bool {
    headers
        .get("authorization")
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.strip_prefix("Bearer "))
        .is_some_and(|candidate| constant_time_eq(candidate.as_bytes(), token.as_bytes()))
}

async fn authorize_sync(state: &AppState, headers: &HeaderMap) -> Option<AuthorizationContext> {
    match &state.authorization {
        Authorization::AdminOnly(token) => (state.allow_admin_data_plane
            && authorized(headers, token))
        .then_some(AuthorizationContext::Admin),
        Authorization::Registry(registry) => {
            match registry.authorization_context(header_auth(headers)).await {
                Some(context @ AuthorizationContext::Admin) if state.allow_admin_data_plane => {
                    Some(context)
                }
                Some(ref context @ AuthorizationContext::Session { ref scopes, .. })
                    if scopes.iter().any(|scope| scope == "threads.read") =>
                {
                    Some(context.clone())
                }
                Some(
                    AuthorizationContext::Admin
                    | AuthorizationContext::Device { .. }
                    | AuthorizationContext::Session { .. },
                )
                | None => None,
            }
        }
    }
}

async fn authorize_scope(state: &AppState, headers: &HeaderMap, scope: &str) -> bool {
    match &state.authorization {
        Authorization::AdminOnly(token) => {
            state.allow_admin_data_plane && authorized(headers, token)
        }
        Authorization::Registry(registry) => {
            match registry.authorization_context(header_auth(headers)).await {
                Some(AuthorizationContext::Admin) => state.allow_admin_data_plane,
                Some(AuthorizationContext::Session { scopes, .. }) => {
                    scopes.iter().any(|candidate| candidate == scope)
                }
                Some(AuthorizationContext::Device { .. }) | None => false,
            }
        }
    }
}

async fn authorize_admin(authorization: &Authorization, headers: &HeaderMap) -> bool {
    match authorization {
        Authorization::AdminOnly(token) => authorized(headers, token),
        Authorization::Registry(registry) => registry.authorize_admin(header_auth(headers)).await,
    }
}

fn registry(authorization: &Authorization) -> Option<&Arc<DeviceRegistry>> {
    match authorization {
        Authorization::Registry(registry) => Some(registry),
        Authorization::AdminOnly(_) => None,
    }
}

fn header_auth(headers: &HeaderMap) -> Option<&str> {
    headers
        .get("authorization")
        .and_then(|value| value.to_str().ok())
}

fn auth_error(error: &AuthError) -> Response {
    let (status, code) = match error {
        AuthError::InvalidDeviceMetadata => (StatusCode::BAD_REQUEST, "invalid_device_metadata"),
        AuthError::InvalidPairing => (StatusCode::UNAUTHORIZED, "invalid_or_expired_pairing"),
        AuthError::InvalidPairingProof => (StatusCode::UNAUTHORIZED, "invalid_pairing_key_proof"),
        AuthError::DeviceAuthorizationRequired => {
            (StatusCode::UNAUTHORIZED, "device_authorization_required")
        }
        AuthError::DeviceKeyRequired => (StatusCode::CONFLICT, "device_key_required_repair"),
        AuthError::InvalidDeviceProof => {
            (StatusCode::UNAUTHORIZED, "invalid_or_expired_device_proof")
        }
        AuthError::DeviceKeyMismatch => (StatusCode::CONFLICT, "device_key_mismatch_repair"),
        AuthError::DeviceNotFound => (StatusCode::NOT_FOUND, "device_not_found"),
        AuthError::InvalidScopes => (
            StatusCode::BAD_REQUEST,
            "valid_scopes_with_threads_read_required",
        ),
        AuthError::InvalidRegistry
        | AuthError::Io(_)
        | AuthError::Json(_)
        | AuthError::Random
        | AuthError::Worker => (StatusCode::INTERNAL_SERVER_ERROR, "internal_error"),
    };
    json_error(status, code)
}

fn json_error(status: StatusCode, code: &str) -> Response {
    (status, Json(json!({"error": code}))).into_response()
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

async fn health(State(state): State<AppState>) -> Json<Health> {
    Json(Health {
        status: "ok",
        implementation: "rust",
        schema_version: state.store.schema_version(),
        upstream: match state.sync.upstream_status() {
            upstream::ConnectionStatus::Live => "live",
            upstream::ConnectionStatus::Reconnecting => "reconnecting",
        },
    })
}

async fn readiness(State(state): State<AppState>) -> (StatusCode, Json<Health>) {
    let live = state.sync.upstream_status() == upstream::ConnectionStatus::Live;
    (
        if live {
            StatusCode::OK
        } else {
            StatusCode::SERVICE_UNAVAILABLE
        },
        Json(Health {
            status: if live { "ok" } else { "not_ready" },
            implementation: "rust",
            schema_version: state.store.schema_version(),
            upstream: if live { "live" } else { "reconnecting" },
        }),
    )
}

#[cfg(test)]
mod tests {
    use super::constant_time_eq;

    #[test]
    fn token_comparison_requires_exact_bytes() {
        assert!(constant_time_eq(b"same", b"same"));
        assert!(!constant_time_eq(b"same", b"diff"));
        assert!(!constant_time_eq(b"short", b"longer"));
    }
}
