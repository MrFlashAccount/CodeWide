//! A sub-agent's `can_use_tool` request (`agent_id`): its call is the
//! sub-agent's item, never one of the conversation's turn, and it wakes a
//! provider turn only when the user must answer it.

use std::sync::Arc;

use agent_core::model::{
    AgentEvent, AgentItem, ApprovalDecision, RequestRespondParams, RuntimeResponse,
    ThreadCreateParams, TurnOrigin,
};
use serde_json::{Value, json};

use super::{
    FakeQuery, Harness, Options, THREAD, TestResult, frames, harness, id, settings, settle, start,
};
use crate::cli::protocol::ControlRequest;

const AGENT_ID: &str = "a0000000000000001";
const SUBAGENT_CALL: &str = "toolu_subagent_bash";

async fn thread(permission_profile: &str) -> Result<Harness, Box<dyn std::error::Error>> {
    let harness = harness(Options::default())?;
    harness
        .service
        .create(ThreadCreateParams {
            app_thread_id: Some(id(THREAD)?),
            cwd: "/workspace".into(),
            settings: settings(permission_profile),
            client_tools: None,
        })
        .await?;
    Ok(harness)
}

/// A user turn that starts a background agent and ends; the session stays
/// open and idle while the agent works.
async fn launch_background_agent(
    harness: &Harness,
) -> Result<Arc<FakeQuery>, Box<dyn std::error::Error>> {
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
        .push(
            json!({"type": "system", "subtype": "task_started", "task_id": AGENT_ID,
            "task_type": "local_agent", "description": "Review the diff",
            "tool_use_id": "toolu_agent"}),
        )
        .await;
    query
        .push(
            json!({"type": "user", "parent_tool_use_id": null, "message": {"role": "user",
            "content": [{"type": "tool_result", "tool_use_id": "toolu_agent",
                "content": "Async agent launched successfully."}]}}),
        )
        .await;
    query.push(frames::text("m2", "Started.")).await;
    query.push(frames::result()).await;
    settle().await;
    Ok(query)
}

/// The sub-agent's shell call: Claude asks for it, then streams the call
/// and its result under the spawning call, as it does for every sub-agent.
async fn subagent_runs_a_command(query: &FakeQuery) {
    query
        .request(
            "subagent-request-1",
            ControlRequest::CanUseTool {
                tool_name: "Bash".into(),
                input: json!({"command": "git status"})
                    .as_object()
                    .cloned()
                    .unwrap_or_default(),
                tool_use_id: Some(SUBAGENT_CALL.into()),
                decision_reason: None,
                suggestions: Vec::new(),
                agent_id: Some(AGENT_ID.into()),
            },
        )
        .await;
    settle().await;
}

async fn subagent_command_returns(query: &FakeQuery) {
    query
        .push(
            json!({"type": "assistant", "parent_tool_use_id": "toolu_agent",
            "message": {"id": "sub-m1", "role": "assistant", "content": [{"type": "tool_use",
                "id": SUBAGENT_CALL, "name": "Bash", "input": {"command": "git status"}}]}}),
        )
        .await;
    query
        .push(json!({"type": "user", "parent_tool_use_id": "toolu_agent",
            "message": {"role": "user", "content": [{"type": "tool_result",
                "tool_use_id": SUBAGENT_CALL, "content": "clean"}]}}))
        .await;
    settle().await;
}

/// The agent reports and the conversation answers in the turn the report wakes.
async fn agent_reports(query: &FakeQuery) {
    query
        .push(
            json!({"type": "system", "subtype": "task_notification", "status": "completed",
            "task_id": AGENT_ID, "tool_use_id": "toolu_agent", "summary": "No issues."}),
        )
        .await;
    query
        .push(frames::text("m3", "The review found nothing."))
        .await;
    let mut wake_result = frames::result();
    wake_result["origin"] = json!({"kind": "task-notification"});
    query.push(wake_result).await;
    settle().await;
}

fn allowed(answers: &[(String, Result<Value, String>)], request_id: &str) -> bool {
    answers.iter().any(|(id, outcome)| {
        id == request_id
            && outcome
                .as_ref()
                .is_ok_and(|response| response["behavior"] == "allow")
    })
}

fn turn_starts(events: &[AgentEvent]) -> Vec<TurnOrigin> {
    events
        .iter()
        .filter_map(|event| match event {
            AgentEvent::TurnStarted { turn, .. } => Some(turn.origin),
            _ => None,
        })
        .collect()
}

/// Whether any event or completed turn carries the sub-agent's call as an item.
fn shows_subagent_call(harness: &Harness) -> bool {
    let is_call = |item: &AgentItem| item.item_id().as_str() == SUBAGENT_CALL;
    harness.events().iter().any(|event| match event {
        AgentEvent::ItemStarted { item, .. } | AgentEvent::ItemCompleted { item, .. } => {
            is_call(item)
        }
        AgentEvent::TurnCompleted { turn, .. } => turn.items.iter().any(is_call),
        _ => false,
    })
}

#[tokio::test]
async fn an_allowed_subagent_call_while_idle_wakes_no_turn_and_adds_no_item() -> TestResult {
    let harness = thread(":full-access").await?;
    let query = launch_background_agent(&harness).await?;

    subagent_runs_a_command(&query).await;
    assert!(allowed(&query.answers(), "subagent-request-1"));
    // The conversation stays idle while its background agent works.
    assert_eq!(turn_starts(&harness.events()), [TurnOrigin::User]);
    subagent_command_returns(&query).await;
    assert_eq!(turn_starts(&harness.events()), [TurnOrigin::User]);

    agent_reports(&query).await;
    let turns = harness.completions();
    assert_eq!(
        turns.iter().map(|turn| turn.origin).collect::<Vec<_>>(),
        [TurnOrigin::User, TurnOrigin::Provider]
    );
    assert!(
        turns[1]
            .items
            .iter()
            .any(|item| matches!(item, AgentItem::AgentMessage { text, .. } if text == "The review found nothing."))
    );
    assert!(!shows_subagent_call(&harness));
    harness.close().await;
    Ok(())
}

#[tokio::test]
async fn a_subagent_approval_while_idle_wakes_a_turn_for_the_request_only() -> TestResult {
    let harness = thread(":workspace").await?;
    let query = launch_background_agent(&harness).await?;

    subagent_runs_a_command(&query).await;
    let events = harness.events();
    // The user must answer, so a provider turn carries the request.
    assert_eq!(
        turn_starts(&events),
        [TurnOrigin::User, TurnOrigin::Provider]
    );
    let opened = events.iter().find_map(|event| match event {
        AgentEvent::RequestOpened { request_id, .. } => Some(request_id.clone()),
        _ => None,
    });
    let Some(request_id) = opened else {
        return Err("the approval was not opened".into());
    };
    harness
        .service
        .request_respond(RequestRespondParams {
            app_thread_id: id(THREAD)?,
            request_id,
            response: RuntimeResponse::Approval {
                decision: ApprovalDecision::Accept,
            },
        })
        .await?;
    settle().await;
    assert!(allowed(&query.answers(), "subagent-request-1"));

    subagent_command_returns(&query).await;
    agent_reports(&query).await;
    let turns = harness.completions();
    assert_eq!(
        turns.iter().map(|turn| turn.origin).collect::<Vec<_>>(),
        [TurnOrigin::User, TurnOrigin::Provider]
    );
    assert!(!shows_subagent_call(&harness));
    harness.close().await;
    Ok(())
}
