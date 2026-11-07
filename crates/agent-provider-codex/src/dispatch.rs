//! Codex thread-mutation dispatch with account admission and one safe
//! resume-retry (moved unchanged from `sync.rs`).
//!
//! `thread not found: <id>` is a conclusive pre-acceptance rejection: a
//! companion reconnect can replace the App Server runtime while indexed
//! history keeps the chat readable, so the mutation rehydrates that runtime
//! (without returning history) before the one retry.
//!
//! A turn started on a thread this connection is not subscribed to (a thread
//! the shared App Server still holds loaded after a companion restart) is
//! accepted without that rejection, but its events go only to subscribed
//! connections. `turn/start` therefore subscribes first, through the same
//! history-free resume, unless the current connection generation already
//! subscribed to the thread (`subscriptions`).

use std::sync::Arc;

use serde_json::{Value, json};

use agent_core::provider::{AdmissionError, DispatchError};
use agent_transport::UpstreamHandle;

use crate::{
    account_pool::{AccountPoolError, AccountPoolService},
    subscriptions::ThreadSubscriptions,
    transport_error,
};

const GLOBAL_SUPERVISOR_THREAD_UNAVAILABLE_RPC_CODE: i64 = -32_061;
const GLOBAL_SUPERVISOR_THREAD_UNAVAILABLE_MESSAGE: &str =
    "Global supervisor thread is unavailable";

fn pool_error(error: AccountPoolError) -> DispatchError {
    DispatchError::Admission(match error {
        AccountPoolError::Deferred(_) => AdmissionError::Deferred(error.to_string()),
        error => AdmissionError::Fatal(error.to_string()),
    })
}

pub(super) async fn turn_start_with_resume(
    upstream: &UpstreamHandle,
    account_pool: Option<&Arc<AccountPoolService>>,
    subscriptions: &ThreadSubscriptions,
    request: Value,
) -> Result<Value, DispatchError> {
    let thread_id = request
        .pointer("/params/threadId")
        .and_then(Value::as_str)
        .map(ToOwned::to_owned);
    if let Some(thread_id) = &thread_id {
        // A rejected subscription is not fatal: the turn start below reports
        // the thread's real state (and resumes an unloaded thread itself).
        ensure_subscribed(upstream, account_pool, subscriptions, thread_id).await?;
    }
    let response = turn_start_once(upstream, account_pool, request.clone()).await?;
    let Some(thread_id) = thread_id else {
        return Ok(response);
    };
    if !is_thread_not_found_response(&response, &thread_id) {
        return Ok(response);
    }
    let generation = upstream.generation();
    let resumed = resume_thread_runtime(upstream, account_pool, &thread_id).await?;
    if resumed.get("error").is_some() {
        return Ok(resumed);
    }
    subscriptions.record(generation, &thread_id);
    turn_start_once(upstream, account_pool, request).await
}

/// Subscribes this connection to the thread's events with a history-free
/// `thread/resume`, unless the current connection generation already did.
/// Returns the App Server's answer to that resume, `None` when none was
/// needed.
///
/// # Errors
///
/// Returns the transport or admission failure of the resume request.
pub(super) async fn ensure_subscribed(
    upstream: &UpstreamHandle,
    account_pool: Option<&Arc<AccountPoolService>>,
    subscriptions: &ThreadSubscriptions,
    thread_id: &str,
) -> Result<Option<Value>, DispatchError> {
    let generation = upstream.generation();
    if subscriptions.contains(generation, thread_id) {
        return Ok(None);
    }
    let resumed = resume_thread_runtime(upstream, account_pool, thread_id).await?;
    if resumed.get("error").is_none() {
        subscriptions.record(generation, thread_id);
    }
    Ok(Some(resumed))
}

pub(super) async fn settings_update_with_resume(
    upstream: &UpstreamHandle,
    account_pool: Option<&Arc<AccountPoolService>>,
    subscriptions: &ThreadSubscriptions,
    request: Value,
) -> Result<Value, DispatchError> {
    let response = upstream
        .request(request.clone())
        .await
        .map_err(|error| DispatchError::Transport(transport_error(error)))?;
    let Some(thread_id) = request.pointer("/params/threadId").and_then(Value::as_str) else {
        return Ok(response);
    };
    if !is_thread_not_found_response(&response, thread_id) {
        return Ok(response);
    }
    // Settings require a loaded runtime even when indexed history is readable.
    // The exact thread-not-found rejection proves no settings were applied, so
    // resume without history and retry once, before Global Voice starts audio.
    let generation = upstream.generation();
    let resumed = resume_thread_runtime(upstream, account_pool, thread_id).await?;
    if resumed.get("error").is_some() {
        return Ok(resumed);
    }
    subscriptions.record(generation, thread_id);
    upstream
        .request(request)
        .await
        .map_err(|error| DispatchError::Transport(transport_error(error)))
}

pub(super) async fn realtime_start_with_resume(
    upstream: &UpstreamHandle,
    account_pool: Option<&Arc<AccountPoolService>>,
    subscriptions: &ThreadSubscriptions,
    request: Value,
) -> Result<Value, DispatchError> {
    let response = upstream
        .request(request.clone())
        .await
        .map_err(|error| DispatchError::Transport(transport_error(error)))?;
    let Some(thread_id) = request
        .pointer("/params/threadId")
        .and_then(Value::as_str)
        .map(ToOwned::to_owned)
    else {
        return Ok(response);
    };
    if !is_thread_not_found_response(&response, &thread_id) {
        return Ok(response);
    }
    // `thread/realtime/start` is rejected before a live session exists, so
    // rehydrating the indexed thread and retrying once cannot duplicate audio.
    let generation = upstream.generation();
    let resumed = resume_thread_runtime(upstream, account_pool, &thread_id).await?;
    if resumed.get("error").is_some() {
        return Ok(if is_rollout_not_found_response(&resumed, &thread_id) {
            global_supervisor_thread_unavailable_response(&request)
        } else {
            resumed
        });
    }
    subscriptions.record(generation, &thread_id);
    let retried = upstream
        .request(request)
        .await
        .map_err(|error| DispatchError::Transport(transport_error(error)))?;
    Ok(if is_thread_not_found_response(&retried, &thread_id) {
        global_supervisor_thread_unavailable_response(&retried)
    } else {
        retried
    })
}

async fn resume_thread_runtime(
    upstream: &UpstreamHandle,
    account_pool: Option<&Arc<AccountPoolService>>,
    thread_id: &str,
) -> Result<Value, DispatchError> {
    match account_pool {
        Some(account_pool) => account_pool
            .resume_thread_runtime(thread_id)
            .await
            .map_err(pool_error),
        None => upstream
            .request(json!({
                "id": "thread-mutation-resume",
                "method": "thread/resume",
                "params": {
                    "threadId": thread_id,
                    "excludeTurns": true
                }
            }))
            .await
            .map_err(|error| DispatchError::Transport(transport_error(error))),
    }
}

async fn turn_start_once(
    upstream: &UpstreamHandle,
    account_pool: Option<&Arc<AccountPoolService>>,
    request: Value,
) -> Result<Value, DispatchError> {
    match account_pool {
        Some(account_pool) => account_pool
            .send_turn_start(request)
            .await
            .map_err(pool_error),
        None => upstream
            .request(request)
            .await
            .map_err(|error| DispatchError::Transport(transport_error(error))),
    }
}

fn is_thread_not_found_response(response: &Value, thread_id: &str) -> bool {
    response
        .pointer("/error/message")
        .and_then(Value::as_str)
        .and_then(|message| message.strip_prefix("thread not found: "))
        == Some(thread_id)
}

fn is_rollout_not_found_response(response: &Value, thread_id: &str) -> bool {
    response
        .pointer("/error/message")
        .and_then(Value::as_str)
        .and_then(|message| message.strip_prefix("no rollout found for thread id "))
        == Some(thread_id)
}

fn global_supervisor_thread_unavailable_response(request: &Value) -> Value {
    json!({
        "id": request.get("id").cloned().unwrap_or(Value::Null),
        "error": {
            "code": GLOBAL_SUPERVISOR_THREAD_UNAVAILABLE_RPC_CODE,
            "message": GLOBAL_SUPERVISOR_THREAD_UNAVAILABLE_MESSAGE
        }
    })
}
