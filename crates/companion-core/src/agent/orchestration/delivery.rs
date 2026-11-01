//! Task-addressed wait, result acknowledgement, and public snapshot projection.
//!
//! The durable journal owns coordination state while provider history remains
//! authoritative for final text and cost. Waiting is anchored to the calling
//! turn; a terminal result it returns acknowledges the task's initial request
//! (and retracts a notice that is still queued).

use super::{
    Caller, OrchestrationService, ToolError,
    journal::TaskBundle,
    task::{
        PublicTaskStatus, RecoveryAction, TaskId, TaskSnapshot, TaskState, WorkspaceClaimState,
    },
    tools::TaskWaitRequest,
    work_requests::{AckSource, WorkRequestId},
};
use crate::{
    agent::model::{
        AgentItem, AppThreadId, ItemsView, MessagePhase, ProviderId, SortDirection,
        ThreadTurnsParams, TurnId, TurnStatus,
    },
    store::OutboxState,
    turn_delivery::retract_notice_in_write,
};

pub(super) enum TerminalPayload {
    Ready {
        message: Option<String>,
        cost: Option<crate::agent::model::ProviderCost>,
    },
    Unavailable,
}

impl TerminalPayload {
    fn into_parts(self) -> (Option<String>, Option<crate::agent::model::ProviderCost>) {
        match self {
            Self::Ready { message, cost } => (message, cost),
            Self::Unavailable => (None, None),
        }
    }
}

impl OrchestrationService {
    pub(super) async fn wait_task(
        &self,
        caller: &Caller,
        request: TaskWaitRequest,
    ) -> Result<TaskSnapshot, ToolError> {
        let admitted = self.authorize_task(caller, &request.task_id).await?;
        if let Err(error) = self.drive_task(&request.task_id).await {
            tracing::error!(
                err = ?error,
                task_id = %request.task_id.as_str(),
                "delegated task recovery failed after durable admission"
            );
            let _ = self
                .task_journal
                .mark_start_uncertain(&request.task_id)
                .await;
            self.signal_tasks();
            return self.task_snapshot(&request.task_id).await.or_else(|_| {
                Ok(super::coordinator::addressable_uncertain_snapshot(
                    &admitted,
                ))
            });
        }
        self.wait_task_loop(caller, &request.task_id, request.timeout)
            .await
    }

    pub(super) async fn wait_task_loop(
        &self,
        caller: &Caller,
        task_id: &TaskId,
        timeout: std::time::Duration,
    ) -> Result<TaskSnapshot, ToolError> {
        let mut task_events = self.task_signals.subscribe();
        let mut turn_ends = self.turn_ends.subscribe();
        let caller_turn = (
            caller.provider.descriptor().id,
            caller.thread.as_str().to_owned(),
            caller.turn.as_str().to_owned(),
        );
        let wait = async {
            loop {
                let snapshot = self.task_snapshot(task_id).await?;
                if snapshot.status.is_terminal() {
                    return Ok(snapshot);
                }
                tokio::select! {
                    _ = task_events.recv() => {}
                    event = turn_ends.recv() => {
                        if matches!(event, Ok((ref provider, ref thread, ref turn))
                            if provider == &caller_turn.0 && thread == &caller_turn.1 && turn == &caller_turn.2) {
                            return Ok(snapshot);
                        }
                    }
                }
            }
        };
        let snapshot = match tokio::time::timeout(timeout, wait).await {
            Ok(result) => result,
            Err(_) => self.task_snapshot(task_id).await,
        }?;
        if snapshot.status.is_terminal() {
            let bundle = self
                .task_journal
                .get(task_id)
                .await
                .map_err(ToolError::from)?;
            self.task_journal
                .acknowledge(
                    vec![WorkRequestId::from_delivery(&bundle.task.delivery_id)],
                    AckSource::WaitTask,
                    retract_notice_in_write,
                )
                .await
                .map_err(ToolError::from)?;
        }
        Ok(snapshot)
    }

    pub(super) async fn task_snapshot(&self, task_id: &TaskId) -> Result<TaskSnapshot, ToolError> {
        let mut bundle = self
            .task_journal
            .get(task_id)
            .await
            .map_err(ToolError::from)?;
        if !bundle.task.state.is_terminal()
            && let Some(command) = self
                .turn_delivery
                .command(&bundle.attempt.command_id)
                .await
                .map_err(|error| ToolError::message(error.to_string()))?
        {
            match command.state {
                OutboxState::Uncertain if !command.has_in_flight_claim() => {
                    bundle = self
                        .task_journal
                        .mark_start_uncertain(task_id)
                        .await
                        .map_err(ToolError::from)?;
                }
                OutboxState::Failed => {
                    bundle = self
                        .task_journal
                        .fail_task(task_id)
                        .await
                        .map_err(ToolError::from)?;
                }
                OutboxState::Queued | OutboxState::Delivered | OutboxState::Uncertain => {}
            }
        }
        if let Some(reconciled) = self.reconcile_authoritative_turn(&bundle).await? {
            bundle = reconciled;
        }
        let (final_message, cost) = if bundle.task.state.is_terminal() {
            self.terminal_payload(&bundle).await?.into_parts()
        } else {
            (None, None)
        };
        let status = match bundle.task.state {
            TaskState::ReconcilingStart => PublicTaskStatus::StartUncertain,
            TaskState::Cancelling => PublicTaskStatus::Cancelling,
            TaskState::Succeeded => PublicTaskStatus::Succeeded,
            TaskState::Failed => PublicTaskStatus::Failed,
            TaskState::Interrupted => PublicTaskStatus::Interrupted,
            TaskState::Cancelled => PublicTaskStatus::Cancelled,
            TaskState::Admitted
            | TaskState::PreparingWorkspace
            | TaskState::Starting
            | TaskState::Running => PublicTaskStatus::Running,
        };
        Ok(TaskSnapshot {
            task_id: bundle.task.task_id.as_str().to_owned(),
            attempt_id: bundle.attempt.attempt_id.as_str().to_owned(),
            provider: bundle.task.provider.as_str().to_owned(),
            model: bundle.task.model,
            agent_thread_id: bundle
                .attempt
                .state
                .child_thread_id()
                .map(|id| id.as_str().to_owned()),
            status,
            recovery: (status == PublicTaskStatus::StartUncertain)
                .then_some(RecoveryAction::WaitTask),
            final_message,
            cost,
        })
    }

    pub(super) async fn terminal_payload(
        &self,
        bundle: &TaskBundle,
    ) -> Result<TerminalPayload, ToolError> {
        if let WorkspaceClaimState::Failed { error, .. } = &bundle.workspace.state {
            return Ok(TerminalPayload::Ready {
                message: Some(error.clone()),
                cost: None,
            });
        }
        let (Some(child), Some(turn_id)) = (
            bundle.attempt.state.child_thread_id(),
            bundle.attempt.state.provider_turn_id(),
        ) else {
            return Ok(TerminalPayload::Ready {
                message: None,
                cost: None,
            });
        };
        Ok(self
            .turn_payload(&bundle.task.provider, child, turn_id)
            .await)
    }

    /// The final text and cost of one terminal provider turn, read from
    /// authoritative history.
    pub(super) async fn turn_payload(
        &self,
        provider: &ProviderId,
        child: &AppThreadId,
        turn_id: &TurnId,
    ) -> TerminalPayload {
        let Some(provider) = self.gateway.registry().get(provider) else {
            return TerminalPayload::Unavailable;
        };
        let turns = match provider
            .thread_turns(ThreadTurnsParams {
                app_thread_id: child.clone(),
                cursor: None,
                limit: 100,
                sort_direction: SortDirection::Desc,
                items_view: ItemsView::Full,
            })
            .await
        {
            Ok(turns) => turns,
            Err(error) => {
                tracing::warn!(
                    err = ?error,
                    child_thread_id = %child,
                    "terminal child result payload is temporarily unreadable"
                );
                return TerminalPayload::Unavailable;
            }
        };
        let Some(turn) = turns
            .turns
            .into_iter()
            .find(|turn| &turn.turn_id == turn_id)
        else {
            return TerminalPayload::Unavailable;
        };
        if turn.status == TurnStatus::InProgress {
            return TerminalPayload::Unavailable;
        }
        let mut final_answer = None;
        let mut commentary = None;
        for item in &turn.items {
            if let AgentItem::AgentMessage { text, phase, .. } = item {
                match phase {
                    MessagePhase::Final => final_answer = Some(text.clone()),
                    MessagePhase::Commentary => commentary = Some(text.clone()),
                }
            }
        }
        let message = final_answer
            .or(commentary)
            .or_else(|| turn.error.map(|error| error.message));
        let cost = turn.usage.and_then(|usage| usage.cost);
        TerminalPayload::Ready { message, cost }
    }

    pub(super) fn signal_tasks(&self) {
        let _ = self.task_signals.send(());
    }
}
