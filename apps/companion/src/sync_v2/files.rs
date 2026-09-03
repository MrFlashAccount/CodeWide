//! Versioned V2 file, content, and media HTTP adapters.

use std::{
    sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
    },
    time::Duration,
};

use axum::{
    Json, Router,
    body::Body,
    extract::{DefaultBodyLimit, Path, Query, State},
    http::{HeaderMap, HeaderValue, Method, StatusCode},
    response::Response,
    routing::{get, post, put},
};
use futures_util::{StreamExt, stream};
use serde::Serialize;
use serde_json::Value;

use crate::{
    content::{ContentError, ContentQuery},
    files::{FileError, FileQuery, UploadCommitGuard},
    media::MediaError,
    server::{AppState, Authorization, authorization_for_scope},
};

use super::workspace_upload_staging::WorkspaceUploadError;
use super::{
    AttachmentStageError, AuthenticatedContextKey, http,
    protocol::{
        AttachmentStageRequest, AttachmentStageResponse, AttachmentUploadResponse, ContentLocation,
        FileLocation, MediaMaterializeRequest, MediaMaterializeResponse, MediaStreamCreateRequest,
        MediaStreamCreateResponse, PreviewLocation, TransportErrorCode,
    },
};

const WORKSPACE_UPLOAD_IDLE_TIMEOUT: Duration = Duration::from_secs(30);
const WORKSPACE_UPLOAD_TOTAL_TIMEOUT: Duration = Duration::from_mins(30);

#[derive(Clone, Copy)]
struct WorkspaceUploadTransferLimits {
    idle_timeout: Duration,
    total_timeout: Duration,
}

impl Default for WorkspaceUploadTransferLimits {
    fn default() -> Self {
        Self {
            idle_timeout: WORKSPACE_UPLOAD_IDLE_TIMEOUT,
            total_timeout: WORKSPACE_UPLOAD_TOTAL_TIMEOUT,
        }
    }
}

pub(crate) fn routes() -> Router<AppState> {
    let attachment_metadata = Router::new()
        .route("/v2/attachments", post(attachment_stage))
        .layer(DefaultBodyLimit::max(20 * 1024));
    let transfers = Router::new()
        .route(
            "/v2/attachments/{id}",
            put(attachment_upload)
                .head(attachment_upload_status)
                .delete(attachment_delete),
        )
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
        .route("/v2/media/streams", post(media_stream_create))
        .route(
            "/v2/media/streams/{id}",
            get(media_stream_read).head(media_stream_read),
        )
        .route("/v2/media/{id}", get(media_read).head(media_read))
        .layer(DefaultBodyLimit::max(20 * 1024));
    attachment_metadata.merge(transfers).merge(media)
}

async fn attachment_stage(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(value): Json<Value>,
) -> Response {
    let request: AttachmentStageRequest = match http::parse("attachmentStageRequest", value) {
        Ok(request) => request,
        Err(_) => return http::InvalidRequest::response(),
    };
    let Some(store) = state.services.attachment_staging.as_ref() else {
        return unavailable("attachment staging unavailable");
    };
    let Some(owner) = authorized_context(&state, &headers, "files.upload.workspace").await else {
        return unauthorized();
    };
    match store.stage(&owner, &request) {
        Ok((attachment_id, expires_at)) => {
            let upload_path = format!("/v2/attachments/{}", attachment_id.as_str());
            http::response(
                StatusCode::CREATED,
                "attachmentStageResponse",
                &AttachmentStageResponse {
                    attachment_id,
                    upload_path,
                    expires_at,
                },
            )
        }
        Err(error) => attachment_stage_error(&error),
    }
}

async fn attachment_upload(
    State(state): State<AppState>,
    Path(raw_id): Path<String>,
    headers: HeaderMap,
    body: Body,
) -> Response {
    let Some(store) = state.services.attachment_staging.as_ref() else {
        return unavailable("attachment staging unavailable");
    };
    let Some(owner) = authorized_context(&state, &headers, "files.upload.workspace").await else {
        return unauthorized();
    };
    let Ok(id) = super::scalar::Id::new(raw_id) else {
        return invalid_request();
    };
    #[cfg(feature = "e2e-command-fault")]
    if let Some(response) = e2e_attachment_upload_fault(&state).await {
        return response;
    }
    match store.upload(&owner, &id, body.into_data_stream()).await {
        Ok(result) => http::response(
            StatusCode::OK,
            "attachmentUploadResponse",
            &AttachmentUploadResponse {
                attachment: result.attachment,
                sha256: result.sha256,
            },
        ),
        Err(error) => attachment_stage_error(&error),
    }
}

async fn attachment_upload_status(
    State(state): State<AppState>,
    Path(raw_id): Path<String>,
    headers: HeaderMap,
) -> Response {
    let Some(store) = state.services.attachment_staging.as_ref() else {
        return unavailable("attachment staging unavailable");
    };
    let Some(owner) = authorized_context(&state, &headers, "files.upload.workspace").await else {
        return unauthorized();
    };
    let Ok(id) = super::scalar::Id::new(raw_id) else {
        return invalid_request();
    };
    match store.status(&owner, &id) {
        Ok(super::attachment_staging::StageStatus::Pending) => {
            empty_response(StatusCode::NO_CONTENT)
        }
        Ok(super::attachment_staging::StageStatus::Completed) => empty_response(StatusCode::OK),
        Err(error) => attachment_stage_error(&error),
    }
}

async fn attachment_delete(
    State(state): State<AppState>,
    Path(raw_id): Path<String>,
    headers: HeaderMap,
) -> Response {
    let Some(store) = state.services.attachment_staging.as_ref() else {
        return unavailable("attachment staging unavailable");
    };
    let Some(owner) = authorized_context(&state, &headers, "files.upload.workspace").await else {
        return unauthorized();
    };
    let Ok(id) = super::scalar::Id::new(raw_id) else {
        return invalid_request();
    };
    match store.delete(&owner, &id).await {
        Ok(()) => empty_response(StatusCode::NO_CONTENT),
        Err(error) => attachment_stage_error(&error),
    }
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
    #[cfg(feature = "e2e-command-fault")]
    if let Some(response) = e2e_hold_fail_fault(
        &state,
        super::E2ESurfaceFaultTarget::ResourceRead,
        "E2E resource read action mismatch",
    )
    .await
    {
        return response;
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
    protected_file_upload_status(state, file_query(location), headers).await
}

pub(crate) async fn protected_file_upload_status(
    state: AppState,
    query: FileQuery,
    headers: HeaderMap,
) -> Response {
    let Some(location) = file_location(query) else {
        return invalid_request();
    };
    let Some(files) = state.services.files.clone() else {
        return unavailable("file service unavailable");
    };
    let Some(owner) = authorized_context(&state, &headers, "files.upload.workspace").await else {
        return unauthorized();
    };
    let Some(staging) = state.services.workspace_upload_staging.as_ref() else {
        return unavailable("workspace upload staging unavailable");
    };
    let Some(upload_id) = upload_id(&headers) else {
        return invalid_request();
    };
    let tracked = match staging.validate_owner(
        &owner,
        location.root_id.as_str(),
        location.path.as_str(),
        upload_id,
    ) {
        Ok(tracked) => tracked,
        Err(error) => return workspace_upload_error(&error),
    };
    let response = files
        .upload_status(file_query(location), &headers)
        .await
        .unwrap_or_else(|error| file_error(&error));
    if !tracked
        && response
            .headers()
            .get("x-upload-complete")
            .is_none_or(|value| value != "true")
    {
        return http::error(
            StatusCode::NOT_FOUND,
            TransportErrorCode::NotFound,
            "workspace upload not found",
        );
    }
    response
}

async fn file_upload_cancel(
    State(state): State<AppState>,
    Query(location): Query<FileLocation>,
    headers: HeaderMap,
) -> Response {
    if !valid_query("fileLocation", &location) {
        return invalid_request();
    }
    protected_file_upload_cancel(state, file_query(location), headers).await
}

pub(crate) async fn protected_file_upload_cancel(
    state: AppState,
    query: FileQuery,
    headers: HeaderMap,
) -> Response {
    let Some(location) = file_location(query) else {
        return invalid_request();
    };
    let Some(owner) = authorized_context(&state, &headers, "files.upload.workspace").await else {
        return unauthorized();
    };
    let Some(staging) = state.services.workspace_upload_staging.as_ref() else {
        return unavailable("workspace upload staging unavailable");
    };
    let Some(upload_id) = upload_id(&headers) else {
        return invalid_request();
    };
    match staging
        .cancel(
            &owner,
            location.root_id.as_str(),
            location.path.as_str(),
            upload_id,
        )
        .await
    {
        Ok(()) => empty_response(StatusCode::NO_CONTENT),
        Err(error) => workspace_upload_error(&error),
    }
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
    protected_file_upload(state, file_query(location), headers, body).await
}

pub(crate) async fn protected_file_upload(
    state: AppState,
    query: FileQuery,
    headers: HeaderMap,
    body: Body,
) -> Response {
    let Some(location) = file_location(query) else {
        return invalid_request();
    };
    let Some(files) = state.services.files.clone() else {
        return unavailable("file service unavailable");
    };
    let changes = authorization_changes(&state);
    let Some(authorization) = authorized_upload_context(&state, &headers).await else {
        return unauthorized();
    };
    let Some(staging) = state.services.workspace_upload_staging.as_ref() else {
        return unavailable("workspace upload staging unavailable");
    };
    let Some((upload_id, sha256, total_bytes)) = workspace_upload_descriptor(&headers) else {
        return invalid_request();
    };
    #[cfg(feature = "e2e-command-fault")]
    if let Some(response) = e2e_attachment_upload_fault(&state).await {
        return response;
    }
    let lease = match staging
        .claim(
            &authorization.owner,
            location.root_id.as_str(),
            location.path.as_str(),
            &upload_id,
            &sha256,
            total_bytes,
        )
        .await
    {
        Ok(lease) => lease,
        Err(error) => return workspace_upload_error(&error),
    };
    let query = file_query(location.clone());
    if headers.get("content-range").is_none() {
        let mut cleanup_headers = HeaderMap::new();
        let Ok(upload_id_header) = HeaderValue::from_str(&upload_id) else {
            let _ = staging.abort(lease).await;
            return invalid_request();
        };
        cleanup_headers.insert("x-upload-id", upload_id_header);
        if let Err(error) = files.cancel_upload(query.clone(), &cleanup_headers).await {
            let _ = staging.abort(lease).await;
            return file_error(&error);
        }
    }
    let cancelled = Arc::new(AtomicBool::new(false));
    let bounded_body = workspace_upload_body(
        body,
        lease.cancellation(),
        changes,
        authorization.device_id,
        lease.total_bytes(),
        cancelled.clone(),
        WorkspaceUploadTransferLimits::default(),
    );
    let reauthorize_state = state.clone();
    let reauthorize_headers = headers.clone();
    let guard = UploadCommitGuard::new(move || {
        let state = reauthorize_state.clone();
        let headers = reauthorize_headers.clone();
        async move { authorized(&state, &headers, "files.upload.workspace").await }
    })
    .with_temporary_upload_id(&upload_id);
    let result = files
        .upload_authorized(query, &headers, bounded_body, &guard)
        .await;
    let authorization_rejected = matches!(
        result,
        Err(FileError::Client {
            status: StatusCode::UNAUTHORIZED,
            ..
        })
    );
    if cancelled.load(Ordering::Acquire) || authorization_rejected {
        let _ = staging.abort(lease).await;
        return unauthorized();
    }
    let completed = result
        .as_ref()
        .is_ok_and(|response| response.status().is_success());
    if staging.finish(&lease, completed).is_err() {
        return unavailable("workspace upload staging unavailable");
    }
    result.unwrap_or_else(|error| file_error(&error))
}

#[cfg(feature = "e2e-command-fault")]
async fn e2e_attachment_upload_fault(state: &AppState) -> Option<Response> {
    e2e_hold_fail_fault(
        state,
        super::E2ESurfaceFaultTarget::AttachmentUpload,
        "E2E attachment upload action mismatch",
    )
    .await
}

#[cfg(feature = "e2e-command-fault")]
async fn e2e_hold_fail_fault(
    state: &AppState,
    target: super::E2ESurfaceFaultTarget,
    mismatch: &'static str,
) -> Option<Response> {
    let runtime = state.services.sync_v2.as_ref()?;
    match runtime.intercept_e2e_surface_fault(target).await? {
        super::E2ESurfaceFaultEffect::Continue => None,
        super::E2ESurfaceFaultEffect::Fail(marker) => Some(http::response(
            StatusCode::SERVICE_UNAVAILABLE,
            "transportError",
            &super::protocol::TransportError {
                code: TransportErrorCode::Unavailable,
                message: format!("E2E fault: {marker}"),
            },
        )),
        super::E2ESurfaceFaultEffect::NotFound
        | super::E2ESurfaceFaultEffect::ReplayUnavailable
        | super::E2ESurfaceFaultEffect::InvalidCursor
        | super::E2ESurfaceFaultEffect::VoiceRetry(_)
        | super::E2ESurfaceFaultEffect::VoiceResult(_)
        | super::E2ESurfaceFaultEffect::PortExpire { .. }
        | super::E2ESurfaceFaultEffect::QueueUncertain(_) => Some(http::error(
            StatusCode::INTERNAL_SERVER_ERROR,
            TransportErrorCode::Unavailable,
            mismatch,
        )),
    }
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
    let Some(owner) = authorized_device(&state, &headers, "files.download.workspace").await else {
        return unauthorized();
    };
    match media.materialize_for_owner(&owner, &request.url).await {
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
    let Some(owner) = authorized_device(&state, &headers, "files.download.workspace").await else {
        return unauthorized();
    };
    media
        .serve_for_owner(&owner, &id, method == Method::HEAD)
        .unwrap_or_else(|error| media_error(&error))
}

async fn media_stream_create(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(value): Json<Value>,
) -> Response {
    let request: MediaStreamCreateRequest = match http::parse("mediaStreamCreateRequest", value) {
        Ok(request) => request,
        Err(_) => return http::InvalidRequest::response(),
    };
    let Some(media) = state.services.media.clone() else {
        return unavailable("media service unavailable");
    };
    let Some(owner) = authorized_device(&state, &headers, "files.download.workspace").await else {
        return unauthorized();
    };
    match media.register_stream(&owner, &request.url).await {
        Ok(result) => http::response(
            if result.reused {
                StatusCode::OK
            } else {
                StatusCode::CREATED
            },
            "mediaStreamCreateResponse",
            &MediaStreamCreateResponse {
                id: result.id,
                expires_at: result.expires_at,
            },
        ),
        Err(error) => media_error(&error),
    }
}

async fn media_stream_read(
    State(state): State<AppState>,
    Path(id): Path<String>,
    headers: HeaderMap,
    method: Method,
) -> Response {
    let Some(media) = state.services.media.clone() else {
        return unavailable("media service unavailable");
    };
    let Some(owner) = authorized_device(&state, &headers, "files.download.workspace").await else {
        return unauthorized();
    };
    media
        .stream(&owner, &id, &headers, method == Method::HEAD)
        .await
        .unwrap_or_else(|error| media_error(&error))
}

async fn authorized(state: &AppState, headers: &HeaderMap, scope: &str) -> bool {
    headers.get("origin").is_none()
        && authorization_for_scope(state, headers, scope)
            .await
            .is_some()
}

async fn authorized_device(state: &AppState, headers: &HeaderMap, scope: &str) -> Option<String> {
    if headers.get("origin").is_some() {
        return None;
    }
    authorization_for_scope(state, headers, scope)
        .await?
        .device_id()
        .map(str::to_owned)
}

async fn authorized_context(
    state: &AppState,
    headers: &HeaderMap,
    scope: &str,
) -> Option<AuthenticatedContextKey> {
    if headers.get("origin").is_some() {
        return None;
    }
    let authorization = authorization_for_scope(state, headers, scope).await?;
    AuthenticatedContextKey::derive(&authorization).ok()
}

struct AuthorizedUploadContext {
    owner: AuthenticatedContextKey,
    device_id: Option<String>,
}

async fn authorized_upload_context(
    state: &AppState,
    headers: &HeaderMap,
) -> Option<AuthorizedUploadContext> {
    if headers.get("origin").is_some() {
        return None;
    }
    let authorization = authorization_for_scope(state, headers, "files.upload.workspace").await?;
    let owner = AuthenticatedContextKey::derive(&authorization).ok()?;
    let device_id = authorization.device_id().map(str::to_owned);
    Some(AuthorizedUploadContext { owner, device_id })
}

fn upload_id(headers: &HeaderMap) -> Option<&str> {
    headers
        .get("x-upload-id")
        .and_then(|value| value.to_str().ok())
        .filter(|value| {
            (16..=80).contains(&value.len())
                && value
                    .bytes()
                    .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'-'))
        })
}

fn workspace_upload_descriptor(headers: &HeaderMap) -> Option<(String, String, u64)> {
    let sha256 = headers
        .get("x-content-sha256")?
        .to_str()
        .ok()?
        .to_ascii_lowercase();
    if sha256.len() != 64 || !sha256.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return None;
    }
    let content_length = headers
        .get("content-length")?
        .to_str()
        .ok()?
        .parse::<u64>()
        .ok()?;
    let content_range = headers
        .get("content-range")
        .and_then(|value| value.to_str().ok());
    let total_bytes = content_range
        .and_then(|value| value.rsplit_once('/'))
        .and_then(|(_, total)| total.parse::<u64>().ok())
        .unwrap_or(content_length);
    let upload_id = match (upload_id(headers), content_range) {
        (Some(upload_id), _) => upload_id.to_owned(),
        (None, None) => format!("simple-{sha256}"),
        (None, Some(_)) => return None,
    };
    Some((upload_id, sha256, total_bytes))
}

fn authorization_changes(
    state: &AppState,
) -> Option<tokio::sync::broadcast::Receiver<crate::auth::AuthorizationChange>> {
    match &state.authorization {
        Authorization::Registry(registry) => Some(registry.subscribe_authorization_changes()),
        Authorization::AdminOnly(_) => None,
    }
}

fn workspace_upload_body(
    body: Body,
    cancelled: tokio::sync::watch::Receiver<bool>,
    changes: Option<tokio::sync::broadcast::Receiver<crate::auth::AuthorizationChange>>,
    owner_device_id: Option<String>,
    max_bytes: u64,
    cancellation_observed: Arc<AtomicBool>,
    limits: WorkspaceUploadTransferLimits,
) -> Body {
    struct State {
        body: futures_util::stream::BoxStream<'static, Result<bytes::Bytes, std::io::Error>>,
        cancelled: tokio::sync::watch::Receiver<bool>,
        changes: Option<tokio::sync::broadcast::Receiver<crate::auth::AuthorizationChange>>,
        owner_device_id: Option<String>,
        deadline: tokio::time::Instant,
        bytes: u64,
        max_bytes: u64,
        idle_timeout: Duration,
        failed: bool,
        cancellation_observed: Arc<AtomicBool>,
    }

    let state = State {
        body: body
            .into_data_stream()
            .map(|item| item.map_err(std::io::Error::other))
            .boxed(),
        cancelled,
        changes,
        owner_device_id,
        deadline: tokio::time::Instant::now() + limits.total_timeout,
        bytes: 0,
        max_bytes,
        idle_timeout: limits.idle_timeout,
        failed: false,
        cancellation_observed,
    };
    Body::from_stream(stream::unfold(state, |mut state| async move {
        if state.failed {
            return None;
        }
        if *state.cancelled.borrow() {
            state.failed = true;
            state.cancellation_observed.store(true, Ordering::Release);
            return Some((
                Err(std::io::Error::new(
                    std::io::ErrorKind::PermissionDenied,
                    "upload cancelled",
                )),
                state,
            ));
        }
        let owner_device_id = state.owner_device_id.clone();
        let item = tokio::select! {
            biased;
            cancellation = state.cancelled.changed() => {
                let _ = cancellation;
                state.cancellation_observed.store(true, Ordering::Release);
                Err(std::io::Error::new(std::io::ErrorKind::PermissionDenied, "upload cancelled"))
            }
            () = wait_for_authorization_change(&mut state.changes, owner_device_id.as_deref()) => {
                state.cancellation_observed.store(true, Ordering::Release);
                Err(std::io::Error::new(std::io::ErrorKind::PermissionDenied, "upload authorization revoked"))
            }
            () = tokio::time::sleep_until(state.deadline) => {
                Err(std::io::Error::new(std::io::ErrorKind::TimedOut, "upload deadline exceeded"))
            }
            item = tokio::time::timeout(state.idle_timeout, state.body.next()) => {
                match item {
                    Ok(Some(item)) => item,
                    Ok(None) => return None,
                    Err(_) => Err(std::io::Error::new(std::io::ErrorKind::TimedOut, "upload idle timeout")),
                }
            }
        };
        match item {
            Ok(chunk) => {
                state.bytes = state
                    .bytes
                    .saturating_add(u64::try_from(chunk.len()).unwrap_or(u64::MAX));
                if state.bytes > state.max_bytes {
                    state.failed = true;
                    Some((
                        Err(std::io::Error::other("upload body limit exceeded")),
                        state,
                    ))
                } else {
                    Some((Ok(chunk), state))
                }
            }
            Err(error) => {
                state.failed = true;
                Some((Err(error), state))
            }
        }
    }))
}

async fn wait_for_authorization_change(
    changes: &mut Option<tokio::sync::broadcast::Receiver<crate::auth::AuthorizationChange>>,
    owner_device_id: Option<&str>,
) {
    let Some(changes) = changes.as_mut() else {
        std::future::pending().await
    };
    loop {
        match changes.recv().await {
            Ok(change) if Some(change.device_id.as_str()) == owner_device_id => return,
            Ok(_) => {}
            Err(_) => return,
        }
    }
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

fn file_location(query: FileQuery) -> Option<FileLocation> {
    Some(FileLocation {
        root_id: query.root_id?,
        path: query.path?,
    })
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

fn workspace_upload_error(error: &WorkspaceUploadError) -> Response {
    match error {
        WorkspaceUploadError::Forbidden => http::error(
            StatusCode::NOT_FOUND,
            TransportErrorCode::NotFound,
            "workspace upload not found",
        ),
        WorkspaceUploadError::Conflict => http::error(
            StatusCode::CONFLICT,
            TransportErrorCode::Conflict,
            "workspace upload state conflicts with this request",
        ),
        WorkspaceUploadError::QuotaExceeded => http::error(
            StatusCode::TOO_MANY_REQUESTS,
            TransportErrorCode::LimitExceeded,
            "workspace upload staging quota exceeded",
        ),
        WorkspaceUploadError::Storage(_) => unavailable("workspace upload staging unavailable"),
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
        MediaError::Capacity => http::error(
            StatusCode::TOO_MANY_REQUESTS,
            TransportErrorCode::LimitExceeded,
            "media capacity exceeded",
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

fn attachment_stage_error(error: &AttachmentStageError) -> Response {
    match error {
        AttachmentStageError::Invalid | AttachmentStageError::Integrity => invalid_request(),
        AttachmentStageError::NotFound
        | AttachmentStageError::Expired
        | AttachmentStageError::Forbidden => http::error(
            StatusCode::NOT_FOUND,
            TransportErrorCode::NotFound,
            "attachment stage not found",
        ),
        AttachmentStageError::Conflict | AttachmentStageError::Cancelled => http::error(
            StatusCode::CONFLICT,
            TransportErrorCode::Conflict,
            "attachment stage state conflicts with this request",
        ),
        AttachmentStageError::Timeout => http::error(
            StatusCode::REQUEST_TIMEOUT,
            TransportErrorCode::Unavailable,
            "attachment upload timed out",
        ),
        AttachmentStageError::QuotaExceeded => http::error(
            StatusCode::TOO_MANY_REQUESTS,
            TransportErrorCode::LimitExceeded,
            "attachment staging quota exceeded",
        ),
        AttachmentStageError::Storage(_) => unavailable("attachment staging unavailable"),
    }
}

fn empty_response(status: StatusCode) -> Response {
    Response::builder()
        .status(status)
        .body(Body::empty())
        .unwrap_or_else(|_| Response::new(Body::empty()))
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

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn workspace_upload_body_stops_on_stage_cancellation() {
        let (cancel, _retained) = tokio::sync::watch::channel(false);
        let observed = Arc::new(AtomicBool::new(false));
        assert!(cancel.send(true).is_ok());
        let cancelled = cancel.subscribe();
        let body = workspace_upload_body(
            Body::from("hello"),
            cancelled,
            None,
            None,
            5,
            observed.clone(),
            WorkspaceUploadTransferLimits::default(),
        );
        assert!(axum::body::to_bytes(body, 16).await.is_err());
        assert!(observed.load(Ordering::Acquire));
    }

    #[tokio::test]
    async fn workspace_upload_body_rejects_bytes_beyond_reserved_total() {
        let (_cancel, cancelled) = tokio::sync::watch::channel(false);
        let body = workspace_upload_body(
            Body::from("hello"),
            cancelled,
            None,
            None,
            4,
            Arc::new(AtomicBool::new(false)),
            WorkspaceUploadTransferLimits::default(),
        );
        assert!(axum::body::to_bytes(body, 16).await.is_err());
    }

    #[tokio::test]
    async fn workspace_upload_body_rejects_a_stalled_stream() {
        let (_cancel, cancelled) = tokio::sync::watch::channel(false);
        let stalled = Body::from_stream(futures_util::stream::pending::<
            Result<bytes::Bytes, std::io::Error>,
        >());
        let body = workspace_upload_body(
            stalled,
            cancelled,
            None,
            None,
            4,
            Arc::new(AtomicBool::new(false)),
            WorkspaceUploadTransferLimits {
                idle_timeout: Duration::from_millis(10),
                total_timeout: Duration::from_secs(1),
            },
        );
        let result =
            tokio::time::timeout(Duration::from_millis(200), axum::body::to_bytes(body, 16)).await;
        assert!(matches!(result, Ok(Err(_))));
    }
}
