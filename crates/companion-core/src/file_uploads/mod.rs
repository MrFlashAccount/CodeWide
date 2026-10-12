//! Durable upload ownership, cancellation and quotas for the Companion file API.

pub(crate) mod http;
mod owner;
mod response;
mod staging;

pub use staging::{WorkspaceUploadError, WorkspaceUploadStore};

use crate::{auth::DeviceRegistry, files::FileService};
use std::{path::Path, sync::Arc};

/// The Companion file API. Device-authorized uploads require owner-bound staging, so a
/// file service cannot be exposed without it; every host composes it through this type.
#[derive(Clone)]
pub struct FileTransfer {
    files: Arc<FileService>,
    uploads: WorkspaceUploadStore,
}

impl FileTransfer {
    /// Opens durable upload staging for paired devices, collects abandoned uploads and
    /// purges a device's uploads as soon as its authorization changes.
    ///
    /// # Errors
    /// Returns a storage error when the staging database cannot be opened.
    pub fn for_devices(
        files: Arc<FileService>,
        staging_database: impl AsRef<Path>,
        registry: &DeviceRegistry,
    ) -> Result<Self, WorkspaceUploadError> {
        let transfer = Self::open(files, staging_database)?;
        transfer
            .uploads
            .start_revocation_cleanup(registry.subscribe_authorization_changes());
        Ok(transfer)
    }

    /// Opens upload staging for an administrator-token router without paired devices.
    ///
    /// # Errors
    /// Returns a storage error when the staging database cannot be opened.
    pub fn without_devices(
        files: Arc<FileService>,
        staging_database: impl AsRef<Path>,
    ) -> Result<Self, WorkspaceUploadError> {
        Self::open(files, staging_database)
    }

    fn open(
        files: Arc<FileService>,
        staging_database: impl AsRef<Path>,
    ) -> Result<Self, WorkspaceUploadError> {
        let uploads = WorkspaceUploadStore::open(staging_database, files.clone())?;
        uploads.start_periodic_gc();
        Ok(Self { files, uploads })
    }

    pub(crate) fn files(&self) -> &Arc<FileService> {
        &self.files
    }

    pub(crate) fn uploads(&self) -> &WorkspaceUploadStore {
        &self.uploads
    }
}
