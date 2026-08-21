use serde_json::{Value, json};
use sha2::{Digest, Sha256};

pub const THREAD_PATCH_FIELD: &str = "codewideThreadPatch";

/// Adds a stable, companion-owned projection patch while preserving the raw
/// App Server notification for older clients and protocol diagnostics.
#[must_use]
pub fn attach_thread_patch(payload: Value) -> Value {
    attach_thread_patch_with_usage(payload, None)
}

/// Adds the semantic patch plus an optional companion-owned usage projection.
#[must_use]
pub fn attach_thread_patch_with_usage(mut payload: Value, usage: Option<Value>) -> Value {
    let Some(mut patch) = compile_thread_patch(&payload) else {
        return payload;
    };
    if let Some(usage) = usage
        && let Some(operation) = patch.get_mut("operation").and_then(Value::as_object_mut)
    {
        operation.insert("usage".into(), usage);
    }
    if let Some(object) = payload.as_object_mut() {
        object.insert(THREAD_PATCH_FIELD.into(), patch);
    }
    payload
}

#[must_use]
pub fn compile_thread_patch(payload: &Value) -> Option<Value> {
    let method = payload.get("method")?.as_str()?;
    let params = payload.get("params")?.as_object()?;
    let thread_id = params.get("threadId").and_then(Value::as_str).or_else(|| {
        params
            .get("thread")
            .and_then(Value::as_object)
            .and_then(|thread| thread.get("id"))
            .and_then(Value::as_str)
    })?;
    let mut operation = match method {
        "thread/status/changed" => operation("threadStatus"),
        "thread/name/updated" => operation("threadName"),
        "thread/deleted" => operation("threadDeleted"),
        "thread/settings/updated" => operation("threadSettings"),
        "thread/started" => operation("threadStarted"),
        "thread/archived" => with_bool(operation("threadArchived"), "archived", true),
        "thread/unarchived" => with_bool(operation("threadArchived"), "archived", false),
        "turn/started" => operation("turnStarted"),
        "turn/completed" => operation("turnCompleted"),
        "model/rerouted" => operation("modelRerouted"),
        "item/started" | "item/completed" => operation("itemUpsert"),
        "item/agentMessage/delta" => {
            with_string(operation("itemTextDelta"), "itemType", "agentMessage")
        }
        "item/plan/delta" => with_string(operation("itemTextDelta"), "itemType", "plan"),
        "item/commandExecution/outputDelta" => {
            with_string(operation("itemTextDelta"), "itemType", "commandExecution")
        }
        "item/fileChange/patchUpdated" => operation("fileChanges"),
        "item/mcpToolCall/progress" => operation("mcpProgress"),
        "thread/tokenUsage/updated" => operation("tokenUsage"),
        "turn/diff/updated" => operation("turnDiff"),
        "turn/plan/updated" => operation("turnPlan"),
        "item/reasoning/summaryPartAdded" => {
            with_string(operation("reasoningPart"), "field", "summary")
        }
        "item/reasoning/summaryTextDelta" => {
            with_string(operation("reasoningDelta"), "field", "summary")
        }
        "item/reasoning/textDelta" => with_string(operation("reasoningDelta"), "field", "content"),
        _ => return None,
    };
    if let Some(summary) = summary_projection(method, params)
        && let Some(object) = operation.as_object_mut()
    {
        object.insert("summary".into(), summary);
    }
    if let Some(terminal_projection) = terminal_projection(method, params)
        && let Some(object) = operation.as_object_mut()
    {
        object.insert("terminalProjection".into(), terminal_projection);
    }
    Some(json!({
        "version": 1,
        "threadId": thread_id,
        "operation": operation,
    }))
}

fn terminal_projection(method: &str, params: &serde_json::Map<String, Value>) -> Option<Value> {
    if method != "turn/completed" {
        return None;
    }
    let turn = params.get("turn")?.as_object()?;
    let turn_id = turn.get("id")?.as_str()?;
    let items = turn.get("items")?.as_array()?;
    let message = items
        .iter()
        .rev()
        .filter_map(Value::as_object)
        .find(|item| {
            item.get("type").and_then(Value::as_str) == Some("agentMessage")
                && item.get("phase").and_then(Value::as_str) == Some("final_answer")
        })
        .or_else(|| {
            items
                .iter()
                .rev()
                .filter_map(Value::as_object)
                .find(|item| item.get("type").and_then(Value::as_str) == Some("agentMessage"))
        });
    // A turn/completed notification is allowed to carry a sparse item list.
    // Its absence cannot prove that the authoritative turn has no agent
    // response, so emit only a positive content witness.
    let text = message?.get("text")?.as_str()?;
    Some(json!({
        "version": 1,
        "turnId": turn_id,
        "agentMessage": {
            "utf8Bytes": text.len(),
            "sha256": format!("{:x}", Sha256::digest(text.as_bytes())),
        },
    }))
}

fn operation(kind: &str) -> Value {
    json!({"kind": kind})
}

fn with_string(mut value: Value, key: &str, field: &str) -> Value {
    if let Some(object) = value.as_object_mut() {
        object.insert(key.into(), Value::String(field.into()));
    }
    value
}

fn with_bool(mut value: Value, key: &str, field: bool) -> Value {
    if let Some(object) = value.as_object_mut() {
        object.insert(key.into(), Value::Bool(field));
    }
    value
}

fn summary_projection(method: &str, params: &serde_json::Map<String, Value>) -> Option<Value> {
    if !is_thread_activity(method) {
        return None;
    }
    let turn = params.get("turn").and_then(Value::as_object);
    let item = params.get("item").and_then(Value::as_object);
    let final_agent_response = method == "turn/completed" && turn_has_agent_response(turn);
    Some(json!({
        "activity": true,
        "conversationMessage": final_agent_response || turn_has_user_message(turn) || item.and_then(|item| item.get("type")).and_then(Value::as_str) == Some("userMessage"),
        "finalAgentResponse": final_agent_response,
        "previewText": preview_from_event(method, turn, item),
    }))
}

fn preview_from_event(
    method: &str,
    turn: Option<&serde_json::Map<String, Value>>,
    item: Option<&serde_json::Map<String, Value>>,
) -> Option<String> {
    if matches!(method, "turn/started" | "turn/completed") {
        let items = turn
            .and_then(|turn| turn.get("items"))
            .and_then(Value::as_array)
            .map(Vec::as_slice)
            .unwrap_or_default();
        if method == "turn/completed"
            && let Some(text) = latest_item_text(items, |candidate| {
                candidate.get("type").and_then(Value::as_str) == Some("agentMessage")
                    && candidate.get("phase").and_then(Value::as_str) == Some("final_answer")
            })
        {
            return Some(text);
        }
        return latest_item_text(items, |candidate| {
            matches!(
                candidate.get("type").and_then(Value::as_str),
                Some("agentMessage" | "userMessage")
            )
        });
    }
    if matches!(method, "item/started" | "item/completed") {
        if item
            .and_then(|item| item.get("type"))
            .and_then(Value::as_str)
            == Some("agentMessage")
            && item
                .and_then(|item| item.get("phase"))
                .and_then(Value::as_str)
                == Some("final_answer")
        {
            return None;
        }
        return item.and_then(item_text);
    }
    None
}

fn latest_item_text(
    items: &[Value],
    accepts: impl Fn(&serde_json::Map<String, Value>) -> bool,
) -> Option<String> {
    items.iter().rev().find_map(|raw| {
        let item = raw.as_object()?;
        accepts(item).then(|| item_text(item)).flatten()
    })
}

fn item_text(item: &serde_json::Map<String, Value>) -> Option<String> {
    match item.get("type").and_then(Value::as_str) {
        Some("agentMessage") => bounded_non_empty(item.get("text").and_then(Value::as_str)),
        Some("userMessage") => {
            let text = item
                .get("content")
                .and_then(Value::as_array)?
                .iter()
                .filter_map(Value::as_object)
                .filter(|part| part.get("type").and_then(Value::as_str) == Some("text"))
                .filter_map(|part| part.get("text").and_then(Value::as_str))
                .collect::<Vec<_>>()
                .join(" ");
            bounded_non_empty(Some(&text))
        }
        _ => None,
    }
}

fn bounded_non_empty(value: Option<&str>) -> Option<String> {
    let value = value?.trim();
    if value.is_empty() {
        return None;
    }
    Some(value.chars().take(2_000).collect())
}

fn turn_has_agent_response(turn: Option<&serde_json::Map<String, Value>>) -> bool {
    turn.and_then(|turn| turn.get("items"))
        .and_then(Value::as_array)
        .is_some_and(|items| {
            items.iter().filter_map(Value::as_object).any(|item| {
                item.get("type").and_then(Value::as_str) == Some("agentMessage")
                    && item
                        .get("text")
                        .and_then(Value::as_str)
                        .is_some_and(|text| !text.trim().is_empty())
            })
        })
}

fn turn_has_user_message(turn: Option<&serde_json::Map<String, Value>>) -> bool {
    turn.and_then(|turn| turn.get("items"))
        .and_then(Value::as_array)
        .is_some_and(|items| {
            items
                .iter()
                .filter_map(Value::as_object)
                .any(|item| item.get("type").and_then(Value::as_str) == Some("userMessage"))
        })
}

fn is_thread_activity(method: &str) -> bool {
    method.starts_with("turn/")
        || method.starts_with("item/")
        || method == "thread/tokenUsage/updated"
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn attaches_a_stable_delta_patch_without_removing_raw_params() {
        let payload = json!({
            "method": "item/agentMessage/delta",
            "params": {
                "threadId": "thread-1",
                "turnId": "turn-1",
                "itemId": "item-1",
                "delta": "hello"
            }
        });

        let projected = attach_thread_patch(payload);

        assert_eq!(projected["params"]["delta"], "hello");
        assert_eq!(projected[THREAD_PATCH_FIELD]["version"], 1);
        assert_eq!(
            projected[THREAD_PATCH_FIELD]["operation"]["kind"],
            "itemTextDelta"
        );
        assert_eq!(
            projected[THREAD_PATCH_FIELD]["operation"]["itemType"],
            "agentMessage"
        );
        assert!(
            projected[THREAD_PATCH_FIELD]["operation"]
                .get("delta")
                .is_none(),
            "patch metadata must not duplicate streamed content"
        );
    }

    #[test]
    fn ignores_notifications_that_do_not_change_a_thread_projection() {
        let payload = json!({"method": "account/updated", "params": {}});
        assert_eq!(attach_thread_patch(payload.clone()), payload);
    }

    #[test]
    fn embeds_companion_usage_in_the_semantic_operation() {
        let projected = attach_thread_patch_with_usage(
            json!({
                "method": "thread/tokenUsage/updated",
                "params": {"threadId": "thread", "turnId": "turn", "tokenUsage": {}}
            }),
            Some(json!({"version": 1, "status": "live"})),
        );
        assert_eq!(
            projected[THREAD_PATCH_FIELD]["operation"]["usage"]["status"],
            "live"
        );
    }

    #[test]
    fn hashes_the_terminal_agent_projection_for_end_to_end_verification() {
        let projected = attach_thread_patch(json!({
            "method": "turn/completed",
            "params": {
                "threadId": "thread",
                "turn": {
                    "id": "turn",
                    "items": [{
                        "id": "agent",
                        "type": "agentMessage",
                        "phase": "final_answer",
                        "text": "hello"
                    }]
                }
            }
        }));

        assert_eq!(
            projected[THREAD_PATCH_FIELD]["operation"]["terminalProjection"],
            json!({
                "version": 1,
                "turnId": "turn",
                "agentMessage": {
                    "utf8Bytes": 5,
                    "sha256": "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824"
                }
            })
        );
    }

    #[test]
    fn sparse_completion_does_not_claim_that_the_authoritative_turn_has_no_agent_message() {
        let projected = attach_thread_patch(json!({
            "method": "turn/completed",
            "params": {
                "threadId": "thread",
                "turn": {
                    "id": "interrupted-turn",
                    "status": "interrupted",
                    "items": []
                }
            }
        }));

        assert!(
            projected[THREAD_PATCH_FIELD]["operation"]
                .get("terminalProjection")
                .is_none(),
            "a sparse notification is not evidence that the authoritative turn has no response"
        );
    }

    #[test]
    fn patch_overhead_is_constant_for_large_content() -> Result<(), serde_json::Error> {
        let payload = json!({
            "method": "item/agentMessage/delta",
            "params": {
                "threadId": "thread-1",
                "turnId": "turn-1",
                "itemId": "item-1",
                "delta": "x".repeat(1_000_000)
            }
        });
        let raw_bytes = serde_json::to_vec(&payload)?.len();
        let projected_bytes = serde_json::to_vec(&attach_thread_patch(payload))?.len();
        assert!(projected_bytes - raw_bytes < 256);
        Ok(())
    }

    #[test]
    fn projects_bounded_summary_semantics_for_the_thread_list() {
        let payload = json!({
            "method": "turn/completed",
            "params": {
                "threadId": "thread-1",
                "turn": {"items": [
                    {"type": "userMessage", "content": [{"type": "text", "text": "Prompt"}]},
                    {"type": "agentMessage", "phase": "final_answer", "text": "**Answer**"}
                ]}
            }
        });

        let projected = attach_thread_patch(payload);
        let summary = &projected[THREAD_PATCH_FIELD]["operation"]["summary"];
        assert_eq!(summary["previewText"], "**Answer**");
        assert_eq!(summary["conversationMessage"], true);
        assert_eq!(summary["finalAgentResponse"], true);
    }
}
