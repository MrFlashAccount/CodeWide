//! Durable live adapter for activity metrics. It consumes raw output before the
//! content projector replaces it with private references; no output is stored.
use crate::{
    activity_metrics::{ActivityItem, ActivityState},
    store::{IndexStore, StoreError},
};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

#[derive(Default, Deserialize, Serialize)]
struct LiveActivityState {
    initialized: bool,
    model: Option<String>,
    state: ActivityState,
}

pub(crate) fn observe(
    store: &IndexStore,
    payload: &Value,
    usage: Option<&Value>,
) -> Result<Option<Value>, StoreError> {
    let Some(method) = payload.get("method").and_then(Value::as_str) else {
        return Ok(None);
    };
    if !matches!(
        method,
        "turn/started"
            | "turn/completed"
            | "item/started"
            | "item/completed"
            | "item/commandExecution/outputDelta"
            | "item/agentMessage/delta"
            | "thread/tokenUsage/updated"
            | "turn/plan/updated"
            | "turn/diff/updated"
    ) {
        return Ok(None);
    }
    let Some(params) = payload.get("params") else {
        return Ok(None);
    };
    let (Some(thread_id), Some(turn_id)) = (
        params.get("threadId").and_then(Value::as_str),
        params
            .get("turnId")
            .or_else(|| params.pointer("/turn/id"))
            .and_then(Value::as_str),
    ) else {
        return Ok(None);
    };
    let key = serde_json::to_string(&(thread_id, turn_id))?;
    let mut live = store
        .activity_metrics::<LiveActivityState>(&key)?
        .unwrap_or_default();
    live.initialized |= method == "turn/started"
        || (params.pointer("/turn/itemsView").and_then(Value::as_str) == Some("full")
            && params
                .pointer("/turn/items")
                .and_then(Value::as_array)
                .is_some_and(|items| {
                    items
                        .iter()
                        .any(|i| i.get("type").and_then(Value::as_str) == Some("userMessage"))
                }));
    if let Some(model) = usage
        .and_then(|value| value.pointer("/turn/cost/model"))
        .and_then(Value::as_str)
    {
        live.model = Some(model.to_owned());
    }
    let state = &mut live.state;
    if let Some(turn) = params.get("turn") {
        state.merge_turn(turn);
    }
    if let Some(item) = params.get("item").and_then(ActivityItem::from_item) {
        state.upsert(item);
    }
    if let Some(id) = params.get("itemId").and_then(Value::as_str) {
        let kind = if method == "item/commandExecution/outputDelta" {
            "commandExecution"
        } else {
            "agentMessage"
        };
        if !state.items.iter().any(|i| i.id == id) {
            state.upsert(ActivityItem {
                id: id.to_owned(),
                kind: kind.into(),
                ..ActivityItem::default()
            });
        }
        if let Some(item) = state.items.iter_mut().find(|i| i.id == id) {
            let delta = params.get("delta").and_then(Value::as_str).unwrap_or("");
            if method == "item/commandExecution/outputDelta" {
                item.output_bytes = Some(
                    item.output_bytes
                        .unwrap_or(0)
                        .saturating_add(delta.len() as u64),
                );
            }
            if method == "item/agentMessage/delta" {
                item.text |= !delta.trim().is_empty();
            }
        }
    }
    if method == "turn/plan/updated" {
        state.plan = true;
    }
    if method == "turn/diff/updated" {
        state.diff = true;
    }
    state.input_price = live
        .model
        .as_deref()
        .and_then(crate::usage::input_price_for);
    let projection = if live.initialized {
        state.projection()
    } else {
        Value::Null
    };
    store.put_activity_metrics(&key, &live)?;
    Ok(Some(projection))
}

pub(crate) fn attach(mut payload: Value, metrics: Option<Value>) -> Value {
    let Some(mut metrics) = metrics else {
        return payload;
    };
    if metrics.is_null() {
        if let Some(operation) = payload
            .pointer_mut("/codewideThreadPatch/operation")
            .and_then(Value::as_object_mut)
        {
            operation.insert("activityMetrics".into(), Value::Null);
        }
        return payload;
    }
    if let Some(params) = payload.get_mut("params") {
        let item_id = params
            .get("itemId")
            .or_else(|| params.pointer("/item/id"))
            .and_then(Value::as_str);
        let footprint = item_id.and_then(|id| metrics["commands"].get(id)).cloned();
        if let Some(item) = params.get_mut("item") {
            crate::activity_metrics::attach_item_metrics(item, &metrics);
        }
        if let Some(footprint) = footprint
            && let Some(params) = params.as_object_mut()
        {
            params.insert("codewideOutputFootprint".into(), footprint);
        }
        if let Some(items) = params
            .pointer_mut("/turn/items")
            .and_then(Value::as_array_mut)
        {
            for item in items {
                crate::activity_metrics::attach_item_metrics(item, &metrics);
            }
        }
    }
    // Per-command values travel with their item/delta. A new chunk must not
    // retransmit a footprint map for every older command in the turn.
    metrics["commands"] = json!({});
    if let Some(operation) = payload
        .pointer_mut("/codewideThreadPatch/operation")
        .and_then(Value::as_object_mut)
    {
        operation.insert("activityMetrics".into(), metrics.clone());
    }
    if let Some(turn) = payload
        .pointer_mut("/params/turn")
        .and_then(Value::as_object_mut)
    {
        if turn.get("itemsView").and_then(Value::as_str) == Some("summary") {
            crate::activity_metrics::compact_summary(&mut metrics);
        }
        let metadata = turn.entry("codewide").or_insert_with(|| json!({}));
        if let Some(metadata) = metadata.as_object_mut() {
            metadata.insert("activity".into(), metrics["total"].clone());
            metadata.insert("activityMetrics".into(), metrics);
        }
    }
    payload
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn joining_mid_turn_does_not_publish_partial_totals() -> Result<(), Box<dyn std::error::Error>>
    {
        let directory = tempfile::tempdir()?;
        let store = IndexStore::open(directory.path().join("index.redb"))?;
        let event = json!({"method":"item/completed","params":{"threadId":"thread","turnId":"turn","item":{"id":"last","type":"commandExecution","aggregatedOutput":"output"}}});
        let metrics = observe(&store, &event, None)?;
        assert_eq!(metrics, Some(Value::Null));
        let replay = attach(crate::thread_patch::attach_thread_patch(event), metrics);
        assert!(replay["codewideThreadPatch"]["operation"]["activityMetrics"].is_null());
        Ok(())
    }

    #[test]
    fn raw_deltas_completion_replay_and_restart_preserve_server_figures()
    -> Result<(), Box<dyn std::error::Error>> {
        let directory = tempfile::tempdir()?;
        let store = IndexStore::open(directory.path().join("index.redb"))?;
        observe(
            &store,
            &json!({"method":"turn/started","params":{"threadId":"thread","turn":{"id":"turn","status":"inProgress","items":[{"id":"u","type":"userMessage"}]}}}),
            None,
        )?;
        let delta = json!({"method":"item/commandExecution/outputDelta","params":{"threadId":"thread","turnId":"turn","itemId":"cmd","delta":"λa"}});
        let first = observe(&store, &delta, None)?.ok_or("missing metrics")?;
        assert_eq!(first["total"]["outputFootprint"]["bytes"], 3);
        drop(store);
        let store = IndexStore::open(directory.path().join("index.redb"))?;
        let completed = json!({"method":"item/completed","params":{"threadId":"thread","turnId":"turn","item":{"id":"cmd","type":"commandExecution","aggregatedOutput":"λa12345"}}});
        let priced = json!({"turn":{"cost":{"model":"gpt-6-sol","price":{"input":5.0}}}});
        let result = observe(&store, &completed, Some(&priced))?.ok_or("missing metrics")?;
        assert_eq!(
            result["total"]["outputFootprint"],
            crate::activity_metrics::footprint(8, 2, Some(2.0))
        );
        drop(store);
        let store = IndexStore::open(directory.path().join("index.redb"))?;
        let key = serde_json::to_string(&("thread", "turn"))?;
        let persisted: Value = store
            .activity_metrics(&key)?
            .ok_or("missing durable activity")?;
        assert_eq!(persisted["model"], "gpt-6-sol");
        assert!(persisted["state"].get("input_price").is_none());
        assert_eq!(observe(&store, &completed, None)?, Some(result.clone()));
        let without_output = json!({"method":"item/completed","params":{"threadId":"thread","turnId":"turn","item":{"id":"cmd","type":"commandExecution","aggregatedOutput":null}}});
        assert_eq!(
            observe(&store, &without_output, None)?,
            Some(result.clone())
        );
        let sparse = json!({"method":"turn/completed","params":{"threadId":"thread","turn":{"id":"turn","status":"completed","items":[]}}});
        let mut terminal = observe(&store, &sparse, None)?.ok_or("missing terminal")?;
        assert_eq!(terminal["total"], result["total"]);
        let wire = attach(
            crate::thread_patch::attach_thread_patch(sparse),
            Some(terminal.clone()),
        );
        let replay: Value = serde_json::from_slice(&serde_json::to_vec(&wire)?)?;
        terminal["commands"] = json!({});
        assert_eq!(
            replay["codewideThreadPatch"]["operation"]["activityMetrics"],
            terminal
        );
        Ok(())
    }
}
