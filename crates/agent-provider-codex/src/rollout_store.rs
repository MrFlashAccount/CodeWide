//! The rollout index: the Codex adapter's tables in the shared offset index
//! (`agent-index`) inside the companion's host index database.
//!
//! The table names, row encodings and [`ROLLOUT_LOGIC_VERSION`] are the ones
//! every companion wrote so far, so attaching through the shared store
//! reads an existing index unchanged. The tables are disposable:
//! [`ROLLOUT_INDEX_SCHEMA`] creates them in the index's opening migration
//! and drops them when the companion schema asks for a rebuild or when the
//! logic version changes; the indexer then rebuilds them from the unchanged
//! rollouts.

use std::{ops::Deref, path::PathBuf, sync::Arc};

use agent_index::{IndexStore, IndexTables};
use companion_host::{index::StoreError, thread_index::HostThreadIndex};
use redb::Database;
use serde::{Deserialize, Serialize};

pub use agent_index::{FileState, RecordRef, TurnRef};

pub const ROLLOUT_LOGIC_VERSION: u64 = 4;

/// The rollout tables' schema in the host index.
pub const ROLLOUT_INDEX_SCHEMA: IndexTables = IndexTables {
    files: "rollout_files",
    records: "rollout_records",
    turns: "rollout_turns",
    turns_by_id: "rollout_turns_by_id",
    removed_turns: "rollout_removed_turns",
    turn_summaries: "rollout_turn_summaries",
    content: "rollout_content",
    content_by_file: "rollout_content_by_file",
    logic_version_key: "rollout_logic_version",
    logic_version: ROLLOUT_LOGIC_VERSION,
};

/// The rollout index over the shared host index database, and the
/// companion thread index the rollout indexer publishes metadata to.
pub struct RolloutStore(IndexStore);

impl Deref for RolloutStore {
    type Target = IndexStore;

    fn deref(&self) -> &IndexStore {
        &self.0
    }
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
        Ok(Self(IndexStore::attach(
            database,
            threads,
            ROLLOUT_INDEX_SCHEMA,
        )?))
    }

    /// The per-rollout lane serializing scans and qualified reads.
    pub(crate) fn rollout_index_lock(&self, file_id: [u8; 32]) -> Arc<std::sync::Mutex<()>> {
        self.0.index_lock(file_id)
    }

    /// Resolves canonical rollout records that were proven to contain the
    /// requested digest while indexing their source JSONL.
    pub(crate) fn rollout_content(
        &self,
        digest: &[u8; 32],
    ) -> Result<Vec<RolloutContentLocator>, StoreError> {
        self.0
            .content(digest)?
            .iter()
            .map(|locator| serde_json::from_slice(locator).map_err(StoreError::from))
            .collect()
    }
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

#[cfg(test)]
mod tests {
    use agent_index::store::offset_key;
    use companion_host::index::{DerivedIndexSchema, META};
    use redb::{ReadableDatabase, TableDefinition};

    use super::*;

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
            let write = store.database().begin_write()?;
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
