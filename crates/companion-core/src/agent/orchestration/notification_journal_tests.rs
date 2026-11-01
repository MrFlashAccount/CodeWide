//! Durable child work requests: atomic handoff, restart safety, retraction
//! and the `work_requests_backfill_v1` migration of every legacy route.

use redb::{ReadableDatabase, ReadableTable};

use super::*;
use crate::{
    agent::{
        client_wire::observe::TurnEnd,
        orchestration::{
            children::{ChildLink, ChildLinks},
            journal::{HandoffOutcome, TaskJournal},
            task::{
                CompletionDelivery, DeliveryProgress, DeliveryState, ParentDeliveryState, TaskId,
                TaskState,
            },
            work_requests::{
                AckSource, ChildWorkRequest, Delivery, NeverStartedReason, RequestOrigin,
                RequestPhase, RunOutcome, Settlement, WorkRequestId,
            },
        },
    },
    store::{StoreError, orchestration_tables},
    turn_delivery::{
        NoticeCommandState, TurnDelivery, enqueue_completion_in_write, notice_state_in_write,
        open_commands_in_write, retract_notice_in_write,
    },
};

struct Settled {
    _directory: tempfile::TempDir,
    store: Arc<IndexStore>,
    journal: TaskJournal,
    request_id: WorkRequestId,
}

/// A delegated task whose initial request ran in `turn-1` and completed.
async fn settled_task() -> Result<Settled, Box<dyn std::error::Error>> {
    let directory = tempfile::tempdir()?;
    let store = Arc::new(IndexStore::open(directory.path().join("state.redb"))?);
    let journal = TaskJournal::new(store.clone());
    let task_id = TaskId::new();
    let child = AppThreadId::from_static("settled-child");
    let (record, command_id) = rework_tests::admission(&task_id, &child, "settled");
    journal.admit(record).await?;
    journal.bind_child(&task_id, child.clone()).await?;
    test_support::receipt(&journal, &command_id, child.as_str(), "turn-1").await?;
    let bundle = test_support::terminal(
        &journal,
        &ProviderId::from_static("claude"),
        child.as_str(),
        "turn-1",
        TurnEnd::Completed,
    )
    .await?
    .ok_or("the turn did not settle")?;
    assert_eq!(bundle.task.state, TaskState::Succeeded);
    assert!(bundle.request.awaits_handoff());
    Ok(Settled {
        _directory: directory,
        store,
        journal,
        request_id: bundle.request.request_id,
    })
}

fn notice_key(fixture: &Settled) -> String {
    format!("request-notice:{}", fixture.request_id.as_str())
}

async fn hand_off(
    fixture: &Settled,
    enqueue: impl FnOnce(&redb::WriteTransaction, &str, &str) -> Result<(), StoreError> + Send + 'static,
) -> Result<HandoffOutcome, Box<dyn std::error::Error>> {
    Ok(fixture
        .journal
        .hand_off(
            &AppThreadId::from_static(PARENT),
            vec![fixture.request_id.clone()],
            notice_key(fixture),
            notice_state_in_write,
            retract_notice_in_write,
            enqueue,
        )
        .await?)
}

async fn delivery(fixture: &Settled) -> Result<Delivery, Box<dyn std::error::Error>> {
    match fixture
        .journal
        .request(&fixture.request_id)
        .await?
        .ok_or("missing request")?
        .phase
    {
        RequestPhase::Settled { delivery, .. } => Ok(delivery),
        phase => Err(format!("request is not settled: {phase:?}").into()),
    }
}

// A storage failure inside the handoff transaction (disk full) must leave
// neither an outbox command nor an `Enqueued` request.
#[tokio::test]
async fn a_failed_handoff_transaction_leaves_no_partial_state() -> TestResult {
    let fixture = settled_task().await?;
    let failed = hand_off(&fixture, |write, command, parent| {
        enqueue_completion_in_write(write, command, parent, "result")?;
        Err(StoreError::CorruptedIndex("injected disk full".into()))
    })
    .await;
    assert!(failed.is_err());
    assert!(matches!(
        delivery(&fixture).await?,
        Delivery::AwaitingHandoff { .. }
    ));
    assert!(fixture.store.outbox_get(&notice_key(&fixture))?.is_none());
    assert_eq!(
        hand_off(&fixture, |write, command, parent| {
            enqueue_completion_in_write(write, command, parent, "result")
        })
        .await?,
        HandoffOutcome::Enqueued
    );
    assert!(matches!(
        delivery(&fixture).await?,
        Delivery::Enqueued { .. }
    ));
    Ok(())
}

// Restart between settle and handoff: a reopened owner hands the result
// off exactly once; restart between handoff and dispatch: it never hands it
// off again.
#[tokio::test]
async fn restarts_around_the_handoff_produce_exactly_one_outbox_command() -> TestResult {
    let fixture = settled_task().await?;
    let reopened = TaskJournal::new(fixture.store.clone());
    assert!(
        reopened
            .handoffs_by_parent()
            .await?
            .get(&AppThreadId::from_static(PARENT))
            .is_some_and(|requests| requests.len() == 1)
    );
    let harness = harness_without_pump(":workspace").await?;
    let (events, _event_stream) = tokio::sync::mpsc::channel(64);
    let first = OrchestrationService::with_turn_delivery(
        harness.gateway.clone(),
        &fixture.store,
        events.clone(),
        Arc::new(ProfileObservations::default()),
        TurnDelivery::new(
            fixture.store.clone(),
            Arc::new(tokio::sync::Notify::new()),
            events.clone(),
        ),
        Arc::new(std::sync::RwLock::new(None)),
    );
    let command = tokio::time::timeout(Duration::from_secs(5), async {
        loop {
            if let Some(command) = first.turn_delivery.command(&notice_key(&fixture)).await? {
                return Ok::<_, Box<dyn std::error::Error>>(command);
            }
            tokio::time::sleep(Duration::from_millis(5)).await;
        }
    })
    .await??;
    assert_eq!(command.remote_thread_id, PARENT);
    assert_eq!(
        command.presentation,
        crate::store::OutboxPresentation::Notice
    );
    drop(first);
    let second = OrchestrationService::with_turn_delivery(
        harness.gateway.clone(),
        &fixture.store,
        events.clone(),
        Arc::new(ProfileObservations::default()),
        TurnDelivery::new(
            fixture.store.clone(),
            Arc::new(tokio::sync::Notify::new()),
            events,
        ),
        Arc::new(std::sync::RwLock::new(None)),
    );
    second.signal_tasks();
    tokio::time::sleep(Duration::from_millis(100)).await;
    assert_eq!(fixture.store.outbox_list(Some(PARENT))?.len(), 1);
    assert!(matches!(
        delivery(&fixture).await?,
        Delivery::Enqueued { .. }
    ));
    Ok(())
}

#[tokio::test]
async fn a_wait_before_handoff_suppresses_the_push_and_after_enqueue_retracts_it() -> TestResult {
    let before = settled_task().await?;
    assert_eq!(
        before
            .journal
            .acknowledge(
                vec![before.request_id.clone()],
                AckSource::WaitTask,
                retract_notice_in_write,
            )
            .await?,
        1
    );
    assert_eq!(
        hand_off(&before, |_, _, _| panic!(
            "an acknowledged result must not be injected"
        ))
        .await?,
        HandoffOutcome::Stale
    );
    assert!(before.store.outbox_get(&notice_key(&before))?.is_none());

    let after = settled_task().await?;
    hand_off(&after, |write, command, parent| {
        enqueue_completion_in_write(write, command, parent, "result")
    })
    .await?;
    assert!(after.store.outbox_get(&notice_key(&after))?.is_some());
    after
        .journal
        .acknowledge(
            vec![after.request_id.clone()],
            AckSource::WaitTask,
            retract_notice_in_write,
        )
        .await?;
    assert!(after.store.outbox_get(&notice_key(&after))?.is_none());
    assert_eq!(
        delivery(&after).await?,
        Delivery::Acknowledged {
            by: AckSource::WaitTask
        }
    );
    Ok(())
}

#[tokio::test]
async fn a_queued_notice_blocks_new_handoffs_until_it_is_dispatched() -> TestResult {
    let fixture = settled_task().await?;
    hand_off(&fixture, |write, command, parent| {
        enqueue_completion_in_write(write, command, parent, "result")
    })
    .await?;
    let parent = AppThreadId::from_static(PARENT);
    assert!(
        fixture
            .journal
            .notice_pending(&parent, notice_state_in_write, retract_notice_in_write)
            .await?
    );
    let crate::store::OutboxClaimOutcome::Acquired { .. } =
        fixture.store.outbox_claim_dispatch(&notice_key(&fixture))?
    else {
        return Err("notice claim was not acquired".into());
    };
    assert!(
        !fixture
            .journal
            .notice_pending(&parent, notice_state_in_write, retract_notice_in_write)
            .await?
    );
    let state = {
        let write = fixture.store.database().begin_write()?;
        notice_state_in_write(&write, &notice_key(&fixture))?
    };
    assert_eq!(state, NoticeCommandState::Dispatched);
    Ok(())
}

#[tokio::test]
async fn request_tables_hold_no_prompt_or_final_text() -> TestResult {
    let fixture = settled_task().await?;
    let secret_result = "final-text-owned-by-provider-history-91b2";
    hand_off(&fixture, move |write, command, parent| {
        enqueue_completion_in_write(write, command, parent, secret_result)
    })
    .await?;
    let read = fixture.store.database().begin_read()?;
    for definition in [
        orchestration_tables::WORK_REQUESTS,
        orchestration_tables::NOTICES,
    ] {
        let table = read.open_table(definition)?;
        for entry in table.iter()? {
            let (_, value) = entry?;
            let text = String::from_utf8_lossy(value.value()).into_owned();
            assert!(!text.contains(secret_result));
            assert!(!text.contains("inspect"));
        }
    }
    assert!(
        fixture
            .store
            .outbox_get(&notice_key(&fixture))?
            .is_some_and(|command| command.params.to_string().contains(secret_result))
    );
    Ok(())
}

// ---- work_requests_backfill_v1 ------------------------------------------

struct Legacy {
    task: serde_json::Value,
    attempt: serde_json::Value,
    delivery: serde_json::Value,
    workspace: serde_json::Value,
}

/// One legacy task record set, written exactly as the pre-request code
/// persisted it (camelCase JSON with a flattened delivery route).
fn legacy(
    state: &str,
    attempt: &serde_json::Value,
    route: &str,
    delivery_state: &str,
) -> (TaskId, Legacy) {
    let task_id = TaskId::new();
    let attempt_id = crate::agent::orchestration::task::AttemptId::new();
    let delivery_id = crate::agent::orchestration::task::DeliveryId::new();
    let claim_id = crate::agent::orchestration::task::WorkspaceClaimId::new();
    let task = json!({
        "taskId": task_id, "parentThreadId": PARENT, "rootThreadId": PARENT,
        "provenance": "agentSelected", "waitMode": "deferred", "workspaceMode": "legacyShared",
        "state": state, "authoritativeAttemptId": attempt_id, "deliveryId": delivery_id,
        "provider": "claude", "model": "claude-default", "name": "Legacy",
        "permission": {"parentCeiling": ":workspace", "requestedProfile": null, "translatedProfile": ":workspace"},
        "workspaceClaimId": claim_id, "createdAtMs": 1, "updatedAtMs": 2
    });
    let attempt_record = json!({
        "attemptId": attempt_id, "taskId": task_id,
        "commandId": format!("task-turn-{}", task_id.as_str()),
        "state": attempt
    });
    let delivery = json!({
        "deliveryId": delivery_id, "taskId": task_id, "route": route, "state": delivery_state,
        "dedupeKey": format!("task-completion:{}", task_id.as_str())
    });
    let workspace = json!({
        "claimId": claim_id, "mode": "legacyShared",
        "state": {"state": "shared", "effectiveCwd": "/repo"}
    });
    (
        task_id,
        Legacy {
            task,
            attempt: attempt_record,
            delivery,
            workspace,
        },
    )
}

fn write_legacy(store: &IndexStore, records: &[Legacy]) -> TestResult {
    let write = store.database().begin_write()?;
    for record in records {
        let key = |value: &serde_json::Value, field: &str| {
            value[field].as_str().map(str::to_owned).unwrap_or_default()
        };
        write.open_table(orchestration_tables::TASKS)?.insert(
            key(&record.task, "taskId").as_str(),
            serde_json::to_vec(&record.task)?.as_slice(),
        )?;
        write.open_table(orchestration_tables::ATTEMPTS)?.insert(
            key(&record.attempt, "attemptId").as_str(),
            serde_json::to_vec(&record.attempt)?.as_slice(),
        )?;
        write.open_table(orchestration_tables::DELIVERIES)?.insert(
            key(&record.delivery, "deliveryId").as_str(),
            serde_json::to_vec(&record.delivery)?.as_slice(),
        )?;
        write
            .open_table(orchestration_tables::WORKSPACE_CLAIMS)?
            .insert(
                key(&record.workspace, "claimId").as_str(),
                serde_json::to_vec(&record.workspace)?.as_slice(),
            )?;
    }
    write.commit()?;
    Ok(())
}

async fn migrated(
    journal: &TaskJournal,
    task_id: &TaskId,
) -> Result<ChildWorkRequest, Box<dyn std::error::Error>> {
    Ok(journal.get(task_id).await?.request)
}

/// The legacy tasks of every route and state, by case.
struct LegacyTasks {
    running: TaskId,
    spawned: TaskId,
    cancelling: TaskId,
    awaiting: TaskId,
    enqueued: TaskId,
    acknowledged: TaskId,
    fallback: TaskId,
    never: TaskId,
}

fn seed_legacy_tasks(store: &IndexStore) -> Result<LegacyTasks, Box<dyn std::error::Error>> {
    let started =
        json!({"state": "started", "childThreadId": "legacy-child", "providerTurnId": "turn-1"});
    let terminal =
        json!({"state": "terminal", "childThreadId": "legacy-child", "providerTurnId": "turn-1"});
    let bound = json!({"state": "childBound", "childThreadId": "legacy-child"});
    let admitted = json!({"state": "admitted"});
    let (running, running_records) = legacy("running", &started, "parentTurn", "pending");
    let (spawned, spawned_records) = legacy("starting", &bound, "awaitingResume", "pending");
    let (cancelling, cancelling_records) = legacy("cancelling", &started, "parentTurn", "pending");
    let (awaiting, awaiting_records) =
        legacy("succeeded", &terminal, "parentTurn", "awaitingResume");
    let (enqueued, enqueued_records) = legacy("succeeded", &terminal, "parentTurn", "enqueued");
    let (acknowledged, acknowledged_records) =
        legacy("failed", &terminal, "parentTurn", "acknowledged");
    let (fallback, fallback_records) =
        legacy("cancelled", &terminal, "awaitingResume", "awaitingResume");
    let (never, never_records) = legacy("failed", &admitted, "parentTurn", "awaitingResume");
    write_legacy(
        store,
        &[
            running_records,
            spawned_records,
            cancelling_records,
            awaiting_records,
            enqueued_records,
            acknowledged_records,
            fallback_records,
            never_records,
        ],
    )?;
    // Old persisted delivery encodings keep decoding.
    let raw = {
        let read = store.database().begin_read()?;
        let table = read.open_table(orchestration_tables::DELIVERIES)?;
        let mut decoded = Vec::new();
        for entry in table.iter()? {
            let (_, value) = entry?;
            decoded.push(serde_json::from_slice::<CompletionDelivery>(value.value())?);
        }
        decoded
    };
    assert_eq!(raw.len(), 8);
    assert!(raw.iter().any(|delivery| delivery.progress
        == DeliveryProgress::AwaitingResume {
            state: DeliveryState::AwaitingResume
        }));
    assert!(raw.iter().any(|delivery| delivery.progress
        == DeliveryProgress::ParentTurn {
            state: ParentDeliveryState::Enqueued
        }));

    Ok(LegacyTasks {
        running,
        spawned,
        cancelling,
        awaiting,
        enqueued,
        acknowledged,
        fallback,
        never,
    })
}

/// An open legacy follow-up command of a linked child, and a delivered one.
async fn seed_legacy_followups(store: &Arc<IndexStore>) -> TestResult {
    ChildLinks::new(store.clone())
        .link(&ChildLink::new(
            PARENT.into(),
            "legacy-child".into(),
            ProviderId::from_static("claude"),
            "claude-default".into(),
            None,
            "/repo".into(),
        ))
        .await?;
    let followup = |id: &str| {
        json!({"threadId": "legacy-child", "clientUserMessageId": id,
            "input": [{"type": "text", "text": "follow up", "text_elements": []}]})
    };
    store.outbox_put_turn_start_with_presentation(
        "agent-send-open",
        "legacy-child",
        followup("agent-send-open"),
        None,
        crate::store::OutboxPresentation::Delivery,
    )?;
    store.outbox_put_turn_start_with_presentation(
        "agent-send-done",
        "legacy-child",
        followup("agent-send-done"),
        None,
        crate::store::OutboxPresentation::Delivery,
    )?;
    let crate::store::OutboxClaimOutcome::Acquired { token, .. } =
        store.outbox_claim_dispatch("agent-send-done")?
    else {
        return Err("claim".into());
    };
    store.outbox_resolve_claim(
        "agent-send-done",
        token,
        crate::store::OutboxClaimResolution::Delivered {
            turn_id: Some("old-turn"),
        },
    )?;

    Ok(())
}

async fn assert_open_tasks(journal: &TaskJournal, tasks: &LegacyTasks) -> TestResult {
    let LegacyTasks {
        running,
        spawned,
        cancelling,
        ..
    } = tasks;
    // A non-terminal task with a known turn is running and will be pushed.
    let request = migrated(journal, running).await?;
    assert_eq!(
        request.phase,
        RequestPhase::Running {
            turn_id: TurnId::from_static("turn-1")
        }
    );
    assert_eq!(
        request.dedupe_key,
        format!("task-completion:{}", running.as_str())
    );
    assert_eq!(
        request.request_id.as_str(),
        journal.get(running).await?.task.delivery_id.as_str()
    );
    // A legacy spawn without a turn is queued on its bound child.
    let request = migrated(journal, spawned).await?;
    assert_eq!(request.phase, RequestPhase::Queued);
    assert_eq!(
        request.child_thread_id,
        Some(AppThreadId::from_static("legacy-child"))
    );
    assert_eq!(
        migrated(journal, cancelling).await?.phase,
        RequestPhase::CancelRequested {
            turn_id: Some(TurnId::from_static("turn-1"))
        }
    );
    Ok(())
}

async fn assert_terminal_tasks(journal: &TaskJournal, tasks: &LegacyTasks) -> TestResult {
    let LegacyTasks {
        awaiting,
        enqueued,
        acknowledged,
        fallback,
        never,
        ..
    } = tasks;
    // Terminal parent-turn deliveries keep their state.
    assert!(matches!(
        migrated(journal, awaiting).await?.phase,
        RequestPhase::Settled {
            settlement: Settlement::Ran {
                outcome: RunOutcome::Completed,
                ..
            },
            delivery: Delivery::AwaitingHandoff { .. },
            ..
        }
    ));
    let enqueued_request = migrated(journal, enqueued).await?;
    assert_eq!(
        enqueued_request.phase,
        RequestPhase::Settled {
            settlement: Settlement::Ran {
                turn_id: TurnId::from_static("turn-1"),
                outcome: RunOutcome::Completed
            },
            delivery: Delivery::Enqueued {
                parent_command_id: format!("task-completion:{}", enqueued.as_str())
            },
            settled_at_ms: 2,
        }
    );
    assert!(matches!(
        migrated(journal, acknowledged).await?.phase,
        RequestPhase::Settled {
            delivery: Delivery::Acknowledged {
                by: AckSource::Migration
            },
            ..
        }
    ));
    // A terminal fallback was the model's to collect: acknowledged.
    assert!(matches!(
        migrated(journal, fallback).await?.phase,
        RequestPhase::Settled {
            settlement: Settlement::Ran {
                outcome: RunOutcome::Cancelled,
                ..
            },
            delivery: Delivery::Acknowledged {
                by: AckSource::Migration
            },
            ..
        }
    ));
    assert!(matches!(
        migrated(journal, never).await?.phase,
        RequestPhase::Settled {
            settlement: Settlement::NeverStarted {
                reason: NeverStartedReason::DispatchFailed
            },
            delivery: Delivery::AwaitingHandoff { .. },
            ..
        }
    ));
    Ok(())
}

#[tokio::test]
async fn backfill_migrates_every_legacy_route_and_state_once() -> TestResult {
    let directory = tempfile::tempdir()?;
    let store = Arc::new(IndexStore::open(directory.path().join("state.redb"))?);
    let tasks = seed_legacy_tasks(&store)?;
    seed_legacy_followups(&store).await?;
    let report = TaskJournal::backfill_v1(&store, open_commands_in_write)?;
    assert_eq!(
        (report.tasks, report.followups, report.skipped),
        (8, 1, false)
    );
    let journal = TaskJournal::new(store.clone());

    assert_open_tasks(&journal, &tasks).await?;
    assert_terminal_tasks(&journal, &tasks).await?;
    // The open follow-up became a queued request with the linked parent.
    let open = journal.open_by_child().await?;
    let followups = open
        .get(&AppThreadId::from_static("legacy-child"))
        .map(|requests| {
            requests
                .iter()
                .filter(|request| request.origin == RequestOrigin::Followup)
                .cloned()
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    assert_eq!(followups.len(), 1);
    assert_eq!(followups[0].command_id, "agent-send-open");
    assert_eq!(
        followups[0].parent_thread_id,
        AppThreadId::from_static(PARENT)
    );

    // The marker makes a second run a no-op.
    assert!(TaskJournal::backfill_v1(&store, open_commands_in_write)?.skipped);
    // Without the marker a rerun still creates nothing twice.
    {
        let write = store.database().begin_write()?;
        write
            .open_table(orchestration_tables::META)?
            .remove("work_requests_backfill_v1")?;
        write.commit()?;
    }
    let rerun = TaskJournal::backfill_v1(&store, open_commands_in_write)?;
    assert_eq!((rerun.tasks, rerun.followups), (0, 0));
    Ok(())
}
