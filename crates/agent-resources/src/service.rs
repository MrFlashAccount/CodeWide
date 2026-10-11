//! Thread resource reads over a provider's projection source: the
//! `companion/threadResources|threadChanges|threadAttachments|threadChange`
//! responses, the VCS overlay, and the live overlay of the mutable turn
//! observed on the client-wire event stream.

use std::{
    collections::{BTreeMap, HashMap, HashSet},
    path::Path,
    sync::Arc,
    time::Duration,
};

use async_trait::async_trait;
use companion_host::{
    files::PreviewFiles,
    vcs::{VcsDiff, VcsError, VcsScope, VcsSnapshot, WorkspaceVcs},
};
use futures_util::StreamExt;
use serde_json::{Value, json};
use tokio::sync::{Mutex, RwLock};

use crate::{
    ResourceError,
    data::{
        ChangeScope, ResourceData, availability_revision, observe_turn, observe_turns,
        resolve_path, resource_revision, vcs_change_kind,
    },
    projection::{ResourceProjection, last_turn_patch, last_turn_summary},
};

const COMPLETED_TURN_REFRESH_DELAYS: [Duration; 6] = [
    Duration::ZERO,
    Duration::from_millis(100),
    Duration::from_millis(250),
    Duration::from_millis(500),
    Duration::from_secs(1),
    Duration::from_secs(2),
];

/// Where a provider's immutable resource projection comes from.
#[async_trait]
pub trait ProjectionSource: Send + Sync + 'static {
    type Projection: AsRef<ResourceProjection> + Send + Sync + 'static;

    /// The thread's projection, refreshed from the provider's history.
    ///
    /// # Errors
    ///
    /// Returns the provider's failure to read the thread's history.
    async fn refresh(&self, thread_id: &str) -> Result<Self::Projection, ResourceError>;
}

/// Thread resource reads of one provider.
pub struct ThreadResources<S> {
    source: Arc<S>,
    files: Arc<dyn PreviewFiles>,
    live: Arc<RwLock<HashMap<String, BTreeMap<String, ResourceData>>>>,
    latest_live_turns: Arc<RwLock<HashMap<String, String>>>,
    refreshes: Arc<Mutex<HashMap<String, Arc<Mutex<()>>>>>,
    scheduled_prewarm: Arc<std::sync::Mutex<HashSet<String>>>,
    vcs: Option<Arc<dyn WorkspaceVcs>>,
}

impl<S> Clone for ThreadResources<S> {
    fn clone(&self) -> Self {
        Self {
            source: self.source.clone(),
            files: self.files.clone(),
            live: self.live.clone(),
            latest_live_turns: self.latest_live_turns.clone(),
            refreshes: self.refreshes.clone(),
            scheduled_prewarm: self.scheduled_prewarm.clone(),
            vcs: self.vcs.clone(),
        }
    }
}

/// One thread-scoped resource request after refresh.
pub struct ResourceRequestContext<P> {
    pub thread_id: String,
    pub projection: P,
    pub overlays: BTreeMap<String, ResourceData>,
    pub latest_live_turn: Option<String>,
    pub requested_scope: ChangeScope,
}

#[derive(Clone, Copy, Eq, PartialEq)]
pub(crate) enum ResourceSelection {
    All,
    Changes,
    Attachments,
}

impl<S: ProjectionSource> ThreadResources<S> {
    /// Resources over `source`, observing preview paths through `files`.
    #[must_use]
    pub fn new(source: Arc<S>, files: Arc<dyn PreviewFiles>) -> Self {
        Self {
            source,
            files,
            live: Arc::new(RwLock::new(HashMap::new())),
            latest_live_turns: Arc::new(RwLock::new(HashMap::new())),
            refreshes: Arc::new(Mutex::new(HashMap::new())),
            scheduled_prewarm: Arc::new(std::sync::Mutex::new(HashSet::new())),
            vcs: None,
        }
    }

    /// The provider's projection source.
    #[must_use]
    pub fn source(&self) -> &S {
        &self.source
    }

    /// The workspace VCS, when attached.
    #[must_use]
    pub fn vcs(&self) -> Option<&dyn WorkspaceVcs> {
        self.vcs.as_deref()
    }

    #[must_use]
    pub fn with_vcs(mut self, vcs: Arc<dyn WorkspaceVcs>) -> Self {
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
        let context = self.context(params).await?;
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

    /// The refreshed projection, live overlays and requested scope of a
    /// thread-scoped resource request.
    ///
    /// # Errors
    ///
    /// Returns an error for a missing thread id, an unreadable source or an
    /// invalid change scope.
    pub async fn context(
        &self,
        params: &Value,
    ) -> Result<ResourceRequestContext<S::Projection>, ResourceError> {
        let thread_id = params
            .get("threadId")
            .and_then(Value::as_str)
            .filter(|value| !value.is_empty())
            .ok_or(ResourceError::MissingThreadId)?
            .to_owned();
        let projection = self.refresh_projection(&thread_id).await?;

        let mut live = self.live.write().await;
        if let Some(turns) = live.get_mut(&thread_id) {
            for completed in &projection.as_ref().recent_completed_turns {
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
        Ok(ResourceRequestContext {
            thread_id,
            projection,
            overlays,
            latest_live_turn,
            requested_scope,
        })
    }

    async fn handle_thread_change(
        &self,
        params: &Value,
        context: &ResourceRequestContext<S::Projection>,
    ) -> Result<Value, ResourceError> {
        let requested = params
            .get("path")
            .and_then(Value::as_str)
            .filter(|value| !value.is_empty())
            .ok_or(ResourceError::MissingPath)?;
        let resolved = resolve_path(requested, context.projection.as_ref().cwd.as_deref());
        let mut effective_scope = context.requested_scope;
        if let Some(vcs_scope) = context.requested_scope.vcs() {
            if let Some(response) = vcs_change_response(
                self.vcs.as_deref(),
                context.projection.as_ref().cwd.as_deref(),
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
                context.projection.as_ref(),
                &context.overlays,
                context.latest_live_turn.as_deref(),
                &resolved,
            )
        } else {
            let mut bucket = context.projection.as_ref().materialized_patch(&resolved);
            for overlay in context.overlays.values() {
                let resolved_overlay =
                    overlay.resolved_against(context.projection.as_ref().cwd.as_deref());
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
        context: &ResourceRequestContext<S::Projection>,
        selection: ResourceSelection,
    ) -> Result<Value, ResourceError> {
        let projection = context.projection.as_ref();
        let mut data = projection.materialized_summary();
        for overlay in context.overlays.values() {
            data.merge_missing_summary(&overlay.resolved_against(projection.cwd.as_deref()));
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
            projection.cwd.as_deref(),
            context.requested_scope.vcs(),
        ) {
            match vcs.changes(cwd, vcs_scope).await {
                Ok(snapshot) => Some(snapshot),
                Err(VcsError::UnsupportedWorkspace(_)) => None,
                Err(VcsError::UnsupportedScope { .. })
                    if !explicit_scope && vcs_scope == VcsScope::Branch =>
                {
                    effective_scope = ChangeScope::Uncommitted;
                    match vcs.changes(cwd, VcsScope::Uncommitted).await {
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
                thread_resources_from_vcs(context.thread_id.clone(), snapshot, &data, &*self.files)
                    .await?;
            remove_attachments_for_changes(&mut response, selection);
            return Ok(response);
        }
        if effective_scope.vcs().is_some() {
            effective_scope = ChangeScope::Session;
        }

        let selected_data = if effective_scope == ChangeScope::LastTurn {
            last_turn_summary(
                projection,
                &context.overlays,
                context.latest_live_turn.as_deref(),
            )
        } else {
            data.clone()
        };
        let change_scopes =
            available_change_scopes(self.vcs.as_deref(), projection.cwd.as_deref()).await?;

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
                    // Keep the persisted preview registry current for older local
                    // state readers even though authenticated HTTP reads are now
                    // host-wide in both protocol generations.
                    service
                        .files
                        .observe_preview_paths(
                            projection.as_ref().materialized_summary().preview_paths(),
                        )
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

    async fn refresh_projection(&self, thread_id: &str) -> Result<S::Projection, ResourceError> {
        let refresh = {
            let mut refreshes = self.refreshes.lock().await;
            refreshes
                .entry(thread_id.to_owned())
                .or_insert_with(|| Arc::new(Mutex::new(())))
                .clone()
        };
        let _guard = refresh.lock().await;
        self.source.refresh(thread_id).await
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
            "companion/thread/sync" => {
                let cwd = result
                    .get("thread")
                    .and_then(|thread| thread.get("cwd"))
                    .and_then(Value::as_str)
                    .map(Path::new);
                observe_turns(&mut data, result.pointer("/history/turns"), cwd);
                if let Some(active_turn) = result.get("activeTurn")
                    && !active_turn.is_null()
                {
                    observe_turn(&mut data, active_turn, cwd);
                }
            }
            "thread/read" | "thread/resume" => {
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
                    .as_ref()
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

pub(crate) fn remove_attachments_for_changes(response: &mut Value, selection: ResourceSelection) {
    if selection == ResourceSelection::Changes
        && let Some(object) = response.as_object_mut()
    {
        object.remove("attachments");
    }
}

pub(crate) async fn vcs_change_response(
    vcs: Option<&dyn WorkspaceVcs>,
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

pub(crate) fn project_vcs_diff(thread_id: &str, diff: &VcsDiff) -> Value {
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

pub(crate) async fn thread_resources_from_vcs(
    thread_id: String,
    snapshot: VcsSnapshot,
    rollout_data: &ResourceData,
    files: &dyn PreviewFiles,
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
    let vcs = json!({
        "provider": snapshot.repository.provider,
        "branch": snapshot.repository.branch
    });
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
        "changeScopes": changes_menu_scopes(&snapshot.available_scopes),
        "vcs": vcs,
        "changes": changes,
        "attachments": rollout_data.attachments
    }))
}

impl From<VcsScope> for ChangeScope {
    fn from(scope: VcsScope) -> Self {
        match scope {
            VcsScope::Staged => Self::Staged,
            VcsScope::Unstaged => Self::Unstaged,
            VcsScope::Uncommitted => Self::Uncommitted,
            VcsScope::Branch => Self::Branch,
        }
    }
}

pub(crate) async fn available_change_scopes(
    vcs: Option<&dyn WorkspaceVcs>,
    cwd: Option<&Path>,
) -> Result<Vec<ChangeScope>, ResourceError> {
    let mut scopes = vec![ChangeScope::Session];
    let (Some(vcs), Some(cwd)) = (vcs, cwd) else {
        return Ok(scopes);
    };
    let snapshot = match vcs.changes(cwd, VcsScope::Branch).await {
        Ok(snapshot) => Some(snapshot),
        Err(VcsError::UnsupportedScope { .. }) => {
            match vcs.changes(cwd, VcsScope::Uncommitted).await {
                Ok(snapshot) => Some(snapshot),
                Err(VcsError::UnsupportedWorkspace(_)) => None,
                Err(error) => return Err(error.into()),
            }
        }
        Err(VcsError::UnsupportedWorkspace(_)) => None,
        Err(error) => return Err(error.into()),
    };
    if let Some(snapshot) = snapshot {
        scopes = changes_menu_scopes(&snapshot.available_scopes);
    }
    Ok(scopes)
}

pub(crate) fn changes_menu_scopes(available: &[VcsScope]) -> Vec<ChangeScope> {
    let mut scopes = vec![ChangeScope::Session];
    if available.contains(&VcsScope::Uncommitted) {
        scopes.push(ChangeScope::Uncommitted);
    }
    if available.contains(&VcsScope::Branch) {
        scopes.push(ChangeScope::Branch);
    }
    scopes
}
