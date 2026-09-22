//! Persistent full-text search, independent of the bounded history-window index.
//! Queries never open rollouts. A single background writer commits bounded batches
//! while readers use WAL snapshots; an incomplete index is visible to clients.

mod catalog;
mod context;
mod index;
mod query;
#[cfg(test)]
mod tests;
mod window;
mod worker;

use crate::catalog::SessionCatalog;
pub use context::{ContextPage, ContextQuery};
pub use query::{SearchHit, SearchPage, SearchQuery};
use rusqlite::{Connection, OpenFlags};
use std::{
    path::{Path, PathBuf},
    sync::{
        Arc,
        atomic::{AtomicBool, AtomicUsize, Ordering},
    },
};

#[derive(Debug, thiserror::Error)]
pub enum SearchError {
    #[error("Search catalog is unavailable: {0}")]
    Catalog(#[from] crate::catalog::CatalogError),
    #[error("Search index is unavailable: {0}")]
    Database(#[from] rusqlite::Error),
    #[error("Search source is unavailable: {0}")]
    Io(#[from] std::io::Error),
    #[error("Search source is invalid: {0}")]
    Json(#[from] serde_json::Error),
    #[error("Invalid search query or date range")]
    InvalidQuery,
    #[error("Search history is unavailable: {0}")]
    History(#[from] crate::history::HistoryError),
    #[error("Search worker is unavailable")]
    Worker,
}

/// Owns query access and background indexing; cloning does not copy indexed data.
#[derive(Clone)]
pub struct MessageSearch {
    catalog: Arc<SessionCatalog>,
    path: Arc<PathBuf>,
    indexing: Arc<AtomicBool>,
    failed: Arc<AtomicUsize>,
}

impl MessageSearch {
    /// Loads canonical summary turns at an indexed message, without replaying
    /// history into the live projection or waiting for the reverse index.
    ///
    /// # Errors
    /// Rejects stale source identities and unavailable indexed positions.
    pub async fn window(&self, query: ContextQuery) -> Result<serde_json::Value, SearchError> {
        let path = Arc::clone(&self.path);
        let catalog = Arc::clone(&self.catalog);
        tokio::task::spawn_blocking(move || {
            if catalog.visibility.excluded(&query.thread_id)? {
                return Err(SearchError::InvalidQuery);
            }
            let mut db =
                Connection::open_with_flags(path.as_path(), OpenFlags::SQLITE_OPEN_READ_ONLY)?;
            db.busy_timeout(std::time::Duration::from_millis(100))?;
            let transaction = db.transaction()?;
            window::read(&transaction, &query)
        })
        .await
        .map_err(|_| SearchError::Worker)?
    }
    /// Reads the indexed text around a search hit without replacing a live chat projection.
    ///
    /// # Errors
    /// Returns an error for expired hits, unavailable storage or invalid input.
    pub async fn context(&self, query: ContextQuery) -> Result<ContextPage, SearchError> {
        let path = Arc::clone(&self.path);
        let catalog = Arc::clone(&self.catalog);
        tokio::task::spawn_blocking(move || {
            if catalog.visibility.excluded(&query.thread_id)? {
                return Err(SearchError::InvalidQuery);
            }
            let mut db =
                Connection::open_with_flags(path.as_path(), OpenFlags::SQLITE_OPEN_READ_ONLY)?;
            db.busy_timeout(std::time::Duration::from_millis(100))?;
            let transaction = db.transaction()?;
            context::read(&transaction, &query)
        })
        .await
        .map_err(|_| SearchError::Worker)?
    }
    /// Starts background indexing without putting rollout reads on the request path.
    ///
    /// # Errors
    /// Returns an error if the persistent index cannot be opened or initialized.
    pub fn start(path: &Path, catalog: Arc<SessionCatalog>) -> Result<Self, SearchError> {
        let db = Connection::open(path)?;
        db.execute_batch(include_str!("schema.sql"))?;
        let service = Self {
            catalog: Arc::clone(&catalog),
            path: Arc::new(path.to_path_buf()),
            indexing: Arc::new(AtomicBool::new(true)),
            failed: Arc::new(AtomicUsize::new(0)),
        };
        worker::spawn(
            db,
            catalog,
            Arc::downgrade(&service.indexing),
            Arc::clone(&service.failed),
        );
        Ok(service)
    }

    /// Reads a bounded result page from `SQLite`, never from canonical history files.
    ///
    /// # Errors
    /// Returns validation, database or worker errors without presenting an empty success.
    pub async fn search(&self, query: SearchQuery) -> Result<SearchPage, SearchError> {
        let service = self.clone();
        tokio::task::spawn_blocking(move || {
            let db = Connection::open_with_flags(
                service.path.as_path(),
                OpenFlags::SQLITE_OPEN_READ_ONLY,
            )?;
            db.busy_timeout(std::time::Duration::from_millis(100))?;
            let mut page = query::read(&db, &query)?;
            let mut visible = Vec::with_capacity(page.data.len());
            for hit in page.data {
                if !service.catalog.visibility.excluded(&hit.thread_id)? {
                    visible.push(hit);
                }
            }
            page.data = visible;
            page.indexing = service.indexing.load(Ordering::Acquire);
            page.failed_sources = service.failed.load(Ordering::Acquire);
            Ok(page)
        })
        .await
        .map_err(|_| SearchError::Worker)?
    }
}
