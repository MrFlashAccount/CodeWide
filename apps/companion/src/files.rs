use std::{
    collections::{HashMap, HashSet},
    os::unix::fs::{MetadataExt, PermissionsExt},
    path::{Component, Path, PathBuf},
    sync::Arc,
    time::{Duration, SystemTime, UNIX_EPOCH},
};

use axum::{
    body::Body,
    http::{HeaderMap, HeaderValue, Response, StatusCode, header},
    response::IntoResponse,
};
use futures_util::{FutureExt, StreamExt, future::BoxFuture};
use percent_encoding::{NON_ALPHANUMERIC, utf8_percent_encode};
use rand::{TryRngCore, rngs::OsRng};
use serde::{Deserialize, Serialize};
use serde_json::json;
use sha2::{Digest, Sha256};
use tokio::{
    fs::{File, OpenOptions},
    io::{AsyncReadExt, AsyncWriteExt},
};
use tokio_util::io::ReaderStream;

const DEFAULT_MAX_TRANSFER_BYTES: u64 = 512 * 1024 * 1024;
const MAX_OBSERVED_PREVIEW_FILES: usize = 4_096;
const MANAGED_ATTACHMENT_RETENTION: Duration = Duration::from_hours(168);

#[derive(Clone)]
pub struct FileService {
    roots: Arc<HashMap<String, PathBuf>>,
    preview_path_mappings: Arc<Vec<PreviewPathMapping>>,
    observed: Arc<tokio::sync::RwLock<HashSet<PathBuf>>>,
    preview_registry_path: Option<PathBuf>,
    managed_attachments: Option<ManagedAttachmentRoot>,
    managed_manifest_lock: Arc<tokio::sync::Mutex<()>>,
    max_transfer_bytes: u64,
}

#[derive(Clone)]
pub(crate) struct UploadCommitGuard {
    authorize: Arc<dyn Fn() -> BoxFuture<'static, bool> + Send + Sync>,
    temporary_upload_id: Option<Arc<str>>,
}

impl UploadCommitGuard {
    pub(crate) fn new<F, Fut>(authorize: F) -> Self
    where
        F: Fn() -> Fut + Send + Sync + 'static,
        Fut: std::future::Future<Output = bool> + Send + 'static,
    {
        Self {
            authorize: Arc::new(move || authorize().boxed()),
            temporary_upload_id: None,
        }
    }

    pub(crate) fn with_temporary_upload_id(mut self, upload_id: &str) -> Self {
        self.temporary_upload_id = Some(Arc::from(upload_id));
        self
    }

    async fn authorize(&self) -> Result<(), FileError> {
        if (self.authorize)().await {
            Ok(())
        } else {
            Err(client(
                StatusCode::UNAUTHORIZED,
                "upload_authorization_expired",
            ))
        }
    }
}

#[derive(Clone)]
struct PreviewPathMapping {
    reported_root: PathBuf,
    readable_root: PathBuf,
}

#[derive(Clone)]
struct ManagedAttachmentRoot {
    root_id: String,
    root: PathBuf,
}

struct ManagedAttachmentPath<'a> {
    thread_id: &'a str,
    file_name: &'a str,
}

struct CompletedUpload<'a> {
    root_id: &'a str,
    relative_path: &'a str,
    temporary: &'a Path,
    target: &'a Path,
    sha256: &'a str,
    bytes: u64,
    overwrite: bool,
}

struct SimpleUpload<'a> {
    root: &'a str,
    path: &'a str,
    expected_hash: &'a str,
    content_length: u64,
    overwrite: bool,
}

#[derive(Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct AttachmentManifest {
    version: u8,
    thread_id: String,
    attachments: Vec<AttachmentManifestEntry>,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct AttachmentManifestEntry {
    path: String,
    name: String,
    sha256: String,
    bytes: u64,
    content_type: String,
    created_at_unix_ms: u64,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileQuery {
    pub root_id: Option<String>,
    pub path: Option<String>,
}

#[derive(Debug, thiserror::Error)]
pub enum FileError {
    #[error("{code}")]
    Client {
        status: StatusCode,
        code: &'static str,
    },
    #[error(transparent)]
    Io(#[from] std::io::Error),
    #[error(transparent)]
    Json(#[from] serde_json::Error),
}

#[derive(Deserialize)]
struct PreviewRegistry {
    version: u8,
    files: Vec<PathBuf>,
}

#[derive(Serialize)]
struct PreviewRegistryRef<'a> {
    version: u8,
    files: &'a [PathBuf],
}

struct ByteRange {
    start: u64,
    end: u64,
}

struct ContentRange {
    start: u64,
    end: u64,
    total: u64,
}

impl FileService {
    /// Creates a scoped file service from canonical roots.
    ///
    /// # Errors
    ///
    /// Returns an error when a configured root cannot be canonicalized or the
    /// preview registry cannot be read.
    pub async fn open(
        roots: HashMap<String, PathBuf>,
        preview_roots: Vec<PathBuf>,
        preview_registry_path: Option<PathBuf>,
        max_transfer_bytes: Option<u64>,
    ) -> Result<Self, FileError> {
        Self::open_with_preview_mappings(
            roots,
            preview_roots,
            HashMap::new(),
            preview_registry_path,
            max_transfer_bytes,
        )
        .await
    }

    /// Creates a file service whose app-server paths may be translated to
    /// separate read-only mounts visible inside the companion namespace.
    ///
    /// # Errors
    ///
    /// Returns an error when a configured root or readable mapping root cannot
    /// be canonicalized, a reported mapping root is not absolute, or the
    /// preview registry cannot be read.
    pub async fn open_with_preview_mappings(
        roots: HashMap<String, PathBuf>,
        preview_roots: Vec<PathBuf>,
        preview_path_mappings: HashMap<PathBuf, PathBuf>,
        preview_registry_path: Option<PathBuf>,
        max_transfer_bytes: Option<u64>,
    ) -> Result<Self, FileError> {
        Self::open_internal(
            roots,
            preview_roots,
            preview_path_mappings,
            preview_registry_path,
            None,
            max_transfer_bytes,
        )
        .await
    }

    /// Creates a scoped file service with one companion-owned attachment root.
    /// Uploads below `sessions/<thread-id>/files/` are content-addressed and
    /// recorded in a per-thread manifest. Other roots keep the generic file
    /// transport contract unchanged.
    ///
    /// # Errors
    ///
    /// Returns an error when a configured root cannot be canonicalized, the
    /// managed root is unknown, or the preview registry cannot be read.
    pub async fn open_with_managed_attachments(
        roots: HashMap<String, PathBuf>,
        preview_roots: Vec<PathBuf>,
        preview_path_mappings: HashMap<PathBuf, PathBuf>,
        preview_registry_path: Option<PathBuf>,
        managed_attachment_root_id: String,
        max_transfer_bytes: Option<u64>,
    ) -> Result<Self, FileError> {
        Self::open_internal(
            roots,
            preview_roots,
            preview_path_mappings,
            preview_registry_path,
            Some(managed_attachment_root_id),
            max_transfer_bytes,
        )
        .await
    }

    async fn open_internal(
        roots: HashMap<String, PathBuf>,
        _preview_roots: Vec<PathBuf>,
        preview_path_mappings: HashMap<PathBuf, PathBuf>,
        preview_registry_path: Option<PathBuf>,
        managed_attachment_root_id: Option<String>,
        max_transfer_bytes: Option<u64>,
    ) -> Result<Self, FileError> {
        let mut canonical_roots = HashMap::with_capacity(roots.len());
        for (id, root) in roots {
            if !valid_root_id(&id) {
                return Err(client(StatusCode::BAD_REQUEST, "invalid_root_id"));
            }
            canonical_roots.insert(id, tokio::fs::canonicalize(root).await?);
        }
        let managed_attachments = managed_attachment_root_id
            .map(|root_id| {
                let root = canonical_roots.get(&root_id).cloned().ok_or_else(|| {
                    client(StatusCode::BAD_REQUEST, "unknown_managed_attachment_root")
                })?;
                Ok::<ManagedAttachmentRoot, FileError>(ManagedAttachmentRoot { root_id, root })
            })
            .transpose()?;
        let mut canonical_preview_path_mappings = Vec::with_capacity(preview_path_mappings.len());
        for (reported_root, readable_root) in preview_path_mappings {
            if !reported_root.is_absolute() {
                return Err(client(
                    StatusCode::BAD_REQUEST,
                    "invalid_preview_path_mapping",
                ));
            }
            canonical_preview_path_mappings.push(PreviewPathMapping {
                reported_root: normalize_absolute_path(&reported_root),
                readable_root: tokio::fs::canonicalize(readable_root).await?,
            });
        }
        canonical_preview_path_mappings.sort_by(|left, right| {
            right
                .reported_root
                .components()
                .count()
                .cmp(&left.reported_root.components().count())
        });
        let observed = load_preview_registry(preview_registry_path.as_deref()).await?;
        Ok(Self {
            roots: Arc::new(canonical_roots),
            preview_path_mappings: Arc::new(canonical_preview_path_mappings),
            observed: Arc::new(tokio::sync::RwLock::new(observed)),
            preview_registry_path,
            managed_attachments,
            managed_manifest_lock: Arc::new(tokio::sync::Mutex::new(())),
            max_transfer_bytes: max_transfer_bytes.unwrap_or(DEFAULT_MAX_TRANSFER_BYTES),
        })
    }

    /// Adds an exact app-server-observed path to the private preview allowlist.
    pub async fn observe_preview_path(&self, path: &Path) {
        self.observe_preview_paths([path.to_path_buf()]).await;
    }

    /// Adds a batch of exact app-server-observed paths to the private preview
    /// allowlist. Canonicalization is bounded and the registry is persisted at
    /// most once for the whole projection.
    pub async fn observe_preview_paths(&self, paths: impl IntoIterator<Item = PathBuf>) {
        let canonical = futures_util::stream::iter(paths)
            .map(|path| async move { self.canonical_preview_path(&path).await })
            .buffer_unordered(32)
            .filter_map(async |result| result)
            .collect::<Vec<_>>()
            .await;
        self.record_observed_preview_paths(canonical).await;
    }

    /// Adds exact preview paths only when their canonical targets remain
    /// inside the supplied root. This is used for VCS-discovered files: a
    /// changed symlink must not authorize an arbitrary target outside the
    /// repository that produced the snapshot.
    pub(crate) async fn observe_preview_paths_within(&self, root: PathBuf, paths: Vec<PathBuf>) {
        let Some(canonical_root) = self.canonical_preview_path(&root).await else {
            return;
        };
        let canonical = futures_util::stream::iter(paths)
            .map(|path| {
                let canonical_root = canonical_root.clone();
                async move {
                    self.canonical_preview_path(&path)
                        .await
                        .filter(|candidate| is_child(&canonical_root, candidate))
                }
            })
            .buffer_unordered(32)
            .filter_map(async |result| result)
            .collect::<Vec<_>>()
            .await;
        self.record_observed_preview_paths(canonical).await;
    }

    /// Resolves one reported file path and grants its canonical target to the
    /// private preview endpoint. Read access is intentionally host-wide for an
    /// authenticated device; the workspace is retained only as source context.
    pub(crate) async fn preview_metadata_within(
        &self,
        _root: PathBuf,
        path: PathBuf,
    ) -> Result<(u64, String), FileError> {
        self.host_preview_metadata(path).await
    }

    /// Resolves one explicitly requested host file and grants its exact canonical
    /// target to the private preview endpoint. Callers must enforce terminal-level
    /// authorization before invoking this capability.
    ///
    /// # Errors
    ///
    /// Returns an error when the path is missing, cannot be inspected, or does
    /// not resolve to a regular file.
    pub(crate) async fn host_preview_metadata(
        &self,
        path: PathBuf,
    ) -> Result<(u64, String), FileError> {
        let canonical = self
            .canonical_preview_path(&path)
            .await
            .ok_or_else(|| client(StatusCode::NOT_FOUND, "file_not_found"))?;
        let metadata = tokio::fs::metadata(&canonical).await?;
        if !metadata.is_file() {
            return Err(client(StatusCode::BAD_REQUEST, "not_a_regular_file"));
        }
        self.record_observed_preview_paths(vec![canonical]).await;
        Ok((metadata.len(), content_type(&path).to_owned()))
    }

    async fn canonical_preview_path(&self, path: &Path) -> Option<PathBuf> {
        let readable = self.readable_preview_path(path);
        if let Ok(canonical) = tokio::fs::canonicalize(&readable).await {
            Some(canonical)
        } else {
            let source = strip_source_location(&readable)?;
            tokio::fs::canonicalize(source).await.ok()
        }
    }

    async fn record_observed_preview_paths(&self, canonical: Vec<PathBuf>) {
        if canonical.is_empty() {
            return;
        }
        let snapshot = {
            let mut observed = self.observed.write().await;
            let mut changed = false;
            for path in canonical {
                changed |= observed.insert(path);
            }
            if !changed {
                return;
            }
            if observed.len() > MAX_OBSERVED_PREVIEW_FILES {
                let mut entries = observed.iter().cloned().collect::<Vec<_>>();
                entries.sort();
                for stale in entries
                    .into_iter()
                    .take(observed.len() - MAX_OBSERVED_PREVIEW_FILES)
                {
                    observed.remove(&stale);
                }
            }
            observed.iter().cloned().collect::<Vec<_>>()
        };
        if let Some(path) = self.preview_registry_path.clone() {
            let _ = persist_preview_registry(&path, &snapshot).await;
        }
    }

    /// Resolves a remote input to an existing regular host file. Relative paths
    /// use the named root as their base but may resolve outside it.
    ///
    /// # Errors
    ///
    /// Returns a stable client error for missing roots, invalid or missing
    /// paths, and non-files.
    pub async fn resolve_input_file(
        &self,
        root_id: &str,
        relative_path: &str,
    ) -> Result<PathBuf, FileError> {
        self.resolve_existing(root_id, relative_path).await
    }

    /// Tombstones one explicitly deleted thread. Files remain readable during
    /// the grace period, so a delayed event or accidental deletion does not
    /// immediately destroy the canonical attachment path.
    ///
    /// # Errors
    ///
    /// Returns an error for an invalid thread ID or a failed durable write.
    pub async fn mark_thread_attachments_deleted(&self, thread_id: &str) -> Result<(), FileError> {
        let Some(configured) = self.managed_attachments.as_ref() else {
            return Ok(());
        };
        if !valid_managed_segment(thread_id, 160) {
            return Err(client(StatusCode::BAD_REQUEST, "invalid_thread_id"));
        }
        let session = configured.root.join("sessions").join(thread_id);
        match tokio::fs::metadata(&session).await {
            Ok(metadata) if metadata.is_dir() => {}
            Ok(_) => return Err(client(StatusCode::CONFLICT, "invalid_attachment_session")),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
            Err(error) => return Err(error.into()),
        }
        let tombstone = session.join(".deleted-at");
        persist_private_file(&tombstone, format!("{}\n", now_unix_ms()).as_bytes()).await
    }

    /// Removes only sessions that were explicitly tombstoned at least seven
    /// days ago, then removes unreferenced CAS blobs. Archive and catalog
    /// disappearance never enter this path.
    ///
    /// # Errors
    ///
    /// Returns an error when managed attachment metadata cannot be read or
    /// expired files cannot be removed.
    pub async fn gc_managed_attachments(&self) -> Result<(), FileError> {
        let Some(configured) = self.managed_attachments.as_ref() else {
            return Ok(());
        };
        let _guard = self.managed_manifest_lock.lock().await;
        let now = now_unix_ms();
        let retention_ms =
            u64::try_from(MANAGED_ATTACHMENT_RETENTION.as_millis()).unwrap_or(u64::MAX);
        let sessions = configured.root.join("sessions");
        let mut entries = match tokio::fs::read_dir(&sessions).await {
            Ok(entries) => entries,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
            Err(error) => return Err(error.into()),
        };
        while let Some(entry) = entries.next_entry().await? {
            if !entry.file_type().await?.is_dir() {
                continue;
            }
            let tombstone = entry.path().join(".deleted-at");
            let deleted_at = match tokio::fs::read_to_string(&tombstone).await {
                Ok(value) => value.trim().parse::<u64>().ok(),
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => None,
                Err(error) => return Err(error.into()),
            };
            if deleted_at.is_some_and(|deleted_at| now.saturating_sub(deleted_at) >= retention_ms) {
                tokio::fs::remove_dir_all(entry.path()).await?;
            }
        }
        remove_unreferenced_blobs(&configured.root.join("blobs/sha256"), now, retention_ms).await
    }

    /// Builds a private download or preview response with range support.
    ///
    /// # Errors
    ///
    /// Returns a client error for invalid paths/ranges and an I/O error for a
    /// host failure.
    pub async fn download(
        &self,
        query: FileQuery,
        headers: &HeaderMap,
        head_only: bool,
        preview: bool,
    ) -> Result<Response<Body>, FileError> {
        let path = if preview {
            let path = query
                .path
                .ok_or_else(|| client(StatusCode::BAD_REQUEST, "path_required"))?;
            self.resolve_host_preview(&path).await?
        } else {
            let root_id = query
                .root_id
                .ok_or_else(|| client(StatusCode::BAD_REQUEST, "rootId_and_path_required"))?;
            let path = query
                .path
                .ok_or_else(|| client(StatusCode::BAD_REQUEST, "rootId_and_path_required"))?;
            self.resolve_existing(&root_id, &path).await?
        };
        self.serve_file(&path, headers, head_only, preview).await
    }

    /// Returns resumable-upload state for any host path addressable through a
    /// configured root or an absolute path.
    ///
    /// # Errors
    ///
    /// Returns a stable client error for malformed headers and unsafe paths.
    pub async fn upload_status(
        &self,
        query: FileQuery,
        headers: &HeaderMap,
    ) -> Result<Response<Body>, FileError> {
        let (root, path) = required_root_path(query)?;
        let upload_id = required_upload_id(headers)?;
        let target = self.resolve_upload_target(&root, &path).await?;
        let temporary = resumable_path(&target, upload_id);
        if let Ok(metadata) = tokio::fs::symlink_metadata(&temporary).await {
            if !metadata.is_file() || metadata.file_type().is_symlink() {
                return Err(client(StatusCode::CONFLICT, "invalid_upload_state"));
            }
            return response_with_headers(
                StatusCode::NO_CONTENT,
                [("x-upload-offset", metadata.len().to_string())],
                Body::empty(),
            );
        }
        if let (Ok(metadata), Some(expected_hash)) = (
            tokio::fs::symlink_metadata(&target).await,
            string_header(headers, "x-content-sha256"),
        ) && metadata.is_file()
            && valid_sha256(expected_hash)
            && metadata.len() <= self.max_transfer_bytes
            && hash_file(&target).await? == expected_hash
        {
            self.record_managed_attachment(&root, &path, expected_hash, metadata.len())
                .await?;
            return response_with_headers(
                StatusCode::OK,
                [
                    ("x-upload-complete", "true".to_owned()),
                    ("x-upload-offset", metadata.len().to_string()),
                    ("x-content-sha256", expected_hash.to_owned()),
                ],
                Body::empty(),
            );
        }
        response_with_headers(
            StatusCode::NOT_FOUND,
            [("x-upload-offset", "0".to_owned())],
            Body::empty(),
        )
    }

    /// Cancels a resumable upload without touching a completed target.
    ///
    /// # Errors
    ///
    /// Returns a stable client error for malformed headers and unsafe paths.
    pub async fn cancel_upload(
        &self,
        query: FileQuery,
        headers: &HeaderMap,
    ) -> Result<Response<Body>, FileError> {
        let (root, path) = required_root_path(query)?;
        let upload_id = required_upload_id(headers)?;
        let target = self.resolve_upload_target(&root, &path).await?;
        let _ = tokio::fs::remove_file(resumable_path(&target, upload_id)).await;
        Ok(StatusCode::NO_CONTENT.into_response())
    }

    /// Streams one simple or resumable upload into its final scoped path.
    ///
    /// # Errors
    ///
    /// Returns stable validation/integrity errors and never publishes partial
    /// data as the target file.
    pub async fn upload(
        &self,
        query: FileQuery,
        headers: &HeaderMap,
        body: Body,
    ) -> Result<Response<Body>, FileError> {
        self.upload_with_commit_guard(query, headers, body, None)
            .await
    }

    /// Streams one V2 upload and revalidates its authorization immediately before publish.
    ///
    /// # Errors
    ///
    /// Returns the same transfer errors as [`Self::upload`] and rejects publication when the
    /// authenticated capability was revoked or expired while bytes were in flight.
    pub(crate) async fn upload_authorized(
        &self,
        query: FileQuery,
        headers: &HeaderMap,
        body: Body,
        guard: &UploadCommitGuard,
    ) -> Result<Response<Body>, FileError> {
        self.upload_with_commit_guard(query, headers, body, Some(guard))
            .await
    }

    async fn upload_with_commit_guard(
        &self,
        query: FileQuery,
        headers: &HeaderMap,
        body: Body,
        guard: Option<&UploadCommitGuard>,
    ) -> Result<Response<Body>, FileError> {
        let (root, path) = required_root_path(query)?;
        let expected_hash = string_header(headers, "x-content-sha256")
            .filter(|value| valid_sha256(value))
            .ok_or_else(|| client(StatusCode::BAD_REQUEST, "valid_x_content_sha256_required"))?;
        let content_length = content_length(headers)?;
        if content_length > self.max_transfer_bytes {
            return Err(client(StatusCode::PAYLOAD_TOO_LARGE, "file_too_large"));
        }
        let upload_id = string_header(headers, "x-upload-id");
        let content_range = string_header(headers, "content-range");
        if upload_id.is_some() || content_range.is_some() {
            let upload_id = required_upload_id(headers)?;
            let range = parse_content_range(
                content_range
                    .ok_or_else(|| client(StatusCode::BAD_REQUEST, "content_range_required"))?,
            )?;
            return self
                .upload_chunk(
                    &root,
                    &path,
                    upload_id,
                    expected_hash,
                    content_length,
                    range,
                    overwrite(headers),
                    body,
                    guard,
                )
                .await;
        }
        self.upload_complete(
            SimpleUpload {
                root: &root,
                path: &path,
                expected_hash,
                content_length,
                overwrite: overwrite(headers),
            },
            body,
            guard,
        )
        .await
    }

    async fn serve_file(
        &self,
        path: &Path,
        headers: &HeaderMap,
        head_only: bool,
        inline: bool,
    ) -> Result<Response<Body>, FileError> {
        let metadata = tokio::fs::metadata(path).await?;
        if !metadata.is_file() {
            return Err(client(StatusCode::BAD_REQUEST, "not_a_regular_file"));
        }
        if !inline && metadata.len() > self.max_transfer_bytes {
            return Err(client(StatusCode::PAYLOAD_TOO_LARGE, "file_too_large"));
        }
        let range = parse_range(headers.get(header::RANGE), metadata.len())?;
        let mut response = Response::builder()
            .status(if range.is_some() {
                StatusCode::PARTIAL_CONTENT
            } else {
                StatusCode::OK
            })
            .header(header::ACCEPT_RANGES, "bytes")
            .header(header::CONTENT_TYPE, content_type(path))
            .header(
                header::CONTENT_DISPOSITION,
                format!(
                    "{}; filename*=UTF-8''{}",
                    if inline { "inline" } else { "attachment" },
                    utf8_percent_encode(
                        path.file_name()
                            .and_then(|name| name.to_str())
                            .unwrap_or("file"),
                        NON_ALPHANUMERIC
                    )
                ),
            )
            .header(header::CACHE_CONTROL, "private, no-store")
            .header("x-content-type-options", "nosniff");
        if inline {
            response = response.header("content-security-policy", "default-src 'none'; sandbox");
        }
        response = response.header("x-content-sha256", hash_file(path).await?);
        let (start, length) = range.as_ref().map_or((0, metadata.len()), |range| {
            (range.start, range.end - range.start + 1)
        });
        response = response.header(header::CONTENT_LENGTH, length.to_string());
        if let Some(range) = range {
            response = response.header(
                header::CONTENT_RANGE,
                format!("bytes {}-{}/{}", range.start, range.end, metadata.len()),
            );
        }
        if head_only {
            return response
                .body(Body::empty())
                .map_err(|_| client(StatusCode::INTERNAL_SERVER_ERROR, "response_failed"));
        }
        let mut file = File::open(path).await?;
        tokio::io::AsyncSeekExt::seek(&mut file, std::io::SeekFrom::Start(start)).await?;
        let body = Body::from_stream(ReaderStream::new(file.take(length)));
        response
            .body(body)
            .map_err(|_| client(StatusCode::INTERNAL_SERVER_ERROR, "response_failed"))
    }

    async fn upload_complete(
        &self,
        upload: SimpleUpload<'_>,
        body: Body,
        guard: Option<&UploadCommitGuard>,
    ) -> Result<Response<Body>, FileError> {
        let target = self.resolve_upload_target(upload.root, upload.path).await?;
        let existed = tokio::fs::symlink_metadata(&target).await.is_ok();
        if existed && !upload.overwrite {
            return Err(client(StatusCode::CONFLICT, "target_exists"));
        }
        let temporary = match guard.and_then(|guard| guard.temporary_upload_id.as_deref()) {
            Some(upload_id) => resumable_path(&target, upload_id),
            None => temporary_upload_path(&target)?,
        };
        let result = async {
            let file = OpenOptions::new()
                .create_new(true)
                .write(true)
                .mode(0o600)
                .open(&temporary)
                .await?;
            stream_body(body, file, upload.content_length).await?;
            let actual_hash = hash_file(&temporary).await?;
            if actual_hash != upload.expected_hash {
                return Err(client(StatusCode::UNPROCESSABLE_ENTITY, "sha256_mismatch"));
            }
            if let Some(guard) = guard {
                guard.authorize().await?;
            }
            self.publish_completed_upload(CompletedUpload {
                root_id: upload.root,
                relative_path: upload.path,
                temporary: &temporary,
                target: &target,
                sha256: &actual_hash,
                bytes: upload.content_length,
                overwrite: upload.overwrite,
            })
            .await?;
            json_response(
                if existed {
                    StatusCode::OK
                } else {
                    StatusCode::CREATED
                },
                &json!({"ok": true, "bytes": upload.content_length, "sha256": actual_hash}),
            )
        }
        .await;
        let _ = tokio::fs::remove_file(&temporary).await;
        result
    }

    #[allow(clippy::too_many_arguments)]
    async fn upload_chunk(
        &self,
        root: &str,
        path: &str,
        upload_id: &str,
        expected_hash: &str,
        content_length: u64,
        range: ContentRange,
        overwrite: bool,
        body: Body,
        guard: Option<&UploadCommitGuard>,
    ) -> Result<Response<Body>, FileError> {
        if range.end - range.start + 1 != content_length {
            return Err(client(
                StatusCode::BAD_REQUEST,
                "content_range_length_mismatch",
            ));
        }
        if range.total > self.max_transfer_bytes {
            return Err(client(StatusCode::PAYLOAD_TOO_LARGE, "file_too_large"));
        }
        let target = self.resolve_upload_target(root, path).await?;
        let temporary = resumable_path(&target, upload_id);
        let existed = tokio::fs::symlink_metadata(&target).await.is_ok();
        if range.start == 0 && existed && !overwrite {
            return Err(client(StatusCode::CONFLICT, "target_exists"));
        }
        let offset = match tokio::fs::symlink_metadata(&temporary).await {
            Ok(metadata) if metadata.is_file() && !metadata.file_type().is_symlink() => {
                metadata.len()
            }
            Ok(_) => return Err(client(StatusCode::CONFLICT, "invalid_upload_state")),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => 0,
            Err(error) => return Err(error.into()),
        };
        if offset != range.start {
            return response_with_headers(
                StatusCode::CONFLICT,
                [("x-upload-offset", offset.to_string())],
                Body::from(
                    json!({"error": "upload_offset_mismatch", "offset": offset}).to_string(),
                ),
            );
        }
        let file = if range.start == 0 {
            OpenOptions::new()
                .create_new(true)
                .write(true)
                .mode(0o600)
                .open(&temporary)
                .await?
        } else {
            OpenOptions::new().append(true).open(&temporary).await?
        };
        stream_body(body, file, content_length).await?;
        let next_offset = range.end + 1;
        if next_offset < range.total {
            return response_with_headers(
                StatusCode::PERMANENT_REDIRECT,
                [("x-upload-offset", next_offset.to_string())],
                Body::empty(),
            );
        }
        if next_offset != range.total {
            return Err(client(StatusCode::BAD_REQUEST, "invalid_content_range"));
        }
        let actual_hash = hash_file(&temporary).await?;
        if actual_hash != expected_hash {
            let _ = tokio::fs::remove_file(&temporary).await;
            return Err(client(StatusCode::UNPROCESSABLE_ENTITY, "sha256_mismatch"));
        }
        if !overwrite && tokio::fs::symlink_metadata(&target).await.is_ok() {
            return Err(client(StatusCode::CONFLICT, "target_exists"));
        }
        if let Some(guard) = guard {
            guard.authorize().await?;
        }
        self.publish_completed_upload(CompletedUpload {
            root_id: root,
            relative_path: path,
            temporary: &temporary,
            target: &target,
            sha256: &actual_hash,
            bytes: range.total,
            overwrite,
        })
        .await?;
        json_response(
            if existed {
                StatusCode::OK
            } else {
                StatusCode::CREATED
            },
            &json!({"ok": true, "bytes": range.total, "sha256": actual_hash}),
        )
    }

    async fn resolve_existing(
        &self,
        root_id: &str,
        relative_path: &str,
    ) -> Result<PathBuf, FileError> {
        let root = self.root(root_id)?;
        if relative_path.is_empty() || relative_path.contains('\0') {
            return Err(client(StatusCode::BAD_REQUEST, "invalid_path"));
        }
        let requested = Path::new(relative_path);
        let candidate = if requested.is_absolute() {
            self.readable_preview_path(requested)
        } else {
            root.join(requested)
        };
        let canonical = tokio::fs::canonicalize(candidate)
            .await
            .map_err(|error| map_not_found(error, "file_not_found"))?;
        let metadata = tokio::fs::metadata(&canonical).await?;
        if !metadata.is_file() {
            return Err(client(StatusCode::BAD_REQUEST, "not_a_regular_file"));
        }
        Ok(canonical)
    }

    async fn resolve_host_preview(&self, path: &str) -> Result<PathBuf, FileError> {
        if path.len() > 16_384 || path.contains('\0') || !Path::new(path).is_absolute() {
            return Err(client(StatusCode::BAD_REQUEST, "invalid_absolute_path"));
        }
        let reported = normalize_absolute_path(Path::new(path));
        tokio::fs::canonicalize(self.readable_preview_path(&reported))
            .await
            .map_err(|error| map_not_found(error, "file_not_found"))
    }

    fn readable_preview_path(&self, reported: &Path) -> PathBuf {
        let normalized = normalize_absolute_path(reported);
        for mapping in self.preview_path_mappings.iter() {
            let Ok(relative) = normalized.strip_prefix(&mapping.reported_root) else {
                continue;
            };
            return mapping.readable_root.join(relative);
        }
        normalized
    }

    async fn resolve_upload_target(&self, root_id: &str, path: &str) -> Result<PathBuf, FileError> {
        let root = self.root(root_id)?;
        if path.is_empty() || path.contains('\0') {
            return Err(client(StatusCode::BAD_REQUEST, "invalid_path"));
        }
        let requested = Path::new(path);
        let candidate = if requested.is_absolute() {
            requested.to_path_buf()
        } else {
            root.join(requested)
        };
        self.ensure_managed_attachment_parent(root_id, path).await?;
        let parent = candidate
            .parent()
            .ok_or_else(|| client(StatusCode::BAD_REQUEST, "invalid_path"))?;
        let canonical_parent = tokio::fs::canonicalize(parent)
            .await
            .map_err(|error| map_not_found(error, "parent_not_found"))?;
        let name = candidate
            .file_name()
            .ok_or_else(|| client(StatusCode::BAD_REQUEST, "invalid_path"))?;
        Ok(canonical_parent.join(name))
    }

    async fn ensure_managed_attachment_parent(
        &self,
        root_id: &str,
        relative_path: &str,
    ) -> Result<(), FileError> {
        let Some(managed) = self.managed_attachment_path(root_id, relative_path)? else {
            return Ok(());
        };
        let Some(configured) = self.managed_attachments.as_ref() else {
            return Ok(());
        };
        let session = configured.root.join("sessions").join(managed.thread_id);
        let files = session.join("files");
        tokio::fs::create_dir_all(&files).await?;
        set_private_directory(&configured.root.join("sessions")).await?;
        set_private_directory(&session).await?;
        set_private_directory(&files).await?;
        Ok(())
    }

    async fn publish_completed_upload(&self, upload: CompletedUpload<'_>) -> Result<(), FileError> {
        let Some(_managed_path) =
            self.managed_attachment_path(upload.root_id, upload.relative_path)?
        else {
            return publish_upload(upload.temporary, upload.target, upload.overwrite).await;
        };
        let configured = self.managed_attachments.as_ref().ok_or_else(|| {
            client(
                StatusCode::INTERNAL_SERVER_ERROR,
                "managed_attachment_root_missing",
            )
        })?;
        let shard = configured
            .root
            .join("blobs/sha256")
            .join(&upload.sha256[..2]);
        tokio::fs::create_dir_all(&shard).await?;
        set_private_directory(&configured.root.join("blobs")).await?;
        set_private_directory(&configured.root.join("blobs/sha256")).await?;
        set_private_directory(&shard).await?;
        let blob = shard.join(upload.sha256);
        match tokio::fs::hard_link(upload.temporary, &blob).await {
            Ok(()) => {
                tokio::fs::remove_file(upload.temporary).await?;
            }
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {
                let metadata = tokio::fs::metadata(&blob).await?;
                if !metadata.is_file()
                    || metadata.len() != upload.bytes
                    || hash_file(&blob).await? != upload.sha256
                {
                    return Err(client(StatusCode::CONFLICT, "content_address_collision"));
                }
                tokio::fs::remove_file(upload.temporary).await?;
            }
            Err(error) => return Err(error.into()),
        }
        if upload.overwrite {
            let _ = tokio::fs::remove_file(upload.target).await;
        }
        tokio::fs::hard_link(&blob, upload.target)
            .await
            .map_err(|error| {
                if error.kind() == std::io::ErrorKind::AlreadyExists {
                    client(StatusCode::CONFLICT, "target_exists")
                } else {
                    error.into()
                }
            })?;
        if let Err(error) = self
            .record_managed_attachment(
                upload.root_id,
                upload.relative_path,
                upload.sha256,
                upload.bytes,
            )
            .await
        {
            let _ = tokio::fs::remove_file(upload.target).await;
            return Err(error);
        }
        Ok(())
    }

    async fn record_managed_attachment(
        &self,
        root_id: &str,
        relative_path: &str,
        sha256: &str,
        bytes: u64,
    ) -> Result<(), FileError> {
        let Some(managed_path) = self.managed_attachment_path(root_id, relative_path)? else {
            return Ok(());
        };
        let configured = self.managed_attachments.as_ref().ok_or_else(|| {
            client(
                StatusCode::INTERNAL_SERVER_ERROR,
                "managed_attachment_root_missing",
            )
        })?;
        let _guard = self.managed_manifest_lock.lock().await;
        let session = configured
            .root
            .join("sessions")
            .join(managed_path.thread_id);
        let manifest_path = session.join("manifest.json");
        let mut manifest = match tokio::fs::read(&manifest_path).await {
            Ok(bytes) => serde_json::from_slice::<AttachmentManifest>(&bytes)?,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => AttachmentManifest {
                version: 1,
                thread_id: managed_path.thread_id.to_owned(),
                attachments: Vec::new(),
            },
            Err(error) => return Err(error.into()),
        };
        if manifest.version != 1 || manifest.thread_id != managed_path.thread_id {
            return Err(client(StatusCode::CONFLICT, "invalid_attachment_manifest"));
        }
        let path = format!("files/{}", managed_path.file_name);
        if !manifest.attachments.iter().any(|entry| entry.path == path) {
            manifest.attachments.push(AttachmentManifestEntry {
                path,
                name: managed_path.file_name.to_owned(),
                sha256: sha256.to_owned(),
                bytes,
                content_type: content_type(Path::new(managed_path.file_name)).to_owned(),
                created_at_unix_ms: now_unix_ms(),
            });
            manifest
                .attachments
                .sort_by(|left, right| left.path.cmp(&right.path));
        }
        persist_attachment_manifest(&manifest_path, &manifest).await
    }

    fn managed_attachment_path<'a>(
        &self,
        root_id: &str,
        relative_path: &'a str,
    ) -> Result<Option<ManagedAttachmentPath<'a>>, FileError> {
        let Some(configured) = self.managed_attachments.as_ref() else {
            return Ok(None);
        };
        if configured.root_id != root_id {
            return Ok(None);
        }
        let mut components = Path::new(relative_path).components();
        let Some(Component::Normal(sessions)) = components.next() else {
            return Ok(None);
        };
        if sessions != "sessions" {
            return Ok(None);
        }
        let Some(Component::Normal(thread_id)) = components.next() else {
            return Err(client(
                StatusCode::BAD_REQUEST,
                "invalid_managed_attachment_path",
            ));
        };
        let Some(Component::Normal(files)) = components.next() else {
            return Err(client(
                StatusCode::BAD_REQUEST,
                "invalid_managed_attachment_path",
            ));
        };
        let Some(Component::Normal(file_name)) = components.next() else {
            return Err(client(
                StatusCode::BAD_REQUEST,
                "invalid_managed_attachment_path",
            ));
        };
        if components.next().is_some() || files != "files" {
            return Err(client(
                StatusCode::BAD_REQUEST,
                "invalid_managed_attachment_path",
            ));
        }
        let thread_id = thread_id
            .to_str()
            .filter(|value| valid_managed_segment(value, 160))
            .ok_or_else(|| client(StatusCode::BAD_REQUEST, "invalid_managed_attachment_path"))?;
        let file_name = file_name
            .to_str()
            .filter(|value| valid_managed_file_name(value))
            .ok_or_else(|| client(StatusCode::BAD_REQUEST, "invalid_managed_attachment_path"))?;
        Ok(Some(ManagedAttachmentPath {
            thread_id,
            file_name,
        }))
    }

    fn root(&self, root_id: &str) -> Result<&Path, FileError> {
        self.roots
            .get(root_id)
            .map(PathBuf::as_path)
            .ok_or_else(|| client(StatusCode::NOT_FOUND, "unknown_root"))
    }
}

impl IntoResponse for FileError {
    fn into_response(self) -> Response<Body> {
        let (status, code) = match self {
            Self::Client { status, code } => (status, code),
            Self::Io(_) | Self::Json(_) => {
                (StatusCode::INTERNAL_SERVER_ERROR, "file_operation_failed")
            }
        };
        (status, axum::Json(json!({"error": code}))).into_response()
    }
}

async fn stream_body(body: Body, mut file: File, expected: u64) -> Result<(), FileError> {
    let mut bytes = 0_u64;
    let mut stream = body.into_data_stream();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(std::io::Error::other)?;
        bytes = bytes.saturating_add(u64::try_from(chunk.len()).unwrap_or(u64::MAX));
        if bytes > expected {
            return Err(client(StatusCode::PAYLOAD_TOO_LARGE, "file_too_large"));
        }
        file.write_all(&chunk).await?;
    }
    file.flush().await?;
    file.sync_all().await?;
    if bytes != expected {
        return Err(client(StatusCode::BAD_REQUEST, "content_length_mismatch"));
    }
    Ok(())
}

async fn publish_upload(temporary: &Path, target: &Path, overwrite: bool) -> Result<(), FileError> {
    if overwrite {
        tokio::fs::rename(temporary, target).await?;
        return Ok(());
    }
    tokio::fs::hard_link(temporary, target)
        .await
        .map_err(|error| {
            if error.kind() == std::io::ErrorKind::AlreadyExists {
                client(StatusCode::CONFLICT, "target_exists")
            } else {
                error.into()
            }
        })?;
    tokio::fs::remove_file(temporary).await?;
    Ok(())
}

async fn hash_file(path: &Path) -> Result<String, FileError> {
    let mut file = File::open(path).await?;
    let mut hash = Sha256::new();
    let mut buffer = vec![0_u8; 128 * 1024];
    loop {
        let read = file.read(&mut buffer).await?;
        if read == 0 {
            break;
        }
        hash.update(&buffer[..read]);
    }
    Ok(hex::encode(hash.finalize()))
}

fn parse_range(value: Option<&HeaderValue>, total: u64) -> Result<Option<ByteRange>, FileError> {
    let Some(value) = value else {
        return Ok(None);
    };
    let value = value
        .to_str()
        .map_err(|_| client(StatusCode::RANGE_NOT_SATISFIABLE, "invalid_range"))?;
    let Some(value) = value.strip_prefix("bytes=") else {
        return Err(client(StatusCode::RANGE_NOT_SATISFIABLE, "invalid_range"));
    };
    let Some((start, end)) = value.split_once('-') else {
        return Err(client(StatusCode::RANGE_NOT_SATISFIABLE, "invalid_range"));
    };
    let start = start
        .parse::<u64>()
        .map_err(|_| client(StatusCode::RANGE_NOT_SATISFIABLE, "invalid_range"))?;
    if start >= total {
        return Err(client(StatusCode::RANGE_NOT_SATISFIABLE, "invalid_range"));
    }
    let end = if end.is_empty() {
        total - 1
    } else {
        end.parse::<u64>()
            .map_err(|_| client(StatusCode::RANGE_NOT_SATISFIABLE, "invalid_range"))?
            .min(total - 1)
    };
    if end < start {
        return Err(client(StatusCode::RANGE_NOT_SATISFIABLE, "invalid_range"));
    }
    Ok(Some(ByteRange { start, end }))
}

fn parse_content_range(value: &str) -> Result<ContentRange, FileError> {
    let Some(value) = value.strip_prefix("bytes ") else {
        return Err(client(StatusCode::BAD_REQUEST, "invalid_content_range"));
    };
    let Some((range, total)) = value.split_once('/') else {
        return Err(client(StatusCode::BAD_REQUEST, "invalid_content_range"));
    };
    let Some((start, end)) = range.split_once('-') else {
        return Err(client(StatusCode::BAD_REQUEST, "invalid_content_range"));
    };
    let range = ContentRange {
        start: start
            .parse()
            .map_err(|_| client(StatusCode::BAD_REQUEST, "invalid_content_range"))?,
        end: end
            .parse()
            .map_err(|_| client(StatusCode::BAD_REQUEST, "invalid_content_range"))?,
        total: total
            .parse()
            .map_err(|_| client(StatusCode::BAD_REQUEST, "invalid_content_range"))?,
    };
    if range.start > range.end || range.end >= range.total {
        return Err(client(StatusCode::BAD_REQUEST, "invalid_content_range"));
    }
    Ok(range)
}

fn is_child(root: &Path, path: &Path) -> bool {
    path == root || path.starts_with(root)
}

fn strip_source_location(path: &Path) -> Option<PathBuf> {
    let value = path.to_str()?;
    let (without_last, last) = value.rsplit_once(':')?;
    if last.is_empty() || !last.bytes().all(|byte| byte.is_ascii_digit()) {
        return None;
    }
    let without_location = without_last
        .rsplit_once(':')
        .filter(|(_, line)| !line.is_empty() && line.bytes().all(|byte| byte.is_ascii_digit()))
        .map_or(without_last, |(path, _line)| path);
    (!without_location.is_empty()).then(|| PathBuf::from(without_location))
}

fn normalize_absolute_path(path: &Path) -> PathBuf {
    let mut normalized = PathBuf::new();
    for component in path.components() {
        match component {
            Component::CurDir => {}
            Component::ParentDir => {
                normalized.pop();
            }
            Component::RootDir => normalized.push(Path::new("/")),
            Component::Prefix(prefix) => normalized.push(prefix.as_os_str()),
            Component::Normal(part) => normalized.push(part),
        }
    }
    normalized
}

fn required_root_path(query: FileQuery) -> Result<(String, String), FileError> {
    match (query.root_id, query.path) {
        (Some(root), Some(path)) => Ok((root, path)),
        _ => Err(client(StatusCode::BAD_REQUEST, "rootId_and_path_required")),
    }
}

fn valid_root_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 64
        && id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'-'))
}

fn valid_managed_segment(value: &str, max_chars: usize) -> bool {
    !value.is_empty()
        && value.len() <= max_chars
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'-'))
}

fn valid_managed_file_name(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 255
        && value != "."
        && value != ".."
        && !value.chars().any(char::is_control)
}

fn required_upload_id(headers: &HeaderMap) -> Result<&str, FileError> {
    string_header(headers, "x-upload-id")
        .filter(|value| {
            (16..=80).contains(&value.len())
                && value
                    .bytes()
                    .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'-'))
        })
        .ok_or_else(|| client(StatusCode::BAD_REQUEST, "valid_x_upload_id_required"))
}

fn content_length(headers: &HeaderMap) -> Result<u64, FileError> {
    string_header(headers, "content-length")
        .and_then(|value| value.parse().ok())
        .ok_or_else(|| client(StatusCode::LENGTH_REQUIRED, "content_length_required"))
}

fn string_header<'a>(headers: &'a HeaderMap, name: &str) -> Option<&'a str> {
    headers.get(name)?.to_str().ok()
}

fn overwrite(headers: &HeaderMap) -> bool {
    string_header(headers, "x-codex-overwrite") == Some("true")
}

fn valid_sha256(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|byte| byte.is_ascii_hexdigit() && !byte.is_ascii_uppercase())
}

fn resumable_path(target: &Path, upload_id: &str) -> PathBuf {
    target.with_file_name(format!(
        ".{}.upload-{upload_id}",
        target
            .file_name()
            .and_then(|value| value.to_str())
            .unwrap_or("file")
    ))
}

fn temporary_upload_path(target: &Path) -> Result<PathBuf, FileError> {
    let mut random = [0_u8; 8];
    OsRng
        .try_fill_bytes(&mut random)
        .map_err(|_| client(StatusCode::INTERNAL_SERVER_ERROR, "randomness_unavailable"))?;
    Ok(target.with_file_name(format!(
        ".{}.upload-{}",
        target
            .file_name()
            .and_then(|value| value.to_str())
            .unwrap_or("file"),
        hex::encode(random)
    )))
}

fn content_type(path: &Path) -> &'static str {
    match path
        .extension()
        .and_then(|extension| extension.to_str())
        .unwrap_or("")
        .to_ascii_lowercase()
        .as_str()
    {
        "md" | "markdown" | "mdown" | "mkd" => "text/markdown; charset=utf-8",
        "html" | "htm" => "text/html; charset=utf-8",
        "txt" | "rs" | "ts" | "tsx" | "js" | "jsx" | "json" | "toml" | "yaml" | "yml" | "css"
        | "scss" | "sh" | "fish" | "py" | "go" | "java" | "kt" | "kts" | "swift" | "c" | "h"
        | "cc" | "cpp" | "hpp" | "diff" | "patch" => "text/plain; charset=utf-8",
        _ => mime_guess::from_path(path)
            .first_raw()
            .unwrap_or("application/octet-stream"),
    }
}

async fn set_private_directory(path: &Path) -> Result<(), FileError> {
    tokio::fs::set_permissions(path, std::fs::Permissions::from_mode(0o700)).await?;
    Ok(())
}

async fn persist_attachment_manifest(
    path: &Path,
    manifest: &AttachmentManifest,
) -> Result<(), FileError> {
    let mut payload = serde_json::to_vec_pretty(manifest)?;
    payload.push(b'\n');
    persist_private_file(path, &payload).await
}

async fn persist_private_file(path: &Path, payload: &[u8]) -> Result<(), FileError> {
    let mut random = [0_u8; 8];
    OsRng
        .try_fill_bytes(&mut random)
        .map_err(|_| client(StatusCode::INTERNAL_SERVER_ERROR, "randomness_unavailable"))?;
    let base_name = path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("private");
    let temporary = path.with_file_name(format!(".{base_name}-{}.tmp", hex::encode(random)));
    let result = async {
        let mut file = OpenOptions::new()
            .create_new(true)
            .write(true)
            .mode(0o600)
            .open(&temporary)
            .await?;
        file.write_all(payload).await?;
        file.flush().await?;
        file.sync_all().await?;
        tokio::fs::rename(&temporary, path).await?;
        Ok::<(), FileError>(())
    }
    .await;
    let _ = tokio::fs::remove_file(&temporary).await;
    result
}

async fn remove_unreferenced_blobs(
    root: &Path,
    now_unix_ms: u64,
    retention_ms: u64,
) -> Result<(), FileError> {
    let mut shards = match tokio::fs::read_dir(root).await {
        Ok(entries) => entries,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(error) => return Err(error.into()),
    };
    while let Some(shard) = shards.next_entry().await? {
        if !shard.file_type().await?.is_dir() {
            continue;
        }
        let mut blobs = tokio::fs::read_dir(shard.path()).await?;
        while let Some(blob) = blobs.next_entry().await? {
            let metadata = tokio::fs::symlink_metadata(blob.path()).await?;
            if !metadata.is_file() || metadata.nlink() != 1 {
                continue;
            }
            let modified = metadata
                .modified()
                .ok()
                .and_then(|value| value.duration_since(UNIX_EPOCH).ok())
                .map(|value| u64::try_from(value.as_millis()).unwrap_or(u64::MAX));
            if modified.is_some_and(|modified| now_unix_ms.saturating_sub(modified) >= retention_ms)
            {
                tokio::fs::remove_file(blob.path()).await?;
            }
        }
        if tokio::fs::read_dir(shard.path())
            .await?
            .next_entry()
            .await?
            .is_none()
        {
            tokio::fs::remove_dir(shard.path()).await?;
        }
    }
    Ok(())
}

fn now_unix_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |duration| {
            u64::try_from(duration.as_millis()).unwrap_or(u64::MAX)
        })
}

fn client(status: StatusCode, code: &'static str) -> FileError {
    FileError::Client { status, code }
}

fn map_not_found(error: std::io::Error, code: &'static str) -> FileError {
    if error.kind() == std::io::ErrorKind::NotFound {
        client(StatusCode::NOT_FOUND, code)
    } else {
        error.into()
    }
}

fn response_with_headers<const N: usize>(
    status: StatusCode,
    headers: [(&str, String); N],
    body: Body,
) -> Result<Response<Body>, FileError> {
    let mut response = Response::builder().status(status);
    for (name, value) in headers {
        response = response.header(name, value);
    }
    response
        .body(body)
        .map_err(|_| client(StatusCode::INTERNAL_SERVER_ERROR, "response_failed"))
}

fn json_response(
    status: StatusCode,
    value: &serde_json::Value,
) -> Result<Response<Body>, FileError> {
    response_with_headers(
        status,
        [("content-type", "application/json".to_owned())],
        Body::from(format!("{value}\n")),
    )
}

async fn load_preview_registry(path: Option<&Path>) -> Result<HashSet<PathBuf>, FileError> {
    let Some(path) = path else {
        return Ok(HashSet::new());
    };
    let raw = match tokio::fs::read(path).await {
        Ok(raw) => raw,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(HashSet::new()),
        Err(error) => return Err(error.into()),
    };
    let parsed: PreviewRegistry = match serde_json::from_slice::<PreviewRegistry>(&raw) {
        Ok(parsed) if parsed.version == 1 => parsed,
        _ => return Ok(HashSet::new()),
    };
    let mut observed = HashSet::new();
    for candidate in parsed
        .files
        .into_iter()
        .rev()
        .take(MAX_OBSERVED_PREVIEW_FILES)
    {
        if candidate.is_absolute()
            && let Ok(canonical) = tokio::fs::canonicalize(candidate).await
        {
            observed.insert(canonical);
        }
    }
    Ok(observed)
}

async fn persist_preview_registry(path: &Path, files: &[PathBuf]) -> Result<(), FileError> {
    let parent = path
        .parent()
        .ok_or_else(|| client(StatusCode::INTERNAL_SERVER_ERROR, "invalid_registry_path"))?;
    tokio::fs::create_dir_all(parent).await?;
    let temporary = path.with_extension(format!("tmp-{}", std::process::id()));
    let bytes = serde_json::to_vec(&PreviewRegistryRef { version: 1, files })?;
    let mut file = OpenOptions::new()
        .create(true)
        .truncate(true)
        .write(true)
        .mode(0o600)
        .open(&temporary)
        .await?;
    file.write_all(&bytes).await?;
    file.write_all(b"\n").await?;
    file.sync_all().await?;
    tokio::fs::rename(temporary, path).await?;
    Ok(())
}
