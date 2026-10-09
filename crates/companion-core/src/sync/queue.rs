//! Durable queue RPCs (`companion/queue/*`) over the outbox store.

use serde_json::{Map, Value, json};

use crate::store::{IndexStore, OutboxPresentation, OutboxState};

pub(super) fn queue_rpc(
    store: &IndexStore,
    method: &str,
    params: &Value,
) -> Result<Value, crate::store::StoreError> {
    let object = params.as_object().ok_or_else(|| {
        crate::store::StoreError::CorruptedIndex("queue params must be an object".into())
    })?;
    match method {
        "companion/queue/put" => queue_put(store, object),
        "companion/queue/list" => {
            let thread_id = object.get("threadId").and_then(Value::as_str);
            // Delivered queue rows are durable handoff receipts. The client
            // projects them as accepted chat deliveries (not queued prompts)
            // until the canonical user item with the same command id arrives.
            Ok(json!({"data": store.outbox_list(thread_id)? }))
        }
        "companion/queue/edit" => {
            let command_id = required_string(object.get("commandId"), "commandId")?;
            let input = object.get("input").cloned().ok_or_else(|| {
                crate::store::StoreError::CorruptedIndex("queue input is required".into())
            })?;
            serde_json::to_value(store.outbox_edit_prompt(command_id, &input)?).map_err(Into::into)
        }
        "companion/queue/cancel" => {
            let command_id = required_string(object.get("commandId"), "commandId")?;
            Ok(json!({"cancelled": store.outbox_cancel(command_id)?}))
        }
        "companion/queue/retry" => {
            let command_id = required_string(object.get("commandId"), "commandId")?;
            serde_json::to_value(store.outbox_retry_failed(command_id)?).map_err(Into::into)
        }
        "companion/queue/move" => queue_move(store, object),
        _ => Err(crate::store::StoreError::CorruptedIndex(
            "unknown companion queue method".into(),
        )),
    }
}

pub(super) fn queue_command(params: &Value) -> Option<&Map<String, Value>> {
    let object = params.as_object()?;
    object
        .get("command")
        .and_then(Value::as_object)
        .or(Some(object))
}

pub(super) fn queue_changed_thread_id(
    store: &IndexStore,
    method: &str,
    params: &Value,
) -> Option<String> {
    if method == "companion/queue/list" {
        return None;
    }
    if method == "companion/queue/put" {
        return queue_command(params)?
            .get("remoteThreadId")
            .and_then(Value::as_str)
            .map(str::to_owned);
    }
    let command_id = params.get("commandId").and_then(Value::as_str)?;
    store
        .outbox_list(None)
        .ok()?
        .into_iter()
        .find(|command| command.command_id == command_id)
        .map(|command| command.remote_thread_id)
}

fn queue_put(
    store: &IndexStore,
    object: &Map<String, Value>,
) -> Result<Value, crate::store::StoreError> {
    let command = object
        .get("command")
        .and_then(Value::as_object)
        .unwrap_or(object);
    let command_id = required_string(command.get("commandId"), "commandId")?;
    let thread_id = required_string(command.get("remoteThreadId"), "remoteThreadId")?;
    if required_string(command.get("method"), "method")? != "turn/start" {
        return Err(crate::store::StoreError::CorruptedIndex(
            "only turn/start can be queued".into(),
        ));
    }
    let rpc_params = command.get("params").cloned().unwrap_or_else(|| json!({}));
    let created_at = command.get("createdAt").and_then(Value::as_u64);
    let workspace_request_id = command.get("workspaceRequestId").and_then(Value::as_str);
    let presentation = match command.get("presentation").and_then(Value::as_str) {
        None | Some("queue") => OutboxPresentation::Queue,
        Some("delivery") => OutboxPresentation::Delivery,
        Some(_) => {
            return Err(crate::store::StoreError::CorruptedIndex(
                "queue presentation must be queue or delivery".into(),
            ));
        }
    };
    serde_json::to_value(store.outbox_put_turn_start_with_workspace(
        command_id,
        thread_id,
        rpc_params,
        created_at,
        presentation,
        workspace_request_id,
    )?)
    .map_err(Into::into)
}

fn queue_move(
    store: &IndexStore,
    object: &Map<String, Value>,
) -> Result<Value, crate::store::StoreError> {
    let command_id = required_string(object.get("commandId"), "commandId")?;
    let moved = if let Some(before) = object.get("beforeCommandId") {
        let before = match before {
            Value::Null => None,
            value => Some(required_string(Some(value), "beforeCommandId")?),
        };
        store.outbox_place(command_id, before)?
    } else {
        queue_move_relative(store, command_id, object)?
    };
    Ok(json!({"moved": moved}))
}

fn queue_move_relative(
    store: &IndexStore,
    command_id: &str,
    object: &Map<String, Value>,
) -> Result<bool, crate::store::StoreError> {
    let commands = store.outbox_list(None)?;
    let selected = commands
        .iter()
        .find(|command| command.command_id == command_id)
        .ok_or_else(|| {
            crate::store::StoreError::CorruptedIndex("outbox command not found".into())
        })?;
    let same_thread = commands
        .iter()
        .filter(|command| {
            command.remote_thread_id == selected.remote_thread_id
                && command.state == OutboxState::Queued
        })
        .collect::<Vec<_>>();
    let index = same_thread
        .iter()
        .position(|command| command.command_id == command_id)
        .ok_or_else(|| {
            crate::store::StoreError::CorruptedIndex("outbox command is not queued".into())
        })?;
    let direction = object
        .get("direction")
        .and_then(Value::as_i64)
        .filter(|direction| matches!(direction, -1 | 1))
        .ok_or_else(|| {
            crate::store::StoreError::CorruptedIndex("queue direction must be -1 or 1".into())
        })?;
    let target = i64::try_from(index)
        .unwrap_or(i64::MAX)
        .saturating_add(direction);
    let Ok(target) = usize::try_from(target) else {
        return Ok(false);
    };
    if target >= same_thread.len() {
        return Ok(false);
    }
    let before = if direction < 0 {
        Some(same_thread[target].command_id.as_str())
    } else {
        same_thread
            .get(target.saturating_add(1))
            .map(|command| command.command_id.as_str())
    };
    store.outbox_place(command_id, before)
}

fn required_string<'a>(
    value: Option<&'a Value>,
    label: &str,
) -> Result<&'a str, crate::store::StoreError> {
    value.and_then(Value::as_str).ok_or_else(|| {
        crate::store::StoreError::CorruptedIndex(format!("{label} must be a string"))
    })
}
