//! Forks (`host/test/threads.test.ts`, "forks"): a fork copies the
//! source's sessions through a boundary into sessions the copy owns; the
//! source is unchanged and repeats return the same copy.

use agent_core::model::{
    AgentItem, ForkBoundary, ThreadChange, ThreadForkParams, TurnId, UserContent,
};

use super::{
    Harness, Options, TERMINAL, TestResult, harness, id, stored_answer, stored_prompt,
    threads::{rejected_code, session_file_exists, turns_params, update},
    write_session,
};

const FORK: &str = "6b8f0c2a-1d3e-4f5a-8b9c-0d1e2f3a4b5c";

fn store_with_two_turns(harness: &Harness) -> TestResult {
    write_session(
        &harness.projects(),
        "/repo",
        TERMINAL,
        &[
            stored_prompt(TERMINAL, "/repo", "p-1", "Fix the flaky test"),
            stored_answer(TERMINAL, "a-1", "Fixed.", "claude-sonnet-4-6"),
            stored_prompt(TERMINAL, "/repo", "p-2", "Now add a regression test"),
            stored_answer(TERMINAL, "a-2", "Added.", "claude-sonnet-4-6"),
        ],
        1_760_000_200_000,
    )?;
    Ok(())
}

async fn prompts(
    harness: &Harness,
    app_thread_id: &str,
) -> Result<Vec<String>, Box<dyn std::error::Error>> {
    let (page, _) = harness
        .service
        .turns(turns_params(app_thread_id)?, false)
        .await?;
    Ok(page
        .turns
        .iter()
        .flat_map(|turn| turn.items.iter())
        .filter_map(|item| match item {
            AgentItem::UserMessage { content, .. } => Some(content),
            _ => None,
        })
        .flatten()
        .filter_map(|content| match content {
            UserContent::Text { text } => Some(text.clone()),
            _ => None,
        })
        .collect())
}

fn fork_params(
    fork: Option<&str>,
    boundary: ForkBoundary,
) -> Result<ThreadForkParams, Box<dyn std::error::Error>> {
    Ok(ThreadForkParams {
        app_thread_id: id(TERMINAL)?,
        boundary,
        fork_app_thread_id: fork.map(id).transpose()?,
    })
}

fn turn(value: &str) -> Result<TurnId, Box<dyn std::error::Error>> {
    TurnId::parse(value).ok_or_else(|| "invalid turn id".into())
}

/// Session files in the store other than the source's.
fn forked_sessions(harness: &Harness) -> usize {
    crate::native::files::sessions(&harness.projects())
        .iter()
        .filter(|file| file.session_id != TERMINAL)
        .count()
}

#[tokio::test]
async fn copies_the_history_through_a_turn_into_a_thread_with_its_own_session() -> TestResult {
    let harness = harness(Options::default())?;
    store_with_two_turns(&harness)?;
    let forked = harness
        .service
        .fork(fork_params(
            Some(FORK),
            ForkBoundary::Through {
                turn_id: turn("p-1")?,
            },
        )?)
        .await?;
    assert_eq!(forked.app_thread_id.as_str(), FORK);
    assert_eq!(forked.cwd, "/repo");
    assert_eq!(prompts(&harness, FORK).await?, ["Fix the flaky test"]);
    assert_eq!(
        prompts(&harness, TERMINAL).await?,
        ["Fix the flaky test", "Now add a regression test"]
    );
    assert_eq!(forked_sessions(&harness), 1);
    harness.close().await;
    Ok(())
}

#[tokio::test]
async fn keeps_everything_or_the_turns_before_a_turn() -> TestResult {
    let harness = harness(Options::default())?;
    store_with_two_turns(&harness)?;
    harness
        .service
        .fork(fork_params(Some(FORK), ForkBoundary::All)?)
        .await?;
    assert_eq!(
        prompts(&harness, FORK).await?,
        ["Fix the flaky test", "Now add a regression test"]
    );
    let before = "7c9a1d3b-2e4f-4a6b-9c0d-1e2f3a4b5c6d";
    harness
        .service
        .fork(fork_params(
            Some(before),
            ForkBoundary::Before {
                turn_id: turn("p-2")?,
            },
        )?)
        .await?;
    assert_eq!(prompts(&harness, before).await?, ["Fix the flaky test"]);
    harness.close().await;
    Ok(())
}

#[tokio::test]
async fn refuses_an_empty_fork_and_an_unknown_turn_and_repeats_return_the_same_copy() -> TestResult
{
    let harness = harness(Options::default())?;
    store_with_two_turns(&harness)?;
    let empty = harness
        .service
        .fork(fork_params(
            Some(FORK),
            ForkBoundary::Before {
                turn_id: turn("p-1")?,
            },
        )?)
        .await;
    assert_eq!(rejected_code(empty), Some(-32_602));
    let unknown = harness
        .service
        .fork(fork_params(
            Some(FORK),
            ForkBoundary::Through {
                turn_id: turn("gone")?,
            },
        )?)
        .await;
    assert_eq!(rejected_code(unknown), Some(-32_600));
    let unminted = harness
        .service
        .fork(fork_params(None, ForkBoundary::All)?)
        .await;
    assert_eq!(rejected_code(unminted), Some(-32_602));
    assert_eq!(forked_sessions(&harness), 0);
    let first = harness
        .service
        .fork(fork_params(Some(FORK), ForkBoundary::All)?)
        .await?;
    let again = harness
        .service
        .fork(fork_params(Some(FORK), ForkBoundary::All)?)
        .await?;
    assert_eq!(again, first);
    assert_eq!(forked_sessions(&harness), 1);
    harness.close().await;
    Ok(())
}

#[tokio::test]
async fn deleting_the_copy_leaves_the_sources_sessions() -> TestResult {
    let harness = harness(Options::default())?;
    store_with_two_turns(&harness)?;
    harness
        .service
        .fork(fork_params(Some(FORK), ForkBoundary::All)?)
        .await?;
    assert_eq!(update(&harness, FORK, ThreadChange::Deleted).await?, None);
    assert!(session_file_exists(&harness, TERMINAL));
    assert_eq!(prompts(&harness, TERMINAL).await?.len(), 2);
    harness.close().await;
    Ok(())
}
