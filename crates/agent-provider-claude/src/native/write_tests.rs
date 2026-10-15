//! Writes to a throwaway Claude store: rename, removal and fork, read back
//! through the native reads.

use std::{
    collections::HashSet,
    path::{Path, PathBuf},
};

use agent_core::model::{AgentItem, NativeSessionListParams, UserContent};
use serde_json::{Value, json};

use super::{
    LocalSessions, files, fixture_paths, meta,
    write::{self, ForkError, Removal, RenameError, SessionLocation},
};
use crate::{
    indexer::NativeSessions,
    transcript::{chain::active_branch, json::str_of},
};

const SESSION: &str = "11111111-1111-4111-8111-111111111111";
const OTHER: &str = "22222222-2222-4222-8222-222222222222";
const UNKNOWN: &str = "33333333-3333-4333-8333-333333333333";
/// A working directory that does not exist, so its project is `-work`.
const CWD: &str = "/codewide-test-missing/work";

type TestResult = Result<(), Box<dyn std::error::Error>>;

fn at(second: u32) -> String {
    format!("2026-10-01T10:00:{second:02}.000Z")
}

fn user(uuid: &str, parent: Option<&str>, second: u32, text: &str) -> Value {
    json!({"type": "user", "uuid": uuid, "parentUuid": parent, "timestamp": at(second),
        "sessionId": SESSION, "cwd": CWD, "entrypoint": "cli", "isSidechain": false,
        "message": {"role": "user", "content": text}})
}

fn assistant(uuid: &str, parent: &str, second: u32, text: &str) -> Value {
    json!({"type": "assistant", "uuid": uuid, "parentUuid": parent, "timestamp": at(second),
        "sessionId": SESSION, "cwd": CWD, "isSidechain": false,
        "message": {"id": format!("msg_{uuid}"), "model": "claude-opus-5-5", "role": "assistant",
            "content": [{"type": "text", "text": text}]}})
}

fn project(root: &Path) -> PathBuf {
    fixture_paths(root).0.join(write::project_dir_name(CWD))
}

fn write_session(root: &Path, id: &str, rows: &[Value]) -> Result<PathBuf, std::io::Error> {
    let directory = project(root);
    std::fs::create_dir_all(&directory)?;
    let path = directory.join(format!("{id}.jsonl"));
    let text = rows.iter().fold(String::new(), |mut text, row| {
        text.push_str(&row.to_string());
        text.push('\n');
        text
    });
    std::fs::write(&path, text)?;
    Ok(path)
}

fn located(id: &str) -> SessionLocation<'_> {
    SessionLocation {
        session_id: id,
        cwd: Some(Path::new(CWD)),
    }
}

fn projects(root: &Path) -> PathBuf {
    fixture_paths(root).0
}

fn local(root: &Path) -> LocalSessions {
    let (projects, journal) = fixture_paths(root);
    LocalSessions::new(projects, journal)
}

/// The stored rows of a session, as objects.
fn stored(path: &Path) -> Result<Vec<serde_json::Map<String, Value>>, std::io::Error> {
    Ok(files::rows(path)?
        .into_iter()
        .filter_map(|row| match row {
            Value::Object(row) => Some(row),
            _ => None,
        })
        .collect())
}

/// The source uuids of a fork's active branch.
fn forked_branch(path: &Path) -> Result<Vec<String>, std::io::Error> {
    let rows = files::rows(path)?;
    Ok(active_branch(&rows)
        .iter()
        .filter_map(|row| {
            row.get("forkedFrom")
                .and_then(|origin| origin.get("messageUuid"))
                .and_then(Value::as_str)
                .map(ToOwned::to_owned)
        })
        .collect())
}

/// The texts of the user and agent messages a native read rebuilds.
async fn read_texts(root: &Path, id: &str) -> Result<Vec<String>, Box<dyn std::error::Error>> {
    let read = local(root).read(id).await?;
    Ok(read
        .turns
        .iter()
        .flat_map(|turn| turn.items.iter())
        .filter_map(|item| match item {
            AgentItem::UserMessage { content, .. } => {
                content.iter().find_map(|block| match block {
                    UserContent::Text { text } => Some(text.clone()),
                    _ => None,
                })
            }
            AgentItem::AgentMessage { text, .. } => Some(text.clone()),
            _ => None,
        })
        .collect())
}

/// A rewound session: an abandoned second prompt and the one asked again.
fn rewound() -> Vec<Value> {
    vec![
        user("p1", None, 1, "Fix the flaky test"),
        assistant("a1", "p1", 2, "Fixed."),
        user("p2", Some("a1"), 3, "Abandoned question"),
        assistant("a2", "p2", 4, "Abandoned answer"),
        user("p2b", Some("a1"), 5, "Asked again"),
        assistant("a3", "p2b", 6, "Answer again"),
    ]
}

#[tokio::test]
async fn renames_by_appending_a_title_the_listing_reads() -> TestResult {
    let root = tempfile::tempdir()?;
    let mut rows = rewound();
    rows.push(json!({"type": "ai-title", "aiTitle": "Flaky test", "sessionId": SESSION}));
    let path = write_session(root.path(), SESSION, &rows)?;

    write::rename(&projects(root.path()), &located(SESSION), "  Greeting ")?;

    let last = stored(&path)?.pop().ok_or("title row")?;
    assert_eq!(
        Value::Object(last),
        json!({"type": "custom-title", "customTitle": "Greeting", "sessionId": SESSION})
    );
    let (head, tail) = files::head_and_tail(&path)?;
    assert_eq!(
        meta::session_meta(&head, &tail).and_then(|meta| meta.title),
        Some("Greeting".to_owned())
    );
    let listed = local(root.path())
        .list(NativeSessionListParams {
            cursor: None,
            dir: None,
            limit: 10,
        })
        .await?;
    assert_eq!(listed.sessions[0].title.as_deref(), Some("Greeting"));

    assert!(matches!(
        write::rename(&projects(root.path()), &located(SESSION), " \n"),
        Err(RenameError::EmptyTitle)
    ));
    assert!(matches!(
        write::rename(&projects(root.path()), &located(UNKNOWN), "Title"),
        Err(RenameError::NotFound)
    ));
    Ok(())
}

#[test]
fn a_rename_finds_the_session_in_any_project_and_keeps_an_unterminated_row_whole() -> TestResult {
    let root = tempfile::tempdir()?;
    let elsewhere = projects(root.path()).join("-moved");
    std::fs::create_dir_all(&elsewhere)?;
    let path = elsewhere.join(format!("{SESSION}.jsonl"));
    std::fs::write(&path, format!("{}", user("p1", None, 1, "Hi")))?;
    let anywhere = SessionLocation {
        session_id: SESSION,
        cwd: None,
    };
    write::rename(&projects(root.path()), &anywhere, "Moved")?;
    write::rename(&projects(root.path()), &located(SESSION), "Again")?;
    let rows = stored(&path)?;
    assert_eq!(rows.len(), 3);
    assert_eq!(str_of(&rows[2], "customTitle"), Some("Again"));

    let empty = projects(root.path()).join("-empty");
    std::fs::create_dir_all(&empty)?;
    std::fs::write(empty.join(format!("{OTHER}.jsonl")), "")?;
    let empty_session = SessionLocation {
        session_id: OTHER,
        cwd: None,
    };
    assert!(matches!(
        write::rename(&projects(root.path()), &empty_session, "Title"),
        Err(RenameError::NotFound)
    ));
    Ok(())
}

#[test]
fn removes_the_session_and_its_directory_and_a_repeat_finds_it_missing() -> TestResult {
    let root = tempfile::tempdir()?;
    let path = write_session(root.path(), SESSION, &rewound())?;
    let other = write_session(root.path(), OTHER, &rewound())?;
    let sidecars = path.with_extension("").join("subagents");
    std::fs::create_dir_all(&sidecars)?;
    std::fs::write(sidecars.join("agent-a1.jsonl"), "{}\n")?;

    let anywhere = SessionLocation {
        session_id: SESSION,
        cwd: None,
    };
    assert_eq!(
        write::remove(&projects(root.path()), &anywhere)?,
        Removal::Removed
    );
    assert!(!path.exists());
    assert!(!path.with_extension("").exists());
    assert!(other.exists());
    assert_eq!(
        write::remove(&projects(root.path()), &located(SESSION))?,
        Removal::Missing
    );
    assert_eq!(
        write::remove(&projects(root.path()), &located("not-a-session"))?,
        Removal::Missing
    );
    Ok(())
}

#[tokio::test]
async fn forks_every_message_with_fresh_ids_into_a_titled_session() -> TestResult {
    let root = tempfile::tempdir()?;
    let mut rows = vec![
        json!({"type": "file-history-snapshot", "messageId": "p1", "snapshot": {}}),
        user("p1", None, 1, "Fix the flaky test"),
        json!({"type": "progress", "uuid": "g1", "parentUuid": "p1", "sessionId": SESSION, "data": {}}),
        assistant("a1", "g1", 2, "Fixed."),
        json!({"type": "user", "uuid": "s1", "parentUuid": null, "isSidechain": true, "sessionId": SESSION,
            "message": {"role": "user", "content": "side"}}),
        json!({"type": "ai-title", "aiTitle": "Flaky test", "sessionId": SESSION}),
        json!({"type": "custom-title", "customTitle": "Build check", "sessionId": SESSION}),
        json!({"type": "tag", "tag": "keep", "sessionId": SESSION}),
        json!({"type": "relocated", "relocatedCwd": "/moved", "sessionId": SESSION}),
        json!({"type": "content-replacement", "sessionId": SESSION, "replacements": [{"kind": "x"}]}),
    ];
    rows[3]["teamName"] = json!("team");
    rows[3]["slug"] = json!("slug");
    let path = write_session(root.path(), SESSION, &rows)?;
    std::fs::create_dir_all(path.with_extension("").join("subagents"))?;

    let forked = write::fork(&projects(root.path()), &located(SESSION), None)?;

    assert_ne!(forked, SESSION);
    assert!(files::is_session_id(&forked));
    let copy = project(root.path()).join(format!("{forked}.jsonl"));
    assert!(!project(root.path()).join(&forked).exists());
    let copied = stored(&copy)?;
    let kinds = copied
        .iter()
        .map(|row| str_of(row, "type").unwrap_or_default())
        .collect::<Vec<_>>();
    assert_eq!(
        kinds,
        [
            "user",
            "assistant",
            "content-replacement",
            "relocated",
            "custom-title"
        ]
    );
    let (prompt, answer) = (&copied[0], &copied[1]);
    for row in [prompt, answer] {
        assert_eq!(str_of(row, "sessionId"), Some(forked.as_str()));
        assert_eq!(row.get("isSidechain"), Some(&Value::Bool(false)));
        assert!(row.get("teamName").is_none() && row.get("slug").is_none());
        assert!(files::is_session_id(
            str_of(row, "uuid").unwrap_or_default()
        ));
    }
    assert_eq!(
        prompt.get("forkedFrom"),
        Some(&json!({"sessionId": SESSION, "messageUuid": "p1"}))
    );
    assert_eq!(prompt.get("parentUuid"), Some(&Value::Null));
    assert_eq!(prompt.get("timestamp"), Some(&json!(at(1))));
    // The progress row is dropped; the answer follows the prompt's copy.
    assert_eq!(answer.get("parentUuid"), prompt.get("uuid"));
    assert_ne!(answer.get("timestamp"), Some(&json!(at(2))));
    assert_eq!(str_of(&copied[3], "relocatedCwd"), Some("/moved"));
    assert_eq!(copied[2].get("replacements"), Some(&json!([{"kind": "x"}])));
    assert_eq!(
        str_of(&copied[4], "customTitle"),
        Some("Build check (fork)")
    );

    let listed = local(root.path())
        .list(NativeSessionListParams {
            cursor: None,
            dir: None,
            limit: 10,
        })
        .await?;
    let listing = listed
        .sessions
        .iter()
        .find(|session| session.session_id == forked)
        .ok_or("forked session listed")?;
    assert_eq!(listing.title.as_deref(), Some("Build check (fork)"));
    assert_eq!(listing.cwd.as_deref(), Some("/moved"));
    assert_eq!(
        read_texts(root.path(), &forked).await?,
        ["Fix the flaky test", "Fixed."]
    );
    Ok(())
}

#[tokio::test]
async fn forks_through_a_message_onto_its_branch() -> TestResult {
    let root = tempfile::tempdir()?;
    write_session(root.path(), SESSION, &rewound())?;
    let root_projects = projects(root.path());

    let first = write::fork(&root_projects, &located(SESSION), Some("a1"))?;
    let first_path = project(root.path()).join(format!("{first}.jsonl"));
    assert_eq!(forked_branch(&first_path)?, ["p1", "a1"]);
    assert_eq!(
        read_texts(root.path(), &first).await?,
        ["Fix the flaky test", "Fixed."]
    );

    let again = write::fork(&root_projects, &located(SESSION), Some("p2b"))?;
    let again_path = project(root.path()).join(format!("{again}.jsonl"));
    assert_eq!(forked_branch(&again_path)?, ["p1", "a1", "p2b"]);
    // The abandoned branch before the cut is copied too, as the SDK does.
    assert_eq!(stored(&again_path)?.len(), 6);

    let whole = write::fork(&root_projects, &located(SESSION), None)?;
    let whole_path = project(root.path()).join(format!("{whole}.jsonl"));
    assert_eq!(forked_branch(&whole_path)?, ["p1", "a1", "p2b", "a3"]);
    assert_eq!(
        read_texts(root.path(), &whole).await?,
        [
            "Fix the flaky test",
            "Fixed.",
            "Asked again",
            "Answer again"
        ]
    );
    let (head, tail) = files::head_and_tail(&whole_path)?;
    assert_eq!(
        meta::session_meta(&head, &tail).and_then(|meta| meta.title),
        Some("Fix the flaky test (fork)".to_owned())
    );
    Ok(())
}

#[test]
fn a_cut_leaves_out_a_compaction_of_an_abandoned_branch() -> TestResult {
    let root = tempfile::tempdir()?;
    let rows = vec![
        user("p1", None, 1, "First"),
        assistant("a1", "p1", 2, "One."),
        json!({"type": "system", "subtype": "compact_boundary", "uuid": "b1", "parentUuid": null,
            "logicalParentUuid": "a1", "sessionId": SESSION, "timestamp": at(3),
            "compactMetadata": {"trigger": "manual"}}),
        json!({"type": "user", "uuid": "s1", "parentUuid": "b1", "isCompactSummary": true, "sessionId": SESSION,
            "timestamp": at(4), "message": {"role": "user", "content": "Summary"}}),
        user("p2", Some("s1"), 5, "After compaction"),
        assistant("a2", "p2", 6, "Two."),
        user("p3", Some("a1"), 7, "Rewound"),
        assistant("a3", "p3", 8, "Three."),
    ];
    write_session(root.path(), SESSION, &rows)?;
    let forked = write::fork(&projects(root.path()), &located(SESSION), Some("a3"))?;
    let copied = stored(&project(root.path()).join(format!("{forked}.jsonl")))?;
    let origins = copied
        .iter()
        .filter_map(|row| row.get("forkedFrom")?.get("messageUuid")?.as_str())
        .collect::<Vec<_>>();
    assert_eq!(origins, ["p1", "a1", "p3", "a3"]);

    let whole = write::fork(&projects(root.path()), &located(SESSION), None)?;
    assert_eq!(
        stored(&project(root.path()).join(format!("{whole}.jsonl")))?.len(),
        rows.len() + 1
    );
    Ok(())
}

#[test]
fn a_fork_relinks_compactions_queued_prompts_and_logical_parents() -> TestResult {
    let root = tempfile::tempdir()?;
    let rows = vec![
        user("p1", None, 1, "First"),
        assistant("a1", "p1", 2, "One."),
        json!({"type": "system", "subtype": "compact_boundary", "uuid": "b1", "parentUuid": null,
            "logicalParentUuid": "a1", "sessionId": SESSION, "timestamp": at(3),
            "compactMetadata": {"trigger": "manual", "runningTurnSends": ["x"],
                "preservedMessages": {"anchorUuid": "s1", "uuids": ["a1", "elsewhere"]}}}),
        json!({"type": "user", "uuid": "s1", "parentUuid": "b1", "isCompactSummary": true, "sessionId": SESSION,
            "timestamp": at(4), "message": {"role": "user", "content": "Summary"}}),
        json!({"type": "attachment", "uuid": "q1", "parentUuid": "s1", "sessionId": SESSION, "timestamp": at(5),
            "attachment": {"type": "queued_command", "prompt": "Later", "source_uuid": "p1"}}),
    ];
    write_session(root.path(), SESSION, &rows)?;
    let forked = write::fork(&projects(root.path()), &located(SESSION), None)?;
    let copied = stored(&project(root.path()).join(format!("{forked}.jsonl")))?;
    let new_id = |source: &str| {
        copied
            .iter()
            .find(|row| {
                row.get("forkedFrom")
                    .and_then(|origin| origin.get("messageUuid"))
                    .and_then(Value::as_str)
                    == Some(source)
            })
            .and_then(|row| str_of(row, "uuid"))
            .map(ToOwned::to_owned)
    };
    let boundary = &copied[2];
    assert_eq!(
        boundary.get("logicalParentUuid").and_then(Value::as_str),
        new_id("a1").as_deref()
    );
    assert_eq!(
        boundary.get("compactMetadata"),
        Some(&json!({"trigger": "manual", "preservedMessages": {
            "anchorUuid": new_id("s1"), "uuids": [new_id("a1"), "elsewhere"]}}))
    );
    assert_eq!(
        copied[4]
            .get("attachment")
            .and_then(|attachment| attachment.get("source_uuid")),
        new_id("p1").map(Value::from).as_ref()
    );
    let ids = copied
        .iter()
        .filter_map(|row| str_of(row, "uuid"))
        .collect::<HashSet<_>>();
    assert_eq!(ids.len(), copied.len());
    Ok(())
}

#[test]
fn a_fork_refuses_unknown_sessions_messages_and_empty_transcripts() -> TestResult {
    let root = tempfile::tempdir()?;
    write_session(root.path(), SESSION, &rewound())?;
    write_session(
        root.path(),
        OTHER,
        &[
            json!({"type": "user", "uuid": "s1", "parentUuid": null, "isSidechain": true,
            "message": {"role": "user", "content": "side"}}),
        ],
    )?;
    let root_projects = projects(root.path());
    assert!(matches!(
        write::fork(&root_projects, &located(UNKNOWN), None),
        Err(ForkError::NotFound)
    ));
    assert!(matches!(
        write::fork(&root_projects, &located(SESSION), Some("gone")),
        Err(ForkError::MessageNotFound)
    ));
    assert!(matches!(
        write::fork(&root_projects, &located(OTHER), None),
        Err(ForkError::NoMessages)
    ));
    let left = std::fs::read_dir(project(root.path()))?.count();
    assert_eq!(left, 2);
    Ok(())
}

#[test]
fn names_project_directories_as_claude_does() {
    assert_eq!(
        write::project_dir_name("/home/me/my project.v2"),
        "-home-me-my-project-v2"
    );
    assert_eq!(write::project_dir_name("/tmp/ü😀"), "-tmp----");
    let long = format!("/work/{}", "deep/".repeat(50));
    let name = write::project_dir_name(&long);
    assert_eq!(name.len(), 200 + 1 + "pzfomp".len());
    assert!(name.ends_with("-pzfomp"));
}

#[test]
fn a_fork_carries_the_sidecar_title_the_atis_latch_and_history_suppression() -> TestResult {
    let root = tempfile::tempdir()?;
    let mut rows = rewound();
    rows.extend([
        json!({"type": "history-suppression", "sessionId": SESSION, "cause": "x", "ts": at(7)}),
        json!({"type": "atis-latch", "sessionId": SESSION, "atis": "latch-1"}),
        json!({"type": "atis-latch", "sessionId": OTHER, "atis": "foreign"}),
    ]);
    let path = write_session(root.path(), SESSION, &rows)?;
    std::fs::create_dir_all(path.with_extension(""))?;
    std::fs::write(
        path.with_extension("").join("custom-title.json"),
        json!({"customTitle": "  Side\u{7}car\u{200b}title  "}).to_string(),
    )?;
    let forked = write::fork(&projects(root.path()), &located(SESSION), None)?;
    let copied = stored(&project(root.path()).join(format!("{forked}.jsonl")))?;
    let first = copied.first().ok_or("first row")?;
    assert_eq!(str_of(first, "type"), Some("history-suppression"));
    assert_eq!(str_of(first, "cause"), Some("fork_inherit"));
    let latches = copied
        .iter()
        .filter(|row| str_of(row, "type") == Some("atis-latch"))
        .filter_map(|row| str_of(row, "atis"))
        .collect::<Vec<_>>();
    assert_eq!(latches, ["latch-1"]);
    let title = copied.last().and_then(|row| str_of(row, "customTitle"));
    assert_eq!(title, Some("Side car title (fork)"));
    Ok(())
}
