//! Per-epoch control frames, cleanup, and bounded server publication.

use axum::extract::ws::WebSocket;
use tracing::{info, warn};

use crate::auth::AuthorizationContext;

use super::{ContextLifecycle, SyncV2Runtime};
use crate::sync_v2::{
    AuthenticatedContextKey,
    domain::ProjectionChange,
    epoch::{ConnectionEpoch, EpochPhase},
    protocol::{ClientFrame, CurrentThreadIntent, ReinitializeReason, ServerFrame, V2Error},
    wire::{close, send},
};

impl SyncV2Runtime {
    #[allow(clippy::too_many_arguments)]
    pub(super) async fn handle_frame(
        &self,
        socket: &mut WebSocket,
        authorization: &AuthorizationContext,
        context: &AuthenticatedContextKey,
        lifecycle: &ContextLifecycle,
        lifecycle_revision: u64,
        epoch: &mut ConnectionEpoch,
        frame: ClientFrame,
    ) -> bool {
        let _dispatch_guard = lifecycle.dispatch.read().await;
        if !self
            .context_is_current(context, lifecycle, lifecycle_revision)
            .await
        {
            close(socket, 1008, "authenticated_context_revoked").await;
            return false;
        }
        match frame {
            ClientFrame::Ping { nonce } => self
                .send_frame(socket, &ServerFrame::Pong { nonce })
                .await
                .is_ok(),
            ClientFrame::SnapshotCommitted {
                epoch_id,
                revision,
                watermark,
            } if epoch.phase == EpochPhase::AwaitingCommit => {
                if !epoch.validates_commit(&epoch_id, &revision, watermark) {
                    self.reinitialize(socket, epoch, ReinitializeReason::InvalidCommit)
                        .await;
                    return true;
                }
                epoch.begin_drain();
                true
            }
            ClientFrame::Query { request_id, query } if epoch.phase == EpochPhase::Live => {
                self.handle_query(socket, authorization, context, epoch, request_id, query)
                    .await
            }
            ClientFrame::ThreadWatch {
                request_id,
                thread_id,
                turn_limit,
            } if epoch.phase == EpochPhase::Live => {
                let current = CurrentThreadIntent {
                    thread_id,
                    turn_limit,
                };
                let watched = tokio::time::timeout(
                    self.source_deadline,
                    self.source.watch_thread(
                        &epoch.id,
                        &current,
                        authorization,
                        context,
                        epoch.generation,
                    ),
                )
                .await;
                let result = match watched {
                    Ok(Ok(watched)) => {
                        epoch.intent.current_thread = Some(current);
                        if epoch
                            .enqueue_local(ProjectionChange::CurrentThreadReplaced {
                                current_thread: watched.current_thread,
                                pending_requests: watched.pending_requests,
                            })
                            .is_err()
                            || self.flush_changes(socket, epoch).await.is_err()
                        {
                            return false;
                        }
                        ServerFrame::ThreadWatched {
                            request_id,
                            epoch_id: epoch.id.clone(),
                        }
                    }
                    Ok(Err(error)) => ServerFrame::ThreadWatchFailed { request_id, error },
                    Err(_) => ServerFrame::ThreadWatchFailed {
                        request_id,
                        error: V2Error::source_unavailable("thread watch deadline exceeded"),
                    },
                };
                self.send_frame(socket, &result).await.is_ok()
            }
            ClientFrame::Command {
                request_id,
                operation_id,
                command,
            } if epoch.phase == EpochPhase::Live => {
                #[cfg(feature = "e2e-command-fault")]
                if let Some(fault_id) = self.e2e_command_fault.intercept(&operation_id).await {
                    self.reinitialize(socket, epoch, ReinitializeReason::SourceGap)
                        .await;
                    self.e2e_command_fault
                        .mark_reinitialize_sent(&fault_id)
                        .await;
                    return true;
                }
                self.handle_command(
                    socket,
                    authorization,
                    context,
                    epoch.generation,
                    request_id,
                    operation_id,
                    command,
                )
                .await
            }
            ClientFrame::Action { request_id, action } if epoch.phase == EpochPhase::Live => {
                let frame = match crate::sync_v2::source::ensure_generation(
                    self.source.as_ref(),
                    epoch.generation,
                ) {
                    Ok(()) => match tokio::time::timeout(
                        self.source_deadline,
                        self.source
                            .resolve(action, authorization, context, epoch.generation),
                    )
                    .await
                    {
                        Ok(Ok(result)) => ServerFrame::ActionCompleted { request_id, result },
                        Ok(Err(error)) => ServerFrame::ActionFailed { request_id, error },
                        Err(_) => ServerFrame::ActionFailed {
                            request_id,
                            error: V2Error::source_unavailable("action source deadline exceeded"),
                        },
                    },
                    Err(error) => ServerFrame::ActionFailed { request_id, error },
                };
                self.send_frame(socket, &frame).await.is_ok()
            }
            _ => {
                close(socket, 1008, "frame_not_legal_in_current_state").await;
                false
            }
        }
    }

    pub(super) async fn reinitialize(
        &self,
        socket: &mut WebSocket,
        epoch: &mut ConnectionEpoch,
        reason: ReinitializeReason,
    ) {
        let epoch_id = epoch.id.clone();
        let (queued_events, queued_bytes) = epoch.queued_usage();
        info!(
            epoch_id = epoch_id.as_str(),
            ?reason,
            queued_events,
            queued_bytes,
            "Sync V2 epoch reinitializing"
        );
        let _ = self
            .send_frame(socket, &ServerFrame::Reinitialize { epoch_id, reason })
            .await;
        self.cleanup(epoch).await;
    }

    pub(super) fn initialization_failure_reason(&self) -> ReinitializeReason {
        if self.source.is_available() {
            ReinitializeReason::SnapshotFailed
        } else {
            ReinitializeReason::UpstreamUnavailable
        }
    }

    pub(super) async fn cleanup(&self, epoch: &mut ConnectionEpoch) {
        self.live_epoch_contexts.lock().await.remove(&epoch.id);
        let _ =
            tokio::time::timeout(self.source_deadline, self.source.remove_intent(&epoch.id)).await;
        self.source.coordinator().remove(&epoch.id);
        epoch.close();
    }

    pub(super) async fn flush_changes(
        &self,
        socket: &mut WebSocket,
        epoch: &mut ConnectionEpoch,
    ) -> Result<(), ()> {
        while let Some(change) = epoch.next_queued_change() {
            self.send_frame(
                socket,
                &ServerFrame::Change {
                    epoch_id: epoch.id.clone(),
                    watermark: change.watermark,
                    change: change.change,
                },
            )
            .await?;
            epoch.confirm_queued_change();
        }
        Ok(())
    }

    pub(super) async fn send_frame(
        &self,
        socket: &mut WebSocket,
        frame: &ServerFrame,
    ) -> Result<(), ()> {
        let failure = match frame {
            ServerFrame::QueryFailed { error, .. } => Some(("queryFailed", error)),
            ServerFrame::CommandRejected { error, .. } => Some(("commandRejected", error)),
            ServerFrame::CommandExpired { error, .. } => Some(("commandExpired", error)),
            ServerFrame::CommandFailed { error, .. } => Some(("commandFailed", error)),
            ServerFrame::CommandIndeterminate { error, .. } => {
                Some(("commandIndeterminate", error))
            }
            ServerFrame::ActionFailed { error, .. } => Some(("actionFailed", error)),
            _ => None,
        };
        if let Some((frame_type, error)) = failure {
            warn!(
                frame_type,
                code = ?error.code,
                recovery = ?error.recovery,
                "Sync V2 request failed"
            );
        }
        tokio::time::timeout(self.send_deadline, send(socket, frame))
            .await
            .map_err(|_| ())?
            .map_err(|_| ())
    }
}
