//! Provider runtime binding and authoritative turn reconciliation.
//!
//! This module owns the boundary from a durable task attempt to one provider
//! child and its initial turn. Task transitions remain in `task`; durable
//! persistence remains in `journal`.

use std::sync::Arc;

use super::{
    OrchestrationService, ToolError,
    children::ChildLink,
    journal::TaskBundle,
    task::{TaskState, WorkspaceMode},
};
use crate::agent::{
    client_wire::gateway::RpcFailure,
    model::{AppThreadId, ThreadSettings},
    provider::AgentProvider,
};

impl OrchestrationService {
    /// Reconciles a task's initial request against authoritative provider
    /// history (one read of its child). Task reads use this path so a missed
    /// live terminal event cannot strand a task in running.
    pub(super) async fn reconcile_authoritative_turn(
        &self,
        bundle: &TaskBundle,
    ) -> Result<Option<TaskBundle>, ToolError> {
        if !bundle.task.state.is_terminal()
            && bundle.request.is_open()
            && bundle.request.turn_id().is_some()
            && let Some(child) = &bundle.request.child_thread_id
        {
            self.reconcile_child(child, std::slice::from_ref(&bundle.request))
                .await;
        }
        // Another observer or the delivery loop can win the terminal
        // transition after this caller read `bundle`. Return the durable
        // winner instead of projecting a stale running state.
        let current = self
            .task_journal
            .get(&bundle.task.task_id)
            .await
            .map_err(ToolError::from)?;
        Ok(current.task.state.is_terminal().then_some(current))
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
        if let Err(error) = self
            .turn_delivery
            .bind_initial_turn(
                &bundle.attempt.command_id,
                child.as_str(),
                workspace_request_id,
            )
            .await
        {
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
        let current = self
            .task_journal
            .get(&bundle.task.task_id)
            .await
            .map_err(ToolError::from)?;
        if current.task.state == TaskState::Cancelling {
            self.resume_cancellation(&current).await?;
            return Ok(());
        }
        // The provider turn is learned only from this command's delivery
        // receipt, which binds the request inside the receipt transaction.
        self.task_journal
            .turn_queued(&bundle.task.task_id)
            .await
            .map_err(ToolError::from)?;
        self.signal_tasks();
        Ok(())
    }
}

fn uncertain(failure: &RpcFailure) -> bool {
    matches!(failure.code, -32_003 | -32_004 | -32_020)
}
