//! V2 Terminal WebSocket bridge over the companion-owned PTY registry.

use std::sync::Arc;

use axum::extract::ws::{CloseFrame, Message, WebSocket};
use base64::{Engine as _, engine::general_purpose::STANDARD};

use crate::{
    session_authority::SessionAuthority,
    sync_v2::{
        parse_definition,
        protocol::{
            TerminalClientRecord, TerminalServerRecord, TransportError, TransportErrorCode,
        },
        serialize_definition,
    },
};

use super::{
    LiveTerminal, ReplayChunk, ReplayFailure, ReplayReadError, TerminalExit, TerminalState,
    WriterCommand, lock, validate_size,
};

enum ReplaySendError {
    Authorization,
    Generation,
    Socket,
    Replay(ReplayReadError),
}

#[allow(clippy::too_many_lines)]
pub(crate) async fn bridge(
    mut socket: WebSocket,
    terminal: Arc<LiveTerminal>,
    generation: u64,
    mut generation_changes: tokio::sync::watch::Receiver<u64>,
    mut authority: SessionAuthority,
    offset: u64,
    #[cfg(feature = "e2e-command-fault")] e2e_runtime: crate::sync_v2::SyncV2Runtime,
) {
    let _attachment = terminal.attach();
    let mut output = terminal.output.subscribe();
    let mut state = terminal.state.subscribe();
    let mut cursor = offset;
    if !authority.is_valid() {
        terminal.revoke();
        send_error(
            &mut socket,
            TransportErrorCode::Forbidden,
            "Terminal session authorization unavailable",
        )
        .await;
        return;
    }
    if *generation_changes.borrow() != generation {
        terminal.revoke();
        send_error(
            &mut socket,
            TransportErrorCode::GenerationChanged,
            "Terminal generation changed",
        )
        .await;
        return;
    }
    let cursor_available = lock(&terminal.replay).contains_offset(cursor);
    if !cursor_available {
        terminal.revoke_and_wait().await;
        send_error(
            &mut socket,
            TransportErrorCode::ReplayUnavailable,
            "Terminal replay cursor is unavailable",
        )
        .await;
        return;
    }
    if *generation_changes.borrow() != generation {
        terminal.revoke();
        send_error(
            &mut socket,
            TransportErrorCode::GenerationChanged,
            "Terminal generation changed",
        )
        .await;
        return;
    }
    if send_opened(&mut socket, &terminal, generation, cursor)
        .await
        .is_err()
    {
        return;
    }
    if let Err(error) = send_replay(
        &mut socket,
        &terminal,
        generation,
        &generation_changes,
        &mut authority,
        &mut cursor,
    )
    .await
    {
        send_replay_error(&mut socket, error).await;
        return;
    }
    let replayed_state = state.borrow().clone();
    match replayed_state {
        TerminalState::Running => {}
        TerminalState::Exited(exit) => {
            let _ = send_exited(&mut socket, cursor, exit).await;
            return;
        }
        TerminalState::Failed(failure) => {
            send_terminal_failure(&mut socket, failure).await;
            return;
        }
    }

    #[cfg(feature = "e2e-command-fault")]
    if let Some(effect) = e2e_runtime
        .intercept_e2e_surface_fault(crate::sync_v2::E2ESurfaceFaultTarget::TerminalChannel)
        .await
    {
        match effect {
            crate::sync_v2::E2ESurfaceFaultEffect::Continue => {}
            crate::sync_v2::E2ESurfaceFaultEffect::Fail(marker) => {
                send_error_owned(
                    &mut socket,
                    TransportErrorCode::Unavailable,
                    format!("E2E fault: {marker}"),
                )
                .await;
                return;
            }
            crate::sync_v2::E2ESurfaceFaultEffect::NotFound
            | crate::sync_v2::E2ESurfaceFaultEffect::ReplayUnavailable
            | crate::sync_v2::E2ESurfaceFaultEffect::InvalidCursor
            | crate::sync_v2::E2ESurfaceFaultEffect::VoiceRetry(_)
            | crate::sync_v2::E2ESurfaceFaultEffect::VoiceResult(_)
            | crate::sync_v2::E2ESurfaceFaultEffect::PortExpire { .. }
            | crate::sync_v2::E2ESurfaceFaultEffect::QueueUncertain(_) => {
                send_error(
                    &mut socket,
                    TransportErrorCode::Unavailable,
                    "E2E surface fault action did not match the Terminal channel boundary",
                )
                .await;
                return;
            }
        }
    }

    let mut exit = None;
    loop {
        tokio::select! {
            biased;
            () = authority.revoked() => {
                terminal.revoke();
                send_error(&mut socket, TransportErrorCode::Forbidden, "Terminal session authorization lost").await;
                return;
            }
            changed = generation_changes.changed() => {
                if changed.is_err() || *generation_changes.borrow_and_update() != generation {
                    terminal.revoke();
                    send_error(&mut socket, TransportErrorCode::GenerationChanged, "Terminal generation changed").await;
                    return;
                }
            }
            received = socket.recv() => match received {
                Some(Ok(Message::Text(text))) => {
                    if !authority.is_valid() {
                        terminal.revoke();
                        send_error(&mut socket, TransportErrorCode::Forbidden, "Terminal session authorization unavailable").await;
                        return;
                    }
                    let Ok(record) = parse_definition::<TerminalClientRecord>("terminalClientRecord", &text) else {
                        send_error(&mut socket, TransportErrorCode::InvalidRequest, "invalid Terminal control record").await;
                        return;
                    };
                    match record {
                        TerminalClientRecord::Input { data } => {
                            let Ok(bytes) = STANDARD.decode(data) else {
                                send_error(&mut socket, TransportErrorCode::InvalidRequest, "invalid Terminal input encoding").await;
                                return;
                            };
                            if !authority.is_valid() {
                                terminal.revoke();
                                send_error(&mut socket, TransportErrorCode::Forbidden, "Terminal session authorization lost").await;
                                return;
                            }
                            if bytes.len() > super::MAX_INPUT_BYTES
                                || terminal.commands.try_send(WriterCommand::Input(bytes)).is_err()
                            {
                                send_error(&mut socket, TransportErrorCode::LimitExceeded, "Terminal input queue limit exceeded").await;
                                return;
                            }
                            terminal.touch();
                        }
                        TerminalClientRecord::Resize { cols, rows } => {
                            let Ok(size) = validate_size(Some(cols), Some(rows)) else {
                                send_error(&mut socket, TransportErrorCode::InvalidRequest, "invalid Terminal size").await;
                                return;
                            };
                            if terminal.commands.try_send(WriterCommand::Resize(size)).is_err() {
                                send_error(&mut socket, TransportErrorCode::Unavailable, "Terminal unavailable").await;
                                return;
                            }
                            terminal.touch();
                        }
                        TerminalClientRecord::Close => {
                            terminal.close();
                            break;
                        }
                        TerminalClientRecord::Open { .. } => {
                            send_error(&mut socket, TransportErrorCode::Conflict, "Terminal is already open").await;
                            return;
                        }
                    }
                }
                Some(Ok(Message::Ping(bytes))) => {
                    if socket.send(Message::Pong(bytes)).await.is_err() {
                        return;
                    }
                }
                Some(Ok(Message::Pong(_))) => {}
                Some(Ok(Message::Close(_)) | Err(_)) | None => return,
                Some(Ok(Message::Binary(_))) => {
                    send_error(&mut socket, TransportErrorCode::InvalidRequest, "Terminal control records must be JSON text").await;
                    return;
                }
            },
            received = output.recv() => match received {
                Ok(chunk) => {
                    if !authority.is_valid() {
                        terminal.revoke();
                        send_error(&mut socket, TransportErrorCode::Forbidden, "Terminal session authorization lost").await;
                        return;
                    }
                    if send_chunk(&mut socket, &chunk, &mut cursor).await.is_err() {
                        return;
                    }
                }
                Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => {
                    if let Err(error) = send_replay(
                        &mut socket,
                        &terminal,
                        generation,
                        &generation_changes,
                        &mut authority,
                        &mut cursor,
                    ).await {
                        send_replay_error(&mut socket, error).await;
                        return;
                    }
                }
                Err(tokio::sync::broadcast::error::RecvError::Closed) => break,
            },
            changed = state.changed() => {
                if changed.is_err() {
                    break;
                }
                let current = state.borrow_and_update().clone();
                match current {
                    TerminalState::Running => {}
                    TerminalState::Exited(current_exit) => {
                        exit = Some(current_exit);
                        break;
                    }
                    TerminalState::Failed(failure) => {
                        send_terminal_failure(&mut socket, failure).await;
                        return;
                    }
                }
            },
        }
    }
    let exit = exit.unwrap_or(TerminalExit {
        exit_code: None,
        signal: None,
    });
    let _ = send_exited(&mut socket, cursor, exit).await;
}

async fn send_replay(
    socket: &mut WebSocket,
    terminal: &Arc<LiveTerminal>,
    generation: u64,
    generation_changes: &tokio::sync::watch::Receiver<u64>,
    authority: &mut SessionAuthority,
    cursor: &mut u64,
) -> Result<(), ReplaySendError> {
    loop {
        if *generation_changes.borrow() != generation {
            terminal.revoke();
            return Err(ReplaySendError::Generation);
        }
        let read = lock(&terminal.replay).read_chunk(*cursor);
        let chunk = match read {
            Ok(chunk) => chunk,
            Err(ReplayReadError::Unavailable) => {
                terminal.revoke_and_wait().await;
                return Err(ReplaySendError::Replay(ReplayReadError::Unavailable));
            }
            Err(ReplayReadError::Failed(failure)) => {
                terminal.mark_failed(failure);
                return Err(ReplaySendError::Replay(ReplayReadError::Failed(failure)));
            }
        };
        let Some(chunk) = chunk else {
            return Ok(());
        };
        if !authority.is_valid() {
            terminal.revoke();
            return Err(ReplaySendError::Authorization);
        }
        send_chunk(socket, &chunk, cursor)
            .await
            .map_err(|()| ReplaySendError::Socket)?;
    }
}

async fn send_replay_error(socket: &mut WebSocket, error: ReplaySendError) {
    match error {
        ReplaySendError::Authorization => {
            send_error(
                socket,
                TransportErrorCode::Forbidden,
                "Terminal session authorization lost",
            )
            .await;
        }
        ReplaySendError::Generation => {
            send_error(
                socket,
                TransportErrorCode::GenerationChanged,
                "Terminal generation changed",
            )
            .await;
        }
        ReplaySendError::Socket => {}
        ReplaySendError::Replay(ReplayReadError::Unavailable) => {
            send_error(
                socket,
                TransportErrorCode::ReplayUnavailable,
                "Terminal replay cursor is unavailable",
            )
            .await;
        }
        ReplaySendError::Replay(ReplayReadError::Failed(failure)) => {
            send_terminal_failure(socket, failure).await;
        }
    }
}

async fn send_terminal_failure(socket: &mut WebSocket, failure: ReplayFailure) {
    let (code, message) = match failure {
        ReplayFailure::OwnerQuotaExceeded => (
            TransportErrorCode::LimitExceeded,
            "Terminal owner replay quota exceeded",
        ),
        ReplayFailure::GlobalQuotaExceeded => (
            TransportErrorCode::LimitExceeded,
            "Terminal global replay quota exceeded",
        ),
        ReplayFailure::StorageUnavailable => (
            TransportErrorCode::Unavailable,
            "Terminal replay storage unavailable",
        ),
    };
    send_error(socket, code, message).await;
}

async fn send_opened(
    socket: &mut WebSocket,
    terminal: &LiveTerminal,
    generation: u64,
    cursor: u64,
) -> Result<(), ()> {
    send_record(
        socket,
        &TerminalServerRecord::Opened {
            session_id: terminal.id.clone(),
            generation: generation.to_string(),
            offset: cursor.to_string(),
        },
    )
    .await
}

async fn send_exited(socket: &mut WebSocket, cursor: u64, exit: TerminalExit) -> Result<(), ()> {
    send_record(
        socket,
        &TerminalServerRecord::Exited {
            offset: cursor.to_string(),
            exit_code: exit.exit_code,
            signal: exit.signal,
        },
    )
    .await
}

async fn send_chunk(
    socket: &mut WebSocket,
    chunk: &ReplayChunk,
    cursor: &mut u64,
) -> Result<(), ()> {
    let chunk_end = chunk.start + u64::try_from(chunk.bytes.len()).map_err(|_| ())?;
    if chunk_end <= *cursor {
        return Ok(());
    }
    let skip = usize::try_from(cursor.saturating_sub(chunk.start)).map_err(|_| ())?;
    let record = TerminalServerRecord::Output {
        offset: cursor.to_string(),
        data: STANDARD.encode(&chunk.bytes[skip..]),
    };
    send_record(socket, &record).await?;
    *cursor = chunk_end;
    Ok(())
}

async fn send_error(socket: &mut WebSocket, code: TransportErrorCode, message: &'static str) {
    send_error_owned(socket, code, message.to_owned()).await;
}

async fn send_error_owned(socket: &mut WebSocket, code: TransportErrorCode, message: String) {
    let _ = send_record(
        socket,
        &TerminalServerRecord::Error {
            error: TransportError { code, message },
        },
    )
    .await;
    let _ = socket
        .send(Message::Close(Some(CloseFrame {
            code: 1008,
            reason: "v2_terminal_closed".into(),
        })))
        .await;
}

async fn send_record(socket: &mut WebSocket, record: &TerminalServerRecord) -> Result<(), ()> {
    let text = serialize_definition("terminalServerRecord", record)?;
    socket
        .send(Message::Text(text.into()))
        .await
        .map_err(|_| ())
}
