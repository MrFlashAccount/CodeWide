//! The review bounded context: review targets independent of forges —
//! diff-source identity, hunk ids, drafts, guides and companion-local
//! viewed marks. Session and VCS reviews use it without any forge, and it
//! never imports `crate::forge`; the forge registers its pull request
//! catalog through [`source::CatalogSources`] and drives Submit through
//! [`drafts::DraftStore`]. See `CONTEXT.md`.

pub mod catalogs;
pub mod drafts;
pub mod guide;
pub mod hunks;
pub mod source;
pub mod viewed;

use std::{
    collections::{BTreeMap, HashMap},
    sync::{Arc, Mutex},
};

use serde::Deserialize;
use serde_json::{Value, json};

use self::{
    drafts::{AgentState, Author, DraftComment, DraftInput, DraftStore, HunkOrigin, Routing},
    guide::GuideService,
    source::{CatalogSources, DiffCatalog, DiffSource, SourceKind},
    viewed::ViewedMarks,
};
use crate::{agent_bridge::AgentBridge, store::IndexStore};

const INVALID_PARAMS: i64 = -32_602;
const INTERNAL: i64 = -32_603;
const CAPABILITY_UNAVAILABLE: i64 = -32_084;
const INVALID_GUIDE: i64 = -32_085;
const GUIDE_TOO_LARGE: i64 = -32_086;
const NOT_FOUND_OR_CONFLICT: i64 = -32_088;

#[derive(Debug)]
pub enum ReviewError {
    Invalid(String),
    NotFound,
    Conflict(Box<DraftComment>),
    /// A conflict whose current value is not a draft (a moved revision).
    ConflictValue(Value),
    Unavailable(String),
    Source(String),
    InvalidGuide(String),
    GuideTooLarge(usize),
    Internal(String),
}

impl ReviewError {
    /// The JSON-RPC `error` object, with the shared companion `data` shapes.
    #[must_use]
    pub fn to_rpc_error(&self) -> Value {
        let (code, message, data) = match self {
            Self::Invalid(message) => (INVALID_PARAMS, message.clone(), None),
            Self::NotFound => (
                NOT_FOUND_OR_CONFLICT,
                "Not found".to_owned(),
                Some(json!({"code": NOT_FOUND_OR_CONFLICT, "kind": "notFound", "current": null})),
            ),
            Self::Conflict(current) => (
                NOT_FOUND_OR_CONFLICT,
                "The draft changed on another device".to_owned(),
                Some(
                    json!({"code": NOT_FOUND_OR_CONFLICT, "kind": "conflict", "current": current}),
                ),
            ),
            Self::ConflictValue(current) => (
                NOT_FOUND_OR_CONFLICT,
                "The revision is no longer current".to_owned(),
                Some(
                    json!({"code": NOT_FOUND_OR_CONFLICT, "kind": "conflict", "current": current}),
                ),
            ),
            Self::Unavailable(reason) | Self::Source(reason) => (
                CAPABILITY_UNAVAILABLE,
                reason.clone(),
                Some(
                    json!({"code": CAPABILITY_UNAVAILABLE, "kind": "capabilityUnavailable", "reason": reason}),
                ),
            ),
            Self::InvalidGuide(reason) => (
                INVALID_GUIDE,
                reason.clone(),
                Some(json!({"code": INVALID_GUIDE, "kind": "invalidGuide", "reason": reason})),
            ),
            Self::GuideTooLarge(hunks) => (
                GUIDE_TOO_LARGE,
                "The diff is too large for a guide".to_owned(),
                Some(json!({"code": GUIDE_TOO_LARGE, "kind": "guideTooLarge", "hunks": hunks})),
            ),
            Self::Internal(message) => (INTERNAL, message.clone(), None),
        };
        let mut error = json!({"code": code, "message": message});
        if let Some(data) = data {
            error["data"] = data;
        }
        error
    }
}

impl From<crate::store::StoreError> for ReviewError {
    fn from(error: crate::store::StoreError) -> Self {
        tracing::error!(err = ?error, "review storage failed");
        Self::Internal("Companion storage failed".into())
    }
}

/// `8-4-4-4-12` hexadecimal groups.
#[must_use]
pub fn valid_uuid(value: &str) -> bool {
    let groups: Vec<&str> = value.split('-').collect();
    groups.len() == 5
        && groups.iter().zip([8, 4, 4, 4, 12]).all(|(group, length)| {
            group.len() == length && group.bytes().all(|byte| byte.is_ascii_hexdigit())
        })
}

/// A random UUID v4 string.
#[must_use]
pub fn new_uuid() -> String {
    let mut bytes: [u8; 16] = rand::random();
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    let hex = hex::encode(bytes);
    format!(
        "{}-{}-{}-{}-{}",
        &hex[0..8],
        &hex[8..12],
        &hex[12..16],
        &hex[16..20],
        &hex[20..32]
    )
}

/// A thread id usable as a store key segment.
#[must_use]
pub fn valid_thread_id(value: &str) -> bool {
    !value.is_empty() && value.len() <= 512 && !value.chars().any(char::is_control)
}

fn params<T: serde::de::DeserializeOwned>(value: &Value) -> Result<T, ReviewError> {
    serde_json::from_value(value.clone())
        .map_err(|error| ReviewError::Invalid(format!("invalid params: {error}")))
}

fn now() -> String {
    time::OffsetDateTime::now_utc()
        .format(&time::format_description::well_known::Rfc3339)
        .unwrap_or_default()
}

/// Content-free review invalidations.
#[derive(Clone)]
pub struct ReviewEvents {
    sender: tokio::sync::mpsc::Sender<Value>,
}

impl ReviewEvents {
    #[must_use]
    pub fn new(sender: tokio::sync::mpsc::Sender<Value>) -> Self {
        Self { sender }
    }

    pub async fn invalidated(&self, source: &DiffSource) {
        let payload =
            json!({"method": "companion/review/invalidated", "params": {"source": source}});
        if self.sender.send(payload).await.is_err() {
            tracing::warn!("review invalidation was not journaled: the journal is closed");
        }
    }
}

pub struct ReviewService {
    sources: CatalogSources,
    drafts: DraftStore,
    viewed: ViewedMarks,
    guides: GuideService,
    events: ReviewEvents,
    agents: Option<AgentBridge>,
    /// The last catalog of each source (memory only).
    catalogs: Mutex<HashMap<String, DiffCatalog>>,
}

impl ReviewService {
    #[must_use]
    pub fn new(
        store: Arc<IndexStore>,
        events: ReviewEvents,
        agents: Option<AgentBridge>,
        admission: Option<Arc<crate::workspaces::WorkspaceAdmission>>,
    ) -> Arc<Self> {
        let sources = CatalogSources::default();
        Arc::new(Self {
            guides: GuideService::new(store.clone(), agents.clone(), admission),
            drafts: DraftStore::new(store.clone()),
            viewed: ViewedMarks::new(store),
            sources,
            events,
            agents,
            catalogs: Mutex::default(),
        })
    }

    #[must_use]
    pub fn sources(&self) -> &CatalogSources {
        &self.sources
    }

    #[must_use]
    pub fn drafts(&self) -> &DraftStore {
        &self.drafts
    }

    #[must_use]
    pub fn viewed(&self) -> &ViewedMarks {
        &self.viewed
    }

    #[must_use]
    pub fn guides(&self) -> &GuideService {
        &self.guides
    }

    #[must_use]
    pub fn events(&self) -> &ReviewEvents {
        &self.events
    }

    #[must_use]
    pub fn handles(method: &str) -> bool {
        method.starts_with("companion/review/")
    }

    /// The catalog of a source at its current revision, cached in memory.
    ///
    /// # Errors
    ///
    /// Returns the catalog source failure.
    pub async fn catalog(&self, source: &DiffSource) -> Result<DiffCatalog, ReviewError> {
        let catalog = self.sources.catalog(source).await?;
        if let Ok(mut catalogs) = self.catalogs.lock() {
            catalogs.insert(source.storage_key(), catalog.clone());
        }
        Ok(catalog)
    }

    fn cached_catalog(&self, source: &DiffSource, revision: &str) -> Option<DiffCatalog> {
        let catalogs = self.catalogs.lock().ok()?;
        catalogs
            .get(&source.storage_key())
            .filter(|catalog| catalog.revision == revision)
            .cloned()
    }

    /// Handles one `companion/review/*` RPC.
    ///
    /// # Errors
    ///
    /// Returns the typed review error.
    pub async fn handle(self: &Arc<Self>, method: &str, raw: &Value) -> Result<Value, ReviewError> {
        match method {
            "companion/review/hunks/read" => self.hunks_read(raw).await,
            "companion/review/drafts/read" => self.drafts_read(raw).await,
            "companion/review/draft/put" => self.draft_put(raw).await,
            "companion/review/draft/delete" => self.draft_delete(raw).await,
            "companion/review/draft/sendToAgent" => self.send_to_agent(raw).await,
            "companion/review/draft/agentDelivered" => self.agent_delivered(raw).await,
            "companion/review/guide/request" => guide::request(self, raw).await,
            "companion/review/guide/read" => guide::read(self, raw).await,
            "companion/review/guide/stop/set" => guide::set_stop(self, raw).await,
            _ => Err(ReviewError::Invalid(format!(
                "unknown review method {method}"
            ))),
        }
    }

    async fn hunks_read(&self, raw: &Value) -> Result<Value, ReviewError> {
        #[derive(Deserialize)]
        #[serde(rename_all = "camelCase", deny_unknown_fields)]
        struct Request {
            source: DiffSource,
            revision: String,
        }
        let request: Request = params(raw)?;
        request.source.validate()?;
        let catalog = match self.cached_catalog(&request.source, &request.revision) {
            Some(catalog) => catalog,
            None => self.catalog(&request.source).await?,
        };
        let files: Vec<Value> = catalog
            .files
            .iter()
            .map(|file| {
                json!({
                    "path": file.path,
                    "hunks": file.hunks.iter().map(|parsed| &parsed.hunk).collect::<Vec<_>>(),
                })
            })
            .collect();
        Ok(json!({"revision": catalog.revision, "files": files}))
    }

    async fn drafts_read(&self, raw: &Value) -> Result<Value, ReviewError> {
        #[derive(Deserialize)]
        #[serde(rename_all = "camelCase", deny_unknown_fields)]
        struct Request {
            source: DiffSource,
        }
        let request: Request = params(raw)?;
        request.source.validate()?;
        let source_key = request.source.storage_key();
        let drafts = self.drafts.list(&source_key)?;
        // Without drafts nothing is re-anchored, so only the revision is
        // read, never the catalog's file pages.
        let revision = if drafts.is_empty() {
            self.sources.revision(&request.source).await.ok()
        } else {
            match self.catalog(&request.source).await {
                Ok(catalog) => {
                    self.drafts.reanchor(&source_key, &catalog, &now())?;
                    Some(catalog.revision)
                }
                Err(error) => {
                    tracing::info!(reason = ?error, "review source unavailable; drafts served without re-anchoring");
                    None
                }
            }
        };
        let drafts = self.drafts.list(&source_key)?;
        let revision = revision
            .or_else(|| drafts.last().map(|draft| draft.revision.revision.clone()))
            .unwrap_or_default();
        Ok(json!({"revision": revision, "drafts": drafts}))
    }

    async fn draft_put(&self, raw: &Value) -> Result<Value, ReviewError> {
        #[derive(Deserialize)]
        #[serde(rename_all = "camelCase", deny_unknown_fields)]
        struct Request {
            draft: DraftInput,
            expected_version: Option<u64>,
        }
        let request: Request = params(raw)?;
        request.draft.routing()?;
        let origin = self.anchor_origin(&request.draft).await?;
        let draft = self.drafts.put(
            &request.draft,
            request.expected_version,
            Author::User,
            origin,
            &now(),
        )?;
        self.events.invalidated(&draft.revision.source).await;
        serde_json::to_value(&draft).map_err(|error| ReviewError::Internal(error.to_string()))
    }

    /// Where the anchor's hunk starts at the draft's revision, so a moved
    /// hunk can carry the anchor. The anchor's hunk must exist there.
    async fn anchor_origin(&self, draft: &DraftInput) -> Result<Option<HunkOrigin>, ReviewError> {
        let Some(hunk) = &draft.anchor.hunk else {
            return Ok(None);
        };
        let source = &draft.revision.source;
        let catalog = match self.cached_catalog(source, &draft.revision.revision) {
            Some(catalog) => catalog,
            None => self.catalog(source).await?,
        };
        if catalog.revision != draft.revision.revision {
            return Err(ReviewError::ConflictValue(
                json!({"revision": catalog.revision}),
            ));
        }
        catalog
            .files
            .iter()
            .flat_map(|file| &file.hunks)
            .find(|parsed| parsed.hunk.id == hunk.id && parsed.hunk.fingerprint == hunk.fingerprint)
            .map(|parsed| {
                Some(HunkOrigin {
                    old_start: parsed.hunk.old_start,
                    new_start: parsed.hunk.new_start,
                })
            })
            .ok_or_else(|| ReviewError::Invalid("the anchor hunk is not in this revision".into()))
    }

    async fn draft_delete(&self, raw: &Value) -> Result<Value, ReviewError> {
        #[derive(Deserialize)]
        #[serde(rename_all = "camelCase", deny_unknown_fields)]
        struct Request {
            draft_id: String,
            expected_version: u64,
        }
        let request: Request = params(raw)?;
        let draft = self
            .drafts
            .load(std::slice::from_ref(&request.draft_id))?
            .pop()
            .ok_or(ReviewError::NotFound)?;
        self.drafts
            .delete(&request.draft_id, request.expected_version)?;
        self.events.invalidated(&draft.revision.source).await;
        Ok(json!({}))
    }

    /// Sends pull request drafts to their own target threads now, one turn
    /// per thread through the durable queue.
    async fn send_to_agent(&self, raw: &Value) -> Result<Value, ReviewError> {
        #[derive(Deserialize)]
        #[serde(rename_all = "camelCase", deny_unknown_fields)]
        struct Request {
            draft_ids: Vec<String>,
            idempotency_key: String,
        }
        let request: Request = params(raw)?;
        if request.draft_ids.is_empty() || request.draft_ids.len() > 500 {
            return Err(ReviewError::Invalid("draftIds must hold 1–500 ids".into()));
        }
        if request.idempotency_key.is_empty() || request.idempotency_key.len() > 128 {
            return Err(ReviewError::Invalid("invalid idempotencyKey".into()));
        }
        let drafts = self.drafts.load(&request.draft_ids)?;
        if drafts
            .iter()
            .any(|draft| draft.source_kind != SourceKind::PullRequest)
        {
            return Err(ReviewError::Invalid(
                "sendToAgent is for pull request drafts; session and VCS drafts use the composer"
                    .into(),
            ));
        }
        let results = self
            .forward(&drafts, &request.idempotency_key, |agent| {
                matches!(agent.state, AgentState::Pending | AgentState::Failed)
            })
            .await?;
        let mut sources = Vec::new();
        for draft in &drafts {
            if !sources.contains(&draft.revision.source) {
                sources.push(draft.revision.source.clone());
            }
        }
        for source in &sources {
            self.events.invalidated(source).await;
        }
        Ok(json!({
            "drafts": results
                .iter()
                .map(|(id, outcome)| json!({
                    "draftId": id,
                    "agent": if outcome.is_ok() { "sent" } else { "failed" },
                    "error": outcome.as_ref().err(),
                }))
                .collect::<Vec<_>>(),
        }))
    }

    /// Delivers the agent halves of `drafts` whose axis `eligible` accepts:
    /// one queued turn per target thread, then the axes move to `sent` or
    /// `failed`. Returns the per-draft outcome in input order.
    ///
    /// # Errors
    ///
    /// Returns a storage failure.
    pub async fn forward(
        &self,
        drafts: &[DraftComment],
        idempotency_key: &str,
        eligible: impl Fn(&drafts::AgentAxis) -> bool,
    ) -> Result<Vec<(String, Result<(), String>)>, ReviewError> {
        let mut by_thread: BTreeMap<String, Vec<&DraftComment>> = BTreeMap::new();
        for draft in drafts {
            if let Some(agent) = draft.routing.agent()
                && eligible(agent)
            {
                by_thread
                    .entry(agent.target_thread_id.clone())
                    .or_default()
                    .push(draft);
            }
        }
        let mut outcomes: HashMap<String, Result<(), String>> = HashMap::new();
        for (thread, group) in &by_thread {
            let description = self.describe(&group[0].revision.source).await;
            let outcome = match &self.agents {
                Some(agents) => {
                    let command_id = forward_command_id(idempotency_key, thread, group);
                    agents
                        .enqueue(thread, &command_id, comment_inputs(&description, group))
                        .await
                }
                None => Err("agents are unavailable on this companion".to_owned()),
            };
            for draft in group {
                outcomes.insert(draft.id.clone(), outcome.clone());
            }
        }
        let ids: Vec<String> = outcomes.keys().cloned().collect();
        if !ids.is_empty() {
            for id in &ids {
                let outcome = outcomes.get(id).cloned().unwrap_or(Ok(()));
                self.drafts
                    .update_axes(std::slice::from_ref(id), &now(), |_, routing| {
                        if let Routing::Agent { agent } | Routing::Both { agent, .. } = routing {
                            match &outcome {
                                Ok(()) => {
                                    agent.state = AgentState::Sent;
                                    agent.error = None;
                                }
                                Err(error) => {
                                    agent.state = AgentState::Failed;
                                    agent.error = Some(error.chars().take(300).collect());
                                }
                            }
                        }
                    })?;
            }
        }
        Ok(drafts
            .iter()
            .filter_map(|draft| Some((draft.id.clone(), outcomes.get(&draft.id)?.clone())))
            .collect())
    }

    /// A short identity of a source for agent inputs.
    async fn describe(&self, source: &DiffSource) -> String {
        self.sources.describe(source).await
    }

    /// Session and VCS drafts: the composer delivered them (identity-checked
    /// acknowledgement), so their agent axes become `sent`.
    async fn agent_delivered(&self, raw: &Value) -> Result<Value, ReviewError> {
        #[derive(Deserialize)]
        #[serde(rename_all = "camelCase", deny_unknown_fields)]
        struct Request {
            draft_ids: Vec<String>,
        }
        let request: Request = params(raw)?;
        let drafts = self.drafts.load(&request.draft_ids)?;
        if drafts
            .iter()
            .any(|draft| draft.source_kind == SourceKind::PullRequest)
        {
            return Err(ReviewError::Invalid(
                "agentDelivered is for session and VCS drafts".into(),
            ));
        }
        let updated = self
            .drafts
            .update_axes(&request.draft_ids, &now(), |_, routing| {
                if let Routing::Agent { agent } = routing {
                    agent.state = AgentState::Sent;
                    agent.error = None;
                }
            })?;
        if let Some(draft) = updated.first() {
            self.events.invalidated(&draft.revision.source).await;
        }
        Ok(json!({"drafts": updated}))
    }
}

/// The queue command id of one forwarded group: the same request key, target
/// thread and drafts always name the same command, so a retry after a
/// partial failure re-sends exactly the groups that did not reach the queue.
fn forward_command_id(idempotency_key: &str, thread: &str, drafts: &[&DraftComment]) -> String {
    let mut hasher = blake3::Hasher::new();
    hasher.update(thread.as_bytes());
    let mut ids: Vec<&str> = drafts.iter().map(|draft| draft.id.as_str()).collect();
    ids.sort_unstable();
    for id in ids {
        hasher.update(b"\0");
        hasher.update(id.as_bytes());
    }
    format!(
        "review-{idempotency_key}-{}",
        &hasher.finalize().to_hex()[..16]
    )
}

/// The turn inputs for a group of drafts: the comments as the user's own
/// text, then the source identity as a separate input.
fn comment_inputs(description: &str, drafts: &[&DraftComment]) -> Vec<String> {
    use std::fmt::Write as _;
    let mut text = format!("Review comments on {description}:\n");
    for (index, draft) in drafts.iter().enumerate() {
        let side = match draft.anchor.side {
            drafts::Side::New => "new",
            drafts::Side::Old => "old",
        };
        let _ = write!(
            text,
            "\n{}. {} lines {}-{} ({side} side):\n{}\n",
            index + 1,
            draft.anchor.path,
            draft.anchor.start_line,
            draft.anchor.end_line,
            draft.body
        );
    }
    vec![text]
}

#[cfg(test)]
mod forward_tests {
    use super::*;

    #[test]
    fn forward_command_ids_depend_on_key_thread_and_drafts_not_order() {
        let draft = |id: &str| -> DraftComment {
            serde_json::from_value(json!({
                "id": id,
                "revision": {"source": {"kind": "pullRequest", "pullRequest": "fpr1.x"}, "revision": "h"},
                "anchor": {"path": "a", "side": "new", "startLine": 1, "endLine": 1},
                "body": "b", "author": {"kind": "user"}, "createdAt": "", "updatedAt": "", "version": 1,
                "sourceKind": "pullRequest", "destination": "both",
                "agent": {"state": "pending", "targetThreadId": "t"}, "pr": {"state": "pending"}
            }))
            .unwrap_or_else(|error| panic!("{error}"))
        };
        let (a, b) = (draft("a"), draft("b"));
        let first = forward_command_id("k", "thread-1", &[&a, &b]);
        assert_eq!(first, forward_command_id("k", "thread-1", &[&b, &a]));
        assert_ne!(first, forward_command_id("k", "thread-2", &[&a, &b]));
        assert_ne!(first, forward_command_id("k", "thread-1", &[&a]));
        assert_ne!(first, forward_command_id("k2", "thread-1", &[&a, &b]));
    }

    /// A pull-request-like source whose revision is cheap and whose catalog
    /// counts its (expensive) reads.
    struct CountingSource {
        catalogs: std::sync::atomic::AtomicUsize,
    }

    #[async_trait::async_trait]
    impl source::DiffCatalogSource for CountingSource {
        async fn catalog(&self, _source: &DiffSource) -> Result<DiffCatalog, ReviewError> {
            self.catalogs
                .fetch_add(1, std::sync::atomic::Ordering::SeqCst);
            Ok(DiffCatalog {
                revision: "head-2".into(),
                files: Vec::new(),
            })
        }

        async fn revision(&self, _source: &DiffSource) -> Result<String, ReviewError> {
            Ok("head-2".into())
        }

        async fn describe(&self, _source: &DiffSource) -> String {
            "a pull request".into()
        }
    }

    #[tokio::test]
    async fn drafts_read_without_drafts_reads_only_the_revision()
    -> Result<(), Box<dyn std::error::Error>> {
        let directory = tempfile::tempdir()?;
        let store = Arc::new(IndexStore::open(directory.path().join("state.redb"))?);
        let (sender, _receiver) = tokio::sync::mpsc::channel(8);
        let review = ReviewService::new(store, ReviewEvents::new(sender), None, None);
        let counting = Arc::new(CountingSource {
            catalogs: std::sync::atomic::AtomicUsize::new(0),
        });
        review
            .sources()
            .register(source::SourceKind::PullRequest, counting.clone());

        let read = review
            .handle(
                "companion/review/drafts/read",
                &json!({"source": {"kind": "pullRequest", "pullRequest": "fpr1.x"}}),
            )
            .await
            .map_err(|error| format!("{error:?}"))?;
        assert_eq!(read, json!({"revision": "head-2", "drafts": []}));
        assert_eq!(
            counting.catalogs.load(std::sync::atomic::Ordering::SeqCst),
            0,
            "no file page is read to learn the head revision"
        );
        Ok(())
    }
}
