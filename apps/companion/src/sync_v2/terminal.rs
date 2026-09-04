//! Authenticated generation-bound V2 Terminal data plane.

use std::time::Duration;

use axum::{
    Router,
    extract::{
        State, WebSocketUpgrade,
        ws::{Message, WebSocket},
    },
    http::{HeaderMap, StatusCode},
    response::Response,
    routing::get,
};
use futures_util::SinkExt;

use crate::{
    server::{AppState, Authorization, authenticated_session, resolve_terminal_spawn_query},
    session_authority::SessionAuthority,
    terminal::{self, TerminalQuery, TerminalSession},
};

use super::{
    AuthenticatedContextKey, http, parse_definition,
    protocol::{TerminalClientRecord, TerminalServerRecord, TransportError, TransportErrorCode},
    scalar::Id,
    serialize_definition,
};

const HANDSHAKE_TIMEOUT: Duration = Duration::from_secs(10);
const RECLAIM_RETRY_DELAY: Duration = Duration::from_millis(50);
const RECLAIM_RETRY_ATTEMPTS: usize = 20;

pub(crate) fn routes() -> Router<AppState> {
    Router::new().route("/v2/terminals", get(terminal_upgrade))
}

async fn terminal_upgrade(
    State(state): State<AppState>,
    headers: HeaderMap,
    upgrade: WebSocketUpgrade,
) -> Response {
    if headers.get("origin").is_some() {
        return unauthorized();
    }
    let Some(authorization) = authenticated_session(&state, &headers).await else {
        return unauthorized();
    };
    let Ok(owner) = AuthenticatedContextKey::derive(&authorization) else {
        return http::error(
            StatusCode::FORBIDDEN,
            TransportErrorCode::Forbidden,
            "paired session required",
        );
    };
    let Some(runtime) = state.services.sync_v2.clone() else {
        return http::error(
            StatusCode::SERVICE_UNAVAILABLE,
            TransportErrorCode::Unavailable,
            "V2 runtime unavailable",
        );
    };
    upgrade
        .max_message_size(2 * 1024 * 1024)
        .max_frame_size(2 * 1024 * 1024)
        .on_upgrade(move |socket| serve_terminal(socket, state, runtime, headers, owner))
}

#[expect(
    clippy::too_many_lines,
    reason = "the closed WebSocket handshake is kept linear so authority checks remain auditable"
)]
async fn serve_terminal(
    mut socket: WebSocket,
    state: AppState,
    runtime: super::SyncV2Runtime,
    headers: HeaderMap,
    owner: AuthenticatedContextKey,
) {
    let first = tokio::time::timeout(HANDSHAKE_TIMEOUT, socket.recv()).await;
    let Ok(Some(Ok(Message::Text(text)))) = first else {
        handshake_error(
            &mut socket,
            TransportErrorCode::InvalidRequest,
            "Terminal open record required",
        )
        .await;
        return;
    };
    let Ok(record) = parse_definition::<TerminalClientRecord>("terminalClientRecord", &text) else {
        handshake_error(
            &mut socket,
            TransportErrorCode::InvalidRequest,
            "invalid Terminal open record",
        )
        .await;
        return;
    };
    let TerminalClientRecord::Open {
        version,
        session_id,
        thread_id,
        generation,
        cwd,
        cols,
        rows,
        offset,
        create,
    } = record
    else {
        handshake_error(
            &mut socket,
            TransportErrorCode::InvalidRequest,
            "Terminal open record required",
        )
        .await;
        return;
    };
    let Ok(generation) = generation.parse::<u64>() else {
        handshake_error(
            &mut socket,
            TransportErrorCode::InvalidRequest,
            "invalid Terminal generation",
        )
        .await;
        return;
    };
    if Id::new(thread_id.clone()).is_err() {
        handshake_error(
            &mut socket,
            TransportErrorCode::InvalidRequest,
            "invalid Terminal thread",
        )
        .await;
        return;
    }
    let Ok(offset) = offset.parse::<u64>() else {
        handshake_error(
            &mut socket,
            TransportErrorCode::InvalidRequest,
            "invalid Terminal offset",
        )
        .await;
        return;
    };
    if version != 2 {
        handshake_error(
            &mut socket,
            TransportErrorCode::GenerationChanged,
            "Terminal generation changed",
        )
        .await;
        return;
    }
    if runtime.generation() != generation {
        handshake_error(
            &mut socket,
            TransportErrorCode::GenerationChanged,
            "Terminal generation changed",
        )
        .await;
        return;
    }
    #[cfg(feature = "e2e-command-fault")]
    if !e2e_terminal_boundary(
        &mut socket,
        &runtime,
        super::E2ESurfaceFaultTarget::TerminalOpen,
    )
    .await
    {
        return;
    }
    #[cfg(feature = "e2e-command-fault")]
    if offset > 0
        && !e2e_terminal_boundary(
            &mut socket,
            &runtime,
            super::E2ESurfaceFaultTarget::TerminalReplay,
        )
        .await
    {
        return;
    }
    let query = TerminalQuery {
        cwd,
        thread_id: Some(thread_id),
        cols: Some(cols),
        rows: Some(rows),
        session_id: Some(session_id),
        offset: Some(offset),
        create: Some(create),
    };
    let mut reclaimed = false;
    let mut attempts = 0;
    let terminal = loop {
        let Some(creation_generation) = current_terminal_generation(&runtime, generation) else {
            handshake_error(
                &mut socket,
                TransportErrorCode::GenerationChanged,
                "Terminal generation changed",
            )
            .await;
            return;
        };
        let Some((attached, authority_still_valid)) = with_current_terminal_authority(
            &state.authorization,
            &headers,
            &owner,
            |creation_authority| {
                state
                    .terminals
                    .attach_or_create_v2(owner.as_str(), generation, &query, || {
                        if !creation_authority.is_valid() {
                            return Err(terminal::TerminalError::AuthorizationUnavailable);
                        }
                        if !generation_is_current(&creation_generation, generation) {
                            return Err(terminal::TerminalError::GenerationChanged);
                        }
                        let query = resolve_terminal_spawn_query(&state, &query)?;
                        TerminalSession::spawn(&query)
                    })
            },
        )
        .await
        else {
            handshake_error(
                &mut socket,
                TransportErrorCode::Forbidden,
                "Terminal session authorization unavailable",
            )
            .await;
            return;
        };
        match attached {
            Ok(terminal)
                if authority_still_valid
                    && generation_is_current(&creation_generation, generation) =>
            {
                break terminal;
            }
            Ok(terminal) if !generation_is_current(&creation_generation, generation) => {
                terminal.revoke();
                handshake_error(
                    &mut socket,
                    TransportErrorCode::GenerationChanged,
                    "Terminal generation changed",
                )
                .await;
                return;
            }
            Ok(terminal) => {
                terminal.revoke();
                handshake_error(
                    &mut socket,
                    TransportErrorCode::Forbidden,
                    "Terminal session authorization unavailable",
                )
                .await;
                return;
            }
            Err(terminal::TerminalError::SessionLimitReached)
                if !reclaimed
                    && query.create == Some(true)
                    && state.terminals.reclaim_oldest_detached_v2(owner.as_str()) =>
            {
                reclaimed = true;
                tokio::time::sleep(RECLAIM_RETRY_DELAY).await;
            }
            Err(terminal::TerminalError::SessionLimitReached)
                if reclaimed && attempts < RECLAIM_RETRY_ATTEMPTS =>
            {
                attempts += 1;
                tokio::time::sleep(RECLAIM_RETRY_DELAY).await;
            }
            Err(error) => {
                let (code, message) = terminal_error(&error);
                handshake_error(&mut socket, code, message).await;
                return;
            }
        }
    };
    let Some(open_generation) = current_terminal_generation(&runtime, generation) else {
        terminal.revoke();
        handshake_error(
            &mut socket,
            TransportErrorCode::GenerationChanged,
            "Terminal generation changed",
        )
        .await;
        return;
    };
    let Some(mut session_authority) =
        current_terminal_authority(&state.authorization, &headers, &owner).await
    else {
        terminal.revoke();
        handshake_error(
            &mut socket,
            TransportErrorCode::Forbidden,
            "Terminal session authorization unavailable",
        )
        .await;
        return;
    };
    let Some(mut process_authority) =
        current_terminal_authority(&state.authorization, &headers, &owner).await
    else {
        terminal.revoke();
        handshake_error(
            &mut socket,
            TransportErrorCode::Forbidden,
            "Terminal session authorization unavailable",
        )
        .await;
        return;
    };
    if !session_authority.is_valid() || !process_authority.is_valid() {
        terminal.revoke();
        handshake_error(
            &mut socket,
            TransportErrorCode::Forbidden,
            "Terminal session authorization unavailable",
        )
        .await;
        return;
    }
    let terminal_process = terminal.clone();
    tokio::spawn(async move {
        process_authority.revoked().await;
        terminal_process.revoke();
    });
    let terminal_process = terminal.clone();
    let mut process_generation = open_generation.clone();
    tokio::spawn(async move {
        loop {
            if process_generation.changed().await.is_err()
                || !generation_is_current(&process_generation, generation)
            {
                terminal_process.revoke();
                return;
            }
        }
    });
    if !session_authority.is_valid() {
        terminal.revoke();
        handshake_error(
            &mut socket,
            TransportErrorCode::Forbidden,
            "Terminal session authorization unavailable",
        )
        .await;
        return;
    }
    terminal::v2::bridge(
        socket,
        terminal,
        generation,
        open_generation,
        session_authority,
        offset,
        #[cfg(feature = "e2e-command-fault")]
        runtime,
    )
    .await;
}

fn current_terminal_generation(
    runtime: &super::SyncV2Runtime,
    expected: u64,
) -> Option<tokio::sync::watch::Receiver<u64>> {
    let changes = runtime.subscribe_generation();
    generation_is_current(&changes, expected).then_some(changes)
}

fn generation_is_current(changes: &tokio::sync::watch::Receiver<u64>, expected: u64) -> bool {
    *changes.borrow() == expected
}

/// Subscribes before consulting the current durable registry. This ordering
/// closes both sides of the authorization race: a completed revocation makes
/// the registry lookup fail, while a concurrent revocation is retained by the
/// receiver and observed by `is_valid` before the caller creates or opens a PTY.
async fn current_terminal_authority(
    authorization_source: &Authorization,
    headers: &HeaderMap,
    expected_owner: &AuthenticatedContextKey,
) -> Option<SessionAuthority> {
    let Authorization::Registry(registry) = authorization_source else {
        return None;
    };
    let changes = registry.subscribe_authorization_changes();
    let credential = headers
        .get(axum::http::header::AUTHORIZATION)
        .and_then(|value| value.to_str().ok());
    let authorization = registry.authorization_context(credential).await?;
    let crate::auth::AuthorizationContext::Session { .. } = &authorization else {
        return None;
    };
    if AuthenticatedContextKey::derive(&authorization)
        .ok()
        .as_ref()
        != Some(expected_owner)
    {
        return None;
    }
    let mut authority = SessionAuthority::new(&authorization, Some(changes))?;
    authority.is_valid().then_some(authority)
}

async fn with_current_terminal_authority<T>(
    authorization_source: &Authorization,
    headers: &HeaderMap,
    expected_owner: &AuthenticatedContextKey,
    operation: impl FnOnce(&mut SessionAuthority) -> T,
) -> Option<(T, bool)> {
    let mut authority =
        current_terminal_authority(authorization_source, headers, expected_owner).await?;
    let value = operation(&mut authority);
    Some((value, authority.is_valid()))
}

fn terminal_error(error: &terminal::TerminalError) -> (TransportErrorCode, &'static str) {
    match error {
        terminal::TerminalError::ReplayUnavailable => (
            TransportErrorCode::ReplayUnavailable,
            "Terminal replay unavailable",
        ),
        terminal::TerminalError::GenerationChanged => (
            TransportErrorCode::GenerationChanged,
            "Terminal generation changed",
        ),
        terminal::TerminalError::SessionOwnedByAnotherDevice => {
            (TransportErrorCode::Forbidden, "Terminal audience mismatch")
        }
        terminal::TerminalError::AuthorizationUnavailable => (
            TransportErrorCode::Forbidden,
            "Terminal session authorization unavailable",
        ),
        terminal::TerminalError::SessionLimitReached => (
            TransportErrorCode::LimitExceeded,
            "Terminal session limit exceeded",
        ),
        terminal::TerminalError::SessionNotFound | terminal::TerminalError::ThreadNotFound => {
            (TransportErrorCode::NotFound, "Terminal resource not found")
        }
        terminal::TerminalError::SessionThreadMismatch => {
            (TransportErrorCode::Conflict, "Terminal thread mismatch")
        }
        terminal::TerminalError::ThreadResolutionFailed { .. }
        | terminal::TerminalError::SpawnFailed { .. } => {
            (TransportErrorCode::Unavailable, "Terminal unavailable")
        }
        terminal::TerminalError::InvalidSize
        | terminal::TerminalError::InvalidCwd
        | terminal::TerminalError::InvalidThread
        | terminal::TerminalError::InvalidSession => (
            TransportErrorCode::InvalidRequest,
            "invalid Terminal request",
        ),
    }
}

async fn handshake_error(socket: &mut WebSocket, code: TransportErrorCode, message: &'static str) {
    handshake_error_owned(socket, code, message.to_owned()).await;
}

async fn handshake_error_owned(socket: &mut WebSocket, code: TransportErrorCode, message: String) {
    let record = TerminalServerRecord::Error {
        error: TransportError { code, message },
    };
    if let Ok(text) = serialize_definition("terminalServerRecord", &record) {
        let _ = socket.send(Message::Text(text.into())).await;
    }
    let _ = socket.close().await;
}

#[cfg(feature = "e2e-command-fault")]
async fn e2e_terminal_boundary(
    socket: &mut WebSocket,
    runtime: &super::SyncV2Runtime,
    target: super::E2ESurfaceFaultTarget,
) -> bool {
    let Some(effect) = runtime.intercept_e2e_surface_fault(target).await else {
        return true;
    };
    match effect {
        super::E2ESurfaceFaultEffect::Continue => true,
        super::E2ESurfaceFaultEffect::Fail(marker) => {
            handshake_error_owned(
                socket,
                TransportErrorCode::Unavailable,
                format!("E2E fault: {marker}"),
            )
            .await;
            false
        }
        super::E2ESurfaceFaultEffect::ReplayUnavailable => {
            handshake_error(
                socket,
                TransportErrorCode::ReplayUnavailable,
                "Terminal replay unavailable",
            )
            .await;
            false
        }
        super::E2ESurfaceFaultEffect::InvalidCursor => {
            handshake_error(
                socket,
                TransportErrorCode::InvalidRequest,
                "Terminal replay cursor is invalid",
            )
            .await;
            false
        }
        super::E2ESurfaceFaultEffect::NotFound
        | super::E2ESurfaceFaultEffect::VoiceRetry(_)
        | super::E2ESurfaceFaultEffect::VoiceResult(_)
        | super::E2ESurfaceFaultEffect::PortExpire { .. }
        | super::E2ESurfaceFaultEffect::QueueUncertain(_) => {
            handshake_error(
                socket,
                TransportErrorCode::Unavailable,
                "E2E surface fault action did not match the Terminal boundary",
            )
            .await;
            false
        }
    }
}

fn unauthorized() -> Response {
    http::error(
        StatusCode::UNAUTHORIZED,
        TransportErrorCode::Unauthorized,
        "authenticated device session required",
    )
}

#[cfg(test)]
mod tests {
    use std::{
        error::Error,
        sync::{
            Arc,
            atomic::{AtomicUsize, Ordering},
        },
    };

    use base64::{Engine as _, engine::general_purpose};
    use p256::{
        ecdsa::{Signature, SigningKey, signature::Signer},
        pkcs8::EncodePublicKey,
    };

    use crate::auth::{DeviceRegistry, PairingClaim, SessionProof, pairing_claim_message};

    use super::*;

    #[tokio::test]
    async fn revoke_during_delayed_open_is_forbidden_before_pty_creation()
    -> Result<(), Box<dyn Error>> {
        let directory = tempfile::tempdir()?;
        let registry = Arc::new(
            DeviceRegistry::open(
                Arc::from("terminal-test-admin-token-long-enough"),
                directory.path().join("devices.json"),
                None,
            )
            .await?,
        );
        let signing = SigningKey::from_bytes((&[19_u8; 32]).into())?;
        let public_key_spki = general_purpose::STANDARD
            .encode(signing.verifying_key().to_public_key_der()?.as_bytes());
        let pairing = registry.create_pairing().await?;
        let claim_signature: Signature = signing.sign(&pairing_claim_message(
            &pairing.pairing_token,
            "Delayed Terminal",
            &public_key_spki,
        ));
        let claim = registry
            .claim(PairingClaim {
                pairing_token: pairing.pairing_token,
                device_name: "Delayed Terminal".into(),
                public_key_spki,
                proof: general_purpose::STANDARD.encode(claim_signature.to_der().as_bytes()),
            })
            .await?;
        let device_bearer = format!("Bearer {}", claim.capability_token);
        let challenge = registry.challenge(Some(&device_bearer)).await?;
        let challenge_signature: Signature =
            signing.sign(&general_purpose::URL_SAFE_NO_PAD.decode(&challenge.challenge)?);
        let session = registry
            .create_session(
                Some(&device_bearer),
                SessionProof {
                    challenge_id: challenge.challenge_id,
                    signature: general_purpose::STANDARD
                        .encode(challenge_signature.to_der().as_bytes()),
                },
            )
            .await?;
        let session_bearer = format!("Bearer {}", session.session_token);
        let initial = registry
            .authorization_context(Some(&session_bearer))
            .await
            .ok_or("initial terminal authorization missing")?;
        let owner = AuthenticatedContextKey::derive(&initial).map_err(|error| {
            std::io::Error::other(format!(
                "initial terminal context derivation failed: {:?}",
                error.code
            ))
        })?;
        let mut headers = HeaderMap::new();
        headers.insert(axum::http::header::AUTHORIZATION, session_bearer.parse()?);

        assert!(registry.revoke(&claim.device_id).await?);

        let pty_creations = AtomicUsize::new(0);
        let result = with_current_terminal_authority(
            &Authorization::Registry(registry),
            &headers,
            &owner,
            |_| pty_creations.fetch_add(1, Ordering::SeqCst),
        )
        .await;
        assert!(result.is_none());
        assert_eq!(pty_creations.load(Ordering::SeqCst), 0);
        Ok(())
    }
}
