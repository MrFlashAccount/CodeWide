//! Contract-derived WebSocket decoding and bounded public encoding.

use axum::extract::ws::{CloseFrame, Message, WebSocket};
use futures_util::StreamExt;
use serde_json::Value;

use super::{
    contract,
    protocol::{ClientFrame, ServerFrame},
};

pub(super) async fn recv_frame(socket: &mut WebSocket) -> Option<ClientFrame> {
    loop {
        match socket.next().await {
            Some(Ok(Message::Text(raw))) => {
                let value: Value = match serde_json::from_str(&raw) {
                    Ok(value) => value,
                    Err(error) if error.is_syntax() || error.is_eof() => {
                        close(socket, 1007, "malformed_json").await;
                        return None;
                    }
                    Err(_) => {
                        close(socket, 1008, "invalid_v2_record").await;
                        return None;
                    }
                };
                if !contract::valid_client(&value) {
                    close(socket, 1008, "invalid_v2_record").await;
                    return None;
                }
                return if let Ok(frame) = serde_json::from_value(value) {
                    Some(frame)
                } else {
                    close(socket, 1008, "invalid_v2_record").await;
                    None
                };
            }
            Some(Ok(Message::Binary(_))) => {
                close(socket, 1003, "text_frames_required").await;
                return None;
            }
            Some(Ok(Message::Ping(bytes))) => {
                let _ = socket.send(Message::Pong(bytes)).await;
            }
            Some(Ok(Message::Pong(_))) => {}
            Some(Ok(Message::Close(_)) | Err(_)) | None => return None,
        }
    }
}

pub(super) async fn send(socket: &mut WebSocket, frame: &ServerFrame) -> Result<(), axum::Error> {
    let frame = public_frame(frame);
    let value = serde_json::to_value(&frame).map_err(axum::Error::new)?;
    if !contract::valid_server(&value) {
        return Err(axum::Error::new(std::io::Error::other(
            "Sync V2 server frame violated the executable contract",
        )));
    }
    let raw = serde_json::to_string(&value).map_err(axum::Error::new)?;
    socket.send(Message::Text(raw.into())).await
}

pub(super) async fn close(socket: &mut WebSocket, code: u16, reason: &'static str) {
    let _ = socket
        .send(Message::Close(Some(CloseFrame {
            code,
            reason: reason.into(),
        })))
        .await;
}

fn public_frame(frame: &ServerFrame) -> ServerFrame {
    match frame {
        ServerFrame::QueryFailed { request_id, error } => ServerFrame::QueryFailed {
            request_id: request_id.clone(),
            error: error.for_wire(),
        },
        ServerFrame::CommandRejected {
            request_id,
            operation_id,
            error,
        } => ServerFrame::CommandRejected {
            request_id: request_id.clone(),
            operation_id: operation_id.clone(),
            error: error.for_wire(),
        },
        ServerFrame::CommandExpired {
            request_id,
            operation_id,
            error,
        } => ServerFrame::CommandExpired {
            request_id: request_id.clone(),
            operation_id: operation_id.clone(),
            error: error.for_wire(),
        },
        ServerFrame::CommandFailed {
            operation_id,
            error,
        } => ServerFrame::CommandFailed {
            operation_id: operation_id.clone(),
            error: error.for_wire(),
        },
        ServerFrame::CommandIndeterminate {
            operation_id,
            error,
        } => ServerFrame::CommandIndeterminate {
            operation_id: operation_id.clone(),
            error: error.for_wire(),
        },
        other => other.clone(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::sync_v2::{protocol::V2Error, scalar::Id};

    #[test]
    fn public_frame_removes_internal_error_content() {
        let secret = "PRIVATE_SENTINEL_/home/user/token";
        let frame = ServerFrame::QueryFailed {
            request_id: Id::new("request").unwrap_or_else(|error| panic!("{error}")),
            error: V2Error::source_unavailable(secret),
        };
        let ServerFrame::QueryFailed { error, .. } = &frame else {
            panic!("expected query failure");
        };
        assert_eq!(error.message, secret);
        let encoded = serde_json::to_string(&public_frame(&frame))
            .unwrap_or_else(|error| panic!("public frame must serialize: {error}"));
        assert!(!encoded.contains(secret));
        assert!(encoded.contains("source is temporarily unavailable"));
    }
}
