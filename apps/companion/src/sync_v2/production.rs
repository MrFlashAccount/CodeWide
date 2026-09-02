//! Production semantic adapters for the dedicated Sync V2 App Server session.

use std::{
    collections::{HashMap, HashSet},
    fs::File,
    io::{Read, Seek, SeekFrom},
    os::unix::fs::MetadataExt,
    sync::{Arc, Mutex},
};

use async_trait::async_trait;
use serde_json::{Value, json};
use tokio::sync::{RwLock, watch};

use crate::{
    account_pool::AccountPoolService,
    auth::AuthorizationContext,
    catalog::SessionCatalog,
    history_service::HistoryService,
    projects::ProjectService,
    resources::ResourceService,
    store::{IndexStore, OutboxPresentation},
    upstream::{ConnectionStatus, UpstreamHandle},
    workspaces::WorkspaceService,
};

use super::{
    auth_context::AuthenticatedContextKey,
    bounded::BoundedMap,
    cursor::{HistoryAnchor, HistoryCursor, SourceWitness, stale_cursor, v1_source_offset},
    domain::{
        ApprovalAction, CatalogPartitionScope, CatalogScope, ElicitationField,
        ElicitationFieldType, PendingCloseReason, PendingRequest, ProjectionChange, RemovalReason,
        ThreadWindow, UserInputQuestion,
    },
    normalize,
    protocol::{
        AccountChange, Action, ActionResult, CatalogPartition, CatalogSnapshot, Command,
        CommandResult, CurrentThreadIntent, ErrorCode, HistoryDetail, HistoryDirection,
        InterruptState, OpenIntent, Query, QueryResult, QueueMutation, Recovery, ResolutionState,
        ResourceScope, ThreadUpdate, V2Error,
    },
    scalar::{Id, OperationId, Timestamp, U64},
    source::{
        AudienceSelector, CommandExecution, SemanticSource, SnapshotData, SourceInvalidationReason,
        SubscriptionCoordinator, WatchedThreadData, capabilities, ensure_generation,
    },
};

const MAX_SOURCE_RESPONSE_BYTES: usize = super::V2_UPSTREAM_MAX_MESSAGE_BYTES;
const MAX_CURSOR_WITNESSES: usize = 2_048;
const MAX_THREAD_ACCESS_WITNESSES: usize = 8_192;
const MAX_OUTBOX_SCAN: usize = 4_096;
const MAX_OUTBOX_RESULTS: usize = 100;
const MAX_PENDING_REQUESTS: usize = 256;

#[derive(Clone)]
struct OwnedPendingRequest {
    delivered_to: HashSet<AuthenticatedContextKey>,
    request: PendingRequest,
}

#[derive(Clone, Debug, Eq, Hash, PartialEq)]
struct ThreadAccessKey {
    context: AuthenticatedContextKey,
    thread_id: Id,
}

#[derive(Clone, Default)]
pub struct ProductionServices {
    pub projects: Option<Arc<ProjectService>>,
    pub workspaces: Option<Arc<WorkspaceService>>,
    pub resources: Option<Arc<ResourceService>>,
    pub accounts: Option<Arc<AccountPoolService>>,
}

pub struct UpstreamSemanticSource {
    upstream: UpstreamHandle,
    store: Arc<IndexStore>,
    history: HistoryService,
    catalog: Arc<SessionCatalog>,
    services: ProductionServices,
    coordinator: SubscriptionCoordinator,
    generation: watch::Receiver<u64>,
    pending: Arc<RwLock<HashMap<String, OwnedPendingRequest>>>,
    catalog_cursors: Arc<Mutex<BoundedMap<String, String>>>,
    live_history_cursors: Arc<Mutex<BoundedMap<String, String>>>,
    history_cursor_owners: Arc<Mutex<BoundedMap<String, ()>>>,
    thread_access: Arc<Mutex<BoundedMap<ThreadAccessKey, u64>>>,
    resumed_thread_settings: Arc<Mutex<BoundedMap<Id, super::domain::ThreadSettings>>>,
}

impl UpstreamSemanticSource {
    #[must_use]
    pub fn new(
        upstream: UpstreamHandle,
        store: Arc<IndexStore>,
        history: HistoryService,
        catalog: Arc<SessionCatalog>,
        services: ProductionServices,
    ) -> Arc<Self> {
        let coordinator = SubscriptionCoordinator::default();
        let (generation_tx, generation) = watch::channel(upstream.generation());
        let source = Arc::new(Self {
            upstream,
            store,
            history,
            catalog,
            services,
            coordinator,
            generation,
            pending: Arc::new(RwLock::new(HashMap::new())),
            catalog_cursors: Arc::new(Mutex::new(BoundedMap::new(MAX_CURSOR_WITNESSES))),
            live_history_cursors: Arc::new(Mutex::new(BoundedMap::new(MAX_CURSOR_WITNESSES))),
            history_cursor_owners: Arc::new(Mutex::new(BoundedMap::new(MAX_CURSOR_WITNESSES))),
            thread_access: Arc::new(Mutex::new(BoundedMap::new(MAX_THREAD_ACCESS_WITNESSES))),
            resumed_thread_settings: Arc::new(Mutex::new(BoundedMap::new(
                MAX_THREAD_ACCESS_WITNESSES,
            ))),
        });
        source.spawn_generation_monitor(generation_tx);
        source.spawn_event_normalizer();
        source
    }

    fn spawn_generation_monitor(self: &Arc<Self>, generation_tx: watch::Sender<u64>) {
        let source = self.clone();
        tokio::spawn(async move {
            let mut status = source.upstream.subscribe_status();
            let mut previous = *generation_tx.borrow();
            let mut previous_status = *status.borrow();
            loop {
                if status.changed().await.is_err() {
                    break;
                }
                let current_status = *status.borrow();
                if current_status == previous_status {
                    continue;
                }
                previous_status = current_status;
                if current_status != ConnectionStatus::Live {
                    let generation = source.generation();
                    source.close_pending_source_lost(generation).await;
                    source.clear_generation_witnesses();
                    source.coordinator.invalidate_generation_for(
                        generation,
                        SourceInvalidationReason::UpstreamUnavailable,
                    );
                    continue;
                }
                let generation = source.upstream.generation();
                if generation != previous {
                    source.close_pending_source_lost(previous).await;
                    source.clear_generation_witnesses();
                    previous = generation;
                    // The generation watch is the single authoritative signal
                    // for an upstream reconnect. Publishing a generic routing
                    // invalidation as well races the runtime and misclassifies
                    // the same transition as `sourceGap`.
                    let _ = generation_tx.send(generation);
                }
            }
        });
    }

    async fn close_pending_source_lost(&self, generation: u64) {
        let pending = {
            let mut pending = self.pending.write().await;
            std::mem::take(&mut *pending)
        };
        for owned in pending.into_values() {
            let request_id = pending_id(&owned.request).clone();
            let thread_id = pending_thread_id(&owned.request).cloned();
            let mut audiences = owned.delivered_to;
            if let Some(thread_id) = &thread_id {
                audiences.extend(self.authorized_contexts(thread_id, generation));
            }
            for context in audiences {
                let selector = thread_id.as_ref().map_or_else(
                    || AudienceSelector::ExactContext(context.clone()),
                    |thread_id| AudienceSelector::CurrentThread {
                        context: context.clone(),
                        thread_id: thread_id.clone(),
                    },
                );
                self.coordinator.publish(
                    generation,
                    selector,
                    ProjectionChange::PendingRequestClosed {
                        request_id: request_id.clone(),
                        generation: U64::new(generation),
                        reason: PendingCloseReason::SourceLost,
                    },
                );
            }
        }
    }

    fn clear_generation_witnesses(&self) {
        self.catalog_cursors
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .clear();
        self.live_history_cursors
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .clear();
        self.history_cursor_owners
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .clear();
        self.thread_access
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .clear();
        self.resumed_thread_settings
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .clear();
    }

    async fn purge_context_state(&self, context: &AuthenticatedContextKey) {
        self.thread_access
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .retain(|key, _| &key.context != context);
        let prefix = format!("{}#", context.as_str());
        self.catalog_cursors
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .retain(|key, _| !key.starts_with(&prefix));
        self.live_history_cursors
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .retain(|key, _| !key.starts_with(&prefix));
        self.history_cursor_owners
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .retain(|key, ()| !key.starts_with(&prefix));
        for owned in self.pending.write().await.values_mut() {
            owned.delivered_to.remove(context);
        }
        self.coordinator.invalidate_context(context);
    }

    fn record_thread_access(
        &self,
        context: &AuthenticatedContextKey,
        thread_id: &Id,
        generation: u64,
    ) {
        let evicted = insert_thread_access(
            &mut self
                .thread_access
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner),
            context,
            thread_id,
            generation,
        );
        if let Some((evicted, _)) = evicted {
            self.coordinator.invalidate_context(&evicted.context);
        }
    }

    fn has_thread_access(
        &self,
        context: &AuthenticatedContextKey,
        thread_id: &Id,
        generation: u64,
    ) -> bool {
        self.thread_access
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .get(&ThreadAccessKey {
                context: context.clone(),
                thread_id: thread_id.clone(),
            })
            .is_some_and(|witness_generation| *witness_generation == generation)
    }

    fn authorized_contexts(&self, thread_id: &Id, generation: u64) -> Vec<AuthenticatedContextKey> {
        self.thread_access
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .iter()
            .filter(|(key, witness_generation)| {
                &key.thread_id == thread_id && **witness_generation == generation
            })
            .map(|(key, _)| key.context.clone())
            .collect()
    }

    fn publish_thread_to_authorized_contexts(
        &self,
        generation: u64,
        thread: &super::domain::ThreadSummary,
    ) {
        for context in self.authorized_contexts(&thread.id, generation) {
            self.coordinator
                .publish_catalog_upsert(generation, &context, thread.clone());
        }
    }

    fn remove_thread_witnesses(&self, thread_id: &Id) {
        self.thread_access
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .retain(|key, _| &key.thread_id != thread_id);
        self.resumed_thread_settings
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .retain(|candidate, _| candidate != thread_id);
    }

    async fn authorize_thread_access(
        &self,
        authorization: &AuthorizationContext,
        context: &AuthenticatedContextKey,
        thread_id: &Id,
        generation: u64,
    ) -> Result<super::domain::ThreadSummary, V2Error> {
        require_scope(authorization, "threads.read")?;
        ensure_generation(self, generation)?;
        let thread = self.read_thread(thread_id).await?;
        self.record_thread_access(context, thread_id, generation);
        Ok(thread)
    }

    async fn rpc(&self, method: &str, params: Value) -> Result<Value, V2Error> {
        let started = std::time::Instant::now();
        let response = self
            .upstream
            .request(json!({"method": method, "params": params}))
            .await
            .map_err(|error| V2Error::source_unavailable(error.to_string()))?;
        let bytes = serde_json::to_vec(&response)
            .map_err(|_| V2Error::source_unavailable("source response could not be measured"))?
            .len();
        tracing::info!(
            source_method = method,
            source_bytes = bytes,
            source_latency_ms = started.elapsed().as_millis(),
            "Sync V2 bounded source read"
        );
        if bytes > MAX_SOURCE_RESPONSE_BYTES {
            return Err(V2Error::source_unavailable(
                "source response exceeded byte limit",
            ));
        }
        normalize::rpc_result(&response)
    }

    async fn catalog_page(
        &self,
        context: &AuthenticatedContextKey,
        generation: u64,
        partition: CatalogPartition,
        before: Option<super::domain::CatalogAnchor>,
        limit: u16,
    ) -> Result<
        (
            Vec<super::domain::ThreadSummary>,
            Option<super::domain::CatalogAnchor>,
        ),
        V2Error,
    > {
        let cursor_key = before
            .as_ref()
            .map(catalog_anchor_key)
            .map(|key| retained_cursor_key(context, &key));
        let source_cursor = cursor_key.as_ref().and_then(|key| {
            self.catalog_cursors
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner)
                .get(key)
                .cloned()
        });
        if before.is_some() && source_cursor.is_none() {
            return Err(V2Error {
                code: ErrorCode::StaleCursor,
                recovery: Recovery::Requery,
                message: "catalog anchor source witness is no longer retained".into(),
            });
        }
        let result = self
            .rpc(
                "thread/list",
                json!({
                    "limit": limit,
                    "sortKey": "updated_at",
                    "sortDirection": "desc",
                    "archived": partition == CatalogPartition::Archived,
                    "cursor": source_cursor,
                    "useStateDbOnly": true,
                }),
            )
            .await?;
        let result = self.history.enrich_thread_list(result).await;
        let source_threads = result
            .get("data")
            .and_then(Value::as_array)
            .ok_or_else(|| V2Error::source_unavailable("thread/list omitted data"))?;
        if source_threads.len() > limit as usize {
            return Err(V2Error::source_unavailable(
                "catalog source exceeded record limit",
            ));
        }
        let threads = source_threads
            .iter()
            .map(|thread| {
                normalize::thread_summary_in_partition(
                    thread,
                    partition == CatalogPartition::Archived,
                )
            })
            .collect::<Result<Vec<_>, _>>()?;
        ensure_generation(self, generation)?;
        for thread in &threads {
            self.record_thread_access(context, &thread.id, generation);
        }
        let next = threads.last().map(|thread| super::domain::CatalogAnchor {
            last_activity_at: thread.last_activity_at.clone(),
            updated_at: thread.updated_at.clone(),
            thread_id: thread.id.clone(),
        });
        if let (Some(anchor), Some(source_cursor)) =
            (&next, result.get("nextCursor").and_then(Value::as_str))
        {
            let _ = self
                .catalog_cursors
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner)
                .insert(
                    retained_cursor_key(context, &catalog_anchor_key(anchor)),
                    source_cursor.to_owned(),
                );
        }
        Ok((
            threads,
            next.filter(|_| {
                result
                    .get("nextCursor")
                    .is_some_and(|value| !value.is_null())
            }),
        ))
    }

    async fn read_thread(&self, thread_id: &Id) -> Result<super::domain::ThreadSummary, V2Error> {
        let mut result = self
            .rpc(
                "thread/read",
                json!({"threadId": thread_id.as_str(), "includeTurns": false}),
            )
            .await?;
        let thread = match result.get_mut("thread") {
            Some(thread) => thread.take(),
            None => result,
        };
        let thread = self.history.enrich_thread(thread).await;
        let thread = normalize::thread_summary(&thread)?;
        let settings = self
            .resumed_thread_settings
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .get(thread_id)
            .cloned();
        Ok(with_cached_thread_settings(thread, settings.as_ref()))
    }

    async fn latest_turn(
        &self,
        thread_id: &Id,
        limit: u16,
        detail: HistoryDetail,
    ) -> Result<Vec<super::domain::TurnView>, V2Error> {
        let result = self.rpc("thread/turns/list", json!({"threadId": thread_id.as_str(), "cursor": null, "limit": limit, "sortDirection": "desc", "itemsView": match detail { HistoryDetail::Summary => "summary", HistoryDetail::Full => "full" }})).await?;
        let source_turns = result
            .get("data")
            .and_then(Value::as_array)
            .ok_or_else(|| V2Error::source_unavailable("thread/turns/list omitted data"))?;
        if source_turns.len() > limit as usize {
            return Err(V2Error::source_unavailable(
                "turn source exceeded record limit",
            ));
        }
        let local_metadata = if detail == HistoryDetail::Full {
            self.local_turn_display_metadata(thread_id, limit).await
        } else {
            HashMap::new()
        };
        let mut turns = source_turns
            .iter()
            .map(|value| {
                let enriched = merge_turn_display_metadata(value, &local_metadata);
                normalize::turn_view(thread_id, &enriched)
            })
            .collect::<Result<Vec<_>, _>>()?;
        turns.reverse();
        Ok(turns)
    }

    async fn local_turn_display_metadata(
        &self,
        thread_id: &Id,
        limit: u16,
    ) -> HashMap<String, Value> {
        let Some(Ok(result)) = self
            .history
            .try_turns_page(
                "thread/turns/list",
                &json!({
                    "threadId": thread_id.as_str(),
                    "cursor": null,
                    "limit": limit,
                    "sortDirection": "desc",
                    "itemsView": "summary"
                }),
            )
            .await
        else {
            return HashMap::new();
        };
        result
            .get("data")
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
            .filter_map(|turn| {
                let id = turn.get("id")?.as_str()?.to_owned();
                Some((id, turn.clone()))
            })
            .collect()
    }

    async fn history_page(
        &self,
        context: &AuthenticatedContextKey,
        thread_id: Id,
        cursor: Option<String>,
        direction: HistoryDirection,
        limit: u16,
        detail: HistoryDetail,
    ) -> Result<QueryResult, V2Error> {
        if direction == HistoryDirection::Newer {
            return self
                .live_history_page(context, thread_id, cursor, direction, limit, detail)
                .await;
        }
        if detail == HistoryDetail::Full {
            return self
                .live_history_page(context, thread_id, cursor, direction, limit, detail)
                .await;
        }
        let decoded = cursor
            .as_deref()
            .map(|value| HistoryCursor::decode(value, &thread_id, direction))
            .transpose()?;
        if let Some(decoded) = &decoded {
            self.require_cursor_owner(context, cursor.as_deref().unwrap_or_default())?;
            self.validate_rollout_witness(decoded)?;
        }
        let internal_cursor = decoded
            .as_ref()
            .map(HistoryCursor::internal_v1_cursor)
            .transpose()?;
        let local = self.history.try_turns_page("thread/turns/list", &json!({"threadId": thread_id.as_str(), "cursor": internal_cursor, "limit": limit, "sortDirection": "desc", "itemsView": "summary"})).await;
        let result = match local {
            Some(Ok(result)) => result,
            Some(Err(_)) | None if cursor.is_none() => {
                return self
                    .live_history_page(context, thread_id, None, direction, limit, detail)
                    .await;
            }
            Some(Err(_)) | None => return Err(stale_cursor()),
        };
        let source_turns = result
            .get("data")
            .and_then(Value::as_array)
            .ok_or_else(|| V2Error::source_unavailable("history projection omitted data"))?;
        if source_turns.len() > limit as usize {
            return Err(V2Error::source_unavailable(
                "history source exceeded record limit",
            ));
        }
        let mut turns = source_turns
            .iter()
            .map(|value| normalize::turn_view(&thread_id, value))
            .collect::<Result<Vec<_>, _>>()?;
        turns.reverse();
        let older_cursor = if let (Some(next), Some(last)) = (
            result.get("nextCursor").and_then(Value::as_str),
            turns.first(),
        ) {
            let offset = v1_source_offset(next).unwrap_or(0);
            let (anchor, witness) = self.rollout_anchor(&thread_id, &last.id, offset)?;
            let cursor =
                HistoryCursor::new(thread_id.clone(), HistoryDirection::Older, anchor, witness)
                    .encode()?;
            self.remember_cursor_owner(context, &cursor);
            Some(cursor)
        } else {
            None
        };
        Ok(QueryResult::HistoryPage {
            thread_id,
            turns,
            older_cursor,
            newer_cursor: None,
        })
    }

    async fn live_history_page(
        &self,
        context: &AuthenticatedContextKey,
        thread_id: Id,
        cursor: Option<String>,
        direction: HistoryDirection,
        limit: u16,
        detail: HistoryDetail,
    ) -> Result<QueryResult, V2Error> {
        let source_cursor = match cursor.as_deref() {
            None => None,
            Some(value) => {
                let decoded = HistoryCursor::decode(value, &thread_id, direction)?;
                self.require_cursor_owner(context, value)?;
                match decoded.source() {
                    SourceWitness::Live { generation, .. }
                        if generation.get() == self.generation() => {}
                    _ => return Err(stale_cursor()),
                }
                Some(
                    self.live_history_cursors
                        .lock()
                        .unwrap_or_else(std::sync::PoisonError::into_inner)
                        .get(&retained_cursor_key(context, value))
                        .cloned()
                        .ok_or_else(stale_cursor)?,
                )
            }
        };
        let result = self.rpc("thread/turns/list", json!({"threadId": thread_id.as_str(), "cursor": source_cursor, "limit": limit, "sortDirection": if direction == HistoryDirection::Older { "desc" } else { "asc" }, "itemsView": if detail == HistoryDetail::Full { "full" } else { "summary" }})).await?;
        let source_turns = result
            .get("data")
            .and_then(Value::as_array)
            .ok_or_else(|| V2Error::source_unavailable("history source omitted data"))?;
        if source_turns.len() > limit as usize {
            return Err(V2Error::source_unavailable(
                "history source exceeded record limit",
            ));
        }
        let mut turns = source_turns
            .iter()
            .map(|value| normalize::turn_view(&thread_id, value))
            .collect::<Result<Vec<_>, _>>()?;
        if direction == HistoryDirection::Older {
            turns.reverse();
        }
        let head_turn_id = turns.last().map(|turn| turn.id.clone());
        let continuation_anchor = match direction {
            HistoryDirection::Older => turns.first(),
            HistoryDirection::Newer => turns.last(),
        };
        let reverse_anchor = match direction {
            HistoryDirection::Older => turns.last(),
            HistoryDirection::Newer => turns.first(),
        };
        let continuation = match (
            result.get("nextCursor").and_then(Value::as_str),
            continuation_anchor,
        ) {
            (Some(source_cursor), Some(anchor)) => Some(self.wrap_live_history_cursor(
                context,
                &thread_id,
                direction,
                source_cursor,
                &anchor.id,
                head_turn_id.clone(),
            )?),
            _ => None,
        };
        let reverse_direction = opposite_history_direction(direction);
        let reverse = match (
            result.get("backwardsCursor").and_then(Value::as_str),
            reverse_anchor,
        ) {
            (Some(source_cursor), Some(anchor)) => Some(self.wrap_live_history_cursor(
                context,
                &thread_id,
                reverse_direction,
                source_cursor,
                &anchor.id,
                head_turn_id,
            )?),
            _ => None,
        };
        let (older_cursor, newer_cursor) = match direction {
            HistoryDirection::Older => (continuation, reverse),
            HistoryDirection::Newer => (reverse, continuation),
        };
        Ok(QueryResult::HistoryPage {
            thread_id,
            turns,
            older_cursor,
            newer_cursor,
        })
    }

    fn wrap_live_history_cursor(
        &self,
        context: &AuthenticatedContextKey,
        thread_id: &Id,
        direction: HistoryDirection,
        source_cursor: &str,
        anchor_turn_id: &Id,
        head_turn_id: Option<Id>,
    ) -> Result<String, V2Error> {
        let cursor = HistoryCursor::new(
            thread_id.clone(),
            direction,
            HistoryAnchor {
                turn_id: anchor_turn_id.clone(),
                start_offset: None,
                end_offset: None,
            },
            SourceWitness::Live {
                generation: U64::new(self.generation()),
                head_turn_id,
                updated_at: Timestamp::now(),
            },
        )
        .encode()?;
        let _ = self
            .live_history_cursors
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .insert(
                retained_cursor_key(context, &cursor),
                source_cursor.to_owned(),
            );
        self.remember_cursor_owner(context, &cursor);
        Ok(cursor)
    }

    fn rollout_anchor(
        &self,
        thread_id: &Id,
        turn_id: &Id,
        fallback_offset: u64,
    ) -> Result<(HistoryAnchor, SourceWitness), V2Error> {
        let path = self
            .catalog
            .resolve(thread_id.as_str())
            .map_err(|error| V2Error::source_unavailable(error.to_string()))?;
        let file_id = crate::rollout::rollout_file_id(&path);
        let turn = self
            .store
            .turn_by_id(&file_id, turn_id.as_str())
            .map_err(|error| V2Error::source_unavailable(error.to_string()))?;
        let start = turn
            .as_ref()
            .map_or(fallback_offset, |turn| turn.start_offset);
        let end = turn.as_ref().map(|turn| turn.end_offset);
        let anchor = HistoryAnchor {
            turn_id: turn_id.clone(),
            start_offset: Some(U64::new(start)),
            end_offset: end.map(U64::new),
        };
        let witness = rollout_witness(&path, &anchor)?;
        Ok((anchor, witness))
    }

    fn validate_rollout_witness(&self, cursor: &HistoryCursor) -> Result<(), V2Error> {
        let path = self
            .catalog
            .resolve(match cursor.source() {
                SourceWitness::Rollout { .. } => cursor.thread_id().as_str(),
                SourceWitness::Live { .. } => return Err(stale_cursor()),
            })
            .map_err(|_| stale_cursor())?;
        let current = rollout_witness(&path, cursor.anchor())?;
        match (cursor.source(), current) {
            (
                SourceWitness::Rollout {
                    device,
                    inode,
                    anchor_hash,
                    durable_end,
                },
                SourceWitness::Rollout {
                    device: current_device,
                    inode: current_inode,
                    anchor_hash: current_hash,
                    durable_end: current_end,
                },
            ) if device == &current_device
                && inode == &current_inode
                && anchor_hash == &current_hash
                && current_end.get() >= durable_end.get() =>
            {
                Ok(())
            }
            _ => Err(stale_cursor()),
        }
    }

    fn remember_cursor_owner(&self, context: &AuthenticatedContextKey, cursor: &str) {
        let _ = self
            .history_cursor_owners
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .insert(retained_cursor_key(context, cursor), ());
    }

    fn require_cursor_owner(
        &self,
        context: &AuthenticatedContextKey,
        cursor: &str,
    ) -> Result<(), V2Error> {
        self.history_cursor_owners
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .get(&retained_cursor_key(context, cursor))
            .is_some()
            .then_some(())
            .ok_or_else(stale_cursor)
    }
}

const fn opposite_history_direction(direction: HistoryDirection) -> HistoryDirection {
    match direction {
        HistoryDirection::Older => HistoryDirection::Newer,
        HistoryDirection::Newer => HistoryDirection::Older,
    }
}

fn insert_thread_access(
    witnesses: &mut BoundedMap<ThreadAccessKey, u64>,
    context: &AuthenticatedContextKey,
    thread_id: &Id,
    generation: u64,
) -> Option<(ThreadAccessKey, u64)> {
    witnesses.insert(
        ThreadAccessKey {
            context: context.clone(),
            thread_id: thread_id.clone(),
        },
        generation,
    )
}

mod events;
mod helpers;
mod source_impl;

use helpers::{
    catalog_anchor_key, is_pending_method, pending_id, pending_request, pending_thread_id,
    require_scope, revision, rollout_witness,
};

fn retained_cursor_key(context: &AuthenticatedContextKey, value: &str) -> String {
    format!("{}#{value}", context.as_str())
}

fn merge_turn_display_metadata(source: &Value, local_metadata: &HashMap<String, Value>) -> Value {
    let Some(turn_id) = source.get("id").and_then(Value::as_str) else {
        return source.clone();
    };
    let Some(local) = local_metadata.get(turn_id) else {
        return source.clone();
    };
    let Some(local_codewide) = local.get("codewide").and_then(Value::as_object) else {
        return source.clone();
    };
    let mut enriched = source.clone();
    let Some(enriched_object) = enriched.as_object_mut() else {
        return enriched;
    };
    let codewide = enriched_object
        .entry("codewide")
        .or_insert_with(|| Value::Object(serde_json::Map::new()));
    let Some(codewide) = codewide.as_object_mut() else {
        return enriched;
    };
    for key in ["activity", "usage"] {
        if let Some(value) = local_codewide.get(key) {
            codewide.insert(key.to_owned(), value.clone());
        }
    }
    enriched
}

fn with_cached_thread_settings(
    mut thread: super::domain::ThreadSummary,
    settings: Option<&super::domain::ThreadSettings>,
) -> super::domain::ThreadSummary {
    if thread.settings.is_none() {
        thread.settings = settings.cloned();
    }
    thread
}

#[cfg(test)]
#[allow(clippy::unwrap_used)]
mod tests {
    use super::*;
    use crate::sync_v2::{
        domain::SnapshotLimits, protocol::CatalogIntent, source::CoordinatorEvent,
    };

    fn context(device_id: &str) -> AuthenticatedContextKey {
        AuthenticatedContextKey::derive(&AuthorizationContext::Session {
            device_id: device_id.into(),
            scopes: vec!["threads.read".into()],
            expires_at: u64::MAX,
        })
        .unwrap()
    }

    #[test]
    fn full_turn_keeps_source_items_and_adds_indexed_display_metadata() {
        let source = json!({
            "id": "turn-1",
            "items": [{"type": "agentMessage", "id": "answer", "text": "Done"}],
            "status": "completed",
            "durationMs": 3200
        });
        let local = json!({
            "id": "turn-1",
            "items": [{"type": "agentMessage", "id": "summary", "text": "Summary"}],
            "codewide": {
                "activity": {"count": 2, "kinds": ["commandExecution"]},
                "usage": {
                    "tokens": {"input": 26000, "output": 1900},
                    "cost": {"totalCostUsd": 0.014}
                }
            }
        });
        let metadata = HashMap::from([("turn-1".to_owned(), local)]);

        let enriched = merge_turn_display_metadata(&source, &metadata);

        assert_eq!(enriched.pointer("/items/0/id"), Some(&json!("answer")));
        assert_eq!(enriched.pointer("/durationMs"), Some(&json!(3200)));
        assert_eq!(
            enriched.pointer("/codewide/activity/count"),
            Some(&json!(2))
        );
        assert_eq!(
            enriched.pointer("/codewide/usage/tokens/input"),
            Some(&json!(26000))
        );
    }

    #[test]
    fn resumed_settings_fill_a_read_only_thread_shell() {
        let thread = serde_json::from_value(json!({
            "id": "thread-1",
            "parentId": null,
            "title": null,
            "preview": "",
            "workspace": "/tmp",
            "archived": false,
            "state": "idle",
            "settings": null,
            "createdAt": "2026-08-31T00:00:00Z",
            "updatedAt": "2026-08-31T00:00:00Z",
            "lastActivityAt": null,
            "headTurnId": null
        }))
        .unwrap();
        let settings = serde_json::from_value(json!({
            "model": "gpt-5.6-sol",
            "effort": "low",
            "approvalPolicy": "never",
            "sandbox": "unrestricted"
        }))
        .unwrap();

        let enriched = with_cached_thread_settings(thread, Some(&settings));

        assert_eq!(
            enriched
                .settings
                .as_ref()
                .and_then(|value| value.model.as_deref()),
            Some("gpt-5.6-sol")
        );
    }

    #[test]
    fn witness_eviction_reinitializes_the_affected_recipient() {
        let coordinator = SubscriptionCoordinator::default();
        let first = context("device-a");
        let receiver = coordinator.register(
            Id::new("recipient-a").unwrap(),
            1,
            first.clone(),
            OpenIntent {
                catalog: CatalogIntent {
                    active_limit: 0,
                    archived_limit: 0,
                },
                current_thread: None,
            },
            SnapshotLimits::default(),
        );
        let mut witnesses = BoundedMap::new(1);
        assert!(insert_thread_access(&mut witnesses, &first, &Id::new("a").unwrap(), 1).is_none());
        let evicted = insert_thread_access(
            &mut witnesses,
            &context("device-b"),
            &Id::new("b").unwrap(),
            1,
        )
        .unwrap();
        coordinator.invalidate_context(&evicted.0.context);
        let (event, _) = receiver.try_recv().unwrap().into_parts();
        assert!(matches!(event, CoordinatorEvent::RoutingInvalidated { .. }));
    }
}
