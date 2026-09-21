use super::attachments::stage_error;
use super::*;

impl UpstreamSemanticSource {
    pub(super) async fn authorize_request_resolution(
        &self,
        request_id: &Id,
        request_generation: U64,
        context: &AuthenticatedContextKey,
        generation: u64,
    ) -> Result<(), V2Error> {
        if request_generation.get() != generation {
            return Err(V2Error::generation_changed());
        }
        let pending = self.pending.read().await;
        let Some(owned) = pending.get(request_id.as_str()) else {
            return Ok(());
        };
        if pending_generation(&owned.request) != generation {
            return Err(V2Error::generation_changed());
        }
        if let Some(thread_id) = pending_thread_id(&owned.request) {
            if !self.has_thread_access(context, thread_id, generation) {
                return Err(V2Error::forbidden("request belongs to another context"));
            }
        } else if !owned.delivered_to.contains(context) {
            return Err(V2Error::forbidden("request belongs to another context"));
        }
        Ok(())
    }

    async fn execute_request_resolution(
        &self,
        request_id: Id,
        request_generation: U64,
        resolution: RequestResolution,
        context: &AuthenticatedContextKey,
        generation: u64,
    ) -> Result<CommandResult, CommandDispatchError> {
        self.authorize_request_resolution(&request_id, request_generation, context, generation)
            .await?;
        let mut pending = self.pending.write().await;
        let Some(owned) = pending.get(request_id.as_str()).cloned() else {
            return Ok(CommandResult::RequestResolve {
                request_id,
                state: ResolutionState::AlreadyResolved,
            });
        };
        if owned.resolution_indeterminate {
            return Err(CommandDispatchError::Indeterminate(
                V2Error::operation_indeterminate(
                    "a prior resolution may already have reached the App Server",
                ),
            ));
        }
        let result = resolution_result(&owned.request, resolution)?;
        let delivery = self
            .upstream
            .respond(json!({"id": request_id.as_str(), "result": result}))
            .await
            .map_err(|error| response_transport_error(&error));
        if let Err(error) = delivery {
            if matches!(&error, CommandDispatchError::Indeterminate(_))
                && let Some(current) = pending.get_mut(request_id.as_str())
            {
                current.resolution_indeterminate = true;
            }
            return Err(error);
        }
        pending.remove(request_id.as_str());
        drop(pending);
        for audience in owned.delivered_to {
            self.coordinator.publish(
                generation,
                AudienceSelector::ExactContext(audience),
                ProjectionChange::PendingRequestClosed {
                    request_id: request_id.clone(),
                    generation: U64::new(generation),
                    reason: PendingCloseReason::Resolved,
                },
            );
        }
        Ok(CommandResult::RequestResolve {
            request_id,
            state: ResolutionState::Resolved,
        })
    }

    pub(super) async fn snapshot_pending_requests(
        &self,
        intent: &OpenIntent,
        authorization: &AuthorizationContext,
        context: &AuthenticatedContextKey,
        generation: u64,
    ) -> Result<Vec<PendingRequest>, V2Error> {
        let candidates = self
            .pending
            .read()
            .await
            .values()
            .map(|owned| owned.request.clone())
            .collect::<Vec<_>>();
        let mut visible_ids = Vec::new();
        for request in candidates {
            let visible = match intent.pending_requests {
                PendingRequestScope::CurrentThread => intent
                    .current_thread
                    .as_ref()
                    .is_some_and(|current| pending_thread_id(&request) == Some(&current.thread_id)),
                PendingRequestScope::AllAccessible => {
                    if let Some(thread_id) = pending_thread_id(&request) {
                        self.authorize_thread_access(authorization, context, thread_id, generation)
                            .await
                            .is_ok()
                    } else {
                        true
                    }
                }
            };
            if visible {
                visible_ids.push(pending_id(&request).as_str().to_owned());
            }
        }
        if visible_ids.len() > MAX_PENDING_REQUESTS {
            return Err(V2Error::source_unavailable(
                "pending request limit exceeded",
            ));
        }
        let mut pending = self.pending.write().await;
        let mut requests = Vec::with_capacity(visible_ids.len());
        for request_id in visible_ids {
            if let Some(owned) = pending.get_mut(&request_id) {
                owned.delivered_to.insert(context.clone());
                requests.push(owned.request.clone());
            }
        }
        Ok(requests)
    }

    pub(super) async fn resume_thread(&self, thread_id: &Id) -> Result<(), V2Error> {
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

    pub(super) async fn watched_thread_data(
        &self,
        current: &CurrentThreadIntent,
        authorization: &AuthorizationContext,
        context: &AuthenticatedContextKey,
        generation: u64,
    ) -> Result<WatchedThreadData, V2Error> {
        let mut thread = self
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
        self.attach_read_state(context, &mut thread)?;
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

    pub(super) async fn execute_inner(
        &self,
        operation_id: &OperationId,
        command: Command,
        context: &AuthenticatedContextKey,
        generation: u64,
    ) -> Result<CommandResult, CommandDispatchError> {
        match command {
            Command::ThreadCreate {
                workspace,
                title,
                settings,
            } => {
                let result = self
                    .command_rpc(
                        "thread/start",
                        thread_start_params(Some(&workspace), &settings),
                    )
                    .await?;
                let mut thread = normalize::thread_summary_from_response(&result)?;
                self.command_rpc(
                    "thread/settings/update",
                    thread_settings_update_params(&thread.id, &settings),
                )
                .await?;
                if let Some(title) = title {
                    self.command_rpc(
                        "thread/name/set",
                        json!({"threadId": thread.id.as_str(), "name": title}),
                    )
                    .await?;
                    thread.title = Some(title);
                }
                self.attach_read_state(context, &mut thread)?;
                Ok(CommandResult::ThreadCreate { thread })
            }
            Command::ThreadFork {
                thread_id,
                through_turn_id,
            } => {
                let result = self
                    .command_rpc(
                        "thread/fork",
                        thread_fork_params(&thread_id, through_turn_id.as_ref()),
                    )
                    .await?;
                let mut thread = normalize::thread_summary_from_response(&result)?;
                self.attach_read_state(context, &mut thread)?;
                Ok(CommandResult::ThreadFork { thread })
            }
            Command::ThreadUpdate { thread_id, change } => {
                let requested_settings = match &change {
                    ThreadUpdate::Settings { settings } => Some(settings.clone()),
                    _ => None,
                };
                let mut settings_updates = requested_settings
                    .as_ref()
                    .map(|_| self.thread_settings_updates.subscribe());
                let (method, params) = match change {
                    ThreadUpdate::Section {
                        section_id,
                        position,
                    } => {
                        let before_thread_id = self
                            .section_before_thread_id(&thread_id, section_id.as_ref(), position)
                            .await?;
                        (
                            "thread/section/move",
                            thread_section_move_params(
                                &thread_id,
                                section_id.as_ref(),
                                before_thread_id.as_ref(),
                            ),
                        )
                    }
                    change => thread_update_rpc(&thread_id, change),
                };
                self.command_rpc(method, params).await?;
                let authoritative_settings =
                    match (requested_settings.as_ref(), settings_updates.as_mut()) {
                        (Some(requested), Some(updates)) => Some(
                            Self::await_authoritative_thread_settings(
                                &thread_id, requested, updates,
                            )
                            .await?,
                        ),
                        _ => None,
                    };
                let mut thread = self.read_thread(&thread_id).await?;
                if requested_settings.is_some() {
                    // A successful update response confirms admission, but it does not carry the
                    // effective settings. Never expose an unrelated cached value as the result.
                    thread.settings = authoritative_settings;
                }
                self.attach_read_state(context, &mut thread)?;
                Ok(CommandResult::ThreadUpdate { thread })
            }
            Command::ThreadDelete { thread_id } => {
                self.command_rpc("thread/delete", json!({"threadId": thread_id.as_str()}))
                    .await?;
                self.read_receipts
                    .delete_thread(&thread_id)
                    .map_err(|error| V2Error::source_unavailable(error.to_string()))?;
                Ok(CommandResult::ThreadDelete { thread_id })
            }
            Command::ThreadMarkRead {
                thread_id,
                through_activity_marker,
            } => {
                let outcome = self
                    .read_receipts
                    .mark_read(context, &thread_id, &through_activity_marker)
                    .map_err(|error| V2Error::source_unavailable(error.to_string()))?;
                if matches!(
                    outcome,
                    crate::store::read_receipts::StoredMarkReadOutcome::UnknownMarker(_)
                ) {
                    return Err(V2Error {
                        code: ErrorCode::Conflict,
                        recovery: Recovery::Requery,
                        message: "read marker is not present in the authoritative thread window"
                            .into(),
                    }
                    .into());
                }
                let mut thread = self.read_thread(&thread_id).await?;
                self.attach_read_state(context, &mut thread)?;
                self.publish_thread_to_authorized_contexts(generation, &thread);
                let read_state = thread.read_state;
                Ok(CommandResult::ThreadMarkRead {
                    thread_id,
                    read_state,
                })
            }
            Command::TurnSubmit {
                thread_id: Some(thread_id),
                input,
                intent: _,
                settings,
                ..
            } => {
                let input = self
                    .resolve_input_blocks(context, &thread_id, &input)
                    .await?;
                let result = self
                    .command_rpc(
                        "turn/start",
                        turn_start_params(&thread_id, input, settings.as_ref()),
                    )
                    .await?;
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
                let attachment_ids = input
                    .iter()
                    .filter_map(|block| match block {
                        crate::sync_v2::domain::InputBlock::Attachment { attachment_id } => {
                            Some(attachment_id.clone())
                        }
                        crate::sync_v2::domain::InputBlock::Text { .. }
                        | crate::sync_v2::domain::InputBlock::Skill { .. } => None,
                    })
                    .collect::<Vec<_>>();
                let stages = if attachment_ids.is_empty() {
                    None
                } else {
                    Some(self.services.attachments.as_ref().ok_or_else(|| {
                        V2Error::invalid_request(
                            "staged attachment is unavailable for this request",
                        )
                    })?)
                };
                if let Some(stages) = stages {
                    stages
                        .reserve_completed_for_new_thread(
                            context,
                            workspace.as_deref(),
                            operation_id,
                            &attachment_ids,
                        )
                        .map_err(|error| stage_error(&error))?;
                }
                let thread_start = settings.as_ref().map_or_else(
                    || json!({"cwd": workspace}),
                    |settings| thread_start_params(workspace.as_deref(), settings),
                );
                let created = match self.command_rpc("thread/start", thread_start).await {
                    Ok(created) => created,
                    Err(error) => {
                        if let Some(stages) = stages {
                            let _ = stages.release_new_thread_reservation(operation_id);
                        }
                        return Err(error);
                    }
                };
                let thread = match normalize::thread_summary_from_response(&created) {
                    Ok(thread) => thread,
                    Err(error) => {
                        if let Some(thread_id) = created
                            .pointer("/thread/id")
                            .and_then(Value::as_str)
                            .and_then(|value| Id::new(value.to_owned()).ok())
                        {
                            let _ = self
                                .rpc("thread/delete", json!({"threadId": thread_id.as_str()}))
                                .await;
                        }
                        if let Some(stages) = stages {
                            let _ = stages.release_new_thread_reservation(operation_id);
                        }
                        return Err(error.into());
                    }
                };
                if let Some(stages) = stages
                    && let Err(error) = stages.commit_new_thread_reservation(
                        context,
                        &thread.workspace,
                        &thread.id,
                        operation_id,
                        &attachment_ids,
                    )
                {
                    let _ = self
                        .rpc("thread/delete", json!({"threadId": thread.id.as_str()}))
                        .await;
                    let _ = stages.release_new_thread_reservation(operation_id);
                    return Err(stage_error(&error).into());
                }
                let input = match self.resolve_new_thread_input_blocks(
                    context,
                    &thread.workspace,
                    &thread.id,
                    &input,
                ) {
                    Ok(input) => input,
                    Err(error) => {
                        self.compensate_new_thread(
                            context,
                            operation_id,
                            &thread.id,
                            &attachment_ids,
                        )
                        .await;
                        return Err(error.into());
                    }
                };
                let started = match self
                    .command_rpc(
                        "turn/start",
                        turn_start_params(&thread.id, input, settings.as_ref()),
                    )
                    .await
                {
                    Ok(started) => started,
                    Err(error) => {
                        self.compensate_new_thread(
                            context,
                            operation_id,
                            &thread.id,
                            &attachment_ids,
                        )
                        .await;
                        return Err(error);
                    }
                };
                let turn_id = match started
                    .pointer("/turn/id")
                    .and_then(Value::as_str)
                    .ok_or_else(|| V2Error::source_unavailable("turn result omitted id"))
                    .and_then(|value| {
                        Id::new(value.to_owned())
                            .map_err(|_| V2Error::source_unavailable("turn id is invalid"))
                    }) {
                    Ok(turn_id) => turn_id,
                    Err(error) => {
                        self.compensate_new_thread(
                            context,
                            operation_id,
                            &thread.id,
                            &attachment_ids,
                        )
                        .await;
                        return Err(error.into());
                    }
                };
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
                let result = self
                    .command_rpc("turn/steer", turn_steer_params(&thread_id, &turn_id, input))
                    .await?;
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
            Command::ReviewStart {
                thread_id,
                target,
                delivery,
            } => {
                let result = self
                    .command_rpc(
                        "review/start",
                        json!({
                            "threadId": thread_id.as_str(),
                            "target": review_target_source(target),
                            "delivery": delivery,
                        }),
                    )
                    .await?;
                let turn_id = Id::new(
                    result
                        .pointer("/turn/id")
                        .and_then(Value::as_str)
                        .ok_or_else(|| V2Error::source_unavailable("review result omitted turn"))?
                        .to_owned(),
                )
                .map_err(|_| V2Error::source_unavailable("review turn id is invalid"))?;
                let review_thread_id = Id::new(
                    result
                        .get("reviewThreadId")
                        .and_then(Value::as_str)
                        .ok_or_else(|| {
                            V2Error::source_unavailable("review result omitted thread id")
                        })?
                        .to_owned(),
                )
                .map_err(|_| V2Error::source_unavailable("review thread id is invalid"))?;
                Ok(CommandResult::ReviewStart {
                    thread_id,
                    review_thread_id,
                    turn_id,
                })
            }
            Command::TurnInterrupt { thread_id, turn_id } => {
                let result = self
                    .command_rpc(
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
                    .command_rpc(
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
                if !drop_following_turns {
                    return Err(V2Error::invalid_request(
                        "App Server rollback only supports dropping following turns",
                    )
                    .into());
                }
                let num_turns = self
                    .rollback_turn_count(&thread_id, through_turn_id.as_ref())
                    .await?;
                if num_turns == 0 {
                    let mut thread = self.read_thread(&thread_id).await?;
                    self.attach_read_state(context, &mut thread)?;
                    return Ok(CommandResult::ThreadRollback {
                        head_turn_id: thread.head_turn_id.clone(),
                        thread,
                    });
                }
                let result = self
                    .command_rpc(
                        "thread/rollback",
                        thread_rollback_params(&thread_id, num_turns),
                    )
                    .await?;
                let mut thread = normalize::thread_summary_from_response(&result)?;
                self.attach_read_state(context, &mut thread)?;
                Ok(CommandResult::ThreadRollback {
                    head_turn_id: thread.head_turn_id.clone(),
                    thread,
                })
            }
            Command::ProcessTerminate {
                thread_id,
                process_id,
            } => {
                let result = self
                    .command_rpc(
                        "thread/backgroundTerminals/terminate",
                        json!({
                            "threadId": thread_id.as_str(),
                            "processId": process_id.as_str(),
                        }),
                    )
                    .await?;
                let terminated = result
                    .get("terminated")
                    .and_then(Value::as_bool)
                    .ok_or_else(|| {
                        V2Error::source_unavailable(
                            "thread/backgroundTerminals/terminate omitted terminated",
                        )
                    })?;
                Ok(CommandResult::ProcessTerminate {
                    process_id,
                    state: if terminated {
                        ProcessTerminationState::Terminated
                    } else {
                        ProcessTerminationState::NotFound
                    },
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
                )?
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
            Command::QueueMutate { mutation } => self
                .queue_mutate(operation_id, mutation, context)
                .await
                .map_err(CommandDispatchError::Failed),
            Command::AccountUpdate { change } => self
                .account_update(change)
                .await
                .map_err(CommandDispatchError::Failed),
            Command::AccountLoginStart => self
                .account_login_start()
                .await
                .map_err(CommandDispatchError::Failed),
            Command::AccountLoginCancel { login_id } => self
                .account_login_cancel(login_id)
                .await
                .map_err(CommandDispatchError::Failed),
            Command::RequestResolve {
                request_id,
                generation: request_generation,
                resolution,
            } => {
                self.execute_request_resolution(
                    request_id,
                    request_generation,
                    resolution,
                    context,
                    generation,
                )
                .await
            }
        }
    }

    async fn section_before_thread_id(
        &self,
        moving_thread_id: &Id,
        section_id: Option<&Id>,
        position: Option<U64>,
    ) -> Result<Option<Id>, V2Error> {
        let (Some(section_id), Some(position)) = (section_id, position) else {
            return Ok(None);
        };
        let target = usize::try_from(position.get()).map_err(|_| {
            V2Error::invalid_request("section position exceeds the supported index range")
        })?;
        let archived = self.read_thread(moving_thread_id).await?.archived;
        let mut cursor = None;
        let mut seen_cursors = HashSet::new();
        let mut ordinal = 0_usize;
        loop {
            let result = self
                .rpc(
                    "thread/list",
                    json!({
                        "cursor": cursor,
                        "limit": 100,
                        "sortKey": "section_position",
                        "sortDirection": "asc",
                        "sourceKinds": ["cli", "vscode", "exec", "appServer", "unknown"],
                        "archived": archived,
                        "sectionId": section_id.as_str(),
                        "useStateDbOnly": true,
                    }),
                )
                .await?;
            let threads = result
                .get("data")
                .and_then(Value::as_array)
                .ok_or_else(|| V2Error::source_unavailable("thread/list omitted data"))?;
            for thread in threads {
                let candidate = Id::new(
                    thread
                        .get("id")
                        .and_then(Value::as_str)
                        .ok_or_else(|| V2Error::source_unavailable("thread/list item omitted id"))?
                        .to_owned(),
                )
                .map_err(|_| V2Error::source_unavailable("thread/list item id is invalid"))?;
                if &candidate == moving_thread_id {
                    continue;
                }
                if ordinal == target {
                    return Ok(Some(candidate));
                }
                ordinal = ordinal.checked_add(1).ok_or_else(|| {
                    V2Error::source_unavailable("section ordering exceeded the supported range")
                })?;
            }
            let Some(next_cursor) = result
                .get("nextCursor")
                .and_then(Value::as_str)
                .map(ToOwned::to_owned)
            else {
                return Ok(None);
            };
            if !seen_cursors.insert(next_cursor.clone()) {
                return Err(V2Error::source_unavailable(
                    "thread/list returned a repeated section cursor",
                ));
            }
            cursor = Some(next_cursor);
        }
    }

    async fn rollback_turn_count(
        &self,
        thread_id: &Id,
        through_turn_id: Option<&Id>,
    ) -> Result<u32, V2Error> {
        let mut cursor = None;
        let mut seen_cursors = HashSet::new();
        let mut count = 0_u32;
        loop {
            let result = self
                .rpc(
                    "thread/turns/list",
                    json!({
                        "threadId": thread_id.as_str(),
                        "cursor": cursor,
                        "limit": 100,
                        "sortDirection": "desc",
                        "itemsView": "summary",
                    }),
                )
                .await?;
            let turns = result
                .get("data")
                .and_then(Value::as_array)
                .ok_or_else(|| V2Error::source_unavailable("thread/turns/list omitted data"))?;
            for turn in turns {
                let candidate = turn.get("id").and_then(Value::as_str).ok_or_else(|| {
                    V2Error::source_unavailable("thread/turns/list item omitted id")
                })?;
                if through_turn_id.is_some_and(|through| candidate == through.as_str()) {
                    return Ok(count);
                }
                count = count.checked_add(1).ok_or_else(|| {
                    V2Error::source_unavailable("thread turn count exceeded App Server limits")
                })?;
            }
            let Some(next_cursor) = result
                .get("nextCursor")
                .and_then(Value::as_str)
                .map(ToOwned::to_owned)
            else {
                return if through_turn_id.is_none() {
                    Ok(count)
                } else {
                    Err(V2Error {
                        code: ErrorCode::NotFound,
                        recovery: Recovery::Requery,
                        message: "rollback boundary turn was not found".into(),
                    })
                };
            };
            if !seen_cursors.insert(next_cursor.clone()) {
                return Err(V2Error::source_unavailable(
                    "thread/turns/list returned a repeated rollback cursor",
                ));
            }
            cursor = Some(next_cursor);
        }
    }

    async fn compensate_new_thread(
        &self,
        context: &AuthenticatedContextKey,
        operation_id: &OperationId,
        thread_id: &Id,
        attachment_ids: &[Id],
    ) {
        let _ = self
            .rpc("thread/delete", json!({"threadId": thread_id.as_str()}))
            .await;
        if let Some(stages) = &self.services.attachments {
            let _ = stages.rollback_new_thread_binding(context, thread_id, attachment_ids);
            let _ = stages.release_new_thread_reservation(operation_id);
        }
    }

    async fn await_authoritative_thread_settings(
        thread_id: &Id,
        requested: &ThreadSettings,
        updates: &mut tokio::sync::broadcast::Receiver<(Id, ThreadSettings)>,
    ) -> Result<ThreadSettings, CommandDispatchError> {
        let update = tokio::time::timeout(std::time::Duration::from_secs(5), async {
            loop {
                match updates.recv().await {
                    Ok((updated_thread_id, settings))
                        if &updated_thread_id == thread_id
                            && settings_satisfy_update(&settings, requested) =>
                    {
                        return Some(settings);
                    }
                    Ok(_) => {}
                    Err(
                        tokio::sync::broadcast::error::RecvError::Closed
                        | tokio::sync::broadcast::error::RecvError::Lagged(_),
                    ) => return None,
                }
            }
        })
        .await
        .unwrap_or(None);
        update.ok_or_else(|| {
            CommandDispatchError::Indeterminate(V2Error::operation_indeterminate(
                "App Server accepted the settings update without an authoritative settings event",
            ))
        })
    }
}

fn settings_satisfy_update(actual: &ThreadSettings, requested: &ThreadSettings) -> bool {
    actual.approval_policy == requested.approval_policy
        && actual.sandbox == requested.sandbox
        && requested
            .model
            .as_ref()
            .is_none_or(|model| actual.model.as_ref() == Some(model))
        && requested
            .effort
            .is_none_or(|effort| actual.effort == Some(effort))
        && requested
            .personality
            .is_none_or(|personality| actual.personality == Some(personality))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::sync_v2::domain::{ApprovalPolicy, Effort, Personality, Sandbox};

    fn settings(model: Option<&str>, sandbox: Sandbox) -> ThreadSettings {
        ThreadSettings {
            model: model.map(ToOwned::to_owned),
            effort: Some(Effort::High),
            approval_policy: ApprovalPolicy::Never,
            sandbox,
            personality: Some(Personality::Pragmatic),
        }
    }

    #[test]
    fn settings_update_match_treats_null_optional_overrides_as_unchanged() {
        let actual = settings(Some("gpt-5.6-sol"), Sandbox::WorkspaceWrite);
        let requested = ThreadSettings {
            model: None,
            effort: None,
            approval_policy: ApprovalPolicy::Never,
            sandbox: Sandbox::WorkspaceWrite,
            personality: None,
        };

        assert!(settings_satisfy_update(&actual, &requested));
    }

    #[test]
    fn settings_update_match_rejects_an_unrelated_authoritative_event() {
        let actual = settings(Some("gpt-5.6-sol"), Sandbox::ReadOnly);
        let requested = settings(Some("gpt-5.6-sol"), Sandbox::WorkspaceWrite);

        assert!(!settings_satisfy_update(&actual, &requested));
    }

    #[tokio::test]
    async fn settings_update_without_authoritative_event_is_indeterminate() {
        let (sender, mut updates) = tokio::sync::broadcast::channel(1);
        drop(sender);
        let result = UpstreamSemanticSource::await_authoritative_thread_settings(
            &Id::from_generated("thread-1".to_owned()),
            &settings(Some("gpt-5.6-sol"), Sandbox::WorkspaceWrite),
            &mut updates,
        )
        .await;

        assert!(matches!(
            result,
            Err(CommandDispatchError::Indeterminate(_))
        ));
    }
}
