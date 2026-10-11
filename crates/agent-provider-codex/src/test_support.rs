//! Test doubles for the host contracts this adapter consumes: an in-memory
//! companion thread index and a recording preview-file service.

use std::{
    collections::{BTreeMap, HashSet},
    path::Path,
    sync::{Arc, Mutex, PoisonError},
};

use companion_host::{
    index::StoreError,
    thread_index::{HostThreadIndex, IndexedThreadMetadata, ThreadPinSnapshot},
};

use crate::rollout_store::RolloutStore;

/// Opens a fresh host index database at `path` with the rollout tables.
pub(crate) fn open_rollout_store(path: impl AsRef<Path>) -> Result<RolloutStore, StoreError> {
    let database = companion_host::database::open(path, "index")?;
    RolloutStore::attach(database, Arc::new(MemoryThreadIndex::default()))
}

/// The companion thread index in memory, with the host's ordering: every
/// descendant in parent-before-child order, siblings by id.
#[derive(Default)]
pub(crate) struct MemoryThreadIndex {
    threads: Mutex<BTreeMap<String, IndexedThreadMetadata>>,
}

impl HostThreadIndex for MemoryThreadIndex {
    fn put_thread_metadata(&self, metadata: &IndexedThreadMetadata) -> Result<(), StoreError> {
        self.put_thread_metadata_batch(std::slice::from_ref(metadata))
    }

    fn put_thread_metadata_batch(
        &self,
        metadata: &[IndexedThreadMetadata],
    ) -> Result<(), StoreError> {
        let mut threads = self.threads.lock().unwrap_or_else(PoisonError::into_inner);
        for value in metadata {
            threads.insert(value.id.clone(), value.clone());
        }
        Ok(())
    }

    fn thread_descendants(
        &self,
        root_thread_id: &str,
    ) -> Result<Vec<IndexedThreadMetadata>, StoreError> {
        let threads = self.threads.lock().unwrap_or_else(PoisonError::into_inner);
        let mut pending = vec![root_thread_id.to_owned()];
        let mut seen = HashSet::new();
        let mut descendants = Vec::new();
        while let Some(parent) = pending.pop() {
            let children = threads
                .values()
                .filter(|thread| thread.parent_thread_id.as_deref() == Some(parent.as_str()))
                .filter(|thread| seen.insert(thread.id.clone()))
                .cloned()
                .collect::<Vec<_>>();
            for child in children.into_iter().rev() {
                pending.push(child.id.clone());
                descendants.push(child);
            }
        }
        Ok(descendants)
    }

    fn thread_pin_snapshot(&self) -> Result<ThreadPinSnapshot, StoreError> {
        Ok(ThreadPinSnapshot {
            cursor: 0,
            thread_ids: Vec::new(),
        })
    }
}
