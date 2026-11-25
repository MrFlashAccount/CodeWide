// Local administrator routes of the forge context (`codewide-companion forge
// provider list|enable|disable`): the provider rollback switch without a
// device. Included into `server.rs`.

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ForgeProviderEnabledCommand {
    enabled: bool,
}

async fn forge_providers_list(State(state): State<AppState>, headers: HeaderMap) -> Response {
    if headers.get("origin").is_some() || !authorize_admin(&state.authorization, &headers).await {
        return json_error(StatusCode::UNAUTHORIZED, "admin_authorization_required");
    }
    let Some(forge) = state.sync.forge() else {
        return StatusCode::NOT_FOUND.into_response();
    };
    match forge.admin_providers() {
        Ok(providers) => Json(providers).into_response(),
        Err(error) => {
            tracing::error!(kind = error.log_kind(), "forge provider list failed");
            json_error(StatusCode::INTERNAL_SERVER_ERROR, "forge_providers_failed")
        }
    }
}

async fn forge_provider_enabled(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(plugin_id): Path<String>,
    Json(command): Json<ForgeProviderEnabledCommand>,
) -> Response {
    if headers.get("origin").is_some() || !authorize_admin(&state.authorization, &headers).await {
        return json_error(StatusCode::UNAUTHORIZED, "admin_authorization_required");
    }
    let Some(forge) = state.sync.forge() else {
        return StatusCode::NOT_FOUND.into_response();
    };
    match forge.admin_set_enabled(&plugin_id, command.enabled).await {
        Ok(provider) => Json(provider).into_response(),
        Err(error) => {
            tracing::info!(kind = error.log_kind(), "forge provider toggle refused");
            json_error(StatusCode::BAD_REQUEST, "forge_provider_unknown")
        }
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct CommentAttachmentQuery {
    pull_request: String,
    name: String,
}

// The plugin protocol uses a bounded JSON frame. Bound concurrent in-memory bodies as well.
static COMMENT_UPLOADS: tokio::sync::Semaphore = tokio::sync::Semaphore::const_new(2);

async fn forge_comment_attachment(
    State(state): State<AppState>, Query(query): Query<CommentAttachmentQuery>,
    headers: HeaderMap, body: Body,
) -> Response {
    if authorize_sync(&state, &headers).await.is_none() {
        return json_error(StatusCode::UNAUTHORIZED, "unauthorized");
    }
    let Some(forge) = state.sync.forge() else { return json_error(StatusCode::NOT_FOUND, "Forge is unavailable."); };
    if query.name.is_empty() || query.name.len() > 255 || query.name.contains(['/', '\\']) || query.name.chars().any(char::is_control) {
        return json_error(StatusCode::BAD_REQUEST, "Invalid attachment name.");
    }
    let Some(content_type) = headers.get(header::CONTENT_TYPE).and_then(|h| h.to_str().ok()).filter(|s| s.len() <= 128) else {
        return json_error(StatusCode::BAD_REQUEST, "Missing attachment type.");
    };
    let Ok(_permit) = COMMENT_UPLOADS.try_acquire() else { return json_error(StatusCode::TOO_MANY_REQUESTS, "Another upload is in progress. Try again."); };
    let bytes = match tokio::time::timeout(Duration::from_secs(90), axum::body::to_bytes(body, forge_protocol::MAX_MEDIA_BYTES)).await {
        Ok(Ok(bytes)) if !bytes.is_empty() => bytes,
        Ok(Ok(_)) => return json_error(StatusCode::BAD_REQUEST, "The attachment is empty."),
        Ok(Err(_)) => return json_error(StatusCode::PAYLOAD_TOO_LARGE, "The file could not be read within the 10 MiB limit."),
        Err(_) => return json_error(StatusCode::REQUEST_TIMEOUT, "The upload timed out."),
    };
    match forge.upload_comment_attachment(&query.pull_request, query.name, content_type.to_owned(), &bytes).await {
        Ok(asset) => Json(asset).into_response(),
        Err(error) => {
            let rpc = error.to_rpc_error();
            json_error(StatusCode::UNPROCESSABLE_ENTITY, rpc["message"].as_str().unwrap_or("Attachment upload failed."))
        }
    }
}
