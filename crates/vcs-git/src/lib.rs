//! The Git implementation of the `CodeWide` VCS provider contract, served by
//! the `codewide-vcs-git` plugin executable. Every Git invocation of the
//! companion lives here; `companion-core` only speaks the plugin protocol.
//!
//! The value model (`VcsSnapshot`, `VcsDiff`, `VcsRemotes`, …) is
//! `companion_host::vcs`, shared with the companion's plugin client.

use std::{
    collections::BTreeMap,
    path::{Path, PathBuf},
    process::Stdio,
};

pub use companion_host::vcs::{
    CHANGES_CAPABILITY, DIFF_CAPABILITY, DIFF_PAGE_CAPABILITY, INSPECT_CAPABILITY,
    REMOTES_CAPABILITY, UpstreamRef, VcsDiff, VcsDiffPage, VcsError, VcsFile, VcsFileStatus,
    VcsRemote, VcsRemotes, VcsRepository, VcsScope, VcsSnapshot, VcsState, VcsSummary,
    WORKSPACE_CREATE_CAPABILITY, WorkspaceCreateResult, WorkspaceSupport,
};
use tokio::{io::AsyncReadExt, process::Command};

mod remotes;

const MAX_DIFF_BYTES: usize = 4 * 1024 * 1024;

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
        if scope == VcsScope::Uncommitted {
            return git_uncommitted_snapshot(&root, &output.stdout).await;
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
        let raw = if file.status == VcsFileStatus::Untracked
            || (snapshot.scope == VcsScope::Uncommitted && snapshot.repository.head.is_none())
        {
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
                VcsScope::Uncommitted => {
                    command.arg("HEAD");
                }
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
        let untracked_difference = (file.status == VcsFileStatus::Untracked
            || (snapshot.scope == VcsScope::Uncommitted && snapshot.repository.head.is_none()))
            && status.code() == Some(1);
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
    if file.status == VcsFileStatus::Untracked
        || (snapshot.scope == VcsScope::Uncommitted && snapshot.repository.head.is_none())
    {
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
        VcsScope::Uncommitted => {
            command.arg("HEAD");
        }
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
        VcsScope::Unstaged | VcsScope::Uncommitted => return Ok(None),
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
    let path = root.join(relative);
    let display = relative.to_string_lossy().replace('\\', "/");
    // Git records a symlink as its target text and an untracked nested repository as a
    // directory entry. Reading either through the link would fail on directories and could
    // expose content outside the workspace.
    let metadata = tokio::fs::symlink_metadata(&path)
        .await
        .map_err(|error| VcsError::Command(format!("could not inspect added file: {error}")))?;
    if metadata.file_type().is_symlink() {
        let target = tokio::fs::read_link(&path)
            .await
            .map_err(|error| VcsError::Command(format!("could not read added symlink: {error}")))?;
        let target = target.to_string_lossy();
        return Ok(bounded_diff(
            format!(
                "diff --git a/{display} b/{display}\nnew file mode 120000\n--- /dev/null\n+++ b/{display}\n@@ -0,0 +1 @@\n+{target}\n\\ No newline at end of file\n"
            )
            .into_bytes(),
        ));
    }
    if metadata.is_dir() {
        return Ok(BoundedDiff {
            text: format!("diff --git a/{display} b/{display}\nnew file mode 160000\n"),
            truncated: false,
        });
    }
    let bytes = tokio::fs::read(&path)
        .await
        .map_err(|error| VcsError::Command(format!("could not read added file: {error}")))?;
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
        available_scopes: vec![
            VcsScope::Staged,
            VcsScope::Unstaged,
            VcsScope::Uncommitted,
            VcsScope::Branch,
        ],
        snapshot_id,
        state,
        summary,
        files,
    })
}

async fn git_uncommitted_snapshot(
    root: &Path,
    status_output: &[u8],
) -> Result<VcsSnapshot, VcsError> {
    let worktree = parse_git_status(root, status_output, VcsScope::Unstaged)?;
    let has_head = worktree.repository.head.is_some();
    let files = git_uncommitted_files(root, status_output, has_head, worktree.files).await?;
    let summary = summarize(&files);
    let state = if summary.conflicted > 0 {
        VcsState::Conflicted
    } else if summary.total > 0 {
        VcsState::Dirty
    } else {
        VcsState::Clean
    };
    let repository = worktree.repository;
    let snapshot_id = snapshot_id(
        root,
        repository.branch.as_deref(),
        repository.head.as_deref(),
        None,
        VcsScope::Uncommitted,
        &files,
    )?;
    Ok(VcsSnapshot {
        capability: CHANGES_CAPABILITY.to_owned(),
        repository,
        scope: VcsScope::Uncommitted,
        available_scopes: vec![
            VcsScope::Staged,
            VcsScope::Unstaged,
            VcsScope::Uncommitted,
            VcsScope::Branch,
        ],
        snapshot_id,
        state,
        summary,
        files,
    })
}

async fn git_uncommitted_files(
    root: &Path,
    status_output: &[u8],
    has_head: bool,
    worktree_files: Vec<VcsFile>,
) -> Result<Vec<VcsFile>, VcsError> {
    let staged = parse_git_status(root, status_output, VcsScope::Staged)?;
    let mut files = BTreeMap::<PathBuf, VcsFile>::new();
    if has_head {
        let output = git_output(
            root,
            &[
                "diff",
                "--name-status",
                "-z",
                "--find-renames",
                "HEAD",
                "--",
            ],
        )
        .await?;
        if !output.status.success() {
            return Err(command_failure(
                "git diff HEAD --name-status",
                &output.stderr,
            ));
        }
        for file in parse_git_name_status(root, &output.stdout)? {
            files.insert(file.path.clone(), file);
        }
    } else {
        // An unborn branch has no HEAD. Every existing indexed file is new.
        let output = git_output(root, &["ls-files", "-z", "--cached"]).await?;
        if !output.status.success() {
            return Err(command_failure("git ls-files", &output.stderr));
        }
        for path in output
            .stdout
            .split(|byte| *byte == 0)
            .filter(|path| !path.is_empty())
        {
            let path = std::str::from_utf8(path).map_err(|_| VcsError::InvalidUtf8)?;
            if tokio::fs::symlink_metadata(root.join(path)).await.is_ok() {
                insert_file(
                    &mut files,
                    root,
                    path,
                    None,
                    VcsFileStatus::Added,
                    true,
                    None,
                );
            }
        }
    }
    for file in worktree_files.into_iter().chain(staged.files) {
        if file.status == VcsFileStatus::Untracked || file.status == VcsFileStatus::Conflicted {
            files.insert(file.path.clone(), file);
        }
    }
    let mut files = files.into_values().collect::<Vec<_>>();
    if has_head {
        populate_git_diff_stats(root, VcsScope::Uncommitted, None, &mut files).await?;
    } else {
        for file in &mut files {
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
    }
    Ok(files)
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
        VcsScope::Uncommitted => {
            command.arg("HEAD");
        }
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
    if matches!(scope, VcsScope::Branch | VcsScope::Uncommitted) {
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
        available_scopes: vec![
            VcsScope::Staged,
            VcsScope::Unstaged,
            VcsScope::Uncommitted,
            VcsScope::Branch,
        ],
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
        VcsScope::Uncommitted | VcsScope::Branch => return None,
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
mod tests;
