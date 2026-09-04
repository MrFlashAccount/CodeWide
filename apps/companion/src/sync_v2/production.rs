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
use tokio::sync::{RwLock, Semaphore, broadcast, watch};

use crate::{
    account_pool::{AccountPoolError, AccountPoolService},
    auth::AuthorizationContext,
    catalog::SessionCatalog,
    history_service::HistoryService,
    projects::ProjectService,
    resources::ResourceService,
    store::{
        IndexStore, OutboxClaimOutcome, OutboxClaimResolution, OutboxClaimResolutionOutcome,
        OutboxExpectation, OutboxQueueInputBlock,
    },
    upstream::{ConnectionStatus, UpstreamError, UpstreamHandle},
    workspaces::WorkspaceService,
};

use super::{
    attachment_staging::AttachmentStageStore,
    auth_context::AuthenticatedContextKey,
    bounded::BoundedMap,
    cursor::{HistoryAnchor, HistoryCursor, SourceWitness, stale_cursor, v1_source_offset},
    domain::{
        ApprovalDecision, CatalogPartitionScope, CatalogScope, ElicitationDefault,
        ElicitationField, ElicitationFieldType, ElicitationMode, ElicitationOption,
        ElicitationValue, FileSystemAccessMode, FileSystemPath, FileSystemPermissionEntry,
        FileSystemPermissions, FileSystemSpecialPath, Item, LifecyclePhase, NetworkAccess,
        NetworkPermissions, NetworkPolicyAmendment, NetworkPolicyRuleAction, PendingCloseReason,
        PendingRequest, PermissionProfile, ProjectionChange, RemovalReason, ThreadReadState,
        ThreadSettings, ThreadWindow, TurnView, UserInputOption, UserInputQuestion,
    },
    normalize,
    protocol::{
        AccountChange, AccountLoginCancelState, BackgroundProcess, CatalogPartition,
        CatalogSnapshot, Command, CommandResult, CurrentThreadIntent, ErrorCode, HistoryDetail,
        HistoryDirection, InterruptState, ItemOutputFormat, OpenIntent, PendingRequestScope,
        ProcessTerminationState, Query, QueryResult, QueueMutation, QueueMutationOutcome, Recovery,
        RequestResolution, ResolutionState, ResourceScope, ReviewCapabilities, ReviewDelivery,
        ReviewTarget, ReviewTargetKind, Skill, ThreadChangePatch, ThreadUpdate, V2Error,
    },
    queue_cursor::{QueueCursor, stale_cursor as stale_queue_cursor},
    read_receipts::ThreadReadReceipts,
    resource_cursor::{ChangeOutputCursor, ResourceCursor, stale_cursor as stale_resource_cursor},
    scalar::{Id, OperationId, Timestamp, U64},
    source::{
        AudienceSelector, CommandExecution, SemanticSource, SnapshotData, SourceInvalidationReason,
        SubscriptionCoordinator, WatchedThreadData, ensure_generation,
    },
};

const MAX_SOURCE_RESPONSE_BYTES: usize = super::V2_UPSTREAM_MAX_MESSAGE_BYTES;
const MAX_CURSOR_WITNESSES: usize = 2_048;
const MAX_THREAD_ACCESS_WITNESSES: usize = 8_192;
const MAX_PENDING_REQUESTS: usize = 256;
const MAX_LIVE_TURN_REFRESHES: usize = 256;
const MAX_CONCURRENT_LIVE_TURN_REFRESHES: usize = 4;
const MAX_TURN_LIFECYCLE_WITNESSES: usize = 8_192;
const THREAD_SETTINGS_EVENT_CAPACITY: usize = 64;

#[derive(Clone)]
struct OwnedPendingRequest {
    delivered_to: HashSet<AuthenticatedContextKey>,
    request: PendingRequest,
    resolution_indeterminate: bool,
}

#[derive(Debug)]
enum CommandDispatchError {
    Failed(V2Error),
    Indeterminate(V2Error),
}

impl From<V2Error> for CommandDispatchError {
    fn from(error: V2Error) -> Self {
        Self::Failed(error)
    }
}

#[derive(Clone, Debug, Eq, Hash, PartialEq)]
struct ThreadAccessKey {
    context: AuthenticatedContextKey,
    thread_id: Id,
}

#[derive(Clone, Debug, Eq, Hash, PartialEq)]
struct TurnLifecycleKey {
    thread_id: Id,
    turn_id: Id,
}

struct ReadThread {
    summary: super::domain::ThreadSummary,
    visible_in_catalog: bool,
    supports_detached_review: bool,
}

#[derive(Clone, Copy, Debug, Default, Eq, PartialEq)]
struct ThreadFreshnessWitness {
    recency_at: Option<i64>,
    active: Option<bool>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
struct TurnItemsCursorWitness {
    source_cursor: String,
    thread_id: Id,
    turn_id: Id,
    generation: u64,
}

#[derive(Clone, Debug, Eq, PartialEq)]
struct ItemOutputCursorWitness {
    offset: usize,
    output_hash: String,
    thread_id: Id,
    turn_id: Id,
    item_id: Id,
    generation: u64,
}

#[derive(Clone, Debug, Eq, PartialEq)]
struct BackgroundProcessCursorWitness {
    source_cursor: String,
    thread_id: Id,
    generation: u64,
}

#[derive(Clone, Debug, Eq, PartialEq)]
struct CatalogSearchCursorWitness {
    source_cursor: String,
    partition: CatalogPartition,
    query_hash: String,
    generation: u64,
}

#[derive(Clone, Copy)]
struct LiveTurnRefreshState {
    generation: u64,
    token: u64,
    dirty: bool,
    resources_dirty: bool,
}

#[derive(Debug, Eq, PartialEq)]
enum LiveTurnRefreshAdmission {
    Spawn { token: u64 },
    Coalesced,
    Saturated,
}

#[derive(Debug, Eq, PartialEq)]
enum LiveTurnRefreshCompletion {
    Complete,
    Repeat,
}

struct LiveTurnRefreshes {
    limit: usize,
    next_token: u64,
    values: HashMap<Id, LiveTurnRefreshState>,
}

impl LiveTurnRefreshes {
    fn new(limit: usize) -> Self {
        Self {
            limit,
            next_token: 1,
            values: HashMap::new(),
        }
    }

    fn admit(
        &mut self,
        thread_id: &Id,
        generation: u64,
        resources_changed: bool,
    ) -> LiveTurnRefreshAdmission {
        if let Some(state) = self.values.get_mut(thread_id)
            && state.generation == generation
        {
            state.dirty = true;
            state.resources_dirty |= resources_changed;
            return LiveTurnRefreshAdmission::Coalesced;
        }
        if !self.values.contains_key(thread_id) && self.values.len() >= self.limit {
            return LiveTurnRefreshAdmission::Saturated;
        }
        let Some(next_token) = self.next_token.checked_add(1) else {
            return LiveTurnRefreshAdmission::Saturated;
        };
        let token = self.next_token;
        self.next_token = next_token;
        self.values.insert(
            thread_id.clone(),
            LiveTurnRefreshState {
                generation,
                token,
                dirty: false,
                resources_dirty: resources_changed,
            },
        );
        LiveTurnRefreshAdmission::Spawn { token }
    }

    fn begin(&mut self, thread_id: &Id, generation: u64, token: u64) -> Option<bool> {
        let state = self.values.get_mut(thread_id)?;
        if state.generation != generation || state.token != token {
            return None;
        }
        state.dirty = false;
        let resources_changed = state.resources_dirty;
        state.resources_dirty = false;
        Some(resources_changed)
    }

    fn is_active(&self, thread_id: &Id, generation: u64, token: u64) -> bool {
        self.values
            .get(thread_id)
            .is_some_and(|state| state.generation == generation && state.token == token)
    }

    fn publish_if_active(
        &self,
        thread_id: &Id,
        generation: u64,
        token: u64,
        publish: impl FnOnce(),
    ) -> bool {
        if !self.is_active(thread_id, generation, token) {
            return false;
        }
        publish();
        true
    }

    fn complete(
        &mut self,
        thread_id: &Id,
        generation: u64,
        token: u64,
    ) -> LiveTurnRefreshCompletion {
        let Some(state) = self.values.get(thread_id) else {
            return LiveTurnRefreshCompletion::Complete;
        };
        if state.generation != generation || state.token != token {
            return LiveTurnRefreshCompletion::Complete;
        }
        if state.dirty {
            return LiveTurnRefreshCompletion::Repeat;
        }
        self.values.remove(thread_id);
        LiveTurnRefreshCompletion::Complete
    }

    fn abort(&mut self, thread_id: &Id, generation: u64, token: u64) -> bool {
        if self
            .values
            .get(thread_id)
            .is_some_and(|state| state.generation == generation && state.token == token)
        {
            self.values.remove(thread_id);
            return true;
        }
        false
    }

    fn abort_current(&mut self, thread_id: &Id, generation: u64) -> bool {
        let Some(token) = self
            .values
            .get(thread_id)
            .and_then(|state| (state.generation == generation).then_some(state.token))
        else {
            return false;
        };
        self.abort(thread_id, generation, token)
    }

    fn clear(&mut self) {
        self.values.clear();
    }
}

#[derive(Clone, Default)]
pub struct ProductionServices {
    pub projects: Option<Arc<ProjectService>>,
    pub workspaces: Option<Arc<WorkspaceService>>,
    pub resources: Option<Arc<ResourceService>>,
    pub accounts: Option<Arc<AccountPoolService>>,
    pub attachments: Option<AttachmentStageStore>,
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
    catalog_search_cursors: Arc<Mutex<BoundedMap<String, CatalogSearchCursorWitness>>>,
    live_history_cursors: Arc<Mutex<BoundedMap<String, String>>>,
    history_cursor_owners: Arc<Mutex<BoundedMap<String, ()>>>,
    turn_items_cursors: Arc<Mutex<BoundedMap<String, TurnItemsCursorWitness>>>,
    item_output_cursors: Arc<Mutex<BoundedMap<String, ItemOutputCursorWitness>>>,
    background_process_cursors: Arc<Mutex<BoundedMap<String, BackgroundProcessCursorWitness>>>,
    thread_access: Arc<Mutex<BoundedMap<ThreadAccessKey, u64>>>,
    account_access: Arc<Mutex<BoundedMap<AuthenticatedContextKey, u64>>>,
    resumed_thread_settings: Arc<Mutex<BoundedMap<Id, super::domain::ThreadSettings>>>,
    thread_settings_updates: broadcast::Sender<(Id, ThreadSettings)>,
    thread_freshness: Arc<Mutex<BoundedMap<Id, ThreadFreshnessWitness>>>,
    live_turn_refreshes: Arc<Mutex<LiveTurnRefreshes>>,
    live_turn_refresh_slots: Arc<Semaphore>,
    read_receipts: ThreadReadReceipts,
    turn_lifecycle: Arc<Mutex<BoundedMap<TurnLifecycleKey, bool>>>,
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
        let (thread_settings_updates, _) = broadcast::channel(THREAD_SETTINGS_EVENT_CAPACITY);
        let read_receipts = ThreadReadReceipts::new(store.clone());
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
            catalog_search_cursors: Arc::new(Mutex::new(BoundedMap::new(MAX_CURSOR_WITNESSES))),
            live_history_cursors: Arc::new(Mutex::new(BoundedMap::new(MAX_CURSOR_WITNESSES))),
            history_cursor_owners: Arc::new(Mutex::new(BoundedMap::new(MAX_CURSOR_WITNESSES))),
            turn_items_cursors: Arc::new(Mutex::new(BoundedMap::new(MAX_CURSOR_WITNESSES))),
            item_output_cursors: Arc::new(Mutex::new(BoundedMap::new(MAX_CURSOR_WITNESSES))),
            background_process_cursors: Arc::new(Mutex::new(BoundedMap::new(MAX_CURSOR_WITNESSES))),
            thread_access: Arc::new(Mutex::new(BoundedMap::new(MAX_THREAD_ACCESS_WITNESSES))),
            account_access: Arc::new(Mutex::new(BoundedMap::new(MAX_THREAD_ACCESS_WITNESSES))),
            resumed_thread_settings: Arc::new(Mutex::new(BoundedMap::new(
                MAX_THREAD_ACCESS_WITNESSES,
            ))),
            thread_settings_updates,
            thread_freshness: Arc::new(Mutex::new(BoundedMap::new(MAX_THREAD_ACCESS_WITNESSES))),
            live_turn_refreshes: Arc::new(Mutex::new(LiveTurnRefreshes::new(
                MAX_LIVE_TURN_REFRESHES,
            ))),
            live_turn_refresh_slots: Arc::new(Semaphore::new(MAX_CONCURRENT_LIVE_TURN_REFRESHES)),
            read_receipts,
            turn_lifecycle: Arc::new(Mutex::new(BoundedMap::new(MAX_TURN_LIFECYCLE_WITNESSES))),
        });
        source.spawn_generation_monitor(generation_tx);
        source.spawn_event_normalizer();
        source.spawn_account_event_normalizer();
        source.spawn_queue_event_normalizer();
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
            for context in owned.delivered_to {
                self.coordinator.publish(
                    generation,
                    AudienceSelector::ExactContext(context),
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
        self.catalog_search_cursors
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
        self.turn_items_cursors
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .clear();
        self.item_output_cursors
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .clear();
        self.thread_access
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .clear();
        self.account_access
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .clear();
        self.resumed_thread_settings
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .clear();
        self.thread_freshness
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .clear();
        self.live_turn_refreshes
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .clear();
        self.turn_lifecycle
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .clear();
    }

    async fn purge_context_state(&self, context: &AuthenticatedContextKey) {
        self.thread_access
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .retain(|key, _| &key.context != context);
        self.account_access
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .retain(|key, _| key != context);
        let prefix = format!("{}#", context.as_str());
        self.catalog_cursors
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .retain(|key, _| !key.starts_with(&prefix));
        self.catalog_search_cursors
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
        self.turn_items_cursors
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .retain(|key, _| !key.starts_with(&prefix));
        self.item_output_cursors
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .retain(|key, _| !key.starts_with(&prefix));
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

    fn record_account_access(&self, context: &AuthenticatedContextKey, generation: u64) {
        let evicted = self
            .account_access
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .insert(context.clone(), generation);
        if let Some((evicted, _)) = evicted {
            self.coordinator.invalidate_context(&evicted);
        }
    }

    fn account_contexts(&self, generation: u64) -> Vec<AuthenticatedContextKey> {
        self.account_access
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .iter()
            .filter(|(_, observed_generation)| **observed_generation == generation)
            .map(|(context, _)| context.clone())
            .collect()
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
        if thread.parent_id.is_some() {
            return;
        }
        for context in self.authorized_contexts(&thread.id, generation) {
            let mut contextual_thread = thread.clone();
            if self
                .attach_read_state(&context, &mut contextual_thread)
                .is_ok()
            {
                self.coordinator
                    .publish_catalog_upsert(generation, &context, &contextual_thread);
            } else {
                self.coordinator.invalidate_context(&context);
            }
        }
    }

    fn remove_thread_witnesses(&self, thread_id: &Id) {
        self.turn_items_cursors
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .retain(|_, witness| &witness.thread_id != thread_id);
        self.thread_access
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .retain(|key, _| &key.thread_id != thread_id);
        self.resumed_thread_settings
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .retain(|candidate, _| candidate != thread_id);
        self.thread_freshness
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .retain(|candidate, _| candidate != thread_id);
        self.turn_lifecycle
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .retain(|key, _| &key.thread_id != thread_id);
    }

    async fn authorize_thread_access(
        &self,
        authorization: &AuthorizationContext,
        context: &AuthenticatedContextKey,
        thread_id: &Id,
        generation: u64,
    ) -> Result<super::domain::ThreadSummary, V2Error> {
        require_authenticated_session(authorization)?;
        ensure_generation(self, generation)?;
        let mut thread = self.read_thread(thread_id).await?;
        self.attach_read_state(context, &mut thread)?;
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

    async fn command_rpc(
        &self,
        method: &str,
        params: Value,
    ) -> Result<Value, CommandDispatchError> {
        let response = self
            .upstream
            .request(json!({"method": method, "params": params}))
            .await
            .map_err(|error| command_transport_error(&error))?;
        command_rpc_result(&response)
    }
}

fn command_transport_error(error: &UpstreamError) -> CommandDispatchError {
    match error {
        UpstreamError::Reconnecting | UpstreamError::Backpressure | UpstreamError::Protocol(_) => {
            CommandDispatchError::Failed(V2Error::source_unavailable(
                "source did not accept the command request",
            ))
        }
        UpstreamError::Disconnected => CommandDispatchError::Indeterminate(
            V2Error::operation_indeterminate("source command delivery became ambiguous"),
        ),
    }
}

fn response_transport_error(error: &UpstreamError) -> CommandDispatchError {
    match error {
        UpstreamError::Reconnecting | UpstreamError::Backpressure | UpstreamError::Protocol(_) => {
            CommandDispatchError::Failed(V2Error::source_unavailable(
                "source did not accept the command response",
            ))
        }
        UpstreamError::Disconnected => CommandDispatchError::Indeterminate(
            V2Error::operation_indeterminate("source command response outcome is unknown"),
        ),
    }
}

fn command_rpc_result(response: &Value) -> Result<Value, CommandDispatchError> {
    let bytes = serde_json::to_vec(response).map_err(|_| {
        CommandDispatchError::Indeterminate(V2Error::operation_indeterminate(
            "source command response could not be measured",
        ))
    })?;
    if bytes.len() > MAX_SOURCE_RESPONSE_BYTES {
        return Err(CommandDispatchError::Indeterminate(
            V2Error::operation_indeterminate("source command response exceeded byte limit"),
        ));
    }
    if response.get("error").is_some() {
        return normalize::rpc_result(response).map_err(CommandDispatchError::Failed);
    }
    response.get("result").cloned().ok_or_else(|| {
        CommandDispatchError::Indeterminate(V2Error::operation_indeterminate(
            "source command response omitted its result",
        ))
    })
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

mod capabilities;
mod events;
mod helpers;
mod permissions;
mod projection;
mod source_impl;

#[cfg(test)]
mod contract_tests;

use capabilities::require_authenticated_session;
use helpers::{
    catalog_anchor_key, is_pending_method, pending_id, pending_request, pending_thread_id,
    revision, rollout_witness,
};
use projection::final_agent_activity_marker;
#[cfg(test)]
use projection::{merge_turn_display_metadata, source_catalog_cursor, with_cached_thread_settings};

#[cfg(test)]
mod state_tests;
