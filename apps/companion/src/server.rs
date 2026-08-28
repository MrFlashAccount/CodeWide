use std::{collections::HashSet, net::SocketAddr, path::PathBuf, sync::Arc, time::Duration};

use axum::{
    Json, Router,
    body::Body,
    extract::{DefaultBodyLimit, FromRequestParts, Path, Query, Request, State, WebSocketUpgrade},
    http::{HeaderMap, HeaderValue, Method, StatusCode, header::CONTENT_TYPE},
    response::{IntoResponse, Response},
    routing::{any, get, patch, post},
};
use serde::{Deserialize, Serialize};
use serde_json::json;

use crate::{
    auth::{AuthError, AuthorizationContext, DeviceRegistry, PairingClaim, SessionProof},
    build_shelf::BuildShelfProxy,
    catalog::{CatalogError, SessionCatalog},
    content::{ContentQuery, PrivateContentService},
    files::{FileQuery, FileService},
    identity::TransportIdentity,
    media::MediaProxyService,
    ports,
    rollout::read_rollout_metadata,
    store::IndexStore,
    sync::SyncHub,
    sync_v2::{SyncV2Mode, SyncV2Runtime},
    telemetry::{
        TelemetryBatch, TelemetryError, TelemetryQuery, TelemetrySettings, TelemetryStore,
    },
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
    terminals: terminal::TerminalRegistry,
}

/// Separates the remotely reachable authenticated data plane from the
/// OS-local administrative control plane.
pub struct CompanionRouters {
    pub public: Router,
    pub inner: Router,
    pub control: Router,
}

#[derive(Clone, Default)]
pub struct CompanionServices {
    pub build_shelf: Option<BuildShelfProxy>,
    pub files: Option<Arc<FileService>>,
    pub content: Option<Arc<PrivateContentService>>,
    pub media: Option<Arc<MediaProxyService>>,
    pub tunnels: Option<Arc<LocalhostTunnelService>>,
    pub telemetry: Option<Arc<TelemetryStore>>,
    pub catalog: Option<Arc<SessionCatalog>>,
    pub app_server_socket_path: Option<PathBuf>,
    pub excluded_ports: HashSet<u16>,
    pub transport_identity: Option<TransportIdentity>,
    pub inner_tls_target: Option<SocketAddr>,
    pub inner_tls_limit: Option<Arc<tokio::sync::Semaphore>>,
    pub sync_v2: Option<SyncV2Runtime>,
    pub sync_v2_mode: SyncV2Mode,
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

/// Builds the V1 router with admin-token authorization and companion services.
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

/// Builds the V1 router with companion-owned file/media/dictation services.
pub fn router_with_registry_and_services(
    store: Arc<IndexStore>,
    registry: Arc<DeviceRegistry>,
    sync: SyncHub,
    services: CompanionServices,
) -> Router {
    build_router(store, Authorization::Registry(registry), sync, services)
}

/// Builds the production routers. The remotely reachable cleartext router is
/// only an opaque carrier into the pinned TLS listener. Authentication and all
/// private application traffic exist exclusively on the inner router.
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
        terminals: terminal::TerminalRegistry::new(8),
    };
    CompanionRouters {
        public: build_outer_router(state.clone()),
        inner: build_secure_router(state.clone()),
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
        terminals: terminal::TerminalRegistry::new(8),
    };
    let core = Router::new()
        .route("/healthz", get(health))
        .route("/readyz", get(readiness))
        .route("/v1/app-server", get(app_server_upgrade))
        .route("/v1/sync", get(sync_upgrade))
        .route("/v2/sync", get(sync_v2_upgrade))
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
    let telemetry = Router::new()
        .route(
            "/v1/telemetry/events",
            get(telemetry_query).post(telemetry_ingest),
        )
        .route(
            "/v1/telemetry/settings",
            get(telemetry_settings_read).patch(telemetry_settings_update),
        )
        .layer(DefaultBodyLimit::max(256 * 1024));
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
        .merge(telemetry)
        .merge(build_shelf)
        .with_state(state)
}

fn build_outer_router(state: AppState) -> Router {
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
    Router::new()
        .route("/v1/e2ee-tunnel", get(e2ee_tunnel))
        .merge(build_shelf)
        .with_state(state)
}

fn build_secure_router(state: AppState) -> Router {
    let transport = Router::new()
        .route("/v1/auth", post(authenticate))
        .route("/v1/sync", get(sync_upgrade))
        .route("/v2/sync", get(sync_v2_upgrade))
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
    let telemetry = Router::new()
        .route("/v1/telemetry/events", post(telemetry_ingest))
        .layer(DefaultBodyLimit::max(256 * 1024));
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
        .merge(telemetry)
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
        .route("/v1/telemetry/events", get(telemetry_query))
        .route(
            "/v1/telemetry/settings",
            get(telemetry_settings_read).patch(telemetry_settings_update),
        )
        .layer(DefaultBodyLimit::max(8 * 1024))
        .with_state(state)
}

async fn telemetry_ingest(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(batch): Json<TelemetryBatch>,
) -> Response {
    let Some(store) = state.services.telemetry.clone() else {
        return StatusCode::NOT_FOUND.into_response();
    };
    if headers.get("origin").is_some() {
        return json_error(StatusCode::UNAUTHORIZED, "session_authorization_required");
    }
    let Some(context) = authorization_for_scope(&state, &headers, "threads.read").await else {
        return json_error(StatusCode::UNAUTHORIZED, "session_authorization_required");
    };
    if !store.enabled() {
        return StatusCode::NO_CONTENT.into_response();
    }
    let device_id = context.device_id().unwrap_or("local-admin").to_owned();
    match tokio::task::spawn_blocking(move || store.ingest(&device_id, batch)).await {
        Ok(Ok(report)) => (StatusCode::ACCEPTED, Json(report)).into_response(),
        Ok(Err(error)) => telemetry_error(&error),
        Err(error) => {
            tracing::error!(reason = %error, "telemetry ingest task failed");
            json_error(StatusCode::INTERNAL_SERVER_ERROR, "telemetry_store_failed")
        }
    }
}

async fn telemetry_settings_read(State(state): State<AppState>, headers: HeaderMap) -> Response {
    let Some(store) = state.services.telemetry.clone() else {
        return StatusCode::NOT_FOUND.into_response();
    };
    if headers.get("origin").is_some() || !authorize_admin(&state.authorization, &headers).await {
        return json_error(StatusCode::UNAUTHORIZED, "admin_authorization_required");
    }
    Json(TelemetrySettings {
        enabled: store.enabled(),
    })
    .into_response()
}

async fn telemetry_settings_update(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(settings): Json<TelemetrySettings>,
) -> Response {
    let Some(store) = state.services.telemetry.clone() else {
        return StatusCode::NOT_FOUND.into_response();
    };
    if headers.get("origin").is_some() || !authorize_admin(&state.authorization, &headers).await {
        return json_error(StatusCode::UNAUTHORIZED, "admin_authorization_required");
    }
    match tokio::task::spawn_blocking(move || store.set_enabled(settings.enabled)).await {
        Ok(Ok(())) => Json(settings).into_response(),
        Ok(Err(error)) => telemetry_error(&error),
        Err(error) => {
            tracing::error!(reason = %error, "telemetry settings task failed");
            json_error(StatusCode::INTERNAL_SERVER_ERROR, "telemetry_store_failed")
        }
    }
}

async fn telemetry_query(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(query): Query<TelemetryQuery>,
) -> Response {
    let Some(store) = state.services.telemetry.clone() else {
        return StatusCode::NOT_FOUND.into_response();
    };
    if headers.get("origin").is_some() || !authorize_admin(&state.authorization, &headers).await {
        return json_error(StatusCode::UNAUTHORIZED, "admin_authorization_required");
    }
    match tokio::task::spawn_blocking(move || store.query(&query)).await {
        Ok(Ok(page)) => Json(page).into_response(),
        Ok(Err(error)) => telemetry_error(&error),
        Err(error) => {
            tracing::error!(reason = %error, "telemetry query task failed");
            json_error(StatusCode::INTERNAL_SERVER_ERROR, "telemetry_store_failed")
        }
    }
}

fn telemetry_error(error: &TelemetryError) -> Response {
    match error {
        TelemetryError::Invalid(reason) => {
            tracing::debug!(%reason, "invalid telemetry request");
            json_error(StatusCode::BAD_REQUEST, "invalid_telemetry")
        }
        TelemetryError::Database(_)
        | TelemetryError::DatabaseOpen(_)
        | TelemetryError::Transaction(_)
        | TelemetryError::Table(_)
        | TelemetryError::Storage(_)
        | TelemetryError::Commit(_)
        | TelemetryError::Json(_)
        | TelemetryError::Io(_) => {
            tracing::error!(reason = %error, "telemetry store failed");
            json_error(StatusCode::INTERNAL_SERVER_ERROR, "telemetry_store_failed")
        }
    }
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
    let authorization = if headers.get("origin").is_some() {
        None
    } else {
        authorization_for_scope(&state, &headers, "localhost.forward").await
    };
    let Some(authorization) = authorization else {
        return TunnelError::Unauthorized.into_response();
    };
    tunnels
        .create_for_device(
            request.port,
            request.ttl_seconds,
            authorization.device_id().map(str::to_owned),
        )
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
    let authorization = if headers.get("origin").is_some() {
        None
    } else {
        authorization_for_scope(&state, &headers, "localhost.forward").await
    };
    let Some(authorization) = authorization else {
        return json_error(StatusCode::UNAUTHORIZED, "unauthorized");
    };
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
    let authorization_changes = match (&state.authorization, authorization.device_id()) {
        (Authorization::Registry(registry), Some(device_id)) => Some((
            device_id.to_owned(),
            registry.subscribe_authorization_changes(),
        )),
        _ => None,
    };
    upgrade
        .max_message_size(1024 * 1024)
        .on_upgrade(move |socket| async move {
            if let Some((device_id, changes)) = authorization_changes {
                ports::bridge_tcp_authorized(socket, target, device_id, changes).await;
            } else {
                ports::bridge_tcp(socket, target).await;
            }
        })
}

async fn terminal_upgrade(
    State(state): State<AppState>,
    Query(query): Query<TerminalQuery>,
    upgrade: WebSocketUpgrade,
    headers: HeaderMap,
) -> Response {
    let authorization = if headers.get("origin").is_some() {
        None
    } else {
        authorization_for_scope(&state, &headers, "shell.explicit").await
    };
    let Some(authorization) = authorization else {
        return json_error(StatusCode::FORBIDDEN, "shell_explicit_scope_required");
    };
    let owner = authorization.device_id().unwrap_or("admin").to_owned();
    let authorization_changes = match (&state.authorization, authorization.device_id()) {
        (Authorization::Registry(registry), Some(device_id)) => {
            Some(terminal::TerminalAuthorization::new(
                device_id.to_owned(),
                registry.subscribe_authorization_changes(),
            ))
        }
        _ => None,
    };
    if query.session_id.is_some() {
        let offset = query.offset.unwrap_or(0);
        let session =
            match state
                .terminals
                .attach_or_create(&owner, &query, authorization_changes, || {
                    let spawn_query = resolve_terminal_spawn_query(&state, &query)?;
                    terminal::TerminalSession::spawn(&spawn_query)
                }) {
                Ok(session) => session,
                Err(error) => {
                    tracing::error!(reason = %error, "resumable terminal attach failed");
                    return json_error(error.status(), error.code());
                }
            };
        return upgrade
            .max_message_size(1024 * 1024)
            .on_upgrade(move |socket| terminal::bridge_resumable(socket, session, offset));
    }

    let permit = match state.terminals.legacy_permit() {
        Ok(permit) => permit,
        Err(error) => return json_error(error.status(), error.code()),
    };
    let session = match resolve_terminal_spawn_query(&state, &query)
        .and_then(|spawn_query| terminal::TerminalSession::spawn(&spawn_query))
    {
        Ok(session) => session,
        Err(error) => {
            tracing::error!(reason = %error, "terminal session spawn failed");
            return json_error(error.status(), error.code());
        }
    };
    upgrade
        .max_message_size(1024 * 1024)
        .on_upgrade(move |socket| async move {
            let _permit = permit;
            terminal::bridge(socket, session, authorization_changes).await;
        })
}

fn resolve_terminal_spawn_query(
    state: &AppState,
    query: &TerminalQuery,
) -> Result<TerminalQuery, terminal::TerminalError> {
    let Some(thread_id) = query.thread_id.as_deref() else {
        return Ok(query.clone());
    };
    if !valid_thread_id(thread_id) {
        return Err(terminal::TerminalError::InvalidThread);
    }
    let metadata = if let Some(metadata) = state
        .store
        .thread_metadata(thread_id)
        .map_err(terminal::TerminalError::thread_resolution_failed)?
    {
        metadata
    } else {
        let catalog = state
            .services
            .catalog
            .as_ref()
            .ok_or(terminal::TerminalError::ThreadNotFound)?;
        let rollout = catalog.resolve(thread_id).map_err(|error| match error {
            CatalogError::NotFound(_) => terminal::TerminalError::ThreadNotFound,
            CatalogError::Poisoned => terminal::TerminalError::thread_resolution_failed(error),
        })?;
        let metadata = read_rollout_metadata(&rollout)
            .map_err(terminal::TerminalError::thread_resolution_failed)?
            .filter(|metadata| metadata.id == thread_id)
            .ok_or(terminal::TerminalError::ThreadNotFound)?;
        state
            .store
            .put_thread_metadata(&metadata)
            .map_err(terminal::TerminalError::thread_resolution_failed)?;
        metadata
    };
    Ok(TerminalQuery {
        cwd: Some(metadata.cwd),
        ..query.clone()
    })
}

fn valid_thread_id(value: &str) -> bool {
    value.len() == 36
        && value.bytes().enumerate().all(|(index, byte)| match index {
            8 | 13 | 18 | 23 => byte == b'-',
            _ => byte.is_ascii_hexdigit(),
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

async fn sync_v2_upgrade(
    State(state): State<AppState>,
    headers: HeaderMap,
    upgrade: WebSocketUpgrade,
) -> Response {
    if state.services.sync_v2_mode == SyncV2Mode::Disabled {
        let mut response = (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(json!({
                "type": "https://codewide.dev/problems/sync-v2-disabled",
                "title": "Sync V2 disabled",
                "status": 503,
                "code": "sync_v2_disabled"
            })),
        )
            .into_response();
        response.headers_mut().insert(
            CONTENT_TYPE,
            HeaderValue::from_static("application/problem+json"),
        );
        return response;
    }
    let Some(runtime) = state.services.sync_v2.clone() else {
        return json_error(StatusCode::SERVICE_UNAVAILABLE, "sync_v2_unavailable");
    };
    let authorization_changes = match &state.authorization {
        Authorization::Registry(registry) => Some(registry.subscribe_authorization_changes()),
        Authorization::AdminOnly(_) => None,
    };
    let Some(authorization @ AuthorizationContext::Session { .. }) =
        authorize_sync(&state, &headers).await
    else {
        return StatusCode::UNAUTHORIZED.into_response();
    };
    if headers.get("origin").is_some() {
        return StatusCode::UNAUTHORIZED.into_response();
    }
    upgrade
        .max_message_size(16 * 1024 * 1024)
        .max_frame_size(16 * 1024 * 1024)
        .on_upgrade(move |socket| runtime.serve(socket, authorization, authorization_changes))
}

async fn e2ee_tunnel(
    State(state): State<AppState>,
    headers: HeaderMap,
    upgrade: WebSocketUpgrade,
) -> Response {
    if headers.get("origin").is_some() {
        return json_error(StatusCode::UNAUTHORIZED, "browser_origin_rejected");
    }
    let Some(target) = state.services.inner_tls_target else {
        return StatusCode::NOT_FOUND.into_response();
    };
    let Some(limit) = state.services.inner_tls_limit.clone() else {
        return StatusCode::NOT_FOUND.into_response();
    };
    let Ok(permit) = limit.try_acquire_owned() else {
        return json_error(StatusCode::TOO_MANY_REQUESTS, "secure_transport_capacity");
    };
    let Ok(Ok(stream)) = tokio::time::timeout(
        Duration::from_secs(2),
        tokio::net::TcpStream::connect(target),
    )
    .await
    else {
        return json_error(
            StatusCode::SERVICE_UNAVAILABLE,
            "secure_transport_unavailable",
        );
    };
    upgrade
        .max_message_size(1024 * 1024)
        .max_frame_size(1024 * 1024)
        .on_upgrade(move |socket| async move {
            let _permit = permit;
            ports::bridge_tcp_idle_bounded(socket, stream, Duration::from_secs(15)).await;
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
        } => {
            complete_pairing_claim(
                registry,
                state.services.sync_v2.as_ref(),
                PairingClaim {
                    pairing_token,
                    device_name,
                    public_key_spki,
                    proof,
                },
            )
            .await
        }
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
        Ok(pairing) => {
            let mut response = json!({
                "pairingToken": pairing.pairing_token,
                "expiresAt": pairing.expires_at,
            });
            if let Some(identity) = &state.services.transport_identity {
                response["tlsPinSha256"] = json!(identity.tls_pin_sha256);
                response["identityExpiresAt"] = json!(identity.expires_at);
            }
            (StatusCode::CREATED, Json(response)).into_response()
        }
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
    complete_pairing_claim(registry, state.services.sync_v2.as_ref(), claim).await
}

async fn complete_pairing_claim(
    registry: &DeviceRegistry,
    sync_v2: Option<&SyncV2Runtime>,
    claim: PairingClaim,
) -> Response {
    let result = match registry.claim(claim).await {
        Ok(result) => result,
        Err(error) => return auth_error(&error),
    };
    if result.replaced_existing
        && let Some(runtime) = sync_v2
        && !runtime.purge_device_context(&result.device_id).await
    {
        return json_error(
            StatusCode::INTERNAL_SERVER_ERROR,
            "sync_v2_context_purge_failed",
        );
    }
    (
        StatusCode::CREATED,
        Json(json!({
            "deviceId": result.device_id,
            "capabilityToken": result.capability_token,
            "scopes": result.scopes,
            // Kept for clients from the rollout window. This is no longer a
            // per-device mode: the outer server has no private data routes.
            "secureTransportRequired": true,
        })),
    )
        .into_response()
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
        Ok(device) => {
            if let Some(runtime) = &state.services.sync_v2
                && !runtime.purge_device_context(&device_id).await
            {
                return json_error(
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "sync_v2_context_purge_failed",
                );
            }
            Json(device).into_response()
        }
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
            if revoked
                && let Some(runtime) = &state.services.sync_v2
                && !runtime.purge_device_context(&device_id).await
            {
                return json_error(
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "sync_v2_context_purge_failed",
                );
            }
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
    authorization_for_scope(state, headers, scope)
        .await
        .is_some()
}

async fn authorization_for_scope(
    state: &AppState,
    headers: &HeaderMap,
    scope: &str,
) -> Option<AuthorizationContext> {
    match &state.authorization {
        Authorization::AdminOnly(token) => (state.allow_admin_data_plane
            && authorized(headers, token))
        .then_some(AuthorizationContext::Admin),
        Authorization::Registry(registry) => {
            match registry.authorization_context(header_auth(headers)).await {
                Some(AuthorizationContext::Admin) if state.allow_admin_data_plane => {
                    Some(AuthorizationContext::Admin)
                }
                Some(context @ AuthorizationContext::Session { .. })
                    if matches!(
                        &context,
                        AuthorizationContext::Session { scopes, .. }
                            if scopes.iter().any(|candidate| candidate == scope)
                    ) =>
                {
                    Some(context)
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
