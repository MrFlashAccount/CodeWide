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
    server::{AppState, Authorization, authorization_for_scope, resolve_terminal_spawn_query},
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
    let Some(authorization) = authorization_for_scope(&state, &headers, "shell.explicit").await
    else {
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
    let registry = match &state.authorization {
        Authorization::Registry(registry) => Some(registry.clone()),
        Authorization::AdminOnly(_) => None,
    };
    upgrade
        .max_message_size(2 * 1024 * 1024)
        .max_frame_size(2 * 1024 * 1024)
        .on_upgrade(move |socket| {
            serve_terminal(socket, state, runtime, authorization, owner, registry)
        })
}

#[expect(
    clippy::too_many_lines,
    reason = "the closed WebSocket handshake is kept linear so authority checks remain auditable"
)]
async fn serve_terminal(
    mut socket: WebSocket,
    state: AppState,
    runtime: super::SyncV2Runtime,
    authorization: crate::auth::AuthorizationContext,
    owner: AuthenticatedContextKey,
    registry: Option<std::sync::Arc<crate::auth::DeviceRegistry>>,
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
    let Some(mut session_authority) = SessionAuthority::new(
        &authorization,
        registry
            .as_ref()
            .map(|registry| registry.subscribe_authorization_changes()),
    ) else {
        handshake_error(
            &mut socket,
            TransportErrorCode::Forbidden,
            "paired session required",
        )
        .await;
        return;
    };
    let query = TerminalQuery {
        cwd,
        thread_id: Some(thread_id),
        cols: Some(cols),
        rows: Some(rows),
        session_id: Some(session_id),
        offset: Some(offset),
        create: Some(create),
    };
    let terminal =
        match state
            .terminals
            .attach_or_create_v2(owner.as_str(), generation, &query, || {
                let query = resolve_terminal_spawn_query(&state, &query)?;
                TerminalSession::spawn(&query)
            }) {
            Ok(terminal) => terminal,
            Err(error) => {
                let (code, message) = terminal_error(&error);
                handshake_error(&mut socket, code, message).await;
                return;
            }
        };
    let Some(mut process_authority) = SessionAuthority::new(
        &authorization,
        registry
            .as_ref()
            .map(|registry| registry.subscribe_authorization_changes()),
    ) else {
        terminal.revoke();
        handshake_error(
            &mut socket,
            TransportErrorCode::Forbidden,
            "Terminal session authorization unavailable",
        )
        .await;
        return;
    };
    let terminal_process = terminal.clone();
    tokio::spawn(async move {
        process_authority.revoked().await;
        terminal_process.revoke();
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
    terminal::v2::bridge(socket, terminal, generation, session_authority, offset).await;
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
    let record = TerminalServerRecord::Error {
        error: TransportError::new(code, message),
    };
    if let Ok(text) = serialize_definition("terminalServerRecord", &record) {
        let _ = socket.send(Message::Text(text.into())).await;
    }
    let _ = socket.close().await;
}

fn unauthorized() -> Response {
    http::error(
        StatusCode::UNAUTHORIZED,
        TransportErrorCode::Unauthorized,
        "shell.explicit session scope required",
    )
}
