use std::{
    collections::HashMap,
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
    time::{SystemTime, UNIX_EPOCH},
};

use axum::{
    body::Body,
    http::{HeaderMap, Response, StatusCode, header},
    response::IntoResponse,
};
use base64::{Engine as _, engine::general_purpose};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value, json};
use sha2::{Digest, Sha256};
use tokio::io::AsyncWriteExt;

pub const MAX_INLINE_TEXT_BYTES: usize = 16 * 1024;
pub const MAX_PROJECTED_ITEM_BYTES: usize = 32 * 1024;
pub const MAX_PROJECTED_TURN_BYTES: usize = 96 * 1024;
pub const MAX_PROJECTED_PAGE_BYTES: usize = 256 * 1024;
const MAX_PROJECTED_NOTIFICATION_BYTES: usize = 96 * 1024;
const MAX_COLLECTION_ENTRIES: usize = 128;
const MAX_CHUNK_BYTES: usize = 256 * 1024;
const MAX_MEMORY_BYTES: usize = 64 * 1024 * 1024;
const MAX_PENDING_WRITES: usize = 64;
const MAX_DISK_BYTES: u64 = 1024 * 1024 * 1024;
const PRUNE_INTERVAL: std::time::Duration = std::time::Duration::from_secs(10);
const MAX_INLINE_ASSET_BYTES: usize = 32 * 1024 * 1024;
const APPROX_BYTES_PER_TOKEN: usize = 4;

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ContentReference {
    pub id: String,
    pub byte_length: usize,
    pub content_type: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub encoding: Option<&'static str>,
}

#[derive(Clone)]
pub struct PrivateContentService {
    directory: PathBuf,
    fallback_directories: Arc<[PathBuf]>,
    memory: Arc<Mutex<MemoryCache>>,
    writes: tokio::sync::mpsc::Sender<PersistRequest>,
}

#[derive(Clone)]
pub struct ContentProjector {
    content: Arc<PrivateContentService>,
}

#[derive(Default)]
struct MemoryCache {
    values: HashMap<String, CachedContent>,
    bytes: usize,
    clock: u64,
}

#[derive(Clone)]
struct CachedContent {
    bytes: Arc<[u8]>,
    content_type: String,
    last_access: u64,
}

struct PersistRequest {
    id: String,
    bytes: Arc<[u8]>,
    content_type: String,
}

#[derive(Debug, thiserror::Error)]
pub enum ContentError {
    #[error("content_not_found")]
    NotFound,
    #[error("invalid_range")]
    InvalidRange,
    #[error(transparent)]
    Io(#[from] std::io::Error),
    #[error(transparent)]
    Json(#[from] serde_json::Error),
}

#[derive(Clone, Copy, Debug, Deserialize)]
pub struct ContentQuery {
    pub offset: Option<usize>,
    pub limit: Option<usize>,
}

struct RequestedRange {
    start: usize,
    end: usize,
    partial: bool,
}

impl PrivateContentService {
    /// Opens the private content-addressed store and its single persistence
    /// worker. Writes are serialized off the sync lane.
    #[must_use]
    pub fn open(directory: PathBuf) -> Arc<Self> {
        Self::open_with_fallbacks(directory, Vec::new())
    }

    /// Opens the writable content store with read-only compatibility roots.
    ///
    /// Older companion implementations minted the same content-addressed
    /// references in a different cache directory. A client can retain those
    /// references across a companion migration, so a miss in the new store
    /// must fall back to the legacy CAS instead of turning valid media into a
    /// permanent 404.
    #[must_use]
    pub fn open_with_fallbacks(
        directory: PathBuf,
        fallback_directories: Vec<PathBuf>,
    ) -> Arc<Self> {
        let (writes, receiver) = tokio::sync::mpsc::channel(MAX_PENDING_WRITES);
        let memory = Arc::new(Mutex::new(MemoryCache::default()));
        tokio::spawn(persist_worker(directory.clone(), receiver, memory.clone()));
        Arc::new(Self {
            directory,
            fallback_directories: fallback_directories.into(),
            memory,
            writes,
        })
    }

    #[must_use]
    pub fn put_text(&self, value: &str, content_type: &str) -> ContentReference {
        let mut reference = self.put_bytes(value.as_bytes(), content_type);
        reference.encoding = Some("utf-8");
        reference
    }

    #[must_use]
    pub fn put_json(&self, value: &Value) -> ContentReference {
        let bytes = serde_json::to_vec(value).unwrap_or_default();
        let mut reference = self.put_bytes(&bytes, "application/json; charset=utf-8");
        reference.encoding = Some("utf-8");
        reference
    }

    #[must_use]
    pub fn put_bytes(&self, bytes: &[u8], content_type: &str) -> ContentReference {
        let id = hex::encode(Sha256::digest(bytes));
        let bytes: Arc<[u8]> = Arc::from(bytes);
        remember(&self.memory, &id, bytes.clone(), content_type);
        if self
            .writes
            .try_send(PersistRequest {
                id: id.clone(),
                bytes: bytes.clone(),
                content_type: content_type.to_owned(),
            })
            .is_err()
        {
            tracing::warn!(
                id,
                "private content persistence queue is full; keeping memory copy"
            );
        }
        ContentReference {
            id,
            byte_length: bytes.len(),
            content_type: content_type.to_owned(),
            encoding: None,
        }
    }

    /// Serves one bounded private chunk. UTF-8 boundaries are repaired so a
    /// client can concatenate independently requested chunks safely.
    ///
    /// # Errors
    ///
    /// Returns not-found, invalid-range, or host I/O errors.
    pub async fn serve(
        &self,
        digest: &str,
        query: ContentQuery,
        headers: &HeaderMap,
        head_only: bool,
    ) -> Result<Response<Body>, ContentError> {
        if digest.len() != 64 || !digest.bytes().all(|byte| byte.is_ascii_hexdigit()) {
            return Err(ContentError::NotFound);
        }
        let content = self.load(digest).await?.ok_or(ContentError::NotFound)?;
        let mut range = requested_range(query, headers, content.bytes.len())?;
        if content.content_type.contains("charset=utf-8") {
            align_utf8_range(&content.bytes, &mut range);
        }
        let body = &content.bytes[range.start..range.end];
        let response = Response::builder()
            .status(if range.partial {
                StatusCode::PARTIAL_CONTENT
            } else {
                StatusCode::OK
            })
            .header(header::CONTENT_TYPE, content.content_type)
            .header(header::CONTENT_LENGTH, body.len())
            .header(header::ACCEPT_RANGES, "bytes")
            .header(
                header::CONTENT_RANGE,
                format!(
                    "bytes {}-{}/{}",
                    range.start,
                    range.end.saturating_sub(1),
                    content.bytes.len()
                ),
            )
            .header(header::CACHE_CONTROL, "private, no-store")
            .header("content-security-policy", "default-src 'none'; sandbox")
            .header("x-content-type-options", "nosniff")
            .header("referrer-policy", "no-referrer");
        response
            .body(if head_only {
                Body::empty()
            } else {
                Body::from(body.to_vec())
            })
            .map_err(|_| ContentError::InvalidRange)
    }

    async fn load(&self, id: &str) -> Result<Option<CachedContent>, ContentError> {
        if let Some(value) = cached(&self.memory, id) {
            return Ok(Some(value));
        }
        let mut directories = Vec::with_capacity(1 + self.fallback_directories.len());
        directories.push(self.directory.as_path());
        directories.extend(self.fallback_directories.iter().map(PathBuf::as_path));
        for directory in directories {
            if let Some(content) = load_from_directory(directory, id).await? {
                remember(
                    &self.memory,
                    id,
                    content.bytes.clone(),
                    &content.content_type,
                );
                return Ok(Some(content));
            }
        }
        Ok(None)
    }
}

async fn load_from_directory(
    directory: &Path,
    id: &str,
) -> Result<Option<CachedContent>, std::io::Error> {
    let path = directory.join(id);
    let bytes = match tokio::fs::read(&path).await {
        Ok(bytes) => bytes,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(error),
    };
    let metadata = tokio::fs::read_to_string(path.with_extension("meta.json"))
        .await
        .unwrap_or_default();
    let content_type = serde_json::from_str::<Value>(&metadata)
        .ok()
        .and_then(|value| value["contentType"].as_str().map(ToOwned::to_owned))
        .unwrap_or_else(|| "text/plain; charset=utf-8".to_owned());
    let bytes: Arc<[u8]> = Arc::from(bytes);
    Ok(Some(CachedContent {
        bytes,
        content_type,
        last_access: unix_time_ms(),
    }))
}

impl ContentProjector {
    #[must_use]
    pub fn new(content: Arc<PrivateContentService>) -> Self {
        Self { content }
    }

    #[must_use]
    pub fn project_notification(&self, payload: Value) -> Value {
        let method = payload.get("method").and_then(Value::as_str).unwrap_or("");
        let Some(params) = payload.get("params").cloned() else {
            return payload;
        };
        let projected = match method {
            "turn/started" | "turn/completed" => {
                project_nested(params, "turn", |value| self.project_turn(value))
            }
            "item/started" | "item/completed" | "item/updated" => {
                project_nested(params, "item", |value| self.project_item(value))
            }
            "thread/started" => {
                project_nested(params, "thread", |value| self.project_thread(value))
            }
            _ => self.project_bounded(params, MAX_PROJECTED_NOTIFICATION_BYTES),
        };
        let mut envelope = payload;
        if let Some(object) = envelope.as_object_mut() {
            object.insert("params".into(), projected);
        }
        envelope
    }

    #[must_use]
    pub fn project_rpc_result(&self, method: &str, value: Value) -> Value {
        match method {
            "thread/read" | "thread/resume" => {
                project_nested(value, "thread", |thread| self.project_thread(thread))
            }
            "thread/turns/list" => project_data(value, |turn| self.project_turn(turn)),
            "thread/items/list" => project_data(value, |entry| {
                project_nested(entry, "item", |item| self.project_item(item))
            }),
            _ => value,
        }
    }

    #[must_use]
    pub fn project_item(&self, raw: Value) -> Value {
        // Attribute command output before bounded projection externalizes or
        // truncates the visible string. The app-server protocol does not
        // expose per-tool token usage, so this mirrors Codex's own bytes/4
        // approximation and deliberately remains an estimate.
        let item = self.compact_inline_images(attach_command_output_footprint(raw));
        let projected = self.project_bounded(item.clone(), MAX_PROJECTED_ITEM_BYTES);
        if encoded_len(&projected) <= MAX_PROJECTED_ITEM_BYTES {
            return projected;
        }
        let whole = self.content.put_json(&item);
        let mut minimal = scalar_fields(&item);
        for key in [
            "id",
            "type",
            "status",
            "command",
            "text",
            "aggregatedOutput",
            "codewideOutputFootprint",
            "content",
            "codewideAttachments",
            "changes",
        ] {
            if let Some(value) = item.get(key).cloned() {
                minimal.insert(key.into(), value);
            }
        }
        Self::attach_whole(
            self.project_bounded(Value::Object(minimal), MAX_PROJECTED_ITEM_BYTES),
            whole,
        )
    }

    #[must_use]
    pub fn project_turn(&self, raw: Value) -> Value {
        let Some(object) = raw.as_object() else {
            return raw;
        };
        let mut turn = object.clone();
        if let Some(items) = turn.get_mut("items").and_then(Value::as_array_mut) {
            for item in items {
                *item = self.project_item(item.take());
            }
        }
        let projected = self.project_bounded(Value::Object(turn), MAX_PROJECTED_TURN_BYTES);
        if encoded_len(&projected) <= MAX_PROJECTED_TURN_BYTES {
            return projected;
        }
        let whole = self.content.put_json(&raw);
        let mut summary = scalar_fields(&raw);
        let items = projected
            .get("items")
            .and_then(Value::as_array)
            .map(|items| summarize_turn_items(items))
            .unwrap_or_default();
        let activity = activity_summary(
            projected
                .get("items")
                .and_then(Value::as_array)
                .unwrap_or(&Vec::new()),
        );
        summary.insert("items".into(), Value::Array(items));
        summary.insert("itemsView".into(), Value::String("summary".into()));
        if let Some(activity) = activity {
            summary.insert("codewide".into(), json!({"activity": activity}));
        }
        Self::attach_whole(Value::Object(summary), whole)
    }

    #[must_use]
    pub fn project_thread(&self, raw: Value) -> Value {
        let Some(object) = raw.as_object() else {
            return raw;
        };
        let mut thread = object.clone();
        if let Some(turns) = thread.get_mut("turns").and_then(Value::as_array_mut) {
            for turn in turns {
                *turn = self.project_turn(turn.take());
            }
        }
        let projected = Value::Object(thread);
        if encoded_len(&projected) <= MAX_PROJECTED_PAGE_BYTES {
            return projected;
        }
        let whole = self.content.put_json(&raw);
        let mut bounded = scalar_fields(&raw);
        let mut retained = Vec::new();
        let turns = projected
            .get("turns")
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default();
        let mut bytes = encoded_len(&Value::Object(bounded.clone()));
        for turn in turns.into_iter().rev() {
            let turn_bytes = encoded_len(&turn) + 1;
            if !retained.is_empty() && bytes + turn_bytes > MAX_PROJECTED_PAGE_BYTES {
                break;
            }
            retained.push(turn);
            bytes += turn_bytes;
        }
        retained.reverse();
        bounded.insert("turns".into(), Value::Array(retained));
        Self::attach_whole(Value::Object(bounded), whole)
    }

    fn project_bounded(&self, value: Value, budget: usize) -> Value {
        let original = value.clone();
        let mut fields = Map::new();
        let mut projected = self.project_value(value, "", &mut fields, 0);
        if !fields.is_empty() {
            attach_content_metadata(&mut projected, fields, None);
        }
        if encoded_len(&projected) <= budget {
            projected
        } else {
            let whole = self.content.put_json(&original);
            Self::attach_whole(Value::Object(scalar_fields(&projected)), whole)
        }
    }

    fn project_value(
        &self,
        value: Value,
        pointer: &str,
        fields: &mut Map<String, Value>,
        depth: usize,
    ) -> Value {
        match value {
            Value::String(value) => {
                if value.len() <= MAX_INLINE_TEXT_BYTES {
                    return Value::String(value);
                }
                let reference = self.content.put_text(&value, content_type(pointer));
                fields.insert(pointer_or_root(pointer).into(), json!(reference));
                Value::String(bounded_preview(&value, MAX_INLINE_TEXT_BYTES))
            }
            Value::Array(values) if depth < 16 => {
                let total = values.len();
                let values = values
                    .into_iter()
                    .take(MAX_COLLECTION_ENTRIES)
                    .collect::<Vec<_>>();
                if total > values.len() {
                    fields.insert(
                        pointer_or_root(pointer).into(),
                        json!(self.content.put_json(&Value::Array(values.clone()))),
                    );
                }
                Value::Array(
                    values
                        .into_iter()
                        .enumerate()
                        .map(|(index, value)| {
                            self.project_value(
                                value,
                                &format!("{pointer}/{index}"),
                                fields,
                                depth + 1,
                            )
                        })
                        .collect(),
                )
            }
            Value::Object(object) if depth < 16 => {
                let mut projected = Map::new();
                for (index, (key, value)) in object.into_iter().enumerate() {
                    if index >= MAX_COLLECTION_ENTRIES {
                        break;
                    }
                    let child = format!("{pointer}/{}", escape_pointer(&key));
                    projected.insert(key, self.project_value(value, &child, fields, depth + 1));
                }
                Value::Object(projected)
            }
            Value::Array(_) | Value::Object(_) => {
                fields.insert(
                    pointer_or_root(pointer).into(),
                    json!(self.content.put_json(&value)),
                );
                if value.is_array() {
                    json!([])
                } else {
                    json!({})
                }
            }
            other => other,
        }
    }

    fn compact_inline_images(&self, mut value: Value) -> Value {
        let Some(object) = value.as_object_mut() else {
            return value;
        };
        compact_image_array(object.get_mut("contentItems"), &self.content);
        // Responses API custom tool outputs use `output`, while App Server
        // tool items may expose the same content blocks directly as
        // `content`. Both are binary-bearing lanes and must be materialized
        // before the generic size projector replaces their data URLs.
        compact_image_array(object.get_mut("output"), &self.content);
        compact_image_array(object.get_mut("content"), &self.content);
        if let Some(result) = object.get_mut("result").and_then(Value::as_object_mut) {
            compact_image_array(result.get_mut("content"), &self.content);
        }
        if object.get("type").and_then(Value::as_str) == Some("userMessage") {
            compact_user_images(object, &self.content);
            attach_user_message_attachments(object);
        }
        if object.get("type").and_then(Value::as_str) == Some("imageGeneration")
            && let Some(result) = object.get("result").and_then(Value::as_str)
            && let Some(reference) = store_generated_image(result, &self.content)
        {
            object.insert("result".into(), Value::String(String::new()));
            object.insert("codewideAsset".into(), asset_json(reference));
        }
        value
    }

    fn attach_whole(mut value: Value, whole: ContentReference) -> Value {
        attach_content_metadata(&mut value, Map::new(), Some(whole));
        value
    }
}

impl IntoResponse for ContentError {
    fn into_response(self) -> Response<Body> {
        let (status, code) = match self {
            Self::NotFound => (StatusCode::NOT_FOUND, "content_not_found"),
            Self::InvalidRange => (StatusCode::RANGE_NOT_SATISFIABLE, "invalid_range"),
            Self::Io(_) | Self::Json(_) => (StatusCode::INTERNAL_SERVER_ERROR, "content_failed"),
        };
        (status, axum::Json(json!({"error": code}))).into_response()
    }
}

fn project_nested<F>(mut value: Value, key: &str, project: F) -> Value
where
    F: FnOnce(Value) -> Value,
{
    if let Some(object) = value.as_object_mut()
        && let Some(child) = object.remove(key)
    {
        object.insert(key.into(), project(child));
    }
    value
}

fn project_data<F>(mut value: Value, project: F) -> Value
where
    F: Fn(Value) -> Value,
{
    if let Some(data) = value.get_mut("data").and_then(Value::as_array_mut) {
        for entry in data {
            *entry = project(entry.take());
        }
    }
    value
}

fn attach_content_metadata(
    value: &mut Value,
    fields: Map<String, Value>,
    whole: Option<ContentReference>,
) {
    let Some(object) = value.as_object_mut() else {
        return;
    };
    if fields.is_empty() && whole.is_none() {
        return;
    }
    let mut metadata = Map::from_iter([
        ("version".into(), json!(1)),
        ("fields".into(), Value::Object(fields)),
    ]);
    if let Some(whole) = whole {
        metadata.insert(
            "whole".into(),
            serde_json::to_value(whole).unwrap_or(Value::Null),
        );
    }
    object.insert("codewideContent".into(), Value::Object(metadata));
}

fn compact_image_array(value: Option<&mut Value>, content: &PrivateContentService) {
    let Some(items) = value.and_then(Value::as_array_mut) else {
        return;
    };
    for item in items {
        let Some(object) = item.as_object_mut() else {
            continue;
        };
        let kind = object.get("type").and_then(Value::as_str).unwrap_or("");
        let image_key = match kind {
            "inputImage" => Some("imageUrl"),
            "input_image" => Some("image_url"),
            _ => None,
        };
        if let Some(image_key) = image_key
            && let Some(data) = object.get(image_key).and_then(Value::as_str)
            && let Some(reference) = store_data_image(data, content)
        {
            object.insert(image_key.into(), Value::String(String::new()));
            object.insert("codewideAsset".into(), asset_json(reference));
        } else if kind == "image"
            && let Some(data) = object.get("data").and_then(Value::as_str)
        {
            let content_type = object
                .get("mimeType")
                .and_then(Value::as_str)
                .unwrap_or("image/png");
            if let Some(reference) = store_base64_image(data, content_type, content) {
                object.remove("data");
                object.insert("codewideAsset".into(), asset_json(reference));
            }
        }
    }
}

fn compact_user_images(object: &mut Map<String, Value>, content: &PrivateContentService) {
    let image_paths = object
        .get("content")
        .and_then(Value::as_array)
        .map(|parts| mentioned_image_paths(parts))
        .unwrap_or_default();
    let Some(parts) = object.get_mut("content").and_then(Value::as_array_mut) else {
        return;
    };
    let mut image_index = 0;
    for part in parts {
        let Some(part) = part.as_object_mut() else {
            continue;
        };
        if part.get("type").and_then(Value::as_str) != Some("image") {
            continue;
        }
        let Some(url) = part.get("url").and_then(Value::as_str) else {
            continue;
        };
        if !url.starts_with("data:image/") {
            continue;
        }
        if let Some(path) = image_paths.get(image_index) {
            part.remove("url");
            part.insert("type".into(), Value::String("localImage".into()));
            part.insert("path".into(), Value::String(path.clone()));
        } else if let Some(reference) = store_data_image(url, content) {
            part.insert("url".into(), Value::String(String::new()));
            part.insert("codewideAsset".into(), asset_json(reference));
        } else {
            part.insert("url".into(), Value::String(String::new()));
            part.insert(
                "codewideUnavailable".into(),
                Value::String("inline_image_without_file_reference".into()),
            );
        }
        image_index += 1;
    }
}

/// Adds a small, stable attachment index to the projected user item. Codex is
/// still the source of truth: the index is derived exclusively from the
/// persisted user-message content after inline images have been materialized.
/// Clients no longer need to retain composer state to reconstruct attachments.
fn attach_user_message_attachments(object: &mut Map<String, Value>) {
    let Some(parts) = object.get("content").and_then(Value::as_array) else {
        return;
    };
    let mut items = Vec::new();
    let mut seen = std::collections::HashSet::new();
    let mut image_index = 0_usize;
    for part in parts {
        let Some(part) = part.as_object() else {
            continue;
        };
        match part.get("type").and_then(Value::as_str).unwrap_or("") {
            "localImage" => {
                image_index += 1;
                let Some(path) = part.get("path").and_then(Value::as_str) else {
                    continue;
                };
                let name = attachment_basename(path, image_index, "Image");
                push_path_attachment(&mut items, &mut seen, "image", &name, path);
            }
            "image" => {
                image_index += 1;
                if let Some(asset) = part.get("codewideAsset") {
                    push_user_attachment(
                        &mut items,
                        &mut seen,
                        json!({
                            "kind": "image",
                            "name": format!("Image {image_index}"),
                            "source": {"type": "content", "asset": asset}
                        }),
                    );
                } else if let Some(url) = part.get("url").and_then(Value::as_str)
                    && !url.is_empty()
                {
                    push_user_attachment(
                        &mut items,
                        &mut seen,
                        json!({
                            "kind": "image",
                            "name": format!("Image {image_index}"),
                            "source": {"type": "url", "url": url}
                        }),
                    );
                }
            }
            "localAudio" => {
                let Some(path) = part.get("path").and_then(Value::as_str) else {
                    continue;
                };
                let name = attachment_basename(path, 1, "Audio");
                push_path_attachment(&mut items, &mut seen, "audio", &name, path);
            }
            "mention" => {
                let Some(path) = part.get("path").and_then(Value::as_str) else {
                    continue;
                };
                let name = part
                    .get("name")
                    .and_then(Value::as_str)
                    .filter(|name| !name.is_empty())
                    .map_or_else(|| attachment_basename(path, 1, "File"), ToOwned::to_owned);
                push_path_attachment(&mut items, &mut seen, "file", &name, path);
            }
            "text" => {
                if let Some(text) = part.get("text").and_then(Value::as_str) {
                    for (name, path) in mentioned_user_files(text) {
                        push_path_attachment(&mut items, &mut seen, "file", &name, &path);
                    }
                }
            }
            _ => {}
        }
    }
    if !items.is_empty() {
        object.insert(
            "codewideAttachments".into(),
            json!({"version": 1, "items": items}),
        );
    }
}

fn push_path_attachment(
    items: &mut Vec<Value>,
    seen: &mut std::collections::HashSet<String>,
    kind: &str,
    name: &str,
    path: &str,
) {
    push_user_attachment(
        items,
        seen,
        json!({"kind": kind, "name": name, "source": {"type": "path", "path": path}}),
    );
}

fn push_user_attachment(
    items: &mut Vec<Value>,
    seen: &mut std::collections::HashSet<String>,
    value: Value,
) {
    let Some(key) = value.get("source").map(Value::to_string) else {
        return;
    };
    if seen.insert(key) {
        items.push(value);
    }
}

fn attachment_basename(path: &str, index: usize, fallback: &str) -> String {
    Path::new(path)
        .file_name()
        .and_then(|name| name.to_str())
        .filter(|name| !name.is_empty())
        .map_or_else(|| format!("{fallback} {index}"), ToOwned::to_owned)
}

fn mentioned_user_files(text: &str) -> Vec<(String, String)> {
    let Some((_, remainder)) = text.split_once("# Files mentioned by the user:") else {
        return Vec::new();
    };
    let metadata = remainder
        .split_once("## My request for Codex:")
        .map_or(remainder, |(metadata, _)| metadata);
    metadata
        .lines()
        .filter_map(|line| {
            let entry = line.trim().strip_prefix("## ")?;
            let (name, path) = entry.split_once(": ")?;
            let name = name.trim();
            let path = path.trim().trim_matches('`');
            (!name.is_empty() && Path::new(path).is_absolute())
                .then(|| (name.to_owned(), path.to_owned()))
        })
        .collect()
}

fn store_data_image(value: &str, content: &PrivateContentService) -> Option<ContentReference> {
    let (metadata, encoded) = value.split_once(',')?;
    let content_type = metadata.strip_prefix("data:")?.strip_suffix(";base64")?;
    store_base64_image(encoded, content_type, content)
}

fn store_base64_image(
    value: &str,
    content_type: &str,
    content: &PrivateContentService,
) -> Option<ContentReference> {
    if !matches!(
        content_type,
        "image/avif" | "image/gif" | "image/jpeg" | "image/png" | "image/webp"
    ) {
        return None;
    }
    let normalized = value
        .chars()
        .filter(|character| !character.is_whitespace())
        .collect::<String>();
    if normalized.is_empty() || normalized.len() > MAX_INLINE_ASSET_BYTES * 4 / 3 + 4 {
        return None;
    }
    let bytes = general_purpose::STANDARD.decode(normalized).ok()?;
    if bytes.is_empty() || bytes.len() > MAX_INLINE_ASSET_BYTES {
        return None;
    }
    Some(content.put_bytes(&bytes, content_type))
}

fn store_generated_image(value: &str, content: &PrivateContentService) -> Option<ContentReference> {
    if let Some(reference) = store_data_image(value, content) {
        return Some(reference);
    }
    let normalized = value
        .chars()
        .filter(|character| !character.is_whitespace())
        .collect::<String>();
    if normalized.is_empty() || normalized.len() > MAX_INLINE_ASSET_BYTES * 4 / 3 + 4 {
        return None;
    }
    let bytes = general_purpose::STANDARD.decode(normalized).ok()?;
    if bytes.is_empty() || bytes.len() > MAX_INLINE_ASSET_BYTES {
        return None;
    }
    let content_type = generated_image_content_type(&bytes)?;
    Some(content.put_bytes(&bytes, content_type))
}

fn generated_image_content_type(bytes: &[u8]) -> Option<&'static str> {
    if bytes.starts_with(&[0x89, b'P', b'N', b'G', 0x0d, 0x0a, 0x1a, 0x0a]) {
        return Some("image/png");
    }
    if bytes.starts_with(&[0xff, 0xd8, 0xff]) {
        return Some("image/jpeg");
    }
    if bytes.starts_with(b"GIF87a") || bytes.starts_with(b"GIF89a") {
        return Some("image/gif");
    }
    if bytes.len() >= 12 && &bytes[..4] == b"RIFF" && &bytes[8..12] == b"WEBP" {
        return Some("image/webp");
    }
    if bytes.len() >= 12
        && &bytes[4..8] == b"ftyp"
        && (&bytes[8..12] == b"avif" || &bytes[8..12] == b"avis")
    {
        return Some("image/avif");
    }
    None
}

fn asset_json(reference: ContentReference) -> Value {
    let mut value = serde_json::to_value(reference).unwrap_or(Value::Null);
    if let Some(object) = value.as_object_mut() {
        object.insert("version".into(), json!(1));
    }
    value
}

fn mentioned_image_paths(parts: &[Value]) -> Vec<String> {
    let mut paths = Vec::new();
    for text in parts
        .iter()
        .filter_map(|part| part.get("text").and_then(Value::as_str))
    {
        for line in text.lines() {
            // Current Codex transcripts describe uploaded images with an
            // explicit path attribute. Their content-addressed filenames end
            // in `image:<id>` rather than a conventional file extension, so
            // the legacy extension heuristic below cannot recognize them.
            if line.contains("<image ")
                && let Some(candidate) = quoted_attribute(line, "path")
                && Path::new(candidate).is_absolute()
            {
                paths.push(candidate.to_owned());
                continue;
            }
            let Some((_, candidate)) = line.split_once(':') else {
                continue;
            };
            let candidate = candidate.trim().trim_matches('`');
            let lower = candidate.to_ascii_lowercase();
            if Path::new(candidate).is_absolute()
                && [".avif", ".gif", ".jpg", ".jpeg", ".png", ".webp"]
                    .iter()
                    .any(|extension| lower.ends_with(extension))
            {
                paths.push(candidate.to_owned());
            }
        }
    }
    paths
}

fn quoted_attribute<'a>(value: &'a str, name: &str) -> Option<&'a str> {
    let marker = format!("{name}=\"");
    let remainder = value.split_once(&marker)?.1;
    let candidate = remainder.split_once('"')?.0.trim();
    (!candidate.is_empty()).then_some(candidate)
}

fn scalar_fields(value: &Value) -> Map<String, Value> {
    value
        .as_object()
        .map(|object| {
            object
                .iter()
                .filter(|(_, value)| {
                    value.is_null() || value.is_string() || value.is_number() || value.is_boolean()
                })
                .map(|(key, value)| (key.clone(), value.clone()))
                .collect()
        })
        .unwrap_or_default()
}

fn summarize_turn_items(items: &[Value]) -> Vec<Value> {
    let first_user = items
        .iter()
        .position(|item| item.get("type").and_then(Value::as_str) == Some("userMessage"));
    let final_agent = items
        .iter()
        .rposition(|item| item.get("type").and_then(Value::as_str) == Some("agentMessage"));
    [first_user, final_agent]
        .into_iter()
        .flatten()
        .collect::<std::collections::BTreeSet<_>>()
        .into_iter()
        .filter_map(|index| items.get(index).cloned())
        .collect()
}

fn activity_summary(items: &[Value]) -> Option<Value> {
    let final_agent = items
        .iter()
        .rposition(|item| item.get("type").and_then(Value::as_str) == Some("agentMessage"));
    let kinds = items
        .iter()
        .enumerate()
        .filter_map(|(index, item)| {
            let kind = item.get("type").and_then(Value::as_str)?;
            (kind != "userMessage" && Some(index) != final_agent).then_some(kind)
        })
        .collect::<Vec<_>>();
    (!kinds.is_empty()).then(|| {
        let output_footprint = aggregate_output_footprint(items);
        let mut activity = json!({"count": kinds.len(), "kinds": kinds});
        if let (Some(activity), Some(output_footprint)) =
            (activity.as_object_mut(), output_footprint)
        {
            activity.insert("outputFootprint".into(), output_footprint);
        }
        activity
    })
}

fn attach_command_output_footprint(mut item: Value) -> Value {
    let Some(object) = item.as_object_mut() else {
        return item;
    };
    if object.get("type").and_then(Value::as_str) != Some("commandExecution") {
        return item;
    }
    let Some(output) = object.get("aggregatedOutput").and_then(Value::as_str) else {
        return item;
    };
    if output.is_empty() {
        return item;
    }
    object.insert(
        "codewideOutputFootprint".into(),
        output_footprint(output.len()),
    );
    item
}

fn output_footprint(bytes: usize) -> Value {
    json!({
        "version": 1,
        "basis": "approxBytesPerToken",
        "bytes": bytes,
        "estimatedTokens": bytes.saturating_add(APPROX_BYTES_PER_TOKEN - 1) / APPROX_BYTES_PER_TOKEN
    })
}

fn aggregate_output_footprint(items: &[Value]) -> Option<Value> {
    let (bytes, estimated_tokens) = items
        .iter()
        .filter(|item| item.get("type").and_then(Value::as_str) == Some("commandExecution"))
        .filter_map(|item| {
            let footprint = item.get("codewideOutputFootprint")?;
            Some((
                footprint.get("bytes")?.as_u64()?,
                footprint.get("estimatedTokens")?.as_u64()?,
            ))
        })
        .fold(
            (0_u64, 0_u64),
            |(bytes, tokens), (next_bytes, next_tokens)| {
                (
                    bytes.saturating_add(next_bytes),
                    tokens.saturating_add(next_tokens),
                )
            },
        );
    (bytes > 0 || estimated_tokens > 0).then(|| {
        json!({
            "version": 1,
            "basis": "approxBytesPerToken",
            "bytes": bytes,
            "estimatedTokens": estimated_tokens
        })
    })
}

fn bounded_preview(value: &str, budget: usize) -> String {
    let bytes = value.len();
    let marker = format!("\n… [{bytes} bytes; full content available]");
    let available = budget.saturating_sub(marker.len());
    let head = utf8_prefix(value, available * 3 / 4);
    let tail = utf8_suffix(value, available / 4);
    format!("{head}{marker}{tail}")
}

fn utf8_prefix(value: &str, bytes: usize) -> &str {
    let mut end = bytes.min(value.len());
    while end > 0 && !value.is_char_boundary(end) {
        end -= 1;
    }
    &value[..end]
}

fn utf8_suffix(value: &str, bytes: usize) -> &str {
    let mut start = value.len().saturating_sub(bytes);
    while start < value.len() && !value.is_char_boundary(start) {
        start += 1;
    }
    &value[start..]
}

fn content_type(pointer: &str) -> &'static str {
    if pointer.ends_with("/diff") || pointer == "/diff" {
        "text/x-diff; charset=utf-8"
    } else if pointer.ends_with("/text") || pointer.contains("/content/") {
        "text/markdown; charset=utf-8"
    } else {
        "text/plain; charset=utf-8"
    }
}

fn pointer_or_root(pointer: &str) -> &str {
    if pointer.is_empty() { "/" } else { pointer }
}

fn escape_pointer(value: &str) -> String {
    value.replace('~', "~0").replace('/', "~1")
}

fn encoded_len(value: &Value) -> usize {
    serde_json::to_vec(value).map_or(usize::MAX, |bytes| bytes.len())
}

fn remember(cache: &Mutex<MemoryCache>, id: &str, bytes: Arc<[u8]>, content_type: &str) {
    if bytes.len() > MAX_MEMORY_BYTES {
        return;
    }
    let mut cache = cache
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
    cache.clock = cache.clock.saturating_add(1);
    let last_access = cache.clock;
    if let Some(existing) = cache.values.get_mut(id) {
        existing.last_access = last_access;
        return;
    }
    while cache.bytes.saturating_add(bytes.len()) > MAX_MEMORY_BYTES {
        let Some(oldest) = cache
            .values
            .iter()
            .min_by_key(|(_, value)| value.last_access)
            .map(|(id, _)| id.clone())
        else {
            break;
        };
        if let Some(removed) = cache.values.remove(&oldest) {
            cache.bytes = cache.bytes.saturating_sub(removed.bytes.len());
        }
    }
    cache.bytes = cache.bytes.saturating_add(bytes.len());
    cache.values.insert(
        id.to_owned(),
        CachedContent {
            bytes,
            content_type: content_type.to_owned(),
            last_access,
        },
    );
}

fn cached(cache: &Mutex<MemoryCache>, id: &str) -> Option<CachedContent> {
    let mut cache = cache
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
    cache.clock = cache.clock.saturating_add(1);
    let clock = cache.clock;
    let value = cache.values.get_mut(id)?;
    value.last_access = clock;
    Some(value.clone())
}

async fn persist_worker(
    directory: PathBuf,
    mut receiver: tokio::sync::mpsc::Receiver<PersistRequest>,
    memory: Arc<Mutex<MemoryCache>>,
) {
    let mut last_prune = tokio::time::Instant::now() - PRUNE_INTERVAL;
    while let Some(request) = receiver.recv().await {
        if let Err(error) = persist_one(&directory, &request).await {
            tracing::warn!(id = request.id, %error, "private content persistence failed");
        }
        if last_prune.elapsed() >= PRUNE_INTERVAL {
            if let Err(error) = prune_disk_to(&directory, &memory, MAX_DISK_BYTES).await {
                tracing::warn!(%error, "private content disk prune failed");
            }
            last_prune = tokio::time::Instant::now();
        }
    }
}

async fn persist_one(directory: &Path, request: &PersistRequest) -> Result<(), std::io::Error> {
    tokio::fs::create_dir_all(directory).await?;
    #[cfg(unix)]
    tokio::fs::set_permissions(
        directory,
        <std::fs::Permissions as std::os::unix::fs::PermissionsExt>::from_mode(0o700),
    )
    .await?;
    let target = directory.join(&request.id);
    if !tokio::fs::try_exists(&target).await? {
        let temporary = target.with_extension(format!("tmp-{}", std::process::id()));
        let mut file = tokio::fs::OpenOptions::new()
            .create(true)
            .truncate(true)
            .write(true)
            .mode(0o600)
            .open(&temporary)
            .await?;
        file.write_all(&request.bytes).await?;
        file.sync_all().await?;
        tokio::fs::rename(temporary, &target).await?;
    }
    let metadata_target = target.with_extension("meta.json");
    let mut metadata = tokio::fs::OpenOptions::new()
        .create(true)
        .truncate(true)
        .write(true)
        .mode(0o600)
        .open(metadata_target)
        .await?;
    metadata
        .write_all(
            json!({"contentType": request.content_type})
                .to_string()
                .as_bytes(),
        )
        .await?;
    metadata.sync_all().await
}

async fn prune_disk_to(
    directory: &Path,
    memory: &Mutex<MemoryCache>,
    max_bytes: u64,
) -> Result<(), std::io::Error> {
    let mut reader = match tokio::fs::read_dir(directory).await {
        Ok(reader) => reader,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(error) => return Err(error),
    };
    let mut entries = Vec::new();
    let mut total = 0_u64;
    while let Some(entry) = reader.next_entry().await? {
        let name = entry.file_name();
        let Some(id) = name.to_str() else { continue };
        if id.len() != 64 || !id.bytes().all(|byte| byte.is_ascii_hexdigit()) {
            continue;
        }
        let metadata = entry.metadata().await?;
        if !metadata.is_file() {
            continue;
        }
        let modified = metadata.modified().unwrap_or(SystemTime::UNIX_EPOCH);
        total = total.saturating_add(metadata.len());
        entries.push((modified, id.to_owned(), metadata.len(), entry.path()));
    }
    entries.sort_by_key(|(modified, _, _, _)| *modified);
    for (_modified, id, bytes, path) in entries {
        if total <= max_bytes {
            break;
        }
        let _ = tokio::fs::remove_file(&path).await;
        let _ = tokio::fs::remove_file(path.with_extension("meta.json")).await;
        total = total.saturating_sub(bytes);
        let mut cache = memory
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        if let Some(removed) = cache.values.remove(&id) {
            cache.bytes = cache.bytes.saturating_sub(removed.bytes.len());
        }
    }
    Ok(())
}

fn requested_range(
    query: ContentQuery,
    headers: &HeaderMap,
    total: usize,
) -> Result<RequestedRange, ContentError> {
    let mut start = query.offset.unwrap_or(0);
    let mut end = start.saturating_add(query.limit.unwrap_or(MAX_CHUNK_BYTES));
    let mut partial = query.offset.is_some() || query.limit.is_some();
    if let Some(raw) = headers
        .get(header::RANGE)
        .and_then(|value| value.to_str().ok())
    {
        let raw = raw
            .strip_prefix("bytes=")
            .ok_or(ContentError::InvalidRange)?;
        let (raw_start, raw_end) = raw.split_once('-').ok_or(ContentError::InvalidRange)?;
        start = raw_start.parse().map_err(|_| ContentError::InvalidRange)?;
        end = if raw_end.is_empty() {
            total
        } else {
            raw_end
                .parse::<usize>()
                .map_err(|_| ContentError::InvalidRange)?
                .saturating_add(1)
        };
        partial = true;
    }
    if start >= total || end <= start {
        return Err(ContentError::InvalidRange);
    }
    end = end.min(total).min(start.saturating_add(MAX_CHUNK_BYTES));
    Ok(RequestedRange {
        start,
        end,
        partial: partial || start != 0 || end != total,
    })
}

fn align_utf8_range(bytes: &[u8], range: &mut RequestedRange) {
    while range.start < range.end
        && range.start > 0
        && bytes
            .get(range.start)
            .is_some_and(|byte| byte & 0b1100_0000 == 0b1000_0000)
    {
        range.start += 1;
    }
    while range.end < bytes.len()
        && bytes
            .get(range.end)
            .is_some_and(|byte| byte & 0b1100_0000 == 0b1000_0000)
    {
        range.end += 1;
    }
}

fn unix_time_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |duration| {
            u64::try_from(duration.as_millis()).unwrap_or(u64::MAX)
        })
}

#[cfg(test)]
#[allow(clippy::expect_used)]
mod tests {
    use super::*;

    #[test]
    fn recognizes_current_extensionless_attachment_markup() {
        let path =
            "/home/user/.codex/attachments/codewide/sessions/thread/files/message-image:7731";
        let parts = vec![json!({
            "type": "text",
            "text": format!("<image name=[Image #1] path=\"{path}\">")
        })];

        assert_eq!(mentioned_image_paths(&parts), vec![path]);
    }

    #[tokio::test]
    async fn projects_current_user_attachment_as_a_stable_local_image() {
        let directory = tempfile::tempdir().expect("temp content directory");
        let attachment = directory.path().join("message-image:7731");
        std::fs::write(&attachment, b"image bytes").expect("write attachment");
        let content = PrivateContentService::open(directory.path().join("cas"));
        let projector = ContentProjector::new(content);
        let projected = projector.project_item(json!({
            "id": "user-message",
            "type": "userMessage",
            "content": [
                {
                    "type": "text",
                    "text": format!("<image name=[Image #1] path=\"{}\">", attachment.display())
                },
                {
                    "type": "image",
                    "url": "data:image/png;base64,iVBORw0KGgo="
                }
            ]
        }));

        assert_eq!(projected["content"][1]["type"], "localImage");
        assert_eq!(
            projected["content"][1]["path"],
            attachment.to_string_lossy().as_ref()
        );
        assert!(projected["content"][1].get("url").is_none());
        assert!(projected["content"][1].get("codewideAsset").is_none());
        assert_eq!(projected["codewideAttachments"]["version"], 1);
        assert_eq!(
            projected["codewideAttachments"]["items"][0]["kind"],
            "image"
        );
        assert_eq!(
            projected["codewideAttachments"]["items"][0]["source"]["path"],
            attachment.to_string_lossy().as_ref()
        );
    }

    #[tokio::test]
    async fn projects_mentioned_files_from_the_persisted_user_message() {
        let projector = ContentProjector::new(PrivateContentService::open(
            tempfile::tempdir()
                .expect("temp content directory")
                .path()
                .join("cas"),
        ));
        let projected = projector.project_item(json!({
            "id": "user-message",
            "type": "userMessage",
            "content": [{
                "type": "text",
                "text": "# Files mentioned by the user:\n\n## plan.md: /srv/codex/plan.md\n\n## page.html: `/srv/codex/page.html`\n\n## My request for Codex:\n\nReview both."
            }]
        }));

        assert_eq!(projected["codewideAttachments"]["version"], 1);
        assert_eq!(
            projected["codewideAttachments"]["items"][0],
            json!({
                "kind": "file",
                "name": "plan.md",
                "source": {"type": "path", "path": "/srv/codex/plan.md"}
            })
        );
        assert_eq!(
            projected["codewideAttachments"]["items"][1],
            json!({
                "kind": "file",
                "name": "page.html",
                "source": {"type": "path", "path": "/srv/codex/page.html"}
            })
        );
    }

    #[tokio::test]
    async fn materializes_images_from_custom_tool_output_notifications()
    -> Result<(), Box<dyn std::error::Error>> {
        let directory = tempfile::tempdir()?;
        let content = PrivateContentService::open(directory.path().to_path_buf());
        let projector = ContentProjector::new(content.clone());
        let png = hex::decode("89504e470d0a1a0a0000000d49484452")?;
        let projected = projector.project_notification(json!({
            "method": "item/completed",
            "params": {
                "threadId": "thread",
                "turnId": "turn",
                "item": {
                    "id": "tool-output",
                    "type": "custom_tool_call_output",
                    "output": [{
                        "type": "input_image",
                        "image_url": format!(
                            "data:image/png;base64,{}",
                            general_purpose::STANDARD.encode(&png)
                        )
                    }]
                }
            }
        }));
        let image = &projected["params"]["item"]["output"][0];
        assert_eq!(image["image_url"], "");
        assert_eq!(image["codewideAsset"]["contentType"], "image/png");
        assert_eq!(
            image["codewideAsset"]["id"],
            hex::encode(Sha256::digest(&png))
        );

        let response = content
            .serve(
                image["codewideAsset"]["id"].as_str().unwrap_or_default(),
                ContentQuery {
                    offset: None,
                    limit: None,
                },
                &HeaderMap::new(),
                false,
            )
            .await?;
        assert_eq!(response.status(), StatusCode::OK);
        let body = axum::body::to_bytes(response.into_body(), png.len()).await?;
        assert_eq!(body.as_ref(), png);
        Ok(())
    }

    #[tokio::test]
    async fn materializes_image_generation_result_before_size_projection() {
        let directory = tempfile::tempdir().expect("temp content directory");
        let content = PrivateContentService::open(directory.path().to_path_buf());
        let projector = ContentProjector::new(content);
        let png = hex::decode("89504e470d0a1a0a0000000d49484452").expect("png bytes");
        let projected = projector.project_item(json!({
            "id": "generated-image",
            "type": "imageGeneration",
            "status": "completed",
            "revisedPrompt": null,
            "result": general_purpose::STANDARD.encode(&png),
            "savedPath": "/tmp/generated.png"
        }));

        assert_eq!(projected["result"], "");
        assert_eq!(projected["codewideAsset"]["contentType"], "image/png");
        assert_eq!(projected["codewideAsset"]["byteLength"], png.len());
        assert_eq!(
            projected["codewideAsset"]["id"],
            hex::encode(Sha256::digest(&png))
        );
    }

    #[tokio::test]
    async fn attributes_full_command_output_before_bounded_projection() {
        let projector = ContentProjector::new(PrivateContentService::open(
            tempfile::tempdir()
                .expect("temp content directory")
                .path()
                .join("cas"),
        ));
        let output = "λ".repeat(MAX_PROJECTED_ITEM_BYTES);
        let expected_bytes = output.len();
        let projected = projector.project_item(json!({
            "id": "command",
            "type": "commandExecution",
            "command": "print output",
            "status": "completed",
            "aggregatedOutput": output
        }));

        assert_eq!(projected["codewideOutputFootprint"]["version"], 1);
        assert_eq!(
            projected["codewideOutputFootprint"]["basis"],
            "approxBytesPerToken"
        );
        assert_eq!(
            projected["codewideOutputFootprint"]["bytes"],
            expected_bytes
        );
        assert_eq!(
            projected["codewideOutputFootprint"]["estimatedTokens"],
            expected_bytes.div_ceil(APPROX_BYTES_PER_TOKEN)
        );
    }

    #[test]
    fn activity_summary_aggregates_command_output_footprints() {
        let items = vec![
            attach_command_output_footprint(json!({
                "id": "one",
                "type": "commandExecution",
                "aggregatedOutput": "12345"
            })),
            json!({ "id": "reasoning", "type": "reasoning" }),
            attach_command_output_footprint(json!({
                "id": "two",
                "type": "commandExecution",
                "aggregatedOutput": "123"
            })),
        ];

        let summary = activity_summary(&items).expect("activity summary");
        assert_eq!(summary["outputFootprint"]["bytes"], 8);
        assert_eq!(summary["outputFootprint"]["estimatedTokens"], 3);
    }

    #[tokio::test]
    async fn materializes_images_from_hydrated_items_and_message_content()
    -> Result<(), Box<dyn std::error::Error>> {
        let directory = tempfile::tempdir()?;
        let content = PrivateContentService::open(directory.path().to_path_buf());
        let projector = ContentProjector::new(content.clone());
        let png = hex::decode("89504e470d0a1a0a0000000d49484452")?;
        let data_url = format!(
            "data:image/png;base64,{}",
            general_purpose::STANDARD.encode(&png)
        );
        let projected = projector.project_rpc_result(
            "thread/items/list",
            json!({
                "data": [
                    {
                        "item": {
                            "id": "tool-output",
                            "type": "custom_tool_call_output",
                            "output": [{
                                "type": "input_image",
                                "image_url": data_url
                            }]
                        }
                    },
                    {
                        "item": {
                            "id": "user-message",
                            "type": "message",
                            "role": "user",
                            "content": [{
                                "type": "input_image",
                                "image_url": data_url
                            }]
                        }
                    }
                ]
            }),
        );
        let expected_id = hex::encode(Sha256::digest(&png));
        for pointer in ["/data/0/item/output/0", "/data/1/item/content/0"] {
            let image = projected.pointer(pointer).unwrap_or(&Value::Null);
            assert_eq!(image["image_url"], "");
            assert_eq!(image["codewideAsset"]["contentType"], "image/png");
            assert_eq!(image["codewideAsset"]["id"], expected_id);
        }

        let response = content
            .serve(
                &expected_id,
                ContentQuery {
                    offset: None,
                    limit: None,
                },
                &HeaderMap::new(),
                false,
            )
            .await?;
        assert_eq!(response.status(), StatusCode::OK);
        let body = axum::body::to_bytes(response.into_body(), png.len()).await?;
        assert_eq!(body.as_ref(), png);
        Ok(())
    }

    #[tokio::test]
    async fn disk_prune_is_bounded_and_removes_matching_memory_entries()
    -> Result<(), Box<dyn std::error::Error>> {
        let directory = tempfile::tempdir()?;
        let memory = Mutex::new(MemoryCache::default());
        for index in 0..3_u8 {
            let id = format!("{index:064x}");
            let request = PersistRequest {
                id: id.clone(),
                bytes: Arc::from(vec![index; 8]),
                content_type: "application/octet-stream".into(),
            };
            remember(&memory, &id, request.bytes.clone(), &request.content_type);
            persist_one(directory.path(), &request).await?;
            tokio::time::sleep(std::time::Duration::from_millis(2)).await;
        }
        prune_disk_to(directory.path(), &memory, 8).await?;
        let retained = std::fs::read_dir(directory.path())?
            .filter_map(Result::ok)
            .filter(|entry| entry.file_name().to_string_lossy().len() == 64)
            .count();
        assert_eq!(retained, 1);
        assert_eq!(
            memory
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner)
                .values
                .len(),
            1
        );
        Ok(())
    }
}
