//! Durable ownership and resource limits for generic V2 workspace uploads.

use std::{
    os::unix::fs::PermissionsExt,
    path::Path,
    sync::{Arc, Mutex},
    time::{Duration, SystemTime, UNIX_EPOCH},
};

use axum::http::{HeaderMap, HeaderValue};
use redb::{Database, ReadableDatabase, ReadableTable, TableDefinition};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tokio::sync::{Mutex as AsyncMutex, OwnedRwLockReadGuard, RwLock, watch};

use crate::auth::{AuthorizationChange, AuthorizationContext};
use crate::files::{FileQuery, FileService};

use super::AuthenticatedContextKey;

const RECORDS: TableDefinition<&str, &[u8]> =
    TableDefinition::new("sync_v2_workspace_upload_stages");
const RETENTION_MS: u64 = 72 * 60 * 60 * 1_000;
const GC_INTERVAL: Duration = Duration::from_mins(15);

#[derive(Clone, Copy)]
struct WorkspaceUploadLimits {
    owner_count: u64,
    owner_bytes: u64,
    global_count: u64,
    global_bytes: u64,
}

impl Default for WorkspaceUploadLimits {
    fn default() -> Self {
        Self {
            owner_count: 32,
            owner_bytes: 4 * 1024 * 1024 * 1024,
            global_count: 256,
            global_bytes: 32 * 1024 * 1024 * 1024,
        }
    }
}

#[derive(Clone)]
pub struct WorkspaceUploadStore {
    database: Arc<Database>,
    files: Arc<FileService>,
    limits: WorkspaceUploadLimits,
    cancellations: Arc<Mutex<std::collections::HashMap<String, watch::Sender<bool>>>>,
    admission: Arc<AsyncMutex<()>>,
    filesystem_guard: Arc<RwLock<()>>,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct WorkspaceUploadRecord {
    owner: String,
    root_id: String,
    path: String,
    upload_id: String,
    sha256: String,
    total_bytes: u64,
    expires_at: u64,
    active: bool,
}

pub(crate) struct WorkspaceUploadLease {
    database: Arc<Database>,
    key: String,
    total_bytes: u64,
    cancelled: watch::Receiver<bool>,
    _filesystem: OwnedRwLockReadGuard<()>,
}

impl WorkspaceUploadLease {
    pub(crate) const fn total_bytes(&self) -> u64 {
        self.total_bytes
    }

    pub(crate) fn cancellation(&self) -> watch::Receiver<bool> {
        self.cancelled.clone()
    }
}

impl Drop for WorkspaceUploadLease {
    fn drop(&mut self) {
        if let Err(error) = reset_active(&self.database, &self.key) {
            tracing::warn!(%error, "failed to release abandoned workspace upload claim");
        }
    }
}

#[derive(Debug, thiserror::Error)]
pub enum WorkspaceUploadError {
    #[error("workspace upload belongs to another device")]
    Forbidden,
    #[error("workspace upload metadata conflicts with its durable reservation")]
    Conflict,
    #[error("workspace upload staging quota exceeded")]
    QuotaExceeded,
    #[error("workspace upload storage failed: {0}")]
    Storage(String),
}

impl WorkspaceUploadStore {
    /// Opens the durable owner-bound workspace upload reservation store.
    ///
    /// # Errors
    /// Returns a storage error when the private database cannot be opened or recovered.
    pub fn open(
        database_path: impl AsRef<Path>,
        files: Arc<FileService>,
    ) -> Result<Self, WorkspaceUploadError> {
        Self::open_with_limits(database_path, files, WorkspaceUploadLimits::default())
    }

    fn open_with_limits(
        database_path: impl AsRef<Path>,
        files: Arc<FileService>,
        limits: WorkspaceUploadLimits,
    ) -> Result<Self, WorkspaceUploadError> {
        let database = Database::create(database_path.as_ref()).map_err(storage)?;
        std::fs::set_permissions(
            database_path.as_ref(),
            std::fs::Permissions::from_mode(0o600),
        )
        .map_err(storage)?;
        let write = database.begin_write().map_err(storage)?;
        let mut cancellation_ids = Vec::new();
        {
            let mut records = write.open_table(RECORDS).map_err(storage)?;
            let inspected = records
                .iter()
                .map_err(storage)?
                .map(|entry| {
                    let (key, value) = entry.map_err(storage)?;
                    Ok::<_, WorkspaceUploadError>((
                        key.value().to_owned(),
                        serde_json::from_slice::<WorkspaceUploadRecord>(value.value()),
                    ))
                })
                .collect::<Result<Vec<_>, _>>()?;
            for (key, decoded) in inspected {
                match decoded {
                    Ok(mut record) => {
                        record.active = false;
                        write_record(&mut records, &key, &record)?;
                        cancellation_ids.push(key);
                    }
                    Err(_) => {
                        records.remove(key.as_str()).map_err(storage)?;
                    }
                }
            }
        }
        write.commit().map_err(storage)?;
        Ok(Self {
            database: Arc::new(database),
            files,
            limits,
            cancellations: Arc::new(Mutex::new(
                cancellation_ids
                    .into_iter()
                    .map(|id| {
                        let (sender, _) = watch::channel(false);
                        (id, sender)
                    })
                    .collect(),
            )),
            admission: Arc::new(AsyncMutex::new(())),
            filesystem_guard: Arc::new(RwLock::new(())),
        })
    }

    pub fn start_periodic_gc(&self) {
        let Ok(runtime) = tokio::runtime::Handle::try_current() else {
            tracing::warn!("workspace upload garbage collector requires an async runtime");
            return;
        };
        let store = self.clone();
        std::mem::drop(runtime.spawn(async move {
            let _ = store.garbage_collect().await;
            let mut interval = tokio::time::interval(GC_INTERVAL);
            interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
            interval.tick().await;
            loop {
                interval.tick().await;
                if store.garbage_collect().await.is_err() {
                    tracing::warn!("workspace upload garbage collection failed");
                }
            }
        }));
    }

    /// Removes durable uploads as soon as their owning device capability changes.
    pub fn start_revocation_cleanup(
        &self,
        mut changes: tokio::sync::broadcast::Receiver<AuthorizationChange>,
    ) {
        let Ok(runtime) = tokio::runtime::Handle::try_current() else {
            tracing::warn!("workspace upload revocation cleanup requires an async runtime");
            return;
        };
        let store = self.clone();
        std::mem::drop(runtime.spawn(async move {
            loop {
                match changes.recv().await {
                    Ok(change) => {
                        if let Some(owner) = owner_for_device(&change.device_id) {
                            let _ = store.purge_owner(&owner).await;
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

    pub(crate) async fn claim(
        &self,
        owner: &AuthenticatedContextKey,
        root_id: &str,
        path: &str,
        upload_id: &str,
        sha256: &str,
        total_bytes: u64,
    ) -> Result<WorkspaceUploadLease, WorkspaceUploadError> {
        let _admission = self.admission.lock().await;
        let filesystem = self.filesystem_guard.clone().read_owned().await;
        let key = upload_key(root_id, path);
        let mut cancellations = self.cancellations.lock().map_err(storage)?;
        let write = self.database.begin_write().map_err(storage)?;
        {
            let mut records = write.open_table(RECORDS).map_err(storage)?;
            let existing = records
                .get(key.as_str())
                .map_err(storage)?
                .map(|value| serde_json::from_slice::<WorkspaceUploadRecord>(value.value()))
                .transpose()
                .map_err(storage)?;
            let record = if let Some(mut existing) = existing {
                if existing.owner != owner.as_str() {
                    return Err(WorkspaceUploadError::Forbidden);
                }
                if existing.root_id != root_id
                    || existing.path != path
                    || existing.upload_id != upload_id
                    || existing.sha256 != sha256
                    || existing.total_bytes != total_bytes
                    || existing.expires_at <= now_ms()
                {
                    return Err(WorkspaceUploadError::Conflict);
                }
                if existing.active {
                    return Err(WorkspaceUploadError::Conflict);
                }
                existing.active = true;
                existing
            } else {
                enforce_quota(&records, owner.as_str(), total_bytes, self.limits)?;
                WorkspaceUploadRecord {
                    owner: owner.as_str().to_owned(),
                    root_id: root_id.to_owned(),
                    path: path.to_owned(),
                    upload_id: upload_id.to_owned(),
                    sha256: sha256.to_owned(),
                    total_bytes,
                    expires_at: now_ms().saturating_add(RETENTION_MS),
                    active: true,
                }
            };
            write_record(&mut records, &key, &record)?;
        }
        write.commit().map_err(storage)?;
        let sender = cancellations.entry(key.clone()).or_insert_with(|| {
            let (sender, _) = watch::channel(false);
            sender
        });
        let cancelled = sender.subscribe();
        Ok(WorkspaceUploadLease {
            database: self.database.clone(),
            key,
            total_bytes,
            cancelled,
            _filesystem: filesystem,
        })
    }

    pub(crate) fn validate_owner(
        &self,
        owner: &AuthenticatedContextKey,
        root_id: &str,
        path: &str,
        upload_id: &str,
    ) -> Result<bool, WorkspaceUploadError> {
        let key = upload_key(root_id, path);
        let Some(record) = self.read(&key)? else {
            return Ok(false);
        };
        if record.owner != owner.as_str() {
            return Err(WorkspaceUploadError::Forbidden);
        }
        if record.upload_id != upload_id {
            return Err(WorkspaceUploadError::Conflict);
        }
        Ok(true)
    }

    pub(crate) fn finish(
        &self,
        lease: &WorkspaceUploadLease,
        completed: bool,
    ) -> Result<(), WorkspaceUploadError> {
        let write = self.database.begin_write().map_err(storage)?;
        {
            let mut records = write.open_table(RECORDS).map_err(storage)?;
            if completed {
                records.remove(lease.key.as_str()).map_err(storage)?;
            } else if let Some(mut record) = {
                records
                    .get(lease.key.as_str())
                    .map_err(storage)?
                    .map(|value| serde_json::from_slice::<WorkspaceUploadRecord>(value.value()))
                    .transpose()
                    .map_err(storage)?
            } {
                record.active = false;
                write_record(&mut records, &lease.key, &record)?;
            }
        }
        write.commit().map_err(storage)?;
        if completed {
            self.forget(&lease.key);
        }
        Ok(())
    }

    pub(crate) async fn abort(
        &self,
        lease: WorkspaceUploadLease,
    ) -> Result<(), WorkspaceUploadError> {
        let key = lease.key.clone();
        self.signal(&key);
        drop(lease);
        let _admission = self.admission.lock().await;
        let _filesystem = self.filesystem_guard.write().await;
        if let Some(record) = self.read(&key)? {
            self.remove_record(&key)?;
            self.cancel_file(&record).await;
        }
        self.forget(&key);
        Ok(())
    }

    pub(crate) async fn cancel(
        &self,
        owner: &AuthenticatedContextKey,
        root_id: &str,
        path: &str,
        upload_id: &str,
    ) -> Result<(), WorkspaceUploadError> {
        let _admission = self.admission.lock().await;
        let key = upload_key(root_id, path);
        let Some(record) = self.read(&key)? else {
            return Ok(());
        };
        if record.owner != owner.as_str() {
            return Err(WorkspaceUploadError::Forbidden);
        }
        if record.upload_id != upload_id {
            return Err(WorkspaceUploadError::Conflict);
        }
        self.signal(&key);
        let _filesystem = self.filesystem_guard.write().await;
        let Some(record) = self.read(&key)? else {
            return Ok(());
        };
        if record.owner != owner.as_str() || record.upload_id != upload_id {
            return Err(WorkspaceUploadError::Forbidden);
        }
        self.remove_record(&key)?;
        self.cancel_file(&record).await;
        self.forget(&key);
        Ok(())
    }

    pub(crate) async fn purge_owner(
        &self,
        owner: &AuthenticatedContextKey,
    ) -> Result<(), WorkspaceUploadError> {
        let _admission = self.admission.lock().await;
        let records = self.records_for_owner(owner.as_str())?;
        for (key, _) in &records {
            self.signal(key);
        }
        let _filesystem = self.filesystem_guard.write().await;
        for (key, record) in &records {
            self.remove_record(key)?;
            self.cancel_file(record).await;
            self.forget(key);
        }
        Ok(())
    }

    async fn garbage_collect(&self) -> Result<(), WorkspaceUploadError> {
        let _admission = self.admission.lock().await;
        let expired = self.expired_records(now_ms())?;
        for (key, _) in &expired {
            self.signal(key);
        }
        let _filesystem = self.filesystem_guard.write().await;
        for (key, record) in &expired {
            self.remove_record(key)?;
            self.cancel_file(record).await;
            self.forget(key);
        }
        Ok(())
    }

    async fn purge_all(&self) -> Result<(), WorkspaceUploadError> {
        let _admission = self.admission.lock().await;
        let records = self.filter_records(|_| true)?;
        for (key, _) in &records {
            self.signal(key);
        }
        let _filesystem = self.filesystem_guard.write().await;
        for (key, record) in &records {
            self.remove_record(key)?;
            self.cancel_file(record).await;
            self.forget(key);
        }
        Ok(())
    }

    fn read(&self, key: &str) -> Result<Option<WorkspaceUploadRecord>, WorkspaceUploadError> {
        let read = self.database.begin_read().map_err(storage)?;
        let table = read.open_table(RECORDS).map_err(storage)?;
        table
            .get(key)
            .map_err(storage)?
            .map(|value| serde_json::from_slice(value.value()).map_err(storage))
            .transpose()
    }

    fn records_for_owner(
        &self,
        owner: &str,
    ) -> Result<Vec<(String, WorkspaceUploadRecord)>, WorkspaceUploadError> {
        self.filter_records(|record| record.owner == owner)
    }

    fn expired_records(
        &self,
        current_time: u64,
    ) -> Result<Vec<(String, WorkspaceUploadRecord)>, WorkspaceUploadError> {
        self.filter_records(|record| record.expires_at <= current_time)
    }

    fn filter_records(
        &self,
        predicate: impl Fn(&WorkspaceUploadRecord) -> bool,
    ) -> Result<Vec<(String, WorkspaceUploadRecord)>, WorkspaceUploadError> {
        let read = self.database.begin_read().map_err(storage)?;
        let table = read.open_table(RECORDS).map_err(storage)?;
        table
            .iter()
            .map_err(storage)?
            .map(|entry| {
                let (key, value) = entry.map_err(storage)?;
                let record = serde_json::from_slice::<WorkspaceUploadRecord>(value.value())
                    .map_err(storage)?;
                Ok::<_, WorkspaceUploadError>(
                    predicate(&record).then(|| (key.value().to_owned(), record)),
                )
            })
            .filter_map(Result::transpose)
            .collect()
    }

    fn remove_record(&self, key: &str) -> Result<(), WorkspaceUploadError> {
        let write = self.database.begin_write().map_err(storage)?;
        {
            write
                .open_table(RECORDS)
                .map_err(storage)?
                .remove(key)
                .map_err(storage)?;
        }
        write.commit().map_err(storage)
    }

    async fn cancel_file(&self, record: &WorkspaceUploadRecord) {
        let mut headers = HeaderMap::new();
        if let Ok(value) = HeaderValue::from_str(&record.upload_id) {
            headers.insert("x-upload-id", value);
            let _ = self
                .files
                .cancel_upload(
                    FileQuery {
                        root_id: Some(record.root_id.clone()),
                        path: Some(record.path.clone()),
                    },
                    &headers,
                )
                .await;
        }
    }

    fn signal(&self, key: &str) {
        if let Ok(cancellations) = self.cancellations.lock()
            && let Some(sender) = cancellations.get(key)
        {
            let _ = sender.send(true);
        }
    }

    fn forget(&self, key: &str) {
        if let Ok(mut cancellations) = self.cancellations.lock() {
            cancellations.remove(key);
        }
    }
}

fn enforce_quota(
    records: &redb::Table<'_, &str, &[u8]>,
    owner: &str,
    candidate_bytes: u64,
    limits: WorkspaceUploadLimits,
) -> Result<(), WorkspaceUploadError> {
    let mut owner_count = 1_u64;
    let mut owner_bytes = candidate_bytes;
    let mut global_count = 1_u64;
    let mut global_bytes = candidate_bytes;
    for entry in records.iter().map_err(storage)? {
        let (_, value) = entry.map_err(storage)?;
        let record =
            serde_json::from_slice::<WorkspaceUploadRecord>(value.value()).map_err(storage)?;
        global_count = global_count
            .checked_add(1)
            .ok_or(WorkspaceUploadError::QuotaExceeded)?;
        global_bytes = global_bytes
            .checked_add(record.total_bytes)
            .ok_or(WorkspaceUploadError::QuotaExceeded)?;
        if record.owner == owner {
            owner_count = owner_count
                .checked_add(1)
                .ok_or(WorkspaceUploadError::QuotaExceeded)?;
            owner_bytes = owner_bytes
                .checked_add(record.total_bytes)
                .ok_or(WorkspaceUploadError::QuotaExceeded)?;
        }
    }
    if owner_count > limits.owner_count
        || owner_bytes > limits.owner_bytes
        || global_count > limits.global_count
        || global_bytes > limits.global_bytes
    {
        return Err(WorkspaceUploadError::QuotaExceeded);
    }
    Ok(())
}

fn write_record(
    table: &mut redb::Table<'_, &str, &[u8]>,
    key: &str,
    record: &WorkspaceUploadRecord,
) -> Result<(), WorkspaceUploadError> {
    let encoded = serde_json::to_vec(record).map_err(storage)?;
    table.insert(key, encoded.as_slice()).map_err(storage)?;
    Ok(())
}

fn reset_active(database: &Database, key: &str) -> Result<(), WorkspaceUploadError> {
    let write = database.begin_write().map_err(storage)?;
    {
        let mut records = write.open_table(RECORDS).map_err(storage)?;
        let record = records
            .get(key)
            .map_err(storage)?
            .map(|value| serde_json::from_slice::<WorkspaceUploadRecord>(value.value()))
            .transpose()
            .map_err(storage)?;
        if let Some(mut record) = record
            && record.active
        {
            record.active = false;
            write_record(&mut records, key, &record)?;
        }
    }
    write.commit().map_err(storage)
}

fn upload_key(root_id: &str, path: &str) -> String {
    let mut digest = Sha256::new();
    for part in [root_id, path] {
        digest.update(u64::try_from(part.len()).unwrap_or(u64::MAX).to_be_bytes());
        digest.update(part.as_bytes());
    }
    hex::encode(digest.finalize())
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
        .try_into()
        .unwrap_or(u64::MAX)
}

fn owner_for_device(device_id: &str) -> Option<AuthenticatedContextKey> {
    AuthenticatedContextKey::derive(&AuthorizationContext::Session {
        device_id: device_id.to_owned(),
        scopes: Vec::new(),
        expires_at: u64::MAX,
    })
    .ok()
}

fn storage(error: impl std::fmt::Display) -> WorkspaceUploadError {
    WorkspaceUploadError::Storage(error.to_string())
}

#[cfg(test)]
mod tests {
    use std::collections::HashMap;

    use super::*;

    fn owner(device_id: &str) -> AuthenticatedContextKey {
        owner_for_device(device_id).unwrap_or_else(|| panic!("owner should be derivable"))
    }

    async fn store(
        directory: &tempfile::TempDir,
        limits: WorkspaceUploadLimits,
    ) -> WorkspaceUploadStore {
        let root = directory.path().join("workspace");
        tokio::fs::create_dir_all(&root)
            .await
            .unwrap_or_else(|error| panic!("{error}"));
        let files = FileService::open(
            HashMap::from([("workspace".to_owned(), root)]),
            Vec::new(),
            None,
            Some(1024),
        )
        .await
        .unwrap_or_else(|error| panic!("{error}"));
        WorkspaceUploadStore::open_with_limits(
            directory.path().join("uploads.redb"),
            Arc::new(files),
            limits,
        )
        .unwrap_or_else(|error| panic!("{error}"))
    }

    #[tokio::test]
    async fn durable_reservations_enforce_owner_and_quota() {
        let directory = tempfile::tempdir().unwrap_or_else(|error| panic!("{error}"));
        let store = store(
            &directory,
            WorkspaceUploadLimits {
                owner_count: 1,
                owner_bytes: 8,
                global_count: 1,
                global_bytes: 8,
            },
        )
        .await;
        let first = owner("device-a");
        let second = owner("device-b");
        let lease = store
            .claim(&first, "workspace", "one.txt", "upload-a", "abcd", 8)
            .await
            .unwrap_or_else(|error| panic!("{error}"));
        assert!(matches!(
            store
                .claim(&second, "workspace", "one.txt", "upload-a", "abcd", 8)
                .await,
            Err(WorkspaceUploadError::Forbidden)
        ));
        assert!(matches!(
            store
                .claim(&second, "workspace", "two.txt", "upload-b", "efgh", 1)
                .await,
            Err(WorkspaceUploadError::QuotaExceeded)
        ));
        store
            .finish(&lease, true)
            .unwrap_or_else(|error| panic!("{error}"));
        assert!(
            store
                .claim(&second, "workspace", "two.txt", "upload-b", "efgh", 1)
                .await
                .is_ok()
        );
    }

    #[tokio::test]
    async fn concurrent_claims_admit_only_one_active_writer() {
        let directory = tempfile::tempdir().unwrap_or_else(|error| panic!("{error}"));
        let store = store(&directory, WorkspaceUploadLimits::default()).await;
        let barrier = Arc::new(tokio::sync::Barrier::new(8));
        let mut tasks = Vec::new();
        for _ in 0..8 {
            let store = store.clone();
            let barrier = barrier.clone();
            tasks.push(tokio::spawn(async move {
                barrier.wait().await;
                store
                    .claim(
                        &owner("device-a"),
                        "workspace",
                        "one.txt",
                        "upload-a",
                        "abcd",
                        8,
                    )
                    .await
            }));
        }
        let mut admitted = 0;
        for task in tasks {
            match task.await.unwrap_or_else(|error| panic!("{error}")) {
                Ok(_) => admitted += 1,
                Err(WorkspaceUploadError::Conflict) => {}
                Err(error) => panic!("unexpected error: {error}"),
            }
        }
        assert_eq!(admitted, 1);
    }

    #[tokio::test]
    async fn count_quotas_are_enforced_per_owner_and_globally() {
        let directory = tempfile::tempdir().unwrap_or_else(|error| panic!("{error}"));
        let store = store(
            &directory,
            WorkspaceUploadLimits {
                owner_count: 1,
                owner_bytes: 16,
                global_count: 2,
                global_bytes: 32,
            },
        )
        .await;
        let owner_a = owner("device-a");
        let owner_b = owner("device-b");
        let owner_c = owner("device-c");
        let _first = store
            .claim(&owner_a, "workspace", "a.txt", "upload-a", "aaaa", 4)
            .await
            .unwrap_or_else(|error| panic!("{error}"));
        assert!(matches!(
            store
                .claim(&owner_a, "workspace", "a2.txt", "upload-a2", "aaab", 4)
                .await,
            Err(WorkspaceUploadError::QuotaExceeded)
        ));
        let _second = store
            .claim(&owner_b, "workspace", "b.txt", "upload-b", "bbbb", 4)
            .await
            .unwrap_or_else(|error| panic!("{error}"));
        assert!(matches!(
            store
                .claim(&owner_c, "workspace", "c.txt", "upload-c", "cccc", 4)
                .await,
            Err(WorkspaceUploadError::QuotaExceeded)
        ));
    }

    #[tokio::test]
    async fn byte_quotas_are_enforced_per_owner_and_globally() {
        let directory = tempfile::tempdir().unwrap_or_else(|error| panic!("{error}"));
        let store = store(
            &directory,
            WorkspaceUploadLimits {
                owner_count: 2,
                owner_bytes: 4,
                global_count: 4,
                global_bytes: 6,
            },
        )
        .await;
        let owner_a = owner("device-a");
        let owner_b = owner("device-b");
        let owner_c = owner("device-c");
        let _first = store
            .claim(&owner_a, "workspace", "a.txt", "upload-a", "aaaa", 4)
            .await
            .unwrap_or_else(|error| panic!("{error}"));
        assert!(matches!(
            store
                .claim(&owner_a, "workspace", "a2.txt", "upload-a2", "aaab", 1)
                .await,
            Err(WorkspaceUploadError::QuotaExceeded)
        ));
        let _second = store
            .claim(&owner_b, "workspace", "b.txt", "upload-b", "bbbb", 2)
            .await
            .unwrap_or_else(|error| panic!("{error}"));
        assert!(matches!(
            store
                .claim(&owner_c, "workspace", "c.txt", "upload-c", "cccc", 1)
                .await,
            Err(WorkspaceUploadError::QuotaExceeded)
        ));
    }

    #[tokio::test]
    async fn dropping_a_claim_releases_the_active_writer_slot() {
        let directory = tempfile::tempdir().unwrap_or_else(|error| panic!("{error}"));
        let store = store(&directory, WorkspaceUploadLimits::default()).await;
        let context = owner("device-a");
        let lease = store
            .claim(&context, "workspace", "one.txt", "upload-a", "abcd", 8)
            .await
            .unwrap_or_else(|error| panic!("{error}"));
        drop(lease);
        assert!(
            store
                .claim(&context, "workspace", "one.txt", "upload-a", "abcd", 8,)
                .await
                .is_ok()
        );
    }

    #[tokio::test]
    async fn abort_removes_a_deterministic_simple_upload_temporary_file() {
        let directory = tempfile::tempdir().unwrap_or_else(|error| panic!("{error}"));
        let store = store(&directory, WorkspaceUploadLimits::default()).await;
        let context = owner("device-a");
        let upload_id = format!("simple-{}", "a".repeat(64));
        let lease = store
            .claim(
                &context,
                "workspace",
                "one.txt",
                &upload_id,
                &"a".repeat(64),
                8,
            )
            .await
            .unwrap_or_else(|error| panic!("{error}"));
        let temporary = directory
            .path()
            .join("workspace")
            .join(format!(".one.txt.upload-{upload_id}"));
        tokio::fs::write(&temporary, b"partial")
            .await
            .unwrap_or_else(|error| panic!("{error}"));
        store
            .abort(lease)
            .await
            .unwrap_or_else(|error| panic!("{error}"));
        assert!(!temporary.exists());
    }

    #[tokio::test]
    async fn cancel_signals_active_writer_before_waiting_for_cleanup_exclusivity() {
        let directory = tempfile::tempdir().unwrap_or_else(|error| panic!("{error}"));
        let store = store(&directory, WorkspaceUploadLimits::default()).await;
        let context = owner("device-a");
        let lease = store
            .claim(&context, "workspace", "one.txt", "upload-a", "abcd", 8)
            .await
            .unwrap_or_else(|error| panic!("{error}"));
        let mut cancelled = lease.cancellation();
        let cancel_store = store.clone();
        let cancel_context = context.clone();
        let mut cancel = tokio::spawn(async move {
            cancel_store
                .cancel(&cancel_context, "workspace", "one.txt", "upload-a")
                .await
        });
        tokio::time::timeout(Duration::from_secs(1), cancelled.changed())
            .await
            .unwrap_or_else(|error| panic!("{error}"))
            .unwrap_or_else(|error| panic!("{error}"));
        assert!(*cancelled.borrow());
        assert!(
            tokio::time::timeout(Duration::from_millis(10), &mut cancel)
                .await
                .is_err()
        );
        drop(lease);
        cancel
            .await
            .unwrap_or_else(|error| panic!("{error}"))
            .unwrap_or_else(|error| panic!("{error}"));
        assert!(
            !store
                .validate_owner(&context, "workspace", "one.txt", "upload-a")
                .unwrap_or_else(|error| panic!("{error}"))
        );
    }

    #[tokio::test]
    async fn file_publish_is_rejected_when_final_authorization_fails() {
        let directory = tempfile::tempdir().unwrap_or_else(|error| panic!("{error}"));
        let store = store(&directory, WorkspaceUploadLimits::default()).await;
        let mut headers = HeaderMap::new();
        headers.insert("content-length", HeaderValue::from_static("5"));
        headers.insert(
            "x-content-sha256",
            HeaderValue::from_static(
                "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824",
            ),
        );
        let result = store
            .files
            .upload_authorized(
                FileQuery {
                    root_id: Some("workspace".to_owned()),
                    path: Some("blocked.txt".to_owned()),
                },
                &headers,
                axum::body::Body::from("hello"),
                &crate::files::UploadCommitGuard::new(|| async { false }),
            )
            .await;
        assert!(matches!(
            result,
            Err(crate::files::FileError::Client {
                status: axum::http::StatusCode::UNAUTHORIZED,
                ..
            })
        ));
        assert!(!directory.path().join("workspace/blocked.txt").exists());
    }
}
