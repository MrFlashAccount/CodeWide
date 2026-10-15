//! Ports of the host's state, codec, store and v1 journal tests
//! (`host/test/static.test.ts`, `host/test/threads.test.ts`) and the
//! compatibility of a v2 `state.json` written by the TypeScript host.

use std::path::Path;

use agent_core::model::{AgentTurn, AppThreadId, TurnErrorKind, TurnOrigin, TurnStatus};
use serde_json::{Value, json};

use super::{
    StateError, ThreadDirectory, ThreadPresence, ThreadState, ThreadStateOrigin, ThreadStateStore,
    TitleOverride,
    codec::{decode_active_turn, decode_thread_state, encode_active_turn, encode_thread_state},
    thread_state::{PromptRole, ThreadCost, TurnOutcomeRecord, UsageBaseline},
};

type TestResult = Result<(), Box<dyn std::error::Error>>;

const THREAD: &str = "0199a3c4-7a8e-7b2c-9d1e-2f3a4b5c6d7e";

fn usage(input: i64, cache_writes: i64) -> Value {
    json!({"cachedInputTokens": 0, "cacheWriteInputTokens": cache_writes, "inputTokens": input,
        "outputTokens": 0, "reasoningOutputTokens": 0, "totalTokens": input})
}

/// A v2 `state.json` as the TypeScript encoder writes it (every field, the
/// optional `cost` of a turn usage record present).
fn ts_state() -> Value {
    json!({
        "appThreadId": THREAD,
        "createdAt": 1_760_000_000,
        "cwd": "/workspace/project",
        "origin": "created",
        "pendingSettings": {"effort": "high", "model": "claude-opus-4-6",
            "permissionProfile": ":full-access", "serviceTier": null},
        "presence": {"archived": false, "type": "listed"},
        "recencyAt": 1_760_000_100,
        "sessionIds": [THREAD, "6b1f9a2e-0c3d-4e5f-8a9b-0c1d2e3f4a5b"],
        "sessionStarted": true,
        "settings": {"effort": null, "model": "claude-sonnet-4-6",
            "permissionProfile": ":workspace", "serviceTier": null},
        "title": {"name": "Refactor the parser", "type": "pending"},
        "totalCost": {"type": "known", "usd": 0.25},
        "totalUsage": usage(10, 7),
        "turns": [
            {"anchors": ["p-1", "a-1"], "completedAt": 1_760_000_050, "origin": "user",
                "outcome": {"status": "completed"},
                "prompts": [{"clientMessageId": "client-1", "role": "first", "uuid": "p-1"},
                    {"clientMessageId": null, "role": "steer", "uuid": null}],
                "startedAt": 1_760_000_010, "turnId": "turn-1",
                "usage": {"contextWindow": 200_000,
                    "cost": {"basis": "list", "model": "claude-sonnet-4-6",
                        "threadUsd": 0.25, "turnUsd": 0.25},
                    "last": usage(3, 7), "total": usage(10, 7), "turn": usage(10, 7)}},
            {"anchors": ["w-1"], "completedAt": 1_760_000_090, "origin": "provider",
                "outcome": {"error": {"kind": "usageLimit", "message": "limit reached"},
                    "status": "failed"},
                "prompts": [], "startedAt": 1_760_000_080, "turnId": "turn-2", "usage": null}
        ],
        "updatedAt": 1_760_000_090,
        "usageBaseline": {"checkpoints": [[{"cacheCreationInputTokens": 7,
            "cacheReadInputTokens": 0, "costUsd": 0.25, "inputTokens": 3,
            "model": "claude-sonnet-4-6", "outputTokens": 0, "thinkingTokens": 0}]],
            "type": "known"},
        "version": 2
    })
}

fn decode(value: &Value) -> Result<ThreadState, serde_json::Error> {
    decode_thread_state(&serde_json::to_vec(value)?)
}

fn with(mut value: Value, field: &str, replacement: Option<Value>) -> Value {
    if let Some(object) = value.as_object_mut() {
        match replacement {
            Some(replacement) => object.insert(field.to_owned(), replacement),
            None => object.remove(field),
        };
    }
    value
}

fn turn(status: &str) -> Value {
    json!({"turnId": "turn-live", "status": status, "origin": "user", "startedAt": 40,
        "completedAt": null, "error": null, "items": [{"type": "agentMessage",
        "itemId": "turn-live:agent:0", "phase": "commentary", "text": "working"}]})
}

fn thread_id() -> Result<AppThreadId, &'static str> {
    AppThreadId::parse(THREAD).ok_or("thread id")
}

#[test]
fn a_typescript_state_file_round_trips_unchanged() -> TestResult {
    let fixture = ts_state();
    let state = decode(&fixture)?;
    assert_eq!(
        state.current_session_id(),
        "6b1f9a2e-0c3d-4e5f-8a9b-0c1d2e3f4a5b"
    );
    assert_eq!(state.origin, ThreadStateOrigin::Created);
    assert_eq!(state.effective_settings().model, "claude-opus-4-6");
    assert_eq!(
        state.turns[1].outcome,
        TurnOutcomeRecord::Failed {
            error: agent_core::model::TurnError {
                kind: TurnErrorKind::UsageLimit,
                message: "limit reached".into()
            }
        }
    );
    assert_eq!(state.turns[0].prompts[1].role, PromptRole::Steer);
    let encoded: Value = serde_json::from_slice(&encode_thread_state(&state)?)?;
    assert_eq!(encoded, fixture);
    assert_eq!(decode(&encoded)?, state);
    Ok(())
}

#[test]
fn reads_state_written_before_usage_accounting() -> TestResult {
    let mut legacy_usage = usage(5, 0);
    if let Some(object) = legacy_usage.as_object_mut() {
        object.remove("cacheWriteInputTokens");
    }
    let file = with(ts_state(), "totalCost", None);
    let file = with(file, "usageBaseline", None);
    let file = with(file, "totalUsage", Some(legacy_usage));
    let file = with(
        file,
        "turns",
        Some(json!([{"anchors": [], "completedAt": 2, "origin": "user",
            "outcome": {"status": "completed"}, "prompts": [], "startedAt": 1, "turnId": "turn"}])),
    );
    let state = decode(&file)?;
    assert_eq!(state.total_cost, ThreadCost::Unknown);
    assert_eq!(state.usage_baseline, UsageBaseline::Unknown);
    assert_eq!(state.total_usage.cache_write_input_tokens, Some(0));
    assert_eq!(state.turns[0].usage, None);

    let unused = with(file, "totalUsage", Some(usage(0, 0)));
    let unused = with(unused, "totalCost", Some(Value::Null));
    assert_eq!(decode(&unused)?.total_cost, ThreadCost::Known { usd: 0.0 });
    Ok(())
}

#[test]
fn accepts_absent_optionals_and_extra_fields() -> TestResult {
    let file = with(ts_state(), "pendingSettings", None);
    let file = with(file, "recencyAt", None);
    let file = with(file, "preview", Some(json!("ignored")));
    let state = decode(&file)?;
    assert_eq!(state.pending_settings, None);
    assert_eq!(state.recency_at, None);
    Ok(())
}

#[test]
fn rejects_what_the_typescript_codec_rejects() {
    let rejected = [
        ("version 1", with(ts_state(), "version", Some(json!(1)))),
        ("version 3", with(ts_state(), "version", Some(json!(3)))),
        ("no version", with(ts_state(), "version", None)),
        (
            "empty chain",
            with(ts_state(), "sessionIds", Some(json!([]))),
        ),
        (
            "null baseline",
            with(ts_state(), "usageBaseline", Some(Value::Null)),
        ),
        ("no usage", with(ts_state(), "totalUsage", None)),
        ("no turns", with(ts_state(), "turns", None)),
        (
            "bad origin",
            with(ts_state(), "origin", Some(json!("imported"))),
        ),
        (
            "bad title",
            with(ts_state(), "title", Some(json!({"type": "renamed"}))),
        ),
        (
            "bad presence",
            with(ts_state(), "presence", Some(json!({"type": "listed"}))),
        ),
        (
            "bad cost",
            with(ts_state(), "totalCost", Some(json!({"type": "guess"}))),
        ),
        (
            "float time",
            with(ts_state(), "createdAt", Some(json!(1.5))),
        ),
        ("not an object", json!([])),
    ];
    for (name, file) in rejected {
        assert!(decode(&file).is_err(), "{name} must be rejected");
    }
}

#[test]
fn active_turn_snapshots_round_trip_and_reject_foreign_turns() -> TestResult {
    let file = json!({"turn": turn("inProgress"), "version": 2});
    let decoded: AgentTurn = decode_active_turn(&serde_json::to_vec(&file)?)?;
    assert_eq!(decoded.status, TurnStatus::InProgress);
    let encoded: Value = serde_json::from_slice(&encode_active_turn(&decoded)?)?;
    assert_eq!(encoded, file);

    let mut foreign = turn("inProgress");
    if let Some(object) = foreign.as_object_mut() {
        object.insert(
            "provenance".into(),
            json!({"provider": "codex", "nativeThreadId": "x"}),
        );
    }
    let foreign = json!({"turn": foreign, "version": 2});
    assert!(decode_active_turn(&serde_json::to_vec(&foreign)?).is_err());
    let stale = json!({"turn": turn("inProgress"), "version": 1});
    assert!(decode_active_turn(&serde_json::to_vec(&stale)?).is_err());
    Ok(())
}

#[test]
fn turn_records_replace_by_id_or_append() -> TestResult {
    let mut state = decode(&ts_state())?;
    let mut record = state.turns[0].clone();
    record.outcome = TurnOutcomeRecord::Interrupted;
    state.put_turn_record(record.clone());
    assert_eq!(state.turns.len(), 2);
    assert_eq!(state.turns[0].outcome, TurnOutcomeRecord::Interrupted);
    record.turn_id = "turn-3".into();
    state.put_turn_record(record);
    assert_eq!(
        state
            .turns
            .iter()
            .map(|turn| turn.turn_id.as_str())
            .collect::<Vec<_>>(),
        ["turn-1", "turn-2", "turn-3"]
    );
    assert!(!state.is_archived() && !state.is_deleted());
    Ok(())
}

#[cfg(unix)]
fn mode(path: &Path) -> std::io::Result<u32> {
    use std::os::unix::fs::PermissionsExt;
    Ok(std::fs::metadata(path)?.permissions().mode() & 0o777)
}

#[test]
fn writes_owner_only_files_atomically_and_reads_them_back() -> TestResult {
    let temporary = tempfile::tempdir()?;
    let root = temporary.path().join("state");
    let store = ThreadStateStore::open(root.clone())?;
    let mut state = decode(&ts_state())?;
    store.write(&state)?;
    state.title = TitleOverride::Pending {
        name: "renamed".into(),
    };
    store.write(&state)?;
    let directory = root.join("threads").join(THREAD);
    let names = std::fs::read_dir(&directory)?
        .map(|entry| entry.map(|entry| entry.file_name()))
        .collect::<Result<Vec<_>, _>>()?;
    assert_eq!(names, ["state.json"]);
    #[cfg(unix)]
    {
        assert_eq!(mode(&root)?, 0o700);
        assert_eq!(mode(&directory)?, 0o700);
        assert_eq!(mode(&directory.join("state.json"))?, 0o600);
    }
    let mut errors = Vec::new();
    let loaded = store.load(|id, err| errors.push((id.clone(), err.to_string())))?;
    assert!(errors.is_empty(), "{errors:?}");
    assert_eq!(loaded.len(), 1);
    assert_eq!(loaded[0].state, state);
    assert_eq!(loaded[0].active_turn, None);

    let mut escape = state.clone();
    escape.app_thread_id = AppThreadId::parse("../escape").ok_or("id")?;
    assert!(matches!(
        store.write(&escape),
        Err(StateError::UnsafeThreadId)
    ));
    Ok(())
}

#[test]
fn keeps_the_running_turn_until_it_is_cleared() -> TestResult {
    let temporary = tempfile::tempdir()?;
    let store = ThreadStateStore::open(temporary.path().to_path_buf())?;
    let id = thread_id()?;
    store.write(&decode(&ts_state())?)?;
    let running: AgentTurn = serde_json::from_value(turn("inProgress"))?;
    store.write_active_turn(&id, &running)?;
    let loaded = store.load(|_, _| {})?;
    assert_eq!(loaded[0].active_turn.as_ref(), Some(&running));
    store.clear_active_turn(&id)?;
    store.clear_active_turn(&id)?;
    assert_eq!(store.load(|_, _| {})?[0].active_turn, None);
    Ok(())
}

#[test]
fn reports_unreadable_threads_and_skips_foreign_entries() -> TestResult {
    let temporary = tempfile::tempdir()?;
    let root = temporary.path();
    let store = ThreadStateStore::open(root.to_path_buf())?;
    let threads = root.join("threads");
    let elsewhere = threads.join("other-thread");
    std::fs::create_dir_all(&elsewhere)?;
    std::fs::write(
        elsewhere.join("state.json"),
        serde_json::to_vec(&ts_state())?,
    )?;
    let truncated = threads.join("truncated");
    std::fs::create_dir_all(&truncated)?;
    std::fs::write(truncated.join("state.json"), b"{")?;
    let broken_turn = threads.join(THREAD);
    std::fs::create_dir_all(&broken_turn)?;
    std::fs::write(
        broken_turn.join("state.json"),
        serde_json::to_vec(&ts_state())?,
    )?;
    std::fs::write(broken_turn.join("active-turn.json"), b"[]")?;
    std::fs::create_dir_all(threads.join("empty"))?;
    std::fs::create_dir_all(threads.join("not safe"))?;
    std::fs::write(threads.join("a-file"), b"")?;

    let mut errors = Vec::new();
    let loaded = store.load(|id, err| errors.push((id.as_str().to_owned(), err)))?;
    assert!(loaded.is_empty());
    errors.sort_by(|left, right| left.0.cmp(&right.0));
    assert_eq!(errors.len(), 3, "{errors:?}");
    assert!(
        matches!(errors[0].1, StateError::Decode { ref file, .. } if file == "active-turn.json")
    );
    assert!(matches!(errors[1].1, StateError::ThreadIdMismatch));
    assert!(matches!(errors[2].1, StateError::Decode { ref file, .. } if file == "state.json"));
    assert!(ThreadDirectory::new(root, "not safe").is_err());
    Ok(())
}

fn legacy_thread(claude_session_id: &str, deleted_at: Option<i64>) -> Value {
    json!({
        "appThreadId": THREAD, "archived": true, "claudeSessionId": claude_session_id,
        "createdAt": 10, "cwd": "/workspace", "deletedAt": deleted_at,
        "firstUserMessage": "hello", "name": "Old name", "pendingSettings": null,
        "preview": "hello", "recencyAt": 11, "sessionStarted": true,
        "settings": {"effort": null, "model": "sonnet", "permissionProfile": ":workspace",
            "serviceTier": null},
        "totalUsage": {"cachedInputTokens": 0, "inputTokens": 1, "outputTokens": 2,
            "reasoningOutputTokens": 0, "totalTokens": 3},
        "turnCount": 1, "updatedAt": 12, "version": 1
    })
}

fn legacy_turn(turn_id: &str, status: &str, prompts: &Value) -> Value {
    json!({"prompts": prompts, "seq": 1, "version": 1, "turn": {
        "completedAt": 12, "error": null, "origin": "user", "startedAt": 11, "status": status,
        "turnId": turn_id, "items": [{"clientMessageId": "client-1",
            "content": [{"text": "hello", "type": "text"}],
            "itemId": format!("{turn_id}:user:0"), "type": "userMessage"}]}})
}

fn write_legacy(root: &Path, thread: &Value, turns: &[(&str, Value)]) -> TestResult {
    let directory = root.join("threads").join(THREAD);
    std::fs::create_dir_all(directory.join("turns"))?;
    std::fs::write(directory.join("thread.json"), serde_json::to_vec(thread)?)?;
    for (name, turn) in turns {
        std::fs::write(
            directory.join("turns").join(name),
            serde_json::to_vec(turn)?,
        )?;
    }
    Ok(())
}

#[test]
fn converts_a_version_1_journal_keeping_turn_ids_and_client_message_ids() -> TestResult {
    let temporary = tempfile::tempdir()?;
    let root = temporary.path();
    let prompts = json!([{"clientMessageId": "client-1", "uuid": "p-legacy"},
        {"clientMessageId": "client-2", "uuid": null}]);
    write_legacy(
        root,
        &legacy_thread(THREAD, None),
        &[
            (
                "00000002.json",
                legacy_turn("turn-running", "inProgress", &json!([])),
            ),
            (
                "00000001.json",
                legacy_turn("legacy-turn", "completed", &prompts),
            ),
            (
                "00000003.json",
                legacy_turn("turn-failed", "failed", &json!([])),
            ),
            ("notes.json", json!("ignored")),
        ],
    )?;
    let store = ThreadStateStore::open(root.to_path_buf())?;
    let mut errors = Vec::new();
    let loaded = store.load(|_, err| errors.push(err))?;
    assert!(errors.is_empty(), "{errors:?}");
    assert_eq!(loaded.len(), 1);
    let state = &loaded[0].state;
    assert_eq!(state.session_ids.iter().collect::<Vec<_>>(), [THREAD]);
    assert_eq!(state.presence, ThreadPresence::Listed { archived: true });
    assert_eq!(
        state.title,
        TitleOverride::Pending {
            name: "Old name".into()
        }
    );
    assert_eq!(state.total_cost, ThreadCost::Unknown);
    assert_eq!(state.total_usage.cache_write_input_tokens, Some(0));
    assert_eq!(state.usage_baseline, UsageBaseline::Unknown);
    assert_eq!(
        state
            .turns
            .iter()
            .map(|turn| turn.turn_id.as_str())
            .collect::<Vec<_>>(),
        ["legacy-turn", "turn-running", "turn-failed"]
    );
    let first = &state.turns[0];
    assert_eq!(first.anchors, ["p-legacy"]);
    assert_eq!(first.origin, TurnOrigin::User);
    assert_eq!(
        first
            .prompts
            .iter()
            .map(|prompt| (prompt.client_message_id.as_deref(), prompt.role))
            .collect::<Vec<_>>(),
        [
            (Some("client-1"), PromptRole::First),
            (Some("client-2"), PromptRole::Steer)
        ]
    );
    assert_eq!(state.turns[1].outcome, TurnOutcomeRecord::InProgress);
    assert!(matches!(
        &state.turns[2].outcome,
        TurnOutcomeRecord::Failed { error } if error.kind == TurnErrorKind::Unknown
            && error.message == "Claude turn failed"
    ));
    assert_eq!(
        loaded[0]
            .active_turn
            .as_ref()
            .map(|turn| turn.turn_id.as_str()),
        Some("turn-running")
    );

    let directory = root.join("threads").join(THREAD);
    let mut names = std::fs::read_dir(&directory)?
        .map(|entry| entry.map(|entry| entry.file_name().to_string_lossy().into_owned()))
        .collect::<Result<Vec<_>, _>>()?;
    names.sort();
    assert_eq!(names, ["state.json", "thread.json", "turns"]);
    // The converted state now loads as v2 (the active turn lived only in v1).
    let reloaded = store.load(|_, err| errors.push(err))?;
    assert!(errors.is_empty(), "{errors:?}");
    assert_eq!(&reloaded[0].state, state);
    assert_eq!(reloaded[0].active_turn, None);
    Ok(())
}

#[test]
fn converts_replacement_sessions_and_tombstones() -> TestResult {
    let temporary = tempfile::tempdir()?;
    write_legacy(
        temporary.path(),
        &legacy_thread("6b1f9a2e-0c3d-4e5f-8a9b-0c1d2e3f4a5b", Some(20)),
        &[],
    )?;
    let loaded = ThreadStateStore::open(temporary.path().to_path_buf())?.load(|_, _| {})?;
    let state = &loaded[0].state;
    assert_eq!(
        state.current_session_id(),
        "6b1f9a2e-0c3d-4e5f-8a9b-0c1d2e3f4a5b"
    );
    assert_eq!(state.session_ids.iter().count(), 2);
    assert!(state.is_deleted());
    assert!(state.turns.is_empty());
    Ok(())
}

#[test]
fn rejects_a_foreign_version_1_journal() -> TestResult {
    let temporary = tempfile::tempdir()?;
    let mut foreign = legacy_thread(THREAD, None);
    if let Some(object) = foreign.as_object_mut() {
        object.insert("appThreadId".into(), json!("another-thread"));
    }
    write_legacy(temporary.path(), &foreign, &[])?;
    let store = ThreadStateStore::open(temporary.path().to_path_buf())?;
    let mut errors = Vec::new();
    assert!(store.load(|_, err| errors.push(err))?.is_empty());
    assert!(matches!(
        errors.as_slice(),
        [StateError::LegacyThreadIdMismatch]
    ));
    assert!(
        !temporary
            .path()
            .join("threads")
            .join(THREAD)
            .join("state.json")
            .exists()
    );
    Ok(())
}
