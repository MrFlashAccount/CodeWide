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
                state.services.media.as_deref(),
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

async fn authenticate_bootstrap(
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
    let AuthRequest::Register {
        pairing_token,
        device_name,
        public_key_spki,
        proof,
    } = request
    else {
        return json_error(StatusCode::FORBIDDEN, "pairing_registration_only");
    };
    complete_pairing_claim(
        registry,
        state.services.sync_v2.as_ref(),
        state.services.media.as_deref(),
        PairingClaim {
            pairing_token,
            device_name,
            public_key_spki,
            proof,
        },
    )
    .await
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
    complete_pairing_claim(
        registry,
        state.services.sync_v2.as_ref(),
        state.services.media.as_deref(),
        claim,
    )
    .await
}

async fn complete_pairing_claim(
    registry: &DeviceRegistry,
    sync_v2: Option<&SyncV2Runtime>,
    media: Option<&MediaProxyService>,
    claim: PairingClaim,
) -> Response {
    #[cfg(feature = "e2e-command-fault")]
    if let Some(response) = e2e_pairing_exchange_fault(sync_v2).await {
        return response;
    }
    let result = match registry.claim(claim).await {
        Ok(result) => result,
        Err(error) => return auth_error(&error),
    };
    if result.replaced_existing {
        if let Some(media) = media {
            media.purge_owner(&result.device_id);
        }
        if let Some(runtime) = sync_v2
            && !runtime.purge_device_context(&result.device_id).await
        {
            return json_error(
                StatusCode::INTERNAL_SERVER_ERROR,
                "sync_v2_context_purge_failed",
            );
        }
    }
    (
        StatusCode::CREATED,
        Json(json!({
            "deviceId": result.device_id,
            "capabilityToken": result.capability_token,
            // Kept for clients from the rollout window. This is no longer a
            // per-device mode: the outer server has no private data routes.
            "secureTransportRequired": true,
        })),
    )
        .into_response()
}

#[cfg(feature = "e2e-command-fault")]
async fn e2e_pairing_exchange_fault(sync_v2: Option<&SyncV2Runtime>) -> Option<Response> {
    let runtime = sync_v2?;
    match runtime
        .intercept_e2e_surface_fault(crate::sync_v2::E2ESurfaceFaultTarget::PairingExchange)
        .await?
    {
        crate::sync_v2::E2ESurfaceFaultEffect::Continue => None,
        crate::sync_v2::E2ESurfaceFaultEffect::Fail(marker) => Some(json_error(
            StatusCode::SERVICE_UNAVAILABLE,
            &format!("e2e_pairing_exchange_{marker}"),
        )),
        crate::sync_v2::E2ESurfaceFaultEffect::NotFound
        | crate::sync_v2::E2ESurfaceFaultEffect::ReplayUnavailable
        | crate::sync_v2::E2ESurfaceFaultEffect::InvalidCursor
        | crate::sync_v2::E2ESurfaceFaultEffect::VoiceRetry(_)
        | crate::sync_v2::E2ESurfaceFaultEffect::VoiceResult(_)
        | crate::sync_v2::E2ESurfaceFaultEffect::PortExpire { .. }
        | crate::sync_v2::E2ESurfaceFaultEffect::QueueUncertain(_) => Some(json_error(
            StatusCode::INTERNAL_SERVER_ERROR,
            "e2e_pairing_exchange_action_mismatch",
        )),
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
            if revoked && let Some(media) = &state.services.media {
                media.purge_owner(&device_id);
            }
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
                Some(context @ AuthorizationContext::Session { .. }) => Some(context),
                Some(
                    AuthorizationContext::Admin | AuthorizationContext::Device { .. },
                )
                | None => None,
            }
        }
    }
}

async fn is_authenticated_session(state: &AppState, headers: &HeaderMap) -> bool {
    authenticated_session(state, headers)
        .await
        .is_some()
}

pub(crate) async fn authenticated_session(
    state: &AppState,
    headers: &HeaderMap,
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
                Some(context @ AuthorizationContext::Session { .. }) => Some(context),
                Some(
                    AuthorizationContext::Admin | AuthorizationContext::Device { .. },
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
