//! The workspace version-control model shared by the companion's VCS
//! service and provider adapters that project thread changes, and the narrow
//! [`WorkspaceVcs`] read contract the companion's `VcsService` implements.

use std::path::{Path, PathBuf};

use async_trait::async_trait;
use serde::{Deserialize, Serialize};

pub const CHANGES_CAPABILITY: &str = "vcs.changes@2";
pub const INSPECT_CAPABILITY: &str = "vcs.inspect@1";
pub const DIFF_CAPABILITY: &str = "vcs.diff@2";
pub const DIFF_PAGE_CAPABILITY: &str = "vcs.diffPage@1";
pub const WORKSPACE_CREATE_CAPABILITY: &str = "workspace.create@1";
pub const REMOTES_CAPABILITY: &str = "vcs.remotes@1";

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
    Uncommitted,
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

/// `workspace.inspect` result: a provider that can create an isolated
/// workspace for the repository at `repository_root`.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceSupport {
    pub capability: String,
    pub provider: String,
    pub display_name: String,
    pub repository_root: PathBuf,
}

/// `workspace.create` result (and its `workspace.progress` payload).
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceCreateResult {
    pub capability: String,
    pub provider: String,
    pub repository_root: PathBuf,
    pub cwd: PathBuf,
    pub created: bool,
}

/// One named remote of a `vcs.remotes@1` result.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VcsRemote {
    pub name: String,
    /// Credentials are stripped by the provider.
    pub url: String,
}

/// The server branch a local branch tracks, under one of the remotes.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpstreamRef {
    pub remote: String,
    pub branch: String,
}

/// `vcs.remotes@1` result: the current branch, its upstream and the remotes.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VcsRemotes {
    pub capability: String,
    pub provider: String,
    /// `None` on a detached head.
    pub branch: Option<String>,
    pub upstream: Option<UpstreamRef>,
    pub remotes: Vec<VcsRemote>,
}

/// Reads a workspace's changes through the VCS provider that owns it.
#[async_trait]
pub trait WorkspaceVcs: Send + Sync {
    /// The changed files of `workspace` in `scope`.
    ///
    /// # Errors
    ///
    /// Returns an error when the workspace is invalid or unsupported, or the
    /// owning provider fails.
    async fn changes(&self, workspace: &Path, scope: VcsScope) -> Result<VcsSnapshot, VcsError>;

    /// One file's diff in `scope`.
    ///
    /// # Errors
    ///
    /// Returns an error when the workspace or path is invalid, no provider
    /// owns the workspace, the file is no longer changed, or the provider fails.
    async fn diff(
        &self,
        workspace: &Path,
        path: &Path,
        scope: VcsScope,
    ) -> Result<VcsDiff, VcsError>;

    /// One bounded page of a file's diff in `scope`.
    ///
    /// # Errors
    ///
    /// Returns an error when the workspace or path is invalid, no provider
    /// owns the workspace, or the provider lacks the paged-diff capability.
    async fn diff_page(
        &self,
        workspace: &Path,
        path: &Path,
        scope: VcsScope,
        offset: usize,
        limit: usize,
    ) -> Result<VcsDiffPage, VcsError>;
}
