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
            // Hidden notices (model-only child-agent results) are never
            // listed to a client, so no client can show them as pending.
            Ok(unchanged(
                json!({"data": delivery.client_list(thread_id).await? }),
            ))
        }
        "companion/queue/edit" => {
            let command_id = client_command_id(delivery, object).await?;
            let input = object.get("input").cloned().ok_or_else(|| {
                crate::store::StoreError::CorruptedIndex("queue input is required".into())
            })?;
            let command = delivery.edit_prompt(command_id, input).await?;
            Ok(changed(serde_json::to_value(&command)?, &command))
        }
        "companion/queue/cancel" => {
            let command_id = client_command_id(delivery, object).await?;
            let thread_id = delivery
                .client_command(command_id)
                .await?
                .map(|command| command.remote_thread_id);
            let cancelled = delivery.cancel(command_id).await?;
            Ok(QueueRpcResult {
                value: json!({"cancelled": cancelled}),
                changed_thread_id: cancelled.then_some(thread_id).flatten(),
            })
        }
        "companion/queue/retry" => {
            let command_id = client_command_id(delivery, object).await?;
            let command = delivery.retry(command_id).await?;
            Ok(changed(serde_json::to_value(&command)?, &command))
        }
        "companion/queue/move" => {
            let command_id = client_command_id(delivery, object).await?;
            let thread_id = delivery
                .client_command(command_id)
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
    let commands = delivery.client_list(None).await?;
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

/// The `commandId` of a client queue mutation. A hidden notice is not a
/// client command: addressing one fails as if it did not exist.
async fn client_command_id<'a>(
    delivery: &TurnDelivery,
    object: &'a Map<String, Value>,
) -> Result<&'a str, crate::store::StoreError> {
    let command_id = required_string(object.get("commandId"), "commandId")?;
    if delivery
        .command(command_id)
        .await?
        .is_some_and(|command| command.presentation == OutboxPresentation::Notice)
    {
        return Err(crate::store::StoreError::CorruptedIndex(
            "outbox command not found".into(),
        ));
    }
    Ok(command_id)
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

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use serde_json::json;

    use super::queue_rpc;
    use crate::{
        store::{IndexStore, OutboxClaimOutcome, OutboxClaimResolution, OutboxPresentation},
        turn_delivery::{TurnDelivery, enqueue_completion_in_write},
    };

    type TestResult = Result<(), Box<dyn std::error::Error>>;

    fn turn(thread: &str, command: &str) -> serde_json::Value {
        json!({"threadId": thread, "clientUserMessageId": command,
            "input": [{"type": "text", "text": "visible", "text_elements": []}]})
    }

    // Child-result notices are model-only: no client list, change event or
    // queue mutation may expose them as a pending user message.
    #[tokio::test]
    async fn notice_commands_never_reach_client_queue_lists_or_events() -> TestResult {
        let directory = tempfile::tempdir()?;
        let store = Arc::new(IndexStore::open(directory.path().join("state.redb"))?);
        let (events, mut changed) = tokio::sync::mpsc::channel(8);
        let delivery =
            TurnDelivery::new(store.clone(), Arc::new(tokio::sync::Notify::new()), events);
        store.outbox_put_turn_start("visible", "parent", turn("parent", "visible"), None)?;
        let write = store.database().begin_write()?;
        enqueue_completion_in_write(&write, "request-notice:1", "parent", "hidden result")?;
        write.commit()?;

        // The internal owner (pump, batching) still sees the notice.
        assert_eq!(delivery.list(Some("parent")).await?.len(), 2);
        let listed = queue_rpc(
            &delivery,
            "companion/queue/list",
            &json!({"threadId": "parent"}),
        )
        .await?;
        let rows = listed.value["data"].as_array().cloned().unwrap_or_default();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0]["commandId"], "visible");
        assert!(!listed.value.to_string().contains("hidden result"));

        delivery.emit_changed("parent").await;
        let event = changed.recv().await.ok_or("no change event")?;
        assert_eq!(event["params"]["data"].as_array().map(Vec::len), Some(1));
        assert!(!event.to_string().contains("hidden result"));

        for method in [
            "companion/queue/cancel",
            "companion/queue/retry",
            "companion/queue/edit",
        ] {
            assert!(
                queue_rpc(
                    &delivery,
                    method,
                    &json!({"commandId": "request-notice:1", "input": []}),
                )
                .await
                .is_err(),
                "{method} addressed a hidden notice"
            );
        }
        assert!(
            queue_rpc(
                &delivery,
                "companion/queue/put",
                &json!({"command": {"commandId": "client-notice", "remoteThreadId": "parent",
                    "method": "turn/start", "presentation": "notice",
                    "params": turn("parent", "client-notice")}}),
            )
            .await
            .is_err()
        );

        // A busy provider keeps a notice hidden instead of turning it into a
        // visible queue entry.
        let OutboxClaimOutcome::Acquired { token, .. } =
            store.outbox_claim_dispatch("request-notice:1")?
        else {
            return Err("notice claim was not acquired".into());
        };
        store.outbox_resolve_claim("request-notice:1", token, OutboxClaimResolution::Busy)?;
        assert_eq!(
            store
                .outbox_get("request-notice:1")?
                .map(|command| command.presentation),
            Some(OutboxPresentation::Notice)
        );
        assert_eq!(delivery.client_list(Some("parent")).await?.len(), 1);
        Ok(())
    }
}
