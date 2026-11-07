//! A background command's state reaches the client live: the provider
//! republishes the launching `command` item of a finished turn, and the
//! client receives the same item of that turn with the new state.

use codewide_companion::agent::model::{
    AgentItem, BackgroundCommand, BackgroundCommandState, ExecutionStatus,
};

use super::*;

fn launch(state: BackgroundCommandState) -> AgentItem {
    AgentItem::Command {
        item_id: ItemId::from_static("toolu_bg"),
        provenance: None,
        command: "npm test".into(),
        cwd: "/work".into(),
        status: ExecutionStatus::Completed,
        output: Some("Command running in background with ID: bd3cb8oli.".into()),
        exit_code: Some(0),
        duration_ms: Some(4),
        background: Some(BackgroundCommand {
            task_id: "bd3cb8oli".into(),
            started_at: 1_760_000_100,
            description: None,
            state,
        }),
    }
}

fn turn(status: TurnStatus, items: Vec<AgentItem>) -> AgentTurn {
    AgentTurn {
        turn_id: TurnId::from_static("turn-bg"),
        status,
        origin: TurnOrigin::User,
        started_at: 1,
        completed_at: (status != TurnStatus::InProgress).then_some(2),
        error: None,
        items,
        provenance: None,
        usage: None,
    }
}

#[tokio::test]
async fn a_background_command_state_change_reaches_the_client_after_its_turn() -> TestResult {
    let mut harness = Harness::start(default_answer, |_| Vec::new()).await?;
    let thread_id = harness.new_fake_thread().await?;
    let app_thread_id = AppThreadId::parse(&thread_id).ok_or("id")?;
    send_json(
        &mut harness.client,
        &json!({"type": "interest", "add": [thread_id.as_str()]}),
    )
    .await?;
    let item_completed = |app_thread_id: &AppThreadId, state| {
        ProviderEvent::Event(Box::new(AgentEvent::ItemCompleted {
            app_thread_id: app_thread_id.clone(),
            turn_id: TurnId::from_static("turn-bg"),
            item: launch(state),
        }))
    };
    harness
        .events
        .send(ProviderEvent::Event(Box::new(AgentEvent::TurnStarted {
            app_thread_id: app_thread_id.clone(),
            turn: turn(TurnStatus::InProgress, Vec::new()),
        })))
        .await?;
    harness
        .events
        .send(item_completed(
            &app_thread_id,
            BackgroundCommandState::Running,
        ))
        .await?;
    let running = harness
        .event_where(|payload| payload["method"] == "item/completed")
        .await?;
    assert_eq!(
        running["params"]["item"]["codewideBackgroundTask"],
        json!({"taskId": "bd3cb8oli", "startedAt": 1_760_000_100, "description": null, "status": "running"})
    );
    harness
        .events
        .send(ProviderEvent::Event(Box::new(AgentEvent::TurnCompleted {
            app_thread_id: app_thread_id.clone(),
            turn: turn(
                TurnStatus::Completed,
                vec![launch(BackgroundCommandState::Running)],
            ),
        })))
        .await?;
    harness
        .event_where(|payload| payload["method"] == "turn/completed")
        .await?;

    // The task ends after its turn: the same item of the same turn again.
    harness
        .events
        .send(item_completed(
            &app_thread_id,
            BackgroundCommandState::Failed {
                ended_at: 1_760_000_200,
                exit_code: None,
            },
        ))
        .await?;
    let ended = harness
        .event_where(|payload| payload["method"] == "item/completed")
        .await?;
    assert_eq!(ended["params"]["threadId"], thread_id.as_str());
    assert_eq!(ended["params"]["turnId"], "turn-bg");
    assert_eq!(ended["params"]["item"]["id"], "toolu_bg");
    assert_eq!(
        ended["params"]["item"]["codewideBackgroundTask"],
        json!({"taskId": "bd3cb8oli", "startedAt": 1_760_000_100, "description": null, "status": "failed", "endedAt": 1_760_000_200, "exitCode": null})
    );
    // Clients apply it through the companion's semantic patch.
    let operation = &ended["codewideThreadPatch"]["operation"];
    assert_eq!(operation["kind"], "itemUpsert");
    assert_eq!(operation["itemPhase"], "completed");
    harness.stop();
    Ok(())
}
