//! Durable queue RPCs (`companion/queue/*`) over the outbox store.

use serde_json::{Map, Value, json};

use crate::{
    store::{OutboxCommand, OutboxPresentation, OutboxState},
    turn_delivery::TurnDelivery,
};

pub(super) struct QueueRpcResult {
    pub value: Value,
    pub changed_thread_id: Option<String>,
}

pub(super) async fn queue_rpc(
    delivery: &TurnDelivery,
    method: &str,
    params: &Value,
) -> Result<QueueRpcResult, crate::store::StoreError> {
    let object = params.as_object().ok_or_else(|| {
        crate::store::StoreError::CorruptedIndex("queue params must be an object".into())
    })?;
    match method {
        "companion/queue/put" => {
            let command = queue_put(delivery, object).await?;
            Ok(changed(serde_json::to_value(&command)?, &command))
        }
        "companion/queue/list" => {
            let thread_id = object.get("threadId").and_then(Value::as_str);
            // Delivered queue rows are durable handoff receipts. The client
            // projects them as accepted chat deliveries (not queued prompts)
            // until the canonical user item with the same command id arrives.
            Ok(unchanged(json!({"data": delivery.list(thread_id).await? })))
        }
        "companion/queue/edit" => {
            let command_id = required_string(object.get("commandId"), "commandId")?;
            let input = object.get("input").cloned().ok_or_else(|| {
                crate::store::StoreError::CorruptedIndex("queue input is required".into())
            })?;
            let command = delivery.edit_prompt(command_id, input).await?;
            Ok(changed(serde_json::to_value(&command)?, &command))
        }
        "companion/queue/cancel" => {
            let command_id = required_string(object.get("commandId"), "commandId")?;
            let thread_id = delivery
                .command(command_id)
                .await?
                .map(|command| command.remote_thread_id);
            let cancelled = delivery.cancel(command_id).await?;
            Ok(QueueRpcResult {
                value: json!({"cancelled": cancelled}),
                changed_thread_id: cancelled.then_some(thread_id).flatten(),
            })
        }
        "companion/queue/retry" => {
            let command_id = required_string(object.get("commandId"), "commandId")?;
            let command = delivery.retry(command_id).await?;
            Ok(changed(serde_json::to_value(&command)?, &command))
        }
        "companion/queue/move" => {
            let command_id = required_string(object.get("commandId"), "commandId")?;
            let thread_id = delivery
                .command(command_id)
                .await?
                .map(|command| command.remote_thread_id);
            let value = queue_move(delivery, object).await?;
            let moved = value.get("moved").and_then(Value::as_bool) == Some(true);
            Ok(QueueRpcResult {
                value,
                changed_thread_id: moved.then_some(thread_id).flatten(),
            })
        }
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

async fn queue_put(
    delivery: &TurnDelivery,
    object: &Map<String, Value>,
) -> Result<OutboxCommand, crate::store::StoreError> {
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
    delivery
        .put(
            command_id,
            thread_id,
            rpc_params,
            created_at,
            presentation,
            workspace_request_id,
        )
        .await
}

async fn queue_move(
    delivery: &TurnDelivery,
    object: &Map<String, Value>,
) -> Result<Value, crate::store::StoreError> {
    let command_id = required_string(object.get("commandId"), "commandId")?;
    let moved = if let Some(before) = object.get("beforeCommandId") {
        let before = match before {
            Value::Null => None,
            value => Some(required_string(Some(value), "beforeCommandId")?),
        };
        delivery.place(command_id, before).await?
    } else {
        queue_move_relative(delivery, command_id, object).await?
    };
    Ok(json!({"moved": moved}))
}

async fn queue_move_relative(
    delivery: &TurnDelivery,
    command_id: &str,
    object: &Map<String, Value>,
) -> Result<bool, crate::store::StoreError> {
    let commands = delivery.list(None).await?;
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
    delivery.place(command_id, before).await
}

fn required_string<'a>(
    value: Option<&'a Value>,
    label: &str,
) -> Result<&'a str, crate::store::StoreError> {
    value.and_then(Value::as_str).ok_or_else(|| {
        crate::store::StoreError::CorruptedIndex(format!("{label} must be a string"))
    })
}

fn changed(value: Value, command: &OutboxCommand) -> QueueRpcResult {
    QueueRpcResult {
        value,
        changed_thread_id: Some(command.remote_thread_id.clone()),
    }
}

const fn unchanged(value: Value) -> QueueRpcResult {
    QueueRpcResult {
        value,
        changed_thread_id: None,
    }
}
