//! Contract tests for durable task-addressed delegation.

use super::*;
use crate::agent::orchestration::{
    journal::AdmissionRecord,
    task::{
        AttemptId, AttemptState, CompletionDelivery, DeliveryId, DeliveryRoute, DeliveryState,
        HostProvenance, OrchestrationTask, PermissionEnvelope, PublicTaskStatus, RecoveryAction,
        TaskAttempt, TaskId, TaskState, WaitMode, WorkspaceClaim, WorkspaceClaimId,
        WorkspaceClaimState, WorkspaceMode,
    },
};

async fn task_call(
    service: &OrchestrationService,
    call_id: &str,
    tool: &str,
    arguments: Value,
) -> (bool, Value) {
    let result = service
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
    let ToolCallResult { success, content } = result;
    let text = content
        .into_iter()
        .map(|ToolResultContent::Text { text }| text)
        .collect::<String>();
    let value = serde_json::from_str(&text).unwrap_or(Value::String(text));
    (success, value)
}

fn deferred(prompt: &str) -> Value {
    json!({
        "prompt": prompt,
        "waitMode": "deferred",
        "provider": "claude",
        "workspace": {"mode": "sharedReadOnly"}
    })
}

#[tokio::test]
async fn delegate_rollout_gate_denies_only_new_task_admission() -> TestResult {
    let harness = harness(":workspace").await?;
    harness.service.set_delegate_task_enabled(false);
    let (success, rejection) = task_call(
        &harness.service,
        "disabled-delegate",
        "codewide_delegate_task",
        deferred("inspect"),
    )
    .await;
    assert!(!success);
    assert_eq!(rejection["code"], "capability_unavailable");
    assert!(harness.service.task_journal.pending().await?.is_empty());
    assert!(harness.claude.created().is_empty());

    let (success, spawned) = call(
        &harness.service,
        "codex",
        PARENT,
        "codewide_spawn_agent",
        json!({"prompt": "compatibility", "provider": "claude"}),
    )
    .await;
    assert!(success, "{spawned}");
    Ok(())
}

#[tokio::test]
async fn delegate_rejects_model_supplied_authority_fields_before_admission() -> TestResult {
    let harness = harness(":workspace").await?;
    for field in [
        "provenance",
        "explicitUserRequest",
        "sharedWriteExplicit",
        "grantId",
    ] {
        let mut arguments = deferred("inspect");
        arguments[field] = json!(true);
        let (success, _) =
            task_call(&harness.service, field, "codewide_delegate_task", arguments).await;
        assert!(!success, "{field}");
    }
    let (success, rejection) = task_call(
        &harness.service,
        "isolated",
        "codewide_delegate_task",
        json!({
            "prompt": "inspect",
            "waitMode": "deferred",
            "workspace": {"mode": "isolatedWrite"}
        }),
    )
    .await;
    assert!(!success);
    assert_eq!(rejection["code"], "workspace_unavailable");
    assert!(harness.claude.created().is_empty());
    Ok(())
}

#[tokio::test]
async fn delegate_call_identity_is_idempotent_and_conflict_checked() -> TestResult {
    let harness = harness(":workspace").await?;
    let (success, first) = task_call(
        &harness.service,
        "delegate-1",
        "codewide_delegate_task",
        deferred("inspect"),
    )
    .await;
    assert!(success);
    let (success, repeated) = task_call(
        &harness.service,
        "delegate-1",
        "codewide_delegate_task",
        deferred("inspect"),
    )
    .await;
    assert!(success);
    assert_eq!(repeated["taskId"], first["taskId"]);
    assert_eq!(harness.claude.created().len(), 1);

    let (success, conflict) = task_call(
        &harness.service,
        "delegate-1",
        "codewide_delegate_task",
        deferred("different"),
    )
    .await;
    assert!(!success);
    assert!(
        conflict
            .as_str()
            .is_some_and(|message| message.contains("different arguments"))
    );
    assert_eq!(harness.claude.created().len(), 1);
    Ok(())
}

#[tokio::test]
async fn durable_task_journal_does_not_persist_prompt_material() -> TestResult {
    let harness = harness(":workspace").await?;
    let secret_prompt = "prompt-owned-only-by-turn-delivery-7e6c";
    let (success, delegated) = task_call(
        &harness.service,
        "prompt-owner",
        "codewide_delegate_task",
        deferred(secret_prompt),
    )
    .await;
    assert!(success, "{delegated}");
    let task_id =
        TaskId::parse(delegated["taskId"].as_str().ok_or("task id")?).ok_or("valid task id")?;
    let bundle = harness.service.task_journal.get(&task_id).await?;
    let persisted = serde_json::to_string(&(
        bundle.task,
        bundle.attempt,
        bundle.delivery,
        bundle.workspace,
    ))?;
    assert!(!persisted.contains(secret_prompt));
    Ok(())
}

#[tokio::test]
async fn wait_returns_the_initial_turn_result_and_acknowledges_delivery() -> TestResult {
    let harness = harness(":workspace").await?;
    let (success, delegated) = task_call(
        &harness.service,
        "delegate-result",
        "codewide_delegate_task",
        deferred("inspect"),
    )
    .await;
    assert!(success);
    let task_id =
        TaskId::parse(delegated["taskId"].as_str().ok_or("task id")?).ok_or("valid task id")?;
    let child = delegated["agentThreadId"].as_str().ok_or("child id")?;
    tokio::time::timeout(Duration::from_secs(5), async {
        loop {
            let _ = harness
                .service
                .task_snapshot(&task_id)
                .await
                .map_err(|error| std::io::Error::other(error.render()))?;
            let bundle = harness.service.task_journal.get(&task_id).await?;
            if bundle.attempt.state.provider_turn_id().is_some() {
                return Ok::<(), Box<dyn std::error::Error>>(());
            }
            tokio::task::yield_now().await;
        }
    })
    .await??;
    harness.claude.set_status(child, ThreadStatus::Idle);
    harness.claude.set_turns(
        child,
        vec![AgentTurn {
            turn_id: TurnId::from_static("claude-turn-1"),
            status: TurnStatus::Completed,
            origin: TurnOrigin::User,
            started_at: 1,
            completed_at: Some(2),
            error: None,
            items: vec![AgentItem::AgentMessage {
                item_id: ItemId::from_static("task-answer"),
                provenance: None,
                text: "done".into(),
                phase: MessagePhase::Final,
            }],
            provenance: None,
            usage: None,
        }],
    );
    harness.service.observe_event(
        &ProviderId::from_static("claude"),
        &completed(child, "claude-turn-1", "completed"),
    );
    tokio::time::timeout(Duration::from_secs(5), async {
        loop {
            if harness.service.task_journal.get(&task_id).await?.task.state == TaskState::Succeeded
            {
                return Ok::<(), Box<dyn std::error::Error>>(());
            }
            tokio::task::yield_now().await;
        }
    })
    .await??;
    let (success, result) = task_call(
        &harness.service,
        "wait-result",
        "codewide_wait_task",
        json!({"taskId": task_id.as_str(), "timeoutSeconds": 0}),
    )
    .await;
    assert!(success);
    assert_eq!(result["status"], "succeeded");
    assert_eq!(result["finalMessage"], "done");
    assert_eq!(
        harness
            .service
            .task_journal
            .get(&task_id)
            .await?
            .delivery
            .state,
        DeliveryState::Acknowledged
    );
    let unchanged = harness
        .service
        .task_journal
        .observe_terminal(
            &ProviderId::from_static("claude"),
            child,
            TurnId::from_static("claude-turn-1"),
            crate::agent::client_wire::observe::TurnEnd::Interrupted,
        )
        .await?;
    assert!(unchanged.is_none());
    assert_eq!(
        harness.service.task_journal.get(&task_id).await?.task.state,
        TaskState::Succeeded
    );
    Ok(())
}

#[tokio::test]
async fn another_provider_cannot_spoof_a_task_terminal_event() -> TestResult {
    let harness = harness(":workspace").await?;
    let (success, delegated) = task_call(
        &harness.service,
        "provider-spoof",
        "codewide_delegate_task",
        deferred("inspect"),
    )
    .await;
    assert!(success, "{delegated}");
    let task_id =
        TaskId::parse(delegated["taskId"].as_str().ok_or("task id")?).ok_or("valid task id")?;
    let child = delegated["agentThreadId"].as_str().ok_or("child id")?;
    tokio::time::timeout(Duration::from_secs(5), async {
        loop {
            let _ = harness
                .service
                .task_snapshot(&task_id)
                .await
                .map_err(|error| std::io::Error::other(error.render()))?;
            let bundle = harness.service.task_journal.get(&task_id).await?;
            if bundle.attempt.state.provider_turn_id().is_some() {
                return Ok::<(), Box<dyn std::error::Error>>(());
            }
            tokio::task::yield_now().await;
        }
    })
    .await??;

    harness.service.observe_event(
        &ProviderId::from_static("codex"),
        &completed(child, "claude-turn-1", "completed"),
    );
    tokio::time::sleep(Duration::from_millis(25)).await;
    assert_eq!(
        harness.service.task_journal.get(&task_id).await?.task.state,
        TaskState::Running
    );

    harness.service.observe_event(
        &ProviderId::from_static("claude"),
        &completed(child, "claude-turn-1", "completed"),
    );
    tokio::time::timeout(Duration::from_secs(5), async {
        loop {
            if harness.service.task_journal.get(&task_id).await?.task.state == TaskState::Succeeded
            {
                return Ok::<(), Box<dyn std::error::Error>>(());
            }
            tokio::task::yield_now().await;
        }
    })
    .await??;
    Ok(())
}

#[tokio::test]
async fn reopened_service_reconciles_terminal_turns_without_live_events() -> TestResult {
    for (case, turn_status, expected) in [
        ("completed", TurnStatus::Completed, TaskState::Succeeded),
        ("failed", TurnStatus::Failed, TaskState::Failed),
        ("interrupted", TurnStatus::Interrupted, TaskState::Cancelled),
    ] {
        let harness = harness(":workspace").await?;
        let (success, delegated) = task_call(
            &harness.service,
            &format!("reopen-{case}"),
            "codewide_delegate_task",
            deferred("inspect"),
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
                let _ = harness
                    .service
                    .task_snapshot(&task_id)
                    .await
                    .map_err(|error| std::io::Error::other(error.render()))?;
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
        harness.claude.set_status(&child, ThreadStatus::Idle);
        harness.claude.set_turns(
            &child,
            vec![AgentTurn {
                turn_id: TurnId::from_static("claude-turn-1"),
                status: turn_status,
                origin: TurnOrigin::User,
                started_at: 1,
                completed_at: Some(2),
                error: None,
                items: Vec::new(),
                provenance: None,
                usage: None,
            }],
        );
        let (journal, _journal_rx) = tokio::sync::mpsc::channel(1);
        let restarted = OrchestrationService::with_turn_delivery(
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
        );
        let snapshot = restarted
            .task_snapshot(&task_id)
            .await
            .map_err(|error| std::io::Error::other(error.render()))?;
        assert_eq!(
            restarted.task_journal.get(&task_id).await?.task.state,
            expected,
            "{case}"
        );
        assert!(matches!(
            snapshot.status,
            PublicTaskStatus::Succeeded | PublicTaskStatus::Failed | PublicTaskStatus::Cancelled
        ));
    }
    Ok(())
}

#[tokio::test]
async fn cancel_task_records_intent_once_and_waits_for_provider_terminal() -> TestResult {
    let harness = harness(":workspace").await?;
    let (success, delegated) = task_call(
        &harness.service,
        "delegate-cancel",
        "codewide_delegate_task",
        deferred("inspect"),
    )
    .await;
    assert!(success);
    let task_id =
        TaskId::parse(delegated["taskId"].as_str().ok_or("task id")?).ok_or("valid task id")?;
    let child = delegated["agentThreadId"].as_str().ok_or("child id")?;
    tokio::time::timeout(Duration::from_secs(5), async {
        loop {
            let snapshot = harness
                .service
                .task_snapshot(&task_id)
                .await
                .map_err(|error| std::io::Error::other(error.render()))?;
            if snapshot.status == crate::agent::orchestration::task::PublicTaskStatus::Running
                && harness
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

    let (success, cancelling) = task_call(
        &harness.service,
        "cancel-1",
        "codewide_cancel_task",
        json!({"taskId": task_id.as_str()}),
    )
    .await;
    assert!(success);
    assert_eq!(cancelling["status"], "cancelling");
    assert_eq!(harness.claude.interrupted().len(), 1);
    let (success, repeated) = task_call(
        &harness.service,
        "cancel-2",
        "codewide_cancel_task",
        json!({"taskId": task_id.as_str()}),
    )
    .await;
    assert!(success);
    assert_eq!(repeated["status"], "cancelling");
    assert_eq!(harness.claude.interrupted().len(), 1);

    harness.service.observe_event(
        &ProviderId::from_static("claude"),
        &completed(child, "claude-turn-1", "interrupted"),
    );
    tokio::time::timeout(Duration::from_secs(5), async {
        loop {
            if harness.service.task_journal.get(&task_id).await?.task.state == TaskState::Cancelled
            {
                return Ok::<(), Box<dyn std::error::Error>>(());
            }
            tokio::task::yield_now().await;
        }
    })
    .await??;
    let (success, cancelled) = task_call(
        &harness.service,
        "wait-cancelled",
        "codewide_wait_task",
        json!({"taskId": task_id.as_str(), "timeoutSeconds": 0}),
    )
    .await;
    assert!(success);
    assert_eq!(cancelled["status"], "cancelled");
    Ok(())
}

async fn claimed_turn_waiting_for_late_receipt(
    harness: &Harness,
) -> Result<(TaskId, AppThreadId, TurnId), Box<dyn std::error::Error>> {
    let task_id = TaskId::new();
    let attempt_id = AttemptId::new();
    let delivery_id = DeliveryId::new();
    let workspace_claim_id = WorkspaceClaimId::new();
    let command_id = format!("task-turn-{}", task_id.as_str());
    let child = AppThreadId::from_static("late-start-child");
    let provider_turn = TurnId::from_static("late-start-turn");

    harness
        .service
        .task_journal
        .admit(AdmissionRecord {
            call_key: "late-start-cancel".into(),
            request_hash: "request".into(),
            initial_turn: crate::turn_delivery::InitialTurnReservation {
                task_id: task_id.as_str().to_owned(),
                command_id: command_id.clone(),
                params: json!({"input": [{"type": "text", "text": "inspect"}]}),
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
                state: AttemptState::Admitted,
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
        })
        .await?;
    harness
        .service
        .task_journal
        .plan_child(&task_id, child.clone())
        .await?;
    harness
        .service
        .task_journal
        .bind_child(&task_id, child.clone())
        .await?;
    harness
        .store
        .promote_orchestration_turn(&command_id, child.as_str(), None)?;
    harness.service.task_journal.turn_queued(&task_id).await?;
    assert!(matches!(
        harness.store.outbox_claim_dispatch(&command_id)?,
        crate::store::OutboxClaimOutcome::Acquired { .. }
    ));
    Ok((task_id, child, provider_turn))
}

#[tokio::test]
async fn a_late_start_receipt_preserves_cancelling_and_interrupts_that_exact_turn() -> TestResult {
    let harness = harness_without_pump(":workspace").await?;
    let (task_id, child, provider_turn) = claimed_turn_waiting_for_late_receipt(&harness).await?;
    let cancelling = harness.service.task_journal.cancel_intent(&task_id).await?;
    harness
        .service
        .resume_cancellation(&cancelling)
        .await
        .map_err(|error| std::io::Error::other(error.render()))?;
    assert_eq!(
        harness.service.task_journal.get(&task_id).await?.task.state,
        TaskState::Cancelling
    );
    assert!(harness.claude.interrupted().is_empty());

    let started = harness
        .service
        .task_journal
        .observe_started(
            &ProviderId::from_static("claude"),
            child.as_str(),
            provider_turn.clone(),
        )
        .await?
        .ok_or("late turn start was not matched")?;
    assert_eq!(started.task.state, TaskState::Cancelling);
    harness
        .service
        .resume_cancellation(&started)
        .await
        .map_err(|error| std::io::Error::other(error.render()))?;
    assert_eq!(
        harness.claude.interrupted(),
        vec![crate::agent::model::TurnInterruptParams {
            app_thread_id: child,
            turn_id: Some(provider_turn),
        }]
    );
    Ok(())
}

#[tokio::test]
async fn provider_minted_create_crash_recovers_as_start_uncertain_without_retry() -> TestResult {
    let harness = harness(":workspace").await?;
    let task_id = TaskId::new();
    let attempt_id = AttemptId::new();
    let delivery_id = DeliveryId::new();
    let workspace_claim_id = WorkspaceClaimId::new();
    let task = OrchestrationTask {
        task_id: task_id.clone(),
        parent_thread_id: AppThreadId::from_static(PARENT),
        root_thread_id: AppThreadId::from_static(PARENT),
        provenance: HostProvenance::AgentSelected,
        wait_mode: WaitMode::Deferred,
        workspace_mode: WorkspaceMode::SharedReadOnly,
        state: TaskState::Admitted,
        authoritative_attempt_id: attempt_id.clone(),
        delivery_id: delivery_id.clone(),
        provider: ProviderId::from_static("codex"),
        model: "gpt-parent".into(),
        name: None,
        permission: PermissionEnvelope {
            parent_ceiling: ":workspace".into(),
            requested_profile: None,
            translated_profile: ":read-only".into(),
        },
        workspace_claim_id: workspace_claim_id.clone(),
        created_at_ms: 1,
        updated_at_ms: 1,
    };
    let command_id = format!("task-turn-{}", task_id.as_str());
    harness
        .service
        .task_journal
        .admit(AdmissionRecord {
            call_key: "provider-minted-crash".into(),
            request_hash: "request".into(),
            initial_turn: crate::turn_delivery::InitialTurnReservation {
                task_id: task_id.as_str().to_owned(),
                command_id: command_id.clone(),
                params: json!({"input": [{"type": "text", "text": "inspect"}]}),
                created_at_ms: 1,
            },
            task,
            attempt: TaskAttempt {
                attempt_id,
                task_id: task_id.clone(),
                command_id,
                state: AttemptState::Admitted,
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
        })
        .await?;
    harness
        .service
        .task_journal
        .provider_create_started(&task_id)
        .await?;
    let (journal, _journal_rx) = tokio::sync::mpsc::channel(1);
    let restarted = OrchestrationService::with_turn_delivery(
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
    );
    let snapshot = tokio::time::timeout(Duration::from_secs(5), async {
        loop {
            let snapshot = restarted
                .task_snapshot(&task_id)
                .await
                .map_err(|error| std::io::Error::other(error.render()))?;
            if snapshot.status == PublicTaskStatus::StartUncertain {
                return Ok::<_, Box<dyn std::error::Error>>(snapshot);
            }
            tokio::task::yield_now().await;
        }
    })
    .await??;
    assert_eq!(snapshot.task_id, task_id.as_str());
    assert_eq!(snapshot.recovery, Some(RecoveryAction::WaitTask));
    assert!(harness.codex.created().is_empty());
    Ok(())
}
