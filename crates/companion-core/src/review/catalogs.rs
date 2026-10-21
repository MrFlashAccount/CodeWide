//! The VCS and session/turn implementations of `DiffCatalogSource`.
//!
//! - VCS: the workspace's VCS provider snapshot (`snapshotId` is the
//!   revision) and one diff per changed text file.
//! - Session: the thread's change resources (`companion/threadChanges/read`
//!   and `companion/threadChange/read`); a `{turnId}` resource keeps only
//!   that turn's patches and uses the turn id as its revision.

use std::{path::Path, sync::Arc};

use async_trait::async_trait;
use serde_json::{Value, json};

use super::{
    ReviewError,
    hunks::{HunkId, ParsedHunk, parse_patch},
    source::{
        CatalogFile, DiffCatalog, DiffCatalogSource, DiffSource, NamedResource, SessionResource,
        VcsReviewScope,
    },
};
use crate::{
    agent::provider::NativeThreadResources,
    vcs::{VcsScope, VcsService},
};

/// Finds the resource store that answers a thread.
#[async_trait]
pub trait ThreadResourcesLookup: Send + Sync {
    async fn resources(&self, thread_id: &str) -> Option<Arc<dyn NativeThreadResources>>;
}

pub struct VcsCatalog {
    vcs: Arc<VcsService>,
}

impl VcsCatalog {
    #[must_use]
    pub fn new(vcs: Arc<VcsService>) -> Self {
        Self { vcs }
    }
}

fn vcs_scope(scope: VcsReviewScope) -> VcsScope {
    match scope {
        VcsReviewScope::Staged => VcsScope::Staged,
        VcsReviewScope::Unstaged => VcsScope::Unstaged,
        VcsReviewScope::Uncommitted => VcsScope::Uncommitted,
        VcsReviewScope::Branch => VcsScope::Branch,
    }
}

#[async_trait]
impl DiffCatalogSource for VcsCatalog {
    async fn catalog(&self, source: &DiffSource) -> Result<DiffCatalog, ReviewError> {
        let DiffSource::Vcs { workspace, scope } = source else {
            return Err(ReviewError::Invalid("not a VCS source".into()));
        };
        let workspace = Path::new(workspace);
        let scope = vcs_scope(*scope);
        let snapshot = self
            .vcs
            .changes(workspace, scope)
            .await
            .map_err(|error| ReviewError::Source(error.to_string()))?;
        let mut files = Vec::new();
        for file in snapshot.files.iter().filter(|file| !file.binary) {
            let diff = self
                .vcs
                .diff(workspace, &file.path, scope)
                .await
                .map_err(|error| ReviewError::Source(error.to_string()))?;
            let path = file.path.display().to_string();
            files.push(CatalogFile {
                hunks: parse_patch(&path, &diff.diff),
                path,
            });
        }
        Ok(DiffCatalog {
            revision: snapshot.snapshot_id,
            files,
        })
    }

    async fn describe(&self, source: &DiffSource) -> String {
        super::source::generic_description(source)
    }
}

pub struct SessionCatalog {
    lookup: Arc<dyn ThreadResourcesLookup>,
}

impl SessionCatalog {
    #[must_use]
    pub fn new(lookup: Arc<dyn ThreadResourcesLookup>) -> Self {
        Self { lookup }
    }
}

#[async_trait]
impl DiffCatalogSource for SessionCatalog {
    async fn catalog(&self, source: &DiffSource) -> Result<DiffCatalog, ReviewError> {
        let DiffSource::Session {
            thread_id,
            resource,
        } = source
        else {
            return Err(ReviewError::Invalid("not a session source".into()));
        };
        let resources = self
            .lookup
            .resources(thread_id)
            .await
            .ok_or_else(|| ReviewError::Unavailable("thread changes are unavailable".into()))?;
        let (scope, turn) = match resource {
            SessionResource::Named(NamedResource::Session) => ("session", None),
            SessionResource::Named(NamedResource::LastTurn) => ("lastTurn", None),
            SessionResource::Turn(turn) => ("session", Some(turn.turn_id.as_str())),
        };
        let listed = resources
            .read(
                "companion/threadChanges/read",
                &json!({"threadId": thread_id, "changeScope": scope}),
            )
            .await
            .map_err(ReviewError::Source)?;
        let revision = match turn {
            Some(turn) => turn.to_owned(),
            None => listed
                .get("revision")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_owned(),
        };
        let paths: Vec<String> = listed
            .get("changes")
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
            .filter_map(|change| {
                change
                    .get("path")
                    .and_then(Value::as_str)
                    .map(str::to_owned)
            })
            .collect();
        let mut files = Vec::new();
        for path in paths {
            let change = resources
                .read(
                    "companion/threadChange/read",
                    &json!({"threadId": thread_id, "path": path, "changeScope": scope}),
                )
                .await
                .map_err(ReviewError::Source)?;
            let mut hunks: Vec<ParsedHunk> = Vec::new();
            for patch in change
                .get("patches")
                .and_then(Value::as_array)
                .into_iter()
                .flatten()
                .filter(|patch| {
                    turn.is_none_or(|turn| {
                        patch.get("turnId").and_then(Value::as_str) == Some(turn)
                    })
                })
            {
                let diff = patch
                    .get("diff")
                    .and_then(Value::as_str)
                    .unwrap_or_default();
                hunks.extend(parse_patch(&path, diff));
            }
            // Ordinals run across every patch of the path.
            for (index, hunk) in hunks.iter_mut().enumerate() {
                hunk.hunk.ordinal = index + 1;
                hunk.hunk.id = HunkId::new(&path, index + 1);
            }
            if !hunks.is_empty() {
                files.push(CatalogFile { path, hunks });
            }
        }
        Ok(DiffCatalog { revision, files })
    }

    async fn describe(&self, source: &DiffSource) -> String {
        super::source::generic_description(source)
    }
}
