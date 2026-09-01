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
    history::{
        HistoryError, SummaryProjectionState, project_summary_turn_from_file,
        summary_projection_state_from_file,
    },
    rollout::{
        IndexError, backfill_rollout_prefix, current_indexed_turns_from_file, index_rollout,
        rollout_file_id, scan_tail_turns_from_file,
    },
    rollout_monitor::{self, RolloutChange},
    store::{IndexStore, TurnRef},
};

const CURSOR_PREFIX: &str = "codewide-history-v1:";
const DEFAULT_PAGE_SIZE: usize = 20;
const MAX_PAGE_SIZE: usize = 100;
const MAX_SUMMARY_CACHE_BYTES: usize = 64 * 1024 * 1024;
const MAX_SUMMARY_CACHE_ENTRY_BYTES: usize = 1024 * 1024;
const MAX_THREAD_PREVIEW_CHARS: usize = 512;
const MAX_THREAD_PREVIEW_CACHE_ENTRIES: usize = 4_096;

#[derive(Clone)]
pub struct HistoryService {
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
    device: u64,
    inode: u64,
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
    #[error("threadId is required")]
    MissingThreadId,
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
}

impl HistoryService {
    #[must_use]
    pub fn new(catalog: Arc<SessionCatalog>, store: Arc<IndexStore>) -> Self {
        Self {
            catalog,
            store,
            summaries: Arc::new(Mutex::new(SummaryCache::default())),
            previews: Arc::new(Mutex::new(PreviewCache::default())),
            invalidation_previews: Arc::new(Mutex::new(HashMap::new())),
            index_jobs: Arc::new(Mutex::new(IndexJobs::default())),
        }
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
                        "kind": "threadInvalidated",
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

fn enrich_thread_list_result(
    catalog: &SessionCatalog,
    store: &IndexStore,
    summaries: &Mutex<SummaryCache>,
    previews: &Mutex<PreviewCache>,
    mut result: Value,
) -> Value {
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
    let path_metadata = std::fs::metadata(&path).map_err(IndexError::from)?;
    let path_revision = file_revision(&path_metadata);
    if let PreviewCacheLookup::Hit(preview) = cached_preview(previews, thread_id, path_revision) {
        return Ok(preview);
    }
    let rollout = File::open(&path).map_err(IndexError::from)?;
    let metadata = rollout.metadata().map_err(IndexError::from)?;
    let revision = file_revision(&metadata);
    if revision != path_revision
        && let PreviewCacheLookup::Hit(preview) = cached_preview(previews, thread_id, revision)
    {
        return Ok(preview);
    }
    let file_bytes = metadata.len();
    let (device, inode) = file_identity(&metadata);
    let (turn, indexed_exact) = if let Some(indexed) =
        current_indexed_turns_from_file(store, &path, &rollout, file_bytes, None, 1)?
    {
        (indexed.turns.into_iter().next(), true)
    } else {
        (
            scan_tail_turns_from_file(&rollout, file_bytes, None, 1)?
                .turns
                .into_iter()
                .next()
                .map(|turn| TurnRef {
                    id: turn.id,
                    start_offset: turn.start_offset,
                    end_offset: turn.end_offset,
                    completed: turn.completed,
                }),
            false,
        )
    };
    let Some(turn) = turn else {
        let state = LatestThreadState::default();
        remember_preview(previews, thread_id, revision, state.clone());
        return Ok(state);
    };
    let key = SummaryKey {
        thread_id: thread_id.to_owned(),
        device,
        inode,
        start_offset: turn.start_offset,
        end_offset: turn.end_offset,
    };
    let projected = if let Some(projected) = cached_summary(summaries, &key) {
        projected
    } else {
        let projected = projected_turn(store, &path, &rollout, &turn, indexed_exact)?;
        remember_summary(summaries, key, &projected);
        projected
    };
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
    let rollout = File::open(&path).map_err(IndexError::from)?;
    let metadata = rollout.metadata().map_err(IndexError::from)?;
    let file_bytes = metadata.len();
    let (device, inode) = file_identity(&metadata);
    let (discovered, indexed_exact, indexed_has_more) = if let Some(indexed) =
        current_indexed_turns_from_file(
            store,
            &path,
            &rollout,
            file_bytes,
            source_offset,
            scan_limit,
        )? {
        (indexed.turns, true, indexed.has_more)
    } else {
        (
            scan_tail_turns_from_file(&rollout, file_bytes, source_offset, scan_limit)?
                .turns
                .into_iter()
                .map(|turn| TurnRef {
                    id: turn.id,
                    start_offset: turn.start_offset,
                    end_offset: turn.end_offset,
                    completed: turn.completed,
                })
                .collect(),
            false,
            false,
        )
    };
    let page_refs: Vec<_> = if source_offset.is_some() {
        discovered
    } else {
        discovered.into_iter().skip(logical_offset).collect()
    };
    let has_more = indexed_has_more || page_refs.len() > limit;
    let selected = page_refs.into_iter().take(limit).collect::<Vec<_>>();
    let mut data = Vec::with_capacity(selected.len());
    for turn in &selected {
        let key = SummaryKey {
            thread_id: thread_id.to_owned(),
            device,
            inode,
            start_offset: turn.start_offset,
            end_offset: turn.end_offset,
        };
        let mut projected = if let Some(projected) = cached_summary(summaries, &key) {
            projected
        } else {
            let projected = projected_turn(store, &path, &rollout, turn, indexed_exact)?;
            remember_summary(summaries, key, &projected);
            projected
        };
        if not_loaded && let Some(object) = projected.as_object_mut() {
            object.insert("items".into(), json!([]));
            object.insert("itemsView".into(), Value::String("notLoaded".into()));
            object.remove("codewide");
        }
        data.push(projected);
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
            })
        })
    } else {
        None
    };
    Ok(json!({
        "data": data,
        "nextCursor": next_cursor,
        "backwardsCursor": Value::Null
    }))
}

fn projected_turn(
    store: &IndexStore,
    path: &std::path::Path,
    rollout: &File,
    turn: &TurnRef,
    indexed_exact: bool,
) -> Result<Value, HistoryServiceError> {
    if !indexed_exact {
        return project_summary_turn_from_file(rollout, turn).map_err(HistoryServiceError::from);
    }
    let file_id = rollout_file_id(path);
    if let Some(summary) = store
        .turn_summary_state::<SummaryProjectionState>(&file_id, turn.start_offset)?
        .filter(SummaryProjectionState::is_current)
    {
        return Ok(summary.project());
    }
    // Schema v6 offset indexes predate materialized summaries. Enrich only the
    // requested turn once; never rebuild or rescan the complete session.
    let summary = summary_projection_state_from_file(rollout, turn)?;
    store.put_turn_summary_state(&file_id, turn.start_offset, &summary)?;
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
        .ok_or(HistoryServiceError::InvalidCursor)?;
    let decoded = URL_SAFE_NO_PAD
        .decode(raw)
        .map_err(|_| HistoryServiceError::InvalidCursor)?;
    let cursor: Cursor =
        serde_json::from_slice(&decoded).map_err(|_| HistoryServiceError::InvalidCursor)?;
    if cursor.kind != "turns" || cursor.thread_id != thread_id || cursor.direction != "desc" {
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

    use super::{HistoryService, HistoryServiceError, SummaryCache, turns_page};
    use crate::{catalog::SessionCatalog, store::IndexStore};

    const THREAD_ID: &str = "019fe7af-e2fa-70f3-88e8-99d59e10bd63";

    fn history_service(root: &Path) -> Result<HistoryService, Box<dyn std::error::Error>> {
        Ok(HistoryService::new(
            Arc::new(SessionCatalog::scan(root)),
            Arc::new(IndexStore::open(root.join("history-index.redb"))?),
        ))
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
