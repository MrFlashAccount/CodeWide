//! Per-epoch control frames, cleanup, and bounded server publication.

use axum::extract::ws::WebSocket;
use tracing::{info, warn};

use crate::auth::{AuthorizationChange, AuthorizationContext};

use super::{ContextLifecycle, SyncV2Runtime, recv_authorization_change, wait_for_session_expiry};
use crate::sync_v2::{
    AuthenticatedContextKey,
    domain::ProjectionChange,
    epoch::{ConnectionEpoch, EpochPhase},
    protocol::{ClientFrame, CurrentThreadIntent, ReinitializeReason, ServerFrame, V2Error},
    wire::{close, send},
};

enum FrameOutcome {
    Handled(bool),
    SessionExpired,
    LifecycleRevoked,
    AuthorizationRevoked(&'static str),
}

impl SyncV2Runtime {
    #[allow(clippy::too_many_arguments)]
    pub(super) async fn handle_frame(
        &self,
        socket: &mut WebSocket,
        authorization: &AuthorizationContext,
        context: &AuthenticatedContextKey,
        authorization_changes: &mut Option<tokio::sync::broadcast::Receiver<AuthorizationChange>>,
        lifecycle: &ContextLifecycle,
        lifecycle_revision: u64,
        epoch: &mut ConnectionEpoch,
        frame: ClientFrame,
    ) -> bool {
        let Some(dispatch_guard) = self
            .current_context_dispatch(context, lifecycle, lifecycle_revision)
            .await
        else {
            close(socket, 1008, "authenticated_context_revoked").await;
            return false;
        };
        let mut lifecycle_changes = lifecycle.revisions.subscribe();
        drop(dispatch_guard);

        // Returning the outcome before handling revocation drops the losing
        // request future first. That cancels cancellable adapter/RPC work before
        // context purge begins; an upstream side effect already accepted by the
        // remote process cannot be rolled back, but it cannot be committed to the
        // ledger or reported as successful after the revocation boundary.
        let outcome = tokio::select! {
            biased;
            () = wait_for_session_expiry(authorization) => FrameOutcome::SessionExpired,
            changed = lifecycle_changes.changed() => {
                let _ = changed;
                FrameOutcome::LifecycleRevoked
            }
            change = recv_authorization_change(
                authorization_changes,
                authorization.device_id(),
            ) => FrameOutcome::AuthorizationRevoked(
                change.unwrap_or("authorization_context_revoked"),
            ),
            handled = self.dispatch_frame(
                socket,
                authorization,
                context,
                lifecycle,
                lifecycle_revision,
                epoch,
                frame,
            ) => FrameOutcome::Handled(handled),
        };
        match outcome {
            FrameOutcome::Handled(handled) => handled,
            FrameOutcome::SessionExpired => {
                close(socket, 1008, "session_expired").await;
                false
            }
            FrameOutcome::LifecycleRevoked => {
                close(socket, 1008, "authenticated_context_revoked").await;
                false
            }
            FrameOutcome::AuthorizationRevoked(reason) => {
                let _ = self.purge_context(context).await;
                close(socket, 1008, reason).await;
                false
            }
        }
    }

    #[allow(clippy::too_many_arguments)]
    async fn dispatch_frame(
        &self,
        socket: &mut WebSocket,
        authorization: &AuthorizationContext,
        context: &AuthenticatedContextKey,
        lifecycle: &ContextLifecycle,
        lifecycle_revision: u64,
        epoch: &mut ConnectionEpoch,
        frame: ClientFrame,
    ) -> bool {
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
                #[cfg(feature = "e2e-command-fault")]
                if let Some(effect) = self
                    .intercept_e2e_surface_fault(super::super::E2ESurfaceFaultTarget::ThreadOpen)
                    .await
                {
                    let error = match effect {
                        super::super::E2ESurfaceFaultEffect::Continue => None,
                        super::super::E2ESurfaceFaultEffect::Fail(marker) => Some(
                            V2Error::source_unavailable(format!("App Server error: {marker}")),
                        ),
                        super::super::E2ESurfaceFaultEffect::NotFound => Some(V2Error {
                            code: super::super::protocol::ErrorCode::NotFound,
                            recovery: super::super::protocol::Recovery::Requery,
                            message: "requested thread was not found".into(),
                        }),
                        super::super::E2ESurfaceFaultEffect::ReplayUnavailable
                        | super::super::E2ESurfaceFaultEffect::InvalidCursor
                        | super::super::E2ESurfaceFaultEffect::VoiceRetry(_)
                        | super::super::E2ESurfaceFaultEffect::VoiceResult(_)
                        | super::super::E2ESurfaceFaultEffect::PortExpire { .. }
                        | super::super::E2ESurfaceFaultEffect::QueueUncertain(_) => Some(
                            V2Error::source_unavailable("E2E thread open action mismatch"),
                        ),
                    };
                    if let Some(error) = error {
                        return self
                            .send_frame(
                                socket,
                                &ServerFrame::ThreadWatchFailed { request_id, error },
                            )
                            .await
                            .is_ok();
                    }
                }
                let thread_install_lock = self
                    .thread_install_lock(epoch.generation, Some(&current.thread_id))
                    .await;
                let thread_install_guard = match &thread_install_lock {
                    Some(lock) => Some(lock.lock().await),
                    None => None,
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
                drop(thread_install_guard);
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
                    lifecycle,
                    lifecycle_revision,
                    epoch.generation,
                    request_id,
                    operation_id,
                    command,
                )
                .await
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
