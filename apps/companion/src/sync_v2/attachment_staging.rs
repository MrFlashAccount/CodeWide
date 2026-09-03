//! Durable, device-bound staging for V2 composer attachments.

use std::{
    collections::{HashMap, HashSet},
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
    time::{Duration, SystemTime, UNIX_EPOCH},
};

use base64::{Engine as _, engine::general_purpose::URL_SAFE_NO_PAD};
use bytes::Bytes;
use futures_util::{Stream, StreamExt};
use rand::{TryRngCore, rngs::OsRng};
use redb::{Database, ReadableDatabase, ReadableTable, Table, TableDefinition};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tokio::{
    fs::OpenOptions,
    io::AsyncWriteExt,
    sync::{RwLock, watch},
};

use super::{
    AuthenticatedContextKey,
    domain::Attachment,
    protocol::AttachmentStageRequest,
    scalar::{Id, OperationId, U64},
};
use crate::auth::{AuthorizationChange, AuthorizationContext};

const RECORDS: TableDefinition<&str, &[u8]> = TableDefinition::new("sync_v2_attachment_stages");
const RETENTION_MS: u64 = 72 * 60 * 60 * 1_000;
const GC_INTERVAL: Duration = Duration::from_mins(15);
const UPLOAD_IDLE_TIMEOUT: Duration = Duration::from_secs(30);
const UPLOAD_TOTAL_TIMEOUT: Duration = Duration::from_mins(30);

#[derive(Clone, Copy, Debug)]
struct AttachmentStageLimits {
    device_count: u64,
    device_bytes: u64,
    global_count: u64,
    global_bytes: u64,
}

impl Default for AttachmentStageLimits {
    fn default() -> Self {
        Self {
            device_count: 128,
            device_bytes: 4 * 1024 * 1024 * 1024,
            global_count: 1_024,
            global_bytes: 32 * 1024 * 1024 * 1024,
        }
    }
}

#[derive(Clone)]
pub struct AttachmentStageStore {
    database: Arc<Database>,
    root: Arc<PathBuf>,
    limits: AttachmentStageLimits,
    filesystem_guard: Arc<RwLock<()>>,
    admission: Arc<tokio::sync::Mutex<()>>,
    cancellations: Arc<Mutex<HashMap<String, watch::Sender<bool>>>>,
}

struct UploadResetGuard {
    store: AttachmentStageStore,
    id: Id,
    armed: bool,
}

impl UploadResetGuard {
    fn new(store: AttachmentStageStore, id: Id) -> Self {
        Self {
            store,
            id,
            armed: true,
        }
    }

    const fn disarm(&mut self) {
        self.armed = false;
    }
}

impl Drop for UploadResetGuard {
    fn drop(&mut self) {
        if self.armed
            && let Err(error) = self.store.reset_upload(&self.id)
        {
            tracing::warn!(%error, "failed to release abandoned attachment upload claim");
        }
    }
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct StageRecord {
    owner: String,
    workspace: Option<String>,
    thread_id: Option<String>,
    name: String,
    media_type: String,
    size_bytes: u64,
    sha256: String,
    expires_at: u64,
    state: StageState,
    #[serde(default)]
    reservation_id: Option<String>,
    #[serde(default)]
    inferred_workspace: bool,
}

#[derive(Default)]
struct StageUsage {
    device_count: u64,
    device_bytes: u64,
    global_count: u64,
    global_bytes: u64,
}

struct GarbageCollectionPlan {
    removed_ids: Vec<String>,
    retained_blobs: HashSet<String>,
    retained_parts: HashSet<String>,
}

impl StageUsage {
    fn add(
        &mut self,
        record: &StageRecord,
        candidate_owner: &str,
    ) -> Result<(), AttachmentStageError> {
        self.global_count = checked_add(self.global_count, 1)?;
        self.global_bytes = checked_add(self.global_bytes, record.size_bytes)?;
        if record.owner == candidate_owner {
            self.device_count = checked_add(self.device_count, 1)?;
            self.device_bytes = checked_add(self.device_bytes, record.size_bytes)?;
        }
        Ok(())
    }

    fn admit(
        &self,
        candidate_bytes: u64,
        limits: AttachmentStageLimits,
    ) -> Result<(), AttachmentStageError> {
        let device_count = checked_add(self.device_count, 1)?;
        let device_bytes = checked_add(self.device_bytes, candidate_bytes)?;
        let global_count = checked_add(self.global_count, 1)?;
        let global_bytes = checked_add(self.global_bytes, candidate_bytes)?;
        if device_count > limits.device_count
            || device_bytes > limits.device_bytes
            || global_count > limits.global_count
            || global_bytes > limits.global_bytes
        {
            return Err(AttachmentStageError::QuotaExceeded);
        }
        Ok(())
    }
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
enum StageState {
    Pending,
    Uploading,
    Completed,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct StagedAttachment {
    pub attachment: Attachment,
    pub sha256: String,
    pub workspace: Option<String>,
    pub path: PathBuf,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum StageStatus {
    Pending,
    Completed,
}

#[derive(Debug, thiserror::Error)]
pub enum AttachmentStageError {
    #[error("attachment stage is invalid")]
    Invalid,
    #[error("attachment stage was not found")]
    NotFound,
    #[error("attachment stage belongs to another device or target")]
    Forbidden,
    #[error("attachment stage is expired")]
    Expired,
    #[error("attachment stage is busy or already completed")]
    Conflict,
    #[error("attachment staging quota exceeded")]
    QuotaExceeded,
    #[error("attachment upload was cancelled")]
    Cancelled,
    #[error("attachment upload timed out")]
    Timeout,
    #[error("attachment bytes do not match the declared size or digest")]
    Integrity,
    #[error("attachment stage storage failed: {0}")]
    Storage(String),
}

impl AttachmentStageStore {
    /// Opens the durable metadata database and private blob directory.
    ///
    /// # Errors
    /// Returns a storage error when the database or private directory cannot be opened.
    pub fn open(
        database_path: impl AsRef<Path>,
        root: impl AsRef<Path>,
    ) -> Result<Self, AttachmentStageError> {
        Self::open_with_limits(database_path, root, AttachmentStageLimits::default())
    }

    fn open_with_limits(
        database_path: impl AsRef<Path>,
        root: impl AsRef<Path>,
        limits: AttachmentStageLimits,
    ) -> Result<Self, AttachmentStageError> {
        let database_path = database_path.as_ref();
        std::fs::create_dir_all(root.as_ref()).map_err(storage)?;
        set_private_directory(root.as_ref()).map_err(storage)?;
        let canonical_root = std::fs::canonicalize(root.as_ref()).map_err(storage)?;
        let database = Database::create(database_path).map_err(storage)?;
        set_private_file(database_path).map_err(storage)?;
        let mut retained_blobs = HashSet::new();
        let mut cancellation_ids = HashSet::new();
        let mut removed_ids = Vec::new();
        let current_time = now_ms();
        let write = database.begin_write().map_err(storage)?;
        {
            let mut records = write.open_table(RECORDS).map_err(storage)?;
            let inspected = records
                .iter()
                .map_err(storage)?
                .map(|entry| {
                    let (key, value) = entry.map_err(storage)?;
                    Ok::<_, AttachmentStageError>((
                        key.value().to_owned(),
                        serde_json::from_slice::<StageRecord>(value.value()),
                    ))
                })
                .collect::<Result<Vec<_>, _>>()?;
            for (key, decoded) in inspected {
                let Ok(mut record) = decoded else {
                    records.remove(key.as_str()).map_err(storage)?;
                    removed_ids.push(key);
                    continue;
                };
                if record.expires_at <= current_time {
                    records.remove(key.as_str()).map_err(storage)?;
                    removed_ids.push(key);
                    continue;
                }
                if record.state == StageState::Uploading {
                    record.state = StageState::Pending;
                    let encoded = serde_json::to_vec(&record).map_err(storage)?;
                    records
                        .insert(key.as_str(), encoded.as_slice())
                        .map_err(storage)?;
                }
                if record.state == StageState::Completed
                    && canonical_root.join(format!("{key}.blob")).is_file()
                {
                    cancellation_ids.insert(key.clone());
                    retained_blobs.insert(key);
                } else if record.state == StageState::Completed {
                    records.remove(key.as_str()).map_err(storage)?;
                    removed_ids.push(key);
                } else {
                    cancellation_ids.insert(key.clone());
                    removed_ids.push(key);
                }
            }
        }
        write.commit().map_err(storage)?;
        for raw_id in removed_ids {
            remove_stage_files_sync(&canonical_root, &raw_id)?;
        }
        remove_orphan_stage_files(&canonical_root, &retained_blobs, &HashSet::new())?;
        Ok(Self {
            database: Arc::new(database),
            root: Arc::new(canonical_root),
            limits,
            filesystem_guard: Arc::new(RwLock::new(())),
            admission: Arc::new(tokio::sync::Mutex::new(())),
            cancellations: Arc::new(Mutex::new(
                cancellation_ids
                    .into_iter()
                    .map(|id| {
                        let (sender, _) = watch::channel(false);
                        (id, sender)
                    })
                    .collect(),
            )),
        })
    }

    /// Starts periodic expiry and orphan cleanup for this store.
    pub fn start_periodic_gc(&self) {
        let Ok(runtime) = tokio::runtime::Handle::try_current() else {
            tracing::warn!("attachment staging garbage collector requires an async runtime");
            return;
        };
        let store = self.clone();
        std::mem::drop(runtime.spawn(async move {
            let mut interval = tokio::time::interval(GC_INTERVAL);
            interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
            interval.tick().await;
            loop {
                interval.tick().await;
                if store.garbage_collect().await.is_err() {
                    tracing::warn!("attachment staging garbage collection failed");
                }
            }
        }));
    }

    /// Cancels and removes staged bytes when their owning device authorization changes.
    pub fn start_revocation_cleanup(
        &self,
        mut changes: tokio::sync::broadcast::Receiver<AuthorizationChange>,
    ) {
        let Ok(runtime) = tokio::runtime::Handle::try_current() else {
            tracing::warn!("attachment staging revocation cleanup requires an async runtime");
            return;
        };
        let store = self.clone();
        std::mem::drop(runtime.spawn(async move {
            loop {
                match changes.recv().await {
                    Ok(change) => {
                        if let Some(owner) = owner_for_device(&change.device_id) {
                            let _ = store.purge_context(&owner).await;
                        }
                    }
                    Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => {
                        let _ = store.purge_all().await;
                    }
                    Err(tokio::sync::broadcast::error::RecvError::Closed) => return,
                }
            }
        }));
    }

    /// Deletes expired, malformed, and orphaned staging data.
    ///
    /// # Errors
    /// Returns a storage error when metadata or private files cannot be cleaned.
    pub async fn garbage_collect(&self) -> Result<(), AttachmentStageError> {
        let _admission = self.admission.lock().await;
        let candidates = self.expired_or_invalid_ids(now_ms())?;
        self.cancel_ids(&candidates);
        let _filesystem = self.filesystem_guard.write().await;
        let plan = self.remove_expired_and_invalid(now_ms())?;
        for raw_id in &plan.removed_ids {
            remove_stage_files(&self.root, raw_id).await?;
        }
        remove_orphan_stage_files(&self.root, &plan.retained_blobs, &plan.retained_parts)?;
        self.forget_cancellations(&plan.removed_ids);
        Ok(())
    }

    fn expired_or_invalid_ids(
        &self,
        current_time: u64,
    ) -> Result<Vec<String>, AttachmentStageError> {
        let read = self.database.begin_read().map_err(storage)?;
        let table = read.open_table(RECORDS).map_err(storage)?;
        table
            .iter()
            .map_err(storage)?
            .map(|entry| {
                let (key, value) = entry.map_err(storage)?;
                let remove = serde_json::from_slice::<StageRecord>(value.value())
                    .map_or(true, |record| record.expires_at <= current_time);
                Ok::<_, AttachmentStageError>(remove.then(|| key.value().to_owned()))
            })
            .filter_map(Result::transpose)
            .collect()
    }

    fn remove_expired_and_invalid(
        &self,
        current_time: u64,
    ) -> Result<GarbageCollectionPlan, AttachmentStageError> {
        let write = self.database.begin_write().map_err(storage)?;
        let mut removed_ids = Vec::new();
        let mut retained_blobs = HashSet::new();
        let mut retained_parts = HashSet::new();
        {
            let mut records = write.open_table(RECORDS).map_err(storage)?;
            let inspected = records
                .iter()
                .map_err(storage)?
                .map(|entry| {
                    let (key, value) = entry.map_err(storage)?;
                    Ok::<_, AttachmentStageError>((
                        key.value().to_owned(),
                        serde_json::from_slice::<StageRecord>(value.value()),
                    ))
                })
                .collect::<Result<Vec<_>, _>>()?;
            for (key, decoded) in inspected {
                match decoded {
                    Ok(record) if record.expires_at > current_time => match record.state {
                        StageState::Completed
                            if self.root.join(format!("{key}.blob")).is_file() =>
                        {
                            retained_blobs.insert(key);
                        }
                        StageState::Completed => {
                            records.remove(key.as_str()).map_err(storage)?;
                            removed_ids.push(key);
                        }
                        StageState::Uploading => {
                            retained_parts.insert(key);
                        }
                        StageState::Pending => {}
                    },
                    Ok(_) | Err(_) => {
                        records.remove(key.as_str()).map_err(storage)?;
                        removed_ids.push(key);
                    }
                }
            }
        }
        write.commit().map_err(storage)?;
        Ok(GarbageCollectionPlan {
            removed_ids,
            retained_blobs,
            retained_parts,
        })
    }

    /// Creates one opaque stage bound to the authenticated device and declared target.
    ///
    /// # Errors
    /// Returns a stable stage error for invalid metadata, randomness, or durable storage failures.
    pub fn stage(
        &self,
        owner: &AuthenticatedContextKey,
        request: &AttachmentStageRequest,
    ) -> Result<(Id, u64), AttachmentStageError> {
        validate_request(request)?;
        let id = generated_id()?;
        let expires_at = now_ms().saturating_add(RETENTION_MS);
        let record = StageRecord {
            owner: owner.as_str().to_owned(),
            workspace: request.workspace.clone(),
            thread_id: request
                .thread_id
                .as_ref()
                .map(|value| value.as_str().to_owned()),
            name: request.name.clone(),
            media_type: request.media_type.clone(),
            size_bytes: request.size_bytes.get(),
            sha256: request.sha256.clone(),
            expires_at,
            state: StageState::Pending,
            reservation_id: None,
            inferred_workspace: false,
        };
        self.insert_with_quota(&id, &record)?;
        self.ensure_cancellation(&id)?;
        Ok((id, expires_at))
    }

    /// Streams and verifies one upload before atomically publishing it as completed.
    ///
    /// # Errors
    /// Returns a stable stage error for ownership, lifecycle, storage, or integrity failures.
    pub async fn upload<S, E>(
        &self,
        owner: &AuthenticatedContextKey,
        id: &Id,
        mut stream: S,
    ) -> Result<StagedAttachment, AttachmentStageError>
    where
        S: Stream<Item = Result<Bytes, E>> + Unpin,
        E: std::fmt::Display,
    {
        let mut cancelled = self.subscribe_cancellation(id)?;
        let admission = self.admission.lock().await;
        let _filesystem = self.filesystem_guard.read().await;
        let mut record = self.claim_upload(owner, id)?;
        let mut reset = UploadResetGuard::new(self.clone(), id.clone());
        drop(admission);
        let temporary = self.temporary_path(id);
        let _ = tokio::fs::remove_file(&temporary).await;
        let _ = tokio::fs::remove_file(self.completed_path(id)).await;
        let result = self
            .write_stream(&record, &temporary, &mut stream, &mut cancelled)
            .await;
        if let Err(error) = result {
            let _ = tokio::fs::remove_file(&temporary).await;
            return Err(error);
        }
        let target = self.completed_path(id);
        if let Err(error) = tokio::fs::rename(&temporary, &target).await {
            let _ = tokio::fs::remove_file(&temporary).await;
            return Err(storage(error));
        }
        record.state = StageState::Completed;
        if let Err(error) = self.write_record(id, &record, true) {
            let _ = tokio::fs::remove_file(&target).await;
            return Err(error);
        }
        reset.disarm();
        Ok(self.resolved(id, record))
    }

    /// Reads the device-bound upload state without exposing attachment metadata.
    ///
    /// # Errors
    /// Returns a stable stage error when the stage is unavailable to this device.
    pub fn status(
        &self,
        owner: &AuthenticatedContextKey,
        id: &Id,
    ) -> Result<StageStatus, AttachmentStageError> {
        let record = self.read_owned(owner, id)?;
        if record.expires_at <= now_ms() {
            return Err(AttachmentStageError::Expired);
        }
        match record.state {
            StageState::Completed => Ok(StageStatus::Completed),
            StageState::Pending | StageState::Uploading => Ok(StageStatus::Pending),
        }
    }

    /// Deletes a stage and cancels an active upload before removing its private bytes.
    ///
    /// # Errors
    /// Returns a stable stage error when the stage is unavailable or reserved by a command.
    pub async fn delete(
        &self,
        owner: &AuthenticatedContextKey,
        id: &Id,
    ) -> Result<(), AttachmentStageError> {
        let _admission = self.admission.lock().await;
        let record = self.read_owned(owner, id)?;
        if record.reservation_id.is_some() {
            return Err(AttachmentStageError::Conflict);
        }
        self.cancel_id(id.as_str());
        let _filesystem = self.filesystem_guard.write().await;
        let write = self.database.begin_write().map_err(storage)?;
        {
            let mut table = write.open_table(RECORDS).map_err(storage)?;
            let record = table.get(id.as_str()).map_err(storage)?;
            let record = record
                .map(|value| serde_json::from_slice::<StageRecord>(value.value()))
                .transpose()
                .map_err(storage)?
                .ok_or(AttachmentStageError::NotFound)?;
            if record.owner != owner.as_str() {
                return Err(AttachmentStageError::Forbidden);
            }
            if record.reservation_id.is_some() {
                return Err(AttachmentStageError::Conflict);
            }
            table.remove(id.as_str()).map_err(storage)?;
        }
        write.commit().map_err(storage)?;
        remove_if_exists(&self.completed_path(id)).await?;
        remove_if_exists(&self.temporary_path(id)).await?;
        self.forget_cancellation(id.as_str());
        Ok(())
    }

    /// Removes every staged byte owned by one revoked authenticated context.
    ///
    /// # Errors
    /// Returns a storage error when durable metadata cannot be removed.
    pub async fn purge_context(
        &self,
        owner: &AuthenticatedContextKey,
    ) -> Result<(), AttachmentStageError> {
        let _admission = self.admission.lock().await;
        let ids = {
            let read = self.database.begin_read().map_err(storage)?;
            let table = read.open_table(RECORDS).map_err(storage)?;
            table
                .iter()
                .map_err(storage)?
                .map(|entry| {
                    let (key, value) = entry.map_err(storage)?;
                    let id = match serde_json::from_slice::<StageRecord>(value.value()) {
                        Ok(record) if record.owner != owner.as_str() => None,
                        Ok(_) | Err(_) => Some(key.value().to_owned()),
                    };
                    Ok::<_, AttachmentStageError>(id)
                })
                .filter_map(Result::transpose)
                .collect::<Result<Vec<_>, _>>()?
        };
        self.cancel_ids(&ids);
        let _filesystem = self.filesystem_guard.write().await;
        let write = self.database.begin_write().map_err(storage)?;
        {
            let mut table = write.open_table(RECORDS).map_err(storage)?;
            for id in &ids {
                table.remove(id.as_str()).map_err(storage)?;
            }
        }
        write.commit().map_err(storage)?;
        for raw_id in &ids {
            if let Ok(id) = Id::new(raw_id.clone()) {
                remove_if_exists(&self.completed_path(&id)).await?;
                remove_if_exists(&self.temporary_path(&id)).await?;
            }
        }
        self.forget_cancellations(&ids);
        Ok(())
    }

    async fn purge_all(&self) -> Result<(), AttachmentStageError> {
        let _admission = self.admission.lock().await;
        let ids = {
            let read = self.database.begin_read().map_err(storage)?;
            let table = read.open_table(RECORDS).map_err(storage)?;
            table
                .iter()
                .map_err(storage)?
                .map(|entry| {
                    let (key, _) = entry.map_err(storage)?;
                    Ok::<_, AttachmentStageError>(key.value().to_owned())
                })
                .collect::<Result<Vec<_>, _>>()?
        };
        self.cancel_ids(&ids);
        let _filesystem = self.filesystem_guard.write().await;
        let write = self.database.begin_write().map_err(storage)?;
        {
            let mut table = write.open_table(RECORDS).map_err(storage)?;
            for id in &ids {
                table.remove(id.as_str()).map_err(storage)?;
            }
        }
        write.commit().map_err(storage)?;
        for id in &ids {
            remove_stage_files(&self.root, id).await?;
        }
        self.forget_cancellations(&ids);
        Ok(())
    }

    /// Resolves only a completed stage created for this existing thread.
    ///
    /// # Errors
    /// Returns a stable stage error unless the completed stage belongs to this device and thread.
    pub fn resolve_completed(
        &self,
        owner: &AuthenticatedContextKey,
        thread_id: &Id,
        id: &Id,
    ) -> Result<StagedAttachment, AttachmentStageError> {
        let record = self.read_owned(owner, id)?;
        validate_owner_and_expiry(&record, owner)?;
        if record.state != StageState::Completed || record.reservation_id.is_some() {
            return Err(AttachmentStageError::Conflict);
        }
        if record.thread_id.as_deref() != Some(thread_id.as_str()) {
            return Err(AttachmentStageError::Forbidden);
        }
        Ok(self.resolved(id, record))
    }

    /// Resolves a stage after its reservation was committed to a new authoritative thread.
    ///
    /// # Errors
    /// Returns a stable stage error unless owner, workspace, thread binding, and lifecycle match.
    pub fn resolve_completed_for_new_thread(
        &self,
        owner: &AuthenticatedContextKey,
        workspace: &str,
        thread_id: &Id,
        id: &Id,
    ) -> Result<StagedAttachment, AttachmentStageError> {
        let record = self.read_owned(owner, id)?;
        validate_owner_and_expiry(&record, owner)?;
        if record.state != StageState::Completed || record.reservation_id.is_some() {
            return Err(AttachmentStageError::Conflict);
        }
        if record.thread_id.as_deref() != Some(thread_id.as_str())
            || record.workspace.as_deref() != Some(workspace)
        {
            return Err(AttachmentStageError::Forbidden);
        }
        Ok(self.resolved(id, record))
    }

    /// Atomically reserves every staged attachment before creating a new upstream thread.
    ///
    /// # Errors
    /// Returns without reserving any stage unless every stage is completed, unbound, and owned by
    /// the same device and workspace.
    pub fn reserve_completed_for_new_thread(
        &self,
        owner: &AuthenticatedContextKey,
        workspace: Option<&str>,
        reservation_id: &OperationId,
        ids: &[Id],
    ) -> Result<(), AttachmentStageError> {
        let unique_ids = unique_ids(ids);
        let write = self.database.begin_write().map_err(storage)?;
        {
            let mut table = write.open_table(RECORDS).map_err(storage)?;
            let mut updates = Vec::with_capacity(unique_ids.len());
            for id in unique_ids {
                let mut record = read_record(&table, id)?;
                validate_owner_and_expiry(&record, owner)?;
                if record.state != StageState::Completed
                    || record.thread_id.is_some()
                    || record.workspace.as_deref() != workspace
                {
                    return Err(AttachmentStageError::Forbidden);
                }
                match record.reservation_id.as_deref() {
                    Some(current) if current != reservation_id.as_str() => {
                        return Err(AttachmentStageError::Conflict);
                    }
                    Some(_) => {}
                    None => record.reservation_id = Some(reservation_id.as_str().to_owned()),
                }
                updates.push((id.clone(), record));
            }
            write_records(&mut table, &updates)?;
        }
        write.commit().map_err(storage)
    }

    /// Atomically binds a complete reservation to the newly created authoritative thread.
    ///
    /// # Errors
    /// Returns without binding any stage unless the whole reservation still belongs to this
    /// operation and target.
    pub fn commit_new_thread_reservation(
        &self,
        owner: &AuthenticatedContextKey,
        workspace: &str,
        thread_id: &Id,
        reservation_id: &OperationId,
        ids: &[Id],
    ) -> Result<(), AttachmentStageError> {
        let unique_ids = unique_ids(ids);
        let write = self.database.begin_write().map_err(storage)?;
        {
            let mut table = write.open_table(RECORDS).map_err(storage)?;
            let mut updates = Vec::with_capacity(unique_ids.len());
            for id in unique_ids {
                let mut record = read_record(&table, id)?;
                validate_owner_and_expiry(&record, owner)?;
                if record.state != StageState::Completed
                    || record.thread_id.is_some()
                    || record.reservation_id.as_deref() != Some(reservation_id.as_str())
                {
                    return Err(AttachmentStageError::Conflict);
                }
                match record.workspace.as_deref() {
                    Some(current) if current != workspace => {
                        return Err(AttachmentStageError::Forbidden);
                    }
                    Some(_) => {}
                    None => {
                        record.workspace = Some(workspace.to_owned());
                        record.inferred_workspace = true;
                    }
                }
                record.thread_id = Some(thread_id.as_str().to_owned());
                record.reservation_id = None;
                updates.push((id.clone(), record));
            }
            write_records(&mut table, &updates)?;
        }
        write.commit().map_err(storage)?;
        Ok(())
    }

    /// Rolls back a committed binding after the upstream new-thread command is compensated.
    ///
    /// # Errors
    /// Returns a storage error when durable metadata cannot be updated.
    pub fn rollback_new_thread_binding(
        &self,
        owner: &AuthenticatedContextKey,
        thread_id: &Id,
        ids: &[Id],
    ) -> Result<(), AttachmentStageError> {
        let unique_ids = unique_ids(ids);
        let write = self.database.begin_write().map_err(storage)?;
        {
            let mut table = write.open_table(RECORDS).map_err(storage)?;
            let mut updates = Vec::with_capacity(unique_ids.len());
            for id in unique_ids {
                let mut record = read_record(&table, id)?;
                validate_owner_and_expiry(&record, owner)?;
                if record.thread_id.as_deref() != Some(thread_id.as_str()) {
                    return Err(AttachmentStageError::Conflict);
                }
                record.thread_id = None;
                if record.inferred_workspace {
                    record.workspace = None;
                    record.inferred_workspace = false;
                }
                updates.push((id.clone(), record));
            }
            write_records(&mut table, &updates)?;
        }
        write.commit().map_err(storage)
    }

    /// Releases only stages reserved by the specified operation.
    ///
    /// # Errors
    /// Returns a storage error when durable metadata cannot be updated.
    pub fn release_new_thread_reservation(
        &self,
        reservation_id: &OperationId,
    ) -> Result<(), AttachmentStageError> {
        let write = self.database.begin_write().map_err(storage)?;
        {
            let mut table = write.open_table(RECORDS).map_err(storage)?;
            let mut updates = Vec::new();
            for entry in table.iter().map_err(storage)? {
                let (key, value) = entry.map_err(storage)?;
                let mut record =
                    serde_json::from_slice::<StageRecord>(value.value()).map_err(storage)?;
                if record.reservation_id.as_deref() != Some(reservation_id.as_str()) {
                    continue;
                }
                let id = Id::new(key.value().to_owned())
                    .map_err(|_| storage("attachment stage key is invalid"))?;
                record.reservation_id = None;
                updates.push((id, record));
            }
            write_records(&mut table, &updates)?;
        }
        write.commit().map_err(storage)
    }

    fn read_owned(
        &self,
        owner: &AuthenticatedContextKey,
        id: &Id,
    ) -> Result<StageRecord, AttachmentStageError> {
        let read = self.database.begin_read().map_err(storage)?;
        let table = read.open_table(RECORDS).map_err(storage)?;
        let value = table
            .get(id.as_str())
            .map_err(storage)?
            .ok_or(AttachmentStageError::NotFound)?;
        let record = serde_json::from_slice::<StageRecord>(value.value()).map_err(storage)?;
        if record.owner != owner.as_str() {
            return Err(AttachmentStageError::Forbidden);
        }
        Ok(record)
    }

    fn claim_upload(
        &self,
        owner: &AuthenticatedContextKey,
        id: &Id,
    ) -> Result<StageRecord, AttachmentStageError> {
        let write = self.database.begin_write().map_err(storage)?;
        let record = {
            let mut table = write.open_table(RECORDS).map_err(storage)?;
            let mut record = table
                .get(id.as_str())
                .map_err(storage)?
                .map(|value| serde_json::from_slice::<StageRecord>(value.value()))
                .transpose()
                .map_err(storage)?
                .ok_or(AttachmentStageError::NotFound)?;
            validate_owner_and_expiry(&record, owner)?;
            if record.state != StageState::Pending {
                return Err(AttachmentStageError::Conflict);
            }
            record.state = StageState::Uploading;
            let encoded = serde_json::to_vec(&record).map_err(storage)?;
            table
                .insert(id.as_str(), encoded.as_slice())
                .map_err(storage)?;
            record
        };
        write.commit().map_err(storage)?;
        Ok(record)
    }

    fn write_record(
        &self,
        id: &Id,
        record: &StageRecord,
        replace: bool,
    ) -> Result<(), AttachmentStageError> {
        let encoded = serde_json::to_vec(record).map_err(storage)?;
        let write = self.database.begin_write().map_err(storage)?;
        {
            let mut table = write.open_table(RECORDS).map_err(storage)?;
            let exists = table.get(id.as_str()).map_err(storage)?.is_some();
            match (replace, exists) {
                (false, true) => return Err(AttachmentStageError::Conflict),
                (true, false) => return Err(AttachmentStageError::NotFound),
                (false, false) | (true, true) => {}
            }
            table
                .insert(id.as_str(), encoded.as_slice())
                .map_err(storage)?;
        }
        write.commit().map_err(storage)
    }

    fn reset_upload(&self, id: &Id) -> Result<(), AttachmentStageError> {
        let write = self.database.begin_write().map_err(storage)?;
        {
            let mut table = write.open_table(RECORDS).map_err(storage)?;
            let mut record = read_record(&table, id)?;
            if record.state == StageState::Uploading {
                record.state = StageState::Pending;
                let encoded = serde_json::to_vec(&record).map_err(storage)?;
                table
                    .insert(id.as_str(), encoded.as_slice())
                    .map_err(storage)?;
            }
        }
        write.commit().map_err(storage)
    }

    fn insert_with_quota(&self, id: &Id, record: &StageRecord) -> Result<(), AttachmentStageError> {
        let encoded = serde_json::to_vec(record).map_err(storage)?;
        let write = self.database.begin_write().map_err(storage)?;
        {
            let mut table = write.open_table(RECORDS).map_err(storage)?;
            if table.get(id.as_str()).map_err(storage)?.is_some() {
                return Err(AttachmentStageError::Conflict);
            }
            let mut usage = StageUsage::default();
            for entry in table.iter().map_err(storage)? {
                let (_, value) = entry.map_err(storage)?;
                let existing =
                    serde_json::from_slice::<StageRecord>(value.value()).map_err(storage)?;
                usage.add(&existing, &record.owner)?;
            }
            usage.admit(record.size_bytes, self.limits)?;
            table
                .insert(id.as_str(), encoded.as_slice())
                .map_err(storage)?;
        }
        write.commit().map_err(storage)?;
        Ok(())
    }

    async fn write_stream<S, E>(
        &self,
        record: &StageRecord,
        path: &Path,
        stream: &mut S,
        cancelled: &mut watch::Receiver<bool>,
    ) -> Result<(), AttachmentStageError>
    where
        S: Stream<Item = Result<Bytes, E>> + Unpin,
        E: std::fmt::Display,
    {
        let mut file = OpenOptions::new()
            .create_new(true)
            .write(true)
            .open(path)
            .await
            .map_err(storage)?;
        let mut bytes = 0_u64;
        let mut digest = Sha256::new();
        let deadline = tokio::time::Instant::now() + UPLOAD_TOTAL_TIMEOUT;
        loop {
            if *cancelled.borrow() {
                return Err(AttachmentStageError::Cancelled);
            }
            let chunk = tokio::select! {
                biased;
                changed = cancelled.changed() => {
                    let _ = changed;
                    return Err(AttachmentStageError::Cancelled);
                }
                () = tokio::time::sleep_until(deadline) => {
                    return Err(AttachmentStageError::Timeout);
                }
                chunk = tokio::time::timeout(UPLOAD_IDLE_TIMEOUT, stream.next()) => {
                    match chunk {
                        Ok(chunk) => chunk,
                        Err(_) => return Err(AttachmentStageError::Timeout),
                    }
                }
            };
            let Some(chunk) = chunk else {
                break;
            };
            let chunk = chunk.map_err(|error| AttachmentStageError::Storage(error.to_string()))?;
            bytes = bytes
                .checked_add(u64::try_from(chunk.len()).unwrap_or(u64::MAX))
                .ok_or(AttachmentStageError::Integrity)?;
            if bytes > record.size_bytes {
                return Err(AttachmentStageError::Integrity);
            }
            digest.update(&chunk);
            file.write_all(&chunk).await.map_err(storage)?;
        }
        file.flush().await.map_err(storage)?;
        if bytes != record.size_bytes || hex::encode(digest.finalize()) != record.sha256 {
            return Err(AttachmentStageError::Integrity);
        }
        set_private_file(path).map_err(storage)
    }

    fn subscribe_cancellation(
        &self,
        id: &Id,
    ) -> Result<watch::Receiver<bool>, AttachmentStageError> {
        let mut cancellations = self.cancellations.lock().map_err(storage)?;
        let sender = cancellations
            .entry(id.as_str().to_owned())
            .or_insert_with(|| {
                let (sender, _) = watch::channel(false);
                sender
            });
        Ok(sender.subscribe())
    }

    fn ensure_cancellation(&self, id: &Id) -> Result<(), AttachmentStageError> {
        let mut cancellations = self.cancellations.lock().map_err(storage)?;
        cancellations
            .entry(id.as_str().to_owned())
            .or_insert_with(|| {
                let (sender, _) = watch::channel(false);
                sender
            });
        Ok(())
    }

    fn cancel_ids(&self, ids: &[String]) {
        let Ok(cancellations) = self.cancellations.lock() else {
            return;
        };
        for id in ids {
            if let Some(sender) = cancellations.get(id) {
                let _ = sender.send(true);
            }
        }
    }

    fn cancel_id(&self, id: &str) {
        let Ok(cancellations) = self.cancellations.lock() else {
            return;
        };
        if let Some(sender) = cancellations.get(id) {
            let _ = sender.send(true);
        }
    }

    fn forget_cancellation(&self, id: &str) {
        if let Ok(mut cancellations) = self.cancellations.lock() {
            cancellations.remove(id);
        }
    }

    fn forget_cancellations(&self, ids: &[String]) {
        if let Ok(mut cancellations) = self.cancellations.lock() {
            for id in ids {
                cancellations.remove(id);
            }
        }
    }

    fn resolved(&self, id: &Id, record: StageRecord) -> StagedAttachment {
        let path = self.completed_path(id);
        StagedAttachment {
            attachment: Attachment {
                id: id.clone(),
                name: record.name,
                media_type: record.media_type,
                size_bytes: U64::new(record.size_bytes),
                download_url: None,
            },
            sha256: record.sha256,
            workspace: record.workspace,
            path,
        }
    }

    fn temporary_path(&self, id: &Id) -> PathBuf {
        self.root.join(format!("{}.part", id.as_str()))
    }
    fn completed_path(&self, id: &Id) -> PathBuf {
        self.root.join(format!("{}.blob", id.as_str()))
    }
}

fn read_record(
    table: &Table<'_, &str, &[u8]>,
    id: &Id,
) -> Result<StageRecord, AttachmentStageError> {
    table
        .get(id.as_str())
        .map_err(storage)?
        .map(|value| serde_json::from_slice::<StageRecord>(value.value()))
        .transpose()
        .map_err(storage)?
        .ok_or(AttachmentStageError::NotFound)
}

fn write_records(
    table: &mut Table<'_, &str, &[u8]>,
    records: &[(Id, StageRecord)],
) -> Result<(), AttachmentStageError> {
    for (id, record) in records {
        let encoded = serde_json::to_vec(record).map_err(storage)?;
        table
            .insert(id.as_str(), encoded.as_slice())
            .map_err(storage)?;
    }
    Ok(())
}

fn unique_ids(ids: &[Id]) -> Vec<&Id> {
    let mut seen = HashSet::with_capacity(ids.len());
    let mut unique = Vec::with_capacity(ids.len());
    for id in ids {
        if seen.insert(id.as_str()) {
            unique.push(id);
        }
    }
    unique
}

fn checked_add(left: u64, right: u64) -> Result<u64, AttachmentStageError> {
    left.checked_add(right)
        .ok_or(AttachmentStageError::QuotaExceeded)
}

async fn remove_stage_files(root: &Path, raw_id: &str) -> Result<(), AttachmentStageError> {
    let Ok(id) = Id::new(raw_id.to_owned()) else {
        return Ok(());
    };
    remove_if_exists(&root.join(format!("{}.blob", id.as_str()))).await?;
    remove_if_exists(&root.join(format!("{}.part", id.as_str()))).await
}

fn remove_stage_files_sync(root: &Path, raw_id: &str) -> Result<(), AttachmentStageError> {
    let Ok(id) = Id::new(raw_id.to_owned()) else {
        return Ok(());
    };
    remove_if_exists_sync(&root.join(format!("{}.blob", id.as_str())))?;
    remove_if_exists_sync(&root.join(format!("{}.part", id.as_str())))
}

fn remove_orphan_stage_files(
    root: &Path,
    retained_blobs: &HashSet<String>,
    retained_parts: &HashSet<String>,
) -> Result<(), AttachmentStageError> {
    let entries = std::fs::read_dir(root).map_err(storage)?;
    for entry in entries {
        let entry = entry.map_err(storage)?;
        let path = entry.path();
        if !entry.file_type().map_err(storage)?.is_file() {
            continue;
        }
        let Some(name) = path.file_name().and_then(|value| value.to_str()) else {
            continue;
        };
        let remove = if let Some(id) = name.strip_suffix(".blob") {
            !retained_blobs.contains(id)
        } else if let Some(id) = name.strip_suffix(".part") {
            !retained_parts.contains(id)
        } else {
            false
        };
        if remove {
            remove_if_exists_sync(&path)?;
        }
    }
    Ok(())
}

fn validate_request(request: &AttachmentStageRequest) -> Result<(), AttachmentStageError> {
    if request.name.is_empty()
        || request.name.chars().count() > 512
        || request.name.len() > 2_048
        || request.media_type.is_empty()
        || request.media_type.chars().count() > 256
        || request.size_bytes.get() > 512 * 1024 * 1024
        || request.sha256.len() != 64
        || !request
            .sha256
            .bytes()
            .all(|byte| byte.is_ascii_hexdigit() && !byte.is_ascii_uppercase())
    {
        return Err(AttachmentStageError::Invalid);
    }
    Ok(())
}

fn validate_owner_and_expiry(
    record: &StageRecord,
    owner: &AuthenticatedContextKey,
) -> Result<(), AttachmentStageError> {
    if record.owner != owner.as_str() {
        return Err(AttachmentStageError::Forbidden);
    }
    if record.expires_at <= now_ms() {
        return Err(AttachmentStageError::Expired);
    }
    Ok(())
}

fn generated_id() -> Result<Id, AttachmentStageError> {
    let mut bytes = [0_u8; 24];
    OsRng.try_fill_bytes(&mut bytes).map_err(storage)?;
    Ok(Id::from_generated(URL_SAFE_NO_PAD.encode(bytes)))
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |value| {
            u64::try_from(value.as_millis()).unwrap_or(u64::MAX)
        })
}

fn owner_for_device(device_id: &str) -> Option<AuthenticatedContextKey> {
    AuthenticatedContextKey::derive(&AuthorizationContext::Session {
        device_id: device_id.to_owned(),
        scopes: Vec::new(),
        expires_at: u64::MAX,
    })
    .ok()
}

fn storage(error: impl std::fmt::Display) -> AttachmentStageError {
    AttachmentStageError::Storage(error.to_string())
}

async fn remove_if_exists(path: &Path) -> Result<(), AttachmentStageError> {
    match tokio::fs::remove_file(path).await {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(storage(error)),
    }
}

fn remove_if_exists_sync(path: &Path) -> Result<(), AttachmentStageError> {
    match std::fs::remove_file(path) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(storage(error)),
    }
}

#[cfg(unix)]
fn set_private_directory(path: &Path) -> std::io::Result<()> {
    use std::os::unix::fs::PermissionsExt;
    std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o700))
}
#[cfg(not(unix))]
fn set_private_directory(_path: &Path) -> std::io::Result<()> {
    Ok(())
}
#[cfg(unix)]
fn set_private_file(path: &Path) -> std::io::Result<()> {
    use std::os::unix::fs::PermissionsExt;
    std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600))
}
#[cfg(not(unix))]
fn set_private_file(_path: &Path) -> std::io::Result<()> {
    Ok(())
}

#[cfg(test)]
mod tests {
    use futures_util::stream;

    use super::*;
    use crate::auth::AuthorizationContext;

    fn owner(device_id: &str) -> AuthenticatedContextKey {
        AuthenticatedContextKey::derive(&AuthorizationContext::Session {
            device_id: device_id.to_owned(),
            scopes: vec!["files.upload.workspace".to_owned()],
            expires_at: u64::MAX,
        })
        .unwrap_or_else(|error| panic!("{error:?}"))
    }

    fn request(bytes: &[u8], thread_id: Option<&str>) -> AttachmentStageRequest {
        AttachmentStageRequest {
            workspace: Some("/workspace".to_owned()),
            thread_id: thread_id
                .map(|value| Id::new(value).unwrap_or_else(|error| panic!("{error}"))),
            name: "note.txt".to_owned(),
            media_type: "text/plain".to_owned(),
            size_bytes: U64::new(u64::try_from(bytes.len()).unwrap_or(u64::MAX)),
            sha256: hex::encode(Sha256::digest(bytes)),
        }
    }

    fn open(directory: &tempfile::TempDir) -> AttachmentStageStore {
        AttachmentStageStore::open(
            directory.path().join("stages.redb"),
            directory.path().join("blobs"),
        )
        .unwrap_or_else(|error| panic!("{error}"))
    }

    fn open_with_test_limits(
        directory: &tempfile::TempDir,
        limits: AttachmentStageLimits,
    ) -> AttachmentStageStore {
        AttachmentStageStore::open_with_limits(
            directory.path().join("stages.redb"),
            directory.path().join("blobs"),
            limits,
        )
        .unwrap_or_else(|error| panic!("{error}"))
    }

    #[tokio::test]
    async fn completed_stage_survives_restart_and_resolves_for_its_target() {
        let directory = tempfile::tempdir().unwrap_or_else(|error| panic!("{error}"));
        let context = owner("device-a");
        let thread = Id::new("thread-a").unwrap_or_else(|error| panic!("{error}"));
        let id = {
            let store = open(&directory);
            let (id, _) = store
                .stage(&context, &request(b"hello", Some("thread-a")))
                .unwrap_or_else(|error| panic!("{error}"));
            store
                .upload(
                    &context,
                    &id,
                    stream::iter([Ok::<_, std::io::Error>(Bytes::from_static(b"hello"))]),
                )
                .await
                .unwrap_or_else(|error| panic!("{error}"));
            id
        };
        let reopened = open(&directory);
        let resolved = reopened
            .resolve_completed(&context, &thread, &id)
            .unwrap_or_else(|error| panic!("{error}"));
        assert_eq!(resolved.sha256, hex::encode(Sha256::digest(b"hello")));
        assert_eq!(
            std::fs::read(resolved.path).unwrap_or_else(|error| panic!("{error}")),
            b"hello"
        );
    }

    #[tokio::test]
    async fn upload_rejects_wrong_bytes_without_publishing_them() {
        let directory = tempfile::tempdir().unwrap_or_else(|error| panic!("{error}"));
        let store = open(&directory);
        let context = owner("device-a");
        let (id, _) = store
            .stage(&context, &request(b"hello", None))
            .unwrap_or_else(|error| panic!("{error}"));
        let result = store
            .upload(
                &context,
                &id,
                stream::iter([Ok::<_, std::io::Error>(Bytes::from_static(b"hullo"))]),
            )
            .await;
        assert!(matches!(result, Err(AttachmentStageError::Integrity)));
        assert!(matches!(
            store.status(&context, &id),
            Ok(StageStatus::Pending)
        ));
    }

    #[tokio::test]
    async fn cancelled_upload_task_releases_the_stage_for_retry() {
        let directory = tempfile::tempdir().unwrap_or_else(|error| panic!("{error}"));
        let store = open(&directory);
        let context = owner("device-a");
        let (id, _) = store
            .stage(&context, &request(b"hello", None))
            .unwrap_or_else(|error| panic!("{error}"));
        let (polled, claimed) = tokio::sync::oneshot::channel();
        let upload_store = store.clone();
        let upload_context = context.clone();
        let upload_id = id.clone();
        let mut polled = Some(polled);
        let upload = tokio::spawn(async move {
            upload_store
                .upload(
                    &upload_context,
                    &upload_id,
                    stream::poll_fn(move |_| {
                        if let Some(polled) = polled.take() {
                            let _ = polled.send(());
                        }
                        std::task::Poll::<Option<Result<Bytes, std::io::Error>>>::Pending
                    }),
                )
                .await
        });
        claimed.await.unwrap_or_else(|error| panic!("{error}"));
        upload.abort();
        assert!(matches!(upload.await, Err(error) if error.is_cancelled()));
        store
            .upload(
                &context,
                &id,
                stream::iter([Ok::<_, std::io::Error>(Bytes::from_static(b"hello"))]),
            )
            .await
            .unwrap_or_else(|error| panic!("{error}"));
        assert!(matches!(
            store.status(&context, &id),
            Ok(StageStatus::Completed)
        ));
    }

    #[tokio::test]
    async fn stage_is_device_bound() {
        let directory = tempfile::tempdir().unwrap_or_else(|error| panic!("{error}"));
        let store = open(&directory);
        let first = owner("device-a");
        let second = owner("device-b");
        let (id, _) = store
            .stage(&first, &request(b"hello", None))
            .unwrap_or_else(|error| panic!("{error}"));
        assert!(matches!(
            store.status(&second, &id),
            Err(AttachmentStageError::Forbidden)
        ));
        store
            .purge_context(&first)
            .await
            .unwrap_or_else(|error| panic!("{error}"));
        assert!(matches!(
            store.status(&first, &id),
            Err(AttachmentStageError::NotFound)
        ));
    }

    #[tokio::test]
    async fn new_thread_stage_is_consumed_idempotently_by_one_thread() {
        let directory = tempfile::tempdir().unwrap_or_else(|error| panic!("{error}"));
        let store = open(&directory);
        let context = owner("device-a");
        let first = Id::new("thread-a").unwrap_or_else(|error| panic!("{error}"));
        let second = Id::new("thread-b").unwrap_or_else(|error| panic!("{error}"));
        let (id, _) = store
            .stage(&context, &request(b"hello", None))
            .unwrap_or_else(|error| panic!("{error}"));
        store
            .upload(
                &context,
                &id,
                stream::iter([Ok::<_, std::io::Error>(Bytes::from_static(b"hello"))]),
            )
            .await
            .unwrap_or_else(|error| panic!("{error}"));
        let operation = OperationId::new("operation-a").unwrap_or_else(|error| panic!("{error}"));
        assert!(matches!(
            store.resolve_completed(&context, &first, &id),
            Err(AttachmentStageError::Forbidden)
        ));
        store
            .reserve_completed_for_new_thread(
                &context,
                Some("/workspace"),
                &operation,
                std::slice::from_ref(&id),
            )
            .unwrap_or_else(|error| panic!("{error}"));
        store
            .commit_new_thread_reservation(
                &context,
                "/workspace",
                &first,
                &operation,
                std::slice::from_ref(&id),
            )
            .unwrap_or_else(|error| panic!("{error}"));
        assert!(
            store
                .resolve_completed_for_new_thread(&context, "/workspace", &first, &id)
                .is_ok()
        );
        assert!(
            store
                .resolve_completed_for_new_thread(&context, "/workspace", &first, &id)
                .is_ok()
        );
        assert!(matches!(
            store.resolve_completed_for_new_thread(&context, "/workspace", &second, &id),
            Err(AttachmentStageError::Forbidden)
        ));
    }

    #[tokio::test]
    async fn new_thread_consumption_requires_the_staged_workspace() {
        let directory = tempfile::tempdir().unwrap_or_else(|error| panic!("{error}"));
        let store = open(&directory);
        let context = owner("device-a");
        let thread = Id::new("thread-a").unwrap_or_else(|error| panic!("{error}"));
        let (id, _) = store
            .stage(&context, &request(b"hello", None))
            .unwrap_or_else(|error| panic!("{error}"));
        store
            .upload(
                &context,
                &id,
                stream::iter([Ok::<_, std::io::Error>(Bytes::from_static(b"hello"))]),
            )
            .await
            .unwrap_or_else(|error| panic!("{error}"));
        let operation = OperationId::new("operation-a").unwrap_or_else(|error| panic!("{error}"));
        store
            .reserve_completed_for_new_thread(
                &context,
                Some("/workspace"),
                &operation,
                std::slice::from_ref(&id),
            )
            .unwrap_or_else(|error| panic!("{error}"));
        assert!(matches!(
            store.commit_new_thread_reservation(
                &context,
                "/other",
                &thread,
                &operation,
                std::slice::from_ref(&id),
            ),
            Err(AttachmentStageError::Forbidden)
        ));
        store
            .commit_new_thread_reservation(
                &context,
                "/workspace",
                &thread,
                &operation,
                std::slice::from_ref(&id),
            )
            .unwrap_or_else(|error| panic!("{error}"));
        assert!(
            store
                .resolve_completed_for_new_thread(&context, "/workspace", &thread, &id)
                .is_ok()
        );
    }

    #[tokio::test]
    async fn omitted_workspace_binds_to_the_resolved_new_thread_workspace() {
        let directory = tempfile::tempdir().unwrap_or_else(|error| panic!("{error}"));
        let store = open(&directory);
        let context = owner("device-a");
        let thread = Id::new("thread-a").unwrap_or_else(|error| panic!("{error}"));
        let mut stage_request = request(b"hello", None);
        stage_request.workspace = None;
        let (id, _) = store
            .stage(&context, &stage_request)
            .unwrap_or_else(|error| panic!("{error}"));
        store
            .upload(
                &context,
                &id,
                stream::iter([Ok::<_, std::io::Error>(Bytes::from_static(b"hello"))]),
            )
            .await
            .unwrap_or_else(|error| panic!("{error}"));
        let operation = OperationId::new("operation-a").unwrap_or_else(|error| panic!("{error}"));
        store
            .reserve_completed_for_new_thread(&context, None, &operation, std::slice::from_ref(&id))
            .unwrap_or_else(|error| panic!("{error}"));
        store
            .commit_new_thread_reservation(
                &context,
                "/resolved",
                &thread,
                &operation,
                std::slice::from_ref(&id),
            )
            .unwrap_or_else(|error| panic!("{error}"));
        let resolved = store
            .resolve_completed_for_new_thread(&context, "/resolved", &thread, &id)
            .unwrap_or_else(|error| panic!("{error}"));
        assert_eq!(resolved.workspace.as_deref(), Some("/resolved"));
    }

    #[test]
    fn quotas_are_enforced_atomically_per_device_and_globally() {
        let directory = tempfile::tempdir().unwrap_or_else(|error| panic!("{error}"));
        let store = open_with_test_limits(
            &directory,
            AttachmentStageLimits {
                device_count: 1,
                device_bytes: 5,
                global_count: 2,
                global_bytes: 10,
            },
        );
        let first = owner("device-a");
        let second = owner("device-b");
        let third = owner("device-c");
        assert!(store.stage(&first, &request(b"hello", None)).is_ok());
        assert!(matches!(
            store.stage(&first, &request(b"x", None)),
            Err(AttachmentStageError::QuotaExceeded)
        ));
        assert!(store.stage(&second, &request(b"hello", None)).is_ok());
        assert!(matches!(
            store.stage(&third, &request(b"x", None)),
            Err(AttachmentStageError::QuotaExceeded)
        ));
    }

    #[tokio::test]
    async fn concurrent_stage_creation_cannot_overbook_a_device_quota() {
        let directory = tempfile::tempdir().unwrap_or_else(|error| panic!("{error}"));
        let store = open_with_test_limits(
            &directory,
            AttachmentStageLimits {
                device_count: 1,
                device_bytes: 5,
                global_count: 8,
                global_bytes: 40,
            },
        );
        let barrier = Arc::new(std::sync::Barrier::new(8));
        let mut tasks = Vec::new();
        for _ in 0..8 {
            let store = store.clone();
            let barrier = barrier.clone();
            tasks.push(tokio::task::spawn_blocking(move || {
                barrier.wait();
                store.stage(&owner("device-a"), &request(b"hello", None))
            }));
        }
        let mut admitted = 0;
        for task in tasks {
            match task.await.unwrap_or_else(|error| panic!("{error}")) {
                Ok(_) => admitted += 1,
                Err(AttachmentStageError::QuotaExceeded) => {}
                Err(error) => panic!("unexpected staging failure: {error}"),
            }
        }
        assert_eq!(admitted, 1);
    }

    #[tokio::test]
    async fn startup_and_gc_remove_expired_corrupt_and_orphan_files() {
        let directory = tempfile::tempdir().unwrap_or_else(|error| panic!("{error}"));
        let context = owner("device-a");
        let blobs = directory.path().join("blobs");
        let expired_id = {
            let store = open(&directory);
            let (id, _) = store
                .stage(&context, &request(b"hello", None))
                .unwrap_or_else(|error| panic!("{error}"));
            let mut record = store
                .read_owned(&context, &id)
                .unwrap_or_else(|error| panic!("{error}"));
            record.expires_at = 0;
            store
                .write_record(&id, &record, true)
                .unwrap_or_else(|error| panic!("{error}"));
            std::fs::write(blobs.join(format!("{}.blob", id.as_str())), b"expired")
                .unwrap_or_else(|error| panic!("{error}"));
            std::fs::write(blobs.join("orphan.part"), b"partial")
                .unwrap_or_else(|error| panic!("{error}"));
            std::fs::write(blobs.join("orphan.blob"), b"orphan")
                .unwrap_or_else(|error| panic!("{error}"));
            let write = store
                .database
                .begin_write()
                .unwrap_or_else(|error| panic!("{error}"));
            {
                let mut records = write
                    .open_table(RECORDS)
                    .unwrap_or_else(|error| panic!("{error}"));
                records
                    .insert("corrupt", b"{".as_slice())
                    .unwrap_or_else(|error| panic!("{error}"));
            }
            write.commit().unwrap_or_else(|error| panic!("{error}"));
            std::fs::write(blobs.join("corrupt.blob"), b"corrupt")
                .unwrap_or_else(|error| panic!("{error}"));
            id
        };
        let reopened = open(&directory);
        reopened
            .garbage_collect()
            .await
            .unwrap_or_else(|error| panic!("{error}"));
        assert!(matches!(
            reopened.status(&context, &expired_id),
            Err(AttachmentStageError::NotFound)
        ));
        assert!(!blobs.join(format!("{}.blob", expired_id.as_str())).exists());
        assert!(!blobs.join("orphan.part").exists());
        assert!(!blobs.join("orphan.blob").exists());
        assert!(!blobs.join("corrupt.blob").exists());
    }

    #[tokio::test]
    async fn periodic_gc_cannot_delete_a_concurrently_completing_upload() {
        let directory = tempfile::tempdir().unwrap_or_else(|error| panic!("{error}"));
        let store = open(&directory);
        let context = owner("device-a");
        let (id, _) = store
            .stage(&context, &request(b"hello", None))
            .unwrap_or_else(|error| panic!("{error}"));
        let started = Arc::new(tokio::sync::Notify::new());
        let release = Arc::new(tokio::sync::Notify::new());
        let upload_stream = stream::unfold(
            (0_u8, started.clone(), release.clone()),
            |(phase, started, release)| async move {
                if phase == 0 {
                    started.notify_one();
                    return Some((
                        Ok::<_, std::io::Error>(Bytes::from_static(b"hello")),
                        (1, started, release),
                    ));
                }
                release.notified().await;
                None
            },
        )
        .boxed();
        let upload_store = store.clone();
        let upload_context = context.clone();
        let upload_id = id.clone();
        let upload = tokio::spawn(async move {
            upload_store
                .upload(&upload_context, &upload_id, upload_stream)
                .await
        });
        started.notified().await;
        let gc_store = store.clone();
        let mut gc = tokio::spawn(async move { gc_store.garbage_collect().await });
        assert!(
            tokio::time::timeout(Duration::from_millis(10), &mut gc)
                .await
                .is_err()
        );
        release.notify_one();
        let uploaded = upload
            .await
            .unwrap_or_else(|error| panic!("{error}"))
            .unwrap_or_else(|error| panic!("{error}"));
        gc.await
            .unwrap_or_else(|error| panic!("{error}"))
            .unwrap_or_else(|error| panic!("{error}"));
        assert!(uploaded.path.is_file());
    }

    #[tokio::test]
    async fn expired_upload_is_cancelled_before_gc_waits_for_filesystem_exclusivity() {
        let directory = tempfile::tempdir().unwrap_or_else(|error| panic!("{error}"));
        let store = open(&directory);
        let context = owner("device-a");
        let (id, _) = store
            .stage(&context, &request(b"hello", None))
            .unwrap_or_else(|error| panic!("{error}"));
        let started = Arc::new(tokio::sync::Notify::new());
        let upload_stream =
            stream::unfold((false, started.clone()), |(sent, started)| async move {
                if sent {
                    std::future::pending().await
                } else {
                    started.notify_one();
                    Some((
                        Ok::<_, std::io::Error>(Bytes::from_static(b"hello")),
                        (true, started),
                    ))
                }
            })
            .boxed();
        let upload_store = store.clone();
        let upload_context = context.clone();
        let upload_id = id.clone();
        let upload = tokio::spawn(async move {
            upload_store
                .upload(&upload_context, &upload_id, upload_stream)
                .await
        });
        started.notified().await;
        let mut record = store
            .read_owned(&context, &id)
            .unwrap_or_else(|error| panic!("{error}"));
        record.expires_at = now_ms().saturating_sub(1);
        store
            .write_record(&id, &record, true)
            .unwrap_or_else(|error| panic!("{error}"));

        tokio::time::timeout(Duration::from_secs(1), store.garbage_collect())
            .await
            .unwrap_or_else(|error| panic!("{error}"))
            .unwrap_or_else(|error| panic!("{error}"));
        assert!(matches!(
            upload.await.unwrap_or_else(|error| panic!("{error}")),
            Err(AttachmentStageError::Cancelled)
        ));
        assert!(matches!(
            store.status(&context, &id),
            Err(AttachmentStageError::NotFound)
        ));
    }

    #[tokio::test]
    async fn reservation_prevents_two_new_threads_from_consuming_one_stage() {
        let directory = tempfile::tempdir().unwrap_or_else(|error| panic!("{error}"));
        let store = open(&directory);
        let context = owner("device-a");
        let (id, _) = store
            .stage(&context, &request(b"hello", None))
            .unwrap_or_else(|error| panic!("{error}"));
        store
            .upload(
                &context,
                &id,
                stream::iter([Ok::<_, std::io::Error>(Bytes::from_static(b"hello"))]),
            )
            .await
            .unwrap_or_else(|error| panic!("{error}"));
        let first = OperationId::new("operation-a").unwrap_or_else(|error| panic!("{error}"));
        let second = OperationId::new("operation-b").unwrap_or_else(|error| panic!("{error}"));
        assert!(
            store
                .reserve_completed_for_new_thread(
                    &context,
                    Some("/workspace"),
                    &first,
                    std::slice::from_ref(&id),
                )
                .is_ok()
        );
        assert!(matches!(
            store.reserve_completed_for_new_thread(
                &context,
                Some("/workspace"),
                &second,
                std::slice::from_ref(&id),
            ),
            Err(AttachmentStageError::Conflict)
        ));
        let thread = Id::new("thread-a").unwrap_or_else(|error| panic!("{error}"));
        store
            .commit_new_thread_reservation(
                &context,
                "/workspace",
                &thread,
                &first,
                std::slice::from_ref(&id),
            )
            .unwrap_or_else(|error| panic!("{error}"));
        assert!(store.resolve_completed(&context, &thread, &id).is_ok());
        store
            .rollback_new_thread_binding(&context, &thread, std::slice::from_ref(&id))
            .unwrap_or_else(|error| panic!("{error}"));
        assert!(
            store
                .reserve_completed_for_new_thread(
                    &context,
                    Some("/workspace"),
                    &second,
                    std::slice::from_ref(&id),
                )
                .is_ok()
        );
    }

    #[tokio::test]
    async fn rollback_restores_an_omitted_workspace_for_retry() {
        let directory = tempfile::tempdir().unwrap_or_else(|error| panic!("{error}"));
        let store = open(&directory);
        let context = owner("device-a");
        let mut stage_request = request(b"hello", None);
        stage_request.workspace = None;
        let (id, _) = store
            .stage(&context, &stage_request)
            .unwrap_or_else(|error| panic!("{error}"));
        store
            .upload(
                &context,
                &id,
                stream::iter([Ok::<_, std::io::Error>(Bytes::from_static(b"hello"))]),
            )
            .await
            .unwrap_or_else(|error| panic!("{error}"));
        let first = OperationId::new("operation-a").unwrap_or_else(|error| panic!("{error}"));
        let second = OperationId::new("operation-b").unwrap_or_else(|error| panic!("{error}"));
        let ids = std::slice::from_ref(&id);
        store
            .reserve_completed_for_new_thread(&context, None, &first, ids)
            .unwrap_or_else(|error| panic!("{error}"));
        let thread = Id::new("thread-a").unwrap_or_else(|error| panic!("{error}"));
        store
            .commit_new_thread_reservation(&context, "/resolved", &thread, &first, ids)
            .unwrap_or_else(|error| panic!("{error}"));
        store
            .rollback_new_thread_binding(&context, &thread, ids)
            .unwrap_or_else(|error| panic!("{error}"));
        assert!(
            store
                .reserve_completed_for_new_thread(&context, None, &second, ids)
                .is_ok()
        );
    }
}
