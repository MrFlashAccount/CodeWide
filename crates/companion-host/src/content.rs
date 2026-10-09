//! Canonical content a provider can prove from its own durable sources.
//!
//! The companion's private content service asks the source before it falls
//! back to companion-owned bytes, and skips persisting a copy of content the
//! source proves.

use std::sync::Arc;

use async_trait::async_trait;

use crate::index::StoreError;

/// Bytes whose digest a canonical source re-verified on read.
pub struct CanonicalContent {
    pub bytes: Arc<[u8]>,
    pub content_type: String,
}

#[async_trait]
pub trait CanonicalContentSource: Send + Sync {
    /// Loads the content with the hex SHA-256 `digest`; `None` when no source
    /// record proves it.
    ///
    /// # Errors
    ///
    /// Returns an error when the source index cannot be read.
    async fn load(&self, digest: &str) -> Result<Option<CanonicalContent>, StoreError>;
}
