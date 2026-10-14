//! `thread.updated` projections of recorded transcripts replayed through
//! the service, against the host's golden event streams
//! (`host/test/golden/*.neutral.jsonl`). Time fields are blanked: they
//! depend on how often each implementation reads its clock.

use std::path::{Path, PathBuf};

use agent_core::model::{
    ClientMessageId, ThreadCreateParams, ThreadSettings, TurnStartParams, UserContent,
};
use serde_json::{Value, json};

use super::{Options, TestResult, harness, id, settle};

const REPLAY_THREAD: &str = "00000000-0000-4000-8000-0000000000aa";
const TIME_FIELDS: [&str; 6] = [
    "startedAt",
    "completedAt",
    "durationMs",
    "createdAt",
    "updatedAt",
    "recencyAt",
];

fn fixtures() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("fixtures")
}

fn load(path: &Path) -> Result<Vec<Value>, Box<dyn std::error::Error>> {
    std::fs::read_to_string(path)?
        .lines()
        .filter(|line| !line.trim().is_empty())
        .map(|line| serde_json::from_str(line).map_err(Into::into))
        .collect()
}

fn without_times(value: &mut Value) {
    match value {
        Value::Object(record) => {
            for (key, field) in record.iter_mut() {
                if TIME_FIELDS.contains(&key.as_str()) && !field.is_null() {
                    *field = json!(0);
                } else {
                    without_times(field);
                }
            }
        }
        Value::Array(values) => values.iter_mut().for_each(without_times),
        _ => {}
    }
}

fn updates(events: impl IntoIterator<Item = Value>) -> Vec<Value> {
    let mut updates: Vec<Value> = Vec::new();
    for mut event in events {
        if event["type"] != "thread.updated" {
            continue;
        }
        without_times(&mut event);
        if updates.last() != Some(&event) {
            updates.push(event);
        }
    }
    updates
}

/// The host published `thread.updated` before its background metadata
/// refresh of the new session landed: a thread that already showed its
/// first prompt shows an empty preview until the refresh republishes it.
/// The Rust service's refresh lands at `init`, before the turn ends, so the
/// golden stream is read with the preview the refresh brings.
fn with_refreshed_previews(golden: Vec<Value>) -> Vec<Value> {
    let mut known = Value::from("");
    let mut updates: Vec<Value> = Vec::new();
    for mut event in golden {
        let preview = &mut event["thread"]["preview"];
        if *preview == "" {
            preview.clone_from(&known);
        } else {
            known = preview.clone();
        }
        if updates.last() != Some(&event) {
            updates.push(event);
        }
    }
    updates
}

fn offer_text(entry: &Value) -> String {
    match &entry["frame"]["message"]["message"]["content"] {
        Value::String(text) => text.clone(),
        Value::Array(blocks) => blocks
            .iter()
            .filter_map(|block| block["text"].as_str())
            .collect::<Vec<_>>()
            .join("\n"),
        _ => String::new(),
    }
}

/// Replays one recorded transcript through the service; returns every
/// published event.
async fn replay(scenario: &str) -> Result<Vec<Value>, Box<dyn std::error::Error>> {
    let entries = load(&fixtures().join("replay").join(format!("{scenario}.ndjson")))?;
    let harness = harness(Options {
        ticking_clock: true,
        ..Options::default()
    })?;
    let thread = id(REPLAY_THREAD)?;
    harness
        .service
        .create(ThreadCreateParams {
            app_thread_id: Some(thread.clone()),
            cwd: "/workspace".into(),
            settings: ThreadSettings {
                model: "claude-sonnet-4-6".into(),
                effort: None,
                permission_profile: ":full-access".into(),
                service_tier: None,
            },
            client_tools: None,
        })
        .await?;
    let mut client_messages = 0;
    for entry in &entries {
        match (entry["type"].as_str(), entry["frame"]["type"].as_str()) {
            (Some("expect_outbound"), Some("prompt.offer")) => {
                client_messages += 1;
                harness
                    .service
                    .turn_start(TurnStartParams {
                        app_thread_id: thread.clone(),
                        client_message_id: ClientMessageId::parse(&format!(
                            "replay-{client_messages}"
                        )),
                        input: vec![UserContent::Text {
                            text: offer_text(entry),
                        }],
                        client_tools: None,
                    })
                    .await?;
            }
            (Some("emit_inbound"), _) => {
                let query = harness.runtime.queries().pop().ok_or("no open query")?;
                query.push(entry["frame"].clone()).await;
            }
            (Some("runtime_exit"), _) => {
                let query = harness.runtime.queries().pop().ok_or("no open query")?;
                query.end().await;
            }
            _ => continue,
        }
        // The session takes Claude's output before commands: after this
        // read, the entry has been handled.
        harness.service.read(&thread, false).await?;
        settle().await;
    }
    settle().await;
    harness.service.shutdown().await;
    settle().await;
    let events = harness
        .events()
        .iter()
        .map(serde_json::to_value)
        .collect::<Result<Vec<_>, _>>()?;
    Ok(events)
}

async fn assert_matches_golden(scenario: &str) -> TestResult {
    let actual = updates(replay(scenario).await?);
    let expected = with_refreshed_previews(updates(load(
        &fixtures()
            .join("golden")
            .join(format!("{scenario}.neutral.jsonl")),
    )?));
    assert_eq!(
        actual,
        expected,
        "{scenario}: thread.updated differs\nactual:\n{}\ngolden:\n{}",
        actual
            .iter()
            .map(Value::to_string)
            .collect::<Vec<_>>()
            .join("\n"),
        expected
            .iter()
            .map(Value::to_string)
            .collect::<Vec<_>>()
            .join("\n"),
    );
    Ok(())
}

#[tokio::test]
async fn simple_publishes_the_golden_thread_updates() -> TestResult {
    assert_matches_golden("simple").await
}

#[tokio::test]
async fn multi_turn_publishes_the_golden_thread_updates() -> TestResult {
    assert_matches_golden("multi_turn").await
}

/// The event kinds besides `thread.updated` are the session's; this checks
/// that the service passes them through in order.
#[tokio::test]
async fn passes_the_sessions_events_through_in_order() -> TestResult {
    let actual = replay("simple")
        .await?
        .into_iter()
        .filter(|event| event["type"] != "thread.updated")
        .map(|event| event["type"].clone())
        .collect::<Vec<_>>();
    let expected = load(&fixtures().join("golden/simple.neutral.jsonl"))?
        .into_iter()
        .filter(|event| event["type"] != "thread.updated")
        .map(|event| event["type"].clone())
        .collect::<Vec<_>>();
    assert_eq!(actual, expected);
    Ok(())
}
