//! The narrow file-preview contract the companion's `FileService` offers to
//! provider adapters that project thread attachments.

use std::path::PathBuf;

use async_trait::async_trait;

#[async_trait]
pub trait PreviewFiles: Send + Sync {
    /// Records host paths a thread referenced so previews of them resolve.
    async fn observe_preview_paths(&self, paths: Vec<PathBuf>);

    /// Records changed paths that lie inside the repository `root`.
    async fn observe_preview_paths_within(&self, root: PathBuf, paths: Vec<PathBuf>);

    /// Tombstones the managed attachments of a deleted thread.
    ///
    /// # Errors
    ///
    /// Returns the file service error when the tombstone cannot be written.
    async fn mark_thread_attachments_deleted(
        &self,
        thread_id: &str,
    ) -> Result<(), Box<dyn std::error::Error + Send + Sync>>;
}
