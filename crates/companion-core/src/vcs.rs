use std::path::{Path, PathBuf};

mod bundled;
mod plugin;
mod registry;
mod remotes;
#[cfg(test)]
mod scope_tests;

pub use bundled::BUILT_IN_PRIORITY;
pub use companion_host::vcs::{
    CHANGES_CAPABILITY, DIFF_CAPABILITY, DIFF_PAGE_CAPABILITY, INSPECT_CAPABILITY,
    REMOTES_CAPABILITY, UpstreamRef, VcsDiff, VcsDiffPage, VcsError, VcsFile, VcsFileStatus,
    VcsRemote, VcsRemotes, VcsRepository, VcsScope, VcsSnapshot, VcsState, VcsSummary,
    WORKSPACE_CREATE_CAPABILITY, WorkspaceCreateResult, WorkspaceSupport,
};
pub use registry::{BundledProvider, PluginRegistry, VcsPluginConfig, VcsProviderEntry};
pub use remotes::OrderedRemotes;

#[derive(Clone, Debug)]
pub struct VcsService {
    registry: PluginRegistry,
}

#[async_trait::async_trait]
impl companion_host::vcs::WorkspaceVcs for VcsService {
    async fn changes(&self, workspace: &Path, scope: VcsScope) -> Result<VcsSnapshot, VcsError> {
        Self::changes(self, workspace, scope).await
    }

    async fn diff(
        &self,
        workspace: &Path,
        path: &Path,
        scope: VcsScope,
    ) -> Result<VcsDiff, VcsError> {
        Self::diff(self, workspace, path, scope).await
    }

    async fn diff_page(
        &self,
        workspace: &Path,
        path: &Path,
        scope: VcsScope,
        offset: usize,
        limit: usize,
    ) -> Result<VcsDiffPage, VcsError> {
        Self::diff_page(self, workspace, path, scope, offset, limit).await
    }
}

impl VcsService {
    /// A VCS service over the registry file and the host's bundled plugin
    /// directory, against which built-in providers resolve at each spawn.
    #[must_use]
    pub fn new(registry_path: PathBuf, bundled_plugin_directory: Option<PathBuf>) -> Self {
        Self {
            registry: PluginRegistry::new(registry_path, bundled_plugin_directory),
        }
    }

    #[must_use]
    pub fn registry(&self) -> &PluginRegistry {
        &self.registry
    }

    /// Resolves the first provider that explicitly owns the workspace.
    ///
    /// Providers run in configured priority order and inspect the workspace
    /// before any changes are requested. A provider may decline with the
    /// contract's `workspace_not_owned` error. Once it claims ownership, its
    /// operation errors are terminal.
    ///
    /// # Errors
    ///
    /// Returns an error when the workspace is invalid or unsupported, the
    /// selected provider fails, or the plugin registry is unreadable.
    pub async fn changes(
        &self,
        workspace: &Path,
        scope: VcsScope,
    ) -> Result<VcsSnapshot, VcsError> {
        validate_workspace(workspace)?;
        let plugin = self.owning_plugin(workspace, scope).await?;
        plugin::changes(&plugin, workspace, scope)
            .await
            .map_err(|error| VcsError::Plugin(format!("{}: {error}", plugin.id)))
    }

    /// Reads one file diff from the same provider that owns the workspace.
    ///
    /// Provider ownership is resolved through inspection first. This keeps
    /// capability fallback honest: a provider that owns a workspace but fails
    /// to produce its diff may not be hidden by another provider.
    ///
    /// # Errors
    ///
    /// Returns an error when the workspace or path is invalid, no provider
    /// owns the workspace, the file is no longer changed, or the selected
    /// provider fails.
    pub async fn diff(
        &self,
        workspace: &Path,
        path: &Path,
        scope: VcsScope,
    ) -> Result<VcsDiff, VcsError> {
        validate_workspace(workspace)?;
        if !path.is_absolute() {
            return Err(VcsError::InvalidWorkspace(path.to_path_buf()));
        }
        let plugin = self.owning_plugin(workspace, scope).await?;
        let snapshot = plugin::changes(&plugin, workspace, scope)
            .await
            .map_err(|error| VcsError::Plugin(format!("{}: {error}", plugin.id)))?;
        let file = find_snapshot_file(&snapshot, path)
            .ok_or_else(|| VcsError::FileNotChanged(path.to_path_buf()))?;
        plugin::diff(&plugin, workspace, file, &snapshot.snapshot_id, scope)
            .await
            .map_err(|error| VcsError::Plugin(format!("{}: {error}", plugin.id)))
    }

    /// Reads one bounded page of a file diff without materializing the whole diff.
    ///
    /// Provider ownership and the current snapshot are resolved before every page.
    /// Callers must compare the returned revision across pages and reject a stale
    /// continuation if the working tree changed between requests.
    ///
    /// # Errors
    ///
    /// Returns an error when the workspace/path is invalid, no provider owns the
    /// workspace, or the owning provider lacks the paged-diff capability.
    pub async fn diff_page(
        &self,
        workspace: &Path,
        path: &Path,
        scope: VcsScope,
        offset: usize,
        limit: usize,
    ) -> Result<VcsDiffPage, VcsError> {
        validate_workspace(workspace)?;
        if !path.is_absolute() {
            return Err(VcsError::InvalidWorkspace(path.to_path_buf()));
        }
        let provider = self.owning_plugin(workspace, scope).await?;
        let snapshot = plugin::changes(&provider, workspace, scope)
            .await
            .map_err(|error| VcsError::Plugin(format!("{}: {error}", provider.id)))?;
        let file = find_snapshot_file(&snapshot, path)
            .ok_or_else(|| VcsError::FileNotChanged(path.to_path_buf()))?;
        plugin::diff_page(
            &provider,
            workspace,
            file,
            &snapshot.snapshot_id,
            scope,
            offset,
            limit,
        )
        .await
        .map_err(|error| VcsError::Plugin(format!("{}: {error}", provider.id)))
    }

    /// Resolves the provider that can create an isolated workspace for this
    /// repository. Providers without the optional capability are skipped.
    ///
    /// # Errors
    ///
    /// Returns an error when the workspace is invalid, the registry cannot be
    /// read, or a capable provider fails while inspecting an owned workspace.
    pub async fn workspace_support(
        &self,
        workspace: &Path,
    ) -> Result<Option<WorkspaceSupport>, VcsError> {
        validate_workspace(workspace)?;
        validate_existing_workspace(workspace)?;
        let mut start_error = None;
        for plugin in self.registry.enabled_plugins()? {
            match plugin::workspace_support(&plugin, workspace).await {
                Ok(support) => return Ok(Some(support)),
                Err(
                    plugin::PluginCallError::WorkspaceNotOwned
                    | plugin::PluginCallError::CapabilityUnsupported,
                ) => {}
                Err(error @ plugin::PluginCallError::Start(_)) => {
                    start_error
                        .get_or_insert_with(|| VcsError::Plugin(format!("{}: {error}", plugin.id)));
                }
                Err(error) => {
                    return Err(VcsError::Plugin(format!("{}: {error}", plugin.id)));
                }
            }
        }
        if let Some(error) = start_error {
            return Err(error);
        }
        Ok(None)
    }

    /// Creates an isolated workspace through the same provider that claims
    /// the selected repository and advertises `workspace.create@1`.
    ///
    /// # Errors
    ///
    /// Returns an error for invalid input, unsupported repositories, or a
    /// provider failure. Errors after a provider claims ownership are terminal.
    pub async fn create_workspace(
        &self,
        workspace: &Path,
        request_id: &str,
        storage_root: &Path,
    ) -> Result<WorkspaceCreateResult, VcsError> {
        let (progress, mut updates) = tokio::sync::mpsc::unbounded_channel();
        let creation =
            self.create_workspace_with_progress(workspace, request_id, storage_root, progress);
        tokio::pin!(creation);
        loop {
            tokio::select! {
                result = &mut creation => return result,
                update = updates.recv() => {
                    if update.is_none() {
                        return creation.await;
                    }
                }
            }
        }
    }

    /// Creates an isolated workspace and forwards provider lifecycle progress.
    ///
    /// # Errors
    ///
    /// Returns the same errors as [`Self::create_workspace`].
    pub async fn create_workspace_with_progress(
        &self,
        workspace: &Path,
        request_id: &str,
        storage_root: &Path,
        progress: tokio::sync::mpsc::UnboundedSender<WorkspaceCreateResult>,
    ) -> Result<WorkspaceCreateResult, VcsError> {
        validate_workspace(workspace)?;
        validate_workspace(storage_root)?;
        validate_workspace_request_id(request_id)?;
        validate_existing_workspace(workspace)?;
        let mut start_error = None;
        for plugin in self.registry.enabled_plugins()? {
            match plugin::workspace_support(&plugin, workspace).await {
                Ok(_) => {
                    return plugin::workspace_create(
                        &plugin,
                        workspace,
                        request_id,
                        storage_root,
                        progress,
                    )
                    .await
                    .map_err(|error| VcsError::Plugin(format!("{}: {error}", plugin.id)));
                }
                Err(
                    plugin::PluginCallError::WorkspaceNotOwned
                    | plugin::PluginCallError::CapabilityUnsupported,
                ) => {}
                Err(error @ plugin::PluginCallError::Start(_)) => {
                    start_error
                        .get_or_insert_with(|| VcsError::Plugin(format!("{}: {error}", plugin.id)));
                }
                Err(error) => {
                    return Err(VcsError::Plugin(format!("{}: {error}", plugin.id)));
                }
            }
        }
        Err(start_error.unwrap_or_else(|| VcsError::UnsupportedWorkspace(workspace.to_path_buf())))
    }

    async fn owning_plugin(
        &self,
        workspace: &Path,
        scope: VcsScope,
    ) -> Result<VcsPluginConfig, VcsError> {
        validate_existing_workspace(workspace)?;
        let mut start_error = None;
        for candidate in self.registry.enabled_plugins()? {
            match plugin::inspect(&candidate, workspace, scope).await {
                Ok(()) => return Ok(candidate),
                Err(plugin::PluginCallError::WorkspaceNotOwned) => {}
                Err(error @ plugin::PluginCallError::Start(_)) => {
                    start_error.get_or_insert_with(|| {
                        VcsError::Plugin(format!("{}: {error}", candidate.id))
                    });
                }
                Err(error) => {
                    return Err(VcsError::Plugin(format!("{}: {error}", candidate.id)));
                }
            }
        }
        Err(start_error.unwrap_or_else(|| VcsError::UnsupportedWorkspace(workspace.to_path_buf())))
    }
}

fn find_snapshot_file<'a>(snapshot: &'a VcsSnapshot, path: &Path) -> Option<&'a VcsFile> {
    if let Some(file) = snapshot.files.iter().find(|file| file.path == path) {
        return Some(file);
    }
    let canonical = path.canonicalize().ok()?;
    snapshot.files.iter().find(|file| {
        file.path
            .canonicalize()
            .is_ok_and(|candidate| candidate == canonical)
    })
}

fn validate_workspace(workspace: &Path) -> Result<(), VcsError> {
    if workspace.is_absolute() {
        Ok(())
    } else {
        Err(VcsError::InvalidWorkspace(workspace.to_path_buf()))
    }
}

fn validate_existing_workspace(workspace: &Path) -> Result<(), VcsError> {
    match std::fs::metadata(workspace) {
        Ok(metadata) if metadata.is_dir() => Ok(()),
        Ok(_) => Err(VcsError::UnsupportedWorkspace(workspace.to_path_buf())),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            Err(VcsError::UnsupportedWorkspace(workspace.to_path_buf()))
        }
        Err(error) => Err(VcsError::Command(format!(
            "could not inspect workspace {}: {error}",
            workspace.display()
        ))),
    }
}

fn validate_workspace_request_id(request_id: &str) -> Result<(), VcsError> {
    let valid = !request_id.is_empty()
        && request_id.len() <= 128
        && request_id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'));
    if valid {
        Ok(())
    } else {
        Err(VcsError::Command("invalid workspace request id".into()))
    }
}

#[cfg(test)]
#[allow(clippy::expect_used)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn service_preserves_explicit_unsupported_workspace_fallback() {
        let directory = tempfile::tempdir().expect("temp directory");
        let service = VcsService::new(directory.path().join("plugins.json"), None);
        assert!(matches!(
            service.changes(directory.path(), VcsScope::Unstaged).await,
            Err(VcsError::UnsupportedWorkspace(path)) if path == directory.path()
        ));
    }
}
