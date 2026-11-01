//! Draft comments and their independent delivery axes.
//!
//! A draft's destination decides which axes exist: `agent` (any source),
//! `pr` and `both` (pull request sources only, rejected otherwise). Axis
//! transitions:
//!
//! - agent: `pending → sent` (Send to agent, Submit with forwarding, or the
//!   composer's acknowledgement for session/VCS sources), `pending → failed`
//!   (queue rejected), `failed → pending` (retry);
//! - pr: `pending → submitting → published | failed | outdated`, `failed →
//!   submitting` (retry), `pending → outdated` (new head, fingerprint gone),
//!   `outdated → pending` (the user re-anchors).
//!
//! `published` and `sent` are terminal; a published draft is read-only. A
//! companion restart during `submitting` reopens the draft as `failed` with
//! `outcomeUnknown`; the action journal then decides whether a retry may
//! write. Every write bumps `version`; a write with a stale
//! `expectedVersion` returns `-32088` with the current draft.

use std::{
    collections::HashSet,
    sync::{Arc, Mutex},
};

use serde::{Deserialize, Serialize};

use super::{
    ReviewError,
    hunks::{HunkFingerprint, HunkId},
    source::{DiffCatalog, DiffSourceRevision, SourceKind},
};
use crate::store::{IndexStore, kv::KvOp, review_tables::REVIEW_DRAFTS};

const MAX_BODY_CHARS: usize = 65_536;
const RECORD_VERSION: u32 = 1;

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Side {
    New,
    Old,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AnchorHunk {
    pub id: HunkId,
    pub fingerprint: HunkFingerprint,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DraftAnchor {
    pub path: String,
    pub side: Side,
    pub start_line: u32,
    pub end_line: u32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub hunk: Option<AnchorHunk>,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum AgentState {
    Pending,
    Sent,
    Failed,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentAxis {
    pub state: AgentState,
    pub target_thread_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum PrState {
    Pending,
    Submitting,
    Published,
    Failed,
    Outdated,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PrAxis {
    pub state: PrState,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum Author {
    User,
    Agent { thread_id: String },
}

/// The destination and its axes; only these three shapes exist.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(tag = "destination", rename_all = "camelCase")]
pub enum Routing {
    Agent { agent: AgentAxis },
    Pr { pr: PrAxis },
    Both { agent: AgentAxis, pr: PrAxis },
}

impl Routing {
    #[must_use]
    pub fn agent(&self) -> Option<&AgentAxis> {
        match self {
            Self::Agent { agent } | Self::Both { agent, .. } => Some(agent),
            Self::Pr { .. } => None,
        }
    }

    #[must_use]
    pub fn pr(&self) -> Option<&PrAxis> {
        match self {
            Self::Pr { pr } | Self::Both { pr, .. } => Some(pr),
            Self::Agent { .. } => None,
        }
    }

    fn agent_mut(&mut self) -> Option<&mut AgentAxis> {
        match self {
            Self::Agent { agent } | Self::Both { agent, .. } => Some(agent),
            Self::Pr { .. } => None,
        }
    }

    fn pr_mut(&mut self) -> Option<&mut PrAxis> {
        match self {
            Self::Pr { pr } | Self::Both { pr, .. } => Some(pr),
            Self::Agent { .. } => None,
        }
    }
}

/// A draft as clients see it. `sourceKind` is derived from the revision's
/// source when serialized.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DraftComment {
    pub id: String,
    pub revision: DiffSourceRevision,
    pub anchor: DraftAnchor,
    pub body: String,
    pub author: Author,
    pub created_at: String,
    pub updated_at: String,
    pub version: u64,
    pub source_kind: SourceKind,
    #[serde(flatten)]
    pub routing: Routing,
}

impl DraftComment {
    /// Whether a client may still edit or delete the draft.
    #[must_use]
    pub fn editable(&self) -> bool {
        let published = self
            .routing
            .pr()
            .is_some_and(|pr| matches!(pr.state, PrState::Published | PrState::Submitting));
        let sent_agent_only =
            matches!(&self.routing, Routing::Agent { agent } if agent.state == AgentState::Sent);
        !published && !sent_agent_only
    }

    fn matches_input(&self, input: &DraftInput) -> bool {
        let routing_matches = match (&self.routing, input.destination) {
            (Routing::Pr { .. }, Destination::Pr) => input.target_thread_id.is_none(),
            (Routing::Agent { agent }, Destination::Agent)
            | (Routing::Both { agent, .. }, Destination::Both) => {
                input.target_thread_id.as_deref() == Some(agent.target_thread_id.as_str())
            }
            _ => false,
        };
        self.id == input.id
            && self.revision == input.revision
            && self.anchor == input.anchor
            && self.body == input.body
            && routing_matches
    }
}

/// The stored record: the draft plus where its anchor hunk started, so a
/// moved hunk can shift the anchor's lines.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct StoredDraft {
    record_version: u32,
    draft: DraftComment,
    hunk_origin: Option<HunkOrigin>,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HunkOrigin {
    pub old_start: u32,
    pub new_start: u32,
}

/// `companion/review/draft/put` input.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DraftInput {
    pub id: String,
    pub revision: DiffSourceRevision,
    pub anchor: DraftAnchor,
    pub body: String,
    pub destination: Destination,
    pub target_thread_id: Option<String>,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Destination {
    Agent,
    Pr,
    Both,
}

impl DraftInput {
    /// Validates the input and builds its routing; `pr` and `both` need a
    /// pull request source, `agent` and `both` a target thread.
    ///
    /// # Errors
    ///
    /// Returns invalid params for any contract violation.
    pub fn routing(&self) -> Result<Routing, ReviewError> {
        self.revision.source.validate()?;
        if !super::valid_uuid(&self.id) {
            return Err(ReviewError::Invalid("invalid draft id".into()));
        }
        if self.body.trim().is_empty() || self.body.chars().count() > MAX_BODY_CHARS {
            return Err(ReviewError::Invalid("invalid draft body".into()));
        }
        if self.revision.revision.is_empty() || self.revision.revision.len() > 512 {
            return Err(ReviewError::Invalid("invalid revision".into()));
        }
        let anchor = &self.anchor;
        if anchor.path.is_empty()
            || anchor.path.len() > 4_096
            || anchor.path.contains('\0')
            || anchor.start_line == 0
            || anchor.end_line < anchor.start_line
        {
            return Err(ReviewError::Invalid("invalid anchor".into()));
        }
        let pull_request = self.revision.source.kind() == SourceKind::PullRequest;
        let target = || {
            self.target_thread_id
                .as_deref()
                .filter(|thread| super::valid_thread_id(thread))
                .map(str::to_owned)
                .ok_or_else(|| ReviewError::Invalid("targetThreadId is required".into()))
        };
        let agent = || -> Result<AgentAxis, ReviewError> {
            Ok(AgentAxis {
                state: AgentState::Pending,
                target_thread_id: target()?,
                error: None,
            })
        };
        let pr = PrAxis {
            state: PrState::Pending,
            error: None,
        };
        match self.destination {
            Destination::Agent => Ok(Routing::Agent { agent: agent()? }),
            Destination::Pr if pull_request && self.target_thread_id.is_none() => {
                Ok(Routing::Pr { pr })
            }
            Destination::Both if pull_request => Ok(Routing::Both {
                agent: agent()?,
                pr,
            }),
            _ => Err(ReviewError::Invalid(
                "this destination is not valid for this source".into(),
            )),
        }
    }
}

/// The draft store over `review_drafts`.
#[derive(Clone)]
pub struct DraftStore {
    store: Arc<IndexStore>,
    /// Drafts whose Submit runs in this process.
    submitting: Arc<Mutex<HashSet<String>>>,
    /// Serializes every read-modify-write of `review_drafts`, so a version
    /// check and its write are one step and two writers never interleave.
    writes: Arc<Mutex<()>>,
}

fn key(source_key: &str, draft_id: &str) -> String {
    format!("{source_key}\0{draft_id}")
}

impl DraftStore {
    #[must_use]
    pub fn new(store: Arc<IndexStore>) -> Self {
        Self {
            store,
            submitting: Arc::default(),
            writes: Arc::default(),
        }
    }

    fn serialized<T>(
        &self,
        step: impl FnOnce() -> Result<T, ReviewError>,
    ) -> Result<T, ReviewError> {
        let _guard = self
            .writes
            .lock()
            .map_err(|_| ReviewError::Internal("the draft store is unavailable".into()))?;
        step()
    }

    fn all_stored(&self, prefix: &str) -> Result<Vec<(String, StoredDraft)>, ReviewError> {
        Ok(self
            .store
            .kv_scan(REVIEW_DRAFTS, prefix)?
            .into_iter()
            .filter_map(|(key, value)| Some((key, serde_json::from_slice(&value).ok()?)))
            .collect())
    }

    fn find(&self, draft_id: &str) -> Result<Option<(String, StoredDraft)>, ReviewError> {
        Ok(self
            .all_stored("")?
            .into_iter()
            .find(|(_, stored)| stored.draft.id == draft_id))
    }

    fn write(&self, entries: &[(String, StoredDraft)]) -> Result<(), ReviewError> {
        let ops = entries
            .iter()
            .map(|(key, stored)| {
                Ok(KvOp::Put {
                    table: REVIEW_DRAFTS,
                    key: key.clone(),
                    value: serde_json::to_vec(stored)
                        .map_err(|error| ReviewError::Internal(error.to_string()))?,
                })
            })
            .collect::<Result<Vec<_>, ReviewError>>()?;
        self.store.kv_apply(ops)?;
        Ok(())
    }

    /// Drafts of one source, any revision, oldest first. A `submitting` axis
    /// left by an earlier process is reopened as failed `outcomeUnknown`.
    ///
    /// # Errors
    ///
    /// Returns a storage failure.
    pub fn list(&self, source_key: &str) -> Result<Vec<DraftComment>, ReviewError> {
        self.serialized(|| self.list_locked(source_key))
    }

    fn list_locked(&self, source_key: &str) -> Result<Vec<DraftComment>, ReviewError> {
        let mut entries = self.all_stored(&format!("{source_key}\0"))?;
        let in_flight = self
            .submitting
            .lock()
            .map(|set| set.clone())
            .unwrap_or_default();
        let mut reopened = Vec::new();
        for (key, stored) in &mut entries {
            if let Some(pr) = stored.draft.routing.pr_mut()
                && pr.state == PrState::Submitting
                && !in_flight.contains(&stored.draft.id)
            {
                pr.state = PrState::Failed;
                pr.error = Some("outcomeUnknown".into());
                stored.draft.version += 1;
                reopened.push((key.clone(), stored.clone()));
            }
        }
        if !reopened.is_empty() {
            self.write(&reopened)?;
        }
        let mut drafts: Vec<DraftComment> = entries
            .into_iter()
            .map(|(_, stored)| stored.draft)
            .collect();
        drafts.sort_by(|left, right| {
            left.created_at
                .cmp(&right.created_at)
                .then(left.id.cmp(&right.id))
        });
        Ok(drafts)
    }

    /// Creates or edits a draft.
    ///
    /// # Errors
    ///
    /// Returns invalid params for an invalid input, `-32088` for a version
    /// mismatch or a read-only draft, and a storage failure.
    pub fn put(
        &self,
        input: &DraftInput,
        expected_version: Option<u64>,
        author: Author,
        origin: Option<HunkOrigin>,
        now: &str,
    ) -> Result<DraftComment, ReviewError> {
        self.serialized(|| self.put_locked(input, expected_version, author, origin, now))
    }

    fn put_locked(
        &self,
        input: &DraftInput,
        expected_version: Option<u64>,
        author: Author,
        origin: Option<HunkOrigin>,
        now: &str,
    ) -> Result<DraftComment, ReviewError> {
        let routing = input.routing()?;
        let source_key = input.revision.source.storage_key();
        let existing = self.find(&input.id)?;
        if let Some((existing_key, stored)) = &existing {
            let replayed_version = match expected_version {
                Some(version) => version.checked_add(1),
                None => Some(1),
            };
            if *existing_key == key(&source_key, &input.id)
                && Some(stored.draft.version) == replayed_version
                && stored.draft.editable()
                && stored.draft.matches_input(input)
            {
                return Ok(stored.draft.clone());
            }
        }
        let (created_at, version, author) = match (&existing, expected_version) {
            (None, None) => (now.to_owned(), 1, author),
            (None, Some(_)) => return Err(ReviewError::NotFound),
            (Some((existing_key, stored)), Some(expected)) => {
                if *existing_key != key(&source_key, &input.id) {
                    return Err(ReviewError::Invalid(
                        "a draft cannot move to another source".into(),
                    ));
                }
                if stored.draft.version != expected || !stored.draft.editable() {
                    return Err(ReviewError::Conflict(Box::new(stored.draft.clone())));
                }
                (
                    stored.draft.created_at.clone(),
                    stored.draft.version + 1,
                    stored.draft.author.clone(),
                )
            }
            (Some((_, stored)), None) => {
                return Err(ReviewError::Conflict(Box::new(stored.draft.clone())));
            }
        };
        let routing = keep_sent_agent(existing.as_ref().map(|(_, stored)| &stored.draft), routing);
        let draft = DraftComment {
            id: input.id.clone(),
            revision: input.revision.clone(),
            anchor: input.anchor.clone(),
            body: input.body.clone(),
            // A user edit makes an agent remark the user's.
            author: if existing.is_some() {
                Author::User
            } else {
                author
            },
            created_at,
            updated_at: now.to_owned(),
            version,
            source_kind: input.revision.source.kind(),
            routing,
        };
        self.write(&[(
            key(&source_key, &input.id),
            StoredDraft {
                record_version: RECORD_VERSION,
                draft: draft.clone(),
                hunk_origin: origin,
            },
        )])?;
        Ok(draft)
    }

    /// Deletes an editable draft at the expected version.
    ///
    /// # Errors
    ///
    /// Returns `-32088` for a missing draft, a version mismatch or a
    /// read-only draft.
    pub fn delete(&self, draft_id: &str, expected_version: u64) -> Result<(), ReviewError> {
        self.serialized(|| {
            let (key, stored) = self.find(draft_id)?.ok_or(ReviewError::NotFound)?;
            if stored.draft.version != expected_version || !stored.draft.editable() {
                return Err(ReviewError::Conflict(Box::new(stored.draft)));
            }
            self.store.kv_apply(vec![KvOp::Delete {
                table: REVIEW_DRAFTS,
                key,
            }])?;
            Ok(())
        })
    }

    /// Loads drafts by id.
    ///
    /// # Errors
    ///
    /// Returns `-32088` notFound when any id is unknown.
    pub fn load(&self, draft_ids: &[String]) -> Result<Vec<DraftComment>, ReviewError> {
        let entries = self.all_stored("")?;
        draft_ids
            .iter()
            .map(|id| {
                entries
                    .iter()
                    .find(|(_, stored)| stored.draft.id == *id)
                    .map(|(_, stored)| stored.draft.clone())
                    .ok_or(ReviewError::NotFound)
            })
            .collect()
    }

    /// Applies `change(draftId, axes)` to each draft in one transaction and returns
    /// the updated drafts.
    ///
    /// # Errors
    ///
    /// Returns `-32088` for an unknown id or a storage failure.
    pub fn update_axes(
        &self,
        draft_ids: &[String],
        now: &str,
        change: impl FnMut(&str, &mut Routing),
    ) -> Result<Vec<DraftComment>, ReviewError> {
        self.serialized(|| self.update_axes_locked(draft_ids, now, change))
    }

    fn update_axes_locked(
        &self,
        draft_ids: &[String],
        now: &str,
        mut change: impl FnMut(&str, &mut Routing),
    ) -> Result<Vec<DraftComment>, ReviewError> {
        let entries = self.all_stored("")?;
        let mut updated = Vec::new();
        for id in draft_ids {
            let (key, mut stored) = entries
                .iter()
                .find(|(_, stored)| stored.draft.id == *id)
                .cloned()
                .ok_or(ReviewError::NotFound)?;
            let before = stored.draft.routing.clone();
            change(id, &mut stored.draft.routing);
            if stored.draft.routing != before {
                stored.draft.version += 1;
                now.clone_into(&mut stored.draft.updated_at);
            }
            updated.push((key, stored));
        }
        self.write(&updated)?;
        Ok(updated
            .into_iter()
            .map(|(_, stored)| stored.draft)
            .collect())
    }

    /// Claims drafts for one Submit in a single serialized step: each must
    /// be a draft of `pull_request` at `revision` whose PR axis is pending or
    /// failed. The claim moves every axis to `submitting` and returns the
    /// snapshot the forge publishes; a draft another Submit or an edit got
    /// to first answers `-32088` with its current state, and nothing moves.
    ///
    /// # Errors
    ///
    /// Returns `-32088` for a missing or concurrently changed draft and
    /// invalid params for a draft of another source or without a PR axis.
    pub fn claim_for_submit(
        &self,
        draft_ids: &[String],
        pull_request: &str,
        revision: &str,
        now: &str,
    ) -> Result<Vec<DraftComment>, ReviewError> {
        let mut distinct = HashSet::with_capacity(draft_ids.len());
        if !draft_ids.iter().all(|id| distinct.insert(id.as_str())) {
            return Err(ReviewError::Invalid("a draft is claimed twice".into()));
        }
        self.serialized(|| {
            let entries = self.all_stored("")?;
            let mut claimed = Vec::with_capacity(draft_ids.len());
            for id in draft_ids {
                let (key, mut stored) = entries
                    .iter()
                    .find(|(_, stored)| stored.draft.id == *id)
                    .cloned()
                    .ok_or(ReviewError::NotFound)?;
                let same_pull_request = matches!(
                    &stored.draft.revision.source,
                    super::source::DiffSource::PullRequest { pull_request: candidate } if candidate == pull_request
                );
                if !same_pull_request {
                    return Err(ReviewError::Invalid(
                        "every draft must belong to this pull request".into(),
                    ));
                }
                if stored.draft.revision.revision != revision {
                    return Err(ReviewError::Conflict(Box::new(stored.draft)));
                }
                let current = stored.draft.clone();
                let Some(pr) = stored.draft.routing.pr_mut() else {
                    return Err(ReviewError::Invalid(
                        "agent-only drafts are never submitted".into(),
                    ));
                };
                if !matches!(pr.state, PrState::Pending | PrState::Failed) {
                    return Err(ReviewError::Conflict(Box::new(current)));
                }
                pr.state = PrState::Submitting;
                pr.error = None;
                stored.draft.version += 1;
                now.clone_into(&mut stored.draft.updated_at);
                claimed.push((key, stored));
            }
            if let Ok(mut set) = self.submitting.lock() {
                set.extend(draft_ids.iter().cloned());
            }
            self.write(&claimed)?;
            Ok(claimed.into_iter().map(|(_, stored)| stored.draft).collect())
        })
    }

    pub fn end_submit(&self, draft_ids: &[String]) {
        if let Ok(mut set) = self.submitting.lock() {
            for id in draft_ids {
                set.remove(id);
            }
        }
    }

    /// Moves drafts of older revisions to `catalog`'s revision: a draft whose
    /// anchor hunk fingerprint exists there moves with shifted lines; a
    /// pending PR axis without a match becomes `outdated`. Terminal and
    /// in-flight axes stay on their revision.
    ///
    /// # Errors
    ///
    /// Returns a storage failure.
    pub fn reanchor(
        &self,
        source_key: &str,
        catalog: &DiffCatalog,
        now: &str,
    ) -> Result<(), ReviewError> {
        self.serialized(|| self.reanchor_locked(source_key, catalog, now))
    }

    fn reanchor_locked(
        &self,
        source_key: &str,
        catalog: &DiffCatalog,
        now: &str,
    ) -> Result<(), ReviewError> {
        let entries = self.all_stored(&format!("{source_key}\0"))?;
        let index = catalog.by_fingerprint();
        let mut changed = Vec::new();
        for (key, mut stored) in entries {
            if stored.draft.revision.revision == catalog.revision {
                continue;
            }
            // Published, in-flight and failed axes belong to their revision:
            // a failed one is retried at its head or re-anchored by the user.
            let frozen = stored.draft.routing.pr().is_some_and(|pr| {
                matches!(
                    pr.state,
                    PrState::Published | PrState::Submitting | PrState::Failed
                )
            });
            if frozen {
                continue;
            }
            let matched = stored.draft.anchor.hunk.as_ref().and_then(|hunk| {
                index
                    .get(hunk.fingerprint.as_str())
                    .and_then(|candidates| {
                        candidates
                            .iter()
                            .find(|candidate| {
                                candidate
                                    .hunk
                                    .id
                                    .as_str()
                                    .starts_with(&format!("{}#", stored.draft.anchor.path))
                            })
                            .or_else(|| candidates.first())
                    })
                    .map(|parsed| parsed.hunk.clone())
            });
            if let (Some(hunk), Some(origin)) = (matched, stored.hunk_origin) {
                let delta = match stored.draft.anchor.side {
                    Side::New => i64::from(hunk.new_start) - i64::from(origin.new_start),
                    Side::Old => i64::from(hunk.old_start) - i64::from(origin.old_start),
                };
                let shift = |line: u32| u32::try_from(i64::from(line) + delta).unwrap_or(1).max(1);
                stored.draft.anchor.start_line = shift(stored.draft.anchor.start_line);
                stored.draft.anchor.end_line = shift(stored.draft.anchor.end_line);
                stored.draft.anchor.hunk = Some(AnchorHunk {
                    id: hunk.id.clone(),
                    fingerprint: hunk.fingerprint.clone(),
                });
                stored.hunk_origin = Some(HunkOrigin {
                    old_start: hunk.old_start,
                    new_start: hunk.new_start,
                });
                stored.draft.revision.revision.clone_from(&catalog.revision);
                if let Some(pr) = stored.draft.routing.pr_mut()
                    && pr.state == PrState::Outdated
                {
                    pr.state = PrState::Pending;
                }
            } else {
                let Some(pr) = stored.draft.routing.pr_mut() else {
                    continue;
                };
                if pr.state != PrState::Pending {
                    continue;
                }
                pr.state = PrState::Outdated;
            }
            stored.draft.version += 1;
            now.clone_into(&mut stored.draft.updated_at);
            changed.push((key, stored));
        }
        if !changed.is_empty() {
            self.write(&changed)?;
        }
        Ok(())
    }
}

/// Every put builds fresh axes, so re-anchoring an `outdated` draft returns
/// its PR axis to `pending`; an agent axis already `sent` to the same thread
/// stays `sent` on edit.
fn keep_sent_agent(previous: Option<&DraftComment>, mut routing: Routing) -> Routing {
    if let (Some(previous), Some(agent)) = (
        previous.and_then(|draft| draft.routing.agent()),
        routing.agent_mut(),
    ) && previous.state == AgentState::Sent
        && previous.target_thread_id == agent.target_thread_id
    {
        agent.state = AgentState::Sent;
    }
    routing
}

#[cfg(test)]
mod tests;
