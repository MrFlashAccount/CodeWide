//! Compatibility for Arc providers whose wire scopes predate `uncommitted`.
//! An Arc-owned workspace never falls through to Git on a component failure.

use std::{collections::BTreeMap, path::Path};

use super::{
    CHANGES_CAPABILITY, MAX_DIFF_BYTES, VcsDiff, VcsError, VcsFile, VcsScope, VcsSnapshot,
    VcsState, find_snapshot_file, plugin, summarize,
};

pub(super) enum Resolved {
    Native(VcsSnapshot),
    Composed {
        snapshot: VcsSnapshot,
        staged: Box<VcsSnapshot>,
        unstaged: Box<VcsSnapshot>,
    },
}

impl Resolved {
    pub(super) fn snapshot(self) -> VcsSnapshot {
        match self {
            Self::Native(snapshot) | Self::Composed { snapshot, .. } => snapshot,
        }
    }

    pub(super) fn native_snapshot(&self) -> Option<&VcsSnapshot> {
        match self {
            Self::Native(snapshot) => Some(snapshot),
            Self::Composed { .. } => None,
        }
    }

    pub(super) async fn diff(
        &self,
        provider: &plugin::VcsPluginConfig,
        workspace: &Path,
        path: &Path,
    ) -> Result<VcsDiff, VcsError> {
        match self {
            Self::Native(snapshot) => {
                let file = find_snapshot_file(snapshot, path)
                    .ok_or_else(|| VcsError::FileNotChanged(path.to_path_buf()))?;
                plugin::diff(
                    provider,
                    workspace,
                    file,
                    &snapshot.snapshot_id,
                    VcsScope::Uncommitted,
                )
                .await
                .map_err(|error| VcsError::Plugin(format!("{}: {error}", provider.id)))
            }
            Self::Composed {
                snapshot,
                staged,
                unstaged,
            } => {
                let file = find_snapshot_file(snapshot, path)
                    .ok_or_else(|| VcsError::FileNotChanged(path.to_path_buf()))?;
                let mut pieces = Vec::with_capacity(2);
                for component in [staged, unstaged] {
                    if let Some(component_file) = find_snapshot_file(component, &file.path) {
                        let piece = plugin::diff(
                            provider,
                            workspace,
                            component_file,
                            &component.snapshot_id,
                            component.scope,
                        )
                        .await
                        .map_err(|error| VcsError::Plugin(format!("{}: {error}", provider.id)))?;
                        pieces.push(piece);
                    }
                }
                let staged_revision = pieces
                    .iter()
                    .find(|piece| piece.scope == VcsScope::Staged)
                    .map_or(staged.snapshot_id.as_str(), |piece| {
                        piece.snapshot_id.as_str()
                    });
                let unstaged_revision = pieces
                    .iter()
                    .find(|piece| piece.scope == VcsScope::Unstaged)
                    .map_or(unstaged.snapshot_id.as_str(), |piece| {
                        piece.snapshot_id.as_str()
                    });
                Ok(composed_diff(
                    snapshot,
                    file,
                    &pieces,
                    &combined_revision(staged_revision, unstaged_revision),
                ))
            }
        }
    }
}

pub(super) async fn resolve(
    provider: &plugin::VcsPluginConfig,
    workspace: &Path,
) -> Result<Resolved, plugin::PluginCallError> {
    // The first supported scope both resolves ownership and discovers whether
    // a newer Arc provider already implements the native aggregate.
    let staged = plugin::changes(provider, workspace, VcsScope::Staged).await?;
    if staged.available_scopes.contains(&VcsScope::Uncommitted) {
        return plugin::changes(provider, workspace, VcsScope::Uncommitted)
            .await
            .map(Resolved::Native);
    }
    if !staged.available_scopes.contains(&VcsScope::Unstaged) {
        return Err(plugin::PluginCallError::Protocol(
            "Arc provider does not advertise an aggregate or both component scopes".into(),
        ));
    }
    let unstaged = plugin::changes(provider, workspace, VcsScope::Unstaged).await?;
    let snapshot = compose(&staged, &unstaged)?;
    Ok(Resolved::Composed {
        snapshot,
        staged: Box::new(staged),
        unstaged: Box::new(unstaged),
    })
}

pub(super) fn advertise(snapshot: &mut VcsSnapshot) {
    if snapshot.available_scopes.contains(&VcsScope::Staged)
        && snapshot.available_scopes.contains(&VcsScope::Unstaged)
        && !snapshot.available_scopes.contains(&VcsScope::Uncommitted)
    {
        snapshot.available_scopes.push(VcsScope::Uncommitted);
    }
}

fn compose(
    staged: &VcsSnapshot,
    unstaged: &VcsSnapshot,
) -> Result<VcsSnapshot, plugin::PluginCallError> {
    if staged.repository != unstaged.repository {
        return Err(plugin::PluginCallError::Protocol(
            "Arc component snapshots disagree about repository identity".into(),
        ));
    }
    let mut files = BTreeMap::<&Path, VcsFile>::new();
    for file in &staged.files {
        files.insert(&file.path, file.clone());
    }
    for file in &unstaged.files {
        files
            .entry(&file.path)
            .and_modify(|prior| {
                let staged_additions = prior.additions;
                let staged_deletions = prior.deletions;
                let staged_binary = prior.binary;
                let staged_conflict = prior.conflict.clone();
                let staged_old_path = prior.old_path.clone();
                *prior = file.clone();
                prior.staged = true;
                prior.old_path = staged_old_path.or_else(|| file.old_path.clone());
                prior.additions = sum_counts(staged_additions, file.additions);
                prior.deletions = sum_counts(staged_deletions, file.deletions);
                prior.binary |= staged_binary;
                if prior.conflict.is_none() {
                    prior.conflict = staged_conflict;
                }
                if prior.conflict.is_some() {
                    prior.status = super::VcsFileStatus::Conflicted;
                }
            })
            .or_insert_with(|| file.clone());
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
    let mut available_scopes = staged.available_scopes.clone();
    if !available_scopes.contains(&VcsScope::Uncommitted) {
        available_scopes.push(VcsScope::Uncommitted);
    }
    Ok(VcsSnapshot {
        capability: CHANGES_CAPABILITY.into(),
        repository: staged.repository.clone(),
        scope: VcsScope::Uncommitted,
        available_scopes,
        snapshot_id: combined_revision(&staged.snapshot_id, &unstaged.snapshot_id),
        state,
        summary,
        files,
    })
}

fn sum_counts(left: Option<u64>, right: Option<u64>) -> Option<u64> {
    Some(left?.saturating_add(right?))
}

fn combined_revision(staged_id: &str, unstaged_id: &str) -> String {
    let mut hasher = blake3::Hasher::new();
    hasher.update(staged_id.as_bytes());
    hasher.update(&[0]);
    hasher.update(unstaged_id.as_bytes());
    hasher.finalize().to_hex().to_string()
}

fn composed_diff(
    snapshot: &VcsSnapshot,
    file: &VcsFile,
    pieces: &[VcsDiff],
    revision: &str,
) -> VcsDiff {
    let mut diff = String::new();
    let mut truncated = false;
    for piece in pieces {
        if !diff.is_empty() && !diff.ends_with('\n') && diff.len() < MAX_DIFF_BYTES {
            diff.push('\n');
        }
        let remaining = MAX_DIFF_BYTES.saturating_sub(diff.len());
        let boundary = piece
            .diff
            .floor_char_boundary(remaining.min(piece.diff.len()));
        diff.push_str(&piece.diff[..boundary]);
        truncated |= piece.truncated || boundary < piece.diff.len();
    }
    VcsDiff {
        capability: super::DIFF_CAPABILITY.into(),
        repository: snapshot.repository.clone(),
        scope: VcsScope::Uncommitted,
        snapshot_id: revision.into(),
        file_id: file.id.clone(),
        path: file.path.clone(),
        old_path: file.old_path.clone(),
        status: file.status,
        diff,
        source: None,
        truncated,
        binary: pieces.iter().any(|piece| piece.binary),
        additions: pieces
            .iter()
            .fold(0u64, |sum, piece| sum.saturating_add(piece.additions)),
        deletions: pieces
            .iter()
            .fold(0u64, |sum, piece| sum.saturating_add(piece.deletions)),
    }
}

#[cfg(test)]
#[allow(clippy::expect_used)]
mod tests {
    use std::path::PathBuf;

    use super::*;
    use crate::vcs::{VcsFileStatus, VcsRepository, VcsSummary};

    fn file(path: &str, status: VcsFileStatus, additions: u64) -> VcsFile {
        VcsFile {
            id: path.into(),
            path: PathBuf::from(path),
            old_path: None,
            status,
            staged: false,
            additions: Some(additions),
            deletions: Some(0),
            binary: false,
            conflict: None,
        }
    }

    fn snapshot(scope: VcsScope, id: &str, files: Vec<VcsFile>) -> VcsSnapshot {
        let summary = summarize(&files);
        VcsSnapshot {
            capability: CHANGES_CAPABILITY.into(),
            repository: VcsRepository {
                provider: "arc".into(),
                root: PathBuf::from("/repo"),
                branch: Some("feature".into()),
                head: Some("head".into()),
                base: None,
            },
            scope,
            available_scopes: vec![VcsScope::Staged, VcsScope::Unstaged, VcsScope::Branch],
            snapshot_id: id.into(),
            state: VcsState::Dirty,
            summary,
            files,
        }
    }

    #[test]
    fn staged_and_unstaged_are_deduplicated_without_losing_both_counts() {
        let staged = snapshot(
            VcsScope::Staged,
            "stage-1",
            vec![
                file("/repo/both", VcsFileStatus::Modified, 2),
                file("/repo/staged", VcsFileStatus::Added, 1),
            ],
        );
        let unstaged = snapshot(
            VcsScope::Unstaged,
            "work-1",
            vec![
                file("/repo/both", VcsFileStatus::Modified, 3),
                file("/repo/untracked", VcsFileStatus::Untracked, 4),
            ],
        );
        let combined = compose(&staged, &unstaged).expect("compatible snapshots");
        assert_eq!(combined.scope, VcsScope::Uncommitted);
        assert_eq!(
            combined.summary,
            VcsSummary {
                total: 3,
                added: 1,
                modified: 1,
                untracked: 1,
                ..VcsSummary::default()
            }
        );
        assert!(combined.available_scopes.contains(&VcsScope::Uncommitted));
        let both = combined
            .files
            .iter()
            .find(|file| file.path == Path::new("/repo/both"))
            .expect("deduplicated file");
        assert_eq!(both.additions, Some(5));
        assert!(both.staged);
        let different_revision = compose(
            &staged,
            &snapshot(VcsScope::Unstaged, "work-2", unstaged.files),
        )
        .expect("compatible snapshots");
        assert_ne!(combined.snapshot_id, different_revision.snapshot_id);
    }

    #[test]
    fn aggregate_diff_keeps_both_patches_in_stage_order() {
        let snapshot = snapshot(
            VcsScope::Uncommitted,
            "combined",
            vec![file("/repo/both", VcsFileStatus::Modified, 5)],
        );
        let file = &snapshot.files[0];
        let pieces = [
            VcsDiff {
                capability: super::super::DIFF_CAPABILITY.into(),
                repository: snapshot.repository.clone(),
                scope: VcsScope::Staged,
                snapshot_id: "stage-1".into(),
                file_id: file.id.clone(),
                path: file.path.clone(),
                old_path: None,
                status: file.status,
                diff: "diff --git a/both b/both\n+staged\n".into(),
                source: None,
                truncated: false,
                binary: false,
                additions: 1,
                deletions: 0,
            },
            VcsDiff {
                capability: super::super::DIFF_CAPABILITY.into(),
                repository: snapshot.repository.clone(),
                scope: VcsScope::Unstaged,
                snapshot_id: "work-1".into(),
                file_id: file.id.clone(),
                path: file.path.clone(),
                old_path: None,
                status: file.status,
                diff: "diff --git a/both b/both\n+unstaged\n".into(),
                source: None,
                truncated: false,
                binary: false,
                additions: 1,
                deletions: 0,
            },
        ];
        let revision = combined_revision("stage-1", "work-1");
        let diff = composed_diff(&snapshot, file, &pieces, &revision);
        assert!(
            diff.diff.find("staged").expect("staged")
                < diff.diff.find("unstaged").expect("unstaged")
        );
        assert_eq!(diff.scope, VcsScope::Uncommitted);
        assert_eq!(diff.additions, 2);
        assert_eq!(diff.snapshot_id, revision);
    }

    #[test]
    fn native_scope_is_not_added_twice() {
        let mut snapshot = snapshot(VcsScope::Branch, "branch", Vec::new());
        advertise(&mut snapshot);
        advertise(&mut snapshot);
        assert_eq!(
            snapshot
                .available_scopes
                .iter()
                .filter(|scope| **scope == VcsScope::Uncommitted)
                .count(),
            1
        );
    }
}
