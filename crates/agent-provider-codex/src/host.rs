//! Codex storage services the companion host wires in at startup: the
//! catalog metadata warmup and thread metadata lookup for threads the host
//! index does not know yet.

use std::sync::Arc;

use companion_host::thread_index::{HostThreadIndex, IndexedThreadMetadata, ThreadMetadataSource};

use crate::{
    catalog::{CatalogError, SessionCatalog},
    rollout::read_rollout_metadata,
};

/// Resolves a thread's metadata from its rollout header.
pub struct RolloutThreadMetadata {
    catalog: Arc<SessionCatalog>,
}

impl RolloutThreadMetadata {
    #[must_use]
    pub fn new(catalog: Arc<SessionCatalog>) -> Self {
        Self { catalog }
    }
}

impl ThreadMetadataSource for RolloutThreadMetadata {
    fn thread_metadata(&self, thread_id: &str) -> Result<Option<IndexedThreadMetadata>, String> {
        let rollout = match self.catalog.resolve(thread_id) {
            Ok(rollout) => rollout,
            Err(CatalogError::NotFound(_)) => return Ok(None),
            Err(error @ (CatalogError::Poisoned | CatalogError::Authority(_))) => {
                return Err(error.to_string());
            }
        };
        Ok(read_rollout_metadata(&rollout)
            .map_err(|error| error.to_string())?
            .filter(|metadata| metadata.id == thread_id))
    }
}

/// Refreshes the catalog and indexes every rollout header's metadata in the
/// background.
pub fn spawn_catalog_warmup(catalog: Arc<SessionCatalog>, threads: Arc<dyn HostThreadIndex>) {
    tokio::spawn(async move {
        let result = tokio::task::spawn_blocking(move || {
            let catalog_threads = catalog.refresh()?;
            let mut metadata = Vec::new();
            let mut failures = 0_usize;
            for path in catalog.rollout_paths() {
                match read_rollout_metadata(&path) {
                    Ok(Some(value)) => metadata.push(value),
                    Ok(None) => {}
                    Err(_) => failures += 1,
                }
            }
            let indexed = metadata.len();
            if threads.put_thread_metadata_batch(&metadata).is_err() {
                failures = failures.saturating_add(indexed);
                return Ok::<_, CatalogError>((catalog_threads, 0, failures));
            }
            Ok((catalog_threads, indexed, failures))
        })
        .await;
        match result {
            Ok(Ok((catalog_threads, indexed_metadata, metadata_failures))) => {
                tracing::info!(threads = catalog_threads, "catalog warmup is ready");
                tracing::info!(threads = indexed_metadata, "metadata warmup is ready");
                if metadata_failures > 0 {
                    tracing::warn!(
                        failures = metadata_failures,
                        "some thread metadata headers could not be indexed"
                    );
                }
            }
            Ok(Err(error)) => tracing::warn!(err = ?error, "catalog warmup failed"),
            Err(error) => tracing::warn!(err = ?error, "catalog warmup task failed"),
        }
    });
}
