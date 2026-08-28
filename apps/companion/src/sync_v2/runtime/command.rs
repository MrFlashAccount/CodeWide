use std::sync::Arc;

use axum::extract::ws::WebSocket;
use tracing::info;

use crate::auth::AuthorizationContext;

use super::SyncV2Runtime;
use crate::sync_v2::{
    auth_context::AuthenticatedContextKey,
    ledger::Admission,
    protocol::{Command, ServerFrame, V2Error},
    scalar::{Id, OperationId},
    source::{CommandExecution, ensure_generation},
};

impl SyncV2Runtime {
    #[allow(clippy::too_many_arguments)]
    pub(super) async fn handle_command(
        &self,
        socket: &mut WebSocket,
        authorization: &AuthorizationContext,
        context: &AuthenticatedContextKey,
        generation: u64,
        request_id: Id,
        operation_id: OperationId,
        command: Command,
    ) -> bool {
        let command_kind = command.kind();
        if let Err(error) = ensure_generation(self.source.as_ref(), generation) {
            return self
                .send_frame(
                    socket,
                    &ServerFrame::CommandRejected {
                        request_id,
                        operation_id,
                        error,
                    },
                )
                .await
                .is_ok();
        }
        let authorization_result = tokio::time::timeout(
            self.source_deadline,
            self.source
                .authorize_command(&command, authorization, context, generation),
        )
        .await;
        if !matches!(authorization_result, Ok(Ok(()))) {
            let error = match authorization_result {
                Ok(Err(error)) => error,
                Err(_) => V2Error::source_unavailable("command authorization deadline exceeded"),
                Ok(Ok(())) => unreachable!(),
            };
            return self
                .send_frame(
                    socket,
                    &ServerFrame::CommandRejected {
                        request_id,
                        operation_id,
                        error,
                    },
                )
                .await
                .is_ok();
        }
        let operation_lock = self.operation_lock(context, &operation_id).await;
        let _operation_guard = operation_lock.lock().await;
        let admission = match self.ledger.admit(context, &operation_id, &command) {
            Ok(admission) => admission,
            Err(error) => {
                return self
                    .send_frame(
                        socket,
                        &ServerFrame::CommandRejected {
                            request_id,
                            operation_id,
                            error: V2Error::source_unavailable(error.to_string()),
                        },
                    )
                    .await
                    .is_ok();
            }
        };
        let admission_name = match &admission {
            Admission::New { .. } => "new",
            Admission::Admitted { .. } => "retainedAdmission",
            Admission::Completed { .. } => "retainedCompleted",
            Admission::Failed { .. } => "retainedFailed",
            Admission::Indeterminate { .. } => "retainedIndeterminate",
            Admission::Expired => "expired",
            Admission::Conflict => "conflict",
        };
        info!(
            command_kind,
            admission = admission_name,
            "Sync V2 command admission"
        );
        match admission {
            Admission::Conflict => self
                .send_frame(
                    socket,
                    &ServerFrame::CommandRejected {
                        request_id,
                        operation_id,
                        error: V2Error::operation_conflict(),
                    },
                )
                .await
                .is_ok(),
            Admission::Expired => self
                .send_frame(
                    socket,
                    &ServerFrame::CommandExpired {
                        request_id,
                        operation_id,
                        error: V2Error::operation_expired(),
                    },
                )
                .await
                .is_ok(),
            Admission::Completed {
                accepted_at,
                result,
            } => {
                self.send_frame(
                    socket,
                    &ServerFrame::CommandAccepted {
                        request_id,
                        operation_id: operation_id.clone(),
                        accepted_at,
                    },
                )
                .await
                .is_ok()
                    && self
                        .send_frame(
                            socket,
                            &ServerFrame::CommandCompleted {
                                operation_id,
                                result,
                            },
                        )
                        .await
                        .is_ok()
            }
            Admission::Failed { accepted_at, error } => {
                self.send_frame(
                    socket,
                    &ServerFrame::CommandAccepted {
                        request_id,
                        operation_id: operation_id.clone(),
                        accepted_at,
                    },
                )
                .await
                .is_ok()
                    && self
                        .send_frame(
                            socket,
                            &ServerFrame::CommandFailed {
                                operation_id,
                                error,
                            },
                        )
                        .await
                        .is_ok()
            }
            Admission::Indeterminate { accepted_at, error } => {
                self.send_frame(
                    socket,
                    &ServerFrame::CommandAccepted {
                        request_id,
                        operation_id: operation_id.clone(),
                        accepted_at,
                    },
                )
                .await
                .is_ok()
                    && self
                        .send_frame(
                            socket,
                            &ServerFrame::CommandIndeterminate {
                                operation_id,
                                error,
                            },
                        )
                        .await
                        .is_ok()
            }
            Admission::Admitted { accepted_at } => {
                if self
                    .send_frame(
                        socket,
                        &ServerFrame::CommandAccepted {
                            request_id,
                            operation_id: operation_id.clone(),
                            accepted_at,
                        },
                    )
                    .await
                    .is_err()
                {
                    return false;
                }
                let error = V2Error::operation_indeterminate(
                    "command was admitted before restart; adapter dispatch was not repeated",
                );
                if self
                    .ledger
                    .indeterminate(context, &operation_id, error.clone())
                    .is_err()
                {
                    return false;
                }
                self.send_frame(
                    socket,
                    &ServerFrame::CommandIndeterminate {
                        operation_id,
                        error,
                    },
                )
                .await
                .is_ok()
            }
            Admission::New { accepted_at } => {
                if self
                    .send_frame(
                        socket,
                        &ServerFrame::CommandAccepted {
                            request_id,
                            operation_id: operation_id.clone(),
                            accepted_at,
                        },
                    )
                    .await
                    .is_err()
                {
                    return false;
                }
                let execution = tokio::time::timeout(
                    self.source_deadline,
                    self.source
                        .execute(&operation_id, command, authorization, context, generation),
                )
                .await;
                let frame = match execution {
                    Err(_) => {
                        let error = V2Error::operation_indeterminate(
                            "command source deadline exceeded after admission",
                        );
                        if self
                            .ledger
                            .indeterminate(context, &operation_id, error.clone())
                            .is_err()
                        {
                            return false;
                        }
                        ServerFrame::CommandIndeterminate {
                            operation_id,
                            error,
                        }
                    }
                    Ok(execution) => match execution {
                        CommandExecution::Completed(result) if result.kind() == command_kind => {
                            if self
                                .ledger
                                .complete(context, &operation_id, result.clone())
                                .is_err()
                            {
                                return false;
                            }
                            ServerFrame::CommandCompleted {
                                operation_id,
                                result,
                            }
                        }
                        CommandExecution::Completed(_) => {
                            let error = V2Error::operation_indeterminate(
                                "semantic source returned a mismatched command result",
                            );
                            if self
                                .ledger
                                .indeterminate(context, &operation_id, error.clone())
                                .is_err()
                            {
                                return false;
                            }
                            ServerFrame::CommandIndeterminate {
                                operation_id,
                                error,
                            }
                        }
                        CommandExecution::Failed(error) => {
                            if self
                                .ledger
                                .fail(context, &operation_id, error.clone())
                                .is_err()
                            {
                                return false;
                            }
                            ServerFrame::CommandFailed {
                                operation_id,
                                error,
                            }
                        }
                        CommandExecution::Indeterminate(error) => {
                            if self
                                .ledger
                                .indeterminate(context, &operation_id, error.clone())
                                .is_err()
                            {
                                return false;
                            }
                            ServerFrame::CommandIndeterminate {
                                operation_id,
                                error,
                            }
                        }
                    },
                };
                let outcome = match &frame {
                    ServerFrame::CommandCompleted { .. } => "completed",
                    ServerFrame::CommandFailed { .. } => "failed",
                    ServerFrame::CommandIndeterminate { .. } => "indeterminate",
                    _ => "invalid",
                };
                info!(command_kind, outcome, "Sync V2 command terminal outcome");
                self.send_frame(socket, &frame).await.is_ok()
            }
        }
    }

    async fn operation_lock(
        &self,
        context: &AuthenticatedContextKey,
        operation_id: &OperationId,
    ) -> Arc<tokio::sync::Mutex<()>> {
        let key = format!("{}#{}", context.as_str(), operation_id.as_str());
        let mut locks = self.operation_locks.lock().await;
        locks.retain(|_, candidate| candidate.strong_count() > 0);
        if let Some(existing) = locks.get(&key).and_then(std::sync::Weak::upgrade) {
            return existing;
        }
        let lock = Arc::new(tokio::sync::Mutex::new(()));
        locks.insert(key, Arc::downgrade(&lock));
        lock
    }
}
