//! Deferred results reach the parent without a task-addressed poll.

use super::*;
use crate::agent::orchestration::task::{DeliveryProgress, ParentDeliveryState, TaskId, TaskState};

async fn delegate_from_claude(harness: &Harness) -> Result<Value, Box<dyn std::error::Error>> {
    let (success, delegated) = call(
        &harness.service,
        "claude",
        CLAUDE_PARENT,
        "codewide_delegate_task",
        json!({"prompt": "inspect", "provider": "codex",
            "model": "gpt-6.1-sol", "waitMode": "deferred"}),
    )
    .await;
    assert!(success, "{delegated}");
    Ok(delegated)
}

async fn record_child_turn(
    harness: &Harness,
    delegated: &Value,
    status: TurnStatus,
) -> Result<(AppThreadId, TurnId), Box<dyn std::error::Error>> {
    let id = TaskId::parse(delegated["taskId"].as_str().ok_or("task id")?).ok_or("invalid task")?;
    let bundle = tokio::time::timeout(Duration::from_secs(5), async {
        loop {
            let bundle = harness.service.task_journal.get(&id).await?;
            if bundle.attempt.state.provider_turn_id().is_some() {
                return Ok::<_, Box<dyn std::error::Error>>(bundle);
            }
            tokio::task::yield_now().await;
        }
    })
    .await??;
    let child = bundle
        .attempt
        .state
        .child_thread_id()
        .ok_or("missing child")?;
    let turn = bundle
        .attempt
        .state
        .provider_turn_id()
        .ok_or("missing turn")?;
    harness.codex.set_status(child.as_str(), ThreadStatus::Idle);
    harness.codex.set_turns(
        child.as_str(),
        vec![AgentTurn {
            turn_id: turn.clone(),
            status,
            origin: TurnOrigin::User,
            started_at: 1,
            completed_at: Some(2),
            error: None,
            provenance: None,
            usage: None,
            items: vec![AgentItem::AgentMessage {
                item_id: ItemId::from_static("answer"),
                provenance: None,
                text: match status {
                    TurnStatus::Completed => "The cargo build passed.",
                    TurnStatus::Failed => "The build failed.",
                    TurnStatus::Interrupted => "The build was interrupted.",
                    TurnStatus::InProgress => "Still building.",
                }
                .into(),
                phase: MessagePhase::Final,
            }],
        }],
    );
    Ok((child.clone(), turn.clone()))
}

async fn finish_child(harness: &Harness, delegated: &Value, status: TurnStatus) -> TestResult {
    let (child, turn) = record_child_turn(harness, delegated, status).await?;
    let end = match status {
        TurnStatus::Completed => "completed",
        TurnStatus::Failed => "failed",
        TurnStatus::Interrupted => "interrupted",
        TurnStatus::InProgress => return Err("fixture must be terminal".into()),
    };
    harness.service.observe_event(
        &ProviderId::from_static("codex"),
        &completed(child.as_str(), turn.as_str(), end),
    );
    Ok(())
}

async fn parent_message(harness: &Harness) -> Result<String, Box<dyn std::error::Error>> {
    tokio::time::timeout(Duration::from_secs(8), async {
        loop {
            if let Some(started) = harness
                .claude
                .started()
                .into_iter()
                .find(|started| started.app_thread_id.as_str() == CLAUDE_PARENT)
            {
                let text = started
                    .input
                    .iter()
                    .filter_map(|input| {
                        if let crate::agent::model::UserContent::Text { text, .. } = input {
                            Some(text.as_str())
                        } else {
                            None
                        }
                    })
                    .collect::<String>();
                return Ok::<_, Box<dyn std::error::Error>>(text);
            }
            tokio::task::yield_now().await;
        }
    })
    .await?
}

#[tokio::test]
async fn a_deferred_codex_result_is_pushed_to_its_claude_parent_without_wait_task() -> TestResult {
    let harness = harness(":workspace").await?;
    let delegated = delegate_from_claude(&harness).await?;
    finish_child(&harness, &delegated, TurnStatus::Completed).await?;
    let message = parent_message(&harness).await?;
    assert!(message.contains(delegated["taskId"].as_str().ok_or("task id")?));
    assert!(message.contains("succeeded"));
    assert!(message.contains("The cargo build passed."));
    let task =
        TaskId::parse(delegated["taskId"].as_str().ok_or("task id")?).ok_or("invalid task")?;
    assert_eq!(
        harness.service.task_journal.get(&task).await?.task.state,
        TaskState::Succeeded
    );
    Ok(())
}

async fn queued_completion(harness: &Harness, task_id: &TaskId) -> TestResult {
    tokio::time::timeout(Duration::from_secs(5), async {
        loop {
            let bundle = harness.service.task_journal.get(task_id).await?;
            if bundle.delivery.progress
                == (DeliveryProgress::ParentTurn {
                    state: ParentDeliveryState::Enqueued,
                })
            {
                let command = harness
                    .service
                    .turn_delivery
                    .command(&bundle.delivery.dedupe_key)
                    .await?
                    .ok_or("missing notification")?;
                assert_eq!(command.remote_thread_id, CLAUDE_PARENT);
                // A nonzero retry time proves the pump checked the active parent.
                if command.next_attempt_at != 0 {
                    assert_eq!(command.state, crate::store::OutboxState::Queued);
                    return Ok::<_, Box<dyn std::error::Error>>(());
                }
            }
            tokio::task::yield_now().await;
        }
    })
    .await?
}

#[tokio::test]
async fn completion_waits_for_a_busy_parent_then_starts_without_a_poll() -> TestResult {
    let harness = harness(":workspace").await?;
    harness
        .claude
        .set_status(CLAUDE_PARENT, ThreadStatus::Active);
    let delegated = delegate_from_claude(&harness).await?;
    finish_child(&harness, &delegated, TurnStatus::Completed).await?;
    let task_id =
        TaskId::parse(delegated["taskId"].as_str().ok_or("task id")?).ok_or("invalid task")?;
    queued_completion(&harness, &task_id).await?;
    assert!(harness.claude.started().is_empty());
    harness.claude.set_status(CLAUDE_PARENT, ThreadStatus::Idle);
    harness.service.observe_event(
        &ProviderId::from_static("claude"),
        &completed(CLAUDE_PARENT, "parent-turn", "completed"),
    );
    assert!(
        parent_message(&harness)
            .await?
            .contains("The cargo build passed.")
    );
    Ok(())
}

#[tokio::test]
async fn failed_and_cancelled_children_push_their_terminal_outcomes() -> TestResult {
    for (status, outcome, answer) in [
        (TurnStatus::Failed, "failed", "The build failed."),
        (
            TurnStatus::Interrupted,
            "cancelled",
            "The build was interrupted.",
        ),
    ] {
        let harness = harness(":workspace").await?;
        let delegated = delegate_from_claude(&harness).await?;
        finish_child(&harness, &delegated, status).await?;
        let message = parent_message(&harness).await?;
        let (_, payload) = message.split_once('\n').ok_or("missing result JSON")?;
        let payload: Value = serde_json::from_str(payload)?;
        assert_eq!(payload["status"], outcome);
        assert_eq!(payload["finalMessage"], answer);
    }
    Ok(())
}

#[tokio::test]
async fn replayed_completion_does_not_enqueue_or_start_a_second_parent_turn() -> TestResult {
    let harness = harness(":workspace").await?;
    let delegated = delegate_from_claude(&harness).await?;
    finish_child(&harness, &delegated, TurnStatus::Completed).await?;
    parent_message(&harness).await?;
    let task_id =
        TaskId::parse(delegated["taskId"].as_str().ok_or("task id")?).ok_or("invalid task")?;
    finish_child(&harness, &delegated, TurnStatus::Completed).await?;
    assert!(matches!(
        harness.service.push_completion(&task_id).await,
        Ok(true)
    ));
    assert_eq!(
        harness
            .service
            .turn_delivery
            .list(Some(CLAUDE_PARENT))
            .await?
            .len(),
        1
    );
    assert_eq!(harness.claude.started().len(), 1);
    Ok(())
}

#[tokio::test]
async fn a_terminal_event_waits_for_final_history_then_pushes_without_another_event() -> TestResult
{
    let harness = harness(":workspace").await?;
    let delegated = delegate_from_claude(&harness).await?;
    let (child, turn) = record_child_turn(&harness, &delegated, TurnStatus::InProgress).await?;
    harness.service.observe_event(
        &ProviderId::from_static("codex"),
        &completed(child.as_str(), turn.as_str(), "completed"),
    );
    let task_id =
        TaskId::parse(delegated["taskId"].as_str().ok_or("task id")?).ok_or("invalid task")?;
    tokio::time::timeout(Duration::from_secs(5), async {
        loop {
            if harness
                .service
                .task_journal
                .get(&task_id)
                .await?
                .task
                .state
                .is_terminal()
            {
                return Ok::<_, Box<dyn std::error::Error>>(());
            }
            tokio::task::yield_now().await;
        }
    })
    .await??;
    assert!(matches!(
        harness.service.push_completion(&task_id).await,
        Ok(false)
    ));
    assert!(harness.claude.started().is_empty());
    record_child_turn(&harness, &delegated, TurnStatus::Completed).await?;
    let message = parent_message(&harness).await?;
    assert!(message.contains("The cargo build passed."));
    assert!(!message.contains("Still building."));
    Ok(())
}
