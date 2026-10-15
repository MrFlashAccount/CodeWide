//! Live background task reports: when a `task_notification` frame becomes a
//! `taskNotification` item (wake, mid-turn, once), and when it does not (a
//! foreground call still open, a sub-agent's own task, a query that ended).

use std::collections::HashSet;

use agent_core::model::{
    AgentEvent, AgentItem, AgentTurn, MessagePhase, SubagentStatus, TaskNotificationDelivery,
    TaskNotificationSource, TaskNotificationStatus, TurnOrigin,
};
use serde_json::{Value, json};

use super::{
    Harness, Options, TERMINAL, THREAD, TestResult, create_thread, frames, harness, settle, start,
    stored_answer, stored_prompt, threads::turns_params, write_session,
};

fn task_started(fields: &Value) -> Value {
    let mut frame = json!({"type": "system", "subtype": "task_started"});
    merge(&mut frame, fields);
    frame
}

fn task_notification(fields: &Value) -> Value {
    let mut frame =
        json!({"type": "system", "subtype": "task_notification", "status": "completed"});
    merge(&mut frame, fields);
    frame
}

fn merge(frame: &mut Value, fields: &Value) {
    if let (Some(frame), Some(fields)) = (frame.as_object_mut(), fields.as_object()) {
        frame.extend(fields.clone());
    }
}

fn tool_result(tool_use_id: &str, text: &str) -> Value {
    json!({"type": "user", "parent_tool_use_id": null, "message": {"role": "user",
        "content": [{"type": "tool_result", "tool_use_id": tool_use_id, "content": text}]}})
}

fn wake_result() -> Value {
    let mut result = frames::result();
    result["origin"] = json!({"kind": "task-notification"});
    result
}

fn types(turn: &AgentTurn) -> Vec<&'static str> {
    turn.items
        .iter()
        .map(|item| match item {
            AgentItem::UserMessage { .. } => "userMessage",
            AgentItem::AgentMessage { .. } => "agentMessage",
            AgentItem::Command { .. } => "command",
            AgentItem::Subagent { .. } => "subagent",
            AgentItem::TaskNotification { .. } => "taskNotification",
            AgentItem::Compaction { .. } => "compaction",
            _ => "other",
        })
        .collect()
}

/// `(delivery, kind, name, status)` of each report of a turn.
fn reports(
    turn: &AgentTurn,
) -> Vec<(
    TaskNotificationDelivery,
    &'static str,
    &str,
    TaskNotificationStatus,
)> {
    turn.items
        .iter()
        .filter_map(|item| match item {
            AgentItem::TaskNotification {
                delivery,
                source,
                name,
                status,
                ..
            } => Some((*delivery, source.kind(), name.as_str(), *status)),
            _ => None,
        })
        .collect()
}

/// Item events outside their turn, or items started twice or never completed.
fn event_violations(events: &[AgentEvent]) -> Vec<String> {
    let mut violations = Vec::new();
    let mut open_turn = None;
    let mut started = HashSet::new();
    let mut completed = HashSet::new();
    for event in events {
        match event {
            AgentEvent::TurnStarted { turn, .. } => open_turn = Some(turn.turn_id.clone()),
            AgentEvent::ItemStarted { turn_id, item, .. } => {
                if open_turn.as_ref() != Some(turn_id) {
                    violations.push(format!("{} started outside its turn", item.item_id()));
                }
                if !started.insert(item.item_id().clone()) {
                    violations.push(format!("{} started twice", item.item_id()));
                }
            }
            AgentEvent::ItemCompleted { turn_id, item, .. } => {
                if open_turn.as_ref() != Some(turn_id) || !started.contains(item.item_id()) {
                    violations.push(format!("{} completed out of order", item.item_id()));
                }
                completed.insert(item.item_id().clone());
            }
            AgentEvent::TurnCompleted { .. } => open_turn = None,
            _ => {}
        }
    }
    violations.extend(
        started
            .difference(&completed)
            .map(|item_id| format!("{item_id} never completed")),
    );
    violations
}

async fn thread() -> Result<Harness, Box<dyn std::error::Error>> {
    let harness = harness(Options::default())?;
    create_thread(&harness.service, THREAD).await?;
    Ok(harness)
}

/// A user turn that starts the background agent `a0000000000000001`
/// ("Review the diff") and ends; the session stays open and idle.
async fn launch_background_agent(
    harness: &Harness,
) -> Result<std::sync::Arc<super::FakeQuery>, Box<dyn std::error::Error>> {
    start(&harness.service, THREAD, "Start an agent").await?;
    let query = harness.runtime.query(0)?;
    query.push(frames::init()).await;
    query
        .push(frames::tool_use(
            "m1",
            "toolu_agent",
            "Agent",
            &json!({"description": "Review the diff", "prompt": "Review it.",
                "run_in_background": true}),
        ))
        .await;
    query
        .push(task_started(&json!({"task_id": "a0000000000000001",
            "task_type": "local_agent", "description": "Review the diff",
            "tool_use_id": "toolu_agent"})))
        .await;
    query
        .push(tool_result(
            "toolu_agent",
            "Async agent launched successfully.",
        ))
        .await;
    query.push(frames::text("m2", "Started.")).await;
    query.push(frames::result()).await;
    settle().await;
    Ok(query)
}

#[tokio::test]
async fn reports_that_arrive_while_idle_lead_the_turn_they_wake_once() -> TestResult {
    let harness = thread().await?;
    let query = launch_background_agent(&harness).await?;
    // Idle: both reports wait for the turn they wake.
    query
        .push(task_notification(&json!({"task_id": "a0000000000000001",
            "tool_use_id": "toolu_agent", "summary": "Two issues.",
            "usage": {"duration_ms": 12_963, "tool_uses": 4, "total_tokens": 900}})))
        .await;
    query
        .push(task_notification(&json!({"task_id": "btest0001",
            "tool_use_id": "toolu_old",
            "summary": "Background command \"npm test\" completed (exit code 0)"})))
        .await;
    settle().await;
    assert_eq!(harness.completions().len(), 1);
    query.push(frames::text("m3", "Both finished.")).await;
    query.push(wake_result()).await;
    settle().await;
    start(&harness.service, THREAD, "Next").await?;
    query.push(frames::text("m4", "Done.")).await;
    query.push(frames::result()).await;
    settle().await;

    let turns = harness.completions();
    assert_eq!(
        turns.iter().map(|turn| turn.origin).collect::<Vec<_>>(),
        [TurnOrigin::User, TurnOrigin::Provider, TurnOrigin::User]
    );
    assert_eq!(
        types(&turns[1]),
        ["taskNotification", "taskNotification", "agentMessage"]
    );
    let AgentItem::TaskNotification {
        source,
        duration_ms,
        tool_uses,
        result,
        ..
    } = &turns[1].items[0]
    else {
        return Err("the wake turn does not lead with the agent's report".into());
    };
    assert_eq!(
        source,
        &TaskNotificationSource::Agent {
            agent_thread_id: agent_core::model::AppThreadId::parse(&format!(
                "{THREAD}:agent:a0000000000000001"
            )),
        }
    );
    // A live report carries no result text.
    assert_eq!(
        (*duration_ms, *tool_uses, result),
        (Some(12_963), Some(4), &None)
    );
    assert_eq!(
        reports(&turns[1]),
        [
            (
                TaskNotificationDelivery::Wake,
                "agent",
                "Review the diff",
                TaskNotificationStatus::Completed
            ),
            (
                TaskNotificationDelivery::Wake,
                "command",
                "npm test",
                TaskNotificationStatus::Completed
            ),
        ]
    );
    assert_eq!(reports(&turns[2]), []);
    // The report of the idle wake does not change the earlier turn's item.
    assert!(turns[0].items.iter().any(|item| matches!(
        item,
        AgentItem::Subagent {
            status: SubagentStatus::Running,
            ..
        }
    )));
    assert_eq!(event_violations(&harness.events()), Vec::<String>::new());
    harness.close().await;
    Ok(())
}

#[tokio::test]
async fn a_report_into_a_running_turn_sits_where_it_arrived_but_not_a_foreground_calls_or_a_sub_agents_own()
-> TestResult {
    let harness = thread().await?;
    start(&harness.service, THREAD, "Work").await?;
    let query = harness.runtime.query(0)?;
    query.push(frames::init()).await;
    query
        .push(frames::tool_use(
            "m1",
            "toolu_fg",
            "Bash",
            &json!({"command": "npm test"}),
        ))
        .await;
    query
        .push(task_started(
            &json!({"task_id": "bfg", "task_type": "local_bash",
            "description": "npm test", "tool_use_id": "toolu_fg"}),
        ))
        .await;
    // A foreground call reports before its result: the result is its outcome.
    query
        .push(task_notification(
            &json!({"task_id": "bfg", "tool_use_id": "toolu_fg", "summary": "npm test"}),
        ))
        .await;
    query.push(tool_result("toolu_fg", "ok")).await;
    // A sub-agent's own task reports to that sub-agent.
    query
        .push(task_started(
            &json!({"task_id": "bnested", "task_type": "local_bash",
            "owned_by_subagent": true, "description": "nested",
            "tool_use_id": "toolu_nested"}),
        ))
        .await;
    query
        .push(task_notification(&json!({"task_id": "bnested",
            "tool_use_id": "toolu_nested", "summary": "nested"})))
        .await;
    query
        .push(task_started(
            &json!({"task_id": "bdeep", "task_type": "local_agent",
            "spawn_depth": 2, "description": "deep", "tool_use_id": "toolu_deep"}),
        ))
        .await;
    query
        .push(task_notification(
            &json!({"task_id": "bdeep", "tool_use_id": "toolu_deep", "summary": "deep"}),
        ))
        .await;
    query
        .push(frames::text("m2", "Waiting for the watcher."))
        .await;
    query
        .push(task_notification(
            &json!({"task_id": "bwatch", "tool_use_id": "toolu_watch",
            "status": "failed",
            "summary": "Background command \"npm run watch\" failed with exit code 1"}),
        ))
        .await;
    query.push(frames::result()).await;
    settle().await;

    let turns = harness.completions();
    assert_eq!(turns.len(), 1);
    assert_eq!(
        types(&turns[0]),
        ["userMessage", "command", "agentMessage", "taskNotification"]
    );
    assert_eq!(
        reports(&turns[0]),
        [(
            TaskNotificationDelivery::MidTurn,
            "command",
            "npm run watch",
            TaskNotificationStatus::Failed
        )]
    );
    // The report after the answer does not demote it.
    assert!(turns[0].items.iter().any(|item| matches!(
        item,
        AgentItem::AgentMessage {
            phase: MessagePhase::Final,
            ..
        }
    )));
    assert_eq!(event_violations(&harness.events()), Vec::<String>::new());
    harness.close().await;
    Ok(())
}

#[tokio::test]
async fn reports_waiting_while_idle_follow_the_next_user_turns_prompt() -> TestResult {
    let harness = thread().await?;
    start(&harness.service, THREAD, "First").await?;
    let query = harness.runtime.query(0)?;
    query.push(frames::init()).await;
    query.push(frames::text("m1", "One.")).await;
    query.push(frames::result()).await;
    settle().await;
    query
        .push(task_notification(
            &json!({"task_id": "btest", "tool_use_id": "toolu_old",
            "summary": "Background command \"npm test\" completed (exit code 0)"}),
        ))
        .await;
    settle().await;
    start(&harness.service, THREAD, "Second").await?;
    query.push(frames::text("m2", "Two.")).await;
    query.push(frames::result()).await;
    settle().await;

    let turns = harness.completions();
    assert_eq!(
        turns.iter().map(types).collect::<Vec<_>>(),
        [
            vec!["userMessage", "agentMessage"],
            vec!["userMessage", "taskNotification", "agentMessage"],
        ]
    );
    assert_eq!(
        reports(&turns[1]),
        [(
            TaskNotificationDelivery::MidTurn,
            "command",
            "npm test",
            TaskNotificationStatus::Completed
        )]
    );
    assert_eq!(event_violations(&harness.events()), Vec::<String>::new());
    harness.close().await;
    Ok(())
}

/// History stores a report that waited for `/compact` after the compact
/// boundary; live delivers it there too, not before the compaction.
#[tokio::test]
async fn reports_waiting_for_a_compaction_follow_its_boundary() -> TestResult {
    let harness = thread().await?;
    start(&harness.service, THREAD, "First").await?;
    let query = harness.runtime.query(0)?;
    query.push(frames::init()).await;
    query.push(frames::text("m1", "One.")).await;
    query.push(frames::result()).await;
    settle().await;
    query
        .push(task_notification(
            &json!({"task_id": "btest", "tool_use_id": "toolu_old",
            "summary": "Background command \"npm test\" completed (exit code 0)"}),
        ))
        .await;
    settle().await;
    harness.service.compact(&super::id(THREAD)?).await?;
    settle().await;
    query
        .push(json!({"type": "system", "subtype": "status", "status": "compacting"}))
        .await;
    query
        .push(json!({"type": "system", "subtype": "compact_boundary",
            "uuid": "c0de0c0d-5e55-4c0a-9a7c-00000000b0d1"}))
        .await;
    query.push(frames::result()).await;
    settle().await;

    let turns = harness.completions();
    assert_eq!(
        turns.iter().map(types).collect::<Vec<_>>(),
        [
            vec!["userMessage", "agentMessage"],
            vec!["compaction", "taskNotification"],
        ]
    );
    assert_eq!(
        reports(&turns[1]),
        [(
            TaskNotificationDelivery::MidTurn,
            "command",
            "npm test",
            TaskNotificationStatus::Completed
        )]
    );
    assert_eq!(event_violations(&harness.events()), Vec::<String>::new());
    harness.close().await;
    Ok(())
}

#[tokio::test]
async fn reports_waiting_when_the_query_ends_are_dropped() -> TestResult {
    let harness = thread().await?;
    start(&harness.service, THREAD, "First").await?;
    let query = harness.runtime.query(0)?;
    query.push(frames::init()).await;
    query.push(frames::text("m1", "One.")).await;
    query.push(frames::result()).await;
    settle().await;
    query
        .push(task_notification(&json!({"task_id": "btest",
            "summary": "Background command \"npm test\" completed (exit code 0)"})))
        .await;
    query.end().await;
    settle().await;
    start(&harness.service, THREAD, "Second").await?;
    let resumed = harness.runtime.query(1)?;
    resumed.push(frames::init()).await;
    resumed.push(frames::text("m2", "Two.")).await;
    resumed.push(frames::result()).await;
    settle().await;

    let turns = harness.completions();
    assert_eq!(
        turns.iter().map(types).collect::<Vec<_>>(),
        [
            vec!["userMessage", "agentMessage"],
            vec!["userMessage", "agentMessage"],
        ]
    );
    harness.close().await;
    Ok(())
}

/// A terminal session whose first turn starts a background agent and whose
/// second the agent's report woke, read as a `summary` page: the launch and
/// the report stay beside the messages, other activity does not.
#[tokio::test]
async fn a_summary_history_page_keeps_agent_launches_and_task_reports() -> TestResult {
    let harness = harness(Options::default())?;
    let row = |uuid: &str, kind: &str, message: Value| {
        json!({"type": kind, "uuid": uuid, "sessionId": TERMINAL,
            "timestamp": "2026-10-01T10:00:02.000Z", "isSidechain": false, "message": message})
    };
    let mut wake = row(
        "n-1",
        "user",
        json!({"role": "user", "content": "<task-notification>\n<task-id>a0000000000000001</task-id>\n<tool-use-id>toolu_agent</tool-use-id>\n<status>completed</status>\n<summary>Agent \"Review the diff\" finished</summary>\n<result>Two issues.</result>\n</task-notification>"}),
    );
    wake["origin"] = json!({"kind": "task-notification"});
    write_session(
        &harness.projects(),
        "/repo",
        TERMINAL,
        &[
            stored_prompt(
                TERMINAL,
                "/repo",
                "p-1",
                "Review the diff in the background.",
            ),
            row(
                "a-1",
                "assistant",
                json!({"id": "msg_a-1", "role": "assistant", "content": [{"type": "tool_use",
                    "id": "toolu_agent", "name": "Agent", "input": {"description": "Review the diff",
                    "prompt": "Review it.", "run_in_background": true}}]}),
            ),
            row(
                "r-1",
                "user",
                json!({"role": "user", "content": [{"type": "tool_result",
                    "tool_use_id": "toolu_agent", "content": "Async agent launched successfully."}]}),
            ),
            row(
                "a-2",
                "assistant",
                json!({"id": "msg_a-2", "role": "assistant", "content": [{"type": "tool_use",
                    "id": "toolu_ls", "name": "Bash", "input": {"command": "ls"}}]}),
            ),
            row(
                "r-2",
                "user",
                json!({"role": "user", "content": [{"type": "tool_result",
                    "tool_use_id": "toolu_ls", "content": "src"}]}),
            ),
            stored_answer(TERMINAL, "a-3", "Started.", "claude-sonnet-4-6"),
            wake,
            stored_answer(TERMINAL, "a-4", "It found two issues.", "claude-sonnet-4-6"),
        ],
        1_760_000_200_000,
    )?;
    let mut params = turns_params(TERMINAL)?;
    params.items_view = agent_core::model::ItemsView::Summary;
    let (page, _) = harness.service.turns(params, false).await?;
    assert_eq!(
        page.turns.iter().map(types).collect::<Vec<_>>(),
        [
            vec!["userMessage", "subagent", "agentMessage"],
            vec!["taskNotification", "agentMessage"],
        ]
    );
    harness.close().await;
    Ok(())
}
