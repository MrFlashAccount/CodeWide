//! Background task output reads over a live thread: the thread's own launch
//! makes a task readable, the live session says it runs until its report,
//! pages follow each other across multibyte characters, and a task the
//! thread never started, an id that could name another file and output that
//! is gone are rejected. The launching `command` item is republished with
//! each change of the task's state.

use std::{collections::HashMap, os::unix::fs::MetadataExt, path::PathBuf, sync::Arc};

use agent_core::model::{
    AgentEvent, AgentItem, BackgroundCommandState, BackgroundTaskReadResult, BackgroundTaskStatus,
    ERROR_BACKGROUND_TASK_UNAVAILABLE, RpcError, RunningBackgroundTask, SortDirection,
};
use serde_json::json;

use super::{
    Harness, Options, THREAD, TestResult, create_thread, frames, harness, id, settle, start,
    threads::turns_params,
};
use crate::background_tasks::{BackgroundTaskId, TaskFacts, TaskRead, answer};

const TASK: &str = "bd3cb8oli";

/// A turn that starts `npm test` as the background task [`TASK`] and ends;
/// the query stays open, so the task keeps running.
async fn launch(
    harness: &Harness,
) -> Result<std::sync::Arc<super::FakeQuery>, Box<dyn std::error::Error>> {
    create_thread(&harness.service, THREAD).await?;
    start(&harness.service, THREAD, "Run the tests in the background").await?;
    let query = harness.runtime.query(0)?;
    query.push(frames::init()).await;
    query
        .push(frames::tool_use(
            "m1",
            "toolu_bg",
            "Bash",
            &json!({"command": "npm test", "run_in_background": true}),
        ))
        .await;
    query
        .push(
            json!({"type": "system", "subtype": "task_started", "task_id": TASK,
            "tool_use_id": "toolu_bg", "task_type": "local_bash",
            "description": "npm test"}),
        )
        .await;
    query
        .push(json!({"type": "user", "parent_tool_use_id": null,
            "message": {"role": "user", "content": [{"type": "tool_result",
                "tool_use_id": "toolu_bg",
                "content": format!("Command running in background with ID: {TASK}.")}]},
            "tool_use_result": {"stdout": "", "stderr": "", "backgroundTaskId": TASK}}))
        .await;
    query.push(frames::text("m2", "Started.")).await;
    query.push(frames::result()).await;
    query.idle().await;
    settle().await;
    Ok(query)
}

/// Answers a read as the provider does, with output under `temp_root`.
async fn read(
    harness: &Harness,
    task: &str,
    temp_root: &std::path::Path,
    offset: u64,
    limit: u32,
) -> Result<Result<BackgroundTaskReadResult, RpcError>, Box<dyn std::error::Error>> {
    let task = BackgroundTaskId::parse(task).ok_or("task id")?;
    let thread = harness
        .service
        .background_task_thread(&id(THREAD)?, &task)
        .await?;
    let mut params = turns_params(THREAD)?;
    params.sort_direction = SortDirection::Desc;
    let (turns, _) = harness.service.turns(params, false).await?;
    let mut facts = TaskFacts::default();
    facts.scan_newest_first(&task, &turns.turns);
    Ok(answer(&TaskRead {
        task: &task,
        facts: &facts,
        live: thread.live,
        sessions: &thread.sessions,
        temp_root,
        offset,
        limit,
    }))
}

/// Where Claude writes [`TASK`]'s output for the thread's session.
async fn output_file(harness: &Harness) -> Result<(PathBuf, PathBuf), Box<dyn std::error::Error>> {
    let task = BackgroundTaskId::parse(TASK).ok_or("task id")?;
    let thread = harness
        .service
        .background_task_thread(&id(THREAD)?, &task)
        .await?;
    let session = thread
        .sessions
        .first()
        .ok_or("the thread has no session file")?;
    let project_key = session
        .path
        .parent()
        .and_then(std::path::Path::file_name)
        .ok_or("no project directory")?;
    let uid = std::fs::metadata(&session.path)?.uid();
    let temp_root = harness.root.path().join("tmp");
    let tasks = temp_root
        .join(format!("claude-{uid}"))
        .join(project_key)
        .join(&session.session_id)
        .join("tasks");
    std::fs::create_dir_all(&tasks)?;
    Ok((temp_root, tasks.join(task.output_file_name())))
}

#[tokio::test]
async fn a_launched_task_pages_its_output_while_it_runs_and_reports_its_status() -> TestResult {
    let harness = harness(Options::default())?;
    let query = launch(&harness).await?;
    let (temp_root, output) = output_file(&harness).await?;
    // "PASS €" is 8 bytes: a 6-byte page ends before the euro sign.
    std::fs::write(&output, "PASS €\nok\n")?;

    let first = read(&harness, TASK, &temp_root, 0, 6)
        .await?
        .map_err(|error| error.message)?;
    assert_eq!(
        first,
        BackgroundTaskReadResult {
            task_id: TASK.into(),
            command: Some("npm test".into()),
            status: BackgroundTaskStatus::Running,
            text: "PASS ".into(),
            next_offset: Some(5),
            size_bytes: 12,
        }
    );
    let second = read(&harness, TASK, &temp_root, 5, 6)
        .await?
        .map_err(|error| error.message)?;
    assert_eq!(second.text, "€\nok");
    assert_eq!(second.next_offset, Some(11));
    let last = read(&harness, TASK, &temp_root, 11, 6)
        .await?
        .map_err(|error| error.message)?;
    assert_eq!((last.text.as_str(), last.next_offset), ("\n", None));

    query
        .push(
            json!({"type": "system", "subtype": "task_notification", "task_id": TASK,
            "tool_use_id": "toolu_bg", "status": "completed",
            "summary": "Background command \"npm test\" completed (exit code 0)"}),
        )
        .await;
    settle().await;
    let finished = read(&harness, TASK, &temp_root, 0, 65_536)
        .await?
        .map_err(|error| error.message)?;
    assert_eq!(finished.status, BackgroundTaskStatus::Completed);
    assert_eq!(finished.text, "PASS €\nok\n");

    std::fs::remove_file(&output)?;
    let gone = read(&harness, TASK, &temp_root, 0, 10).await?;
    assert_eq!(
        gone.map_err(|error| (error.code, error.message)),
        Err((
            ERROR_BACKGROUND_TASK_UNAVAILABLE,
            format!("background task output is unavailable: {TASK}")
        ))
    );
    harness.close().await;
    Ok(())
}

#[tokio::test]
async fn a_task_the_thread_never_started_is_not_read_even_when_its_file_exists() -> TestResult {
    let harness = harness(Options::default())?;
    launch(&harness).await?;
    let (temp_root, output) = output_file(&harness).await?;
    let foreign = output.with_file_name("bforeign1.output");
    std::fs::write(&foreign, "secret")?;
    let rejected = read(&harness, "bforeign1", &temp_root, 0, 10).await?;
    assert_eq!(
        rejected.map_err(|error| (error.code, error.message)),
        Err((
            ERROR_BACKGROUND_TASK_UNAVAILABLE,
            "background task not found: bforeign1".to_owned()
        ))
    );
    // An id that could name another file is never a task id.
    assert!(BackgroundTaskId::parse("../../../../etc/passwd").is_none());
    harness.close().await;
    Ok(())
}

/// The states the launching item of [`TASK`] was published with, in order.
fn published_states(harness: &Harness) -> Vec<BackgroundCommandState> {
    harness
        .events()
        .into_iter()
        .filter_map(|event| match event {
            AgentEvent::ItemCompleted {
                item:
                    AgentItem::Command {
                        background: Some(background),
                        ..
                    },
                ..
            } if background.task_id == TASK => Some(background.state),
            _ => None,
        })
        .collect()
}

#[tokio::test]
async fn a_launch_runs_and_its_report_republishes_the_end_live() -> TestResult {
    for (status, ended) in [
        ("completed", "completed"),
        ("failed", "failed"),
        ("killed", "stopped"),
        ("stopped", "stopped"),
    ] {
        let harness = harness(Options::default())?;
        let query = launch(&harness).await?;
        assert_eq!(
            published_states(&harness).last(),
            Some(&BackgroundCommandState::Running),
            "{status}: the launch runs"
        );
        assert_eq!(
            harness
                .service
                .live_session_knowledge(&id(THREAD)?)
                .await?
                .0
                .map(|live| live.states),
            Some(HashMap::from([(
                TASK.to_owned(),
                BackgroundCommandState::Running
            )]))
        );
        let launch_turn = harness
            .events()
            .into_iter()
            .find_map(|event| match event {
                AgentEvent::ItemCompleted { turn_id, item, .. }
                    if item.item_id().as_str() == "toolu_bg" =>
                {
                    Some(turn_id)
                }
                _ => None,
            })
            .ok_or("launch item")?;

        // The report arrives while no turn runs: the item changes at once.
        query
            .push(
                json!({"type": "system", "subtype": "task_notification", "task_id": TASK,
                "tool_use_id": "toolu_bg", "status": status,
                "summary": "Background command \"npm test\" ended"}),
            )
            .await;
        settle().await;
        let republished = harness
            .events()
            .into_iter()
            .filter_map(|event| match event {
                AgentEvent::ItemCompleted { turn_id, item, .. }
                    if item.item_id().as_str() == "toolu_bg" =>
                {
                    Some(turn_id)
                }
                _ => None,
            })
            .next_back()
            .ok_or("republished item")?;
        assert_eq!(
            republished, launch_turn,
            "{status}: the same item of its own turn"
        );
        let state = published_states(&harness).last().copied();
        let matches_end = match (ended, state) {
            ("completed", Some(BackgroundCommandState::Completed { exit_code, .. }))
            | ("failed", Some(BackgroundCommandState::Failed { exit_code, .. })) => {
                exit_code.is_none()
            }
            ("stopped", Some(BackgroundCommandState::Stopped { .. })) => true,
            _ => false,
        };
        assert!(matches_end, "{status}: published {state:?}");
        assert_eq!(
            harness
                .service
                .live_session_knowledge(&id(THREAD)?)
                .await?
                .0
                .and_then(|live| live.states.get(TASK).copied()),
            state
        );

        // A later report cannot reopen or replace the end.
        let published = published_states(&harness).len();
        query
            .push(
                json!({"type": "system", "subtype": "task_notification", "task_id": TASK,
                "tool_use_id": "toolu_bg", "status": "completed"}),
            )
            .await;
        settle().await;
        assert_eq!(published_states(&harness).len(), published, "{status}");
        harness.close().await;
    }
    Ok(())
}

#[tokio::test]
async fn a_launch_stops_when_its_process_exits_while_it_runs() -> TestResult {
    let harness = harness(Options::default())?;
    let query = launch(&harness).await?;
    query.end().await;
    settle().await;
    // The harness clock reads 1_760_000_000_000 ms when the process exits.
    assert_eq!(
        published_states(&harness),
        [
            BackgroundCommandState::Running,
            BackgroundCommandState::Stopped {
                ended_at: 1_760_000_000
            }
        ]
    );
    assert_eq!(
        harness
            .service
            .live_session_knowledge(&id(THREAD)?)
            .await?
            .0,
        None
    );
    harness.close().await;
    Ok(())
}

/// Appends to the thread's session file the `<task-notification>` row Claude
/// stores for [`TASK`]'s report.
async fn store_report(harness: &Harness, status: &str) -> TestResult {
    let task = BackgroundTaskId::parse(TASK).ok_or("task id")?;
    let thread = harness
        .service
        .background_task_thread(&id(THREAD)?, &task)
        .await?;
    let session = thread.sessions.first().ok_or("no session file")?;
    let xml = format!(
        "<task-notification>\n<task-id>{TASK}</task-id>\n<tool-use-id>toolu_bg</tool-use-id>\n<status>{status}</status>\n<summary>Background command \"npm test\" ended</summary>\n</task-notification>"
    );
    super::append_row(
        &session.path,
        json!({"type": "user", "uuid": format!("report-{status}"), "sessionId": session.session_id,
            "timestamp": "2026-10-01T10:01:00.000Z", "origin": {"kind": "task-notification"},
            "message": {"role": "user", "content": xml}}),
    )?;
    Ok(())
}

/// [`TASK`]'s state as a `thread.turns` read answers it.
async fn read_state(
    harness: &Harness,
) -> Result<BackgroundCommandState, Box<dyn std::error::Error>> {
    let (page, _) = harness.service.turns(turns_params(THREAD)?, false).await?;
    page.turns
        .iter()
        .flat_map(|turn| &turn.items)
        .find_map(|item| match item {
            AgentItem::Command {
                background: Some(background),
                ..
            } if background.task_id == TASK => Some(background.state),
            _ => None,
        })
        .ok_or_else(|| "no background command".into())
}

/// The session file's report at 2026-10-01T10:01:00Z.
const STORED_AT: i64 = 1_790_848_860;

#[tokio::test]
async fn a_read_answers_the_authoritative_state_even_without_the_live_event() -> TestResult {
    let harness = harness(Options::default())?;
    let query = launch(&harness).await?;
    // History alone cannot tell; the live session says it runs.
    assert_eq!(read_state(&harness).await?, BackgroundCommandState::Running);

    // Claude stores the report; whether or not its live event reached anyone,
    // the next read ends the task at the stored time.
    store_report(&harness, "completed").await?;
    assert_eq!(
        read_state(&harness).await?,
        BackgroundCommandState::Completed {
            ended_at: STORED_AT,
            exit_code: None
        }
    );
    // The live report later agrees on the status and cannot change the read.
    query
        .push(
            json!({"type": "system", "subtype": "task_notification", "task_id": TASK,
            "tool_use_id": "toolu_bg", "status": "completed"}),
        )
        .await;
    settle().await;
    assert!(matches!(
        published_states(&harness).last(),
        Some(BackgroundCommandState::Completed { .. })
    ));
    assert_eq!(
        read_state(&harness).await?,
        BackgroundCommandState::Completed {
            ended_at: STORED_AT,
            exit_code: None
        }
    );
    harness.close().await;
    Ok(())
}

#[tokio::test]
async fn a_live_stop_reads_stopped_and_the_stored_report_s_time_wins() -> TestResult {
    let harness = harness(Options::default())?;
    let query = launch(&harness).await?;
    query
        .push(
            json!({"type": "system", "subtype": "task_notification", "task_id": TASK,
            "tool_use_id": "toolu_bg", "status": "killed"}),
        )
        .await;
    settle().await;
    assert_eq!(
        read_state(&harness).await?,
        BackgroundCommandState::Stopped {
            ended_at: 1_760_000_000
        }
    );
    store_report(&harness, "killed").await?;
    assert_eq!(
        read_state(&harness).await?,
        BackgroundCommandState::Stopped {
            ended_at: STORED_AT
        }
    );
    harness.close().await;
    Ok(())
}

#[tokio::test]
async fn after_a_restart_a_read_answers_what_the_session_file_proves() -> TestResult {
    let first = harness(Options::default())?;
    launch(&first).await?;
    store_report(&first, "failed").await?;
    let root = Arc::clone(&first.root);
    first.close().await;

    let second = harness(Options {
        root: Some(root),
        ..Options::default()
    })?;
    second.service.load().await?;
    assert_eq!(
        read_state(&second).await?,
        BackgroundCommandState::Failed {
            ended_at: STORED_AT,
            exit_code: None
        }
    );
    second.close().await;

    Ok(())
}

/// The stored launch's start: its tool call row, 2026-10-01T10:00:05Z.
const LAUNCHED_AT_MS: i64 = 1_790_848_805_000;

#[tokio::test]
async fn after_a_restart_an_unreported_launch_runs_only_while_its_process_holds_the_session()
-> TestResult {
    for (holder, expected) in [
        // The process that launched it outlived the companion: it still runs.
        (
            Some(LAUNCHED_AT_MS - 60_000),
            BackgroundCommandState::Running,
        ),
        // A later process generation holds the session: the launching one
        // is gone, so the task stopped by that generation's start.
        (
            Some(LAUNCHED_AT_MS + 60_000),
            BackgroundCommandState::Stopped {
                ended_at: (LAUNCHED_AT_MS + 60_000) / 1000,
            },
        ),
        // No process holds it any more: stopped when the companion saw it
        // gone (the harness clock is older than the stored launch, so the
        // launch's own start bounds it).
        (
            None,
            BackgroundCommandState::Stopped {
                ended_at: LAUNCHED_AT_MS / 1000,
            },
        ),
    ] {
        let first = harness(Options::default())?;
        launch(&first).await?;
        let root = Arc::clone(&first.root);
        first.close().await;
        let restarted = harness(Options {
            root: Some(root),
            ..Options::default()
        })?;
        restarted.service.load().await?;
        let task = BackgroundTaskId::parse(TASK).ok_or("task id")?;
        let session = restarted
            .service
            .background_task_thread(&id(THREAD)?, &task)
            .await?
            .sessions
            .into_iter()
            .next()
            .ok_or("no session file")?;
        if let Some(started_at_ms) = holder {
            restarted
                .running
                .add_started(&session.session_id, started_at_ms);
        }
        assert_eq!(read_state(&restarted).await?, expected, "{holder:?}");
        restarted.close().await;
    }
    Ok(())
}

#[tokio::test]
async fn an_unreadable_process_list_keeps_a_launch_running_until_it_can_be_read() -> TestResult {
    let first = harness(Options::default())?;
    launch(&first).await?;
    let root = Arc::clone(&first.root);
    first.close().await;
    let restarted = harness(Options {
        root: Some(root),
        ..Options::default()
    })?;
    restarted.service.load().await?;
    restarted.running.fail(true);
    assert_eq!(
        read_state(&restarted).await?,
        BackgroundCommandState::Running
    );
    // Readable again: no process holds the session, so the task stopped, and
    // every later read answers the same stop.
    restarted.running.fail(false);
    let stopped = BackgroundCommandState::Stopped {
        ended_at: LAUNCHED_AT_MS / 1000,
    };
    tokio::time::sleep(std::time::Duration::from_millis(2_100)).await;
    assert_eq!(read_state(&restarted).await?, stopped);
    assert_eq!(read_state(&restarted).await?, stopped);
    restarted.close().await;
    Ok(())
}

#[tokio::test]
async fn the_running_list_holds_a_launch_until_its_report_ends_it() -> TestResult {
    let harness = harness(Options::default())?;
    let query = launch(&harness).await?;
    let running = harness
        .service
        .running_background_tasks(&id(THREAD)?)
        .await?;
    let listed = running
        .iter()
        .filter_map(|task| match task {
            RunningBackgroundTask::Task {
                item_id,
                command,
                background,
                ..
            } => Some((
                item_id.as_str().to_owned(),
                command.clone(),
                background.task_id.clone(),
                background.description.clone(),
                background.state,
            )),
            RunningBackgroundTask::Terminal { .. } => None,
        })
        .collect::<Vec<_>>();
    assert_eq!(
        listed,
        [(
            "toolu_bg".to_owned(),
            "npm test".to_owned(),
            TASK.to_owned(),
            None,
            BackgroundCommandState::Running,
        )]
    );
    let launch_turn = harness
        .events()
        .into_iter()
        .find_map(|event| match event {
            AgentEvent::ItemCompleted { turn_id, item, .. }
                if item.item_id().as_str() == "toolu_bg" =>
            {
                Some(turn_id)
            }
            _ => None,
        })
        .ok_or("launch item")?;
    assert!(matches!(
        running.first(),
        Some(RunningBackgroundTask::Task { turn_id, .. }) if *turn_id == launch_turn
    ));

    query
        .push(
            json!({"type": "system", "subtype": "task_notification", "task_id": TASK,
            "tool_use_id": "toolu_bg", "status": "completed"}),
        )
        .await;
    settle().await;
    assert!(
        harness
            .service
            .running_background_tasks(&id(THREAD)?)
            .await?
            .is_empty()
    );
    harness.close().await;
    Ok(())
}

/// What `claude` 2.1.319 sends live when it resumes a session whose previous
/// process died with a background command running: one report per
/// orphaned task (its launch's tool call, `stopped`) and never one for the
/// summary Claude stores beside them.
fn orphan_report(task_id: &str) -> serde_json::Value {
    json!({"type": "system", "subtype": "task_notification", "task_id": task_id,
        "tool_use_id": "toolu_bg", "status": "stopped", "output_file": "",
        "summary": "Orphaned by a previous Claude Code process exit and reported in an aggregate summary."})
}

#[tokio::test]
async fn after_a_restart_a_resumed_session_ends_the_earlier_process_launches() -> TestResult {
    let first = harness(Options::default())?;
    launch(&first).await?;
    let root = Arc::clone(&first.root);
    first.close().await;

    // The companion restarted (its `claude` died with the task) an hour
    // after the launch; the person writes again and the session resumes.
    let resumed_at_ms = LAUNCHED_AT_MS + 3_600_000;
    let restarted = harness(Options {
        root: Some(root),
        clock_ms: resumed_at_ms,
        minted_ids: 1_000,
        ..Options::default()
    })?;
    restarted.service.load().await?;
    start(&restarted.service, THREAD, "Why did it stop?").await?;
    let query = restarted.runtime.query(0)?;
    query.push(frames::init()).await;
    settle().await;

    // Before Claude reports it: the open query is a later process
    // generation, so the earlier launch is no longer running anywhere.
    let ended = BackgroundCommandState::Stopped {
        ended_at: resumed_at_ms / 1000,
    };
    assert_eq!(read_state(&restarted).await?, ended);
    assert!(
        restarted
            .service
            .running_background_tasks(&id(THREAD)?)
            .await?
            .is_empty()
    );

    // Claude's live reports: the launching item, in its own older turn,
    // is republished with the end; the summary pseudo id reports nothing.
    query.push(orphan_report(TASK)).await;
    query.push(orphan_report("__orphan_summary__:shell")).await;
    settle().await;
    let republished = restarted
        .events()
        .into_iter()
        .filter_map(|event| match event {
            AgentEvent::ItemCompleted { item, .. } => match item {
                AgentItem::Command {
                    background: Some(background),
                    ..
                } => Some((background.task_id, background.state)),
                AgentItem::TaskNotification { task_id, .. } => Some((task_id, ended)),
                _ => None,
            },
            _ => None,
        })
        .collect::<Vec<_>>();
    assert!(
        republished
            .iter()
            .any(|(task_id, state)| task_id == TASK && state.has_ended()),
        "{republished:?}"
    );
    assert!(
        republished
            .iter()
            .all(|(task_id, _)| !task_id.starts_with("__orphan_summary__")),
        "{republished:?}"
    );
    assert!(
        restarted
            .service
            .running_background_tasks(&id(THREAD)?)
            .await?
            .is_empty()
    );
    restarted.close().await;
    Ok(())
}
