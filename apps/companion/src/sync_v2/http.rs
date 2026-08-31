//! Shared closed-schema response helpers for versioned V2 HTTP routes.

use axum::{
    Json,
    http::StatusCode,
    response::{IntoResponse, Response},
};
use serde::{Serialize, de::DeserializeOwned};
use serde_json::Value;

use super::{
    contract,
    protocol::{TransportError, TransportErrorCode},
};

#[derive(Clone, Copy)]
struct ClosedV2Response;

pub(crate) struct InvalidRequest;

impl InvalidRequest {
    pub(crate) fn response() -> Response {
        error(
            StatusCode::BAD_REQUEST,
            TransportErrorCode::InvalidRequest,
            "invalid closed V2 request",
        )
    }
}

pub(super) fn parse<T: DeserializeOwned>(
    definition: &str,
    value: Value,
) -> Result<T, InvalidRequest> {
    if !contract::valid_definition(definition, &value) {
        return Err(InvalidRequest);
    }
    serde_json::from_value(value).map_err(|_| InvalidRequest)
}

pub(super) fn response<T: Serialize>(status: StatusCode, definition: &str, value: &T) -> Response {
    let Ok(value) = serde_json::to_value(value) else {
        return error(
            StatusCode::INTERNAL_SERVER_ERROR,
            TransportErrorCode::Unavailable,
            "V2 response serialization failed",
        );
    };
    if !contract::valid_definition(definition, &value) {
        return error(
            StatusCode::INTERNAL_SERVER_ERROR,
            TransportErrorCode::Unavailable,
            "V2 response contract mismatch",
        );
    }
    mark_closed((status, Json(value)).into_response())
}

pub(super) fn error(
    status: StatusCode,
    code: TransportErrorCode,
    message: &'static str,
) -> Response {
    let error = TransportError::new(code, message);
    debug_assert!(
        serde_json::to_value(&error)
            .is_ok_and(|value| contract::valid_definition("transportError", &value)),
        "static V2 transport error must satisfy the executable contract",
    );
    mark_closed((status, Json(error)).into_response())
}

fn mark_closed(mut response: Response) -> Response {
    response.extensions_mut().insert(ClosedV2Response);
    response
}

pub(crate) async fn close_extractor_rejection(response: Response) -> Response {
    if matches!(
        response.status(),
        StatusCode::BAD_REQUEST
            | StatusCode::PAYLOAD_TOO_LARGE
            | StatusCode::UNSUPPORTED_MEDIA_TYPE
            | StatusCode::UNPROCESSABLE_ENTITY
    ) && response.extensions().get::<ClosedV2Response>().is_none()
    {
        return InvalidRequest::response();
    }
    response
}
