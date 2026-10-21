//! Display names of the models a client-wire payload names, added beside
//! each model id so a client shows the provider's name (`Opus 5.5`) as is.
//! The names come from the thread's own provider (`AgentProvider::model_names`);
//! a model the provider does not name keeps no label.

use agent_core::naming::ModelNaming;
use serde_json::{Map, Value};

/// The cost a combination of several models reports instead of a model id.
const MIXED_MODEL: &str = "mixed";

/// Whether `payload` names a model this module labels, so its thread's
/// provider is worth resolving.
#[must_use]
pub fn names_a_model(payload: &Value) -> bool {
    matches!(
        payload.get("method").and_then(Value::as_str),
        Some("thread/settings/updated" | "model/rerouted")
    ) || payload
        .pointer("/codewideThreadPatch/operation/usage")
        .is_some_and(|usage| !usage.is_null())
}

/// Labels the models of one live notification: a settings change, a model
/// reroute and the usage its thread patch carries.
#[must_use]
pub fn label_payload(mut payload: Value, names: &dyn ModelNaming) -> Value {
    match payload.get("method").and_then(Value::as_str) {
        Some("thread/settings/updated") => {
            if let Some(settings) = payload
                .pointer_mut("/params/threadSettings")
                .and_then(Value::as_object_mut)
            {
                label_field(settings, "model", "modelLabel", names);
            }
        }
        Some("model/rerouted") => {
            if let Some(params) = payload.get_mut("params").and_then(Value::as_object_mut) {
                label_field(params, "toModel", "toModelLabel", names);
            }
        }
        _ => {}
    }
    if let Some(usage) = payload.pointer_mut("/codewideThreadPatch/operation/usage") {
        label_usage(usage, names);
    }
    payload
}

/// Labels the model of each cost a turn usage projection carries.
pub fn label_usage(usage: &mut Value, names: &dyn ModelNaming) {
    for scope in ["turn", "thread"] {
        if let Some(cost) = usage
            .get_mut(scope)
            .and_then(|scope| scope.get_mut("cost"))
            .and_then(Value::as_object_mut)
        {
            label_field(cost, "model", "modelLabel", names);
        }
    }
}

/// Labels the usage of the turns an RPC result carries: a turn page
/// (`turns`, `history.turns`), a thread with its turns and an active turn.
#[must_use]
pub fn label_rpc_result(mut result: Value, names: &dyn ModelNaming) -> Value {
    for pointer in ["/turns", "/history/turns", "/thread/turns"] {
        if let Some(turns) = result.pointer_mut(pointer).and_then(Value::as_array_mut) {
            label_turns(turns, names);
        }
    }
    if let Some(active) = result.get_mut("activeTurn").filter(|turn| turn.is_object()) {
        label_turns(std::slice::from_mut(active), names);
    }
    result
}

/// Labels the usage of every turn in `turns` (`codewide.usage`).
pub fn label_turns(turns: &mut [Value], names: &dyn ModelNaming) {
    for turn in turns {
        if let Some(usage) = turn.pointer_mut("/codewide/usage") {
            label_usage(usage, names);
        }
    }
}

fn label_field(object: &mut Map<String, Value>, model: &str, label: &str, names: &dyn ModelNaming) {
    let name = object
        .get(model)
        .and_then(Value::as_str)
        .filter(|model| *model != MIXED_MODEL)
        .and_then(|model| names.label(model));
    match name {
        Some(name) => {
            object.insert(label.to_owned(), Value::String(name));
        }
        None => {
            object.remove(label);
        }
    }
}

#[cfg(test)]
mod tests {
    use agent_core::naming::CatalogNames;
    use serde_json::json;

    use super::*;

    fn names() -> CatalogNames {
        CatalogNames::new([("claude-opus-5-5".to_owned(), "Opus 5.5".to_owned())])
    }

    #[test]
    fn a_settings_change_and_a_reroute_name_their_model() {
        let settings = label_payload(
            json!({"method": "thread/settings/updated", "params": {
                "threadId": "t", "threadSettings": {"model": "claude-opus-5-5"}}}),
            &names(),
        );
        assert_eq!(
            settings["params"]["threadSettings"]["modelLabel"],
            "Opus 5.5"
        );
        let rerouted = label_payload(
            json!({"method": "model/rerouted", "params": {
                "threadId": "t", "toModel": "claude-opus-5-5"}}),
            &names(),
        );
        assert_eq!(rerouted["params"]["toModelLabel"], "Opus 5.5");
    }

    #[test]
    fn each_cost_names_its_model_and_a_mix_or_an_unknown_model_stays_unnamed() {
        let delivered = label_payload(
            json!({"method": "thread/tokenUsage/updated", "codewideThreadPatch": {"operation": {
            "usage": {
                "turn": {"cost": {"model": "claude-opus-5-5"}},
                "thread": {"cost": {"model": "mixed", "modelLabel": "stale"}},
            }}}}),
            &names(),
        );
        let usage = &delivered["codewideThreadPatch"]["operation"]["usage"];
        assert_eq!(usage["turn"]["cost"]["modelLabel"], "Opus 5.5");
        assert!(usage["thread"]["cost"].get("modelLabel").is_none());
        let mut turns = vec![json!({"codewide": {"usage": {
            "turn": {"cost": {"model": "claude-unknown-1"}}, "thread": {"cost": null}}}})];
        label_turns(&mut turns, &names());
        assert!(
            turns[0]["codewide"]["usage"]["turn"]["cost"]
                .get("modelLabel")
                .is_none()
        );
    }

    #[test]
    fn only_payloads_that_name_a_model_are_resolved() {
        assert!(names_a_model(&json!({"method": "model/rerouted"})));
        assert!(names_a_model(&json!({"method": "turn/completed",
            "codewideThreadPatch": {"operation": {"usage": {"turn": {}}}}})));
        assert!(!names_a_model(&json!({"method": "item/agentMessage/delta",
            "codewideThreadPatch": {"operation": {"kind": "itemTextDelta"}}})));
    }
}
