use crate::host_update::{
    ApplyHostUpdateCommand, ApplyHostUpdateRequest, GuardianError, GuardianErrorCode,
    HostUpdateCapability, ReconnectReceipt,
};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct HostUpdateErrorBody {
    error: String,
    message: String,
}

async fn host_update_status(State(state): State<AppState>, headers: HeaderMap) -> Response {
    if let Err(response) = host_update_actor(&state.authorization, &headers).await {
        return response;
    }
    let Some(guardian) = &state.host_update_guardian else {
        return manual_update_required("platform_guardian_unavailable");
    };
    guardian
        .status()
        .await
        .map_or_else(host_update_error, |status| Json(status).into_response())
}

async fn host_update_check(State(state): State<AppState>, headers: HeaderMap) -> Response {
    if let Err(response) = host_update_actor(&state.authorization, &headers).await {
        return response;
    }
    let Some(guardian) = &state.host_update_guardian else {
        return manual_update_required("platform_guardian_unavailable");
    };
    guardian
        .check()
        .await
        .map_or_else(host_update_error, |status| Json(status).into_response())
}

async fn host_update_apply(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(request): Json<ApplyHostUpdateRequest>,
) -> Response {
    let actor = match host_update_actor(&state.authorization, &headers).await {
        Ok(actor) => actor,
        Err(response) => return response,
    };
    if !valid_hex(&request.target_fingerprint, 64)
        || !valid_opaque_id(&request.idempotency_key, 20, 128)
    {
        return host_update_json_error(
            StatusCode::BAD_REQUEST,
            "invalid_update_request",
            "target fingerprint or idempotency key is invalid",
        );
    }
    let Some(guardian) = &state.host_update_guardian else {
        return manual_update_required("platform_guardian_unavailable");
    };
    host_update_apply_authorized(guardian.as_ref(), actor, request).await
}

async fn host_update_apply_authorized(
    guardian: &dyn crate::host_update::HostUpdateGuardian,
    actor: String,
    request: ApplyHostUpdateRequest,
) -> Response {
    let capability = guardian.capability();
    if !capability.supports_remote_apply() {
        return unsupported_capability(&capability);
    }
    match guardian
        .apply(ApplyHostUpdateCommand {
            target_fingerprint: request.target_fingerprint,
            idempotency_key: request.idempotency_key,
            initiating_device_id: actor,
        })
        .await
    {
        Ok(accepted)
            if valid_opaque_id(&accepted.operation_id, 20, 128)
                && accepted.phase == crate::host_update::HostUpdatePhase::Accepted =>
        {
            let location = format!(
                "/v1/host-update/operations/{}",
                accepted.operation_id
            );
            let Ok(value) = header::HeaderValue::from_str(&location) else {
                return host_update_json_error(
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "invalid_guardian_response",
                    "guardian returned an invalid operation id",
                );
            };
            let mut response = (StatusCode::ACCEPTED, Json(accepted)).into_response();
            response.headers_mut().insert(header::LOCATION, value);
            response
        }
        Ok(_) => host_update_json_error(
            StatusCode::INTERNAL_SERVER_ERROR,
            "invalid_guardian_response",
            "guardian acknowledged before persisting an accepted operation",
        ),
        Err(error) => host_update_error(error),
    }
}

async fn host_update_operation(
    State(state): State<AppState>,
    Path(operation_id): Path<String>,
    headers: HeaderMap,
) -> Response {
    if let Err(response) = host_update_actor(&state.authorization, &headers).await {
        return response;
    }
    if !valid_opaque_id(&operation_id, 20, 128) {
        return host_update_json_error(
            StatusCode::NOT_FOUND,
            "operation_not_found",
            "host update operation was not found",
        );
    }
    let Some(guardian) = &state.host_update_guardian else {
        return manual_update_required("platform_guardian_unavailable");
    };
    guardian
        .operation(&operation_id)
        .await
        .map_or_else(host_update_error, |operation| Json(operation).into_response())
}

async fn host_update_reconnect(
    State(state): State<AppState>,
    Path(operation_id): Path<String>,
    headers: HeaderMap,
) -> Response {
    let actor = match host_update_actor(&state.authorization, &headers).await {
        Ok(actor) => actor,
        Err(response) => return response,
    };
    if !valid_opaque_id(&operation_id, 20, 128) {
        return host_update_json_error(
            StatusCode::PRECONDITION_FAILED,
            "invalid_reconnect_receipt",
            "reconnect receipt is invalid or stale",
        );
    }
    let Some(guardian) = &state.host_update_guardian else {
        return manual_update_required("platform_guardian_unavailable");
    };
    guardian
        .reconnect(ReconnectReceipt {
            operation_id,
            device_id: actor,
        })
        .await
        .map_or_else(host_update_error, |operation| Json(operation).into_response())
}

async fn host_update_actor(
    authorization: &Authorization,
    headers: &HeaderMap,
) -> Result<String, Response> {
    if headers.get(header::ORIGIN).is_some() {
        return Err(host_update_json_error(
            StatusCode::UNAUTHORIZED,
            "browser_origin_rejected",
            "browser-origin requests are not accepted",
        ));
    }
    let context = match authorization {
        Authorization::Registry(registry) => {
            registry.authorization_context(header_auth(headers)).await
        }
        Authorization::AdminOnly(_) => None,
    };
    match context {
        Some(AuthorizationContext::Session { device_id, .. }) => Ok(device_id),
        _ => Err(host_update_json_error(
            StatusCode::UNAUTHORIZED,
            "device_session_required",
            "an authenticated device session is required",
        )),
    }
}

fn unsupported_capability(capability: &HostUpdateCapability) -> Response {
    manual_update_required(
        capability
            .unavailable_reason
            .as_deref()
            .unwrap_or("guardian_contract_unsupported"),
    )
}

fn manual_update_required(message: &str) -> Response {
    host_update_json_error(
        StatusCode::PRECONDITION_FAILED,
        "manual_update_required",
        message,
    )
}

fn host_update_error(error: GuardianError) -> Response {
    let status = match error.code {
        GuardianErrorCode::NotFound => StatusCode::NOT_FOUND,
        GuardianErrorCode::Conflict | GuardianErrorCode::IdempotencyConflict => {
            StatusCode::CONFLICT
        }
        GuardianErrorCode::PreconditionFailed | GuardianErrorCode::ManualUpdateRequired => {
            StatusCode::PRECONDITION_FAILED
        }
        GuardianErrorCode::Locked => StatusCode::LOCKED,
        GuardianErrorCode::Internal => StatusCode::INTERNAL_SERVER_ERROR,
    };
    (
        status,
        Json(HostUpdateErrorBody {
            error: error.code.reason().to_owned(),
            message: error.message,
        }),
    )
        .into_response()
}

fn host_update_json_error(status: StatusCode, error: &str, message: &str) -> Response {
    (
        status,
        Json(HostUpdateErrorBody {
            error: error.to_owned(),
            message: message.to_owned(),
        }),
    )
        .into_response()
}

fn valid_opaque_id(value: &str, minimum: usize, maximum: usize) -> bool {
    (minimum..=maximum).contains(&value.len())
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
}

fn valid_hex(value: &str, length: usize) -> bool {
    value.len() == length
        && value
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
}

#[cfg(test)]
#[allow(clippy::expect_used)]
mod host_update_server_tests {
    use super::*;
    use base64::{Engine as _, engine::general_purpose};
    use p256::{
        ecdsa::{Signature, SigningKey, signature::Signer},
        pkcs8::EncodePublicKey,
    };
    use crate::host_update::{
        ApplyHostUpdateAccepted, HostUpdateGuardian, HostUpdateOperation, HostUpdatePhase,
        HostUpdateStatus,
    };

    struct TestGuardian {
        capability: HostUpdateCapability,
        applied: std::sync::Mutex<Vec<ApplyHostUpdateCommand>>,
    }

    #[async_trait::async_trait]
    impl HostUpdateGuardian for TestGuardian {
        fn capability(&self) -> HostUpdateCapability {
            self.capability.clone()
        }

        async fn status(&self) -> Result<HostUpdateStatus, GuardianError> {
            Err(GuardianError::new(
                GuardianErrorCode::Internal,
                "unused",
            ))
        }

        async fn check(&self) -> Result<HostUpdateStatus, GuardianError> {
            self.status().await
        }

        async fn apply(
            &self,
            command: ApplyHostUpdateCommand,
        ) -> Result<ApplyHostUpdateAccepted, GuardianError> {
            self.applied
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner)
                .push(command);
            Ok(ApplyHostUpdateAccepted {
                operation_id: "019f0000-0000-7000-8000-000000000001".to_owned(),
                phase: HostUpdatePhase::Accepted,
            })
        }

        async fn operation(
            &self,
            _operation_id: &str,
        ) -> Result<HostUpdateOperation, GuardianError> {
            Err(GuardianError::new(
                GuardianErrorCode::Internal,
                "unused",
            ))
        }

        async fn reconnect(
            &self,
            _receipt: ReconnectReceipt,
        ) -> Result<HostUpdateOperation, GuardianError> {
            self.operation("unused").await
        }
    }

    fn test_capability(apply_supported: bool) -> HostUpdateCapability {
        HostUpdateCapability {
            api_version: 1,
            guardian_contract_version: 1,
            journal_version: 1,
            bootstrap_version: 1,
            apply_supported,
            unavailable_reason: (!apply_supported).then(|| "guardian_not_proven".to_owned()),
        }
    }

    fn apply_request() -> ApplyHostUpdateRequest {
        ApplyHostUpdateRequest {
            target_fingerprint: "a".repeat(64),
            idempotency_key: "019f0000-0000-7000-8000-000000000002".to_owned(),
        }
    }

    #[test]
    fn request_identifiers_are_bounded_and_non_enumerable_shapes() {
        assert!(valid_opaque_id(
            "019f0000-0000-7000-8000-000000000001",
            20,
            128
        ));
        assert!(!valid_opaque_id("12", 20, 128));
        assert!(!valid_opaque_id("../../operation", 8, 128));
        assert!(valid_hex(&"a".repeat(64), 64));
        assert!(!valid_hex(&"A".repeat(64), 64));
    }

    #[test]
    fn guardian_errors_have_deterministic_http_statuses() {
        for (code, status) in [
            (GuardianErrorCode::NotFound, StatusCode::NOT_FOUND),
            (GuardianErrorCode::Conflict, StatusCode::CONFLICT),
            (
                GuardianErrorCode::IdempotencyConflict,
                StatusCode::CONFLICT,
            ),
            (
                GuardianErrorCode::PreconditionFailed,
                StatusCode::PRECONDITION_FAILED,
            ),
            (GuardianErrorCode::Locked, StatusCode::LOCKED),
            (
                GuardianErrorCode::ManualUpdateRequired,
                StatusCode::PRECONDITION_FAILED,
            ),
        ] {
            assert_eq!(
                host_update_error(GuardianError::new(code, "test")).status(),
                status
            );
        }
    }

    #[tokio::test]
    async fn apply_returns_location_only_after_capable_guardian_accepts_actor() {
        let guardian = TestGuardian {
            capability: test_capability(true),
            applied: std::sync::Mutex::new(Vec::new()),
        };
        let response = host_update_apply_authorized(
            &guardian,
            "device-a".to_owned(),
            apply_request(),
        )
        .await;
        assert_eq!(response.status(), StatusCode::ACCEPTED);
        assert_eq!(
            response.headers().get(header::LOCATION),
            Some(&header::HeaderValue::from_static(
                "/v1/host-update/operations/019f0000-0000-7000-8000-000000000001"
            ))
        );
        let applied = guardian
            .applied
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        assert_eq!(applied.len(), 1);
        assert_eq!(applied[0].initiating_device_id, "device-a");
    }

    #[tokio::test]
    async fn unsupported_guardian_is_rejected_before_apply() {
        let guardian = TestGuardian {
            capability: test_capability(false),
            applied: std::sync::Mutex::new(Vec::new()),
        };
        let response = host_update_apply_authorized(
            &guardian,
            "device-a".to_owned(),
            apply_request(),
        )
        .await;
        assert_eq!(response.status(), StatusCode::PRECONDITION_FAILED);
        assert!(
            guardian
                .applied
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner)
                .is_empty()
        );
    }

    #[tokio::test]
    async fn host_update_requires_a_non_browser_device_session()
    -> Result<(), Box<dyn std::error::Error>> {
        let directory = tempfile::tempdir()?;
        let registry = Arc::new(
            DeviceRegistry::open(
                Arc::from("admin-token-that-is-long-enough-for-tests"),
                directory.path().join("devices.json"),
                Some(60_000),
            )
            .await?,
        );
        let signing = SigningKey::random(&mut p256::elliptic_curve::rand_core::OsRng);
        let public_key = general_purpose::STANDARD.encode(
            signing
                .verifying_key()
                .to_public_key_der()?
                .as_bytes(),
        );
        let pairing = registry.create_pairing().await?;
        let proof: Signature = signing.sign(&crate::auth::pairing_claim_message(
            &pairing.pairing_token,
            "Android phone",
            &public_key,
        ));
        let claimed = registry
            .claim(PairingClaim {
                pairing_token: pairing.pairing_token,
                device_name: "Android phone".to_owned(),
                public_key_spki: public_key,
                proof: general_purpose::STANDARD.encode(proof.to_der().as_bytes()),
            })
            .await?;
        let device_bearer = format!("Bearer {}", claimed.capability_token);
        let challenge = registry.challenge(Some(&device_bearer)).await?;
        let challenge_bytes = general_purpose::URL_SAFE_NO_PAD.decode(&challenge.challenge)?;
        let signature: Signature = signing.sign(&challenge_bytes);
        let session = registry
            .create_session(
                Some(&device_bearer),
                SessionProof {
                    challenge_id: challenge.challenge_id,
                    signature: general_purpose::STANDARD.encode(signature.to_der().as_bytes()),
                },
            )
            .await?;
        let authorization = Authorization::Registry(registry);

        let mut session_headers = HeaderMap::new();
        session_headers.insert(
            header::AUTHORIZATION,
            header::HeaderValue::from_str(&format!("Bearer {}", session.session_token))?,
        );
        assert_eq!(
            host_update_actor(&authorization, &session_headers)
                .await
                .expect("session is authorized"),
            claimed.device_id
        );

        let mut capability_headers = HeaderMap::new();
        capability_headers.insert(
            header::AUTHORIZATION,
            header::HeaderValue::from_str(&device_bearer)?,
        );
        assert_eq!(
            host_update_actor(&authorization, &capability_headers)
                .await
                .expect_err("device capability is not a session")
                .status(),
            StatusCode::UNAUTHORIZED
        );

        session_headers.insert(header::ORIGIN, header::HeaderValue::from_static("https://example.test"));
        assert_eq!(
            host_update_actor(&authorization, &session_headers)
                .await
                .expect_err("browser origin must be rejected")
                .status(),
            StatusCode::UNAUTHORIZED
        );
        Ok(())
    }
}
