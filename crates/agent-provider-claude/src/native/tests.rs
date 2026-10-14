//! Native session reads over a throwaway Claude store and host journal.

use std::path::Path;

use agent_core::model::{
    AgentItem, NativeSessionListParams, NativeThreadPresence, SubagentStatus, TurnStatus,
};
use serde_json::{Value, json};

use super::*;

const SESSION: &str = "11111111-1111-4111-8111-111111111111";
const OTHER: &str = "22222222-2222-4222-8222-222222222222";

fn row(value: &Value) -> String {
    format!("{value}\n")
}

fn at(second: u32) -> String {
    format!("2026-10-01T10:00:{second:02}.000Z")
}

fn user(uuid: &str, parent: Option<&str>, second: u32, content: &Value) -> Value {
    json!({"type": "user", "uuid": uuid, "parentUuid": parent, "timestamp": at(second),
        "sessionId": SESSION, "cwd": "/work", "entrypoint": "cli", "isSidechain": false,
        "message": {"role": "user", "content": content}})
}

fn assistant(uuid: &str, parent: &str, second: u32, content: &Value) -> Value {
    json!({"type": "assistant", "uuid": uuid, "parentUuid": parent, "timestamp": at(second),
        "sessionId": SESSION, "cwd": "/work", "isSidechain": false,
        "message": {"id": format!("msg_{uuid}"), "model": "claude-opus-5-5", "role": "assistant", "content": content}})
}

/// A terminal session: a prompt that spawns a background agent and gets an
/// answer, then a rewound prompt whose abandoned branch must not show.
fn write_store(root: &Path) -> Result<(), Box<dyn std::error::Error>> {
    let (projects, _) = fixture_paths(root);
    let project = projects.join("-work");
    std::fs::create_dir_all(project.join(SESSION).join("subagents"))?;
    let session = [
        user("p1", None, 1, &json!("Check the build")),
        assistant(
            "a1",
            "p1",
            2,
            &json!([{"type": "tool_use", "id": "toolu_spawn", "name": "Agent",
            "input": {"description": "Build", "prompt": "Run the build", "subagent_type": "Explore", "run_in_background": true}}]),
        ),
        {
            let mut result = user(
                "r1",
                Some("a1"),
                3,
                &json!([{"type": "tool_result", "tool_use_id": "toolu_spawn",
                "content": "Async agent launched successfully.\nagentId: agent1"}]),
            );
            result["toolUseResult"] = json!({"isAsync": true, "agentId": "agent1"});
            result
        },
        assistant(
            "a2",
            "r1",
            4,
            &json!([{"type": "text", "text": "Started."}]),
        ),
        user("p2", Some("a2"), 5, &json!("Abandoned question")),
        assistant(
            "a3",
            "p2",
            6,
            &json!([{"type": "text", "text": "Abandoned answer"}]),
        ),
        user("p2b", Some("a2"), 7, &json!("Asked again")),
        assistant(
            "a4",
            "p2b",
            8,
            &json!([{"type": "text", "text": "Answer again"}]),
        ),
        json!({"type": "ai-title", "aiTitle": "Build check", "sessionId": SESSION}),
    ];
    std::fs::write(
        project.join(format!("{SESSION}.jsonl")),
        session.iter().map(row).collect::<String>(),
    )?;
    let agent = [
        json!({"type": "user", "uuid": "s1", "parentUuid": null, "timestamp": at(3), "isSidechain": true,
            "agentId": "agent1", "message": {"role": "user", "content": "Run the build"}}),
        json!({"type": "assistant", "uuid": "s2", "parentUuid": "s1", "timestamp": at(4), "isSidechain": true,
            "agentId": "agent1", "message": {"id": "msg_s2", "role": "assistant",
                "content": [{"type": "tool_use", "id": "toolu_bash", "name": "Bash", "input": {"command": "make"}}]}}),
    ];
    std::fs::write(
        project.join(SESSION).join("subagents/agent-agent1.jsonl"),
        agent.iter().map(row).collect::<String>(),
    )?;
    std::fs::write(
        project
            .join(SESSION)
            .join("subagents/agent-agent1.meta.json"),
        r#"{"toolUseId":"toolu_spawn","agentType":"Explore"}"#,
    )?;
    let sdk = [
        json!({"type": "user", "uuid": "q1", "parentUuid": null, "timestamp": at(9),
        "entrypoint": "sdk-ts", "cwd": "/other", "message": {"role": "user", "content": "Programmatic"}}),
    ];
    std::fs::write(
        project.join(format!("{OTHER}.jsonl")),
        sdk.iter().map(row).collect::<String>(),
    )?;
    Ok(())
}

fn write_owner(root: &Path) -> Result<(), Box<dyn std::error::Error>> {
    let (_, journal) = fixture_paths(root);
    let directory = journal.join("threads/codewide-thread");
    std::fs::create_dir_all(&directory)?;
    std::fs::write(
        directory.join("state.json"),
        serde_json::to_vec(&json!({
            "appThreadId": "codewide-thread", "createdAt": 1, "cwd": "/work", "origin": "discovered",
            "pendingSettings": null, "presence": {"type": "listed", "archived": false}, "recencyAt": null,
            "sessionIds": [SESSION], "sessionStarted": true,
            "settings": {"model": "opus", "effort": null, "permissionProfile": ":workspace", "serviceTier": null},
            "title": {"type": "none"},
            "totalUsage": {"inputTokens": 0, "cachedInputTokens": 0, "outputTokens": 0,
                "reasoningOutputTokens": 0, "totalTokens": 0},
            "turns": [{"anchors": ["p1"], "completedAt": 9, "origin": "user",
                "outcome": {"status": "completed"},
                "prompts": [{"clientMessageId": "client-1", "role": "first", "uuid": "p1"}],
                "startedAt": 1, "turnId": "turn-first", "usage": null}],
            "updatedAt": 9, "version": 2
        }))?,
    )?;
    Ok(())
}

fn sessions(root: &Path) -> LocalSessions {
    let (projects, journal) = fixture_paths(root);
    LocalSessions::new(projects, journal)
}

#[tokio::test]
async fn lists_every_session_newest_first_with_its_listing_facts()
-> Result<(), Box<dyn std::error::Error>> {
    let root = tempfile::tempdir()?;
    write_store(root.path())?;
    let listed = sessions(root.path())
        .list(NativeSessionListParams {
            cursor: None,
            dir: None,
            limit: 500,
        })
        .await?;
    let terminal = listed
        .sessions
        .iter()
        .find(|session| session.session_id == SESSION)
        .ok_or("terminal session")?;
    assert!(terminal.interactive);
    assert_eq!(terminal.title.as_deref(), Some("Build check"));
    assert_eq!(terminal.first_prompt.as_deref(), Some("Check the build"));
    assert_eq!(terminal.cwd.as_deref(), Some("/work"));
    assert_eq!(terminal.app_thread_id.as_str(), SESSION);
    assert!(terminal.codewide.is_none());
    let programmatic = listed
        .sessions
        .iter()
        .find(|session| session.session_id == OTHER)
        .ok_or("SDK session")?;
    assert!(!programmatic.interactive);

    let first = sessions(root.path())
        .list(NativeSessionListParams {
            cursor: None,
            dir: None,
            limit: 1,
        })
        .await?;
    assert_eq!(first.next_cursor.as_deref(), Some("v1:1"));
    let narrowed = sessions(root.path())
        .list(NativeSessionListParams {
            cursor: None,
            dir: Some("/other".into()),
            limit: 10,
        })
        .await?;
    assert_eq!(narrowed.sessions.len(), 1);
    Ok(())
}

#[tokio::test]
async fn reads_the_active_branch_and_the_running_background_agent()
-> Result<(), Box<dyn std::error::Error>> {
    let root = tempfile::tempdir()?;
    write_store(root.path())?;
    let read = sessions(root.path()).read(SESSION).await?;
    let texts = read
        .turns
        .iter()
        .flat_map(|turn| turn.items.iter())
        .filter_map(|item| match item {
            AgentItem::UserMessage { content, .. } => {
                content.iter().find_map(|block| match block {
                    agent_core::model::UserContent::Text { text } => Some(text.clone()),
                    _ => None,
                })
            }
            AgentItem::AgentMessage { text, .. } => Some(text.clone()),
            _ => None,
        })
        .collect::<Vec<_>>();
    assert_eq!(
        texts,
        ["Check the build", "Started.", "Asked again", "Answer again"]
    );
    let spawn = read.turns[0]
        .items
        .iter()
        .find_map(|item| match item {
            AgentItem::Subagent {
                agent_thread_id,
                status,
                ..
            } => Some((agent_thread_id.clone(), *status)),
            _ => None,
        })
        .ok_or("spawn item")?;
    assert_eq!(
        spawn.0.map(AppThreadId::into_string),
        Some(format!("{SESSION}:agent:agent1"))
    );
    assert_eq!(spawn.1, SubagentStatus::Running);
    assert_eq!(read.subagents.len(), 1);
    assert_eq!(
        read.subagents[0].parent_tool_use_id.as_deref(),
        Some("toolu_spawn")
    );
    assert_eq!(read.subagents[0].turns.len(), 1);
    assert_eq!(read.subagents[0].turns[0].status, TurnStatus::InProgress);
    // Unchanged input reads the same.
    assert_eq!(sessions(root.path()).read(SESSION).await?, read);
    Ok(())
}

#[tokio::test]
async fn a_codewide_threads_session_carries_its_metadata_and_turn_index()
-> Result<(), Box<dyn std::error::Error>> {
    let root = tempfile::tempdir()?;
    write_store(root.path())?;
    write_owner(root.path())?;
    let read = sessions(root.path()).read(SESSION).await?;
    assert_eq!(read.session.app_thread_id.as_str(), "codewide-thread");
    assert_eq!(
        read.session
            .codewide
            .as_ref()
            .map(|codewide| codewide.presence.clone()),
        Some(NativeThreadPresence::Listed { archived: false })
    );
    assert_eq!(read.turns[0].turn_id.as_str(), "turn-first");
    let client = read.turns[0].items.iter().find_map(|item| match item {
        AgentItem::UserMessage {
            client_message_id, ..
        } => client_message_id.clone(),
        _ => None,
    });
    assert_eq!(
        client.map(agent_core::model::ClientMessageId::into_string),
        Some("client-1".into())
    );
    assert_eq!(
        read.subagents[0].turns.first().map(|turn| turn.items.len()),
        Some(2)
    );
    Ok(())
}

#[tokio::test]
async fn an_unknown_session_is_the_protocol_not_found_error()
-> Result<(), Box<dyn std::error::Error>> {
    let root = tempfile::tempdir()?;
    let error = sessions(root.path()).read(SESSION).await.err();
    assert!(matches!(
        error,
        Some(ProviderError::Rejected(RpcError { code, ref message, .. }))
            if code == ERROR_INVALID_REQUEST && message.starts_with("native session not found:")
    ));
    Ok(())
}

/// Compares this reader with the host's reads the live index holds, over the
/// developer's own sessions: `CODEWIDE_PARITY_INDEX` is a copy of the
/// companion's `state.redb`. Run by hand:
/// `CODEWIDE_PARITY_INDEX=/tmp/state.redb cargo test -p agent-provider-claude native_parity -- --ignored --nocapture`.
/// Prints ids and counts only, never content.
#[tokio::test]
#[ignore = "reads the developer's own Claude store and a copy of the live index"]
#[allow(clippy::too_many_lines)] // A manual diagnostic report; it reads top to bottom.
async fn native_parity_with_the_hosts_reads() -> Result<(), Box<dyn std::error::Error>> {
    use redb::{ReadableDatabase, ReadableTable, TableDefinition};
    const SESSIONS: TableDefinition<&str, &[u8]> = TableDefinition::new("claude_sessions");
    const TURNS: TableDefinition<&[u8], &[u8]> = TableDefinition::new("claude_session_turns");

    let index = std::env::var("CODEWIDE_PARITY_INDEX")?;
    let home = std::env::var("HOME")?;
    let reader = LocalSessions::new(
        Path::new(&home).join(".claude/projects"),
        Path::new(&home).join(".local/state/codewide/companion/claude-journal"),
    );
    let database = redb::Database::open(index)?;
    let read = database.begin_read()?;
    let sessions = read.open_table(SESSIONS)?;
    let turns_table = read.open_table(TURNS)?;
    let shape = |turns: &[agent_core::model::AgentTurn]| {
        turns
            .iter()
            .map(|turn| {
                let items = turn
                    .items
                    .iter()
                    .filter(|item| !matches!(item, AgentItem::Reasoning { .. }))
                    .map(|item| {
                        let kind = serde_json::to_value(item)
                            .ok()
                            .and_then(|value| {
                                value
                                    .get("type")
                                    .and_then(Value::as_str)
                                    .map(ToOwned::to_owned)
                            })
                            .unwrap_or_default();
                        format!("{kind}:{}", item.item_id().as_str())
                    })
                    .collect::<Vec<_>>();
                (turn.turn_id.as_str().to_owned(), turn.status, items)
            })
            .collect::<Vec<_>>()
    };
    let (mut same, mut differ, mut missing) = (0, 0, 0);
    for entry in sessions.iter()? {
        let (key, _) = entry?;
        let session_id = key.value().to_owned();
        let mut prefix = session_id.as_bytes().to_vec();
        prefix.push(0);
        let mut end = prefix.clone();
        end.extend_from_slice(&[0xff; 4]);
        let host = turns_table
            .range(prefix.as_slice()..=end.as_slice())?
            .map(
                |row| -> Result<agent_core::model::AgentTurn, Box<dyn std::error::Error>> {
                    Ok(serde_json::from_slice(row?.1.value())?)
                },
            )
            .collect::<Result<Vec<_>, _>>()?;
        let Ok(ours) = reader.read(&session_id).await else {
            missing += 1;
            println!("{session_id}: not read");
            continue;
        };
        let (host, ours) = (shape(&host), shape(&ours.turns));
        if host == ours {
            same += 1;
            continue;
        }
        differ += 1;
        let tail = &ours[ours.len().saturating_sub(host.len().saturating_sub(1))..];
        println!(
            "{session_id}: host's turns after its first are our newest turns: {}",
            host.len() > 1 && host[1..] == *tail
        );
        let first = host
            .iter()
            .zip(&ours)
            .position(|(left, right)| left != right);
        println!(
            "{session_id}: host turns={} ours={} first difference at turn {:?}",
            host.len(),
            ours.len(),
            first
        );
        if let Some(index) = first {
            println!(
                "  host: {:?} {:?} items={}",
                host[index].0,
                host[index].1,
                host[index].2.len()
            );
            println!(
                "  ours: {:?} {:?} items={}",
                ours[index].0,
                ours[index].1,
                ours[index].2.len()
            );
            let item = host[index]
                .2
                .iter()
                .zip(&ours[index].2)
                .position(|(left, right)| left != right);
            println!("  first item difference: {item:?}");
            if let Some(item) = item {
                let from = item.saturating_sub(1);
                println!(
                    "  host items: {:?}",
                    &host[index].2[from..(item + 3).min(host[index].2.len())]
                );
                println!(
                    "  our items:  {:?}",
                    &ours[index].2[from..(item + 3).min(ours[index].2.len())]
                );
            } else {
                println!("  host items: {:?}", host[index].2);
                println!("  our items:  {:?}", ours[index].2);
            }
        }
    }
    println!("same={same} differ={differ} missing={missing}");
    Ok(())
}

/// Times a full read of the largest local session (manual).
#[tokio::test]
#[ignore = "reads the developer's own Claude store"]
async fn time_the_largest_local_session_read() -> Result<(), Box<dyn std::error::Error>> {
    let home = std::env::var("HOME")?;
    let root = Path::new(&home).join(".claude/projects");
    let largest = files::sessions(&root)
        .into_iter()
        .max_by_key(|file| file.size)
        .ok_or("no sessions")?;
    let reader = LocalSessions::new(
        root,
        Path::new(&home).join(".local/state/codewide/companion/claude-journal"),
    );
    let started = std::time::Instant::now();
    let read = reader.read(&largest.session_id).await?;
    println!(
        "bytes={} turns={} subagents={} elapsed_ms={}",
        largest.size,
        read.turns.len(),
        read.subagents.len(),
        started.elapsed().as_millis()
    );
    Ok(())
}
