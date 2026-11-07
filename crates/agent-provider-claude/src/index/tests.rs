//! The session index over Claude's own files, observed through what it
//! serves: pages of turns, child threads, search hits and what an index pass
//! reports as read again or gone.

use agent_core::model::{
    AgentItem, AppThreadId, ItemsView, SortDirection, TurnOrigin, UserContent,
};
use serde_json::{Value, json};

use super::history::PageRequest;
use crate::{
    search::ClaudeSearch,
    test_support::{StoreFixture, session_id, timestamp},
};

const CWD: &str = "/work";

fn request(cursor: Option<&str>, limit: u32, direction: SortDirection) -> PageRequest<'_> {
    PageRequest {
        cursor,
        limit,
        direction,
        view: ItemsView::Full,
    }
}

/// Turn ids, each with its messages' text.
type Transcript = Vec<(String, Vec<String>)>;

/// Every turn of the thread, oldest first: its id and its messages' text.
fn transcript(
    fixture: &StoreFixture,
    thread: &str,
) -> Result<Transcript, Box<dyn std::error::Error>> {
    let page = fixture
        .history
        .page(
            &AppThreadId::parse(thread).ok_or("thread id")?,
            &request(None, 200, SortDirection::Asc),
        )?
        .ok_or("indexed thread")?;
    Ok(page
        .turns
        .iter()
        .map(|turn| {
            (
                turn.turn_id.as_str().to_owned(),
                turn.items
                    .iter()
                    .filter_map(|item| match item {
                        AgentItem::UserMessage { content, .. } => {
                            content.iter().find_map(|part| match part {
                                UserContent::Text { text } => Some(text.clone()),
                                UserContent::Image { .. } | UserContent::LocalImage { .. } => None,
                            })
                        }
                        AgentItem::AgentMessage { text, .. } => Some(text.clone()),
                        AgentItem::Compaction { .. } => Some("[compaction]".to_owned()),
                        _ => None,
                    })
                    .collect(),
            )
        })
        .collect())
}

fn turn(id: &str, messages: &[&str]) -> (String, Vec<String>) {
    (
        id.to_owned(),
        messages
            .iter()
            .map(|message| (*message).to_owned())
            .collect(),
    )
}

async fn hits(search: &ClaudeSearch, text: &str) -> Result<Vec<Value>, Box<dyn std::error::Error>> {
    use agent_core::provider::StoredMessageSearch as _;
    let page = search.search(&json!({"query": text})).await?;
    Ok(page["data"].as_array().cloned().unwrap_or_default())
}

#[tokio::test]
async fn an_appended_turn_reads_only_the_turns_whose_range_moved()
-> Result<(), Box<dyn std::error::Error>> {
    let fixture = StoreFixture::new()?;
    let session = session_id(1);
    fixture.exchange(&session, CWD, 1, &["one", "two"])?;
    let first = fixture.index(&session)?;
    assert_eq!(first.changed.len(), 2);
    let one = format!("{session}-one");
    let two = format!("{session}-two");
    let three = format!("{session}-three");

    fixture.exchange(&session, CWD, 10, &["three"])?;
    let appended = fixture.index(&session)?;
    // The open turn's range ended; the new one began. `one` was not read.
    let read = appended
        .changed
        .iter()
        .map(|changed| changed.turn.turn_id.as_str())
        .collect::<Vec<_>>();
    assert_eq!(read, [two.as_str(), three.as_str()]);
    assert!(appended.removed.is_empty());
    assert_eq!(
        transcript(&fixture, &session)?,
        [
            turn(&one, &["one", "answer to one"]),
            turn(&two, &["two", "answer to two"]),
            turn(&three, &["three", "answer to three"]),
        ]
    );
    // Unchanged files read nothing.
    assert!(!fixture.index(&session)?.written());

    // Earlier documents stay; the appended turn is searchable.
    let threes = hits(&fixture.search, "three").await?;
    assert!(threes.iter().any(|hit| hit["turnId"] == three.as_str()));
    let ones = hits(&fixture.search, "one").await?;
    assert!(ones.iter().any(|hit| hit["turnId"] == one.as_str()));
    Ok(())
}

#[tokio::test]
async fn a_rewound_prompt_drops_the_turns_after_the_message_it_returns_to()
-> Result<(), Box<dyn std::error::Error>> {
    let fixture = StoreFixture::new()?;
    let session = session_id(2);
    fixture.exchange(&session, CWD, 1, &["one", "abandoned"])?;
    fixture.index(&session)?;
    let one = format!("{session}-one");
    // The person rewound to the first answer and asked again.
    fixture.append(
        &session,
        CWD,
        &[
            json!({"type": "user", "uuid": "again", "parentUuid": format!("{one}-answer"),
                "timestamp": timestamp(20), "sessionId": session, "cwd": CWD, "isSidechain": false,
                "message": {"role": "user", "content": "asked again"}}),
            json!({"type": "assistant", "uuid": "again-answer", "parentUuid": "again",
                "timestamp": timestamp(21), "sessionId": session, "cwd": CWD, "isSidechain": false,
                "message": {"id": "msg_again", "model": "claude-opus-5-5", "role": "assistant",
                    "content": [{"type": "text", "text": "answered again"}]}}),
        ],
    )?;
    let rewound = fixture.index(&session)?;
    assert_eq!(rewound.removed, [format!("{session}-abandoned")]);
    assert_eq!(
        transcript(&fixture, &session)?,
        [
            turn(&one, &["one", "answer to one"]),
            turn("again", &["asked again", "answered again"]),
        ]
    );
    assert!(hits(&fixture.search, "abandoned").await?.is_empty());
    Ok(())
}

#[tokio::test]
async fn a_compaction_is_an_item_of_the_turn_it_ran_in() -> Result<(), Box<dyn std::error::Error>> {
    let fixture = StoreFixture::new()?;
    let session = session_id(3);
    fixture.exchange(&session, CWD, 1, &["long task"])?;
    let answer = format!("{session}-long task-answer");
    fixture.append(
        &session,
        CWD,
        &[
            json!({"type": "system", "subtype": "compact_boundary", "uuid": "boundary",
                "parentUuid": null, "logicalParentUuid": answer, "timestamp": timestamp(5),
                "sessionId": session, "cwd": CWD, "isSidechain": false,
                "compactMetadata": {"trigger": "auto", "preservedMessages": {"anchorUuid": "summary", "uuids": [answer]}}}),
            json!({"type": "user", "uuid": "summary", "parentUuid": "boundary", "isCompactSummary": true,
                "timestamp": timestamp(6), "sessionId": session, "cwd": CWD, "isSidechain": false,
                "message": {"role": "user", "content": "This session is being continued"}}),
            json!({"type": "assistant", "uuid": "after", "parentUuid": answer,
                "timestamp": timestamp(7), "sessionId": session, "cwd": CWD, "isSidechain": false,
                "message": {"id": "msg_after", "model": "claude-opus-5-5", "role": "assistant",
                    "content": [{"type": "text", "text": "continued"}]}}),
        ],
    )?;
    fixture.index(&session)?;
    // The preserved answer stays where it was written; the continuation
    // after the summary is no rewind.
    assert_eq!(
        transcript(&fixture, &session)?,
        [turn(
            &format!("{session}-long task"),
            &[
                "long task",
                "answer to long task",
                "[compaction]",
                "continued"
            ]
        )]
    );
    Ok(())
}

/// A `CodeWide` thread owning `sessions`, with these turn records.
fn write_owner(
    fixture: &StoreFixture,
    thread: &str,
    sessions: &[&str],
    turns: &Value,
) -> Result<(), Box<dyn std::error::Error>> {
    let directory = fixture.journal().join("threads").join(thread);
    std::fs::create_dir_all(&directory)?;
    std::fs::write(
        directory.join("state.json"),
        serde_json::to_vec(&json!({
            "appThreadId": thread, "createdAt": 1, "cwd": CWD, "origin": "created",
            "pendingSettings": null, "presence": {"type": "listed", "archived": false}, "recencyAt": null,
            "sessionIds": sessions, "sessionStarted": true,
            "settings": {"model": "opus", "effort": null, "permissionProfile": ":workspace", "serviceTier": null},
            "title": {"type": "none"},
            "totalUsage": {"inputTokens": 0, "cachedInputTokens": 0, "outputTokens": 0,
                "reasoningOutputTokens": 0, "totalTokens": 0},
            "turns": turns, "updatedAt": 9, "version": 2
        }))?,
    )?;
    Ok(())
}

fn user_record(turn_id: &str, prompt_uuid: &str) -> Value {
    json!({"anchors": [prompt_uuid], "completedAt": 9, "origin": "user",
        "outcome": {"status": "completed"},
        "prompts": [{"clientMessageId": null, "role": "first", "uuid": prompt_uuid}],
        "startedAt": 1, "turnId": turn_id, "usage": null})
}

#[tokio::test]
async fn a_turn_index_hint_that_arrives_after_its_record_moves_the_turn_boundary()
-> Result<(), Box<dyn std::error::Error>> {
    let fixture = StoreFixture::new()?;
    let session = session_id(4);
    let thread = "codewide-thread";
    let prompt = format!("{session}-start");
    write_owner(
        &fixture,
        thread,
        &[&session],
        &json!([user_record("turn-1", &prompt)]),
    )?;
    fixture.exchange(&session, CWD, 1, &["start"])?;
    // The companion woke Claude for a provider turn; its first frame is
    // stored before the companion records it.
    fixture.append(
        &session,
        CWD,
        &[
            json!({"type": "assistant", "uuid": "woken", "parentUuid": format!("{prompt}-answer"),
            "timestamp": timestamp(5), "sessionId": session, "cwd": CWD, "isSidechain": false,
            "message": {"id": "msg_woken", "model": "claude-opus-5-5", "role": "assistant",
                "content": [{"type": "text", "text": "woken answer"}]}}),
        ],
    )?;
    fixture.index(&session)?;
    assert_eq!(
        transcript(&fixture, thread)?,
        [turn(
            "turn-1",
            &["start", "answer to start", "woken answer"]
        )]
    );

    write_owner(
        &fixture,
        thread,
        &[&session],
        &json!([user_record("turn-1", &prompt), {"anchors": ["woken"], "completedAt": 9,
            "origin": "provider", "outcome": {"status": "completed"}, "prompts": [],
            "startedAt": 5, "turnId": "turn-2", "usage": null}]),
    )?;
    let repaired = fixture.index(&session)?;
    assert!(repaired.written());
    assert_eq!(
        transcript(&fixture, thread)?,
        [
            turn("turn-1", &["start", "answer to start"]),
            turn("turn-2", &["woken answer"]),
        ]
    );
    let page = fixture
        .history
        .page(
            &AppThreadId::from_static("codewide-thread"),
            &request(None, 10, SortDirection::Asc),
        )?
        .ok_or("indexed thread")?;
    assert_eq!(page.turns[1].origin, TurnOrigin::Provider);
    Ok(())
}

#[tokio::test]
async fn a_rewritten_session_file_is_indexed_again_from_its_first_byte()
-> Result<(), Box<dyn std::error::Error>> {
    let fixture = StoreFixture::new()?;
    let session = session_id(5);
    fixture.exchange(&session, CWD, 1, &["first draft"])?;
    fixture.index(&session)?;
    std::fs::remove_file(fixture.path(&session, CWD))?;
    fixture.exchange(&session, CWD, 1, &["rewritten"])?;
    let rewritten = fixture.index(&session)?;
    assert_eq!(rewritten.removed, [format!("{session}-first draft")]);
    assert_eq!(
        transcript(&fixture, &session)?,
        [turn(
            &format!("{session}-rewritten"),
            &["rewritten", "answer to rewritten"]
        )]
    );
    assert!(hits(&fixture.search, "draft").await?.is_empty());
    Ok(())
}

#[tokio::test]
async fn a_sub_agent_transcript_that_appears_later_becomes_a_child_thread()
-> Result<(), Box<dyn std::error::Error>> {
    let fixture = StoreFixture::new()?;
    let session = session_id(6);
    fixture.append(
        &session,
        CWD,
        &[
            json!({"type": "user", "uuid": "p1", "parentUuid": null, "timestamp": timestamp(1),
                "sessionId": session, "cwd": CWD, "entrypoint": "cli", "isSidechain": false,
                "message": {"role": "user", "content": "check the build"}}),
            json!({"type": "assistant", "uuid": "a1", "parentUuid": "p1", "timestamp": timestamp(2),
                "sessionId": session, "cwd": CWD, "isSidechain": false,
                "message": {"id": "msg_a1", "model": "claude-opus-5-5", "role": "assistant",
                    "content": [{"type": "tool_use", "id": "toolu_spawn", "name": "Agent",
                        "input": {"description": "Build", "prompt": "Run the build", "subagent_type": "Explore"}}]}}),
        ],
    )?;
    fixture.index(&session)?;
    assert!(
        fixture
            .store
            .session(&session)?
            .ok_or("stored")?
            .subagents
            .is_empty()
    );

    let directory = fixture
        .path(&session, CWD)
        .with_extension("")
        .join("subagents");
    std::fs::create_dir_all(&directory)?;
    std::fs::write(
        directory.join("agent-agent1.meta.json"),
        r#"{"toolUseId":"toolu_spawn","agentType":"Explore"}"#,
    )?;
    std::fs::write(
        directory.join("agent-agent1.jsonl"),
        [
            json!({"type": "user", "uuid": "s1", "parentUuid": null, "timestamp": timestamp(3),
                "isSidechain": true, "agentId": "agent1", "message": {"role": "user", "content": "Run the build"}}),
            json!({"type": "assistant", "uuid": "s2", "parentUuid": "s1", "timestamp": timestamp(4),
                "isSidechain": true, "agentId": "agent1", "message": {"id": "msg_s2", "model": "claude-haiku-4-5",
                    "role": "assistant", "content": [{"type": "text", "text": "Build passes"}]}}),
        ]
        .iter()
        .fold(String::new(), |mut rows, row| {
            rows.push_str(&row.to_string());
            rows.push('\n');
            rows
        }),
    )?;
    let changes = fixture.index(&session)?;
    let agent = changes.stored.subagents.first().ok_or("sub-agent")?;
    assert_eq!(agent.description.as_deref(), Some("Build"));
    assert_eq!(agent.model.as_deref(), Some("claude-haiku-4-5"));
    let child_id = AppThreadId::parse(&format!("{session}:agent:agent1")).ok_or("child id")?;
    // The companion thread index lists the child under its parent.
    assert_eq!(fixture.threads.cwd(&session).as_deref(), Some(CWD));
    let row = fixture
        .threads
        .metadata(child_id.as_str())
        .ok_or("child row")?;
    assert_eq!(row.parent_thread_id.as_deref(), Some(session.as_str()));
    assert_eq!(row.agent_nickname.as_deref(), Some("Build"));
    let child = fixture.history.child(&child_id)?.ok_or("child thread")?;
    assert_eq!(child.preview.as_deref(), Some("Build passes"));
    let page = fixture
        .history
        .child_page(&child, &request(None, 10, SortDirection::Asc))?;
    assert_eq!(page.turns.len(), 1);
    assert_eq!(page.turns[0].turn_id.as_str(), "s1");
    Ok(())
}

#[tokio::test]
async fn pages_follow_cursors_across_a_session_chain_and_the_later_share_wins()
-> Result<(), Box<dyn std::error::Error>> {
    let fixture = StoreFixture::new()?;
    let (lost, replacement) = (session_id(7), session_id(8));
    let thread = "chain-thread";
    write_owner(&fixture, thread, &[&lost, &replacement], &json!([]))?;
    fixture.exchange(&lost, CWD, 1, &["one", "two"])?;
    // The replacement session repeats the interrupted turn under its id.
    fixture.append(
        &replacement,
        CWD,
        &[
            json!({"type": "user", "uuid": format!("{lost}-two"), "parentUuid": null,
            "timestamp": timestamp(30), "sessionId": replacement, "cwd": CWD, "isSidechain": false,
            "message": {"role": "user", "content": "two again"}}),
        ],
    )?;
    fixture.exchange(&replacement, CWD, 31, &["three"])?;
    fixture.index(&lost)?;
    fixture.index(&replacement)?;
    let thread_id = AppThreadId::from_static("chain-thread");
    let mut ascending = Vec::new();
    let mut cursor = None::<String>;
    loop {
        let page = fixture
            .history
            .page(
                &thread_id,
                &request(cursor.as_deref(), 1, SortDirection::Asc),
            )?
            .ok_or("indexed thread")?;
        ascending.extend(
            page.turns
                .iter()
                .map(|turn| turn.turn_id.as_str().to_owned()),
        );
        match page.next_cursor {
            Some(next) => cursor = Some(next),
            None => break,
        }
    }
    let expected = [
        format!("{lost}-one"),
        format!("{lost}-two"),
        format!("{replacement}-three"),
    ];
    assert_eq!(ascending, expected);
    let newest = fixture
        .history
        .page(&thread_id, &request(None, 2, SortDirection::Desc))?
        .ok_or("indexed thread")?;
    assert_eq!(
        newest
            .turns
            .iter()
            .map(|turn| turn.turn_id.as_str())
            .collect::<Vec<_>>(),
        [expected[2].as_str(), expected[1].as_str()]
    );
    // The repeated turn is the replacement's.
    assert_eq!(
        newest.turns[1].items.iter().find_map(|item| match item {
            AgentItem::UserMessage { content, .. } => content.first().cloned(),
            _ => None,
        }),
        Some(UserContent::Text {
            text: "two again".into()
        })
    );
    let unknown = fixture
        .history
        .page(&thread_id, &request(Some("missing"), 1, SortDirection::Asc))
        .err()
        .map(|error| error.to_string());
    assert_eq!(unknown.as_deref(), Some("invalid turns cursor"));
    Ok(())
}

#[test]
fn a_logic_version_change_rebuilds_only_claude_tables() -> Result<(), Box<dyn std::error::Error>> {
    use companion_host::index::{META, logic_version};
    use redb::{ReadableDatabase, TableDefinition};
    const COMPANION: TableDefinition<&str, u64> = TableDefinition::new("companion_table");
    const RETIRED: TableDefinition<&[u8], &[u8]> = TableDefinition::new("claude_session_turns");
    let directory = tempfile::tempdir()?;
    let path = directory.path().join("index.redb");
    {
        let database = companion_host::database::open(&path, "test")?;
        let write = database.begin_write()?;
        write.open_table(COMPANION)?.insert("kept", 7)?;
        write
            .open_table(RETIRED)?
            .insert(b"turn".as_slice(), b"copy".as_slice())?;
        write
            .open_table(META)?
            .insert("claude_index_logic_version", 16)?;
        write.commit()?;
    }
    let database = companion_host::database::open(&path, "test")?;
    let store = crate::store::ClaudeStore::attach(
        database.clone(),
        std::sync::Arc::new(crate::test_support::MemoryThreadIndex::default()),
    )?;
    assert!(store.session_ids()?.is_empty());
    let read = database.begin_read()?;
    assert_eq!(
        read.open_table(COMPANION)?
            .get("kept")?
            .map(|row| row.value()),
        Some(7)
    );
    assert!(
        read.open_table(RETIRED).is_err(),
        "the turn copies are dropped"
    );
    assert_eq!(
        logic_version(&read, "claude_index_logic_version")?,
        Some(crate::store::CLAUDE_INDEX_LOGIC_VERSION)
    );
    Ok(())
}

/// A session whose turn was interrupted, then woken by a task report while
/// idle, then given a prompt Claude queued (a `queued_command`
/// attachment); `next` follows.
fn woken_then_queued(
    fixture: &StoreFixture,
    session: &str,
    next: &Value,
) -> Result<(), Box<dyn std::error::Error>> {
    fixture.exchange(session, CWD, 1, &["start"])?;
    let report = "<task-notification>\n<task-id>b1</task-id>\n<status>completed</status>\n<summary>Build finished</summary>\n</task-notification>";
    fixture.append(
        session,
        CWD,
        &[
            json!({"type": "user", "uuid": "marker", "parentUuid": format!("{session}-start-answer"),
                "timestamp": timestamp(4), "sessionId": session, "cwd": CWD, "isSidechain": false,
                "message": {"role": "user", "content": [{"type": "text", "text": "[Request interrupted by user]"}]}}),
            json!({"type": "user", "uuid": "wake", "parentUuid": "marker", "origin": {"kind": "task-notification"},
                "timestamp": timestamp(5), "sessionId": session, "cwd": CWD, "isSidechain": false,
                "message": {"role": "user", "content": report}}),
            json!({"type": "attachment", "uuid": "queued", "parentUuid": "wake", "timestamp": timestamp(6),
                "sessionId": session, "cwd": CWD, "isSidechain": false,
                "attachment": {"type": "queued_command", "prompt": "queued question", "source_uuid": "queued-source"}}),
            next.clone(),
        ],
    )?;
    Ok(())
}

fn kinds(turn: &agent_core::model::AgentTurn) -> Vec<String> {
    turn.items
        .iter()
        .filter_map(|item| {
            serde_json::to_value(item)
                .ok()
                .and_then(|value| value["type"].as_str().map(ToOwned::to_owned))
        })
        .collect()
}

#[tokio::test]
async fn an_undelivered_queued_prompt_leaves_the_woken_turn_to_the_next_prompt()
-> Result<(), Box<dyn std::error::Error>> {
    let fixture = StoreFixture::new()?;
    let session = session_id(9);
    // The person sent a message of their own: Claude dropped the queued one.
    woken_then_queued(
        &fixture,
        &session,
        &json!({"type": "user", "uuid": "typed", "parentUuid": "queued", "timestamp": timestamp(7),
            "sessionId": session, "cwd": CWD, "isSidechain": false,
            "message": {"role": "user", "content": "typed instead"}}),
    )?;
    fixture.index(&session)?;
    let page = fixture
        .history
        .page(
            &AppThreadId::parse(&session).ok_or("thread id")?,
            &request(None, 10, SortDirection::Asc),
        )?
        .ok_or("indexed")?;
    let last = page.turns.last().ok_or("turns")?;
    assert_eq!(last.turn_id.as_str(), "typed");
    assert_eq!(kinds(last), ["userMessage", "taskNotification"]);
    assert_eq!(page.turns.len(), 2, "no turn for the dropped prompt");
    Ok(())
}

#[tokio::test]
async fn a_delivered_queued_prompt_joins_the_turn_its_wakes_opened()
-> Result<(), Box<dyn std::error::Error>> {
    let fixture = StoreFixture::new()?;
    let session = session_id(10);
    woken_then_queued(
        &fixture,
        &session,
        &json!({"type": "assistant", "uuid": "reply", "parentUuid": "queued", "timestamp": timestamp(7),
            "sessionId": session, "cwd": CWD, "isSidechain": false,
            "message": {"id": "msg_reply", "model": "claude-opus-5-5", "role": "assistant",
                "content": [{"type": "text", "text": "answered the queue"}]}}),
    )?;
    fixture.index(&session)?;
    let page = fixture
        .history
        .page(
            &AppThreadId::parse(&session).ok_or("thread id")?,
            &request(None, 10, SortDirection::Asc),
        )?
        .ok_or("indexed")?;
    let last = page.turns.last().ok_or("turns")?;
    assert_eq!(last.turn_id.as_str(), "queued-source");
    assert_eq!(
        kinds(last),
        ["taskNotification", "userMessage", "agentMessage"]
    );
    Ok(())
}

/// A rewind the `claude` CLI 2.1.310 wrote itself (`--resume <session>
/// --resume-session-at <first answer>`), sanitized: two turns, then a
/// prompt appended to the same file whose `parentUuid` is the first answer.
#[tokio::test]
async fn a_rewind_the_cli_wrote_drops_the_turn_it_returned_past()
-> Result<(), Box<dyn std::error::Error>> {
    let fixture = StoreFixture::new()?;
    let session = "11111111-1111-4111-8111-111111111111";
    let rows = include_str!("../../fixtures/raw/rewind-resume-session-at.jsonl")
        .lines()
        .map(serde_json::from_str::<Value>)
        .collect::<Result<Vec<_>, _>>()?;
    // The first two turns, as indexed before the rewind.
    let rewind = rows
        .iter()
        .position(|row| row["message"]["content"] == "Reply with exactly: C3")
        .ok_or("the rewound prompt")?;
    fixture.append(session, CWD, &rows[..rewind])?;
    fixture.index(session)?;
    assert_eq!(
        transcript(&fixture, session)?
            .into_iter()
            .map(|(_, messages)| messages)
            .collect::<Vec<_>>(),
        [
            vec!["Reply with exactly: A1".to_owned(), "A1".to_owned()],
            vec!["Reply with exactly: B2".to_owned(), "B2".to_owned()],
        ]
    );
    fixture.append(session, CWD, &rows[rewind..])?;
    let rewound = fixture.index(session)?;
    assert_eq!(rewound.removed.len(), 1, "the abandoned turn is gone");
    assert_eq!(
        transcript(&fixture, session)?
            .into_iter()
            .map(|(_, messages)| messages)
            .collect::<Vec<_>>(),
        [
            vec!["Reply with exactly: A1".to_owned(), "A1".to_owned()],
            vec!["Reply with exactly: C3".to_owned(), "C3".to_owned()],
        ]
    );
    // Claude's own branch rule (the newest leaf walked back through
    // `parentUuid`) keeps the same turns.
    let branch = crate::transcript::chain::active_branch(&rows);
    let messages = branch.iter().map(AsRef::as_ref).collect::<Vec<_>>();
    let rebuilt = crate::transcript::reconstruct::reconstruct_turns(
        &messages,
        &[],
        &crate::transcript::reconstruct::HistoryContext {
            app_thread_id: AppThreadId::from_static("rewind"),
            cwd: CWD.into(),
        },
    );
    let page = fixture
        .history
        .page(
            &AppThreadId::parse(session).ok_or("thread id")?,
            &request(None, 10, SortDirection::Asc),
        )?
        .ok_or("indexed")?;
    assert_eq!(
        rebuilt
            .iter()
            .map(|turn| turn.turn_id.as_str())
            .collect::<Vec<_>>(),
        page.turns
            .iter()
            .map(|turn| turn.turn_id.as_str())
            .collect::<Vec<_>>()
    );
    Ok(())
}

/// A task report is a fact about a process, not part of a conversation:
/// Claude's rewind returns the conversation, not the background agent, so
/// a report stored on the branch the person rewound past still ends the
/// agent the kept turn launched.
#[tokio::test]
async fn a_report_on_a_rewound_branch_still_ends_the_agent_a_kept_turn_launched()
-> Result<(), Box<dyn std::error::Error>> {
    let fixture = StoreFixture::new()?;
    let session = session_id(11);
    let row = |kind: &str, uuid: &str, parent: Option<&str>, second: u32, message: Value| {
        json!({"type": kind, "uuid": uuid, "parentUuid": parent, "timestamp": timestamp(second),
            "sessionId": session, "cwd": CWD, "isSidechain": false, "message": message})
    };
    let report = "<task-notification>\n<task-id>agent1</task-id>\n<tool-use-id>toolu_spawn</tool-use-id>\n<status>completed</status>\n<summary>Agent \"Build\" finished</summary>\n</task-notification>";
    let mut launched = row(
        "user",
        "r1",
        Some("a1"),
        3,
        json!({"role": "user",
        "content": [{"type": "tool_result", "tool_use_id": "toolu_spawn",
            "content": "Async agent launched successfully.\nagentId: agent1"}]}),
    );
    launched["toolUseResult"] = json!({"isAsync": true, "agentId": "agent1"});
    let mut woken = row(
        "user",
        "w1",
        Some("a3"),
        7,
        json!({"role": "user", "content": report}),
    );
    woken["origin"] = json!({"kind": "task-notification"});
    fixture.append(
        &session,
        CWD,
        &[
            row("user", "p1", None, 1, json!({"role": "user", "content": "build it"})),
            row("assistant", "a1", Some("p1"), 2, json!({"id": "msg_a1", "role": "assistant",
                "content": [{"type": "tool_use", "id": "toolu_spawn", "name": "Agent",
                    "input": {"description": "Build", "prompt": "Run the build", "run_in_background": true}}]})),
            launched,
            row("assistant", "a2", Some("r1"), 4, json!({"id": "msg_a2", "role": "assistant",
                "content": [{"type": "text", "text": "Started."}]})),
            row("user", "p2", Some("a2"), 5, json!({"role": "user", "content": "abandoned"})),
            row("assistant", "a3", Some("p2"), 6, json!({"id": "msg_a3", "role": "assistant",
                "content": [{"type": "text", "text": "abandoned answer"}]})),
            woken,
            // The person rewinds to the first turn's answer.
            row("user", "p3", Some("a2"), 8, json!({"role": "user", "content": "asked again"})),
        ],
    )?;
    fixture.index(&session)?;
    let page = fixture
        .history
        .page(
            &AppThreadId::parse(&session).ok_or("thread id")?,
            &request(None, 10, SortDirection::Asc),
        )?
        .ok_or("indexed")?;
    assert_eq!(
        page.turns
            .iter()
            .map(|turn| turn.turn_id.as_str())
            .collect::<Vec<_>>(),
        ["p1", "p3"]
    );
    let status = page.turns[0].items.iter().find_map(|item| match item {
        AgentItem::Subagent { status, .. } => Some(*status),
        _ => None,
    });
    assert_eq!(status, Some(agent_core::model::SubagentStatus::Completed));
    Ok(())
}

#[tokio::test]
async fn a_session_that_joins_its_chain_before_earlier_indexed_ones_keeps_search_order()
-> Result<(), Box<dyn std::error::Error>> {
    use agent_core::provider::StoredMessageSearch as _;
    let fixture = StoreFixture::new()?;
    let (early, late) = (session_id(12), session_id(13));
    let thread = "joined-thread";
    write_owner(&fixture, thread, &[&late], &json!([]))?;
    fixture.exchange(&late, CWD, 40, &["later words"])?;
    fixture.index(&late)?;
    // An older session of the thread is found later (it starts first).
    write_owner(&fixture, thread, &[&early, &late], &json!([]))?;
    fixture.exchange(&early, CWD, 1, &["earlier words"])?;
    fixture.index(&early)?;

    let hit = fixture.search.search(&json!({"query": "later"})).await?["data"]
        .as_array()
        .and_then(|hits| {
            hits.iter()
                .find(|hit| hit["kind"] == "user_message")
                .cloned()
        })
        .ok_or("hit")?;
    let around = fixture
        .search
        .context(&json!({"threadId": thread, "messageId": hit["messageId"], "direction": "around"}))
        .await?;
    let texts = around["messages"]
        .as_array()
        .ok_or("messages")?
        .iter()
        .filter_map(|message| message["text"].as_str())
        .collect::<Vec<_>>();
    assert_eq!(
        texts,
        [
            "earlier words",
            "answer to earlier words",
            "later words",
            "answer to later words"
        ]
    );
    Ok(())
}
