#![allow(clippy::wildcard_imports)]

use super::*;

fn is_account_pool_event(event: &Value) -> bool {
    event
        .get("method")
        .and_then(Value::as_str)
        .is_some_and(|method| method.starts_with("companion/accountPool/"))
}

impl UpstreamSemanticSource {
    pub(super) fn spawn_event_normalizer(self: &Arc<Self>) {
        // Subscribe before the task is scheduled. Otherwise an immediately-live
        // App Server can publish events into a channel with no V2 receiver.
        let mut events = self.upstream.subscribe_events();
        let source = self.clone();
        tokio::spawn(async move {
            loop {
                let event = match events.recv().await {
                    Ok(event) => event,
                    Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => {
                        source.close_pending_source_lost(source.generation()).await;
                        source.clear_generation_witnesses();
                        source
                            .coordinator
                            .invalidate_generation(source.generation());
                        continue;
                    }
                    Err(tokio::sync::broadcast::error::RecvError::Closed) => break,
                };
                source.normalize_event(event).await;
            }
        });
    }

    pub(super) fn spawn_account_event_normalizer(self: &Arc<Self>) {
        let Some(accounts) = &self.services.accounts else {
            return;
        };
        let mut events = accounts.subscribe_events();
        let source = self.clone();
        tokio::spawn(async move {
            loop {
                match events.recv().await {
                    Ok(event) if is_account_pool_event(&event) => {
                        source.publish_accounts_changed(source.generation());
                    }
                    Ok(_) => {}
                    Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => {
                        source.publish_accounts_changed(source.generation());
                    }
                    Err(tokio::sync::broadcast::error::RecvError::Closed) => break,
                }
            }
        });
    }

    pub(super) fn spawn_queue_event_normalizer(self: &Arc<Self>) {
        // Subscribe before scheduling so a dispatcher transition cannot land
        // between source construction and receiver registration.
        let mut changes = self.store.subscribe_outbox_changes();
        let source = self.clone();
        tokio::spawn(async move {
            loop {
                match changes.recv().await {
                    Ok(change) => source.publish_queue_changed(change),
                    Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => {
                        source.publish_all_queues_changed();
                    }
                    Err(tokio::sync::broadcast::error::RecvError::Closed) => break,
                }
            }
        });
    }

    fn publish_queue_changed(&self, change: crate::store::OutboxChange) {
        let Some(owner) = change
            .owner_context
            .and_then(AuthenticatedContextKey::from_persisted)
        else {
            return;
        };
        let Ok(thread_id) = Id::new(change.remote_thread_id) else {
            self.coordinator.invalidate_context(&owner);
            return;
        };
        self.coordinator.publish(
            self.generation(),
            AudienceSelector::ExactContext(owner),
            ProjectionChange::QueueChanged {
                thread_id: Some(thread_id),
                revision: revision("queue"),
            },
        );
    }

    fn publish_all_queues_changed(&self) {
        let generation = self.generation();
        for context in self.coordinator.contexts(generation) {
            self.coordinator.publish(
                generation,
                AudienceSelector::ExactContext(context),
                ProjectionChange::QueueChanged {
                    thread_id: None,
                    revision: revision("queue"),
                },
            );
        }
    }

    fn publish_accounts_changed(&self, generation: u64) {
        for context in self.account_contexts(generation) {
            self.coordinator.publish(
                generation,
                AudienceSelector::ExactContext(context),
                ProjectionChange::AccountsChanged {
                    revision: revision("accounts"),
                },
            );
        }
    }

    #[allow(clippy::too_many_lines)]
    async fn normalize_event(self: &Arc<Self>, event: Value) {
        let generation = self.generation();
        let method = event
            .get("method")
            .and_then(Value::as_str)
            .unwrap_or_default();
        if event_announces_agent(method, &event)
            && let Some(parent_thread_id) = event
                .pointer("/params/threadId")
                .and_then(Value::as_str)
                .and_then(|value| Id::new(value.to_owned()).ok())
        {
            self.publish_agents_changed(generation, Some(&parent_thread_id));
        }
        if is_pending_method(method) {
            self.normalize_pending_event(&event, generation).await;
            return;
        }
        if method == "skills/changed" {
            for context in self.coordinator.contexts(generation) {
                self.coordinator.publish(
                    generation,
                    AudienceSelector::ExactContext(context),
                    ProjectionChange::SkillsChanged {
                        workspace: None,
                        revision: revision("skills"),
                    },
                );
            }
            return;
        }
        if method == "serverRequest/resolved" {
            self.close_resolved_pending(&event, generation).await;
            return;
        }
        if method == "thread/settings/updated" {
            if let Ok(update) = cache_thread_settings_event(&self.resumed_thread_settings, &event) {
                let _ = self.thread_settings_updates.send(update);
            } else {
                self.invalidate_ambiguous(generation);
                return;
            }
        }

        let thread_id = event
            .pointer("/params/threadId")
            .and_then(Value::as_str)
            .and_then(|value| Id::new(value.to_owned()).ok());
        if method == "turn/completed"
            && let (Some(thread_id), Some(turn)) =
                (thread_id.as_ref(), event.pointer("/params/turn"))
            && let Ok(turn) = normalize::turn_view(thread_id, turn)
            && let Some(marker) = final_agent_activity_marker(&turn)
            && self
                .read_receipts
                .note_agent_response(thread_id, &marker)
                .is_err()
        {
            self.invalidate_ambiguous(generation);
            return;
        }
        if matches!(method, "item/started" | "item/completed")
            && self
                .publish_item_lifecycle(&event, method, generation)
                .await
                .is_err()
        {
            self.invalidate_ambiguous(generation);
            return;
        }
        let superseded_live_refresh = thread_id.as_ref().is_some_and(|thread_id| {
            event_supersedes_live_turn(method)
                && self.abort_current_live_turn_refresh(thread_id, generation)
        });
        if method == "thread/deleted" {
            let Some(thread_id) = thread_id else {
                self.invalidate_ambiguous(generation);
                return;
            };
            self.publish_agents_changed(generation, None);
            for context in self.coordinator.contexts(generation) {
                self.coordinator.publish_thread_removed(
                    generation,
                    &context,
                    &thread_id,
                    RemovalReason::Deleted,
                );
            }
            self.remove_thread_witnesses(&thread_id);
            if self.read_receipts.delete_thread(&thread_id).is_err() {
                self.invalidate_ambiguous(generation);
            }
            return;
        }
        if matches!(method, "thread/goal/updated" | "thread/goal/cleared") {
            let Some(thread_id) = thread_id else {
                self.invalidate_ambiguous(generation);
                return;
            };
            for context in self.coordinator.contexts(generation) {
                self.coordinator.publish(
                    generation,
                    AudienceSelector::CurrentThread {
                        context,
                        thread_id: thread_id.clone(),
                    },
                    ProjectionChange::ThreadGoalChanged {
                        thread_id: thread_id.clone(),
                        revision: revision("thread-goal"),
                    },
                );
            }
            return;
        }
        if matches!(method, "thread/archived" | "thread/unarchived") {
            let Some(thread_id) = thread_id else {
                self.invalidate_ambiguous(generation);
                return;
            };
            match self.event_thread(&thread_id, generation).await {
                Ok(Some((audiences, mut thread))) => {
                    thread.summary.archived = method == "thread/archived";
                    self.publish_catalog(generation, audiences, &thread);
                    if superseded_live_refresh {
                        self.schedule_live_turn_refresh(thread_id, generation, false);
                    }
                }
                Ok(None) => {}
                Err(_) => self.invalidate_ambiguous(generation),
            }
            return;
        }
        let changes_resources = event_changes_resources(method, &event);
        if changes_resources && !is_turn_or_item_method(method) {
            let Some(thread_id) = thread_id else {
                self.invalidate_ambiguous(generation);
                return;
            };
            match self.event_thread(&thread_id, generation).await {
                Ok(Some((audiences, thread))) => {
                    for context in &audiences {
                        self.publish_resources_changed(generation, context, &thread_id);
                    }
                    self.publish_catalog(generation, audiences, &thread);
                    if superseded_live_refresh {
                        self.schedule_live_turn_refresh(thread_id, generation, false);
                    }
                }
                Ok(None) => {}
                Err(_) => self.invalidate_ambiguous(generation),
            }
            return;
        }
        if method.starts_with("account/") || method.starts_with("companion/accountPool/") {
            self.publish_accounts_changed(generation);
            return;
        }
        let Some(thread_id) = thread_id else {
            if method.starts_with("thread/")
                || method.starts_with("turn/")
                || method.starts_with("item/")
            {
                self.invalidate_ambiguous(generation);
            }
            return;
        };
        if is_turn_or_item_method(method) {
            self.schedule_live_turn_refresh(thread_id, generation, changes_resources);
            return;
        }
        let (audiences, thread) = match self.event_thread(&thread_id, generation).await {
            Ok(Some(routed)) => routed,
            Ok(None) => return,
            Err(_) => {
                self.invalidate_ambiguous(generation);
                return;
            }
        };
        self.publish_catalog(generation, audiences, &thread);
        if superseded_live_refresh {
            self.schedule_live_turn_refresh(thread_id, generation, false);
        }
    }

    fn schedule_live_turn_refresh(
        self: &Arc<Self>,
        thread_id: Id,
        generation: u64,
        resources_changed: bool,
    ) {
        let admission = self
            .live_turn_refreshes
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .admit(&thread_id, generation, resources_changed);
        match admission {
            LiveTurnRefreshAdmission::Coalesced => {}
            LiveTurnRefreshAdmission::Saturated => self.invalidate_ambiguous(generation),
            LiveTurnRefreshAdmission::Spawn { token } => {
                let source = self.clone();
                tokio::spawn(async move {
                    source
                        .run_live_turn_refresh(thread_id, generation, token)
                        .await;
                });
            }
        }
    }

    async fn run_live_turn_refresh(self: Arc<Self>, thread_id: Id, generation: u64, token: u64) {
        loop {
            let Ok(_permit) = self.live_turn_refresh_slots.clone().acquire_owned().await else {
                self.abort_live_turn_refresh(&thread_id, generation, token);
                return;
            };
            let resources_changed = self
                .live_turn_refreshes
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner)
                .begin(&thread_id, generation, token);
            let Some(resources_changed) = resources_changed else {
                return;
            };
            match self
                .refresh_live_turn(&thread_id, generation, token, resources_changed)
                .await
            {
                Ok(true) => {}
                Ok(false) => return,
                Err(_error) => {
                    self.abort_live_turn_refresh(&thread_id, generation, token);
                    if self.generation() == generation {
                        self.invalidate_ambiguous(generation);
                    }
                    return;
                }
            }
            let completion = self
                .live_turn_refreshes
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner)
                .complete(&thread_id, generation, token);
            if completion == LiveTurnRefreshCompletion::Complete {
                return;
            }
        }
    }

    async fn refresh_live_turn(
        &self,
        thread_id: &Id,
        generation: u64,
        token: u64,
        resources_changed: bool,
    ) -> Result<bool, V2Error> {
        let contexts = self.coordinator.contexts(generation);
        if contexts.is_empty() {
            return Ok(true);
        }
        let (thread, mut turns) = tokio::try_join!(
            self.read_thread_record(thread_id),
            self.latest_turn(thread_id, 1, HistoryDetail::Full),
        )?;
        let turn = turns
            .pop()
            .ok_or_else(|| V2Error::source_unavailable("source turn is unavailable"))?;
        ensure_generation(self, generation)?;
        // Token validation and the complete projection publication are one
        // critical section so a later delete cannot revoke the refresh between
        // its final check and a stale TurnUpserted/catalog write.
        let refreshes = self
            .live_turn_refreshes
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        let audiences = contexts.into_iter().collect::<Vec<_>>();
        let published = refreshes.publish_if_active(thread_id, generation, token, || {
            for context in &audiences {
                self.record_thread_access(context, thread_id, generation);
                self.coordinator.publish(
                    generation,
                    AudienceSelector::CurrentThread {
                        context: context.clone(),
                        thread_id: thread_id.clone(),
                    },
                    ProjectionChange::TurnUpserted { turn: turn.clone() },
                );
                if resources_changed {
                    self.publish_resources_changed(generation, context, thread_id);
                }
            }
            self.publish_catalog(generation, audiences, &thread);
        });
        Ok(published)
    }

    fn abort_live_turn_refresh(&self, thread_id: &Id, generation: u64, token: u64) {
        self.live_turn_refreshes
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .abort(thread_id, generation, token);
    }

    fn abort_current_live_turn_refresh(&self, thread_id: &Id, generation: u64) -> bool {
        self.live_turn_refreshes
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .abort_current(thread_id, generation)
    }

    fn publish_resources_changed(
        &self,
        generation: u64,
        context: &AuthenticatedContextKey,
        thread_id: &Id,
    ) {
        self.coordinator.publish(
            generation,
            AudienceSelector::CurrentThread {
                context: context.clone(),
                thread_id: thread_id.clone(),
            },
            ProjectionChange::ResourcesChanged {
                thread_id: thread_id.clone(),
                revision: revision("resources"),
            },
        );
    }

    async fn publish_item_lifecycle(
        &self,
        event: &Value,
        method: &str,
        generation: u64,
    ) -> Result<(), V2Error> {
        let thread_id = source_event_id(event, "/params/threadId", "lifecycle thread")?;
        let turn_id = source_event_id(event, "/params/turnId", "lifecycle turn")?;
        let source_item = event
            .pointer("/params/item")
            .ok_or_else(|| V2Error::source_unavailable("lifecycle event omitted item"))?;
        let phase = if method == "item/started" {
            LifecyclePhase::Started
        } else {
            LifecyclePhase::Completed
        };
        let item = normalize::item(source_item)?;
        let mut pre_turn = self.lifecycle_pre_turn(&thread_id, &turn_id, &item);
        if pre_turn.is_none() {
            let turns = self.latest_turn(&thread_id, 1, HistoryDetail::Full).await?;
            if turns.iter().all(|turn| turn.id != turn_id) {
                return Err(V2Error::source_unavailable("lifecycle turn is unavailable"));
            }
            pre_turn = self.lifecycle_pre_turn(&thread_id, &turn_id, &item);
        }
        let pre_turn = pre_turn
            .ok_or_else(|| V2Error::source_unavailable("lifecycle witness is unavailable"))?;
        let lifecycle = normalize::item_lifecycle(item, phase, pre_turn);
        for context in self.coordinator.contexts(generation) {
            self.coordinator.publish(
                generation,
                AudienceSelector::CurrentThread {
                    context,
                    thread_id: thread_id.clone(),
                },
                ProjectionChange::ItemLifecycleChanged {
                    thread_id: thread_id.clone(),
                    turn_id: turn_id.clone(),
                    lifecycle: lifecycle.clone(),
                },
            );
        }
        Ok(())
    }

    async fn normalize_pending_event(&self, event: &Value, generation: u64) {
        let Ok(request) = pending_request(event, generation) else {
            self.invalidate_ambiguous(generation);
            return;
        };
        let id = pending_id(&request).as_str().to_owned();
        let thread_id = pending_thread_id(&request).cloned();
        if let Some(thread_id) = &thread_id {
            if self.read_thread_record(thread_id).await.is_err() {
                self.invalidate_ambiguous(generation);
                return;
            }
            if ensure_generation(self, generation).is_err() {
                return;
            }
        }
        let audiences = self
            .coordinator
            .pending_contexts(generation, thread_id.as_ref());
        for context in &audiences {
            if let Some(thread_id) = &thread_id {
                self.record_thread_access(context, thread_id, generation);
            }
        }
        let mut pending = self.pending.write().await;
        if pending.len() >= MAX_PENDING_REQUESTS && !pending.contains_key(&id) {
            drop(pending);
            self.invalidate_ambiguous(generation);
            return;
        }
        pending.insert(
            id,
            OwnedPendingRequest {
                delivered_to: audiences.clone(),
                request: request.clone(),
                resolution_indeterminate: false,
            },
        );
        drop(pending);
        for context in audiences {
            self.coordinator.publish(
                generation,
                AudienceSelector::PendingRequests {
                    context,
                    thread_id: thread_id.clone(),
                },
                ProjectionChange::PendingRequestOpened {
                    request: request.clone(),
                },
            );
        }
    }

    async fn close_resolved_pending(&self, event: &Value, generation: u64) {
        let Some(raw_id) = event.pointer("/params/requestId") else {
            self.invalidate_ambiguous(generation);
            return;
        };
        let Ok(request_id) = Id::new(raw_id.to_string().trim_matches('"').to_owned()) else {
            self.invalidate_ambiguous(generation);
            return;
        };
        let Some(owned) = self.pending.write().await.remove(request_id.as_str()) else {
            return;
        };
        for context in owned.delivered_to {
            self.coordinator.publish(
                generation,
                AudienceSelector::ExactContext(context),
                ProjectionChange::PendingRequestClosed {
                    request_id: request_id.clone(),
                    generation: U64::new(generation),
                    reason: PendingCloseReason::Resolved,
                },
            );
        }
    }

    async fn event_thread(
        &self,
        thread_id: &Id,
        generation: u64,
    ) -> Result<Option<(Vec<AuthenticatedContextKey>, ReadThread)>, V2Error> {
        let contexts = self.coordinator.contexts(generation);
        if contexts.is_empty() {
            return Ok(None);
        }
        let thread = self.read_thread_record(thread_id).await?;
        for context in &contexts {
            self.record_thread_access(context, thread_id, generation);
        }
        Ok(Some((contexts.into_iter().collect(), thread)))
    }

    fn publish_catalog(
        &self,
        generation: u64,
        audiences: Vec<AuthenticatedContextKey>,
        thread: &ReadThread,
    ) {
        if let Some(parent_thread_id) = thread.summary.parent_id.as_ref() {
            self.publish_agents_changed(generation, Some(parent_thread_id));
            return;
        }
        if !thread.visible_in_catalog {
            return;
        }
        for context in audiences {
            let mut contextual_thread = thread.summary.clone();
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

    fn invalidate_ambiguous(&self, generation: u64) {
        let reason = if self.upstream.status() == ConnectionStatus::Live {
            SourceInvalidationReason::SourceGap
        } else {
            SourceInvalidationReason::UpstreamUnavailable
        };
        self.coordinator
            .invalidate_generation_for(generation, reason);
    }

    fn publish_agents_changed(&self, generation: u64, thread_id: Option<&Id>) {
        let contexts = thread_id.map_or_else(
            || self.coordinator.contexts(generation).into_iter().collect(),
            |parent_thread_id| self.authorized_contexts(parent_thread_id, generation),
        );
        for context in contexts {
            self.coordinator.publish(
                generation,
                AudienceSelector::ExactContext(context),
                ProjectionChange::AgentsChanged {
                    thread_id: thread_id.cloned(),
                    revision: revision("agents"),
                },
            );
        }
    }
}

fn event_announces_agent(method: &str, event: &Value) -> bool {
    matches!(method, "item/started" | "item/completed")
        && event.pointer("/params/item/type").and_then(Value::as_str) == Some("subAgentActivity")
}

#[cfg(test)]
mod queue_tests {
    use std::time::Duration;

    use super::*;
    use crate::{
        store::{OutboxClaimOutcome, OutboxClaimResolution, OutboxPresentation, OutboxState},
        sync_v2::{
            domain::SnapshotLimits,
            protocol::{CatalogIntent, OpenIntent},
            source::{CoordinatorEvent, CoordinatorReceiver, CoordinatorRecvError},
        },
    };

    fn authorization(device_id: &str) -> AuthorizationContext {
        AuthorizationContext::Session {
            device_id: device_id.into(),
            expires_at: u64::MAX,
        }
    }

    fn context(device_id: &str) -> AuthenticatedContextKey {
        AuthenticatedContextKey::derive(&authorization(device_id))
            .unwrap_or_else(|error| panic!("test context failed: {error:?}"))
    }

    fn test_id(value: &str) -> Id {
        Id::new(value).unwrap_or_else(|error| panic!("test id failed: {error}"))
    }

    fn intent() -> OpenIntent {
        OpenIntent {
            catalog: CatalogIntent {
                active_limit: 0,
                archived_limit: 0,
            },
            current_thread: None,
            pending_requests: PendingRequestScope::CurrentThread,
        }
    }

    async fn receive_queue_change(receiver: &CoordinatorReceiver) {
        let notification = tokio::time::timeout(Duration::from_secs(1), receiver.recv())
            .await
            .unwrap_or_else(|error| panic!("queue notification timed out: {error}"))
            .unwrap_or_else(|error| panic!("queue notification failed: {error:?}"));
        let (event, _reservation) = notification.into_parts();
        let CoordinatorEvent::Change { change, .. } = event else {
            panic!("queue notification was not a projection change");
        };
        assert!(matches!(change, ProjectionChange::QueueChanged { .. }));
    }

    #[tokio::test]
    async fn account_notifications_reach_only_contexts_that_authorized_account_reads() {
        let directory =
            tempfile::tempdir().unwrap_or_else(|error| panic!("temp directory failed: {error}"));
        let store = Arc::new(
            IndexStore::open(directory.path().join("state.redb"))
                .unwrap_or_else(|error| panic!("store open failed: {error}")),
        );
        let catalog = Arc::new(SessionCatalog::scan(directory.path()));
        let source = UpstreamSemanticSource::new(
            UpstreamHandle::spawn(directory.path().join("absent-app-server.sock")),
            store.clone(),
            HistoryService::new(catalog.clone(), store),
            catalog,
            ProductionServices::default(),
        );
        let generation = source.generation();
        let allowed_context = context("account-reader");
        let blocked_context = context("thread-only");
        let allowed = source.coordinator.register(
            test_id("account-recipient"),
            generation,
            allowed_context.clone(),
            intent(),
            SnapshotLimits::default(),
        );
        let blocked = source.coordinator.register(
            test_id("thread-recipient"),
            generation,
            blocked_context,
            intent(),
            SnapshotLimits::default(),
        );

        source.record_account_access(&allowed_context, generation);
        source.publish_accounts_changed(generation);

        let received = tokio::time::timeout(Duration::from_secs(1), allowed.recv())
            .await
            .unwrap_or_else(|error| panic!("account notification timed out: {error}"))
            .unwrap_or_else(|error| panic!("account notification failed: {error:?}"));
        let (event, _reservation) = received.into_parts();
        assert!(matches!(
            event,
            CoordinatorEvent::Change {
                change: ProjectionChange::AccountsChanged { .. },
                ..
            }
        ));
        assert!(
            tokio::time::timeout(Duration::from_millis(50), blocked.recv())
                .await
                .is_err(),
            "thread-only context received an account notification"
        );
    }

    #[tokio::test]
    async fn dispatcher_transitions_reach_every_owner_connection_only() {
        let directory =
            tempfile::tempdir().unwrap_or_else(|error| panic!("temp directory failed: {error}"));
        let store = Arc::new(
            IndexStore::open(directory.path().join("state.redb"))
                .unwrap_or_else(|error| panic!("store open failed: {error}")),
        );
        let catalog = Arc::new(SessionCatalog::scan(directory.path()));
        let source = UpstreamSemanticSource::new(
            UpstreamHandle::spawn(directory.path().join("absent-app-server.sock")),
            store.clone(),
            HistoryService::new(catalog.clone(), store.clone()),
            catalog,
            ProductionServices::default(),
        );
        let generation = source.generation();
        let owner_a = context("device-a");
        let first = source.coordinator.register(
            test_id("recipient-a-1"),
            generation,
            owner_a.clone(),
            intent(),
            SnapshotLimits::default(),
        );
        let second = source.coordinator.register(
            test_id("recipient-a-2"),
            generation,
            owner_a.clone(),
            intent(),
            SnapshotLimits::default(),
        );
        let other = source.coordinator.register(
            test_id("recipient-b"),
            generation,
            context("device-b"),
            intent(),
            SnapshotLimits::default(),
        );

        store
            .outbox_put_turn_start_for_owner(
                "delivered",
                "thread-1",
                json!({
                    "threadId": "thread-1",
                    "clientUserMessageId": "delivered",
                    "input": [{"type": "text", "text": "hello"}]
                }),
                None,
                OutboxPresentation::Queue,
                owner_a.as_str(),
            )
            .unwrap_or_else(|error| panic!("queue put failed: {error}"));
        receive_queue_change(&first).await;
        receive_queue_change(&second).await;
        assert!(matches!(other.try_recv(), Err(CoordinatorRecvError::Empty)));

        let OutboxClaimOutcome::Acquired { token, .. } = store
            .outbox_claim_dispatch("delivered")
            .unwrap_or_else(|error| panic!("claim failed: {error}"))
        else {
            panic!("dispatch claim was not acquired");
        };
        receive_queue_change(&first).await;
        receive_queue_change(&second).await;
        store
            .outbox_resolve_claim("delivered", token, OutboxClaimResolution::Delivered)
            .unwrap_or_else(|error| panic!("resolution failed: {error}"));
        receive_queue_change(&first).await;
        receive_queue_change(&second).await;

        store
            .outbox_put_turn_start_for_owner(
                "failed",
                "thread-1",
                json!({
                    "threadId": "thread-1",
                    "clientUserMessageId": "failed",
                    "input": [{"type": "text", "text": "hello"}]
                }),
                None,
                OutboxPresentation::Queue,
                owner_a.as_str(),
            )
            .unwrap_or_else(|error| panic!("queue put failed: {error}"));
        receive_queue_change(&first).await;
        receive_queue_change(&second).await;
        store
            .outbox_set_state("failed", OutboxState::Failed, Some("rejected"))
            .unwrap_or_else(|error| panic!("failure update failed: {error}"));
        receive_queue_change(&first).await;
        receive_queue_change(&second).await;
        assert!(matches!(other.try_recv(), Err(CoordinatorRecvError::Empty)));
    }
}

fn source_event_id(event: &Value, pointer: &str, label: &str) -> Result<Id, V2Error> {
    Id::new(
        event
            .pointer(pointer)
            .and_then(Value::as_str)
            .ok_or_else(|| V2Error::source_unavailable(format!("{label} id is missing")))?
            .to_owned(),
    )
    .map_err(|_| V2Error::source_unavailable(format!("{label} id is invalid")))
}

fn cache_thread_settings_event(
    settings: &Mutex<BoundedMap<Id, super::super::domain::ThreadSettings>>,
    event: &Value,
) -> Result<(Id, super::super::domain::ThreadSettings), V2Error> {
    let thread_id = match source_event_id(event, "/params/threadId", "thread settings") {
        Ok(thread_id) => thread_id,
        Err(error) => {
            settings
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner)
                .clear();
            return Err(error);
        }
    };
    let normalized = event
        .pointer("/params/threadSettings")
        .ok_or_else(|| V2Error::source_unavailable("thread settings event omitted settings"))
        .and_then(normalize::thread_settings);
    let mut cache = settings
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
    let normalized = match normalized {
        Ok(normalized) => normalized,
        Err(error) => {
            cache.retain(|candidate, _| candidate != &thread_id);
            return Err(error);
        }
    };
    let _ = cache.insert(thread_id.clone(), normalized.clone());
    Ok((thread_id, normalized))
}

fn is_turn_or_item_method(method: &str) -> bool {
    method.starts_with("turn/") || method.starts_with("item/")
}

fn event_supersedes_live_turn(method: &str) -> bool {
    !is_turn_or_item_method(method)
        && !method.starts_with("account/")
        && !method.starts_with("companion/accountPool/")
}

fn event_changes_resources(method: &str, event: &Value) -> bool {
    if method.contains("resource") || method.contains("fileChange") {
        return true;
    }
    match method {
        "item/started" | "item/completed" => event
            .pointer("/params/item/type")
            .and_then(Value::as_str)
            .is_some_and(resource_item_type),
        "turn/started" | "turn/completed" => event
            .pointer("/params/turn/items")
            .and_then(Value::as_array)
            .is_some_and(|items| {
                items.iter().any(|item| {
                    item.get("type")
                        .and_then(Value::as_str)
                        .is_some_and(resource_item_type)
                })
            }),
        _ => false,
    }
}

fn resource_item_type(item_type: &str) -> bool {
    matches!(
        item_type,
        "agentMessage" | "fileChange" | "imageGeneration" | "imageView" | "userMessage"
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::sync_v2::domain::{
        ApprovalPolicy, Effort, GranularApprovalConfig, Personality, Sandbox, ThreadSettings,
    };

    #[test]
    fn authoritative_settings_event_replaces_resumed_settings_cache() -> Result<(), V2Error> {
        let thread_id = Id::from_generated("thread-1".to_owned());
        let settings = Mutex::new(BoundedMap::new(2));
        let _ = settings
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .insert(
                thread_id.clone(),
                ThreadSettings {
                    model: Some("old-model".to_owned()),
                    effort: Some(Effort::Low),
                    approval_policy: ApprovalPolicy::Never,
                    sandbox: Sandbox::ReadOnly,
                    personality: None,
                },
            );

        let event = json!({
            "method": "thread/settings/updated",
            "params": {
                "threadId": "thread-1",
                "threadSettings": {
                    "cwd": "/workspace",
                    "model": "new-model",
                    "modelProvider": "openai",
                    "serviceTier": null,
                    "effort": "ultra",
                    "summary": "auto",
                    "approvalPolicy": {
                        "granular": {
                            "sandbox_approval": true,
                            "rules": false,
                            "skill_approval": true,
                            "request_permissions": false,
                            "mcp_elicitations": true
                        }
                    },
                    "approvalsReviewer": "user",
                    "sandboxPolicy": {
                        "type": "workspaceWrite",
                        "writableRoots": [],
                        "networkAccess": false,
                        "excludeTmpdirEnvVar": false,
                        "excludeSlashTmp": false
                    },
                    "activePermissionProfile": null,
                    "collaborationMode": {"mode": "default", "settings": {}},
                    "multiAgentMode": "explicitRequestOnly",
                    "personality": "pragmatic"
                }
            }
        });

        assert_eq!(cache_thread_settings_event(&settings, &event)?.0, thread_id);
        assert_eq!(
            settings
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner)
                .get(&thread_id)
                .cloned(),
            Some(ThreadSettings {
                model: Some("new-model".to_owned()),
                effort: Some(Effort::Ultra),
                approval_policy: ApprovalPolicy::Granular(GranularApprovalConfig {
                    sandbox_approval: true,
                    rules: false,
                    skill_approval: true,
                    request_permissions: false,
                    mcp_elicitations: true,
                }),
                sandbox: Sandbox::WorkspaceWrite,
                personality: Some(Personality::Pragmatic),
            })
        );
        Ok(())
    }

    #[test]
    fn malformed_settings_event_is_rejected_instead_of_leaving_stale_cache() {
        let settings = Mutex::new(BoundedMap::new(2));
        let thread_id = Id::from_generated("thread-1".to_owned());
        let _ = settings
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .insert(
                thread_id.clone(),
                ThreadSettings {
                    model: Some("stale-model".to_owned()),
                    effort: None,
                    approval_policy: ApprovalPolicy::Never,
                    sandbox: Sandbox::ReadOnly,
                    personality: None,
                },
            );
        let result = cache_thread_settings_event(
            &settings,
            &json!({
                "method": "thread/settings/updated",
                "params": {"threadId": "thread-1", "threadSettings": {"model": "model"}}
            }),
        );

        assert!(result.is_err());
        assert!(
            settings
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner)
                .get(&thread_id)
                .is_none()
        );
    }

    #[test]
    fn account_pool_event_filter_accepts_only_account_pool_notifications() {
        assert!(is_account_pool_event(&json!({
            "method": "companion/accountPool/changed"
        })));
        assert!(!is_account_pool_event(&json!({
            "method": "thread/updated"
        })));
        assert!(!is_account_pool_event(&json!({})));
    }

    #[test]
    fn resource_events_include_materialized_item_variants() {
        for item_type in [
            "agentMessage",
            "fileChange",
            "imageGeneration",
            "imageView",
            "userMessage",
        ] {
            let event = json!({
                "method": "item/completed",
                "params": {
                    "threadId": "thread-1",
                    "turnId": "turn-1",
                    "item": {"id": "item-1", "type": item_type}
                }
            });
            assert!(event_changes_resources("item/completed", &event));
        }
        let user_attachment = json!({
            "method": "item/started",
            "params": {
                "threadId": "thread-1",
                "turnId": "turn-1",
                "item": {
                    "id": "item-1",
                    "type": "userMessage",
                    "content": [
                        {"type": "localImage", "path": "/tmp/image.png"},
                        {"type": "mention", "path": "/tmp/file.txt"}
                    ]
                }
            }
        });
        assert!(event_changes_resources("item/started", &user_attachment));
    }

    #[test]
    fn resource_events_ignore_unrelated_item_variants() {
        for item_type in ["commandExecution", "mcpToolCall", "reasoning", "plan"] {
            let event = json!({
                "method": "item/completed",
                "params": {"item": {"type": item_type}}
            });
            assert!(!event_changes_resources("item/completed", &event));
        }
        assert!(!event_changes_resources(
            "item/agentMessage/delta",
            &json!({"params": {}})
        ));
    }

    #[test]
    fn subagent_activity_invalidates_the_parent_agent_relation() {
        let event = json!({
            "method": "item/completed",
            "params": {
                "threadId": "parent-thread",
                "item": {"type": "subAgentActivity"}
            }
        });
        assert!(event_announces_agent("item/completed", &event));
        assert!(!event_announces_agent(
            "item/completed",
            &json!({"params": {}})
        ));
        assert!(!event_announces_agent("item/agentMessage/delta", &event));
    }

    #[test]
    fn file_change_and_turn_payloads_invalidate_resources() {
        assert!(event_changes_resources(
            "item/fileChange/patchUpdated",
            &json!({"params": {}})
        ));
        assert!(event_changes_resources(
            "turn/completed",
            &json!({
                "params": {
                    "threadId": "thread-1",
                    "turn": {
                        "id": "turn-1",
                        "items": [{"id": "item-1", "type": "imageView", "path": "/tmp/image.png"}]
                    }
                }
            })
        ));
    }

    #[test]
    fn later_thread_events_supersede_detached_turn_refreshes() {
        for method in [
            "thread/name/updated",
            "thread/archived",
            "thread/unarchived",
            "thread/deleted",
        ] {
            assert!(event_supersedes_live_turn(method));
        }
        assert!(!event_supersedes_live_turn("turn/completed"));
        assert!(!event_supersedes_live_turn("item/agentMessage/delta"));
        assert!(!event_supersedes_live_turn("account/rateLimits/updated"));
    }
}
