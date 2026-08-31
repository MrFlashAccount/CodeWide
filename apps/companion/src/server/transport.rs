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
    bridge_inner_tls(
        &headers,
        upgrade,
        state.services.inner_tls_target,
        state.services.inner_tls_limit.clone(),
    )
    .await
}

async fn e2ee_bootstrap_tunnel(
    State(state): State<AppState>,
    headers: HeaderMap,
    upgrade: WebSocketUpgrade,
) -> Response {
    bridge_inner_tls(
        &headers,
        upgrade,
        state.services.bootstrap_tls_target,
        state.services.bootstrap_tls_limit.clone(),
    )
    .await
}

async fn bridge_inner_tls(
    headers: &HeaderMap,
    upgrade: WebSocketUpgrade,
    target: Option<SocketAddr>,
    limit: Option<Arc<tokio::sync::Semaphore>>,
) -> Response {
    if headers.get("origin").is_some() {
        return json_error(StatusCode::UNAUTHORIZED, "browser_origin_rejected");
    }
    let Some(target) = target else {
        return StatusCode::NOT_FOUND.into_response();
    };
    let Some(limit) = limit else {
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

