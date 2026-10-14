//! The offset index tables a provider derives from its transcript files
//! inside the companion's host index database.
//!
//! The tables are disposable: [`IndexTables`] creates them in the index's
//! opening migration and drops them when the companion schema asks for a
//! rebuild or when the provider's logic version changes; the scan then
//! rebuilds them from the unchanged files. Each provider names its own table
//! set, so two providers share one database without sharing rows. Thread
//! metadata and pins stay companion state, reached through
//! [`HostThreadIndex`].

use std::{
    collections::HashMap,
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

const FILE_STATE_VERSION: u8 = 2;
const FILE_STATE_V1_BYTES: usize = 65;
const FILE_STATE_BYTES: usize = 73;

/// The names of one provider's index tables and the logic version that
/// decides when they are rebuilt.
#[derive(Clone, Copy, Debug)]
pub struct IndexTables {
    pub files: &'static str,
    pub records: &'static str,
    pub turns: &'static str,
    pub turns_by_id: &'static str,
    pub removed_turns: &'static str,
    pub turn_summaries: &'static str,
    pub content: &'static str,
    pub content_by_file: &'static str,
    /// The [`META`] key holding the provider's logic version.
    pub logic_version_key: &'static str,
    /// Bumped whenever derived rows change meaning; a change drops them.
    pub logic_version: u64,
}

impl IndexTables {
    const fn files(&self) -> TableDefinition<'static, &'static [u8], &'static [u8]> {
        TableDefinition::new(self.files)
    }

    const fn records(&self) -> TableDefinition<'static, &'static [u8], &'static [u8]> {
        TableDefinition::new(self.records)
    }

    const fn turns(&self) -> TableDefinition<'static, &'static [u8], &'static [u8]> {
        TableDefinition::new(self.turns)
    }

    const fn turns_by_id(&self) -> TableDefinition<'static, &'static [u8], u64> {
        TableDefinition::new(self.turns_by_id)
    }

    const fn removed_turns(&self) -> TableDefinition<'static, &'static [u8], u8> {
        TableDefinition::new(self.removed_turns)
    }

    const fn turn_summaries(&self) -> TableDefinition<'static, &'static [u8], &'static [u8]> {
        TableDefinition::new(self.turn_summaries)
    }

    const fn content(&self) -> TableDefinition<'static, &'static [u8], &'static [u8]> {
        TableDefinition::new(self.content)
    }

    const fn content_by_file(&self) -> TableDefinition<'static, &'static [u8], u8> {
        TableDefinition::new(self.content_by_file)
    }
}

impl DerivedIndexSchema for IndexTables {
    fn migrate(&self, write: &WriteTransaction, rebuild: bool) -> Result<(), StoreError> {
        let mut rebuild = rebuild;
        {
            let mut meta = write.open_table(META)?;
            if meta.get(self.logic_version_key)?.map(|entry| entry.value())
                != Some(self.logic_version)
            {
                rebuild = true;
                meta.insert(self.logic_version_key, self.logic_version)?;
            }
        }
        if rebuild {
            // These tables are derived from the source files. Delete their
            // trees in bulk: redb retain(false) copies the B-tree per removed
            // row and defers reclaiming those copies until the entire scan
            // finishes. On a large index that can exhaust disk during startup.
            write.delete_table(self.removed_turns())?;
            write.delete_table(self.files())?;
            write.delete_table(self.records())?;
            write.delete_table(self.turns())?;
            write.delete_table(self.turns_by_id())?;
            write.delete_table(self.turn_summaries())?;
            write.delete_table(self.content())?;
            write.delete_table(self.content_by_file())?;
        }
        write.open_table(self.files())?;
        write.open_table(self.records())?;
        write.open_table(self.turns())?;
        write.open_table(self.turns_by_id())?;
        write.open_table(self.removed_turns())?;
        write.open_table(self.turn_summaries())?;
        write.open_table(self.content())?;
        write.open_table(self.content_by_file())?;
        Ok(())
    }

    fn is_current(&self, read: &ReadTransaction) -> Result<bool, StoreError> {
        Ok(
            logic_version(read, self.logic_version_key)? == Some(self.logic_version)
                && table_exists(read, self.content_by_file())?,
        )
    }
}

/// One provider's offset index over the shared host index database, and the
/// companion thread index the scan publishes metadata to.
pub struct IndexStore {
    database: Arc<Database>,
    threads: Arc<dyn HostThreadIndex>,
    tables: IndexTables,
    index_locks: Mutex<HashMap<[u8; 32], Arc<Mutex<()>>>>,
}

impl IndexStore {
    /// Attaches to a host index database. The index normally migrated the
    /// tables when it opened with `tables` among its derived schemas; an
    /// index opened without them is migrated here.
    ///
    /// # Errors
    ///
    /// Returns an error when the tables cannot be checked or created.
    pub fn attach(
        database: Arc<Database>,
        threads: Arc<dyn HostThreadIndex>,
        tables: IndexTables,
    ) -> Result<Self, StoreError> {
        attach_derived(&database, &tables)?;
        Ok(Self {
            database,
            threads,
            tables,
            index_locks: Mutex::new(HashMap::new()),
        })
    }

    /// The companion thread index (metadata, subagent tree, pins).
    #[must_use]
    pub fn threads(&self) -> &dyn HostThreadIndex {
        self.threads.as_ref()
    }

    /// The database the tables live in.
    #[must_use]
    pub fn database(&self) -> &Arc<Database> {
        &self.database
    }

    /// The per-file lane serializing scans and qualified reads of one file.
    #[must_use]
    pub fn index_lock(&self, file_id: [u8; 32]) -> Arc<Mutex<()>> {
        self.index_locks
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .entry(file_id)
            .or_insert_with(|| Arc::new(Mutex::new(())))
            .clone()
    }

    /// Reads the durable progress for a file.
    ///
    /// # Errors
    ///
    /// Returns an error if the read transaction fails or the stored state is
    /// corrupt.
    pub fn file_state(&self, file_id: &[u8; 32]) -> Result<Option<FileState>, StoreError> {
        let read = self.database.begin_read()?;
        let table = read.open_table(self.tables.files())?;
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
        let table = read.open_table(self.tables.records())?;
        table
            .range(start.as_slice()..=end.as_slice())?
            .map(|entry| {
                let (_key, value) = entry?;
                decode_record_ref(value.value())
            })
            .collect()
    }

    /// The encoded locators of every record proven to contain `digest`.
    ///
    /// # Errors
    ///
    /// Returns an error if the index cannot be read.
    pub fn content(&self, digest: &[u8; 32]) -> Result<Vec<Vec<u8>>, StoreError> {
        let start = content_key(digest, &[0; 32], 0);
        let end = content_key(digest, &[u8::MAX; 32], u64::MAX);
        let read = self.database.begin_read()?;
        let table = read.open_table(self.tables.content())?;
        table
            .range(start.as_slice()..=end.as_slice())?
            .map(|entry| {
                let (_key, value) = entry?;
                Ok(value.value().to_vec())
            })
            .collect()
    }

    /// Commits record references and their exact source checkpoint atomically.
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
        self.commit_index_batch(
            file_id,
            IndexBatch {
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
    /// Tombstones prevent later prefix backfill from resurrecting removed
    /// turns.
    ///
    /// # Errors
    ///
    /// Returns an error if a write transaction cannot be opened or committed.
    pub fn commit_index_batch(
        &self,
        file_id: &[u8; 32],
        batch: IndexBatch<'_>,
        file_state: FileState,
    ) -> Result<(), StoreError> {
        let write = self.database.begin_write()?;
        {
            let mut table = write.open_table(self.tables.records())?;
            for (key, value) in batch.records {
                table.insert(key.as_slice(), value.as_slice())?;
            }
        }
        {
            let mut table = write.open_table(self.tables.turns())?;
            let mut by_id = write.open_table(self.tables.turns_by_id())?;
            let mut removed = write.open_table(self.tables.removed_turns())?;
            let mut summaries = write.open_table(self.tables.turn_summaries())?;
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
            let mut table = write.open_table(self.tables.turn_summaries())?;
            let removed = write.open_table(self.tables.removed_turns())?;
            for (start_offset, summary) in batch.turn_summaries {
                let key = offset_key(file_id, *start_offset);
                if removed.get(key.as_slice())?.is_some() {
                    continue;
                }
                table.insert(key.as_slice(), summary.as_slice())?;
            }
        }
        {
            let mut by_digest = write.open_table(self.tables.content())?;
            let mut by_file = write.open_table(self.tables.content_by_file())?;
            for entry in batch.content {
                let primary_key = content_key(&entry.digest, &entry.file_id, entry.offset);
                let reverse_key = content_reverse_key(&entry.file_id, &entry.digest, entry.offset);
                by_digest.insert(primary_key.as_slice(), entry.locator.as_slice())?;
                by_file.insert(reverse_key.as_slice(), 1)?;
            }
        }
        {
            let mut files = write.open_table(self.tables.files())?;
            files.insert(file_id.as_slice(), file_state.encode().as_slice())?;
        }
        write.commit()?;
        Ok(())
    }

    /// Removes the derived index for one replaced or truncated file.
    ///
    /// # Errors
    ///
    /// Returns an error if the range cannot be removed atomically.
    pub fn reset_file(&self, file_id: &[u8; 32]) -> Result<(), StoreError> {
        let start = offset_key(file_id, 0);
        let end = offset_key(file_id, u64::MAX);
        let mut id_start = Vec::with_capacity(33);
        id_start.extend_from_slice(file_id);
        id_start.push(0);
        let mut id_end = Vec::with_capacity(33);
        id_end.extend_from_slice(file_id);
        id_end.push(u8::MAX);

        let write = self.database.begin_write()?;
        {
            let reverse_start = content_reverse_key(file_id, &[0; 32], 0);
            let reverse_end = content_reverse_key(file_id, &[u8::MAX; 32], u64::MAX);
            let mut reverse = write.open_table(self.tables.content_by_file())?;
            // The keys form the stable deletion snapshot required to update
            // both derived indexes in one transaction.
            let keys = reverse
                .range(reverse_start.as_slice()..=reverse_end.as_slice())?
                .map(|entry| entry.map(|(key, _value)| key.value().to_vec()))
                .collect::<Result<Vec<_>, _>>()?;
            let mut by_digest = write.open_table(self.tables.content())?;
            for key in keys {
                if key.len() != 72 {
                    return Err(StoreError::CorruptedIndex(
                        "invalid indexed content key".into(),
                    ));
                }
                let digest: [u8; 32] = key[32..64].try_into().map_err(|_| {
                    StoreError::CorruptedIndex("invalid indexed content key".into())
                })?;
                let offset = read_u64(&key[64..72])?;
                by_digest.remove(content_key(&digest, file_id, offset).as_slice())?;
                reverse.remove(key.as_slice())?;
            }
        }
        {
            let mut removed = write.open_table(self.tables.removed_turns())?;
            removed.retain_in(start.as_slice()..=end.as_slice(), |_key, _value| false)?;
        }
        {
            let mut records = write.open_table(self.tables.records())?;
            records.retain_in(start.as_slice()..=end.as_slice(), |_key, _value| false)?;
        }
        {
            let mut turns = write.open_table(self.tables.turns())?;
            turns.retain_in(start.as_slice()..=end.as_slice(), |_key, _value| false)?;
        }
        {
            let mut turns_by_id = write.open_table(self.tables.turns_by_id())?;
            turns_by_id.retain_in(id_start.as_slice()..=id_end.as_slice(), |_key, _value| {
                false
            })?;
        }
        {
            let mut summaries = write.open_table(self.tables.turn_summaries())?;
            summaries.retain_in(start.as_slice()..=end.as_slice(), |_key, _value| false)?;
        }
        {
            let mut files = write.open_table(self.tables.files())?;
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
        let table = read.open_table(self.tables.records())?;
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
        let table = read.open_table(self.tables.turns())?;
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
        let table = read.open_table(self.tables.turns())?;
        table
            .range(start.as_slice()..=end.as_slice())?
            .take(limit)
            .map(|entry| {
                let (_key, value) = entry?;
                TurnRef::decode(value.value())
            })
            .collect()
    }

    /// Whether a rollback removed an indexed turn that started in
    /// `from..before`. The index applies rollbacks wherever they occur in the
    /// file, so a range without removals reads the same through any prefix.
    ///
    /// # Errors
    ///
    /// Returns an error if the index cannot be read.
    pub fn has_removed_turns(
        &self,
        file_id: &[u8; 32],
        from: u64,
        before: u64,
    ) -> Result<bool, StoreError> {
        if from >= before {
            return Ok(false);
        }
        let start = offset_key(file_id, from);
        let end = offset_key(file_id, before - 1);
        let read = self.database.begin_read()?;
        let removed = read.open_table(self.tables.removed_turns())?;
        Ok(removed
            .range(start.as_slice()..=end.as_slice())?
            .next()
            .transpose()?
            .is_some())
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
        let by_id = read.open_table(self.tables.turns_by_id())?;
        let id_key = turn_id_key(file_id, turn_id);
        let Some(offset) = by_id.get(id_key.as_slice())?.map(|value| value.value()) else {
            return Ok(None);
        };
        let turns = read.open_table(self.tables.turns())?;
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
        let table = read.open_table(self.tables.turn_summaries())?;
        let key = offset_key(file_id, start_offset);
        table
            .get(key.as_slice())?
            .map(|value| serde_json::from_slice(value.value()))
            .transpose()
            .map_err(StoreError::from)
    }

    /// Persists one materialized turn projection without changing the file
    /// checkpoint. Used to lazily enrich an offset index created by an older
    /// companion without rebuilding the whole file.
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
            let mut table = write.open_table(self.tables.turn_summaries())?;
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
        let table = read.open_table(self.tables.turns())?;
        Ok(table.len()?)
    }
}

/// One indexed turn: a contiguous byte range of its file. An open turn keeps
/// `end_offset == 0` until its terminal record arrives.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct TurnRef {
    pub id: String,
    pub start_offset: u64,
    pub end_offset: u64,
    pub completed: bool,
}

/// One indexed record: where it lies and the provider's byte tag for it.
#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct RecordRef {
    pub offset: u64,
    pub length: u32,
    pub record_type: u8,
}

/// A piece of content proven to lie in one record, keyed by its digest. The
/// locator's encoding belongs to the provider.
#[derive(Clone, Debug)]
pub struct ContentEntry {
    pub digest: [u8; 32],
    pub file_id: [u8; 32],
    pub offset: u64,
    pub locator: Vec<u8>,
}

/// Everything one scan step commits together with the file's checkpoint.
#[derive(Clone, Copy)]
pub struct IndexBatch<'a> {
    pub records: &'a [(Vec<u8>, Vec<u8>)],
    pub turns: &'a [TurnRef],
    pub turn_summaries: &'a [(u64, Vec<u8>)],
    pub removed_turns: &'a [u64],
    pub content: &'a [ContentEntry],
}

impl TurnRef {
    pub(crate) fn encode(&self) -> Result<Vec<u8>, StoreError> {
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

    pub(crate) fn decode(encoded: &[u8]) -> Result<Self, StoreError> {
        if encoded.len() < 20 || encoded[0] != 1 {
            return Err(StoreError::CorruptedIndex("invalid indexed turn".into()));
        }
        let id_length = usize::from(read_u16(&encoded[18..20])?);
        if encoded.len() != 20 + id_length {
            return Err(StoreError::CorruptedIndex(
                "invalid indexed turn id length".into(),
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

/// The durable checkpoint of one file: the contiguous indexed range and what
/// proves the bytes behind it unchanged.
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
                "invalid indexed file state".into(),
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

/// The key of a record or turn row: the file, then the offset.
#[must_use]
pub fn offset_key(file_id: &[u8; 32], offset: u64) -> Vec<u8> {
    let mut key = Vec::with_capacity(40);
    key.extend_from_slice(file_id);
    key.extend_from_slice(&offset.to_be_bytes());
    key
}

/// The value of a record row.
#[must_use]
pub fn record_value(offset: u64, length: u32, record_type: u8) -> Vec<u8> {
    let mut value = Vec::with_capacity(13);
    value.extend_from_slice(&offset.to_be_bytes());
    value.extend_from_slice(&length.to_be_bytes());
    value.push(record_type);
    value
}

fn content_key(digest: &[u8; 32], file_id: &[u8; 32], offset: u64) -> Vec<u8> {
    let mut key = Vec::with_capacity(72);
    key.extend_from_slice(digest);
    key.extend_from_slice(file_id);
    key.extend_from_slice(&offset.to_be_bytes());
    key
}

fn content_reverse_key(file_id: &[u8; 32], digest: &[u8; 32], offset: u64) -> Vec<u8> {
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
            "invalid indexed record reference".into(),
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
    fn turn_refs_round_trip() -> Result<(), Box<dyn std::error::Error>> {
        let turn = TurnRef {
            id: "turn-1".into(),
            start_offset: 7,
            end_offset: 0,
            completed: false,
        };
        assert_eq!(TurnRef::decode(&turn.encode()?)?, turn);
        Ok(())
    }
}
