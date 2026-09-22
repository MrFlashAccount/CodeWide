//! Authenticated resumable upload adapters shared by the surviving Companion API.

use super::response::{self, UploadErrorCode};
use super::{owner::UploadOwnerKey, staging::WorkspaceUploadError};
use crate::{
    files::{FileError, FileQuery, UploadCommitGuard},
    server::{AppState, Authorization, authenticated_session},
};
use axum::{
    body::Body,
    http::{HeaderMap, HeaderValue, StatusCode},
    response::Response,
};
use futures_util::{StreamExt, stream};
use std::{
    sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
    },
    time::Duration,
};

#[derive(Clone)]
struct FileLocation {
    root_id: String,
    path: String,
}

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
    let Some(owner) = authorized_context(&state, &headers).await else {
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
        return response::error(
            StatusCode::NOT_FOUND,
            UploadErrorCode::NotFound,
            "workspace upload not found",
        );
    }
    response
}

pub(crate) async fn protected_file_upload_cancel(
    state: AppState,
    query: FileQuery,
    headers: HeaderMap,
) -> Response {
    let Some(location) = file_location(query) else {
        return invalid_request();
    };
    let Some(owner) = authorized_context(&state, &headers).await else {
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
        async move { authorized(&state, &headers).await }
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

async fn authorized(state: &AppState, headers: &HeaderMap) -> bool {
    headers.get("origin").is_none() && authenticated_session(state, headers).await.is_some()
}

async fn authorized_context(state: &AppState, headers: &HeaderMap) -> Option<UploadOwnerKey> {
    if headers.get("origin").is_some() {
        return None;
    }
    let authorization = authenticated_session(state, headers).await?;
    UploadOwnerKey::derive(&authorization).ok()
}

struct AuthorizedUploadContext {
    owner: UploadOwnerKey,
    device_id: Option<String>,
}

async fn authorized_upload_context(
    state: &AppState,
    headers: &HeaderMap,
) -> Option<AuthorizedUploadContext> {
    if headers.get("origin").is_some() {
        return None;
    }
    let authorization = authenticated_session(state, headers).await?;
    let owner = UploadOwnerKey::derive(&authorization).ok()?;
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
            response::error(*status, UploadErrorCode::NotFound, "file not found")
        }
        FileError::Client { status, .. } => response::error(
            *status,
            UploadErrorCode::InvalidRequest,
            "invalid file request",
        ),
        FileError::Io(_) | FileError::Json(_) => unavailable("file service unavailable"),
    }
}

fn workspace_upload_error(error: &WorkspaceUploadError) -> Response {
    match error {
        WorkspaceUploadError::Forbidden => response::error(
            StatusCode::NOT_FOUND,
            UploadErrorCode::NotFound,
            "workspace upload not found",
        ),
        WorkspaceUploadError::Conflict => response::error(
            StatusCode::CONFLICT,
            UploadErrorCode::Conflict,
            "workspace upload state conflicts with this request",
        ),
        WorkspaceUploadError::QuotaExceeded => response::error(
            StatusCode::TOO_MANY_REQUESTS,
            UploadErrorCode::LimitExceeded,
            "workspace upload staging quota exceeded",
        ),
        WorkspaceUploadError::Storage(_) => unavailable("workspace upload staging unavailable"),
    }
}

fn empty_response(status: StatusCode) -> Response {
    Response::builder()
        .status(status)
        .body(Body::empty())
        .unwrap_or_else(|_| Response::new(Body::empty()))
}

fn invalid_request() -> Response {
    response::error(
        StatusCode::BAD_REQUEST,
        UploadErrorCode::InvalidRequest,
        "invalid upload request",
    )
}

fn unauthorized() -> Response {
    response::error(
        StatusCode::UNAUTHORIZED,
        UploadErrorCode::Unauthorized,
        "session authorization required",
    )
}

fn unavailable(message: &'static str) -> Response {
    response::error(
        StatusCode::SERVICE_UNAVAILABLE,
        UploadErrorCode::Unavailable,
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
