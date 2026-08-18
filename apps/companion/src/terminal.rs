use std::{
    env,
    io::{Read, Write},
    path::{Path, PathBuf},
    sync::mpsc as std_mpsc,
};

use axum::{
    extract::ws::{CloseFrame, Message, WebSocket},
    http::StatusCode,
};
use futures_util::SinkExt;
use portable_pty::{Child, CommandBuilder, MasterPty, PtySize, native_pty_system};
use serde::Deserialize;
use tokio::sync::mpsc;

use crate::auth::AuthorizationChange;

const DEFAULT_COLS: u16 = 80;
const DEFAULT_ROWS: u16 = 24;
const MAX_COLS: u16 = 500;
const MAX_ROWS: u16 = 300;
const MAX_INPUT_BYTES: usize = 1024 * 1024;
const OUTPUT_CHUNK_BYTES: usize = 64 * 1024;

#[derive(Clone, Debug, Deserialize)]
pub struct TerminalQuery {
    pub cwd: Option<String>,
    pub cols: Option<u16>,
    pub rows: Option<u16>,
}

#[derive(Debug)]
pub enum TerminalError {
    InvalidSize,
    InvalidCwd,
    SpawnFailed,
}

impl TerminalError {
    #[must_use]
    pub const fn status(&self) -> StatusCode {
        match self {
            Self::InvalidSize | Self::InvalidCwd => StatusCode::BAD_REQUEST,
            Self::SpawnFailed => StatusCode::INTERNAL_SERVER_ERROR,
        }
    }

    #[must_use]
    pub const fn code(&self) -> &'static str {
        match self {
            Self::InvalidSize => "terminal_size_invalid",
            Self::InvalidCwd => "terminal_cwd_invalid",
            Self::SpawnFailed => "terminal_spawn_failed",
        }
    }
}

pub struct TerminalSession {
    master: Box<dyn MasterPty + Send>,
    child: Box<dyn Child + Send + Sync>,
    reader: Box<dyn Read + Send>,
    writer: Box<dyn Write + Send>,
}

pub struct TerminalAuthorization {
    device_id: String,
    changes: tokio::sync::broadcast::Receiver<AuthorizationChange>,
}

impl TerminalAuthorization {
    #[must_use]
    pub const fn new(
        device_id: String,
        changes: tokio::sync::broadcast::Receiver<AuthorizationChange>,
    ) -> Self {
        Self { device_id, changes }
    }
}

impl TerminalSession {
    /// Starts a private pseudo-terminal using the requested dimensions and
    /// working directory.
    ///
    /// # Errors
    ///
    /// Returns an error when the terminal size or working directory is invalid,
    /// or when the platform cannot create or start the pseudo-terminal.
    pub fn spawn(query: &TerminalQuery) -> Result<Self, TerminalError> {
        let size = validate_size(query.cols, query.rows)?;
        let cwd = resolve_cwd(query.cwd.as_deref())?;
        let pair = native_pty_system()
            .openpty(size)
            .map_err(|_| TerminalError::SpawnFailed)?;
        let shell = resolve_shell();
        let mut command = CommandBuilder::new(shell);
        command.cwd(cwd);
        command.env("TERM", "xterm-256color");
        command.env("COLORTERM", "truecolor");
        command.env("TERM_PROGRAM", "CodeWide");
        let child = pair
            .slave
            .spawn_command(command)
            .map_err(|_| TerminalError::SpawnFailed)?;
        drop(pair.slave);
        let reader = pair
            .master
            .try_clone_reader()
            .map_err(|_| TerminalError::SpawnFailed)?;
        let writer = pair
            .master
            .take_writer()
            .map_err(|_| TerminalError::SpawnFailed)?;
        Ok(Self {
            master: pair.master,
            child,
            reader,
            writer,
        })
    }
}

enum WriterCommand {
    Input(Vec<u8>),
    Close,
}

enum Output {
    Bytes(Vec<u8>),
    Closed,
}

enum AuthorizationChangeOutcome {
    Continue,
    Close,
    Disable,
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

enum ClientFrame<'a> {
    Input(&'a [u8]),
    Resize(PtySize),
    Close,
}

fn parse_client_frame(bytes: &[u8]) -> Result<ClientFrame<'_>, ()> {
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

fn validate_size(cols: Option<u16>, rows: Option<u16>) -> Result<PtySize, TerminalError> {
    let cols = cols.unwrap_or(DEFAULT_COLS);
    let rows = rows.unwrap_or(DEFAULT_ROWS);
    if !(2..=MAX_COLS).contains(&cols) || !(2..=MAX_ROWS).contains(&rows) {
        return Err(TerminalError::InvalidSize);
    }
    Ok(PtySize {
        rows,
        cols,
        pixel_width: 0,
        pixel_height: 0,
    })
}

fn resolve_cwd(raw: Option<&str>) -> Result<PathBuf, TerminalError> {
    let candidate = raw
        .filter(|value| !value.is_empty() && value.len() <= 4096)
        .map(PathBuf::from)
        .or_else(|| env::var_os("HOME").map(PathBuf::from))
        .or_else(|| env::current_dir().ok())
        .ok_or(TerminalError::InvalidCwd)?;
    let canonical = candidate
        .canonicalize()
        .map_err(|_| TerminalError::InvalidCwd)?;
    if !canonical.is_dir() {
        return Err(TerminalError::InvalidCwd);
    }
    Ok(canonical)
}

fn resolve_shell() -> PathBuf {
    env::var_os("SHELL")
        .map(PathBuf::from)
        .filter(|path| path.is_absolute() && Path::new(path).is_file())
        .unwrap_or_else(|| PathBuf::from("/bin/sh"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_input_and_resize_frames() {
        assert!(matches!(
            parse_client_frame(&[0, b'a']),
            Ok(ClientFrame::Input(b"a"))
        ));
        let Ok(ClientFrame::Resize(size)) = parse_client_frame(&[1, 0, 120, 0, 40]) else {
            panic!("resize frame was not parsed");
        };
        assert_eq!((size.cols, size.rows), (120, 40));
    }

    #[test]
    fn rejects_invalid_frames_and_sizes() {
        assert!(parse_client_frame(&[]).is_err());
        assert!(parse_client_frame(&[1, 0, 1, 0, 24]).is_err());
        assert!(parse_client_frame(&[2, 0]).is_err());
    }
}
