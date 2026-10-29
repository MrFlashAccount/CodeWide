//! Native session reads over a throwaway Claude store and host journal.

use std::{collections::HashSet, path::Path};

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

fn write_owner(root: &Path, origin: &str) -> Result<(), Box<dyn std::error::Error>> {
    let (_, journal) = fixture_paths(root);
    let directory = journal.join("threads/codewide-thread");
    std::fs::create_dir_all(&directory)?;
    std::fs::write(
        directory.join("state.json"),
        serde_json::to_vec(&json!({
            "appThreadId": "codewide-thread", "createdAt": 1, "cwd": "/work", "origin": origin,
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
    LocalSessions::for_test(projects, journal, HashSet::from([SESSION.to_owned()]))
}

fn stopped_sessions(root: &Path) -> LocalSessions {
    let (projects, journal) = fixture_paths(root);
    LocalSessions::for_test(projects, journal, HashSet::new())
}

fn restarted_sessions(root: &Path, started_at_ms: i64) -> LocalSessions {
    let (projects, journal) = fixture_paths(root);
    LocalSessions::for_test_processes(
        projects,
        journal,
        std::collections::HashMap::from([(
            SESSION.to_owned(),
            RunningProcess::StartedAt(started_at_ms),
        )]),
    )
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
async fn an_unfinished_agent_is_not_running_after_its_session_process_is_gone()
-> Result<(), Box<dyn std::error::Error>> {
    let root = tempfile::tempdir()?;
    write_store(root.path())?;

    let read = stopped_sessions(root.path()).read(SESSION).await?;

    let spawn_status = read.turns[0].items.iter().find_map(|item| match item {
        AgentItem::Subagent { status, .. } => Some(*status),
        _ => None,
    });
    assert_eq!(spawn_status, Some(SubagentStatus::Stopped));
    assert_eq!(read.subagents.len(), 1);
    assert_ne!(
        read.subagents[0].turns.last().map(|turn| turn.status),
        Some(TurnStatus::InProgress)
    );
    Ok(())
}

#[tokio::test]
async fn an_unfinished_agent_from_the_previous_process_generation_is_stopped()
-> Result<(), Box<dyn std::error::Error>> {
    let root = tempfile::tempdir()?;
    write_store(root.path())?;
    let restarted_at = OffsetDateTime::parse("2026-10-01T11:00:00Z", &Rfc3339)?;
    let restarted_at_ms = i64::try_from(restarted_at.unix_timestamp_nanos().div_euclid(1_000_000))?;

    let read = restarted_sessions(root.path(), restarted_at_ms)
        .read(SESSION)
        .await?;

    let spawn_status = read.turns[0].items.iter().find_map(|item| match item {
        AgentItem::Subagent { status, .. } => Some(*status),
        _ => None,
    });
    assert_eq!(spawn_status, Some(SubagentStatus::Stopped));
    assert_ne!(
        read.subagents[0].turns.last().map(|turn| turn.status),
        Some(TurnStatus::InProgress)
    );
    Ok(())
}

#[tokio::test]
async fn an_unfinished_agent_written_by_the_current_process_generation_stays_running()
-> Result<(), Box<dyn std::error::Error>> {
    let root = tempfile::tempdir()?;
    write_store(root.path())?;
    let started_at = OffsetDateTime::parse("2026-10-01T09:00:00Z", &Rfc3339)?;
    let started_at_ms = i64::try_from(started_at.unix_timestamp_nanos().div_euclid(1_000_000))?;

    let read = restarted_sessions(root.path(), started_at_ms)
        .read(SESSION)
        .await?;

    let spawn_status = read.turns[0].items.iter().find_map(|item| match item {
        AgentItem::Subagent { status, .. } => Some(*status),
        _ => None,
    });
    assert_eq!(spawn_status, Some(SubagentStatus::Running));
    assert_eq!(
        read.subagents[0].turns.last().map(|turn| turn.status),
        Some(TurnStatus::InProgress)
    );
    Ok(())
}

#[tokio::test]
async fn subagent_liveness_does_not_depend_on_who_created_the_session()
-> Result<(), Box<dyn std::error::Error>> {
    let root = tempfile::tempdir()?;
    write_store(root.path())?;
    let restarted_at = OffsetDateTime::parse("2026-10-01T11:00:00Z", &Rfc3339)?;
    let restarted_at_ms = i64::try_from(restarted_at.unix_timestamp_nanos().div_euclid(1_000_000))?;

    let external = restarted_sessions(root.path(), restarted_at_ms)
        .read(SESSION)
        .await?;
    write_owner(root.path(), "created")?;
    let codewide = restarted_sessions(root.path(), restarted_at_ms)
        .read(SESSION)
        .await?;

    let state = |read: &NativeSessionReadResult| {
        let spawn = read
            .turns
            .iter()
            .flat_map(|turn| &turn.items)
            .find_map(|item| match item {
                AgentItem::Subagent { status, .. } => Some(*status),
                _ => None,
            });
        let child = read
            .subagents
            .first()
            .and_then(|agent| agent.turns.last())
            .map(|turn| turn.status);
        (spawn, child)
    };
    assert_eq!(state(&external), state(&codewide));
    assert_eq!(
        state(&external),
        (Some(SubagentStatus::Stopped), Some(TurnStatus::Interrupted))
    );
    Ok(())
}

#[tokio::test]
async fn a_codewide_threads_session_carries_its_metadata_and_turn_index()
-> Result<(), Box<dyn std::error::Error>> {
    let root = tempfile::tempdir()?;
    write_store(root.path())?;
    write_owner(root.path(), "discovered")?;
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
        std::sync::Arc::new(crate::runtime::open_elsewhere::OpenElsewhere::new(
            crate::runtime::open_elsewhere::OpenElsewhereDeps {
                running: std::sync::Arc::new(
                    crate::runtime::running_sessions::CliRunningSessions::new(
                        "claude".into(),
                        Vec::new(),
                    ),
                ),
                owns_live: std::sync::Arc::new(|_| false),
                changed: std::sync::Arc::new(|_| {}),
                activity_changed: std::sync::Arc::new(|_| {}),
                poll: std::time::Duration::from_secs(10),
            },
        )),
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
        std::sync::Arc::new(crate::runtime::open_elsewhere::OpenElsewhere::new(
            crate::runtime::open_elsewhere::OpenElsewhereDeps {
                running: std::sync::Arc::new(
                    crate::runtime::running_sessions::CliRunningSessions::new(
                        "claude".into(),
                        Vec::new(),
                    ),
                ),
                owns_live: std::sync::Arc::new(|_| false),
                changed: std::sync::Arc::new(|_| {}),
                activity_changed: std::sync::Arc::new(|_| {}),
                poll: std::time::Duration::from_secs(10),
            },
        )),
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

fn sidechain(
    agent: &str,
    uuid: &str,
    parent: Option<&str>,
    second: u32,
    kind: &str,
    message: &Value,
) -> Value {
    json!({"type": kind, "uuid": uuid, "parentUuid": parent, "timestamp": at(second),
        "isSidechain": true, "agentId": agent, "message": message})
}

fn report(agent: &str, tool_use: &str) -> String {
    format!(
        "<task-notification>\n<task-id>{agent}</task-id>\n<tool-use-id>{tool_use}</tool-use-id>\n<status>completed</status>\n<summary>Agent \"{agent}\" finished</summary>\n</task-notification>"
    )
}

/// A background agent that spawns two background agents of its own. One
/// reports back into its transcript as a queued attachment; the other
/// reports to the main conversation instead.
fn write_nested_store(root: &Path) -> Result<(), Box<dyn std::error::Error>> {
    let (projects, _) = fixture_paths(root);
    let directory = projects.join("-work").join(SESSION).join("subagents");
    std::fs::create_dir_all(&directory)?;
    write_nested_main(&projects.join("-work").join(format!("{SESSION}.jsonl")))?;
    write_outer_agent(&directory)?;
    for (agent, tool_use) in [("inner1", "toolu_inner1"), ("inner2", "toolu_inner2")] {
        write_inner_agent(&directory, agent, tool_use)?;
    }
    Ok(())
}

/// The main conversation: it spawns the outer agent and takes the second inner report.
fn write_nested_main(path: &Path) -> Result<(), Box<dyn std::error::Error>> {
    let session = [
        user("p1", None, 1, &json!("Research it")),
        assistant(
            "a1",
            "p1",
            2,
            &json!([{"type": "tool_use", "id": "toolu_outer", "name": "Agent",
            "input": {"description": "Outer", "prompt": "Research", "run_in_background": true}}]),
        ),
        user(
            "r1",
            Some("a1"),
            3,
            &json!([{"type": "tool_result", "tool_use_id": "toolu_outer",
            "content": "Async agent launched successfully.\nagentId: outer1"}]),
        ),
        assistant(
            "a2",
            "r1",
            4,
            &json!([{"type": "text", "text": "Started."}]),
        ),
        {
            let mut wake = user(
                "w1",
                Some("a2"),
                9,
                &json!(report("inner2", "toolu_inner2")),
            );
            wake["origin"] = json!({"kind": "task-notification"});
            wake
        },
        assistant("a3", "w1", 10, &json!([{"type": "text", "text": "Noted."}])),
    ];
    std::fs::write(path, session.iter().map(row).collect::<String>())?;
    Ok(())
}

/// The outer agent: it spawns both inner agents and takes the first report as an attachment.
fn write_outer_agent(directory: &Path) -> Result<(), Box<dyn std::error::Error>> {
    let spawn = |id: &str, description: &str| {
        json!({"type": "tool_use", "id": id, "name": "Agent",
            "input": {"description": description, "prompt": "Look", "run_in_background": true}})
    };
    let launched = |id: &str, agent: &str| {
        json!([{"type": "tool_result", "tool_use_id": id,
            "content": format!("Async agent launched successfully.\nagentId: {agent}")}])
    };
    let outer = [
        sidechain(
            "outer1",
            "o1",
            None,
            3,
            "user",
            &json!({"role": "user", "content": "Research"}),
        ),
        sidechain(
            "outer1",
            "o2",
            Some("o1"),
            4,
            "assistant",
            &json!({"id": "msg_o2", "role": "assistant", "content": [spawn("toolu_inner1", "Inner one"), spawn("toolu_inner2", "Inner two")]}),
        ),
        sidechain(
            "outer1",
            "o3",
            Some("o2"),
            5,
            "user",
            &json!({"role": "user", "content": launched("toolu_inner1", "inner1")}),
        ),
        sidechain(
            "outer1",
            "o4",
            Some("o3"),
            5,
            "user",
            &json!({"role": "user", "content": launched("toolu_inner2", "inner2")}),
        ),
        json!({"type": "attachment", "uuid": "o5", "parentUuid": "o4", "timestamp": at(6), "isSidechain": true,
            "agentId": "outer1", "attachment": {"type": "queued_command", "commandMode": "task-notification",
                "prompt": report("inner1", "toolu_inner1"), "source_uuid": "src-o5"}}),
        sidechain(
            "outer1",
            "o6",
            Some("o5"),
            7,
            "assistant",
            &json!({"id": "msg_o6", "role": "assistant", "stop_reason": "end_turn", "content": [{"type": "text", "text": "Done."}]}),
        ),
    ];
    std::fs::write(
        directory.join("agent-outer1.jsonl"),
        outer.iter().map(row).collect::<String>(),
    )?;
    std::fs::write(
        directory.join("agent-outer1.meta.json"),
        r#"{"toolUseId":"toolu_outer"}"#,
    )?;
    Ok(())
}

/// An inner agent that finished its only turn.
fn write_inner_agent(
    directory: &Path,
    agent: &str,
    tool_use: &str,
) -> Result<(), Box<dyn std::error::Error>> {
    let transcript = [
        sidechain(
            agent,
            &format!("{agent}-1"),
            None,
            5,
            "user",
            &json!({"role": "user", "content": "Look"}),
        ),
        sidechain(
            agent,
            &format!("{agent}-2"),
            Some(&format!("{agent}-1")),
            6,
            "assistant",
            &json!({"id": format!("msg_{agent}"), "role": "assistant", "stop_reason": "end_turn",
                    "content": [{"type": "text", "text": "Found it."}]}),
        ),
    ];
    std::fs::write(
        directory.join(format!("agent-{agent}.jsonl")),
        transcript.iter().map(row).collect::<String>(),
    )?;
    std::fs::write(
        directory.join(format!("agent-{agent}.meta.json")),
        format!(r#"{{"toolUseId":"{tool_use}","parentAgentId":"outer1"}}"#),
    )?;
    Ok(())
}

#[tokio::test]
async fn a_nested_background_agent_settles_on_a_report_in_any_transcript()
-> Result<(), Box<dyn std::error::Error>> {
    let root = tempfile::tempdir()?;
    write_nested_store(root.path())?;
    let read = sessions(root.path()).read(SESSION).await?;
    let outer = read
        .subagents
        .iter()
        .find(|subagent| subagent.agent_id == "outer1")
        .ok_or("outer agent")?;
    let nested = outer
        .turns
        .iter()
        .flat_map(|turn| turn.items.iter())
        .filter_map(|item| match item {
            AgentItem::Subagent {
                description,
                status,
                ..
            } => Some((description.clone(), *status)),
            _ => None,
        })
        .collect::<Vec<_>>();
    assert_eq!(
        nested,
        [
            ("Inner one".to_owned(), SubagentStatus::Completed),
            ("Inner two".to_owned(), SubagentStatus::Completed),
        ]
    );
    let running = crate::subagents::index(&read)
        .into_iter()
        .filter(|subagent| subagent.running)
        .map(|subagent| subagent.agent_id)
        .collect::<Vec<_>>();
    // The outer agent never reported: only it still works.
    assert_eq!(running, ["outer1"]);
    Ok(())
}

#[tokio::test]
async fn a_report_off_the_active_branch_still_settles_its_nested_agent()
-> Result<(), Box<dyn std::error::Error>> {
    let root = tempfile::tempdir()?;
    write_nested_store(root.path())?;
    // A rewound prompt makes the branch that holds the second inner agent's
    // report (`w1`) an abandoned one, as a compaction does for older rows.
    let (projects, _) = fixture_paths(root.path());
    let main = projects.join("-work").join(format!("{SESSION}.jsonl"));
    let rewound = [
        user("p2", Some("r1"), 20, &json!("Start over")),
        assistant("a4", "p2", 21, &json!([{"type": "text", "text": "Again."}])),
    ];
    let mut stored = std::fs::read_to_string(&main)?;
    stored.extend(rewound.iter().map(row));
    std::fs::write(&main, stored)?;

    let read = sessions(root.path()).read(SESSION).await?;
    let running = crate::subagents::index(&read)
        .into_iter()
        .filter(|subagent| subagent.running)
        .map(|subagent| subagent.agent_id)
        .collect::<Vec<_>>();
    assert_eq!(running, ["outer1"], "a settled nested agent is not running");
    Ok(())
}

fn wake(uuid: &str, parent: &str, second: u32, agent: &str, tool_use: &str) -> Value {
    let mut wake = user(uuid, Some(parent), second, &json!(report(agent, tool_use)));
    wake["origin"] = json!({"kind": "task-notification"});
    wake
}

/// The result of a `SendMessage` call, as Claude stores it.
fn send_result(uuid: &str, parent: &str, second: u32, result: &Value) -> Value {
    let mut row = user(
        uuid,
        Some(parent),
        second,
        &json!([{"type": "tool_result", "tool_use_id": "toolu_send",
            "content": [{"type": "text", "text": result.to_string()}]}]),
    );
    row["toolUseResult"] = result.clone();
    row
}

/// A background agent that finished, then a `SendMessage` call answered with
/// `send`; `ending` are the main conversation's rows after it.
fn write_resumed_store(
    root: &Path,
    send: &Value,
    ending: &[Value],
) -> Result<(), Box<dyn std::error::Error>> {
    let (projects, _) = fixture_paths(root);
    let project = projects.join("-work");
    let directory = project.join(SESSION).join("subagents");
    std::fs::create_dir_all(&directory)?;
    let mut session = vec![
        user("p1", None, 1, &json!("Draft it")),
        assistant(
            "a1",
            "p1",
            2,
            &json!([{"type": "tool_use", "id": "toolu_spawn", "name": "Agent",
            "input": {"description": "Draft", "prompt": "Draft", "run_in_background": true}}]),
        ),
        user(
            "r1",
            Some("a1"),
            3,
            &json!([{"type": "tool_result", "tool_use_id": "toolu_spawn",
            "content": "Async agent launched successfully.\nagentId: agent1"}]),
        ),
        assistant(
            "a2",
            "r1",
            4,
            &json!([{"type": "text", "text": "Started."}]),
        ),
        wake("w1", "a2", 10, "agent1", "toolu_spawn"),
        assistant(
            "a3",
            "w1",
            11,
            &json!([{"type": "tool_use", "id": "toolu_send", "name": "SendMessage",
            "input": {"to": "agent1", "message": "Revise it"}}]),
        ),
        send_result("r2", "a3", 12, send),
        assistant("a4", "r2", 13, &json!([{"type": "text", "text": "Sent."}])),
    ];
    session.extend_from_slice(ending);
    std::fs::write(
        project.join(format!("{SESSION}.jsonl")),
        session.iter().map(row).collect::<String>(),
    )?;
    let agent = [
        sidechain(
            "agent1",
            "s1",
            None,
            3,
            "user",
            &json!({"role": "user", "content": "Draft"}),
        ),
        sidechain(
            "agent1",
            "s2",
            Some("s1"),
            9,
            "assistant",
            &json!({"id": "msg_s2", "role": "assistant", "stop_reason": "end_turn",
                "content": [{"type": "text", "text": "Drafted."}]}),
        ),
        {
            let mut resumed = sidechain(
                "agent1",
                "s3",
                Some("s2"),
                12,
                "user",
                &json!({"role": "user", "content": "Revise it"}),
            );
            resumed["isMeta"] = json!(true);
            resumed["origin"] = json!({"kind": "coordinator"});
            resumed
        },
        sidechain(
            "agent1",
            "s4",
            Some("s3"),
            13,
            "assistant",
            &json!({"id": "msg_s4", "role": "assistant",
                "content": [{"type": "tool_use", "id": "toolu_edit", "name": "Bash", "input": {"command": "edit"}}]}),
        ),
    ];
    std::fs::write(
        directory.join("agent-agent1.jsonl"),
        agent.iter().map(row).collect::<String>(),
    )?;
    std::fs::write(
        directory.join("agent-agent1.meta.json"),
        r#"{"toolUseId":"toolu_spawn"}"#,
    )?;
    Ok(())
}

fn resumed() -> Value {
    json!({"success": true, "message": "Resuming agent agent1", "resumedAgentId": "agent1"})
}

/// The spawning item's status and whether the index lists the agent running.
async fn agent_state(root: &Path) -> Result<(SubagentStatus, bool), Box<dyn std::error::Error>> {
    let read = sessions(root).read(SESSION).await?;
    let status = read
        .turns
        .iter()
        .flat_map(|turn| turn.items.iter())
        .find_map(|item| match item {
            AgentItem::Subagent { status, .. } => Some(*status),
            _ => None,
        })
        .ok_or("spawn item")?;
    let running = crate::subagents::index(&read)
        .iter()
        .any(|subagent| subagent.agent_id == "agent1" && subagent.running);
    Ok((status, running))
}

#[tokio::test]
async fn a_finished_agent_a_message_resumes_works_again_until_that_run_reports()
-> Result<(), Box<dyn std::error::Error>> {
    let root = tempfile::tempdir()?;
    write_resumed_store(root.path(), &resumed(), &[])?;
    assert_eq!(
        agent_state(root.path()).await?,
        (SubagentStatus::Running, true)
    );
    let read = sessions(root.path()).read(SESSION).await?;
    assert_eq!(
        read.subagents[0].turns.last().map(|turn| turn.status),
        Some(TurnStatus::InProgress)
    );

    let finished = tempfile::tempdir()?;
    write_resumed_store(
        finished.path(),
        &resumed(),
        &[wake("w2", "a4", 20, "agent1", "toolu_send")],
    )?;
    assert_eq!(
        agent_state(finished.path()).await?,
        (SubagentStatus::Completed, false)
    );
    Ok(())
}

#[tokio::test]
async fn a_later_finished_resume_supersedes_an_older_unreported_resume()
-> Result<(), Box<dyn std::error::Error>> {
    let root = tempfile::tempdir()?;
    write_resumed_store(
        root.path(),
        &resumed(),
        &[
            assistant(
                "a5",
                "a4",
                20,
                &json!([{"type": "tool_use", "id": "toolu_send2", "name": "SendMessage",
                    "input": {"to": "agent1", "message": "Revise it again"}}]),
            ),
            {
                let mut result = send_result("r3", "a5", 21, &resumed());
                result["message"]["content"][0]["tool_use_id"] = json!("toolu_send2");
                result
            },
            assistant(
                "a6",
                "r3",
                22,
                &json!([{"type": "text", "text": "Sent again."}]),
            ),
            wake("w2", "a6", 30, "agent1", "toolu_send2"),
        ],
    )?;

    assert_eq!(
        agent_state(root.path()).await?,
        (SubagentStatus::Completed, false)
    );
    Ok(())
}

#[tokio::test]
async fn a_message_that_resumes_no_agent_leaves_a_finished_agent_finished()
-> Result<(), Box<dyn std::error::Error>> {
    for send in [
        json!({"success": true, "message": "Message queued for delivery to agent1"}),
        json!({"success": false, "message": "Agent agent1 was stopped by the user"}),
    ] {
        let root = tempfile::tempdir()?;
        write_resumed_store(root.path(), &send, &[])?;
        assert_eq!(
            agent_state(root.path()).await?,
            (SubagentStatus::Completed, false)
        );
    }
    Ok(())
}
