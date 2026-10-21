//! The model a native read reports for each sub-agent: the newest answer of
//! its own transcript, never the main conversation's.

use std::path::Path;

use serde_json::{Value, json};

use super::*;

const SESSION: &str = "33333333-3333-4333-8333-333333333333";

fn rows(values: &[Value]) -> String {
    values
        .iter()
        .map(|value| value.to_string() + "\n")
        .collect()
}

fn at(second: u32) -> String {
    format!("2026-10-01T10:00:{second:02}.000Z")
}

/// One row of a conversation level; `agent` names a sub-agent transcript.
fn message(
    kind: &str,
    uuid: &str,
    parent: Option<&str>,
    second: u32,
    agent: Option<&str>,
    body: &Value,
) -> Value {
    let mut row = json!({"type": kind, "uuid": uuid, "parentUuid": parent, "timestamp": at(second),
        "sessionId": SESSION, "cwd": "/work", "isSidechain": agent.is_some(), "message": body});
    if let Some(agent) = agent {
        row["agentId"] = json!(agent);
    } else {
        row["entrypoint"] = json!("cli");
    }
    row
}

fn answer(uuid: &str, model: Option<&str>, text: &str) -> Value {
    json!({"id": format!("msg_{uuid}"), "model": model, "role": "assistant",
        "content": [{"type": "text", "text": text}]})
}

/// A session answered by Opus with two finished sub-agents: `pinned` answered
/// with Haiku (its last row a synthetic placeholder), `unrecorded` recorded
/// no model.
fn write_store(root: &Path) -> Result<(), Box<dyn std::error::Error>> {
    let (projects, _) = fixture_paths(root);
    let project = projects.join("-work");
    let agents = project.join(SESSION).join("subagents");
    std::fs::create_dir_all(&agents)?;
    let prompt = json!({"role": "user", "content": "Look around"});
    std::fs::write(
        project.join(format!("{SESSION}.jsonl")),
        rows(&[
            message("user", "p1", None, 1, None, &prompt),
            message(
                "assistant",
                "a1",
                Some("p1"),
                2,
                None,
                &answer("a1", Some("claude-opus-5-5"), "Done."),
            ),
        ]),
    )?;
    std::fs::write(
        agents.join("agent-pinned.jsonl"),
        rows(&[
            message("user", "s1", None, 3, Some("pinned"), &prompt),
            message(
                "assistant",
                "s2",
                Some("s1"),
                4,
                Some("pinned"),
                &answer("s2", Some("claude-haiku-4-5"), "Found it."),
            ),
            message(
                "assistant",
                "s3",
                Some("s2"),
                5,
                Some("pinned"),
                &answer("s3", Some("<synthetic>"), "No response requested."),
            ),
        ]),
    )?;
    std::fs::write(
        agents.join("agent-unrecorded.jsonl"),
        rows(&[
            message("user", "u1", None, 3, Some("unrecorded"), &prompt),
            message(
                "assistant",
                "u2",
                Some("u1"),
                4,
                Some("unrecorded"),
                &answer("u2", None, "Nothing."),
            ),
        ]),
    )?;
    Ok(())
}

#[tokio::test]
async fn each_sub_agent_reports_the_model_of_its_own_transcript()
-> Result<(), Box<dyn std::error::Error>> {
    let root = tempfile::tempdir()?;
    write_store(root.path())?;
    let (projects, journal) = fixture_paths(root.path());
    let read = LocalSessions::new(projects, journal).read(SESSION).await?;
    let models = read
        .subagents
        .iter()
        .map(|subagent| (subagent.agent_id.as_str(), subagent.model.as_deref()))
        .collect::<Vec<_>>();
    assert_eq!(
        models,
        [("pinned", Some("claude-haiku-4-5")), ("unrecorded", None)]
    );
    // The index keeps what the read reports.
    let indexed = crate::subagents::index(&read)
        .into_iter()
        .map(|subagent| subagent.model)
        .collect::<Vec<_>>();
    assert_eq!(indexed, [Some("claude-haiku-4-5".to_owned()), None]);
    Ok(())
}
