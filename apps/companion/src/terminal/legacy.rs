use super::{
    Arc, AuthorizationChange, CloseFrame, LiveTerminal, MAX_INPUT_BYTES, Message,
    OUTPUT_CHUNK_BYTES, PtySize, Read, ReplayChunk, ReplayFailure, ReplayReadError, SinkExt,
    TERMINAL_EXITED_CLOSE_CODE, TERMINAL_REPLAY_CLOSE_CODE, TERMINAL_RESOURCE_CLOSE_CODE,
    TerminalAuthorization, TerminalSession, TerminalState, WebSocket, Write, WriterCommand,
    broadcast, lock, mpsc, std_mpsc, validate_size,
};

enum Output {
    Bytes(Vec<u8>),
    Closed,
}

enum AuthorizationChangeOutcome {
    Continue,
    Close,
    Disable,
}

enum ReplaySendError {
    Socket,
    Replay(ReplayReadError),
}

pub async fn bridge(
    mut socket: WebSocket,
    mut session: TerminalSession,
    mut authorization: Option<TerminalAuthorization>,
) {
    let (output_tx, mut output_rx) = mpsc::channel::<Output>(32);
    let mut reader = session.reader;
    let reader_task = tokio::task::spawn_blocking(move || {
        let mut buffer = vec![0_u8; OUTPUT_CHUNK_BYTES];
        loop {
            match reader.read(&mut buffer) {
                Ok(0) | Err(_) => break,
                Ok(count) => {
                    if output_tx
                        .blocking_send(Output::Bytes(buffer[..count].to_vec()))
                        .is_err()
                    {
                        break;
                    }
                }
            }
        }
        let _ = output_tx.blocking_send(Output::Closed);
    });
    let (writer_tx, writer_rx) = std_mpsc::sync_channel::<WriterCommand>(32);
    let mut writer = session.writer;
    let writer_task = tokio::task::spawn_blocking(move || {
        while let Ok(command) = writer_rx.recv() {
            match command {
                WriterCommand::Input(bytes) => {
                    if writer
                        .write_all(&bytes)
                        .and_then(|()| writer.flush())
                        .is_err()
                    {
                        break;
                    }
                }
                WriterCommand::Resize(_) => {}
                WriterCommand::Close => break,
            }
        }
    });

    loop {
        tokio::select! {
            phone = socket.recv() => match phone {
                Some(Ok(Message::Binary(bytes))) => match parse_client_frame(&bytes) {
                    Ok(ClientFrame::Input(input)) => {
                        if writer_tx.try_send(WriterCommand::Input(input.to_vec())).is_err() { break; }
                    }
                    Ok(ClientFrame::Resize(size)) => {
                        if session.master.resize(size).is_err() { break; }
                    }
                    Ok(ClientFrame::Close) => break,
                    Err(()) => {
                        let _ = socket.send(Message::Close(Some(CloseFrame {
                            code: 1003,
                            reason: "invalid_terminal_frame".into(),
                        }))).await;
                        break;
                    }
                },
                Some(Ok(Message::Ping(bytes))) => {
                    if socket.send(Message::Pong(bytes)).await.is_err() { break; }
                }
                Some(Ok(Message::Pong(_))) => {}
                Some(Ok(Message::Close(_)) | Err(_)) | None => break,
                Some(Ok(Message::Text(_))) => {
                    let _ = socket.send(Message::Close(Some(CloseFrame {
                        code: 1003,
                        reason: "binary_frames_required".into(),
                    }))).await;
                    break;
                }
            },
            output = output_rx.recv() => match output {
                Some(Output::Bytes(bytes)) => {
                    if socket.send(Message::Binary(bytes.into())).await.is_err() { break; }
                }
                Some(Output::Closed) | None => break,
            },
            change = receive_authorization_change(&mut authorization), if authorization.is_some() => {
                match handle_authorization_change(&mut socket, authorization.as_ref(), change).await {
                    AuthorizationChangeOutcome::Close => break,
                    AuthorizationChangeOutcome::Disable => authorization = None,
                    AuthorizationChangeOutcome::Continue => {}
                }
            }
        }
    }

    let _ = writer_tx.try_send(WriterCommand::Close);
    let _ = session.child.kill();
    let _ = session.child.wait();
    reader_task.abort();
    writer_task.abort();
    let _ = socket.close().await;
}

/// Attaches a WebSocket to a companion-owned process without tying the process
/// lifetime to that socket. Output produced while detached is replayed from the
/// requested byte offset.
pub async fn bridge_resumable(mut socket: WebSocket, terminal: Arc<LiveTerminal>, offset: u64) {
    let _attachment = terminal.attach();
    let mut output = terminal.output.subscribe();
    let mut state = terminal.state.subscribe();
    let mut cursor = offset;
    if let Err(error) = send_replay(&mut socket, &terminal, &mut cursor).await {
        close_for_replay_error(&mut socket, error).await;
        return;
    }
    let replayed_state = state.borrow().clone();
    match replayed_state {
        TerminalState::Running => {}
        TerminalState::Exited(_) => {
            close_socket(&mut socket, TERMINAL_EXITED_CLOSE_CODE, "terminal_exited").await;
            return;
        }
        TerminalState::Failed(failure) => {
            close_for_terminal_failure(&mut socket, failure).await;
            return;
        }
    }

    loop {
        tokio::select! {
            phone = socket.recv() => match phone {
                Some(Ok(Message::Binary(bytes))) => match parse_client_frame(&bytes) {
                    Ok(ClientFrame::Input(input)) => {
                        if terminal.commands.try_send(WriterCommand::Input(input.to_vec())).is_err() {
                            break;
                        }
                        terminal.touch();
                    }
                    Ok(ClientFrame::Resize(size)) => {
                        if terminal.commands.try_send(WriterCommand::Resize(size)).is_err() {
                            break;
                        }
                        terminal.touch();
                    }
                    Ok(ClientFrame::Close) => {
                        terminal.close();
                        break;
                    }
                    Err(()) => {
                        close_socket(&mut socket, 1003, "invalid_terminal_frame").await;
                        return;
                    }
                },
                Some(Ok(Message::Ping(bytes))) => {
                    if socket.send(Message::Pong(bytes)).await.is_err() {
                        return;
                    }
                }
                Some(Ok(Message::Pong(_))) => {}
                Some(Ok(Message::Close(_)) | Err(_)) | None => return,
                Some(Ok(Message::Text(_))) => {
                    close_socket(&mut socket, 1003, "binary_frames_required").await;
                    return;
                }
            },
            received = output.recv() => match received {
                Ok(chunk) => {
                    if send_replay_chunk(&mut socket, &chunk, &mut cursor).await.is_err() {
                        return;
                    }
                }
                Err(broadcast::error::RecvError::Lagged(_)) => {
                    if let Err(error) = send_replay(&mut socket, &terminal, &mut cursor).await {
                        close_for_replay_error(&mut socket, error).await;
                        return;
                    }
                }
                Err(broadcast::error::RecvError::Closed) => break,
            },
            changed = state.changed() => {
                if changed.is_err() {
                    break;
                }
                let current = state.borrow_and_update().clone();
                match current {
                    TerminalState::Running => {}
                    TerminalState::Exited(_) => break,
                    TerminalState::Failed(failure) => {
                        close_for_terminal_failure(&mut socket, failure).await;
                        return;
                    }
                }
            }
        }
    }

    close_socket(&mut socket, TERMINAL_EXITED_CLOSE_CODE, "terminal_exited").await;
}

async fn send_replay(
    socket: &mut WebSocket,
    terminal: &Arc<LiveTerminal>,
    cursor: &mut u64,
) -> Result<(), ReplaySendError> {
    loop {
        let chunk = match lock(&terminal.replay).read_chunk(*cursor) {
            Ok(chunk) => chunk,
            Err(ReplayReadError::Unavailable) => {
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
        send_replay_chunk(socket, &chunk, cursor)
            .await
            .map_err(|()| ReplaySendError::Socket)?;
    }
}

async fn close_for_replay_error(socket: &mut WebSocket, error: ReplaySendError) {
    match error {
        ReplaySendError::Socket => {}
        ReplaySendError::Replay(ReplayReadError::Unavailable) => {
            close_socket(
                socket,
                TERMINAL_REPLAY_CLOSE_CODE,
                "terminal_replay_unavailable",
            )
            .await;
        }
        ReplaySendError::Replay(ReplayReadError::Failed(failure)) => {
            close_for_terminal_failure(socket, failure).await;
        }
    }
}

async fn close_for_terminal_failure(socket: &mut WebSocket, failure: ReplayFailure) {
    let reason = match failure {
        ReplayFailure::OwnerQuotaExceeded => "terminal_owner_replay_quota_exceeded",
        ReplayFailure::GlobalQuotaExceeded => "terminal_global_replay_quota_exceeded",
        ReplayFailure::StorageUnavailable => "terminal_replay_storage_unavailable",
    };
    close_socket(socket, TERMINAL_RESOURCE_CLOSE_CODE, reason).await;
}

async fn send_replay_chunk(
    socket: &mut WebSocket,
    chunk: &ReplayChunk,
    cursor: &mut u64,
) -> Result<(), ()> {
    let chunk_end = chunk.start + u64::try_from(chunk.bytes.len()).map_err(|_| ())?;
    if chunk_end <= *cursor {
        return Ok(());
    }
    let skip = usize::try_from(cursor.saturating_sub(chunk.start)).map_err(|_| ())?;
    socket
        .send(Message::Binary(chunk.bytes[skip..].to_vec().into()))
        .await
        .map_err(|_| ())?;
    *cursor = chunk_end;
    Ok(())
}

async fn close_socket(socket: &mut WebSocket, code: u16, reason: &'static str) {
    let _ = socket
        .send(Message::Close(Some(CloseFrame {
            code,
            reason: reason.into(),
        })))
        .await;
}

async fn receive_authorization_change(
    authorization: &mut Option<TerminalAuthorization>,
) -> Result<AuthorizationChange, tokio::sync::broadcast::error::RecvError> {
    match authorization {
        Some(authorization) => authorization.changes.recv().await,
        None => std::future::pending().await,
    }
}

async fn handle_authorization_change(
    socket: &mut WebSocket,
    authorization: Option<&TerminalAuthorization>,
    change: Result<AuthorizationChange, tokio::sync::broadcast::error::RecvError>,
) -> AuthorizationChangeOutcome {
    let close_reason = match change {
        Ok(change) if authorization.is_some_and(|guard| guard.device_id == change.device_id) => {
            Some(change.reason.close_reason())
        }
        Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => Some("authorization_changed"),
        Err(tokio::sync::broadcast::error::RecvError::Closed) => {
            return AuthorizationChangeOutcome::Disable;
        }
        Ok(_) => None,
    };
    let Some(reason) = close_reason else {
        return AuthorizationChangeOutcome::Continue;
    };
    let _ = socket
        .send(Message::Close(Some(CloseFrame {
            code: 4003,
            reason: reason.into(),
        })))
        .await;
    AuthorizationChangeOutcome::Close
}

pub(super) enum ClientFrame<'a> {
    Input(&'a [u8]),
    Resize(PtySize),
    Close,
}

pub(super) fn parse_client_frame(bytes: &[u8]) -> Result<ClientFrame<'_>, ()> {
    match bytes {
        [0, input @ ..] if input.len() <= MAX_INPUT_BYTES => Ok(ClientFrame::Input(input)),
        [1, cols_hi, cols_lo, rows_hi, rows_lo] => {
            let cols = u16::from_be_bytes([*cols_hi, *cols_lo]);
            let rows = u16::from_be_bytes([*rows_hi, *rows_lo]);
            Ok(ClientFrame::Resize(
                validate_size(Some(cols), Some(rows)).map_err(|_| ())?,
            ))
        }
        [2] => Ok(ClientFrame::Close),
        _ => Err(()),
    }
}
