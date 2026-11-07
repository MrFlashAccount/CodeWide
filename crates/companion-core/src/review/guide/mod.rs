//! Agent-written review guides over any diff source.
//!
//! A request sends one turn to the author thread through the durable queue:
//! the guide contract plus an alias catalog `h1..hN` of the current revision
//! with budgeted excerpts, fenced as untrusted text. The final agent message
//! of that turn must hold exactly one fenced `codewide-guide` JSON block.
//! The companion maps aliases back to hunk ids and validates: an unknown or
//! duplicate alias, an empty guide, or a guide over the size caps is
//! rejected with `-32085` and the previous guide is kept. Omitted hunks are
//! appended to `support`.
//!
//! On a newer revision a stop keeps `accepted` or `commented` only if the
//! multiset of its hunk fingerprints still exists; otherwise it becomes
//! `changed`. Hunk ids are remapped by fingerprint. Only the companion sets
//! `changed`.

mod catalog;
mod parse;
#[cfg(test)]
mod tests;

use std::{collections::HashMap, sync::Arc};

use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use tracing::info;

pub use self::{
    catalog::{MAX_EXCERPT_CHARS, MAX_GUIDE_HUNKS},
    parse::{MAX_CHAPTERS, MAX_STOP_TEXT_CHARS, MAX_STOPS},
};
use self::{
    catalog::{alias_catalog, guide_instructions},
    parse::{Remark, parse_guide},
};
use super::{
    ReviewError, ReviewService,
    drafts::{AnchorHunk, Author, Destination, DraftAnchor, DraftInput, HunkOrigin},
    hunks::{HunkFingerprint, HunkId},
    now, params,
    source::{DiffCatalog, DiffSource, DiffSourceRevision},
    valid_thread_id, valid_uuid,
};
use crate::{
    agent_bridge::{AgentBridge, TurnOutcome},
    store::{
        IndexStore,
        kv::KvOp,
        review_tables::{REVIEW_GUIDE_PROGRESS, REVIEW_GUIDES},
    },
    workspaces::WorkspaceAdmission,
};

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum StopState {
    Pending,
    Commented,
    Accepted,
    Changed,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GuideStop {
    pub stop_id: String,
    pub title: String,
    pub summary: String,
    pub prose: Option<String>,
    pub hunk_ids: Vec<HunkId>,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GuideChapter {
    pub chapter_id: String,
    pub title: String,
    pub summary: Option<String>,
    pub stops: Vec<GuideStop>,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReviewGuide {
    pub guide_id: String,
    pub source: DiffSource,
    pub revision: String,
    pub author_thread_id: String,
    pub created_at: String,
    pub title: String,
    pub summary: String,
    pub chapters: Vec<GuideChapter>,
    pub support: Vec<HunkId>,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
struct PendingGuide {
    source: DiffSource,
    request_id: String,
    idempotency_key: String,
    author_thread_id: String,
    revision: String,
    /// `aliases[i]` is the hunk of alias `h{i+1}`.
    aliases: Vec<HunkId>,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
struct LastError {
    code: i64,
    reason: String,
    at: String,
}

/// The stored guide of one source.
#[derive(Clone, Debug, Default, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
struct GuideRecord {
    guide: Option<ReviewGuide>,
    /// Fingerprints of the guide's hunks at the guide's revision.
    fingerprints: HashMap<HunkId, HunkFingerprint>,
    pending: Option<PendingGuide>,
    last_error: Option<LastError>,
}

pub struct GuideService {
    store: Arc<IndexStore>,
    agents: Option<AgentBridge>,
    admission: Option<Arc<WorkspaceAdmission>>,
}

impl GuideService {
    #[must_use]
    pub fn new(
        store: Arc<IndexStore>,
        agents: Option<AgentBridge>,
        admission: Option<Arc<WorkspaceAdmission>>,
    ) -> Self {
        Self {
            store,
            agents,
            admission,
        }
    }

    fn record(&self, source: &DiffSource) -> Result<GuideRecord, ReviewError> {
        Ok(self
            .store
            .kv_get(REVIEW_GUIDES, &source.storage_key())?
            .and_then(|bytes| serde_json::from_slice(&bytes).ok())
            .unwrap_or_default())
    }

    fn save(
        &self,
        source: &DiffSource,
        record: &GuideRecord,
        progress: Option<&[(String, StopState)]>,
    ) -> Result<(), ReviewError> {
        let key = source.storage_key();
        let mut ops = vec![KvOp::Put {
            table: REVIEW_GUIDES,
            key: key.clone(),
            value: serde_json::to_vec(record)
                .map_err(|error| ReviewError::Internal(error.to_string()))?,
        }];
        if let Some(progress) = progress {
            for (stored_key, _) in self
                .store
                .kv_scan(REVIEW_GUIDE_PROGRESS, &format!("{key}\0"))?
            {
                ops.push(KvOp::Delete {
                    table: REVIEW_GUIDE_PROGRESS,
                    key: stored_key,
                });
            }
            for (stop, state) in progress {
                ops.push(KvOp::Put {
                    table: REVIEW_GUIDE_PROGRESS,
                    key: format!("{key}\0{stop}"),
                    value: serde_json::to_vec(state)
                        .map_err(|error| ReviewError::Internal(error.to_string()))?,
                });
            }
        }
        self.store.kv_apply(ops)?;
        Ok(())
    }

    fn progress(&self, source: &DiffSource) -> Result<HashMap<String, StopState>, ReviewError> {
        let prefix = format!("{}\0", source.storage_key());
        Ok(self
            .store
            .kv_scan(REVIEW_GUIDE_PROGRESS, &prefix)?
            .into_iter()
            .filter_map(|(key, value)| {
                Some((
                    key.strip_prefix(&prefix)?.to_owned(),
                    serde_json::from_slice(&value).ok()?,
                ))
            })
            .collect())
    }

    fn set_progress(
        &self,
        source: &DiffSource,
        stop_id: &str,
        state: StopState,
    ) -> Result<(), ReviewError> {
        self.store.kv_apply(vec![KvOp::Put {
            table: REVIEW_GUIDE_PROGRESS,
            key: format!("{}\0{stop_id}", source.storage_key()),
            value: serde_json::to_vec(&state)
                .map_err(|error| ReviewError::Internal(error.to_string()))?,
        }])?;
        Ok(())
    }
}

#[derive(Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
enum AuthorRequest {
    Thread { thread_id: String },
    NewThread { workspace: Option<String> },
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct GuideRequest {
    source: DiffSource,
    revision: String,
    author: AuthorRequest,
    idempotency_key: String,
}

/// `companion/review/guide/request`.
///
/// # Errors
///
/// Returns invalid params for an unknown author thread or an inadmissible
/// workspace (no thread is created then), `-32086` above the catalog
/// budget, and `-32088` when the revision is no longer current.
pub async fn request(service: &Arc<ReviewService>, raw: &Value) -> Result<Value, ReviewError> {
    let request: GuideRequest = params(raw)?;
    request.source.validate()?;
    if request.idempotency_key.is_empty() || request.idempotency_key.len() > 128 {
        return Err(ReviewError::Invalid("invalid idempotencyKey".into()));
    }
    let guides = service.guides();
    let mut record = guides.record(&request.source)?;
    if let Some(pending) = &record.pending
        && pending.idempotency_key == request.idempotency_key
    {
        return Ok(
            json!({"requestId": pending.request_id, "authorThreadId": pending.author_thread_id}),
        );
    }
    let agents = guides.agents.clone().ok_or_else(|| {
        ReviewError::Unavailable("agents are unavailable on this companion".into())
    })?;
    let catalog = service.catalog(&request.source).await?;
    if catalog.revision != request.revision {
        return Err(ReviewError::ConflictValue(
            json!({"revision": catalog.revision}),
        ));
    }
    let (aliases, excerpt) = alias_catalog(&catalog)?;
    let author_thread_id = match request.author {
        AuthorRequest::Thread { thread_id } => {
            if !valid_thread_id(&thread_id) || !agents.thread_exists(&thread_id).await {
                return Err(ReviewError::Invalid("unknown author thread".into()));
            }
            thread_id
        }
        AuthorRequest::NewThread { workspace } => {
            let admission = guides.admission.as_ref().ok_or_else(|| {
                ReviewError::Unavailable("workspace admission is unavailable".into())
            })?;
            let cwd = admission
                .admit(workspace.as_deref())
                .await
                .map_err(ReviewError::Invalid)?;
            agents
                .create_thread(cwd, crate::agent::permission_profiles::READ_ONLY)
                .await
                .map_err(ReviewError::Source)?
                .into_string()
        }
    };
    let request_id = super::new_uuid();
    let description = service.sources().describe(&request.source).await;
    agents
        .enqueue(
            &author_thread_id,
            &request_id,
            vec![guide_instructions(&description, aliases.len()), excerpt],
        )
        .await
        .map_err(ReviewError::Source)?;
    record.pending = Some(PendingGuide {
        source: request.source.clone(),
        request_id: request_id.clone(),
        idempotency_key: request.idempotency_key,
        author_thread_id: author_thread_id.clone(),
        revision: catalog.revision.clone(),
        aliases,
    });
    guides.save(&request.source, &record, None)?;
    info!(request_id = %request_id, "review guide requested");
    service.events().invalidated(&request.source).await;
    Ok(json!({"requestId": request_id, "authorThreadId": author_thread_id}))
}

/// Completes a pending request whose turn has ended. Returns whether the
/// record changed.
///
/// # Errors
///
/// Returns a storage failure.
pub async fn finalize(
    service: &Arc<ReviewService>,
    source: &DiffSource,
) -> Result<bool, ReviewError> {
    let guides = service.guides();
    let mut record = guides.record(source)?;
    let Some(pending) = record.pending.clone() else {
        return Ok(false);
    };
    let Some(agents) = guides.agents.clone() else {
        return Ok(false);
    };
    let Some(outcome) = agents
        .turn_outcome(&pending.author_thread_id, &pending.request_id)
        .await
    else {
        return Ok(false);
    };
    record.pending = None;
    let parsed = match outcome {
        TurnOutcome::Completed(Some(message)) => parse_guide(&message, &pending),
        TurnOutcome::Completed(None) => Err("the agent returned no message".to_owned()),
        TurnOutcome::Ended(reason) => Err(reason),
    };
    match parsed {
        Ok(parsed) => {
            let catalog = service
                .catalog(source)
                .await
                .ok()
                .filter(|catalog| catalog.revision == pending.revision);
            let fingerprints: HashMap<HunkId, HunkFingerprint> = catalog
                .iter()
                .flat_map(|catalog| catalog.files.iter().flat_map(|file| &file.hunks))
                .map(|parsed| (parsed.hunk.id.clone(), parsed.hunk.fingerprint.clone()))
                .collect();
            let guide = ReviewGuide {
                guide_id: super::new_uuid(),
                source: source.clone(),
                revision: pending.revision.clone(),
                author_thread_id: pending.author_thread_id.clone(),
                created_at: now(),
                title: parsed.title,
                summary: parsed.summary,
                chapters: parsed.chapters,
                support: parsed.support,
            };
            let progress: Vec<(String, StopState)> = guide
                .chapters
                .iter()
                .flat_map(|chapter| &chapter.stops)
                .map(|stop| (stop.stop_id.clone(), StopState::Pending))
                .collect();
            record.guide = Some(guide);
            record.fingerprints = fingerprints;
            record.last_error = None;
            guides.save(source, &record, Some(&progress))?;
            if let Some(catalog) = catalog.as_ref().filter(|_| takes_remarks(source)) {
                create_remarks(service, source, catalog, &pending, parsed.remarks);
            }
            info!(request_id = %pending.request_id, "review guide stored");
        }
        Err(reason) => {
            record.last_error = Some(LastError {
                code: -32_085,
                reason: reason.chars().take(300).collect(),
                at: now(),
            });
            guides.save(source, &record, None)?;
            info!(request_id = %pending.request_id, "review guide rejected");
        }
    }
    service.events().invalidated(source).await;
    Ok(true)
}

/// Remarks are review drafts, which exist only on pull requests; on any
/// other source the guide keeps its stops and drops the remarks.
pub(super) fn takes_remarks(source: &DiffSource) -> bool {
    matches!(source, DiffSource::PullRequest { .. })
}

/// Agent remarks become agent-authored drafts addressed to the author
/// thread; only a user edit changes their destination.
fn create_remarks(
    service: &Arc<ReviewService>,
    source: &DiffSource,
    catalog: &DiffCatalog,
    pending: &PendingGuide,
    remarks: Vec<Remark>,
) {
    for remark in remarks {
        let Some(parsed) = catalog
            .files
            .iter()
            .flat_map(|file| &file.hunks)
            .find(|parsed| parsed.hunk.id == remark.hunk)
        else {
            continue;
        };
        let path = remark
            .hunk
            .as_str()
            .rsplit_once("#h")
            .map_or("", |(path, _)| path)
            .to_owned();
        let input = DraftInput {
            id: super::new_uuid(),
            revision: DiffSourceRevision {
                source: source.clone(),
                revision: pending.revision.clone(),
            },
            anchor: DraftAnchor {
                path,
                side: remark.side,
                start_line: remark.start_line,
                end_line: remark.end_line,
                hunk: Some(AnchorHunk {
                    id: parsed.hunk.id.clone(),
                    fingerprint: parsed.hunk.fingerprint.clone(),
                }),
            },
            body: remark.body,
            destination: Destination::Agent,
            target_thread_id: Some(pending.author_thread_id.clone()),
        };
        let origin = HunkOrigin {
            old_start: parsed.hunk.old_start,
            new_start: parsed.hunk.new_start,
        };
        if let Err(error) = service.drafts().put(
            &input,
            None,
            Author::Agent {
                thread_id: pending.author_thread_id.clone(),
            },
            Some(origin),
            &now(),
        ) {
            tracing::warn!(reason = ?error, "a guide remark was not stored");
        }
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ReadRequest {
    source: DiffSource,
}

/// `companion/review/guide/read`: the latest guide re-matched to the
/// current revision, its progress, the pending request and the last error.
///
/// # Errors
///
/// Returns a storage failure.
pub async fn read(service: &Arc<ReviewService>, raw: &Value) -> Result<Value, ReviewError> {
    let request: ReadRequest = params(raw)?;
    request.source.validate()?;
    finalize(service, &request.source).await?;
    let guides = service.guides();
    let record = guides.record(&request.source)?;
    let mut progress = guides.progress(&request.source)?;
    let current = service.catalog(&request.source).await.ok();
    let current_revision = current
        .as_ref()
        .map(|catalog| catalog.revision.clone())
        .or_else(|| record.guide.as_ref().map(|guide| guide.revision.clone()))
        .unwrap_or_default();
    let mut guide = record.guide.clone();
    if let (Some(guide), Some(catalog)) = (guide.as_mut(), current.as_ref())
        && guide.revision != catalog.revision
    {
        let changed = rematch(guide, &record.fingerprints, catalog, &mut progress);
        for (stop, state) in changed {
            guides.set_progress(&request.source, &stop, state)?;
        }
    }
    let progress: Vec<Value> = guide
        .iter()
        .flat_map(|guide| guide.chapters.iter().flat_map(|chapter| &chapter.stops))
        .map(|stop| {
            json!({
                "stopId": stop.stop_id,
                "state": progress.get(&stop.stop_id).copied().unwrap_or(StopState::Pending),
            })
        })
        .collect();
    Ok(json!({
        "currentRevision": current_revision,
        "guide": guide,
        "progress": progress,
        "pending": record.pending.as_ref().map(|pending| json!({
            "requestId": pending.request_id,
            "authorThreadId": pending.author_thread_id,
        })),
        "lastError": record.last_error,
    }))
}

/// Re-matches stops to a newer catalog by fingerprint multisets; returns
/// the stops whose state became `changed`.
fn rematch(
    guide: &mut ReviewGuide,
    fingerprints: &HashMap<HunkId, HunkFingerprint>,
    catalog: &DiffCatalog,
    progress: &mut HashMap<String, StopState>,
) -> Vec<(String, StopState)> {
    let mut available: HashMap<&str, Vec<&HunkId>> = HashMap::new();
    for parsed in catalog.files.iter().flat_map(|file| &file.hunks) {
        available
            .entry(parsed.hunk.fingerprint.as_str())
            .or_default()
            .push(&parsed.hunk.id);
    }
    let mut changed = Vec::new();
    for stop in guide
        .chapters
        .iter_mut()
        .flat_map(|chapter| &mut chapter.stops)
    {
        let mut remaining = available.clone();
        let mut remapped = Vec::new();
        for hunk in &stop.hunk_ids {
            let next = fingerprints
                .get(hunk)
                .and_then(|fingerprint| remaining.get_mut(fingerprint.as_str()))
                .and_then(Vec::pop);
            if let Some(id) = next {
                remapped.push(id.clone());
            } else {
                remapped.clear();
                break;
            }
        }
        if remapped.len() == stop.hunk_ids.len() {
            stop.hunk_ids = remapped;
        } else if progress.get(&stop.stop_id).copied() != Some(StopState::Changed) {
            progress.insert(stop.stop_id.clone(), StopState::Changed);
            changed.push((stop.stop_id.clone(), StopState::Changed));
        }
    }
    changed
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct StopRequest {
    guide_id: String,
    stop_id: String,
    revision: String,
    state: StopState,
}

/// `companion/review/guide/stop/set`. Never accepts `changed`, which only
/// re-matching sets. Writes nothing to any forge.
///
/// # Errors
///
/// Returns invalid params for `changed`, an unknown guide or stop.
pub async fn set_stop(service: &Arc<ReviewService>, raw: &Value) -> Result<Value, ReviewError> {
    let request: StopRequest = params(raw)?;
    if request.state == StopState::Changed {
        return Err(ReviewError::Invalid(
            "changed is set only by the companion".into(),
        ));
    }
    if !valid_uuid(&request.guide_id) || request.revision.is_empty() {
        return Err(ReviewError::Invalid("invalid guide".into()));
    }
    let record = service
        .guides()
        .store
        .kv_scan(REVIEW_GUIDES, "")?
        .into_iter()
        .filter_map(|(_, value)| serde_json::from_slice::<GuideRecord>(&value).ok())
        .find(|record| {
            record
                .guide
                .as_ref()
                .is_some_and(|guide| guide.guide_id == request.guide_id)
        })
        .ok_or(ReviewError::NotFound)?;
    let guide = record.guide.ok_or(ReviewError::NotFound)?;
    if !guide
        .chapters
        .iter()
        .flat_map(|chapter| &chapter.stops)
        .any(|stop| stop.stop_id == request.stop_id)
    {
        return Err(ReviewError::NotFound);
    }
    service
        .guides()
        .set_progress(&guide.source, &request.stop_id, request.state)?;
    service.events().invalidated(&guide.source).await;
    Ok(json!({"stopId": request.stop_id, "state": request.state}))
}

/// Finalizes pending guides of a thread whose turn ended.
pub async fn observe_turn_end(service: &Arc<ReviewService>, thread_id: &str) {
    let Ok(records) = service.guides().store.kv_scan(REVIEW_GUIDES, "") else {
        return;
    };
    for (_, value) in records {
        let Ok(record) = serde_json::from_slice::<GuideRecord>(&value) else {
            continue;
        };
        let Some(pending) = record.pending.as_ref() else {
            continue;
        };
        if pending.author_thread_id == thread_id
            && let Err(error) = finalize(service, &pending.source).await
        {
            tracing::warn!(reason = ?error, "review guide finalization failed");
        }
    }
}
