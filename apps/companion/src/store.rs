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
const SCHEMA_VERSION: u32 = 6;
const FILE_STATE_VERSION: u8 = 2;
const FILE_STATE_V1_BYTES: usize = 65;
const FILE_STATE_BYTES: usize = 73;
const MAX_OUTBOX_COMMANDS: usize = 1_000;
const MAX_OUTBOX_COMMAND_BYTES: usize = 1024 * 1024;
const MAX_OUTBOX_BYTES: usize = 48 * 1024 * 1024;
const MAX_RETAINED_DELIVERED_COMMANDS: usize = 128;

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
    pub order: u64,
    pub created_at: u64,
    pub updated_at: u64,
    pub last_error: Option<String>,
    #[serde(default)]
    pub attempts: u32,
    #[serde(default)]
    pub next_attempt_at: u64,
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
    #[error("outbox capacity exceeded by active or failed commands")]
    OutboxCapacityExceeded,
}

pub struct IndexStore {
    database: Database,
    rollout_index_locks: Mutex<HashMap<[u8; 32], Arc<Mutex<()>>>>,
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
                None => {
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
        Ok(Self {
            database,
            rollout_index_locks: Mutex::new(HashMap::new()),
        })
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
    /// Returns an error for invalid commands, capacity exhaustion, corruption,
    /// or a failed transaction.
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
        self.outbox_put_turn_start_with_workspace(
            command_id,
            remote_thread_id,
            params,
            created_at,
            presentation,
            None,
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
        validate_outbox_id(command_id, "command id")?;
        validate_outbox_id(remote_thread_id, "remote thread id")?;
        if let Some(request_id) = workspace_request_id {
            validate_outbox_id(request_id, "workspace request id")?;
        }
        validate_turn_start_params(command_id, remote_thread_id, &params)?;
        let params_bytes = serde_json::to_vec(&params)?.len();
        if params_bytes > MAX_OUTBOX_COMMAND_BYTES {
            return Err(StoreError::CorruptedIndex(
                "outbox command exceeds 1 MiB".into(),
            ));
        }
        let write = self.database.begin_write()?;
        let command = {
            let mut table = write.open_table(OUTBOX)?;
            if let Some(encoded) = table.get(command_id)?.map(|value| value.value().to_vec()) {
                let existing: OutboxCommand = serde_json::from_slice(&encoded)?;
                if existing.remote_thread_id != remote_thread_id
                    || existing.method != "turn/start"
                    || existing.params != params
                    || existing.presentation != presentation
                    || existing.workspace_request_id.as_deref() != workspace_request_id
                {
                    return Err(StoreError::CorruptedIndex(
                        "outbox command id already has a different payload".into(),
                    ));
                }
                return Ok(existing);
            }
            let (_, command_count, total_bytes, max_order) =
                prune_delivered_outbox_receipts(&mut table, 1, params_bytes)?;
            if command_count > MAX_OUTBOX_COMMANDS || total_bytes > MAX_OUTBOX_BYTES {
                return Err(StoreError::OutboxCapacityExceeded);
            }
            let now = unix_time_ms();
            let command = OutboxCommand {
                command_id: command_id.to_owned(),
                remote_thread_id: remote_thread_id.to_owned(),
                method: "turn/start".into(),
                params,
                state: OutboxState::Queued,
                presentation,
                workspace_request_id: workspace_request_id.map(str::to_owned),
                order: max_order.saturating_add(1),
                created_at: created_at.unwrap_or(now),
                updated_at: now,
                last_error: None,
                attempts: 0,
                next_attempt_at: 0,
            };
            let encoded = serde_json::to_vec(&command)?;
            table.insert(command_id, encoded.as_slice())?;
            command
        };
        write.commit()?;
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
            prune_delivered_outbox_receipts(&mut table, 0, 0)?.0
        };
        write.commit()?;
        Ok(removed)
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

    /// Lists durable outbox commands with explicit scan and result ceilings.
    ///
    /// # Errors
    ///
    /// Returns an error if either ceiling is exceeded or a record is invalid.
    pub fn outbox_list_bounded(
        &self,
        remote_thread_id: Option<&str>,
        scan_limit: usize,
        result_limit: usize,
    ) -> Result<Vec<OutboxCommand>, StoreError> {
        let read = self.database.begin_read()?;
        let table = read.open_table(OUTBOX)?;
        let mut commands = Vec::new();
        for (scanned, entry) in table.iter()?.enumerate() {
            if scanned >= scan_limit {
                return Err(StoreError::OutboxCapacityExceeded);
            }
            let (_key, value) = entry?;
            let command: OutboxCommand = serde_json::from_slice(value.value())?;
            if remote_thread_id.is_none_or(|thread_id| command.remote_thread_id == thread_id) {
                if commands.len() >= result_limit {
                    return Err(StoreError::OutboxCapacityExceeded);
                }
                commands.push(command);
            }
        }
        commands.sort_by_key(|command| (command.order, command.created_at));
        Ok(commands)
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
            command.last_error = last_error.map(|error| error.chars().take(500).collect());
            command.next_attempt_at = 0;
            let encoded = serde_json::to_vec(&command)?;
            table.insert(command_id, encoded.as_slice())?;
            command
        };
        write.commit()?;
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
            command.last_error = Some(last_error.chars().take(500).collect());
            let encoded = serde_json::to_vec(&command)?;
            table.insert(command_id, encoded.as_slice())?;
            command
        };
        write.commit()?;
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
            command.last_error = last_error.map(|error| error.chars().take(500).collect());
            let encoded = serde_json::to_vec(&command)?;
            table.insert(command_id, encoded.as_slice())?;
            (command, changed)
        };
        write.commit()?;
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
        let threads = {
            let mut table = write.open_table(OUTBOX)?;
            let mut recovered = HashSet::new();
            let mut updates = Vec::new();
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
            }
            for (command_id, encoded) in updates {
                table.insert(command_id.as_str(), encoded.as_slice())?;
            }
            recovered.into_iter().collect::<Vec<_>>()
        };
        write.commit()?;
        Ok(threads)
    }

    /// Reopens a terminally failed command with the same stable identity.
    /// Delivered receipts remain terminal and cannot be replayed.
    ///
    /// # Errors
    ///
    /// Returns an error if the command is missing, is not failed, or persistence fails.
    pub fn outbox_retry_failed(&self, command_id: &str) -> Result<OutboxCommand, StoreError> {
        let write = self.database.begin_write()?;
        let command = {
            let mut table = write.open_table(OUTBOX)?;
            let encoded = table
                .get(command_id)?
                .map(|value| value.value().to_vec())
                .ok_or_else(|| StoreError::CorruptedIndex("outbox command not found".into()))?;
            let mut command: OutboxCommand = serde_json::from_slice(&encoded)?;
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
            let encoded = table
                .get(command_id)?
                .map(|value| value.value().to_vec())
                .ok_or_else(|| StoreError::CorruptedIndex("outbox command not found".into()))?;
            let mut command: OutboxCommand = serde_json::from_slice(&encoded)?;
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
            let encoded = serde_json::to_vec(&command)?;
            table.insert(command_id, encoded.as_slice())?;
            command
        };
        write.commit()?;
        Ok(command)
    }

    /// Reorders one queued command relative to another command in the same
    /// thread. A `None` target places it last.
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
        let write = self.database.begin_write()?;
        let changed = {
            let mut table = write.open_table(OUTBOX)?;
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
            same_thread.retain(|candidate| candidate.remote_thread_id == selected.remote_thread_id);
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
            let mut changed = false;
            for (mut command, order) in same_thread.into_iter().zip(order_slots) {
                if command.order == order {
                    continue;
                }
                command.order = order;
                command.updated_at = now;
                let encoded = serde_json::to_vec(&command)?;
                table.insert(command.command_id.as_str(), encoded.as_slice())?;
                changed = true;
            }
            changed
        };
        write.commit()?;
        Ok(changed)
    }

    /// Removes a queued or failed command. Commands being reconciled or
    /// already delivered remain as idempotency receipts.
    ///
    /// # Errors
    ///
    /// Returns an error if persistence fails or the row is corrupt.
    pub fn outbox_cancel(&self, command_id: &str) -> Result<bool, StoreError> {
        let write = self.database.begin_write()?;
        let cancelled = {
            let mut table = write.open_table(OUTBOX)?;
            let Some(encoded) = table.get(command_id)?.map(|value| value.value().to_vec()) else {
                return Ok(false);
            };
            let command: OutboxCommand = serde_json::from_slice(&encoded)?;
            if !matches!(command.state, OutboxState::Queued | OutboxState::Failed) {
                return Ok(false);
            }
            table.remove(command_id)?;
            true
        };
        write.commit()?;
        Ok(cancelled)
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

fn prune_delivered_outbox_receipts(
    table: &mut Table<'_, &str, &[u8]>,
    incoming_commands: usize,
    incoming_bytes: usize,
) -> Result<(usize, usize, usize, u64), StoreError> {
    let mut total_bytes = incoming_bytes;
    let mut max_order = 0_u64;
    let mut command_count = incoming_commands;
    let mut delivered = Vec::new();
    for entry in table.iter()? {
        let (key, value) = entry?;
        let command: OutboxCommand = serde_json::from_slice(value.value())?;
        let command_bytes = serde_json::to_vec(&command.params)?.len();
        total_bytes = total_bytes.saturating_add(command_bytes);
        command_count = command_count.saturating_add(1);
        max_order = max_order.max(command.order);
        if command.state == OutboxState::Delivered {
            delivered.push((
                key.value().to_owned(),
                command.updated_at,
                command.order,
                command_bytes,
            ));
        }
    }
    // Delivered rows are short-lived receipts for reconnecting clients, not
    // permanent queue history. Keep a bounded recent window and reclaim older
    // receipts before they can starve active commands.
    delivered.sort_by_key(|(_, updated_at, order, _)| (*updated_at, *order));
    let mut delivered_count = delivered.len();
    let mut removed = 0_usize;
    for (command_id, _, _, command_bytes) in delivered {
        if delivered_count <= MAX_RETAINED_DELIVERED_COMMANDS
            && command_count <= MAX_OUTBOX_COMMANDS
            && total_bytes <= MAX_OUTBOX_BYTES
        {
            break;
        }
        table.remove(command_id.as_str())?;
        delivered_count -= 1;
        command_count -= 1;
        total_bytes = total_bytes.saturating_sub(command_bytes);
        removed += 1;
    }
    Ok((removed, command_count, total_bytes, max_order))
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
    use super::{FILE_STATE_V1_BYTES, FileState};

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
}
