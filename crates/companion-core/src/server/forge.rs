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
