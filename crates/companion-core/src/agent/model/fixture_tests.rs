//! Round-trips every `packages/agent-protocol/fixtures/v1` message through
//! the typed serde mirror. A field the mirror drops, renames or retypes makes
//! the re-encoded value differ from the fixture.

use std::path::{Path, PathBuf};

use serde::{Serialize, de::DeserializeOwned};
use serde_json::Value;

use super::*;

fn fixture_directory() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../../packages/agent-protocol/fixtures/v1")
}

fn round_trip<T: Serialize + DeserializeOwned>(value: &Value) -> Result<Value, String> {
    let typed: T = serde_json::from_value(value.clone()).map_err(|error| error.to_string())?;
    serde_json::to_value(typed).map_err(|error| error.to_string())
}

fn round_trip_result(operation: &str, result: &Value) -> Result<Value, String> {
    match operation {
        "initialize" => round_trip::<InitializeResult>(result),
        "catalog.models" => round_trip::<ModelCatalog>(result),
        "catalog.permissionProfiles" => round_trip::<PermissionProfileCatalog>(result),
        "thread.create" => round_trip::<ThreadResult>(result),
        "thread.read" => round_trip::<ThreadReadResult>(result),
        "thread.list" => round_trip::<ThreadListResult>(result),
        "thread.turns" => round_trip::<ThreadTurnsResult>(result),
        "thread.update" => round_trip::<ThreadUpdateResult>(result),
        "thread.owns" => round_trip::<ThreadOwnsResult>(result),
        "thread.compact" | "turn.interrupt" | "request.respond" => round_trip::<Empty>(result),
        "turn.start" => round_trip::<TurnStartResult>(result),
        "turn.steer" => round_trip::<TurnSteerResult>(result),
        "capability.invoke" => round_trip::<CapabilityInvokeResult>(result),
        other => Err(format!("fixture answers unknown operation {other}")),
    }
}

fn round_trip_message(responds_to: Option<&str>, message: &Value) -> Result<Value, String> {
    let method = message.get("method").and_then(Value::as_str);
    match method {
        Some("event") => {
            let event = round_trip::<AgentEvent>(&message["params"])?;
            Ok(serde_json::json!({"method": "event", "params": event}))
        }
        Some("initialized") => Ok(message.clone()),
        Some(_) => round_trip::<RequestEnvelope>(message),
        None if message.get("error").is_some() => {
            let error = round_trip::<RpcError>(&message["error"])?;
            Ok(serde_json::json!({"id": message["id"], "error": error}))
        }
        None => {
            let operation = responds_to.ok_or("response fixture names no operation")?;
            let result = round_trip_result(operation, &message["result"])?;
            Ok(serde_json::json!({"id": message["id"], "result": result}))
        }
    }
}

#[test]
fn every_protocol_fixture_round_trips_through_the_typed_mirror()
-> Result<(), Box<dyn std::error::Error>> {
    let mut checked = 0_usize;
    let mut names = std::fs::read_dir(fixture_directory())?
        .filter_map(Result::ok)
        .map(|entry| entry.path())
        .filter(|path| {
            path.extension()
                .is_some_and(|extension| extension == "json")
        })
        .collect::<Vec<_>>();
    names.sort();
    assert!(names.len() >= 3, "expected the v1 fixture set");
    for path in names {
        let fixture: Value = serde_json::from_slice(&std::fs::read(&path)?)?;
        let messages = fixture["messages"]
            .as_array()
            .ok_or("fixture messages must be an array")?;
        for (index, entry) in messages.iter().enumerate() {
            let responds_to = entry["respondsTo"].as_str();
            let message = &entry["message"];
            let encoded = round_trip_message(responds_to, message)
                .map_err(|error| format!("{}[{index}]: {error}", path.display()))?;
            assert_eq!(
                &encoded,
                message,
                "{}[{index}] changed in the round trip",
                path.display()
            );
            checked += 1;
        }
    }
    assert!(checked > 60, "only {checked} fixture messages were checked");
    Ok(())
}
