//! Thread → provider bindings: the durable store, observation upserts, the
//! one-time backfill job and discovery on a miss.
//!
//! A binding is an ordered list of segments: each segment is one provider's
//! native thread serving a contiguous run of the app thread's turns. The app
//! thread id is the first segment's native id; routing uses the active
//! (last) segment; a native thread that is a non-first segment of an app
//! thread (a continuation) is never listed or bound as its own app thread,
//! and an app thread's history is its segments' turns concatenated in order
//! (`assemble_history`).
//!
//! Invariants (phase 1): every thread has exactly one binding with exactly
//! one segment whose native id is the app thread id, and a binding's provider
//! never changes. Upserts insert only absent keys; a conflicting claim is
//! logged at `error` and ignored. Routing reads only bindings, never model
//! ids, `thread_metadata.model_provider` or id shapes.

use std::{
    collections::{BTreeMap, HashMap, HashSet},
    sync::{Arc, Mutex},
    time::{Duration, SystemTime, UNIX_EPOCH},
};

use serde::{Deserialize, Serialize};
use tracing::{error, info, warn};

use super::{
    model::{
        AgentTurn, AppThreadId, ProviderId, ProviderThreadRef, SortDirection, ThreadListParams,
        ThreadSortKey,
    },
    provider::{AgentProvider, ProviderStatus},
    registry::ProviderRegistry,
};
use crate::store::{BindingWrite, IndexStore, StoreError};

/// v2: segments. v1 records (one provider ref) are upgraded on open; v2
/// records keep the v1 fields as a projection so an older companion still
/// routes them.
const BINDING_RECORD_VERSION: u8 = 2;
const SEGMENTS_UPGRADED_KEY: &str = "agent_bindings_segments_v2";
const MAX_CACHED_BINDINGS: usize = 16_384;
const BACKFILL_MARKER_PREFIX: &str = "agent_bindings_backfill_v1:";
const BACKFILL_PAGE_SIZE: u32 = 100;
const BACKFILL_RETRY: Duration = Duration::from_secs(30);

/// How a binding came to exist.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum BindingOrigin {
    /// Written by `thread/start` before the response was sent.
    Created,
    /// Written when a provider reported or recognized the thread.
    Discovered,
    /// Written by the one-time backfill job.
    Backfilled,
}

/// One provider's native thread serving a contiguous run of an app
/// thread's turns. Ordinals are 0-based app-thread turn positions.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BindingSegment {
    pub provider: ProviderId,
    pub native_thread_id: ProviderThreadRef,
    pub first_turn_ordinal: u64,
    /// `None` while the segment is active.
    pub last_turn_ordinal: Option<u64>,
    /// Handoff context the next segment was started with (phase 2).
    pub handoff_refs: Vec<String>,
}

impl BindingSegment {
    fn first(provider: &ProviderId, native_thread_id: ProviderThreadRef) -> Self {
        Self {
            provider: provider.clone(),
            native_thread_id,
            first_turn_ordinal: 0,
            last_turn_ordinal: None,
            handoff_refs: Vec::new(),
        }
    }
}

/// Versioned durable record (`v: 2`).
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct BindingRecord {
    v: u8,
    app_thread_id: AppThreadId,
    /// Absent in a v1 record; see [`Self::upgraded`].
    #[serde(default)]
    segments: Vec<BindingSegment>,
    /// v1 projection: the active segment's provider.
    active_provider: ProviderId,
    /// v1 projection: each segment's native id by provider.
    refs: BTreeMap<ProviderId, ProviderThreadRef>,
    origin: BindingOrigin,
    created_at_ms: u64,
}

impl BindingRecord {
    fn new(app_thread_id: &AppThreadId, provider: &ProviderId, origin: BindingOrigin) -> Self {
        // Phase 1: the provider's thread handle is the app thread id itself.
        let segment = BindingSegment::first(provider, ProviderThreadRef::same_as(app_thread_id));
        Self::with_segments(app_thread_id, vec![segment], origin, now_ms())
    }

    fn with_segments(
        app_thread_id: &AppThreadId,
        segments: Vec<BindingSegment>,
        origin: BindingOrigin,
        created_at_ms: u64,
    ) -> Self {
        let active_provider = segments.last().map_or_else(
            || ProviderId::from_static("unknown"),
            |segment| segment.provider.clone(),
        );
        let refs = segments
            .iter()
            .map(|segment| (segment.provider.clone(), segment.native_thread_id.clone()))
            .collect();
        Self {
            v: BINDING_RECORD_VERSION,
            app_thread_id: app_thread_id.clone(),
            segments,
            active_provider,
            refs,
            origin,
            created_at_ms,
        }
    }

    /// The record as v2: a v1 record becomes one open segment of its active
    /// provider's ref (the app thread id when the ref is missing).
    fn upgraded(self) -> Self {
        if self.v >= BINDING_RECORD_VERSION && !self.segments.is_empty() {
            return self;
        }
        let native = self
            .refs
            .get(&self.active_provider)
            .cloned()
            .unwrap_or_else(|| ProviderThreadRef::same_as(&self.app_thread_id));
        let segment = BindingSegment::first(&self.active_provider, native);
        Self::with_segments(
            &self.app_thread_id,
            vec![segment],
            self.origin,
            self.created_at_ms,
        )
    }

    fn decode(bytes: &[u8]) -> Result<Self, serde_json::Error> {
        serde_json::from_slice::<Self>(bytes).map(Self::upgraded)
    }

    /// The provider of the active (last) segment.
    fn active(&self) -> &ProviderId {
        self.segments
            .last()
            .map_or(&self.active_provider, |segment| &segment.provider)
    }
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |elapsed| {
            u64::try_from(elapsed.as_millis()).unwrap_or(u64::MAX)
        })
}

/// An app thread's history: each segment's native turns in segment order;
/// a closed segment contributes at most its ordinal span.
#[must_use]
pub fn assemble_history(segments: &[(BindingSegment, Vec<AgentTurn>)]) -> Vec<AgentTurn> {
    let mut history = Vec::new();
    for (segment, turns) in segments {
        let span = segment.last_turn_ordinal.map_or(usize::MAX, |last| {
            usize::try_from(
                last.saturating_sub(segment.first_turn_ordinal)
                    .saturating_add(1),
            )
            .unwrap_or(usize::MAX)
        });
        history.extend(turns.iter().take(span).cloned());
    }
    history
}

#[derive(Debug, thiserror::Error)]
pub enum BindingError {
    #[error(transparent)]
    Store(#[from] StoreError),
    #[error("binding record is invalid: {0}")]
    Invalid(#[from] serde_json::Error),
    #[error("binding worker failed: {0}")]
    Worker(String),
    #[error("binding segments are invalid: {0}")]
    Segments(String),
}

/// Rewrites every v1 record as v2 once; a durable marker skips later opens.
fn upgrade_records(store: &IndexStore) -> Result<(), BindingError> {
    if store.agent_meta(SEGMENTS_UPGRADED_KEY)?.is_some() {
        return Ok(());
    }
    let upgraded =
        store.agent_bindings_upgrade(|bytes| -> Result<Option<Vec<u8>>, BindingError> {
            let record = serde_json::from_slice::<BindingRecord>(bytes)?;
            if record.v >= BINDING_RECORD_VERSION && !record.segments.is_empty() {
                return Ok(None);
            }
            Ok(Some(serde_json::to_vec(&record.upgraded())?))
        })?;
    store.put_agent_meta(SEGMENTS_UPGRADED_KEY, b"1")?;
    if upgraded > 0 {
        info!(
            records = upgraded,
            "thread binding records upgraded to segments"
        );
    }
    Ok(())
}

/// Result of a single bind attempt.
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum BindOutcome {
    Bound,
    AlreadyBound,
    /// The thread is bound to another provider; the claim was ignored.
    Conflict {
        existing: ProviderId,
    },
    /// The id is a non-first segment of an app thread; it is never bound as
    /// its own app thread.
    Continuation,
}

/// Where a thread-scoped call goes.
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum ThreadRoute {
    /// An explicit binding exists.
    Bound(ProviderId),
    /// No binding yet; exactly one provider can discover external threads.
    /// The caller confirms the binding after that provider accepted the call.
    Provisional(ProviderId),
    /// No provider owns the id.
    Unknown,
}

/// Durable binding store with a bounded read cache.
pub struct BindingStore {
    store: Arc<IndexStore>,
    cache: Mutex<HashMap<AppThreadId, ProviderId>>,
    /// Native ids of non-first segments (empty in phase 1).
    continuations: Mutex<HashSet<String>>,
}

impl BindingStore {
    /// Opens the binding store, upgrading v1 records to segments once.
    /// A failed upgrade is logged at `error`; v1 records are still read as
    /// one segment.
    #[must_use]
    pub fn new(store: Arc<IndexStore>) -> Self {
        if let Err(err) = upgrade_records(&store) {
            error!(err = ?err, "thread binding records could not be upgraded to segments");
        }
        let continuations = match store.agent_continuations() {
            Ok(continuations) => continuations
                .into_iter()
                .map(|(native, _app)| native)
                .collect(),
            Err(err) => {
                error!(err = ?err, "thread binding continuations are unreadable");
                HashSet::new()
            }
        };
        Self {
            store,
            cache: Mutex::new(HashMap::new()),
            continuations: Mutex::new(continuations),
        }
    }

    /// Whether a native thread id continues another app thread.
    #[must_use]
    pub fn is_continuation(&self, native_thread_id: &str) -> bool {
        let continuations = self
            .continuations
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        !continuations.is_empty() && continuations.contains(native_thread_id)
    }

    /// The app thread's segments, oldest first.
    ///
    /// # Errors
    /// Returns an error when the durable store cannot be read.
    pub async fn segments(
        &self,
        id: &AppThreadId,
    ) -> Result<Option<Vec<BindingSegment>>, BindingError> {
        let store = self.store.clone();
        let key = id.clone();
        let stored = tokio::task::spawn_blocking(move || store.agent_binding(key.as_str()))
            .await
            .map_err(|error| BindingError::Worker(error.to_string()))??;
        stored
            .map(|bytes| BindingRecord::decode(&bytes).map(|record| record.segments))
            .transpose()
            .map_err(BindingError::from)
    }

    /// Replaces an app thread's segments (provider switching, phase 2). The
    /// first segment's native id must be the app thread id.
    ///
    /// # Errors
    /// Returns an error for an invalid segment list or a failed write.
    pub async fn replace_segments(
        &self,
        id: &AppThreadId,
        segments: Vec<BindingSegment>,
        origin: BindingOrigin,
    ) -> Result<(), BindingError> {
        if segments
            .first()
            .is_none_or(|first| first.native_thread_id.as_str() != id.as_str())
        {
            return Err(BindingError::Segments(
                "the first segment must be the app thread".into(),
            ));
        }
        let continuations = segments
            .iter()
            .skip(1)
            .map(|segment| segment.native_thread_id.as_str().to_owned())
            .collect::<Vec<_>>();
        let record = BindingRecord::with_segments(id, segments, origin, now_ms());
        let active = record.active().clone();
        let encoded = serde_json::to_vec(&record)?;
        let store = self.store.clone();
        let key = id.clone();
        let natives = continuations.clone();
        tokio::task::spawn_blocking(move || {
            let natives = natives.iter().map(String::as_str).collect::<Vec<_>>();
            store.agent_binding_replace(key.as_str(), &encoded, &natives)
        })
        .await
        .map_err(|error| BindingError::Worker(error.to_string()))??;
        self.continuations
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .extend(continuations);
        self.remember(id.clone(), active);
        Ok(())
    }

    fn cached(&self, id: &AppThreadId) -> Option<ProviderId> {
        self.cache
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .get(id)
            .cloned()
    }

    fn remember(&self, id: AppThreadId, provider: ProviderId) {
        let mut cache = self
            .cache
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        if cache.len() >= MAX_CACHED_BINDINGS {
            cache.clear();
        }
        cache.insert(id, provider);
    }

    /// The provider bound to a thread, if any.
    ///
    /// # Errors
    /// Returns an error when the durable store cannot be read.
    pub async fn provider_of(&self, id: &AppThreadId) -> Result<Option<ProviderId>, BindingError> {
        if let Some(provider) = self.cached(id) {
            return Ok(Some(provider));
        }
        let store = self.store.clone();
        let key = id.clone();
        let stored = tokio::task::spawn_blocking(move || store.agent_binding(key.as_str()))
            .await
            .map_err(|error| BindingError::Worker(error.to_string()))??;
        let Some(stored) = stored else {
            return Ok(None);
        };
        let record = BindingRecord::decode(&stored)?;
        let provider = record.active().clone();
        self.remember(id.clone(), provider.clone());
        Ok(Some(provider))
    }

    /// Binds one thread unless it is bound already.
    ///
    /// # Errors
    /// Returns an error when the durable store cannot be written.
    pub async fn bind(
        &self,
        id: &AppThreadId,
        provider: &ProviderId,
        origin: BindingOrigin,
    ) -> Result<BindOutcome, BindingError> {
        let outcomes = self
            .bind_many(provider, std::slice::from_ref(id), origin)
            .await?;
        Ok(outcomes
            .into_iter()
            .next()
            .unwrap_or(BindOutcome::AlreadyBound))
    }

    /// Binds every id that is not bound yet, in one transaction. Conflicting
    /// claims are logged at `error` and ignored.
    ///
    /// # Errors
    /// Returns an error when the durable store cannot be written.
    pub async fn bind_many(
        &self,
        provider: &ProviderId,
        ids: &[AppThreadId],
        origin: BindingOrigin,
    ) -> Result<Vec<BindOutcome>, BindingError> {
        let mut pending = Vec::with_capacity(ids.len());
        let mut outcomes = vec![BindOutcome::AlreadyBound; ids.len()];
        for (index, id) in ids.iter().enumerate() {
            if self.is_continuation(id.as_str()) {
                outcomes[index] = BindOutcome::Continuation;
                continue;
            }
            match self.cached(id) {
                Some(existing) if &existing == provider => {}
                Some(existing) => {
                    error!(app_thread_id = %id, existing = %existing, claimed = %provider, "conflicting thread binding claim ignored");
                    outcomes[index] = BindOutcome::Conflict { existing };
                }
                None => pending.push((index, id.clone())),
            }
        }
        if pending.is_empty() {
            return Ok(outcomes);
        }
        let records = pending
            .iter()
            .map(|(_, id)| {
                serde_json::to_vec(&BindingRecord::new(id, provider, origin))
                    .map(|record| (id.clone(), record))
            })
            .collect::<Result<Vec<_>, _>>()?;
        let store = self.store.clone();
        let writes = tokio::task::spawn_blocking(move || {
            let borrowed = records
                .iter()
                .map(|(id, record)| (id.as_str(), record.as_slice()))
                .collect::<Vec<_>>();
            store.agent_bindings_insert_absent(&borrowed)
        })
        .await
        .map_err(|error| BindingError::Worker(error.to_string()))??;
        for ((index, id), write) in pending.into_iter().zip(writes) {
            match write {
                BindingWrite::Inserted => {
                    self.remember(id, provider.clone());
                    outcomes[index] = BindOutcome::Bound;
                }
                BindingWrite::Existing(existing) => {
                    let record = BindingRecord::decode(&existing)?;
                    let active = record.active().clone();
                    self.remember(id.clone(), active.clone());
                    if &active != provider {
                        error!(app_thread_id = %id, existing = %active, claimed = %provider, "conflicting thread binding claim ignored");
                        outcomes[index] = BindOutcome::Conflict { existing: active };
                    }
                }
            }
        }
        Ok(outcomes)
    }

    /// Resolves the provider of a thread-scoped call: the binding when it
    /// exists, otherwise discovery. With exactly one discovery provider the
    /// route is provisional (no extra provider call); with several, each is
    /// asked in registry order and the first owner is bound.
    ///
    /// # Errors
    /// Returns an error when bindings cannot be read or written.
    pub async fn route(
        &self,
        registry: &ProviderRegistry,
        id: &AppThreadId,
    ) -> Result<ThreadRoute, BindingError> {
        if let Some(provider) = self.provider_of(id).await? {
            return Ok(ThreadRoute::Bound(provider));
        }
        if self.is_continuation(id.as_str()) {
            return Ok(ThreadRoute::Unknown);
        }
        let candidates = registry.discovery_providers().cloned().collect::<Vec<_>>();
        match candidates.as_slice() {
            [] => Ok(ThreadRoute::Unknown),
            [only] => Ok(ThreadRoute::Provisional(only.descriptor().id)),
            several => {
                for provider in several {
                    match provider.thread_owns(id).await {
                        Ok(true) => {
                            let provider_id = provider.descriptor().id;
                            self.bind(id, &provider_id, BindingOrigin::Discovered)
                                .await?;
                            return Ok(ThreadRoute::Bound(provider_id));
                        }
                        Ok(false) => {}
                        Err(error) => {
                            warn!(app_thread_id = %id, provider = %provider.descriptor().id, err = %error, "thread discovery failed");
                        }
                    }
                }
                Ok(ThreadRoute::Unknown)
            }
        }
    }

    fn backfill_marker_key(provider: &ProviderId) -> String {
        format!("{BACKFILL_MARKER_PREFIX}{provider}")
    }
}

/// Durable progress of the one-time backfill of one provider.
#[derive(Clone, Debug, Default, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct BackfillProgress {
    archived: bool,
    cursor: Option<String>,
    done: bool,
}

/// Runs the `agent_bindings_backfill_v1` job for one external-discovery
/// provider: pages its `thread.list` for non-archived then archived threads
/// and binds every row. Progress is durable after each page, so a restart
/// resumes where it stopped and never duplicates a binding.
pub async fn run_backfill(
    bindings: Arc<BindingStore>,
    provider: Arc<dyn AgentProvider>,
    start_delay: Duration,
) {
    let provider_id = provider.descriptor().id;
    let marker_key = BindingStore::backfill_marker_key(&provider_id);
    let mut progress = match read_progress(&bindings.store, &marker_key).await {
        Ok(progress) => progress,
        Err(error) => {
            error!(provider = %provider_id, err = ?error, "binding backfill marker is unreadable");
            return;
        }
    };
    if progress.done {
        return;
    }
    tokio::time::sleep(start_delay).await;
    let mut status = provider.subscribe_status();
    let mut bound = 0_usize;
    while !progress.done {
        while *status.borrow() != ProviderStatus::Live {
            if status.changed().await.is_err() {
                return;
            }
        }
        let page = provider
            .thread_list(ThreadListParams {
                archived: progress.archived,
                cwd: None,
                search_term: None,
                sort_key: ThreadSortKey::CreatedAt,
                sort_direction: SortDirection::Desc,
                window: None,
                cursor: progress.cursor.clone(),
                limit: BACKFILL_PAGE_SIZE,
            })
            .await;
        let page = match page {
            Ok(page) => page,
            Err(error) => {
                warn!(provider = %provider_id, err = %error, "binding backfill page failed; retrying");
                tokio::time::sleep(BACKFILL_RETRY).await;
                continue;
            }
        };
        let ids = page
            .threads
            .iter()
            .map(|thread| thread.app_thread_id.clone())
            .collect::<Vec<_>>();
        if let Err(error) = bindings
            .bind_many(&provider_id, &ids, BindingOrigin::Backfilled)
            .await
        {
            warn!(provider = %provider_id, err = ?error, "binding backfill write failed; retrying");
            tokio::time::sleep(BACKFILL_RETRY).await;
            continue;
        }
        bound = bound.saturating_add(ids.len());
        progress = match page.next_cursor {
            Some(cursor) => BackfillProgress {
                archived: progress.archived,
                cursor: Some(cursor),
                done: false,
            },
            None if !progress.archived => BackfillProgress {
                archived: true,
                cursor: None,
                done: false,
            },
            None => BackfillProgress {
                archived: true,
                cursor: None,
                done: true,
            },
        };
        if let Err(error) = write_progress(&bindings.store, &marker_key, &progress).await {
            warn!(provider = %provider_id, err = ?error, "binding backfill progress write failed; retrying");
            tokio::time::sleep(BACKFILL_RETRY).await;
        }
    }
    info!(provider = %provider_id, rows = bound, "binding backfill finished");
}

async fn read_progress(
    store: &Arc<IndexStore>,
    key: &str,
) -> Result<BackfillProgress, BindingError> {
    let store = store.clone();
    let key = key.to_owned();
    let stored = tokio::task::spawn_blocking(move || store.agent_meta(&key))
        .await
        .map_err(|error| BindingError::Worker(error.to_string()))??;
    match stored {
        Some(bytes) => Ok(serde_json::from_slice(&bytes)?),
        None => Ok(BackfillProgress::default()),
    }
}

async fn write_progress(
    store: &Arc<IndexStore>,
    key: &str,
    progress: &BackfillProgress,
) -> Result<(), BindingError> {
    let encoded = serde_json::to_vec(progress)?;
    let store = store.clone();
    let key = key.to_owned();
    tokio::task::spawn_blocking(move || store.put_agent_meta(&key, &encoded))
        .await
        .map_err(|error| BindingError::Worker(error.to_string()))??;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn id(value: &str) -> Result<AppThreadId, Box<dyn std::error::Error>> {
        AppThreadId::parse(value).ok_or_else(|| "invalid id".into())
    }

    fn provider(value: &str) -> Result<ProviderId, Box<dyn std::error::Error>> {
        ProviderId::parse(value).ok_or_else(|| "invalid provider".into())
    }

    #[tokio::test]
    async fn a_binding_never_changes_provider_and_survives_reopen()
    -> Result<(), Box<dyn std::error::Error>> {
        let directory = tempfile::tempdir()?;
        let path = directory.path().join("state.redb");
        {
            let bindings = BindingStore::new(Arc::new(IndexStore::open(&path)?));
            assert_eq!(
                bindings
                    .bind(
                        &id("thread-1")?,
                        &provider("claude")?,
                        BindingOrigin::Created
                    )
                    .await?,
                BindOutcome::Bound
            );
            assert_eq!(
                bindings
                    .bind(
                        &id("thread-1")?,
                        &provider("claude")?,
                        BindingOrigin::Discovered
                    )
                    .await?,
                BindOutcome::AlreadyBound
            );
            assert_eq!(
                bindings
                    .bind(
                        &id("thread-1")?,
                        &provider("codex")?,
                        BindingOrigin::Discovered
                    )
                    .await?,
                BindOutcome::Conflict {
                    existing: provider("claude")?
                }
            );
        }
        let reopened = BindingStore::new(Arc::new(IndexStore::open(&path)?));
        assert_eq!(
            reopened.provider_of(&id("thread-1")?).await?,
            Some(provider("claude")?)
        );
        assert_eq!(
            reopened
                .bind(
                    &id("thread-1")?,
                    &provider("codex")?,
                    BindingOrigin::Backfilled
                )
                .await?,
            BindOutcome::Conflict {
                existing: provider("claude")?
            }
        );
        assert_eq!(reopened.provider_of(&id("thread-2")?).await?, None);
        Ok(())
    }

    #[tokio::test]
    async fn the_record_is_versioned_with_one_ref_equal_to_the_thread_id()
    -> Result<(), Box<dyn std::error::Error>> {
        let directory = tempfile::tempdir()?;
        let store = Arc::new(IndexStore::open(directory.path().join("state.redb"))?);
        let bindings = BindingStore::new(store.clone());
        bindings
            .bind(
                &id("thread-9")?,
                &provider("codex")?,
                BindingOrigin::Backfilled,
            )
            .await?;
        let stored: serde_json::Value =
            serde_json::from_slice(&store.agent_binding("thread-9")?.ok_or("record missing")?)?;
        assert_eq!(stored["v"], 2);
        assert_eq!(
            stored["segments"],
            serde_json::json!([{"provider": "codex", "nativeThreadId": "thread-9",
                "firstTurnOrdinal": 0, "lastTurnOrdinal": null, "handoffRefs": []}])
        );
        // The v1 projection an older companion routes by.
        assert_eq!(stored["activeProvider"], "codex");
        assert_eq!(stored["refs"], serde_json::json!({"codex": "thread-9"}));
        assert_eq!(stored["origin"], "backfilled");
        Ok(())
    }

    #[tokio::test]
    async fn v1_records_are_upgraded_to_one_segment_losslessly()
    -> Result<(), Box<dyn std::error::Error>> {
        let directory = tempfile::tempdir()?;
        let path = directory.path().join("state.redb");
        let v1 = serde_json::json!({"v": 1, "appThreadId": "legacy", "activeProvider": "codex",
            "refs": {"codex": "legacy"}, "origin": "discovered", "createdAtMs": 1234});
        {
            let store = IndexStore::open(&path)?;
            store.agent_bindings_insert_absent(&[("legacy", &serde_json::to_vec(&v1)?)])?;
        }
        let store = Arc::new(IndexStore::open(&path)?);
        let bindings = BindingStore::new(store.clone());
        let stored: serde_json::Value =
            serde_json::from_slice(&store.agent_binding("legacy")?.ok_or("record missing")?)?;
        assert_eq!(stored["v"], 2);
        assert_eq!(stored["segments"][0]["provider"], "codex");
        assert_eq!(stored["segments"][0]["nativeThreadId"], "legacy");
        assert_eq!(stored["segments"].as_array().map(Vec::len), Some(1));
        for field in [
            "appThreadId",
            "activeProvider",
            "refs",
            "origin",
            "createdAtMs",
        ] {
            assert_eq!(stored[field], v1[field], "{field} changed in the upgrade");
        }
        assert_eq!(
            bindings.provider_of(&id("legacy")?).await?,
            Some(provider("codex")?)
        );
        // The upgrade runs once.
        assert_eq!(
            store.agent_meta(SEGMENTS_UPGRADED_KEY)?.as_deref(),
            Some(&b"1"[..])
        );
        Ok(())
    }

    fn segment(
        provider_id: &str,
        native: &str,
        first: u64,
        last: Option<u64>,
    ) -> Result<BindingSegment, Box<dyn std::error::Error>> {
        Ok(BindingSegment {
            provider: provider(provider_id)?,
            native_thread_id: ProviderThreadRef::same_as(&id(native)?),
            first_turn_ordinal: first,
            last_turn_ordinal: last,
            handoff_refs: Vec::new(),
        })
    }

    #[tokio::test]
    async fn the_active_segment_routes_and_continuations_are_never_their_own_threads()
    -> Result<(), Box<dyn std::error::Error>> {
        let directory = tempfile::tempdir()?;
        let path = directory.path().join("state.redb");
        {
            let bindings = BindingStore::new(Arc::new(IndexStore::open(&path)?));
            bindings
                .replace_segments(
                    &id("app")?,
                    vec![
                        segment("codex", "app", 0, Some(1))?,
                        segment("claude", "claude-session", 2, None)?,
                    ],
                    BindingOrigin::Created,
                )
                .await?;
            assert!(
                bindings
                    .replace_segments(
                        &id("other")?,
                        vec![segment("codex", "app", 0, None)?],
                        BindingOrigin::Created
                    )
                    .await
                    .is_err()
            );
        }
        let bindings = BindingStore::new(Arc::new(IndexStore::open(&path)?));
        assert_eq!(
            bindings.provider_of(&id("app")?).await?,
            Some(provider("claude")?)
        );
        assert!(bindings.is_continuation("claude-session"));
        assert!(!bindings.is_continuation("app"));
        assert_eq!(
            bindings
                .bind(
                    &id("claude-session")?,
                    &provider("claude")?,
                    BindingOrigin::Discovered
                )
                .await?,
            BindOutcome::Continuation
        );
        assert_eq!(bindings.provider_of(&id("claude-session")?).await?, None);
        let registry = ProviderRegistry::single(
            crate::agent::testing::FakeProvider::new("codex", discovery_capabilities()).into_arc(),
            Vec::new(),
        );
        assert_eq!(
            bindings.route(&registry, &id("claude-session")?).await?,
            ThreadRoute::Unknown
        );
        assert_eq!(
            bindings
                .segments(&id("app")?)
                .await?
                .map(|segments| segments.len()),
            Some(2)
        );
        Ok(())
    }

    #[test]
    fn history_concatenates_segments_within_their_spans() -> Result<(), Box<dyn std::error::Error>>
    {
        use crate::agent::model::{TurnId, TurnOrigin, TurnStatus};
        let turn = |turn_id: &str| -> Result<AgentTurn, Box<dyn std::error::Error>> {
            Ok(AgentTurn {
                turn_id: TurnId::parse(turn_id).ok_or("turn id")?,
                status: TurnStatus::Completed,
                origin: TurnOrigin::User,
                started_at: 0,
                completed_at: Some(1),
                error: None,
                items: Vec::new(),
                provenance: None,
                usage: None,
            })
        };
        let history = assemble_history(&[
            (
                segment("codex", "app", 0, Some(1))?,
                vec![turn("c1")?, turn("c2")?, turn("c3-late")?],
            ),
            (
                segment("claude", "session", 2, None)?,
                vec![turn("k1")?, turn("k2")?],
            ),
        ]);
        assert_eq!(
            history
                .iter()
                .map(|turn| turn.turn_id.as_str())
                .collect::<Vec<_>>(),
            ["c1", "c2", "k1", "k2"]
        );
        let single = assemble_history(&[(segment("codex", "app", 0, None)?, vec![turn("c1")?])]);
        assert_eq!(single.len(), 1);
        Ok(())
    }

    fn discovery_capabilities() -> crate::agent::model::CapabilitySet {
        let mut capabilities = crate::agent::model::CapabilitySet::none(
            crate::agent::model::StartWhileActiveMode::NativeJoin,
        );
        capabilities.threads_external_discovery = true;
        capabilities
    }

    #[tokio::test]
    async fn backfill_binds_every_thread_and_resumes_after_a_restart()
    -> Result<(), Box<dyn std::error::Error>> {
        use crate::agent::testing::{FakeProvider, thread};

        let directory = tempfile::tempdir()?;
        let store = Arc::new(IndexStore::open(directory.path().join("state.redb"))?);
        let bindings = Arc::new(BindingStore::new(store.clone()));
        let mut fake = FakeProvider::new("codex", discovery_capabilities());
        fake.threads = (0..1_000)
            .map(|index| {
                let mut row = thread("codex", &format!("thread-{index:04}"), index);
                row.archived = index % 2 == 1;
                row
            })
            .collect();
        let fake = fake.into_arc();
        let first = tokio::spawn(run_backfill(bindings.clone(), fake.clone(), Duration::ZERO));
        let marker = BindingStore::backfill_marker_key(&ProviderId::from_static("codex"));
        tokio::time::timeout(Duration::from_secs(5), async {
            loop {
                if let Ok(Some(progress)) = store.agent_meta(&marker)
                    && serde_json::from_slice::<BackfillProgress>(&progress)
                        .is_ok_and(|progress| progress.cursor.as_deref() == Some("300"))
                {
                    return;
                }
                tokio::task::yield_now().await;
            }
        })
        .await?;
        first.abort();
        let calls_before_restart = fake.calls().len();
        // A fresh store handle stands for a restarted companion.
        let restarted = Arc::new(BindingStore::new(store.clone()));
        run_backfill(restarted.clone(), fake.clone(), Duration::ZERO).await;
        let resumed_calls = fake.calls().len() - calls_before_restart;
        assert!(
            resumed_calls < 10 + 5,
            "restart resumed instead of starting over"
        );
        for index in 0..1_000 {
            let id = AppThreadId::parse(&format!("thread-{index:04}")).ok_or("id")?;
            assert_eq!(
                restarted.provider_of(&id).await?,
                Some(ProviderId::from_static("codex")),
                "{id}"
            );
        }
        let progress: BackfillProgress =
            serde_json::from_slice(&store.agent_meta(&marker)?.ok_or("marker")?)?;
        assert!(progress.done);
        // A finished backfill never pages again.
        let calls = fake.calls().len();
        run_backfill(restarted, fake.clone(), Duration::ZERO).await;
        assert_eq!(fake.calls().len(), calls);
        Ok(())
    }

    #[tokio::test]
    async fn discovery_asks_owners_in_registry_order_only_when_ambiguous()
    -> Result<(), Box<dyn std::error::Error>> {
        use crate::agent::{provider::AgentProvider, testing::FakeProvider};

        let directory = tempfile::tempdir()?;
        let bindings = BindingStore::new(Arc::new(IndexStore::open(
            directory.path().join("state.redb"),
        )?));
        let lone = FakeProvider::new("codex", discovery_capabilities()).into_arc();
        let single = ProviderRegistry::single(lone.clone(), Vec::new());
        assert_eq!(
            bindings.route(&single, &id("cli-thread")?).await?,
            ThreadRoute::Provisional(ProviderId::from_static("codex"))
        );
        assert!(lone.calls().is_empty(), "a lone discoverer is not asked");

        let first = FakeProvider::new("codex", discovery_capabilities()).into_arc();
        let mut second = FakeProvider::new("other", discovery_capabilities());
        second.owned = vec!["other-thread".into()];
        let second = second.into_arc();
        let registry = ProviderRegistry::new(
            vec![
                first.clone() as Arc<dyn AgentProvider>,
                second.clone() as Arc<dyn AgentProvider>,
            ],
            &ProviderId::from_static("codex"),
            Vec::new(),
        )?;
        assert_eq!(
            bindings.route(&registry, &id("other-thread")?).await?,
            ThreadRoute::Bound(ProviderId::from_static("other"))
        );
        assert_eq!(first.calls(), ["thread.owns"]);
        assert_eq!(
            bindings.provider_of(&id("other-thread")?).await?,
            Some(ProviderId::from_static("other"))
        );
        assert_eq!(
            bindings.route(&registry, &id("nobody")?).await?,
            ThreadRoute::Unknown
        );
        Ok(())
    }
}
