use std::{collections::HashSet, net::SocketAddr, path::PathBuf, sync::Arc, time::Duration};

use axum::{
    Json, Router,
    body::Body,
    extract::{DefaultBodyLimit, FromRequestParts, Path, Query, Request, State, WebSocketUpgrade},
    http::{HeaderMap, HeaderValue, Method, StatusCode, header::CONTENT_TYPE},
    middleware::Next,
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
    device_tls::DeviceTlsConnectInfo,
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
pub(crate) struct AppState {
    pub(crate) store: Arc<IndexStore>,
    pub(crate) authorization: Authorization,
    pub(crate) sync: SyncHub,
    pub(crate) services: CompanionServices,
    pub(crate) allow_admin_data_plane: bool,
    pub(crate) terminals: terminal::TerminalRegistry,
}

/// Separates the remotely reachable authenticated data plane from the
/// OS-local administrative control plane.
pub struct CompanionRouters {
    pub public: Router,
    pub bootstrap: Router,
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
    pub bootstrap_tls_target: Option<SocketAddr>,
    pub bootstrap_tls_limit: Option<Arc<tokio::sync::Semaphore>>,
    pub inner_tls_target: Option<SocketAddr>,
    pub inner_tls_limit: Option<Arc<tokio::sync::Semaphore>>,
    pub sync_v2: Option<SyncV2Runtime>,
    pub sync_v2_mode: SyncV2Mode,
}

#[derive(Clone)]
pub(crate) enum Authorization {
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
        bootstrap: build_bootstrap_router(state.clone()),
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
        .route(
            "/v2/sync",
            get(sync_v2_upgrade).layer(axum::middleware::map_response(
                crate::sync_v2::http::close_extractor_rejection,
            )),
        )
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
        .layer(DefaultBodyLimit::max(8 * 1024))
        .merge(crate::sync_v2::all_routes());
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
        .route("/v1/e2ee-bootstrap-tunnel", get(e2ee_bootstrap_tunnel))
        .merge(build_shelf)
        .with_state(state)
}

fn build_bootstrap_router(state: AppState) -> Router {
    Router::new()
        .route("/v1/auth", post(authenticate_bootstrap))
        .layer(DefaultBodyLimit::max(8 * 1024))
        .with_state(state)
}

fn build_secure_router(state: AppState) -> Router {
    let authorization = state.authorization.clone();
    let transport = Router::new()
        .route("/v1/auth", post(authenticate))
        .route("/v1/sync", get(sync_upgrade))
        .route(
            "/v2/sync",
            get(sync_v2_upgrade).layer(axum::middleware::map_response(
                crate::sync_v2::http::close_extractor_rejection,
            )),
        )
        .route("/v1/port-forwards/discovery", get(port_discovery))
        .route("/v1/port-forwards/{port}", get(port_forward_upgrade))
        .route("/v1/terminals", get(terminal_upgrade))
        .route("/v1/tunnels", post(tunnel_create))
        .route("/v1/tunnels/{id}", any(tunnel_exact))
        .route("/v1/tunnels/{id}/", any(tunnel_proxy_root))
        .route("/v1/tunnels/{id}/{*path}", any(tunnel_proxy))
        .layer(DefaultBodyLimit::max(8 * 1024))
        .merge(crate::sync_v2::data_routes());
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
        .layer(axum::middleware::from_fn_with_state(
            authorization,
            enforce_tls_device_binding,
        ))
        .with_state(state)
}

async fn enforce_tls_device_binding(
    State(authorization): State<Authorization>,
    axum::Extension(tls): axum::Extension<DeviceTlsConnectInfo>,
    request: Request,
    next: Next,
) -> Response {
    let Some(header) = header_auth(request.headers()) else {
        return next.run(request).await;
    };
    let Authorization::Registry(registry) = authorization else {
        return json_error(StatusCode::UNAUTHORIZED, "device_bound_transport_required");
    };
    let Some(context) = registry.authorization_context(Some(header)).await else {
        return json_error(StatusCode::UNAUTHORIZED, "device_bound_transport_required");
    };
    if context.device_id() != Some(tls.device_id.as_str()) {
        return json_error(StatusCode::UNAUTHORIZED, "device_bound_transport_required");
    }
    next.run(request).await
}

fn build_control_router(state: AppState) -> Router {
    let router = Router::new()
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
        );
    #[cfg(feature = "e2e-command-fault")]
    let router = router
        .route(
            "/internal/e2e/v2-command-fault",
            post(e2e_command_fault_arm),
        )
        .route(
            "/internal/e2e/v2-command-fault/{fault_id}",
            get(e2e_command_fault_status),
        )
        .route(
            "/internal/e2e/v2-command-fault/{fault_id}/release",
            post(e2e_command_fault_release),
        );
    router
        .layer(DefaultBodyLimit::max(8 * 1024))
        .with_state(state)
}

#[cfg(feature = "e2e-command-fault")]
async fn e2e_command_fault_arm(State(state): State<AppState>, headers: HeaderMap) -> Response {
    if !e2e_fault_authorized(&state.authorization, &headers).await {
        return json_error(StatusCode::UNAUTHORIZED, "admin_authorization_required");
    }
    let Some(runtime) = state.services.sync_v2.as_ref() else {
        return json_error(StatusCode::SERVICE_UNAVAILABLE, "sync_v2_unavailable");
    };
    let fault_id = format!("fault:{}", random_token(16));
    match runtime.arm_e2e_command_fault(fault_id).await {
        Ok(status) => Json(status).into_response(),
        Err(code) => json_error(StatusCode::CONFLICT, code),
    }
}

#[cfg(feature = "e2e-command-fault")]
async fn e2e_command_fault_status(
    State(state): State<AppState>,
    Path(fault_id): Path<String>,
    headers: HeaderMap,
) -> Response {
    if !e2e_fault_authorized(&state.authorization, &headers).await {
        return json_error(StatusCode::UNAUTHORIZED, "admin_authorization_required");
    }
    let Some(runtime) = state.services.sync_v2.as_ref() else {
        return json_error(StatusCode::SERVICE_UNAVAILABLE, "sync_v2_unavailable");
    };
    runtime
        .e2e_command_fault_status(&fault_id)
        .await
        .map_or_else(
            || json_error(StatusCode::NOT_FOUND, "e2e_command_fault_not_found"),
            |status| Json(status).into_response(),
        )
}

#[cfg(feature = "e2e-command-fault")]
async fn e2e_command_fault_release(
    State(state): State<AppState>,
    Path(fault_id): Path<String>,
    headers: HeaderMap,
) -> Response {
    if !e2e_fault_authorized(&state.authorization, &headers).await {
        return json_error(StatusCode::UNAUTHORIZED, "admin_authorization_required");
    }
    let Some(runtime) = state.services.sync_v2.as_ref() else {
        return json_error(StatusCode::SERVICE_UNAVAILABLE, "sync_v2_unavailable");
    };
    runtime
        .release_e2e_command_fault(&fault_id)
        .await
        .map_or_else(
            || json_error(StatusCode::NOT_FOUND, "e2e_command_fault_not_found"),
            |status| Json(status).into_response(),
        )
}

#[cfg(feature = "e2e-command-fault")]
async fn e2e_fault_authorized(authorization: &Authorization, headers: &HeaderMap) -> bool {
    headers.get("origin").is_none() && authorize_admin(authorization, headers).await
}

#[cfg(feature = "e2e-command-fault")]
fn random_token(byte_count: usize) -> String {
    use rand::RngCore;
    let mut bytes = vec![0_u8; byte_count];
    rand::rng().fill_bytes(&mut bytes);
    hex::encode(bytes)
}

include!("server/services.rs");
include!("server/transport.rs");
include!("server/auth.rs");

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

    #[cfg(feature = "e2e-command-fault")]
    use super::{Authorization, e2e_fault_authorized};
    #[cfg(feature = "e2e-command-fault")]
    use axum::http::{HeaderMap, HeaderValue};
    #[cfg(feature = "e2e-command-fault")]
    use std::sync::Arc;

    #[test]
    fn token_comparison_requires_exact_bytes() {
        assert!(constant_time_eq(b"same", b"same"));
        assert!(!constant_time_eq(b"same", b"diff"));
        assert!(!constant_time_eq(b"short", b"longer"));
    }

    #[cfg(feature = "e2e-command-fault")]
    #[tokio::test]
    async fn e2e_fault_control_requires_exact_admin_authorization() {
        let authorization = Authorization::AdminOnly(Arc::from("admin-secret"));
        assert!(!e2e_fault_authorized(&authorization, &HeaderMap::new()).await);

        let mut invalid = HeaderMap::new();
        invalid.insert(
            "authorization",
            HeaderValue::from_static("Bearer wrong-secret"),
        );
        assert!(!e2e_fault_authorized(&authorization, &invalid).await);

        let mut valid = HeaderMap::new();
        valid.insert(
            "authorization",
            HeaderValue::from_static("Bearer admin-secret"),
        );
        assert!(e2e_fault_authorized(&authorization, &valid).await);
        valid.insert(
            "origin",
            HeaderValue::from_static("https://example.invalid"),
        );
        assert!(!e2e_fault_authorized(&authorization, &valid).await);
    }
}
