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
    let Some(context) = authenticated_session(&state, &headers).await else {
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
        authenticated_session(&state, &headers).await
    };
    let Some(authorization) = authorization else {
        return TunnelError::Unauthorized.into_response();
    };
    #[cfg(feature = "e2e-command-fault")]
    if let Some(response) = e2e_v1_surface_fault(
        &state,
        crate::sync_v2::E2ESurfaceFaultTarget::PortCreate,
        "e2e_port_fault_action_mismatch",
    )
    .await
    {
        return response;
    }
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
    let authorization = if headers.get("origin").is_some() {
        None
    } else {
        authenticated_session(&state, &headers).await
    };
    let Some(authorization) = authorization else {
        return TunnelError::Unauthorized.into_response();
    };
    #[cfg(feature = "e2e-command-fault")]
    if let Some(response) = e2e_v1_surface_fault(
        &state,
        crate::sync_v2::E2ESurfaceFaultTarget::PortDelete,
        "e2e_port_fault_action_mismatch",
    )
    .await
    {
        return response;
    }
    let tunnel = match tunnels.tunnel(&id).await {
        Ok(tunnel) => tunnel,
        Err(error) => return error.into_response(),
    };
    if !same_tunnel_owner(tunnel.owner_device_id(), authorization.device_id()) {
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

#[cfg(feature = "e2e-command-fault")]
async fn e2e_v1_surface_fault(
    state: &AppState,
    target: crate::sync_v2::E2ESurfaceFaultTarget,
    mismatch_error: &'static str,
) -> Option<Response> {
    let runtime = state.services.sync_v2.as_ref()?;
    match runtime.intercept_e2e_surface_fault(target).await? {
        crate::sync_v2::E2ESurfaceFaultEffect::Continue => None,
        crate::sync_v2::E2ESurfaceFaultEffect::Fail(marker) => {
            Some(json_error(StatusCode::SERVICE_UNAVAILABLE, &marker))
        }
        crate::sync_v2::E2ESurfaceFaultEffect::NotFound
        | crate::sync_v2::E2ESurfaceFaultEffect::ReplayUnavailable
        | crate::sync_v2::E2ESurfaceFaultEffect::InvalidCursor
        | crate::sync_v2::E2ESurfaceFaultEffect::VoiceRetry(_)
        | crate::sync_v2::E2ESurfaceFaultEffect::VoiceResult(_)
        | crate::sync_v2::E2ESurfaceFaultEffect::PortExpire { .. }
        | crate::sync_v2::E2ESurfaceFaultEffect::QueueUncertain(_) => Some(json_error(
            StatusCode::INTERNAL_SERVER_ERROR,
            mismatch_error,
        )),
    }
}

#[cfg(feature = "e2e-command-fault")]
async fn e2e_v1_terminal_replay_fault(state: &AppState) -> Option<Response> {
    let runtime = state.services.sync_v2.as_ref()?;
    match runtime
        .intercept_e2e_surface_fault(crate::sync_v2::E2ESurfaceFaultTarget::TerminalReplay)
        .await?
    {
        crate::sync_v2::E2ESurfaceFaultEffect::Continue => None,
        crate::sync_v2::E2ESurfaceFaultEffect::Fail(marker) => {
            Some(json_error(StatusCode::SERVICE_UNAVAILABLE, &marker))
        }
        crate::sync_v2::E2ESurfaceFaultEffect::ReplayUnavailable
        | crate::sync_v2::E2ESurfaceFaultEffect::InvalidCursor => Some(json_error(
            StatusCode::CONFLICT,
            "terminal_replay_unavailable",
        )),
        crate::sync_v2::E2ESurfaceFaultEffect::NotFound
        | crate::sync_v2::E2ESurfaceFaultEffect::VoiceRetry(_)
        | crate::sync_v2::E2ESurfaceFaultEffect::VoiceResult(_)
        | crate::sync_v2::E2ESurfaceFaultEffect::PortExpire { .. }
        | crate::sync_v2::E2ESurfaceFaultEffect::QueueUncertain(_) => Some(json_error(
            StatusCode::INTERNAL_SERVER_ERROR,
            "e2e_terminal_replay_action_mismatch",
        )),
    }
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
    let bearer = if parts.headers.get("origin").is_none() {
        authenticated_session(&state, &parts.headers).await
    } else {
        None
    };
    let bearer_authorized = bearer.as_ref().is_some_and(|authorization| {
        same_tunnel_owner(tunnel.owner_device_id(), authorization.device_id())
    });
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
    let browser_cookie_path = bearer_authorized.then(|| format!("/v1/tunnels/{id}/"));
    tunnels
        .proxy_http(
            tunnel,
            parts.method,
            &target_path,
            &parts.headers,
            body,
            browser_cookie_path.as_deref(),
        )
        .await
        .unwrap_or_else(IntoResponse::into_response)
}

fn same_tunnel_owner(tunnel_owner: Option<&str>, requester: Option<&str>) -> bool {
    tunnel_owner == requester
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
    if headers.get("origin").is_some() {
        return json_error(StatusCode::UNAUTHORIZED, "unauthorized");
    }
    let Some(authorization) =
        authenticated_session(&state, &headers).await
    else {
        return json_error(StatusCode::UNAUTHORIZED, "unauthorized");
    };
    let owner = authorization.device_id().unwrap_or("local-admin");
    match media.materialize_for_owner(owner, &request.url).await {
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
    if headers.get("origin").is_some() {
        return json_error(StatusCode::UNAUTHORIZED, "unauthorized");
    }
    let Some(authorization) =
        authenticated_session(&state, &headers).await
    else {
        return json_error(StatusCode::UNAUTHORIZED, "unauthorized");
    };
    let owner = authorization.device_id().unwrap_or("local-admin");
    media
        .serve_for_owner(owner, &id, method == Method::HEAD)
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
        || !is_authenticated_session(&state, &headers).await
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
        authenticated_session(&state, &headers).await
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
        authenticated_session(&state, &headers).await
    };
    let Some(authorization) = authorization else {
        return json_error(
            StatusCode::UNAUTHORIZED,
            "authenticated_device_session_required",
        );
    };
    #[cfg(feature = "e2e-command-fault")]
    if let Some(response) = e2e_v1_surface_fault(
        &state,
        crate::sync_v2::E2ESurfaceFaultTarget::TerminalOpen,
        "e2e_terminal_fault_action_mismatch",
    )
    .await
    {
        return response;
    }
    #[cfg(feature = "e2e-command-fault")]
    if query.session_id.is_some()
        && query.offset.unwrap_or_default() > 0
        && let Some(response) = e2e_v1_terminal_replay_fault(&state).await
    {
        return response;
    }
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

pub(crate) fn resolve_terminal_spawn_query(
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
        || !is_authenticated_session(&state, &headers).await
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
        || !is_authenticated_session(&state, &headers).await
    {
        return json_error(StatusCode::UNAUTHORIZED, "unauthorized");
    }
    #[cfg(feature = "e2e-command-fault")]
    if let Some(response) = e2e_v1_surface_fault(
        &state,
        crate::sync_v2::E2ESurfaceFaultTarget::ResourceRead,
        "e2e_resource_read_action_mismatch",
    )
    .await
    {
        return response;
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
    if matches!(&state.authorization, Authorization::Registry(_)) {
        return crate::sync_v2::files::protected_file_upload_status(state, query, headers).await;
    }
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
    if matches!(&state.authorization, Authorization::Registry(_)) {
        return crate::sync_v2::files::protected_file_upload_cancel(state, query, headers).await;
    }
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
    if matches!(&state.authorization, Authorization::Registry(_)) {
        return crate::sync_v2::files::protected_file_upload(state, query, headers, body).await;
    }
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
        && is_authenticated_session(state, headers).await
}
