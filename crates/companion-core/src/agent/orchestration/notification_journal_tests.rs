//! The completion handoff commits with the outbox and survives service restart.

use super::*;
use crate::{
    agent::orchestration::{
        journal::TaskJournal,
        task::{DeliveryProgress, ParentDeliveryState, TaskId, WorkspaceClaimState, WorkspaceMode},
    },
    store::StoreError,
    turn_delivery::{TurnDelivery, enqueue_completion_in_write},
};

struct PendingCompletion {
    _directory: tempfile::TempDir,
    store: Arc<IndexStore>,
    journal: TaskJournal,
    task_id: TaskId,
    command_id: String,
}

async fn pending_completion() -> Result<PendingCompletion, Box<dyn std::error::Error>> {
    let directory = tempfile::tempdir()?;
    let store = Arc::new(IndexStore::open(directory.path().join("state.redb"))?);
    let journal = TaskJournal::new(store.clone());
    let task_id = TaskId::new();
    let (mut record, _) = rework_tests::admission(
        &task_id,
        &AppThreadId::from_static("planned-child"),
        "pending-completion",
    );
    record.delivery.progress = DeliveryProgress::ParentTurn {
        state: ParentDeliveryState::Pending,
    };
    record.task.workspace_mode = WorkspaceMode::IsolatedWrite;
    record.workspace.mode = WorkspaceMode::IsolatedWrite;
    record.workspace.state = WorkspaceClaimState::Pending {
        source_workspace: "/repo".into(),
    };
    let command_id = record.delivery.dedupe_key.clone();
    journal.admit(record).await?;
    journal.preparing_workspace(&task_id).await?;
    journal.fail_workspace(&task_id).await?;
    Ok(PendingCompletion {
        _directory: directory,
        store,
        journal,
        task_id,
        command_id,
    })
}

#[tokio::test]
async fn notification_handoff_rolls_back_and_commits_as_one_transaction() -> TestResult {
    let fixture = pending_completion().await?;
    let failed = fixture
        .journal
        .enqueue_completion(&fixture.task_id, |write, command, parent| {
            enqueue_completion_in_write(write, command, parent, "result")?;
            Err(StoreError::CorruptedIndex(
                "injected transaction failure".into(),
            ))
        })
        .await;
    assert!(failed.is_err());
    assert_eq!(
        fixture
            .journal
            .get(&fixture.task_id)
            .await?
            .delivery
            .progress,
        DeliveryProgress::ParentTurn {
            state: ParentDeliveryState::AwaitingResume
        }
    );
    assert!(fixture.store.outbox_get(&fixture.command_id)?.is_none());
    assert!(
        fixture
            .journal
            .enqueue_completion(&fixture.task_id, |write, command, parent| {
                enqueue_completion_in_write(write, command, parent, "result")
            })
            .await?
    );
    let reopened = TaskJournal::new(fixture.store.clone());
    assert_eq!(
        reopened.get(&fixture.task_id).await?.delivery.progress,
        DeliveryProgress::ParentTurn {
            state: ParentDeliveryState::Enqueued
        }
    );
    assert!(fixture.store.outbox_get(&fixture.command_id)?.is_some());
    assert!(
        !reopened
            .enqueue_completion(&fixture.task_id, |_, _, _| {
                panic!("replayed handoff must not enqueue again")
            })
            .await?
    );
    assert_eq!(fixture.store.outbox_list(Some(PARENT))?.len(), 1);
    Ok(())
}

#[tokio::test]
async fn startup_recovers_terminal_results_without_an_event_or_wait_task() -> TestResult {
    let fixture = pending_completion().await?;
    let harness = harness_without_pump(":workspace").await?;
    let (events, _event_stream) = tokio::sync::mpsc::channel(32);
    let service = OrchestrationService::with_turn_delivery(
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
    let command = tokio::time::timeout(Duration::from_secs(5), async {
        loop {
            if let Some(command) = service.turn_delivery.command(&fixture.command_id).await? {
                return Ok::<_, Box<dyn std::error::Error>>(command);
            }
            tokio::task::yield_now().await;
        }
    })
    .await??;
    assert_eq!(command.remote_thread_id, PARENT);
    assert!(
        command
            .params
            .to_string()
            .contains("Isolated workspace preparation failed")
    );
    assert_eq!(
        fixture
            .journal
            .get(&fixture.task_id)
            .await?
            .delivery
            .progress,
        DeliveryProgress::ParentTurn {
            state: ParentDeliveryState::Enqueued
        }
    );
    Ok(())
}

#[tokio::test]
async fn a_wait_acknowledgement_before_handoff_suppresses_the_injection() -> TestResult {
    let fixture = pending_completion().await?;
    fixture
        .journal
        .acknowledge_delivery(&fixture.task_id)
        .await?;
    assert!(
        !fixture
            .journal
            .enqueue_completion(&fixture.task_id, |_, _, _| {
                panic!("an acknowledged result must not be injected")
            })
            .await?
    );
    assert!(fixture.store.outbox_get(&fixture.command_id)?.is_none());
    Ok(())
}
