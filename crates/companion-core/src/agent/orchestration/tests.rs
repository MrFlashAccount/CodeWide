//! Contract tests of the orchestration tools over scripted neutral
//! providers: a Codex-like parent provider and a Claude-like provider with
//! host-minted ids.

use std::{sync::Arc, time::Duration};

use serde_json::{Value, json};

use super::OrchestrationService;
use crate::{
    agent::{
        bindings::{BindingOrigin, BindingStore},
        client_wire::gateway::ClientWireGateway,
        model::{
            AgentItem, AgentTurn, AppThreadId, CapabilitySet, ItemId, MessagePhase, ProviderId,
            StartWhileActiveMode, ThreadChange, ThreadStatus, ToolCallParams, ToolCallResult,
            ToolResultContent, TurnId, TurnOrigin, TurnStatus,
        },
        provider::{AgentProvider, ClientToolHost},
        registry::ProviderRegistry,
        testing::{ScriptedProvider, thread},
    },
    store::IndexStore,
};

type TestResult = Result<(), Box<dyn std::error::Error>>;

const PARENT: &str = "parent-thread";

fn capabilities(host_minted: bool) -> CapabilitySet {
    let mut capabilities = CapabilitySet::none(StartWhileActiveMode::Busy);
    capabilities.turns_steer = true;
    capabilities.threads_host_minted_ids = host_minted;
    capabilities.orchestration_tools = true;
    capabilities
}

struct Harness {
    service: Arc<OrchestrationService>,
    codex: Arc<ScriptedProvider>,
    claude: Arc<ScriptedProvider>,
    journal: tokio::sync::mpsc::Receiver<Value>,
    store: Arc<IndexStore>,
    gateway: Arc<ClientWireGateway>,
    _directory: tempfile::TempDir,
}

async fn harness(parent_profile: &str) -> Result<Harness, Box<dyn std::error::Error>> {
    let directory = tempfile::tempdir()?;
    let store = Arc::new(IndexStore::open(directory.path().join("state.redb"))?);
    let mut parent = thread("codex", PARENT, 5);
    parent.cwd = "/repo".into();
    parent.settings.model = "gpt-parent".into();
    parent.settings.permission_profile = parent_profile.into();
    let codex = Arc::new(ScriptedProvider::new("codex", capabilities(false)).with_thread(parent));
    let claude = Arc::new(ScriptedProvider::new("claude", capabilities(true)));
    let codex_dyn: Arc<dyn AgentProvider> = codex.clone();
    let claude_dyn: Arc<dyn AgentProvider> = claude.clone();
    let registry = Arc::new(ProviderRegistry::new(
        vec![codex_dyn, claude_dyn],
        &ProviderId::from_static("codex"),
        Vec::new(),
    )?);
    let bindings = Arc::new(BindingStore::new(store.clone()));
    bindings
        .bind(
            &AppThreadId::from_static(PARENT),
            &ProviderId::from_static("codex"),
            BindingOrigin::Created,
        )
        .await?;
    let gateway = Arc::new(ClientWireGateway::new(registry, bindings));
    let (journal_tx, journal) = tokio::sync::mpsc::channel(16);
    let service = OrchestrationService::new(gateway.clone(), store.clone(), journal_tx);
    Ok(Harness {
        service,
        codex,
        claude,
        journal,
        store,
        gateway,
        _directory: directory,
    })
}

async fn call(
    service: &OrchestrationService,
    provider: &'static str,
    thread: &str,
    tool: &str,
    arguments: Value,
) -> (bool, Value) {
    let result = service
        .call(
            &ProviderId::from_static(provider),
            ToolCallParams {
                app_thread_id: AppThreadId::parse(thread)
                    .unwrap_or_else(|| AppThreadId::from_static("invalid")),
                turn_id: TurnId::from_static("parent-turn"),
                call_id: "call".into(),
                tool: tool.into(),
                arguments,
            },
        )
        .await;
    let ToolCallResult { success, content } = result;
    let text = content
        .into_iter()
        .map(|ToolResultContent::Text { text }| text)
        .collect::<String>();
    let value = serde_json::from_str(&text).unwrap_or(Value::String(text));
    (success, value)
}

fn completed(thread: &str, turn: &str, status: &str) -> Value {
    json!({"method": "turn/completed", "params": {"threadId": thread, "turn": {"id": turn, "status": status}}})
}

fn final_answer(thread: &str, turn: &str, text: &str) -> Value {
    json!({"method": "item/completed", "params": {"threadId": thread, "turnId": turn,
        "item": {"type": "agentMessage", "id": "m", "text": text, "phase": "final_answer"}}})
}

fn agent_id(value: &Value) -> Result<String, Box<dyn std::error::Error>> {
    Ok(value["agentThreadId"]
        .as_str()
        .ok_or("spawn returned no agentThreadId")?
        .to_owned())
}

#[tokio::test]
async fn spawn_creates_a_linked_thread_on_another_provider_and_starts_the_prompt() -> TestResult {
    let mut harness = harness(":workspace").await?;
    let (success, spawned) = call(
        &harness.service,
        "codex",
        PARENT,
        "codewide_spawn_agent",
        json!({"prompt": "review src/", "provider": "claude", "name": "reviewer"}),
    )
    .await;
    assert!(success, "{spawned}");
    let child = agent_id(&spawned)?;
    let child = child.as_str();
    assert_eq!(spawned["provider"], "claude");
    assert_eq!(spawned["model"], "claude-default");
    assert_eq!(spawned["status"], "running");

    let created = harness.claude.created();
    assert_eq!(created.len(), 1);
    assert_eq!(created[0].cwd, "/repo");
    assert_eq!(created[0].settings.permission_profile, ":workspace");
    assert!(created[0].app_thread_id.is_some(), "host-minted id");
    let started = harness.claude.started();
    assert_eq!(started.len(), 1);
    assert_eq!(started[0].app_thread_id.as_str(), child);
    assert_eq!(
        serde_json::to_value(&started[0].input)?,
        json!([{"type": "text", "text": "review src/"}]),
        "the prompt only; the parent history is not copied"
    );
    assert!(matches!(
        harness.claude.updated().first().map(|update| &update.change),
        Some(ThreadChange::Name { name: Some(name) }) if name == "reviewer"
    ));
    assert_eq!(
        harness
            .gateway
            .bindings()
            .provider_of(&AppThreadId::parse(child).ok_or("invalid id")?)
            .await?
            .map(ProviderId::into_string)
            .as_deref(),
        Some("claude")
    );
    let announced = harness.journal.recv().await.ok_or("no thread/started")?;
    assert_eq!(announced["method"], "thread/started");
    assert_eq!(announced["params"]["thread"]["id"], child);

    let rows = harness.service.subagent_rows(PARENT).await?;
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0]["id"], child);
    assert_eq!(rows[0]["parentThreadId"], PARENT);
    assert_eq!(rows[0]["agentNickname"], "reviewer");
    assert_eq!(rows[0]["modelProvider"], "claude-models");
    Ok(())
}

#[tokio::test]
async fn spawn_defaults_to_the_parent_provider_model_and_never_escalates() -> TestResult {
    let harness = harness(":workspace").await?;
    let (success, spawned) = call(
        &harness.service,
        "codex",
        PARENT,
        "codewide_spawn_agent",
        json!({"prompt": "p"}),
    )
    .await;
    assert!(success, "{spawned}");
    assert_eq!(spawned["provider"], "codex");
    assert_eq!(spawned["model"], "gpt-parent");
    assert_eq!(harness.codex.created()[0].app_thread_id, None);

    let (success, refused) = call(
        &harness.service,
        "codex",
        PARENT,
        "codewide_spawn_agent",
        json!({"prompt": "p", "permissionProfile": ":danger-full-access"}),
    )
    .await;
    assert!(!success);
    assert!(
        refused
            .as_str()
            .is_some_and(|text| text.contains("exceeds")),
        "{refused}"
    );
    assert_eq!(
        harness.codex.created().len(),
        1,
        "a refused spawn creates nothing"
    );
    Ok(())
}

#[tokio::test]
async fn an_unknown_parent_profile_allows_only_read_only_children() -> TestResult {
    let harness = harness("").await?;
    let (success, _) = call(
        &harness.service,
        "codex",
        PARENT,
        "codewide_spawn_agent",
        json!({"prompt": "p", "permissionProfile": ":workspace"}),
    )
    .await;
    assert!(!success);
    let (success, _) = call(
        &harness.service,
        "codex",
        PARENT,
        "codewide_spawn_agent",
        json!({"prompt": "p"}),
    )
    .await;
    assert!(success);
    assert_eq!(
        harness.codex.created()[0].settings.permission_profile,
        ":read-only"
    );
    // An observed effective profile replaces the unknown one.
    harness.service.observe_rpc_result(
        "thread/resume",
        &json!({"thread": {"id": PARENT}, "activePermissionProfile": {"id": ":full-access"}}),
    );
    let (success, _) = call(
        &harness.service,
        "codex",
        PARENT,
        "codewide_spawn_agent",
        json!({"prompt": "p", "permissionProfile": ":workspace"}),
    )
    .await;
    assert!(success);
    Ok(())
}

#[tokio::test]
async fn wait_wakes_on_the_childs_turn_end_and_reports_the_final_message() -> TestResult {
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
    let service = harness.service.clone();
    let arguments = json!({"agentThreadId": child, "timeoutSeconds": 30});
    let wait_task = tokio::spawn(async move {
        call(&service, "codex", PARENT, "codewide_wait_agent", arguments).await
    });
    tokio::time::sleep(Duration::from_millis(50)).await;
    assert!(!wait_task.is_finished(), "wait blocks while the child runs");
    let turn_id = "claude-turn-1";
    harness
        .service
        .observe_event(&final_answer(child, turn_id, "all good"));
    harness
        .service
        .observe_event(&completed(child, turn_id, "completed"));
    let (success, waited) = tokio::time::timeout(Duration::from_secs(5), wait_task).await??;
    assert!(success);
    assert_eq!(
        waited,
        json!({"status": "completed", "finalMessage": "all good", "turnId": turn_id})
    );
    Ok(())
}

#[tokio::test]
async fn wait_returns_running_after_its_timeout() -> TestResult {
    let harness = harness(":workspace").await?;
    let (_, spawned) = call(
        &harness.service,
        "codex",
        PARENT,
        "codewide_spawn_agent",
        json!({"prompt": "p"}),
    )
    .await;
    let child = agent_id(&spawned)?;
    let child = child.as_str();
    let started = std::time::Instant::now();
    let (success, waited) = call(
        &harness.service,
        "codex",
        PARENT,
        "codewide_wait_agent",
        json!({"agentThreadId": child, "timeoutSeconds": 0.05}),
    )
    .await;
    assert!(success);
    assert_eq!(waited["status"], "running");
    assert!(started.elapsed() < Duration::from_secs(2));
    Ok(())
}

#[tokio::test]
async fn tools_address_only_children_of_the_calling_thread() -> TestResult {
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
    // The parent is not its own agent, and a stranger is no agent at all.
    for target in [PARENT, "stranger"] {
        let (success, refused) = call(
            &harness.service,
            "codex",
            PARENT,
            "codewide_cancel_agent",
            json!({"agentThreadId": target}),
        )
        .await;
        assert!(!success);
        assert!(
            refused
                .as_str()
                .is_some_and(|text| text.contains("agent not found"))
        );
    }
    // The child cannot address its sibling or parent through its own channel.
    let (success, _) = call(
        &harness.service,
        "claude",
        child,
        "codewide_wait_agent",
        json!({"agentThreadId": PARENT}),
    )
    .await;
    assert!(!success);
    // A call naming a thread of another provider's channel is refused.
    let (success, refused) = call(
        &harness.service,
        "claude",
        PARENT,
        "codewide_list_agents",
        json!({}),
    )
    .await;
    assert!(!success);
    assert!(
        refused
            .as_str()
            .is_some_and(|text| text.contains("not a thread of this agent"))
    );
    Ok(())
}

#[tokio::test]
async fn send_queues_while_running_and_delivers_on_the_turn_end() -> TestResult {
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
    let (_, queued) = call(
        &harness.service,
        "codex",
        PARENT,
        "codewide_send_agent",
        json!({"agentThreadId": child, "message": "and the tests"}),
    )
    .await;
    assert_eq!(queued, json!({"status": "queued"}));
    assert_eq!(harness.claude.started().len(), 1);

    let (_, steered) = call(
        &harness.service,
        "codex",
        PARENT,
        "codewide_send_agent",
        json!({"agentThreadId": child, "message": "hurry", "mode": "steer"}),
    )
    .await;
    assert_eq!(steered, json!({"status": "running"}));
    let steer = harness.claude.steered();
    assert_eq!(steer.len(), 1);
    assert_eq!(steer[0].expected_turn_id.as_str(), "claude-turn-1");

    harness
        .service
        .observe_event(&completed(child, "claude-turn-1", "completed"));
    tokio::time::timeout(Duration::from_secs(5), async {
        while harness.claude.started().len() < 2 {
            tokio::task::yield_now().await;
        }
    })
    .await?;
    assert_eq!(
        serde_json::to_value(&harness.claude.started()[1].input)?,
        json!([{"type": "text", "text": "and the tests"}])
    );
    let (_, state) = call(
        &harness.service,
        "codex",
        PARENT,
        "codewide_wait_agent",
        json!({"agentThreadId": child, "timeoutSeconds": 0}),
    )
    .await;
    assert_eq!(state["status"], "running");

    // An idle agent gets a new turn at once.
    harness
        .service
        .observe_event(&completed(child, "claude-turn-2", "completed"));
    let (_, sent) = call(
        &harness.service,
        "codex",
        PARENT,
        "codewide_send_agent",
        json!({"agentThreadId": child, "message": "next"}),
    )
    .await;
    assert_eq!(sent, json!({"status": "running"}));
    assert_eq!(harness.claude.started().len(), 3);
    Ok(())
}

#[tokio::test]
async fn cancel_interrupts_the_running_turn_and_is_idempotent() -> TestResult {
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
    let (_, cancelled) = call(
        &harness.service,
        "codex",
        PARENT,
        "codewide_cancel_agent",
        json!({"agentThreadId": child}),
    )
    .await;
    assert_eq!(cancelled, json!({"status": "interrupted"}));
    let interrupts = harness.claude.interrupted();
    assert_eq!(interrupts.len(), 1);
    assert_eq!(
        interrupts[0].turn_id.as_ref().map(TurnId::as_str),
        Some("claude-turn-1")
    );
    harness
        .service
        .observe_event(&completed(child, "claude-turn-1", "interrupted"));
    let (success, again) = call(
        &harness.service,
        "codex",
        PARENT,
        "codewide_cancel_agent",
        json!({"agentThreadId": child}),
    )
    .await;
    assert!(success);
    assert_eq!(again, json!({"status": "interrupted"}));
    assert_eq!(
        harness.claude.interrupted().len(),
        1,
        "an idle agent is not interrupted again"
    );
    Ok(())
}

#[tokio::test]
async fn links_and_status_survive_a_restart() -> TestResult {
    let harness = harness(":workspace").await?;
    let (_, spawned) = call(
        &harness.service,
        "codex",
        PARENT,
        "codewide_spawn_agent",
        json!({"prompt": "p", "provider": "claude", "name": "r"}),
    )
    .await;
    let child = agent_id(&spawned)?;
    let child = child.as_str();
    harness.claude.set_status(child, ThreadStatus::Idle);
    harness.claude.set_turns(
        child,
        vec![AgentTurn {
            turn_id: TurnId::from_static("stored-turn"),
            status: TurnStatus::Completed,
            origin: TurnOrigin::User,
            started_at: 1,
            completed_at: Some(2),
            error: None,
            items: vec![AgentItem::AgentMessage {
                item_id: ItemId::from_static("i"),
                provenance: None,
                text: "stored answer".into(),
                phase: MessagePhase::Final,
            }],
            provenance: None,
            usage: None,
        }],
    );
    // A new service over the same store: the tracker starts empty.
    let (journal, _journal_rx) = tokio::sync::mpsc::channel(1);
    let restarted =
        OrchestrationService::new(harness.gateway.clone(), harness.store.clone(), journal);
    let (_, listed) = call(
        &restarted,
        "codex",
        PARENT,
        "codewide_list_agents",
        json!({}),
    )
    .await;
    assert_eq!(
        listed,
        json!({"agents": [{"agentThreadId": child, "provider": "claude", "model": "claude-default",
            "name": "r", "status": "completed"}]})
    );
    let (_, waited) = call(
        &restarted,
        "codex",
        PARENT,
        "codewide_wait_agent",
        json!({"agentThreadId": child}),
    )
    .await;
    assert_eq!(
        waited,
        json!({"status": "completed", "finalMessage": "stored answer", "turnId": "stored-turn"})
    );
    Ok(())
}

#[tokio::test]
async fn invalid_arguments_and_unknown_tools_are_unsuccessful_results() -> TestResult {
    let harness = harness(":workspace").await?;
    for (tool, arguments) in [
        ("codewide_spawn_agent", json!({})),
        ("codewide_wait_agent", json!({"agentThreadId": 3})),
        ("codewide_other", json!({})),
        (
            "codewide_spawn_agent",
            json!({"prompt": "p", "provider": "nope"}),
        ),
    ] {
        let (success, _) = call(&harness.service, "codex", PARENT, tool, arguments).await;
        assert!(!success, "{tool}");
    }
    assert!(harness.codex.created().is_empty() && harness.claude.created().is_empty());
    Ok(())
}

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
    harness
        .service
        .observe_event(&completed(child, "claude-turn-1", "completed"));
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
    harness
        .service
        .observe_event(&completed(child, "wake-turn", "completed"));
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
    harness
        .service
        .observe_event(&completed("elsewhere", "parent-turn", "completed"));
    tokio::time::sleep(Duration::from_millis(20)).await;
    assert!(!wait_task.is_finished());
    harness
        .service
        .observe_event(&completed(PARENT, "parent-turn", "interrupted"));
    let (success, waited) = tokio::time::timeout(Duration::from_secs(5), wait_task).await??;
    assert!(success);
    assert_eq!(waited["status"], "running");
    Ok(())
}
