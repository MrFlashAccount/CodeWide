async fn sync_upgrade(
    State(state): State<AppState>,
    headers: HeaderMap,
    tls: Option<axum::Extension<DeviceTlsConnectInfo>>,
    upgrade: WebSocketUpgrade,
) -> Response {
    let mut authorization_changes = match &state.authorization {
        Authorization::Registry(registry) => Some(registry.subscribe_authorization_changes()),
        Authorization::AdminOnly(_) => None,
    };
    let authorization =
        authorize_sync_transport(&state, &headers, tls.as_ref().map(|value| &value.0)).await;
    if headers.get("origin").is_some() || authorization.is_none() {
        return StatusCode::UNAUTHORIZED.into_response();
    }
    let authorization = authorization.unwrap_or(AuthorizationContext::Admin);
    let presence = match (&state.authorization, authorization.device_id()) {
        (Authorization::Registry(registry), Some(device_id)) => Some((
            registry.connection_lease(device_id.to_owned()),
            registry.clone(),
            device_id.to_owned(),
        )),
        _ => None,
    };
    if authorization.device_id().is_none() {
        authorization_changes = None;
    }
    upgrade
        .max_message_size(64 * 1024 * 1024)
        .max_frame_size(64 * 1024 * 1024)
        .on_upgrade(move |socket| async move {
            state
                .sync
                .serve(socket, authorization, authorization_changes)
                .await;
            if let Some((lease, registry, device_id)) = presence {
                drop(lease);
                if let Err(error) = registry.mark_device_disconnected(&device_id).await {
                    tracing::warn!(err = ?error, "device last-seen checkpoint failed");
                }
            }
        })
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
