//! `work_requests_backfill_v1`: one idempotent migration from per-task
//! `CompletionDelivery` records and open legacy follow-up commands to child
//! work requests. It runs once per store (durable marker) before the
//! reconciler starts; rerunning it skips every request that already exists.

use redb::{ReadableTable, WriteTransaction};

use super::{JournalError, TaskJournal, requests, unix_time_ms};
use crate::{
    agent::{
        model::{AppThreadId, TurnId},
        orchestration::{
            children::ChildLinks,
            task::{
                CompletionDelivery, DeliveryProgress, DeliveryState, OrchestrationTask,
                ParentDeliveryState, TaskAttempt, TaskState,
            },
            work_requests::{
                AckSource, ChildWorkRequest, Delivery, NeverStartedReason, RequestOrigin,
                RequestPhase, RunOutcome, Settlement, WorkRequestId,
            },
        },
    },
    store::{IndexStore, StoreError, orchestration_tables},
};

const MARKER: &str = "work_requests_backfill_v1";
const FOLLOWUP_PREFIX: &str = "agent-send-";

/// What the migration wrote; opaque counts only.
#[derive(Clone, Copy, Debug, Default, Eq, PartialEq)]
pub(in crate::agent::orchestration) struct BackfillReport {
    pub tasks: usize,
    pub followups: usize,
    pub skipped: bool,
}

/// One not-yet-dispatched outbox command: `(command id, thread id)`.
pub(in crate::agent::orchestration) type OpenCommand = (String, String);

impl TaskJournal {
    /// Runs `work_requests_backfill_v1` unless its marker exists.
    ///
    /// # Errors
    /// Returns a storage or record failure; nothing is committed then and a
    /// later start retries.
    pub(in crate::agent::orchestration) fn backfill_v1(
        store: &IndexStore,
        open_followups: impl FnOnce(&WriteTransaction, &str) -> Result<Vec<OpenCommand>, StoreError>,
    ) -> Result<BackfillReport, JournalError> {
        let write = store.database().begin_write()?;
        if write
            .open_table(orchestration_tables::META)?
            .get(MARKER)?
            .is_some()
        {
            return Ok(BackfillReport {
                skipped: true,
                ..BackfillReport::default()
            });
        }
        let mut report = BackfillReport::default();
        let tasks = {
            let table = write.open_table(orchestration_tables::TASKS)?;
            let mut tasks = Vec::new();
            for entry in table.iter()? {
                let (_, value) = entry?;
                tasks.push(serde_json::from_slice::<OrchestrationTask>(value.value())?);
            }
            tasks
        };
        for task in tasks {
            let request_id = WorkRequestId::from_delivery(&task.delivery_id);
            if requests::read_from_write(&write, &request_id)?.is_some() {
                continue;
            }
            let attempt: TaskAttempt = write
                .open_table(orchestration_tables::ATTEMPTS)?
                .get(task.authoritative_attempt_id.as_str())?
                .map(|encoded| serde_json::from_slice(encoded.value()))
                .transpose()?
                .ok_or_else(|| {
                    JournalError::InvalidTransition("authoritative attempt is missing".into())
                })?;
            let legacy: Option<CompletionDelivery> = write
                .open_table(orchestration_tables::DELIVERIES)?
                .get(task.delivery_id.as_str())?
                .map(|encoded| serde_json::from_slice(encoded.value()))
                .transpose()?;
            let request = migrated_task_request(&task, &attempt, legacy.as_ref(), request_id);
            requests::insert_new(&write, &request)?;
            if let RequestPhase::Settled {
                delivery: Delivery::Enqueued { parent_command_id },
                ..
            } = &request.phase
            {
                requests::record_migrated_notice(
                    &write,
                    &request.parent_thread_id,
                    parent_command_id,
                    &request.request_id,
                )?;
            }
            report.tasks += 1;
        }
        for (command_id, thread_id) in open_followups(&write, FOLLOWUP_PREFIX)? {
            let mapped = write
                .open_table(orchestration_tables::REQUESTS_BY_COMMAND)?
                .get(command_id.as_str())?
                .is_some();
            if mapped {
                continue;
            }
            let Some(link) = ChildLinks::link_of_blocking(store, &thread_id)
                .map_err(|error| JournalError::InvalidTransition(error.to_string()))?
            else {
                continue;
            };
            let (Some(parent), Some(child)) = (
                AppThreadId::parse(&link.parent_thread_id),
                AppThreadId::parse(&thread_id),
            ) else {
                continue;
            };
            let request = ChildWorkRequest::queued(
                WorkRequestId::new(),
                parent,
                Some(child),
                link.provider,
                command_id,
                RequestOrigin::Followup,
                unix_time_ms(),
            );
            requests::insert_new(&write, &request)?;
            report.followups += 1;
        }
        write
            .open_table(orchestration_tables::META)?
            .insert(MARKER, b"1".as_slice())?;
        write.commit()?;
        Ok(report)
    }
}

fn migrated_task_request(
    task: &OrchestrationTask,
    attempt: &TaskAttempt,
    legacy: Option<&CompletionDelivery>,
    request_id: WorkRequestId,
) -> ChildWorkRequest {
    let child = match &attempt.state {
        crate::agent::orchestration::task::AttemptState::ChildBound { child_thread_id }
        | crate::agent::orchestration::task::AttemptState::Started {
            child_thread_id, ..
        }
        | crate::agent::orchestration::task::AttemptState::Terminal {
            child_thread_id, ..
        } => Some(child_thread_id.clone()),
        _ => None,
    };
    let mut request = ChildWorkRequest::queued(
        request_id,
        task.parent_thread_id.clone(),
        child,
        task.provider.clone(),
        attempt.command_id.clone(),
        RequestOrigin::TaskInitial {
            task_id: task.task_id.clone(),
        },
        task.created_at_ms,
    );
    // Migrated rows keep their stable legacy notice key.
    if let Some(legacy) = legacy {
        request.dedupe_key.clone_from(&legacy.dedupe_key);
    } else {
        request.dedupe_key = format!("task-completion:{}", task.task_id.as_str());
    }
    let turn = attempt.state.provider_turn_id().cloned();
    request.phase = if task.state.is_terminal() {
        RequestPhase::Settled {
            settlement: settlement(task.state, turn),
            delivery: migrated_delivery(legacy, &request.dedupe_key),
            settled_at_ms: task.updated_at_ms,
        }
    } else {
        match (task.state, turn) {
            (TaskState::Cancelling, turn_id) => RequestPhase::CancelRequested { turn_id },
            (_, Some(turn_id)) => RequestPhase::Running { turn_id },
            (_, None) => RequestPhase::Queued,
        }
    };
    request.updated_at_ms = task.updated_at_ms;
    request
}

fn settlement(state: TaskState, turn: Option<TurnId>) -> Settlement {
    match (state, turn) {
        (TaskState::Succeeded, Some(turn_id)) => Settlement::Ran {
            turn_id,
            outcome: RunOutcome::Completed,
        },
        (TaskState::Interrupted, Some(turn_id)) => Settlement::Ran {
            turn_id,
            outcome: RunOutcome::Interrupted,
        },
        (TaskState::Cancelled, Some(turn_id)) => Settlement::Ran {
            turn_id,
            outcome: RunOutcome::Cancelled,
        },
        (TaskState::Cancelled, None) => Settlement::NeverStarted {
            reason: NeverStartedReason::CancelledByParent,
        },
        (_, Some(turn_id)) => Settlement::Ran {
            turn_id,
            outcome: RunOutcome::Failed,
        },
        (_, None) => Settlement::NeverStarted {
            reason: NeverStartedReason::DispatchFailed,
        },
    }
}

/// A terminal task's legacy delivery: the injected-turn route keeps its
/// state; the fallback route was the model's to collect and is acknowledged.
fn migrated_delivery(legacy: Option<&CompletionDelivery>, dedupe_key: &str) -> Delivery {
    let migration = Delivery::Acknowledged {
        by: AckSource::Migration,
    };
    let Some(legacy) = legacy else {
        return migration;
    };
    match legacy.progress {
        DeliveryProgress::ParentTurn {
            state: ParentDeliveryState::Pending | ParentDeliveryState::AwaitingResume,
        } => Delivery::AwaitingHandoff {
            next_attempt_at_ms: 0,
            attempts: 0,
        },
        DeliveryProgress::ParentTurn {
            state: ParentDeliveryState::Enqueued,
        } => Delivery::Enqueued {
            parent_command_id: dedupe_key.to_owned(),
        },
        DeliveryProgress::ParentTurn {
            state: ParentDeliveryState::Acknowledged,
        }
        | DeliveryProgress::AwaitingResume {
            state:
                DeliveryState::Pending | DeliveryState::AwaitingResume | DeliveryState::Acknowledged,
        } => migration,
    }
}
