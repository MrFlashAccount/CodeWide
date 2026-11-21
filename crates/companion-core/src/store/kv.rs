//! Atomic primitives over `&str → bytes` tables created lazily on first
//! write. A table that was never written reads as empty, so adding one needs
//! no schema migration and an older companion simply ignores it.

use redb::{ReadableDatabase, ReadableTable, TableDefinition, TableError};

use super::{IndexStore, StoreError};

pub(crate) type BytesTable = TableDefinition<'static, &'static str, &'static [u8]>;

/// One change of an atomic batch.
pub(crate) enum KvOp {
    Put {
        table: BytesTable,
        key: String,
        value: Vec<u8>,
    },
    Delete {
        table: BytesTable,
        key: String,
    },
}

impl IndexStore {
    /// Reads one value; a missing table or key is `None`.
    ///
    /// # Errors
    /// Returns an error when the index cannot be read.
    pub(crate) fn kv_get(
        &self,
        table: BytesTable,
        key: &str,
    ) -> Result<Option<Vec<u8>>, StoreError> {
        let read = self.database.begin_read()?;
        let table = match read.open_table(table) {
            Ok(table) => table,
            Err(TableError::TableDoesNotExist(_)) => return Ok(None),
            Err(error) => return Err(error.into()),
        };
        Ok(table.get(key)?.map(|value| value.value().to_vec()))
    }

    /// Every entry whose key starts with `prefix`, in key order.
    ///
    /// # Errors
    /// Returns an error when the index cannot be read.
    pub(crate) fn kv_scan(
        &self,
        table: BytesTable,
        prefix: &str,
    ) -> Result<Vec<(String, Vec<u8>)>, StoreError> {
        let read = self.database.begin_read()?;
        let table = match read.open_table(table) {
            Ok(table) => table,
            Err(TableError::TableDoesNotExist(_)) => return Ok(Vec::new()),
            Err(error) => return Err(error.into()),
        };
        let mut entries = Vec::new();
        for entry in table.range(prefix..)? {
            let (key, value) = entry?;
            let key = key.value();
            if !key.starts_with(prefix) {
                break;
            }
            entries.push((key.to_owned(), value.value().to_vec()));
        }
        Ok(entries)
    }

    /// Applies puts and deletes in one transaction.
    ///
    /// # Errors
    /// Returns an error when the transaction fails; nothing changes then.
    pub(crate) fn kv_apply(&self, ops: Vec<KvOp>) -> Result<(), StoreError> {
        let write = self.database.begin_write()?;
        for op in ops {
            match op {
                KvOp::Put { table, key, value } => {
                    write
                        .open_table(table)?
                        .insert(key.as_str(), value.as_slice())?;
                }
                KvOp::Delete { table, key } => {
                    write.open_table(table)?.remove(key.as_str())?;
                }
            }
        }
        write.commit()?;
        Ok(())
    }

    /// Inserts `value` unless `key` exists; returns the existing value then.
    ///
    /// # Errors
    /// Returns an error when the transaction fails.
    pub(crate) fn kv_insert_absent(
        &self,
        table: BytesTable,
        key: &str,
        value: &[u8],
    ) -> Result<Option<Vec<u8>>, StoreError> {
        let write = self.database.begin_write()?;
        let existing = {
            let mut table = write.open_table(table)?;
            let existing = table.get(key)?.map(|stored| stored.value().to_vec());
            if existing.is_none() {
                table.insert(key, value)?;
            }
            existing
        };
        write.commit()?;
        Ok(existing)
    }
}

#[cfg(test)]
#[allow(clippy::expect_used)]
mod tests {
    use super::*;

    const TABLE: BytesTable = TableDefinition::new("kv_test");

    #[test]
    fn missing_tables_read_empty_and_batches_are_atomic() {
        let directory = tempfile::tempdir().expect("dir");
        let store = IndexStore::open(directory.path().join("state.redb")).expect("store");
        assert_eq!(store.kv_get(TABLE, "a").expect("get"), None);
        assert!(store.kv_scan(TABLE, "").expect("scan").is_empty());
        store
            .kv_apply(vec![
                KvOp::Put {
                    table: TABLE,
                    key: "p\0a".into(),
                    value: b"1".to_vec(),
                },
                KvOp::Put {
                    table: TABLE,
                    key: "p\0b".into(),
                    value: b"2".to_vec(),
                },
                KvOp::Put {
                    table: TABLE,
                    key: "q\0a".into(),
                    value: b"3".to_vec(),
                },
            ])
            .expect("apply");
        let scanned = store.kv_scan(TABLE, "p\0").expect("scan");
        assert_eq!(scanned.len(), 2);
        assert_eq!(
            store.kv_insert_absent(TABLE, "p\0a", b"9").expect("insert"),
            Some(b"1".to_vec())
        );
        assert_eq!(
            store.kv_insert_absent(TABLE, "new", b"9").expect("insert"),
            None
        );
    }
}
