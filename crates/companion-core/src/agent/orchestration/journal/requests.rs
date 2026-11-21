//! Durable child work requests inside the journal's transactions.
//!
//! Every write keeps the request value and its indexes consistent: a request
//! is in `OPEN_REQUESTS_BY_CHILD` exactly while it is unsettled and has a
//! child, and in `HANDOFFS_BY_PARENT` exactly while its settled result waits
//! for a parent handoff. A task's initial request and the task's terminal
//! state change in the same transaction.

use std::collections::BTreeMap;

use redb::{ReadableDatabase, ReadableTable, WriteTransaction};
use serde::{Deserialize, Serialize};
use tracing::info;

use super::{
    JournalError, TaskJournal, append_next_event, read_bundle_from_write, unix_time_ms,
    write_bundle,
};
use crate::{
    agent::{
        client_wire::observe::TurnEnd,
        model::{AppThreadId, ProviderId, TurnId},
        orchestration::{
            task::{TaskEventKind, TaskId, TaskTransition},
            work_requests::{
                AckSource, ChildWorkRequest, Delivery, NeverStartedReason, RequestPhase,
                RunOutcome, SettleHold, Settlement, SuppressReason, WorkRequestId,
            },
        },
    },
    store::{StoreError, TurnReceipt, orchestration_tables},
    turn_delivery::NoticeCommandState,
};

/// A request bound by a delivery receipt, or a parent turn started by a
/// notice. Opaque identifiers only.
#[derive(Clone, Debug, Eq, PartialEq)]
pub(in crate::agent::orchestration) enum ReceiptBinding {
    Request {
        request_id: WorkRequestId,
        provider: ProviderId,
        child: AppThreadId,
        turn_id: TurnId,
        cancel_requested: bool,
        task_id: Option<TaskId>,
    },
    Notice {
        parent: AppThreadId,
        consecutive: u64,
    },
}

/// One request a terminal fact settled.
#[derive(Clone, Debug, Eq, PartialEq)]
pub(in crate::agent::orchestration) struct SettledRequest {
    pub request_id: WorkRequestId,
    pub task_id: Option<TaskId>,
}

/// The handoff transaction's result.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(in crate::agent::orchestration) enum HandoffOutcome {
    Enqueued,
    /// The parent's previous notice is still queued; results wait to batch.
    Blocked,
    /// A request changed since it was read; nothing was written.
    Stale,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct NoticeRecord {
    parent_thread_id: AppThreadId,
    request_ids: Vec<WorkRequestId>,
}

fn pair_key(owner: &str, request: &WorkRequestId) -> String {
    format!("{owner}\0{}", request.as_str())
}

fn owner_range(owner: &str) -> (String, String) {
    (format!("{owner}\0"), format!("{owner}\u{1}"))
}

pub(super) fn read_from_write(
    write: &WriteTransaction,
    request_id: &WorkRequestId,
) -> Result<Option<ChildWorkRequest>, JournalError> {
    let table = write.open_table(orchestration_tables::WORK_REQUESTS)?;
    Ok(table
        .get(request_id.as_str())?
        .map(|encoded| serde_json::from_slice(encoded.value()))
        .transpose()?)
}

/// Writes a request and reconciles both of its indexes with its state.
pub(super) fn put(
    write: &WriteTransaction,
    request: &ChildWorkRequest,
) -> Result<(), JournalError> {
    write
        .open_table(orchestration_tables::WORK_REQUESTS)?
        .insert(
            request.request_id.as_str(),
            serde_json::to_vec(request)?.as_slice(),
        )?;
    let mut open = write.open_table(orchestration_tables::OPEN_REQUESTS_BY_CHILD)?;
    if let Some(child) = &request.child_thread_id {
        let key = pair_key(child.as_str(), &request.request_id);
        if request.is_open() {
            open.insert(key.as_str(), request.request_id.as_str())?;
        } else {
            open.remove(key.as_str())?;
        }
    }
    drop(open);
    let mut handoffs = write.open_table(orchestration_tables::HANDOFFS_BY_PARENT)?;
    let key = pair_key(request.parent_thread_id.as_str(), &request.request_id);
    if request.awaits_handoff() {
        handoffs.insert(key.as_str(), request.request_id.as_str())?;
    } else {
        handoffs.remove(key.as_str())?;
    }
    Ok(())
}

/// Inserts a new request and its command binding. Repeating the same
/// request for the same command is a no-op.
pub(super) fn insert_new(
    write: &WriteTransaction,
    request: &ChildWorkRequest,
) -> Result<bool, JournalError> {
    let existing = write
        .open_table(orchestration_tables::REQUESTS_BY_COMMAND)?
        .get(request.command_id.as_str())?
        .map(|value| value.value().to_owned());
    match existing {
        Some(existing) if existing == request.request_id.as_str() => return Ok(false),
        Some(_) => {
            return Err(JournalError::InvalidTransition(
                "command already belongs to another work request".into(),
            ));
        }
        None => {}
    }
    write
        .open_table(orchestration_tables::REQUESTS_BY_COMMAND)?
        .insert(request.command_id.as_str(), request.request_id.as_str())?;
    put(write, request)?;
    Ok(true)
}

/// Records a migrated legacy notice so a terminal wait can still retract it.
pub(super) fn record_migrated_notice(
    write: &WriteTransaction,
    parent: &AppThreadId,
    command_id: &str,
    request_id: &WorkRequestId,
) -> Result<(), JournalError> {
    let mut notices = write.open_table(orchestration_tables::NOTICES)?;
    let mut record: NoticeRecord = notices
        .get(command_id)?
        .map(|encoded| serde_json::from_slice(encoded.value()))
        .transpose()?
        .unwrap_or_else(|| NoticeRecord {
            parent_thread_id: parent.clone(),
            request_ids: Vec::new(),
        });
    if !record.request_ids.contains(request_id) {
        record.request_ids.push(request_id.clone());
    }
    notices.insert(command_id, serde_json::to_vec(&record)?.as_slice())?;
    drop(notices);
    write
        .open_table(orchestration_tables::LATEST_NOTICE_BY_PARENT)?
        .insert(parent.as_str(), command_id)?;
    Ok(())
}

/// A task failed outside its turn: the initial request fails with it.
pub(super) fn settle_failed_task(request: &mut ChildWorkRequest, now_ms: u64) {
    if let Some(turn_id) = request.turn_id().cloned()
        && request.is_open()
    {
        request.settle_turn(&turn_id, TurnEnd::Failed, now_ms, SettleHold::NONE);
    } else {
        request.settle_never_started(NeverStartedReason::DispatchFailed, now_ms);
    }
}

/// Applies a settled initial request to its task in the same transaction.
fn settle_task(write: &WriteTransaction, request: &ChildWorkRequest) -> Result<(), JournalError> {
    let (Some(task_id), RequestPhase::Settled { settlement, .. }) =
        (request.task_id(), &request.phase)
    else {
        return Ok(());
    };
    let mut bundle = read_bundle_from_write(write, task_id)?;
    bundle.request = request.clone();
    if bundle.task.state.is_terminal() {
        return write_bundle(write, &bundle);
    }
    let transition = match settlement {
        Settlement::Ran { turn_id, outcome } => {
            if let Some(child) = &request.child_thread_id {
                bundle
                    .attempt
                    .observe_terminal(child.clone(), turn_id.clone())
                    .map_err(JournalError::InvalidTransition)?;
            }
            match outcome {
                RunOutcome::Completed => TaskTransition::Succeeded,
                RunOutcome::Failed => TaskTransition::Failed,
                RunOutcome::Interrupted => TaskTransition::Interrupted,
                RunOutcome::Cancelled => TaskTransition::Cancelled,
            }
        }
        Settlement::NeverStarted {
            reason: NeverStartedReason::CancelledByParent,
        } => TaskTransition::CancelledBeforeStart,
        Settlement::NeverStarted {
            reason: NeverStartedReason::DispatchFailed | NeverStartedReason::ChildGone,
        } => TaskTransition::Failed,
    };
    bundle
        .task
        .transition(transition)
        .map_err(JournalError::InvalidTransition)?;
    bundle.task.updated_at_ms = unix_time_ms();
    write_bundle(write, &bundle)?;
    append_next_event(write, task_id, TaskEventKind::AttemptTerminal)?;
    append_next_event(write, task_id, TaskEventKind::TaskTerminal)
}

/// The request ids one owner (`child` or `parent`) holds in a pair index.
fn indexed_ids(
    write: &WriteTransaction,
    index: redb::TableDefinition<'static, &'static str, &'static str>,
    owner: &str,
) -> Result<Vec<WorkRequestId>, JournalError> {
    let table = write.open_table(index)?;
    let (start, end) = owner_range(owner);
    let mut ids = Vec::new();
    for entry in table.range(start.as_str()..end.as_str())? {
        let (_, value) = entry?;
        ids.push(WorkRequestId::parse(value.value()).ok_or_else(|| {
            JournalError::InvalidTransition("request index holds an invalid id".into())
        })?);
    }
    Ok(ids)
}

fn open_requests_of(
    write: &WriteTransaction,
    child: &str,
) -> Result<Vec<ChildWorkRequest>, JournalError> {
    let mut requests = Vec::new();
    for id in indexed_ids(write, orchestration_tables::OPEN_REQUESTS_BY_CHILD, child)? {
        if let Some(request) = read_from_write(write, &id)? {
            requests.push(request);
        }
    }
    Ok(requests)
}

/// Settles one request and its task, then persists both.
fn persist_settled(
    write: &WriteTransaction,
    request: &ChildWorkRequest,
) -> Result<(), JournalError> {
    put(write, request)?;
    settle_task(write, request)
}

/// Acknowledges one settled request. A still-queued notice that carries it is
/// retracted in the same transaction and its other requests return to the
/// handoff queue; a dispatched notice stays (one duplicate is accepted).
fn acknowledge_in_write(
    write: &WriteTransaction,
    request: &mut ChildWorkRequest,
    by: AckSource,
    retract: &dyn Fn(&WriteTransaction, &str) -> Result<bool, StoreError>,
) -> Result<bool, JournalError> {
    let Some(previous) = request.acknowledge(by) else {
        return Ok(false);
    };
    put(write, request)?;
    let Delivery::Enqueued { parent_command_id } = previous else {
        return Ok(true);
    };
    if !retract(write, &parent_command_id)? {
        return Ok(true);
    }
    let record: Option<NoticeRecord> = write
        .open_table(orchestration_tables::NOTICES)?
        .remove(parent_command_id.as_str())?
        .map(|encoded| serde_json::from_slice(encoded.value()))
        .transpose()?;
    {
        let mut latest = write.open_table(orchestration_tables::LATEST_NOTICE_BY_PARENT)?;
        let parent = request.parent_thread_id.as_str();
        if latest
            .get(parent)?
            .is_some_and(|value| value.value() == parent_command_id)
        {
            latest.remove(parent)?;
        }
    }
    let now = unix_time_ms();
    for sibling in record.map(|record| record.request_ids).unwrap_or_default() {
        if sibling == request.request_id {
            continue;
        }
        if let Some(mut sibling) = read_from_write(write, &sibling)?
            && sibling.return_to_handoff(now)
        {
            put(write, &sibling)?;
        }
    }
    Ok(true)
}

#[cfg(test)]
fn check_injected(journal: &TaskJournal) -> Result<(), JournalError> {
    if journal
        .fail_next_settle
        .swap(false, std::sync::atomic::Ordering::SeqCst)
    {
        return Err(JournalError::Injected);
    }
    Ok(())
}

impl TaskJournal {
    /// Binds the request of `receipt.command` to its provider turn, or
    /// counts a parent turn started by a notice. Runs inside the receipt
    /// transaction; nothing else may bind a request to a turn.
    ///
    /// # Errors
    /// Returns a storage or record failure; the caller decides whether it
    /// aborts the receipt.
    pub(in crate::agent::orchestration) fn bind_from_receipt(
        write: &WriteTransaction,
        receipt: TurnReceipt<'_>,
    ) -> Result<Option<ReceiptBinding>, JournalError> {
        let notice = write
            .open_table(orchestration_tables::NOTICES)?
            .get(receipt.command)?
            .map(|encoded| serde_json::from_slice::<NoticeRecord>(encoded.value()))
            .transpose()?;
        if let Some(notice) = notice {
            let mut wakes = write.open_table(orchestration_tables::PARENT_WAKES)?;
            let consecutive = wakes
                .get(receipt.thread)?
                .map_or(0, |value| value.value())
                .saturating_add(1);
            wakes.insert(receipt.thread, consecutive)?;
            return Ok(Some(ReceiptBinding::Notice {
                parent: notice.parent_thread_id,
                consecutive,
            }));
        }
        // Any other delivered turn of a woken parent ends its streak.
        write
            .open_table(orchestration_tables::PARENT_WAKES)?
            .remove(receipt.thread)?;
        let request_id = write
            .open_table(orchestration_tables::REQUESTS_BY_COMMAND)?
            .get(receipt.command)?
            .map(|value| value.value().to_owned());
        let Some(request_id) = request_id.as_deref().and_then(WorkRequestId::parse) else {
            return Ok(None);
        };
        let Some(mut request) = read_from_write(write, &request_id)? else {
            return Ok(None);
        };
        let (Some(child), Some(turn_id)) = (
            AppThreadId::parse(receipt.thread),
            TurnId::parse(receipt.turn),
        ) else {
            return Err(JournalError::InvalidTransition(
                "delivery receipt carries an invalid identifier".into(),
            ));
        };
        let changed = request
            .bind_turn(&child, turn_id.clone())
            .map_err(|error| JournalError::InvalidTransition(error.to_string()))?;
        if changed {
            put(write, &request)?;
        }
        if let Some(task_id) = request.task_id() {
            let mut bundle = read_bundle_from_write(write, task_id)?;
            bundle.request = request.clone();
            if !bundle.task.state.is_terminal()
                && bundle
                    .attempt
                    .observe_started(child.clone(), turn_id.clone())
                    .map_err(JournalError::InvalidTransition)?
            {
                bundle
                    .task
                    .transition(TaskTransition::TurnStarted)
                    .map_err(JournalError::InvalidTransition)?;
                bundle.task.updated_at_ms = unix_time_ms();
                write_bundle(write, &bundle)?;
                append_next_event(write, task_id, TaskEventKind::TurnStarted)?;
            }
        }
        Ok(Some(ReceiptBinding::Request {
            request_id,
            provider: request.provider.clone(),
            child,
            turn_id,
            cancel_requested: matches!(request.phase, RequestPhase::CancelRequested { .. }),
            task_id: request.task_id().cloned(),
        }))
    }

    /// Re-applies a receipt that is already durable in the outbox (a legacy
    /// command delivered before its request existed).
    pub(in crate::agent::orchestration) async fn bind_stored_receipt(
        &self,
        command_id: String,
        thread_id: String,
        turn_id: String,
    ) -> Result<Option<ReceiptBinding>, JournalError> {
        self.blocking(move |store| {
            let write = store.database().begin_write()?;
            let binding = Self::bind_from_receipt(
                &write,
                TurnReceipt {
                    command: &command_id,
                    thread: &thread_id,
                    turn: &turn_id,
                },
            )?;
            write.commit()?;
            Ok(binding)
        })
        .await
    }

    /// Records a queued follow-up request in its outbox command's
    /// transaction. Idempotent for a repeated command.
    ///
    /// # Errors
    /// Returns a storage or record failure, which rolls the command back.
    pub(in crate::agent::orchestration) fn record_followup_in_write(
        write: &WriteTransaction,
        request: &ChildWorkRequest,
    ) -> Result<(), JournalError> {
        // A repeated `send_agent` call reuses its command and its request.
        if write
            .open_table(orchestration_tables::REQUESTS_BY_COMMAND)?
            .get(request.command_id.as_str())?
            .is_some()
        {
            return Ok(());
        }
        insert_new(write, request).map(|_| ())
    }

    /// Reads one request.
    pub(in crate::agent::orchestration) async fn request(
        &self,
        request_id: &WorkRequestId,
    ) -> Result<Option<ChildWorkRequest>, JournalError> {
        let request_id = request_id.clone();
        self.blocking(move |store| {
            let read = store.database().begin_read()?;
            let table = read.open_table(orchestration_tables::WORK_REQUESTS)?;
            Ok(table
                .get(request_id.as_str())?
                .map(|encoded| serde_json::from_slice(encoded.value()))
                .transpose()?)
        })
        .await
    }

    /// Unsettled requests grouped by child, for the reconciler.
    pub(in crate::agent::orchestration) async fn open_by_child(
        &self,
    ) -> Result<BTreeMap<AppThreadId, Vec<ChildWorkRequest>>, JournalError> {
        self.indexed(orchestration_tables::OPEN_REQUESTS_BY_CHILD)
            .await
    }

    /// Settled requests awaiting handoff, grouped by parent.
    pub(in crate::agent::orchestration) async fn handoffs_by_parent(
        &self,
    ) -> Result<BTreeMap<AppThreadId, Vec<ChildWorkRequest>>, JournalError> {
        self.indexed(orchestration_tables::HANDOFFS_BY_PARENT).await
    }

    async fn indexed(
        &self,
        index: redb::TableDefinition<'static, &'static str, &'static str>,
    ) -> Result<BTreeMap<AppThreadId, Vec<ChildWorkRequest>>, JournalError> {
        self.blocking(move |store| {
            let read = store.database().begin_read()?;
            let index = read.open_table(index)?;
            let requests = read.open_table(orchestration_tables::WORK_REQUESTS)?;
            let mut grouped = BTreeMap::<AppThreadId, Vec<ChildWorkRequest>>::new();
            for entry in index.iter()? {
                let (key, value) = entry?;
                let Some((owner, _)) = key.value().split_once('\0') else {
                    continue;
                };
                let Some(owner) = AppThreadId::parse(owner) else {
                    continue;
                };
                let Some(encoded) = requests.get(value.value())? else {
                    continue;
                };
                let request: ChildWorkRequest = serde_json::from_slice(encoded.value())?;
                grouped.entry(owner).or_default().push(request);
            }
            Ok(grouped)
        })
        .await
    }

    /// Settles every request of `child` bound to `turn_id` (one provider turn
    /// may absorb several queued inputs) and the task each one starts.
    /// Only the request's own provider can settle it.
    ///
    /// # Errors
    /// Returns a storage or record failure; nothing is settled then.
    pub(in crate::agent::orchestration) async fn settle_by_turn(
        &self,
        provider: &ProviderId,
        child: &str,
        turn_id: &TurnId,
        end: TurnEnd,
        waiter_hold_ms: u64,
    ) -> Result<Vec<SettledRequest>, JournalError> {
        #[cfg(test)]
        check_injected(self)?;
        let provider = provider.clone();
        let child = child.to_owned();
        let turn_id = turn_id.clone();
        let hold = SettleHold {
            waiter_ms: waiter_hold_ms,
            cancel_ms: u64::try_from(super::super::agent_controls::CANCEL_ACK_WINDOW.as_millis())
                .unwrap_or(u64::MAX),
        };
        self.blocking(move |store| {
            let write = store.database().begin_write()?;
            let now = unix_time_ms();
            let mut settled = Vec::new();
            for mut request in open_requests_of(&write, &child)? {
                if request.provider != provider || !request.settle_turn(&turn_id, end, now, hold) {
                    continue;
                }
                persist_settled(&write, &request)?;
                settled.push(SettledRequest {
                    request_id: request.request_id.clone(),
                    task_id: request.task_id().cloned(),
                });
            }
            write.commit()?;
            Ok(settled)
        })
        .await
    }

    /// Settles requests that never got a provider turn.
    ///
    /// # Errors
    /// Returns a storage or record failure.
    pub(in crate::agent::orchestration) async fn settle_never_started(
        &self,
        request_ids: Vec<WorkRequestId>,
        reason: NeverStartedReason,
    ) -> Result<Vec<SettledRequest>, JournalError> {
        self.blocking(move |store| {
            let write = store.database().begin_write()?;
            let now = unix_time_ms();
            let mut settled = Vec::new();
            for request_id in request_ids {
                let Some(mut request) = read_from_write(&write, &request_id)? else {
                    continue;
                };
                if request.settle_never_started(reason, now) {
                    persist_settled(&write, &request)?;
                    settled.push(SettledRequest {
                        request_id,
                        task_id: request.task_id().cloned(),
                    });
                }
            }
            write.commit()?;
            Ok(settled)
        })
        .await
    }

    /// Settles the queued requests whose commands a parent cancel removed.
    ///
    /// # Errors
    /// Returns a storage or record failure.
    pub(in crate::agent::orchestration) async fn cancelled_commands(
        &self,
        command_ids: Vec<String>,
    ) -> Result<(), JournalError> {
        let ids = self
            .blocking(move |store| {
                let read = store.database().begin_read()?;
                let table = read.open_table(orchestration_tables::REQUESTS_BY_COMMAND)?;
                let mut ids = Vec::new();
                for command_id in command_ids {
                    if let Some(id) = table
                        .get(command_id.as_str())?
                        .and_then(|value| WorkRequestId::parse(value.value()))
                    {
                        ids.push(id);
                    }
                }
                Ok(ids)
            })
            .await?;
        self.settle_never_started(ids, NeverStartedReason::CancelledByParent)
            .await
            .map(|_| ())
    }

    /// Records the parent's cancel intent on every open request of a child.
    ///
    /// # Errors
    /// Returns a storage or record failure.
    pub(in crate::agent::orchestration) async fn cancel_child_requests(
        &self,
        child: &str,
    ) -> Result<Vec<WorkRequestId>, JournalError> {
        let child = child.to_owned();
        self.blocking(move |store| {
            let write = store.database().begin_write()?;
            let mut changed = Vec::new();
            for mut request in open_requests_of(&write, &child)? {
                if matches!(request.phase, RequestPhase::Running { .. }) && request.request_cancel()
                {
                    put(&write, &request)?;
                    changed.push(request.request_id);
                }
            }
            write.commit()?;
            Ok(changed)
        })
        .await
    }

    /// Postpones one handoff.
    ///
    /// # Errors
    /// Returns a storage or record failure.
    pub(in crate::agent::orchestration) async fn defer_handoff(
        &self,
        request_id: &WorkRequestId,
        next_attempt_at_ms: u64,
    ) -> Result<(), JournalError> {
        let request_id = request_id.clone();
        self.blocking(move |store| {
            let write = store.database().begin_write()?;
            if let Some(mut request) = read_from_write(&write, &request_id)?
                && request.defer_handoff(next_attempt_at_ms)
            {
                put(&write, &request)?;
            }
            write.commit()?;
            Ok(())
        })
        .await
    }

    /// Drops pending handoffs of a parent that can no longer take them.
    ///
    /// # Errors
    /// Returns a storage or record failure.
    pub(in crate::agent::orchestration) async fn suppress(
        &self,
        request_ids: Vec<WorkRequestId>,
        reason: SuppressReason,
    ) -> Result<(), JournalError> {
        self.blocking(move |store| {
            let write = store.database().begin_write()?;
            for request_id in request_ids {
                if let Some(mut request) = read_from_write(&write, &request_id)?
                    && request.suppress(reason)
                {
                    put(&write, &request)?;
                }
            }
            write.commit()?;
            Ok(())
        })
        .await
    }

    /// Whether the parent's newest notice still waits in the outbox. A
    /// rejected notice is removed and its requests return to the queue.
    ///
    /// # Errors
    /// Returns a storage or record failure.
    pub(in crate::agent::orchestration) async fn notice_pending(
        &self,
        parent: &AppThreadId,
        state: impl Fn(&WriteTransaction, &str) -> Result<NoticeCommandState, StoreError>
        + Send
        + 'static,
        retract: impl Fn(&WriteTransaction, &str) -> Result<bool, StoreError> + Send + 'static,
    ) -> Result<bool, JournalError> {
        let parent = parent.clone();
        self.blocking(move |store| {
            let write = store.database().begin_write()?;
            let pending = notice_gate(&write, &parent, &state, &retract)?;
            write.commit()?;
            Ok(pending)
        })
        .await
    }

    /// Atomically hands settled requests to one parent notice command. The
    /// command and the `Enqueued` transitions commit together or not at all.
    ///
    /// # Errors
    /// Returns a storage, record or enqueue failure; nothing is written then.
    pub(in crate::agent::orchestration) async fn hand_off(
        &self,
        parent: &AppThreadId,
        request_ids: Vec<WorkRequestId>,
        command_id: String,
        state: impl Fn(&WriteTransaction, &str) -> Result<NoticeCommandState, StoreError>
        + Send
        + 'static,
        retract: impl Fn(&WriteTransaction, &str) -> Result<bool, StoreError> + Send + 'static,
        enqueue: impl FnOnce(&WriteTransaction, &str, &str) -> Result<(), StoreError> + Send + 'static,
    ) -> Result<HandoffOutcome, JournalError> {
        let parent = parent.clone();
        self.blocking(move |store| {
            let write = store.database().begin_write()?;
            if notice_gate(&write, &parent, &state, &retract)? {
                write.commit()?;
                return Ok(HandoffOutcome::Blocked);
            }
            let mut requests = Vec::with_capacity(request_ids.len());
            for request_id in &request_ids {
                match read_from_write(&write, request_id)? {
                    Some(request)
                        if request.awaits_handoff() && request.parent_thread_id == parent =>
                    {
                        requests.push(request);
                    }
                    _ => return Ok(HandoffOutcome::Stale),
                }
            }
            enqueue(&write, &command_id, parent.as_str())?;
            for request in &mut requests {
                request.hand_off(&command_id);
                put(&write, request)?;
            }
            write.open_table(orchestration_tables::NOTICES)?.insert(
                command_id.as_str(),
                serde_json::to_vec(&NoticeRecord {
                    parent_thread_id: parent.clone(),
                    request_ids,
                })?
                .as_slice(),
            )?;
            write
                .open_table(orchestration_tables::LATEST_NOTICE_BY_PARENT)?
                .insert(parent.as_str(), command_id.as_str())?;
            write.commit()?;
            Ok(HandoffOutcome::Enqueued)
        })
        .await
    }

    /// Acknowledges the given requests (a terminal `wait_task`, or a cancel
    /// call that saw the terminal state in time).
    ///
    /// # Errors
    /// Returns a storage or record failure.
    pub(in crate::agent::orchestration) async fn acknowledge(
        &self,
        request_ids: Vec<WorkRequestId>,
        by: AckSource,
        retract: impl Fn(&WriteTransaction, &str) -> Result<bool, StoreError> + Send + 'static,
    ) -> Result<usize, JournalError> {
        self.blocking(move |store| {
            let write = store.database().begin_write()?;
            let mut acknowledged = 0;
            for request_id in request_ids {
                if let Some(mut request) = read_from_write(&write, &request_id)?
                    && acknowledge_in_write(&write, &mut request, by, &retract)?
                {
                    acknowledged += 1;
                }
            }
            write.commit()?;
            Ok(acknowledged)
        })
        .await
    }

    /// Acknowledges what a terminal `wait_agent` of `parent` returned: every
    /// request of `child` that ran in `turn_id`. A request still bound to that
    /// turn is settled from the observed end first, so no later push repeats
    /// it. Only results the parent has not received yet can change: those
    /// awaiting handoff and those in its newest (possibly still queued) notice.
    ///
    /// # Errors
    /// Returns a storage or record failure.
    pub(in crate::agent::orchestration) async fn acknowledge_turn(
        &self,
        provider: &ProviderId,
        parent: &AppThreadId,
        child: &AppThreadId,
        turn_id: &TurnId,
        end: TurnEnd,
        retract: impl Fn(&WriteTransaction, &str) -> Result<bool, StoreError> + Send + 'static,
    ) -> Result<usize, JournalError> {
        let provider = provider.clone();
        let parent = parent.clone();
        let child = child.clone();
        let turn_id = turn_id.clone();
        self.blocking(move |store| {
            let write = store.database().begin_write()?;
            let now = unix_time_ms();
            for mut request in open_requests_of(&write, child.as_str())? {
                if request.provider == provider
                    && request.settle_turn(&turn_id, end, now, SettleHold::NONE)
                {
                    persist_settled(&write, &request)?;
                }
            }
            let mut candidates = indexed_ids(
                &write,
                orchestration_tables::HANDOFFS_BY_PARENT,
                parent.as_str(),
            )?;
            let latest = write
                .open_table(orchestration_tables::LATEST_NOTICE_BY_PARENT)?
                .get(parent.as_str())?
                .map(|value| value.value().to_owned());
            if let Some(latest) = latest {
                let record: Option<NoticeRecord> = write
                    .open_table(orchestration_tables::NOTICES)?
                    .get(latest.as_str())?
                    .map(|encoded| serde_json::from_slice(encoded.value()))
                    .transpose()?;
                candidates.extend(record.map(|record| record.request_ids).unwrap_or_default());
            }
            let mut acknowledged = 0;
            for request_id in candidates {
                let Some(mut request) = read_from_write(&write, &request_id)? else {
                    continue;
                };
                let ran_in_turn = matches!(
                    &request.phase,
                    RequestPhase::Settled {
                        settlement: Settlement::Ran { turn_id: ran, .. },
                        ..
                    } if ran == &turn_id
                );
                if ran_in_turn
                    && request.child_thread_id.as_ref() == Some(&child)
                    && request.provider == provider
                    && acknowledge_in_write(&write, &mut request, AckSource::WaitAgent, &retract)?
                {
                    acknowledged += 1;
                }
            }
            write.commit()?;
            Ok(acknowledged)
        })
        .await
    }
}

/// Returns whether the parent's newest notice is still queued. A failed one
/// is removed and its requests return to the handoff queue.
fn notice_gate(
    write: &WriteTransaction,
    parent: &AppThreadId,
    state: &dyn Fn(&WriteTransaction, &str) -> Result<NoticeCommandState, StoreError>,
    retract: &dyn Fn(&WriteTransaction, &str) -> Result<bool, StoreError>,
) -> Result<bool, JournalError> {
    let latest = write
        .open_table(orchestration_tables::LATEST_NOTICE_BY_PARENT)?
        .get(parent.as_str())?
        .map(|value| value.value().to_owned());
    let Some(latest) = latest else {
        return Ok(false);
    };
    match state(write, &latest)? {
        NoticeCommandState::Queued => Ok(true),
        NoticeCommandState::Dispatched | NoticeCommandState::Missing => Ok(false),
        NoticeCommandState::Failed => {
            retract(write, &latest)?;
            let record: Option<NoticeRecord> = write
                .open_table(orchestration_tables::NOTICES)?
                .remove(latest.as_str())?
                .map(|encoded| serde_json::from_slice(encoded.value()))
                .transpose()?;
            write
                .open_table(orchestration_tables::LATEST_NOTICE_BY_PARENT)?
                .remove(parent.as_str())?;
            let now = unix_time_ms();
            for request_id in record.map(|record| record.request_ids).unwrap_or_default() {
                if let Some(mut request) = read_from_write(write, &request_id)?
                    && request.return_to_handoff(now)
                {
                    request.defer_handoff(now.saturating_add(1_000));
                    put(write, &request)?;
                }
            }
            info!(parent_thread_id = %parent, "a rejected child-result notice returned to the handoff queue");
            Ok(false)
        }
    }
}
