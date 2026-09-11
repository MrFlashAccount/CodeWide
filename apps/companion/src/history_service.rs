use std::{
    collections::{HashMap, HashSet},
    fs::File,
    sync::{Arc, Mutex},
    time::Duration,
};

#[cfg(unix)]
use std::os::unix::fs::MetadataExt;

use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

use crate::{
    catalog::{CatalogError, SessionCatalog},
    history::{HistoryError, SummaryProjectionState, summary_projection_state_from_file},
    rollout::{
        IndexError, RolloutWitness, backfill_rollout_prefix, current_indexed_anchor_from_file,
        current_indexed_coverage_from_file, current_indexed_turns_from_file, index_rollout,
        index_rollout_through_anchor, rollout_file_id, rollout_witness_from_file,
        rollout_witness_matches, scan_tail_turns_from_file, scan_turns_after_from_file,
        scan_turns_before_from_file,
    },
    rollout_monitor::{self, RolloutChange},
    store::{IndexStore, TurnRef},
};

const CURSOR_PREFIX: &str = "codewide-history-v1:";
const SOURCE_WITNESS_PREFIX: &str = "codewide-history-source-v1:";
const DEFAULT_PAGE_SIZE: usize = 20;
const MAX_PAGE_SIZE: usize = 100;
const MAX_SUMMARY_CACHE_BYTES: usize = 64 * 1024 * 1024;
const MAX_SUMMARY_CACHE_ENTRY_BYTES: usize = 1024 * 1024;
const MAX_THREAD_PREVIEW_CHARS: usize = 512;
const MAX_THREAD_PREVIEW_CACHE_ENTRIES: usize = 4_096;

#[derive(Clone)]
pub struct HistoryService {
    search: Option<crate::message_search::MessageSearch>,
    catalog: Arc<SessionCatalog>,
    store: Arc<IndexStore>,
    summaries: Arc<Mutex<SummaryCache>>,
    previews: Arc<Mutex<PreviewCache>>,
    invalidation_previews: Arc<Mutex<HashMap<String, Option<String>>>>,
    index_jobs: Arc<Mutex<IndexJobs>>,
}

#[derive(Default)]
struct IndexJobs {
    running: HashSet<String>,
    dirty: HashSet<String>,
}

#[derive(Clone, Eq, Hash, PartialEq)]
struct SummaryKey {
    thread_id: String,
    source: RolloutWitness,
    start_offset: u64,
    end_offset: u64,
}

struct CachedSummary {
    value: Value,
    bytes: usize,
    last_access: u64,
}

#[derive(Default)]
struct SummaryCache {
    values: HashMap<SummaryKey, CachedSummary>,
    bytes: usize,
    clock: u64,
}

#[derive(Clone, Copy, Eq, PartialEq)]
struct FileRevision {
    device: u64,
    inode: u64,
    bytes: u64,
    modified_nanos: u128,
}

struct CachedPreview {
    revision: FileRevision,
    value: LatestThreadState,
    last_access: u64,
}

enum PreviewCacheLookup {
    Miss,
    Hit(LatestThreadState),
}

#[derive(Clone, Default, Eq, PartialEq)]
struct LatestThreadState {
    preview: Option<String>,
    active: bool,
}

#[derive(Default)]
struct PreviewCache {
    values: HashMap<String, CachedPreview>,
    clock: u64,
}

#[derive(Debug, thiserror::Error)]
pub enum HistoryServiceError {
    #[error(transparent)]
    Catalog(#[from] CatalogError),
    #[error(transparent)]
    Rollout(#[from] IndexError),
    #[error(transparent)]
    Store(#[from] crate::store::StoreError),
    #[error(transparent)]
    History(#[from] HistoryError),
    #[error("History cursor is invalid or expired")]
    InvalidCursor,
    #[error("History source changed; reload the canonical history tail")]
    HistorySourceChanged,
    #[error("threadId is required")]
    MissingThreadId,
    #[error("thread history after request is invalid")]
    InvalidAfterRequest,
    #[error("history worker failed: {0}")]
    Worker(String),
    #[error(
        "canonical rollout is stale for thread {thread_id}: expected recency {expected}, newest turn started at {observed:?}"
    )]
    StaleRollout {
        thread_id: String,
        expected: i64,
        observed: Option<i64>,
    },
    #[error(
        "canonical rollout lifecycle is stale for thread {thread_id}: expected active={expected_active}, newest turn active={observed_active:?}"
    )]
    StaleLifecycle {
        thread_id: String,
        expected_active: bool,
        observed_active: Option<bool>,
    },
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct Cursor {
    kind: String,
    thread_id: String,
    direction: String,
    offset: usize,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    source_offset: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    source: Option<RolloutWitness>,
}

impl HistoryService {
    #[must_use]
    pub fn new(catalog: Arc<SessionCatalog>, store: Arc<IndexStore>) -> Self {
        Self {
            search: None,
            catalog,
            store,
            summaries: Arc::new(Mutex::new(SummaryCache::default())),
            previews: Arc::new(Mutex::new(PreviewCache::default())),
            invalidation_previews: Arc::new(Mutex::new(HashMap::new())),
            index_jobs: Arc::new(Mutex::new(IndexJobs::default())),
        }
    }

    /// Attaches the independent full-text index without changing history reads.
    #[must_use]
    pub fn with_search(mut self, search: crate::message_search::MessageSearch) -> Self {
        self.search = Some(search);
        self
    }

    /// Reads neighboring indexed messages without materializing the live thread.
    ///
    /// # Errors
    /// Returns an error for expired search positions or unavailable search.
    pub async fn search_context(
        &self,
        params: &Value,
    ) -> Result<Value, crate::message_search::SearchError> {
        let search = self
            .search
            .as_ref()
            .ok_or(crate::message_search::SearchError::Worker)?;
        Ok(serde_json::to_value(
            search
                .context(serde_json::from_value(params.clone())?)
                .await?,
        )?)
    }

    /// Reads canonical turns around a full-text search position.
    ///
    /// # Errors
    /// Returns stale-position, source and index failures to the caller.
    pub async fn search_window(
        &self,
        params: &Value,
    ) -> Result<Value, crate::message_search::SearchError> {
        self.search
            .as_ref()
            .ok_or(crate::message_search::SearchError::Worker)?
            .window(serde_json::from_value(params.clone())?)
            .await
    }

    /// Searches only persisted documents, independently of App Server resume.
    ///
    /// # Errors
    /// Returns an error when search is unavailable or the query is invalid.
    pub async fn search_messages(
        &self,
        params: &Value,
    ) -> Result<Value, crate::message_search::SearchError> {
        let search = self
            .search
            .as_ref()
            .ok_or(crate::message_search::SearchError::Worker)?;
        let query = serde_json::from_value(params.clone())?;
        Ok(serde_json::to_value(search.search(query).await?)?)
    }

    /// Reads only the indexed mutable-head lifecycle. This is the queue
    /// dispatch oracle: it advances the append-only suffix and never asks App
    /// Server to materialize a full turn list.
    ///
    /// # Errors
    ///
    /// A thread without a rollout has not started its first turn yet and is
    /// therefore idle for queue dispatch. Other index/catalog failures remain
    /// errors, as treating corruption as idle could consume a queue item as a
    /// steer into an active turn.
    pub async fn thread_active(&self, thread_id: &str) -> Result<bool, HistoryServiceError> {
        let catalog = self.catalog.clone();
        let store = self.store.clone();
        let summaries = self.summaries.clone();
        let previews = self.previews.clone();
        let thread_id = thread_id.to_owned();
        tokio::task::spawn_blocking(move || {
            match latest_thread_state(&catalog, &store, &summaries, &previews, &thread_id) {
                Ok(state) => Ok(state.active),
                Err(HistoryServiceError::Catalog(CatalogError::NotFound(_))) => Ok(false),
                Err(error) => Err(error),
            }
        })
        .await
        .map_err(|error| HistoryServiceError::Worker(error.to_string()))?
    }

    fn schedule_rollout_index(&self, thread_id: String) {
        let should_spawn = {
            let mut jobs = self
                .index_jobs
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner);
            if jobs.running.contains(&thread_id) {
                jobs.dirty.insert(thread_id.clone());
                false
            } else {
                jobs.running.insert(thread_id.clone());
                true
            }
        };
        if !should_spawn {
            return;
        }

        let catalog = self.catalog.clone();
        let store = self.store.clone();
        let jobs = self.index_jobs.clone();
        tokio::spawn(async move {
            loop {
                let indexed_thread_id = thread_id.clone();
                let catalog = catalog.clone();
                let store = store.clone();
                let result = tokio::task::spawn_blocking(move || {
                    let path = catalog
                        .resolve(&indexed_thread_id)
                        .map_err(|error| error.to_string())?;
                    let hot = index_rollout(&store, &path).map_err(|error| error.to_string())?;
                    if hot.complete || hot.indexed_records > 0 {
                        Ok::<_, String>(hot)
                    } else {
                        backfill_rollout_prefix(&store, &path).map_err(|error| error.to_string())
                    }
                })
                .await;
                let backfill_pending = matches!(&result, Ok(Ok(report)) if !report.complete);
                match &result {
                    Ok(Ok(report)) => tracing::debug!(
                        thread_id,
                        indexed_records = report.indexed_records,
                        coverage_start = report.coverage_start,
                        complete = report.complete,
                        elapsed_ms = report.elapsed_ms,
                        "canonical rollout index advanced"
                    ),
                    Ok(Err(error)) => tracing::warn!(
                        thread_id,
                        reason = %error,
                        "canonical rollout indexing failed"
                    ),
                    Err(error) => tracing::warn!(
                        thread_id,
                        reason = %error,
                        "canonical rollout indexing task failed"
                    ),
                }
                if backfill_pending {
                    // Prefix work is intentionally low-priority: publish one
                    // adjacent turn, yield the blocking lane, then continue.
                    tokio::time::sleep(Duration::from_millis(5)).await;
                    continue;
                }

                let repeat = {
                    let mut jobs = jobs
                        .lock()
                        .unwrap_or_else(std::sync::PoisonError::into_inner);
                    if jobs.dirty.remove(&thread_id) {
                        true
                    } else {
                        jobs.running.remove(&thread_id);
                        false
                    }
                };
                if !repeat {
                    break;
                }
            }
        });
    }

    /// Starts the shared canonical-rollout invalidation stream.
    ///
    /// # Errors
    ///
    /// Returns the platform watcher error when an existing rollout root cannot
    /// be observed.
    pub fn spawn_rollout_monitor(
        &self,
    ) -> Result<tokio::sync::mpsc::Receiver<RolloutChange>, notify::Error> {
        rollout_monitor::spawn(self.catalog.rollout_roots())
    }

    /// Reads the canonical subagent tree from the shared thread metadata index.
    ///
    /// # Errors
    ///
    /// Returns an error when the root id is missing or the index cannot be read.
    pub fn subagent_descendants(&self, params: &Value) -> Result<Value, HistoryServiceError> {
        let root_thread_id = params
            .get("threadId")
            .and_then(Value::as_str)
            .filter(|value| !value.is_empty())
            .ok_or(HistoryServiceError::MissingThreadId)?;
        Ok(json!({
            "threads": self.store.thread_descendants(root_thread_id)?
        }))
    }

    /// Builds a small semantic invalidation for changes written by a different
    /// App Server process. Detailed turns remain lazy and bounded.
    pub async fn rollout_invalidation_event(&self, change: RolloutChange) -> Value {
        let thread_id = change.thread_id.clone();
        let archived = change.archived;
        let catalog = self.catalog.clone();
        let store = self.store.clone();
        let summaries = self.summaries.clone();
        let previews = self.previews.clone();
        let invalidation_previews = self.invalidation_previews.clone();
        tokio::task::spawn_blocking(move || {
            let state = latest_thread_state(&catalog, &store, &summaries, &previews, &thread_id)
                .unwrap_or_default();
            let preview = state.preview;
            let conversation_message = match invalidation_previews.lock() {
                Ok(mut previous) => {
                    previous.insert(thread_id.clone(), preview.clone()) != Some(preview.clone())
                }
                Err(poisoned) => {
                    poisoned
                        .into_inner()
                        .insert(thread_id.clone(), preview.clone())
                        != Some(preview.clone())
                }
            };
            let mut summary = json!({
                "activity": true,
                "conversationMessage": conversation_message,
                "finalAgentResponse": false,
            });
            if let Some(preview) = preview
                && let Some(summary) = summary.as_object_mut()
            {
                summary.insert("previewText".into(), Value::String(preview));
            }
            // A partial rollout projection is suitable for the thread-list
            // preview, but not authoritative enough to replace a live item
            // chain. Only the terminal boundary asks clients to refresh detail.
            let method = if state.active {
                "companion/thread/progress"
            } else {
                "companion/thread/invalidated"
            };
            let operation_kind = if state.active {
                "threadProgress"
            } else {
                "threadInvalidated"
            };
            json!({
                "method": method,
                "params": {
                    "threadId": thread_id,
                    "archived": archived,
                    "turnActive": state.active,
                    "source": "rollout"
                },
                "codewideThreadPatch": {
                    "version": 1,
                    "threadId": thread_id,
                    "operation": {
                        "kind": operation_kind,
                        "archived": archived,
                        "summary": summary
                    }
                }
            })
        })
        .await
        .unwrap_or_else(|error| {
            tracing::warn!(%error, "rollout invalidation projection task failed");
            json!({
                "method": "companion/thread/invalidated",
                "params": {
                    "threadId": change.thread_id,
                    "archived": archived,
                    "turnActive": false,
                    "source": "rollout"
                },
                "codewideThreadPatch": {
                    "version": 1,
                    "threadId": change.thread_id,
                    "operation": {
                        "kind": "threadInvalidated",
                        "archived": archived,
                        "turnActive": false
                    }
                }
            })
        })
    }

    /// Advances the local catalog and offset index immediately. UI
    /// invalidation may still be suppressed for upstream-originated writes,
    /// but local indexed reads must never wait for that suppression window.
    pub fn observe_rollout_change(&self, change: &RolloutChange) {
        if let Err(error) = self
            .catalog
            .observe_rollout(&change.thread_id, change.path.clone())
        {
            tracing::warn!(thread_id = change.thread_id, %error, "rollout catalog update failed");
        }
        self.schedule_rollout_index(change.thread_id.clone());
    }

    /// Serves summary/not-loaded descending turn pages from canonical JSONL.
    /// Other views stay on the upstream oracle until their projector reaches
    /// differential parity.
    pub async fn try_turns_page(
        &self,
        method: &str,
        params: &Value,
    ) -> Option<Result<Value, HistoryServiceError>> {
        if method != "thread/turns/list" {
            return None;
        }
        let view = params
            .get("itemsView")
            .and_then(Value::as_str)
            .unwrap_or("summary");
        let direction = params
            .get("sortDirection")
            .and_then(Value::as_str)
            .unwrap_or("desc");
        if !matches!(view, "summary" | "notLoaded") || direction != "desc" {
            return None;
        }
        let not_loaded = view == "notLoaded";
        if let Some(thread_id) = params.get("threadId").and_then(Value::as_str) {
            self.schedule_rollout_index(thread_id.to_owned());
        }
        let params = params.clone();
        let catalog = self.catalog.clone();
        let store = self.store.clone();
        let summaries = self.summaries.clone();
        Some(
            tokio::task::spawn_blocking(move || {
                turns_page(&catalog, &store, &summaries, &params, not_loaded)
            })
            .await
            .map_err(|_join_error| HistoryServiceError::InvalidCursor)
            .and_then(|result| result),
        )
    }

    /// Synchronizes immutable thread history from a semantic turn cursor.
    ///
    /// A known cursor is an O(1) index lookup followed by a bounded forward
    /// read. A missing or expired cursor returns a bounded latest reset; the
    /// mutable turn is deliberately excluded and remains App Server-owned.
    ///
    /// # Errors
    ///
    /// Returns an error when the canonical rollout or its derived index cannot
    /// be read.
    pub async fn sync_thread_history(
        &self,
        thread_id: &str,
        after_turn_id: Option<&str>,
        limit: usize,
        active_turn_id: Option<&str>,
    ) -> Result<Value, HistoryServiceError> {
        self.sync_thread_history_with_source(thread_id, after_turn_id, limit, active_turn_id, None)
            .await
    }

    /// Synchronizes against an optional prior source witness. Incompatible
    /// sources return a canonical reset instead of extending stale history.
    ///
    /// # Errors
    /// Returns a source, projection, or malformed witness error.
    pub async fn sync_thread_history_with_source(
        &self,
        thread_id: &str,
        after_turn_id: Option<&str>,
        limit: usize,
        active_turn_id: Option<&str>,
        source_witness: Option<&str>,
    ) -> Result<Value, HistoryServiceError> {
        let source = source_witness.map(decode_source_witness_text).transpose()?;
        let catalog = self.catalog.clone();
        let store = self.store.clone();
        let summaries = self.summaries.clone();
        let thread_id = thread_id.to_owned();
        let after_turn_id = after_turn_id.map(str::to_owned);
        let active_turn_id = active_turn_id.map(str::to_owned);
        tokio::task::spawn_blocking(move || {
            sync_history_with_source(
                &catalog,
                &store,
                &summaries,
                HistorySyncRequest {
                    thread_id: &thread_id,
                    after_turn_id: after_turn_id.as_deref(),
                    limit,
                    active_turn_id: active_turn_id.as_deref(),
                    source: source.as_ref(),
                },
            )
        })
        .await
        .map_err(|error| HistoryServiceError::Worker(error.to_string()))?
    }

    /// Reads one ascending immutable history page after a stable turn id.
    ///
    /// Unlike thread synchronization this does not resume the thread, attach
    /// an observer, or read the mutable App Server head.
    ///
    /// # Errors
    ///
    /// Returns an error for invalid parameters, an expired anchor, or an
    /// unavailable canonical rollout.
    pub async fn turns_after(&self, params: &Value) -> Result<Value, HistoryServiceError> {
        self.semantic_page(params, HistoryDirection::After).await
    }

    /// Reads the nearest immutable turns strictly before a semantic anchor.
    /// Results are chronological; `hasMore` describes additional older turns.
    ///
    /// # Errors
    /// Returns an error for invalid parameters, an expired anchor or source,
    /// or an unavailable canonical rollout.
    pub async fn turns_before(&self, params: &Value) -> Result<Value, HistoryServiceError> {
        self.semantic_page(params, HistoryDirection::Before).await
    }

    async fn semantic_page(
        &self,
        params: &Value,
        direction: HistoryDirection,
    ) -> Result<Value, HistoryServiceError> {
        let request = parse_semantic_request(params, direction)?;
        let catalog = self.catalog.clone();
        let store = self.store.clone();
        let summaries = self.summaries.clone();
        tokio::task::spawn_blocking(move || {
            semantic_history_page(&catalog, &store, &summaries, &request, direction)
        })
        .await
        .map_err(|error| HistoryServiceError::Worker(error.to_string()))?
    }

    /// Replaces the App Server's first-prompt `Thread.preview` with the newest
    /// canonical conversation text required by the `CodeWide` chat list.
    ///
    /// This is an intentional companion-contract break: downstream clients no
    /// longer need to understand two competing preview fields.
    pub async fn enrich_thread_list(&self, result: Value) -> Value {
        let fallback = result.clone();
        let catalog = self.catalog.clone();
        let store = self.store.clone();
        let summaries = self.summaries.clone();
        let previews = self.previews.clone();
        match tokio::task::spawn_blocking(move || {
            enrich_thread_list_result(&catalog, &store, &summaries, &previews, result)
        })
        .await
        {
            Ok(result) => result,
            Err(error) => {
                tracing::warn!(%error, "thread list preview projection task failed");
                fallback
            }
        }
    }

    /// Projects the latest canonical conversation preview onto one App Server thread record.
    pub async fn enrich_thread(&self, thread: Value) -> Value {
        let mut result = self.enrich_thread_list(json!({ "data": [thread] })).await;
        result
            .get_mut("data")
            .and_then(Value::as_array_mut)
            .and_then(Vec::pop)
            .unwrap_or(Value::Null)
    }
}

#[derive(Clone, Copy)]
enum HistoryDirection {
    After,
    Before,
}

struct SemanticHistoryRequest {
    thread_id: String,
    anchor_turn_id: String,
    limit: usize,
    source: Option<RolloutWitness>,
}

fn parse_semantic_request(
    params: &Value,
    direction: HistoryDirection,
) -> Result<SemanticHistoryRequest, HistoryServiceError> {
    let params = params
        .as_object()
        .ok_or(HistoryServiceError::InvalidAfterRequest)?;
    let thread_id = params
        .get("threadId")
        .and_then(Value::as_str)
        .filter(|value| !value.is_empty())
        .ok_or(HistoryServiceError::InvalidAfterRequest)?;
    let anchor_key = match direction {
        HistoryDirection::After => "afterTurnId",
        HistoryDirection::Before => "beforeTurnId",
    };
    let anchor_turn_id = params
        .get(anchor_key)
        .and_then(Value::as_str)
        .filter(|value| !value.is_empty())
        .ok_or(HistoryServiceError::InvalidAfterRequest)?;
    let limit = params
        .get("limit")
        .and_then(Value::as_u64)
        .and_then(|value| usize::try_from(value).ok())
        .filter(|value| (1..=MAX_PAGE_SIZE).contains(value))
        .ok_or(HistoryServiceError::InvalidAfterRequest)?;
    Ok(SemanticHistoryRequest {
        thread_id: thread_id.to_owned(),
        anchor_turn_id: anchor_turn_id.to_owned(),
        limit,
        source: decode_source_witness(params.get("sourceWitness"))?,
    })
}

fn enrich_thread_list_result(
    catalog: &SessionCatalog,
    store: &IndexStore,
    summaries: &Mutex<SummaryCache>,
    previews: &Mutex<PreviewCache>,
    mut result: Value,
) -> Value {
    // A list page carries catalog-wide metadata; single-thread enrichment does not.
    if result.get("nextCursor").is_some() {
        let summary = catalog
            .summary()
            .ok()
            .and_then(|value| serde_json::to_value(value).ok());
        result["codewideCatalogSummary"] = summary.unwrap_or(Value::Null);
    }
    let Some(threads) = result.get_mut("data").and_then(Value::as_array_mut) else {
        return result;
    };
    for thread in threads {
        let Some(thread_id) = thread.get("id").and_then(Value::as_str) else {
            continue;
        };
        let preview = match latest_thread_preview(catalog, store, summaries, previews, thread_id) {
            Ok(preview) => preview.unwrap_or_default(),
            Err(error) => {
                tracing::debug!(thread_id, %error, "latest thread preview is unavailable");
                continue;
            }
        };
        if let Some(thread) = thread.as_object_mut() {
            thread.insert("preview".into(), Value::String(preview));
        }
    }
    result
}

fn latest_thread_preview(
    catalog: &SessionCatalog,
    store: &IndexStore,
    summaries: &Mutex<SummaryCache>,
    previews: &Mutex<PreviewCache>,
    thread_id: &str,
) -> Result<Option<String>, HistoryServiceError> {
    Ok(latest_thread_state(catalog, store, summaries, previews, thread_id)?.preview)
}

fn latest_thread_state(
    catalog: &SessionCatalog,
    store: &IndexStore,
    summaries: &Mutex<SummaryCache>,
    previews: &Mutex<PreviewCache>,
    thread_id: &str,
) -> Result<LatestThreadState, HistoryServiceError> {
    let path = catalog.resolve(thread_id)?;
    // The persisted projection is append-incremental. Advancing it here costs
    // only the newly durable JSONL records and makes the following read
    // independent of the total rollout size.
    index_rollout(store, &path)?;
    let lane = store.rollout_index_lock(rollout_file_id(&path));
    let _guard = lane
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
    let reader = HistoryReader::open(store, summaries, thread_id, &path)?;
    let metadata = reader.file.metadata().map_err(IndexError::from)?;
    let revision = file_revision(&metadata);
    if let PreviewCacheLookup::Hit(preview) = cached_preview(previews, thread_id, revision) {
        return Ok(preview);
    }
    let (turns, indexed_exact) = reader.latest(None, 1)?;
    let Some(projected) = reader.project(&turns, indexed_exact)?.pop() else {
        reader.finish()?;
        let state = LatestThreadState::default();
        remember_preview(previews, thread_id, revision, state.clone());
        return Ok(state);
    };
    reader.finish()?;
    let preview = summary_preview(&projected);
    let active = projected.get("status").and_then(Value::as_str) == Some("inProgress");
    let state = LatestThreadState { preview, active };
    remember_preview(previews, thread_id, revision, state.clone());
    Ok(state)
}

fn cached_preview(
    cache: &Mutex<PreviewCache>,
    thread_id: &str,
    revision: FileRevision,
) -> PreviewCacheLookup {
    let mut cache = cache
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
    cache.clock = cache.clock.saturating_add(1);
    let clock = cache.clock;
    let Some(value) = cache.values.get_mut(thread_id) else {
        return PreviewCacheLookup::Miss;
    };
    if value.revision != revision {
        return PreviewCacheLookup::Miss;
    }
    value.last_access = clock;
    PreviewCacheLookup::Hit(value.value.clone())
}

fn remember_preview(
    cache: &Mutex<PreviewCache>,
    thread_id: &str,
    revision: FileRevision,
    value: LatestThreadState,
) {
    let mut cache = cache
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
    cache.clock = cache.clock.saturating_add(1);
    let last_access = cache.clock;
    if cache.values.len() >= MAX_THREAD_PREVIEW_CACHE_ENTRIES
        && !cache.values.contains_key(thread_id)
        && let Some(oldest) = cache
            .values
            .iter()
            .min_by_key(|(_, value)| value.last_access)
            .map(|(key, _)| key.clone())
    {
        cache.values.remove(&oldest);
    }
    cache.values.insert(
        thread_id.to_owned(),
        CachedPreview {
            revision,
            value,
            last_access,
        },
    );
}

fn summary_preview(turn: &Value) -> Option<String> {
    let items = turn.get("items")?.as_array()?;
    for expected_type in ["agentMessage", "userMessage"] {
        for item in items.iter().rev() {
            if item.get("type").and_then(Value::as_str) != Some(expected_type) {
                continue;
            }
            let raw = if expected_type == "agentMessage" {
                item.get("text").and_then(Value::as_str).unwrap_or_default()
            } else {
                return item
                    .get("content")
                    .and_then(Value::as_array)
                    .into_iter()
                    .flatten()
                    .filter(|part| part.get("type").and_then(Value::as_str) == Some("text"))
                    .filter_map(|part| part.get("text").and_then(Value::as_str))
                    .map(normalize_preview)
                    .find(|text| !text.is_empty());
            };
            let preview = normalize_preview(raw);
            if !preview.is_empty() {
                return Some(preview);
            }
        }
    }
    None
}

fn normalize_preview(value: &str) -> String {
    value
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .chars()
        .take(MAX_THREAD_PREVIEW_CHARS)
        .collect()
}

/// Qualifies index rows and projections against one open canonical source. The
/// caller holds the rollout index lane for this reader's complete lifetime.
struct HistoryReader<'a> {
    store: &'a IndexStore,
    summaries: &'a Mutex<SummaryCache>,
    thread_id: &'a str,
    path: &'a std::path::Path,
    file: File,
    source: RolloutWitness,
}

impl<'a> HistoryReader<'a> {
    fn open(
        store: &'a IndexStore,
        summaries: &'a Mutex<SummaryCache>,
        thread_id: &'a str,
        path: &'a std::path::Path,
    ) -> Result<Self, HistoryServiceError> {
        let file = File::open(path).map_err(IndexError::from)?;
        let file_bytes = file.metadata().map_err(IndexError::from)?.len();
        let source = rollout_witness_from_file(&file, file_bytes)?;
        Ok(Self {
            store,
            summaries,
            thread_id,
            path,
            file,
            source,
        })
    }

    fn validate_source(&self, source: &RolloutWitness) -> Result<(), HistoryServiceError> {
        if rollout_witness_matches(&self.file, self.source.durable_bytes, source)? {
            Ok(())
        } else {
            Err(HistoryServiceError::HistorySourceChanged)
        }
    }

    fn finish(&self) -> Result<String, HistoryServiceError> {
        let bytes = self.file.metadata().map_err(IndexError::from)?.len();
        if !rollout_witness_matches(&self.file, bytes, &self.source)? {
            return Err(HistoryServiceError::HistorySourceChanged);
        }
        encode_source_witness(&self.source)
    }

    fn latest(
        &self,
        before: Option<u64>,
        limit: usize,
    ) -> Result<(Vec<TurnRef>, bool), HistoryServiceError> {
        if let Some(indexed) = current_indexed_turns_from_file(
            self.store,
            self.path,
            &self.file,
            self.source.durable_bytes,
            before,
            limit,
        )? && !indexed.has_more
        {
            return Ok((indexed.turns, true));
        }
        let turns =
            scan_tail_turns_from_file(&self.file, self.source.durable_bytes, before, limit)?
                .turns
                .into_iter()
                .map(|turn| TurnRef {
                    id: turn.id,
                    start_offset: turn.start_offset,
                    end_offset: turn.end_offset,
                    completed: turn.completed,
                })
                .collect();
        Ok((turns, false))
    }

    fn anchored(
        &self,
        anchor_id: &str,
        direction: HistoryDirection,
        limit: usize,
    ) -> Result<Option<(Vec<TurnRef>, bool)>, HistoryServiceError> {
        if let Some(anchor) = current_indexed_anchor_from_file(
            self.store,
            self.path,
            &self.file,
            self.source.durable_bytes,
            anchor_id,
        )? {
            if anchor.end_offset == 0 {
                return Ok(None);
            }
            return match direction {
                HistoryDirection::After => Ok(Some((
                    self.store.turns_asc_after(
                        &rollout_file_id(self.path),
                        anchor.start_offset,
                        limit,
                    )?,
                    true,
                ))),
                HistoryDirection::Before => self.latest(Some(anchor.start_offset), limit).map(Some),
            };
        }
        if current_indexed_coverage_from_file(
            self.store,
            self.path,
            &self.file,
            self.source.durable_bytes,
        )?
        .is_some_and(crate::store::FileState::is_complete)
        {
            return Ok(None);
        }
        let turns = match direction {
            HistoryDirection::After => {
                scan_turns_after_from_file(&self.file, self.source.durable_bytes, anchor_id, limit)?
            }
            HistoryDirection::Before => scan_turns_before_from_file(
                &self.file,
                self.source.durable_bytes,
                anchor_id,
                limit,
            )?,
        };
        Ok(turns.map(|turns| (turns, false)))
    }

    fn project(&self, turns: &[TurnRef], indexed: bool) -> Result<Vec<Value>, HistoryServiceError> {
        let mut projected = Vec::with_capacity(turns.len());
        for turn in turns {
            let key = SummaryKey {
                thread_id: self.thread_id.to_owned(),
                source: self.source.clone(),
                start_offset: turn.start_offset,
                end_offset: turn.end_offset,
            };
            let value = if let Some(value) = cached_summary(self.summaries, &key) {
                value
            } else {
                let value = projected_turn(
                    self.store,
                    self.path,
                    &self.file,
                    turn,
                    indexed,
                    self.source.durable_bytes,
                )?;
                remember_summary(self.summaries, key, &value);
                value
            };
            projected.push(value);
        }
        Ok(projected)
    }
}

fn semantic_history_page(
    catalog: &SessionCatalog,
    store: &IndexStore,
    summaries: &Mutex<SummaryCache>,
    request: &SemanticHistoryRequest,
    direction: HistoryDirection,
) -> Result<Value, HistoryServiceError> {
    let path = catalog.resolve(&request.thread_id)?;
    let older_limit = match direction {
        HistoryDirection::After => 0,
        HistoryDirection::Before => request.limit.saturating_add(1),
    };
    index_rollout_through_anchor(store, &path, &request.anchor_turn_id, older_limit)?;
    let lane = store.rollout_index_lock(rollout_file_id(&path));
    let _guard = lane
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
    let reader = HistoryReader::open(store, summaries, &request.thread_id, &path)?;
    if let Some(source) = &request.source {
        reader.validate_source(source)?;
    }
    let Some((refs, indexed)) = reader.anchored(
        &request.anchor_turn_id,
        direction,
        request.limit.saturating_add(2),
    )?
    else {
        return Err(HistoryServiceError::InvalidCursor);
    };
    let mut sealed = refs
        .into_iter()
        .filter(|turn| is_immutable_turn_ref(turn, None))
        .take(request.limit.saturating_add(1))
        .collect::<Vec<_>>();
    let has_more = sealed.len() > request.limit;
    sealed.truncate(request.limit);
    if matches!(direction, HistoryDirection::Before) {
        sealed.reverse();
    }
    let turns = reader.project(&sealed, indexed)?;
    Ok(json!({"data":turns, "hasMore":has_more, "sourceWitness":reader.finish()?}))
}

fn turns_page(
    catalog: &SessionCatalog,
    store: &IndexStore,
    summaries: &Mutex<SummaryCache>,
    params: &Value,
    not_loaded: bool,
) -> Result<Value, HistoryServiceError> {
    let thread_id = params
        .get("threadId")
        .and_then(Value::as_str)
        .ok_or(HistoryServiceError::MissingThreadId)?;
    let limit = params
        .get("limit")
        .and_then(Value::as_u64)
        .and_then(|value| usize::try_from(value).ok())
        .unwrap_or(DEFAULT_PAGE_SIZE)
        .clamp(1, MAX_PAGE_SIZE);
    let cursor = decode_cursor(params.get("cursor"), thread_id)?;
    let logical_offset = cursor.as_ref().map_or(0, |cursor| cursor.offset);
    let source_offset = cursor.as_ref().and_then(|cursor| cursor.source_offset);
    let scan_limit = if source_offset.is_some() {
        limit.saturating_add(1)
    } else {
        logical_offset.saturating_add(limit).saturating_add(1)
    };
    let path = catalog.resolve(thread_id)?;
    index_rollout(store, &path)?;
    let lane = store.rollout_index_lock(rollout_file_id(&path));
    let _guard = lane
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
    let reader = HistoryReader::open(store, summaries, thread_id, &path)?;
    if let Some(cursor) = &cursor {
        let source = cursor
            .source
            .as_ref()
            .ok_or(HistoryServiceError::InvalidCursor)?;
        reader
            .validate_source(source)
            .map_err(|error| match error {
                HistoryServiceError::HistorySourceChanged => HistoryServiceError::InvalidCursor,
                other => other,
            })?;
    }
    // The initial descending surface may publish a short indexed tail while
    // prefix coverage warms. Semantic pages instead require a proven sentinel.
    let (discovered, indexed_exact, indexed_has_more) = if let Some(indexed) =
        current_indexed_turns_from_file(
            store,
            &path,
            &reader.file,
            reader.source.durable_bytes,
            source_offset,
            scan_limit,
        )? {
        (indexed.turns, true, indexed.has_more)
    } else {
        let (turns, indexed) = reader.latest(source_offset, scan_limit)?;
        (turns, indexed, false)
    };
    let page_refs: Vec<_> = if source_offset.is_some() {
        discovered
    } else {
        discovered.into_iter().skip(logical_offset).collect()
    };
    let has_more = indexed_has_more || page_refs.len() > limit;
    let selected = page_refs.into_iter().take(limit).collect::<Vec<_>>();
    let mut data = reader.project(&selected, indexed_exact)?;
    for projected in &mut data {
        if not_loaded && let Some(object) = projected.as_object_mut() {
            object.insert("items".into(), json!([]));
            object.insert("itemsView".into(), Value::String("notLoaded".into()));
            object.remove("codewide");
        }
    }
    validate_expected_recency(params, cursor.as_ref(), thread_id, &data)?;
    validate_expected_lifecycle(params, cursor.as_ref(), thread_id, &data)?;
    let next_cursor = if has_more {
        selected.last().map(|turn| {
            encode_cursor(&Cursor {
                kind: "turns".into(),
                thread_id: thread_id.to_owned(),
                direction: "desc".into(),
                offset: logical_offset.saturating_add(selected.len()),
                source_offset: Some(turn.start_offset),
                source: Some(reader.source.clone()),
            })
        })
    } else {
        None
    };
    Ok(json!({
        "data": data,
        "nextCursor": next_cursor,
        "backwardsCursor": Value::Null,
        "sourceWitness": reader.finish()?,
    }))
}

#[cfg(test)]
fn sync_history(
    catalog: &SessionCatalog,
    store: &IndexStore,
    summaries: &Mutex<SummaryCache>,
    thread_id: &str,
    after_turn_id: Option<&str>,
    limit: usize,
    active_turn_id: Option<&str>,
) -> Result<Value, HistoryServiceError> {
    sync_history_with_source(
        catalog,
        store,
        summaries,
        HistorySyncRequest {
            thread_id,
            after_turn_id,
            limit,
            active_turn_id,
            source: None,
        },
    )
}

#[derive(Clone, Copy)]
struct HistorySyncRequest<'a> {
    thread_id: &'a str,
    after_turn_id: Option<&'a str>,
    limit: usize,
    active_turn_id: Option<&'a str>,
    source: Option<&'a RolloutWitness>,
}

fn sync_history_with_source(
    catalog: &SessionCatalog,
    store: &IndexStore,
    summaries: &Mutex<SummaryCache>,
    request: HistorySyncRequest<'_>,
) -> Result<Value, HistoryServiceError> {
    let HistorySyncRequest {
        thread_id,
        after_turn_id,
        limit,
        active_turn_id,
        source,
    } = request;
    let limit = limit.clamp(1, MAX_PAGE_SIZE);
    let path = catalog.resolve(thread_id)?;
    if let Some(anchor) = after_turn_id.filter(|id| Some(*id) != active_turn_id) {
        index_rollout_through_anchor(store, &path, anchor, 0)?;
    } else {
        index_rollout(store, &path)?;
    }
    let lane = store.rollout_index_lock(rollout_file_id(&path));
    let _guard = lane
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
    let reader = HistoryReader::open(store, summaries, thread_id, &path)?;
    let after_turn_id = if let Some(source) = source {
        match reader.validate_source(source) {
            Ok(()) => after_turn_id,
            Err(HistoryServiceError::HistorySourceChanged) => None,
            Err(error) => return Err(error),
        }
    } else {
        after_turn_id
    };
    let scan_limit = limit.saturating_add(2);
    let (latest_refs, latest_refs_are_indexed) = reader.latest(None, scan_limit)?;
    let head_turn_id = latest_refs
        .iter()
        .find(|turn| is_immutable_turn_ref(turn, active_turn_id))
        .map(|turn| turn.id.clone());

    if let Some(anchor) = after_turn_id.filter(|id| Some(*id) != active_turn_id)
        && let Some((discovered, indexed)) =
            reader.anchored(anchor, HistoryDirection::After, scan_limit)?
    {
        let mut sealed = discovered
            .into_iter()
            .filter(|turn| is_immutable_turn_ref(turn, active_turn_id))
            .take(limit.saturating_add(1))
            .collect::<Vec<_>>();
        let has_more = sealed.len() > limit;
        sealed.truncate(limit);
        let turns = reader.project(&sealed, indexed)?;
        return Ok(json!({
            "kind": if turns.is_empty() { "current" } else { "delta" },
            "headTurnId": head_turn_id,
            "turns": turns,
            "hasMore": has_more,
            "olderCursor": Value::Null,
            "sourceWitness": reader.finish()?,
        }));
    }

    let reset = latest_reset(
        latest_refs,
        thread_id,
        limit,
        active_turn_id,
        &reader.source,
    );
    let mut turns = reader.project(&reset.turns, latest_refs_are_indexed)?;
    turns.reverse();
    Ok(json!({
        "kind": "reset",
        "headTurnId": head_turn_id,
        "turns": turns,
        "hasMore": false,
        "olderCursor": reset.older_cursor,
        "sourceWitness": reader.finish()?,
    }))
}

struct LatestReset {
    turns: Vec<TurnRef>,
    older_cursor: Option<String>,
}

fn latest_reset(
    latest_refs: Vec<TurnRef>,
    thread_id: &str,
    limit: usize,
    active_turn_id: Option<&str>,
    source: &RolloutWitness,
) -> LatestReset {
    let mut turns = latest_refs
        .into_iter()
        .filter(|turn| is_immutable_turn_ref(turn, active_turn_id))
        .take(limit.saturating_add(1))
        .collect::<Vec<_>>();
    let has_older = turns.len() > limit;
    turns.truncate(limit);
    let older_cursor = if has_older {
        turns.last().map(|turn| {
            encode_cursor(&Cursor {
                kind: "turns".into(),
                thread_id: thread_id.to_owned(),
                direction: "desc".into(),
                offset: turns.len(),
                source_offset: Some(turn.start_offset),
                source: Some(source.clone()),
            })
        })
    } else {
        None
    };
    LatestReset {
        turns,
        older_cursor,
    }
}

fn is_immutable_turn_ref(turn: &TurnRef, active_turn_id: Option<&str>) -> bool {
    turn.end_offset > turn.start_offset && active_turn_id != Some(turn.id.as_str())
}

fn projected_turn(
    store: &IndexStore,
    path: &std::path::Path,
    rollout: &File,
    turn: &TurnRef,
    indexed_exact: bool,
    durable_bytes: u64,
) -> Result<Value, HistoryServiceError> {
    let file_id = rollout_file_id(path);
    let cached = if indexed_exact {
        store
            .turn_summary_state::<SummaryProjectionState>(&file_id, turn.start_offset)?
            .filter(SummaryProjectionState::is_current)
    } else {
        None
    };
    let mut summary = if let Some(summary) = cached {
        summary
    } else {
        let summary = if turn.end_offset == 0 {
            let snapshot = TurnRef {
                id: turn.id.clone(),
                start_offset: turn.start_offset,
                end_offset: durable_bytes,
                completed: false,
            };
            summary_projection_state_from_file(rollout, &snapshot)?
        } else {
            summary_projection_state_from_file(rollout, turn)?
        };
        if indexed_exact {
            store.put_turn_summary_state(&file_id, turn.start_offset, &summary)?;
        }
        summary
    };
    if turn.end_offset != 0 {
        summary.seal_interrupted();
    }
    Ok(summary.project())
}

/// `thread/resume` returns the App Server's authoritative `recencyAt`. A
/// rollout discovered on disk can still be an empty shell or an older local
/// copy when another Codex client created or advanced the thread. Treating
/// that page as a successful empty/stale result prevents the bounded upstream
/// oracle from ever running and makes the conversation appear blank.
fn validate_expected_recency(
    params: &Value,
    cursor: Option<&Cursor>,
    thread_id: &str,
    data: &[Value],
) -> Result<(), HistoryServiceError> {
    if cursor.is_some() {
        return Ok(());
    }
    let Some(expected) = params.get("expectedRecencyAt").and_then(Value::as_i64) else {
        return Ok(());
    };
    let observed = data
        .iter()
        .filter_map(|turn| turn.get("startedAt").and_then(Value::as_i64))
        .max();
    if observed.is_some_and(|observed| observed >= expected) {
        return Ok(());
    }
    Err(HistoryServiceError::StaleRollout {
        thread_id: thread_id.to_owned(),
        expected,
        observed,
    })
}

/// The rollout index and App Server metadata advance independently while the
/// phone is suspended. `thread/resume` supplies the authoritative lifecycle so
/// an indexed mutable head cannot be mistaken for a completed conversation (or
/// vice versa). A mismatch makes the caller use the bounded App Server page.
fn validate_expected_lifecycle(
    params: &Value,
    cursor: Option<&Cursor>,
    thread_id: &str,
    data: &[Value],
) -> Result<(), HistoryServiceError> {
    if cursor.is_some() {
        return Ok(());
    }
    let Some(expected_active) = params.get("expectedThreadActive").and_then(Value::as_bool) else {
        return Ok(());
    };
    let observed_active = data
        .first()
        .and_then(|turn| turn.get("status"))
        .and_then(Value::as_str)
        .map(|status| status == "inProgress");
    let missing_final = params.get("itemsView").and_then(Value::as_str) == Some("summary")
        && !expected_active
        && data.first().is_some_and(|turn| {
            turn.get("status").and_then(Value::as_str) == Some("completed")
                && !turn
                    .get("items")
                    .and_then(Value::as_array)
                    .is_some_and(|items| {
                        items.iter().any(|item| {
                            item.get("type").and_then(Value::as_str) == Some("agentMessage")
                                && item
                                    .get("text")
                                    .and_then(Value::as_str)
                                    .is_some_and(|text| !text.trim().is_empty())
                        })
                    })
        });
    if observed_active == Some(expected_active) && !missing_final {
        return Ok(());
    }
    // An idle thread may legitimately contain no turns (for example, a shell
    // created before its first prompt). An active thread cannot.
    if observed_active.is_none() && !expected_active && data.is_empty() {
        return Ok(());
    }
    Err(HistoryServiceError::StaleLifecycle {
        thread_id: thread_id.to_owned(),
        expected_active,
        observed_active,
    })
}

fn cached_summary(cache: &Mutex<SummaryCache>, key: &SummaryKey) -> Option<Value> {
    let mut cache = cache
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
    cache.clock = cache.clock.saturating_add(1);
    let clock = cache.clock;
    let value = cache.values.get_mut(key)?;
    value.last_access = clock;
    Some(value.value.clone())
}

fn remember_summary(cache: &Mutex<SummaryCache>, key: SummaryKey, value: &Value) {
    let bytes = serde_json::to_vec(value).map_or(0, |encoded| encoded.len());
    if bytes == 0 || bytes > MAX_SUMMARY_CACHE_ENTRY_BYTES {
        return;
    }
    let mut cache = cache
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
    cache.clock = cache.clock.saturating_add(1);
    let last_access = cache.clock;
    if let Some(previous) = cache.values.remove(&key) {
        cache.bytes = cache.bytes.saturating_sub(previous.bytes);
    }
    while cache.bytes.saturating_add(bytes) > MAX_SUMMARY_CACHE_BYTES {
        let Some(oldest) = cache
            .values
            .iter()
            .min_by_key(|(_, value)| value.last_access)
            .map(|(key, _)| key.clone())
        else {
            break;
        };
        if let Some(removed) = cache.values.remove(&oldest) {
            cache.bytes = cache.bytes.saturating_sub(removed.bytes);
        }
    }
    cache.bytes = cache.bytes.saturating_add(bytes);
    cache.values.insert(
        key,
        CachedSummary {
            value: value.clone(),
            bytes,
            last_access,
        },
    );
}

#[cfg(unix)]
fn file_identity(metadata: &std::fs::Metadata) -> (u64, u64) {
    (metadata.dev(), metadata.ino())
}

fn file_revision(metadata: &std::fs::Metadata) -> FileRevision {
    let (device, inode) = file_identity(metadata);
    FileRevision {
        device,
        inode,
        bytes: metadata.len(),
        modified_nanos: metadata
            .modified()
            .ok()
            .and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
            .map_or(0, |duration| duration.as_nanos()),
    }
}

#[cfg(not(unix))]
fn file_identity(_metadata: &std::fs::Metadata) -> (u64, u64) {
    (0, 0)
}

fn encode_cursor(cursor: &Cursor) -> String {
    let raw = serde_json::to_vec(&cursor).unwrap_or_default();
    format!("{CURSOR_PREFIX}{}", URL_SAFE_NO_PAD.encode(raw))
}

fn encode_source_witness(source: &RolloutWitness) -> Result<String, HistoryServiceError> {
    let raw = serde_json::to_vec(source).map_err(crate::store::StoreError::from)?;
    Ok(format!(
        "{SOURCE_WITNESS_PREFIX}{}",
        URL_SAFE_NO_PAD.encode(raw)
    ))
}

fn decode_source_witness_text(value: &str) -> Result<RolloutWitness, HistoryServiceError> {
    let raw = value
        .strip_prefix(SOURCE_WITNESS_PREFIX)
        .filter(|value| value.len() <= 4_096)
        .ok_or(HistoryServiceError::InvalidAfterRequest)?;
    let decoded = URL_SAFE_NO_PAD
        .decode(raw)
        .map_err(|_| HistoryServiceError::InvalidAfterRequest)?;
    serde_json::from_slice(&decoded).map_err(|_| HistoryServiceError::InvalidAfterRequest)
}

fn decode_source_witness(
    value: Option<&Value>,
) -> Result<Option<RolloutWitness>, HistoryServiceError> {
    value
        .filter(|value| !value.is_null())
        .map(|value| {
            decode_source_witness_text(
                value
                    .as_str()
                    .ok_or(HistoryServiceError::InvalidAfterRequest)?,
            )
        })
        .transpose()
}

fn decode_cursor(
    value: Option<&Value>,
    thread_id: &str,
) -> Result<Option<Cursor>, HistoryServiceError> {
    let Some(value) = value.filter(|value| !value.is_null()) else {
        return Ok(None);
    };
    let raw = value
        .as_str()
        .and_then(|value| value.strip_prefix(CURSOR_PREFIX))
        .filter(|value| value.len() <= 4_096)
        .ok_or(HistoryServiceError::InvalidCursor)?;
    let decoded = URL_SAFE_NO_PAD
        .decode(raw)
        .map_err(|_| HistoryServiceError::InvalidCursor)?;
    let cursor: Cursor =
        serde_json::from_slice(&decoded).map_err(|_| HistoryServiceError::InvalidCursor)?;
    if cursor.kind != "turns"
        || cursor.thread_id != thread_id
        || cursor.direction != "desc"
        || cursor.source_offset.is_none()
        || cursor.source.is_none()
    {
        return Err(HistoryServiceError::InvalidCursor);
    }
    Ok(Some(cursor))
}

#[cfg(test)]
mod tests {
    use std::{
        io::Write,
        path::Path,
        sync::{Arc, Mutex},
    };

    use serde_json::json;

    use super::{HistoryService, HistoryServiceError, SummaryCache, sync_history, turns_page};
    use crate::{catalog::SessionCatalog, rollout::rollout_file_id, store::IndexStore};

    const THREAD_ID: &str = "019fe7af-e2fa-70f3-88e8-99d59e10bd63";

    fn history_service(root: &Path) -> Result<HistoryService, Box<dyn std::error::Error>> {
        Ok(HistoryService::new(
            Arc::new(SessionCatalog::scan(root)),
            Arc::new(IndexStore::open(root.join("history-index.redb"))?),
        ))
    }

    #[tokio::test]
    async fn list_page_reports_archive_total_without_loading_archived_rows()
    -> Result<(), Box<dyn std::error::Error>> {
        let directory = tempfile::tempdir()?;
        let db = rusqlite::Connection::open(directory.path().join("state_5.sqlite"))?;
        db.execute_batch("CREATE TABLE threads (source TEXT NOT NULL, archived INTEGER NOT NULL); INSERT INTO threads VALUES ('cli', 1), ('vscode', 1), ('cli', 0)")?;
        let service = history_service(directory.path())?;
        let page = service
            .enrich_thread_list(json!({"data": [], "nextCursor": null}))
            .await;
        assert_eq!(page["data"], json!([]));
        assert_eq!(page["codewideCatalogSummary"]["archivedCount"], 2);
        Ok(())
    }

    #[tokio::test]
    async fn unavailable_archive_summary_does_not_fail_the_list_page()
    -> Result<(), Box<dyn std::error::Error>> {
        let directory = tempfile::tempdir()?;
        let service = history_service(directory.path())?;
        let page = service
            .enrich_thread_list(json!({"data": [], "nextCursor": "continuation"}))
            .await;
        assert_eq!(page["data"], json!([]));
        assert_eq!(page["nextCursor"], "continuation");
        assert_eq!(page["codewideCatalogSummary"], json!(null));
        Ok(())
    }

    fn write_completed_turns(path: &Path, count: usize) -> Result<(), Box<dyn std::error::Error>> {
        let mut rollout = std::fs::File::create(path)?;
        for index in 0..count {
            for line in [
                format!(
                    "{{\"type\":\"event_msg\",\"payload\":{{\"type\":\"task_started\",\"turn_id\":\"turn-{index}\"}}}}"
                ),
                format!(
                    "{{\"type\":\"event_msg\",\"payload\":{{\"type\":\"agent_message\",\"message\":\"answer-{index}\",\"phase\":\"final_answer\"}}}}"
                ),
                format!(
                    "{{\"type\":\"event_msg\",\"payload\":{{\"type\":\"task_complete\",\"turn_id\":\"turn-{index}\",\"last_agent_message\":\"answer-{index}\"}}}}"
                ),
            ] {
                writeln!(rollout, "{line}")?;
            }
        }
        rollout.sync_all()?;
        Ok(())
    }

    #[test]
    fn sync_without_cursor_returns_a_bounded_reset() -> Result<(), Box<dyn std::error::Error>> {
        let directory = tempfile::tempdir()?;
        let sessions = directory.path().join("sessions/2026/08/17");
        std::fs::create_dir_all(&sessions)?;
        let path = sessions.join(format!("rollout-2026-08-17T00-00-00-{THREAD_ID}.jsonl"));
        write_completed_turns(&path, 45)?;
        let catalog = SessionCatalog::scan(directory.path());
        let store = IndexStore::open(directory.path().join("history-index.redb"))?;
        let summaries = Mutex::new(SummaryCache::default());

        let result = sync_history(&catalog, &store, &summaries, THREAD_ID, None, 36, None)?;

        assert_eq!(result["kind"], "reset");
        assert_eq!(result["turns"].as_array().map(Vec::len), Some(36));
        assert_eq!(result["turns"][0]["id"], "turn-9");
        assert_eq!(result["turns"][35]["id"], "turn-44");
        assert_eq!(result["headTurnId"], "turn-44");
        assert_eq!(result["hasMore"], false);
        assert!(result["olderCursor"].is_string());
        Ok(())
    }

    #[test]
    fn sync_follows_rollout_authority_after_index_was_warmed()
    -> Result<(), Box<dyn std::error::Error>> {
        let directory = tempfile::tempdir()?;
        let sessions = directory.path().join("sessions/2026/08/17");
        std::fs::create_dir_all(&sessions)?;
        let old_path = sessions.join(format!("rollout-2026-08-17T00-00-00-{THREAD_ID}.jsonl"));
        write_completed_turns(&old_path, 2)?;
        let catalog = SessionCatalog::scan(directory.path());
        let store = IndexStore::open(directory.path().join("history-index.redb"))?;
        let summaries = Mutex::new(SummaryCache::default());
        let first = sync_history(&catalog, &store, &summaries, THREAD_ID, None, 36, None)?;
        assert_eq!(first["headTurnId"], "turn-1");

        let new_path = sessions.join(format!(
            "rollout-2026-08-17T00-01-00-{THREAD_ID}_writer.jsonl"
        ));
        write_completed_turns(&new_path, 5)?;
        let db = rusqlite::Connection::open(directory.path().join("state_5.sqlite"))?;
        db.execute_batch("CREATE TABLE threads (id TEXT PRIMARY KEY, rollout_path TEXT NOT NULL)")?;
        db.execute(
            "INSERT INTO threads (id, rollout_path) VALUES (?1, ?2)",
            rusqlite::params![THREAD_ID, new_path.to_string_lossy()],
        )?;

        let updated = sync_history(
            &catalog,
            &store,
            &summaries,
            THREAD_ID,
            Some("turn-1"),
            36,
            None,
        )?;
        assert_eq!(updated["kind"], "delta");
        assert_eq!(updated["headTurnId"], "turn-4");
        let ids: Vec<_> = updated["turns"]
            .as_array()
            .ok_or("missing turns")?
            .iter()
            .map(|turn| turn["id"].as_str())
            .collect();
        assert_eq!(ids, vec![Some("turn-2"), Some("turn-3"), Some("turn-4")]);
        Ok(())
    }

    #[test]
    fn sync_from_stale_cursor_returns_only_newer_sealed_turns()
    -> Result<(), Box<dyn std::error::Error>> {
        let directory = tempfile::tempdir()?;
        let sessions = directory.path().join("sessions/2026/08/17");
        std::fs::create_dir_all(&sessions)?;
        let path = sessions.join(format!("rollout-2026-08-17T00-00-00-{THREAD_ID}.jsonl"));
        write_completed_turns(&path, 8)?;
        let catalog = SessionCatalog::scan(directory.path());
        let store = IndexStore::open(directory.path().join("history-index.redb"))?;
        let summaries = Mutex::new(SummaryCache::default());

        let result = sync_history(
            &catalog,
            &store,
            &summaries,
            THREAD_ID,
            Some("turn-3"),
            2,
            None,
        )?;

        assert_eq!(result["kind"], "delta");
        assert_eq!(result["turns"][0]["id"], "turn-4");
        assert_eq!(result["turns"][1]["id"], "turn-5");
        assert_eq!(result["hasMore"], true);
        assert_eq!(result["headTurnId"], "turn-7");
        Ok(())
    }

    #[test]
    fn sync_at_head_returns_current_and_unknown_cursor_resets()
    -> Result<(), Box<dyn std::error::Error>> {
        let directory = tempfile::tempdir()?;
        let sessions = directory.path().join("sessions/2026/08/17");
        std::fs::create_dir_all(&sessions)?;
        let path = sessions.join(format!("rollout-2026-08-17T00-00-00-{THREAD_ID}.jsonl"));
        write_completed_turns(&path, 3)?;
        let catalog = SessionCatalog::scan(directory.path());
        let store = IndexStore::open(directory.path().join("history-index.redb"))?;
        let summaries = Mutex::new(SummaryCache::default());

        let current = sync_history(
            &catalog,
            &store,
            &summaries,
            THREAD_ID,
            Some("turn-2"),
            36,
            None,
        )?;
        let reset = sync_history(
            &catalog,
            &store,
            &summaries,
            THREAD_ID,
            Some("missing"),
            36,
            None,
        )?;

        assert_eq!(current["kind"], "current");
        assert_eq!(current["turns"], json!([]));
        assert_eq!(reset["kind"], "reset");
        assert_eq!(reset["turns"].as_array().map(Vec::len), Some(3));
        Ok(())
    }

    #[test]
    fn sync_treats_an_aborted_turn_as_immutable_history() -> Result<(), Box<dyn std::error::Error>>
    {
        let directory = tempfile::tempdir()?;
        let sessions = directory.path().join("sessions/2026/08/17");
        std::fs::create_dir_all(&sessions)?;
        let path = sessions.join(format!("rollout-2026-08-17T00-00-00-{THREAD_ID}.jsonl"));
        write_completed_turns(&path, 1)?;
        let mut rollout = std::fs::OpenOptions::new().append(true).open(&path)?;
        writeln!(
            rollout,
            "{{\"type\":\"event_msg\",\"payload\":{{\"type\":\"task_started\",\"turn_id\":\"aborted-turn\"}}}}"
        )?;
        writeln!(
            rollout,
            "{{\"type\":\"event_msg\",\"payload\":{{\"type\":\"turn_aborted\",\"turn_id\":\"aborted-turn\"}}}}"
        )?;
        rollout.sync_all()?;
        let catalog = SessionCatalog::scan(directory.path());
        let store = IndexStore::open(directory.path().join("history-index.redb"))?;
        let summaries = Mutex::new(SummaryCache::default());

        let result = sync_history(
            &catalog,
            &store,
            &summaries,
            THREAD_ID,
            Some("turn-0"),
            36,
            None,
        )?;

        assert_eq!(result["kind"], "delta");
        assert_eq!(result["headTurnId"], "aborted-turn");
        assert_eq!(result["turns"][0]["id"], "aborted-turn");
        assert_eq!(result["turns"][0]["status"], "interrupted");
        Ok(())
    }

    #[test]
    fn sync_excludes_the_app_server_active_turn_from_every_history_path()
    -> Result<(), Box<dyn std::error::Error>> {
        let directory = tempfile::tempdir()?;
        let sessions = directory.path().join("sessions/2026/08/17");
        std::fs::create_dir_all(&sessions)?;
        let path = sessions.join(format!("rollout-2026-08-17T00-00-00-{THREAD_ID}.jsonl"));
        write_completed_turns(&path, 1)?;
        let mut rollout = std::fs::OpenOptions::new().append(true).open(&path)?;
        writeln!(
            rollout,
            "{{\"type\":\"event_msg\",\"payload\":{{\"type\":\"task_started\",\"turn_id\":\"active-turn\"}}}}"
        )?;
        writeln!(
            rollout,
            "{{\"type\":\"event_msg\",\"payload\":{{\"type\":\"user_message\",\"message\":\"active question\"}}}}"
        )?;
        rollout.sync_all()?;
        let catalog = SessionCatalog::scan(directory.path());
        let store = IndexStore::open(directory.path().join("history-index.redb"))?;
        let summaries = Mutex::new(SummaryCache::default());

        let reset = sync_history(
            &catalog,
            &store,
            &summaries,
            THREAD_ID,
            None,
            36,
            Some("active-turn"),
        )?;
        assert_eq!(reset["kind"], "reset");
        assert_eq!(reset["headTurnId"], "turn-0");
        assert_eq!(reset["turns"].as_array().map(Vec::len), Some(1));
        assert_eq!(reset["turns"][0]["id"], "turn-0");

        let current = sync_history(
            &catalog,
            &store,
            &summaries,
            THREAD_ID,
            Some("turn-0"),
            36,
            Some("active-turn"),
        )?;
        assert_eq!(current["kind"], "current");
        assert_eq!(current["headTurnId"], "turn-0");
        assert_eq!(current["turns"], json!([]));
        Ok(())
    }

    #[test]
    fn cold_large_sync_reads_the_requested_history_beyond_the_partial_index()
    -> Result<(), Box<dyn std::error::Error>> {
        let directory = tempfile::tempdir()?;
        let sessions = directory.path().join("sessions/2026/08/17");
        std::fs::create_dir_all(&sessions)?;
        let path = sessions.join(format!("rollout-2026-08-17T00-00-00-{THREAD_ID}.jsonl"));
        let mut rollout = std::fs::File::create(&path)?;
        writeln!(
            rollout,
            "{{\"type\":\"compacted\",\"payload\":{{\"opaque\":\"{}\"}}}}",
            "x".repeat(9 * 1024 * 1024)
        )?;
        for index in 0..20 {
            for line in [
                format!(
                    "{{\"type\":\"event_msg\",\"payload\":{{\"type\":\"task_started\",\"turn_id\":\"turn-{index}\"}}}}"
                ),
                format!(
                    "{{\"type\":\"event_msg\",\"payload\":{{\"type\":\"agent_message\",\"message\":\"answer-{index}\",\"phase\":\"final_answer\"}}}}"
                ),
                format!(
                    "{{\"type\":\"event_msg\",\"payload\":{{\"type\":\"task_complete\",\"turn_id\":\"turn-{index}\",\"last_agent_message\":\"answer-{index}\"}}}}"
                ),
            ] {
                writeln!(rollout, "{line}")?;
            }
        }
        writeln!(
            rollout,
            "{{\"type\":\"event_msg\",\"payload\":{{\"type\":\"task_started\",\"turn_id\":\"active-turn\"}}}}"
        )?;
        writeln!(
            rollout,
            "{{\"type\":\"event_msg\",\"payload\":{{\"type\":\"user_message\",\"message\":\"active question\"}}}}"
        )?;
        rollout.sync_all()?;

        let catalog = SessionCatalog::scan(directory.path());
        let store = IndexStore::open(directory.path().join("history-index.redb"))?;
        let summaries = Mutex::new(SummaryCache::default());
        let result = sync_history(
            &catalog,
            &store,
            &summaries,
            THREAD_ID,
            None,
            36,
            Some("active-turn"),
        )?;

        assert_eq!(result["kind"], "reset");
        assert_eq!(result["headTurnId"], "turn-19");
        assert_eq!(result["turns"].as_array().map(Vec::len), Some(20));
        assert_eq!(result["turns"][0]["id"], "turn-0");
        assert_eq!(result["turns"][19]["id"], "turn-19");

        let file_id = rollout_file_id(&path);
        assert!(store.turn_by_id(&file_id, "turn-18")?.is_none());
        let delta = sync_history(
            &catalog,
            &store,
            &summaries,
            THREAD_ID,
            Some("turn-18"),
            36,
            Some("active-turn"),
        )?;
        assert_eq!(delta["kind"], "delta");
        assert_eq!(delta["headTurnId"], "turn-19");
        assert_eq!(delta["turns"].as_array().map(Vec::len), Some(1));
        assert_eq!(delta["turns"][0]["id"], "turn-19");

        let current = sync_history(
            &catalog,
            &store,
            &summaries,
            THREAD_ID,
            Some("turn-19"),
            36,
            Some("active-turn"),
        )?;
        assert_eq!(current["kind"], "current");
        assert_eq!(current["headTurnId"], "turn-19");
        assert_eq!(current["turns"], json!([]));
        Ok(())
    }

    #[tokio::test]
    async fn turns_after_pages_forward_without_exposing_the_mutable_head()
    -> Result<(), Box<dyn std::error::Error>> {
        let directory = tempfile::tempdir()?;
        let sessions = directory.path().join("sessions/2026/08/17");
        std::fs::create_dir_all(&sessions)?;
        let path = sessions.join(format!("rollout-2026-08-17T00-00-00-{THREAD_ID}.jsonl"));
        write_completed_turns(&path, 6)?;
        let mut rollout = std::fs::OpenOptions::new().append(true).open(&path)?;
        writeln!(
            rollout,
            "{{\"type\":\"event_msg\",\"payload\":{{\"type\":\"task_started\",\"turn_id\":\"active-turn\"}}}}"
        )?;
        writeln!(
            rollout,
            "{{\"type\":\"event_msg\",\"payload\":{{\"type\":\"user_message\",\"message\":\"active question\"}}}}"
        )?;
        rollout.sync_all()?;
        let service = history_service(directory.path())?;

        let first = service
            .turns_after(&json!({
                "threadId": THREAD_ID,
                "afterTurnId": "turn-1",
                "limit": 3
            }))
            .await?;
        assert_eq!(
            first["data"]
                .as_array()
                .into_iter()
                .flatten()
                .filter_map(|turn| turn.get("id").and_then(serde_json::Value::as_str))
                .collect::<Vec<_>>(),
            ["turn-2", "turn-3", "turn-4"]
        );
        assert_eq!(first["hasMore"], true);

        let second = service
            .turns_after(&json!({
                "threadId": THREAD_ID,
                "afterTurnId": "turn-4",
                "limit": 3
            }))
            .await?;
        assert_eq!(
            second["data"]
                .as_array()
                .into_iter()
                .flatten()
                .filter_map(|turn| turn.get("id").and_then(serde_json::Value::as_str))
                .collect::<Vec<_>>(),
            ["turn-5"]
        );
        assert_eq!(second["hasMore"], false);

        assert!(matches!(
            service
                .turns_after(&json!({
                    "threadId": THREAD_ID,
                    "afterTurnId": "missing",
                    "limit": 3
                }))
                .await,
            Err(HistoryServiceError::InvalidCursor)
        ));
        Ok(())
    }

    fn page_ids(page: &serde_json::Value) -> Vec<&str> {
        page["data"]
            .as_array()
            .into_iter()
            .flatten()
            .filter_map(|turn| turn["id"].as_str())
            .collect()
    }

    fn fixture_path(root: &Path) -> std::io::Result<std::path::PathBuf> {
        let sessions = root.join("sessions");
        std::fs::create_dir_all(&sessions)?;
        Ok(sessions.join(format!("rollout-2026-09-09T00-00-00-{THREAD_ID}.jsonl")))
    }

    fn append_events(path: &Path, events: &[serde_json::Value]) -> std::io::Result<()> {
        let mut file = std::fs::OpenOptions::new().append(true).open(path)?;
        for payload in events {
            writeln!(file, "{}", json!({"type":"event_msg", "payload":payload}))?;
        }
        file.sync_all()
    }

    #[tokio::test]
    async fn implicit_interruption_does_not_hide_later_history()
    -> Result<(), Box<dyn std::error::Error>> {
        let directory = tempfile::tempdir()?;
        let path = fixture_path(directory.path())?;
        write_completed_turns(&path, 1)?;
        append_events(
            &path,
            &[
                json!({"type":"task_started", "turn_id":"interrupted"}),
                json!({"type":"user_message", "message":"unfinished"}),
                json!({"type":"task_started", "turn_id":"later"}),
                json!({"type":"task_complete", "turn_id":"later"}),
            ],
        )?;
        let service = history_service(directory.path())?;
        let page = service
            .turns_after(&json!({
                "threadId": THREAD_ID, "afterTurnId":"turn-0", "limit":2
            }))
            .await?;
        assert_eq!(page_ids(&page), ["interrupted", "later"]);
        assert_eq!(page["data"][0]["status"], "interrupted");
        assert_eq!(page["data"][1]["status"], "completed");
        assert_eq!(page["hasMore"], false);
        drop(service);
        let reopened = history_service(directory.path())?;
        assert_eq!(
            reopened
                .turns_after(&json!({
                    "threadId": THREAD_ID, "afterTurnId":"turn-0", "limit":2
                }))
                .await?,
            page
        );
        Ok(())
    }

    #[tokio::test]
    async fn rollback_removes_turns_and_expires_their_semantic_anchors()
    -> Result<(), Box<dyn std::error::Error>> {
        let directory = tempfile::tempdir()?;
        let path = fixture_path(directory.path())?;
        write_completed_turns(&path, 2)?;
        let service = history_service(directory.path())?;
        service
            .sync_thread_history(THREAD_ID, None, 10, None)
            .await?;
        append_events(
            &path,
            &[
                json!({"type":"thread_rolled_back", "num_turns":1}),
                json!({"type":"task_started", "turn_id":"replacement"}),
                json!({"type":"task_complete", "turn_id":"replacement"}),
            ],
        )?;
        let page = service
            .turns_after(&json!({
                "threadId": THREAD_ID, "afterTurnId":"turn-0", "limit":10
            }))
            .await?;
        assert_eq!(page_ids(&page), ["replacement"]);
        assert_eq!(page["hasMore"], false);
        assert!(matches!(
            service
                .turns_after(&json!({
                    "threadId": THREAD_ID, "afterTurnId":"turn-1", "limit":10
                }))
                .await,
            Err(HistoryServiceError::InvalidCursor)
        ));
        Ok(())
    }

    #[tokio::test]
    async fn semantic_before_returns_nearest_older_sealed_turns()
    -> Result<(), Box<dyn std::error::Error>> {
        let directory = tempfile::tempdir()?;
        let path = fixture_path(directory.path())?;
        write_completed_turns(&path, 7)?;
        let service = history_service(directory.path())?;
        let first = service
            .turns_before(&json!({
                "threadId": THREAD_ID, "beforeTurnId":"turn-5", "limit":3
            }))
            .await?;
        assert_eq!(page_ids(&first), ["turn-2", "turn-3", "turn-4"]);
        assert_eq!(first["hasMore"], true);
        let last = service
            .turns_before(&json!({
                "threadId": THREAD_ID, "beforeTurnId":"turn-2", "limit":3
            }))
            .await?;
        assert_eq!(page_ids(&last), ["turn-0", "turn-1"]);
        assert_eq!(last["hasMore"], false);
        Ok(())
    }

    #[tokio::test]
    async fn same_span_rewrite_invalidates_summary_and_byte_cursor()
    -> Result<(), Box<dyn std::error::Error>> {
        let directory = tempfile::tempdir()?;
        let path = fixture_path(directory.path())?;
        write_completed_turns(&path, 3)?;
        let service = history_service(directory.path())?;
        let params = json!({"threadId": THREAD_ID, "limit":1});
        let first = service
            .try_turns_page("thread/turns/list", &params)
            .await
            .ok_or("missing history handler")??;
        let original = std::fs::read_to_string(&path)?;
        // Same inode, IDs, and byte spans: only the canonical message changes.
        std::fs::write(&path, original.replace("answer-", "edited-"))?;
        let updated = service
            .try_turns_page("thread/turns/list", &params)
            .await
            .ok_or("missing history handler")??;
        assert_eq!(updated["data"][0]["items"][0]["text"], "edited-2");
        assert!(matches!(
            service
                .try_turns_page(
                    "thread/turns/list",
                    &json!({
                        "threadId":THREAD_ID, "limit":1, "cursor":first["nextCursor"]
                    })
                )
                .await
                .ok_or("missing history handler")?,
            Err(HistoryServiceError::InvalidCursor)
        ));
        Ok(())
    }

    #[tokio::test]
    async fn cold_semantic_pages_recover_old_anchors_and_count_only_sealed_sentinels()
    -> Result<(), Box<dyn std::error::Error>> {
        let directory = tempfile::tempdir()?;
        let path = fixture_path(directory.path())?;
        write_completed_turns(&path, 150)?;
        let turns = std::fs::read(&path)?;
        let mut file = std::fs::File::create(&path)?;
        writeln!(
            file,
            "{}",
            json!({"type":"compacted", "payload":{"opaque":"x".repeat(9 * 1024 * 1024)}})
        )?;
        file.write_all(&turns)?;
        file.sync_all()?;
        append_events(&path, &[json!({"type":"task_started", "turn_id":"active"})])?;
        let service = history_service(directory.path())?;
        let forward = service
            .turns_after(&json!({
                "threadId":THREAD_ID, "afterTurnId":"turn-20", "limit":3
            }))
            .await?;
        assert_eq!(page_ids(&forward), ["turn-21", "turn-22", "turn-23"]);
        assert_eq!(forward["hasMore"], true);
        let backward = service
            .turns_before(&json!({
                "threadId":THREAD_ID, "beforeTurnId":"turn-8", "limit":3
            }))
            .await?;
        assert_eq!(page_ids(&backward), ["turn-5", "turn-6", "turn-7"]);
        assert_eq!(backward["hasMore"], true);
        let end = service
            .turns_after(&json!({
                "threadId":THREAD_ID, "afterTurnId":"turn-146", "limit":3
            }))
            .await?;
        assert_eq!(page_ids(&end), ["turn-147", "turn-148", "turn-149"]);
        assert_eq!(end["hasMore"], false);
        Ok(())
    }

    #[tokio::test]
    async fn source_witness_accepts_append_but_rollback_requires_reset()
    -> Result<(), Box<dyn std::error::Error>> {
        let directory = tempfile::tempdir()?;
        let path = fixture_path(directory.path())?;
        write_completed_turns(&path, 2)?;
        let service = history_service(directory.path())?;
        let first = service
            .sync_thread_history(THREAD_ID, None, 3, None)
            .await?;
        let witness = first["sourceWitness"]
            .as_str()
            .ok_or("missing source witness")?;
        append_events(
            &path,
            &[
                json!({"type":"task_started", "turn_id":"appended"}),
                json!({"type":"task_complete", "turn_id":"appended"}),
            ],
        )?;
        let page = service
            .turns_after(&json!({
                "threadId":THREAD_ID, "afterTurnId":"turn-1", "limit":3, "sourceWitness":witness
            }))
            .await?;
        assert_eq!(page_ids(&page), ["appended"]);
        append_events(
            &path,
            &[json!({"type":"thread_rolled_back", "num_turns":1})],
        )?;
        assert!(matches!(
            service
                .turns_after(&json!({
                    "threadId":THREAD_ID, "afterTurnId":"turn-1", "limit":3, "sourceWitness":witness
                }))
                .await,
            Err(HistoryServiceError::HistorySourceChanged)
        ));
        let reset = service
            .sync_thread_history_with_source(THREAD_ID, Some("turn-1"), 3, None, Some(witness))
            .await?;
        assert_eq!(reset["kind"], "reset");
        assert_eq!(reset["headTurnId"], "turn-1");
        assert_eq!(reset["turns"].as_array().map(Vec::len), Some(2));
        Ok(())
    }

    #[test]
    fn append_between_index_advance_and_source_open_never_uses_stale_forward_rows()
    -> Result<(), Box<dyn std::error::Error>> {
        let directory = tempfile::tempdir()?;
        let path = fixture_path(directory.path())?;
        write_completed_turns(&path, 1)?;
        let store = IndexStore::open(directory.path().join("history-index.redb"))?;
        crate::rollout::index_rollout(&store, &path)?;
        append_events(
            &path,
            &[
                json!({"type":"task_started", "turn_id":"appended"}),
                json!({"type":"task_complete", "turn_id":"appended", "last_agent_message":"new answer"}),
            ],
        )?;
        let summaries = Mutex::new(SummaryCache::default());
        let lane = store.rollout_index_lock(rollout_file_id(&path));
        let _guard = lane.lock().map_err(|_| "index lane poisoned")?;
        let reader = super::HistoryReader::open(&store, &summaries, THREAD_ID, &path)?;
        let (turns, indexed) = reader
            .anchored("turn-0", super::HistoryDirection::After, 2)?
            .ok_or("surviving anchor was lost")?;
        let projected = reader.project(&turns, indexed)?;
        assert_eq!(projected.len(), 1);
        assert_eq!(projected[0]["id"], "appended");
        assert_eq!(projected[0]["items"][0]["text"], "new answer");
        reader.finish()?;
        Ok(())
    }

    #[test]
    fn cold_large_page_returns_the_indexed_tail_with_an_older_cursor()
    -> Result<(), Box<dyn std::error::Error>> {
        let directory = tempfile::tempdir()?;
        let sessions = directory.path().join("sessions/2026/08/17");
        std::fs::create_dir_all(&sessions)?;
        let path = sessions.join(format!("rollout-2026-08-17T00-00-00-{THREAD_ID}.jsonl"));
        let mut rollout = std::fs::File::create(&path)?;
        writeln!(
            rollout,
            "{{\"type\":\"compacted\",\"payload\":{{\"opaque\":\"{}\"}}}}",
            "x".repeat(9 * 1024 * 1024)
        )?;
        for index in 0..20 {
            for line in [
                format!(
                    "{{\"type\":\"event_msg\",\"payload\":{{\"type\":\"task_started\",\"turn_id\":\"turn-{index}\"}}}}"
                ),
                format!(
                    "{{\"type\":\"event_msg\",\"payload\":{{\"type\":\"agent_message\",\"message\":\"answer-{index}\",\"phase\":\"final_answer\"}}}}"
                ),
                format!(
                    "{{\"type\":\"event_msg\",\"payload\":{{\"type\":\"task_complete\",\"turn_id\":\"turn-{index}\",\"last_agent_message\":\"answer-{index}\"}}}}"
                ),
            ] {
                writeln!(rollout, "{line}")?;
            }
        }
        rollout.sync_all()?;

        let catalog = SessionCatalog::scan(directory.path());
        let store = IndexStore::open(directory.path().join("history-index.redb"))?;
        let summaries = Mutex::new(SummaryCache::default());
        let first = turns_page(
            &catalog,
            &store,
            &summaries,
            &json!({
                "threadId": THREAD_ID,
                "cursor": null,
                "limit": 36,
                "sortDirection": "desc",
                "itemsView": "summary"
            }),
            false,
        )?;

        assert_eq!(first["data"].as_array().map(Vec::len), Some(1));
        assert_eq!(first["data"][0]["id"], "turn-19");
        let cursor = first["nextCursor"]
            .as_str()
            .ok_or("partial tail did not expose an older cursor")?;
        let older = turns_page(
            &catalog,
            &store,
            &summaries,
            &json!({
                "threadId": THREAD_ID,
                "cursor": cursor,
                "limit": 12,
                "sortDirection": "desc",
                "itemsView": "summary"
            }),
            false,
        )?;
        assert_eq!(older["data"].as_array().map(Vec::len), Some(12));
        assert_eq!(older["data"][0]["id"], "turn-18");
        Ok(())
    }

    #[tokio::test]
    async fn thread_list_replaces_first_prompt_with_latest_canonical_message()
    -> Result<(), Box<dyn std::error::Error>> {
        let directory = tempfile::tempdir()?;
        let sessions = directory.path().join("sessions/2026/08/17");
        std::fs::create_dir_all(&sessions)?;
        let path = sessions.join(format!("rollout-2026-08-17T00-00-00-{THREAD_ID}.jsonl"));
        let mut rollout = std::fs::File::create(path)?;
        for line in [
            r#"{"type":"event_msg","payload":{"type":"task_started","turn_id":"turn-1"}}"#,
            r#"{"type":"event_msg","payload":{"type":"user_message","message":"First prompt"}}"#,
            r#"{"type":"event_msg","payload":{"type":"agent_message","message":"First answer"}}"#,
            r#"{"type":"event_msg","payload":{"type":"task_complete","turn_id":"turn-1","last_agent_message":"First answer"}}"#,
            r#"{"type":"event_msg","payload":{"type":"task_started","turn_id":"turn-2"}}"#,
            r#"{"type":"event_msg","payload":{"type":"user_message","message":"Newest question"}}"#,
            r#"{"type":"event_msg","payload":{"type":"agent_message","message":"Newest canonical answer"}}"#,
            r#"{"type":"event_msg","payload":{"type":"task_complete","turn_id":"turn-2","last_agent_message":"Newest canonical answer"}}"#,
        ] {
            writeln!(rollout, "{line}")?;
        }
        rollout.sync_all()?;

        let service = history_service(directory.path())?;
        let result = service
            .enrich_thread_list(json!({
                "data": [{"id": THREAD_ID, "preview": "First prompt"}],
                "nextCursor": null
            }))
            .await;

        assert_eq!(result["data"][0]["preview"], "Newest canonical answer");
        assert!(result["data"][0].get("codewide").is_none());

        for line in [
            r#"{"type":"event_msg","payload":{"type":"task_started","turn_id":"turn-3"}}"#,
            r#"{"type":"event_msg","payload":{"type":"user_message","message":"Third question"}}"#,
            r#"{"type":"event_msg","payload":{"type":"agent_message","message":"Third answer"}}"#,
        ] {
            writeln!(rollout, "{line}")?;
        }
        rollout.sync_all()?;
        let refreshed = service
            .enrich_thread_list(json!({"data": [{"id": THREAD_ID, "preview": "First prompt"}]}))
            .await;
        assert_eq!(refreshed["data"][0]["preview"], "Third answer");
        Ok(())
    }

    #[tokio::test]
    async fn thread_list_falls_back_without_a_canonical_rollout()
    -> Result<(), Box<dyn std::error::Error>> {
        let directory = tempfile::tempdir()?;
        let service = history_service(directory.path())?;
        let source = json!({"data": [{"id": THREAD_ID, "preview": "First prompt"}]});

        assert_eq!(service.enrich_thread_list(source.clone()).await, source);
        Ok(())
    }

    #[tokio::test]
    async fn single_thread_uses_the_same_canonical_preview_projection()
    -> Result<(), Box<dyn std::error::Error>> {
        let directory = tempfile::tempdir()?;
        let sessions = directory.path().join("sessions/2026/08/17");
        std::fs::create_dir_all(&sessions)?;
        let path = sessions.join(format!("rollout-2026-08-17T00-00-00-{THREAD_ID}.jsonl"));
        let mut rollout = std::fs::File::create(path)?;
        for line in [
            r#"{"type":"event_msg","payload":{"type":"task_started","turn_id":"turn-1"}}"#,
            r#"{"type":"event_msg","payload":{"type":"agent_message","message":"Canonical answer"}}"#,
            r#"{"type":"event_msg","payload":{"type":"task_complete","turn_id":"turn-1","last_agent_message":"Canonical answer"}}"#,
        ] {
            writeln!(rollout, "{line}")?;
        }
        rollout.sync_all()?;
        let service = history_service(directory.path())?;

        let result = service
            .enrich_thread(json!({"id": THREAD_ID, "preview": "First prompt"}))
            .await;

        assert_eq!(result["preview"], "Canonical answer");
        Ok(())
    }

    #[tokio::test]
    async fn external_rollout_change_projects_a_bounded_thread_invalidation()
    -> Result<(), Box<dyn std::error::Error>> {
        let directory = tempfile::tempdir()?;
        let sessions = directory.path().join("sessions/2026/08/17");
        std::fs::create_dir_all(&sessions)?;
        let path = sessions.join(format!("rollout-2026-08-17T00-00-00-{THREAD_ID}.jsonl"));
        let mut rollout = std::fs::File::create(&path)?;
        for line in [
            r#"{"type":"event_msg","payload":{"type":"task_started","turn_id":"turn-1"}}"#,
            r#"{"type":"event_msg","payload":{"type":"user_message","message":"External question"}}"#,
            r#"{"type":"event_msg","payload":{"type":"agent_message","message":"External answer"}}"#,
        ] {
            writeln!(rollout, "{line}")?;
        }
        rollout.sync_all()?;

        let service = history_service(directory.path())?;
        assert!(service.thread_active(THREAD_ID).await?);
        let event = service
            .rollout_invalidation_event(crate::rollout_monitor::RolloutChange {
                thread_id: THREAD_ID.to_owned(),
                path: path.clone(),
                archived: false,
            })
            .await;

        assert_eq!(event["method"], "companion/thread/progress");
        assert_eq!(event["params"]["threadId"], THREAD_ID);
        assert_eq!(event["params"]["turnActive"], true);
        assert_eq!(
            event["codewideThreadPatch"]["operation"]["kind"],
            "threadProgress"
        );
        assert_eq!(
            event["codewideThreadPatch"]["operation"]["summary"]["previewText"],
            "External answer"
        );
        assert_eq!(
            event["codewideThreadPatch"]["operation"]["summary"]["conversationMessage"],
            true
        );

        writeln!(
            rollout,
            "{{\"type\":\"event_msg\",\"payload\":{{\"type\":\"task_complete\",\"turn_id\":\"turn-1\",\"last_agent_message\":\"External answer\"}}}}",
        )?;
        rollout.sync_all()?;
        let completed = service
            .rollout_invalidation_event(crate::rollout_monitor::RolloutChange {
                thread_id: THREAD_ID.to_owned(),
                path,
                archived: false,
            })
            .await;
        assert!(!service.thread_active(THREAD_ID).await?);
        assert_eq!(completed["method"], "companion/thread/invalidated");
        assert_eq!(completed["params"]["turnActive"], false);
        assert_eq!(
            completed["codewideThreadPatch"]["operation"]["kind"],
            "threadInvalidated"
        );
        Ok(())
    }

    #[tokio::test]
    async fn initial_page_rejects_a_rollout_older_than_app_server_recency()
    -> Result<(), Box<dyn std::error::Error>> {
        let directory = tempfile::tempdir()?;
        let sessions = directory.path().join("sessions/2026/08/17");
        std::fs::create_dir_all(&sessions)?;
        let path = sessions.join(format!("rollout-2026-08-17T00-00-00-{THREAD_ID}.jsonl"));
        let mut rollout = std::fs::File::create(path)?;
        for line in [
            r#"{"type":"event_msg","payload":{"type":"task_started","turn_id":"turn-1","started_at":10}}"#,
            r#"{"type":"event_msg","payload":{"type":"user_message","message":"old question"}}"#,
            r#"{"type":"event_msg","payload":{"type":"task_complete","turn_id":"turn-1","last_agent_message":"old answer","completed_at":11}}"#,
        ] {
            writeln!(rollout, "{line}")?;
        }
        rollout.sync_all()?;

        let service = history_service(directory.path())?;
        let fresh = service
            .try_turns_page(
                "thread/turns/list",
                &json!({
                    "threadId": THREAD_ID,
                    "cursor": null,
                    "limit": 6,
                    "sortDirection": "desc",
                    "itemsView": "summary",
                    "expectedRecencyAt": 10
                }),
            )
            .await
            .ok_or("history page was not handled")??;
        assert_eq!(fresh["data"].as_array().map(Vec::len), Some(1));

        let stale = service
            .try_turns_page(
                "thread/turns/list",
                &json!({
                    "threadId": THREAD_ID,
                    "cursor": null,
                    "limit": 6,
                    "sortDirection": "desc",
                    "itemsView": "summary",
                    "expectedRecencyAt": 20
                }),
            )
            .await
            .ok_or("history page was not handled")?;
        assert!(matches!(
            stale,
            Err(HistoryServiceError::StaleRollout {
                expected: 20,
                observed: Some(10),
                ..
            })
        ));
        Ok(())
    }

    #[tokio::test]
    async fn initial_page_rejects_a_mutable_head_after_thread_became_idle()
    -> Result<(), Box<dyn std::error::Error>> {
        let directory = tempfile::tempdir()?;
        let sessions = directory.path().join("sessions/2026/08/17");
        std::fs::create_dir_all(&sessions)?;
        let path = sessions.join(format!("rollout-2026-08-17T00-00-00-{THREAD_ID}.jsonl"));
        let mut rollout = std::fs::File::create(path)?;
        for line in [
            r#"{"type":"event_msg","payload":{"type":"task_started","turn_id":"turn-1","started_at":10}}"#,
            r#"{"type":"event_msg","payload":{"type":"user_message","message":"question","client_id":"android-1"}}"#,
        ] {
            writeln!(rollout, "{line}")?;
        }
        rollout.sync_all()?;

        let service = history_service(directory.path())?;
        let stale = service
            .try_turns_page(
                "thread/turns/list",
                &json!({
                    "threadId": THREAD_ID,
                    "cursor": null,
                    "limit": 6,
                    "sortDirection": "desc",
                    "itemsView": "summary",
                    "expectedThreadActive": false
                }),
            )
            .await
            .ok_or("history page was not handled")?;
        assert!(matches!(
            stale,
            Err(HistoryServiceError::StaleLifecycle {
                expected_active: false,
                observed_active: Some(true),
                ..
            })
        ));

        writeln!(
            rollout,
            r#"{{"type":"event_msg","payload":{{"type":"task_complete","turn_id":"turn-1","last_agent_message":"answer","completed_at":11}}}}"#,
        )?;
        rollout.sync_all()?;
        let complete = service
            .try_turns_page(
                "thread/turns/list",
                &json!({
                    "threadId": THREAD_ID,
                    "cursor": null,
                    "limit": 6,
                    "sortDirection": "desc",
                    "itemsView": "summary",
                    "expectedThreadActive": false
                }),
            )
            .await
            .ok_or("history page was not handled")??;
        assert_eq!(complete["data"][0]["status"], "completed");
        assert_eq!(complete["data"][0]["items"][1]["text"], "answer");
        assert_eq!(complete["data"][0]["items"][0]["clientId"], "android-1");
        Ok(())
    }
}
