//! Versioned V2 file, content, and media HTTP adapters.

use axum::{
    Json, Router,
    body::Body,
    extract::{DefaultBodyLimit, Path, Query, State},
    http::{HeaderMap, Method, StatusCode},
    response::Response,
    routing::{get, post, put},
};
use serde::Serialize;
use serde_json::Value;

use crate::{
    content::{ContentError, ContentQuery},
    files::{FileError, FileQuery},
    media::MediaError,
    server::{AppState, authorization_for_scope},
};

use super::{
    http,
    protocol::{
        ContentLocation, FileLocation, MediaMaterializeRequest, MediaMaterializeResponse,
        PreviewLocation, TransportErrorCode,
    },
};

pub(crate) fn routes() -> Router<AppState> {
    let transfers = Router::new()
        .route("/v2/files/download", get(file_download).head(file_download))
        .route("/v2/files/preview", get(file_preview).head(file_preview))
        .route(
            "/v2/files/upload",
            put(file_upload)
                .head(file_upload_status)
                .delete(file_upload_cancel),
        )
        .route("/v2/content/{digest}", get(content_read).head(content_read))
        .layer(DefaultBodyLimit::max(512 * 1024 * 1024));
    let media = Router::new()
        .route("/v2/media/materialize", post(media_materialize))
        .route("/v2/media/{id}", get(media_read).head(media_read))
        .layer(DefaultBodyLimit::max(20 * 1024));
    transfers.merge(media)
}

async fn file_download(
    State(state): State<AppState>,
    Query(location): Query<FileLocation>,
    headers: HeaderMap,
    method: Method,
) -> Response {
    if !valid_query("fileLocation", &location) {
        return invalid_request();
    }
    file_read(
        state,
        FileQuery {
            root_id: Some(location.root_id),
            path: Some(location.path),
        },
        headers,
        method == Method::HEAD,
        false,
    )
    .await
}

async fn file_preview(
    State(state): State<AppState>,
    Query(location): Query<PreviewLocation>,
    headers: HeaderMap,
    method: Method,
) -> Response {
    if !valid_query("previewLocation", &location) {
        return invalid_request();
    }
    file_read(
        state,
        FileQuery {
            root_id: None,
            path: Some(location.path),
        },
        headers,
        method == Method::HEAD,
        true,
    )
    .await
}

async fn file_read(
    state: AppState,
    query: FileQuery,
    headers: HeaderMap,
    head_only: bool,
    preview: bool,
) -> Response {
    let Some(files) = state.services.files.clone() else {
        return unavailable("file service unavailable");
    };
    if !authorized(&state, &headers, "files.download.workspace").await {
        return unauthorized();
    }
    files
        .download(query, &headers, head_only, preview)
        .await
        .unwrap_or_else(|error| file_error(&error))
}

async fn file_upload_status(
    State(state): State<AppState>,
    Query(location): Query<FileLocation>,
    headers: HeaderMap,
) -> Response {
    if !valid_query("fileLocation", &location) {
        return invalid_request();
    }
    let Some(files) = state.services.files.clone() else {
        return unavailable("file service unavailable");
    };
    if !authorized(&state, &headers, "files.upload.workspace").await {
        return unauthorized();
    }
    files
        .upload_status(file_query(location), &headers)
        .await
        .unwrap_or_else(|error| file_error(&error))
}

async fn file_upload_cancel(
    State(state): State<AppState>,
    Query(location): Query<FileLocation>,
    headers: HeaderMap,
) -> Response {
    if !valid_query("fileLocation", &location) {
        return invalid_request();
    }
    let Some(files) = state.services.files.clone() else {
        return unavailable("file service unavailable");
    };
    if !authorized(&state, &headers, "files.upload.workspace").await {
        return unauthorized();
    }
    files
        .cancel_upload(file_query(location), &headers)
        .await
        .unwrap_or_else(|error| file_error(&error))
}

async fn file_upload(
    State(state): State<AppState>,
    Query(location): Query<FileLocation>,
    headers: HeaderMap,
    body: Body,
) -> Response {
    if !valid_query("fileLocation", &location) {
        return invalid_request();
    }
    let Some(files) = state.services.files.clone() else {
        return unavailable("file service unavailable");
    };
    if !authorized(&state, &headers, "files.upload.workspace").await {
        return unauthorized();
    }
    files
        .upload(file_query(location), &headers, body)
        .await
        .unwrap_or_else(|error| file_error(&error))
}

async fn content_read(
    State(state): State<AppState>,
    Path(digest): Path<String>,
    Query(location): Query<ContentLocation>,
    headers: HeaderMap,
    method: Method,
) -> Response {
    if !valid_query("contentLocation", &location) {
        return invalid_request();
    }
    let Some(content) = state.services.content.clone() else {
        return unavailable("content service unavailable");
    };
    if !authorized(&state, &headers, "files.download.workspace").await {
        return unauthorized();
    }
    content
        .serve(
            &digest,
            ContentQuery {
                offset: location.offset,
                limit: location.limit,
            },
            &headers,
            method == Method::HEAD,
        )
        .await
        .unwrap_or_else(|error| content_error(&error))
}

async fn media_materialize(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(value): Json<Value>,
) -> Response {
    let request: MediaMaterializeRequest = match http::parse("mediaMaterializeRequest", value) {
        Ok(request) => request,
        Err(_) => return http::InvalidRequest::response(),
    };
    let Some(media) = state.services.media.clone() else {
        return unavailable("media service unavailable");
    };
    if !authorized(&state, &headers, "files.download.workspace").await {
        return unauthorized();
    }
    match media.materialize(&request.url).await {
        Ok(result) => http::response(
            if result.reused {
                StatusCode::OK
            } else {
                StatusCode::CREATED
            },
            "mediaMaterializeResponse",
            &MediaMaterializeResponse {
                id: result.id,
                expires_at: result.expires_at,
            },
        ),
        Err(error) => media_error(&error),
    }
}

async fn media_read(
    State(state): State<AppState>,
    Path(id): Path<String>,
    headers: HeaderMap,
    method: Method,
) -> Response {
    let Some(media) = state.services.media.clone() else {
        return unavailable("media service unavailable");
    };
    if !authorized(&state, &headers, "files.download.workspace").await {
        return unauthorized();
    }
    media
        .serve(&id, method == Method::HEAD)
        .unwrap_or_else(|error| media_error(&error))
}

async fn authorized(state: &AppState, headers: &HeaderMap, scope: &str) -> bool {
    headers.get("origin").is_none()
        && authorization_for_scope(state, headers, scope)
            .await
            .is_some()
}

fn valid_query<T: Serialize>(definition: &str, value: &T) -> bool {
    serde_json::to_value(value)
        .is_ok_and(|value| super::contract::valid_definition(definition, &value))
}

fn file_query(location: FileLocation) -> FileQuery {
    FileQuery {
        root_id: Some(location.root_id),
        path: Some(location.path),
    }
}

fn file_error(error: &FileError) -> Response {
    match error {
        FileError::Client { status, .. } if *status == StatusCode::NOT_FOUND => {
            http::error(*status, TransportErrorCode::NotFound, "file not found")
        }
        FileError::Client { status, .. } => http::error(
            *status,
            TransportErrorCode::InvalidRequest,
            "invalid file request",
        ),
        FileError::Io(_) | FileError::Json(_) => unavailable("file service unavailable"),
    }
}

fn content_error(error: &ContentError) -> Response {
    match error {
        ContentError::NotFound => http::error(
            StatusCode::NOT_FOUND,
            TransportErrorCode::NotFound,
            "content not found",
        ),
        ContentError::InvalidRange => invalid_request(),
        ContentError::Io(_) | ContentError::Json(_) => unavailable("content service unavailable"),
    }
}

fn media_error(error: &MediaError) -> Response {
    match error {
        MediaError::NotFound => http::error(
            StatusCode::NOT_FOUND,
            TransportErrorCode::NotFound,
            "media not found",
        ),
        MediaError::TooLarge => http::error(
            StatusCode::PAYLOAD_TOO_LARGE,
            TransportErrorCode::LimitExceeded,
            "media limit exceeded",
        ),
        MediaError::InvalidUrl
        | MediaError::InsecureUrl
        | MediaError::UnsafeHost
        | MediaError::Unsupported => invalid_request(),
        MediaError::Redirects
        | MediaError::RedirectLocation
        | MediaError::Upstream
        | MediaError::Timeout => unavailable("media service unavailable"),
    }
}

fn invalid_request() -> Response {
    http::error(
        StatusCode::BAD_REQUEST,
        TransportErrorCode::InvalidRequest,
        "invalid closed V2 request",
    )
}

fn unauthorized() -> Response {
    http::error(
        StatusCode::UNAUTHORIZED,
        TransportErrorCode::Unauthorized,
        "session authorization required",
    )
}

fn unavailable(message: &'static str) -> Response {
    http::error(
        StatusCode::SERVICE_UNAVAILABLE,
        TransportErrorCode::Unavailable,
        message,
    )
}
