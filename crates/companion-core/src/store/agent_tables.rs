//! Durable tables of the agent provider layer: thread bindings, the layer's
//! small metadata records (backfill progress markers), subagent links of the
//! orchestration tools and cross-provider fork records.
//!
//! The values are opaque versioned JSON owned by `agent::bindings`,
//! `agent::orchestration` and `agent::fork`; this module only provides
//! atomic storage primitives.

use redb::{ReadableDatabase, ReadableTable, TableDefinition, WriteTransaction};

use super::{IndexStore, StoreError};

/// `appThreadId` → versioned binding record (JSON).
const AGENT_THREAD_BINDINGS: TableDefinition<&str, &[u8]> =
    TableDefinition::new("agent_thread_bindings");
/// Layer metadata such as `agent_bindings_backfill_v1:<provider>` markers.
const AGENT_META: TableDefinition<&str, &[u8]> = TableDefinition::new("agent_meta");
/// Native thread id of a non-first binding segment → its app thread id.
const AGENT_CONTINUATIONS: TableDefinition<&str, &str> =
    TableDefinition::new("agent_thread_continuations");

/// `<parent>\0<child>` → subagent link record (JSON).
const AGENT_SUBAGENT_CHILDREN: TableDefinition<&str, &[u8]> =
    TableDefinition::new("agent_subagent_children");
/// Child app thread id → parent app thread id of a subagent link.
const AGENT_SUBAGENT_PARENTS: TableDefinition<&str, &str> =
    TableDefinition::new("agent_subagent_parents");
/// App thread id of a cross-provider fork → fork record (JSON).
const AGENT_THREAD_FORKS: TableDefinition<&str, &[u8]> = TableDefinition::new("agent_thread_forks");

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
    write.open_table(AGENT_CONTINUATIONS)?;
    write.open_table(AGENT_SUBAGENT_CHILDREN)?;
    write.open_table(AGENT_SUBAGENT_PARENTS)?;
    write.open_table(AGENT_THREAD_FORKS)?;
    Ok(())
}

fn subagent_key(parent: &str, child: &str) -> String {
    format!("{parent}\0{child}")
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

    /// Rewrites binding records in one transaction: `upgrade` returns the
    /// new bytes of a record that changes, `None` otherwise. Returns how
    /// many records changed.
    ///
    /// # Errors
    /// Returns an error when the transaction fails or `upgrade` rejects a
    /// record; no record changes then.
    pub fn agent_bindings_upgrade<E: From<StoreError>>(
        &self,
        upgrade: impl Fn(&[u8]) -> Result<Option<Vec<u8>>, E>,
    ) -> Result<usize, E> {
        let write = self.database.begin_write().map_err(StoreError::from)?;
        let mut changed = 0;
        {
            let mut table = write
                .open_table(AGENT_THREAD_BINDINGS)
                .map_err(StoreError::from)?;
            let mut updates = Vec::new();
            for entry in table.iter().map_err(StoreError::from)? {
                let (key, value) = entry.map_err(StoreError::from)?;
                if let Some(next) = upgrade(value.value())? {
                    updates.push((key.value().to_owned(), next));
                }
            }
            for (key, value) in updates {
                table
                    .insert(key.as_str(), value.as_slice())
                    .map_err(StoreError::from)?;
                changed += 1;
            }
        }
        write.commit().map_err(StoreError::from)?;
        Ok(changed)
    }

    /// Replaces one binding record and indexes the native ids of its
    /// non-first segments, in one transaction.
    ///
    /// # Errors
    /// Returns an error when the transaction fails.
    pub fn agent_binding_replace(
        &self,
        app_thread_id: &str,
        record: &[u8],
        continuations: &[&str],
    ) -> Result<(), StoreError> {
        let write = self.database.begin_write()?;
        {
            write
                .open_table(AGENT_THREAD_BINDINGS)?
                .insert(app_thread_id, record)?;
            let mut table = write.open_table(AGENT_CONTINUATIONS)?;
            for native in continuations {
                table.insert(*native, app_thread_id)?;
            }
        }
        write.commit()?;
        Ok(())
    }

    /// Every native thread id that continues an app thread (a non-first
    /// segment), with its app thread id.
    ///
    /// # Errors
    /// Returns an error when the index cannot be read.
    pub fn agent_continuations(&self) -> Result<Vec<(String, String)>, StoreError> {
        let read = self.database.begin_read()?;
        let table = read.open_table(AGENT_CONTINUATIONS)?;
        table
            .iter()?
            .map(|entry| {
                entry
                    .map(|(native, app)| (native.value().to_owned(), app.value().to_owned()))
                    .map_err(StoreError::from)
            })
            .collect()
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

    /// Links a child app thread to its parent, in one transaction. A child
    /// has one parent; linking it again replaces the record.
    ///
    /// # Errors
    /// Returns an error when the transaction fails.
    pub fn put_agent_subagent_link(
        &self,
        parent: &str,
        child: &str,
        record: &[u8],
    ) -> Result<(), StoreError> {
        let write = self.database.begin_write()?;
        {
            write
                .open_table(AGENT_SUBAGENT_CHILDREN)?
                .insert(subagent_key(parent, child).as_str(), record)?;
            write
                .open_table(AGENT_SUBAGENT_PARENTS)?
                .insert(child, parent)?;
        }
        write.commit()?;
        Ok(())
    }

    /// The link records of one parent's children, ordered by child id.
    ///
    /// # Errors
    /// Returns an error when the index cannot be read.
    pub fn agent_subagent_children(&self, parent: &str) -> Result<Vec<Vec<u8>>, StoreError> {
        let read = self.database.begin_read()?;
        let table = read.open_table(AGENT_SUBAGENT_CHILDREN)?;
        let start = format!("{parent}\0");
        let end = format!("{parent}\u{1}");
        table
            .range(start.as_str()..end.as_str())?
            .map(|entry| {
                entry
                    .map(|(_key, value)| value.value().to_vec())
                    .map_err(StoreError::from)
            })
            .collect()
    }

    /// The parent of a linked child thread.
    ///
    /// # Errors
    /// Returns an error when the index cannot be read.
    pub fn agent_subagent_parent(&self, child: &str) -> Result<Option<String>, StoreError> {
        let read = self.database.begin_read()?;
        let table = read.open_table(AGENT_SUBAGENT_PARENTS)?;
        Ok(table.get(child)?.map(|value| value.value().to_owned()))
    }

    /// Every linked child thread id.
    ///
    /// # Errors
    /// Returns an error when the index cannot be read.
    pub fn agent_subagent_child_ids(&self) -> Result<Vec<String>, StoreError> {
        let read = self.database.begin_read()?;
        let table = read.open_table(AGENT_SUBAGENT_PARENTS)?;
        table
            .iter()?
            .map(|entry| {
                entry
                    .map(|(child, _parent)| child.value().to_owned())
                    .map_err(StoreError::from)
            })
            .collect()
    }

    /// Reads the fork record of one app thread.
    ///
    /// # Errors
    /// Returns an error when the index cannot be read.
    pub fn agent_thread_fork(&self, thread: &str) -> Result<Option<Vec<u8>>, StoreError> {
        let read = self.database.begin_read()?;
        let table = read.open_table(AGENT_THREAD_FORKS)?;
        Ok(table.get(thread)?.map(|value| value.value().to_vec()))
    }

    /// Replaces the fork record of one app thread.
    ///
    /// # Errors
    /// Returns an error when the transaction fails.
    pub fn put_agent_thread_fork(&self, thread: &str, record: &[u8]) -> Result<(), StoreError> {
        let write = self.database.begin_write()?;
        {
            write
                .open_table(AGENT_THREAD_FORKS)?
                .insert(thread, record)?;
        }
        write.commit()?;
        Ok(())
    }

    /// Every app thread with a fork record.
    ///
    /// # Errors
    /// Returns an error when the index cannot be read.
    pub fn agent_thread_fork_ids(&self) -> Result<Vec<String>, StoreError> {
        let read = self.database.begin_read()?;
        let table = read.open_table(AGENT_THREAD_FORKS)?;
        table
            .iter()?
            .map(|entry| {
                entry
                    .map(|(thread, _record)| thread.value().to_owned())
                    .map_err(StoreError::from)
            })
            .collect()
    }
}
