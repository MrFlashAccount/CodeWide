//! Background task output reads over a live thread: the thread's own launch
//! makes a task readable, the live session says it runs until its report,
//! pages follow each other across multibyte characters, and a task the
//! thread never started, an id that could name another file and output that
//! is gone are rejected.

use std::{os::unix::fs::MetadataExt, path::PathBuf};

use agent_core::model::{
    BackgroundTaskReadResult, BackgroundTaskStatus, ERROR_BACKGROUND_TASK_UNAVAILABLE, RpcError,
    SortDirection,
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
