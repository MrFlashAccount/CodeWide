//! Runtime collaboration for durable delegation.
//!
//! The coordinator admits one durable task, obtains an optional isolated
//! workspace, creates exactly one child, binds the reserved initial turn to
//! the existing outbox, and projects task-addressed wait/cancel results. It
//! does not execute provider turns or persist prompts/final answers itself.

use std::{path::PathBuf, sync::Arc};

use serde_json::json;

use super::{
    Caller, OrchestrationService, ToolError,
    journal::{AdmissionRecord, TaskBundle},
    task::{
        AttemptId, AttemptState, CompletionDelivery, DeliveryId, DeliveryRoute, DeliveryState,
        HostProvenance, OrchestrationTask, PublicTaskStatus, RecoveryAction, TaskAttempt, TaskId,
        TaskSnapshot, TaskState, WaitMode, WorkspaceClaim, WorkspaceClaimId, WorkspaceClaimState,
    },
    tools::{DelegateRequest, SpawnRequest, WorkspaceRequest},
};
use crate::{
    agent::{
        client_wire::gateway::{ClientWireGateway, mint_app_thread_id},
        model::{
            AppThreadId, Capability, ERROR_INVALID_REQUEST, ProviderId, ThreadChange,
            ThreadSettings, ThreadUpdateParams, TurnId, thread_not_found_message,
        },
        provider::{AgentProvider, ProviderError},
    },
    turn_delivery::InitialTurnReservation,
    workspaces::WorkspacePhase,
};

mod admission_plan;
pub(super) mod watch;

use admission_plan::{call_key, request_hash, unix_time_ms};

pub(super) struct CallIdentity {
    pub provider: ProviderId,
    pub thread: AppThreadId,
    pub turn: TurnId,
    pub call_id: String,
    pub tool: String,
}

impl OrchestrationService {
    pub(super) async fn delegate(
        &self,
        caller: &Caller,
        identity: CallIdentity,
        request: DelegateRequest,
    ) -> Result<TaskSnapshot, ToolError> {
        let plan = self.plan_delegate(caller, &request).await?;
        let task_id = TaskId::new();
        let attempt_id = AttemptId::new();
        let delivery_id = DeliveryId::new();
        let workspace_claim_id = WorkspaceClaimId::new();
        let now = unix_time_ms();
        let call_key = call_key(&identity);
        let command_id = format!("task-turn-{call_key}");
        let request_hash = request_hash(&request)?;
        let turn_params = json!({
            "input": [{"type": "text", "text": request.prompt.clone(), "text_elements": []}],
            "model": plan.settings.model,
            "permissions": plan.settings.permission_profile,
        });
        let task = OrchestrationTask {
            task_id: task_id.clone(),
            parent_thread_id: caller.thread.clone(),
            root_thread_id: plan.root_thread_id,
            provenance: HostProvenance::AgentSelected,
            wait_mode: request.wait_mode,
            workspace_mode: plan.workspace_mode,
            state: TaskState::Admitted,
            authoritative_attempt_id: attempt_id.clone(),
            delivery_id: delivery_id.clone(),
            provider: plan.wire.descriptor.id.clone(),
            model: plan.settings.model.clone(),
            name: request.name,
            permission: plan.permission,
            workspace_claim_id: workspace_claim_id.clone(),
            created_at_ms: now,
            updated_at_ms: now,
        };
        let attempt = TaskAttempt {
            attempt_id,
            task_id: task_id.clone(),
            command_id: command_id.clone(),
            state: AttemptState::Admitted,
        };
        let delivery = CompletionDelivery {
            delivery_id,
            task_id: task_id.clone(),
            route: DeliveryRoute::AwaitingResume,
            state: DeliveryState::Pending,
            dedupe_key: format!("task-completion:{}", task_id.as_str()),
        };
        let workspace = WorkspaceClaim {
            claim_id: workspace_claim_id,
            mode: plan.workspace_mode,
            state: plan.claim_state,
        };
        let (_outcome, bundle) = self
            .task_journal
            .admit(AdmissionRecord {
                call_key,
                request_hash,
                initial_turn: InitialTurnReservation {
                    task_id: task_id.as_str().to_owned(),
                    command_id,
                    params: turn_params,
                    created_at_ms: now,
                },
                task,
                attempt,
                delivery,
                workspace,
            })
            .await
            .map_err(ToolError::from)?;
        if let Err(error) = self.drive_task(&bundle.task.task_id).await {
            tracing::error!(
                err = ?error,
                task_id = %bundle.task.task_id.as_str(),
                "delegated task drive failed after durable admission"
            );
            if self
                .task_journal
                .mark_start_uncertain(&bundle.task.task_id)
                .await
                .is_err()
            {
                self.signal_tasks();
                return Ok(addressable_uncertain_snapshot(&bundle));
            }
            self.signal_tasks();
            return self
                .task_snapshot(&bundle.task.task_id)
                .await
                .or_else(|_| Ok(addressable_uncertain_snapshot(&bundle)));
        }
        self.signal_tasks();
        if request.wait_mode == WaitMode::Blocking {
            return self
                .wait_task_loop(caller, &bundle.task.task_id, super::tools::MAX_WAIT)
                .await;
        }
        self.task_snapshot(&bundle.task.task_id).await
    }

    pub(super) async fn spawn_durable(
        &self,
        caller: &Caller,
        mut identity: CallIdentity,
        request: SpawnRequest,
    ) -> Result<super::tools::SpawnResult, ToolError> {
        let delegate_request = DelegateRequest {
            prompt: request.prompt,
            wait_mode: WaitMode::Deferred,
            provider: request.provider,
            model: request.model,
            name: request.name,
            permission_profile: request.permission_profile,
            workspace: WorkspaceRequest::CompatibilitySpawn { cwd: request.cwd },
        };
        // Older provider fixtures reused a call id across separate spawn
        // calls. Keep that compatibility surface separate from the strict
        // `delegate_task` authenticated-call identity.
        identity.call_id = format!("{}:{}", identity.call_id, request_hash(&delegate_request)?);
        let snapshot = self
            .delegate(caller, identity, delegate_request)
            .await
            .map_err(|error| match error {
                ToolError::Admission(rejection) => ToolError::message(rejection.message),
                other @ ToolError::Message(_) => other,
            })?;
        let task_id = TaskId::parse(&snapshot.task_id)
            .ok_or_else(|| ToolError::message("delegate returned an invalid task id"))?;
        let snapshot = self.wait_for_legacy_start(&task_id).await?;
        let agent_thread_id = snapshot.agent_thread_id.ok_or_else(|| {
            ToolError::message(format!(
                "agent task {} was accepted but its child thread start is uncertain; use codewide_wait_task",
                snapshot.task_id
            ))
        })?;
        Ok(super::tools::SpawnResult {
            agent_thread_id,
            provider: snapshot.provider,
            model: snapshot.model,
            model_label: None,
            status: super::tools::AgentStatus::Running,
        })
    }

    async fn wait_for_legacy_start(&self, task_id: &TaskId) -> Result<TaskSnapshot, ToolError> {
        let mut events = self.task_signals.subscribe();
        let wait = async {
            loop {
                let _ = self.task_snapshot(task_id).await?;
                let bundle = self
                    .task_journal
                    .get(task_id)
                    .await
                    .map_err(ToolError::from)?;
                if bundle.attempt.state.provider_turn_id().is_some()
                    || bundle.task.state.is_terminal()
                    || bundle.task.state == TaskState::ReconcilingStart
                {
                    return self.task_snapshot(task_id).await;
                }
                tokio::select! {
                    _ = events.recv() => {}
                    () = tokio::time::sleep(std::time::Duration::from_millis(10)) => {}
                }
            }
        };
        tokio::time::timeout(std::time::Duration::from_secs(30), wait)
            .await
            .map_err(|_| ToolError::message("agent first turn did not start before the timeout"))?
    }

    pub(super) async fn cancel_task(
        &self,
        caller: &Caller,
        task_id: &TaskId,
    ) -> Result<TaskSnapshot, ToolError> {
        let bundle = self.authorize_task(caller, task_id).await?;
        if bundle.task.state.is_terminal() || bundle.task.state == TaskState::Cancelling {
            return self.task_snapshot(task_id).await;
        }
        let _ = self.task_snapshot(task_id).await?;
        self.authorize_task(caller, task_id).await?;
        let bundle = self
            .task_journal
            .cancel_intent(task_id)
            .await
            .map_err(ToolError::from)?;
        if bundle.task.state == TaskState::Cancelled {
            let _ = self
                .turn_delivery
                .cancel_before_start(&bundle.attempt.command_id)
                .await
                .map_err(|error| ToolError::message(error.to_string()))?;
        } else {
            self.resume_cancellation(&bundle).await?;
        }
        self.signal_tasks();
        self.task_snapshot(task_id).await
    }

    pub(super) async fn authorize_task(
        &self,
        caller: &Caller,
        task_id: &TaskId,
    ) -> Result<TaskBundle, ToolError> {
        let mut bundle = self
            .task_journal
            .get(task_id)
            .await
            .map_err(ToolError::from)?;
        if let Some(reconciled) = self.reconcile_authoritative_turn(&bundle).await? {
            bundle = reconciled;
        }
        if bundle.task.parent_thread_id != caller.thread {
            return Err(ToolError::message(format!(
                "task not found: {}",
                task_id.as_str()
            )));
        }
        Ok(bundle)
    }

    pub(super) async fn drive_task(&self, task_id: &TaskId) -> Result<(), ToolError> {
        let lock = {
            let mut drives = self
                .task_drives
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner);
            drives
                .entry(task_id.as_str().to_owned())
                .or_insert_with(|| Arc::new(tokio::sync::Mutex::new(())))
                .clone()
        };
        let guard = lock.lock().await;
        let result = self.drive_task_inner(task_id).await;
        {
            let mut drives = self
                .task_drives
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner);
            if Arc::strong_count(&lock) == 2
                && drives
                    .get(task_id.as_str())
                    .is_some_and(|current| Arc::ptr_eq(current, &lock))
            {
                drives.remove(task_id.as_str());
            }
        }
        drop(guard);
        result
    }

    async fn drive_task_inner(&self, task_id: &TaskId) -> Result<(), ToolError> {
        let bundle = self
            .task_journal
            .get(task_id)
            .await
            .map_err(ToolError::from)?;
        if bundle.task.state.is_terminal() {
            return Ok(());
        }
        if bundle.task.state == TaskState::Cancelling {
            return self.resume_cancellation(&bundle).await;
        }
        let Some(bundle) = self.prepare_task_workspace(task_id, bundle).await? else {
            return Ok(());
        };
        let effective_cwd = effective_cwd(&bundle)?;
        self.start_task_attempt(task_id, bundle, &effective_cwd)
            .await
    }

    async fn prepare_task_workspace(
        &self,
        task_id: &TaskId,
        bundle: TaskBundle,
    ) -> Result<Option<TaskBundle>, ToolError> {
        let WorkspaceClaimState::Pending { source_workspace } = &bundle.workspace.state else {
            return Ok(Some(bundle));
        };
        let source_workspace = source_workspace.clone();
        self.task_journal
            .preparing_workspace(task_id)
            .await
            .map_err(ToolError::from)?;
        let Some(workspaces) = self.workspaces() else {
            return Ok(None);
        };
        let operation = workspaces
            .create_or_observe(
                PathBuf::from(&source_workspace),
                bundle.workspace.claim_id.as_str().to_owned(),
            )
            .await;
        let operation = match operation {
            Ok(operation) => operation,
            Err(error) => {
                tracing::error!(
                    err = ?error,
                    task_id = %task_id.as_str(),
                    "delegated task workspace creation failed"
                );
                self.fail_task_and_signal(task_id).await?;
                return Ok(None);
            }
        };
        if operation.phase == WorkspacePhase::Failed {
            self.fail_task_and_signal(task_id).await?;
            return Ok(None);
        }
        let Some(effective_cwd) = operation
            .workspace
            .as_ref()
            .map(|workspace| workspace.cwd.to_string_lossy().into_owned())
        else {
            self.fail_task_and_signal(task_id).await?;
            return Ok(None);
        };
        let ready = self
            .task_journal
            .workspace_ready(task_id, &source_workspace, &effective_cwd)
            .await
            .map_err(ToolError::from)?;
        Ok(Some(ready))
    }

    async fn start_task_attempt(
        &self,
        task_id: &TaskId,
        mut bundle: TaskBundle,
        effective_cwd: &str,
    ) -> Result<(), ToolError> {
        let Some(target) = self.gateway.registry().get(&bundle.task.provider).cloned() else {
            self.fail_task_and_signal(task_id).await?;
            return Ok(());
        };
        let wire = self.gateway.wire(&target);
        let settings = ThreadSettings {
            model: bundle.task.model.clone(),
            effort: None,
            permission_profile: bundle.task.permission.translated_profile.clone(),
            service_tier: None,
        };
        let mut announce = None;
        match &bundle.attempt.state {
            AttemptState::Admitted => {
                if target
                    .capabilities()
                    .supports(Capability::ThreadsHostMintedIds)
                {
                    let child = mint_app_thread_id();
                    bundle = self
                        .task_journal
                        .plan_child(task_id, child.clone())
                        .await
                        .map_err(ToolError::from)?;
                    announce = self
                        .create_task_child(
                            &bundle,
                            &target,
                            &wire,
                            Some(child),
                            effective_cwd,
                            &settings,
                        )
                        .await?;
                } else {
                    bundle = self
                        .task_journal
                        .provider_create_started(task_id)
                        .await
                        .map_err(ToolError::from)?;
                    announce = self
                        .create_task_child(&bundle, &target, &wire, None, effective_cwd, &settings)
                        .await?;
                }
            }
            AttemptState::ChildPlanned { child_thread_id } => {
                announce = self
                    .create_task_child(
                        &bundle,
                        &target,
                        &wire,
                        Some(child_thread_id.clone()),
                        effective_cwd,
                        &settings,
                    )
                    .await?;
            }
            AttemptState::CreatingProviderMinted => {
                self.task_journal
                    .mark_start_uncertain(task_id)
                    .await
                    .map_err(ToolError::from)?;
                self.signal_tasks();
                return Ok(());
            }
            AttemptState::ChildBound { child_thread_id }
            | AttemptState::Started {
                child_thread_id, ..
            } => {
                self.ensure_child_link(&bundle, child_thread_id, effective_cwd)
                    .await?;
                self.bind_turn(&bundle, child_thread_id).await?;
            }
            AttemptState::StartUncertain {
                child_thread_id: Some(child_thread_id),
            } => {
                let child_thread_id = child_thread_id.clone();
                (bundle, announce) = self
                    .recover_uncertain_child(
                        bundle,
                        &target,
                        &wire,
                        child_thread_id,
                        effective_cwd,
                        &settings,
                    )
                    .await?;
            }
            AttemptState::StartUncertain {
                child_thread_id: None,
            }
            | AttemptState::Terminal { .. } => return Ok(()),
        }
        self.finish_child_announcement(task_id, &bundle, &target, &wire, effective_cwd, announce)
            .await
    }

    async fn recover_uncertain_child(
        &self,
        mut bundle: TaskBundle,
        target: &Arc<dyn AgentProvider>,
        wire: &crate::agent::client_wire::WireProvider,
        child: AppThreadId,
        effective_cwd: &str,
        settings: &ThreadSettings,
    ) -> Result<
        (
            TaskBundle,
            Option<(crate::agent::model::AgentThread, AppThreadId)>,
        ),
        ToolError,
    > {
        let announce = match target.thread_read(&child).await {
            Ok(thread) => {
                self.gateway
                    .bind_created(&bundle.task.provider, child.as_str())
                    .await
                    .map_err(|error| ToolError::message(error.message))?;
                bundle = self
                    .task_journal
                    .bind_child(&bundle.task.task_id.clone(), child.clone())
                    .await
                    .map_err(ToolError::from)?;
                Some((thread.thread, child))
            }
            Err(ProviderError::Rejected(error))
                if error.code == ERROR_INVALID_REQUEST
                    && error.message == thread_not_found_message(child.as_str()) =>
            {
                self.create_task_child(&bundle, target, wire, Some(child), effective_cwd, settings)
                    .await?
            }
            Err(_) => None,
        };
        Ok((bundle, announce))
    }

    async fn finish_child_announcement(
        &self,
        task_id: &TaskId,
        bundle: &TaskBundle,
        target: &Arc<dyn AgentProvider>,
        wire: &crate::agent::client_wire::WireProvider,
        effective_cwd: &str,
        announce: Option<(crate::agent::model::AgentThread, AppThreadId)>,
    ) -> Result<(), ToolError> {
        let Some((thread, child)) = announce else {
            return Ok(());
        };
        self.ensure_child_link(bundle, &child, effective_cwd)
            .await?;
        let (_, started) = ClientWireGateway::started_thread(&thread, wire);
        let _ = self.journal.send(started).await;
        if let Some(name) = &bundle.task.name
            && let Err(error) = target
                .thread_update(ThreadUpdateParams {
                    app_thread_id: child.clone(),
                    change: ThreadChange::Name {
                        name: Some(name.clone()),
                    },
                })
                .await
        {
            tracing::warn!(
                err = ?error,
                task_id = %task_id.as_str(),
                "delegated child name update failed"
            );
        }
        let current = self
            .task_journal
            .get(task_id)
            .await
            .map_err(ToolError::from)?;
        if current.task.state == TaskState::Cancelling || current.task.state == TaskState::Cancelled
        {
            return self.resume_cancellation(&current).await;
        }
        self.bind_turn(&current, &child).await
    }

    async fn fail_task_and_signal(&self, task_id: &TaskId) -> Result<(), ToolError> {
        self.task_journal
            .fail_task(task_id)
            .await
            .map_err(ToolError::from)?;
        self.signal_tasks();
        Ok(())
    }

    pub(super) async fn resume_cancellation(&self, bundle: &TaskBundle) -> Result<(), ToolError> {
        if let (Some(child), Some(turn)) = (
            bundle.attempt.state.child_thread_id(),
            bundle.attempt.state.provider_turn_id(),
        ) {
            let Some(provider) = self.gateway.registry().get(&bundle.task.provider).cloned() else {
                return Ok(());
            };
            if let Err(error) = provider
                .turn_interrupt(crate::agent::model::TurnInterruptParams {
                    app_thread_id: child.clone(),
                    turn_id: Some(turn.clone()),
                })
                .await
            {
                tracing::warn!(
                    err = ?error,
                    task_id = %bundle.task.task_id.as_str(),
                    "delegated task cancellation recovery was not accepted"
                );
            }
            return Ok(());
        }
        if self
            .turn_delivery
            .cancel_before_start(&bundle.attempt.command_id)
            .await
            .map_err(|error| ToolError::message(error.to_string()))?
        {
            self.task_journal
                .cancelled_before_start(&bundle.task.task_id)
                .await
                .map_err(ToolError::from)?;
            self.signal_tasks();
        }
        Ok(())
    }

    fn workspaces(&self) -> Option<Arc<crate::workspaces::WorkspaceService>> {
        match self.workspaces.read() {
            Ok(slot) => slot.clone(),
            Err(poisoned) => poisoned.into_inner().clone(),
        }
    }
}

fn effective_cwd(bundle: &TaskBundle) -> Result<String, ToolError> {
    match &bundle.workspace.state {
        WorkspaceClaimState::Shared { effective_cwd }
        | WorkspaceClaimState::Ready { effective_cwd, .. } => Ok(effective_cwd.clone()),
        WorkspaceClaimState::Pending { .. } => Err(ToolError::message("workspace is not ready")),
        WorkspaceClaimState::Failed { error, .. } => Err(ToolError::message(error.clone())),
    }
}

pub(super) fn addressable_uncertain_snapshot(bundle: &TaskBundle) -> TaskSnapshot {
    TaskSnapshot {
        task_id: bundle.task.task_id.as_str().to_owned(),
        attempt_id: bundle.attempt.attempt_id.as_str().to_owned(),
        provider: bundle.task.provider.as_str().to_owned(),
        model: bundle.task.model.clone(),
        agent_thread_id: bundle
            .attempt
            .state
            .child_thread_id()
            .map(|thread| thread.as_str().to_owned()),
        status: PublicTaskStatus::StartUncertain,
        recovery: Some(RecoveryAction::WaitTask),
        final_message: None,
        cost: None,
    }
}
