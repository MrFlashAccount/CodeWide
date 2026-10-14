//! Service-level session contracts (`host/test/session.test.ts`) the session
//! actor's own tests do not cover: the service's parameter checks, busy
//! starts through the service, process loss of one thread, a session held
//! by a background agent, and restart finalization.

use std::sync::Arc;

use agent_core::{
    model::{
        AgentItem, ExecutionStatus, ThreadChange, ThreadCreateParams, ThreadUpdateParams,
        TurnErrorKind, TurnStartParams, TurnStartResult, TurnStatus,
    },
    provider::ProviderError,
};
use serde_json::json;

use super::{
    OTHER_THREAD, Options, THREAD, TestResult, create_thread, frames, harness, id, settings,
    settle, start, text,
    threads::{rejected_code, update},
};
use crate::cli::command::SessionIdentity;

#[tokio::test]
async fn rejects_an_unknown_permission_profile() -> TestResult {
    let harness = harness(Options::default())?;
    create_thread(&harness.service, THREAD).await?;
    let changed = harness
        .service
        .update(ThreadUpdateParams {
            app_thread_id: id(THREAD)?,
            change: ThreadChange::Settings {
                model: None,
                effort: None,
                permission_profile: Some(":plan".into()),
                service_tier: None,
            },
        })
        .await;
    match changed {
        Err(ProviderError::Rejected(error)) => {
            assert_eq!(error.code, -32_602);
            assert_eq!(
                error.message,
                "Unsupported permission profile for Claude: :plan"
            );
        }
        other => return Err(format!("expected a rejection, got {other:?}").into()),
    }
    let created = harness
        .service
        .create(ThreadCreateParams {
            app_thread_id: Some(id(OTHER_THREAD)?),
            cwd: "/workspace".into(),
            settings: settings(":plan"),
            client_tools: None,
        })
        .await;
    assert!(matches!(created, Err(ProviderError::Rejected(error)) if error.code == -32_602));
    let unminted = harness
        .service
        .create(ThreadCreateParams {
            app_thread_id: Some(id("not-a-uuid")?),
            cwd: "/workspace".into(),
            settings: settings(":workspace"),
            client_tools: None,
        })
        .await;
    match unminted {
        Err(ProviderError::Rejected(error)) => assert_eq!(
            error.message,
            "Claude threads need a host-minted UUID appThreadId"
        ),
        other => return Err(format!("expected a rejection, got {other:?}").into()),
    }
    harness.close().await;
    Ok(())
}

#[tokio::test]
async fn answers_busy_with_the_active_turn_instead_of_steering() -> TestResult {
    let harness = harness(Options::default())?;
    create_thread(&harness.service, THREAD).await?;
    let turn_id = start(&harness.service, THREAD, "first").await?;
    let second = harness
        .service
        .turn_start(TurnStartParams {
            app_thread_id: id(THREAD)?,
            client_message_id: None,
            input: text("second"),
            client_tools: None,
        })
        .await?;
    assert_eq!(
        second,
        TurnStartResult::Busy {
            active_turn_id: turn_id
        }
    );
    assert_eq!(harness.runtime.query(0)?.offer_count(), 1);
    let compact = harness.service.compact(&id(THREAD)?).await;
    assert!(
        matches!(compact, Err(ProviderError::Rejected(error)) if error.message == "thread has an active turn")
    );
    harness.close().await;
    Ok(())
}

#[tokio::test]
async fn opens_with_the_session_id_first_and_resumes_afterwards() -> TestResult {
    let harness = harness(Options::default())?;
    create_thread(&harness.service, THREAD).await?;
    start(&harness.service, THREAD, "first").await?;
    let query = harness.runtime.query(0)?;
    query.push(frames::init()).await;
    query.push(frames::result()).await;
    settle().await;
    query.end().await;
    settle().await;
    start(&harness.service, THREAD, "second").await?;
    let identities = harness
        .runtime
        .queries()
        .iter()
        .map(|query| query.options.identity.clone())
        .collect::<Vec<_>>();
    assert_eq!(
        identities,
        [
            SessionIdentity::New(THREAD.into()),
            SessionIdentity::Resume(THREAD.into())
        ]
    );
    harness.close().await;
    Ok(())
}

#[tokio::test]
async fn fails_only_the_turn_of_the_thread_whose_process_died() -> TestResult {
    let harness = harness(Options::default())?;
    create_thread(&harness.service, THREAD).await?;
    create_thread(&harness.service, OTHER_THREAD).await?;
    start(&harness.service, THREAD, "a").await?;
    let other = start(&harness.service, OTHER_THREAD, "b").await?;
    harness.runtime.query(0)?.fail("killed").await;
    settle().await;
    let failed = harness.completions();
    assert_eq!(failed.len(), 1);
    let error = failed[0].error.as_ref().ok_or("no error")?;
    assert_eq!(error.kind, TurnErrorKind::ProcessExited);
    let (read, _) = harness.service.read(&id(OTHER_THREAD)?, false).await?;
    assert_eq!(read.active_turn_id, Some(other));
    start(&harness.service, THREAD, "again").await?;
    assert_eq!(
        harness.runtime.query(2)?.options.identity,
        SessionIdentity::New(THREAD.into())
    );
    harness.close().await;
    Ok(())
}

#[tokio::test]
async fn names_a_session_held_by_a_background_claude_process() -> TestResult {
    let harness = harness(Options::default())?;
    create_thread(&harness.service, THREAD).await?;
    start(&harness.service, THREAD, "a").await?;
    harness
        .runtime
        .query(0)?
        .fail(
            "Error: That session is running in the background (48d313bf). Run `claude attach \
             48d313bf` to open it, or `claude stop 48d313bf` first to resume it here.",
        )
        .await;
    settle().await;
    let completed = harness.completions();
    let error = completed
        .first()
        .and_then(|turn| turn.error.as_ref())
        .ok_or("no failed turn")?;
    assert_eq!(error.kind, TurnErrorKind::ProcessExited);
    assert_eq!(
        error.message,
        "This conversation is open in another app: a Claude background agent is running this \
         session. Wait for it to finish or run `claude stop 48d313bf` on the host, then try again."
    );
    harness.close().await;
    Ok(())
}

#[tokio::test]
async fn finalizes_a_turn_left_in_progress_as_interrupted() -> TestResult {
    let first = harness(Options::default())?;
    create_thread(&first.service, THREAD).await?;
    start(&first.service, THREAD, "unfinished").await?;
    first
        .runtime
        .query(0)?
        .push(frames::tool_use(
            "m1",
            "toolu_1",
            "Bash",
            &json!({"command": "make"}),
        ))
        .await;
    settle().await;
    // The previous process stops without ending its turn: `first` stays
    // untouched (not shut down) while the next process starts.
    let root = Arc::clone(&first.root);
    let second = harness(Options {
        root: Some(root),
        ..Options::default()
    })?;
    let recovered = second.service.load().await?;
    assert_eq!(recovered.len(), 1);
    let agent_core::model::AgentEvent::TurnCompleted { turn, .. } = &recovered[0] else {
        return Err("expected turn.completed".into());
    };
    assert_eq!(turn.status, TurnStatus::Interrupted);
    let kinds = turn
        .items
        .iter()
        .map(|item| match item {
            AgentItem::UserMessage { .. } => "userMessage",
            AgentItem::Command { .. } => "command",
            _ => "other",
        })
        .collect::<Vec<_>>();
    assert_eq!(kinds, ["userMessage", "command"]);
    assert!(matches!(
        turn.items[1],
        AgentItem::Command {
            status: ExecutionStatus::Failed,
            ..
        }
    ));
    assert!(second.service.load().await?.is_empty());
    let third = harness(Options {
        root: Some(Arc::clone(&second.root)),
        ..Options::default()
    })?;
    assert!(third.service.load().await?.is_empty());
    second.close().await;
    third.close().await;
    Ok(())
}

#[tokio::test]
async fn create_repeats_return_the_existing_thread_and_refuse_a_tombstone() -> TestResult {
    let harness = harness(Options::default())?;
    create_thread(&harness.service, THREAD).await?;
    create_thread(&harness.service, THREAD).await?;
    settle().await;
    assert_eq!(harness.statuses(THREAD).len(), 1, "one thread.updated");
    update(&harness, THREAD, ThreadChange::Deleted).await?;
    assert_eq!(
        rejected_code(
            create_thread(&harness.service, THREAD)
                .await
                .map_err(|err| {
                    err.downcast::<ProviderError>()
                        .map_or_else(|_| ProviderError::Protocol("other".into()), |err| *err)
                })
        ),
        Some(-32_600)
    );
    create_thread(&harness.service, OTHER_THREAD).await?;
    harness.close().await;
    Ok(())
}
