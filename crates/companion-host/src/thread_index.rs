//! The companion's thread metadata index as provider adapters see it.
//!
//! `companion-core`'s `IndexStore` owns the metadata and pin tables and
//! implements [`HostThreadIndex`]. Provider adapters write the metadata they
//! discover and read the subagent tree and pin snapshot only through it.

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::index::StoreError;

/// Canonical metadata of one thread, as indexed by the companion.
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

/// The pinned thread ids at one replay cursor.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ThreadPinSnapshot {
    pub cursor: u64,
    pub thread_ids: Vec<String>,
}

/// Thread metadata and pin reads a provider adapter may perform on the host
/// index.
pub trait HostThreadIndex: Send + Sync {
    /// Atomically updates one thread's canonical metadata and parent index.
    ///
    /// # Errors
    ///
    /// Returns an error when serialization or the index transaction fails.
    fn put_thread_metadata(&self, metadata: &IndexedThreadMetadata) -> Result<(), StoreError>;

    /// Atomically updates several threads' metadata and parent index.
    ///
    /// # Errors
    ///
    /// Returns an error when serialization or the index transaction fails.
    fn put_thread_metadata_batch(
        &self,
        metadata: &[IndexedThreadMetadata],
    ) -> Result<(), StoreError>;

    /// Every indexed descendant of `root_thread_id`.
    ///
    /// # Errors
    ///
    /// Returns an error when the index cannot be read.
    fn thread_descendants(
        &self,
        root_thread_id: &str,
    ) -> Result<Vec<IndexedThreadMetadata>, StoreError>;

    /// The pinned thread ids at the current replay head.
    ///
    /// # Errors
    ///
    /// Returns an error when the index cannot be read.
    fn thread_pin_snapshot(&self) -> Result<ThreadPinSnapshot, StoreError>;
}

/// Resolves metadata of a thread the host index does not know yet from the
/// owning provider's own storage.
pub trait ThreadMetadataSource: Send + Sync {
    /// `Ok(None)` when the provider does not know the thread.
    ///
    /// # Errors
    ///
    /// Returns the reason when the provider's storage cannot be read.
    fn thread_metadata(&self, thread_id: &str) -> Result<Option<IndexedThreadMetadata>, String>;
}
