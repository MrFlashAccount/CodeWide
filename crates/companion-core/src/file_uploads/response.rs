//! Bounded public upload errors; messages do not include request or filesystem data.

use axum::{
    Json,
    http::{HeaderValue, StatusCode},
    response::{IntoResponse, Response},
};
use serde::Serialize;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) enum UploadErrorCode {
    InvalidRequest,
    Unauthorized,
    NotFound,
    Conflict,
    LimitExceeded,
    Unavailable,
}

#[derive(Serialize)]
struct UploadError {
    code: UploadErrorCode,
    message: &'static str,
}

/// HEAD responses carry no body, so the bounded message is mirrored into a header.
const ERROR_HEADER: &str = "x-codewide-error";

pub(super) fn error(status: StatusCode, code: UploadErrorCode, message: &'static str) -> Response {
    // Only the status and the static message are logged: no paths, names or identities.
    if status.is_server_error() {
        tracing::error!(
            status = status.as_u16(),
            message,
            "file upload request failed"
        );
    } else {
        tracing::warn!(
            status = status.as_u16(),
            message,
            "file upload request rejected"
        );
    }
    let mut response = (status, Json(UploadError { code, message })).into_response();
    response
        .headers_mut()
        .insert(ERROR_HEADER, HeaderValue::from_static(message));
    response
}
