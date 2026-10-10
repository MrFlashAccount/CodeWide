//! The stored-message full-text search index shared by provider adapters:
//! one `SQLite` FTS5 schema (`SCHEMA`), the bounded query (`query`), the
//! neighbor read around a hit (`context`) and the neutral document writer
//! (`documents`). Each adapter owns its own database file, its indexing of
//! its own sources and the canonical window around a hit; the format and the
//! read semantics of `companion/search` and `companion/search/context` are
//! the same for every provider.

pub mod context;
pub mod documents;
pub mod query;

pub use context::{ContextMessage, ContextPage, ContextQuery};
pub use query::{SearchHit, SearchPage, SearchQuery};

/// The index schema; executing it is idempotent.
pub const SCHEMA: &str = include_str!("schema.sql");

/// A failed read of the index.
#[derive(Debug, thiserror::Error)]
pub enum SearchReadError {
    #[error(transparent)]
    Database(#[from] rusqlite::Error),
    #[error("Invalid search query or date range")]
    InvalidQuery,
}
