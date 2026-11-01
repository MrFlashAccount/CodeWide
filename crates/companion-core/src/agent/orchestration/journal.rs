//! Durable orchestration journal and terminal compare-and-set owner.
//!
//! Records contain coordination metadata and references only. The initial
//! prompt is held by the turn-delivery reservation table and later moved to
//! the existing outbox; final text remains in provider history. Child work
//! requests (`requests`) are the unit of result delivery; a task's initial
//! request commits with every task transition that settles it.

mod backfill;
mod requests;

use std::{sync::Arc, time::SystemTime};

use redb::{ReadableDatabase, ReadableTable};
use serde::{Deserialize, Serialize};

pub(super) use self::requests::{HandoffOutcome, ReceiptBinding};
use super::{
    task::{
        OrchestrationTask, TaskAttempt, TaskEvent, TaskEventKind, TaskId, TaskState,
        TaskTransition, WorkspaceClaim, WorkspaceClaimState,
    },
    work_requests::{ChildWorkRequest, NeverStartedReason, RequestOrigin, WorkRequestId},
};
use crate::{
    agent::model::AppThreadId,
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
    #[cfg(test)]
    #[error("injected journal failure")]
    Injected,
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
    /// The task's initial child work request (its id is the task's
    /// `deliveryId`).
    pub request: ChildWorkRequest,
    pub workspace: WorkspaceClaim,
}

#[derive(Clone, Debug)]
pub struct AdmissionRecord {
    pub call_key: String,
    pub request_hash: String,
    pub(crate) initial_turn: InitialTurnReservation,
    pub task: OrchestrationTask,
    pub attempt: TaskAttempt,
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
    /// Test fault injection for the terminal settlement write.
    #[cfg(test)]
    fail_next_settle: Arc<std::sync::atomic::AtomicBool>,
}

impl TaskJournal {
    #[must_use]
    pub fn new(store: Arc<IndexStore>) -> Self {
        Self {
            store,
            #[cfg(test)]
            fail_next_settle: Arc::default(),
        }
    }

    /// Makes the next terminal settlement write fail once (tests only).
    #[cfg(test)]
    pub(super) fn fail_next_settle(&self) {
        self.fail_next_settle
            .store(true, std::sync::atomic::Ordering::SeqCst);
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
                        let request = ChildWorkRequest::queued(
                            WorkRequestId::from_delivery(&record.task.delivery_id),
                            record.task.parent_thread_id.clone(),
                            None,
                            record.task.provider.clone(),
                            record.attempt.command_id.clone(),
                            RequestOrigin::TaskInitial {
                                task_id: record.task.task_id.clone(),
                            },
                            record.task.created_at_ms,
                        );
                        requests::insert_new(&write, &request)?;
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
        self.mutate(task_id, move |task, _attempt, _request, workspace| {
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
        self.mutate(task_id, |task, _attempt, _request, _workspace| {
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
        self.mutate(task_id, move |task, attempt, _request, _workspace| {
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
        self.mutate(task_id, |task, attempt, _request, _workspace| {
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
        self.mutate(task_id, |task, _attempt, _request, _workspace| {
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
        self.mutate(task_id, |task, attempt, _request, _workspace| {
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

    /// Records a definite post-admission task failure.
    ///
    /// # Errors
    ///
    /// Returns a journal error when the task is absent or the durable
    /// transition cannot be committed.
    pub async fn fail_task(&self, task_id: &TaskId) -> Result<TaskBundle, JournalError> {
        let task_id = task_id.clone();
        let bundle = self
            .mutate(task_id, |task, _attempt, request, _workspace| {
                if task.state.is_terminal() {
                    return Ok(None);
                }
                task.transition(TaskTransition::Failed)
                    .map_err(JournalError::InvalidTransition)?;
                requests::settle_failed_task(request, unix_time_ms());
                Ok(Some(TaskEventKind::TaskTerminal))
            })
            .await?;
        Ok(bundle)
    }

    /// Records a definite workspace failure without copying plugin payloads.
    ///
    /// # Errors
    /// Returns a journal error when the durable transition cannot be committed.
    pub async fn fail_workspace(&self, task_id: &TaskId) -> Result<TaskBundle, JournalError> {
        self.mutate(task_id.clone(), |task, _attempt, request, workspace| {
            if task.state.is_terminal() {
                return Ok(None);
            }
            let WorkspaceClaimState::Pending { source_workspace } = &workspace.state else {
                return Err(JournalError::InvalidTransition("workspace is not pending".into()));
            };
            workspace.state = WorkspaceClaimState::Failed {
                source_workspace: source_workspace.clone(),
                error: "Isolated workspace preparation failed. The source must be owned by a configured VCS provider supporting workspace.create@1; inspect the workspace operation for details.".into(),
            };
            task.transition(TaskTransition::Failed)
                .map_err(JournalError::InvalidTransition)?;
            requests::settle_failed_task(request, unix_time_ms());
            Ok(Some(TaskEventKind::TaskTerminal))
        }).await
    }

    /// Records idempotent cancellation intent without claiming provider exit.
    ///
    /// # Errors
    ///
    /// Returns a journal error when the task is absent or the durable
    /// transition cannot be committed.
    pub async fn cancel_intent(&self, task_id: &TaskId) -> Result<TaskBundle, JournalError> {
        let task_id = task_id.clone();
        self.mutate(task_id, |task, _attempt, request, _workspace| {
            if task.state.is_terminal() {
                return Ok(None);
            }
            task.transition(TaskTransition::CancelRequested)
                .map_err(JournalError::InvalidTransition)?;
            if task.state == TaskState::Cancelled {
                request.settle_never_started(NeverStartedReason::CancelledByParent, unix_time_ms());
            } else {
                request.request_cancel();
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
        self.mutate(task_id, |task, attempt, request, _workspace| {
            if task.state == TaskState::Cancelling && attempt.state.provider_turn_id().is_none() {
                task.transition(TaskTransition::CancelledBeforeStart)
                    .map_err(JournalError::InvalidTransition)?;
                request.settle_never_started(NeverStartedReason::CancelledByParent, unix_time_ms());
                return Ok(Some(TaskEventKind::TaskTerminal));
            }
            Ok(None)
        })
        .await
    }

    /// The task that owns a child thread (tests of the one-child invariant).
    #[cfg(test)]
    pub(super) async fn task_for_child(&self, child: &str) -> Result<Option<TaskId>, JournalError> {
        let child = child.to_owned();
        self.blocking(move |store| {
            let read = store.database().begin_read()?;
            let table = read.open_table(orchestration_tables::TASKS_BY_CHILD)?;
            Ok(table
                .get(child.as_str())?
                .and_then(|value| TaskId::parse(value.value())))
        })
        .await
    }

    async fn mutate(
        &self,
        task_id: TaskId,
        change: impl FnOnce(
            &mut OrchestrationTask,
            &mut TaskAttempt,
            &mut ChildWorkRequest,
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
                &mut bundle.request,
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
            bundle
                .request
                .attach_child(&child_thread_id)
                .map_err(|error| JournalError::InvalidTransition(error.to_string()))?;
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
    let requests = read.open_table(orchestration_tables::WORK_REQUESTS)?;
    let request: ChildWorkRequest = requests
        .get(task.delivery_id.as_str())?
        .map(|encoded| serde_json::from_slice(encoded.value()))
        .transpose()?
        .ok_or_else(|| JournalError::InvalidTransition("initial work request is missing".into()))?;
    let claims = read.open_table(orchestration_tables::WORKSPACE_CLAIMS)?;
    let workspace: WorkspaceClaim = claims
        .get(task.workspace_claim_id.as_str())?
        .map(|encoded| serde_json::from_slice(encoded.value()))
        .transpose()?
        .ok_or_else(|| JournalError::InvalidTransition("workspace claim is missing".into()))?;
    Ok(TaskBundle {
        task,
        attempt,
        request,
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
    let request =
        requests::read_from_write(write, &WorkRequestId::from_delivery(&task.delivery_id))?
            .ok_or_else(|| {
                JournalError::InvalidTransition("initial work request is missing".into())
            })?;
    let claims = write.open_table(orchestration_tables::WORKSPACE_CLAIMS)?;
    let workspace: WorkspaceClaim = claims
        .get(task.workspace_claim_id.as_str())?
        .map(|encoded| serde_json::from_slice(encoded.value()))
        .transpose()?
        .ok_or_else(|| JournalError::InvalidTransition("workspace claim is missing".into()))?;
    Ok(TaskBundle {
        task,
        attempt,
        request,
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
    requests::put(write, &bundle.request)?;
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
