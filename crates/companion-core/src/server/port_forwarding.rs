//! Service-identity checks and bounded authorized port bridging for the Companion API.

use super::json_error;
use crate::{ports, session_authority::SessionAuthority};
use axum::{
    extract::ws::{CloseFrame, Message, WebSocket},
    http::{HeaderMap, StatusCode},
    response::Response,
};
use futures_util::SinkExt;
use tokio::io::{AsyncReadExt, AsyncWriteExt};

/// Older V1 clients omit identity headers; explicit modes retain strict validation.
pub(super) async fn validate_identity(headers: &HeaderMap, port: u16) -> Result<(), Response> {
    if !headers.contains_key(FORWARDING_MODE_HEADER) && !headers.contains_key(FORWARDING_KEY_HEADER)
    {
        return Ok(());
    }
    let identity = forwarding_identity_headers(headers)
        .map_err(|()| json_error(StatusCode::BAD_REQUEST, "forwarding_identity_invalid"))?;
    if let ForwardingIdentity::Discovered(expected) = identity {
        let current = tokio::time::timeout(
            std::time::Duration::from_secs(10),
            ports::forwarding_key_for_port(port),
        )
        .await
        .ok()
        .flatten();
        if !forwarding_service_matches(expected, current.as_deref()) {
            return Err(json_error(
                StatusCode::CONFLICT,
                "forwarding_service_changed",
            ));
        }
    }
    Ok(())
}

#[derive(Debug, PartialEq, Eq)]
enum ForwardingIdentity<'a> {
    Manual,
    Discovered(&'a str),
}

fn forwarding_identity_headers(headers: &HeaderMap) -> Result<ForwardingIdentity<'_>, ()> {
    let mode = single_header(headers, FORWARDING_MODE_HEADER)?.ok_or(())?;
    let forwarding_key = forwarding_key_header(headers)?;
    match (mode, forwarding_key) {
        ("manual", None) => Ok(ForwardingIdentity::Manual),
        ("discovered", Some(forwarding_key)) => Ok(ForwardingIdentity::Discovered(forwarding_key)),
        _ => Err(()),
    }
}

fn forwarding_key_header(headers: &HeaderMap) -> Result<Option<&str>, ()> {
    let Some(value) = single_header(headers, FORWARDING_KEY_HEADER)? else {
        return Ok(None);
    };
    if value.len() != 64
        || !value
            .bytes()
            .all(|byte| byte.is_ascii_hexdigit() && !byte.is_ascii_uppercase())
    {
        return Err(());
    }
    Ok(Some(value))
}

fn single_header<'a>(headers: &'a HeaderMap, name: &str) -> Result<Option<&'a str>, ()> {
    let values = headers.get_all(name);
    let mut values = values.iter();
    let Some(value) = values.next() else {
        return Ok(None);
    };
    if values.next().is_some() {
        return Err(());
    }
    Ok(Some(value.to_str().map_err(|_| ())?))
}

fn forwarding_service_matches(expected: &str, current: Option<&str>) -> bool {
    current == Some(expected)
}

const FORWARDING_KEY_HEADER: &str = "x-codewide-forwarding-key";

const FORWARDING_MODE_HEADER: &str = "x-codewide-forwarding-mode";

pub(super) async fn bridge_port(
    mut socket: WebSocket,
    mut stream: tokio::net::TcpStream,
    authority: &mut SessionAuthority,
) {
    const MAX_FRAME_BYTES: usize = 1024 * 1024;
    let mut host_buffer = vec![0_u8; 64 * 1024];
    loop {
        tokio::select! {
            phone = socket.recv() => match phone {
                Some(Ok(Message::Binary(bytes))) if bytes.len() <= MAX_FRAME_BYTES => {
                    if !authority.is_valid() || stream.write_all(&bytes).await.is_err() { break; }
                }
                Some(Ok(Message::Ping(bytes))) => {
                    if socket.send(Message::Pong(bytes)).await.is_err() { break; }
                }
                Some(Ok(Message::Pong(_))) => {}
                Some(Ok(Message::Close(_)) | Err(_)) | None => break,
                Some(Ok(Message::Text(_) | Message::Binary(_))) => {
                    let _ = socket.send(Message::Close(Some(CloseFrame { code: 1003, reason: "binary_frames_required".into() }))).await;
                    break;
                }
            },
            host = stream.read(&mut host_buffer) => match host {
                Ok(0) | Err(_) => break,
                Ok(bytes) => {
                    if !authority.is_valid() || socket.send(Message::Binary(host_buffer[..bytes].to_vec().into())).await.is_err() { break; }
                }
            },
            () = authority.revoked() => break,
        }
    }
    let _ = stream.shutdown().await;
    let _ = socket.close().await;
}

#[cfg(test)]
mod tests {
    use axum::http::{HeaderMap, HeaderValue};

    use super::{
        FORWARDING_KEY_HEADER, FORWARDING_MODE_HEADER, ForwardingIdentity,
        forwarding_identity_headers, forwarding_service_matches,
    };

    #[test]
    fn manual_forwarding_mode_is_explicit_and_carries_no_fingerprint() {
        let empty = HeaderMap::new();
        assert_eq!(forwarding_identity_headers(&empty), Err(()));

        let mut manual = HeaderMap::new();
        manual.insert(FORWARDING_MODE_HEADER, HeaderValue::from_static("manual"));
        assert_eq!(
            forwarding_identity_headers(&manual),
            Ok(ForwardingIdentity::Manual)
        );

        manual.insert(
            FORWARDING_KEY_HEADER,
            HeaderValue::from_static(
                "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            ),
        );
        assert_eq!(forwarding_identity_headers(&manual), Err(()));

        let mut ambiguous = HeaderMap::new();
        ambiguous.append(FORWARDING_MODE_HEADER, HeaderValue::from_static("manual"));
        ambiguous.append(FORWARDING_MODE_HEADER, HeaderValue::from_static("manual"));
        assert_eq!(forwarding_identity_headers(&ambiguous), Err(()));
    }

    #[test]
    fn discovered_forwarding_mode_requires_a_strict_fingerprint() {
        let mut missing = HeaderMap::new();
        missing.insert(
            FORWARDING_MODE_HEADER,
            HeaderValue::from_static("discovered"),
        );
        assert_eq!(forwarding_identity_headers(&missing), Err(()));

        let key = "a".repeat(64);
        let mut valid = HeaderMap::new();
        valid.insert(
            FORWARDING_MODE_HEADER,
            HeaderValue::from_static("discovered"),
        );
        valid.insert(
            FORWARDING_KEY_HEADER,
            HeaderValue::from_str(&key).unwrap_or_else(|error| panic!("{error}")),
        );
        assert_eq!(
            forwarding_identity_headers(&valid),
            Ok(ForwardingIdentity::Discovered(key.as_str()))
        );

        for malformed in ["a".repeat(63), "A".repeat(64), "z".repeat(64)] {
            let mut headers = HeaderMap::new();
            headers.insert(
                FORWARDING_MODE_HEADER,
                HeaderValue::from_static("discovered"),
            );
            headers.insert(
                FORWARDING_KEY_HEADER,
                HeaderValue::from_str(&malformed).unwrap_or_else(|error| panic!("{error}")),
            );
            assert_eq!(forwarding_identity_headers(&headers), Err(()));
        }
    }

    #[test]
    fn duplicate_forwarding_key_headers_are_rejected() {
        let mut headers = HeaderMap::new();
        headers.insert(
            FORWARDING_MODE_HEADER,
            HeaderValue::from_static("discovered"),
        );
        let key = HeaderValue::from_static(
            "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        );
        headers.append(FORWARDING_KEY_HEADER, key.clone());
        headers.append(FORWARDING_KEY_HEADER, key);
        assert_eq!(forwarding_identity_headers(&headers), Err(()));
    }

    #[test]
    fn missing_or_changed_local_service_is_rejected_before_forwarding() {
        let expected = "a".repeat(64);
        let changed = "b".repeat(64);

        assert!(!forwarding_service_matches(&expected, None));
        assert!(!forwarding_service_matches(&expected, Some(&changed)));
        assert!(forwarding_service_matches(&expected, Some(&expected)));
    }
}
