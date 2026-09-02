//! Production implementation of the Sync V2 semantic source boundary.

// The implementation is split from its private adapter helpers solely to keep
// backend source files reviewable and below the role size limit.
#![allow(clippy::too_many_lines, clippy::wildcard_imports)]

use super::{helpers::*, *};

mod attachments;

#[async_trait]
impl SemanticSource for UpstreamSemanticSource {
    fn generation(&self) -> u64 {
        self.upstream.generation()
    }
    fn subscribe_generation(&self) -> watch::Receiver<u64> {
        self.generation.clone()
    }
    fn coordinator(&self) -> &SubscriptionCoordinator {
        &self.coordinator
    }

    fn is_available(&self) -> bool {
        self.upstream.status() == ConnectionStatus::Live
    }

    async fn wait_until_available(&self) -> Result<(), V2Error> {
        let mut status = self.upstream.subscribe_status();
        loop {
            if *status.borrow() == ConnectionStatus::Live {
                return Ok(());
            }
            status
                .changed()
                .await
                .map_err(|_| V2Error::source_unavailable("upstream availability channel closed"))?;
        }
    }

    async fn purge_context(&self, context: &AuthenticatedContextKey) -> Result<(), V2Error> {
        self.purge_context_state(context).await;
        Ok(())
    }

    async fn install_intent(
        &self,
        _recipient_id: &Id,
        intent: &OpenIntent,
        authorization: &AuthorizationContext,
        context: &AuthenticatedContextKey,
        generation: u64,
    ) -> Result<(), V2Error> {
        require_scope(authorization, "threads.read")?;
        ensure_generation(self, generation)?;
        if let Some(current) = &intent.current_thread {
            self.authorize_thread_access(authorization, context, &current.thread_id, generation)
                .await?;
            if self
                .coordinator
                .current_thread_recipient_count(&current.thread_id, generation)
                == 1
            {
                let resumed = self
                    .rpc(
                        "thread/resume",
                        json!({"threadId": current.thread_id.as_str(), "excludeTurns": true}),
                    )
                    .await?;
                if let Some(settings) = normalize::thread_summary_from_response(&resumed)?.settings
                {
                    let _ = self
                        .resumed_thread_settings
                        .lock()
                        .unwrap_or_else(std::sync::PoisonError::into_inner)
                        .insert(current.thread_id.clone(), settings);
                }
            }
        }
        Ok(())
    }

    async fn remove_intent(&self, recipient_id: &Id) {
        if let Some(intent) = self.coordinator.recipient_intent(recipient_id)
            && let Some(current) = intent.current_thread
            && self
                .coordinator
                .current_thread_recipient_count(&current.thread_id, self.generation())
                == 1
        {
            let _ = self
                .rpc(
                    "thread/unsubscribe",
                    json!({"threadId": current.thread_id.as_str()}),
                )
                .await;
        }
        self.coordinator.remove(recipient_id);
    }

    async fn watch_thread(
        &self,
        recipient_id: &Id,
        current: &CurrentThreadIntent,
        authorization: &AuthorizationContext,
        context: &AuthenticatedContextKey,
        generation: u64,
    ) -> Result<WatchedThreadData, V2Error> {
        require_scope(authorization, "threads.read")?;
        ensure_generation(self, generation)?;
        self.authorize_thread_access(authorization, context, &current.thread_id, generation)
            .await?;
        let previous = self
            .coordinator
            .recipient_intent(recipient_id)
            .ok_or_else(|| V2Error::source_unavailable("sync recipient is unavailable"))?
            .current_thread;
        let changed = previous.as_ref() != Some(current);
        if changed
            && self
                .coordinator
                .current_thread_recipient_count(&current.thread_id, generation)
                == 0
        {
            self.resume_thread(&current.thread_id).await?;
        }
        if changed {
            self.coordinator
                .set_current_thread(recipient_id, Some(current.clone()));
        }
        let watched = self
            .watched_thread_data(current, authorization, context, generation)
            .await;
        if watched.is_err() && changed {
            self.coordinator
                .set_current_thread(recipient_id, previous.clone());
            if self
                .coordinator
                .current_thread_recipient_count(&current.thread_id, generation)
                == 0
            {
                let _ = self
                    .rpc(
                        "thread/unsubscribe",
                        json!({"threadId": current.thread_id.as_str()}),
                    )
                    .await;
            }
        }
        let watched = watched?;
        if changed
            && let Some(previous) = previous
            && previous.thread_id != current.thread_id
            && self
                .coordinator
                .current_thread_recipient_count(&previous.thread_id, generation)
                == 0
        {
            let _ = self
                .rpc(
                    "thread/unsubscribe",
                    json!({"threadId": previous.thread_id.as_str()}),
                )
                .await;
        }
        Ok(watched)
    }

    async fn snapshot(
        &self,
        intent: &OpenIntent,
        authorization: &AuthorizationContext,
        context: &AuthenticatedContextKey,
        generation: u64,
    ) -> Result<SnapshotData, V2Error> {
        require_scope(authorization, "threads.read")?;
        ensure_generation(self, generation)?;
        let (active, _) = if intent.catalog.active_limit == 0 {
            (Vec::new(), None)
        } else {
            self.catalog_page(
                context,
                generation,
                CatalogPartition::Active,
                None,
                intent.catalog.active_limit,
            )
            .await?
        };
        let (archived, _) = if intent.catalog.archived_limit == 0 {
            (Vec::new(), None)
        } else {
            self.catalog_page(
                context,
                generation,
                CatalogPartition::Archived,
                None,
                intent.catalog.archived_limit,
            )
            .await?
        };
        let current_thread = if let Some(current) = &intent.current_thread {
            let mut thread = self
                .authorize_thread_access(authorization, context, &current.thread_id, generation)
                .await?;
            if active.iter().any(|candidate| candidate.id == thread.id) {
                thread.archived = false;
            } else if archived.iter().any(|candidate| candidate.id == thread.id) {
                thread.archived = true;
            }
            let page = self
                .history_page(
                    context,
                    current.thread_id.clone(),
                    None,
                    HistoryDirection::Older,
                    current.turn_limit,
                    HistoryDetail::Summary,
                )
                .await?;
            let QueryResult::HistoryPage {
                turns,
                older_cursor,
                newer_cursor,
                ..
            } = page
            else {
                return Err(V2Error::source_unavailable(
                    "history query returned the wrong result kind",
                ));
            };
            Some(ThreadWindow {
                thread,
                turns,
                older_cursor,
                newer_cursor,
            })
        } else {
            None
        };
        let mut pending = self.pending.write().await;
        let mut pending_requests = Vec::new();
        if let Some(current) = &intent.current_thread
            && self.has_thread_access(context, &current.thread_id, generation)
        {
            for owned in pending.values_mut() {
                if pending_thread_id(&owned.request) == Some(&current.thread_id) {
                    owned.delivered_to.insert(context.clone());
                    pending_requests.push(owned.request.clone());
                }
            }
        }
        drop(pending);
        if pending_requests.len() > 256 {
            return Err(V2Error::source_unavailable(
                "pending request limit exceeded",
            ));
        }
        let scope = CatalogScope {
            active: CatalogPartitionScope {
                limit: intent.catalog.active_limit,
                returned: u16::try_from(active.len()).unwrap_or(u16::MAX),
                complete: active.len() < intent.catalog.active_limit as usize,
            },
            archived: CatalogPartitionScope {
                limit: intent.catalog.archived_limit,
                returned: u16::try_from(archived.len()).unwrap_or(u16::MAX),
                complete: archived.len() < intent.catalog.archived_limit as usize,
            },
        };
        Ok(SnapshotData {
            scope,
            catalog: CatalogSnapshot { active, archived },
            current_thread,
            pending_requests,
            source_witness: format!("generation:{generation}:{}", Timestamp::now().as_str()),
        })
    }

    async fn query(
        &self,
        query: Query,
        authorization: &AuthorizationContext,
        context: &AuthenticatedContextKey,
        generation: u64,
    ) -> Result<QueryResult, V2Error> {
        require_scope(authorization, query_scope(&query))?;
        ensure_generation(self, generation)?;
        match query {
            Query::CapabilitiesRead => Ok(capabilities(
                crate::sync_v2::domain::SnapshotLimits::default(),
            )),
            Query::ModelsList => {
                let result = self.rpc("model/list", json!({})).await?;
                require_source_array_limit(&result, "models", 100)?;
                let models = normalize::models(&result);
                require_result_count(models.len(), 100)?;
                Ok(QueryResult::ModelsList { models })
            }
            Query::CatalogPage {
                partition,
                before,
                limit,
            } => {
                let (threads, next) = self
                    .catalog_page(context, generation, partition, before, limit)
                    .await?;
                Ok(QueryResult::CatalogPage { threads, next })
            }
            Query::HistoryPage {
                thread_id,
                cursor,
                direction,
                limit,
                detail,
            } => {
                self.authorize_thread_access(authorization, context, &thread_id, generation)
                    .await?;
                self.history_page(context, thread_id, cursor, direction, limit, detail)
                    .await
            }
            Query::TurnItems {
                thread_id,
                turn_id,
                cursor,
                limit,
            } => {
                self.authorize_thread_access(authorization, context, &thread_id, generation)
                    .await?;
                let result = self
                    .rpc(
                        "thread/items/list",
                        json!({
                            "threadId": thread_id.as_str(),
                            "turnId": turn_id.as_str(),
                            "cursor": cursor,
                            "limit": limit,
                            "sortDirection": "asc"
                        }),
                    )
                    .await?;
                let entries = result
                    .get("data")
                    .and_then(Value::as_array)
                    .ok_or_else(|| V2Error::source_unavailable("thread/items/list omitted data"))?;
                if entries.len() > limit as usize {
                    return Err(V2Error::source_unavailable(
                        "turn item source exceeded record limit",
                    ));
                }
                let items = entries
                    .iter()
                    .filter(|entry| {
                        entry.get("turnId").and_then(Value::as_str) == Some(turn_id.as_str())
                    })
                    .filter_map(|entry| entry.get("item").and_then(normalize::item))
                    .collect();
                Ok(QueryResult::TurnItems {
                    thread_id,
                    turn_id,
                    items,
                    next: result
                        .get("nextCursor")
                        .and_then(Value::as_str)
                        .map(ToOwned::to_owned),
                })
            }
            Query::ThreadResources { thread_id, scope } => {
                require_scope(authorization, "threads.read")?;
                self.authorize_thread_access(authorization, context, &thread_id, generation)
                    .await?;
                let resources = self.services.resources.as_ref().ok_or_else(|| {
                    V2Error::source_unavailable("resource service is unavailable")
                })?;
                let result = resources.handle("companion/threadResources/read", &json!({"threadId": thread_id.as_str(), "changeScope": resource_scope(scope)})).await.map_err(|error| V2Error::source_unavailable(error.to_string()))?;
                require_source_array_limit(&result, "changes", 100)?;
                require_source_array_limit(&result, "attachments", 100)?;
                let changes = normalize::resource_changes(&result);
                let attachments = normalize::attachments(&result);
                require_result_count(changes.len(), 100)?;
                require_result_count(attachments.len(), 100)?;
                Ok(QueryResult::ThreadResources {
                    thread_id,
                    revision: revision("resources"),
                    changes,
                    attachments,
                })
            }
            Query::ProjectsList => {
                let projects =
                    self.services.projects.as_ref().ok_or_else(|| {
                        V2Error::source_unavailable("project service is unavailable")
                    })?;
                let result = projects
                    .handle("companion/project/list", &json!({}))
                    .await
                    .map_err(|error| V2Error::source_unavailable(error.to_string()))?;
                require_source_array_limit(&result, "projects", 100)?;
                let projects = normalize::projects(&result);
                require_result_count(projects.len(), 100)?;
                Ok(QueryResult::ProjectsList { projects })
            }
            Query::WorkspaceInspect { path } => {
                let workspaces = self.services.workspaces.as_ref().ok_or_else(|| {
                    V2Error::source_unavailable("workspace service is unavailable")
                })?;
                let result = workspaces
                    .handle("companion/workspace/inspect", &json!({"workspace": path}))
                    .await
                    .map_err(|error| V2Error::source_unavailable(error.to_string()))?;
                Ok(QueryResult::WorkspaceInspect {
                    support: normalize::workspace_support(&result),
                })
            }
            Query::QueueList { thread_id } => {
                if let Some(thread_id) = &thread_id {
                    self.authorize_thread_access(authorization, context, thread_id, generation)
                        .await?;
                }
                let commands = self
                    .store
                    .outbox_list_bounded(
                        thread_id.as_ref().map(Id::as_str),
                        MAX_OUTBOX_SCAN,
                        MAX_OUTBOX_RESULTS,
                    )
                    .map_err(|error| V2Error::source_unavailable(error.to_string()))?;
                let mut items = normalize::queue_items(&json!({"items": commands}));
                items.retain(|item| self.has_thread_access(context, &item.thread_id, generation));
                if items.len() > 100 {
                    return Err(V2Error::source_unavailable(
                        "queue result exceeded record limit",
                    ));
                }
                Ok(QueryResult::QueueList { items })
            }
            Query::OperationGet { .. } => Err(V2Error::invalid_query()),
            Query::AccountsList => {
                let accounts =
                    self.services.accounts.as_ref().ok_or_else(|| {
                        V2Error::source_unavailable("account service is unavailable")
                    })?;
                let result = accounts
                    .handle("companion/accountPool/list", &json!({}))
                    .await
                    .map_err(|error| V2Error::source_unavailable(error.to_string()))?;
                require_source_array_limit(&result, "profiles", 100)?;
                let (active_profile_id, profiles, all_exhausted) = normalize::accounts(&result);
                require_result_count(profiles.len(), 100)?;
                Ok(QueryResult::AccountsList {
                    active_profile_id,
                    profiles,
                    all_exhausted,
                })
            }
        }
    }

    async fn authorize_command(
        &self,
        command: &Command,
        authorization: &AuthorizationContext,
        context: &AuthenticatedContextKey,
        generation: u64,
    ) -> Result<(), V2Error> {
        require_scope(authorization, command_scope(command))?;
        if command_has_attachment(command) {
            require_scope(authorization, "files.download.workspace")?;
            if matches!(
                command,
                Command::TurnSubmit {
                    thread_id: None,
                    ..
                }
            ) {
                return Err(V2Error::invalid_request(
                    "new-thread attachments need an existing semantic identity",
                ));
            }
        }
        ensure_generation(self, generation)?;
        if let Some(thread_id) = command_thread_id(command) {
            self.authorize_thread_access(authorization, context, thread_id, generation)
                .await?;
        }
        if let Command::QueueMutate { mutation } = command
            && let Some(item_id) = queue_mutation_item_id(mutation)
        {
            let item = self
                .store
                .outbox_list_bounded(None, MAX_OUTBOX_SCAN, MAX_OUTBOX_SCAN)
                .map_err(|error| V2Error::source_unavailable(error.to_string()))?
                .into_iter()
                .find(|item| item.command_id == item_id.as_str())
                .ok_or_else(|| V2Error {
                    code: ErrorCode::NotFound,
                    recovery: Recovery::Requery,
                    message: "queue item was not found".into(),
                })?;
            let thread_id = Id::new(item.remote_thread_id)
                .map_err(|_| V2Error::source_unavailable("queue item thread is invalid"))?;
            self.authorize_thread_access(authorization, context, &thread_id, generation)
                .await?;
        }
        Ok(())
    }

    async fn execute(
        &self,
        operation_id: &OperationId,
        command: Command,
        authorization: &AuthorizationContext,
        context: &AuthenticatedContextKey,
        generation: u64,
    ) -> CommandExecution {
        if let Err(error) = require_scope(authorization, command_scope(&command))
            .and_then(|()| ensure_generation(self, generation))
        {
            return CommandExecution::Failed(error);
        }
        match self.execute_inner(operation_id, command, context).await {
            Ok(result) => {
                if let Some(thread_id) = result_thread_id(&result) {
                    self.record_thread_access(context, thread_id, generation);
                }
                if let CommandResult::ThreadUpdate { thread } = &result {
                    self.publish_thread_to_authorized_contexts(generation, thread);
                }
                CommandExecution::Completed(result)
            }
            Err(error) if error.code == ErrorCode::SourceUnavailable => {
                CommandExecution::Indeterminate(V2Error::operation_indeterminate(error.message))
            }
            Err(error) => CommandExecution::Failed(error),
        }
    }

    async fn resolve(
        &self,
        action: Action,
        authorization: &AuthorizationContext,
        context: &AuthenticatedContextKey,
        generation: u64,
    ) -> Result<ActionResult, V2Error> {
        require_scope(authorization, "approvals.respond")?;
        ensure_generation(self, generation)?;
        let Action::RequestResolve {
            request_id,
            generation: request_generation,
            resolution,
        } = action;
        if request_generation.get() != generation {
            return Err(V2Error::generation_changed());
        }
        let mut pending = self.pending.write().await;
        let Some(owned) = pending.get(request_id.as_str()).cloned() else {
            return Ok(ActionResult::RequestResolve {
                request_id,
                state: ResolutionState::AlreadyResolved,
            });
        };
        let Some(thread_id) = pending_thread_id(&owned.request).cloned() else {
            return Err(V2Error::forbidden(
                "request has no authorized thread audience",
            ));
        };
        if !self.has_thread_access(context, &thread_id, generation) {
            return Err(V2Error::forbidden("request belongs to another context"));
        }
        let request = owned.request;
        if pending_generation(&request) != generation {
            return Err(V2Error::generation_changed());
        }
        let result = resolution_result(resolution);
        self.upstream
            .respond(json!({"id": request_id.as_str(), "result": result}))
            .await
            .map_err(|error| V2Error::source_unavailable(error.to_string()))?;
        let mut audiences = owned.delivered_to;
        audiences.extend(self.authorized_contexts(&thread_id, generation));
        pending.remove(request_id.as_str());
        drop(pending);
        for audience in audiences {
            self.coordinator.publish(
                generation,
                AudienceSelector::CurrentThread {
                    context: audience,
                    thread_id: thread_id.clone(),
                },
                ProjectionChange::PendingRequestClosed {
                    request_id: request_id.clone(),
                    generation: U64::new(generation),
                    reason: PendingCloseReason::Resolved,
                },
            );
        }
        Ok(ActionResult::RequestResolve {
            request_id,
            state: ResolutionState::Resolved,
        })
    }
}

fn require_result_count(actual: usize, limit: usize) -> Result<(), V2Error> {
    (actual <= limit)
        .then_some(())
        .ok_or_else(|| V2Error::source_unavailable("semantic result exceeded record limit"))
}

fn require_source_array_limit(result: &Value, field: &str, limit: usize) -> Result<(), V2Error> {
    if result
        .get(field)
        .and_then(Value::as_array)
        .is_some_and(|records| records.len() > limit)
    {
        return Err(V2Error::source_unavailable(
            "semantic source exceeded record limit",
        ));
    }
    Ok(())
}

impl UpstreamSemanticSource {
    async fn resume_thread(&self, thread_id: &Id) -> Result<(), V2Error> {
        let resumed = self
            .rpc(
                "thread/resume",
                json!({"threadId": thread_id.as_str(), "excludeTurns": true}),
            )
            .await?;
        if let Some(settings) = normalize::thread_summary_from_response(&resumed)?.settings {
            let _ = self
                .resumed_thread_settings
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner)
                .insert(thread_id.clone(), settings);
        }
        Ok(())
    }

    async fn watched_thread_data(
        &self,
        current: &CurrentThreadIntent,
        authorization: &AuthorizationContext,
        context: &AuthenticatedContextKey,
        generation: u64,
    ) -> Result<WatchedThreadData, V2Error> {
        let thread = self
            .authorize_thread_access(authorization, context, &current.thread_id, generation)
            .await?;
        let page = self
            .history_page(
                context,
                current.thread_id.clone(),
                None,
                HistoryDirection::Older,
                current.turn_limit,
                HistoryDetail::Summary,
            )
            .await?;
        let QueryResult::HistoryPage {
            turns,
            older_cursor,
            newer_cursor,
            ..
        } = page
        else {
            return Err(V2Error::source_unavailable(
                "history query returned the wrong result kind",
            ));
        };
        let mut pending = self.pending.write().await;
        let mut pending_requests = Vec::new();
        for owned in pending.values_mut() {
            if pending_thread_id(&owned.request) == Some(&current.thread_id) {
                owned.delivered_to.insert(context.clone());
                pending_requests.push(owned.request.clone());
            }
        }
        if pending_requests.len() > MAX_PENDING_REQUESTS {
            return Err(V2Error::source_unavailable(
                "pending request limit exceeded",
            ));
        }
        Ok(WatchedThreadData {
            current_thread: ThreadWindow {
                thread,
                turns,
                older_cursor,
                newer_cursor,
            },
            pending_requests,
        })
    }

    async fn execute_inner(
        &self,
        operation_id: &OperationId,
        command: Command,
        context: &AuthenticatedContextKey,
    ) -> Result<CommandResult, V2Error> {
        match command {
            Command::ThreadCreate {
                workspace,
                title,
                settings,
            } => {
                let result = self.rpc("thread/start", json!({"cwd": workspace, "model": settings.model, "reasoningEffort": effort_source(settings.effort), "approvalPolicy": approval_policy_source(settings.approval_policy), "sandbox": sandbox_source(settings.sandbox)})).await?;
                let mut thread = normalize::thread_summary_from_response(&result)?;
                thread.title = title;
                Ok(CommandResult::ThreadCreate { thread })
            }
            Command::ThreadFork {
                thread_id,
                through_turn_id,
            } => {
                let result = self.rpc("thread/fork", json!({"threadId": thread_id.as_str(), "turnId": through_turn_id.as_ref().map(Id::as_str)})).await?;
                Ok(CommandResult::ThreadFork {
                    thread: normalize::thread_summary_from_response(&result)?,
                })
            }
            Command::ThreadUpdate { thread_id, change } => {
                let updated_settings = match &change {
                    ThreadUpdate::Settings { settings } => Some(settings.clone()),
                    ThreadUpdate::Title { .. }
                    | ThreadUpdate::Archive { .. }
                    | ThreadUpdate::Goal { .. }
                    | ThreadUpdate::Section { .. } => None,
                };
                let (method, params) = thread_update_rpc(&thread_id, change);
                self.rpc(method, params).await?;
                if let Some(settings) = &updated_settings {
                    let _ = self
                        .resumed_thread_settings
                        .lock()
                        .unwrap_or_else(std::sync::PoisonError::into_inner)
                        .insert(thread_id.clone(), settings.clone());
                }
                let mut thread = self.read_thread(&thread_id).await?;
                if let Some(settings) = updated_settings {
                    thread.settings = Some(settings);
                }
                Ok(CommandResult::ThreadUpdate { thread })
            }
            Command::ThreadDelete { thread_id } => {
                self.rpc("thread/delete", json!({"threadId": thread_id.as_str()}))
                    .await?;
                Ok(CommandResult::ThreadDelete { thread_id })
            }
            Command::TurnSubmit {
                thread_id: Some(thread_id),
                input,
                intent,
                settings,
                ..
            } => {
                let input = self
                    .resolve_input_blocks(context, &thread_id, &input)
                    .await?;
                let result = self.rpc(if matches!(intent, crate::sync_v2::protocol::TurnIntent::Review) { "review/start" } else { "turn/start" }, json!({"threadId": thread_id.as_str(), "input": input, "model": settings.as_ref().and_then(|settings| settings.model.as_deref())})).await?;
                let turn_id = Id::new(
                    result
                        .pointer("/turn/id")
                        .or_else(|| result.get("turnId"))
                        .and_then(Value::as_str)
                        .ok_or_else(|| V2Error::source_unavailable("turn result omitted id"))?
                        .to_owned(),
                )
                .map_err(|_| V2Error::source_unavailable("turn result has invalid id"))?;
                Ok(CommandResult::TurnSubmit { thread_id, turn_id })
            }
            Command::TurnSubmit {
                thread_id: None,
                workspace,
                input,
                intent: _,
                settings,
            } => {
                let workspace = workspace.ok_or_else(|| {
                    V2Error::invalid_request("workspace is required for a new thread")
                })?;
                let created = self.rpc("thread/start", json!({"cwd": workspace, "model": settings.as_ref().and_then(|settings| settings.model.as_deref())})).await?;
                let thread = normalize::thread_summary_from_response(&created)?;
                let input = normalize::input_blocks(&input, &HashMap::new())?;
                let started = self
                    .rpc(
                        "turn/start",
                        json!({"threadId": thread.id.as_str(), "input": input}),
                    )
                    .await?;
                let turn_id = Id::new(
                    started
                        .pointer("/turn/id")
                        .and_then(Value::as_str)
                        .ok_or_else(|| V2Error::source_unavailable("turn result omitted id"))?
                        .to_owned(),
                )
                .map_err(|_| V2Error::source_unavailable("turn id is invalid"))?;
                Ok(CommandResult::TurnSubmit {
                    thread_id: thread.id,
                    turn_id,
                })
            }
            Command::TurnSteer {
                thread_id,
                turn_id,
                input,
            } => {
                let input = self
                    .resolve_input_blocks(context, &thread_id, &input)
                    .await?;
                let result = self.rpc("turn/steer", json!({"threadId": thread_id.as_str(), "turnId": turn_id.as_str(), "input": input})).await?;
                let item_id = Id::new(
                    result
                        .get("itemId")
                        .and_then(Value::as_str)
                        .unwrap_or(operation_id.as_str())
                        .to_owned(),
                )
                .map_err(|_| V2Error::source_unavailable("steer item id is invalid"))?;
                Ok(CommandResult::TurnSteer {
                    thread_id,
                    turn_id,
                    item_id,
                })
            }
            Command::TurnInterrupt { thread_id, turn_id } => {
                let result = self
                    .rpc(
                        "turn/interrupt",
                        json!({"threadId": thread_id.as_str(), "turnId": turn_id.as_str()}),
                    )
                    .await?;
                let state = if result
                    .get("alreadyTerminal")
                    .and_then(Value::as_bool)
                    .unwrap_or(false)
                {
                    InterruptState::AlreadyTerminal
                } else {
                    InterruptState::Interrupted
                };
                Ok(CommandResult::TurnInterrupt {
                    thread_id,
                    turn_id,
                    state,
                })
            }
            Command::ThreadCompact { thread_id } => {
                let result = self
                    .rpc(
                        "thread/compact/start",
                        json!({"threadId": thread_id.as_str()}),
                    )
                    .await?;
                let turn_id = Id::new(
                    result
                        .pointer("/turn/id")
                        .or_else(|| result.get("turnId"))
                        .and_then(Value::as_str)
                        .ok_or_else(|| {
                            V2Error::source_unavailable("compact result omitted turn id")
                        })?
                        .to_owned(),
                )
                .map_err(|_| V2Error::source_unavailable("compact turn id is invalid"))?;
                Ok(CommandResult::ThreadCompact { thread_id, turn_id })
            }
            Command::ThreadRollback {
                thread_id,
                through_turn_id,
                drop_following_turns,
            } => {
                self.rpc("thread/rollback", json!({"threadId": thread_id.as_str(), "turnId": through_turn_id.as_str(), "dropFollowingTurns": drop_following_turns})).await?;
                let thread = self.read_thread(&thread_id).await?;
                Ok(CommandResult::ThreadRollback {
                    head_turn_id: thread.head_turn_id.clone(),
                    thread,
                })
            }
            Command::ProjectAdd { path, name, pinned } => {
                let projects =
                    self.services.projects.as_ref().ok_or_else(|| {
                        V2Error::source_unavailable("project service is unavailable")
                    })?;
                let result = projects
                    .handle(
                        "companion/project/add",
                        &json!({"path": path, "name": name, "pinned": pinned}),
                    )
                    .await
                    .map_err(|error| V2Error::source_unavailable(error.to_string()))?;
                let project = normalize::projects(
                    &json!({"projects": [result.get("project").cloned().unwrap_or(result)]}),
                )
                .pop()
                .ok_or_else(|| V2Error::source_unavailable("project result is invalid"))?;
                Ok(CommandResult::ProjectAdd { project })
            }
            Command::WorkspaceCreate {
                provider,
                parent_path,
                name,
            } => {
                let workspaces = self.services.workspaces.as_ref().ok_or_else(|| {
                    V2Error::source_unavailable("workspace service is unavailable")
                })?;
                let path = std::path::Path::new(&parent_path).join(&name);
                let result = workspaces.handle("companion/workspace/create", &json!({"workspace": path, "provider": provider.as_str(), "requestId": operation_id.as_str()})).await.map_err(|error| V2Error::source_unavailable(error.to_string()))?;
                let workspace = result.get("workspace").ok_or_else(|| {
                    V2Error::source_unavailable("workspace result omitted workspace")
                })?;
                Ok(CommandResult::WorkspaceCreate {
                    path: workspace
                        .get("path")
                        .and_then(Value::as_str)
                        .unwrap_or_else(|| path.to_str().unwrap_or_default())
                        .to_owned(),
                    repository_root: workspace
                        .get("repositoryRoot")
                        .and_then(Value::as_str)
                        .unwrap_or_else(|| path.to_str().unwrap_or_default())
                        .to_owned(),
                })
            }
            Command::QueueMutate { mutation } => {
                self.queue_mutate(operation_id, mutation, context).await
            }
            Command::AccountUpdate { change } => self.account_update(change).await,
        }
    }

    async fn queue_mutate(
        &self,
        operation_id: &OperationId,
        mutation: QueueMutation,
        context: &AuthenticatedContextKey,
    ) -> Result<CommandResult, V2Error> {
        match mutation {
            QueueMutation::Put { thread_id, input } => {
                let input = self
                    .resolve_input_blocks(context, &thread_id, &input)
                    .await?;
                self.store
                    .outbox_put_turn_start_with_presentation(
                        operation_id.as_str(),
                        thread_id.as_str(),
                        json!({"threadId": thread_id.as_str(), "input": input}),
                        None,
                        OutboxPresentation::Queue,
                    )
                    .map_err(|error| V2Error::source_unavailable(error.to_string()))?;
            }
            QueueMutation::Edit { item_id, input } => {
                let thread_id = self
                    .store
                    .outbox_list_bounded(None, MAX_OUTBOX_SCAN, MAX_OUTBOX_SCAN)
                    .map_err(|error| V2Error::source_unavailable(error.to_string()))?
                    .into_iter()
                    .find(|item| item.command_id == item_id.as_str())
                    .and_then(|item| Id::new(item.remote_thread_id).ok())
                    .ok_or_else(|| V2Error::source_unavailable("queue item is unavailable"))?;
                let input = self
                    .resolve_input_blocks(context, &thread_id, &input)
                    .await?;
                self.store
                    .outbox_edit_prompt(item_id.as_str(), &Value::Array(input))
                    .map_err(|error| V2Error::invalid_request(error.to_string()))?;
            }
            QueueMutation::Cancel { item_id } => {
                self.store
                    .outbox_cancel(item_id.as_str())
                    .map_err(|error| V2Error::source_unavailable(error.to_string()))?;
            }
            QueueMutation::Move {
                item_id,
                before_item_id,
            } => {
                self.store
                    .outbox_place(item_id.as_str(), before_item_id.as_ref().map(Id::as_str))
                    .map_err(|error| V2Error::invalid_request(error.to_string()))?;
            }
            QueueMutation::Retry { item_id } => {
                self.store
                    .outbox_retry_failed(item_id.as_str())
                    .map_err(|error| V2Error::invalid_request(error.to_string()))?;
            }
        }
        let item = self
            .store
            .outbox_list_bounded(None, MAX_OUTBOX_SCAN, MAX_OUTBOX_SCAN)
            .map_err(|error| V2Error::source_unavailable(error.to_string()))?
            .into_iter()
            .find(|item| item.command_id == operation_id.as_str())
            .and_then(|item| normalize::queue_items(&json!({"items": [item]})).pop());
        Ok(CommandResult::QueueMutate { item })
    }

    async fn account_update(&self, change: AccountChange) -> Result<CommandResult, V2Error> {
        let accounts = self
            .services
            .accounts
            .as_ref()
            .ok_or_else(|| V2Error::source_unavailable("account service is unavailable"))?;
        let (method, params, affected) = match change {
            AccountChange::Activate { profile_id } => (
                "companion/accountPool/profile/activate",
                json!({"profileId": profile_id.as_str()}),
                profile_id,
            ),
            AccountChange::Configure {
                profile_id,
                enabled,
                priority,
            } => (
                "companion/accountPool/profile/update",
                json!({"profileId": profile_id.as_str(), "enabled": enabled, "priority": priority}),
                profile_id,
            ),
            AccountChange::Remove { profile_id } => (
                "companion/accountPool/profile/remove",
                json!({"profileId": profile_id.as_str()}),
                profile_id,
            ),
        };
        accounts
            .handle(method, &params)
            .await
            .map_err(|error| V2Error::source_unavailable(error.to_string()))?;
        let list = accounts
            .handle("companion/accountPool/list", &json!({}))
            .await
            .map_err(|error| V2Error::source_unavailable(error.to_string()))?;
        let (active_profile_id, _, _) = normalize::accounts(&list);
        Ok(CommandResult::AccountUpdate {
            active_profile_id,
            affected_profile_id: affected,
        })
    }
}
