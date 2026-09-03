use std::{
    collections::{BTreeMap, HashMap, HashSet, VecDeque},
    fs::File,
    path::{Component, Path, PathBuf},
    sync::Arc,
    time::{Duration, SystemTime, UNIX_EPOCH},
};

#[cfg(not(unix))]
use std::io::{Read, Seek, SeekFrom};
#[cfg(unix)]
use std::os::unix::fs::FileExt;

use futures_util::StreamExt;
use redb::{Database, ReadableDatabase, TableDefinition};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use tokio::sync::{Mutex, RwLock};

use crate::{
    catalog::{CatalogError, SessionCatalog},
    files::FileService,
    rollout::{IndexError, index_rollout_fully, rollout_file_id},
    store::{IndexStore, StoreError},
    vcs::{VcsDiff, VcsError, VcsFileStatus, VcsScope, VcsService, VcsSnapshot},
};

mod full_change_output;

const PROJECTIONS: TableDefinition<&str, &[u8]> = TableDefinition::new("thread_resources");
const PROJECTION_VERSION: u8 = 8;
const MAX_DIFF_CHARS_PER_PATH: usize = 4 * 1024 * 1024;
const TAIL_CHECK_BYTES: u64 = 4_096;
const COMPLETED_TURN_REFRESH_DELAYS: [Duration; 6] = [
    Duration::ZERO,
    Duration::from_millis(100),
    Duration::from_millis(250),
    Duration::from_millis(500),
    Duration::from_secs(1),
    Duration::from_secs(2),
];
const RECENT_COMPLETED_TURNS: usize = 256;

#[derive(Clone)]
pub struct ResourceService {
    catalog: Arc<SessionCatalog>,
    index: Arc<IndexStore>,
    store: Arc<ResourceStore>,
    files: Arc<FileService>,
    live: Arc<RwLock<HashMap<String, BTreeMap<String, ResourceData>>>>,
    latest_live_turns: Arc<RwLock<HashMap<String, String>>>,
    refreshes: Arc<Mutex<HashMap<String, Arc<Mutex<()>>>>>,
    scheduled_prewarm: Arc<std::sync::Mutex<HashSet<String>>>,
    vcs: Option<Arc<VcsService>>,
}

struct ResourceRequestContext {
    thread_id: String,
    projection: PersistedProjection,
    overlays: BTreeMap<String, ResourceData>,
    latest_live_turn: Option<String>,
    requested_scope: ChangeScope,
}

#[derive(Clone, Copy, Eq, PartialEq)]
enum ResourceSelection {
    All,
    Changes,
    Attachments,
}

struct ResourceStore {
    database: Database,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
struct ChangeResource {
    path: String,
    kind: ChangeKind,
    additions: u64,
    deletions: u64,
    turn_id: String,
    item_id: String,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "lowercase")]
enum ChangeKind {
    Add,
    Delete,
    Update,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
enum ChangeScope {
    Session,
    LastTurn,
    Staged,
    Unstaged,
    Branch,
}

impl ChangeScope {
    fn vcs(self) -> Option<VcsScope> {
        match self {
            Self::Session | Self::LastTurn => None,
            Self::Staged => Some(VcsScope::Staged),
            Self::Unstaged => Some(VcsScope::Unstaged),
            Self::Branch => Some(VcsScope::Branch),
        }
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
struct AttachmentResource {
    key: String,
    name: String,
    kind: AttachmentKind,
    path: Option<String>,
    url: Option<String>,
    origin: AttachmentOrigin,
    turn_id: String,
    item_id: String,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "lowercase")]
enum AttachmentKind {
    Image,
    Audio,
    File,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "lowercase")]
enum AttachmentOrigin {
    User,
    Agent,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
struct ChangePatch {
    turn_id: String,
    item_id: String,
    kind: ChangeKind,
    diff: String,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
struct PatchBucket {
    patches: Vec<ChangePatch>,
    chars: usize,
    truncated: bool,
}

impl PatchBucket {
    fn merge_bucket(&mut self, other: Option<&Self>) {
        let Some(other) = other else {
            return;
        };
        for patch in &other.patches {
            if self.chars.saturating_add(patch.diff.len()) > MAX_DIFF_CHARS_PER_PATH {
                self.truncated = true;
                break;
            }
            self.chars = self.chars.saturating_add(patch.diff.len());
            self.patches.push(patch.clone());
        }
        self.truncated |= other.truncated;
    }
}

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
struct ResourceData {
    changes: BTreeMap<String, ChangeResource>,
    attachments: Vec<AttachmentResource>,
    patches: BTreeMap<String, PatchBucket>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
struct TurnResourceData {
    turn_id: String,
    data: ResourceData,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
struct PersistedProjection {
    version: u8,
    source_path: PathBuf,
    device: u64,
    inode: u64,
    indexed_bytes: u64,
    tail_hash: [u8; 32],
    cwd: Option<PathBuf>,
    active_turn_id: Option<String>,
    #[serde(default)]
    pending_data: ResourceData,
    #[serde(default)]
    turns: Vec<TurnResourceData>,
    recent_completed_turns: VecDeque<String>,
}

impl PersistedProjection {
    fn empty(path: PathBuf, device: u64, inode: u64) -> Self {
        Self {
            version: PROJECTION_VERSION,
            source_path: path,
            device,
            inode,
            indexed_bytes: 0,
            tail_hash: [0; 32],
            cwd: None,
            active_turn_id: None,
            pending_data: ResourceData::default(),
            turns: Vec::new(),
            recent_completed_turns: VecDeque::new(),
        }
    }

    fn started(&mut self, turn_id: &str) {
        if self.active_turn_id.as_deref() == Some(turn_id) {
            return;
        }
        if let Some(previous_turn_id) = self.active_turn_id.clone() {
            // Interrupted turns do not always receive an explicit terminal
            // record. Once the next turn starts, their canonical resources are
            // immutable and must not disappear from the session projection.
            self.completed(&previous_turn_id);
        }
        self.active_turn_id = Some(turn_id.to_owned());
        self.pending_data = ResourceData::default();
    }

    fn completed(&mut self, turn_id: &str) {
        if self.active_turn_id.as_deref() == Some(turn_id) {
            let pending = std::mem::take(&mut self.pending_data);
            self.turns.push(TurnResourceData {
                turn_id: turn_id.to_owned(),
                data: pending,
            });
            self.active_turn_id = None;
        }
        if !turn_id.is_empty() {
            self.recent_completed_turns
                .retain(|candidate| candidate != turn_id);
            self.recent_completed_turns.push_back(turn_id.to_owned());
            while self.recent_completed_turns.len() > RECENT_COMPLETED_TURNS {
                self.recent_completed_turns.pop_front();
            }
        }
    }

    fn aborted(&mut self, turn_id: &str) {
        self.completed(turn_id);
    }

    fn pending_for(&mut self, turn_id: &str) -> Option<&mut ResourceData> {
        (self.active_turn_id.as_deref() == Some(turn_id)).then_some(&mut self.pending_data)
    }

    fn rollback(&mut self, turns: usize) {
        let retained = self.turns.len().saturating_sub(turns);
        self.turns.truncate(retained);
        self.active_turn_id = None;
        self.pending_data = ResourceData::default();
        self.recent_completed_turns = self
            .turns
            .iter()
            .rev()
            .take(RECENT_COMPLETED_TURNS)
            .map(|turn| turn.turn_id.clone())
            .collect::<VecDeque<_>>()
            .into_iter()
            .rev()
            .collect();
    }

    fn materialized_summary(&self) -> ResourceData {
        let mut data = ResourceData::default();
        for turn in &self.turns {
            data.merge_summary(&turn.data);
        }
        // An interrupted or currently active turn can remain at EOF without a
        // terminal event. Its canonical, newline-terminated records are still
        // part of the thread and must survive a companion restart.
        data.merge_summary(&self.pending_data);
        data
    }

    fn materialized_patch(&self, path: &str) -> PatchBucket {
        let mut bucket = PatchBucket::default();
        for turn in &self.turns {
            bucket.merge_bucket(turn.data.patches.get(path));
        }
        bucket.merge_bucket(self.pending_data.patches.get(path));
        bucket
    }

    #[cfg(test)]
    fn materialized_data(&self) -> ResourceData {
        let mut data = ResourceData::default();
        for turn in &self.turns {
            data.merge(&turn.data);
        }
        data.merge(&self.pending_data);
        data
    }
}

#[derive(Debug, thiserror::Error)]
pub enum ResourceError {
    #[error(transparent)]
    File(#[from] crate::files::FileError),
    #[error(transparent)]
    Catalog(#[from] CatalogError),
    #[error(transparent)]
    Io(#[from] std::io::Error),
    #[error(transparent)]
    Database(#[from] redb::Error),
    #[error(transparent)]
    DatabaseOpen(#[from] redb::DatabaseError),
    #[error(transparent)]
    Transaction(#[from] redb::TransactionError),
    #[error(transparent)]
    Table(#[from] redb::TableError),
    #[error(transparent)]
    Storage(#[from] redb::StorageError),
    #[error(transparent)]
    Commit(#[from] redb::CommitError),
    #[error(transparent)]
    Json(#[from] serde_json::Error),
    #[error(transparent)]
    Index(#[from] IndexError),
    #[error(transparent)]
    Store(#[from] StoreError),
    #[error("threadId is required")]
    MissingThreadId,
    #[error("path is required")]
    MissingPath,
    #[error("change output offset is invalid")]
    InvalidOffset,
    #[error("canonical change output record is invalid")]
    InvalidPatchRecord,
    #[error("resource projection task failed")]
    Join,
    #[error(transparent)]
    Vcs(#[from] VcsError),
}

impl ResourceService {
    /// Authorizes one workspace-relative preview against the authoritative
    /// workspace root and returns its current length and media type.
    ///
    /// # Errors
    ///
    /// Returns an error when the workspace/path is invalid, escapes the
    /// workspace root, or the file cannot be inspected.
    pub async fn workspace_preview_metadata(
        &self,
        workspace: PathBuf,
        path: PathBuf,
    ) -> Result<(u64, String), ResourceError> {
        Ok(self.files.preview_metadata_within(workspace, path).await?)
    }

    /// Opens the compact, crash-safe projection store. It contains only file
    /// metadata, attachment references, and bounded diffs; canonical JSONL
    /// remains the only full-history source.
    ///
    /// # Errors
    ///
    /// Returns an error when the redb projection store cannot be opened.
    pub fn open(
        path: impl AsRef<Path>,
        catalog: Arc<SessionCatalog>,
        index: Arc<IndexStore>,
        files: Arc<FileService>,
    ) -> Result<Self, ResourceError> {
        let path = path.as_ref();
        let store = match ResourceStore::open(path) {
            Ok(store) => store,
            Err(error) if recoverable_resource_database_error(&error) => {
                let backup = corrupt_backup_path(path);
                std::fs::rename(path, &backup)?;
                tracing::warn!(
                    path = %path.display(),
                    backup = %backup.display(),
                    reason = %error,
                    "quarantined corrupt derived resource index"
                );
                ResourceStore::open(path)?
            }
            Err(error) => return Err(error),
        };
        Ok(Self {
            catalog,
            index,
            store: Arc::new(store),
            files,
            live: Arc::new(RwLock::new(HashMap::new())),
            latest_live_turns: Arc::new(RwLock::new(HashMap::new())),
            refreshes: Arc::new(Mutex::new(HashMap::new())),
            scheduled_prewarm: Arc::new(std::sync::Mutex::new(HashSet::new())),
            vcs: None,
        })
    }

    #[must_use]
    pub fn with_vcs(mut self, vcs: Arc<VcsService>) -> Self {
        self.vcs = Some(vcs);
        self
    }

    #[must_use]
    pub fn handles(method: &str) -> bool {
        matches!(
            method,
            "companion/threadResources/read"
                | "companion/threadChanges/read"
                | "companion/threadAttachments/read"
                | "companion/threadChange/read"
        )
    }

    /// Refreshes the immutable projection from the canonical rollout and then
    /// overlays only the currently mutable turn observed on the live stream.
    ///
    /// # Errors
    ///
    /// Returns an error when the thread is invalid, its rollout cannot be
    /// read, or the compact projection cannot be committed.
    pub async fn handle(&self, method: &str, params: &Value) -> Result<Value, ResourceError> {
        let thread_id = params
            .get("threadId")
            .and_then(Value::as_str)
            .filter(|value| !value.is_empty())
            .ok_or(ResourceError::MissingThreadId)?
            .to_owned();
        let projection = self.refresh_projection(&thread_id).await?;

        let mut live = self.live.write().await;
        if let Some(turns) = live.get_mut(&thread_id) {
            for completed in &projection.recent_completed_turns {
                turns.remove(completed);
            }
            if turns.is_empty() {
                live.remove(&thread_id);
            }
        }
        let overlays = live.get(&thread_id).cloned().unwrap_or_default();
        drop(live);
        let latest_live_turn = self.latest_live_turns.read().await.get(&thread_id).cloned();
        let requested_scope = params
            .get("changeScope")
            .cloned()
            .map(serde_json::from_value::<ChangeScope>)
            .transpose()?
            .unwrap_or(ChangeScope::Branch);

        let context = ResourceRequestContext {
            thread_id,
            projection,
            overlays,
            latest_live_turn,
            requested_scope,
        };

        if method == "companion/threadChangeOutput/read" {
            return self.handle_thread_change_output(params, &context).await;
        }

        if method == "companion/threadChange/read" {
            return self.handle_thread_change(params, &context).await;
        }

        let selection = match method {
            "companion/threadChanges/read" => ResourceSelection::Changes,
            "companion/threadAttachments/read" => ResourceSelection::Attachments,
            _ => ResourceSelection::All,
        };
        self.handle_thread_resources(params, &context, selection)
            .await
    }

    async fn handle_thread_change(
        &self,
        params: &Value,
        context: &ResourceRequestContext,
    ) -> Result<Value, ResourceError> {
        let requested = params
            .get("path")
            .and_then(Value::as_str)
            .filter(|value| !value.is_empty())
            .ok_or(ResourceError::MissingPath)?;
        let resolved = resolve_path(requested, context.projection.cwd.as_deref());
        let mut effective_scope = context.requested_scope;
        if let Some(vcs_scope) = context.requested_scope.vcs() {
            if let Some(response) = vcs_change_response(
                self.vcs.as_deref(),
                context.projection.cwd.as_deref(),
                &context.thread_id,
                &resolved,
                vcs_scope,
            )
            .await?
            {
                return Ok(response);
            }
            effective_scope = ChangeScope::Session;
        }
        let bucket = if effective_scope == ChangeScope::LastTurn {
            last_turn_patch(
                &context.projection,
                &context.overlays,
                context.latest_live_turn.as_deref(),
                &resolved,
            )
        } else {
            let mut bucket = context.projection.materialized_patch(&resolved);
            for overlay in context.overlays.values() {
                let resolved_overlay = overlay.resolved_against(context.projection.cwd.as_deref());
                bucket.merge_bucket(resolved_overlay.patches.get(&resolved));
            }
            bucket
        };
        Ok(json!({
            "threadId": context.thread_id,
            "path": resolved,
            "changeScope": effective_scope,
            "patches": bucket.patches,
            "truncated": bucket.truncated
        }))
    }

    async fn handle_thread_resources(
        &self,
        params: &Value,
        context: &ResourceRequestContext,
        selection: ResourceSelection,
    ) -> Result<Value, ResourceError> {
        let mut data = context.projection.materialized_summary();
        for overlay in context.overlays.values() {
            data.merge_missing_summary(
                &overlay.resolved_against(context.projection.cwd.as_deref()),
            );
        }
        self.files.observe_preview_paths(data.preview_paths()).await;

        if selection == ResourceSelection::Attachments {
            return Ok(json!({
                "threadId": context.thread_id,
                "revision": resource_revision(&data)?,
                "attachments": data.attachments
            }));
        }

        let explicit_scope = params.get("changeScope").is_some();
        let mut effective_scope = context.requested_scope;
        let vcs_snapshot = if let (Some(vcs), Some(cwd), Some(vcs_scope)) = (
            &self.vcs,
            context.projection.cwd.as_deref(),
            context.requested_scope.vcs(),
        ) {
            match vcs.changes(cwd, vcs_scope).await {
                Ok(snapshot) => Some(snapshot),
                Err(VcsError::UnsupportedWorkspace(_)) => None,
                Err(VcsError::UnsupportedScope { .. })
                    if !explicit_scope && vcs_scope == VcsScope::Branch =>
                {
                    effective_scope = ChangeScope::Unstaged;
                    match vcs.changes(cwd, VcsScope::Unstaged).await {
                        Ok(snapshot) => Some(snapshot),
                        Err(VcsError::UnsupportedWorkspace(_)) => None,
                        Err(error) => return Err(error.into()),
                    }
                }
                Err(error) => return Err(error.into()),
            }
        } else {
            None
        };

        if let Some(snapshot) = vcs_snapshot {
            let mut response =
                thread_resources_from_vcs(context.thread_id.clone(), snapshot, &data, &self.files)
                    .await?;
            remove_attachments_for_changes(&mut response, selection);
            return Ok(response);
        }
        if effective_scope.vcs().is_some() {
            effective_scope = ChangeScope::Session;
        }

        let selected_data = if effective_scope == ChangeScope::LastTurn {
            last_turn_summary(
                &context.projection,
                &context.overlays,
                context.latest_live_turn.as_deref(),
            )
        } else {
            data.clone()
        };
        let change_scopes =
            available_change_scopes(self.vcs.as_deref(), context.projection.cwd.as_deref()).await?;

        let mut changes =
            futures_util::stream::iter(selected_data.changes.values().cloned().enumerate())
                .map(|(index, change)| async move {
                    let availability = match tokio::fs::metadata(&change.path).await {
                        Ok(metadata) if metadata.is_file() => "available",
                        Err(error) if matches!(error.kind(), std::io::ErrorKind::NotFound) => {
                            "deleted"
                        }
                        Ok(_) | Err(_) => "unavailable",
                    };
                    (index, change, availability)
                })
                .buffer_unordered(32)
                .collect::<Vec<_>>()
                .await;
        changes.sort_by_key(|(index, _, _)| *index);
        let changes = changes
            .into_iter()
            .map(|(_, change, availability)| {
                let mut value = serde_json::to_value(change)?;
                if let Some(object) = value.as_object_mut() {
                    object.insert("availability".into(), Value::String(availability.into()));
                }
                Ok(value)
            })
            .collect::<Result<Vec<_>, serde_json::Error>>()?;
        let base_revision = resource_revision(&selected_data)?;
        let availability_revision = availability_revision(&changes);
        let mut response = json!({
            "threadId": context.thread_id,
            "revision": format!("{base_revision}.{availability_revision}"),
            "changeScope": effective_scope,
            "changeScopes": change_scopes,
            "changes": changes,
            "attachments": data.attachments
        });
        remove_attachments_for_changes(&mut response, selection);
        Ok(response)
    }

    /// Starts an idempotent background refresh for a thread as soon as its
    /// history is opened. A later resource request joins the same per-thread
    /// refresh instead of starting a second full scan.
    pub fn schedule_prewarm(&self, thread_id: &str) {
        if thread_id.is_empty() {
            return;
        }
        let scheduled = self
            .scheduled_prewarm
            .lock()
            .is_ok_and(|mut scheduled| scheduled.insert(thread_id.to_owned()));
        if !scheduled {
            return;
        }
        let service = self.clone();
        let thread_id = thread_id.to_owned();
        tokio::spawn(async move {
            match service.refresh_projection(&thread_id).await {
                Ok(projection) => {
                    // A thread read must make its exact attachment and changed-file
                    // paths available immediately. Previously this happened only
                    // after the Changes/Attachments sheet made a separate resource
                    // RPC, so opening the same file directly from a message could
                    // race that RPC and receive path_outside_root (403).
                    service
                        .files
                        .observe_preview_paths(projection.materialized_summary().preview_paths())
                        .await;
                }
                Err(error) => {
                    tracing::warn!(thread_id, reason = %error, "resource prewarm failed");
                }
            }
            // This set only deduplicates concurrent refreshes. A later thread
            // open must be allowed to incrementally observe attachments added
            // after this prewarm or while the companion was disconnected.
            if let Ok(mut scheduled) = service.scheduled_prewarm.lock() {
                scheduled.remove(&thread_id);
            }
        });
    }

    async fn refresh_projection(
        &self,
        thread_id: &str,
    ) -> Result<PersistedProjection, ResourceError> {
        let refresh = {
            let mut refreshes = self.refreshes.lock().await;
            refreshes
                .entry(thread_id.to_owned())
                .or_insert_with(|| Arc::new(Mutex::new(())))
                .clone()
        };
        let _guard = refresh.lock().await;
        let catalog = self.catalog.clone();
        let store = self.store.clone();
        let index = self.index.clone();
        let thread_id = thread_id.to_owned();
        tokio::task::spawn_blocking(move || {
            let path = catalog.resolve(&thread_id)?;
            store.refresh(&thread_id, &path, &index)
        })
        .await
        .map_err(|_| ResourceError::Join)?
    }

    /// Observes App Server notifications. Only the active turn is retained in
    /// memory; completed immutable data is picked up from canonical JSONL.
    pub async fn observe(&self, payload: &Value) {
        let Some(method) = payload.get("method").and_then(Value::as_str) else {
            return;
        };
        let Some(params) = payload.get("params").and_then(Value::as_object) else {
            return;
        };
        let Some(thread_id) = params.get("threadId").and_then(Value::as_str) else {
            return;
        };
        if method == "thread/deleted" {
            self.live.write().await.remove(thread_id);
            self.latest_live_turns.write().await.remove(thread_id);
            if let Err(error) = self.files.mark_thread_attachments_deleted(thread_id).await {
                tracing::warn!(thread_id, reason = %error, "attachment cleanup tombstone failed");
            }
            return;
        }
        if method == "thread/compacted" {
            self.live.write().await.remove(thread_id);
            self.latest_live_turns.write().await.remove(thread_id);
            return;
        }
        let mut completed_turn = None;
        let preview_paths = match method {
            "turn/started" | "turn/completed" => {
                let Some(turn) = params.get("turn") else {
                    return;
                };
                let Some(turn_id) = turn.get("id").and_then(Value::as_str) else {
                    return;
                };
                let mut data = ResourceData::default();
                if let Some(items) = turn.get("items").and_then(Value::as_array) {
                    for item in items {
                        data.apply_materialized_item(turn_id, item, None);
                    }
                }
                let preview_paths = data.preview_paths();
                self.live
                    .write()
                    .await
                    .entry(thread_id.to_owned())
                    .or_default()
                    .insert(turn_id.to_owned(), data);
                self.latest_live_turns
                    .write()
                    .await
                    .insert(thread_id.to_owned(), turn_id.to_owned());
                if method == "turn/completed" {
                    completed_turn = Some(turn_id.to_owned());
                }
                preview_paths
            }
            "item/started" | "item/completed" | "item/fileChange/patchUpdated" => {
                let Some(turn_id) = params.get("turnId").and_then(Value::as_str) else {
                    return;
                };
                let item = if method == "item/fileChange/patchUpdated" {
                    json!({
                        "id": params.get("itemId").and_then(Value::as_str).unwrap_or(""),
                        "type": "fileChange",
                        "changes": params.get("changes").cloned().unwrap_or_else(|| json!([]))
                    })
                } else {
                    params.get("item").cloned().unwrap_or(Value::Null)
                };
                let mut live = self.live.write().await;
                let data = live
                    .entry(thread_id.to_owned())
                    .or_default()
                    .entry(turn_id.to_owned())
                    .or_default();
                data.apply_materialized_item(turn_id, &item, None);
                let preview_paths = data.preview_paths();
                drop(live);
                self.latest_live_turns
                    .write()
                    .await
                    .insert(thread_id.to_owned(), turn_id.to_owned());
                preview_paths
            }
            _ => Vec::new(),
        };
        // Live attachments are usable as soon as their item is observed; the
        // UI must not need to open the resource sheet first to grant access.
        self.files.observe_preview_paths(preview_paths).await;
        if let Some(turn_id) = completed_turn {
            self.schedule_completed_turn_eviction(thread_id.to_owned(), turn_id);
        }
    }

    /// Authorizes previewable files returned by trusted App Server history
    /// RPCs before the response is forwarded to a client. This deliberately
    /// does not depend on the rollout file: a newly-created thread can be
    /// readable from App Server before its JSONL has appeared on disk.
    pub async fn observe_rpc_result(&self, method: &str, result: &Value) {
        let mut data = ResourceData::default();
        match method {
            "companion/threadWindow/read" | "thread/read" | "thread/resume" => {
                let Some(thread) = result.get("thread") else {
                    return;
                };
                let cwd = thread.get("cwd").and_then(Value::as_str).map(Path::new);
                observe_turns(&mut data, thread.get("turns"), cwd);
            }
            "thread/turns/list" => observe_turns(&mut data, result.get("data"), None),
            "thread/items/list" => {
                let Some(entries) = result.get("data").and_then(Value::as_array) else {
                    return;
                };
                for entry in entries {
                    let Some(item) = entry.get("item") else {
                        continue;
                    };
                    let turn_id = entry.get("turnId").and_then(Value::as_str).unwrap_or("");
                    data.apply_materialized_item(turn_id, item, None);
                }
            }
            _ => return,
        }
        self.files.observe_preview_paths(data.preview_paths()).await;
    }

    fn schedule_completed_turn_eviction(&self, thread_id: String, turn_id: String) {
        let service = self.clone();
        tokio::spawn(async move {
            for delay in COMPLETED_TURN_REFRESH_DELAYS {
                if !delay.is_zero() {
                    tokio::time::sleep(delay).await;
                }
                let Ok(projection) = service.refresh_projection(&thread_id).await else {
                    continue;
                };
                if !projection
                    .recent_completed_turns
                    .iter()
                    .any(|candidate| candidate == &turn_id)
                {
                    continue;
                }
                let mut live = service.live.write().await;
                if let Some(turns) = live.get_mut(&thread_id) {
                    turns.remove(&turn_id);
                    if turns.is_empty() {
                        live.remove(&thread_id);
                    }
                }
                drop(live);
                let mut latest = service.latest_live_turns.write().await;
                if latest.get(&thread_id) == Some(&turn_id) {
                    latest.remove(&thread_id);
                }
                return;
            }
            tracing::warn!(
                thread_id,
                turn_id,
                "completed live resource overlay is waiting for canonical rollout"
            );
        });
    }
}

fn remove_attachments_for_changes(response: &mut Value, selection: ResourceSelection) {
    if selection == ResourceSelection::Changes
        && let Some(object) = response.as_object_mut()
    {
        object.remove("attachments");
    }
}

async fn vcs_change_response(
    vcs: Option<&VcsService>,
    cwd: Option<&Path>,
    thread_id: &str,
    resolved: &str,
    scope: VcsScope,
) -> Result<Option<Value>, ResourceError> {
    let (Some(vcs), Some(cwd)) = (vcs, cwd) else {
        return Ok(None);
    };
    match vcs.diff(cwd, Path::new(resolved), scope).await {
        Ok(diff) => Ok(Some(project_vcs_diff(thread_id, &diff))),
        Err(VcsError::FileNotChanged(_)) => Ok(Some(json!({
            "threadId": thread_id,
            "path": resolved,
            "changeScope": scope,
            "patches": [],
            "source": Value::Null,
            "truncated": false
        }))),
        Err(VcsError::UnsupportedWorkspace(_)) => Ok(None),
        Err(error) => Err(error.into()),
    }
}

fn project_vcs_diff(thread_id: &str, diff: &VcsDiff) -> Value {
    json!({
        "threadId": thread_id,
        "path": diff.path,
        "changeScope": diff.scope,
        "patches": [{
            "turnId": "",
            "itemId": format!("vcs:{}:{}", diff.snapshot_id, diff.file_id),
            "kind": vcs_change_kind(diff.status),
            "diff": diff.diff
        }],
        "source": diff.source,
        "truncated": diff.truncated,
        "binary": diff.binary,
        "snapshotId": diff.snapshot_id
    })
}

async fn thread_resources_from_vcs(
    thread_id: String,
    snapshot: VcsSnapshot,
    rollout_data: &ResourceData,
    files: &FileService,
) -> Result<Value, ResourceError> {
    files
        .observe_preview_paths_within(
            snapshot.repository.root.clone(),
            snapshot
                .files
                .iter()
                .map(|file| file.path.clone())
                .collect(),
        )
        .await;
    let snapshot_id = snapshot.snapshot_id.clone();
    let mut changes = futures_util::stream::iter(snapshot.files.into_iter().enumerate())
        .map(|(index, file)| {
            let snapshot_id = snapshot_id.clone();
            async move {
                let availability = match tokio::fs::metadata(&file.path).await {
                    Ok(metadata) if metadata.is_file() => "available",
                    Err(error) if matches!(error.kind(), std::io::ErrorKind::NotFound) => "deleted",
                    Ok(_) | Err(_) => "unavailable",
                };
                let kind = vcs_change_kind(file.status);
                (
                    index,
                    json!({
                        "path": file.path,
                        "kind": kind,
                        "availability": availability,
                        "additions": file.additions.unwrap_or(0),
                        "deletions": file.deletions.unwrap_or(0),
                        "binary": file.binary,
                        "turnId": "",
                        "itemId": format!("vcs:{}:{}", snapshot_id, file.id)
                    }),
                )
            }
        })
        .buffer_unordered(32)
        .collect::<Vec<_>>()
        .await;
    changes.sort_by_key(|(index, _)| *index);
    let changes = changes
        .into_iter()
        .map(|(_, change)| change)
        .collect::<Vec<_>>();
    let attachment_revision = resource_revision(rollout_data)?;
    Ok(json!({
        "threadId": thread_id,
        "revision": format!("vcs.{}.{}", snapshot.snapshot_id, attachment_revision),
        "changeScope": snapshot.scope,
        "changeScopes": (
            [ChangeScope::Session, ChangeScope::LastTurn]
                .into_iter()
                .chain(snapshot.available_scopes.into_iter().map(ChangeScope::from))
                .collect::<Vec<_>>()
        ),
        "changes": changes,
        "attachments": rollout_data.attachments
    }))
}

impl From<VcsScope> for ChangeScope {
    fn from(scope: VcsScope) -> Self {
        match scope {
            VcsScope::Staged => Self::Staged,
            VcsScope::Unstaged => Self::Unstaged,
            VcsScope::Branch => Self::Branch,
        }
    }
}

async fn available_change_scopes(
    vcs: Option<&VcsService>,
    cwd: Option<&Path>,
) -> Result<Vec<ChangeScope>, ResourceError> {
    let mut scopes = vec![ChangeScope::Session, ChangeScope::LastTurn];
    let (Some(vcs), Some(cwd)) = (vcs, cwd) else {
        return Ok(scopes);
    };
    let snapshot = match vcs.changes(cwd, VcsScope::Branch).await {
        Ok(snapshot) => Some(snapshot),
        Err(VcsError::UnsupportedScope { .. }) => {
            match vcs.changes(cwd, VcsScope::Unstaged).await {
                Ok(snapshot) => Some(snapshot),
                Err(VcsError::UnsupportedWorkspace(_)) => None,
                Err(error) => return Err(error.into()),
            }
        }
        Err(VcsError::UnsupportedWorkspace(_)) => None,
        Err(error) => return Err(error.into()),
    };
    if let Some(snapshot) = snapshot {
        scopes.extend(snapshot.available_scopes.into_iter().map(ChangeScope::from));
    }
    scopes.dedup();
    Ok(scopes)
}

fn last_turn_id<'a>(
    projection: &'a PersistedProjection,
    latest_live_turn: Option<&'a str>,
) -> Option<&'a str> {
    latest_live_turn.or_else(|| {
        projection
            .active_turn_id
            .as_deref()
            .or_else(|| projection.turns.last().map(|turn| turn.turn_id.as_str()))
    })
}

fn last_turn_summary(
    projection: &PersistedProjection,
    overlays: &BTreeMap<String, ResourceData>,
    latest_live_turn: Option<&str>,
) -> ResourceData {
    let Some(turn_id) = last_turn_id(projection, latest_live_turn) else {
        return ResourceData::default();
    };
    let base = if projection.active_turn_id.as_deref() == Some(turn_id) {
        &projection.pending_data
    } else {
        projection
            .turns
            .iter()
            .rev()
            .find(|turn| turn.turn_id == turn_id)
            .map_or(&projection.pending_data, |turn| &turn.data)
    };
    let mut data = base.resolved_against(projection.cwd.as_deref());
    if let Some(overlay) = overlays.get(turn_id) {
        data.merge_missing_summary(&overlay.resolved_against(projection.cwd.as_deref()));
    }
    data
}

fn last_turn_patch(
    projection: &PersistedProjection,
    overlays: &BTreeMap<String, ResourceData>,
    latest_live_turn: Option<&str>,
    resolved: &str,
) -> PatchBucket {
    let Some(turn_id) = last_turn_id(projection, latest_live_turn) else {
        return PatchBucket::default();
    };
    let base = if projection.active_turn_id.as_deref() == Some(turn_id) {
        &projection.pending_data
    } else {
        projection
            .turns
            .iter()
            .rev()
            .find(|turn| turn.turn_id == turn_id)
            .map_or(&projection.pending_data, |turn| &turn.data)
    };
    let resolved_base = base.resolved_against(projection.cwd.as_deref());
    let mut bucket = resolved_base
        .patches
        .get(resolved)
        .cloned()
        .unwrap_or_default();
    if let Some(overlay) = overlays.get(turn_id) {
        let overlay = overlay.resolved_against(projection.cwd.as_deref());
        bucket.merge_bucket(overlay.patches.get(resolved));
    }
    bucket
}

fn vcs_change_kind(status: VcsFileStatus) -> &'static str {
    match status {
        VcsFileStatus::Added | VcsFileStatus::Untracked => "add",
        VcsFileStatus::Deleted => "delete",
        VcsFileStatus::Modified | VcsFileStatus::Renamed | VcsFileStatus::Conflicted => "update",
    }
}

fn observe_turns(data: &mut ResourceData, turns: Option<&Value>, cwd: Option<&Path>) {
    let Some(turns) = turns.and_then(Value::as_array) else {
        return;
    };
    for turn in turns {
        let turn_id = turn.get("id").and_then(Value::as_str).unwrap_or("");
        let Some(items) = turn.get("items").and_then(Value::as_array) else {
            continue;
        };
        for item in items {
            data.apply_materialized_item(turn_id, item, cwd);
        }
    }
}

fn recoverable_resource_database_error(error: &ResourceError) -> bool {
    match error {
        ResourceError::DatabaseOpen(redb::DatabaseError::Storage(
            redb::StorageError::Corrupted(_),
        )) => true,
        ResourceError::DatabaseOpen(redb::DatabaseError::Storage(redb::StorageError::Io(
            error,
        ))) => matches!(
            error.kind(),
            std::io::ErrorKind::InvalidData | std::io::ErrorKind::UnexpectedEof
        ),
        _ => false,
    }
}

fn corrupt_backup_path(path: &Path) -> PathBuf {
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |duration| duration.as_millis());
    let file_name = path
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("resources.redb");
    path.with_file_name(format!(
        "{file_name}.corrupt.{timestamp}.{}",
        std::process::id()
    ))
}

impl ResourceStore {
    fn open(path: impl AsRef<Path>) -> Result<Self, ResourceError> {
        let database = Database::create(path)?;
        let write = database.begin_write()?;
        write.open_table(PROJECTIONS)?;
        write.commit()?;
        Ok(Self { database })
    }

    fn load(&self, thread_id: &str) -> Result<Option<PersistedProjection>, ResourceError> {
        let read = self.database.begin_read()?;
        let table = read.open_table(PROJECTIONS)?;
        table
            .get(thread_id)?
            .map(|value| serde_json::from_slice(value.value()).map_err(ResourceError::from))
            .transpose()
    }

    fn save(&self, thread_id: &str, projection: &PersistedProjection) -> Result<(), ResourceError> {
        let encoded = serde_json::to_vec(projection)?;
        let write = self.database.begin_write()?;
        {
            let mut table = write.open_table(PROJECTIONS)?;
            table.insert(thread_id, encoded.as_slice())?;
        }
        write.commit()?;
        Ok(())
    }

    fn refresh(
        &self,
        thread_id: &str,
        path: &Path,
        index: &IndexStore,
    ) -> Result<PersistedProjection, ResourceError> {
        // Resource projection consumes every source record, unlike the chat
        // head which can be served from a tail-first index.
        index_rollout_fully(index, path)?;
        let file_id = rollout_file_id(path);
        let state = index.file_state(&file_id)?.ok_or_else(|| {
            StoreError::CorruptedIndex("rollout checkpoint is missing after indexing".into())
        })?;
        let file = File::open(path)?;
        let mut projection = self.load(thread_id)?.filter(|candidate| {
            candidate.version == PROJECTION_VERSION
                && candidate.source_path == path
                && candidate.device == state.device
                && candidate.inode == state.inode
                && candidate.indexed_bytes <= state.indexed_bytes
                && tail_hash(&file, candidate.indexed_bytes).ok() == Some(candidate.tail_hash)
        });
        let mut projection = projection.take().unwrap_or_else(|| {
            PersistedProjection::empty(path.to_path_buf(), state.device, state.inode)
        });
        let initial_offset = projection.indexed_bytes;
        for record in index.records_from(&file_id, initial_offset)? {
            // session_meta, event_msg and response_item are the only canonical
            // record families that can affect changes or attachments.
            if !matches!(record.record_type, 1 | 3 | 4) {
                continue;
            }
            let mut line =
                vec![0_u8; usize::try_from(record.length).map_err(std::io::Error::other)?];
            read_exact_at(&file, record.offset, &mut line)?;
            apply_rollout_record(&mut projection, record.offset, &line);
        }
        if projection.indexed_bytes != state.indexed_bytes {
            projection.indexed_bytes = state.indexed_bytes;
            projection.tail_hash = state.tail_hash;
            self.save(thread_id, &projection)?;
        }
        Ok(projection)
    }
}

impl ResourceData {
    fn preview_paths(&self) -> Vec<PathBuf> {
        self.changes
            .keys()
            .chain(
                self.attachments
                    .iter()
                    .filter_map(|item| item.path.as_ref()),
            )
            .map(PathBuf::from)
            .collect()
    }

    fn item_ids(&self) -> HashSet<String> {
        self.changes
            .values()
            .map(|item| item.item_id.as_str())
            .chain(self.attachments.iter().map(|item| item.item_id.as_str()))
            .chain(
                self.patches
                    .values()
                    .flat_map(|bucket| &bucket.patches)
                    .map(|item| item.item_id.as_str()),
            )
            .filter(|item_id| !item_id.is_empty())
            .map(ToOwned::to_owned)
            .collect()
    }

    fn merge_missing_summary(&mut self, other: &Self) {
        let existing_item_ids = self.item_ids();
        for change in other.changes.values() {
            if !existing_item_ids.contains(change.item_id.as_str()) {
                self.upsert_change(change.clone());
            }
        }
        for attachment in &other.attachments {
            self.upsert_attachment(attachment.clone());
        }
    }

    fn resolved_against(&self, cwd: Option<&Path>) -> Self {
        let mut resolved = Self::default();
        for change in self.changes.values() {
            let mut change = change.clone();
            change.path = resolve_path(&change.path, cwd);
            resolved.upsert_change(change);
        }
        for attachment in &self.attachments {
            let mut attachment = attachment.clone();
            if let Some(path) = attachment.path.as_deref() {
                let path = resolve_path(path, cwd);
                attachment.key = format!("path:{path}");
                attachment.path = Some(path);
            }
            resolved.upsert_attachment(attachment);
        }
        for (path, bucket) in &self.patches {
            let path = resolve_path(path, cwd);
            for patch in &bucket.patches {
                resolved.append_patch(&path, patch.clone());
            }
            if bucket.truncated {
                resolved.patches.entry(path).or_default().truncated = true;
            }
        }
        resolved
    }

    #[cfg(test)]
    fn merge(&mut self, other: &Self) {
        for change in other.changes.values() {
            self.upsert_change(change.clone());
        }
        for attachment in &other.attachments {
            self.upsert_attachment(attachment.clone());
        }
        for (path, bucket) in &other.patches {
            for patch in &bucket.patches {
                self.append_patch(path, patch.clone());
            }
            if bucket.truncated {
                self.patches.entry(path.clone()).or_default().truncated = true;
            }
        }
    }

    fn merge_summary(&mut self, other: &Self) {
        for change in other.changes.values() {
            self.upsert_change(change.clone());
        }
        for attachment in &other.attachments {
            self.upsert_attachment(attachment.clone());
        }
    }

    fn upsert_change(&mut self, change: ChangeResource) {
        if let Some(previous) = self.changes.get_mut(&change.path) {
            previous.kind = change.kind;
            previous.additions = previous.additions.saturating_add(change.additions);
            previous.deletions = previous.deletions.saturating_add(change.deletions);
            previous.turn_id = change.turn_id;
            previous.item_id = change.item_id;
        } else {
            self.changes.insert(change.path.clone(), change);
        }
    }

    fn upsert_attachment(&mut self, attachment: AttachmentResource) {
        if let Some(existing) = self
            .attachments
            .iter_mut()
            .find(|candidate| candidate.key == attachment.key)
        {
            *existing = attachment;
        } else {
            self.attachments.push(attachment);
        }
    }

    fn append_patch(&mut self, file_path: &str, change_patch: ChangePatch) {
        let bucket = self.patches.entry(file_path.to_owned()).or_default();
        if let Some(existing) = bucket.patches.iter_mut().find(|existing| {
            existing.turn_id == change_patch.turn_id && existing.item_id == change_patch.item_id
        }) {
            let next_chars = bucket
                .chars
                .saturating_sub(existing.diff.len())
                .saturating_add(change_patch.diff.len());
            if next_chars > MAX_DIFF_CHARS_PER_PATH {
                bucket.truncated = true;
                return;
            }
            bucket.chars = next_chars;
            *existing = change_patch;
        } else if bucket.chars.saturating_add(change_patch.diff.len()) > MAX_DIFF_CHARS_PER_PATH {
            bucket.truncated = true;
        } else {
            bucket.chars = bucket.chars.saturating_add(change_patch.diff.len());
            bucket.patches.push(change_patch);
        }
    }

    fn apply_change(
        &mut self,
        turn_id: &str,
        item_id: &str,
        path: &str,
        raw: &Value,
        cwd: Option<&Path>,
    ) {
        let kind_name = raw
            .get("kind")
            .and_then(|kind| {
                kind.as_str()
                    .or_else(|| kind.get("type").and_then(Value::as_str))
            })
            .or_else(|| raw.get("type").and_then(Value::as_str))
            .unwrap_or("update");
        let kind = match kind_name {
            "add" => ChangeKind::Add,
            "delete" => ChangeKind::Delete,
            _ => ChangeKind::Update,
        };
        let moved = raw
            .get("kind")
            .and_then(|kind| kind.get("move_path"))
            .or_else(|| raw.get("move_path"))
            .and_then(Value::as_str)
            .filter(|value| !value.is_empty());
        let resolved = resolve_path(moved.unwrap_or(path), cwd);
        let diff = raw
            .get("diff")
            .or_else(|| raw.get("unified_diff"))
            .or_else(|| raw.get("content"))
            .and_then(Value::as_str)
            .map(ToOwned::to_owned)
            .unwrap_or_default();
        let (additions, deletions) = diff_stats(&diff);
        self.upsert_change(ChangeResource {
            path: resolved.clone(),
            kind,
            additions,
            deletions,
            turn_id: turn_id.to_owned(),
            item_id: item_id.to_owned(),
        });
        if !diff.is_empty() {
            self.append_patch(
                &resolved,
                ChangePatch {
                    turn_id: turn_id.to_owned(),
                    item_id: item_id.to_owned(),
                    kind,
                    diff,
                },
            );
        }
    }

    fn apply_materialized_item(&mut self, turn_id: &str, item: &Value, cwd: Option<&Path>) {
        let item_id = item.get("id").and_then(Value::as_str).unwrap_or("");
        match item.get("type").and_then(Value::as_str) {
            Some("fileChange") => {
                if let Some(changes) = item.get("changes").and_then(Value::as_array) {
                    for raw in changes {
                        if let Some(path) = raw.get("path").and_then(Value::as_str) {
                            self.apply_change(turn_id, item_id, path, raw, cwd);
                        }
                    }
                }
            }
            Some("userMessage") => {
                if let Some(content) = item.get("content").and_then(Value::as_array) {
                    for part in content {
                        self.apply_user_part(turn_id, item_id, part, cwd);
                    }
                }
            }
            Some("imageView") => {
                if let Some(path) = item.get("path").and_then(Value::as_str) {
                    self.local_attachment(
                        path,
                        AttachmentKind::Image,
                        AttachmentOrigin::Agent,
                        turn_id,
                        item_id,
                        None,
                        cwd,
                    );
                }
            }
            Some("imageGeneration") => {
                if let Some(path) = item.get("savedPath").and_then(Value::as_str) {
                    self.local_attachment(
                        path,
                        AttachmentKind::Image,
                        AttachmentOrigin::Agent,
                        turn_id,
                        item_id,
                        None,
                        cwd,
                    );
                } else if let Some(url) = item
                    .get("result")
                    .and_then(Value::as_str)
                    .filter(|url| remote_url(url))
                {
                    self.remote_attachment(
                        url,
                        "Generated image",
                        AttachmentKind::Image,
                        AttachmentOrigin::Agent,
                        turn_id,
                        item_id,
                    );
                }
            }
            Some("agentMessage") => {
                if let Some(text) = item.get("text").and_then(Value::as_str) {
                    self.agent_markdown_links(text, turn_id, item_id, cwd);
                }
            }
            _ => {}
        }
    }

    fn apply_user_part(&mut self, turn_id: &str, item_id: &str, part: &Value, cwd: Option<&Path>) {
        match part.get("type").and_then(Value::as_str) {
            Some("text") => {
                if let Some(text) = part.get("text").and_then(Value::as_str) {
                    self.mentioned_files(text, turn_id, item_id, cwd);
                }
            }
            Some("localImage") => {
                self.local_part(part, "path", AttachmentKind::Image, turn_id, item_id, cwd);
            }
            Some("localAudio") => {
                self.local_part(part, "path", AttachmentKind::Audio, turn_id, item_id, cwd);
            }
            Some("mention") => {
                self.local_part(part, "path", AttachmentKind::File, turn_id, item_id, cwd);
            }
            Some("image") => self.remote_part(
                part,
                "url",
                "Image",
                AttachmentKind::Image,
                turn_id,
                item_id,
            ),
            Some("audio") => self.remote_part(
                part,
                "url",
                "Audio",
                AttachmentKind::Audio,
                turn_id,
                item_id,
            ),
            _ => {}
        }
    }

    fn local_part(
        &mut self,
        part: &Value,
        field: &str,
        kind: AttachmentKind,
        turn_id: &str,
        item_id: &str,
        cwd: Option<&Path>,
    ) {
        if let Some(path) = part.get(field).and_then(Value::as_str) {
            let name = part.get("name").and_then(Value::as_str);
            self.local_attachment(
                path,
                kind,
                AttachmentOrigin::User,
                turn_id,
                item_id,
                name,
                cwd,
            );
        }
    }

    fn remote_part(
        &mut self,
        part: &Value,
        field: &str,
        name: &str,
        kind: AttachmentKind,
        turn_id: &str,
        item_id: &str,
    ) {
        if let Some(url) = part
            .get(field)
            .and_then(Value::as_str)
            .filter(|url| remote_url(url))
        {
            self.remote_attachment(url, name, kind, AttachmentOrigin::User, turn_id, item_id);
        }
    }

    #[allow(clippy::too_many_arguments)]
    fn local_attachment(
        &mut self,
        path: &str,
        kind: AttachmentKind,
        origin: AttachmentOrigin,
        turn_id: &str,
        item_id: &str,
        name: Option<&str>,
        cwd: Option<&Path>,
    ) {
        if path.contains('\0') || path.is_empty() {
            return;
        }
        let resolved = resolve_path(path, cwd);
        let name = name
            .filter(|value| !value.is_empty())
            .map_or_else(|| file_name(&resolved), ToOwned::to_owned);
        self.upsert_attachment(AttachmentResource {
            key: format!("path:{resolved}"),
            name,
            kind,
            path: Some(resolved),
            url: None,
            origin,
            turn_id: turn_id.to_owned(),
            item_id: item_id.to_owned(),
        });
    }

    #[allow(clippy::too_many_arguments)]
    fn remote_attachment(
        &mut self,
        url: &str,
        name: &str,
        kind: AttachmentKind,
        origin: AttachmentOrigin,
        turn_id: &str,
        item_id: &str,
    ) {
        self.upsert_attachment(AttachmentResource {
            key: format!("url:{url}"),
            name: name.to_owned(),
            kind,
            path: None,
            url: Some(url.to_owned()),
            origin,
            turn_id: turn_id.to_owned(),
            item_id: item_id.to_owned(),
        });
    }

    fn mentioned_files(&mut self, text: &str, turn_id: &str, item_id: &str, cwd: Option<&Path>) {
        let mut in_files = false;
        for line in text.lines() {
            let trimmed = line.trim();
            if trimmed == "# Files mentioned by the user:" {
                in_files = true;
                continue;
            }
            if in_files && (trimmed == "## My request:" || trimmed == "## My request for Codex:") {
                break;
            }
            if !in_files {
                continue;
            }
            let Some(entry) = trimmed.strip_prefix("## ") else {
                continue;
            };
            let Some((name, raw_path)) = entry.split_once(':') else {
                continue;
            };
            let name = name.trim();
            let path = raw_path.trim().trim_matches('`');
            if !name.is_empty() && !path.is_empty() {
                self.local_attachment(
                    path,
                    attachment_kind(name, path),
                    AttachmentOrigin::User,
                    turn_id,
                    item_id,
                    Some(name),
                    cwd,
                );
            }
        }
    }

    fn agent_markdown_links(
        &mut self,
        text: &str,
        turn_id: &str,
        item_id: &str,
        cwd: Option<&Path>,
    ) {
        for path in markdown_local_paths(text) {
            self.local_attachment(
                &path,
                attachment_kind(&path, &path),
                AttachmentOrigin::Agent,
                turn_id,
                item_id,
                None,
                cwd,
            );
        }
    }
}

#[allow(clippy::too_many_lines)]
fn apply_rollout_record(projection: &mut PersistedProjection, offset: u64, line: &[u8]) {
    let Ok(envelope) = serde_json::from_slice::<Value>(line) else {
        return;
    };
    let Some(payload) = envelope.get("payload") else {
        return;
    };
    let kind = payload
        .get("type")
        .and_then(Value::as_str)
        .or_else(|| envelope.get("type").and_then(Value::as_str))
        .unwrap_or("");
    match kind {
        "session_meta" => {
            projection.cwd = payload
                .get("cwd")
                .and_then(Value::as_str)
                .filter(|value| Path::new(value).is_absolute())
                .map(PathBuf::from);
        }
        "task_started" => {
            if let Some(turn_id) = payload.get("turn_id").and_then(Value::as_str) {
                projection.started(turn_id);
            }
        }
        "task_complete" => {
            let turn_id = payload
                .get("turn_id")
                .and_then(Value::as_str)
                .or(projection.active_turn_id.as_deref())
                .unwrap_or("")
                .to_owned();
            projection.completed(&turn_id);
        }
        "turn_aborted" => {
            let turn_id = payload
                .get("turn_id")
                .and_then(Value::as_str)
                .or(projection.active_turn_id.as_deref())
                .unwrap_or("")
                .to_owned();
            projection.aborted(&turn_id);
        }
        "thread_rolled_back" => {
            let turns = payload
                .get("num_turns")
                .and_then(Value::as_u64)
                .and_then(|value| usize::try_from(value).ok())
                .unwrap_or(1);
            projection.rollback(turns);
        }
        "user_message" => {
            let turn_id = projection
                .active_turn_id
                .as_deref()
                .unwrap_or("")
                .to_owned();
            let item_id = format!("rollout-{offset}");
            let cwd = projection.cwd.clone();
            let Some(data) = projection.pending_for(&turn_id) else {
                return;
            };
            if let Some(message) = payload.get("message").and_then(Value::as_str) {
                data.mentioned_files(message, &turn_id, &item_id, cwd.as_deref());
            }
            for (field, attachment_kind, local) in [
                ("local_images", AttachmentKind::Image, true),
                ("images", AttachmentKind::Image, false),
                ("local_audio", AttachmentKind::Audio, true),
                ("audio", AttachmentKind::Audio, false),
            ] {
                let Some(values) = payload.get(field).and_then(Value::as_array) else {
                    continue;
                };
                for value in values.iter().filter_map(Value::as_str) {
                    if local {
                        data.local_attachment(
                            value,
                            attachment_kind,
                            AttachmentOrigin::User,
                            &turn_id,
                            &item_id,
                            None,
                            cwd.as_deref(),
                        );
                    } else if remote_url(value) {
                        data.remote_attachment(
                            value,
                            match attachment_kind {
                                AttachmentKind::Image => "Image",
                                AttachmentKind::Audio => "Audio",
                                AttachmentKind::File => "Attachment",
                            },
                            attachment_kind,
                            AttachmentOrigin::User,
                            &turn_id,
                            &item_id,
                        );
                    }
                }
            }
        }
        "patch_apply_end" => {
            let turn_id = payload
                .get("turn_id")
                .and_then(Value::as_str)
                .or(projection.active_turn_id.as_deref())
                .unwrap_or("")
                .to_owned();
            let item_id = payload.get("call_id").and_then(Value::as_str).unwrap_or("");
            let cwd = projection.cwd.clone();
            let Some(data) = projection.pending_for(&turn_id) else {
                return;
            };
            if let Some(changes) = payload.get("changes").and_then(Value::as_object) {
                for (path, change) in changes {
                    data.apply_change(&turn_id, item_id, path, change, cwd.as_deref());
                }
            }
        }
        "view_image_tool_call" => {
            if let Some(path) = payload.get("path").and_then(Value::as_str) {
                let turn_id = projection.active_turn_id.clone().unwrap_or_default();
                let cwd = projection.cwd.clone();
                let Some(data) = projection.pending_for(&turn_id) else {
                    return;
                };
                data.local_attachment(
                    path,
                    AttachmentKind::Image,
                    AttachmentOrigin::Agent,
                    &turn_id,
                    payload.get("call_id").and_then(Value::as_str).unwrap_or(""),
                    None,
                    cwd.as_deref(),
                );
            }
        }
        "image_generation_end" => {
            let turn_id = projection.active_turn_id.clone().unwrap_or_default();
            let item_id = payload.get("call_id").and_then(Value::as_str).unwrap_or("");
            let cwd = projection.cwd.clone();
            let Some(data) = projection.pending_for(&turn_id) else {
                return;
            };
            if let Some(path) = payload.get("saved_path").and_then(Value::as_str) {
                data.local_attachment(
                    path,
                    AttachmentKind::Image,
                    AttachmentOrigin::Agent,
                    &turn_id,
                    item_id,
                    None,
                    cwd.as_deref(),
                );
            } else if let Some(url) = payload
                .get("result")
                .and_then(Value::as_str)
                .filter(|url| remote_url(url))
            {
                data.remote_attachment(
                    url,
                    "Generated image",
                    AttachmentKind::Image,
                    AttachmentOrigin::Agent,
                    &turn_id,
                    item_id,
                );
            }
        }
        "message" if payload.get("role").and_then(Value::as_str) == Some("assistant") => {
            let turn_id = projection.active_turn_id.clone().unwrap_or_default();
            let item_id = payload.get("id").and_then(Value::as_str).unwrap_or("");
            let cwd = projection.cwd.clone();
            let Some(data) = projection.pending_for(&turn_id) else {
                return;
            };
            if let Some(content) = payload.get("content").and_then(Value::as_array) {
                for text in content.iter().filter_map(|part| {
                    part.get("text").and_then(Value::as_str).filter(|_| {
                        matches!(
                            part.get("type").and_then(Value::as_str),
                            Some("output_text" | "text")
                        )
                    })
                }) {
                    data.agent_markdown_links(text, &turn_id, item_id, cwd.as_deref());
                }
            }
        }
        _ => {}
    }
}

fn markdown_local_paths(text: &str) -> Vec<String> {
    let mut paths = Vec::new();
    let bytes = text.as_bytes();
    let mut cursor = 0;
    while cursor + 1 < bytes.len() {
        let Some(link_start) = text[cursor..].find("](") else {
            break;
        };
        let mut index = cursor + link_start + 2;
        while bytes.get(index).is_some_and(u8::is_ascii_whitespace) {
            index += 1;
        }
        let angle = bytes.get(index) == Some(&b'<');
        if angle {
            index += 1;
        }
        let start = index;
        let mut escaped = false;
        while let Some(&byte) = bytes.get(index) {
            if escaped {
                escaped = false;
                index += 1;
                continue;
            }
            if byte == b'\\' {
                escaped = true;
                index += 1;
                continue;
            }
            if (angle && byte == b'>') || (!angle && (byte == b')' || byte.is_ascii_whitespace())) {
                break;
            }
            index += 1;
        }
        cursor = index.saturating_add(1);
        if index == start || (angle && bytes.get(index) != Some(&b'>')) {
            continue;
        }
        let raw = text[start..index].replace("\\ ", " ");
        let without_fragment = raw.split_once('#').map_or(raw.as_str(), |(path, _)| path);
        let without_suffix = without_fragment
            .split_once('?')
            .map_or(without_fragment, |(path, _)| path);
        if without_suffix.is_empty()
            || without_suffix.starts_with('#')
            || without_suffix.starts_with("//")
            || has_uri_scheme(without_suffix)
        {
            continue;
        }
        if let Ok(decoded) = percent_encoding::percent_decode_str(without_suffix).decode_utf8()
            && !decoded.is_empty()
        {
            paths.push(decoded.into_owned());
        }
    }
    paths
}

fn has_uri_scheme(value: &str) -> bool {
    let Some((scheme, _rest)) = value.split_once(':') else {
        return false;
    };
    let mut bytes = scheme.bytes();
    bytes.next().is_some_and(|byte| byte.is_ascii_alphabetic())
        && bytes.all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'+' | b'.' | b'-'))
}

fn resolve_path(value: &str, cwd: Option<&Path>) -> String {
    let path = Path::new(value);
    let joined = if path.is_absolute() {
        path.to_path_buf()
    } else {
        cwd.map_or_else(|| path.to_path_buf(), |cwd| cwd.join(path))
    };
    lexical_normalize(&joined).to_string_lossy().into_owned()
}

fn lexical_normalize(path: &Path) -> PathBuf {
    let mut normalized = PathBuf::new();
    for component in path.components() {
        match component {
            Component::CurDir => {}
            Component::ParentDir => {
                if !normalized.pop() && !path.is_absolute() {
                    normalized.push("..");
                }
            }
            other => normalized.push(other.as_os_str()),
        }
    }
    normalized
}

fn diff_stats(diff: &str) -> (u64, u64) {
    let mut additions = 0_u64;
    let mut deletions = 0_u64;
    for line in diff.lines() {
        if line.starts_with("+++") || line.starts_with("---") {
            continue;
        }
        if line.starts_with('+') {
            additions = additions.saturating_add(1);
        } else if line.starts_with('-') {
            deletions = deletions.saturating_add(1);
        }
    }
    (additions, deletions)
}

fn attachment_kind(name: &str, path: &str) -> AttachmentKind {
    let extension = Path::new(path)
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    if matches!(
        extension.as_str(),
        "png" | "jpg" | "jpeg" | "gif" | "webp" | "bmp" | "avif" | "heic" | "heif"
    ) {
        AttachmentKind::Image
    } else if matches!(
        extension.as_str(),
        "wav" | "mp3" | "m4a" | "aac" | "ogg" | "flac"
    ) {
        AttachmentKind::Audio
    } else if name.to_ascii_lowercase().ends_with(".png") {
        AttachmentKind::Image
    } else {
        AttachmentKind::File
    }
}

fn file_name(path: &str) -> String {
    Path::new(path)
        .file_name()
        .and_then(|value| value.to_str())
        .filter(|value| !value.is_empty())
        .unwrap_or("Attachment")
        .to_owned()
}

fn remote_url(value: &str) -> bool {
    value.starts_with("https://") || value.starts_with("http://")
}

fn resource_revision(data: &ResourceData) -> Result<String, serde_json::Error> {
    let changes = data.changes.values().collect::<Vec<_>>();
    let raw = serde_json::to_string(&(changes, &data.attachments))?;
    let mut hash = 2_166_136_261_u32;
    for unit in raw.encode_utf16() {
        hash ^= u32::from(unit);
        hash = hash.wrapping_mul(16_777_619);
    }
    Ok(base36(hash))
}

fn availability_revision(changes: &[Value]) -> String {
    let mut raw = String::new();
    for (index, change) in changes.iter().enumerate() {
        if index > 0 {
            raw.push('\0');
        }
        raw.push_str(change.get("path").and_then(Value::as_str).unwrap_or(""));
        raw.push('\0');
        raw.push_str(
            change
                .get("availability")
                .and_then(Value::as_str)
                .unwrap_or("unavailable"),
        );
    }
    hex::encode(Sha256::digest(raw.as_bytes()))[..12].to_owned()
}

fn base36(mut value: u32) -> String {
    if value == 0 {
        return "0".into();
    }
    let mut output = Vec::new();
    while value > 0 {
        let digit = u8::try_from(value % 36).unwrap_or(0);
        output.push(if digit < 10 {
            b'0' + digit
        } else {
            b'a' + digit - 10
        });
        value /= 36;
    }
    output.reverse();
    String::from_utf8(output).unwrap_or_default()
}

#[cfg(unix)]
fn read_exact_at(file: &File, offset: u64, buffer: &mut [u8]) -> Result<(), std::io::Error> {
    let mut read = 0;
    while read < buffer.len() {
        let count = file.read_at(&mut buffer[read..], offset + read as u64)?;
        if count == 0 {
            return Err(std::io::Error::from(std::io::ErrorKind::UnexpectedEof));
        }
        read += count;
    }
    Ok(())
}

#[cfg(not(unix))]
fn read_exact_at(file: &File, offset: u64, buffer: &mut [u8]) -> Result<(), std::io::Error> {
    let mut snapshot = file.try_clone()?;
    snapshot.seek(SeekFrom::Start(offset))?;
    snapshot.read_exact(&mut buffer)?;
    Ok(())
}

#[cfg(unix)]
fn tail_hash(file: &File, indexed_bytes: u64) -> Result<[u8; 32], std::io::Error> {
    if indexed_bytes == 0 {
        return Ok([0; 32]);
    }
    let bytes = TAIL_CHECK_BYTES.min(indexed_bytes);
    let start = indexed_bytes - bytes;
    let mut buffer = vec![0_u8; usize::try_from(bytes).map_err(std::io::Error::other)?];
    read_exact_at(file, start, &mut buffer)?;
    Ok(*blake3::hash(&buffer).as_bytes())
}

#[cfg(not(unix))]
fn tail_hash(file: &File, indexed_bytes: u64) -> Result<[u8; 32], std::io::Error> {
    if indexed_bytes == 0 {
        return Ok([0; 32]);
    }
    let bytes = TAIL_CHECK_BYTES.min(indexed_bytes);
    let mut snapshot = file.try_clone()?;
    snapshot.seek(SeekFrom::Start(indexed_bytes - bytes))?;
    let mut buffer = vec![0_u8; usize::try_from(bytes).map_err(std::io::Error::other)?];
    snapshot.read_exact(&mut buffer)?;
    Ok(*blake3::hash(&buffer).as_bytes())
}

#[cfg(test)]
#[allow(clippy::expect_used)]
mod tests {
    use super::*;

    #[test]
    fn next_turn_commits_resources_from_an_interrupted_turn() {
        let source = PathBuf::from("/tmp/session.jsonl");
        let mut projection = PersistedProjection::empty(source, 1, 2);
        projection.started("interrupted");
        let pending = projection.pending_for("interrupted");
        assert!(pending.is_some());
        if let Some(pending) = pending {
            pending.local_attachment(
                "/tmp/photo.png",
                AttachmentKind::Image,
                AttachmentOrigin::User,
                "interrupted",
                "message",
                None,
                None,
            );
        }
        assert_eq!(projection.materialized_data().attachments.len(), 1);

        projection.started("next");

        assert_eq!(projection.turns.len(), 1);
        assert_eq!(projection.turns[0].turn_id, "interrupted");
        assert_eq!(projection.materialized_data().attachments.len(), 1);
        assert_eq!(projection.active_turn_id.as_deref(), Some("next"));
    }

    #[test]
    fn normalizes_paths_diffs_and_metadata_attachments() {
        assert_eq!(
            resolve_path("src/../src/a.ts", Some(Path::new("/workspace/project"))),
            "/workspace/project/src/a.ts"
        );
        assert_eq!(diff_stats("--- a\n+++ b\n-old\n+new\n"), (1, 1));
        let mut data = ResourceData::default();
        data.mentioned_files(
            "# Files mentioned by the user:\n\n## Photo 1.jpg: `/tmp/photo.jpg`\n\n## My request for Codex:\nHi",
            "turn",
            "item",
            None,
        );
        assert_eq!(data.attachments.len(), 1);
        assert_eq!(data.attachments[0].kind, AttachmentKind::Image);
    }

    #[test]
    fn extracts_only_local_markdown_links_from_agent_text() {
        assert_eq!(
            markdown_local_paths(
                "[relative](<../reports/final report.md>) [absolute](/tmp/result.png) \
                 [web](https://example.com/a.md) [anchor](#details)"
            ),
            vec!["../reports/final report.md", "/tmp/result.png"]
        );
    }

    #[test]
    fn streaming_patch_updates_replace_the_same_item() {
        let mut data = ResourceData::default();
        data.apply_change(
            "turn",
            "item",
            "/tmp/file.rs",
            &json!({"type":"update","diff":"+first\n"}),
            None,
        );
        data.apply_change(
            "turn",
            "item",
            "/tmp/file.rs",
            &json!({"type":"update","diff":"+second\n"}),
            None,
        );

        let bucket = data.patches.get("/tmp/file.rs").expect("patch bucket");
        assert_eq!(bucket.patches.len(), 1);
        assert_eq!(bucket.patches[0].diff, "+second\n");
        assert_eq!(bucket.chars, "+second\n".len());
    }

    #[test]
    fn resource_projection_consumes_the_shared_rollout_index()
    -> Result<(), Box<dyn std::error::Error>> {
        let directory = tempfile::tempdir()?;
        let rollout = directory.path().join("rollout.jsonl");
        std::fs::write(
            &rollout,
            concat!(
                "{\"type\":\"session_meta\",\"payload\":{\"type\":\"session_meta\",\"id\":\"thread\",\"cwd\":\"/repo\",\"source\":\"cli\"}}\n",
                "{\"type\":\"event_msg\",\"payload\":{\"type\":\"task_started\",\"turn_id\":\"turn\"}}\n",
                "{\"type\":\"event_msg\",\"payload\":{\"type\":\"patch_apply_end\",\"call_id\":\"patch\",\"changes\":{\"src/a.rs\":{\"type\":\"update\",\"diff\":\"-old\\n+new\\n\"}}}}\n",
                "{\"type\":\"response_item\",\"payload\":{\"type\":\"message\",\"id\":\"answer\",\"role\":\"assistant\",\"content\":[{\"type\":\"output_text\",\"text\":\"[report](/tmp/report.md)\"}]}}\n",
                "{\"type\":\"event_msg\",\"payload\":{\"type\":\"task_complete\",\"turn_id\":\"turn\"}}\n",
            ),
        )?;
        let index = IndexStore::open(directory.path().join("index.redb"))?;
        let resources = ResourceStore::open(directory.path().join("resources.redb"))?;

        let projection = resources.refresh("thread", &rollout, &index)?;
        let data = projection.materialized_data();

        assert!(data.changes.contains_key("/repo/src/a.rs"));
        assert!(
            data.attachments
                .iter()
                .any(|attachment| attachment.path.as_deref() == Some("/tmp/report.md"))
        );
        assert_eq!(projection.indexed_bytes, std::fs::metadata(&rollout)?.len());

        std::fs::write(
            &rollout,
            concat!(
                "{\"type\":\"session_meta\",\"payload\":{\"type\":\"session_meta\",\"id\":\"thread\",\"cwd\":\"/repo\",\"source\":\"cli\"}}\n",
                "{\"type\":\"event_msg\",\"payload\":{\"type\":\"task_started\",\"turn_id\":\"turn\"}}\n",
                "{\"type\":\"event_msg\",\"payload\":{\"type\":\"patch_apply_end\",\"call_id\":\"patch\",\"changes\":{\"src/b.rs\":{\"type\":\"update\",\"diff\":\"-old\\n+new\\n\"}}}}\n",
                "{\"type\":\"event_msg\",\"payload\":{\"type\":\"task_complete\",\"turn_id\":\"turn\"}}\n",
            ),
        )?;
        let replaced = resources
            .refresh("thread", &rollout, &index)?
            .materialized_data();
        assert!(!replaced.changes.contains_key("/repo/src/a.rs"));
        assert!(replaced.changes.contains_key("/repo/src/b.rs"));
        assert!(replaced.attachments.is_empty());
        Ok(())
    }

    #[test]
    fn last_turn_scope_excludes_changes_from_earlier_turns() {
        let mut projection = PersistedProjection::empty(PathBuf::from("/tmp/session.jsonl"), 1, 2);
        projection.cwd = Some(PathBuf::from("/workspace"));
        let mut first = ResourceData::default();
        first.apply_change(
            "turn-1",
            "item-1",
            "first.rs",
            &json!({ "type": "update", "diff": "-old\n+first\n" }),
            projection.cwd.as_deref(),
        );
        let mut second = ResourceData::default();
        second.apply_change(
            "turn-2",
            "item-2",
            "second.rs",
            &json!({ "type": "update", "diff": "-old\n+second\n" }),
            projection.cwd.as_deref(),
        );
        projection.turns = vec![
            TurnResourceData {
                turn_id: "turn-1".into(),
                data: first,
            },
            TurnResourceData {
                turn_id: "turn-2".into(),
                data: second,
            },
        ];

        let session = projection.materialized_summary();
        assert_eq!(session.changes.len(), 2);
        assert!(session.changes.contains_key("/workspace/first.rs"));
        assert!(session.changes.contains_key("/workspace/second.rs"));

        let selected = last_turn_summary(&projection, &BTreeMap::new(), None);
        assert_eq!(selected.changes.len(), 1);
        assert!(selected.changes.contains_key("/workspace/second.rs"));
        assert!(
            last_turn_patch(&projection, &BTreeMap::new(), None, "/workspace/first.rs")
                .patches
                .is_empty()
        );
        assert_eq!(
            last_turn_patch(&projection, &BTreeMap::new(), None, "/workspace/second.rs").patches[0]
                .item_id,
            "item-2"
        );

        let mut live = ResourceData::default();
        live.apply_change(
            "turn-live",
            "item-live",
            "live.rs",
            &json!({ "type": "update", "diff": "+live\n" }),
            projection.cwd.as_deref(),
        );
        let overlays = BTreeMap::from([("turn-live".into(), live)]);
        let selected_live = last_turn_summary(&projection, &overlays, Some("turn-live"));
        assert_eq!(selected_live.changes.len(), 1);
        assert!(selected_live.changes.contains_key("/workspace/live.rs"));
    }

    #[tokio::test]
    async fn session_and_last_turn_scopes_remain_available_without_vcs() {
        assert_eq!(
            available_change_scopes(None, None)
                .await
                .expect("change scopes"),
            vec![ChangeScope::Session, ChangeScope::LastTurn]
        );
    }

    #[test]
    fn vcs_diff_projects_into_the_existing_android_patch_contract() {
        let value = project_vcs_diff(
            "thread",
            &VcsDiff {
                capability: crate::vcs::DIFF_CAPABILITY.into(),
                repository: crate::vcs::VcsRepository {
                    provider: "arc".into(),
                    root: PathBuf::from("/arcadia"),
                    branch: Some("feature".into()),
                    head: Some("abc".into()),
                    base: Some("base".into()),
                },
                scope: VcsScope::Branch,
                snapshot_id: "snapshot".into(),
                file_id: "file".into(),
                path: PathBuf::from("/arcadia/file.rs"),
                old_path: None,
                status: VcsFileStatus::Modified,
                diff: "@@ -1 +1 @@\n-old\n+new\n".into(),
                source: Some("new\n".into()),
                truncated: false,
                binary: false,
                additions: 1,
                deletions: 1,
            },
        );
        assert_eq!(value["threadId"], "thread");
        assert_eq!(value["patches"][0]["kind"], "update");
        assert_eq!(value["patches"][0]["itemId"], "vcs:snapshot:file");
        assert_eq!(value["patches"][0]["diff"], "@@ -1 +1 @@\n-old\n+new\n");
        assert_eq!(value["source"], "new\n");
        assert_eq!(value["snapshotId"], "snapshot");
    }

    #[tokio::test]
    #[cfg(unix)]
    #[allow(clippy::too_many_lines)]
    async fn vcs_snapshot_replaces_rollout_changes_without_dropping_attachments() {
        let directory = tempfile::tempdir().expect("temp directory");
        let repository = directory.path().join("repository");
        std::fs::create_dir(&repository).expect("repository directory");
        let changed = repository.join("changed.rs");
        std::fs::write(&changed, "changed").expect("changed file");
        let outside = directory.path().join("outside.rs");
        std::fs::write(&outside, "private").expect("outside file");
        let escaped = repository.join("escaped.rs");
        std::os::unix::fs::symlink(&outside, &escaped).expect("escaped symlink");
        let files = FileService::open(HashMap::new(), Vec::new(), None, None)
            .await
            .expect("file service");
        let mut rollout = ResourceData::default();
        rollout.attachments.push(AttachmentResource {
            key: "attachment".into(),
            name: "notes.md".into(),
            kind: AttachmentKind::File,
            path: Some("/tmp/notes.md".into()),
            url: None,
            origin: AttachmentOrigin::User,
            turn_id: "turn".into(),
            item_id: "message".into(),
        });
        let snapshot = VcsSnapshot {
            capability: crate::vcs::CHANGES_CAPABILITY.into(),
            repository: crate::vcs::VcsRepository {
                provider: "arc".into(),
                root: repository,
                branch: Some("feature".into()),
                head: Some("abc".into()),
                base: Some("base".into()),
            },
            scope: VcsScope::Branch,
            available_scopes: vec![VcsScope::Staged, VcsScope::Unstaged, VcsScope::Branch],
            snapshot_id: "snapshot".into(),
            state: crate::vcs::VcsState::Dirty,
            summary: crate::vcs::VcsSummary {
                total: 2,
                modified: 2,
                ..crate::vcs::VcsSummary::default()
            },
            files: vec![
                crate::vcs::VcsFile {
                    id: "file".into(),
                    path: changed.clone(),
                    old_path: None,
                    status: VcsFileStatus::Modified,
                    staged: false,
                    additions: Some(1),
                    deletions: Some(1),
                    binary: false,
                    conflict: None,
                },
                crate::vcs::VcsFile {
                    id: "escaped".into(),
                    path: escaped.clone(),
                    old_path: None,
                    status: VcsFileStatus::Modified,
                    staged: false,
                    additions: Some(1),
                    deletions: Some(1),
                    binary: false,
                    conflict: None,
                },
            ],
        };

        let preview_query = |path: &Path| crate::files::FileQuery {
            root_id: None,
            path: Some(path.to_string_lossy().into_owned()),
        };
        assert!(matches!(
            files
                .download(
                    preview_query(&changed),
                    &axum::http::HeaderMap::new(),
                    false,
                    true
                )
                .await,
            Err(crate::files::FileError::Client {
                status: axum::http::StatusCode::FORBIDDEN,
                code: "path_outside_root"
            })
        ));

        let value = thread_resources_from_vcs("thread".into(), snapshot, &rollout, &files)
            .await
            .expect("resources project");

        assert_eq!(
            files
                .download(
                    preview_query(&changed),
                    &axum::http::HeaderMap::new(),
                    false,
                    true
                )
                .await
                .expect("changed file preview")
                .status(),
            axum::http::StatusCode::OK
        );
        assert!(matches!(
            files
                .download(
                    preview_query(&escaped),
                    &axum::http::HeaderMap::new(),
                    false,
                    true
                )
                .await,
            Err(crate::files::FileError::Client {
                status: axum::http::StatusCode::FORBIDDEN,
                code: "path_outside_root"
            })
        ));

        assert_eq!(
            value["changes"][0]["path"].as_str(),
            Some(changed.to_string_lossy().as_ref())
        );
        assert_eq!(value["changes"][0]["availability"], "available");
        assert_eq!(value["changes"][0]["additions"], 1);
        assert_eq!(value["changes"][0]["deletions"], 1);
        assert_eq!(value["changes"][0]["binary"], false);
        assert_eq!(value["changes"][0]["itemId"], "vcs:snapshot:file");
        assert_eq!(value["attachments"][0]["key"], "attachment");
        assert_eq!(
            value["changeScopes"],
            json!(["session", "lastTurn", "staged", "unstaged", "branch"])
        );
        assert!(
            value["revision"]
                .as_str()
                .is_some_and(|revision| revision.starts_with("vcs.snapshot."))
        );
    }
}
