//! Bounded public upload errors; messages do not include request or filesystem data.

use axum::{
    Json,
    http::StatusCode,
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

pub(super) fn error(status: StatusCode, code: UploadErrorCode, message: &'static str) -> Response {
    (status, Json(UploadError { code, message })).into_response()
}
