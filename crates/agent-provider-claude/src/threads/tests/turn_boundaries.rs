//! Where a Claude turn ends: Claude's own session state and the lifecycle of
//! the messages the companion wrote, never a result's origin. The recorded
//! scenarios (a message Claude takes into a wake, a message while a
//! background agent works, a steer) replay in `session::replay_tests`.

use std::sync::atomic::Ordering;

use agent_core::model::{
    AgentTurn, TurnErrorKind, TurnOrigin, TurnStartParams, TurnStartResult, TurnStatus,
};

use super::{Options, THREAD, TestResult, create_thread, frames, harness, id, settle, start, text};

/// The uuid of the latest message the session wrote to `query`.
fn last_offer(query: &super::FakeQuery) -> Result<String, Box<dyn std::error::Error>> {
    Ok(query
        .offers
        .lock()
        .map_err(|_| "offers poisoned")?
        .last()
        .ok_or("nothing offered")?
        .uuid
        .clone())
}

fn the_only(completed: &[AgentTurn]) -> Result<&AgentTurn, Box<dyn std::error::Error>> {
    match completed {
        [turn] => Ok(turn),
        _ => Err(format!("{} turns completed, expected one", completed.len()).into()),
    }
}

#[tokio::test]
async fn a_result_before_claude_completed_the_message_does_not_end_the_turn() -> TestResult {
    let harness = harness(Options::default())?;
    create_thread(&harness.service, THREAD).await?;
    let turn_id = start(&harness.service, THREAD, "first").await?;
    let query = harness.runtime.query(0)?;
    let message = last_offer(&query)?;
    query.push(frames::init()).await;
    query.push(frames::command(&message, "started")).await;
    query.push(frames::text("m1", "answer")).await;
    query.push(frames::result()).await;
    settle().await;
    assert!(
        harness.completions().is_empty(),
        "the turn ended before Claude completed the message"
    );
    query.push(frames::command(&message, "completed")).await;
    settle().await;
    let completed = harness.completions();
    let turn = the_only(&completed)?;
    assert_eq!(turn.turn_id, turn_id);
    assert_eq!(turn.status, TurnStatus::Completed);
    harness.close().await;
    Ok(())
}

#[tokio::test]
async fn idle_ends_the_turn_of_a_message_claude_never_reported_completed() -> TestResult {
    let harness = harness(Options::default())?;
    create_thread(&harness.service, THREAD).await?;
    start(&harness.service, THREAD, "first").await?;
    let query = harness.runtime.query(0)?;
    query.push(frames::text("m1", "answer")).await;
    query.push(frames::result()).await;
    settle().await;
    assert!(harness.completions().is_empty());
    query.idle().await;
    settle().await;
    assert_eq!(
        the_only(&harness.completions())?.status,
        TurnStatus::Completed
    );
    // A later turn is not held by the earlier message either.
    start(&harness.service, THREAD, "second").await?;
    let second = last_offer(&query)?;
    query.push(frames::text("m2", "again")).await;
    query.push(frames::command(&second, "started")).await;
    query.push(frames::result()).await;
    query.push(frames::command(&second, "completed")).await;
    settle().await;
    assert_eq!(harness.completions().len(), 2);
    harness.close().await;
    Ok(())
}

#[tokio::test]
async fn idle_before_claude_acknowledged_the_message_keeps_the_turn() -> TestResult {
    let harness = harness(Options::default())?;
    harness.runtime.silent.store(true, Ordering::SeqCst);
    create_thread(&harness.service, THREAD).await?;
    start(&harness.service, THREAD, "first").await?;
    let query = harness.runtime.query(0)?;
    let message = last_offer(&query)?;
    // Claude finished other work before it read the message.
    query.idle().await;
    settle().await;
    assert!(
        harness.completions().is_empty(),
        "an idle Claude had not read the message yet"
    );
    query.wake().await;
    query.push(frames::command(&message, "queued")).await;
    query.push(frames::command(&message, "started")).await;
    query.push(frames::text("m1", "answer")).await;
    query.push(frames::result()).await;
    query.push(frames::command(&message, "completed")).await;
    settle().await;
    assert_eq!(
        the_only(&harness.completions())?.status,
        TurnStatus::Completed
    );
    harness.close().await;
    Ok(())
}

#[tokio::test]
async fn claude_running_on_its_own_starts_a_provider_turn_and_a_start_answers_busy() -> TestResult {
    let harness = harness(Options::default())?;
    create_thread(&harness.service, THREAD).await?;
    start(&harness.service, THREAD, "first").await?;
    let query = harness.runtime.query(0)?;
    query.push(frames::result()).await;
    query.idle().await;
    settle().await;
    query.wake().await;
    settle().await;
    let busy = harness
        .service
        .turn_start(TurnStartParams {
            app_thread_id: id(THREAD)?,
            client_message_id: None,
            input: text("second"),
            client_tools: None,
        })
        .await?;
    let TurnStartResult::Busy { active_turn_id } = busy else {
        return Err("a start during Claude's own work was not busy".into());
    };
    query.push(frames::text("m2", "woke")).await;
    query.push(frames::result()).await;
    settle().await;
    let completed = harness.completions();
    let wake = completed.last().ok_or("the wake did not end")?;
    assert_eq!(wake.turn_id, active_turn_id);
    assert_eq!(wake.origin, TurnOrigin::Provider);
    harness.close().await;
    Ok(())
}

#[tokio::test]
async fn a_claude_without_session_state_fails_the_turn_and_closes_the_session() -> TestResult {
    let harness = harness(Options::default())?;
    *harness.runtime.unsupported.lock().map_err(|_| "poisoned")? = Some("2.0.1".into());
    create_thread(&harness.service, THREAD).await?;
    start(&harness.service, THREAD, "first").await?;
    settle().await;
    let completed = harness.completions();
    let turn = the_only(&completed)?;
    assert_eq!(turn.status, TurnStatus::Failed);
    let error = turn.error.as_ref().ok_or("no error")?;
    assert_eq!(error.kind, TurnErrorKind::Provider);
    assert!(
        error.message.contains("Claude Code 2.0.1"),
        "{}",
        error.message
    );
    assert!(harness.runtime.query(0)?.closed.load(Ordering::SeqCst));
    harness.close().await;
    Ok(())
}
