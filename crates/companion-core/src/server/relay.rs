async fn relay_status(State(state): State<AppState>, headers: HeaderMap) -> Response {
    if headers.get("origin").is_some() || !authorize_admin(&state.authorization, &headers).await {
        return json_error(StatusCode::UNAUTHORIZED, "admin_authorization_required");
    }
    let Some(runtime) = state.services.relay.as_ref() else {
        return StatusCode::NOT_FOUND.into_response();
    };
    match runtime.status() {
        Ok(status) => Json(status).into_response(),
        Err(error) => {
            tracing::error!(err = ?error, "Relay status failed");
            json_error(StatusCode::INTERNAL_SERVER_ERROR, "relay_status_failed")
        }
    }
}

async fn relay_pair(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(command): Json<crate::relay::RelayPairCommand>,
) -> Response {
    if headers.get("origin").is_some() || !authorize_admin(&state.authorization, &headers).await {
        return json_error(StatusCode::UNAUTHORIZED, "admin_authorization_required");
    }
    let Some(runtime) = state.services.relay.as_ref() else {
        return StatusCode::NOT_FOUND.into_response();
    };
    match runtime.pair(command).await {
        Ok(status) => (StatusCode::CREATED, Json(status)).into_response(),
        Err(error) => {
            tracing::error!(err = ?error, "Relay pairing failed");
            json_error(StatusCode::BAD_REQUEST, "relay_pairing_failed")
        }
    }
}

async fn relay_enabled(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(command): Json<crate::relay::RelayEnabledCommand>,
) -> Response {
    if headers.get("origin").is_some() || !authorize_admin(&state.authorization, &headers).await {
        return json_error(StatusCode::UNAUTHORIZED, "admin_authorization_required");
    }
    let Some(runtime) = state.services.relay.as_ref() else {
        return StatusCode::NOT_FOUND.into_response();
    };
    match runtime.set_enabled(command.enabled).await {
        Ok(status) => Json(status).into_response(),
        Err(error) => {
            tracing::error!(err = ?error, "Relay configuration failed");
            json_error(StatusCode::BAD_REQUEST, "relay_configuration_failed")
        }
    }
}

async fn relay_update_status(State(state): State<AppState>, headers: HeaderMap) -> Response {
    if headers.get("origin").is_some() || !authorize_admin(&state.authorization, &headers).await {
        return json_error(StatusCode::UNAUTHORIZED, "admin_authorization_required");
    }
    let Some(runtime) = state.services.relay.as_ref() else {
        return StatusCode::NOT_FOUND.into_response();
    };
    runtime
        .update_status()
        .await
        .map_or_else(
            |error| relay_update_error(&error),
            |status| Json(status).into_response(),
        )
}

async fn relay_update_check(State(state): State<AppState>, headers: HeaderMap) -> Response {
    if headers.get("origin").is_some() || !authorize_admin(&state.authorization, &headers).await {
        return json_error(StatusCode::UNAUTHORIZED, "admin_authorization_required");
    }
    let Some(runtime) = state.services.relay.as_ref() else {
        return StatusCode::NOT_FOUND.into_response();
    };
    runtime
        .check_update()
        .await
        .map_or_else(
            |error| relay_update_error(&error),
            |status| Json(status).into_response(),
        )
}

async fn relay_update_apply(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(request): Json<codewide_relay::update::ApplyRelayUpdateRequest>,
) -> Response {
    if headers.get("origin").is_some() || !authorize_admin(&state.authorization, &headers).await {
        return json_error(StatusCode::UNAUTHORIZED, "admin_authorization_required");
    }
    let Some(runtime) = state.services.relay.as_ref() else {
        return StatusCode::NOT_FOUND.into_response();
    };
    runtime.apply_update(&request).await.map_or_else(|error| relay_update_error(&error), |accepted| {
        (StatusCode::ACCEPTED, Json(accepted)).into_response()
    })
}

async fn relay_update_operation(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(operation_id): Path<String>,
) -> Response {
    if headers.get("origin").is_some() || !authorize_admin(&state.authorization, &headers).await {
        return json_error(StatusCode::UNAUTHORIZED, "admin_authorization_required");
    }
    let Some(runtime) = state.services.relay.as_ref() else {
        return StatusCode::NOT_FOUND.into_response();
    };
    runtime
        .update_operation(&operation_id)
        .await
        .map_or_else(
            |error| relay_update_error(&error),
            |operation| Json(operation).into_response(),
        )
}

async fn relay_update_reconnect(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(operation_id): Path<String>,
) -> Response {
    if headers.get("origin").is_some() || !authorize_admin(&state.authorization, &headers).await {
        return json_error(StatusCode::UNAUTHORIZED, "admin_authorization_required");
    }
    let Some(runtime) = state.services.relay.as_ref() else {
        return StatusCode::NOT_FOUND.into_response();
    };
    runtime
        .reconnect_update(&operation_id)
        .await
        .map_or_else(
            |error| relay_update_error(&error),
            |operation| Json(operation).into_response(),
        )
}

fn relay_update_error(error: &crate::relay::RelayError) -> Response {
    tracing::error!(err = ?error, "Relay update request failed");
    (
        StatusCode::BAD_GATEWAY,
        Json(serde_json::json!({
            "error": "relay_update_failed",
            "message": error.to_string(),
        })),
    )
        .into_response()
}
