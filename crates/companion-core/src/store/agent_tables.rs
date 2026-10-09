//! Durable tables of the agent provider layer: thread bindings and the
//! layer's small metadata records (backfill progress markers).
//!
//! The values are opaque versioned JSON owned by `agent::bindings`; this
//! module only provides atomic storage primitives.

use redb::{ReadableDatabase, ReadableTable, TableDefinition, WriteTransaction};

use super::{IndexStore, StoreError};

/// `appThreadId` → versioned binding record (JSON).
const AGENT_THREAD_BINDINGS: TableDefinition<&str, &[u8]> =
    TableDefinition::new("agent_thread_bindings");
/// Layer metadata such as `agent_bindings_backfill_v1:<provider>` markers.
const AGENT_META: TableDefinition<&str, &[u8]> = TableDefinition::new("agent_meta");

/// Outcome of an insert-if-absent write.
#[derive(Debug, Eq, PartialEq)]
pub enum BindingWrite {
    Inserted,
    /// A record already existed; it is returned unchanged.
    Existing(Vec<u8>),
}

pub(super) fn create(write: &WriteTransaction) -> Result<(), StoreError> {
    write.open_table(AGENT_THREAD_BINDINGS)?;
    write.open_table(AGENT_META)?;
    Ok(())
}

impl IndexStore {
    /// Reads one binding record.
    ///
    /// # Errors
    /// Returns an error when the index cannot be read.
    pub fn agent_binding(&self, app_thread_id: &str) -> Result<Option<Vec<u8>>, StoreError> {
        let read = self.database.begin_read()?;
        let table = read.open_table(AGENT_THREAD_BINDINGS)?;
        Ok(table
            .get(app_thread_id)?
            .map(|value| value.value().to_vec()))
    }

    /// Inserts binding records whose key is absent, in one transaction.
    /// Existing records are never replaced: a binding's provider is fixed.
    ///
    /// # Errors
    /// Returns an error when the transaction fails.
    pub fn agent_bindings_insert_absent(
        &self,
        records: &[(&str, &[u8])],
    ) -> Result<Vec<BindingWrite>, StoreError> {
        let write = self.database.begin_write()?;
        let mut outcomes = Vec::with_capacity(records.len());
        {
            let mut table = write.open_table(AGENT_THREAD_BINDINGS)?;
            for (key, value) in records {
                let existing = table.get(*key)?.map(|stored| stored.value().to_vec());
                if let Some(existing) = existing {
                    outcomes.push(BindingWrite::Existing(existing));
                } else {
                    table.insert(*key, *value)?;
                    outcomes.push(BindingWrite::Inserted);
                }
            }
        }
        write.commit()?;
        Ok(outcomes)
    }

    /// Reads one agent-layer metadata record.
    ///
    /// # Errors
    /// Returns an error when the index cannot be read.
    pub fn agent_meta(&self, key: &str) -> Result<Option<Vec<u8>>, StoreError> {
        let read = self.database.begin_read()?;
        let table = read.open_table(AGENT_META)?;
        Ok(table.get(key)?.map(|value| value.value().to_vec()))
    }

    /// Replaces one agent-layer metadata record.
    ///
    /// # Errors
    /// Returns an error when the transaction fails.
    pub fn put_agent_meta(&self, key: &str, value: &[u8]) -> Result<(), StoreError> {
        let write = self.database.begin_write()?;
        {
            let mut table = write.open_table(AGENT_META)?;
            table.insert(key, value)?;
        }
        write.commit()?;
        Ok(())
    }
}
