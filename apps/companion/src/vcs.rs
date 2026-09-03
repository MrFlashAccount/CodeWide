use std::{
    collections::BTreeMap,
    path::{Path, PathBuf},
    process::Stdio,
};

use serde::{Deserialize, Serialize};
use tokio::{io::AsyncReadExt, process::Command};

mod plugin;

pub use plugin::{PluginRegistry, VcsPluginConfig};

pub const CHANGES_CAPABILITY: &str = "vcs.changes@2";
pub const DIFF_CAPABILITY: &str = "vcs.diff@2";
pub const DIFF_PAGE_CAPABILITY: &str = "vcs.diffPage@1";
pub const WORKSPACE_CREATE_CAPABILITY: &str = "workspace.create@1";
const MAX_DIFF_BYTES: usize = 4 * 1024 * 1024;

#[derive(Debug, thiserror::Error)]
pub enum VcsError {
    #[error("workspace path must be absolute: {0}")]
    InvalidWorkspace(PathBuf),
    #[error("VCS command failed: {0}")]
    Command(String),
    #[error("VCS output is not valid UTF-8")]
    InvalidUtf8,
    #[error("workspace is not owned by a configured VCS provider: {0}")]
    UnsupportedWorkspace(PathBuf),
    #[error("file is not part of the current VCS snapshot: {0}")]
    FileNotChanged(PathBuf),
    #[error("VCS change scope {scope:?} is not supported for workspace: {workspace}")]
    UnsupportedScope { workspace: PathBuf, scope: VcsScope },
    #[error("VCS plugin failed: {0}")]
    Plugin(String),
    #[error("VCS plugin registry failed: {0}")]
    Registry(String),
}

#[derive(Clone, Debug)]
pub struct VcsService {
    registry: PluginRegistry,
}

impl VcsService {
    #[must_use]
    pub fn new(registry_path: PathBuf) -> Self {
        Self {
            registry: PluginRegistry::new(registry_path),
        }
    }

    #[must_use]
    pub fn registry(&self) -> &PluginRegistry {
        &self.registry
    }

    /// Resolves the first provider that explicitly owns the workspace.
    ///
    /// Providers run in configured priority order. A provider may decline a
    /// workspace with the contract's `workspace_not_owned` error; every other
    /// provider error is terminal so a failing owner cannot be silently hidden
    /// by another provider.
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
        for plugin in self.registry.enabled_plugins()? {
            match plugin::changes(&plugin, workspace, scope).await {
                Ok(snapshot) => return Ok(snapshot),
                Err(plugin::PluginCallError::WorkspaceNotOwned) => {}
                Err(error) => {
                    return Err(VcsError::Plugin(format!("{}: {error}", plugin.id)));
                }
            }
        }
        Err(VcsError::UnsupportedWorkspace(workspace.to_path_buf()))
    }

    /// Reads one file diff from the same provider that owns the workspace.
    ///
    /// Provider ownership is resolved through `vcs.changes` first. This keeps
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
        for plugin in self.registry.enabled_plugins()? {
            let snapshot = match plugin::changes(&plugin, workspace, scope).await {
                Ok(snapshot) => snapshot,
                Err(plugin::PluginCallError::WorkspaceNotOwned) => continue,
                Err(error) => {
                    return Err(VcsError::Plugin(format!("{}: {error}", plugin.id)));
                }
            };
            let file = find_snapshot_file(&snapshot, path)
                .ok_or_else(|| VcsError::FileNotChanged(path.to_path_buf()))?;
            return plugin::diff(&plugin, workspace, file, &snapshot.snapshot_id, scope)
                .await
                .map_err(|error| VcsError::Plugin(format!("{}: {error}", plugin.id)));
        }
        Err(VcsError::UnsupportedWorkspace(workspace.to_path_buf()))
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
        for provider in self.registry.enabled_plugins()? {
            let snapshot = match plugin::changes(&provider, workspace, scope).await {
                Ok(snapshot) => snapshot,
                Err(plugin::PluginCallError::WorkspaceNotOwned) => continue,
                Err(error) => return Err(VcsError::Plugin(format!("{}: {error}", provider.id))),
            };
            let file = find_snapshot_file(&snapshot, path)
                .ok_or_else(|| VcsError::FileNotChanged(path.to_path_buf()))?;
            return plugin::diff_page(
                &provider,
                workspace,
                file,
                &snapshot.snapshot_id,
                scope,
                offset,
                limit,
            )
            .await
            .map_err(|error| VcsError::Plugin(format!("{}: {error}", provider.id)));
        }
        Err(VcsError::UnsupportedWorkspace(workspace.to_path_buf()))
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
        for plugin in self.registry.enabled_plugins()? {
            match plugin::workspace_support(&plugin, workspace).await {
                Ok(support) => return Ok(Some(support)),
                Err(
                    plugin::PluginCallError::WorkspaceNotOwned
                    | plugin::PluginCallError::CapabilityUnsupported,
                ) => {}
                Err(error) => {
                    return Err(VcsError::Plugin(format!("{}: {error}", plugin.id)));
                }
            }
        }
        Ok(None)
    }

    /// Creates an isolated workspace through the same provider that claims
    /// the selected repository and advertises `workspace.create@1`.
    ///
    /// # Errors
    ///
    /// Returns an error for invalid input, unsupported repositories, or a
    /// provider failure. Provider failures are never hidden by fallback.
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
                Err(error) => {
                    return Err(VcsError::Plugin(format!("{}: {error}", plugin.id)));
                }
            }
        }
        Err(VcsError::UnsupportedWorkspace(workspace.to_path_buf()))
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

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VcsRepository {
    pub provider: String,
    pub root: PathBuf,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub branch: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub head: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub base: Option<String>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceSupport {
    pub capability: String,
    pub provider: String,
    pub display_name: String,
    pub repository_root: PathBuf,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceCreateResult {
    pub capability: String,
    pub provider: String,
    pub repository_root: PathBuf,
    pub cwd: PathBuf,
    pub created: bool,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum VcsState {
    Clean,
    Dirty,
    Conflicted,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum VcsScope {
    Staged,
    Unstaged,
    Branch,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum VcsFileStatus {
    Added,
    Modified,
    Deleted,
    Renamed,
    Untracked,
    Conflicted,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VcsFile {
    pub id: String,
    pub path: PathBuf,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub old_path: Option<PathBuf>,
    pub status: VcsFileStatus,
    pub staged: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub additions: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub deletions: Option<u64>,
    pub binary: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub conflict: Option<String>,
}

#[derive(Clone, Debug, Default, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VcsSummary {
    pub total: usize,
    pub added: usize,
    pub modified: usize,
    pub deleted: usize,
    pub renamed: usize,
    pub untracked: usize,
    pub conflicted: usize,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VcsSnapshot {
    pub capability: String,
    pub repository: VcsRepository,
    pub scope: VcsScope,
    pub available_scopes: Vec<VcsScope>,
    pub snapshot_id: String,
    pub state: VcsState,
    pub summary: VcsSummary,
    pub files: Vec<VcsFile>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VcsDiff {
    pub capability: String,
    pub repository: VcsRepository,
    pub scope: VcsScope,
    pub snapshot_id: String,
    pub file_id: String,
    pub path: PathBuf,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub old_path: Option<PathBuf>,
    pub status: VcsFileStatus,
    pub diff: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source: Option<String>,
    pub truncated: bool,
    pub binary: bool,
    pub additions: u64,
    pub deletions: u64,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VcsDiffPage {
    pub capability: String,
    pub provider: String,
    pub scope: VcsScope,
    pub snapshot_id: String,
    pub file_id: String,
    pub path: PathBuf,
    pub content: String,
    pub revision: String,
    pub total_bytes: usize,
    pub next_offset: usize,
}

#[derive(Clone, Debug, Default)]
pub struct GitProvider;

impl GitProvider {
    #[must_use]
    pub fn id(&self) -> &'static str {
        "git"
    }

    /// Resolves a workspace to its Git root without changing process-global cwd.
    ///
    /// # Errors
    ///
    /// Returns an error when the workspace is relative, Git cannot be started,
    /// or Git returns non-UTF-8 repository metadata.
    pub async fn detect(&self, workspace: &Path) -> Result<Option<PathBuf>, VcsError> {
        validate_workspace(workspace)?;
        let output = git_output(workspace, &["rev-parse", "--show-toplevel"]).await?;
        if !output.status.success() {
            return Ok(None);
        }
        let root = String::from_utf8(output.stdout)
            .map_err(|_| VcsError::InvalidUtf8)?
            .trim()
            .to_owned();
        if root.is_empty() {
            return Ok(None);
        }
        Ok(Some(PathBuf::from(root)))
    }

    /// Reads the current uncommitted Git snapshot.
    ///
    /// # Errors
    ///
    /// Returns an error when the workspace is not a Git repository or Git
    /// status cannot be parsed.
    pub async fn changes(
        &self,
        workspace: &Path,
        scope: VcsScope,
    ) -> Result<VcsSnapshot, VcsError> {
        let root = self
            .detect(workspace)
            .await?
            .ok_or_else(|| VcsError::UnsupportedWorkspace(workspace.to_path_buf()))?;
        if scope == VcsScope::Branch {
            return git_branch_snapshot(&root).await;
        }
        let output = git_output(
            &root,
            &[
                "status",
                "--porcelain=v2",
                "--branch",
                "-z",
                "--untracked-files=all",
            ],
        )
        .await?;
        if !output.status.success() {
            return Err(command_failure("git status", &output.stderr));
        }
        let mut snapshot = parse_git_status(&root, &output.stdout, scope)?;
        populate_git_diff_stats(&root, scope, None, &mut snapshot.files).await?;
        snapshot.snapshot_id = snapshot_id(
            &root,
            snapshot.repository.branch.as_deref(),
            snapshot.repository.head.as_deref(),
            None,
            scope,
            &snapshot.files,
        )?;
        Ok(snapshot)
    }

    /// Reads a file diff from a previously resolved Git snapshot.
    ///
    /// # Errors
    ///
    /// Returns an error when the file is outside the repository, Git cannot
    /// produce the requested scope, or the file content cannot be read.
    pub async fn diff(&self, snapshot: &VcsSnapshot, file: &VcsFile) -> Result<VcsDiff, VcsError> {
        let root = &snapshot.repository.root;
        let relative = file
            .path
            .strip_prefix(root)
            .map_err(|_| VcsError::FileNotChanged(file.path.clone()))?;
        let raw = if file.status == VcsFileStatus::Untracked {
            synthetic_added_diff(root, relative).await?
        } else {
            let mut command = Command::new("git");
            command
                .arg("-C")
                .arg(root)
                .args(["diff", "--no-ext-diff", "--no-color"]);
            match snapshot.scope {
                VcsScope::Staged => {
                    command.arg("--cached");
                }
                VcsScope::Unstaged => {}
                VcsScope::Branch => {
                    let base = snapshot.repository.base.as_deref().ok_or_else(|| {
                        VcsError::Command(
                            "Git branch snapshot does not contain a merge base".into(),
                        )
                    })?;
                    command.args([base, "HEAD"]);
                }
            }
            command.arg("--");
            if let Some(old_path) = file.old_path.as_deref() {
                command.arg(old_path.strip_prefix(root).unwrap_or(old_path));
            }
            let output = command
                .arg(relative)
                .stdin(Stdio::null())
                .stdout(Stdio::piped())
                .stderr(Stdio::piped())
                .output()
                .await
                .map_err(|error| VcsError::Command(format!("could not start git diff: {error}")))?;
            if !output.status.success() {
                return Err(command_failure("git diff", &output.stderr));
            }
            bounded_diff(output.stdout)
        };
        let source = git_scoped_source(root, relative, snapshot.scope, file.status).await?;
        let binary = is_binary_diff(&raw.text);
        let (additions, deletions) = count_diff_stats(&raw.text);
        Ok(VcsDiff {
            capability: DIFF_CAPABILITY.to_owned(),
            repository: snapshot.repository.clone(),
            scope: snapshot.scope,
            snapshot_id: snapshot.snapshot_id.clone(),
            file_id: file.id.clone(),
            path: file.path.clone(),
            old_path: file.old_path.clone(),
            status: file.status,
            diff: raw.text,
            source,
            truncated: raw.truncated,
            binary,
            additions,
            deletions,
        })
    }

    /// Streams the selected Git diff into a bounded page while hashing the
    /// complete output for continuation consistency.
    ///
    /// # Errors
    ///
    /// Returns an error for a stale path, invalid byte offset, non-UTF-8 Git
    /// output, or a failed Git command.
    pub async fn diff_page(
        &self,
        snapshot: &VcsSnapshot,
        file: &VcsFile,
        offset: usize,
        limit: usize,
    ) -> Result<VcsDiffPage, VcsError> {
        if limit == 0 || limit > 1024 * 1024 {
            return Err(VcsError::Command("invalid paged diff limit".into()));
        }
        let mut command = git_diff_command(snapshot, file)?;
        let mut child = command
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|error| VcsError::Command(format!("could not start git diff: {error}")))?;
        let mut stdout = child
            .stdout
            .take()
            .ok_or_else(|| VcsError::Command("git diff omitted stdout".into()))?;
        let stderr = child
            .stderr
            .take()
            .ok_or_else(|| VcsError::Command("git diff omitted stderr".into()))?;
        let stderr_task = tokio::spawn(async move {
            let mut bytes = Vec::new();
            stderr
                .take(65_536)
                .read_to_end(&mut bytes)
                .await
                .map(|_| bytes)
        });
        let mut collector = DiffPageCollector::new(offset, limit);
        let mut buffer = vec![0_u8; 32 * 1024].into_boxed_slice();
        loop {
            let read = stdout.read(&mut buffer).await.map_err(|error| {
                VcsError::Command(format!("could not read git diff output: {error}"))
            })?;
            if read == 0 {
                break;
            }
            collector.push(&buffer[..read])?;
        }
        let status = child
            .wait()
            .await
            .map_err(|error| VcsError::Command(format!("could not wait for git diff: {error}")))?;
        let stderr = stderr_task
            .await
            .map_err(|_| VcsError::Command("could not join git diff stderr reader".into()))?
            .map_err(|error| {
                VcsError::Command(format!("could not read git diff stderr: {error}"))
            })?;
        let untracked_difference =
            file.status == VcsFileStatus::Untracked && status.code() == Some(1);
        if !status.success() && !untracked_difference {
            return Err(command_failure("git diff", &stderr));
        }
        let collected = collector.finish()?;
        Ok(VcsDiffPage {
            capability: DIFF_PAGE_CAPABILITY.to_owned(),
            provider: snapshot.repository.provider.clone(),
            scope: snapshot.scope,
            snapshot_id: snapshot.snapshot_id.clone(),
            file_id: file.id.clone(),
            path: file.path.clone(),
            content: collected.content,
            revision: collected.revision,
            total_bytes: collected.total_bytes,
            next_offset: collected.next_offset,
        })
    }
}

fn git_diff_command(snapshot: &VcsSnapshot, file: &VcsFile) -> Result<Command, VcsError> {
    let root = &snapshot.repository.root;
    let relative = file
        .path
        .strip_prefix(root)
        .map_err(|_| VcsError::FileNotChanged(file.path.clone()))?;
    let mut command = Command::new("git");
    command
        .arg("-C")
        .arg(root)
        .args(["diff", "--no-ext-diff", "--no-color"]);
    if file.status == VcsFileStatus::Untracked {
        command
            .args(["--no-index", "--", "/dev/null"])
            .arg(relative);
        return Ok(command);
    }
    match snapshot.scope {
        VcsScope::Staged => {
            command.arg("--cached");
        }
        VcsScope::Unstaged => {}
        VcsScope::Branch => {
            let base = snapshot.repository.base.as_deref().ok_or_else(|| {
                VcsError::Command("Git branch snapshot does not contain a merge base".into())
            })?;
            command.args([base, "HEAD"]);
        }
    }
    command.arg("--");
    if let Some(old_path) = file.old_path.as_deref() {
        command.arg(old_path.strip_prefix(root).unwrap_or(old_path));
    }
    command.arg(relative);
    Ok(command)
}

struct CollectedDiffPage {
    content: String,
    next_offset: usize,
    revision: String,
    total_bytes: usize,
}

struct DiffPageCollector {
    content: String,
    hasher: blake3::Hasher,
    limit: usize,
    offset: usize,
    pending: Vec<u8>,
    processed_bytes: usize,
    total_bytes: usize,
}

impl DiffPageCollector {
    fn new(offset: usize, limit: usize) -> Self {
        Self {
            content: String::new(),
            hasher: blake3::Hasher::new(),
            limit,
            offset,
            pending: Vec::with_capacity(4),
            processed_bytes: 0,
            total_bytes: 0,
        }
    }

    fn push(&mut self, bytes: &[u8]) -> Result<(), VcsError> {
        self.hasher.update(bytes);
        self.total_bytes = self.total_bytes.saturating_add(bytes.len());
        self.pending.extend_from_slice(bytes);
        match std::str::from_utf8(&self.pending) {
            Ok(text) => {
                let owned = text.to_owned();
                self.pending.clear();
                self.append(&owned)
            }
            Err(error) if error.error_len().is_none() => {
                let valid = error.valid_up_to();
                let text = std::str::from_utf8(&self.pending[..valid])
                    .map_err(|_| VcsError::InvalidUtf8)?
                    .to_owned();
                let remainder = self.pending.split_off(valid);
                self.pending = remainder;
                self.append(&text)
            }
            Err(_) => Err(VcsError::InvalidUtf8),
        }
    }

    fn append(&mut self, text: &str) -> Result<(), VcsError> {
        let segment_start = self.processed_bytes;
        let segment_end = segment_start.saturating_add(text.len());
        self.processed_bytes = segment_end;
        if segment_end <= self.offset || self.content.len() >= self.limit {
            return Ok(());
        }
        let local_start = self.offset.saturating_sub(segment_start);
        if !text.is_char_boundary(local_start) {
            return Err(VcsError::Command(
                "paged diff offset is not a UTF-8 boundary".into(),
            ));
        }
        let remaining = self.limit.saturating_sub(self.content.len());
        let mut local_end = text.len().min(local_start.saturating_add(remaining));
        while local_end > local_start && !text.is_char_boundary(local_end) {
            local_end -= 1;
        }
        self.content.push_str(&text[local_start..local_end]);
        Ok(())
    }

    fn finish(mut self) -> Result<CollectedDiffPage, VcsError> {
        if !self.pending.is_empty() {
            let text = std::str::from_utf8(&self.pending)
                .map_err(|_| VcsError::InvalidUtf8)?
                .to_owned();
            self.pending.clear();
            self.append(&text)?;
        }
        if self.offset > self.total_bytes {
            return Err(VcsError::Command("paged diff offset exceeds output".into()));
        }
        let next_offset = self.offset.saturating_add(self.content.len());
        Ok(CollectedDiffPage {
            content: self.content,
            next_offset,
            revision: self.hasher.finalize().to_hex().to_string(),
            total_bytes: self.total_bytes,
        })
    }
}

async fn git_scoped_source(
    root: &Path,
    relative: &Path,
    scope: VcsScope,
    status: VcsFileStatus,
) -> Result<Option<String>, VcsError> {
    if status == VcsFileStatus::Deleted {
        return Ok(Some(String::new()));
    }
    let revision = match scope {
        VcsScope::Unstaged => return Ok(None),
        VcsScope::Staged => format!(":{}", relative.to_string_lossy()),
        VcsScope::Branch => format!("HEAD:{}", relative.to_string_lossy()),
    };
    let output = git_output(root, &["show", &revision]).await?;
    if !output.status.success() {
        return Err(command_failure("git show scoped file", &output.stderr));
    }
    match String::from_utf8(output.stdout) {
        Ok(source) if source.len() <= MAX_DIFF_BYTES => Ok(Some(source)),
        Ok(_) | Err(_) => Ok(None),
    }
}

struct BoundedDiff {
    text: String,
    truncated: bool,
}

fn bounded_diff(mut bytes: Vec<u8>) -> BoundedDiff {
    let truncated = bytes.len() > MAX_DIFF_BYTES;
    if truncated {
        bytes.truncate(MAX_DIFF_BYTES);
        while std::str::from_utf8(&bytes).is_err() && !bytes.is_empty() {
            bytes.pop();
        }
    }
    BoundedDiff {
        text: String::from_utf8_lossy(&bytes).into_owned(),
        truncated,
    }
}

async fn synthetic_added_diff(root: &Path, relative: &Path) -> Result<BoundedDiff, VcsError> {
    let bytes = tokio::fs::read(root.join(relative))
        .await
        .map_err(|error| VcsError::Command(format!("could not read added file: {error}")))?;
    let display = relative.to_string_lossy().replace('\\', "/");
    if bytes.contains(&0) || std::str::from_utf8(&bytes).is_err() {
        return Ok(BoundedDiff {
            text: format!(
                "diff --git a/{display} b/{display}\nBinary files /dev/null and b/{display} differ\n"
            ),
            truncated: false,
        });
    }
    let source = String::from_utf8(bytes).map_err(|_| VcsError::InvalidUtf8)?;
    let line_count = source.lines().count();
    let mut diff = format!(
        "diff --git a/{display} b/{display}\nnew file mode 100644\n--- /dev/null\n+++ b/{display}\n@@ -0,0 +1,{line_count} @@\n"
    );
    for line in source.split_inclusive('\n') {
        diff.push('+');
        diff.push_str(line);
    }
    if !source.is_empty() && !source.ends_with('\n') {
        diff.push_str("\n\\ No newline at end of file\n");
    }
    Ok(bounded_diff(diff.into_bytes()))
}

fn count_diff_stats(diff: &str) -> (u64, u64) {
    let mut additions = 0;
    let mut deletions = 0;
    let mut in_hunk = false;
    for line in diff.lines() {
        if line.starts_with("@@ ") {
            in_hunk = true;
            continue;
        }
        if !in_hunk {
            continue;
        }
        if line.starts_with('+') {
            additions += 1;
        } else if line.starts_with('-') {
            deletions += 1;
        }
    }
    (additions, deletions)
}

fn is_binary_diff(diff: &str) -> bool {
    diff.lines().any(|line| {
        line.starts_with("Binary files ")
            || line == "GIT binary patch"
            || line.starts_with("Cannot display: file marked as a binary type")
    })
}

fn validate_workspace(workspace: &Path) -> Result<(), VcsError> {
    if workspace.is_absolute() {
        Ok(())
    } else {
        Err(VcsError::InvalidWorkspace(workspace.to_path_buf()))
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

async fn git_output(
    workspace: &Path,
    arguments: &[&str],
) -> Result<std::process::Output, VcsError> {
    Command::new("git")
        .arg("-C")
        .arg(workspace)
        .args(arguments)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()
        .await
        .map_err(|error| VcsError::Command(format!("could not start git: {error}")))
}

fn command_failure(operation: &str, stderr: &[u8]) -> VcsError {
    let detail = String::from_utf8_lossy(stderr).trim().to_owned();
    if detail.is_empty() {
        VcsError::Command(operation.to_owned())
    } else {
        VcsError::Command(format!("{operation}: {detail}"))
    }
}

async fn git_branch_snapshot(root: &Path) -> Result<VcsSnapshot, VcsError> {
    let base_ref = git_default_branch(root)
        .await?
        .ok_or_else(|| VcsError::UnsupportedScope {
            workspace: root.to_path_buf(),
            scope: VcsScope::Branch,
        })?;
    let merge_base_output = git_output(root, &["merge-base", &base_ref, "HEAD"]).await?;
    if !merge_base_output.status.success() {
        return Err(command_failure("git merge-base", &merge_base_output.stderr));
    }
    let base = String::from_utf8(merge_base_output.stdout)
        .map_err(|_| VcsError::InvalidUtf8)?
        .trim()
        .to_owned();
    if base.is_empty() {
        return Err(VcsError::Command(
            "git merge-base returned an empty revision".into(),
        ));
    }
    let diff_output = git_output(
        root,
        &[
            "diff",
            "--name-status",
            "-z",
            "--find-renames",
            &base,
            "HEAD",
        ],
    )
    .await?;
    if !diff_output.status.success() {
        return Err(command_failure(
            "git diff --name-status",
            &diff_output.stderr,
        ));
    }
    let mut files = parse_git_name_status(root, &diff_output.stdout)?;
    populate_git_diff_stats(root, VcsScope::Branch, Some(&base), &mut files).await?;
    let branch = git_text(root, &["branch", "--show-current"]).await?;
    let head = git_text(root, &["rev-parse", "HEAD"]).await?;
    let summary = summarize(&files);
    let state = if summary.conflicted > 0 {
        VcsState::Conflicted
    } else if summary.total > 0 {
        VcsState::Dirty
    } else {
        VcsState::Clean
    };
    let snapshot_id = snapshot_id(
        root,
        branch.as_deref(),
        head.as_deref(),
        Some(&base),
        VcsScope::Branch,
        &files,
    )?;
    Ok(VcsSnapshot {
        capability: CHANGES_CAPABILITY.to_owned(),
        repository: VcsRepository {
            provider: "git".into(),
            root: root.to_path_buf(),
            branch,
            head,
            base: Some(base),
        },
        scope: VcsScope::Branch,
        available_scopes: vec![VcsScope::Staged, VcsScope::Unstaged, VcsScope::Branch],
        snapshot_id,
        state,
        summary,
        files,
    })
}

async fn git_default_branch(root: &Path) -> Result<Option<String>, VcsError> {
    let symbolic = git_output(
        root,
        &[
            "symbolic-ref",
            "--quiet",
            "--short",
            "refs/remotes/origin/HEAD",
        ],
    )
    .await?;
    if symbolic.status.success() {
        let value = String::from_utf8(symbolic.stdout).map_err(|_| VcsError::InvalidUtf8)?;
        let value = value.trim();
        if !value.is_empty() {
            return Ok(Some(value.to_owned()));
        }
    }
    for candidate in ["origin/main", "main", "origin/master", "master", "trunk"] {
        let output = git_output(
            root,
            &[
                "rev-parse",
                "--verify",
                "--quiet",
                &format!("{candidate}^{{commit}}"),
            ],
        )
        .await?;
        if output.status.success() {
            return Ok(Some(candidate.to_owned()));
        }
    }
    Ok(None)
}

async fn git_text(root: &Path, arguments: &[&str]) -> Result<Option<String>, VcsError> {
    let output = git_output(root, arguments).await?;
    if !output.status.success() {
        return Ok(None);
    }
    let value = String::from_utf8(output.stdout).map_err(|_| VcsError::InvalidUtf8)?;
    let value = value.trim();
    Ok((!value.is_empty()).then(|| value.to_owned()))
}

fn parse_git_name_status(root: &Path, output: &[u8]) -> Result<Vec<VcsFile>, VcsError> {
    let fields = output
        .split(|byte| *byte == 0)
        .filter(|field| !field.is_empty())
        .collect::<Vec<_>>();
    let mut index = 0;
    let mut files = BTreeMap::new();
    while index < fields.len() {
        let status_text = std::str::from_utf8(fields[index]).map_err(|_| VcsError::InvalidUtf8)?;
        index += 1;
        let status_code = status_text.as_bytes().first().copied().unwrap_or(b'M');
        let renamed = matches!(status_code, b'R' | b'C');
        let old_path = if renamed {
            let value = fields
                .get(index)
                .ok_or_else(|| VcsError::Command("malformed git rename diff".into()))?;
            index += 1;
            Some(std::str::from_utf8(value).map_err(|_| VcsError::InvalidUtf8)?)
        } else {
            None
        };
        let path = fields
            .get(index)
            .ok_or_else(|| VcsError::Command("malformed git name-status diff".into()))?;
        index += 1;
        let path = std::str::from_utf8(path).map_err(|_| VcsError::InvalidUtf8)?;
        let status = match status_code {
            b'A' => VcsFileStatus::Added,
            b'D' => VcsFileStatus::Deleted,
            b'R' | b'C' => VcsFileStatus::Renamed,
            _ => VcsFileStatus::Modified,
        };
        insert_file(&mut files, root, path, old_path, status, false, None);
    }
    Ok(files.into_values().collect())
}

async fn populate_git_diff_stats(
    root: &Path,
    scope: VcsScope,
    base: Option<&str>,
    files: &mut [VcsFile],
) -> Result<(), VcsError> {
    let mut command = Command::new("git");
    command
        .arg("-C")
        .arg(root)
        .args(["diff", "--numstat", "-z", "--find-renames"]);
    match scope {
        VcsScope::Staged => {
            command.arg("--cached");
        }
        VcsScope::Unstaged => {}
        VcsScope::Branch => {
            let base =
                base.ok_or_else(|| VcsError::Command("branch numstat has no base".into()))?;
            command.args([base, "HEAD"]);
        }
    }
    let output = command
        .arg("--")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()
        .await
        .map_err(|error| {
            VcsError::Command(format!("could not start git diff --numstat: {error}"))
        })?;
    if !output.status.success() {
        return Err(command_failure("git diff --numstat", &output.stderr));
    }
    for stat in parse_git_numstat(root, &output.stdout)? {
        let Some(file) = files.iter_mut().find(|file| file.path == stat.path) else {
            continue;
        };
        file.binary = stat.binary;
        file.additions = stat.additions;
        file.deletions = stat.deletions;
    }
    for file in files
        .iter_mut()
        .filter(|file| file.status == VcsFileStatus::Untracked)
    {
        let relative = file
            .path
            .strip_prefix(root)
            .map_err(|_| VcsError::FileNotChanged(file.path.clone()))?;
        let diff = synthetic_added_diff(root, relative).await?;
        file.binary = is_binary_diff(&diff.text);
        if !file.binary {
            let (additions, deletions) = count_diff_stats(&diff.text);
            file.additions = Some(additions);
            file.deletions = Some(deletions);
        }
    }
    Ok(())
}

struct GitNumstat {
    path: PathBuf,
    additions: Option<u64>,
    deletions: Option<u64>,
    binary: bool,
}

fn parse_git_numstat(root: &Path, output: &[u8]) -> Result<Vec<GitNumstat>, VcsError> {
    let mut cursor = 0;
    let mut stats = Vec::new();
    while cursor < output.len() {
        let additions = take_git_field(output, &mut cursor, b'\t')?;
        let deletions = take_git_field(output, &mut cursor, b'\t')?;
        let path = if output.get(cursor) == Some(&0) {
            cursor += 1;
            let _old_path = take_git_field(output, &mut cursor, 0)?;
            take_git_field(output, &mut cursor, 0)?
        } else {
            take_git_field(output, &mut cursor, 0)?
        };
        let path = std::str::from_utf8(path).map_err(|_| VcsError::InvalidUtf8)?;
        let binary = additions == b"-" || deletions == b"-";
        let parse_count = |value: &[u8]| -> Result<Option<u64>, VcsError> {
            if value == b"-" {
                return Ok(None);
            }
            let text = std::str::from_utf8(value).map_err(|_| VcsError::InvalidUtf8)?;
            text.parse::<u64>()
                .map(Some)
                .map_err(|_| VcsError::Command("malformed git numstat count".into()))
        };
        stats.push(GitNumstat {
            path: root.join(path),
            additions: parse_count(additions)?,
            deletions: parse_count(deletions)?,
            binary,
        });
    }
    Ok(stats)
}

fn take_git_field<'a>(
    output: &'a [u8],
    cursor: &mut usize,
    delimiter: u8,
) -> Result<&'a [u8], VcsError> {
    let start = *cursor;
    let Some(offset) = output[start..].iter().position(|byte| *byte == delimiter) else {
        return Err(VcsError::Command("malformed git numstat record".into()));
    };
    let end = start + offset;
    *cursor = end + 1;
    Ok(&output[start..end])
}

#[allow(clippy::too_many_lines)]
fn parse_git_status(root: &Path, output: &[u8], scope: VcsScope) -> Result<VcsSnapshot, VcsError> {
    if scope == VcsScope::Branch {
        return Err(VcsError::UnsupportedScope {
            workspace: root.to_path_buf(),
            scope,
        });
    }
    let mut branch = None;
    let mut head = None;
    let mut files = BTreeMap::<PathBuf, VcsFile>::new();
    let records = output.split(|byte| *byte == 0).collect::<Vec<_>>();
    let mut index = 0;
    while index < records.len() {
        let record = records[index];
        index += 1;
        if record.is_empty() {
            continue;
        }
        let text = std::str::from_utf8(record).map_err(|_| VcsError::InvalidUtf8)?;
        if let Some(value) = text.strip_prefix("# branch.head ") {
            branch = (value != "(detached)").then(|| value.to_owned());
            continue;
        }
        if let Some(value) = text.strip_prefix("# branch.oid ") {
            head = (value != "(initial)").then(|| value.to_owned());
            continue;
        }
        if let Some(path) = text.strip_prefix("? ") {
            if scope == VcsScope::Unstaged {
                insert_file(
                    &mut files,
                    root,
                    path,
                    None,
                    VcsFileStatus::Untracked,
                    false,
                    None,
                );
            }
            continue;
        }
        if text.starts_with("! ") {
            continue;
        }
        let kind = text.as_bytes().first().copied();
        if kind == Some(b'1') {
            let fields = text.splitn(9, ' ').collect::<Vec<_>>();
            if fields.len() != 9 {
                return Err(VcsError::Command("malformed git status record".into()));
            }
            let xy = fields[1];
            let path = fields[8];
            let Some(status) = status_for_scope(xy, false, scope) else {
                continue;
            };
            insert_file(
                &mut files,
                root,
                path,
                None,
                status,
                scope == VcsScope::Staged,
                conflict_from_xy(xy),
            );
            continue;
        }
        if kind == Some(b'2') {
            let fields = text.splitn(10, ' ').collect::<Vec<_>>();
            if fields.len() != 10 || index >= records.len() {
                return Err(VcsError::Command("malformed git rename record".into()));
            }
            let xy = fields[1];
            let path = fields[9];
            let old_path =
                std::str::from_utf8(records[index]).map_err(|_| VcsError::InvalidUtf8)?;
            index += 1;
            let Some(status) = status_for_scope(xy, true, scope) else {
                continue;
            };
            insert_file(
                &mut files,
                root,
                path,
                Some(old_path),
                status,
                scope == VcsScope::Staged,
                conflict_from_xy(xy),
            );
            continue;
        }
        if kind == Some(b'u') {
            let fields = text.splitn(11, ' ').collect::<Vec<_>>();
            if fields.len() != 11 {
                return Err(VcsError::Command("malformed git conflict record".into()));
            }
            let xy = fields[1];
            insert_file(
                &mut files,
                root,
                fields[10],
                None,
                VcsFileStatus::Conflicted,
                scope == VcsScope::Staged,
                Some(xy.to_owned()),
            );
        }
    }
    let files = files.into_values().collect::<Vec<_>>();
    let summary = summarize(&files);
    let state = if summary.conflicted > 0 {
        VcsState::Conflicted
    } else if summary.total > 0 {
        VcsState::Dirty
    } else {
        VcsState::Clean
    };
    let snapshot_id = snapshot_id(
        root,
        branch.as_deref(),
        head.as_deref(),
        None,
        scope,
        &files,
    )?;
    Ok(VcsSnapshot {
        capability: CHANGES_CAPABILITY.to_owned(),
        repository: VcsRepository {
            provider: "git".into(),
            root: root.to_path_buf(),
            branch,
            head,
            base: None,
        },
        scope,
        available_scopes: vec![VcsScope::Staged, VcsScope::Unstaged, VcsScope::Branch],
        snapshot_id,
        state,
        summary,
        files,
    })
}

fn insert_file(
    files: &mut BTreeMap<PathBuf, VcsFile>,
    root: &Path,
    path: &str,
    old_path: Option<&str>,
    status: VcsFileStatus,
    staged: bool,
    conflict: Option<String>,
) {
    let absolute = root.join(path);
    let old_absolute = old_path.map(|candidate| root.join(candidate));
    let id = blake3::hash(absolute.to_string_lossy().as_bytes())
        .to_hex()
        .to_string();
    files.insert(
        absolute.clone(),
        VcsFile {
            id,
            path: absolute,
            old_path: old_absolute,
            status,
            staged,
            additions: None,
            deletions: None,
            binary: false,
            conflict,
        },
    );
}

fn conflict_from_xy(xy: &str) -> Option<String> {
    matches!(xy, "DD" | "AU" | "UD" | "UA" | "DU" | "AA" | "UU").then(|| xy.to_owned())
}

fn status_for_scope(xy: &str, renamed_record: bool, scope: VcsScope) -> Option<VcsFileStatus> {
    if conflict_from_xy(xy).is_some() {
        return Some(VcsFileStatus::Conflicted);
    }
    let index = match scope {
        VcsScope::Staged => 0,
        VcsScope::Unstaged => 1,
        VcsScope::Branch => return None,
    };
    let status = *xy.as_bytes().get(index)?;
    if status == b'.' || status == b' ' {
        return None;
    }
    Some(match status {
        b'R' | b'C' if renamed_record => VcsFileStatus::Renamed,
        b'D' => VcsFileStatus::Deleted,
        b'A' => VcsFileStatus::Added,
        _ => VcsFileStatus::Modified,
    })
}

fn summarize(files: &[VcsFile]) -> VcsSummary {
    let mut summary = VcsSummary {
        total: files.len(),
        ..VcsSummary::default()
    };
    for file in files {
        match file.status {
            VcsFileStatus::Added => summary.added += 1,
            VcsFileStatus::Modified => summary.modified += 1,
            VcsFileStatus::Deleted => summary.deleted += 1,
            VcsFileStatus::Renamed => summary.renamed += 1,
            VcsFileStatus::Untracked => summary.untracked += 1,
            VcsFileStatus::Conflicted => summary.conflicted += 1,
        }
    }
    summary
}

fn snapshot_id(
    root: &Path,
    branch: Option<&str>,
    head: Option<&str>,
    base: Option<&str>,
    scope: VcsScope,
    files: &[VcsFile],
) -> Result<String, VcsError> {
    let encoded = serde_json::to_vec(&(root, branch, head, base, scope, files))
        .map_err(|error| VcsError::Command(format!("could not encode VCS snapshot: {error}")))?;
    Ok(blake3::hash(&encoded).to_hex().to_string())
}

#[cfg(test)]
#[allow(clippy::expect_used)]
mod tests {
    use super::*;

    async fn run_git(root: &Path, arguments: &[&str]) {
        let output = Command::new("git")
            .arg("-C")
            .arg(root)
            .args(arguments)
            .output()
            .await
            .expect("git starts");
        assert!(
            output.status.success(),
            "git {} failed: {}",
            arguments.join(" "),
            String::from_utf8_lossy(&output.stderr)
        );
    }

    async fn initialize_git_repository(root: &Path) {
        run_git(root, &["init", "--quiet", "--initial-branch=main"]).await;
        run_git(root, &["config", "user.email", "test@example.com"]).await;
        run_git(root, &["config", "user.name", "Test"]).await;
    }

    #[test]
    fn parses_porcelain_v2_snapshot() {
        let root = Path::new("/repo");
        let status = concat!(
            "# branch.oid abcdef\0",
            "# branch.head feature/vcs\0",
            "1 .M N... 100644 100644 100644 abc abc src/lib.rs\0",
            "2 R. N... 100644 100644 100644 abc def R100 src/new.rs\0",
            "src/old.rs\0",
            "? notes.txt\0",
            "u UU N... 100644 100644 100644 100644 abc def 123 conflict.rs\0",
        );
        let snapshot =
            parse_git_status(root, status.as_bytes(), VcsScope::Unstaged).expect("status parses");
        assert_eq!(snapshot.repository.branch.as_deref(), Some("feature/vcs"));
        assert_eq!(snapshot.repository.head.as_deref(), Some("abcdef"));
        assert_eq!(snapshot.state, VcsState::Conflicted);
        assert_eq!(snapshot.summary.total, 3);
        assert_eq!(snapshot.summary.modified, 1);
        assert_eq!(snapshot.summary.renamed, 0);
        assert_eq!(snapshot.summary.untracked, 1);
        assert_eq!(snapshot.summary.conflicted, 1);
        let staged = parse_git_status(root, status.as_bytes(), VcsScope::Staged)
            .expect("staged status parses");
        assert_eq!(staged.summary.total, 2);
        assert_eq!(staged.summary.renamed, 1);
        let renamed = staged
            .files
            .iter()
            .find(|file| file.status == VcsFileStatus::Renamed)
            .expect("renamed file exists");
        assert_eq!(
            renamed.old_path.as_deref(),
            Some(Path::new("/repo/src/old.rs"))
        );
    }

    #[test]
    fn parses_text_binary_and_renamed_numstat_records() {
        let stats = parse_git_numstat(
            Path::new("/repo"),
            b"3\t2\tsrc/lib.rs\0-\t-\tassets/image.png\x005\t1\t\0src/old.rs\0src/new.rs\0",
        )
        .expect("numstat parses");

        assert_eq!(stats.len(), 3);
        assert_eq!(stats[0].path, Path::new("/repo/src/lib.rs"));
        assert_eq!((stats[0].additions, stats[0].deletions), (Some(3), Some(2)));
        assert!(!stats[0].binary);
        assert_eq!(stats[1].path, Path::new("/repo/assets/image.png"));
        assert_eq!((stats[1].additions, stats[1].deletions), (None, None));
        assert!(stats[1].binary);
        assert_eq!(stats[2].path, Path::new("/repo/src/new.rs"));
        assert_eq!((stats[2].additions, stats[2].deletions), (Some(5), Some(1)));
    }

    #[test]
    fn binary_detection_ignores_marker_text_inside_a_hunk() {
        let text = "diff --git a/a.rs b/a.rs\n--- a/a.rs\n+++ b/a.rs\n@@ -0,0 +1 @@\n+const label = \"Binary files are supported\";\n";
        let binary = "diff --git a/a.png b/a.png\nBinary files a/a.png and b/a.png differ\n";
        assert!(!is_binary_diff(text));
        assert!(is_binary_diff(binary));
    }

    #[test]
    fn clean_snapshot_is_stable() {
        let first = parse_git_status(
            Path::new("/repo"),
            b"# branch.oid abcdef\0# branch.head main\0",
            VcsScope::Unstaged,
        )
        .expect("status parses");
        let second = parse_git_status(
            Path::new("/repo"),
            b"# branch.oid abcdef\0# branch.head main\0",
            VcsScope::Unstaged,
        )
        .expect("status parses");
        assert_eq!(first.state, VcsState::Clean);
        assert_eq!(first.snapshot_id, second.snapshot_id);
    }

    #[tokio::test]
    async fn git_provider_detects_repository() {
        let directory = tempfile::tempdir().expect("temp directory");
        let init = Command::new("git")
            .arg("init")
            .arg("--quiet")
            .arg(directory.path())
            .output()
            .await
            .expect("git starts");
        assert!(init.status.success());
        let root = GitProvider
            .detect(directory.path())
            .await
            .expect("detect succeeds")
            .expect("repository detected");
        assert_eq!(
            root.canonicalize().expect("root canonicalizes"),
            directory.path().canonicalize().expect("temp canonicalizes")
        );
    }

    #[tokio::test]
    async fn service_preserves_explicit_unsupported_workspace_fallback() {
        let directory = tempfile::tempdir().expect("temp directory");
        let service = VcsService::new(directory.path().join("plugins.json"));
        assert!(matches!(
            service.changes(directory.path(), VcsScope::Unstaged).await,
            Err(VcsError::UnsupportedWorkspace(path)) if path == directory.path()
        ));
    }

    #[tokio::test]
    async fn git_diff_combines_the_current_file_against_head() {
        let directory = tempfile::tempdir().expect("temp directory");
        for arguments in [
            vec!["init", "--quiet"],
            vec!["config", "user.email", "test@example.com"],
            vec!["config", "user.name", "Test"],
        ] {
            let output = Command::new("git")
                .arg("-C")
                .arg(directory.path())
                .args(arguments)
                .output()
                .await
                .expect("git starts");
            assert!(output.status.success());
        }
        let path = directory.path().join("file.txt");
        tokio::fs::write(&path, "old\n").await.expect("file writes");
        for arguments in [
            vec!["add", "file.txt"],
            vec!["commit", "--quiet", "-m", "base"],
        ] {
            let output = Command::new("git")
                .arg("-C")
                .arg(directory.path())
                .args(arguments)
                .output()
                .await
                .expect("git starts");
            assert!(output.status.success());
        }
        tokio::fs::write(&path, "new\nnext\n")
            .await
            .expect("file updates");
        let provider = GitProvider;
        let snapshot = provider
            .changes(directory.path(), VcsScope::Unstaged)
            .await
            .expect("snapshot loads");
        let file = snapshot.files.first().expect("changed file exists");
        assert_eq!((file.additions, file.deletions), (Some(2), Some(1)));
        let diff = provider.diff(&snapshot, file).await.expect("diff loads");
        assert_eq!(diff.repository.provider, "git");
        assert_eq!((diff.additions, diff.deletions), (2, 1));
        assert!(diff.diff.contains("-old\n+new\n+next"));
    }

    #[tokio::test]
    async fn git_diff_synthesizes_untracked_files() {
        let directory = tempfile::tempdir().expect("temp directory");
        let init = Command::new("git")
            .arg("init")
            .arg("--quiet")
            .arg(directory.path())
            .output()
            .await
            .expect("git starts");
        assert!(init.status.success());
        let path = directory.path().join("new.txt");
        tokio::fs::write(&path, "first\nsecond\n")
            .await
            .expect("file writes");
        let provider = GitProvider;
        let snapshot = provider
            .changes(directory.path(), VcsScope::Unstaged)
            .await
            .expect("snapshot loads");
        let file = snapshot.files.first().expect("changed file exists");
        assert_eq!((file.additions, file.deletions), (Some(2), Some(0)));
        let diff = provider.diff(&snapshot, file).await.expect("diff loads");
        assert_eq!(diff.status, VcsFileStatus::Untracked);
        assert_eq!((diff.additions, diff.deletions), (2, 0));
        assert!(diff.diff.contains("--- /dev/null\n+++ b/new.txt"));
    }

    #[tokio::test]
    async fn git_scopes_separate_staged_and_unstaged_content() {
        let directory = tempfile::tempdir().expect("temp directory");
        initialize_git_repository(directory.path()).await;
        let path = directory.path().join("file.txt");
        tokio::fs::write(&path, "base\n")
            .await
            .expect("base writes");
        run_git(directory.path(), &["add", "file.txt"]).await;
        run_git(directory.path(), &["commit", "--quiet", "-m", "base"]).await;

        tokio::fs::write(&path, "staged\n")
            .await
            .expect("staged writes");
        run_git(directory.path(), &["add", "file.txt"]).await;
        tokio::fs::write(&path, "unstaged\n")
            .await
            .expect("unstaged writes");

        let provider = GitProvider;
        let staged = provider
            .changes(directory.path(), VcsScope::Staged)
            .await
            .expect("staged snapshot loads");
        let unstaged = provider
            .changes(directory.path(), VcsScope::Unstaged)
            .await
            .expect("unstaged snapshot loads");
        assert_eq!(staged.files.len(), 1);
        assert!(staged.files[0].staged);
        assert_eq!(
            (staged.files[0].additions, staged.files[0].deletions),
            (Some(1), Some(1))
        );
        assert_eq!(unstaged.files.len(), 1);
        assert!(!unstaged.files[0].staged);
        assert_eq!(
            (unstaged.files[0].additions, unstaged.files[0].deletions),
            (Some(1), Some(1))
        );

        let staged_diff = provider
            .diff(&staged, staged.files.first().expect("staged file exists"))
            .await
            .expect("staged diff loads");
        let unstaged_diff = provider
            .diff(
                &unstaged,
                unstaged.files.first().expect("unstaged file exists"),
            )
            .await
            .expect("unstaged diff loads");
        assert!(staged_diff.diff.contains("-base\n+staged"));
        assert!(!staged_diff.diff.contains("unstaged"));
        assert_eq!(staged_diff.source.as_deref(), Some("staged\n"));
        assert!(unstaged_diff.diff.contains("-staged\n+unstaged"));
        assert_eq!(unstaged_diff.source, None);
    }

    #[tokio::test]
    async fn git_branch_scope_excludes_worktree_changes() {
        let directory = tempfile::tempdir().expect("temp directory");
        initialize_git_repository(directory.path()).await;
        let path = directory.path().join("file.txt");
        tokio::fs::write(&path, "base\n")
            .await
            .expect("base writes");
        run_git(directory.path(), &["add", "file.txt"]).await;
        run_git(directory.path(), &["commit", "--quiet", "-m", "base"]).await;
        run_git(directory.path(), &["switch", "--quiet", "-c", "feature"]).await;
        tokio::fs::write(&path, "committed\n")
            .await
            .expect("commit writes");
        run_git(directory.path(), &["add", "file.txt"]).await;
        run_git(directory.path(), &["commit", "--quiet", "-m", "feature"]).await;
        tokio::fs::write(&path, "worktree\n")
            .await
            .expect("worktree writes");

        let provider = GitProvider;
        let snapshot = provider
            .changes(directory.path(), VcsScope::Branch)
            .await
            .expect("branch snapshot loads");
        assert_eq!(snapshot.scope, VcsScope::Branch);
        assert!(snapshot.repository.base.is_some());
        assert_eq!(snapshot.files.len(), 1);
        assert_eq!(
            (snapshot.files[0].additions, snapshot.files[0].deletions),
            (Some(1), Some(1))
        );

        let diff = provider
            .diff(
                &snapshot,
                snapshot.files.first().expect("branch file exists"),
            )
            .await
            .expect("branch diff loads");
        assert!(diff.diff.contains("-base\n+committed"));
        assert!(!diff.diff.contains("worktree"));
        assert_eq!(diff.source.as_deref(), Some("committed\n"));
    }
}
