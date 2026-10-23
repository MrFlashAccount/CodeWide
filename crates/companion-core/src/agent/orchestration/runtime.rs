//! Provider runtime binding and authoritative turn reconciliation.
//!
//! This module owns the boundary from a durable task attempt to one provider
//! child and its initial turn. Task transitions remain in `task`; durable
//! persistence remains in `journal`.

use std::sync::Arc;

use super::{
    OrchestrationService, ToolError,
    children::ChildLink,
    coordinator::watch::ChildState,
    journal::TaskBundle,
    task::{TaskState, WorkspaceMode},
};
use crate::agent::{
    client_wire::{gateway::RpcFailure, observe::TurnEnd},
    model::{
        AppThreadId, ItemsView, SortDirection, ThreadSettings, ThreadTurnsParams, TurnId,
        TurnStatus,
    },
    provider::AgentProvider,
};

impl OrchestrationService {
    /// Reconciles one persisted provider turn against authoritative provider
    /// history. Startup recovery and task reads both use this path so a
    /// missed live terminal event cannot strand a task in running.
    pub(super) async fn reconcile_authoritative_turn(
        &self,
        bundle: &TaskBundle,
    ) -> Result<Option<TaskBundle>, ToolError> {
        let (Some(child), Some(turn_id)) = (
            bundle.attempt.state.child_thread_id(),
            bundle.attempt.state.provider_turn_id(),
        ) else {
            return Ok(None);
        };
        let Some(provider) = self.gateway.registry().get(&bundle.task.provider) else {
            return Ok(None);
        };
        let turns = match provider
            .thread_turns(ThreadTurnsParams {
                app_thread_id: child.clone(),
                cursor: None,
                limit: 100,
                sort_direction: SortDirection::Desc,
                items_view: ItemsView::NotLoaded,
            })
            .await
        {
            Ok(turns) => turns,
            Err(error) => {
                tracing::warn!(
                    err = ?error,
                    task_id = %bundle.task.task_id.as_str(),
                    "authoritative delegated turn is temporarily unreadable"
                );
                return Ok(None);
            }
        };
        let Some(turn) = turns
            .turns
            .into_iter()
            .find(|turn| &turn.turn_id == turn_id)
        else {
            return Ok(None);
        };
        let end = match turn.status {
            TurnStatus::InProgress => return Ok(None),
            TurnStatus::Completed => TurnEnd::Completed,
            TurnStatus::Failed => TurnEnd::Failed,
            TurnStatus::Interrupted => TurnEnd::Interrupted,
        };
        let terminal = self
            .task_journal
            .observe_terminal(&bundle.task.provider, child.as_str(), turn_id.clone(), end)
            .await
            .map_err(ToolError::from)?;
        if terminal.is_some() {
            self.tracker
                .authorize(child.as_str(), bundle.task.provider.clone());
            self.tracker.register(
                child.as_str(),
                ChildState::Settled {
                    end,
                    turn_id: Some(turn_id.as_str().to_owned()),
                    final_message: None,
                },
            );
            let released = self
                .turn_delivery
                .release_queued_for_thread(child.as_str())
                .await
                .map_err(|error| ToolError::message(error.to_string()))?;
            if released.is_some() {
                self.tracker.queued_after(child.as_str(), turn_id.as_str());
            }
            if self.turn_ends.receiver_count() > 0 {
                let _ = self.turn_ends.send((
                    bundle.task.provider.clone(),
                    child.as_str().to_owned(),
                    turn_id.as_str().to_owned(),
                ));
            }
            self.signal_tasks();
        }
        Ok(terminal)
    }

    pub(super) async fn create_task_child(
        &self,
        bundle: &TaskBundle,
        target: &Arc<dyn AgentProvider>,
        wire: &crate::agent::client_wire::WireProvider,
        app_thread_id: Option<AppThreadId>,
        cwd: &str,
        settings: &ThreadSettings,
    ) -> Result<Option<(crate::agent::model::AgentThread, AppThreadId)>, ToolError> {
        match self
            .gateway
            .create_thread_with_id(
                target,
                wire,
                app_thread_id,
                cwd.to_owned(),
                settings.clone(),
                bundle.task.permission.execution_policy.as_ref(),
            )
            .await
        {
            Ok(thread) => {
                let child = thread.app_thread_id.clone();
                self.profiles.record_created(
                    &wire.descriptor.id,
                    child.as_str(),
                    &settings.permission_profile,
                    bundle.task.permission.execution_policy.clone(),
                );
                self.task_journal
                    .bind_child(&bundle.task.task_id, child.clone())
                    .await
                    .map_err(ToolError::from)?;
                Ok(Some((thread, child)))
            }
            Err(failure) if uncertain(&failure) => {
                self.task_journal
                    .mark_start_uncertain(&bundle.task.task_id)
                    .await
                    .map_err(ToolError::from)?;
                self.signal_tasks();
                Ok(None)
            }
            Err(failure) => {
                tracing::error!(
                    code = failure.code,
                    task_id = %bundle.task.task_id.as_str(),
                    "delegated task child creation failed"
                );
                self.task_journal
                    .fail_task(&bundle.task.task_id)
                    .await
                    .map_err(ToolError::from)?;
                self.signal_tasks();
                Ok(None)
            }
        }
    }

    pub(super) async fn ensure_child_link(
        &self,
        bundle: &TaskBundle,
        child: &AppThreadId,
        cwd: &str,
    ) -> Result<(), ToolError> {
        let link = ChildLink::new(
            bundle.task.parent_thread_id.as_str().to_owned(),
            child.as_str().to_owned(),
            bundle.task.provider.clone(),
            bundle.task.model.clone(),
            bundle.task.name.clone(),
            cwd.to_owned(),
        )
        .with_task(bundle.task.task_id.as_str().to_owned());
        self.links.link(&link).await.map_err(ToolError::from)?;
        self.tracker
            .authorize(child.as_str(), bundle.task.provider.clone());
        Ok(())
    }

    pub(super) async fn bind_turn(
        &self,
        bundle: &TaskBundle,
        child: &AppThreadId,
    ) -> Result<(), ToolError> {
        let workspace_request_id = (bundle.task.workspace_mode == WorkspaceMode::IsolatedWrite)
            .then(|| bundle.workspace.claim_id.as_str());
        let command = match self
            .turn_delivery
            .bind_initial_turn(
                &bundle.attempt.command_id,
                child.as_str(),
                workspace_request_id,
            )
            .await
        {
            Ok(command) => command,
            Err(error) => {
                let current = self
                    .task_journal
                    .get(&bundle.task.task_id)
                    .await
                    .map_err(ToolError::from)?;
                if matches!(
                    current.task.state,
                    TaskState::Cancelling | TaskState::Cancelled
                ) {
                    self.resume_cancellation(&current).await?;
                    return Ok(());
                }
                return Err(ToolError::message(error.to_string()));
            }
        };
        let mut current = self
            .task_journal
            .get(&bundle.task.task_id)
            .await
            .map_err(ToolError::from)?;
        if current.task.state == TaskState::Cancelling {
            if let Some(turn_id) = command.delivered_turn_id.as_deref().and_then(TurnId::parse) {
                current = self
                    .task_journal
                    .observe_started(&bundle.task.provider, child.as_str(), turn_id)
                    .await
                    .map_err(ToolError::from)?
                    .unwrap_or(current);
            }
            self.resume_cancellation(&current).await?;
            return Ok(());
        }
        self.task_journal
            .turn_queued(&bundle.task.task_id)
            .await
            .map_err(ToolError::from)?;
        if let Some(turn_id) = command.delivered_turn_id.as_deref().and_then(TurnId::parse) {
            let _ = self
                .task_journal
                .observe_started(&bundle.task.provider, child.as_str(), turn_id)
                .await
                .map_err(ToolError::from)?;
        }
        let current = self
            .task_journal
            .get(&bundle.task.task_id)
            .await
            .map_err(ToolError::from)?;
        let _ = self.reconcile_authoritative_turn(&current).await?;
        self.signal_tasks();
        Ok(())
    }
}

fn uncertain(failure: &RpcFailure) -> bool {
    matches!(failure.code, -32_003 | -32_004 | -32_020)
}
