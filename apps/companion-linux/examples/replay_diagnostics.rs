use std::{env, error::Error, path::PathBuf};

use codewide_companion::store::IndexStore;
use serde::Serialize;
use serde_json::Value;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct EventDiagnostic<'a> {
    cursor: u64,
    method: &'a str,
    thread_id: Option<&'a str>,
    turn_id: Option<&'a str>,
    item_id: Option<&'a str>,
    item_type: Option<&'a str>,
    item_phase: Option<&'a str>,
    delta_chars: Option<usize>,
}

fn main() -> Result<(), Box<dyn Error>> {
    let mut args = env::args_os().skip(1);
    let state = PathBuf::from(
        args.next()
            .ok_or("usage: replay_diagnostics <state.redb> [limit]")?,
    );
    let limit = args
        .next()
        .map(|value| value.to_string_lossy().parse::<u64>())
        .transpose()?
        .unwrap_or(2_000);
    let store = IndexStore::open(state)?;
    let head = store.replay_after(None)?.head_cursor;
    let page = store.replay_after(Some(head.saturating_sub(limit)))?;
    for (cursor, encoded) in page.entries {
        let payload: Value = serde_json::from_slice(&encoded)?;
        let method = payload.get("method").and_then(Value::as_str).unwrap_or("");
        let params = payload.get("params").and_then(Value::as_object);
        let item = params
            .and_then(|value| value.get("item"))
            .and_then(Value::as_object);
        let diagnostic = EventDiagnostic {
            cursor,
            method,
            thread_id: params
                .and_then(|value| value.get("threadId"))
                .and_then(Value::as_str),
            turn_id: params
                .and_then(|value| value.get("turnId"))
                .and_then(Value::as_str),
            item_id: params
                .and_then(|value| value.get("itemId"))
                .and_then(Value::as_str)
                .or_else(|| {
                    item.and_then(|value| value.get("id"))
                        .and_then(Value::as_str)
                }),
            item_type: item
                .and_then(|value| value.get("type"))
                .and_then(Value::as_str),
            item_phase: item
                .and_then(|value| value.get("phase"))
                .and_then(Value::as_str),
            delta_chars: params
                .and_then(|value| value.get("delta"))
                .and_then(Value::as_str)
                .map(str::chars)
                .map(Iterator::count),
        };
        println!("{}", serde_json::to_string(&diagnostic)?);
    }
    Ok(())
}
