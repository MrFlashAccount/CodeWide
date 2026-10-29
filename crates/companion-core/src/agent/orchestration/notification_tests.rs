//! Child results reach the parent as one hidden notice per settled work
//! request (batched while a notice waits), without a poll by the model.

use redb::ReadableDatabase;

use super::*;
use crate::agent::orchestration::{
    task::{TaskId, TaskState},
    work_requests::{AckSource, ChildWorkRequest, Delivery, RequestPhase, SuppressReason},
};

const CODEX: &str = "codex";
const CLAUDE: &str = "claude";

async fn eventually<T>(
    what: &str,
    mut check: impl AsyncFnMut() -> Result<Option<T>, Box<dyn std::error::Error>>,
) -> Result<T, Box<dyn std::error::Error>> {
    tokio::time::timeout(Duration::from_secs(8), async {
        loop {
            if let Some(value) = check().await? {
                return Ok::<_, Box<dyn std::error::Error>>(value);
            }
            tokio::time::sleep(Duration::from_millis(5)).await;
        }
    })
    .await
    .map_err(|_| format!("timed out waiting for {what}"))?
}

async fn spawn_from_claude(
    harness: &Harness,
    prompt: &str,
) -> Result<AppThreadId, Box<dyn std::error::Error>> {
    let (success, spawned) = call(
        &harness.service,
        CLAUDE,
        CLAUDE_PARENT,
        "codewide_spawn_agent",
        json!({"prompt": prompt, "provider": CODEX, "model": "gpt-6.1-sol", "name": prompt}),
    )
    .await;
    assert!(success, "{spawned}");
    AppThreadId::parse(&agent_id(&spawned)?).ok_or_else(|| "invalid child".into())
}

async fn delegate_from_claude(harness: &Harness) -> Result<Value, Box<dyn std::error::Error>> {
    let (success, delegated) = call(
        &harness.service,
        CLAUDE,
        CLAUDE_PARENT,
        "codewide_delegate_task",
        json!({"prompt": "inspect", "provider": CODEX,
            "model": "gpt-6.1-sol", "waitMode": "deferred"}),
    )
    .await;
    assert!(success, "{delegated}");
    Ok(delegated)
}

/// Every request of a child, settled or not.
fn child_requests(
    harness: &Harness,
    child: &AppThreadId,
) -> Result<Vec<ChildWorkRequest>, Box<dyn std::error::Error>> {
    let read = harness.store.database().begin_read()?;
    let table = read.open_table(crate::store::orchestration_tables::WORK_REQUESTS)?;
    let mut requests = Vec::new();
    for entry in redb::ReadableTable::iter(&table)? {
        let (_, value) = entry?;
        let request: ChildWorkRequest = serde_json::from_slice(value.value())?;
        if request.child_thread_id.as_ref() == Some(child) {
            requests.push(request);
        }
    }
    requests.sort_by_key(|request| request.created_at_ms);
    Ok(requests)
}

/// A running request's turn bound by its receipt, other than `known`.
async fn running_turn(
    harness: &Harness,
    child: &AppThreadId,
    known: &[TurnId],
) -> Result<TurnId, Box<dyn std::error::Error>> {
    eventually("the request's turn", async || {
        let requests = child_requests(harness, child)?;
        Ok(requests.iter().find_map(|request| match &request.phase {
            RequestPhase::Running { turn_id } if !known.contains(turn_id) => Some(turn_id.clone()),
            _ => None,
        }))
    })
    .await
}

fn record_turn(harness: &Harness, child: &AppThreadId, turns: &[(&TurnId, TurnStatus, &str)]) {
    harness.codex.set_turns(
        child.as_str(),
        turns
            .iter()
            .map(|(turn_id, status, text)| AgentTurn {
                turn_id: (*turn_id).clone(),
                status: *status,
                origin: TurnOrigin::User,
                started_at: 1,
                completed_at: Some(2),
                error: None,
                provenance: None,
                usage: None,
                items: vec![AgentItem::AgentMessage {
                    item_id: ItemId::from_static("answer"),
                    provenance: None,
                    text: (*text).into(),
                    phase: MessagePhase::Final,
                }],
            })
            .collect(),
    );
}

fn end(harness: &Harness, child: &AppThreadId, turn: &TurnId, status: &str) {
    harness.service.observe_event(
        &ProviderId::from_static(CODEX),
        &completed(child.as_str(), turn.as_str(), status),
    );
}

/// The model-facing notices the Claude parent received, decoded.
fn notices(harness: &Harness) -> Vec<Value> {
    harness
        .claude
        .started()
        .into_iter()
        .filter(|started| started.app_thread_id.as_str() == CLAUDE_PARENT)
        .filter_map(|started| {
            let text = started
                .input
                .iter()
                .filter_map(|input| match input {
                    crate::agent::model::UserContent::Text { text, .. } => Some(text.as_str()),
                    _ => None,
                })
                .collect::<String>();
            let (_, payload) = text.split_once('\n')?;
            serde_json::from_str(payload).ok()
        })
        .collect()
}

async fn notice_count(
    harness: &Harness,
    count: usize,
) -> Result<Vec<Value>, Box<dyn std::error::Error>> {
    eventually("parent notices", async || {
        let notices = notices(harness);
        Ok((notices.len() >= count).then_some(notices))
    })
    .await
}

/// No further notice arrives during a settle window.
async fn settle_window() {
    tokio::time::sleep(Duration::from_millis(250)).await;
}

#[tokio::test]
async fn a_finished_spawn_sends_exactly_one_notice_to_an_idle_parent() -> TestResult {
    let harness = harness(":workspace").await?;
    let child = spawn_from_claude(&harness, "build").await?;
    let turn = running_turn(&harness, &child, &[]).await?;
    record_turn(
        &harness,
        &child,
        &[(&turn, TurnStatus::Completed, "The cargo build passed.")],
    );
    end(&harness, &child, &turn, "completed");
    let received = notice_count(&harness, 1).await?;
    settle_window().await;
    assert_eq!(notices(&harness).len(), 1);
    let report = &received[0]["reports"][0];
    assert_eq!(received[0]["summary"], "1 agent result");
    assert_eq!(report["status"], "succeeded");
    assert_eq!(report["finalMessage"], "The cargo build passed.");
    assert_eq!(report["agentThreadId"], child.as_str());
    assert_eq!(report["turnId"], turn.as_str());
    // The notice is hidden from every client queue list.
    assert!(
        harness
            .service
            .turn_delivery
            .client_list(Some(CLAUDE_PARENT))
            .await?
            .is_empty()
    );
    Ok(())
}

#[tokio::test]
async fn a_follow_up_gets_its_own_notice_and_the_first_stays_untouched() -> TestResult {
    let harness = harness(":workspace").await?;
    let child = spawn_from_claude(&harness, "build").await?;
    let first = running_turn(&harness, &child, &[]).await?;
    record_turn(
        &harness,
        &child,
        &[(&first, TurnStatus::Completed, "first")],
    );
    end(&harness, &child, &first, "completed");
    notice_count(&harness, 1).await?;
    let first_notice = harness
        .service
        .turn_delivery
        .list(Some(CLAUDE_PARENT))
        .await?;

    let (success, sent) = call(
        &harness.service,
        CLAUDE,
        CLAUDE_PARENT,
        "codewide_send_agent",
        json!({"agentThreadId": child.as_str(), "message": "now test"}),
    )
    .await;
    assert!(success, "{sent}");
    let second = running_turn(&harness, &child, std::slice::from_ref(&first)).await?;
    assert_ne!(second, first);
    record_turn(
        &harness,
        &child,
        &[
            (&first, TurnStatus::Completed, "first"),
            (&second, TurnStatus::Completed, "second"),
        ],
    );
    end(&harness, &child, &second, "completed");
    let received = notice_count(&harness, 2).await?;
    assert_eq!(received[1]["reports"][0]["finalMessage"], "second");
    assert_eq!(received[1]["reports"][0]["turnId"], second.as_str());
    assert_ne!(
        received[0]["reports"][0]["requestId"],
        received[1]["reports"][0]["requestId"]
    );
    let after = harness
        .service
        .turn_delivery
        .list(Some(CLAUDE_PARENT))
        .await?;
    let unchanged = after
        .iter()
        .find(|command| command.command_id == first_notice[0].command_id)
        .ok_or("first notice receipt")?;
    assert_eq!(unchanged.params, first_notice[0].params);
    Ok(())
}

#[tokio::test]
async fn two_queued_follow_ups_are_two_requests_with_notices_in_order() -> TestResult {
    let harness = harness(":workspace").await?;
    let child = spawn_from_claude(&harness, "build").await?;
    let first = running_turn(&harness, &child, &[]).await?;
    for message in ["follow one", "follow two"] {
        let (success, sent) = call(
            &harness.service,
            CLAUDE,
            CLAUDE_PARENT,
            "codewide_send_agent",
            json!({"agentThreadId": child.as_str(), "message": message}),
        )
        .await;
        assert!(success, "{sent}");
        assert_eq!(sent["status"], "queued");
    }
    assert_eq!(child_requests(&harness, &child)?.len(), 3);
    let mut turns = vec![first];
    for index in 0..3 {
        let turn = turns[index].clone();
        let mut history = turns
            .iter()
            .map(|turn| (turn, TurnStatus::Completed, "answer"))
            .collect::<Vec<_>>();
        history.truncate(index + 1);
        record_turn(&harness, &child, &history);
        end(&harness, &child, &turn, "completed");
        if index < 2 {
            let next = running_turn(&harness, &child, &turns).await?;
            turns.push(next);
        }
    }
    let received = notice_count(&harness, 3).await?;
    let delivered_turns = received
        .iter()
        .flat_map(|notice| notice["reports"].as_array().cloned().unwrap_or_default())
        .map(|report| report["turnId"].as_str().unwrap_or_default().to_owned())
        .collect::<Vec<_>>();
    assert_eq!(
        delivered_turns,
        turns
            .iter()
            .map(|turn| turn.as_str().to_owned())
            .collect::<Vec<_>>()
    );
    Ok(())
}

#[tokio::test]
async fn a_steer_joins_the_running_request_and_creates_none() -> TestResult {
    let harness = harness(":workspace").await?;
    let child = spawn_from_claude(&harness, "build").await?;
    running_turn(&harness, &child, &[]).await?;
    let (success, steered) = call(
        &harness.service,
        CLAUDE,
        CLAUDE_PARENT,
        "codewide_send_agent",
        json!({"agentThreadId": child.as_str(), "message": "also lint", "mode": "steer"}),
    )
    .await;
    assert!(success, "{steered}");
    assert_eq!(harness.codex.steered().len(), 1);
    assert_eq!(child_requests(&harness, &child)?.len(), 1);
    Ok(())
}

#[tokio::test]
async fn a_failed_terminal_write_is_reconciled_into_one_notice() -> TestResult {
    let harness = harness(":workspace").await?;
    let child = spawn_from_claude(&harness, "build").await?;
    let turn = running_turn(&harness, &child, &[]).await?;
    record_turn(
        &harness,
        &child,
        &[(&turn, TurnStatus::Completed, "recovered")],
    );
    harness.service.task_journal.fail_next_settle();
    end(&harness, &child, &turn, "completed");
    let received = notice_count(&harness, 1).await?;
    settle_window().await;
    assert_eq!(notices(&harness).len(), 1);
    assert_eq!(received[0]["reports"][0]["finalMessage"], "recovered");
    Ok(())
}

#[tokio::test]
async fn a_turn_that_ended_during_downtime_is_reconciled_at_startup() -> TestResult {
    let harness = harness(":workspace").await?;
    let delegated = delegate_from_claude(&harness).await?;
    let task_id =
        TaskId::parse(delegated["taskId"].as_str().ok_or("task id")?).ok_or("invalid task")?;
    let child = AppThreadId::parse(delegated["agentThreadId"].as_str().ok_or("child")?)
        .ok_or("invalid child")?;
    let turn = running_turn(&harness, &child, &[]).await?;
    // The turn ends while no live event reaches orchestration.
    record_turn(
        &harness,
        &child,
        &[(&turn, TurnStatus::Completed, "done offline")],
    );
    let restarted = rework_tests::restart(&harness);
    let received = notice_count(&harness, 1).await?;
    settle_window().await;
    assert_eq!(notices(&harness).len(), 1);
    assert_eq!(received[0]["reports"][0]["taskId"], task_id.as_str());
    assert_eq!(received[0]["reports"][0]["finalMessage"], "done offline");
    assert_eq!(
        restarted.task_journal.get(&task_id).await?.task.state,
        TaskState::Succeeded
    );
    Ok(())
}

#[tokio::test]
async fn a_busy_parent_gets_the_notice_after_its_turn_and_never_mid_turn() -> TestResult {
    let harness = harness(":workspace").await?;
    harness
        .claude
        .set_status(CLAUDE_PARENT, ThreadStatus::Active);
    let child = spawn_from_claude(&harness, "build").await?;
    let turn = running_turn(&harness, &child, &[]).await?;
    record_turn(
        &harness,
        &child,
        &[(&turn, TurnStatus::Completed, "after the turn")],
    );
    end(&harness, &child, &turn, "completed");
    let queued = eventually("the queued notice", async || {
        let commands = harness
            .service
            .turn_delivery
            .list(Some(CLAUDE_PARENT))
            .await?;
        Ok(commands
            .into_iter()
            .find(|command| command.next_attempt_at != 0))
    })
    .await?;
    assert_eq!(queued.state, crate::store::OutboxState::Queued);
    assert_eq!(
        queued.presentation,
        crate::store::OutboxPresentation::Notice
    );
    assert!(notices(&harness).is_empty());
    assert!(harness.claude.steered().is_empty());
    harness.claude.set_status(CLAUDE_PARENT, ThreadStatus::Idle);
    let received = notice_count(&harness, 1).await?;
    assert_eq!(received[0]["reports"][0]["finalMessage"], "after the turn");
    assert!(harness.claude.steered().is_empty());
    Ok(())
}

#[tokio::test]
async fn an_interrupt_is_pushed_as_interrupted() -> TestResult {
    let harness = harness(":workspace").await?;
    let child = spawn_from_claude(&harness, "build").await?;
    let turn = running_turn(&harness, &child, &[]).await?;
    record_turn(
        &harness,
        &child,
        &[(&turn, TurnStatus::Interrupted, "stopped by the user")],
    );
    end(&harness, &child, &turn, "interrupted");
    let received = notice_count(&harness, 1).await?;
    assert_eq!(received[0]["reports"][0]["status"], "interrupted");
    Ok(())
}

#[tokio::test]
async fn a_cancel_that_sees_the_end_in_time_takes_the_result() -> TestResult {
    let harness = harness(":workspace").await?;
    let delegated = delegate_from_claude(&harness).await?;
    let task_id = delegated["taskId"].as_str().ok_or("task id")?.to_owned();
    let child = AppThreadId::parse(delegated["agentThreadId"].as_str().ok_or("child")?)
        .ok_or("invalid child")?;
    let turn = running_turn(&harness, &child, &[]).await?;
    let service = harness.service.clone();
    let codex = harness.codex.clone();
    let (ender_child, ender_turn) = (child.clone(), turn.clone());
    let ender = tokio::spawn(async move {
        // The provider ends the turn as soon as it receives the interrupt.
        while codex.interrupted().is_empty() {
            tokio::time::sleep(Duration::from_millis(1)).await;
        }
        codex.set_turns(
            ender_child.as_str(),
            vec![AgentTurn {
                turn_id: ender_turn.clone(),
                status: TurnStatus::Interrupted,
                origin: TurnOrigin::User,
                started_at: 1,
                completed_at: Some(2),
                error: None,
                provenance: None,
                usage: None,
                items: Vec::new(),
            }],
        );
        service.observe_event(
            &ProviderId::from_static(CODEX),
            &completed(ender_child.as_str(), ender_turn.as_str(), "interrupted"),
        );
    });
    let (success, cancelled) = call(
        &harness.service,
        CLAUDE,
        CLAUDE_PARENT,
        "codewide_cancel_task",
        json!({"taskId": task_id}),
    )
    .await;
    ender.await?;
    assert!(success, "{cancelled}");
    assert_eq!(cancelled["status"], "cancelled");
    settle_window().await;
    assert!(notices(&harness).is_empty());
    let requests = child_requests(&harness, &child)?;
    assert!(
        matches!(
            requests[0].phase,
            RequestPhase::Settled {
                delivery: Delivery::Acknowledged {
                    by: AckSource::Cancel
                },
                ..
            }
        ),
        "{:?}",
        requests[0].phase
    );
    Ok(())
}

#[tokio::test]
async fn a_late_cancel_end_is_pushed_as_cancelled() -> TestResult {
    let harness = harness(":workspace").await?;
    let child = spawn_from_claude(&harness, "build").await?;
    let turn = running_turn(&harness, &child, &[]).await?;
    let (success, cancelled) = call(
        &harness.service,
        CLAUDE,
        CLAUDE_PARENT,
        "codewide_cancel_agent",
        json!({"agentThreadId": child.as_str()}),
    )
    .await;
    assert!(success, "{cancelled}");
    record_turn(
        &harness,
        &child,
        &[(&turn, TurnStatus::Interrupted, "late")],
    );
    end(&harness, &child, &turn, "interrupted");
    let received = notice_count(&harness, 1).await?;
    assert_eq!(received[0]["reports"][0]["status"], "cancelled");
    Ok(())
}

#[tokio::test]
async fn completion_racing_a_cancel_wins() -> TestResult {
    let harness = harness(":workspace").await?;
    let delegated = delegate_from_claude(&harness).await?;
    let task_id =
        TaskId::parse(delegated["taskId"].as_str().ok_or("task id")?).ok_or("invalid task")?;
    let child = AppThreadId::parse(delegated["agentThreadId"].as_str().ok_or("child")?)
        .ok_or("invalid child")?;
    let turn = running_turn(&harness, &child, &[]).await?;
    let (success, cancelling) = call(
        &harness.service,
        CLAUDE,
        CLAUDE_PARENT,
        "codewide_cancel_task",
        json!({"taskId": task_id.as_str()}),
    )
    .await;
    assert!(success, "{cancelling}");
    assert_eq!(cancelling["status"], "cancelling");
    record_turn(
        &harness,
        &child,
        &[(&turn, TurnStatus::Completed, "finished anyway")],
    );
    end(&harness, &child, &turn, "completed");
    let received = notice_count(&harness, 1).await?;
    assert_eq!(received[0]["reports"][0]["status"], "succeeded");
    assert_eq!(
        harness.service.task_journal.get(&task_id).await?.task.state,
        TaskState::Succeeded
    );
    Ok(())
}

#[tokio::test]
async fn a_wait_that_returns_the_result_is_never_pushed_again() -> TestResult {
    let harness = harness(":workspace").await?;
    let child = spawn_from_claude(&harness, "build").await?;
    let turn = running_turn(&harness, &child, &[]).await?;
    let service = harness.service.clone();
    let wait_child = child.clone();
    let wait = tokio::spawn(async move {
        call(
            &service,
            CLAUDE,
            CLAUDE_PARENT,
            "codewide_wait_agent",
            json!({"agentThreadId": wait_child.as_str(), "timeoutSeconds": 5}),
        )
        .await
    });
    eventually("the waiter", async || {
        Ok(harness
            .service
            .tracker
            .has_waiters(child.as_str())
            .then_some(()))
    })
    .await?;
    record_turn(
        &harness,
        &child,
        &[(&turn, TurnStatus::Completed, "waited")],
    );
    end(&harness, &child, &turn, "completed");
    let (success, waited) = wait.await?;
    assert!(success, "{waited}");
    assert_eq!(waited["status"], "completed");
    settle_window().await;
    settle_window().await;
    assert!(notices(&harness).is_empty());
    Ok(())
}

#[tokio::test]
async fn a_wait_after_enqueue_retracts_the_still_queued_notice() -> TestResult {
    let harness = harness(":workspace").await?;
    harness
        .claude
        .set_status(CLAUDE_PARENT, ThreadStatus::Active);
    let child = spawn_from_claude(&harness, "build").await?;
    let turn = running_turn(&harness, &child, &[]).await?;
    record_turn(
        &harness,
        &child,
        &[(&turn, TurnStatus::Completed, "queued result")],
    );
    end(&harness, &child, &turn, "completed");
    eventually("the queued notice", async || {
        Ok((!harness
            .service
            .turn_delivery
            .list(Some(CLAUDE_PARENT))
            .await?
            .is_empty())
        .then_some(()))
    })
    .await?;
    let (success, waited) = call(
        &harness.service,
        CLAUDE,
        CLAUDE_PARENT,
        "codewide_wait_agent",
        json!({"agentThreadId": child.as_str(), "timeoutSeconds": 0}),
    )
    .await;
    assert!(success, "{waited}");
    assert_eq!(waited["status"], "completed");
    assert!(
        harness
            .service
            .turn_delivery
            .list(Some(CLAUDE_PARENT))
            .await?
            .is_empty()
    );
    harness.claude.set_status(CLAUDE_PARENT, ThreadStatus::Idle);
    settle_window().await;
    assert!(notices(&harness).is_empty());
    Ok(())
}

async fn suppressed_for(
    remove: impl FnOnce(&Harness),
) -> Result<SuppressReason, Box<dyn std::error::Error>> {
    let harness = harness(":workspace").await?;
    let child = spawn_from_claude(&harness, "build").await?;
    let turn = running_turn(&harness, &child, &[]).await?;
    remove(&harness);
    record_turn(
        &harness,
        &child,
        &[(&turn, TurnStatus::Completed, "orphaned")],
    );
    end(&harness, &child, &turn, "completed");
    let reason = eventually("suppression", async || {
        let requests = child_requests(&harness, &child)?;
        Ok(match &requests[0].phase {
            RequestPhase::Settled {
                delivery: Delivery::Suppressed { reason },
                ..
            } => Some(*reason),
            _ => None,
        })
    })
    .await?;
    assert!(
        harness
            .service
            .turn_delivery
            .list(Some(CLAUDE_PARENT))
            .await?
            .is_empty()
    );
    assert!(notices(&harness).is_empty());
    Ok(reason)
}

#[tokio::test]
async fn results_for_a_deleted_or_archived_parent_are_suppressed() -> TestResult {
    assert_eq!(
        suppressed_for(|harness| harness.claude.remove_thread(CLAUDE_PARENT)).await?,
        SuppressReason::ParentDeleted
    );
    assert_eq!(
        suppressed_for(|harness| harness.claude.set_archived(CLAUDE_PARENT, true)).await?,
        SuppressReason::ParentArchived
    );
    Ok(())
}

#[tokio::test]
async fn a_deleted_child_is_reported_failed() -> TestResult {
    let harness = harness(":workspace").await?;
    let child = spawn_from_claude(&harness, "build").await?;
    running_turn(&harness, &child, &[]).await?;
    harness.codex.remove_thread(child.as_str());
    harness.service.delivery.mark_dirty(&child);
    let received = notice_count(&harness, 1).await?;
    assert_eq!(received[0]["reports"][0]["status"], "failed");
    Ok(())
}

#[tokio::test]
async fn unreadable_history_backs_off_then_sends_a_capped_status_only_notice() -> TestResult {
    let harness = harness(":workspace").await?;
    let child = spawn_from_claude(&harness, "build").await?;
    let turn = running_turn(&harness, &child, &[]).await?;
    harness.codex.set_history_unreadable(child.as_str(), true);
    let ended_at = std::time::Instant::now();
    end(&harness, &child, &turn, "completed");
    eventually("a deferred handoff", async || {
        let requests = child_requests(&harness, &child)?;
        Ok(matches!(
            requests[0].phase,
            RequestPhase::Settled {
                delivery: Delivery::AwaitingHandoff { attempts, .. },
                ..
            } if attempts > 0
        )
        .then_some(()))
    })
    .await?;
    assert!(notices(&harness).is_empty());
    let received = notice_count(&harness, 1).await?;
    assert!(ended_at.elapsed() >= Duration::from_millis(300));
    let report = &received[0]["reports"][0];
    assert_eq!(report["status"], "succeeded");
    assert!(report["finalMessage"].is_null());
    assert!(
        report["note"]
            .as_str()
            .is_some_and(|note| note.contains("codewide_wait_agent"))
    );
    Ok(())
}

#[tokio::test]
async fn results_settling_while_a_notice_waits_are_batched_into_one() -> TestResult {
    let harness = harness(":workspace").await?;
    harness
        .claude
        .set_status(CLAUDE_PARENT, ThreadStatus::Active);
    let mut children = Vec::new();
    for prompt in ["first", "second", "third"] {
        let child = spawn_from_claude(&harness, prompt).await?;
        let turn = running_turn(&harness, &child, &[]).await?;
        children.push((child, turn, prompt));
    }
    let (first, first_turn, _) = &children[0];
    record_turn(
        &harness,
        first,
        &[(first_turn, TurnStatus::Completed, "first")],
    );
    end(&harness, first, first_turn, "completed");
    eventually("the first queued notice", async || {
        Ok((harness
            .service
            .turn_delivery
            .list(Some(CLAUDE_PARENT))
            .await?
            .len()
            == 1)
            .then_some(()))
    })
    .await?;
    for (child, turn, text) in &children[1..] {
        record_turn(&harness, child, &[(turn, TurnStatus::Completed, text)]);
        end(&harness, child, turn, "completed");
    }
    eventually("both results settled", async || {
        let parents = harness.service.task_journal.handoffs_by_parent().await?;
        Ok(parents
            .get(&AppThreadId::from_static(CLAUDE_PARENT))
            .is_some_and(|requests| requests.len() == 2)
            .then_some(()))
    })
    .await?;
    settle_window().await;
    assert_eq!(
        harness
            .service
            .turn_delivery
            .list(Some(CLAUDE_PARENT))
            .await?
            .len(),
        1
    );
    harness.claude.set_status(CLAUDE_PARENT, ThreadStatus::Idle);
    let received = notice_count(&harness, 2).await?;
    settle_window().await;
    assert_eq!(notices(&harness).len(), 2);
    assert_eq!(received[1]["summary"], "2 agent results");
    let texts = received[1]["reports"]
        .as_array()
        .map(|reports| {
            reports
                .iter()
                .map(|report| {
                    report["finalMessage"]
                        .as_str()
                        .unwrap_or_default()
                        .to_owned()
                })
                .collect::<std::collections::BTreeSet<_>>()
        })
        .unwrap_or_default();
    assert_eq!(
        texts,
        ["second".to_owned(), "third".to_owned()]
            .into_iter()
            .collect()
    );
    // Consecutive notice-started parent turns are measured, not capped.
    let wakes = {
        let read = harness.store.database().begin_read()?;
        let table = read.open_table(crate::store::orchestration_tables::PARENT_WAKES)?;
        table.get(CLAUDE_PARENT)?.map(|value| value.value())
    };
    assert_eq!(wakes, Some(2));
    Ok(())
}

async fn nest(harness: &Harness, depth: usize) -> Result<AppThreadId, Box<dyn std::error::Error>> {
    let links = crate::agent::orchestration::children::ChildLinks::new(harness.store.clone());
    let mut parent = CLAUDE_PARENT.to_owned();
    for level in 1..=depth {
        let id = format!("nested-{level}");
        links
            .link(&crate::agent::orchestration::children::ChildLink::new(
                parent.clone(),
                id.clone(),
                ProviderId::from_static(CLAUDE),
                "claude-default".into(),
                None,
                "/repo".into(),
            ))
            .await?;
        parent = id;
    }
    let thread = AppThreadId::parse(&parent).ok_or("invalid nested id")?;
    let mut nested = crate::agent::testing::thread(CLAUDE, thread.as_str(), 5);
    nested.cwd = "/repo".into();
    nested.settings.permission_profile = ":full-access".into();
    harness.claude.add_thread(nested);
    harness
        .gateway
        .bindings()
        .bind(
            &thread,
            &ProviderId::from_static(CLAUDE),
            crate::agent::bindings::BindingOrigin::Created,
        )
        .await?;
    Ok(thread)
}

#[tokio::test]
async fn the_default_depth_limit_admits_depth_five_and_rejects_depth_six() -> TestResult {
    let harness = harness(":workspace").await?;
    let at_four = nest(&harness, 4).await?;
    let (allowed, spawned) = call(
        &harness.service,
        CLAUDE,
        at_four.as_str(),
        "codewide_spawn_agent",
        json!({"prompt": "depth five", "provider": CLAUDE}),
    )
    .await;
    assert!(allowed, "{spawned}");
    let at_five = AppThreadId::parse(&agent_id(&spawned)?).ok_or("child")?;
    harness
        .gateway
        .bindings()
        .bind(
            &at_five,
            &ProviderId::from_static(CLAUDE),
            crate::agent::bindings::BindingOrigin::Created,
        )
        .await
        .ok();
    for tool in ["codewide_spawn_agent", "codewide_delegate_task"] {
        let arguments = if tool == "codewide_spawn_agent" {
            json!({"prompt": "depth six", "provider": CLAUDE})
        } else {
            json!({"prompt": "depth six", "provider": CLAUDE, "waitMode": "deferred"})
        };
        let created = harness.claude.created().len();
        let (rejected, error) =
            call(&harness.service, CLAUDE, at_five.as_str(), tool, arguments).await;
        assert!(!rejected, "{tool} admitted depth six");
        assert!(error.to_string().contains("depth limit"), "{error}");
        assert_eq!(harness.claude.created().len(), created);
    }
    Ok(())
}
