//! Regression coverage for durable orchestration review rework.

use super::*;
use crate::{
    agent::{
        model::{ClientMessageId, ThreadCreateParams, ThreadSettings, UserContent},
        orchestration::{
            journal::AdmissionRecord,
            task::{
                AttemptId, AttemptState, CompletionDelivery, DeliveryId, DeliveryRoute,
                DeliveryState, HostProvenance, OrchestrationTask, PermissionEnvelope,
                PublicTaskStatus, TaskAttempt, TaskId, TaskState, WaitMode, WorkspaceClaim,
                WorkspaceClaimId, WorkspaceClaimState, WorkspaceMode,
            },
        },
    },
    store::{OutboxClaimOutcome, OutboxClaimResolution},
    turn_delivery::InitialTurnReservation,
};
use redb::ReadableDatabase;

fn admission(task_id: &TaskId, child: &AppThreadId, call_key: &str) -> (AdmissionRecord, String) {
    let attempt_id = AttemptId::new();
    let delivery_id = DeliveryId::new();
    let workspace_claim_id = WorkspaceClaimId::new();
    let command_id = format!("task-turn-{call_key}");
    let record = AdmissionRecord {
        call_key: call_key.into(),
        request_hash: "request".into(),
        initial_turn: InitialTurnReservation {
            task_id: task_id.as_str().to_owned(),
            command_id: command_id.clone(),
            params: json!({
                "input": [{"type": "text", "text": "inspect"}],
                "model": "claude-default",
                "permissions": ":read-only"
            }),
            created_at_ms: 1,
        },
        task: OrchestrationTask {
            task_id: task_id.clone(),
            parent_thread_id: AppThreadId::from_static(PARENT),
            root_thread_id: AppThreadId::from_static(PARENT),
            provenance: HostProvenance::AgentSelected,
            wait_mode: WaitMode::Deferred,
            workspace_mode: WorkspaceMode::SharedReadOnly,
            state: TaskState::Admitted,
            authoritative_attempt_id: attempt_id.clone(),
            delivery_id: delivery_id.clone(),
            provider: ProviderId::from_static("claude"),
            model: "claude-default".into(),
            name: None,
            permission: PermissionEnvelope {
                parent_ceiling: ":workspace".into(),
                requested_profile: None,
                translated_profile: ":read-only".into(),
            },
            workspace_claim_id: workspace_claim_id.clone(),
            created_at_ms: 1,
            updated_at_ms: 1,
        },
        attempt: TaskAttempt {
            attempt_id,
            task_id: task_id.clone(),
            command_id: command_id.clone(),
            state: AttemptState::ChildPlanned {
                child_thread_id: child.clone(),
            },
        },
        delivery: CompletionDelivery {
            delivery_id,
            task_id: task_id.clone(),
            route: DeliveryRoute::AwaitingResume,
            state: DeliveryState::Pending,
            dedupe_key: format!("task-completion:{}", task_id.as_str()),
        },
        workspace: WorkspaceClaim {
            claim_id: workspace_claim_id,
            mode: WorkspaceMode::SharedReadOnly,
            state: WorkspaceClaimState::Shared {
                effective_cwd: "/repo".into(),
            },
        },
    };
    (record, command_id)
}

fn restart(harness: &Harness) -> Arc<OrchestrationService> {
    let (journal, _journal_rx) = tokio::sync::mpsc::channel(1);
    OrchestrationService::with_turn_delivery(
        harness.gateway.clone(),
        &harness.store,
        journal.clone(),
        Arc::new(ProfileObservations::default()),
        crate::turn_delivery::TurnDelivery::new(
            harness.store.clone(),
            Arc::new(tokio::sync::Notify::new()),
            journal,
        ),
        Arc::new(std::sync::RwLock::new(None)),
    )
}

async fn call_task(
    service: &OrchestrationService,
    call_id: &str,
    tool: &str,
    arguments: Value,
) -> (bool, Value) {
    let ToolCallResult { success, content } = service
        .call(
            &ProviderId::from_static("codex"),
            ToolCallParams {
                app_thread_id: AppThreadId::from_static(PARENT),
                turn_id: TurnId::from_static("parent-turn"),
                call_id: call_id.to_owned(),
                tool: tool.to_owned(),
                arguments,
            },
        )
        .await;
    let text = content
        .into_iter()
        .map(|ToolResultContent::Text { text }| text)
        .collect::<String>();
    let value = serde_json::from_str(&text).unwrap_or(Value::String(text));
    (success, value)
}

fn reservation_exists(
    store: &IndexStore,
    command_id: &str,
) -> Result<bool, Box<dyn std::error::Error>> {
    let read = store.database().begin_read()?;
    let table = read.open_table(crate::store::turn_delivery_tables::RESERVATIONS)?;
    Ok(table.get(command_id)?.is_some())
}

#[test]
fn task_journal_has_no_turn_reservation_storage_dependency() {
    let journal_source = include_str!("journal.rs");
    assert!(!journal_source.contains("ReservedTurnCommand"));
    assert!(!journal_source.contains("turn_delivery_tables"));
    assert!(journal_source.contains("reserve_initial_turn"));
}

#[tokio::test]
async fn one_child_thread_cannot_be_bound_to_two_tasks() -> TestResult {
    let harness = harness(":workspace").await?;
    let child = AppThreadId::from_static("shared-child");
    let first_task = TaskId::new();
    let second_task = TaskId::new();
    let (first, _) = admission(&first_task, &child, "first-child-owner");
    let (second, _) = admission(&second_task, &child, "second-child-owner");
    harness.service.task_journal.admit(first).await?;
    harness.service.task_journal.admit(second).await?;

    harness
        .service
        .task_journal
        .bind_child(&first_task, child.clone())
        .await?;
    let Err(conflict) = harness
        .service
        .task_journal
        .bind_child(&second_task, child.clone())
        .await
    else {
        return Err("a child was reassigned to another task".into());
    };
    assert!(conflict.to_string().contains("already bound"));
    assert_eq!(
        harness
            .service
            .task_journal
            .get_for_child(child.as_str())
            .await?
            .ok_or("indexed task")?
            .task
            .task_id,
        first_task
    );
    assert_eq!(
        harness
            .service
            .task_journal
            .get(&second_task)
            .await?
            .task
            .state,
        TaskState::Admitted
    );
    Ok(())
}

#[tokio::test]
async fn admission_conflict_and_failed_transaction_leave_no_orphan_prompt() -> TestResult {
    let harness = harness(":workspace").await?;
    let (success, first) = call_task(
        &harness.service,
        "atomic-admission",
        "codewide_delegate_task",
        json!({
            "prompt": "first",
            "waitMode": "deferred",
            "provider": "claude",
            "workspace": {"mode": "sharedReadOnly"}
        }),
    )
    .await;
    assert!(success, "{first}");
    let task_id =
        TaskId::parse(first["taskId"].as_str().ok_or("task id")?).ok_or("valid task id")?;
    let command_id = harness
        .service
        .task_journal
        .get(&task_id)
        .await?
        .attempt
        .command_id;
    let (success, _) = call_task(
        &harness.service,
        "atomic-admission",
        "codewide_delegate_task",
        json!({
            "prompt": "different",
            "waitMode": "deferred",
            "provider": "claude",
            "workspace": {"mode": "sharedReadOnly"}
        }),
    )
    .await;
    assert!(!success);
    assert!(
        !reservation_exists(&harness.store, &command_id)?,
        "a conflicting replay must not recreate a promoted prompt reservation"
    );

    let failed_task = TaskId::new();
    let child = AppThreadId::from_static("atomic-rollback-child");
    let (mut invalid, invalid_command) = admission(&failed_task, &child, "atomic-rollback");
    invalid.initial_turn.task_id = TaskId::new().as_str().to_owned();
    assert!(harness.service.task_journal.admit(invalid).await.is_err());
    assert!(
        harness
            .service
            .task_journal
            .get(&failed_task)
            .await
            .is_err()
    );
    assert!(!reservation_exists(&harness.store, &invalid_command)?);
    Ok(())
}

#[tokio::test]
async fn lost_start_response_reopens_with_the_history_turn_and_waits_for_its_result() -> TestResult
{
    let harness = harness(":workspace").await?;
    let task_id = TaskId::new();
    let child = AppThreadId::from_static("lost-response-child");
    let (record, command_id) = admission(&task_id, &child, "lost-response");
    harness.service.task_journal.admit(record).await?;
    arrange_lost_start_response(&harness, &task_id, &child, &command_id).await?;

    let restarted = restart(&harness);
    let (success, result) = call_task(
        &restarted,
        "reopened-wait",
        "codewide_wait_task",
        json!({"taskId": task_id.as_str(), "timeoutSeconds": 1}),
    )
    .await;
    assert!(success, "{result}");
    assert_eq!(result["status"], "succeeded");
    assert_eq!(result["finalMessage"], "recovered");
    assert_eq!(
        restarted
            .task_journal
            .get(&task_id)
            .await?
            .attempt
            .state
            .provider_turn_id()
            .map(TurnId::as_str),
        Some("history-turn")
    );
    Ok(())
}

async fn arrange_lost_start_response(
    harness: &Harness,
    task_id: &TaskId,
    child: &AppThreadId,
    command_id: &str,
) -> TestResult {
    harness
        .service
        .task_journal
        .bind_child(task_id, child.clone())
        .await?;
    harness
        .gateway
        .bindings()
        .bind(
            child,
            &ProviderId::from_static("claude"),
            BindingOrigin::Created,
        )
        .await?;
    harness
        .claude
        .thread_create(ThreadCreateParams {
            app_thread_id: Some(child.clone()),
            cwd: "/repo".into(),
            settings: ThreadSettings {
                model: "claude-default".into(),
                effort: None,
                permission_profile: ":read-only".into(),
                service_tier: None,
            },
            client_tools: None,
        })
        .await?;
    harness
        .store
        .promote_orchestration_turn(command_id, child.as_str(), None)?;
    harness.service.task_journal.turn_queued(task_id).await?;
    let OutboxClaimOutcome::Acquired { token, .. } =
        harness.store.outbox_claim_dispatch(command_id)?
    else {
        return Err("initial turn was not claimable".into());
    };
    harness.store.outbox_resolve_claim(
        command_id,
        token,
        OutboxClaimResolution::Indeterminate {
            error: "lost response",
            retry_after_ms: 0,
        },
    )?;
    harness
        .claude
        .set_status(child.as_str(), ThreadStatus::Idle);
    harness.claude.set_turns(
        child.as_str(),
        vec![AgentTurn {
            turn_id: TurnId::from_static("history-turn"),
            status: TurnStatus::Completed,
            origin: TurnOrigin::User,
            started_at: 1,
            completed_at: Some(2),
            error: None,
            items: vec![
                AgentItem::UserMessage {
                    item_id: ItemId::from_static("history-user"),
                    provenance: None,
                    client_message_id: ClientMessageId::parse(command_id),
                    content: vec![UserContent::Text {
                        text: "inspect".into(),
                    }],
                },
                AgentItem::AgentMessage {
                    item_id: ItemId::from_static("history-answer"),
                    provenance: None,
                    text: "recovered".into(),
                    phase: MessagePhase::Final,
                },
            ],
            provenance: None,
            usage: None,
        }],
    );
    tokio::time::timeout(Duration::from_secs(5), async {
        loop {
            let command = harness.store.outbox_get(command_id)?.ok_or("command")?;
            if command.delivered_turn_id.as_deref() == Some("history-turn") {
                return Ok::<(), Box<dyn std::error::Error>>(());
            }
            tokio::task::yield_now().await;
        }
    })
    .await??;

    Ok(())
}

#[tokio::test]
async fn a_terminal_event_waits_for_the_matching_persisted_start_receipt() -> TestResult {
    let harness = harness(":workspace").await?;
    let task_id = TaskId::new();
    let child = AppThreadId::from_static("late-receipt-child");
    let (record, _) = admission(&task_id, &child, "late-receipt");
    harness.service.task_journal.admit(record).await?;
    harness
        .service
        .task_journal
        .bind_child(&task_id, child.clone())
        .await?;
    assert!(
        harness
            .service
            .task_journal
            .observe_terminal(
                &ProviderId::from_static("claude"),
                child.as_str(),
                TurnId::from_static("wrong-turn"),
                crate::agent::client_wire::observe::TurnEnd::Completed,
            )
            .await?
            .is_none()
    );
    assert!(
        !harness
            .service
            .task_journal
            .get(&task_id)
            .await?
            .task
            .state
            .is_terminal()
    );
    harness
        .service
        .task_journal
        .observe_started(
            &ProviderId::from_static("claude"),
            child.as_str(),
            TurnId::from_static("right-turn"),
        )
        .await?;
    assert!(
        harness
            .service
            .task_journal
            .observe_terminal(
                &ProviderId::from_static("claude"),
                child.as_str(),
                TurnId::from_static("wrong-turn"),
                crate::agent::client_wire::observe::TurnEnd::Completed,
            )
            .await?
            .is_none()
    );
    let terminal = harness
        .service
        .task_journal
        .observe_terminal(
            &ProviderId::from_static("claude"),
            child.as_str(),
            TurnId::from_static("right-turn"),
            crate::agent::client_wire::observe::TurnEnd::Completed,
        )
        .await?
        .ok_or("matching terminal event")?;
    assert_eq!(terminal.task.state, TaskState::Succeeded);
    Ok(())
}

#[tokio::test]
async fn recovery_error_after_receipt_preserves_turn_binding_and_terminalizes() -> TestResult {
    let harness = harness(":workspace").await?;
    let task_id = TaskId::new();
    let child = AppThreadId::from_static("recovery-error-child");
    let provider = ProviderId::from_static("claude");
    let provider_turn = TurnId::from_static("recovery-error-turn");
    let (record, _) = admission(&task_id, &child, "recovery-error-after-receipt");
    harness.service.task_journal.admit(record).await?;
    harness
        .service
        .task_journal
        .bind_child(&task_id, child.clone())
        .await?;
    harness
        .service
        .task_journal
        .observe_started(&provider, child.as_str(), provider_turn.clone())
        .await?
        .ok_or("start receipt was not applied")?;

    let preserved = harness
        .service
        .task_journal
        .mark_start_uncertain(&task_id)
        .await?;
    assert_eq!(preserved.task.state, TaskState::Running);
    assert_eq!(
        preserved.attempt.state.provider_turn_id(),
        Some(&provider_turn)
    );

    let terminal = harness
        .service
        .task_journal
        .observe_terminal(
            &provider,
            child.as_str(),
            provider_turn.clone(),
            crate::agent::client_wire::observe::TurnEnd::Completed,
        )
        .await?
        .ok_or("terminal fact was not applied")?;
    assert_eq!(terminal.task.state, TaskState::Succeeded);
    assert_eq!(
        terminal.attempt.state.provider_turn_id(),
        Some(&provider_turn)
    );
    Ok(())
}

#[tokio::test]
async fn a_foreign_provider_cannot_end_wait_delivery_queue_or_tracker_state() -> TestResult {
    let harness = harness(":workspace").await?;
    let (success, delegated) = call_task(
        &harness.service,
        "provider-fence",
        "codewide_delegate_task",
        json!({
            "prompt": "inspect",
            "waitMode": "deferred",
            "provider": "claude",
            "workspace": {"mode": "sharedReadOnly"}
        }),
    )
    .await;
    assert!(success, "{delegated}");
    let task_id =
        TaskId::parse(delegated["taskId"].as_str().ok_or("task id")?).ok_or("valid task id")?;
    let child = delegated["agentThreadId"]
        .as_str()
        .ok_or("child id")?
        .to_owned();
    tokio::time::timeout(Duration::from_secs(5), async {
        loop {
            if harness
                .service
                .task_journal
                .get(&task_id)
                .await?
                .attempt
                .state
                .provider_turn_id()
                .is_some()
            {
                return Ok::<(), Box<dyn std::error::Error>>(());
            }
            tokio::task::yield_now().await;
        }
    })
    .await??;
    let (_, queued) = call(
        &harness.service,
        "codex",
        PARENT,
        "codewide_send_agent",
        json!({"agentThreadId": child, "message": "follow up"}),
    )
    .await;
    assert_eq!(queued["status"], "queued");
    let service = harness.service.clone();
    let task_id_for_wait = task_id.clone();
    let wait = tokio::spawn(async move {
        call_task(
            &service,
            "provider-fence-wait",
            "codewide_wait_task",
            json!({"taskId": task_id_for_wait.as_str(), "timeoutSeconds": 30}),
        )
        .await
    });
    tokio::time::sleep(Duration::from_millis(25)).await;
    harness.service.observe_event(
        &ProviderId::from_static("codex"),
        &completed(&child, "claude-turn-1", "completed"),
    );
    tokio::time::sleep(Duration::from_millis(50)).await;
    assert!(!wait.is_finished());
    let bundle = harness.service.task_journal.get(&task_id).await?;
    assert_eq!(bundle.task.state, TaskState::Running);
    assert_eq!(bundle.delivery.state, DeliveryState::Pending);
    assert!(
        harness
            .service
            .tracker
            .state(&child)
            .is_some_and(|state| state.is_running())
    );
    assert_eq!(harness.claude.started().len(), 1);

    harness.service.observe_event(
        &ProviderId::from_static("claude"),
        &completed(&child, "claude-turn-1", "completed"),
    );
    let (wait_success, waited) = tokio::time::timeout(Duration::from_secs(5), wait).await??;
    assert!(wait_success, "{waited}");
    assert_eq!(waited["status"], "succeeded");
    tokio::time::timeout(Duration::from_secs(5), async {
        while harness.claude.started().len() < 2 {
            tokio::task::yield_now().await;
        }
    })
    .await?;
    Ok(())
}

async fn host_minted_recovery(existing: bool) -> TestResult {
    let harness = harness(":workspace").await?;
    let task_id = TaskId::new();
    let child = AppThreadId::from_static(if existing {
        "existing-host-child"
    } else {
        "absent-host-child"
    });
    let (record, _) = admission(&task_id, &child, child.as_str());
    harness.service.task_journal.admit(record).await?;
    harness
        .service
        .task_journal
        .mark_start_uncertain(&task_id)
        .await?;
    if existing {
        harness
            .claude
            .thread_create(ThreadCreateParams {
                app_thread_id: Some(child.clone()),
                cwd: "/repo".into(),
                settings: ThreadSettings {
                    model: "claude-default".into(),
                    effort: None,
                    permission_profile: ":read-only".into(),
                    service_tier: None,
                },
                client_tools: None,
            })
            .await?;
    }
    let restarted = restart(&harness);
    tokio::time::timeout(Duration::from_secs(5), async {
        loop {
            restarted
                .drive_task(&task_id)
                .await
                .map_err(|error| std::io::Error::other(error.render()))?;
            if !harness.claude.started().is_empty() {
                return Ok::<(), Box<dyn std::error::Error>>(());
            }
            tokio::task::yield_now().await;
        }
    })
    .await??;
    assert_eq!(harness.claude.created().len(), 1);
    assert_eq!(harness.claude.started().len(), 1);
    let snapshot = restarted
        .task_snapshot(&task_id)
        .await
        .map_err(|error| std::io::Error::other(error.render()))?;
    assert_eq!(snapshot.status, PublicTaskStatus::Running);
    assert_eq!(snapshot.agent_thread_id.as_deref(), Some(child.as_str()));
    Ok(())
}

#[tokio::test]
async fn host_minted_uncertain_start_reuses_an_existing_child() -> TestResult {
    host_minted_recovery(true).await
}

#[tokio::test]
async fn host_minted_uncertain_start_recreates_only_a_proven_absent_child() -> TestResult {
    host_minted_recovery(false).await
}
