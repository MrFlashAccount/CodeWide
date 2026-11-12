//! The tables of a segmented index ([`crate::segment`]): the shared offset
//! index tables of [`IndexTables`] plus what a source whose turn boundaries
//! depend on earlier records needs to continue and to rescan a bounded
//! suffix: the scan cursor of each file, the cursor each turn starts from,
//! the span of each keyed record and the facts the scan observed, by group.
//!
//! Like the shared tables these are derived from the files and dropped with
//! the provider's logic version. Keys and facts are a pure function of the
//! bytes they were read from: a bounded rescan rewrites equal rows, so it
//! never deletes them; only a rewritten file drops its keys.

use std::sync::Arc;

use companion_host::{
    index::{DerivedIndexSchema, META, StoreError, attach_derived, logic_version, table_exists},
    thread_index::HostThreadIndex,
};
use redb::{
    Database, ReadTransaction, ReadableDatabase, ReadableTable, TableDefinition, WriteTransaction,
};

use crate::store::{IndexBatch, IndexStore, IndexTables, TurnRef, offset_key, read_u64};

/// The names of a segmented index's tables and the logic version that
/// decides when they are rebuilt.
#[derive(Clone, Copy, Debug)]
pub struct SegmentTables {
    /// The shared offset index tables (files, turns, turns by id, removed
    /// turns, turn summaries; records and content stay empty).
    pub index: IndexTables,
    /// `file id ‖ key` → the record's offset and length.
    pub record_keys: &'static str,
    /// `file id` → the scan cursor at the checkpoint.
    pub scan_states: &'static str,
    /// `file id ‖ start offset` → the cursor the turn starts from.
    pub turn_states: &'static str,
    /// `group ‖ key` → the merged fact.
    pub facts: &'static str,
}

impl SegmentTables {
    const fn record_keys(&self) -> TableDefinition<'static, &'static [u8], &'static [u8]> {
        TableDefinition::new(self.record_keys)
    }

    const fn scan_states(&self) -> TableDefinition<'static, &'static [u8], &'static [u8]> {
        TableDefinition::new(self.scan_states)
    }

    const fn turn_states(&self) -> TableDefinition<'static, &'static [u8], &'static [u8]> {
        TableDefinition::new(self.turn_states)
    }

    const fn facts(&self) -> TableDefinition<'static, &'static [u8], &'static [u8]> {
        TableDefinition::new(self.facts)
    }
}

impl DerivedIndexSchema for SegmentTables {
    fn migrate(&self, write: &WriteTransaction, rebuild: bool) -> Result<(), StoreError> {
        let rebuild = rebuild || {
            let meta = write.open_table(META)?;
            meta.get(self.index.logic_version_key)?
                .map(|entry| entry.value())
                != Some(self.index.logic_version)
        };
        if rebuild {
            write.delete_table(self.record_keys())?;
            write.delete_table(self.scan_states())?;
            write.delete_table(self.turn_states())?;
            write.delete_table(self.facts())?;
        }
        self.index.migrate(write, rebuild)?;
        write.open_table(self.record_keys())?;
        write.open_table(self.scan_states())?;
        write.open_table(self.turn_states())?;
        write.open_table(self.facts())?;
        Ok(())
    }

    fn is_current(&self, read: &ReadTransaction) -> Result<bool, StoreError> {
        Ok(self.index.is_current(read)?
            && logic_version(read, self.index.logic_version_key)? == Some(self.index.logic_version)
            && table_exists(read, self.facts())?)
    }
}

/// Where a keyed record lies in its file.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct RecordSpan {
    pub offset: u64,
    pub length: u32,
}

impl RecordSpan {
    /// The offset just after the record.
    #[must_use]
    pub const fn end(self) -> u64 {
        self.offset + self.length as u64
    }

    fn encode(self) -> [u8; 12] {
        let mut encoded = [0; 12];
        encoded[..8].copy_from_slice(&self.offset.to_be_bytes());
        encoded[8..].copy_from_slice(&self.length.to_be_bytes());
        encoded
    }

    fn decode(encoded: &[u8]) -> Result<Self, StoreError> {
        if encoded.len() != 12 {
            return Err(StoreError::CorruptedIndex("invalid record span".into()));
        }
        Ok(Self {
            offset: read_u64(&encoded[..8])?,
            length: u32::from_be_bytes(
                encoded[8..]
                    .try_into()
                    .map_err(|_| StoreError::CorruptedIndex("invalid record span".into()))?,
            ),
        })
    }
}

/// The rows one segmented scan step commits with its checkpoint.
pub(crate) struct SegmentRows<'a> {
    pub(crate) index: IndexBatch<'a>,
    pub(crate) renamed: &'a [String],
    pub(crate) turn_states: &'a [(u64, Vec<u8>)],
    pub(crate) keys: &'a [(Vec<u8>, RecordSpan)],
    pub(crate) facts: &'a [(Vec<u8>, Vec<u8>)],
    pub(crate) cursor: &'a [u8],
}

/// A segmented index over the shared host index database.
pub struct SegmentStore {
    index: IndexStore,
    tables: SegmentTables,
}

impl SegmentStore {
    /// Attaches to a host index database, migrating the tables when the
    /// index was opened without them.
    ///
    /// # Errors
    ///
    /// Returns an error when the tables cannot be checked or created.
    pub fn attach(
        database: Arc<Database>,
        threads: Arc<dyn HostThreadIndex>,
        tables: SegmentTables,
    ) -> Result<Self, StoreError> {
        attach_derived(&database, &tables)?;
        Ok(Self {
            index: IndexStore::attach(database, threads, tables.index)?,
            tables,
        })
    }

    /// The shared offset index: file checkpoints, turns, turn summaries.
    #[must_use]
    pub const fn index(&self) -> &IndexStore {
        &self.index
    }

    /// The span of the record `key` names in `file_id`.
    ///
    /// # Errors
    ///
    /// Returns an error when the index cannot be read.
    pub fn record_span(
        &self,
        file_id: &[u8; 32],
        key: &[u8],
    ) -> Result<Option<RecordSpan>, StoreError> {
        let read = self.index.database.begin_read()?;
        let table = read.open_table(self.tables.record_keys())?;
        table
            .get(prefixed(file_id, key).as_slice())?
            .map(|value| RecordSpan::decode(value.value()))
            .transpose()
    }

    /// The fact recorded under `key` for `group`.
    ///
    /// # Errors
    ///
    /// Returns an error when the index cannot be read.
    pub fn fact(&self, group: &[u8; 32], key: &[u8]) -> Result<Option<Vec<u8>>, StoreError> {
        let read = self.index.database.begin_read()?;
        let table = read.open_table(self.tables.facts())?;
        Ok(table
            .get(prefixed(group, key).as_slice())?
            .map(|value| value.value().to_vec()))
    }

    /// The cursor the turn starting at `start_offset` was opened from.
    ///
    /// # Errors
    ///
    /// Returns an error when the index cannot be read.
    pub fn turn_state(
        &self,
        file_id: &[u8; 32],
        start_offset: u64,
    ) -> Result<Option<Vec<u8>>, StoreError> {
        let read = self.index.database.begin_read()?;
        let table = read.open_table(self.tables.turn_states())?;
        Ok(table
            .get(offset_key(file_id, start_offset).as_slice())?
            .map(|value| value.value().to_vec()))
    }

    pub(crate) fn scan_state(&self, file_id: &[u8; 32]) -> Result<Option<Vec<u8>>, StoreError> {
        let read = self.index.database.begin_read()?;
        let table = read.open_table(self.tables.scan_states())?;
        Ok(table
            .get(file_id.as_slice())?
            .map(|value| value.value().to_vec()))
    }

    /// Every live turn of `file_id` starting at or after `from_offset`.
    pub(crate) fn turns_from(
        &self,
        file_id: &[u8; 32],
        from_offset: u64,
    ) -> Result<Vec<TurnRef>, StoreError> {
        self.index.turns_asc_from(file_id, from_offset, usize::MAX)
    }

    pub(crate) fn commit(
        &self,
        file_id: &[u8; 32],
        group: &[u8; 32],
        rows: &SegmentRows<'_>,
        file_state: crate::store::FileState,
    ) -> Result<(), StoreError> {
        let write = self.index.database.begin_write()?;
        self.index
            .write_index_batch(&write, file_id, rows.index, file_state)?;
        {
            let mut by_id = write.open_table(self.index.tables.turns_by_id())?;
            let turns = write.open_table(self.index.tables.turns())?;
            for previous in rows.renamed {
                let key = crate::store::turn_id_key(file_id, previous);
                // A rename inside this batch already moved the row; only an
                // id no live turn carries any longer is dropped.
                let Some(offset) = by_id.get(key.as_slice())?.map(|value| value.value()) else {
                    continue;
                };
                let current = turns
                    .get(offset_key(file_id, offset).as_slice())?
                    .map(|value| TurnRef::decode(value.value()))
                    .transpose()?;
                if current.is_none_or(|turn| turn.id != *previous) {
                    by_id.remove(key.as_slice())?;
                }
            }
        }
        {
            let mut states = write.open_table(self.tables.turn_states())?;
            let removed = write.open_table(self.index.tables.removed_turns())?;
            for offset in rows.index.removed_turns {
                states.remove(offset_key(file_id, *offset).as_slice())?;
            }
            for (offset, state) in rows.turn_states {
                let key = offset_key(file_id, *offset);
                if removed.get(key.as_slice())?.is_none() {
                    states.insert(key.as_slice(), state.as_slice())?;
                }
            }
        }
        {
            let mut keys = write.open_table(self.tables.record_keys())?;
            for (key, span) in rows.keys {
                keys.insert(prefixed(file_id, key).as_slice(), span.encode().as_slice())?;
            }
        }
        {
            let mut facts = write.open_table(self.tables.facts())?;
            for (key, value) in rows.facts {
                facts.insert(prefixed(group, key).as_slice(), value.as_slice())?;
            }
        }
        write
            .open_table(self.tables.scan_states())?
            .insert(file_id.as_slice(), rows.cursor)?;
        write.commit()?;
        Ok(())
    }

    /// Drops the turns starting at or after `from_offset` (and their
    /// tombstones and start cursors), so a scan can continue from there with
    /// `cursor`. Keys and facts stay: the rescan rewrites equal ones.
    pub(crate) fn truncate_turns(
        &self,
        file_id: &[u8; 32],
        from_offset: u64,
        file_state: crate::store::FileState,
        cursor: &[u8],
        reopened: Option<&TurnRef>,
    ) -> Result<(), StoreError> {
        let start = offset_key(file_id, from_offset);
        let end = offset_key(file_id, u64::MAX);
        let write = self.index.database.begin_write()?;
        {
            let mut turns = write.open_table(self.index.tables.turns())?;
            let mut by_id = write.open_table(self.index.tables.turns_by_id())?;
            let removed_turns = turns
                .extract_from_if(start.as_slice()..=end.as_slice(), |_key, _value| true)?
                .map(|entry| {
                    let (_key, value) = entry?;
                    TurnRef::decode(value.value())
                })
                .collect::<Result<Vec<_>, StoreError>>()?;
            for turn in removed_turns {
                by_id.remove(crate::store::turn_id_key(file_id, &turn.id).as_slice())?;
            }
            if let Some(reopened) = reopened {
                turns.insert(
                    offset_key(file_id, reopened.start_offset).as_slice(),
                    reopened.encode()?.as_slice(),
                )?;
                by_id.insert(
                    crate::store::turn_id_key(file_id, &reopened.id).as_slice(),
                    reopened.start_offset,
                )?;
            }
        }
        for table in [
            self.index.tables.turn_summaries(),
            self.tables.turn_states(),
        ] {
            write
                .open_table(table)?
                .retain_in(start.as_slice()..=end.as_slice(), |_key, _value| false)?;
        }
        write
            .open_table(self.index.tables.removed_turns())?
            .retain_in(start.as_slice()..=end.as_slice(), |_key, _value| false)?;
        write
            .open_table(self.index.tables.files())?
            .insert(file_id.as_slice(), file_state.encode().as_slice())?;
        write
            .open_table(self.tables.scan_states())?
            .insert(file_id.as_slice(), cursor)?;
        write.commit()?;
        Ok(())
    }

    /// Drops everything derived from one file: a rewritten or truncated file
    /// is indexed again from its first byte, a removed one not at all. The
    /// facts of its group stay ([`Self::remove_group`] drops them).
    ///
    /// # Errors
    ///
    /// Returns an error when the rows cannot be removed atomically.
    pub fn reset_file(&self, file_id: &[u8; 32]) -> Result<(), StoreError> {
        self.index.reset_file(file_id)?;
        let write = self.index.database.begin_write()?;
        for table in [self.tables.record_keys(), self.tables.turn_states()] {
            retain_outside(&mut write.open_table(table)?, file_id)?;
        }
        write
            .open_table(self.tables.scan_states())?
            .remove(file_id.as_slice())?;
        write.commit()?;
        Ok(())
    }

    /// Drops every fact of `group`.
    ///
    /// # Errors
    ///
    /// Returns an error when the rows cannot be removed.
    pub fn remove_group(&self, group: &[u8; 32]) -> Result<(), StoreError> {
        let write = self.index.database.begin_write()?;
        retain_outside(&mut write.open_table(self.tables.facts())?, group)?;
        write.commit()?;
        Ok(())
    }
}

fn prefixed(prefix: &[u8; 32], key: &[u8]) -> Vec<u8> {
    let mut prefixed = Vec::with_capacity(32 + key.len());
    prefixed.extend_from_slice(prefix);
    prefixed.extend_from_slice(key);
    prefixed
}

/// Removes every row whose key starts with `prefix`.
fn retain_outside(
    table: &mut redb::Table<'_, &'static [u8], &'static [u8]>,
    prefix: &[u8; 32],
) -> Result<(), StoreError> {
    let start = prefix.as_slice();
    match successor(prefix) {
        Some(end) => table.retain_in(start..end.as_slice(), |_key, _value| false)?,
        None => table.retain_in(start.., |_key, _value| false)?,
    }
    Ok(())
}

/// The smallest 32-byte value greater than every key starting with
/// `prefix`; `None` when `prefix` is all ones.
fn successor(prefix: &[u8; 32]) -> Option<[u8; 32]> {
    let mut next = *prefix;
    for byte in next.iter_mut().rev() {
        if *byte == u8::MAX {
            *byte = 0;
        } else {
            *byte += 1;
            return Some(next);
        }
    }
    None
}
