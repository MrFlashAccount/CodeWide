//! Durable orchestration journal and terminal compare-and-set owner.
//!
//! Records contain coordination metadata and references only. The initial
//! prompt is held by the turn-delivery reservation table and later moved to
//! the existing outbox; final text remains in provider history.

use std::{sync::Arc, time::SystemTime};

use redb::{ReadableDatabase, ReadableTable};
use serde::{Deserialize, Serialize};

use super::task::{
    CompletionDelivery, DeliveryState, OrchestrationTask, TaskAttempt, TaskEvent, TaskEventKind,
    TaskId, TaskState, TaskTransition, WorkspaceClaim, WorkspaceClaimState,
};
use crate::{
    agent::{
        client_wire::observe::TurnEnd,
        model::{AppThreadId, ProviderId, TurnId},
    },
    store::{IndexStore, StoreError, orchestration_tables},
    turn_delivery::{InitialTurnReservation, reserve_initial_turn},
};

#[derive(Debug, thiserror::Error)]
pub enum JournalError {
    #[error(transparent)]
    Store(#[from] StoreError),
    #[error("orchestration record is invalid: {0}")]
    Invalid(#[from] serde_json::Error),
    #[error("orchestration journal worker failed: {0}")]
    Worker(String),
    #[error("task not found: {0}")]
    NotFound(String),
    #[error("tool call identity was reused with different arguments")]
    CallConflict,
    #[error("task transition is invalid: {0}")]
    InvalidTransition(String),
}

macro_rules! redb_error {
    ($type:ty) => {
        impl From<$type> for JournalError {
            fn from(error: $type) -> Self {
                Self::Store(StoreError::from(error))
            }
        }
    };
}

redb_error!(redb::TransactionError);
redb_error!(redb::TableError);
redb_error!(redb::StorageError);
redb_error!(redb::CommitError);

#[derive(Clone, Debug)]
pub struct TaskBundle {
    pub task: OrchestrationTask,
    pub attempt: TaskAttempt,
    pub delivery: CompletionDelivery,
    pub workspace: WorkspaceClaim,
}

#[derive(Clone, Debug)]
pub struct AdmissionRecord {
    pub call_key: String,
    pub request_hash: String,
    pub(crate) initial_turn: InitialTurnReservation,
    pub task: OrchestrationTask,
    pub attempt: TaskAttempt,
    pub delivery: CompletionDelivery,
    pub workspace: WorkspaceClaim,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum AdmitOutcome {
    Created,
    Existing,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct CallRecord {
    task_id: TaskId,
    request_hash: String,
}

#[derive(Clone)]
pub struct TaskJournal {
    store: Arc<IndexStore>,
}

impl TaskJournal {
    #[must_use]
    pub const fn new(store: Arc<IndexStore>) -> Self {
        Self { store }
    }

    async fn blocking<T: Send + 'static>(
        &self,
        work: impl FnOnce(&IndexStore) -> Result<T, JournalError> + Send + 'static,
    ) -> Result<T, JournalError> {
        let store = self.store.clone();
        tokio::task::spawn_blocking(move || work(&store))
            .await
            .map_err(|error| JournalError::Worker(error.to_string()))?
    }

    /// Creates one task, attempt, delivery, workspace claim and initial-turn
    /// reservation in one transaction. Repeating an authenticated call
    /// identity returns the existing task only when its validated request
    /// hash also matches. Prompt bytes remain exclusively in the
    /// turn-delivery reservation table.
    ///
    /// # Errors
    ///
    /// Returns a journal error when the durable transaction fails, the record
    /// is invalid, or a call identity is reused with different arguments.
    pub async fn admit(
        &self,
        record: AdmissionRecord,
    ) -> Result<(AdmitOutcome, TaskBundle), JournalError> {
        let (outcome, task_id) = self
            .blocking(move |store| {
                let write = store.database().begin_write()?;
                let outcome = {
                    let mut calls = write.open_table(orchestration_tables::CALLS)?;
                    if let Some(encoded) = calls.get(record.call_key.as_str())? {
                        let existing: CallRecord = serde_json::from_slice(encoded.value())?;
                        if existing.request_hash != record.request_hash {
                            return Err(JournalError::CallConflict);
                        }
                        (AdmitOutcome::Existing, existing.task_id)
                    } else {
                        if record.initial_turn.task_id != record.task.task_id.as_str()
                            || record.initial_turn.command_id != record.attempt.command_id
                        {
                            return Err(JournalError::InvalidTransition(
                                "initial turn reservation does not belong to the admitted task"
                                    .into(),
                            ));
                        }
                        reserve_initial_turn(&write, &record.initial_turn)?;
                        let call = CallRecord {
                            task_id: record.task.task_id.clone(),
                            request_hash: record.request_hash,
                        };
                        calls.insert(
                            record.call_key.as_str(),
                            serde_json::to_vec(&call)?.as_slice(),
                        )?;
                        write.open_table(orchestration_tables::TASKS)?.insert(
                            record.task.task_id.as_str(),
                            serde_json::to_vec(&record.task)?.as_slice(),
                        )?;
                        write.open_table(orchestration_tables::ATTEMPTS)?.insert(
                            record.attempt.attempt_id.as_str(),
                            serde_json::to_vec(&record.attempt)?.as_slice(),
                        )?;
                        write.open_table(orchestration_tables::DELIVERIES)?.insert(
                            record.delivery.delivery_id.as_str(),
                            serde_json::to_vec(&record.delivery)?.as_slice(),
                        )?;
                        write
                            .open_table(orchestration_tables::WORKSPACE_CLAIMS)?
                            .insert(
                                record.workspace.claim_id.as_str(),
                                serde_json::to_vec(&record.workspace)?.as_slice(),
                            )?;
                        insert_event(&write, &record.task.task_id, 1, TaskEventKind::Admitted)?;
                        (AdmitOutcome::Created, record.task.task_id.clone())
                    }
                };
                write.commit()?;
                Ok(outcome)
            })
            .await?;
        Ok((outcome, self.get(&task_id).await?))
    }

    /// Reads one complete task coordination snapshot.
    ///
    /// # Errors
    ///
    /// Returns a journal error when the task is absent or its durable records
    /// cannot be read or decoded.
    pub async fn get(&self, task_id: &TaskId) -> Result<TaskBundle, JournalError> {
        let task_id = task_id.clone();
        self.blocking(move |store| read_bundle(store, &task_id))
            .await
    }

    /// Returns every non-terminal task for restart recovery.
    ///
    /// # Errors
    ///
    /// Returns a journal error when durable task records cannot be read or
    /// decoded.
    pub async fn pending(&self) -> Result<Vec<TaskId>, JournalError> {
        self.blocking(move |store| {
            let read = store.database().begin_read()?;
            let table = read.open_table(orchestration_tables::TASKS)?;
            let mut tasks = Vec::new();
            for entry in table.iter()? {
                let (_key, value) = entry?;
                let task: OrchestrationTask = serde_json::from_slice(value.value())?;
                if !task.state.is_terminal() {
                    tasks.push(task.task_id);
                }
            }
            Ok(tasks)
        })
        .await
    }

    /// Records the isolated workspace selected for a task.
    ///
    /// # Errors
    ///
    /// Returns a journal error when the task is absent or the durable
    /// transition cannot be committed.
    pub async fn workspace_ready(
        &self,
        task_id: &TaskId,
        source_workspace: &str,
        effective_cwd: &str,
    ) -> Result<TaskBundle, JournalError> {
        let task_id = task_id.clone();
        let source_workspace = source_workspace.to_owned();
        let effective_cwd = effective_cwd.to_owned();
        self.mutate(task_id, move |task, _attempt, _delivery, workspace| {
            if task.state.is_terminal() || task.state == TaskState::Cancelling {
                return Ok(None);
            }
            workspace.state = WorkspaceClaimState::Ready {
                source_workspace,
                effective_cwd,
            };
            task.transition(TaskTransition::WorkspaceReady)
                .map_err(JournalError::InvalidTransition)?;
            Ok(Some(TaskEventKind::WorkspaceReady))
        })
        .await
    }

    /// Marks a task as preparing its isolated workspace.
    ///
    /// # Errors
    ///
    /// Returns a journal error when the task is absent or the durable
    /// transition cannot be committed.
    pub async fn preparing_workspace(&self, task_id: &TaskId) -> Result<TaskBundle, JournalError> {
        let task_id = task_id.clone();
        self.mutate(task_id, |task, _attempt, _delivery, _workspace| {
            task.transition(TaskTransition::PrepareWorkspace)
                .map_err(JournalError::InvalidTransition)?;
            Ok(None)
        })
        .await
    }

    /// Persists a host-minted child id before provider creation.
    ///
    /// # Errors
    ///
    /// Returns a journal error when the task is absent or the durable
    /// transition cannot be committed.
    pub async fn plan_child(
        &self,
        task_id: &TaskId,
        child_thread_id: AppThreadId,
    ) -> Result<TaskBundle, JournalError> {
        let task_id = task_id.clone();
        self.mutate(task_id, move |task, attempt, _delivery, _workspace| {
            attempt
                .plan_child(child_thread_id)
                .map_err(JournalError::InvalidTransition)?;
            task.transition(TaskTransition::ChildBound)
                .map_err(JournalError::InvalidTransition)?;
            Ok(None)
        })
        .await
    }

    /// Records the non-repeatable provider-minted create boundary.
    ///
    /// # Errors
    ///
    /// Returns a journal error when the task is absent or the durable
    /// transition cannot be committed.
    pub async fn provider_create_started(
        &self,
        task_id: &TaskId,
    ) -> Result<TaskBundle, JournalError> {
        let task_id = task_id.clone();
        self.mutate(task_id, |task, attempt, _delivery, _workspace| {
            attempt
                .begin_provider_create()
                .map_err(JournalError::InvalidTransition)?;
            task.transition(TaskTransition::ChildBound)
                .map_err(JournalError::InvalidTransition)?;
            Ok(None)
        })
        .await
    }

    /// Binds the created child thread to its authoritative attempt.
    ///
    /// # Errors
    ///
    /// Returns a journal error when the task is absent, the child id is
    /// invalid, or the durable transition cannot be committed.
    pub async fn bind_child(
        &self,
        task_id: &TaskId,
        child_thread_id: AppThreadId,
    ) -> Result<TaskBundle, JournalError> {
        let task_id = task_id.clone();
        self.mutate_with_child(task_id, child_thread_id, |task, _attempt| {
            task.transition(TaskTransition::ChildBound)
                .map_err(JournalError::InvalidTransition)?;
            Ok(TaskEventKind::ChildBound)
        })
        .await
    }

    /// Records that the reserved initial turn reached the durable outbox.
    ///
    /// # Errors
    ///
    /// Returns a journal error when the task is absent or the durable
    /// transition cannot be committed.
    pub async fn turn_queued(&self, task_id: &TaskId) -> Result<TaskBundle, JournalError> {
        let task_id = task_id.clone();
        self.mutate(task_id, |task, _attempt, _delivery, _workspace| {
            if matches!(task.state, TaskState::Running | TaskState::Cancelling) {
                return Ok(None);
            }
            task.transition(TaskTransition::TurnQueued)
                .map_err(JournalError::InvalidTransition)?;
            Ok(Some(TaskEventKind::TurnQueued))
        })
        .await
    }

    /// Moves an unrecoverable create ambiguity into reconciliation state.
    ///
    /// # Errors
    ///
    /// Returns a journal error when the task is absent or the durable
    /// transition cannot be committed.
    pub async fn mark_start_uncertain(&self, task_id: &TaskId) -> Result<TaskBundle, JournalError> {
        let task_id = task_id.clone();
        self.mutate(task_id, |task, attempt, _delivery, _workspace| {
            if task.state.is_terminal() || task.state == TaskState::Cancelling {
                return Ok(None);
            }
            if !attempt.mark_start_uncertain() {
                return Ok(None);
            }
            task.transition(TaskTransition::StartUncertain)
                .map_err(JournalError::InvalidTransition)?;
            Ok(Some(TaskEventKind::StartUncertain))
        })
        .await
    }

    /// Applies a provider turn-start receipt to the indexed task, if any.
    ///
    /// # Errors
    ///
    /// Returns a journal error when indexed records are invalid or the durable
    /// transition cannot be committed.
    pub async fn observe_started(
        &self,
        provider: &ProviderId,
        child_thread_id: &str,
        provider_turn_id: TurnId,
    ) -> Result<Option<TaskBundle>, JournalError> {
        let Some(task_id) = self.task_for_child(child_thread_id).await? else {
            return Ok(None);
        };
        if self.get(&task_id).await?.task.provider != *provider {
            return Ok(None);
        }
        let child_thread_id = AppThreadId::parse(child_thread_id).ok_or_else(|| {
            JournalError::InvalidTransition("child index contains an invalid thread id".into())
        })?;
        let bundle = self
            .mutate(task_id, move |task, attempt, _delivery, _workspace| {
                if task.state.is_terminal() {
                    return Ok(None);
                }
                let changed = attempt
                    .observe_started(child_thread_id, provider_turn_id)
                    .map_err(JournalError::InvalidTransition)?;
                if !changed {
                    return Ok(None);
                }
                task.transition(TaskTransition::TurnStarted)
                    .map_err(JournalError::InvalidTransition)?;
                Ok(Some(TaskEventKind::TurnStarted))
            })
            .await?;
        Ok(Some(bundle))
    }

    /// Applies the first matching provider terminal receipt atomically.
    ///
    /// # Errors
    ///
    /// Returns a journal error when indexed records are invalid or the durable
    /// terminal transition cannot be committed.
    pub async fn observe_terminal(
        &self,
        provider: &ProviderId,
        child_thread_id: &str,
        provider_turn_id: TurnId,
        end: TurnEnd,
    ) -> Result<Option<TaskBundle>, JournalError> {
        let Some(task_id) = self.task_for_child(child_thread_id).await? else {
            return Ok(None);
        };
        if self.get(&task_id).await?.task.provider != *provider {
            return Ok(None);
        }
        let child_thread_id = AppThreadId::parse(child_thread_id).ok_or_else(|| {
            JournalError::InvalidTransition("child index contains an invalid thread id".into())
        })?;
        let read_id = task_id.clone();
        let changed = self
            .blocking(move |store| {
                let write = store.database().begin_write()?;
                let mut bundle = read_bundle_from_write(&write, &task_id)?;
                if bundle.task.state.is_terminal() {
                    write.commit()?;
                    return Ok(false);
                }
                if !bundle
                    .attempt
                    .observe_terminal(child_thread_id, provider_turn_id)
                    .map_err(JournalError::InvalidTransition)?
                {
                    write.commit()?;
                    return Ok(false);
                }
                let transition = match end {
                    TurnEnd::Completed => TaskTransition::Succeeded,
                    TurnEnd::Failed => TaskTransition::Failed,
                    TurnEnd::Interrupted => TaskTransition::Cancelled,
                };
                bundle
                    .task
                    .transition(transition)
                    .map_err(JournalError::InvalidTransition)?;
                bundle.delivery.state = DeliveryState::AwaitingResume;
                bundle.task.updated_at_ms = unix_time_ms();
                write_bundle(&write, &bundle)?;
                append_next_event(&write, &task_id, TaskEventKind::AttemptTerminal)?;
                append_next_event(&write, &task_id, TaskEventKind::TaskTerminal)?;
                write.commit()?;
                Ok(true)
            })
            .await?;
        if changed {
            Ok(Some(self.get(&read_id).await?))
        } else {
            Ok(None)
        }
    }

    /// Records a definite post-admission task failure.
    ///
    /// # Errors
    ///
    /// Returns a journal error when the task is absent or the durable
    /// transition cannot be committed.
    pub async fn fail_task(&self, task_id: &TaskId) -> Result<TaskBundle, JournalError> {
        let task_id = task_id.clone();
        let bundle = self
            .mutate(task_id, |task, _attempt, delivery, _workspace| {
                if task.state.is_terminal() {
                    return Ok(None);
                }
                task.transition(TaskTransition::Failed)
                    .map_err(JournalError::InvalidTransition)?;
                delivery.state = DeliveryState::AwaitingResume;
                Ok(Some(TaskEventKind::TaskTerminal))
            })
            .await?;
        Ok(bundle)
    }

    /// Records idempotent cancellation intent without claiming provider exit.
    ///
    /// # Errors
    ///
    /// Returns a journal error when the task is absent or the durable
    /// transition cannot be committed.
    pub async fn cancel_intent(&self, task_id: &TaskId) -> Result<TaskBundle, JournalError> {
        let task_id = task_id.clone();
        self.mutate(task_id, |task, _attempt, delivery, _workspace| {
            if task.state.is_terminal() {
                return Ok(None);
            }
            task.transition(TaskTransition::CancelRequested)
                .map_err(JournalError::InvalidTransition)?;
            if task.state == TaskState::Cancelled {
                delivery.state = DeliveryState::AwaitingResume;
            }
            Ok(Some(TaskEventKind::CancelRequested))
        })
        .await
    }

    /// Finalizes cancellation when the initial turn was removed before start.
    ///
    /// # Errors
    ///
    /// Returns a journal error when the task is absent or the durable
    /// transition cannot be committed.
    pub async fn cancelled_before_start(
        &self,
        task_id: &TaskId,
    ) -> Result<TaskBundle, JournalError> {
        let task_id = task_id.clone();
        self.mutate(task_id, |task, attempt, delivery, _workspace| {
            if task.state == TaskState::Cancelling && attempt.state.provider_turn_id().is_none() {
                task.transition(TaskTransition::CancelledBeforeStart)
                    .map_err(JournalError::InvalidTransition)?;
                delivery.state = DeliveryState::AwaitingResume;
                return Ok(Some(TaskEventKind::TaskTerminal));
            }
            Ok(None)
        })
        .await
    }

    /// Acknowledges terminal fallback delivery after a task-addressed read.
    ///
    /// # Errors
    ///
    /// Returns a journal error when the task is absent or the durable
    /// transition cannot be committed.
    pub async fn acknowledge_delivery(&self, task_id: &TaskId) -> Result<TaskBundle, JournalError> {
        let task_id = task_id.clone();
        self.mutate(task_id, |task, _attempt, delivery, _workspace| {
            if task.state.is_terminal() && delivery.state == DeliveryState::AwaitingResume {
                delivery.state = DeliveryState::Acknowledged;
            }
            Ok(None)
        })
        .await
    }

    pub(super) async fn get_for_child(
        &self,
        child: &str,
    ) -> Result<Option<TaskBundle>, JournalError> {
        let Some(task_id) = self.task_for_child(child).await? else {
            return Ok(None);
        };
        self.get(&task_id).await.map(Some)
    }

    async fn task_for_child(&self, child: &str) -> Result<Option<TaskId>, JournalError> {
        let child = child.to_owned();
        self.blocking(move |store| {
            let read = store.database().begin_read()?;
            let table = read.open_table(orchestration_tables::TASKS_BY_CHILD)?;
            table
                .get(child.as_str())?
                .map(|value| {
                    TaskId::parse(value.value()).ok_or_else(|| {
                        JournalError::InvalidTransition("child task index is empty".into())
                    })
                })
                .transpose()
        })
        .await
    }

    async fn mutate(
        &self,
        task_id: TaskId,
        change: impl FnOnce(
            &mut OrchestrationTask,
            &mut TaskAttempt,
            &mut CompletionDelivery,
            &mut WorkspaceClaim,
        ) -> Result<Option<TaskEventKind>, JournalError>
        + Send
        + 'static,
    ) -> Result<TaskBundle, JournalError> {
        let read_id = task_id.clone();
        self.blocking(move |store| {
            let write = store.database().begin_write()?;
            let mut bundle = read_bundle_from_write(&write, &task_id)?;
            let event = change(
                &mut bundle.task,
                &mut bundle.attempt,
                &mut bundle.delivery,
                &mut bundle.workspace,
            )?;
            bundle.task.updated_at_ms = unix_time_ms();
            write_bundle(&write, &bundle)?;
            if let Some(kind) = event {
                append_next_event(&write, &task_id, kind)?;
            }
            write.commit()?;
            Ok(())
        })
        .await?;
        self.get(&read_id).await
    }

    async fn mutate_with_child(
        &self,
        task_id: TaskId,
        child_thread_id: AppThreadId,
        change: impl FnOnce(
            &mut OrchestrationTask,
            &mut TaskAttempt,
        ) -> Result<TaskEventKind, JournalError>
        + Send
        + 'static,
    ) -> Result<TaskBundle, JournalError> {
        let read_id = task_id.clone();
        self.blocking(move |store| {
            let write = store.database().begin_write()?;
            let existing_task_id = {
                let child_index = write.open_table(orchestration_tables::TASKS_BY_CHILD)?;
                child_index
                    .get(child_thread_id.as_str())?
                    .map(|value| value.value().to_owned())
            };
            if existing_task_id
                .as_deref()
                .is_some_and(|existing| existing != task_id.as_str())
            {
                return Err(JournalError::InvalidTransition(format!(
                    "child thread {} is already bound to another task",
                    child_thread_id.as_str()
                )));
            }
            let mut bundle = read_bundle_from_write(&write, &task_id)?;
            let kind = change(&mut bundle.task, &mut bundle.attempt)?;
            bundle
                .attempt
                .bind_child(child_thread_id.clone())
                .map_err(JournalError::InvalidTransition)?;
            bundle.task.updated_at_ms = unix_time_ms();
            write_bundle(&write, &bundle)?;
            if existing_task_id.is_none() {
                write
                    .open_table(orchestration_tables::TASKS_BY_CHILD)?
                    .insert(child_thread_id.as_str(), task_id.as_str())?;
            }
            append_next_event(&write, &task_id, kind)?;
            write.commit()?;
            Ok(())
        })
        .await?;
        self.get(&read_id).await
    }
}

fn read_bundle(store: &IndexStore, task_id: &TaskId) -> Result<TaskBundle, JournalError> {
    let read = store.database().begin_read()?;
    let tasks = read.open_table(orchestration_tables::TASKS)?;
    let task: OrchestrationTask = tasks
        .get(task_id.as_str())?
        .map(|encoded| serde_json::from_slice(encoded.value()))
        .transpose()?
        .ok_or_else(|| JournalError::NotFound(task_id.as_str().to_owned()))?;
    let attempts = read.open_table(orchestration_tables::ATTEMPTS)?;
    let attempt: TaskAttempt = attempts
        .get(task.authoritative_attempt_id.as_str())?
        .map(|encoded| serde_json::from_slice(encoded.value()))
        .transpose()?
        .ok_or_else(|| {
            JournalError::InvalidTransition("authoritative attempt is missing".into())
        })?;
    let deliveries = read.open_table(orchestration_tables::DELIVERIES)?;
    let delivery: CompletionDelivery = deliveries
        .get(task.delivery_id.as_str())?
        .map(|encoded| serde_json::from_slice(encoded.value()))
        .transpose()?
        .ok_or_else(|| JournalError::InvalidTransition("completion delivery is missing".into()))?;
    let claims = read.open_table(orchestration_tables::WORKSPACE_CLAIMS)?;
    let workspace: WorkspaceClaim = claims
        .get(task.workspace_claim_id.as_str())?
        .map(|encoded| serde_json::from_slice(encoded.value()))
        .transpose()?
        .ok_or_else(|| JournalError::InvalidTransition("workspace claim is missing".into()))?;
    Ok(TaskBundle {
        task,
        attempt,
        delivery,
        workspace,
    })
}

fn read_bundle_from_write(
    write: &redb::WriteTransaction,
    task_id: &TaskId,
) -> Result<TaskBundle, JournalError> {
    let tasks = write.open_table(orchestration_tables::TASKS)?;
    let task: OrchestrationTask = tasks
        .get(task_id.as_str())?
        .map(|encoded| serde_json::from_slice(encoded.value()))
        .transpose()?
        .ok_or_else(|| JournalError::NotFound(task_id.as_str().to_owned()))?;
    drop(tasks);
    let attempts = write.open_table(orchestration_tables::ATTEMPTS)?;
    let attempt: TaskAttempt = attempts
        .get(task.authoritative_attempt_id.as_str())?
        .map(|encoded| serde_json::from_slice(encoded.value()))
        .transpose()?
        .ok_or_else(|| {
            JournalError::InvalidTransition("authoritative attempt is missing".into())
        })?;
    drop(attempts);
    let deliveries = write.open_table(orchestration_tables::DELIVERIES)?;
    let delivery: CompletionDelivery = deliveries
        .get(task.delivery_id.as_str())?
        .map(|encoded| serde_json::from_slice(encoded.value()))
        .transpose()?
        .ok_or_else(|| JournalError::InvalidTransition("completion delivery is missing".into()))?;
    drop(deliveries);
    let claims = write.open_table(orchestration_tables::WORKSPACE_CLAIMS)?;
    let workspace: WorkspaceClaim = claims
        .get(task.workspace_claim_id.as_str())?
        .map(|encoded| serde_json::from_slice(encoded.value()))
        .transpose()?
        .ok_or_else(|| JournalError::InvalidTransition("workspace claim is missing".into()))?;
    Ok(TaskBundle {
        task,
        attempt,
        delivery,
        workspace,
    })
}

fn write_bundle(write: &redb::WriteTransaction, bundle: &TaskBundle) -> Result<(), JournalError> {
    write.open_table(orchestration_tables::TASKS)?.insert(
        bundle.task.task_id.as_str(),
        serde_json::to_vec(&bundle.task)?.as_slice(),
    )?;
    write.open_table(orchestration_tables::ATTEMPTS)?.insert(
        bundle.attempt.attempt_id.as_str(),
        serde_json::to_vec(&bundle.attempt)?.as_slice(),
    )?;
    write.open_table(orchestration_tables::DELIVERIES)?.insert(
        bundle.delivery.delivery_id.as_str(),
        serde_json::to_vec(&bundle.delivery)?.as_slice(),
    )?;
    write
        .open_table(orchestration_tables::WORKSPACE_CLAIMS)?
        .insert(
            bundle.workspace.claim_id.as_str(),
            serde_json::to_vec(&bundle.workspace)?.as_slice(),
        )?;
    Ok(())
}

fn append_next_event(
    write: &redb::WriteTransaction,
    task_id: &TaskId,
    kind: TaskEventKind,
) -> Result<(), JournalError> {
    let table = write.open_table(orchestration_tables::EVENTS)?;
    let start = format!("{}\0", task_id.as_str());
    let end = format!("{}\u{1}", task_id.as_str());
    let sequence = u64::try_from(table.range(start.as_str()..end.as_str())?.count())
        .ok()
        .and_then(|count| count.checked_add(1))
        .ok_or_else(|| JournalError::InvalidTransition("task event sequence exhausted".into()))?;
    drop(table);
    insert_event(write, task_id, sequence, kind)
}

fn insert_event(
    write: &redb::WriteTransaction,
    task_id: &TaskId,
    sequence: u64,
    kind: TaskEventKind,
) -> Result<(), JournalError> {
    let event = TaskEvent {
        task_id: task_id.clone(),
        sequence,
        kind,
        occurred_at_ms: unix_time_ms(),
    };
    let key = format!("{}\0{sequence:020}", task_id.as_str());
    write
        .open_table(orchestration_tables::EVENTS)?
        .insert(key.as_str(), serde_json::to_vec(&event)?.as_slice())?;
    Ok(())
}

fn unix_time_ms() -> u64 {
    SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)
        .map_or(0, |elapsed| {
            u64::try_from(elapsed.as_millis()).unwrap_or(u64::MAX)
        })
}
