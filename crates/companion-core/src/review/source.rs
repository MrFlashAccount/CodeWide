//! Review targets: a `DiffSource` is what a review looks at, never a change
//! source of a thread. A pull request never joins `ThreadChangeScope`.
//!
//! `DiffCatalogSource` is the seam with three implementations: forge pull
//! request files (in `crate::forge`), VCS diffs and session/turn resources
//! (in `catalogs.rs`). The review context depends only on this trait, so it
//! never imports the forge.

use std::{collections::HashMap, sync::Arc};

use async_trait::async_trait;
use serde::{Deserialize, Serialize};

use super::{ReviewError, hunks::ParsedHunk};

#[derive(Clone, Debug, Deserialize, Eq, Hash, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TurnResource {
    pub turn_id: String,
}

/// `"session" | "lastTurn" | { turnId }`.
#[derive(Clone, Debug, Deserialize, Eq, Hash, PartialEq, Serialize)]
#[serde(untagged)]
pub enum SessionResource {
    Named(NamedResource),
    Turn(TurnResource),
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, Hash, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum NamedResource {
    Session,
    LastTurn,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, Hash, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum VcsReviewScope {
    Staged,
    Unstaged,
    Uncommitted,
    Branch,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, Hash, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum SourceKind {
    Session,
    Vcs,
    PullRequest,
}

#[derive(Clone, Debug, Deserialize, Eq, Hash, PartialEq, Serialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum DiffSource {
    Session {
        thread_id: String,
        resource: SessionResource,
    },
    Vcs {
        workspace: String,
        scope: VcsReviewScope,
    },
    PullRequest {
        /// The companion-issued `PullRequestKey`, opaque to this context.
        pull_request: String,
    },
}

impl DiffSource {
    #[must_use]
    pub fn kind(&self) -> SourceKind {
        match self {
            Self::Session { .. } => SourceKind::Session,
            Self::Vcs { .. } => SourceKind::Vcs,
            Self::PullRequest { .. } => SourceKind::PullRequest,
        }
    }

    /// Validates a client source.
    ///
    /// # Errors
    ///
    /// Returns invalid params for empty or control-character ids and a
    /// relative workspace.
    pub fn validate(&self) -> Result<(), ReviewError> {
        let text = |value: &str| {
            !value.is_empty() && value.len() <= 4_096 && !value.chars().any(char::is_control)
        };
        let valid = match self {
            Self::Session {
                thread_id,
                resource,
            } => {
                text(thread_id)
                    && match resource {
                        SessionResource::Named(_) => true,
                        SessionResource::Turn(turn) => text(&turn.turn_id),
                    }
            }
            Self::Vcs { workspace, .. } => text(workspace) && workspace.starts_with('/'),
            Self::PullRequest { pull_request } => text(pull_request),
        };
        if valid {
            Ok(())
        } else {
            Err(ReviewError::Invalid("invalid diff source".into()))
        }
    }

    /// A stable storage key: blake3 of the canonical JSON.
    #[must_use]
    pub fn storage_key(&self) -> String {
        let canonical = serde_json::to_vec(self).unwrap_or_default();
        blake3::hash(&canonical).to_hex().to_string()
    }

    /// The owning thread of a session source.
    #[must_use]
    pub fn session_thread(&self) -> Option<&str> {
        match self {
            Self::Session { thread_id, .. } => Some(thread_id),
            _ => None,
        }
    }
}

/// A source at one revision: a snapshot id, a turn id or a head revision.
#[derive(Clone, Debug, Deserialize, Eq, Hash, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DiffSourceRevision {
    pub source: DiffSource,
    pub revision: String,
}

/// One file of a catalog with its parsed hunks.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct CatalogFile {
    pub path: String,
    pub hunks: Vec<ParsedHunk>,
}

/// Every hunk of a source at its current revision.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct DiffCatalog {
    pub revision: String,
    pub files: Vec<CatalogFile>,
}

impl DiffCatalog {
    #[must_use]
    pub fn hunk_count(&self) -> usize {
        self.files.iter().map(|file| file.hunks.len()).sum()
    }

    /// Hunks by fingerprint, for re-anchoring drafts and re-matching stops.
    #[must_use]
    pub fn by_fingerprint(&self) -> HashMap<String, Vec<&ParsedHunk>> {
        let mut index: HashMap<String, Vec<&ParsedHunk>> = HashMap::new();
        for file in &self.files {
            for hunk in &file.hunks {
                index
                    .entry(hunk.hunk.fingerprint.as_str().to_owned())
                    .or_default()
                    .push(hunk);
            }
        }
        index
    }
}

/// Produces the hunk catalog of one source kind.
#[async_trait]
pub trait DiffCatalogSource: Send + Sync {
    /// The catalog at the source's current revision.
    ///
    /// # Errors
    ///
    /// Returns the source failure (a forge, VCS or resource error).
    async fn catalog(&self, source: &DiffSource) -> Result<DiffCatalog, ReviewError>;

    /// The source's current revision without its hunks. A source whose
    /// revision is cheaper than its catalog (a pull request's head revision
    /// is in its overview, while the catalog pages every file) overrides
    /// this; the default reads the catalog.
    ///
    /// # Errors
    ///
    /// Returns the source failure.
    async fn revision(&self, source: &DiffSource) -> Result<String, ReviewError> {
        self.catalog(source).await.map(|catalog| catalog.revision)
    }

    /// A short identity of the source for agent inputs (no third-party
    /// prose such as titles or descriptions).
    async fn describe(&self, source: &DiffSource) -> String;
}

/// The registered catalog sources by kind; the forge registers its own
/// after construction, so `review` never names it.
#[derive(Clone, Default)]
pub struct CatalogSources {
    sources: Arc<std::sync::RwLock<HashMap<SourceKind, Arc<dyn DiffCatalogSource>>>>,
}

impl CatalogSources {
    pub fn register(&self, kind: SourceKind, source: Arc<dyn DiffCatalogSource>) {
        match self.sources.write() {
            Ok(mut sources) => {
                sources.insert(kind, source);
            }
            Err(poisoned) => {
                poisoned.into_inner().insert(kind, source);
            }
        }
    }

    /// The catalog of a source at its current revision.
    ///
    /// # Errors
    ///
    /// Returns `-32084` when no source of that kind is registered, or the
    /// source failure.
    pub async fn catalog(&self, source: &DiffSource) -> Result<DiffCatalog, ReviewError> {
        self.provider(source)?.catalog(source).await
    }

    /// The current revision of a source ([`DiffCatalogSource::revision`]).
    ///
    /// # Errors
    ///
    /// Returns `-32084` when no source of that kind is registered, or the
    /// source failure.
    pub async fn revision(&self, source: &DiffSource) -> Result<String, ReviewError> {
        self.provider(source)?.revision(source).await
    }

    fn provider(&self, source: &DiffSource) -> Result<Arc<dyn DiffCatalogSource>, ReviewError> {
        self.sources
            .read()
            .ok()
            .and_then(|sources| sources.get(&source.kind()).cloned())
            .ok_or_else(|| {
                ReviewError::Unavailable(
                    "this diff source is not available on this companion".into(),
                )
            })
    }

    /// A short identity of a source, or a generic one when its kind has no
    /// registered catalog.
    pub async fn describe(&self, source: &DiffSource) -> String {
        let provider = self
            .sources
            .read()
            .ok()
            .and_then(|sources| sources.get(&source.kind()).cloned());
        match provider {
            Some(provider) => provider.describe(source).await,
            None => generic_description(source),
        }
    }
}

/// The source identity without any catalog: thread, workspace or key.
#[must_use]
pub fn generic_description(source: &DiffSource) -> String {
    match source {
        DiffSource::Session { thread_id, .. } => format!("the changes of thread {thread_id}"),
        DiffSource::Vcs { workspace, scope } => {
            format!(
                "the {} changes in {workspace}",
                serde_json::to_value(scope)
                    .ok()
                    .and_then(|value| value.as_str().map(str::to_owned))
                    .unwrap_or_default()
            )
        }
        DiffSource::PullRequest { .. } => "a pull request".to_owned(),
    }
}

#[cfg(test)]
#[allow(clippy::expect_used)]
mod tests {
    use serde_json::json;

    use super::*;

    #[test]
    fn diff_sources_parse_every_contract_shape() {
        for value in [
            json!({"kind": "session", "threadId": "t", "resource": "session"}),
            json!({"kind": "session", "threadId": "t", "resource": "lastTurn"}),
            json!({"kind": "session", "threadId": "t", "resource": {"turnId": "u"}}),
            json!({"kind": "vcs", "workspace": "/w", "scope": "branch"}),
            json!({"kind": "pullRequest", "pullRequest": "fpr1.x"}),
        ] {
            let source: DiffSource = serde_json::from_value(value.clone()).expect("parses");
            source.validate().expect("valid");
            assert_eq!(serde_json::to_value(&source).expect("encodes"), value);
        }
        let relative: DiffSource =
            serde_json::from_value(json!({"kind": "vcs", "workspace": "w", "scope": "branch"}))
                .expect("parses");
        assert!(relative.validate().is_err());
        assert!(
            serde_json::from_value::<DiffSource>(
                json!({"kind": "pullRequest", "pullRequest": "x", "extra": 1})
            )
            .is_err()
        );
    }
}
