//! Production implementation of the Sync V2 semantic source boundary.

// The implementation is split from its private adapter helpers solely to keep
// backend source files reviewable and below the role size limit.
#![allow(clippy::too_many_lines, clippy::wildcard_imports)]

use super::{capabilities::*, helpers::*, *};

mod accounts;
mod attachments;
mod background_processes;
mod catalog_search;
mod command_execution;
mod item_output;
mod queue;
mod thread_changes;
mod thread_resources;

use thread_changes::parse_thread_change_result;

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
        self.read_receipts
            .purge_context(context)
            .map_err(|error| V2Error::source_unavailable(error.to_string()))?;
        if let Some(attachments) = &self.services.attachments {
            attachments
                .purge_context(context)
                .await
                .map_err(|error| V2Error::source_unavailable(error.to_string()))?;
        }
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
        require_authenticated_session(authorization)?;
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
                self.remember_thread_freshness_from_response(&current.thread_id, &resumed);
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
        require_authenticated_session(authorization)?;
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
        require_authenticated_session(authorization)?;
        ensure_generation(self, generation)?;
        let (mut active, active_next) = if intent.catalog.active_limit == 0 {
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
        let (mut archived, archived_next) = if intent.catalog.archived_limit == 0 {
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
            self.attach_read_state(context, &mut thread)?;
            let current_window = ThreadWindow {
                thread,
                turns,
                older_cursor,
                newer_cursor,
            };
            for summary in active.iter_mut().chain(archived.iter_mut()) {
                if summary.id == current_window.thread.id {
                    summary.read_state = current_window.thread.read_state.clone();
                }
            }
            Some(current_window)
        } else {
            None
        };
        let pending_requests = self
            .snapshot_pending_requests(intent, authorization, context, generation)
            .await?;
        let scope = CatalogScope {
            active: CatalogPartitionScope {
                limit: intent.catalog.active_limit,
                returned: u16::try_from(active.len()).unwrap_or(u16::MAX),
                complete: active_next.is_none(),
            },
            archived: CatalogPartitionScope {
                limit: intent.catalog.archived_limit,
                returned: u16::try_from(archived.len()).unwrap_or(u16::MAX),
                complete: archived_next.is_none(),
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
        authorize_query(authorization, &query)?;
        ensure_generation(self, generation)?;
        match query {
            Query::CapabilitiesRead => {
                let accounts_available = self.services.accounts.is_some();
                Ok(capabilities(
                    crate::sync_v2::domain::SnapshotLimits::default(),
                    authorization,
                    accounts_available,
                ))
            }
            Query::ModelsList => {
                let result = self.rpc("model/list", json!({})).await?;
                require_source_array_limit(&result, "models", 100)?;
                let models = normalize::models(&result)?;
                require_result_count(models.len(), 100)?;
                Ok(QueryResult::ModelsList { models })
            }
            Query::SkillsList {
                workspace,
                force_reload,
            } => {
                let result = self
                    .rpc(
                        "skills/list",
                        json!({"cwds": [workspace.as_str()], "forceReload": force_reload}),
                    )
                    .await?;
                require_source_array_limit(&result, "data", 256)?;
                let entries = result
                    .get("data")
                    .and_then(Value::as_array)
                    .ok_or_else(|| V2Error::source_unavailable("skills/list omitted data"))?;
                let entry = entries
                    .iter()
                    .find(|entry| {
                        entry.get("cwd").and_then(Value::as_str) == Some(workspace.as_str())
                    })
                    .ok_or_else(|| {
                        V2Error::source_unavailable("skills/list omitted the requested workspace")
                    })?;
                let source_skills = entry
                    .get("skills")
                    .and_then(Value::as_array)
                    .ok_or_else(|| V2Error::source_unavailable("skills/list omitted skills"))?;
                require_result_count(source_skills.len(), 4_096)?;
                let skills = source_skills
                    .iter()
                    .map(parse_skill)
                    .collect::<Result<Vec<_>, _>>()?;
                Ok(QueryResult::SkillsList { workspace, skills })
            }
            Query::ThreadGoal { thread_id } => {
                self.authorize_thread_access(authorization, context, &thread_id, generation)
                    .await?;
                let result = self
                    .rpc("thread/goal/get", json!({"threadId": thread_id.as_str()}))
                    .await?;
                let goal = match result.get("goal") {
                    None | Some(Value::Null) => None,
                    Some(goal) => Some(normalize::thread_goal(goal)?),
                };
                Ok(QueryResult::ThreadGoal { thread_id, goal })
            }
            Query::ThreadAgents {
                thread_id,
                cursor,
                limit,
            } => {
                self.authorize_thread_access(authorization, context, &thread_id, generation)
                    .await?;
                let result = self
                    .rpc(
                        "thread/list",
                        crate::sync_v2::production::projection::thread_agents_params(
                            &thread_id,
                            cursor.as_deref(),
                            limit,
                        ),
                    )
                    .await?;
                let source_agents = result
                    .get("data")
                    .and_then(Value::as_array)
                    .ok_or_else(|| V2Error::source_unavailable("thread/list omitted data"))?;
                if source_agents.len() > limit as usize {
                    return Err(V2Error::source_unavailable(
                        "thread agents source exceeded record limit",
                    ));
                }
                let mut agents = source_agents
                    .iter()
                    .map(normalize::thread_summary)
                    .collect::<Result<Vec<_>, _>>()?;
                if agents
                    .iter()
                    .any(|agent| agent.parent_id.as_ref() != Some(&thread_id))
                {
                    return Err(V2Error::source_unavailable(
                        "thread/list returned an agent outside the requested parent",
                    ));
                }
                for agent in &mut agents {
                    self.attach_read_state(context, agent)?;
                    self.record_thread_access(context, &agent.id, generation);
                }
                ensure_generation(self, generation)?;
                let next = result
                    .get("nextCursor")
                    .and_then(Value::as_str)
                    .map(ToOwned::to_owned);
                Ok(QueryResult::ThreadAgents {
                    thread_id,
                    agents,
                    next,
                })
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
            Query::CatalogSearch {
                partition,
                text,
                cursor,
                limit,
            } => {
                self.catalog_search(context, generation, partition, text, cursor, limit)
                    .await
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
                let source_cursor = self.resolve_turn_items_cursor(
                    context,
                    &thread_id,
                    &turn_id,
                    generation,
                    cursor.as_deref(),
                )?;
                let result = self
                    .rpc(
                        "thread/items/list",
                        json!({
                            "threadId": thread_id.as_str(),
                            "turnId": turn_id.as_str(),
                            "cursor": source_cursor,
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
                    .map(|entry| {
                        if entry.get("turnId").and_then(Value::as_str) != Some(turn_id.as_str()) {
                            return Err(V2Error::source_unavailable(
                                "turn item source returned a different turn",
                            ));
                        }
                        let item = entry.get("item").ok_or_else(|| {
                            V2Error::source_unavailable("turn item source omitted item")
                        })?;
                        normalize::item(item)
                    })
                    .collect::<Result<Vec<_>, _>>()?;
                let next = result
                    .get("nextCursor")
                    .and_then(Value::as_str)
                    .map(|source_cursor| {
                        self.wrap_turn_items_cursor(
                            context,
                            &thread_id,
                            &turn_id,
                            generation,
                            source_cursor,
                        )
                    });
                Ok(QueryResult::TurnItems {
                    thread_id,
                    turn_id,
                    items,
                    next,
                })
            }
            Query::ItemOutput {
                thread_id,
                turn_id,
                item_id,
                cursor,
                limit_bytes,
            } => {
                self.authorize_thread_access(authorization, context, &thread_id, generation)
                    .await?;
                self.item_output(
                    context,
                    generation,
                    thread_id,
                    turn_id,
                    item_id,
                    cursor,
                    limit_bytes,
                )
                .await
            }
            Query::ThreadProcesses {
                thread_id,
                cursor,
                limit,
            } => {
                self.authorize_thread_access(authorization, context, &thread_id, generation)
                    .await?;
                self.background_processes(context, generation, thread_id, cursor, limit)
                    .await
            }
            Query::ThreadResources {
                thread_id,
                scope,
                cursor,
                limit,
            } => {
                self.thread_resources(
                    authorization,
                    context,
                    generation,
                    thread_id,
                    scope,
                    cursor,
                    limit,
                )
                .await
            }
            Query::WorkspaceFile { thread_id, path } => {
                self.workspace_file(authorization, context, generation, thread_id, path)
                    .await
            }
            Query::ThreadChange {
                thread_id,
                path,
                scope,
            } => {
                require_authenticated_session(authorization)?;
                self.authorize_thread_access(authorization, context, &thread_id, generation)
                    .await?;
                let resources = self.services.resources.as_ref().ok_or_else(|| {
                    V2Error::source_unavailable("resource service is unavailable")
                })?;
                let result = resources
                    .handle(
                        "companion/threadChange/read",
                        &json!({
                            "threadId": thread_id.as_str(),
                            "path": path.as_str(),
                            "changeScope": resource_scope(scope),
                        }),
                    )
                    .await
                    .map_err(|error| V2Error::source_unavailable(error.to_string()))?;
                let detail = parse_thread_change_result(&result, &thread_id, &path)?;
                Ok(QueryResult::ThreadChange {
                    thread_id,
                    path: detail.path,
                    scope: detail.scope,
                    patches: detail.patches,
                    source: detail.source,
                    truncated: detail.truncated,
                })
            }
            Query::ThreadChangeOutput {
                thread_id,
                path,
                scope,
                cursor,
                limit_bytes,
            } => {
                self.thread_change_output(
                    authorization,
                    context,
                    generation,
                    thread_id,
                    path,
                    scope,
                    cursor,
                    limit_bytes,
                )
                .await
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
                let projects = normalize::projects(&result)?;
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
                    support: normalize::workspace_support(&result)?,
                })
            }
            Query::QueueList {
                thread_id,
                cursor,
                limit,
            } => {
                let (commands, revision) = self
                    .store
                    .outbox_list_for_owner_with_revision(
                        context.as_str(),
                        thread_id.as_ref().map(Id::as_str),
                    )
                    .map_err(|error| V2Error::source_unavailable(error.to_string()))?;
                let offset = match cursor {
                    Some(cursor) => {
                        let cursor = QueueCursor::decode(&cursor, context, thread_id.as_ref())?;
                        if cursor.witness() != revision {
                            return Err(stale_queue_cursor());
                        }
                        cursor.offset()
                    }
                    None => 0,
                };
                if offset > commands.len() {
                    return Err(stale_queue_cursor());
                }
                let end = offset
                    .saturating_add(usize::from(limit))
                    .min(commands.len());
                let items = normalize::queue_items(&json!({"items": &commands[offset..end]}))?;
                let revision_token =
                    QueueCursor::new(context, thread_id.clone(), revision.clone(), 0).encode()?;
                let next_cursor = if end < commands.len() {
                    Some(QueueCursor::new(context, thread_id, revision.clone(), end).encode()?)
                } else {
                    None
                };
                Ok(QueryResult::QueueList {
                    items,
                    revision: revision_token,
                    next_cursor,
                })
            }
            Query::OperationGet { .. } => Err(V2Error::invalid_query()),
            Query::AccountsList => {
                // Install the event audience before reading the snapshot so an
                // account change cannot land in the snapshot/live gap.
                self.record_account_access(context, generation);
                let accounts =
                    self.services.accounts.as_ref().ok_or_else(|| {
                        V2Error::source_unavailable("account service is unavailable")
                    })?;
                let result = accounts
                    .handle("companion/accountPool/list", &json!({}))
                    .await
                    .map_err(|error| V2Error::source_unavailable(error.to_string()))?;
                require_source_array_limit(&result, "profiles", 100)?;
                let (active_profile_id, profiles, all_exhausted) = normalize::accounts(&result)?;
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
        authorize_command(authorization, command)?;
        self.authorize_attachment_access(command, authorization, context)?;
        ensure_generation(self, generation)?;
        if let Some(thread_id) = command_thread_id(command) {
            self.authorize_thread_access(authorization, context, thread_id, generation)
                .await?;
        }
        if let Command::RequestResolve {
            request_id,
            generation: request_generation,
            ..
        } = command
        {
            self.authorize_request_resolution(request_id, *request_generation, context, generation)
                .await?;
        }
        if let Command::QueueMutate { mutation } = command
            && let Some(item_id) = queue_mutation_item_id(mutation)
        {
            let item = find_outbox_item(&self.store, item_id)?;
            if item.owner_context.as_deref() != Some(context.as_str()) {
                return Err(V2Error::forbidden("queue item belongs to another device"));
            }
            if let QueueMutation::Move {
                before_item_id: Some(before_item_id),
                ..
            } = mutation
            {
                let target = find_outbox_item(&self.store, before_item_id)?;
                if target.owner_context.as_deref() != Some(context.as_str()) {
                    return Err(V2Error::forbidden(
                        "queue placement target belongs to another device",
                    ));
                }
            }
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
        if let Err(error) = authorize_command(authorization, &command)
            .and_then(|()| ensure_generation(self, generation))
        {
            return CommandExecution::Failed(error);
        }
        match self
            .execute_inner(operation_id, command, context, generation)
            .await
        {
            Ok(result) => {
                if let Some(thread_id) = result_thread_id(&result) {
                    self.record_thread_access(context, thread_id, generation);
                }
                if let CommandResult::ThreadUpdate { thread } = &result {
                    self.publish_thread_to_authorized_contexts(generation, thread);
                }
                CommandExecution::Completed(result)
            }
            Err(CommandDispatchError::Failed(error)) => CommandExecution::Failed(error),
            Err(CommandDispatchError::Indeterminate(error)) => {
                CommandExecution::Indeterminate(error)
            }
        }
    }
}

fn require_result_count(actual: usize, limit: usize) -> Result<(), V2Error> {
    (actual <= limit)
        .then_some(())
        .ok_or_else(|| V2Error::source_unavailable("semantic result exceeded record limit"))
}

fn find_outbox_item(
    store: &IndexStore,
    item_id: &Id,
) -> Result<crate::store::OutboxCommand, V2Error> {
    store
        .outbox_get(item_id.as_str())
        .map_err(|error| V2Error::source_unavailable(error.to_string()))?
        .ok_or_else(|| V2Error {
            code: ErrorCode::NotFound,
            recovery: Recovery::Requery,
            message: "queue item was not found".into(),
        })
}

fn normalize_queue_item(
    item: &crate::store::OutboxCommand,
) -> Result<crate::sync_v2::protocol::QueueItem, V2Error> {
    normalize::queue_items(&json!({"items": [item]}))?
        .pop()
        .ok_or_else(|| V2Error::source_unavailable("queue item is invalid"))
}

fn source_response_within_bound(response: &Value) -> bool {
    serde_json::to_vec(response).is_ok_and(|bytes| bytes.len() <= MAX_SOURCE_RESPONSE_BYTES)
}

fn resolve_queue_claim(
    store: &IndexStore,
    item_id: &Id,
    token: u64,
    resolution: OutboxClaimResolution<'_>,
) -> Result<(), V2Error> {
    match store
        .outbox_resolve_claim(item_id.as_str(), token, resolution)
        .map_err(|error| V2Error::operation_indeterminate(error.to_string()))?
    {
        OutboxClaimResolutionOutcome::Applied(_) => Ok(()),
        OutboxClaimResolutionOutcome::AlreadyResolved(_)
        | OutboxClaimResolutionOutcome::Stale(_) => Err(V2Error::operation_indeterminate(
            "queue claim changed before its delivery result was persisted",
        )),
    }
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
