#![allow(clippy::wildcard_imports)]

use super::*;

impl UpstreamSemanticSource {
    pub(super) fn spawn_event_normalizer(self: &Arc<Self>) {
        let source = self.clone();
        tokio::spawn(async move {
            let mut events = source.upstream.subscribe_events();
            loop {
                let event = match events.recv().await {
                    Ok(event) => event,
                    Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => {
                        source.pending.write().await.clear();
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
            match pending_request(&event, generation) {
                Ok(request) => {
                    let id = pending_id(&request).as_str().to_owned();
                    let Some(thread_id) = pending_thread_id(&request).cloned() else {
                        self.coordinator.publish(
                            generation,
                            AudienceSelector::Ambiguous,
                            ProjectionChange::AccountsChanged {
                                revision: "routing-invalid".into(),
                            },
                        );
                        return;
                    };
                    let audiences = self.authorized_contexts(&thread_id, generation);
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
                Err(_) => self.coordinator.publish(
                    generation,
                    AudienceSelector::Ambiguous,
                    ProjectionChange::AccountsChanged {
                        revision: "routing-invalid".into(),
                    },
                ),
            }
            return;
        }
        let thread_id = event
            .pointer("/params/threadId")
            .and_then(Value::as_str)
            .and_then(|value| Id::new(value.to_owned()).ok());
        if method == "thread/deleted" {
            if let Some(thread_id) = thread_id {
                let audiences = self.authorized_contexts(&thread_id, generation);
                for context in audiences {
                    self.coordinator.publish_thread_removed(
                        generation,
                        &context,
                        thread_id.clone(),
                        RemovalReason::Deleted,
                    );
                }
                self.remove_thread_witnesses(&thread_id);
            }
            return;
        }
        if matches!(method, "thread/archived" | "thread/unarchived") {
            let Some(thread_id) = thread_id else {
                return;
            };
            let audiences = self.authorized_contexts(&thread_id, generation);
            if audiences.is_empty() {
                return;
            }
            if let Ok(mut thread) = self.read_thread(&thread_id).await {
                thread.archived = method == "thread/archived";
                for context in audiences {
                    self.coordinator
                        .publish_catalog_upsert(generation, &context, thread.clone());
                }
            }
            return;
        }
        if method.contains("resource") || method.contains("fileChange") {
            if let Some(thread_id) = thread_id {
                for context in self.authorized_contexts(&thread_id, generation) {
                    self.coordinator.publish(
                        generation,
                        AudienceSelector::CurrentThread {
                            context,
                            thread_id: thread_id.clone(),
                        },
                        ProjectionChange::ResourcesChanged {
                            thread_id: thread_id.clone(),
                            revision: revision("resources"),
                        },
                    );
                }
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
            return;
        };
        let audiences = self.authorized_contexts(&thread_id, generation);
        if audiences.is_empty() {
            return;
        }
        if method.starts_with("turn/") || method.starts_with("item/") {
            if let Ok(turn) = self
                .latest_turn(&thread_id, 1, HistoryDetail::Full)
                .await
                .and_then(|mut turns| {
                    turns
                        .pop()
                        .ok_or_else(|| V2Error::source_unavailable("source turn is unavailable"))
                })
            {
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
            if let Ok(thread) = self.read_thread(&thread_id).await {
                for context in audiences {
                    self.coordinator
                        .publish_catalog_upsert(generation, &context, thread.clone());
                }
            }
            return;
        }
        if let Ok(thread) = self.read_thread(&thread_id).await {
            for context in audiences {
                self.coordinator
                    .publish_catalog_upsert(generation, &context, thread.clone());
            }
        }
    }

    fn invalidate_ambiguous(&self, generation: u64) {
        self.coordinator.publish(
            generation,
            AudienceSelector::Ambiguous,
            ProjectionChange::AccountsChanged {
                revision: "routing-invalid".into(),
            },
        );
    }
}
