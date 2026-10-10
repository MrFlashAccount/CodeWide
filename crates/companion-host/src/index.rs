//! The shared host index substrate: the error vocabulary of the companion's
//! redb index and the extension point through which a provider adapter owns
//! tables it derives from its own sources inside that same database.
//!
//! `companion-core`'s `IndexStore` owns the database file, its schema version
//! and the companion tables (replay, outbox, pins, bindings, usage, thread
//! metadata). A provider crate attaches its derived tables with
//! [`DerivedIndexSchema`] and reads them through the shared
//! [`redb::Database`] handle; it never touches companion tables directly.

use redb::{
    Database, Key, ReadTransaction, ReadableDatabase, TableDefinition, TableError, Value,
    WriteTransaction,
};

/// Companion index metadata: schema and logic versions, the replay head.
pub const META: TableDefinition<&str, u64> = TableDefinition::new("meta");

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
}

/// Tables a provider derives from its own durable sources inside the host
/// index. They are disposable: the provider rebuilds them from the source.
pub trait DerivedIndexSchema: Send + Sync {
    /// Creates the owned tables inside the index's opening migration
    /// transaction. `rebuild` is set when the companion schema migration
    /// requires every derived table to be rebuilt; the schema also resets its
    /// tables when its own logic version (kept in [`META`]) changed.
    ///
    /// # Errors
    ///
    /// Returns an error when the transaction cannot read or change a table.
    fn migrate(&self, write: &WriteTransaction, rebuild: bool) -> Result<(), StoreError>;

    /// Whether `read` sees every owned table at the current logic version.
    ///
    /// # Errors
    ///
    /// Returns an error when the index cannot be read.
    fn is_current(&self, read: &ReadTransaction) -> Result<bool, StoreError>;
}

/// Migrates `schema` in its own transaction unless the index already holds
/// it at the current logic version (an index opened without the schema).
///
/// # Errors
///
/// Returns an error when the tables cannot be checked or migrated.
pub fn attach_derived(
    database: &Database,
    schema: &dyn DerivedIndexSchema,
) -> Result<(), StoreError> {
    if schema.is_current(&database.begin_read()?)? {
        return Ok(());
    }
    let write = database.begin_write()?;
    schema.migrate(&write, false)?;
    write.commit()?;
    Ok(())
}

/// The logic version a derived schema stored under `key` in [`META`].
///
/// # Errors
///
/// Returns an error when the metadata cannot be read.
pub fn logic_version(read: &ReadTransaction, key: &str) -> Result<Option<u64>, StoreError> {
    match read.open_table(META) {
        Ok(meta) => Ok(meta.get(key)?.map(|entry| entry.value())),
        Err(TableError::TableDoesNotExist(_)) => Ok(None),
        Err(error) => Err(error.into()),
    }
}

/// Whether `read` sees `table`.
///
/// # Errors
///
/// Returns an error when the table list cannot be read.
pub fn table_exists<K: Key + 'static, V: Value + 'static>(
    read: &ReadTransaction,
    table: TableDefinition<K, V>,
) -> Result<bool, StoreError> {
    match read.open_table(table) {
        Ok(_) => Ok(true),
        Err(TableError::TableDoesNotExist(_)) => Ok(false),
        Err(error) => Err(error.into()),
    }
}
