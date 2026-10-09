//! Projects the Claude host's committed neutral replay streams
//! (`crates/agent-provider-claude/host/test/golden/*.neutral.jsonl`) onto the client wire
//! and checks them with a port of the client's authoritative-repair
//! predicate (`packages/sync-client/src/thread-events.ts`,
//! `threadProjectionNeedsAuthoritativeRepair`) plus the neutral ordering
//! rules. A stream that would make the client repair or render a stuck item
//! fails here.

use std::{
    collections::{HashMap, HashSet},
    path::Path,
};

use serde_json::{Map, Value};

use super::{WireProvider, events::EventProjector};
use crate::{
    agent::model::{
        AgentEvent, CapabilitySet, ProviderDescriptor, ProviderId, StartWhileActiveMode,
    },
    thread_patch::{THREAD_PATCH_FIELD, attach_thread_patch},
};

fn golden_directory() -> std::path::PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../agent-provider-claude/host/test/golden")
}

fn claude_wire() -> WireProvider {
    let mut capabilities = CapabilitySet::none(StartWhileActiveMode::Busy);
    capabilities.turns_steer = true;
    capabilities.turns_provider_initiated = true;
    capabilities.threads_host_minted_ids = true;
    capabilities.threads_compact = true;
    capabilities.requests_user_input = true;
    WireProvider {
        descriptor: ProviderDescriptor {
            id: ProviderId::from_static("claude"),
            display_name: "Claude".into(),
            model_provider: "anthropic".into(),
            version: "0.1.0".into(),
        },
        capabilities,
        primary_id: ProviderId::from_static("codex"),
        multi_provider: true,
    }
}

/// Port of `threadProjectionNeedsAuthoritativeRepair` over one stream.
fn repair_reason(payloads: &[Value]) -> Option<String> {
    let mut item_types: HashMap<String, HashMap<String, String>> = HashMap::new();
    for (index, payload) in payloads.iter().enumerate() {
        let Some(patch) = payload.get(THREAD_PATCH_FIELD) else {
            continue;
        };
        let mut operation = payload
            .get("params")
            .and_then(Value::as_object)
            .cloned()
            .unwrap_or_default();
        if let Some(fields) = patch.get("operation").and_then(Value::as_object) {
            operation.extend(fields.clone());
        }
        let kind = operation.get("kind").and_then(Value::as_str).unwrap_or("");
        let turn = operation.get("turn").and_then(Value::as_object);
        let reason = |text: &str| Some(format!("#{index} {kind}: {text}"));
        match kind {
            "turnCompleted" | "turnStarted" => {
                let Some(turn_id) = turn.and_then(|turn| turn.get("id")).and_then(Value::as_str)
                else {
                    return reason("turn without id");
                };
                let items = turn
                    .and_then(|turn| turn.get("items"))
                    .and_then(Value::as_array);
                if kind == "turnCompleted"
                    && (turn
                        .and_then(|turn| turn.get("itemsView"))
                        .and_then(Value::as_str)
                        != Some("full")
                        || items.is_none())
                {
                    return reason("completed turn is not a full item list");
                }
                item_types.insert(turn_id.to_owned(), types_of(items));
            }
            "itemUpsert" => {
                let Some(turn_id) = operation.get("turnId").and_then(Value::as_str) else {
                    return reason("item without turn");
                };
                let Some(types) = item_types.get_mut(turn_id) else {
                    return reason("item of an unknown turn");
                };
                let item = operation.get("item").and_then(Value::as_object);
                let (Some(id), Some(item_type)) = (
                    item.and_then(|item| item.get("id")).and_then(Value::as_str),
                    item.and_then(|item| item.get("type"))
                        .and_then(Value::as_str),
                ) else {
                    return reason("item without id or type");
                };
                types.insert(id.to_owned(), item_type.to_owned());
            }
            _ => {
                if let Some(expected) = expected_item_type(kind, &operation) {
                    let turn_id = operation.get("turnId").and_then(Value::as_str);
                    let item_id = operation.get("itemId").and_then(Value::as_str);
                    let actual = turn_id
                        .zip(item_id)
                        .and_then(|(turn, item)| item_types.get(turn)?.get(item));
                    if actual.map(String::as_str) != Some(expected.as_str()) {
                        return reason("delta of an item that was not started with that type");
                    }
                } else if matches!(
                    kind,
                    "modelRerouted" | "tokenUsage" | "turnDiff" | "turnPlan"
                ) && !operation
                    .get("turnId")
                    .and_then(Value::as_str)
                    .is_some_and(|turn| item_types.contains_key(turn))
                {
                    return reason("turn-scoped update of an unknown turn");
                }
            }
        }
    }
    None
}

fn types_of(items: Option<&Vec<Value>>) -> HashMap<String, String> {
    items
        .map(|items| {
            items
                .iter()
                .filter_map(|item| {
                    Some((
                        item.get("id")?.as_str()?.to_owned(),
                        item.get("type")?.as_str()?.to_owned(),
                    ))
                })
                .collect()
        })
        .unwrap_or_default()
}

fn expected_item_type(kind: &str, operation: &Map<String, Value>) -> Option<String> {
    match kind {
        "itemTextDelta" => Some(
            operation
                .get("itemType")
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_owned(),
        ),
        "fileChanges" => Some("fileChange".into()),
        "mcpProgress" => Some("mcpToolCall".into()),
        "reasoningPart" | "reasoningDelta" => Some("reasoning".into()),
        _ => None,
    }
}

/// Rendering rules the predicate does not check: user message first in a
/// user turn, every started item completed before its turn, at most one
/// final answer per turn.
fn ordering_violation(payloads: &[Value]) -> Option<String> {
    let mut open: HashMap<String, HashSet<String>> = HashMap::new();
    let mut first_item: HashMap<String, String> = HashMap::new();
    for (index, payload) in payloads.iter().enumerate() {
        let method = payload.get("method").and_then(Value::as_str).unwrap_or("");
        let params = payload.get("params").cloned().unwrap_or(Value::Null);
        let turn_id = params
            .get("turnId")
            .and_then(Value::as_str)
            .or_else(|| params.pointer("/turn/id").and_then(Value::as_str))
            .unwrap_or("")
            .to_owned();
        match method {
            "item/started" => {
                let item_id = params
                    .pointer("/item/id")
                    .and_then(Value::as_str)
                    .unwrap_or("");
                let item_type = params
                    .pointer("/item/type")
                    .and_then(Value::as_str)
                    .unwrap_or("");
                first_item
                    .entry(turn_id.clone())
                    .or_insert_with(|| item_type.to_owned());
                open.entry(turn_id).or_default().insert(item_id.to_owned());
            }
            "item/completed" => {
                let item_id = params
                    .pointer("/item/id")
                    .and_then(Value::as_str)
                    .unwrap_or("");
                if let Some(items) = open.get_mut(&turn_id) {
                    items.remove(item_id);
                }
            }
            "turn/completed" => {
                if open.get(&turn_id).is_some_and(|items| !items.is_empty()) {
                    return Some(format!(
                        "#{index}: turn {turn_id} completed with open items"
                    ));
                }
                let items = params.pointer("/turn/items").and_then(Value::as_array);
                let finals = items.map_or(0, |items| {
                    items
                        .iter()
                        .filter(|item| {
                            item.get("type").and_then(Value::as_str) == Some("agentMessage")
                                && item.get("phase").and_then(Value::as_str) == Some("final_answer")
                        })
                        .count()
                });
                if finals > 1 {
                    return Some(format!(
                        "#{index}: turn {turn_id} has {finals} final answers"
                    ));
                }
                let has_user = items.is_some_and(|items| {
                    items
                        .iter()
                        .any(|item| item.get("type").and_then(Value::as_str) == Some("userMessage"))
                });
                if has_user
                    && first_item
                        .get(&turn_id)
                        .is_some_and(|first| first != "userMessage")
                {
                    return Some(format!(
                        "#{index}: user turn {turn_id} does not start with its message"
                    ));
                }
            }
            _ => {}
        }
    }
    None
}

#[test]
fn sidecar_golden_streams_project_without_client_repair_or_open_items()
-> Result<(), Box<dyn std::error::Error>> {
    let mut files = std::fs::read_dir(golden_directory())?
        .filter_map(Result::ok)
        .map(|entry| entry.path())
        .filter(|path| path.to_string_lossy().ends_with(".neutral.jsonl"))
        .collect::<Vec<_>>();
    files.sort();
    assert!(files.len() >= 30, "expected the sidecar golden set");
    let mut approvals = 0_usize;
    for path in files {
        let mut projector = EventProjector::new(claude_wire());
        let mut payloads = Vec::new();
        for line in std::fs::read_to_string(&path)?.lines() {
            if line.trim().is_empty() {
                continue;
            }
            let event: AgentEvent = serde_json::from_str(line)
                .map_err(|error| format!("{}: {error}", path.display()))?;
            for payload in projector.project(event) {
                payloads.push(attach_thread_patch(payload));
            }
        }
        for payload in &payloads {
            if payload.get("id").is_some() && payload.get("method").is_some() {
                approvals += 1;
                let id = payload["id"].as_str().unwrap_or_default();
                assert!(id.starts_with("cw-claude:"), "{}: {id}", path.display());
            }
        }
        assert_eq!(repair_reason(&payloads), None, "{}", path.display());
        assert_eq!(ordering_violation(&payloads), None, "{}", path.display());
    }
    assert!(approvals > 0, "golden streams carry runtime requests");
    Ok(())
}

#[test]
fn the_oracle_detects_a_delta_before_its_item() {
    let payloads = [
        attach_thread_patch(serde_json::json!({
            "method": "turn/started",
            "params": {"threadId": "t", "turn": {"id": "u", "items": []}}
        })),
        attach_thread_patch(serde_json::json!({
            "method": "item/agentMessage/delta",
            "params": {"threadId": "t", "turnId": "u", "itemId": "i", "delta": "x"}
        })),
    ];
    assert!(repair_reason(&payloads).is_some());
}
