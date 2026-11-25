//! Compatibility tests for queued legacy sends and turn-anchored waits.

use super::*;

#[tokio::test]
async fn a_busy_provider_keeps_the_message_queued_for_after_its_turn() -> TestResult {
    let harness = harness(":workspace").await?;
    let (_, spawned) = call(
        &harness.service,
        "codex",
        PARENT,
        "codewide_spawn_agent",
        json!({"prompt": "p", "provider": "claude"}),
    )
    .await;
    let child = agent_id(&spawned)?;
    let child = child.as_str();
    harness.service.observe_event(
        &ProviderId::from_static("claude"),
        &completed(child, "claude-turn-1", "completed"),
    );
    // The host started a turn of its own (a wake turn) the tracker missed.
    harness.claude.set_busy(Some("wake-turn"));
    let (_, sent) = call(
        &harness.service,
        "codex",
        PARENT,
        "codewide_send_agent",
        json!({"agentThreadId": child, "message": "later"}),
    )
    .await;
    assert_eq!(sent, json!({"status": "queued"}));
    harness.claude.set_busy(None);
    harness.service.observe_event(
        &ProviderId::from_static("claude"),
        &completed(child, "wake-turn", "completed"),
    );
    tokio::time::timeout(Duration::from_secs(5), async {
        while harness.claude.started().len() < 3 {
            tokio::task::yield_now().await;
        }
    })
    .await?;
    assert_eq!(
        serde_json::to_value(&harness.claude.started()[2].input)?,
        json!([{"type": "text", "text": "later"}])
    );
    Ok(())
}

#[tokio::test]
async fn a_wait_ends_with_the_calling_turn() -> TestResult {
    let harness = harness(":workspace").await?;
    let (_, spawned) = call(
        &harness.service,
        "codex",
        PARENT,
        "codewide_spawn_agent",
        json!({"prompt": "p", "provider": "claude"}),
    )
    .await;
    let child = agent_id(&spawned)?;
    let service = harness.service.clone();
    let arguments = json!({"agentThreadId": child, "timeoutSeconds": 300});
    let wait_task = tokio::spawn(async move {
        call(&service, "codex", PARENT, "codewide_wait_agent", arguments).await
    });
    tokio::time::sleep(Duration::from_millis(50)).await;
    // Another thread's turn end does not release it; the caller's does.
    harness.service.observe_event(
        &ProviderId::from_static("codex"),
        &completed("elsewhere", "parent-turn", "completed"),
    );
    tokio::time::sleep(Duration::from_millis(20)).await;
    assert!(!wait_task.is_finished());
    harness.service.observe_event(
        &ProviderId::from_static("codex"),
        &completed(PARENT, "parent-turn", "interrupted"),
    );
    let (success, waited) = tokio::time::timeout(Duration::from_secs(5), wait_task).await??;
    assert!(success);
    assert_eq!(waited["status"], "running");
    Ok(())
}
