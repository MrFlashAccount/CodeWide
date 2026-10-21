//! Task-addressed wait, completion delivery, and public snapshot projection.
//!
//! The durable journal owns coordination state while provider history remains
//! authoritative for final text and cost. Waiting is anchored to the calling
//! turn and acknowledges the fallback completion delivery exactly once.

use super::{
    Caller, OrchestrationService, ToolError,
    journal::TaskBundle,
    task::{PublicTaskStatus, RecoveryAction, TaskId, TaskSnapshot, TaskState},
    tools::TaskWaitRequest,
};
use crate::{
    agent::model::{AgentItem, ItemsView, MessagePhase, SortDirection, ThreadTurnsParams, TurnId},
    store::OutboxState,
};

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
                if matches!(
                    snapshot.status,
                    PublicTaskStatus::Succeeded
                        | PublicTaskStatus::Failed
                        | PublicTaskStatus::Cancelled
                ) {
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
        if matches!(
            snapshot.status,
            PublicTaskStatus::Succeeded | PublicTaskStatus::Failed | PublicTaskStatus::Cancelled
        ) {
            self.task_journal
                .acknowledge_delivery(task_id)
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
        let mut learned_provider_turn = false;
        if !bundle.task.state.is_terminal()
            && let Some(command) = self
                .turn_delivery
                .command(&bundle.attempt.command_id)
                .await
                .map_err(|error| ToolError::message(error.to_string()))?
        {
            if let (Some(turn_id), Some(child)) = (
                command.delivered_turn_id.as_deref().and_then(TurnId::parse),
                bundle.attempt.state.child_thread_id().cloned(),
            ) {
                self.tracker
                    .authorize(child.as_str(), bundle.task.provider.clone());
                self.tracker.register(
                    child.as_str(),
                    super::coordinator::watch::ChildState::Running {
                        turn_id: Some(turn_id.as_str().to_owned()),
                    },
                );
                if let Some(updated) = self
                    .task_journal
                    .observe_started(&bundle.task.provider, child.as_str(), turn_id)
                    .await
                    .map_err(ToolError::from)?
                {
                    learned_provider_turn = bundle.attempt.state.provider_turn_id().is_none();
                    bundle = updated;
                }
            }
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
        if bundle.task.state == TaskState::Cancelling && learned_provider_turn {
            self.resume_cancellation(&bundle).await?;
            bundle = self
                .task_journal
                .get(task_id)
                .await
                .map_err(ToolError::from)?;
        }
        if let Some(reconciled) = self.reconcile_authoritative_turn(&bundle).await? {
            bundle = reconciled;
        }
        let (final_message, cost) = if bundle.task.state.is_terminal() {
            self.terminal_payload(&bundle).await?
        } else {
            (None, None)
        };
        let status = match bundle.task.state {
            TaskState::ReconcilingStart => PublicTaskStatus::StartUncertain,
            TaskState::Cancelling => PublicTaskStatus::Cancelling,
            TaskState::Succeeded => PublicTaskStatus::Succeeded,
            TaskState::Failed => PublicTaskStatus::Failed,
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

    async fn terminal_payload(
        &self,
        bundle: &TaskBundle,
    ) -> Result<(Option<String>, Option<crate::agent::model::ProviderCost>), ToolError> {
        let (Some(child), Some(turn_id)) = (
            bundle.attempt.state.child_thread_id(),
            bundle.attempt.state.provider_turn_id(),
        ) else {
            return Ok((None, None));
        };
        let Some(provider) = self.gateway.registry().get(&bundle.task.provider) else {
            return Ok((None, None));
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
                    task_id = %bundle.task.task_id.as_str(),
                    "terminal delegated result payload is temporarily unreadable"
                );
                return Ok((None, None));
            }
        };
        let Some(turn) = turns
            .turns
            .into_iter()
            .find(|turn| &turn.turn_id == turn_id)
        else {
            return Ok((None, None));
        };
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
        Ok((message, cost))
    }

    pub(super) fn signal_tasks(&self) {
        let _ = self.task_signals.send(());
    }
}
