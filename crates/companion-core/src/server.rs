use std::{collections::HashSet, net::SocketAddr, path::PathBuf, sync::Arc, time::Duration};

use axum::{
    Json, Router,
    body::Body,
    extract::{DefaultBodyLimit, FromRequestParts, Path, Query, Request, State, WebSocketUpgrade},
    http::{Extensions, HeaderMap, Method, StatusCode, Version, header},
    middleware::Next,
    response::{IntoResponse, Response},
    routing::{any, delete, get, post},
};
use serde::{Deserialize, Serialize};
use serde_json::json;

use crate::{
    auth::{AuthError, AuthorizationContext, DeviceRegistry, PairingClaim, SessionProof},
    build_shelf::BuildShelfProxy,
    catalog::{CatalogError, SessionCatalog},
    content::{ContentQuery, PrivateContentService},
    device_tls::DeviceTlsConnectInfo,
    file_uploads::WorkspaceUploadStore,
    files::{FileQuery, FileService, FileTextQuery},
    identity::TransportIdentity,
    image_previews::{ImagePreviewError, ImagePreviewQuery, ImagePreviewService, ImageVariant},
    media::MediaProxyService,
    ports,
    rollout::read_rollout_metadata,
    store::IndexStore,
    sync::SyncHub,
    telemetry::{
        TelemetryBatch, TelemetryError, TelemetryQuery, TelemetrySettings, TelemetryStore,
    },
    terminal::{self, TerminalQuery},
    tunnels::{LocalhostTunnelService, TunnelError},
    upstream,
};
mod port_forwarding;

use tower_http::compression::{
    CompressionLayer, CompressionLevel,
    predicate::{And, Predicate, SizeAbove},
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
    pub image_previews: Option<Arc<ImagePreviewService>>,
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
    pub relay: Option<crate::relay::RelayRuntime>,
    pub workspace_upload_staging: Option<WorkspaceUploadStore>,
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
    let inventory = crate::port_inventory::PortInventory::new(services.excluded_ports.clone());
    let sync = sync.with_port_inventory(inventory);
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
    let inventory = crate::port_inventory::PortInventory::new(services.excluded_ports.clone());
    let sync = sync.with_port_inventory(inventory);
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
        .route("/v1/devices/{device_id}", delete(device_revoke))
        .layer(DefaultBodyLimit::max(8 * 1024))
        .layer(v1_compression());
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
    let text = v1_text_routes().layer(v1_compression());
    let images = v1_image_preview_routes();
    let media = Router::new()
        .route("/v1/media/materialize", post(media_materialize))
        .route("/v1/media/{id}", get(media_read).head(media_read))
        .layer(DefaultBodyLimit::max(20 * 1024))
        .layer(v1_compression());
    let telemetry = Router::new()
        .route(
            "/v1/telemetry/events",
            get(telemetry_query).post(telemetry_ingest),
        )
        .route(
            "/v1/telemetry/settings",
            get(telemetry_settings_read).patch(telemetry_settings_update),
        )
        .layer(DefaultBodyLimit::max(256 * 1024))
        .layer(v1_compression());
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
        .merge(text)
        .merge(images)
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

type V1CompressionPredicate = fn(StatusCode, Version, &HeaderMap, &Extensions) -> bool;

fn v1_compression() -> CompressionLayer<And<SizeAbove, V1CompressionPredicate>> {
    CompressionLayer::new()
        .quality(CompressionLevel::Fastest)
        .compress_when(SizeAbove::new(256).and(v1_textual_response as V1CompressionPredicate))
}

fn v1_textual_response(
    status: StatusCode,
    _version: Version,
    headers: &HeaderMap,
    _extensions: &Extensions,
) -> bool {
    if status == StatusCode::NO_CONTENT
        || status == StatusCode::NOT_MODIFIED
        || status == StatusCode::SWITCHING_PROTOCOLS
        || headers.contains_key(header::CONTENT_RANGE)
        || headers.contains_key(header::CONTENT_ENCODING)
    {
        return false;
    }
    headers
        .get(header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .is_some_and(|value| {
            value.starts_with("text/")
                || value.starts_with("application/json")
                || value.starts_with("application/javascript")
                || value.starts_with("application/xml")
                || value.contains("+json")
                || value.contains("+xml")
        })
}

fn v1_text_routes() -> Router<AppState> {
    Router::new()
        .route("/v1/files/text", get(file_text).head(file_text))
        .route(
            "/v1/files/preview-text",
            get(file_preview_text).head(file_preview_text),
        )
        .route(
            "/v1/content/{digest}/text",
            get(content_text_read).head(content_text_read),
        )
}

fn v1_image_preview_routes() -> Router<AppState> {
    Router::new()
        .route(
            "/v1/image-previews/file",
            get(file_image_preview).head(file_image_preview),
        )
        .route(
            "/v1/image-previews/host-file",
            get(host_file_image_preview).head(host_file_image_preview),
        )
        .route(
            "/v1/image-previews/content/{digest}",
            get(content_image_preview).head(content_image_preview),
        )
        .route(
            "/v1/image-previews/media/{id}",
            get(media_image_preview).head(media_image_preview),
        )
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
        .route("/v1/port-forwards/discovery", get(port_discovery))
        .route("/v1/port-forwards/{port}", get(port_forward_upgrade))
        .route("/v1/terminals", get(terminal_upgrade))
        .route("/v1/tunnels", post(tunnel_create))
        .route("/v1/tunnels/{id}", any(tunnel_exact))
        .route("/v1/tunnels/{id}/", any(tunnel_proxy_root))
        .route("/v1/tunnels/{id}/{*path}", any(tunnel_proxy))
        .layer(DefaultBodyLimit::max(8 * 1024))
        .layer(v1_compression());
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
    let text = v1_text_routes().layer(v1_compression());
    let images = v1_image_preview_routes();
    let media = Router::new()
        .route("/v1/media/materialize", post(media_materialize))
        .route("/v1/media/{id}", get(media_read).head(media_read))
        .layer(DefaultBodyLimit::max(20 * 1024))
        .layer(v1_compression());
    let telemetry = Router::new()
        .route("/v1/telemetry/events", post(telemetry_ingest))
        .layer(DefaultBodyLimit::max(256 * 1024))
        .layer(v1_compression());
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
        .merge(text)
        .merge(images)
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
        .route("/v1/devices/{device_id}", delete(device_revoke))
        .route("/v1/telemetry/events", get(telemetry_query))
        .route(
            "/v1/telemetry/settings",
            get(telemetry_settings_read).patch(telemetry_settings_update),
        )
        .route("/v1/relay", get(relay_status).patch(relay_enabled))
        .route("/v1/relay/pair", post(relay_pair));
    router
        .layer(DefaultBodyLimit::max(8 * 1024))
        .with_state(state)
}

include!("server/services.rs");
include!("server/transport.rs");
include!("server/auth.rs");
include!("server/relay.rs");

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
