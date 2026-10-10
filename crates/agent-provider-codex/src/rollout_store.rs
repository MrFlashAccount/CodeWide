//! The rollout index: tables the Codex adapter derives from rollout JSONL
//! files inside the companion's host index database.
//!
//! The tables are disposable. [`ROLLOUT_INDEX_SCHEMA`] creates them in the
//! index's opening migration and drops them when the companion schema asks
//! for a rebuild or when [`ROLLOUT_LOGIC_VERSION`] changes; the indexer then
//! rebuilds them from the unchanged rollouts. Thread metadata and pins stay
//! companion state, reached through [`HostThreadIndex`].

use std::{
    collections::HashMap,
    path::PathBuf,
    sync::{Arc, Mutex},
};

use companion_host::{
    index::{DerivedIndexSchema, META, StoreError, attach_derived, logic_version, table_exists},
    thread_index::HostThreadIndex,
};
use redb::{
    Database, ReadTransaction, ReadableDatabase, ReadableTable, ReadableTableMetadata,
    TableDefinition, WriteTransaction,
};
use serde::{Deserialize, Serialize};

const FILES: TableDefinition<&[u8], &[u8]> = TableDefinition::new("rollout_files");
const RECORDS: TableDefinition<&[u8], &[u8]> = TableDefinition::new("rollout_records");
const TURNS: TableDefinition<&[u8], &[u8]> = TableDefinition::new("rollout_turns");
const TURNS_BY_ID: TableDefinition<&[u8], u64> = TableDefinition::new("rollout_turns_by_id");
const REMOVED_TURNS: TableDefinition<&[u8], u8> = TableDefinition::new("rollout_removed_turns");
const TURN_SUMMARIES: TableDefinition<&[u8], &[u8]> =
    TableDefinition::new("rollout_turn_summaries");
const ROLLOUT_CONTENT: TableDefinition<&[u8], &[u8]> = TableDefinition::new("rollout_content");
const ROLLOUT_CONTENT_BY_FILE: TableDefinition<&[u8], u8> =
    TableDefinition::new("rollout_content_by_file");
pub const ROLLOUT_LOGIC_VERSION: u64 = 4;
const FILE_STATE_VERSION: u8 = 2;
const FILE_STATE_V1_BYTES: usize = 65;
const FILE_STATE_BYTES: usize = 73;

/// The rollout tables' schema in the host index.
pub const ROLLOUT_INDEX_SCHEMA: RolloutIndexSchema = RolloutIndexSchema;

pub struct RolloutIndexSchema;

impl DerivedIndexSchema for RolloutIndexSchema {
    fn migrate(&self, write: &WriteTransaction, rebuild: bool) -> Result<(), StoreError> {
        let mut rebuild = rebuild;
        {
            let mut meta = write.open_table(META)?;
            if meta
                .get("rollout_logic_version")?
                .map(|entry| entry.value())
                != Some(ROLLOUT_LOGIC_VERSION)
            {
                rebuild = true;
                meta.insert("rollout_logic_version", ROLLOUT_LOGIC_VERSION)?;
            }
        }
        if rebuild {
            // These tables are derived from rollouts. Delete their trees in
            // bulk: redb retain(false) copies the B-tree per removed row and
            // defers reclaiming those copies until the entire scan finishes.
            // On a large index that can exhaust disk during startup.
            write.delete_table(REMOVED_TURNS)?;
            write.delete_table(FILES)?;
            write.delete_table(RECORDS)?;
            write.delete_table(TURNS)?;
            write.delete_table(TURNS_BY_ID)?;
            write.delete_table(TURN_SUMMARIES)?;
            write.delete_table(ROLLOUT_CONTENT)?;
            write.delete_table(ROLLOUT_CONTENT_BY_FILE)?;
        }
        write.open_table(FILES)?;
        write.open_table(RECORDS)?;
        write.open_table(TURNS)?;
        write.open_table(TURNS_BY_ID)?;
        write.open_table(REMOVED_TURNS)?;
        write.open_table(TURN_SUMMARIES)?;
        write.open_table(ROLLOUT_CONTENT)?;
        write.open_table(ROLLOUT_CONTENT_BY_FILE)?;
        Ok(())
    }

    fn is_current(&self, read: &ReadTransaction) -> Result<bool, StoreError> {
        Ok(
            logic_version(read, "rollout_logic_version")? == Some(ROLLOUT_LOGIC_VERSION)
                && table_exists(read, ROLLOUT_CONTENT_BY_FILE)?,
        )
    }
}

/// The rollout index over the shared host index database, and the
/// companion thread index the rollout indexer publishes metadata to.
pub struct RolloutStore {
    database: Arc<Database>,
    threads: Arc<dyn HostThreadIndex>,
    rollout_index_locks: Mutex<HashMap<[u8; 32], Arc<Mutex<()>>>>,
}

impl RolloutStore {
    /// Attaches to a host index database. The index normally migrated the
    /// rollout tables when it opened with [`ROLLOUT_INDEX_SCHEMA`]; an index
    /// opened without it is migrated here.
    ///
    /// # Errors
    ///
    /// Returns an error when the rollout tables cannot be checked or created.
    pub fn attach(
        database: Arc<Database>,
        threads: Arc<dyn HostThreadIndex>,
    ) -> Result<Self, StoreError> {
        attach_derived(&database, &ROLLOUT_INDEX_SCHEMA)?;
        Ok(Self {
            database,
            threads,
            rollout_index_locks: Mutex::new(HashMap::new()),
        })
    }

    /// The companion thread index (metadata, subagent tree, pins).
    #[must_use]
    pub fn threads(&self) -> &dyn HostThreadIndex {
        self.threads.as_ref()
    }

    pub(crate) fn rollout_index_lock(&self, file_id: [u8; 32]) -> Arc<Mutex<()>> {
        self.rollout_index_locks
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .entry(file_id)
            .or_insert_with(|| Arc::new(Mutex::new(())))
            .clone()
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

    /// Resolves canonical rollout records that were proven to contain the
    /// requested digest while indexing their source JSONL.
    pub(crate) fn rollout_content(
        &self,
        digest: &[u8; 32],
    ) -> Result<Vec<RolloutContentLocator>, StoreError> {
        let start = rollout_content_key(digest, &[0; 32], 0);
        let end = rollout_content_key(digest, &[u8::MAX; 32], u64::MAX);
        let read = self.database.begin_read()?;
        let table = read.open_table(ROLLOUT_CONTENT)?;
        table
            .range(start.as_slice()..=end.as_slice())?
            .map(|entry| {
                let (_key, value) = entry?;
                serde_json::from_slice(value.value()).map_err(StoreError::from)
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
        self.commit_rollout_batch(
            file_id,
            RolloutBatch {
                records,
                turns,
                turn_summaries,
                removed_turns: &[],
                content: &[],
            },
            file_state,
        )
    }

    /// Atomically publishes source progress and logical rollback tombstones.
    /// Tombstones prevent later prefix backfill from resurrecting removed turns.
    pub(crate) fn commit_rollout_batch(
        &self,
        file_id: &[u8; 32],
        batch: RolloutBatch<'_>,
        file_state: FileState,
    ) -> Result<(), StoreError> {
        let write = self.database.begin_write()?;
        {
            let mut table = write.open_table(RECORDS)?;
            for (key, value) in batch.records {
                table.insert(key.as_slice(), value.as_slice())?;
            }
        }
        {
            let mut table = write.open_table(TURNS)?;
            let mut by_id = write.open_table(TURNS_BY_ID)?;
            let mut removed = write.open_table(REMOVED_TURNS)?;
            let mut summaries = write.open_table(TURN_SUMMARIES)?;
            for offset in batch.removed_turns {
                let key = offset_key(file_id, *offset);
                if let Some(value) = table.remove(key.as_slice())? {
                    let turn = TurnRef::decode(value.value())?;
                    by_id.remove(turn_id_key(file_id, &turn.id).as_slice())?;
                }
                summaries.remove(key.as_slice())?;
                removed.insert(key.as_slice(), 1)?;
            }
            for turn in batch.turns {
                let key = offset_key(file_id, turn.start_offset);
                if removed.get(key.as_slice())?.is_some() {
                    continue;
                }
                let value = turn.encode()?;
                table.insert(key.as_slice(), value.as_slice())?;
                let id_key = turn_id_key(file_id, &turn.id);
                by_id.insert(id_key.as_slice(), turn.start_offset)?;
            }
        }
        {
            let mut table = write.open_table(TURN_SUMMARIES)?;
            let removed = write.open_table(REMOVED_TURNS)?;
            for (start_offset, summary) in batch.turn_summaries {
                let key = offset_key(file_id, *start_offset);
                if removed.get(key.as_slice())?.is_some() {
                    continue;
                }
                table.insert(key.as_slice(), summary.as_slice())?;
            }
        }
        {
            let mut by_digest = write.open_table(ROLLOUT_CONTENT)?;
            let mut by_file = write.open_table(ROLLOUT_CONTENT_BY_FILE)?;
            for entry in batch.content {
                let primary_key = rollout_content_key(
                    &entry.digest,
                    &entry.locator.file_id,
                    entry.locator.record.offset,
                );
                let reverse_key = rollout_content_reverse_key(
                    &entry.locator.file_id,
                    &entry.digest,
                    entry.locator.record.offset,
                );
                let encoded = serde_json::to_vec(&entry.locator)?;
                by_digest.insert(primary_key.as_slice(), encoded.as_slice())?;
                by_file.insert(reverse_key.as_slice(), 1)?;
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
            let mut reverse_start = Vec::with_capacity(72);
            reverse_start.extend_from_slice(file_id);
            reverse_start.extend_from_slice(&[0; 32]);
            reverse_start.extend_from_slice(&0_u64.to_be_bytes());
            let mut reverse_end = Vec::with_capacity(72);
            reverse_end.extend_from_slice(file_id);
            reverse_end.extend_from_slice(&[u8::MAX; 32]);
            reverse_end.extend_from_slice(&u64::MAX.to_be_bytes());
            let mut reverse = write.open_table(ROLLOUT_CONTENT_BY_FILE)?;
            // The keys form the stable deletion snapshot required to update
            // both derived indexes in one transaction.
            let keys = reverse
                .range(reverse_start.as_slice()..=reverse_end.as_slice())?
                .map(|entry| entry.map(|(key, _value)| key.value().to_vec()))
                .collect::<Result<Vec<_>, _>>()?;
            let mut by_digest = write.open_table(ROLLOUT_CONTENT)?;
            for key in keys {
                if key.len() != 72 {
                    return Err(StoreError::CorruptedIndex(
                        "invalid rollout content key".into(),
                    ));
                }
                let digest: [u8; 32] = key[32..64].try_into().map_err(|_| {
                    StoreError::CorruptedIndex("invalid rollout content key".into())
                })?;
                let offset = read_u64(&key[64..72])?;
                by_digest.remove(rollout_content_key(&digest, file_id, offset).as_slice())?;
                reverse.remove(key.as_slice())?;
            }
        }
        {
            let mut removed = write.open_table(REMOVED_TURNS)?;
            removed.retain_in(start.as_slice()..=end.as_slice(), |_key, _value| false)?;
        }
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
        if limit == 0 || before_offset == Some(0) {
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
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct TurnRef {
    pub id: String,
    pub start_offset: u64,
    pub end_offset: u64,
    pub completed: bool,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct RecordRef {
    pub offset: u64,
    pub length: u32,
    pub record_type: u8,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum RolloutContentField {
    CommandAggregatedOutput,
    ExecCommandAggregatedOutput,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RolloutContentLocator {
    pub(crate) source_path: PathBuf,
    pub(crate) file_id: [u8; 32],
    pub(crate) record: RecordRef,
    pub(crate) thread_id: Option<String>,
    pub(crate) turn_id: Option<String>,
    pub(crate) item_id: String,
    pub(crate) field: RolloutContentField,
    pub(crate) content_type: String,
}

#[derive(Clone, Debug)]
pub(crate) struct RolloutContentEntry {
    pub(crate) digest: [u8; 32],
    pub(crate) locator: RolloutContentLocator,
}

#[derive(Clone, Copy)]
pub(crate) struct RolloutBatch<'a> {
    pub(crate) records: &'a [(Vec<u8>, Vec<u8>)],
    pub(crate) turns: &'a [TurnRef],
    pub(crate) turn_summaries: &'a [(u64, Vec<u8>)],
    pub(crate) removed_turns: &'a [u64],
    pub(crate) content: &'a [RolloutContentEntry],
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
    /// Detects same-length source rewrites outside the sampled checkpoint tail.
    pub modified_nanos: u128,
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
            modified_nanos: 0,
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
            modified_nanos: 0,
        }
    }

    #[must_use]
    pub const fn is_complete(self) -> bool {
        self.indexed_from == 0
    }

    fn encode(self) -> Vec<u8> {
        if self.is_complete() && self.modified_nanos == 0 {
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
        let mut encoded = vec![
            0_u8;
            if self.modified_nanos == 0 {
                FILE_STATE_BYTES
            } else {
                FILE_STATE_BYTES + 16
            }
        ];
        encoded[0] = if self.modified_nanos == 0 {
            FILE_STATE_VERSION
        } else {
            3
        };
        encoded[1..9].copy_from_slice(&self.device.to_be_bytes());
        encoded[9..17].copy_from_slice(&self.inode.to_be_bytes());
        encoded[17..25].copy_from_slice(&self.indexed_from.to_be_bytes());
        encoded[25..33].copy_from_slice(&self.indexed_bytes.to_be_bytes());
        encoded[33..41].copy_from_slice(&self.records.to_be_bytes());
        encoded[41..73].copy_from_slice(&self.tail_hash);
        if self.modified_nanos != 0 {
            encoded[73..89].copy_from_slice(&self.modified_nanos.to_be_bytes());
        }
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
                modified_nanos: 0,
            });
        }
        let current = encoded.len() == FILE_STATE_BYTES + 16 && encoded[0] == 3;
        if !current && (encoded.len() != FILE_STATE_BYTES || encoded[0] != FILE_STATE_VERSION) {
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
            modified_nanos: if current {
                u128::from_be_bytes(encoded[73..89].try_into().map_err(|_| {
                    StoreError::CorruptedIndex("invalid source modification time".into())
                })?)
            } else {
                0
            },
        })
    }
}

fn offset_key(file_id: &[u8; 32], offset: u64) -> Vec<u8> {
    let mut key = Vec::with_capacity(40);
    key.extend_from_slice(file_id);
    key.extend_from_slice(&offset.to_be_bytes());
    key
}

fn rollout_content_key(digest: &[u8; 32], file_id: &[u8; 32], offset: u64) -> Vec<u8> {
    let mut key = Vec::with_capacity(72);
    key.extend_from_slice(digest);
    key.extend_from_slice(file_id);
    key.extend_from_slice(&offset.to_be_bytes());
    key
}

fn rollout_content_reverse_key(file_id: &[u8; 32], digest: &[u8; 32], offset: u64) -> Vec<u8> {
    let mut key = Vec::with_capacity(72);
    key.extend_from_slice(file_id);
    key.extend_from_slice(digest);
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

fn read_u64(bytes: &[u8]) -> Result<u64, StoreError> {
    let array: [u8; 8] = bytes
        .try_into()
        .map_err(|_| StoreError::CorruptedIndex("invalid integer width".into()))?;
    Ok(u64::from_be_bytes(array))
}

#[cfg(test)]
mod tests {
    use super::*;

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
    fn rebuild_drops_only_rollout_tables() -> Result<(), Box<dyn std::error::Error>> {
        const COMPANION: TableDefinition<&str, u64> = TableDefinition::new("companion_table");
        let directory = tempfile::tempdir()?;
        let database = companion_host::database::open(directory.path().join("index.redb"), "test")?;
        let write = database.begin_write()?;
        write.open_table(COMPANION)?.insert("kept", 7)?;
        write.commit()?;
        let store = RolloutStore::attach(
            database.clone(),
            Arc::new(crate::test_support::MemoryThreadIndex::default()),
        )?;
        let file_id = [1; 32];
        store.commit_batch(
            &file_id,
            &[(offset_key(&file_id, 0), vec![0; 13])],
            &[],
            &[],
            FileState::empty(1, 2),
        )?;
        assert_eq!(store.record_count()?, 1);

        let write = database.begin_write()?;
        ROLLOUT_INDEX_SCHEMA.migrate(&write, true)?;
        write.commit()?;

        assert_eq!(store.record_count()?, 0);
        assert!(store.file_state(&file_id)?.is_none());
        let read = database.begin_read()?;
        assert_eq!(
            read.open_table(COMPANION)?
                .get("kept")?
                .map(|value| value.value()),
            Some(7)
        );
        assert_eq!(
            read.open_table(META)?
                .get("rollout_logic_version")?
                .map(|value| value.value()),
            Some(ROLLOUT_LOGIC_VERSION)
        );
        Ok(())
    }

    #[test]
    fn attach_rebuilds_tables_of_an_older_logic_version() -> Result<(), Box<dyn std::error::Error>>
    {
        let directory = tempfile::tempdir()?;
        let path = directory.path().join("index.redb");
        let file_id = [2; 32];
        {
            let store = crate::test_support::open_rollout_store(&path)?;
            store.commit_batch(
                &file_id,
                &[(offset_key(&file_id, 0), vec![0; 13])],
                &[],
                &[],
                FileState::empty(1, 2),
            )?;
            let write = store.database.begin_write()?;
            write
                .open_table(META)?
                .insert("rollout_logic_version", ROLLOUT_LOGIC_VERSION - 1)?;
            write.commit()?;
        }
        let store = crate::test_support::open_rollout_store(&path)?;
        assert_eq!(store.record_count()?, 0);
        Ok(())
    }
}
