//! A child turn whose live end never reached the companion (dropped, or ended
//! while the companion was down) is settled from provider history the way a
//! live end would have settled it: the in-memory tracker (`wait_agent`), a
//! journaled `turn/completed` (the thread-list row and the phones) and the
//! subagent rows' `running`.

use super::*;
use crate::{
    agent::orchestration::coordinator::watch::ChildState,
    thread_list::{JournaledRow, ThreadListRows},
    thread_patch::attach_thread_patch,
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

async fn spawn_codex_child(harness: &Harness) -> Result<AppThreadId, Box<dyn std::error::Error>> {
    let (success, spawned) = call(
        &harness.service,
        CLAUDE,
        CLAUDE_PARENT,
        "codewide_spawn_agent",
        json!({"prompt": "build", "provider": CODEX, "model": "gpt-6.1-sol", "name": "build"}),
    )
    .await;
    assert!(success, "{spawned}");
    AppThreadId::parse(&agent_id(&spawned)?).ok_or_else(|| "invalid child".into())
}

/// The child's turn once its delivery receipt made the tracker follow it.
async fn tracked_turn(
    service: &OrchestrationService,
    child: &AppThreadId,
) -> Result<TurnId, Box<dyn std::error::Error>> {
    eventually("the tracked turn", async || {
        Ok(match service.tracker.state(child.as_str()) {
            Some(ChildState::Running {
                turn_id: Some(turn_id),
            }) => TurnId::parse(&turn_id),
            _ => None,
        })
    })
    .await
}

fn ended_turn(turn_id: &TurnId, text: &str) -> AgentTurn {
    AgentTurn {
        turn_id: turn_id.clone(),
        status: TurnStatus::Completed,
        origin: TurnOrigin::User,
        started_at: 10,
        completed_at: Some(20),
        error: None,
        provenance: None,
        usage: None,
        items: vec![AgentItem::AgentMessage {
            item_id: ItemId::from_static("answer"),
            provenance: None,
            text: text.into(),
            phase: MessagePhase::Final,
        }],
    }
}

/// The journaled `turn/completed` of the child's turn.
async fn journaled_end(
    journal: &mut tokio::sync::mpsc::Receiver<Value>,
    child: &AppThreadId,
    turn_id: &TurnId,
) -> Result<Value, Box<dyn std::error::Error>> {
    tokio::time::timeout(Duration::from_secs(8), async {
        loop {
            let payload = journal.recv().await.ok_or("journal closed")?;
            if payload["method"] == "turn/completed"
                && payload["params"]["threadId"] == child.as_str()
                && payload["params"]["turn"]["id"] == turn_id.as_str()
            {
                return Ok::<_, Box<dyn std::error::Error>>(payload);
            }
        }
    })
    .await
    .map_err(|_| "no journaled turn end")?
}

/// The thread-list row a device holds for the child after `payload` is
/// journaled over a row that still shows the child running.
async fn list_row_after(child: &AppThreadId, payload: Value) -> Value {
    let rows = ThreadListRows::default();
    let mut page = vec![json!({
        "id": child.as_str(), "source": "vscode", "parentThreadId": CLAUDE_PARENT,
        "status": {"type": "active", "activeFlags": []},
        "preview": "", "updatedAt": 1, "recencyAt": 1, "turns": []
    })];
    rows.observe_page(&mut page, 1, false);
    let subscription = rows.subscribe(true);
    let payload = attach_thread_patch(payload);
    let reads = rows.apply_journaled(
        [JournaledRow {
            payload: &payload,
            cursor: 2,
            streamed_preview: None,
            seed: None,
        }],
        100,
    );
    assert!(reads.is_empty(), "the row is known");
    let frames = tokio::time::timeout(
        Duration::from_secs(3),
        subscription.next_frames(|_: &str| false),
    )
    .await
    .unwrap_or_default();
    frames
        .first()
        .and_then(|frame| frame["rows"].get(0))
        .cloned()
        .unwrap_or(Value::Null)
}

async fn wait_result(
    service: &OrchestrationService,
    child: &AppThreadId,
) -> Result<Value, Box<dyn std::error::Error>> {
    let (success, waited) = call(
        service,
        CLAUDE,
        CLAUDE_PARENT,
        "codewide_wait_agent",
        json!({"agentThreadId": child.as_str(), "timeoutSeconds": 5}),
    )
    .await;
    assert!(success, "{waited}");
    Ok(waited)
}

fn subagent_running(rows: &[Value], child: &AppThreadId) -> Option<Value> {
    rows.iter()
        .find(|row| row["id"] == child.as_str())
        .map(|row| row["running"].clone())
}

#[tokio::test]
async fn a_dropped_live_end_is_reconciled_from_history_to_idle() -> TestResult {
    let mut harness = harness(":workspace").await?;
    let child = spawn_codex_child(&harness).await?;
    let turn = tracked_turn(&harness.service, &child).await?;
    assert_eq!(
        subagent_running(&harness.service.subagent_rows(CLAUDE_PARENT).await?, &child),
        Some(Value::Bool(true))
    );
    // The turn ends, but its live `turn/completed` never arrives.
    harness
        .codex
        .set_turns(child.as_str(), vec![ended_turn(&turn, "finished quietly")]);
    harness.codex.set_status(child.as_str(), ThreadStatus::Idle);

    let settled = eventually("the tracker settles", async || {
        Ok(harness
            .service
            .tracker
            .state(child.as_str())
            .filter(|state| !state.is_running()))
    })
    .await?;
    assert_eq!(
        settled,
        ChildState::Settled {
            end: crate::agent::client_wire::observe::TurnEnd::Completed,
            turn_id: Some(turn.as_str().to_owned()),
            final_message: Some("finished quietly".into()),
        }
    );
    let waited = wait_result(&harness.service, &child).await?;
    assert_eq!(waited["status"], "completed");
    assert_eq!(waited["finalMessage"], "finished quietly");

    let end = journaled_end(&mut harness.journal, &child, &turn).await?;
    assert_eq!(end["params"]["turn"]["status"], "completed");
    assert_eq!(end["params"]["turn"]["items"], json!([]));
    assert_eq!(end["params"]["turn"]["itemsView"], "notLoaded");
    assert_eq!(list_row_after(&child, end).await["status"]["type"], "idle");
    assert_eq!(
        subagent_running(&harness.service.subagent_rows(CLAUDE_PARENT).await?, &child),
        Some(Value::Bool(false))
    );
    assert!(
        harness
            .codex
            .observed()
            .iter()
            .any(|observed| observed == child.as_str()),
        "the reconciler subscribes to the child's live events"
    );
    Ok(())
}

#[tokio::test]
async fn a_turn_that_ended_during_a_restart_is_idle_after_startup() -> TestResult {
    let harness = harness(":workspace").await?;
    let child = spawn_codex_child(&harness).await?;
    let turn = tracked_turn(&harness.service, &child).await?;
    // The companion stops while the child's turn runs: the old process never
    // reads the child again.
    harness.codex.set_history_unreadable(child.as_str(), true);

    // The turn ends during the downtime; the restarted companion reads the
    // provider afresh, with an empty in-memory tracker.
    let codex = Arc::new(
        ScriptedProvider::new(CODEX, {
            let mut value = capabilities(false);
            value.codex_native = true;
            value
        })
        .with_profiles(&CODEX_PROFILES)
        .with_thread(harness.codex.thread(child.as_str()).ok_or("child thread")?),
    );
    codex.set_turns(child.as_str(), vec![ended_turn(&turn, "done offline")]);
    codex.set_status(child.as_str(), ThreadStatus::Idle);
    let codex_dyn: Arc<dyn AgentProvider> = codex.clone();
    let claude_dyn: Arc<dyn AgentProvider> = harness.claude.clone();
    let registry = Arc::new(ProviderRegistry::new(
        vec![codex_dyn, claude_dyn],
        &ProviderId::from_static(CODEX),
        Vec::new(),
    )?);
    let gateway = Arc::new(ClientWireGateway::new(
        registry,
        Arc::new(BindingStore::new(harness.store.clone())),
    ));
    let (journal_tx, mut journal) = tokio::sync::mpsc::channel(16);
    let (events, _events) = tokio::sync::mpsc::channel(16);
    let restarted = OrchestrationService::with_turn_delivery(
        gateway,
        &harness.store,
        journal_tx,
        Arc::new(ProfileObservations::default()),
        crate::turn_delivery::TurnDelivery::new(
            harness.store.clone(),
            Arc::new(tokio::sync::Notify::new()),
            events,
        ),
        Arc::new(std::sync::RwLock::new(None)),
    );

    let end = journaled_end(&mut journal, &child, &turn).await?;
    assert_eq!(
        restarted
            .tracker
            .state(child.as_str())
            .map(|state| state.status()),
        Some(crate::agent::orchestration::tools::AgentStatus::Completed)
    );
    assert_eq!(list_row_after(&child, end).await["status"]["type"], "idle");
    assert_eq!(
        subagent_running(&restarted.subagent_rows(CLAUDE_PARENT).await?, &child),
        Some(Value::Bool(false))
    );
    let waited = wait_result(&restarted, &child).await?;
    assert_eq!(waited["status"], "completed");
    assert_eq!(waited["finalMessage"], "done offline");
    assert_eq!(
        codex.observed().first().map(String::as_str),
        Some(child.as_str()),
        "after startup the child is subscribed before its history is read"
    );
    Ok(())
}

#[test]
fn a_history_end_never_overrides_a_newer_tracked_turn() {
    use crate::agent::client_wire::observe::TurnEnd;
    let tracker = super::super::coordinator::watch::ChildTracker::default();
    let settled = |turn: &str| ChildState::Settled {
        end: TurnEnd::Completed,
        turn_id: Some(turn.into()),
        final_message: None,
    };
    tracker.register(
        "c",
        ChildState::Running {
            turn_id: Some("newer".into()),
        },
    );
    assert!(
        !tracker.settle_from_history("c", settled("older"), &["older"], true),
        "the tracked turn is not shown ended"
    );
    assert!(tracker.state("c").is_some_and(|state| state.is_running()));
    assert!(tracker.settle_from_history("c", settled("newer"), &["older", "newer"], true));
    assert!(
        !tracker.settle_from_history("c", settled("newer"), &["newer"], true),
        "one end is applied once"
    );
    assert!(!tracker.settle_from_history("absent", settled("t"), &["t"], false));
    assert_eq!(tracker.state("absent"), None);
}
