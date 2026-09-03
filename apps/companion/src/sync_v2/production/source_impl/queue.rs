use super::*;

impl UpstreamSemanticSource {
    pub(super) async fn queue_mutate(
        &self,
        operation_id: &OperationId,
        mutation: QueueMutation,
        context: &AuthenticatedContextKey,
    ) -> Result<CommandResult, V2Error> {
        let outcome = match mutation {
            QueueMutation::Put { thread_id, input } => {
                let resolved = self
                    .resolve_input_blocks_with_metadata(context, &thread_id, &input)
                    .await?;
                let queue_input = queue_input_blocks(&input, &resolved.attachment_names)?;
                let stored = self
                    .store
                    .outbox_put_turn_start_for_owner_with_queue_input(
                        operation_id.as_str(),
                        thread_id.as_str(),
                        json!({
                            "threadId": thread_id.as_str(),
                            "clientUserMessageId": operation_id.as_str(),
                            "input": resolved.wire,
                        }),
                        context.as_str(),
                        &queue_input,
                    )
                    .map_err(queue_store_error)?;
                let item = normalize_queue_item(&stored)?;
                QueueMutationOutcome::Item { item }
            }
            QueueMutation::Edit {
                item_id,
                expected_revision,
                editable_input,
            } => {
                let revision = queue_revision(&expected_revision, context)?;
                let expectation = queue_expectation(context, &revision);
                let thread_id = self
                    .store
                    .outbox_get(item_id.as_str())
                    .map_err(|error| V2Error::source_unavailable(error.to_string()))?
                    .and_then(|item| Id::new(item.remote_thread_id).ok())
                    .ok_or_else(|| V2Error::source_unavailable("queue item is unavailable"))?;
                let input = editable_input
                    .into_iter()
                    .map(|block| match block {
                        crate::sync_v2::protocol::EditableInputBlock::Text { text } => {
                            crate::sync_v2::domain::InputBlock::Text { text }
                        }
                        crate::sync_v2::protocol::EditableInputBlock::Attachment {
                            attachment_id,
                        } => crate::sync_v2::domain::InputBlock::Attachment { attachment_id },
                    })
                    .collect::<Vec<_>>();
                let resolved = self
                    .resolve_input_blocks_with_metadata(context, &thread_id, &input)
                    .await?;
                let queue_input = queue_input_blocks(&input, &resolved.attachment_names)?;
                let stored = self
                    .store
                    .outbox_edit_prompt_checked_with_queue_input(
                        item_id.as_str(),
                        &Value::Array(resolved.wire),
                        &expectation,
                        &queue_input,
                    )
                    .map_err(queue_store_error)?;
                let item = normalize_queue_item(&stored)?;
                QueueMutationOutcome::Item { item }
            }
            QueueMutation::Cancel {
                item_id,
                expected_revision,
            } => {
                let revision = queue_revision(&expected_revision, context)?;
                let expectation = queue_expectation(context, &revision);
                let cancelled = self
                    .store
                    .outbox_cancel_checked(item_id.as_str(), &expectation)
                    .map_err(queue_store_error)?;
                if !cancelled {
                    return Err(V2Error {
                        code: ErrorCode::Conflict,
                        recovery: Recovery::Requery,
                        message: "queue item can no longer be cancelled".into(),
                    });
                }
                QueueMutationOutcome::Cancelled { item_id }
            }
            QueueMutation::Move {
                item_id,
                expected_revision,
                before_item_id,
            } => {
                let revision = queue_revision(&expected_revision, context)?;
                let expectation = queue_expectation(context, &revision);
                let stored = self
                    .store
                    .outbox_place_checked(
                        item_id.as_str(),
                        before_item_id.as_ref().map(Id::as_str),
                        &expectation,
                    )
                    .map_err(queue_store_error)?;
                let item = normalize_queue_item(&stored)?;
                QueueMutationOutcome::Item { item }
            }
            QueueMutation::Retry {
                item_id,
                expected_revision,
            } => {
                let revision = queue_revision(&expected_revision, context)?;
                let expectation = queue_expectation(context, &revision);
                let stored = self
                    .store
                    .outbox_retry_failed_checked(item_id.as_str(), &expectation)
                    .map_err(queue_store_error)?;
                let item = normalize_queue_item(&stored)?;
                QueueMutationOutcome::Item { item }
            }
            QueueMutation::Steer {
                item_id,
                turn_id,
                expected_revision,
            } => {
                let revision = queue_revision(&expected_revision, context)?;
                let expectation = queue_expectation(context, &revision);
                let claim = self
                    .store
                    .outbox_claim_steer_checked(
                        item_id.as_str(),
                        operation_id.as_str(),
                        &expectation,
                    )
                    .map_err(queue_store_error)?;
                let (command, token) = match claim {
                    OutboxClaimOutcome::Acquired { command, token } => (command, Some(token)),
                    OutboxClaimOutcome::Duplicate(command) => (command, None),
                    OutboxClaimOutcome::Unavailable(_) => {
                        return Err(V2Error {
                            code: ErrorCode::Conflict,
                            recovery: Recovery::Requery,
                            message: "queue item is already being delivered".into(),
                        });
                    }
                };
                let thread_id = Id::new(command.remote_thread_id.clone())
                    .map_err(|_| V2Error::source_unavailable("queue item thread is invalid"))?;
                if let Some(token) = token {
                    let response = self
                        .upstream
                        .request(json!({
                            "method": "turn/steer",
                            "params": {
                                "threadId": thread_id.as_str(),
                                "expectedTurnId": turn_id.as_str(),
                                "input": command.params.get("input").cloned().unwrap_or_else(|| json!([])),
                            },
                        }))
                        .await;
                    match response {
                        Err(error) => {
                            let message = error.to_string();
                            resolve_queue_claim(
                                &self.store,
                                &item_id,
                                token,
                                OutboxClaimResolution::Indeterminate {
                                    error: &message,
                                    retry_after_ms: 0,
                                },
                            )?;
                            return Err(V2Error::operation_indeterminate(
                                "queued steer delivery is uncertain",
                            ));
                        }
                        Ok(response) if !source_response_within_bound(&response) => {
                            resolve_queue_claim(
                                &self.store,
                                &item_id,
                                token,
                                OutboxClaimResolution::Indeterminate {
                                    error: "source response exceeded byte limit",
                                    retry_after_ms: 0,
                                },
                            )?;
                            return Err(V2Error::operation_indeterminate(
                                "queued steer response exceeded byte limit",
                            ));
                        }
                        Ok(response) => match normalize::rpc_result(&response) {
                            Ok(_) => {
                                resolve_queue_claim(
                                    &self.store,
                                    &item_id,
                                    token,
                                    OutboxClaimResolution::Delivered,
                                )?;
                            }
                            Err(error) => {
                                let queue_error = queue_source_error_message(&response);
                                resolve_queue_claim(
                                    &self.store,
                                    &item_id,
                                    token,
                                    OutboxClaimResolution::Rejected {
                                        error: &queue_error,
                                    },
                                )?;
                                return Err(V2Error::invalid_request(error.message));
                            }
                        },
                    }
                }
                QueueMutationOutcome::Steered {
                    item_id,
                    thread_id,
                    turn_id,
                }
            }
        };
        Ok(CommandResult::QueueMutate { outcome })
    }
}

fn queue_input_blocks(
    input: &[crate::sync_v2::domain::InputBlock],
    attachment_names: &HashMap<Id, String>,
) -> Result<Vec<OutboxQueueInputBlock>, V2Error> {
    input
        .iter()
        .map(|block| match block {
            crate::sync_v2::domain::InputBlock::Text { text } => {
                Ok(OutboxQueueInputBlock::Text { text: text.clone() })
            }
            crate::sync_v2::domain::InputBlock::Attachment { attachment_id } => {
                let name = attachment_names.get(attachment_id).ok_or_else(|| {
                    V2Error::source_unavailable("resolved queue attachment omitted its file name")
                })?;
                if name.is_empty() || name.chars().count() > 512 || name.len() > 2048 {
                    return Err(V2Error::source_unavailable(
                        "resolved queue attachment has an invalid file name",
                    ));
                }
                Ok(OutboxQueueInputBlock::Attachment {
                    attachment_id: attachment_id.as_str().to_owned(),
                    name: name.clone(),
                })
            }
            crate::sync_v2::domain::InputBlock::Skill { name, path } => {
                Ok(OutboxQueueInputBlock::Skill {
                    name: name.clone(),
                    path: path.clone(),
                })
            }
        })
        .collect()
}

fn queue_revision(
    expected_revision: &str,
    context: &AuthenticatedContextKey,
) -> Result<QueueCursor, V2Error> {
    let revision = QueueCursor::decode_for_owner(expected_revision, context)?;
    if revision.offset() != 0 {
        return Err(V2Error::invalid_request("queue revision is invalid"));
    }
    Ok(revision)
}

fn queue_expectation<'a>(
    context: &'a AuthenticatedContextKey,
    revision: &'a QueueCursor,
) -> OutboxExpectation<'a> {
    OutboxExpectation {
        owner_context: context.as_str(),
        remote_thread_id: revision.thread_id().map(Id::as_str),
        revision: revision.witness(),
    }
}

fn queue_store_error(error: crate::store::StoreError) -> V2Error {
    match error {
        crate::store::StoreError::OutboxRevisionConflict => V2Error {
            code: ErrorCode::Conflict,
            recovery: Recovery::Requery,
            message: "durable queue changed before the mutation committed".into(),
        },
        error @ crate::store::StoreError::OutboxOwnerQuotaExceeded { .. } => V2Error {
            code: ErrorCode::Conflict,
            recovery: Recovery::Requery,
            message: format!("{error}; deliver or cancel queued prompts before adding another"),
        },
        error => V2Error::source_unavailable(error.to_string()),
    }
}

fn queue_source_error_message(response: &Value) -> String {
    let error = response.get("error").unwrap_or(response);
    let message = error
        .get("message")
        .and_then(Value::as_str)
        .map_or_else(|| error.to_string(), str::to_owned);
    message.chars().take(500).collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        auth::AuthorizationContext,
        catalog::SessionCatalog,
        history_service::HistoryService,
        store::IndexStore,
        sync_v2::{ProductionServices, SemanticSource, domain::InputBlock},
        upstream::UpstreamHandle,
    };

    #[tokio::test]
    async fn put_derives_app_server_message_identity_from_operation_id() {
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
        let authorization = AuthorizationContext::Session {
            device_id: "device-a".into(),
            scopes: vec!["turns.start".into()],
            expires_at: u64::MAX,
        };
        let context = AuthenticatedContextKey::derive(&authorization)
            .unwrap_or_else(|error| panic!("context failed: {error:?}"));
        let thread_id =
            Id::new("thread-1").unwrap_or_else(|error| panic!("thread id failed: {error}"));
        let generation = source.generation();
        source.record_thread_access(&context, &thread_id, generation);
        let operation_id = OperationId::new("operation-stable")
            .unwrap_or_else(|error| panic!("operation id failed: {error}"));
        let result = source
            .execute(
                &operation_id,
                Command::QueueMutate {
                    mutation: QueueMutation::Put {
                        thread_id,
                        input: vec![InputBlock::Text {
                            text: "hello".into(),
                        }],
                    },
                },
                &authorization,
                &context,
                generation,
            )
            .await;
        assert!(
            matches!(&result, CommandExecution::Completed(_)),
            "queue put failed: {result:?}"
        );
        let queued = store
            .outbox_list_for_owner(context.as_str(), None)
            .unwrap_or_else(|error| panic!("queue list failed: {error}"));
        assert_eq!(queued.len(), 1);
        assert_eq!(queued[0].command_id, "operation-stable");
        assert_eq!(queued[0].params["clientUserMessageId"], "operation-stable");
    }

    #[test]
    fn owner_quota_is_an_explicit_requeryable_command_failure() {
        let error = queue_store_error(crate::store::StoreError::OutboxOwnerQuotaExceeded {
            limit_bytes: 256 * 1024 * 1024,
        });
        assert_eq!(error.code, ErrorCode::Conflict);
        assert_eq!(error.recovery, Recovery::Requery);
        assert!(error.message.contains("cancel queued prompts"));
    }

    #[test]
    fn queue_steer_failure_preserves_the_bounded_source_payload() {
        let payload = json!({"code": -32001, "details": "steer rejected by source"});
        assert_eq!(
            queue_source_error_message(&json!({"error": payload.clone()})),
            payload.to_string()
        );
        assert_eq!(
            queue_source_error_message(&json!({"error": {"message": "x".repeat(501)}}))
                .chars()
                .count(),
            500
        );
    }

    #[test]
    fn queue_presentation_input_keeps_authoritative_attachment_name_and_order() {
        let attachment_id = Id::new("attachment-stable")
            .unwrap_or_else(|error| panic!("attachment id failed: {error}"));
        let input = vec![
            InputBlock::Text {
                text: "review".into(),
            },
            InputBlock::Attachment {
                attachment_id: attachment_id.clone(),
            },
            InputBlock::Skill {
                name: "review".into(),
                path: "/skills/review/SKILL.md".into(),
            },
        ];
        let names = HashMap::from([(attachment_id, "Release notes final.md".into())]);

        let result = queue_input_blocks(&input, &names)
            .unwrap_or_else(|error| panic!("queue input projection failed: {error:?}"));

        assert_eq!(
            result,
            vec![
                OutboxQueueInputBlock::Text {
                    text: "review".into(),
                },
                OutboxQueueInputBlock::Attachment {
                    attachment_id: "attachment-stable".into(),
                    name: "Release notes final.md".into(),
                },
                OutboxQueueInputBlock::Skill {
                    name: "review".into(),
                    path: "/skills/review/SKILL.md".into(),
                },
            ]
        );
    }
}
