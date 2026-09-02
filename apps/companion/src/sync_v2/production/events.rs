#![allow(clippy::wildcard_imports)]

use super::*;
use crate::sync_v2::domain::ThreadSummary;

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

    #[allow(clippy::too_many_lines)]
    async fn normalize_event(&self, event: Value) {
        let generation = self.generation();
        let method = event
            .get("method")
            .and_then(Value::as_str)
            .unwrap_or_default();
        if is_pending_method(method) {
            self.normalize_pending_event(&event, generation).await;
            return;
        }

        let thread_id = event
            .pointer("/params/threadId")
            .and_then(Value::as_str)
            .and_then(|value| Id::new(value.to_owned()).ok());
        if method == "thread/deleted" {
            let Some(thread_id) = thread_id else {
                self.invalidate_ambiguous(generation);
                return;
            };
            for context in self.coordinator.contexts(generation) {
                self.coordinator.publish_thread_removed(
                    generation,
                    &context,
                    thread_id.clone(),
                    RemovalReason::Deleted,
                );
            }
            self.remove_thread_witnesses(&thread_id);
            return;
        }
        if matches!(method, "thread/archived" | "thread/unarchived") {
            let Some(thread_id) = thread_id else {
                self.invalidate_ambiguous(generation);
                return;
            };
            match self.event_thread(&thread_id, generation).await {
                Ok(Some((audiences, mut thread))) => {
                    thread.archived = method == "thread/archived";
                    self.publish_catalog(generation, audiences, &thread);
                }
                Ok(None) => {}
                Err(_) => self.invalidate_ambiguous(generation),
            }
            return;
        }
        if method.contains("resource") || method.contains("fileChange") {
            let Some(thread_id) = thread_id else {
                self.invalidate_ambiguous(generation);
                return;
            };
            match self.event_thread(&thread_id, generation).await {
                Ok(Some((audiences, thread))) => {
                    for context in &audiences {
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
                    self.publish_catalog(generation, audiences, &thread);
                }
                Ok(None) => {}
                Err(_) => self.invalidate_ambiguous(generation),
            }
            return;
        }
        if method.starts_with("account/") || method.starts_with("companion/accountPool/") {
            for context in self.coordinator.contexts(generation) {
                self.coordinator.publish(
                    generation,
                    AudienceSelector::ExactContext(context),
                    ProjectionChange::AccountsChanged {
                        revision: revision("accounts"),
                    },
                );
            }
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
        let (audiences, thread) = match self.event_thread(&thread_id, generation).await {
            Ok(Some(routed)) => routed,
            Ok(None) => return,
            Err(_) => {
                self.invalidate_ambiguous(generation);
                return;
            }
        };
        if method.starts_with("turn/") || method.starts_with("item/") {
            let Ok(turn) = self
                .latest_turn(&thread_id, 1, HistoryDetail::Summary)
                .await
                .and_then(|mut turns| {
                    turns
                        .pop()
                        .ok_or_else(|| V2Error::source_unavailable("source turn is unavailable"))
                })
            else {
                self.invalidate_ambiguous(generation);
                return;
            };
            for context in &audiences {
                self.coordinator.publish(
                    generation,
                    AudienceSelector::CurrentThread {
                        context: context.clone(),
                        thread_id: thread_id.clone(),
                    },
                    ProjectionChange::TurnUpserted { turn: turn.clone() },
                );
            }
        }
        self.publish_catalog(generation, audiences, &thread);
    }

    async fn normalize_pending_event(&self, event: &Value, generation: u64) {
        let Ok(request) = pending_request(event, generation) else {
            self.invalidate_ambiguous(generation);
            return;
        };
        let id = pending_id(&request).as_str().to_owned();
        let Some(thread_id) = pending_thread_id(&request).cloned() else {
            self.invalidate_ambiguous(generation);
            return;
        };
        let audiences = match self.event_thread(&thread_id, generation).await {
            Ok(Some((audiences, _))) => audiences,
            Ok(None) => Vec::new(),
            Err(_) => {
                self.invalidate_ambiguous(generation);
                return;
            }
        };
        let mut pending = self.pending.write().await;
        if pending.len() >= MAX_PENDING_REQUESTS && !pending.contains_key(&id) {
            drop(pending);
            self.invalidate_ambiguous(generation);
            return;
        }
        pending.insert(
            id,
            OwnedPendingRequest {
                delivered_to: audiences.iter().cloned().collect(),
                request: request.clone(),
            },
        );
        drop(pending);
        for context in audiences {
            self.coordinator.publish(
                generation,
                AudienceSelector::CurrentThread {
                    context,
                    thread_id: thread_id.clone(),
                },
                ProjectionChange::PendingRequestOpened {
                    request: request.clone(),
                },
            );
        }
    }

    async fn event_thread(
        &self,
        thread_id: &Id,
        generation: u64,
    ) -> Result<Option<(Vec<AuthenticatedContextKey>, ThreadSummary)>, V2Error> {
        let contexts = self.coordinator.contexts(generation);
        if contexts.is_empty() {
            return Ok(None);
        }
        let thread = self.read_thread(thread_id).await?;
        for context in &contexts {
            self.record_thread_access(context, thread_id, generation);
        }
        Ok(Some((contexts.into_iter().collect(), thread)))
    }

    fn publish_catalog(
        &self,
        generation: u64,
        audiences: Vec<AuthenticatedContextKey>,
        thread: &ThreadSummary,
    ) {
        for context in audiences {
            self.coordinator
                .publish_catalog_upsert(generation, &context, thread.clone());
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
}
