use std::{
    collections::{HashMap, HashSet},
    path::Path,
    sync::{Arc, Mutex},
    time::{SystemTime, UNIX_EPOCH},
};

use redb::{
    Database, ReadableDatabase, ReadableTable, ReadableTableMetadata, Table, TableDefinition,
};
use serde::{Deserialize, Serialize};
use serde_json::Value;

#[path = "store/read_receipts.rs"]
pub(crate) mod read_receipts;

const META: TableDefinition<&str, u64> = TableDefinition::new("meta");
const FILES: TableDefinition<&[u8], &[u8]> = TableDefinition::new("rollout_files");
const RECORDS: TableDefinition<&[u8], &[u8]> = TableDefinition::new("rollout_records");
const TURNS: TableDefinition<&[u8], &[u8]> = TableDefinition::new("rollout_turns");
const TURNS_BY_ID: TableDefinition<&[u8], u64> = TableDefinition::new("rollout_turns_by_id");
const TURN_SUMMARIES: TableDefinition<&[u8], &[u8]> =
    TableDefinition::new("rollout_turn_summaries");
const REPLAY: TableDefinition<u64, &[u8]> = TableDefinition::new("sync_replay");
const OUTBOX: TableDefinition<&str, &[u8]> = TableDefinition::new("command_outbox");
const THREAD_USAGE: TableDefinition<&str, &[u8]> = TableDefinition::new("thread_usage");
const THREAD_METADATA: TableDefinition<&str, &[u8]> = TableDefinition::new("thread_metadata");
const THREADS_BY_PARENT: TableDefinition<&[u8], u8> = TableDefinition::new("threads_by_parent");
const SCHEMA_VERSION: u32 = 7;
const FILE_STATE_VERSION: u8 = 2;
const FILE_STATE_V1_BYTES: usize = 65;
const FILE_STATE_BYTES: usize = 73;
const MAX_OUTBOX_COMMAND_BYTES: usize = 1024 * 1024;
const MAX_OUTBOX_OWNER_BYTES: usize = 256 * 1024 * 1024;
const MAX_RETAINED_DELIVERED_COMMANDS: usize = 128;
const OUTBOX_CHANGE_CHANNEL_CAPACITY: usize = 1_024;

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum OutboxState {
    Queued,
    Uncertain,
    Failed,
    Delivered,
}

#[derive(Clone, Copy, Debug, Default, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum OutboxPresentation {
    Delivery,
    #[default]
    Queue,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum OutboxQueueInputBlock {
    Text { text: String },
    Attachment { attachment_id: String, name: String },
    Skill { name: String, path: String },
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OutboxCommand {
    pub command_id: String,
    pub remote_thread_id: String,
    pub method: String,
    pub params: Value,
    pub state: OutboxState,
    #[serde(default)]
    pub presentation: OutboxPresentation,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub workspace_request_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub owner_context: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub queue_input: Option<Vec<OutboxQueueInputBlock>>,
    pub order: u64,
    pub created_at: u64,
    pub updated_at: u64,
    pub last_error: Option<String>,
    #[serde(default)]
    pub attempts: u32,
    #[serde(default)]
    pub next_attempt_at: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    claim: Option<OutboxClaim>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct OutboxChange {
    pub command_id: String,
    pub remote_thread_id: String,
    pub owner_context: Option<String>,
}

pub struct OutboxExpectation<'a> {
    pub owner_context: &'a str,
    pub remote_thread_id: Option<&'a str>,
    pub revision: &'a str,
}

impl From<&OutboxCommand> for OutboxChange {
    fn from(command: &OutboxCommand) -> Self {
        Self {
            command_id: command.command_id.clone(),
            remote_thread_id: command.remote_thread_id.clone(),
            owner_context: command.owner_context.clone(),
        }
    }
}

#[derive(Clone, Copy)]
struct OutboxPutMetadata<'a> {
    created_at: Option<u64>,
    presentation: OutboxPresentation,
    workspace_request_id: Option<&'a str>,
    owner_context: Option<&'a str>,
    queue_input: Option<&'a [OutboxQueueInputBlock]>,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
enum OutboxClaimKind {
    Dispatch,
    Steer,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
struct OutboxClaim {
    token: u64,
    kind: OutboxClaimKind,
    operation_id: Option<String>,
    resolved: bool,
}

#[derive(Clone, Debug, PartialEq)]
pub enum OutboxClaimOutcome {
    Acquired { command: OutboxCommand, token: u64 },
    Duplicate(OutboxCommand),
    Unavailable(Option<OutboxCommand>),
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum OutboxClaimResolution<'a> {
    Delivered,
    NotSent { retry_after_ms: u64 },
    Rejected { error: &'a str },
    Indeterminate { error: &'a str, retry_after_ms: u64 },
}

#[derive(Clone, Debug, PartialEq)]
pub enum OutboxClaimResolutionOutcome {
    Applied(OutboxCommand),
    AlreadyResolved(OutboxCommand),
    Stale(Option<OutboxCommand>),
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct TurnRef {
    pub id: String,
    pub start_offset: u64,
    pub end_offset: u64,
    pub completed: bool,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct RecordRef {
    pub offset: u64,
    pub length: u32,
    pub record_type: u8,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IndexedThreadMetadata {
    pub id: String,
    pub parent_thread_id: Option<String>,
    pub cwd: String,
    pub created_at: i64,
    pub updated_at: i64,
    pub model_provider: String,
    pub cli_version: String,
    pub source: Value,
    pub agent_nickname: Option<String>,
    pub agent_role: Option<String>,
    pub archived: bool,
}

impl TurnRef {
    fn encode(&self) -> Result<Vec<u8>, StoreError> {
        let id_bytes = self.id.as_bytes();
        let id_length = u16::try_from(id_bytes.len())
            .map_err(|_| StoreError::CorruptedIndex("turn id is too long".into()))?;
        let mut encoded = Vec::with_capacity(20 + id_bytes.len());
        encoded.push(1);
        encoded.extend_from_slice(&self.start_offset.to_be_bytes());
        encoded.extend_from_slice(&self.end_offset.to_be_bytes());
        encoded.push(u8::from(self.completed));
        encoded.extend_from_slice(&id_length.to_be_bytes());
        encoded.extend_from_slice(id_bytes);
        Ok(encoded)
    }

    fn decode(encoded: &[u8]) -> Result<Self, StoreError> {
        if encoded.len() < 20 || encoded[0] != 1 {
            return Err(StoreError::CorruptedIndex("invalid rollout turn".into()));
        }
        let id_length = usize::from(read_u16(&encoded[18..20])?);
        if encoded.len() != 20 + id_length {
            return Err(StoreError::CorruptedIndex(
                "invalid rollout turn id length".into(),
            ));
        }
        let id = std::str::from_utf8(&encoded[20..])
            .map_err(|_| StoreError::CorruptedIndex("turn id is not UTF-8".into()))?
            .to_owned();
        Ok(Self {
            id,
            start_offset: read_u64(&encoded[1..9])?,
            end_offset: read_u64(&encoded[9..17])?,
            completed: encoded[17] != 0,
        })
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct FileState {
    pub device: u64,
    pub inode: u64,
    /// First byte in the contiguous indexed range. Version-1 states always
    /// decode as zero because the old index covered the complete prefix.
    pub indexed_from: u64,
    pub indexed_bytes: u64,
    pub records: u64,
    pub tail_hash: [u8; 32],
}

impl FileState {
    #[must_use]
    pub const fn empty(device: u64, inode: u64) -> Self {
        Self {
            device,
            inode,
            indexed_from: 0,
            indexed_bytes: 0,
            records: 0,
            tail_hash: [0; 32],
        }
    }

    #[must_use]
    pub const fn tail(device: u64, inode: u64, indexed_from: u64) -> Self {
        Self {
            device,
            inode,
            indexed_from,
            indexed_bytes: indexed_from,
            records: 0,
            tail_hash: [0; 32],
        }
    }

    #[must_use]
    pub const fn is_complete(self) -> bool {
        self.indexed_from == 0
    }

    fn encode(self) -> Vec<u8> {
        if self.is_complete() {
            // Keep complete checkpoints byte-compatible with the previous
            // companion so a binary rollback can still consume mature indexes.
            let mut encoded = vec![0_u8; FILE_STATE_V1_BYTES];
            encoded[0] = 1;
            encoded[1..9].copy_from_slice(&self.device.to_be_bytes());
            encoded[9..17].copy_from_slice(&self.inode.to_be_bytes());
            encoded[17..25].copy_from_slice(&self.indexed_bytes.to_be_bytes());
            encoded[25..33].copy_from_slice(&self.records.to_be_bytes());
            encoded[33..65].copy_from_slice(&self.tail_hash);
            return encoded;
        }
        let mut encoded = vec![0_u8; FILE_STATE_BYTES];
        encoded[0] = FILE_STATE_VERSION;
        encoded[1..9].copy_from_slice(&self.device.to_be_bytes());
        encoded[9..17].copy_from_slice(&self.inode.to_be_bytes());
        encoded[17..25].copy_from_slice(&self.indexed_from.to_be_bytes());
        encoded[25..33].copy_from_slice(&self.indexed_bytes.to_be_bytes());
        encoded[33..41].copy_from_slice(&self.records.to_be_bytes());
        encoded[41..73].copy_from_slice(&self.tail_hash);
        encoded
    }

    fn decode(encoded: &[u8]) -> Result<Self, StoreError> {
        if encoded.len() == FILE_STATE_V1_BYTES && encoded[0] == 1 {
            return Ok(Self {
                device: read_u64(&encoded[1..9])?,
                inode: read_u64(&encoded[9..17])?,
                indexed_from: 0,
                indexed_bytes: read_u64(&encoded[17..25])?,
                records: read_u64(&encoded[25..33])?,
                tail_hash: encoded[33..65]
                    .try_into()
                    .map_err(|_| StoreError::CorruptedIndex("invalid tail hash".into()))?,
            });
        }
        if encoded.len() != FILE_STATE_BYTES || encoded[0] != FILE_STATE_VERSION {
            return Err(StoreError::CorruptedIndex(
                "invalid rollout file state".into(),
            ));
        }
        Ok(Self {
            device: read_u64(&encoded[1..9])?,
            inode: read_u64(&encoded[9..17])?,
            indexed_from: read_u64(&encoded[17..25])?,
            indexed_bytes: read_u64(&encoded[25..33])?,
            records: read_u64(&encoded[33..41])?,
            tail_hash: encoded[41..73]
                .try_into()
                .map_err(|_| StoreError::CorruptedIndex("invalid tail hash".into()))?,
        })
    }
}

#[derive(Debug, thiserror::Error)]
pub enum StoreError {
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
    #[error("corrupt companion index: {0}")]
    CorruptedIndex(String),
    #[error("durable queue storage quota exceeded ({limit_bytes} bytes per owner)")]
    OutboxOwnerQuotaExceeded { limit_bytes: usize },
    #[error("durable outbox changed since it was read")]
    OutboxRevisionConflict,
}

pub struct IndexStore {
    database: Database,
    rollout_index_locks: Mutex<HashMap<[u8; 32], Arc<Mutex<()>>>>,
    outbox_changes: tokio::sync::broadcast::Sender<OutboxChange>,
}

#[derive(Debug, Eq, PartialEq)]
pub struct ReplayPage {
    pub head_cursor: u64,
    pub oldest_cursor: Option<u64>,
    pub retained_entries: u64,
    pub retained_bytes: u64,
    pub snapshot_required: bool,
    pub entries: Vec<(u64, Vec<u8>)>,
}

impl IndexStore {
    /// Opens an existing index or creates an empty index atomically.
    ///
    /// # Errors
    ///
    /// Returns an error if the database is unavailable, corrupt, or uses an
    /// unsupported schema version.
    pub fn open(path: impl AsRef<Path>) -> Result<Self, StoreError> {
        let database = Database::create(path)?;
        let write = database.begin_write()?;
        let rebuild_rollout_index = {
            let mut meta = write.open_table(META)?;
            let stored = meta.get("schema_version")?.map(|value| value.value());
            match stored {
                Some(version) if version == u64::from(SCHEMA_VERSION) => false,
                None | Some(6) => {
                    meta.insert("schema_version", u64::from(SCHEMA_VERSION))?;
                    false
                }
                Some(2..=5) => {
                    meta.insert("schema_version", u64::from(SCHEMA_VERSION))?;
                    true
                }
                Some(version) => {
                    return Err(StoreError::Database(redb::Error::Corrupted(format!(
                        "unsupported schema version {version}"
                    ))));
                }
            }
        };
        {
            write.open_table(FILES)?;
            write.open_table(RECORDS)?;
            write.open_table(TURNS)?;
            write.open_table(TURNS_BY_ID)?;
            write.open_table(TURN_SUMMARIES)?;
            write.open_table(REPLAY)?;
            write.open_table(OUTBOX)?;
            write.open_table(THREAD_USAGE)?;
            write.open_table(THREAD_METADATA)?;
            write.open_table(THREADS_BY_PARENT)?;
            read_receipts::open_tables(&write)?;
        }
        if rebuild_rollout_index {
            write.open_table(FILES)?.retain(|_key, _value| false)?;
            write.open_table(RECORDS)?.retain(|_key, _value| false)?;
            write.open_table(TURNS)?.retain(|_key, _value| false)?;
            write
                .open_table(TURNS_BY_ID)?
                .retain(|_key, _value| false)?;
            write
                .open_table(TURN_SUMMARIES)?
                .retain(|_key, _value| false)?;
        }
        write.commit()?;
        let (outbox_changes, _) = tokio::sync::broadcast::channel(OUTBOX_CHANGE_CHANNEL_CAPACITY);
        Ok(Self {
            database,
            rollout_index_locks: Mutex::new(HashMap::new()),
            outbox_changes,
        })
    }

    /// Subscribes to committed durable outbox mutations.
    ///
    /// The notification is only an invalidation edge. Callers must read the
    /// durable outbox for the authoritative queue contents.
    #[must_use]
    pub fn subscribe_outbox_changes(&self) -> tokio::sync::broadcast::Receiver<OutboxChange> {
        self.outbox_changes.subscribe()
    }

    fn publish_outbox_change(&self, command: &OutboxCommand) {
        let _ = self.outbox_changes.send(OutboxChange::from(command));
    }

    pub(crate) fn rollout_index_lock(&self, file_id: [u8; 32]) -> Arc<Mutex<()>> {
        self.rollout_index_locks
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .entry(file_id)
            .or_insert_with(|| Arc::new(Mutex::new(())))
            .clone()
    }

    /// Atomically updates one thread's canonical metadata and parent index.
    ///
    /// # Errors
    ///
    /// Returns an error when serialization or the redb transaction fails.
    pub fn put_thread_metadata(&self, metadata: &IndexedThreadMetadata) -> Result<(), StoreError> {
        self.put_thread_metadata_batch(std::slice::from_ref(metadata))
    }

    /// Atomically updates a batch of canonical thread metadata rows.
    ///
    /// # Errors
    ///
    /// Returns an error when serialization or the redb transaction fails.
    pub fn put_thread_metadata_batch(
        &self,
        values: &[IndexedThreadMetadata],
    ) -> Result<(), StoreError> {
        let encoded = values
            .iter()
            .map(serde_json::to_vec)
            .collect::<Result<Vec<_>, _>>()?;
        let write = self.database.begin_write()?;
        {
            let mut metadata_table = write.open_table(THREAD_METADATA)?;
            let mut parents = write.open_table(THREADS_BY_PARENT)?;
            for (metadata, encoded) in values.iter().zip(encoded) {
                let previous = metadata_table
                    .get(metadata.id.as_str())?
                    .map(|value| serde_json::from_slice::<IndexedThreadMetadata>(value.value()))
                    .transpose()?;
                metadata_table.insert(metadata.id.as_str(), encoded.as_slice())?;
                if let Some(previous_parent) = previous.and_then(|value| value.parent_thread_id) {
                    parents.remove(parent_thread_key(&previous_parent, &metadata.id).as_slice())?;
                }
                if let Some(parent) = metadata.parent_thread_id.as_deref() {
                    parents.insert(parent_thread_key(parent, &metadata.id).as_slice(), 1)?;
                }
            }
        }
        write.commit()?;
        Ok(())
    }

    /// Reads one indexed thread metadata row.
    ///
    /// # Errors
    ///
    /// Returns an error when the index cannot be read or contains invalid JSON.
    pub fn thread_metadata(
        &self,
        thread_id: &str,
    ) -> Result<Option<IndexedThreadMetadata>, StoreError> {
        let read = self.database.begin_read()?;
        let table = read.open_table(THREAD_METADATA)?;
        table
            .get(thread_id)?
            .map(|value| serde_json::from_slice(value.value()))
            .transpose()
            .map_err(StoreError::from)
    }

    /// Returns all indexed descendants of one root in parent-before-child order.
    ///
    /// # Errors
    ///
    /// Returns an error when the index cannot be read or contains invalid JSON.
    pub fn thread_descendants(
        &self,
        root_thread_id: &str,
    ) -> Result<Vec<IndexedThreadMetadata>, StoreError> {
        let read = self.database.begin_read()?;
        let parents = read.open_table(THREADS_BY_PARENT)?;
        let metadata = read.open_table(THREAD_METADATA)?;
        let mut pending = vec![root_thread_id.to_owned()];
        let mut seen = HashSet::new();
        let mut descendants = Vec::new();
        while let Some(parent) = pending.pop() {
            let prefix = parent_thread_prefix(&parent);
            let mut end = prefix.clone();
            end.push(u8::MAX);
            let mut children = parents
                .range(prefix.as_slice()..=end.as_slice())?
                .filter_map(|entry| {
                    let (key, _value) = entry.ok()?;
                    let key = key.value();
                    let child = std::str::from_utf8(&key[prefix.len()..]).ok()?;
                    seen.insert(child.to_owned()).then_some(child.to_owned())
                })
                .collect::<Vec<_>>();
            children.sort();
            for child in children.into_iter().rev() {
                if let Some(value) = metadata.get(child.as_str())? {
                    descendants.push(serde_json::from_slice(value.value())?);
                    pending.push(child);
                }
            }
        }
        Ok(descendants)
    }

    #[must_use]
    pub const fn schema_version(&self) -> u32 {
        SCHEMA_VERSION
    }

    /// Reads one companion-owned thread usage state.
    ///
    /// # Errors
    ///
    /// Returns an error when the table cannot be read or the stored JSON is invalid.
    pub fn thread_usage<T: for<'de> Deserialize<'de>>(
        &self,
        thread_id: &str,
    ) -> Result<Option<T>, StoreError> {
        let read = self.database.begin_read()?;
        let table = read.open_table(THREAD_USAGE)?;
        table
            .get(thread_id)?
            .map(|value| serde_json::from_slice(value.value()))
            .transpose()
            .map_err(StoreError::from)
    }

    /// Atomically replaces one companion-owned thread usage state.
    ///
    /// # Errors
    ///
    /// Returns an error when serialization or the redb transaction fails.
    pub fn put_thread_usage<T: Serialize>(
        &self,
        thread_id: &str,
        value: &T,
    ) -> Result<(), StoreError> {
        let encoded = serde_json::to_vec(value)?;
        let write = self.database.begin_write()?;
        {
            let mut table = write.open_table(THREAD_USAGE)?;
            table.insert(thread_id, encoded.as_slice())?;
        }
        write.commit()?;
        Ok(())
    }

    /// Reads the durable progress for a rollout file.
    ///
    /// # Errors
    ///
    /// Returns an error if the read transaction fails or the stored state is
    /// corrupt.
    pub fn file_state(&self, file_id: &[u8; 32]) -> Result<Option<FileState>, StoreError> {
        let read = self.database.begin_read()?;
        let table = read.open_table(FILES)?;
        table
            .get(file_id.as_slice())?
            .map(|value| FileState::decode(value.value()))
            .transpose()
    }

    /// Returns indexed source-record references at or after `from_offset`.
    ///
    /// Consumers use this compact shared index to build semantic projections
    /// without independently scanning the canonical JSONL file again.
    ///
    /// # Errors
    ///
    /// Returns an error if the index cannot be read or contains an invalid
    /// record reference.
    pub fn records_from(
        &self,
        file_id: &[u8; 32],
        from_offset: u64,
    ) -> Result<Vec<RecordRef>, StoreError> {
        let start = offset_key(file_id, from_offset);
        let end = offset_key(file_id, u64::MAX);
        let read = self.database.begin_read()?;
        let table = read.open_table(RECORDS)?;
        table
            .range(start.as_slice()..=end.as_slice())?
            .map(|entry| {
                let (_key, value) = entry?;
                decode_record_ref(value.value())
            })
            .collect()
    }

    /// Commits rollout references and their exact source checkpoint atomically.
    ///
    /// # Errors
    ///
    /// Returns an error if a write transaction cannot be opened or committed.
    pub fn commit_batch(
        &self,
        file_id: &[u8; 32],
        records: &[(Vec<u8>, Vec<u8>)],
        turns: &[TurnRef],
        turn_summaries: &[(u64, Vec<u8>)],
        file_state: FileState,
    ) -> Result<(), StoreError> {
        let write = self.database.begin_write()?;
        {
            let mut table = write.open_table(RECORDS)?;
            for (key, value) in records {
                table.insert(key.as_slice(), value.as_slice())?;
            }
        }
        {
            let mut table = write.open_table(TURNS)?;
            let mut by_id = write.open_table(TURNS_BY_ID)?;
            for turn in turns {
                let key = offset_key(file_id, turn.start_offset);
                let value = turn.encode()?;
                table.insert(key.as_slice(), value.as_slice())?;
                let id_key = turn_id_key(file_id, &turn.id);
                by_id.insert(id_key.as_slice(), turn.start_offset)?;
            }
        }
        {
            let mut table = write.open_table(TURN_SUMMARIES)?;
            for (start_offset, summary) in turn_summaries {
                let key = offset_key(file_id, *start_offset);
                table.insert(key.as_slice(), summary.as_slice())?;
            }
        }
        {
            let mut files = write.open_table(FILES)?;
            files.insert(file_id.as_slice(), file_state.encode().as_slice())?;
        }
        write.commit()?;
        Ok(())
    }

    /// Removes the derived index for one replaced or truncated rollout.
    ///
    /// # Errors
    ///
    /// Returns an error if the range cannot be removed atomically.
    pub fn reset_file(&self, file_id: &[u8; 32]) -> Result<(), StoreError> {
        let mut start = Vec::with_capacity(40);
        start.extend_from_slice(file_id);
        start.extend_from_slice(&0_u64.to_be_bytes());
        let mut end = Vec::with_capacity(40);
        end.extend_from_slice(file_id);
        end.extend_from_slice(&u64::MAX.to_be_bytes());
        let mut id_start = Vec::with_capacity(33);
        id_start.extend_from_slice(file_id);
        id_start.push(0);
        let mut id_end = Vec::with_capacity(33);
        id_end.extend_from_slice(file_id);
        id_end.push(u8::MAX);

        let write = self.database.begin_write()?;
        {
            let mut records = write.open_table(RECORDS)?;
            records.retain_in(start.as_slice()..=end.as_slice(), |_key, _value| false)?;
        }
        {
            let mut turns = write.open_table(TURNS)?;
            turns.retain_in(start.as_slice()..=end.as_slice(), |_key, _value| false)?;
        }
        {
            let mut turns_by_id = write.open_table(TURNS_BY_ID)?;
            turns_by_id.retain_in(id_start.as_slice()..=id_end.as_slice(), |_key, _value| {
                false
            })?;
        }
        {
            let mut summaries = write.open_table(TURN_SUMMARIES)?;
            summaries.retain_in(start.as_slice()..=end.as_slice(), |_key, _value| false)?;
        }
        {
            let mut files = write.open_table(FILES)?;
            files.remove(file_id.as_slice())?;
        }
        write.commit()?;
        Ok(())
    }

    /// Returns the number of indexed JSONL records.
    ///
    /// # Errors
    ///
    /// Returns an error if a read transaction cannot access the index table.
    pub fn record_count(&self) -> Result<u64, StoreError> {
        let read = self.database.begin_read()?;
        let table = read.open_table(RECORDS)?;
        Ok(table.len()?)
    }

    /// Returns the newest turns before an optional source offset.
    ///
    /// # Errors
    ///
    /// Returns an error if the index cannot be read or contains a corrupt row.
    pub fn turns_desc(
        &self,
        file_id: &[u8; 32],
        before_offset: Option<u64>,
        limit: usize,
    ) -> Result<Vec<TurnRef>, StoreError> {
        if limit == 0 {
            return Ok(Vec::new());
        }
        let start = offset_key(file_id, 0);
        let inclusive_end = before_offset.map_or(u64::MAX, |offset| offset.saturating_sub(1));
        let end = offset_key(file_id, inclusive_end);
        let read = self.database.begin_read()?;
        let table = read.open_table(TURNS)?;
        let mut turns = Vec::with_capacity(limit);
        for entry in table
            .range(start.as_slice()..=end.as_slice())?
            .rev()
            .take(limit)
        {
            let (_key, value) = entry?;
            turns.push(TurnRef::decode(value.value())?);
        }
        Ok(turns)
    }

    /// Returns turns after an exclusive source offset in chronological order.
    ///
    /// # Errors
    ///
    /// Returns an error if the index cannot be read or contains a corrupt row.
    pub fn turns_asc_after(
        &self,
        file_id: &[u8; 32],
        after_offset: u64,
        limit: usize,
    ) -> Result<Vec<TurnRef>, StoreError> {
        if limit == 0 || after_offset == u64::MAX {
            return Ok(Vec::new());
        }
        let start = offset_key(file_id, after_offset.saturating_add(1));
        let end = offset_key(file_id, u64::MAX);
        let read = self.database.begin_read()?;
        let table = read.open_table(TURNS)?;
        table
            .range(start.as_slice()..=end.as_slice())?
            .take(limit)
            .map(|entry| {
                let (_key, value) = entry?;
                TurnRef::decode(value.value())
            })
            .collect()
    }

    /// Resolves one turn without scanning the thread history.
    ///
    /// # Errors
    ///
    /// Returns an error if the index cannot be read or contains a corrupt row.
    pub fn turn_by_id(
        &self,
        file_id: &[u8; 32],
        turn_id: &str,
    ) -> Result<Option<TurnRef>, StoreError> {
        let read = self.database.begin_read()?;
        let by_id = read.open_table(TURNS_BY_ID)?;
        let id_key = turn_id_key(file_id, turn_id);
        let Some(offset) = by_id.get(id_key.as_slice())?.map(|value| value.value()) else {
            return Ok(None);
        };
        let turns = read.open_table(TURNS)?;
        let key = offset_key(file_id, offset);
        turns
            .get(key.as_slice())?
            .map(|value| TurnRef::decode(value.value()))
            .transpose()
    }

    /// Reads the materialized projection state for one indexed turn.
    ///
    /// # Errors
    ///
    /// Returns an error if the index cannot be read or the row is invalid JSON.
    pub fn turn_summary_state<T: for<'de> Deserialize<'de>>(
        &self,
        file_id: &[u8; 32],
        start_offset: u64,
    ) -> Result<Option<T>, StoreError> {
        let read = self.database.begin_read()?;
        let table = read.open_table(TURN_SUMMARIES)?;
        let key = offset_key(file_id, start_offset);
        table
            .get(key.as_slice())?
            .map(|value| serde_json::from_slice(value.value()))
            .transpose()
            .map_err(StoreError::from)
    }

    /// Persists one materialized turn projection without changing the rollout
    /// checkpoint. Used to lazily enrich an offset index created by an older
    /// companion without rebuilding the whole session.
    ///
    /// # Errors
    ///
    /// Returns an error when serialization or the redb transaction fails.
    pub fn put_turn_summary_state<T: Serialize>(
        &self,
        file_id: &[u8; 32],
        start_offset: u64,
        state: &T,
    ) -> Result<(), StoreError> {
        let encoded = serde_json::to_vec(state)?;
        let write = self.database.begin_write()?;
        {
            let mut table = write.open_table(TURN_SUMMARIES)?;
            let key = offset_key(file_id, start_offset);
            table.insert(key.as_slice(), encoded.as_slice())?;
        }
        write.commit()?;
        Ok(())
    }

    /// Returns the number of indexed turns.
    ///
    /// # Errors
    ///
    /// Returns an error if the table cannot be read.
    pub fn turn_count(&self) -> Result<u64, StoreError> {
        let read = self.database.begin_read()?;
        let table = read.open_table(TURNS)?;
        Ok(table.len()?)
    }

    /// Atomically appends payloads to the bounded durable sync replay tail.
    ///
    /// # Errors
    ///
    /// Returns an error when the transaction cannot be committed.
    pub fn append_replay_batch(
        &self,
        payloads: &[Vec<u8>],
        max_entries: usize,
        max_bytes: u64,
    ) -> Result<Vec<u64>, StoreError> {
        if payloads.is_empty() {
            return Ok(Vec::new());
        }
        let write = self.database.begin_write()?;
        let mut cursors = Vec::with_capacity(payloads.len());
        {
            let mut meta = write.open_table(META)?;
            let mut replay = write.open_table(REPLAY)?;
            let mut head = meta.get("replay_head")?.map_or(0, |value| value.value());
            let mut bytes = meta.get("replay_bytes")?.map_or(0, |value| value.value());
            for payload in payloads {
                head = head.saturating_add(1);
                replay.insert(head, payload.as_slice())?;
                bytes = bytes.saturating_add(payload.len() as u64);
                cursors.push(head);
            }
            let max_entries = u64::try_from(max_entries).unwrap_or(u64::MAX);
            while replay.len()? > max_entries || bytes > max_bytes {
                let oldest = {
                    let mut entries = replay.iter()?;
                    entries
                        .next()
                        .transpose()?
                        .map(|(key, value)| (key.value(), value.value().len() as u64))
                };
                let Some((cursor, entry_bytes)) = oldest else {
                    break;
                };
                replay.remove(cursor)?;
                bytes = bytes.saturating_sub(entry_bytes);
            }
            meta.insert("replay_head", head)?;
            meta.insert("replay_bytes", bytes)?;
        }
        write.commit()?;
        Ok(cursors)
    }

    /// Reads the retained replay suffix after a client cursor.
    ///
    /// # Errors
    ///
    /// Returns an error when the replay table cannot be read.
    pub fn replay_after(&self, cursor: Option<u64>) -> Result<ReplayPage, StoreError> {
        let read = self.database.begin_read()?;
        let meta = read.open_table(META)?;
        let replay = read.open_table(REPLAY)?;
        let head_cursor = meta.get("replay_head")?.map_or(0, |value| value.value());
        let retained_bytes = meta.get("replay_bytes")?.map_or(0, |value| value.value());
        let oldest = replay.first()?.map(|(key, _value)| key.value());
        let retained_entries = replay.len()?;
        let snapshot_required = match cursor {
            None => true,
            Some(cursor) => {
                cursor > head_cursor
                    || oldest.is_some_and(|oldest| cursor < oldest.saturating_sub(1))
            }
        };
        let mut entries = Vec::new();
        if !snapshot_required {
            let start = cursor.unwrap_or(0).saturating_add(1);
            for entry in replay.range(start..)? {
                let (key, value) = entry?;
                entries.push((key.value(), value.value().to_vec()));
            }
        }
        Ok(ReplayPage {
            head_cursor,
            oldest_cursor: oldest,
            retained_entries,
            retained_bytes,
            snapshot_required,
            entries,
        })
    }

    /// Returns the durable head cursor without materializing replay entries.
    ///
    /// # Errors
    ///
    /// Returns an error when the metadata table cannot be read.
    pub fn replay_head(&self) -> Result<u64, StoreError> {
        let read = self.database.begin_read()?;
        let meta = read.open_table(META)?;
        Ok(meta.get("replay_head")?.map_or(0, |value| value.value()))
    }

    /// Inserts an idempotent `turn/start` command into the durable outbox.
    /// Reusing an id with the same payload returns the existing command;
    /// reusing it with a different payload is rejected.
    ///
    /// # Errors
    ///
    /// Returns an error for invalid commands, corruption, or a failed transaction.
    pub fn outbox_put_turn_start(
        &self,
        command_id: &str,
        remote_thread_id: &str,
        params: Value,
        created_at: Option<u64>,
    ) -> Result<OutboxCommand, StoreError> {
        self.outbox_put_turn_start_with_presentation(
            command_id,
            remote_thread_id,
            params,
            created_at,
            OutboxPresentation::Queue,
        )
    }

    /// Inserts a durable turn command while keeping transport delivery and an
    /// explicit user queue as separate UI presentations.
    ///
    /// # Errors
    ///
    /// Returns an error when identifiers or parameters are invalid, the
    /// command is too large, persistence fails, or an existing command does
    /// not match the requested operation.
    pub fn outbox_put_turn_start_with_presentation(
        &self,
        command_id: &str,
        remote_thread_id: &str,
        params: Value,
        created_at: Option<u64>,
        presentation: OutboxPresentation,
    ) -> Result<OutboxCommand, StoreError> {
        self.outbox_put_turn_start_inner(
            command_id,
            remote_thread_id,
            params,
            OutboxPutMetadata {
                created_at,
                presentation,
                workspace_request_id: None,
                owner_context: None,
                queue_input: None,
            },
        )
    }

    /// Inserts a durable V2 queue item bound to one authenticated device.
    ///
    /// The owner is server-local authorization metadata and never becomes part
    /// of the App Server command payload.
    ///
    /// # Errors
    ///
    /// Returns an error under the same conditions as
    /// [`Self::outbox_put_turn_start_with_presentation`].
    pub fn outbox_put_turn_start_for_owner(
        &self,
        command_id: &str,
        remote_thread_id: &str,
        params: Value,
        created_at: Option<u64>,
        presentation: OutboxPresentation,
        owner_context: &str,
    ) -> Result<OutboxCommand, StoreError> {
        self.outbox_put_turn_start_inner(
            command_id,
            remote_thread_id,
            params,
            OutboxPutMetadata {
                created_at,
                presentation,
                workspace_request_id: None,
                owner_context: Some(owner_context),
                queue_input: None,
            },
        )
    }

    /// Inserts a device-owned V2 queue item with a durable presentation input.
    ///
    /// # Errors
    /// Returns an error under the same conditions as
    /// [`Self::outbox_put_turn_start_for_owner`].
    pub fn outbox_put_turn_start_for_owner_with_queue_input(
        &self,
        command_id: &str,
        remote_thread_id: &str,
        params: Value,
        owner_context: &str,
        queue_input: &[OutboxQueueInputBlock],
    ) -> Result<OutboxCommand, StoreError> {
        self.outbox_put_turn_start_inner(
            command_id,
            remote_thread_id,
            params,
            OutboxPutMetadata {
                created_at: None,
                presentation: OutboxPresentation::Queue,
                workspace_request_id: None,
                owner_context: Some(owner_context),
                queue_input: Some(queue_input),
            },
        )
    }

    /// Inserts a durable turn command gated by an optional workspace operation.
    ///
    /// # Errors
    ///
    /// Returns an error under the same conditions as
    /// [`Self::outbox_put_turn_start_with_presentation`].
    pub fn outbox_put_turn_start_with_workspace(
        &self,
        command_id: &str,
        remote_thread_id: &str,
        params: Value,
        created_at: Option<u64>,
        presentation: OutboxPresentation,
        workspace_request_id: Option<&str>,
    ) -> Result<OutboxCommand, StoreError> {
        self.outbox_put_turn_start_inner(
            command_id,
            remote_thread_id,
            params,
            OutboxPutMetadata {
                created_at,
                presentation,
                workspace_request_id,
                owner_context: None,
                queue_input: None,
            },
        )
    }

    fn outbox_put_turn_start_inner(
        &self,
        command_id: &str,
        remote_thread_id: &str,
        params: Value,
        metadata: OutboxPutMetadata<'_>,
    ) -> Result<OutboxCommand, StoreError> {
        let OutboxPutMetadata {
            created_at,
            presentation,
            workspace_request_id,
            owner_context,
            queue_input,
        } = metadata;
        validate_outbox_id(command_id, "command id")?;
        validate_outbox_id(remote_thread_id, "remote thread id")?;
        if let Some(request_id) = workspace_request_id {
            validate_outbox_id(request_id, "workspace request id")?;
        }
        if let Some(owner) = owner_context {
            validate_outbox_id(owner, "outbox owner")?;
        }
        validate_turn_start_params(command_id, remote_thread_id, &params)?;
        let params_bytes = serde_json::to_vec(&params)?.len();
        if params_bytes > MAX_OUTBOX_COMMAND_BYTES {
            return Err(StoreError::CorruptedIndex(
                "outbox command exceeds 1 MiB".into(),
            ));
        }
        let write = self.database.begin_write()?;
        let (command, pruned_changes) = {
            let mut table = write.open_table(OUTBOX)?;
            if let Some(encoded) = table.get(command_id)?.map(|value| value.value().to_vec()) {
                let existing: OutboxCommand = serde_json::from_slice(&encoded)?;
                if existing.remote_thread_id != remote_thread_id
                    || existing.method != "turn/start"
                    || existing.params != params
                    || existing.presentation != presentation
                    || existing.workspace_request_id.as_deref() != workspace_request_id
                    || existing.owner_context.as_deref() != owner_context
                    || existing.queue_input.as_deref() != queue_input
                {
                    return Err(StoreError::CorruptedIndex(
                        "outbox command id already has a different payload".into(),
                    ));
                }
                return Ok(existing);
            }
            let (pruned_changes, max_order) = prune_delivered_outbox_receipts(&mut table)?;
            let now = unix_time_ms();
            let command = OutboxCommand {
                command_id: command_id.to_owned(),
                remote_thread_id: remote_thread_id.to_owned(),
                method: "turn/start".into(),
                params,
                state: OutboxState::Queued,
                presentation,
                workspace_request_id: workspace_request_id.map(str::to_owned),
                owner_context: owner_context.map(str::to_owned),
                queue_input: queue_input.map(<[OutboxQueueInputBlock]>::to_vec),
                order: max_order.saturating_add(1),
                created_at: created_at.unwrap_or(now),
                updated_at: now,
                last_error: None,
                attempts: 0,
                next_attempt_at: 0,
                claim: None,
            };
            let encoded = serde_json::to_vec(&command)?;
            ensure_outbox_owner_quota(outbox_owner_bytes(&table, owner_context)?, encoded.len())?;
            table.insert(command_id, encoded.as_slice())?;
            (command, pruned_changes)
        };
        write.commit()?;
        for change in pruned_changes {
            let _ = self.outbox_changes.send(change);
        }
        self.publish_outbox_change(&command);
        Ok(command)
    }

    /// Removes old delivered receipts while preserving queued, uncertain, and
    /// failed commands. Returns the number of reclaimed rows.
    ///
    /// # Errors
    ///
    /// Returns an error if the outbox cannot be read or updated.
    pub fn outbox_prune_delivered_receipts(&self) -> Result<usize, StoreError> {
        let write = self.database.begin_write()?;
        let removed = {
            let mut table = write.open_table(OUTBOX)?;
            prune_delivered_outbox_receipts(&mut table)?.0
        };
        write.commit()?;
        let removed_count = removed.len();
        for change in removed {
            let _ = self.outbox_changes.send(change);
        }
        Ok(removed_count)
    }

    /// Lists durable outbox commands in dispatch order.
    ///
    /// # Errors
    ///
    /// Returns an error if the table cannot be read or contains invalid JSON.
    pub fn outbox_list(
        &self,
        remote_thread_id: Option<&str>,
    ) -> Result<Vec<OutboxCommand>, StoreError> {
        let read = self.database.begin_read()?;
        let table = read.open_table(OUTBOX)?;
        let mut commands = Vec::new();
        for entry in table.iter()? {
            let (_key, value) = entry?;
            let command: OutboxCommand = serde_json::from_slice(value.value())?;
            if remote_thread_id.is_none_or(|thread_id| command.remote_thread_id == thread_id) {
                commands.push(command);
            }
        }
        commands.sort_by_key(|command| (command.order, command.created_at));
        Ok(commands)
    }

    /// Lists queue items owned by one authenticated V2 device.
    ///
    /// # Errors
    ///
    /// Returns an error if the durable outbox is unavailable or corrupt.
    pub fn outbox_list_for_owner(
        &self,
        owner_context: &str,
        remote_thread_id: Option<&str>,
    ) -> Result<Vec<OutboxCommand>, StoreError> {
        let mut commands = self.outbox_list(remote_thread_id)?;
        commands.retain(|command| command.owner_context.as_deref() == Some(owner_context));
        Ok(commands)
    }

    /// Reads one durable outbox row by stable command identity.
    ///
    /// # Errors
    ///
    /// Returns an error if the durable outbox is unavailable or corrupt.
    pub fn outbox_get(&self, command_id: &str) -> Result<Option<OutboxCommand>, StoreError> {
        validate_outbox_id(command_id, "command id")?;
        let read = self.database.begin_read()?;
        let table = read.open_table(OUTBOX)?;
        table
            .get(command_id)?
            .map(|encoded| serde_json::from_slice(encoded.value()).map_err(StoreError::from))
            .transpose()
    }

    /// Lists one device's durable queue together with its compare-and-swap revision.
    ///
    /// # Errors
    ///
    /// Returns an error if the durable outbox is unavailable or corrupt.
    pub fn outbox_list_for_owner_with_revision(
        &self,
        owner_context: &str,
        remote_thread_id: Option<&str>,
    ) -> Result<(Vec<OutboxCommand>, String), StoreError> {
        let commands = self.outbox_list_for_owner(owner_context, remote_thread_id)?;
        let revision = outbox_revision(&commands)?;
        Ok((commands, revision))
    }

    /// Returns the first dispatchable command for every thread.
    ///
    /// # Errors
    ///
    /// Returns an error if the outbox cannot be read.
    pub fn outbox_ready_heads(&self) -> Result<Vec<OutboxCommand>, StoreError> {
        let now = unix_time_ms();
        let mut heads = HashMap::<String, OutboxCommand>::new();
        for command in self.outbox_list(None)? {
            if matches!(command.state, OutboxState::Failed | OutboxState::Delivered) {
                continue;
            }
            heads
                .entry(command.remote_thread_id.clone())
                .or_insert(command);
        }
        Ok(heads
            .into_values()
            .filter(|command| command.next_attempt_at <= now)
            .collect())
    }

    /// Atomically claims one queued command for ordinary `turn/start` delivery.
    /// Only the caller receiving [`OutboxClaimOutcome::Acquired`] may send it.
    ///
    /// # Errors
    ///
    /// Returns an error when the row is corrupt or persistence fails.
    pub fn outbox_claim_dispatch(
        &self,
        command_id: &str,
    ) -> Result<OutboxClaimOutcome, StoreError> {
        self.outbox_claim(command_id, OutboxClaimKind::Dispatch, None, None)
    }

    /// Atomically removes one queued command from dispatcher ownership and
    /// claims its input for one explicit steer operation.
    ///
    /// Repeating the same operation id returns `Duplicate` without granting a
    /// second send, including after restart or an explicit queue retry.
    ///
    /// # Errors
    ///
    /// Returns an error for an invalid operation id, corrupt row, or failed transaction.
    pub fn outbox_claim_steer(
        &self,
        command_id: &str,
        operation_id: &str,
    ) -> Result<OutboxClaimOutcome, StoreError> {
        validate_outbox_id(operation_id, "steer operation id")?;
        self.outbox_claim(command_id, OutboxClaimKind::Steer, Some(operation_id), None)
    }

    /// Atomically claims a queued steer only if the client queue revision is current.
    ///
    /// # Errors
    ///
    /// Returns an error if the revision is stale or the claim cannot be persisted.
    pub fn outbox_claim_steer_checked(
        &self,
        command_id: &str,
        operation_id: &str,
        expectation: &OutboxExpectation<'_>,
    ) -> Result<OutboxClaimOutcome, StoreError> {
        validate_outbox_id(operation_id, "steer operation id")?;
        self.outbox_claim(
            command_id,
            OutboxClaimKind::Steer,
            Some(operation_id),
            Some(expectation),
        )
    }

    /// Resolves a previously acquired dispatch or steer claim.
    ///
    /// Definite acceptance becomes `Delivered`, definite rejection becomes
    /// `Failed`, and transport ambiguity remains `Uncertain`. A stale token or
    /// repeated resolution is a typed no-op.
    ///
    /// # Errors
    ///
    /// Returns an error when the row is corrupt or persistence fails.
    pub fn outbox_resolve_claim(
        &self,
        command_id: &str,
        token: u64,
        resolution: OutboxClaimResolution<'_>,
    ) -> Result<OutboxClaimResolutionOutcome, StoreError> {
        validate_outbox_id(command_id, "command id")?;
        let write = self.database.begin_write()?;
        let outcome = {
            let mut table = write.open_table(OUTBOX)?;
            let Some(encoded) = table.get(command_id)?.map(|value| value.value().to_vec()) else {
                return Ok(OutboxClaimResolutionOutcome::Stale(None));
            };
            let mut command: OutboxCommand = serde_json::from_slice(&encoded)?;
            let Some(claim) = command.claim.as_mut() else {
                return Ok(OutboxClaimResolutionOutcome::Stale(Some(command)));
            };
            if claim.token != token {
                return Ok(OutboxClaimResolutionOutcome::Stale(Some(command)));
            }
            if claim.resolved || command.state != OutboxState::Uncertain {
                return Ok(OutboxClaimResolutionOutcome::AlreadyResolved(command));
            }
            let now = unix_time_ms();
            match resolution {
                OutboxClaimResolution::Delivered => {
                    command.state = OutboxState::Delivered;
                    command.last_error = None;
                    command.next_attempt_at = 0;
                }
                OutboxClaimResolution::NotSent { retry_after_ms } => {
                    command.state = OutboxState::Queued;
                    command.last_error = None;
                    command.next_attempt_at = now.saturating_add(retry_after_ms);
                }
                OutboxClaimResolution::Rejected { error } => {
                    command.state = OutboxState::Failed;
                    command.last_error = Some(bounded_outbox_error(error));
                    command.next_attempt_at = 0;
                }
                OutboxClaimResolution::Indeterminate {
                    error,
                    retry_after_ms,
                } => {
                    command.attempts = command.attempts.saturating_add(1);
                    command.last_error = Some(bounded_outbox_error(error));
                    command.next_attempt_at = now.saturating_add(retry_after_ms);
                }
            }
            command.updated_at = now;
            if let Some(claim) = command.claim.as_mut() {
                claim.resolved = true;
            }
            let encoded = serde_json::to_vec(&command)?;
            table.insert(command_id, encoded.as_slice())?;
            OutboxClaimResolutionOutcome::Applied(command)
        };
        write.commit()?;
        if let OutboxClaimResolutionOutcome::Applied(command) = &outcome {
            self.publish_outbox_change(command);
        }
        Ok(outcome)
    }

    /// Marks a command failed only while it is still owned by the queue.
    /// A concurrent dispatcher or steer claim wins without being overwritten.
    ///
    /// # Errors
    ///
    /// Returns an error when the row is corrupt or persistence fails.
    pub fn outbox_fail_queued(
        &self,
        command_id: &str,
        error: &str,
    ) -> Result<Option<OutboxCommand>, StoreError> {
        validate_outbox_id(command_id, "command id")?;
        let write = self.database.begin_write()?;
        let failed = {
            let mut table = write.open_table(OUTBOX)?;
            let Some(encoded) = table.get(command_id)?.map(|value| value.value().to_vec()) else {
                return Ok(None);
            };
            let mut command: OutboxCommand = serde_json::from_slice(&encoded)?;
            if command.state != OutboxState::Queued {
                return Ok(None);
            }
            command.state = OutboxState::Failed;
            command.updated_at = unix_time_ms();
            command.last_error = Some(bounded_outbox_error(error));
            command.next_attempt_at = 0;
            let encoded = serde_json::to_vec(&command)?;
            table.insert(command_id, encoded.as_slice())?;
            Some(command)
        };
        write.commit()?;
        if let Some(command) = &failed {
            self.publish_outbox_change(command);
        }
        Ok(failed)
    }

    fn outbox_claim(
        &self,
        command_id: &str,
        kind: OutboxClaimKind,
        operation_id: Option<&str>,
        expectation: Option<&OutboxExpectation<'_>>,
    ) -> Result<OutboxClaimOutcome, StoreError> {
        validate_outbox_id(command_id, "command id")?;
        let write = self.database.begin_write()?;
        let outcome = {
            let mut table = write.open_table(OUTBOX)?;
            ensure_outbox_expectation(&table, expectation)?;
            let Some(encoded) = table.get(command_id)?.map(|value| value.value().to_vec()) else {
                return Ok(OutboxClaimOutcome::Unavailable(None));
            };
            let mut command: OutboxCommand = serde_json::from_slice(&encoded)?;
            ensure_outbox_command_matches_expectation(&command, expectation)?;
            let repeated_steer = kind == OutboxClaimKind::Steer
                && command.claim.as_ref().is_some_and(|claim| {
                    claim.kind == OutboxClaimKind::Steer
                        && claim.operation_id.as_deref() == operation_id
                });
            if repeated_steer {
                OutboxClaimOutcome::Duplicate(command)
            } else if command.state != OutboxState::Queued {
                OutboxClaimOutcome::Unavailable(Some(command))
            } else {
                let token = command
                    .claim
                    .as_ref()
                    .map_or(Some(1), |claim| claim.token.checked_add(1))
                    .ok_or_else(|| {
                        StoreError::CorruptedIndex("outbox claim token exhausted".into())
                    })?;
                command.state = OutboxState::Uncertain;
                command.updated_at = unix_time_ms();
                command.next_attempt_at = 0;
                command.last_error = None;
                command.claim = Some(OutboxClaim {
                    token,
                    kind,
                    operation_id: operation_id.map(str::to_owned),
                    resolved: false,
                });
                let encoded = serde_json::to_vec(&command)?;
                table.insert(command_id, encoded.as_slice())?;
                OutboxClaimOutcome::Acquired { command, token }
            }
        };
        write.commit()?;
        if let OutboxClaimOutcome::Acquired { command, .. } = &outcome {
            self.publish_outbox_change(command);
        }
        Ok(outcome)
    }

    /// Changes a command delivery state atomically.
    ///
    /// # Errors
    ///
    /// Returns an error if the command is missing or persistence fails.
    pub fn outbox_set_state(
        &self,
        command_id: &str,
        state: OutboxState,
        last_error: Option<&str>,
    ) -> Result<OutboxCommand, StoreError> {
        let write = self.database.begin_write()?;
        let command = {
            let mut table = write.open_table(OUTBOX)?;
            let encoded = table
                .get(command_id)?
                .map(|value| value.value().to_vec())
                .ok_or_else(|| StoreError::CorruptedIndex("outbox command not found".into()))?;
            let mut command: OutboxCommand = serde_json::from_slice(&encoded)?;
            command.state = state;
            command.updated_at = unix_time_ms();
            command.last_error = last_error.map(bounded_outbox_error);
            command.next_attempt_at = 0;
            if state != OutboxState::Uncertain
                && let Some(claim) = command.claim.as_mut()
            {
                claim.resolved = true;
            }
            let encoded = serde_json::to_vec(&command)?;
            table.insert(command_id, encoded.as_slice())?;
            command
        };
        write.commit()?;
        self.publish_outbox_change(&command);
        Ok(command)
    }

    /// Defers a transiently failed command without releasing the per-thread
    /// FIFO head. The attempt counter and deadline are durable across restarts.
    ///
    /// # Errors
    ///
    /// Returns an error if the command is missing or persistence fails.
    pub fn outbox_defer(
        &self,
        command_id: &str,
        state: OutboxState,
        last_error: &str,
        delay_ms: u64,
    ) -> Result<OutboxCommand, StoreError> {
        let write = self.database.begin_write()?;
        let command = {
            let mut table = write.open_table(OUTBOX)?;
            let encoded = table
                .get(command_id)?
                .map(|value| value.value().to_vec())
                .ok_or_else(|| StoreError::CorruptedIndex("outbox command not found".into()))?;
            let mut command: OutboxCommand = serde_json::from_slice(&encoded)?;
            let now = unix_time_ms();
            command.state = state;
            command.attempts = command.attempts.saturating_add(1);
            command.updated_at = now;
            command.next_attempt_at = now.saturating_add(delay_ms);
            command.last_error = Some(bounded_outbox_error(last_error));
            if state != OutboxState::Uncertain
                && let Some(claim) = command.claim.as_mut()
            {
                claim.resolved = true;
            }
            let encoded = serde_json::to_vec(&command)?;
            table.insert(command_id, encoded.as_slice())?;
            command
        };
        write.commit()?;
        self.publish_outbox_change(&command);
        Ok(command)
    }

    /// Delays a command for a known non-failure condition without consuming a
    /// retry attempt. The returned flag reports a client-visible state change.
    ///
    /// # Errors
    ///
    /// Returns an error if the command is missing or persistence fails.
    pub fn outbox_wait(
        &self,
        command_id: &str,
        state: OutboxState,
        last_error: Option<&str>,
        delay_ms: u64,
    ) -> Result<(OutboxCommand, bool), StoreError> {
        let write = self.database.begin_write()?;
        let (command, changed) = {
            let mut table = write.open_table(OUTBOX)?;
            let encoded = table
                .get(command_id)?
                .map(|value| value.value().to_vec())
                .ok_or_else(|| StoreError::CorruptedIndex("outbox command not found".into()))?;
            let mut command: OutboxCommand = serde_json::from_slice(&encoded)?;
            let changed = command.state != state || command.last_error.as_deref() != last_error;
            let now = unix_time_ms();
            command.state = state;
            command.updated_at = now;
            command.next_attempt_at = now.saturating_add(delay_ms);
            command.last_error = last_error.map(bounded_outbox_error);
            if state != OutboxState::Uncertain
                && let Some(claim) = command.claim.as_mut()
            {
                claim.resolved = true;
            }
            let encoded = serde_json::to_vec(&command)?;
            table.insert(command_id, encoded.as_slice())?;
            (command, changed)
        };
        write.commit()?;
        if changed {
            self.publish_outbox_change(&command);
        }
        Ok((command, changed))
    }

    /// Reopens commands terminally failed by legacy account-switch handling.
    /// Returns affected thread ids so connected clients can be refreshed.
    ///
    /// # Errors
    ///
    /// Returns an error if the outbox cannot be read or updated.
    pub fn outbox_recover_legacy_account_pool_failures(&self) -> Result<Vec<String>, StoreError> {
        let write = self.database.begin_write()?;
        let (threads, changed_commands) = {
            let mut table = write.open_table(OUTBOX)?;
            let mut recovered = HashSet::new();
            let mut updates = Vec::new();
            let mut changed_commands = Vec::new();
            for entry in table.iter()? {
                let (key, value) = entry?;
                let mut command: OutboxCommand = serde_json::from_slice(value.value())?;
                let recoverable = command.last_error.as_deref().is_some_and(|error| {
                    error.contains("account switch deferred while another turn is active")
                        || error.contains("Codex App Server restart failed")
                });
                if command.state != OutboxState::Failed || !recoverable {
                    continue;
                }
                command.state = OutboxState::Queued;
                command.attempts = 0;
                command.updated_at = unix_time_ms();
                command.next_attempt_at = 0;
                command.last_error = None;
                recovered.insert(command.remote_thread_id.clone());
                updates.push((key.value().to_owned(), serde_json::to_vec(&command)?));
                changed_commands.push(command);
            }
            for (command_id, encoded) in updates {
                table.insert(command_id.as_str(), encoded.as_slice())?;
            }
            (recovered.into_iter().collect::<Vec<_>>(), changed_commands)
        };
        write.commit()?;
        for command in &changed_commands {
            self.publish_outbox_change(command);
        }
        Ok(threads)
    }

    /// Reopens a terminally failed command with the same stable identity.
    /// Delivered receipts remain terminal and cannot be replayed.
    ///
    /// # Errors
    ///
    /// Returns an error if the command is missing, is not failed, or persistence fails.
    pub fn outbox_retry_failed(&self, command_id: &str) -> Result<OutboxCommand, StoreError> {
        self.outbox_retry_failed_inner(command_id, None)
    }

    /// Retries a failed item only if the client queue revision is current.
    ///
    /// # Errors
    ///
    /// Returns an error if the revision is stale or persistence fails.
    pub fn outbox_retry_failed_checked(
        &self,
        command_id: &str,
        expectation: &OutboxExpectation<'_>,
    ) -> Result<OutboxCommand, StoreError> {
        self.outbox_retry_failed_inner(command_id, Some(expectation))
    }

    fn outbox_retry_failed_inner(
        &self,
        command_id: &str,
        expectation: Option<&OutboxExpectation<'_>>,
    ) -> Result<OutboxCommand, StoreError> {
        let write = self.database.begin_write()?;
        let command = {
            let mut table = write.open_table(OUTBOX)?;
            ensure_outbox_expectation(&table, expectation)?;
            let encoded = table
                .get(command_id)?
                .map(|value| value.value().to_vec())
                .ok_or_else(|| StoreError::CorruptedIndex("outbox command not found".into()))?;
            let mut command: OutboxCommand = serde_json::from_slice(&encoded)?;
            ensure_outbox_command_matches_expectation(&command, expectation)?;
            if command.state != OutboxState::Failed {
                return Err(StoreError::CorruptedIndex(
                    "only a failed outbox command can be retried".into(),
                ));
            }
            let now = unix_time_ms();
            command.state = OutboxState::Queued;
            command.attempts = 0;
            command.updated_at = now;
            command.next_attempt_at = 0;
            command.last_error = None;
            let encoded = serde_json::to_vec(&command)?;
            table.insert(command_id, encoded.as_slice())?;
            command
        };
        write.commit()?;
        self.publish_outbox_change(&command);
        Ok(command)
    }

    /// Replaces the editable text and remote-file inputs of a command that has
    /// not started dispatching yet. Non-editable inputs such as skills remain
    /// attached to the queued turn.
    ///
    /// # Errors
    ///
    /// Returns an error if the command is not queued, the replacement input is
    /// invalid, or the edited payload exceeds the durable queue limits.
    pub fn outbox_edit_prompt(
        &self,
        command_id: &str,
        replacement_input: &Value,
    ) -> Result<OutboxCommand, StoreError> {
        self.outbox_edit_prompt_inner(command_id, replacement_input, None, None)
    }

    /// Edits an item only if the client queue revision is current.
    ///
    /// # Errors
    ///
    /// Returns an error if the revision is stale, input is invalid, or persistence fails.
    pub fn outbox_edit_prompt_checked(
        &self,
        command_id: &str,
        replacement_input: &Value,
        expectation: &OutboxExpectation<'_>,
    ) -> Result<OutboxCommand, StoreError> {
        self.outbox_edit_prompt_inner(command_id, replacement_input, Some(expectation), None)
    }

    /// Edits a V2 queue item and atomically replaces its presentation input.
    ///
    /// # Errors
    /// Returns an error if the revision, wire input, or presentation input is invalid.
    pub fn outbox_edit_prompt_checked_with_queue_input(
        &self,
        command_id: &str,
        replacement_input: &Value,
        expectation: &OutboxExpectation<'_>,
        queue_input: &[OutboxQueueInputBlock],
    ) -> Result<OutboxCommand, StoreError> {
        self.outbox_edit_prompt_inner(
            command_id,
            replacement_input,
            Some(expectation),
            Some(queue_input),
        )
    }

    fn outbox_edit_prompt_inner(
        &self,
        command_id: &str,
        replacement_input: &Value,
        expectation: Option<&OutboxExpectation<'_>>,
        queue_input: Option<&[OutboxQueueInputBlock]>,
    ) -> Result<OutboxCommand, StoreError> {
        let replacement = replacement_input
            .as_array()
            .ok_or_else(|| StoreError::CorruptedIndex("queued input must be an array".into()))?;
        let text_count = replacement
            .iter()
            .filter(|item| item.get("type").and_then(Value::as_str) == Some("text"))
            .count();
        let valid_parts = replacement.iter().all(|item| {
            matches!(
                item.get("type").and_then(Value::as_str),
                Some("text" | "remoteFile")
            )
        });
        let text_valid = replacement.iter().all(|item| {
            item.get("type").and_then(Value::as_str) != Some("text")
                || item
                    .get("text")
                    .and_then(Value::as_str)
                    .is_some_and(|text| text.chars().count() <= 1_000_000)
        });
        if replacement.is_empty() || text_count > 1 || !valid_parts || !text_valid {
            return Err(StoreError::CorruptedIndex(
                "queued input must contain editable text or remote files".into(),
            ));
        }
        let write = self.database.begin_write()?;
        let command = {
            let mut table = write.open_table(OUTBOX)?;
            ensure_outbox_expectation(&table, expectation)?;
            let current_encoded = table
                .get(command_id)?
                .map(|value| value.value().to_vec())
                .ok_or_else(|| StoreError::CorruptedIndex("outbox command not found".into()))?;
            let current_encoded_len = current_encoded.len();
            let mut command: OutboxCommand = serde_json::from_slice(&current_encoded)?;
            ensure_outbox_command_matches_expectation(&command, expectation)?;
            ensure_outbox_editable(&command)?;
            let input = command
                .params
                .get_mut("input")
                .and_then(Value::as_array_mut)
                .ok_or_else(|| StoreError::CorruptedIndex("queued command has no input".into()))?;
            let preserved = input
                .iter()
                .filter(|item| {
                    !matches!(
                        item.get("type").and_then(Value::as_str),
                        Some("text" | "remoteFile")
                    )
                })
                .cloned()
                .collect::<Vec<_>>();
            input.clone_from(replacement);
            input.extend(preserved);
            validate_turn_start_params(
                &command.command_id,
                &command.remote_thread_id,
                &command.params,
            )?;
            if serde_json::to_vec(&command.params)?.len() > MAX_OUTBOX_COMMAND_BYTES {
                return Err(StoreError::CorruptedIndex(
                    "outbox command exceeds 1 MiB".into(),
                ));
            }
            command.updated_at = unix_time_ms();
            if let Some(queue_input) = queue_input {
                let mut updated_queue_input = queue_input.to_vec();
                if let Some(current_queue_input) = &command.queue_input {
                    updated_queue_input.extend(
                        current_queue_input
                            .iter()
                            .filter(|block| matches!(block, OutboxQueueInputBlock::Skill { .. }))
                            .cloned(),
                    );
                }
                command.queue_input = Some(updated_queue_input);
            }
            let encoded = serde_json::to_vec(&command)?;
            let owner_bytes = outbox_owner_bytes(&table, command.owner_context.as_deref())?;
            ensure_outbox_owner_replacement_quota(owner_bytes, current_encoded_len, encoded.len())?;
            table.insert(command_id, encoded.as_slice())?;
            command
        };
        write.commit()?;
        self.publish_outbox_change(&command);
        Ok(command)
    }

    /// Reorders one queued command relative to another command owned by the
    /// same principal in the same thread. A `None` target places it last.
    ///
    /// # Errors
    ///
    /// Returns an error when either command is missing, not queued, or belongs
    /// to another thread.
    pub fn outbox_place(
        &self,
        command_id: &str,
        before_command_id: Option<&str>,
    ) -> Result<bool, StoreError> {
        self.outbox_place_inner(command_id, before_command_id, None)
            .map(|(changed, _command)| changed)
    }

    /// Reorders an item only if the client queue revision is current.
    ///
    /// # Errors
    ///
    /// Returns an error if the revision is stale or persistence fails.
    pub fn outbox_place_checked(
        &self,
        command_id: &str,
        before_command_id: Option<&str>,
        expectation: &OutboxExpectation<'_>,
    ) -> Result<OutboxCommand, StoreError> {
        self.outbox_place_inner(command_id, before_command_id, Some(expectation))
            .map(|(_changed, command)| command)
    }

    fn outbox_place_inner(
        &self,
        command_id: &str,
        before_command_id: Option<&str>,
        expectation: Option<&OutboxExpectation<'_>>,
    ) -> Result<(bool, OutboxCommand), StoreError> {
        let write = self.database.begin_write()?;
        let (changed_commands, selected) = {
            let mut table = write.open_table(OUTBOX)?;
            ensure_outbox_expectation(&table, expectation)?;
            let mut same_thread = Vec::new();
            let mut selected = None;
            for entry in table.iter()? {
                let (_key, value) = entry?;
                let command: OutboxCommand = serde_json::from_slice(value.value())?;
                if command.command_id == command_id {
                    ensure_outbox_editable(&command)?;
                    selected = Some(command.clone());
                }
                if command.state == OutboxState::Queued {
                    same_thread.push(command);
                }
            }
            let selected = selected
                .ok_or_else(|| StoreError::CorruptedIndex("outbox command not found".into()))?;
            ensure_outbox_command_matches_expectation(&selected, expectation)?;
            same_thread.retain(|candidate| {
                candidate.remote_thread_id == selected.remote_thread_id
                    && candidate.owner_context == selected.owner_context
            });
            same_thread.sort_by_key(|candidate| (candidate.order, candidate.created_at));
            let order_slots = same_thread
                .iter()
                .map(|candidate| candidate.order)
                .collect::<Vec<_>>();
            same_thread.retain(|candidate| candidate.command_id != command_id);
            let insert_at = match before_command_id {
                None => same_thread.len(),
                Some(target) => same_thread
                    .iter()
                    .position(|candidate| candidate.command_id == target)
                    .ok_or_else(|| {
                        StoreError::CorruptedIndex("queued placement target does not exist".into())
                    })?,
            };
            same_thread.insert(insert_at, selected);
            let now = unix_time_ms();
            let mut changed_commands = Vec::new();
            let mut selected = None;
            for (mut command, order) in same_thread.into_iter().zip(order_slots) {
                if command.order != order {
                    command.order = order;
                    command.updated_at = now;
                    let encoded = serde_json::to_vec(&command)?;
                    table.insert(command.command_id.as_str(), encoded.as_slice())?;
                    changed_commands.push(command.clone());
                }
                if command.command_id == command_id {
                    selected = Some(command);
                }
            }
            let selected = selected.ok_or_else(|| {
                StoreError::CorruptedIndex("outbox command disappeared during placement".into())
            })?;
            (changed_commands, selected)
        };
        write.commit()?;
        for command in &changed_commands {
            self.publish_outbox_change(command);
        }
        Ok((!changed_commands.is_empty(), selected))
    }

    /// Removes a queued or failed command. Commands being reconciled or
    /// already delivered remain as idempotency receipts.
    ///
    /// # Errors
    ///
    /// Returns an error if persistence fails or the row is corrupt.
    pub fn outbox_cancel(&self, command_id: &str) -> Result<bool, StoreError> {
        self.outbox_cancel_inner(command_id, None)
    }

    /// Cancels an item only if the client queue revision is current.
    ///
    /// # Errors
    ///
    /// Returns an error if the revision is stale or persistence fails.
    pub fn outbox_cancel_checked(
        &self,
        command_id: &str,
        expectation: &OutboxExpectation<'_>,
    ) -> Result<bool, StoreError> {
        self.outbox_cancel_inner(command_id, Some(expectation))
    }

    fn outbox_cancel_inner(
        &self,
        command_id: &str,
        expectation: Option<&OutboxExpectation<'_>>,
    ) -> Result<bool, StoreError> {
        let write = self.database.begin_write()?;
        let cancelled = {
            let mut table = write.open_table(OUTBOX)?;
            ensure_outbox_expectation(&table, expectation)?;
            let Some(encoded) = table.get(command_id)?.map(|value| value.value().to_vec()) else {
                return Ok(false);
            };
            let command: OutboxCommand = serde_json::from_slice(&encoded)?;
            ensure_outbox_command_matches_expectation(&command, expectation)?;
            if !matches!(command.state, OutboxState::Queued | OutboxState::Failed) {
                return Ok(false);
            }
            table.remove(command_id)?;
            Some(command)
        };
        write.commit()?;
        if let Some(command) = &cancelled {
            self.publish_outbox_change(command);
        }
        Ok(cancelled.is_some())
    }
}

fn validate_outbox_id(value: &str, label: &str) -> Result<(), StoreError> {
    if value.is_empty()
        || value.len() > 512
        || value
            .bytes()
            .any(|byte| byte.is_ascii_control() || byte == 0x7f)
    {
        return Err(StoreError::CorruptedIndex(format!("invalid {label}")));
    }
    Ok(())
}

fn bounded_outbox_error(error: &str) -> String {
    error.chars().take(500).collect()
}

fn outbox_owner_bytes(
    table: &Table<'_, &str, &[u8]>,
    owner_context: Option<&str>,
) -> Result<usize, StoreError> {
    let mut total = 0_usize;
    for entry in table.iter()? {
        let (_key, value) = entry?;
        let command: OutboxCommand = serde_json::from_slice(value.value())?;
        if command.owner_context.as_deref() == owner_context {
            total = total.saturating_add(value.value().len());
        }
    }
    Ok(total)
}

fn ensure_outbox_owner_quota(
    current_bytes: usize,
    incoming_bytes: usize,
) -> Result<(), StoreError> {
    if current_bytes.saturating_add(incoming_bytes) > MAX_OUTBOX_OWNER_BYTES {
        return Err(StoreError::OutboxOwnerQuotaExceeded {
            limit_bytes: MAX_OUTBOX_OWNER_BYTES,
        });
    }
    Ok(())
}

fn ensure_outbox_owner_replacement_quota(
    current_bytes: usize,
    replaced_bytes: usize,
    replacement_bytes: usize,
) -> Result<(), StoreError> {
    ensure_outbox_owner_quota(
        current_bytes.saturating_sub(replaced_bytes),
        replacement_bytes,
    )
}

fn outbox_revision(commands: &[OutboxCommand]) -> Result<String, StoreError> {
    let encoded = serde_json::to_vec(commands)?;
    Ok(blake3::hash(&encoded).to_hex().to_string())
}

fn ensure_outbox_expectation(
    table: &Table<'_, &str, &[u8]>,
    expectation: Option<&OutboxExpectation<'_>>,
) -> Result<(), StoreError> {
    let Some(expectation) = expectation else {
        return Ok(());
    };
    let mut commands = Vec::new();
    for entry in table.iter()? {
        let (_key, value) = entry?;
        let command: OutboxCommand = serde_json::from_slice(value.value())?;
        if command.owner_context.as_deref() == Some(expectation.owner_context)
            && expectation
                .remote_thread_id
                .is_none_or(|thread_id| command.remote_thread_id == thread_id)
        {
            commands.push(command);
        }
    }
    commands.sort_by_key(|command| (command.order, command.created_at));
    if outbox_revision(&commands)? != expectation.revision {
        return Err(StoreError::OutboxRevisionConflict);
    }
    Ok(())
}

fn ensure_outbox_command_matches_expectation(
    command: &OutboxCommand,
    expectation: Option<&OutboxExpectation<'_>>,
) -> Result<(), StoreError> {
    let Some(expectation) = expectation else {
        return Ok(());
    };
    if command.owner_context.as_deref() != Some(expectation.owner_context)
        || expectation
            .remote_thread_id
            .is_some_and(|thread_id| command.remote_thread_id != thread_id)
    {
        return Err(StoreError::OutboxRevisionConflict);
    }
    Ok(())
}

fn prune_delivered_outbox_receipts(
    table: &mut Table<'_, &str, &[u8]>,
) -> Result<(Vec<OutboxChange>, u64), StoreError> {
    let mut max_order = 0_u64;
    let mut delivered = Vec::new();
    for entry in table.iter()? {
        let (key, value) = entry?;
        let command: OutboxCommand = serde_json::from_slice(value.value())?;
        max_order = max_order.max(command.order);
        if command.state == OutboxState::Delivered {
            delivered.push((
                key.value().to_owned(),
                command.updated_at,
                command.order,
                command.owner_context.clone(),
            ));
        }
    }
    // Delivered rows are short-lived receipts for reconnecting clients, not
    // permanent queue history. Keep a bounded recent window per owner without
    // ever rejecting active or failed durable work because another owner filled
    // a process-global quota.
    delivered.sort_by_key(|(_, updated_at, order, _)| (*updated_at, *order));
    let mut delivered_counts = HashMap::<Option<String>, usize>::new();
    for (_, _, _, owner_context) in &delivered {
        *delivered_counts.entry(owner_context.clone()).or_default() += 1;
    }
    let mut removed = Vec::new();
    for (command_id, _, _, owner_context) in delivered {
        let Some(delivered_count) = delivered_counts.get_mut(&owner_context) else {
            continue;
        };
        if *delivered_count <= MAX_RETAINED_DELIVERED_COMMANDS {
            continue;
        }
        let Some(encoded) = table
            .remove(command_id.as_str())?
            .map(|value| value.value().to_vec())
        else {
            continue;
        };
        let command: OutboxCommand = serde_json::from_slice(&encoded)?;
        *delivered_count -= 1;
        removed.push(OutboxChange::from(&command));
    }
    Ok((removed, max_order))
}

fn ensure_outbox_editable(command: &OutboxCommand) -> Result<(), StoreError> {
    if command.state != OutboxState::Queued {
        return Err(StoreError::CorruptedIndex(
            "queued command is already dispatching or no longer exists".into(),
        ));
    }
    Ok(())
}

fn validate_turn_start_params(
    command_id: &str,
    remote_thread_id: &str,
    params: &Value,
) -> Result<(), StoreError> {
    let object = params
        .as_object()
        .ok_or_else(|| StoreError::CorruptedIndex("outbox params must be an object".into()))?;
    if object.get("threadId").and_then(Value::as_str) != Some(remote_thread_id)
        || object.get("clientUserMessageId").and_then(Value::as_str) != Some(command_id)
        || object
            .get("input")
            .and_then(Value::as_array)
            .is_none_or(Vec::is_empty)
    {
        return Err(StoreError::CorruptedIndex(
            "outbox turn/start id or input is invalid".into(),
        ));
    }
    Ok(())
}

fn unix_time_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |duration| {
            u64::try_from(duration.as_millis()).unwrap_or(u64::MAX)
        })
}

fn offset_key(file_id: &[u8; 32], offset: u64) -> Vec<u8> {
    let mut key = Vec::with_capacity(40);
    key.extend_from_slice(file_id);
    key.extend_from_slice(&offset.to_be_bytes());
    key
}

fn turn_id_key(file_id: &[u8; 32], turn_id: &str) -> Vec<u8> {
    let mut key = Vec::with_capacity(33 + turn_id.len());
    key.extend_from_slice(file_id);
    key.push(0);
    key.extend_from_slice(turn_id.as_bytes());
    key
}

fn parent_thread_prefix(parent_thread_id: &str) -> Vec<u8> {
    let mut key = Vec::with_capacity(parent_thread_id.len() + 1);
    key.extend_from_slice(parent_thread_id.as_bytes());
    key.push(0);
    key
}

fn parent_thread_key(parent_thread_id: &str, child_thread_id: &str) -> Vec<u8> {
    let mut key = parent_thread_prefix(parent_thread_id);
    key.extend_from_slice(child_thread_id.as_bytes());
    key
}

fn read_u64(bytes: &[u8]) -> Result<u64, StoreError> {
    let array: [u8; 8] = bytes
        .try_into()
        .map_err(|_| StoreError::CorruptedIndex("invalid integer width".into()))?;
    Ok(u64::from_be_bytes(array))
}

fn read_u16(bytes: &[u8]) -> Result<u16, StoreError> {
    let array: [u8; 2] = bytes
        .try_into()
        .map_err(|_| StoreError::CorruptedIndex("invalid integer width".into()))?;
    Ok(u16::from_be_bytes(array))
}

fn decode_record_ref(encoded: &[u8]) -> Result<RecordRef, StoreError> {
    if encoded.len() != 13 {
        return Err(StoreError::CorruptedIndex(
            "invalid rollout record reference".into(),
        ));
    }
    Ok(RecordRef {
        offset: read_u64(&encoded[..8])?,
        length: u32::from_be_bytes(
            encoded[8..12]
                .try_into()
                .map_err(|_| StoreError::CorruptedIndex("invalid record length".into()))?,
        ),
        record_type: encoded[12],
    })
}

#[cfg(test)]
mod tests {
    use std::sync::{Arc, Barrier};

    use serde_json::json;

    use super::{
        FILE_STATE_V1_BYTES, FileState, IndexStore, MAX_OUTBOX_OWNER_BYTES, OutboxClaimOutcome,
        OutboxClaimResolution, OutboxClaimResolutionOutcome, OutboxPresentation, OutboxState,
        StoreError, ensure_outbox_owner_quota, ensure_outbox_owner_replacement_quota,
    };

    fn put_queued(store: &IndexStore, command_id: &str) -> Result<(), super::StoreError> {
        store.outbox_put_turn_start_with_presentation(
            command_id,
            "thread-a",
            json!({
                "threadId": "thread-a",
                "clientUserMessageId": command_id,
                "input": [{"type": "text", "text": command_id}],
            }),
            Some(1),
            OutboxPresentation::Queue,
        )?;
        Ok(())
    }

    #[test]
    fn owner_queue_byte_quota_has_an_explicit_non_destructive_boundary() {
        assert!(ensure_outbox_owner_quota(MAX_OUTBOX_OWNER_BYTES - 1, 1).is_ok());
        assert!(matches!(
            ensure_outbox_owner_quota(MAX_OUTBOX_OWNER_BYTES, 1),
            Err(StoreError::OutboxOwnerQuotaExceeded { limit_bytes })
                if limit_bytes == MAX_OUTBOX_OWNER_BYTES
        ));
        assert!(ensure_outbox_owner_replacement_quota(MAX_OUTBOX_OWNER_BYTES, 1, 1).is_ok());
        assert!(matches!(
            ensure_outbox_owner_replacement_quota(MAX_OUTBOX_OWNER_BYTES, 1, 2),
            Err(StoreError::OutboxOwnerQuotaExceeded { limit_bytes })
                if limit_bytes == MAX_OUTBOX_OWNER_BYTES
        ));
    }

    #[test]
    fn decodes_v1_file_state_as_a_complete_prefix() -> Result<(), Box<dyn std::error::Error>> {
        let mut encoded = [0_u8; FILE_STATE_V1_BYTES];
        encoded[0] = 1;
        encoded[1..9].copy_from_slice(&11_u64.to_be_bytes());
        encoded[9..17].copy_from_slice(&22_u64.to_be_bytes());
        encoded[17..25].copy_from_slice(&33_u64.to_be_bytes());
        encoded[25..33].copy_from_slice(&44_u64.to_be_bytes());
        encoded[33..65].copy_from_slice(&[55_u8; 32]);

        let decoded = FileState::decode(&encoded)?;

        assert_eq!(decoded.device, 11);
        assert_eq!(decoded.inode, 22);
        assert_eq!(decoded.indexed_from, 0);
        assert_eq!(decoded.indexed_bytes, 33);
        assert_eq!(decoded.records, 44);
        assert_eq!(decoded.tail_hash, [55; 32]);
        assert!(decoded.is_complete());
        Ok(())
    }

    #[test]
    fn v2_file_state_round_trips_tail_coverage() -> Result<(), Box<dyn std::error::Error>> {
        let mut state = FileState::tail(1, 2, 3);
        state.indexed_bytes = 4;
        state.records = 5;
        state.tail_hash = [6; 32];

        assert_eq!(FileState::decode(&state.encode())?, state);
        assert!(!state.is_complete());
        Ok(())
    }

    #[test]
    fn complete_state_keeps_the_v1_rollback_encoding() {
        let state = FileState::empty(1, 2);

        let encoded = state.encode();

        assert_eq!(encoded.len(), FILE_STATE_V1_BYTES);
        assert_eq!(encoded[0], 1);
    }

    #[test]
    fn dispatch_and_steer_claims_have_exactly_one_winner() -> Result<(), Box<dyn std::error::Error>>
    {
        let directory = tempfile::tempdir()?;
        let store = Arc::new(IndexStore::open(directory.path().join("index.redb"))?);
        put_queued(&store, "command-a")?;
        let barrier = Arc::new(Barrier::new(3));
        let (dispatch, steer) = std::thread::scope(|scope| {
            let dispatch_store = Arc::clone(&store);
            let dispatch_barrier = Arc::clone(&barrier);
            let dispatch = scope.spawn(move || {
                dispatch_barrier.wait();
                dispatch_store.outbox_claim_dispatch("command-a")
            });
            let steer_store = Arc::clone(&store);
            let steer_barrier = Arc::clone(&barrier);
            let steer = scope.spawn(move || {
                steer_barrier.wait();
                steer_store.outbox_claim_steer("command-a", "steer-a")
            });
            barrier.wait();
            let dispatch = dispatch
                .join()
                .map_err(|_| std::io::Error::other("dispatch claim panicked"))?;
            let steer = steer
                .join()
                .map_err(|_| std::io::Error::other("steer claim panicked"))?;
            Ok::<_, Box<dyn std::error::Error>>((dispatch?, steer?))
        })?;

        let acquired = usize::from(matches!(dispatch, OutboxClaimOutcome::Acquired { .. }))
            + usize::from(matches!(steer, OutboxClaimOutcome::Acquired { .. }));
        assert_eq!(acquired, 1);
        assert_eq!(store.outbox_list(None)?[0].state, OutboxState::Uncertain);
        assert!(!store.outbox_cancel("command-a")?);
        assert!(
            store
                .outbox_fail_queued("command-a", "stale failure")?
                .is_none()
        );
        assert!(
            store
                .outbox_edit_prompt(
                    "command-a",
                    &json!([{"type": "text", "text": "replacement"}]),
                )
                .is_err()
        );
        assert!(store.outbox_place("command-a", None).is_err());
        Ok(())
    }

    #[test]
    fn terminal_steer_resolution_is_idempotent_and_stale_safe()
    -> Result<(), Box<dyn std::error::Error>> {
        let directory = tempfile::tempdir()?;
        let store = IndexStore::open(directory.path().join("index.redb"))?;
        put_queued(&store, "command-a")?;
        let OutboxClaimOutcome::Acquired { token, .. } =
            store.outbox_claim_steer("command-a", "steer-a")?
        else {
            return Err("steer claim was not acquired".into());
        };

        assert!(matches!(
            store.outbox_resolve_claim(
                "command-a",
                token,
                OutboxClaimResolution::Rejected { error: "rejected" },
            )?,
            OutboxClaimResolutionOutcome::Applied(_)
        ));
        assert!(matches!(
            store.outbox_resolve_claim("command-a", token, OutboxClaimResolution::Delivered,)?,
            OutboxClaimResolutionOutcome::AlreadyResolved(_)
        ));
        store.outbox_retry_failed("command-a")?;
        assert!(matches!(
            store.outbox_claim_steer("command-a", "steer-a")?,
            OutboxClaimOutcome::Duplicate(_)
        ));
        let OutboxClaimOutcome::Acquired {
            token: retry_token, ..
        } = store.outbox_claim_steer("command-a", "steer-b")?
        else {
            return Err("new steer operation was not acquired".into());
        };
        assert!(retry_token > token);
        assert!(matches!(
            store.outbox_resolve_claim("command-a", token, OutboxClaimResolution::Delivered,)?,
            OutboxClaimResolutionOutcome::Stale(_)
        ));
        assert!(matches!(
            store.outbox_resolve_claim(
                "command-a",
                retry_token,
                OutboxClaimResolution::Delivered,
            )?,
            OutboxClaimResolutionOutcome::Applied(_)
        ));
        assert_eq!(store.outbox_list(None)?[0].state, OutboxState::Delivered);

        put_queued(&store, "command-b")?;
        let OutboxClaimOutcome::Acquired {
            token: dispatch_token,
            ..
        } = store.outbox_claim_dispatch("command-b")?
        else {
            return Err("dispatch claim was not acquired".into());
        };
        store.outbox_resolve_claim(
            "command-b",
            dispatch_token,
            OutboxClaimResolution::NotSent { retry_after_ms: 0 },
        )?;
        let OutboxClaimOutcome::Acquired {
            token: next_dispatch_token,
            ..
        } = store.outbox_claim_dispatch("command-b")?
        else {
            return Err("not-sent dispatch was not reacquired".into());
        };
        assert!(next_dispatch_token > dispatch_token);
        Ok(())
    }

    #[test]
    fn indeterminate_steer_claim_survives_restart_without_reacquisition()
    -> Result<(), Box<dyn std::error::Error>> {
        let directory = tempfile::tempdir()?;
        let path = directory.path().join("index.redb");
        {
            let store = IndexStore::open(&path)?;
            put_queued(&store, "command-a")?;
            let OutboxClaimOutcome::Acquired { token, .. } =
                store.outbox_claim_steer("command-a", "steer-a")?
            else {
                return Err("steer claim was not acquired".into());
            };
            store.outbox_resolve_claim(
                "command-a",
                token,
                OutboxClaimResolution::Indeterminate {
                    error: "connection lost",
                    retry_after_ms: 500,
                },
            )?;
        }

        let reopened = IndexStore::open(&path)?;
        assert!(matches!(
            reopened.outbox_claim_steer("command-a", "steer-a")?,
            OutboxClaimOutcome::Duplicate(_)
        ));
        assert!(matches!(
            reopened.outbox_claim_dispatch("command-a")?,
            OutboxClaimOutcome::Unavailable(Some(_))
        ));
        assert_eq!(reopened.outbox_list(None)?[0].state, OutboxState::Uncertain);
        Ok(())
    }
}
