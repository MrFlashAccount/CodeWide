//! Shell calls as `command` items: `Monitor` from its start, a `TaskStop`
//! of a shell task once its result names the task type, and the turn events
//! a client applies for them. Result shapes are copied from recorded Claude
//! output (`fixtures/replay/claude_background_monitor_wake.ndjson`, the
//! `TaskStop` results of the `claude_background_*` fixtures, and a stored
//! session's `TaskStop` of a `local_bash` task).

use agent_core::model::{
    AgentEvent, AgentItem, AppThreadId, CallStatus, ExecutionStatus, TurnId, TurnOrigin,
};
use serde_json::{Value, json};

use super::{
    builder::{TurnBuilder, TurnBuilderContext},
    frames::{ToolResultBlock, classify_frame},
    tools::{ToolCallInput, ToolContext, ToolOutcome, complete_item, start_item},
};

type TestResult = Result<(), Box<dyn std::error::Error>>;

const MONITOR_RESULT_TEXT: &str = "Monitor started (task b1htjkjev, expires in 30s unless the source ends first). You will be notified on each event.";
const STOP_MESSAGE: &str = "Successfully stopped task: b7xgfisfw (sleep 100)";

fn call(id: &str, name: &str, input: &Value) -> ToolCallInput {
    ToolCallInput {
        id: id.into(),
        input: input.as_object().cloned().unwrap_or_default(),
        name: name.into(),
    }
}

fn started(call: &ToolCallInput) -> Result<AgentItem, &'static str> {
    start_item(
        call,
        &ToolContext {
            cwd: "/w",
            mcp_servers: &[],
        },
    )
    .ok_or("no started item")
}

fn completed(
    call: &ToolCallInput,
    text: &str,
    is_error: bool,
    structured: &Value,
) -> Result<AgentItem, &'static str> {
    let thread = AppThreadId::from_static("thread");
    let result = ToolResultBlock {
        blocks: Vec::new(),
        is_error,
        text: text.into(),
        tool_use_id: call.id.clone(),
    };
    Ok(complete_item(
        started(call)?,
        call,
        &ToolOutcome {
            app_thread_id: &thread,
            cwd: "/w",
            duration_ms: 4,
            started_at_ms: 1_760_000_100_000,
            result: &result,
            status: if is_error {
                ExecutionStatus::Failed
            } else {
                ExecutionStatus::Completed
            },
            tool_use_result: structured,
        },
    ))
}

fn monitor() -> ToolCallInput {
    call(
        "toolu_monitor",
        "Monitor",
        &json!({"description": "Background monitor test",
            "command": "sleep 8 && echo MONITOR_DONE", "timeout_ms": 30000}),
    )
}

fn task_stop() -> ToolCallInput {
    call("toolu_stop", "TaskStop", &json!({"task_id": "b7xgfisfw"}))
}

fn stopped(task_type: &str, command: &str) -> Value {
    json!({"message": STOP_MESSAGE, "task_id": "b7xgfisfw", "task_type": task_type,
        "command": command})
}

#[test]
fn a_monitor_call_is_a_command_naming_the_task_it_started() -> TestResult {
    let call = monitor();
    match started(&call)? {
        AgentItem::Command {
            command, status, ..
        } => {
            assert_eq!(command, "sleep 8 && echo MONITOR_DONE");
            assert_eq!(status, ExecutionStatus::InProgress);
        }
        other => return Err(format!("started as {other:?}").into()),
    }
    let item = completed(
        &call,
        MONITOR_RESULT_TEXT,
        false,
        &json!({"taskId": "b1htjkjev", "timeoutMs": 30000, "persistent": false}),
    )?;
    let AgentItem::Command {
        command,
        cwd,
        status,
        output,
        background,
        ..
    } = item
    else {
        return Err("not a command".into());
    };
    assert_eq!(command, "sleep 8 && echo MONITOR_DONE");
    assert_eq!(cwd, "/w");
    assert_eq!(status, ExecutionStatus::Completed);
    assert_eq!(output.as_deref(), Some(MONITOR_RESULT_TEXT));
    // A launch runs until a report or the live session says otherwise.
    assert_eq!(
        background,
        Some(agent_core::model::BackgroundCommand {
            task_id: "b1htjkjev".into(),
            started_at: 1_760_000_100,
            description: Some("Background monitor test".into()),
            state: agent_core::model::BackgroundCommandState::Running,
        })
    );
    Ok(())
}

#[test]
fn a_monitor_result_without_a_valid_task_id_names_no_task() -> TestResult {
    let call = monitor();
    for structured in [
        json!({"taskId": "../../etc/passwd"}),
        // A `Bash` result's field is not a `Monitor`'s.
        json!({"backgroundTaskId": "b1htjkjev"}),
        Value::Null,
    ] {
        assert!(matches!(
            completed(&call, MONITOR_RESULT_TEXT, false, &structured)?,
            AgentItem::Command {
                background: None,
                ..
            }
        ));
    }
    Ok(())
}

#[test]
fn stopping_a_shell_task_completes_as_the_stopped_command() -> TestResult {
    let call = task_stop();
    assert!(matches!(started(&call)?, AgentItem::ToolCall { .. }));
    let item = completed(
        &call,
        "{\"message\":\"...\"}",
        false,
        &stopped("local_bash", "sleep 100"),
    )?;
    let AgentItem::Command {
        item_id,
        command,
        cwd,
        status,
        output,
        exit_code,
        background,
        ..
    } = item
    else {
        return Err("not a command".into());
    };
    assert_eq!(item_id.as_str(), "toolu_stop");
    assert_eq!(command, "sleep 100");
    assert_eq!(cwd, "/w");
    assert_eq!(status, ExecutionStatus::Completed);
    assert_eq!(output.as_deref(), Some(STOP_MESSAGE));
    // The stopped command's exit code is unknown, and the stop did not
    // start the task, so the item does not claim it.
    assert_eq!(exit_code, None);
    assert_eq!(background, None);
    Ok(())
}

#[test]
fn stopping_a_sub_agent_or_failing_to_stop_stays_a_tool_call() -> TestResult {
    let call = task_stop();
    let agent = completed(
        &call,
        "stopped Agent B",
        false,
        &stopped("local_agent", "Agent B"),
    )?;
    assert!(matches!(
        agent,
        AgentItem::ToolCall {
            ref tool,
            status: CallStatus::Completed,
            ref output,
            ..
        } if tool == "TaskStop" && output.as_deref() == Some("stopped Agent B")
    ));
    let failed = completed(
        &call,
        "No task found with ID: b7xgfisfw",
        true,
        &Value::Null,
    )?;
    assert!(matches!(
        failed,
        AgentItem::ToolCall {
            status: CallStatus::Failed,
            ..
        }
    ));
    // A shell task's result without its command names nothing to show.
    let nameless = completed(&call, "stopped", false, &stopped("local_bash", ""))?;
    assert!(matches!(nameless, AgentItem::ToolCall { .. }));
    Ok(())
}

#[test]
fn only_a_task_stop_result_turns_a_tool_call_into_a_command() -> TestResult {
    let call = call("toolu_out", "TaskOutput", &json!({"task_id": "b7xgfisfw"}));
    assert!(matches!(
        completed(&call, "output", false, &stopped("local_bash", "sleep 100"))?,
        AgentItem::ToolCall { .. }
    ));
    Ok(())
}

/// A live turn: the stop starts as a tool call and completes, same item id,
/// as a command; the turn ends with the command.
#[test]
fn a_turn_completes_the_stop_of_a_shell_task_as_a_command() {
    let mut builder = TurnBuilder::new(TurnBuilderContext {
        app_thread_id: AppThreadId::from_static("thread"),
        cwd: "/w".into(),
        now_ms: 0,
        origin: TurnOrigin::User,
        turn_id: TurnId::from_static("turn"),
    });
    let mut events = builder.begin(None);
    events.extend(builder.on_frame(&classify_frame(&json!({
        "type": "assistant",
        "message": {"id": "msg_1", "role": "assistant", "content": [
            {"type": "tool_use", "id": "toolu_stop", "name": "TaskStop",
                "input": {"task_id": "b7xgfisfw"}}]},
        "parent_tool_use_id": null}))));
    events.extend(builder.on_frame(&classify_frame(&json!({
        "type": "user",
        "message": {"role": "user", "content": [
            {"type": "tool_result", "tool_use_id": "toolu_stop",
                "content": stopped("local_bash", "sleep 100").to_string()}]},
        "parent_tool_use_id": null,
        "tool_use_result": stopped("local_bash", "sleep 100")}))));
    let kinds = events
        .iter()
        .filter_map(|event| match event {
            AgentEvent::ItemStarted { item, .. } => Some(("started", item)),
            AgentEvent::ItemCompleted { item, .. } => Some(("completed", item)),
            _ => None,
        })
        .map(|(phase, item)| {
            let kind = match item {
                AgentItem::ToolCall { .. } => "toolCall",
                AgentItem::Command { .. } => "command",
                _ => "other",
            };
            (phase, item.item_id().as_str().to_owned(), kind)
        })
        .collect::<Vec<_>>();
    assert_eq!(
        kinds,
        [
            ("started", "toolu_stop".to_owned(), "toolCall"),
            ("completed", "toolu_stop".to_owned(), "command"),
        ]
    );
    let turn = builder.snapshot();
    assert!(matches!(
        turn.items.as_slice(),
        [AgentItem::Command { command, .. }] if command == "sleep 100"
    ));
}
