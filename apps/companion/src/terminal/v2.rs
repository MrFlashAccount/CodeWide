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

use super::{LiveTerminal, ReplayChunk, TerminalState, WriterCommand, lock, validate_size};

#[allow(clippy::too_many_lines)]
pub(crate) async fn bridge(
    mut socket: WebSocket,
    terminal: Arc<LiveTerminal>,
    generation: u64,
    mut authority: SessionAuthority,
    offset: u64,
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
    if send_record(
        &mut socket,
        &TerminalServerRecord::Opened {
            session_id: terminal.id.clone(),
            generation: generation.to_string(),
            offset: cursor.to_string(),
        },
    )
    .await
    .is_err()
    {
        return;
    }
    let replay = lock(&terminal.replay).snapshot(cursor);
    let Ok(replay) = replay else {
        send_error(
            &mut socket,
            TransportErrorCode::ReplayUnavailable,
            "terminal replay unavailable",
        )
        .await;
        return;
    };
    for chunk in replay {
        if !authority.is_valid() {
            terminal.revoke();
            send_error(
                &mut socket,
                TransportErrorCode::GenerationChanged,
                "Terminal session authorization lost",
            )
            .await;
            return;
        }
        if send_chunk(&mut socket, &chunk, &mut cursor).await.is_err() {
            return;
        }
    }
    if *state.borrow() == TerminalState::Exited {
        let _ = send_record(
            &mut socket,
            &TerminalServerRecord::Exited {
                offset: cursor.to_string(),
            },
        )
        .await;
        return;
    }

    loop {
        tokio::select! {
            biased;
            () = authority.revoked() => {
                terminal.revoke();
                send_error(&mut socket, TransportErrorCode::Forbidden, "Terminal session authorization lost").await;
                return;
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
                    let replay = lock(&terminal.replay).snapshot(cursor);
                    let Ok(replay) = replay else {
                        send_error(&mut socket, TransportErrorCode::ReplayUnavailable, "terminal replay unavailable").await;
                        return;
                    };
                    for chunk in replay {
                        if !authority.is_valid() {
                            terminal.revoke();
                            send_error(&mut socket, TransportErrorCode::Forbidden, "Terminal session authorization lost").await;
                            return;
                        }
                        if send_chunk(&mut socket, &chunk, &mut cursor).await.is_err() {
                            return;
                        }
                    }
                }
                Err(tokio::sync::broadcast::error::RecvError::Closed) => break,
            },
            changed = state.changed() => {
                if changed.is_err() || *state.borrow() == TerminalState::Exited {
                    break;
                }
            },
        }
    }
    let _ = send_record(
        &mut socket,
        &TerminalServerRecord::Exited {
            offset: cursor.to_string(),
        },
    )
    .await;
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
    let _ = send_record(
        socket,
        &TerminalServerRecord::Error {
            error: TransportError::new(code, message),
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
