//! Durable storage owned by the turn-delivery subsystem.
//!
//! Initial orchestration prompts live here until a child thread is bound and
//! the command can be promoted atomically into the ordinary turn outbox. Task
//! journal tables store only the stable command id.

use redb::{ReadableTable, TableDefinition, WriteTransaction};
use serde::{Deserialize, Serialize};
use serde_json::Value;

use super::{
    IndexStore, OutboxCommand, OutboxPresentation, OutboxPutMetadata, OutboxState, StoreError,
};

pub(crate) const RESERVATIONS: TableDefinition<&str, &[u8]> =
    TableDefinition::new("orchestration_turn_reservations");

/// Prompt-bearing initial turn waiting for a durable child binding.
#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ReservedTurnCommand {
    pub task_id: String,
    pub command_id: String,
    pub params: Value,
    pub created_at_ms: u64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ReservedTurnCommandRef<'a> {
    task_id: &'a str,
    command_id: &'a str,
    params: &'a Value,
    created_at_ms: u64,
}

pub(super) fn create(write: &WriteTransaction) -> Result<(), StoreError> {
    write.open_table(RESERVATIONS)?;
    Ok(())
}

/// Inserts a prompt-bearing reservation inside the caller's transaction.
/// This is the turn-delivery-owned half of atomic orchestration admission.
pub(crate) fn reserve(
    write: &WriteTransaction,
    task_id: &str,
    command_id: &str,
    params: &Value,
    created_at_ms: u64,
) -> Result<(), StoreError> {
    super::validate_outbox_id(command_id, "command id")?;
    let encoded = serde_json::to_vec(&ReservedTurnCommandRef {
        task_id,
        command_id,
        params,
        created_at_ms,
    })?;
    if encoded.len() > super::MAX_OUTBOX_COMMAND_BYTES {
        return Err(StoreError::CorruptedIndex(
            "reserved turn command exceeds 1 MiB".into(),
        ));
    }
    let mut table = write.open_table(RESERVATIONS)?;
    if let Some(existing) = table.get(command_id)?.map(|value| value.value().to_vec()) {
        let existing: ReservedTurnCommand = serde_json::from_slice(&existing)?;
        if existing.task_id != task_id
            || existing.command_id != command_id
            || existing.params != *params
            || existing.created_at_ms != created_at_ms
        {
            return Err(StoreError::CorruptedIndex(
                "reserved turn command id already has a different payload".into(),
            ));
        }
        return Ok(());
    }
    table.insert(command_id, encoded.as_slice())?;
    Ok(())
}

impl IndexStore {
    /// Records a history-reconciled receipt and its matching provider turn
    /// atomically. Only an uncertain command can be acknowledged this way.
    ///
    /// # Errors
    /// Returns an error when the command is missing, corrupt, or persistence fails.
    pub(crate) fn outbox_reconcile_delivered(
        &self,
        command_id: &str,
        turn_id: &str,
    ) -> Result<Option<OutboxCommand>, StoreError> {
        super::validate_outbox_id(command_id, "command id")?;
        let observer = self.receipt_observer();
        super::validate_outbox_id(turn_id, "turn id")?;
        let write = self.database.begin_write()?;
        let reconciled = {
            let mut table = write.open_table(super::OUTBOX)?;
            let Some(encoded) = table.get(command_id)?.map(|value| value.value().to_vec()) else {
                return Ok(None);
            };
            let mut command: OutboxCommand = serde_json::from_slice(&encoded)?;
            if command.state != OutboxState::Uncertain {
                return Ok(Some(command));
            }
            command.state = OutboxState::Delivered;
            command.last_error = None;
            command.delivered_turn_id = Some(turn_id.to_owned());
            command.next_attempt_at = 0;
            command.updated_at = super::unix_time_ms();
            let encoded = serde_json::to_vec(&command)?;
            table.insert(command_id, encoded.as_slice())?;
            Some(command)
        };
        let mut notify_after_commit = None;
        if let (Some(observer), Some(command)) = (observer, &reconciled)
            && command.state == OutboxState::Delivered
        {
            observer.delivered(
                &write,
                super::TurnReceipt {
                    command: command_id,
                    thread: &command.remote_thread_id,
                    turn: turn_id,
                },
            )?;
            notify_after_commit = Some(observer);
        }
        write.commit()?;
        if let Some(observer) = notify_after_commit {
            observer.committed();
        }
        Ok(reconciled)
    }

    /// Promotes a task's reserved initial turn into the durable outbox after
    /// the task has a child thread. Repeating the promotion is idempotent.
    ///
    /// # Errors
    /// Returns an error when the reservation is corrupt, the existing outbox
    /// row has another payload, or persistence fails.
    pub fn promote_orchestration_turn(
        &self,
        command_id: &str,
        child_thread_id: &str,
        workspace_request_id: Option<&str>,
    ) -> Result<OutboxCommand, StoreError> {
        let write = self.database.begin_write()?;
        let reservation: Option<ReservedTurnCommand> = {
            let table = write.open_table(RESERVATIONS)?;
            table
                .get(command_id)?
                .map(|encoded| serde_json::from_slice(encoded.value()))
                .transpose()?
        };
        let command = if let Some(reservation) = reservation {
            let mut params = reservation.params;
            let object = params.as_object_mut().ok_or_else(|| {
                StoreError::CorruptedIndex("reserved turn params must be an object".into())
            })?;
            object.insert("threadId".into(), Value::String(child_thread_id.to_owned()));
            object.insert(
                "clientUserMessageId".into(),
                Value::String(command_id.to_owned()),
            );
            let command = put_turn_start_in_write(
                &write,
                command_id,
                child_thread_id,
                params,
                OutboxPutMetadata {
                    created_at: Some(reservation.created_at_ms),
                    presentation: OutboxPresentation::Delivery,
                    workspace_request_id,
                },
            )?;
            write.open_table(RESERVATIONS)?.remove(command_id)?;
            command
        } else {
            let table = write.open_table(super::OUTBOX)?;
            table
                .get(command_id)?
                .map(|encoded| serde_json::from_slice(encoded.value()))
                .transpose()?
                .ok_or_else(|| {
                    StoreError::CorruptedIndex("reserved orchestration turn was not found".into())
                })?
        };
        write.commit()?;
        Ok(command)
    }

    /// Removes an initial turn that was cancelled before child binding.
    ///
    /// # Errors
    /// Returns an error when persistence fails.
    pub fn cancel_orchestration_turn_before_start(
        &self,
        command_id: &str,
    ) -> Result<bool, StoreError> {
        let write = self.database.begin_write()?;
        let cancelled = {
            let removed = write
                .open_table(RESERVATIONS)?
                .remove(command_id)?
                .is_some();
            if removed {
                true
            } else {
                let mut outbox = write.open_table(super::OUTBOX)?;
                let Some(encoded) = outbox.get(command_id)?.map(|value| value.value().to_vec())
                else {
                    return Ok(false);
                };
                let command: OutboxCommand = serde_json::from_slice(&encoded)?;
                if command.has_in_flight_claim()
                    || !matches!(command.state, OutboxState::Queued | OutboxState::Failed)
                {
                    return Ok(false);
                }
                outbox.remove(command_id)?;
                true
            }
        };
        write.commit()?;
        Ok(cancelled)
    }
}

/// Stores a hidden, idle-only notice turn inside its caller's metadata
/// transaction.
pub(crate) fn put_notice_turn_in_write(
    write: &redb::WriteTransaction,
    command_id: &str,
    thread_id: &str,
    params: Value,
) -> Result<OutboxCommand, StoreError> {
    put_turn_start_in_write(
        write,
        command_id,
        thread_id,
        params,
        OutboxPutMetadata {
            created_at: None,
            presentation: OutboxPresentation::Notice,
            workspace_request_id: None,
        },
    )
}

/// Dispatch state of one notice command as its batching owner needs it.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum NoticeCommandState {
    /// No row: pruned after delivery, or removed.
    Missing,
    /// Not yet claimed for dispatch.
    Queued,
    /// Claimed or delivered: it may have reached the provider.
    Dispatched,
    /// Definitely rejected; it will never be dispatched.
    Failed,
}

fn read_command(
    write: &redb::WriteTransaction,
    command_id: &str,
) -> Result<Option<OutboxCommand>, StoreError> {
    let table = write.open_table(super::OUTBOX)?;
    table
        .get(command_id)?
        .map(|encoded| serde_json::from_slice(encoded.value()).map_err(StoreError::from))
        .transpose()
}

pub(crate) fn notice_state_in_write(
    write: &redb::WriteTransaction,
    command_id: &str,
) -> Result<NoticeCommandState, StoreError> {
    Ok(match read_command(write, command_id)? {
        None => NoticeCommandState::Missing,
        Some(command) if command.has_in_flight_claim() => NoticeCommandState::Dispatched,
        Some(command) => match command.state {
            OutboxState::Queued => NoticeCommandState::Queued,
            OutboxState::Failed => NoticeCommandState::Failed,
            OutboxState::Uncertain | OutboxState::Delivered => NoticeCommandState::Dispatched,
        },
    })
}

pub(crate) fn retract_notice_in_write(
    write: &redb::WriteTransaction,
    command_id: &str,
) -> Result<bool, StoreError> {
    if !matches!(
        notice_state_in_write(write, command_id)?,
        NoticeCommandState::Queued | NoticeCommandState::Failed
    ) {
        return Ok(false);
    }
    write.open_table(super::OUTBOX)?.remove(command_id)?;
    Ok(true)
}

/// Not-yet-dispatched (`queued` or `uncertain`) commands whose id starts
/// with `prefix`, as `(command id, thread id)`; no params are returned.
pub(crate) fn open_commands_in_write(
    write: &redb::WriteTransaction,
    prefix: &str,
) -> Result<Vec<(String, String)>, StoreError> {
    let table = write.open_table(super::OUTBOX)?;
    let mut commands = Vec::new();
    for entry in table.iter()? {
        let (key, value) = entry?;
        if !key.value().starts_with(prefix) {
            continue;
        }
        let command: OutboxCommand = serde_json::from_slice(value.value())?;
        if matches!(command.state, OutboxState::Queued | OutboxState::Uncertain) {
            commands.push((command.command_id, command.remote_thread_id));
        }
    }
    Ok(commands)
}

impl IndexStore {
    /// Inserts a durable turn command and runs the caller's prompt-free
    /// coordination writer in the same transaction.
    ///
    /// # Errors
    /// Returns the same errors as an ordinary insert, or the writer's error;
    /// either rolls both back.
    pub(crate) fn outbox_put_turn_start_recorded(
        &self,
        command_id: &str,
        remote_thread_id: &str,
        params: Value,
        presentation: OutboxPresentation,
        record: impl FnOnce(&WriteTransaction) -> Result<(), StoreError>,
    ) -> Result<OutboxCommand, StoreError> {
        let write = self.database.begin_write()?;
        let command = put_turn_start_in_write(
            &write,
            command_id,
            remote_thread_id,
            params,
            OutboxPutMetadata {
                created_at: None,
                presentation,
                workspace_request_id: None,
            },
        )?;
        record(&write)?;
        write.commit()?;
        Ok(command)
    }
}

pub(super) fn put_turn_start_in_write(
    write: &redb::WriteTransaction,
    command_id: &str,
    remote_thread_id: &str,
    params: Value,
    metadata: OutboxPutMetadata<'_>,
) -> Result<OutboxCommand, StoreError> {
    let OutboxPutMetadata {
        created_at,
        presentation,
        workspace_request_id,
    } = metadata;
    super::validate_outbox_id(command_id, "command id")?;
    super::validate_outbox_id(remote_thread_id, "remote thread id")?;
    if let Some(request_id) = workspace_request_id {
        super::validate_outbox_id(request_id, "workspace request id")?;
    }
    super::validate_turn_start_params(command_id, remote_thread_id, &params)?;
    let params_bytes = serde_json::to_vec(&params)?.len();
    if params_bytes > super::MAX_OUTBOX_COMMAND_BYTES {
        return Err(StoreError::CorruptedIndex(
            "outbox command exceeds 1 MiB".into(),
        ));
    }
    let mut table = write.open_table(super::OUTBOX)?;
    if let Some(encoded) = table.get(command_id)?.map(|value| value.value().to_vec()) {
        let existing: OutboxCommand = serde_json::from_slice(&encoded)?;
        if existing.remote_thread_id != remote_thread_id
            || existing.method != "turn/start"
            || existing.params != params
            || existing.presentation != presentation
            || existing.workspace_request_id.as_deref() != workspace_request_id
            || existing.owner_context.is_some()
            || existing.queue_input.is_some()
        {
            return Err(StoreError::CorruptedIndex(
                "outbox command id already has a different payload".into(),
            ));
        }
        return Ok(existing);
    }
    let (_, max_order) = super::prune_delivered_outbox_receipts(&mut table)?;
    let now = super::unix_time_ms();
    let command = OutboxCommand {
        command_id: command_id.to_owned(),
        remote_thread_id: remote_thread_id.to_owned(),
        method: "turn/start".into(),
        params,
        state: OutboxState::Queued,
        presentation,
        workspace_request_id: workspace_request_id.map(str::to_owned),
        owner_context: None,
        queue_input: None,
        order: max_order.saturating_add(1),
        created_at: created_at.unwrap_or(now),
        updated_at: now,
        last_error: None,
        delivered_turn_id: None,
        attempts: 0,
        next_attempt_at: 0,
        claim: None,
    };
    let encoded = serde_json::to_vec(&command)?;
    super::ensure_outbox_owner_quota(super::outbox_owner_bytes(&table, None)?, encoded.len())?;
    table.insert(command_id, encoded.as_slice())?;
    Ok(command)
}
