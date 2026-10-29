//! Deep owner API for durable `turn/start` delivery.
//!
//! Client queue RPCs and orchestration both use the same outbox. An
//! orchestration turn is reserved before an external child exists, then
//! promoted with its stable command id after child binding. This module owns
//! pump execution, provider dispatch, claims and history reconciliation.

mod pump;

pub(crate) use pump::{PumpContext, reconcile_direct_turn_start, run_outbox_pump};

use std::sync::Arc;

use rand::Rng;
use serde_json::{Value, json};
use tracing::warn;

pub(crate) use crate::store::TurnReceiptObserver;
use crate::store::turn_delivery_tables;
pub(crate) use crate::store::turn_delivery_tables::NoticeCommandState;
use crate::store::{
    IndexStore, OutboxClaimOutcome, OutboxClaimResolution, OutboxClaimResolutionOutcome,
    OutboxCommand, OutboxPresentation, OutboxState, StoreError,
};

const OUTBOX_RETRY_BASE_MS: u64 = 1_000;
const OUTBOX_RETRY_MAX_MS: u64 = 30_000;

/// Prompt-bearing initial turn held by the delivery owner until a task has a
/// durable child binding. Orchestration supplies the reservation as part of
/// admission but never sees the storage representation or reservation table.
#[derive(Clone, Debug)]
pub(crate) struct InitialTurnReservation {
    pub(crate) task_id: String,
    pub(crate) command_id: String,
    pub(crate) params: Value,
    pub(crate) created_at_ms: u64,
}

/// Reserves an initial turn inside the caller's admission transaction.
///
/// # Errors
///
/// Returns a store error when the reservation is invalid, conflicts with an
/// existing command, or cannot be persisted.
pub(crate) fn reserve_initial_turn(
    write: &redb::WriteTransaction,
    reservation: &InitialTurnReservation,
) -> Result<(), StoreError> {
    turn_delivery_tables::reserve(
        write,
        &reservation.task_id,
        &reservation.command_id,
        &reservation.params,
        reservation.created_at_ms,
    )
}

/// Transfers a parent completion notice into the outbox in the caller's
/// metadata transaction. The caller commits both ownership changes or
/// neither. The command is a hidden, model-only [`OutboxPresentation::Notice`]
/// that waits for an idle parent and is never listed to a client.
pub(crate) fn enqueue_completion_in_write(
    write: &redb::WriteTransaction,
    command_id: &str,
    parent_thread_id: &str,
    message: &str,
) -> Result<(), StoreError> {
    let params = json!({
        "threadId": parent_thread_id,
        "clientUserMessageId": command_id,
        "input": [{"type": "text", "text": message, "text_elements": []}],
    });
    turn_delivery_tables::put_notice_turn_in_write(write, command_id, parent_thread_id, params)?;
    Ok(())
}

/// Reads a notice command's dispatch state in the caller's transaction.
///
/// # Errors
/// Returns a store error when the row is unreadable.
pub(crate) fn notice_state_in_write(
    write: &redb::WriteTransaction,
    command_id: &str,
) -> Result<NoticeCommandState, StoreError> {
    turn_delivery_tables::notice_state_in_write(write, command_id)
}

/// Not-yet-dispatched commands with an id prefix, as `(command id, thread
/// id)`, read in the caller's transaction (one-time migrations).
///
/// # Errors
/// Returns a store error when the outbox is unreadable.
pub(crate) fn open_commands_in_write(
    write: &redb::WriteTransaction,
    prefix: &str,
) -> Result<Vec<(String, String)>, StoreError> {
    turn_delivery_tables::open_commands_in_write(write, prefix)
}

/// Removes a notice that has not been dispatched (still queued, or failed)
/// in the caller's transaction. Returns `false` when it may have reached the
/// provider.
///
/// # Errors
/// Returns a store error when the row is unreadable or cannot be removed.
pub(crate) fn retract_notice_in_write(
    write: &redb::WriteTransaction,
    command_id: &str,
) -> Result<bool, StoreError> {
    turn_delivery_tables::retract_notice_in_write(write, command_id)
}

pub(crate) enum ClaimResolution {
    Delivered(Option<String>),
    NotSent(u64),
    /// The provider answered `busy`: keep the command queued until idle.
    Busy,
    Rejected(String),
    Indeterminate {
        error: String,
        retry_after_ms: u64,
    },
}

#[derive(Clone)]
pub(crate) struct TurnDelivery {
    store: Arc<IndexStore>,
    wakeup: Arc<tokio::sync::Notify>,
    local_events: tokio::sync::mpsc::Sender<Value>,
}

impl TurnDelivery {
    #[must_use]
    pub(crate) fn new(
        store: Arc<IndexStore>,
        wakeup: Arc<tokio::sync::Notify>,
        local_events: tokio::sync::mpsc::Sender<Value>,
    ) -> Self {
        Self {
            store,
            wakeup,
            local_events,
        }
    }

    /// Installs the prompt-free observer that runs inside every delivery
    /// receipt transaction of this store. A restarted owner replaces it.
    pub(crate) fn install_receipt_observer(&self, observer: Arc<dyn TurnReceiptObserver>) {
        self.store.install_receipt_observer(observer);
    }

    pub(crate) fn wake(&self) {
        self.wakeup.notify_one();
    }

    /// Lists durable commands without exposing the storage owner, including
    /// hidden notices. Internal owners only; clients use [`Self::client_list`].
    pub(crate) async fn list(
        &self,
        thread_id: Option<&str>,
    ) -> Result<Vec<OutboxCommand>, StoreError> {
        let store = self.store.clone();
        let thread_id = thread_id.map(str::to_owned);
        tokio::task::spawn_blocking(move || store.outbox_list(thread_id.as_deref()))
            .await
            .map_err(|error| StoreError::CorruptedIndex(error.to_string()))?
    }

    /// The commands a client may see: every command except hidden notices.
    pub(crate) async fn client_list(
        &self,
        thread_id: Option<&str>,
    ) -> Result<Vec<OutboxCommand>, StoreError> {
        let mut commands = self.list(thread_id).await?;
        commands.retain(|command| command.presentation != OutboxPresentation::Notice);
        Ok(commands)
    }

    /// One command a client may address; a hidden notice reads as absent.
    pub(crate) async fn client_command(
        &self,
        command_id: &str,
    ) -> Result<Option<OutboxCommand>, StoreError> {
        Ok(self
            .command(command_id)
            .await?
            .filter(|command| command.presentation != OutboxPresentation::Notice))
    }

    pub(crate) async fn put(
        &self,
        command_id: &str,
        thread_id: &str,
        params: Value,
        created_at: Option<u64>,
        presentation: OutboxPresentation,
        workspace_request_id: Option<&str>,
    ) -> Result<OutboxCommand, StoreError> {
        let store = self.store.clone();
        let command_id = command_id.to_owned();
        let thread_id = thread_id.to_owned();
        let workspace_request_id = workspace_request_id.map(str::to_owned);
        let command = tokio::task::spawn_blocking(move || {
            store.outbox_put_turn_start_with_workspace(
                &command_id,
                &thread_id,
                params,
                created_at,
                presentation,
                workspace_request_id.as_deref(),
            )
        })
        .await
        .map_err(|error| StoreError::CorruptedIndex(error.to_string()))??;
        Ok(command)
    }

    pub(crate) async fn edit_prompt(
        &self,
        command_id: &str,
        input: Value,
    ) -> Result<OutboxCommand, StoreError> {
        let store = self.store.clone();
        let command_id = command_id.to_owned();
        let command =
            tokio::task::spawn_blocking(move || store.outbox_edit_prompt(&command_id, &input))
                .await
                .map_err(|error| StoreError::CorruptedIndex(error.to_string()))??;
        Ok(command)
    }

    pub(crate) async fn cancel(&self, command_id: &str) -> Result<bool, StoreError> {
        let store = self.store.clone();
        let command_id = command_id.to_owned();
        let cancelled = tokio::task::spawn_blocking(move || store.outbox_cancel(&command_id))
            .await
            .map_err(|error| StoreError::CorruptedIndex(error.to_string()))??;
        Ok(cancelled)
    }

    pub(crate) async fn retry(&self, command_id: &str) -> Result<OutboxCommand, StoreError> {
        let store = self.store.clone();
        let command_id = command_id.to_owned();
        let command = tokio::task::spawn_blocking(move || store.outbox_retry_failed(&command_id))
            .await
            .map_err(|error| StoreError::CorruptedIndex(error.to_string()))??;
        Ok(command)
    }

    pub(crate) async fn place(
        &self,
        command_id: &str,
        before_command_id: Option<&str>,
    ) -> Result<bool, StoreError> {
        let store = self.store.clone();
        let command_id = command_id.to_owned();
        let before_command_id = before_command_id.map(str::to_owned);
        let moved = tokio::task::spawn_blocking(move || {
            store.outbox_place(&command_id, before_command_id.as_deref())
        })
        .await
        .map_err(|error| StoreError::CorruptedIndex(error.to_string()))??;
        Ok(moved)
    }

    pub(crate) async fn ready_heads(&self) -> Result<Vec<OutboxCommand>, StoreError> {
        let store = self.store.clone();
        tokio::task::spawn_blocking(move || store.outbox_ready_heads())
            .await
            .map_err(|error| StoreError::CorruptedIndex(error.to_string()))?
    }

    pub(crate) async fn prune_delivered_receipts(&self) -> Result<usize, StoreError> {
        let store = self.store.clone();
        tokio::task::spawn_blocking(move || store.outbox_prune_delivered_receipts())
            .await
            .map_err(|error| StoreError::CorruptedIndex(error.to_string()))?
    }

    pub(crate) async fn recover_legacy_failures(&self) -> Result<Vec<String>, StoreError> {
        let store = self.store.clone();
        tokio::task::spawn_blocking(move || store.outbox_recover_legacy_account_pool_failures())
            .await
            .map_err(|error| StoreError::CorruptedIndex(error.to_string()))?
    }

    pub(crate) async fn claim_dispatch(
        &self,
        command_id: &str,
    ) -> Result<OutboxClaimOutcome, StoreError> {
        let store = self.store.clone();
        let command_id = command_id.to_owned();
        let outcome = tokio::task::spawn_blocking(move || store.outbox_claim_dispatch(&command_id))
            .await
            .map_err(|error| StoreError::CorruptedIndex(error.to_string()))??;
        if let OutboxClaimOutcome::Acquired { command, .. } = &outcome {
            self.emit_changed(&command.remote_thread_id).await;
        }
        Ok(outcome)
    }

    pub(crate) async fn claim_steer(
        &self,
        command_id: &str,
        operation_id: &str,
    ) -> Result<OutboxClaimOutcome, StoreError> {
        let store = self.store.clone();
        let command_id = command_id.to_owned();
        let operation_id = operation_id.to_owned();
        let outcome = tokio::task::spawn_blocking(move || {
            store.outbox_claim_steer(&command_id, &operation_id)
        })
        .await
        .map_err(|error| StoreError::CorruptedIndex(error.to_string()))??;
        if let OutboxClaimOutcome::Acquired { command, .. } = &outcome {
            self.emit_changed(&command.remote_thread_id).await;
        }
        Ok(outcome)
    }

    pub(crate) async fn resolve_claim(
        &self,
        thread_id: &str,
        command_id: &str,
        token: u64,
        resolution: ClaimResolution,
    ) {
        let store = self.store.clone();
        let command_id = command_id.to_owned();
        let result = tokio::task::spawn_blocking(move || match resolution {
            ClaimResolution::Delivered(turn_id) => store.outbox_resolve_claim(
                &command_id,
                token,
                OutboxClaimResolution::Delivered {
                    turn_id: turn_id.as_deref(),
                },
            ),
            ClaimResolution::NotSent(retry_after_ms) => store.outbox_resolve_claim(
                &command_id,
                token,
                OutboxClaimResolution::NotSent { retry_after_ms },
            ),
            ClaimResolution::Busy => {
                store.outbox_resolve_claim(&command_id, token, OutboxClaimResolution::Busy)
            }
            ClaimResolution::Rejected(error) => store.outbox_resolve_claim(
                &command_id,
                token,
                OutboxClaimResolution::Rejected { error: &error },
            ),
            ClaimResolution::Indeterminate {
                error,
                retry_after_ms,
            } => store.outbox_resolve_claim(
                &command_id,
                token,
                OutboxClaimResolution::Indeterminate {
                    error: &error,
                    retry_after_ms,
                },
            ),
        })
        .await;
        match result {
            Ok(Ok(OutboxClaimResolutionOutcome::Applied(_))) => {
                self.emit_changed(thread_id).await;
            }
            Ok(Ok(
                OutboxClaimResolutionOutcome::AlreadyResolved(_)
                | OutboxClaimResolutionOutcome::Stale(_),
            )) => {}
            Ok(Err(error)) => warn!(err = ?error, "durable outbox claim resolution failed"),
            Err(error) => warn!(err = ?error, "durable outbox claim resolution worker failed"),
        }
    }

    pub(crate) async fn fail_queued(&self, thread_id: &str, command_id: &str, error: &str) {
        let store = self.store.clone();
        let command_id = command_id.to_owned();
        let error = error.to_owned();
        let result =
            tokio::task::spawn_blocking(move || store.outbox_fail_queued(&command_id, &error))
                .await;
        match result {
            Ok(Ok(Some(_))) => self.emit_changed(thread_id).await,
            Ok(Ok(None)) => {}
            Ok(Err(error)) => warn!(err = ?error, "durable queued outbox failure update failed"),
            Err(error) => warn!(err = ?error, "durable queued outbox failure worker failed"),
        }
    }

    pub(crate) async fn set_state(
        &self,
        thread_id: &str,
        command_id: &str,
        state: OutboxState,
        error: Option<&str>,
    ) {
        let store = self.store.clone();
        let command_id = command_id.to_owned();
        let error = error.map(str::to_owned);
        let result = tokio::task::spawn_blocking(move || {
            store.outbox_set_state(&command_id, state, error.as_deref())
        })
        .await;
        match result {
            Ok(Ok(_)) => self.emit_changed(thread_id).await,
            Ok(Err(error)) => warn!(err = ?error, "durable outbox update failed"),
            Err(error) => warn!(err = ?error, "durable outbox update worker failed"),
        }
    }

    pub(crate) async fn reconcile_delivered(
        &self,
        thread_id: &str,
        command_id: &str,
        turn_id: &str,
    ) {
        let store = self.store.clone();
        let command_id = command_id.to_owned();
        let turn_id = turn_id.to_owned();
        let result = tokio::task::spawn_blocking(move || {
            store.outbox_reconcile_delivered(&command_id, &turn_id)
        })
        .await;
        match result {
            Ok(Ok(Some(_))) => self.emit_changed(thread_id).await,
            Ok(Ok(None)) => {}
            Ok(Err(error)) => warn!(err = ?error, "durable outbox history reconciliation failed"),
            Err(error) => warn!(err = ?error, "durable outbox reconciliation worker failed"),
        }
    }

    pub(crate) async fn defer(
        &self,
        thread_id: &str,
        command_id: &str,
        state: OutboxState,
        error: &str,
        delay_ms: u64,
    ) {
        let store = self.store.clone();
        let command_id = command_id.to_owned();
        let error = error.to_owned();
        let result = tokio::task::spawn_blocking(move || {
            store.outbox_defer(&command_id, state, &error, delay_ms)
        })
        .await;
        match result {
            Ok(Ok(_)) => self.emit_changed(thread_id).await,
            Ok(Err(error)) => warn!(err = ?error, "durable outbox retry scheduling failed"),
            Err(error) => warn!(err = ?error, "durable outbox retry worker failed"),
        }
    }

    pub(crate) async fn wait(
        &self,
        thread_id: &str,
        command_id: &str,
        state: OutboxState,
        error: Option<&str>,
        delay_ms: u64,
    ) {
        let store = self.store.clone();
        let command_id = command_id.to_owned();
        let error = error.map(str::to_owned);
        let result = tokio::task::spawn_blocking(move || {
            store.outbox_wait(&command_id, state, error.as_deref(), delay_ms)
        })
        .await;
        match result {
            Ok(Ok((_, true))) => self.emit_changed(thread_id).await,
            Ok(Ok((_, false))) => {}
            Ok(Err(error)) => warn!(err = ?error, "durable outbox wait scheduling failed"),
            Err(error) => warn!(err = ?error, "durable outbox wait worker failed"),
        }
    }

    pub(crate) async fn emit_changed(&self, thread_id: &str) {
        let listed = self.client_list(Some(thread_id)).await;
        let Ok(data) = listed else {
            warn!(thread_id, "durable outbox notification read failed");
            return;
        };
        let _ = self
            .local_events
            .send(json!({
                "method": "companion/queue/changed",
                "params": {"threadId": thread_id, "data": data}
            }))
            .await;
    }

    /// Makes a reserved task turn dispatchable for its bound child.
    ///
    /// # Errors
    /// Returns the durable-store failure.
    pub(crate) async fn bind_initial_turn(
        &self,
        command_id: &str,
        child_thread_id: &str,
        workspace_request_id: Option<&str>,
    ) -> Result<OutboxCommand, StoreError> {
        let store = self.store.clone();
        let command_id = command_id.to_owned();
        let child_thread_id = child_thread_id.to_owned();
        let workspace_request_id = workspace_request_id.map(str::to_owned);
        let command = tokio::task::spawn_blocking(move || {
            store.promote_orchestration_turn(
                &command_id,
                &child_thread_id,
                workspace_request_id.as_deref(),
            )
        })
        .await
        .map_err(|error| StoreError::CorruptedIndex(error.to_string()))??;
        self.emit_changed(&command.remote_thread_id).await;
        self.wakeup.notify_one();
        Ok(command)
    }

    /// Reads the authoritative durable command state.
    ///
    /// # Errors
    /// Returns the durable-store failure.
    pub(crate) async fn command(
        &self,
        command_id: &str,
    ) -> Result<Option<OutboxCommand>, StoreError> {
        let store = self.store.clone();
        let command_id = command_id.to_owned();
        tokio::task::spawn_blocking(move || store.outbox_get(&command_id))
            .await
            .map_err(|error| StoreError::CorruptedIndex(error.to_string()))?
    }

    /// Waits briefly for the pump's first durable receipt so compatibility
    /// tools can preserve their historical `running` versus `queued` result.
    pub(crate) async fn first_receipt(
        &self,
        command_id: &str,
    ) -> Result<Option<OutboxCommand>, StoreError> {
        let deadline = tokio::time::Instant::now() + std::time::Duration::from_secs(5);
        loop {
            let command = self.command(command_id).await?;
            if command.as_ref().is_none_or(|command| {
                matches!(
                    command.state,
                    crate::store::OutboxState::Delivered | crate::store::OutboxState::Failed
                )
            }) {
                return Ok(command);
            }
            if tokio::time::Instant::now() >= deadline {
                return Ok(command);
            }
            tokio::time::sleep(std::time::Duration::from_millis(10)).await;
        }
    }

    /// Reads the newest durable turn command of one child.
    pub(crate) async fn latest_for_thread(
        &self,
        child_thread_id: &str,
    ) -> Result<Option<OutboxCommand>, StoreError> {
        let store = self.store.clone();
        let child_thread_id = child_thread_id.to_owned();
        tokio::task::spawn_blocking(move || {
            Ok(store
                .outbox_list(Some(&child_thread_id))?
                .into_iter()
                .max_by_key(|command| (command.order, command.created_at)))
        })
        .await
        .map_err(|error| StoreError::CorruptedIndex(error.to_string()))?
    }

    /// Enqueues a follow-up through the same durable outbox as user turns.
    /// `record` is the caller's prompt-free coordination writer; it runs in
    /// the transaction that inserts the command, so both commit or neither.
    /// Repeating `command_id` with the same payload is idempotent (and
    /// `record` must be idempotent too).
    pub(crate) async fn enqueue_followup(
        &self,
        command_id: &str,
        child_thread_id: &str,
        message: String,
        hold_until_idle: bool,
        record: impl FnOnce(&redb::WriteTransaction) -> Result<(), StoreError> + Send + 'static,
    ) -> Result<OutboxCommand, StoreError> {
        let store = self.store.clone();
        let command_id = command_id.to_owned();
        let child_thread_id = child_thread_id.to_owned();
        let params: Value = json!({
            "threadId": child_thread_id,
            "clientUserMessageId": command_id,
            "input": [{"type": "text", "text": message, "text_elements": []}],
        });
        let command = tokio::task::spawn_blocking(move || {
            let command = store.outbox_put_turn_start_recorded(
                &command_id,
                &child_thread_id,
                params,
                crate::store::OutboxPresentation::Delivery,
                record,
            )?;
            if hold_until_idle {
                let (command, _) = store.outbox_wait(
                    &command.command_id,
                    crate::store::OutboxState::Queued,
                    None,
                    u64::MAX,
                )?;
                return Ok::<OutboxCommand, StoreError>(command);
            }
            Ok::<OutboxCommand, StoreError>(command)
        })
        .await
        .map_err(|error| StoreError::CorruptedIndex(error.to_string()))??;
        self.emit_changed(&command.remote_thread_id).await;
        self.wakeup.notify_one();
        Ok(command)
    }

    /// Releases held follow-ups after the provider reports the current turn
    /// terminal. Delivered and failed receipts are left unchanged.
    pub(crate) async fn release_queued_for_thread(
        &self,
        child_thread_id: &str,
    ) -> Result<Option<OutboxCommand>, StoreError> {
        let store = self.store.clone();
        let child_thread_id = child_thread_id.to_owned();
        let notify_thread_id = child_thread_id.clone();
        let command_id = tokio::task::spawn_blocking(move || {
            let command = store
                .outbox_list(Some(&child_thread_id))?
                .into_iter()
                .filter(|command| command.state == crate::store::OutboxState::Queued)
                .min_by_key(|command| (command.order, command.created_at));
            let Some(command) = command else {
                return Ok::<Option<String>, StoreError>(None);
            };
            let (command, _) = store.outbox_wait(
                &command.command_id,
                crate::store::OutboxState::Queued,
                None,
                0,
            )?;
            Ok::<Option<String>, StoreError>(Some(command.command_id))
        })
        .await
        .map_err(|error| StoreError::CorruptedIndex(error.to_string()))??;
        let Some(command_id) = command_id else {
            return Ok(None);
        };
        self.emit_changed(&notify_thread_id).await;
        self.wakeup.notify_one();
        self.command(&command_id).await
    }

    /// Cancels work that has not reached the provider.
    ///
    /// # Errors
    /// Returns the durable-store failure.
    pub(crate) async fn cancel_before_start(&self, command_id: &str) -> Result<bool, StoreError> {
        let store = self.store.clone();
        let command_id = command_id.to_owned();
        let (cancelled, thread_id) = tokio::task::spawn_blocking(move || {
            let thread_id = store
                .outbox_get(&command_id)?
                .map(|command| command.remote_thread_id);
            Ok::<_, StoreError>((
                store.cancel_orchestration_turn_before_start(&command_id)?,
                thread_id,
            ))
        })
        .await
        .map_err(|error| StoreError::CorruptedIndex(error.to_string()))??;
        if cancelled && let Some(thread_id) = thread_id {
            self.emit_changed(&thread_id).await;
        }
        Ok(cancelled)
    }

    /// Cancels every not-yet-dispatched durable follow-up of a child thread
    /// and returns the removed command ids. Hidden notices addressed to the
    /// child (results of its own agents) are not follow-ups and stay.
    pub(crate) async fn cancel_queued_for_thread(
        &self,
        child_thread_id: &str,
    ) -> Result<Vec<String>, StoreError> {
        let store = self.store.clone();
        let child_thread_id = child_thread_id.to_owned();
        let notify_thread_id = child_thread_id.clone();
        let cancelled = tokio::task::spawn_blocking(move || {
            let commands = store.outbox_list(Some(&child_thread_id))?;
            let mut cancelled = Vec::new();
            for command in commands {
                if command.presentation != OutboxPresentation::Notice
                    && store.outbox_cancel(&command.command_id)?
                {
                    cancelled.push(command.command_id);
                }
            }
            Ok::<Vec<String>, StoreError>(cancelled)
        })
        .await
        .map_err(|error| StoreError::CorruptedIndex(error.to_string()))??;
        if !cancelled.is_empty() {
            self.emit_changed(&notify_thread_id).await;
        }
        Ok(cancelled)
    }
}

pub(crate) fn retry_delay_ms(attempts: u32) -> u64 {
    let exponent = attempts.min(6);
    let cap = OUTBOX_RETRY_BASE_MS
        .saturating_mul(1_u64 << exponent)
        .min(OUTBOX_RETRY_MAX_MS);
    let floor = (cap / 2).max(1);
    rand::rng().random_range(floor..=cap)
}

pub(crate) fn turn_with_client_message<'a>(
    turns: &'a [Value],
    client_id: &str,
) -> Option<&'a Value> {
    turns.iter().find(|turn| {
        turn.get("items")
            .and_then(Value::as_array)
            .is_some_and(|items| {
                items.iter().any(|item| {
                    item.get("type").and_then(Value::as_str) == Some("userMessage")
                        && item.get("clientId").and_then(Value::as_str) == Some(client_id)
                })
            })
    })
}

pub(crate) fn turn_id(turn: &Value) -> Option<&str> {
    turn.get("id")
        .or_else(|| turn.get("turnId"))
        .and_then(Value::as_str)
}

pub(crate) fn rpc_error_message(response: &Value) -> String {
    let error = response.get("error").unwrap_or(response);
    let message = error
        .get("message")
        .and_then(Value::as_str)
        .map_or_else(|| error.to_string(), str::to_owned);
    message.chars().take(500).collect()
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;
    use crate::store::{OutboxClaimOutcome, OutboxClaimResolution};

    fn reservation(command_id: &str) -> turn_delivery_tables::ReservedTurnCommand {
        turn_delivery_tables::ReservedTurnCommand {
            task_id: "task-1".into(),
            command_id: command_id.into(),
            params: json!({"input": [{"type": "text", "text": "inspect"}]}),
            created_at_ms: 1,
        }
    }

    #[test]
    fn cancellation_removes_only_work_that_cannot_have_reached_the_provider()
    -> Result<(), Box<dyn std::error::Error>> {
        let directory = tempfile::tempdir()?;
        let store = IndexStore::open(directory.path().join("state.redb"))?;

        let write = store.database().begin_write()?;
        let reserved = reservation("reserved");
        turn_delivery_tables::reserve(
            &write,
            &reserved.task_id,
            &reserved.command_id,
            &reserved.params,
            reserved.created_at_ms,
        )?;
        write.commit()?;
        assert!(store.cancel_orchestration_turn_before_start("reserved")?);
        assert!(
            store
                .promote_orchestration_turn("reserved", "child-1", None)
                .is_err()
        );

        let write = store.database().begin_write()?;
        let claimed = reservation("claimed");
        turn_delivery_tables::reserve(
            &write,
            &claimed.task_id,
            &claimed.command_id,
            &claimed.params,
            claimed.created_at_ms,
        )?;
        write.commit()?;
        store.promote_orchestration_turn("claimed", "child-1", None)?;
        let OutboxClaimOutcome::Acquired { token, .. } = store.outbox_claim_dispatch("claimed")?
        else {
            return Err("dispatch claim was not acquired".into());
        };
        assert!(!store.cancel_orchestration_turn_before_start("claimed")?);
        store.outbox_resolve_claim(
            "claimed",
            token,
            OutboxClaimResolution::Delivered {
                turn_id: Some("turn-1"),
            },
        )?;
        assert_eq!(
            store
                .outbox_get("claimed")?
                .and_then(|command| command.delivered_turn_id),
            Some("turn-1".into())
        );
        Ok(())
    }
}
