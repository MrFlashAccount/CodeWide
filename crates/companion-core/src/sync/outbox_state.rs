//! Durable outbox state transitions shared by the queue RPCs, the queued
//! steer and the delivery pump. Every transition that changes what the
//! client sees emits `companion/queue/changed` for the thread.

use std::sync::Arc;

use rand::Rng;
use serde_json::{Value, json};
use tracing::warn;

use crate::store::{
    IndexStore, OutboxClaimOutcome, OutboxClaimResolution, OutboxClaimResolutionOutcome,
    OutboxCommand, OutboxState,
};

const OUTBOX_RETRY_BASE_MS: u64 = 1_000;
const OUTBOX_RETRY_MAX_MS: u64 = 30_000;

pub(super) fn retry_delay_ms(attempts: u32) -> u64 {
    let exponent = attempts.min(6);
    let cap = OUTBOX_RETRY_BASE_MS
        .saturating_mul(1_u64 << exponent)
        .min(OUTBOX_RETRY_MAX_MS);
    let floor = (cap / 2).max(1);
    rand::rng().random_range(floor..=cap)
}

pub(super) enum OwnedClaimResolution {
    Delivered,
    NotSent(u64),
    /// The provider answered `busy`: keep the command queued until idle.
    Busy,
    Rejected(String),
    Indeterminate {
        error: String,
        retry_after_ms: u64,
    },
}

pub(super) async fn claim_outbox_dispatch(
    store: &Arc<IndexStore>,
    local_events: &tokio::sync::mpsc::Sender<Value>,
    command_id: &str,
) -> Option<(OutboxCommand, u64)> {
    let claim_store = Arc::clone(store);
    let command_id = command_id.to_owned();
    let result =
        tokio::task::spawn_blocking(move || claim_store.outbox_claim_dispatch(&command_id)).await;
    match result {
        Ok(Ok(OutboxClaimOutcome::Acquired { command, token })) => {
            emit_queue_changed(store, local_events, &command.remote_thread_id).await;
            Some((command, token))
        }
        Ok(Ok(OutboxClaimOutcome::Duplicate(_) | OutboxClaimOutcome::Unavailable(_))) => None,
        Ok(Err(error)) => {
            warn!(%error, "durable outbox dispatch claim failed");
            None
        }
        Err(error) => {
            warn!(%error, "durable outbox dispatch claim worker failed");
            None
        }
    }
}

pub(super) async fn resolve_outbox_claim(
    store: &Arc<IndexStore>,
    local_events: &tokio::sync::mpsc::Sender<Value>,
    thread_id: &str,
    command_id: &str,
    token: u64,
    resolution: OwnedClaimResolution,
) {
    let resolution_store = Arc::clone(store);
    let command_id = command_id.to_owned();
    let result = tokio::task::spawn_blocking(move || match resolution {
        OwnedClaimResolution::Delivered => resolution_store.outbox_resolve_claim(
            &command_id,
            token,
            OutboxClaimResolution::Delivered,
        ),
        OwnedClaimResolution::NotSent(retry_after_ms) => resolution_store.outbox_resolve_claim(
            &command_id,
            token,
            OutboxClaimResolution::NotSent { retry_after_ms },
        ),
        OwnedClaimResolution::Busy => {
            resolution_store.outbox_resolve_claim(&command_id, token, OutboxClaimResolution::Busy)
        }
        OwnedClaimResolution::Rejected(error) => resolution_store.outbox_resolve_claim(
            &command_id,
            token,
            OutboxClaimResolution::Rejected { error: &error },
        ),
        OwnedClaimResolution::Indeterminate {
            error,
            retry_after_ms,
        } => resolution_store.outbox_resolve_claim(
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
            emit_queue_changed(store, local_events, thread_id).await;
        }
        Ok(Ok(
            OutboxClaimResolutionOutcome::AlreadyResolved(_)
            | OutboxClaimResolutionOutcome::Stale(_),
        )) => {}
        Ok(Err(error)) => warn!(%error, "durable outbox claim resolution failed"),
        Err(error) => warn!(%error, "durable outbox claim resolution worker failed"),
    }
}

pub(super) async fn fail_queued_outbox(
    store: &Arc<IndexStore>,
    local_events: &tokio::sync::mpsc::Sender<Value>,
    thread_id: &str,
    command_id: &str,
    error: &str,
) {
    let fail_store = Arc::clone(store);
    let command_id = command_id.to_owned();
    let error = error.to_owned();
    let result =
        tokio::task::spawn_blocking(move || fail_store.outbox_fail_queued(&command_id, &error))
            .await;
    match result {
        Ok(Ok(Some(_))) => emit_queue_changed(store, local_events, thread_id).await,
        Ok(Ok(None)) => {}
        Ok(Err(error)) => warn!(%error, "durable queued outbox failure update failed"),
        Err(error) => warn!(%error, "durable queued outbox failure worker failed"),
    }
}

pub(super) async fn set_outbox_state(
    store: &Arc<IndexStore>,
    local_events: &tokio::sync::mpsc::Sender<Value>,
    thread_id: &str,
    command_id: &str,
    state: OutboxState,
    error: Option<&str>,
) {
    let store = store.clone();
    let command_id = command_id.to_owned();
    let error = error.map(str::to_owned);
    let update_store = store.clone();
    let result = tokio::task::spawn_blocking(move || {
        update_store.outbox_set_state(&command_id, state, error.as_deref())
    })
    .await;
    match result {
        Ok(Ok(_)) => emit_queue_changed(&store, local_events, thread_id).await,
        Ok(Err(error)) => warn!(%error, "durable outbox update failed"),
        Err(error) => warn!(%error, "durable outbox update worker failed"),
    }
}

pub(super) async fn defer_outbox(
    store: &Arc<IndexStore>,
    local_events: &tokio::sync::mpsc::Sender<Value>,
    thread_id: &str,
    command_id: &str,
    state: OutboxState,
    error: &str,
    delay_ms: u64,
) {
    let store = store.clone();
    let command_id = command_id.to_owned();
    let error = error.to_owned();
    let update_store = store.clone();
    let result = tokio::task::spawn_blocking(move || {
        update_store.outbox_defer(&command_id, state, &error, delay_ms)
    })
    .await;
    match result {
        Ok(Ok(_)) => emit_queue_changed(&store, local_events, thread_id).await,
        Ok(Err(error)) => warn!(%error, "durable outbox retry scheduling failed"),
        Err(error) => warn!(%error, "durable outbox retry worker failed"),
    }
}

pub(super) async fn wait_outbox(
    store: &Arc<IndexStore>,
    local_events: &tokio::sync::mpsc::Sender<Value>,
    thread_id: &str,
    command_id: &str,
    state: OutboxState,
    error: Option<&str>,
    delay_ms: u64,
) {
    let store = store.clone();
    let command_id = command_id.to_owned();
    let error = error.map(str::to_owned);
    let update_store = store.clone();
    let result = tokio::task::spawn_blocking(move || {
        update_store.outbox_wait(&command_id, state, error.as_deref(), delay_ms)
    })
    .await;
    match result {
        Ok(Ok((_, true))) => emit_queue_changed(&store, local_events, thread_id).await,
        Ok(Ok((_, false))) => {}
        Ok(Err(error)) => warn!(%error, "durable outbox wait scheduling failed"),
        Err(error) => warn!(%error, "durable outbox wait worker failed"),
    }
}

pub(super) async fn emit_queue_changed(
    store: &Arc<IndexStore>,
    local_events: &tokio::sync::mpsc::Sender<Value>,
    thread_id: &str,
) {
    let store = store.clone();
    let thread_id = thread_id.to_owned();
    let listed = tokio::task::spawn_blocking({
        let thread_id = thread_id.clone();
        move || store.outbox_list(Some(&thread_id))
    })
    .await;
    let Ok(Ok(data)) = listed else {
        warn!(thread_id, "durable outbox notification read failed");
        return;
    };
    let _ = local_events
        .send(json!({
            "method": "companion/queue/changed",
            "params": {"threadId": thread_id, "data": data}
        }))
        .await;
}

pub(super) fn turns_contain_client_message(turns: &[Value], client_id: &str) -> bool {
    turn_with_client_message(turns, client_id).is_some()
}

pub(super) fn turn_with_client_message<'a>(
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

pub(super) fn rpc_error_message(response: &Value) -> String {
    let error = response.get("error").unwrap_or(response);
    let message = error
        .get("message")
        .and_then(Value::as_str)
        .map_or_else(|| error.to_string(), str::to_owned);
    message.chars().take(500).collect()
}
