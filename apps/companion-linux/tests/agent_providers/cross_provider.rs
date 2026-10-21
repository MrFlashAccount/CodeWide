//! Cross-provider orchestration and fork integration contracts.

use super::*;

const CODEX_PARENT: &str = "01a12092-346f-7d32-8dc8-ef1150dced2e";

/// The Codex parent thread exists with one stored turn.
fn parent_answer(request: &Value) -> Value {
    let parent = request["params"]["threadId"] == CODEX_PARENT;
    match request["method"].as_str() {
        Some("thread/read") if parent => json!({"result": {"thread": {
            "id": CODEX_PARENT, "cwd": "/work", "model": "gpt-5.5", "preview": "",
            "createdAt": 1, "updatedAt": 1, "status": {"type": "idle"}}}}),
        Some("thread/turns/list") if parent => json!({"result": {"data": [{
            "id": "turn-a", "status": "completed", "items": [
                {"type": "userMessage", "id": "u", "content": [{"type": "text", "text": "fix the parser", "text_elements": []}]},
                {"type": "agentMessage", "id": "a", "text": "parser fixed", "phase": "final_answer"}
            ]}], "nextCursor": null}}),
        _ => default_answer(request),
    }
}

const CODEX_FORKED: &str = "01a1550d-3e21-7cd0-861e-8dc69c452dc8";

fn codex_fork_target_answer(request: &Value) -> Value {
    match request["method"].as_str() {
        Some("thread/start") => json!({"result": {
            "thread": {
                "id": CODEX_FORKED, "cwd": "/work", "model": "gpt-5.5", "preview": "",
                "createdAt": 2, "updatedAt": 2, "status": {"type": "idle"}
            }
        }}),
        Some("thread/name/set") => json!({"result": {}}),
        _ => default_answer(request),
    }
}

#[tokio::test]
async fn a_codex_model_spawns_an_agent_on_another_provider_shown_as_a_subagent() -> TestResult {
    let mut harness = Harness::start(parent_answer, |_| {
        vec![(
            AppThreadId::from_static(CODEX_PARENT),
            ProviderId::from_static("codex"),
        )]
    })
    .await?;
    // Threads the companion starts on Codex declare the tools.
    harness
        .rpc("start", "thread/start", json!({"cwd": "/work"}))
        .await?;
    let start = timeout(Duration::from_secs(3), async {
        loop {
            if let Some(request) = harness.observed.recv().await
                && request["method"] == "thread/start"
            {
                return Some(request);
            }
        }
    })
    .await?
    .ok_or("thread/start was not forwarded")?;
    let declared = start["params"]["dynamicTools"]
        .as_array()
        .ok_or("thread/start without dynamicTools")?;
    assert!(
        declared
            .iter()
            .any(|tool| tool["name"] == "codewide_spawn_agent")
    );

    harness
        .pushed
        .send(
            json!({"id": "srv-1", "method": "item/tool/call", "params": {
            "threadId": CODEX_PARENT, "turnId": "turn-p", "callId": "call-1", "namespace": null,
            "tool": "codewide_spawn_agent",
            "arguments": {"prompt": "review the parser", "provider": FAKE, "name": "reviewer"}}}),
        )
        .await?;
    let answer = timeout(Duration::from_secs(3), async {
        loop {
            if let Some(message) = harness.observed.recv().await
                && message["id"] == "srv-1"
            {
                return Some(message);
            }
        }
    })
    .await?
    .ok_or("the tool call was not answered")?;
    assert_eq!(answer["result"]["success"], true, "{answer}");
    let text = answer["result"]["contentItems"][0]["text"]
        .as_str()
        .ok_or("no text result")?;
    let spawned: Value = serde_json::from_str(text)?;
    let child = spawned["agentThreadId"]
        .as_str()
        .ok_or("no agent id")?
        .to_owned();
    assert_eq!(spawned["provider"], FAKE);
    assert_eq!(spawned["status"], "running");
    let started = harness
        .fake
        .started
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
        .clone();
    assert_eq!(started.len(), 1);
    assert_eq!(started[0].app_thread_id.as_str(), child);

    // The client sees the new thread (the adapter keeps the answered request
    // off the client wire: `codex_tools_tests`).
    let announced = harness
        .event_where(|payload| payload["method"] == "thread/started")
        .await?;
    assert_eq!(announced["params"]["thread"]["id"], child.as_str());
    let subagents = harness
        .rpc(
            "subagents",
            "companion/threadSubagents/read",
            json!({"threadId": CODEX_PARENT}),
        )
        .await?;
    let rows = subagents["result"]["threads"]
        .as_array()
        .ok_or("no subagent rows")?;
    assert_eq!(rows.len(), 1, "{subagents}");
    assert_eq!(rows[0]["id"], child.as_str());
    assert_eq!(rows[0]["parentThreadId"], CODEX_PARENT);
    assert_eq!(rows[0]["agentNickname"], "reviewer");
    harness.stop();
    Ok(())
}

#[tokio::test]
async fn thread_fork_into_another_provider_hands_off_the_context_with_the_first_message()
-> TestResult {
    let mut harness = Harness::start(parent_answer, |_| {
        vec![(
            AppThreadId::from_static(CODEX_PARENT),
            ProviderId::from_static("codex"),
        )]
    })
    .await?;
    let forked = harness
        .rpc(
            "fork",
            "thread/fork",
            json!({"threadId": CODEX_PARENT, "codewideAgentProvider": FAKE}),
        )
        .await?;
    let thread = &forked["result"]["thread"];
    let forked_id = thread["id"].as_str().ok_or("no forked thread")?.to_owned();
    assert_ne!(forked_id, CODEX_PARENT);
    assert_eq!(thread["forkedFromId"], CODEX_PARENT);
    assert_eq!(thread["codewideAgent"]["provider"], FAKE);
    let binding: Value = serde_json::from_slice(
        &harness
            .store
            .agent_binding(&forked_id)?
            .ok_or("the fork is not bound")?,
    )?;
    assert_eq!(binding["activeProvider"], FAKE);
    // The source thread was only read.
    let methods = harness.observed_methods();
    assert!(
        methods
            .iter()
            .all(|method| method == "thread/read" || method == "thread/turns/list"),
        "{methods:?}"
    );

    let queued = harness
        .rpc(
            "put",
            "companion/queue/put",
            json!({"command": {
                "commandId": "fork-message-1",
                "remoteThreadId": forked_id,
                "method": "turn/start",
                "presentation": "delivery",
                "params": {
                    "threadId": forked_id,
                    "clientUserMessageId": "fork-message-1",
                    "input": [{"type": "text", "text": "now add tests", "text_elements": []}]
                }
            }}),
        )
        .await?;
    assert!(queued.get("error").is_none(), "{queued}");
    wait_for_state(&harness.store, "fork-message-1", OutboxState::Delivered).await?;
    let started = harness
        .fake
        .started
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
        .clone();
    let input = serde_json::to_value(&started.first().ok_or("no turn")?.input)?;
    let handoff = input[0]["text"].as_str().ok_or("no handoff")?;
    assert!(handoff.contains("fix the parser") && handoff.contains("parser fixed"));
    assert_eq!(input[1]["text"], "now add tests");

    // A same-provider fork stays the native fork, without extension fields.
    harness
        .rpc(
            "native-fork",
            "thread/fork",
            json!({"threadId": CODEX_PARENT, "codewideAgentProvider": "codex"}),
        )
        .await?;
    let native = timeout(Duration::from_secs(3), async {
        loop {
            if let Some(request) = harness.observed.recv().await
                && request["method"] == "thread/fork"
            {
                return Some(request);
            }
        }
    })
    .await?
    .ok_or("the native fork was not forwarded")?;
    assert_eq!(native["params"], json!({"threadId": CODEX_PARENT}));
    harness.stop();
    Ok(())
}

#[tokio::test]
async fn thread_fork_into_codex_materializes_the_empty_rollout_without_a_model_turn() -> TestResult
{
    let mut harness = Harness::start(codex_fork_target_answer, |_| Vec::new()).await?;
    let source = harness.new_fake_thread().await?;
    let forked = harness
        .rpc(
            "fork-to-codex",
            "thread/fork",
            json!({"threadId": source, "codewideAgentProvider": "codex"}),
        )
        .await?;
    assert_eq!(forked["result"]["thread"]["id"], CODEX_FORKED);
    assert_eq!(forked["result"]["thread"]["name"], "fake thread");

    let requests = std::iter::from_fn(|| harness.observed.try_recv().ok()).collect::<Vec<_>>();
    let methods = requests
        .iter()
        .filter_map(|request| request["method"].as_str())
        .collect::<Vec<_>>();
    let start = methods
        .iter()
        .position(|method| *method == "thread/start")
        .ok_or("thread/start missing")?;
    let name = methods
        .iter()
        .position(|method| *method == "thread/name/set")
        .ok_or("thread/name/set missing")?;
    assert!(start < name, "{methods:?}");
    assert!(
        !methods.contains(&"turn/start"),
        "materialization must not call the model: {methods:?}"
    );
    let name_request = &requests[name];
    assert_eq!(name_request["params"]["threadId"], CODEX_FORKED);
    assert_eq!(name_request["params"]["name"], "fake thread");
    harness.stop();
    Ok(())
}
