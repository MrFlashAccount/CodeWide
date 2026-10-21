//! Thread operations over Claude's session store (`host/test/threads.test.ts`):
//! sessions started outside `CodeWide` are listed, read and continued;
//! rename and delete go through Claude's store with idempotent repeats; the
//! service keeps only its own metadata.

use std::sync::Arc;

use agent_core::{
    model::{
        AgentItem, AgentThread, ItemsView, SortDirection, ThreadChange, ThreadCreateParams,
        ThreadListParams, ThreadOrigin, ThreadSettings, ThreadStatus, ThreadTurnsParams,
        ThreadUpdateParams, TurnStartParams, TurnStatus,
    },
    provider::ProviderError,
};
use serde_json::json;

use super::{
    Harness, Options, PROGRAMMATIC, TERMINAL, THREAD, TestResult, create_thread, frames, harness,
    id, ids, list_params, listed, settle, start, stored_answer, stored_prompt, text, write_session,
};
use crate::cli::command::{PermissionProfile, SessionIdentity};

const UNKNOWN: &str = "0199a3c4-7a8e-7b2c-9d1e-000000000000";
const CREATED_MS: &str = "2025-10-09T08:55:00.000Z";

/// The terminal session (interactive) and an SDK-started one.
fn store_with_terminal_session(harness: &Harness) -> TestResult {
    let mut prompt = stored_prompt(TERMINAL, "/repo", "p-1", "Fix the flaky test");
    prompt["timestamp"] = json!(CREATED_MS);
    write_session(
        &harness.projects(),
        "/repo",
        TERMINAL,
        &[
            prompt,
            stored_answer(TERMINAL, "a-1", "Fixed.", "claude-sonnet-4-6"),
            json!({"type": "custom-title", "customTitle": "Flaky test fix", "sessionId": TERMINAL}),
        ],
        1_760_000_200_000,
    )?;
    let mut automation = stored_prompt(PROGRAMMATIC, "/repo", "p-2", "automation");
    automation["entrypoint"] = json!("sdk-ts");
    write_session(
        &harness.projects(),
        "/repo",
        PROGRAMMATIC,
        &[automation],
        1_760_000_200_000,
    )?;
    Ok(())
}

fn find<'a>(threads: &'a [AgentThread], app_thread_id: &str) -> Result<&'a AgentThread, String> {
    threads
        .iter()
        .find(|thread| thread.app_thread_id.as_str() == app_thread_id)
        .ok_or_else(|| format!("{app_thread_id} is not listed"))
}

pub(super) fn turns_params(
    app_thread_id: &str,
) -> Result<ThreadTurnsParams, Box<dyn std::error::Error>> {
    Ok(ThreadTurnsParams {
        app_thread_id: id(app_thread_id)?,
        cursor: None,
        limit: 50,
        sort_direction: SortDirection::Asc,
        items_view: ItemsView::Full,
    })
}

pub(super) async fn update(
    harness: &Harness,
    app_thread_id: &str,
    change: ThreadChange,
) -> Result<Option<AgentThread>, ProviderError> {
    let app_thread_id = agent_core::model::AppThreadId::parse(app_thread_id)
        .ok_or_else(|| ProviderError::Protocol("invalid id".into()))?;
    Ok(harness
        .service
        .update(ThreadUpdateParams {
            app_thread_id,
            change,
        })
        .await?
        .thread)
}

fn rename(name: Option<&str>) -> ThreadChange {
    ThreadChange::Name {
        name: name.map(ToOwned::to_owned),
    }
}

pub(super) fn rejected_code(result: Result<impl std::fmt::Debug, ProviderError>) -> Option<i64> {
    match result {
        Err(ProviderError::Rejected(error)) => Some(error.code),
        _ => None,
    }
}

pub(super) fn session_file_exists(harness: &Harness, session_id: &str) -> bool {
    crate::native::files::find_session(&harness.projects(), session_id).is_some()
}

fn custom_titles(harness: &Harness, session_id: &str) -> Vec<String> {
    let Some(file) = crate::native::files::find_session(&harness.projects(), session_id) else {
        return Vec::new();
    };
    std::fs::read_to_string(file.path)
        .unwrap_or_default()
        .lines()
        .filter_map(|line| serde_json::from_str::<serde_json::Value>(line).ok())
        .filter(|row| row["type"] == "custom-title")
        .filter_map(|row| row["customTitle"].as_str().map(ToOwned::to_owned))
        .collect()
}

#[tokio::test]
async fn lists_interactive_sessions_next_to_codewide_threads_and_hides_other_sdk_sessions()
-> TestResult {
    let harness = harness(Options::default())?;
    store_with_terminal_session(&harness)?;
    create_thread(&harness.service, THREAD).await?;
    assert_eq!(
        ids(&listed(&harness.service, list_params()).await?),
        [TERMINAL]
    );
    start(&harness.service, THREAD, "hello").await?;
    harness.runtime.query(0)?.push(frames::init()).await;
    settle().await;
    let threads = listed(&harness.service, list_params()).await?;
    let mut found = ids(&threads);
    found.sort_unstable();
    let mut expected = [THREAD, TERMINAL];
    expected.sort_unstable();
    assert_eq!(found, expected);
    let terminal = find(&threads, TERMINAL)?;
    assert!(!terminal.archived);
    assert_eq!(terminal.created_at, 1_760_000_100);
    assert_eq!(terminal.cwd, "/repo");
    assert_eq!(terminal.name.as_deref(), Some("Flaky test fix"));
    assert_eq!(terminal.origin, ThreadOrigin::External);
    assert_eq!(terminal.preview, "Fix the flaky test");
    assert_eq!(terminal.settings.model, "default");
    assert_eq!(terminal.settings.permission_profile, ":read-only");
    assert_eq!(terminal.status, ThreadStatus::NotLoaded);
    assert_eq!(terminal.updated_at, 1_760_000_200);
    let created = find(&threads, THREAD)?;
    assert_eq!(created.origin, ThreadOrigin::Interactive);
    assert_eq!(created.preview, "hello");
    let search = ThreadListParams {
        search_term: Some("flaky".into()),
        ..list_params()
    };
    assert_eq!(ids(&listed(&harness.service, search).await?), [TERMINAL]);
    let in_workspace = ThreadListParams {
        cwd: Some("/workspace".into()),
        ..list_params()
    };
    assert_eq!(
        ids(&listed(&harness.service, in_workspace).await?),
        [THREAD]
    );
    harness.close().await;
    Ok(())
}

#[tokio::test]
async fn reads_owns_and_returns_the_history_of_a_session_by_its_id() -> TestResult {
    let harness = harness(Options::default())?;
    store_with_terminal_session(&harness)?;
    assert!(harness.service.owns(&id(TERMINAL)?).await?);
    assert!(!harness.service.owns(&id(UNKNOWN)?).await?);
    let (read, fence) = harness.service.read(&id(TERMINAL)?, false).await?;
    assert!(fence.is_none());
    assert_eq!(read.active_turn_id, None);
    assert_eq!(read.thread.app_thread_id.as_str(), TERMINAL);
    let (turns, _) = harness
        .service
        .turns(turns_params(TERMINAL)?, false)
        .await?;
    let shape = turns
        .turns
        .iter()
        .map(|turn| {
            (
                turn.turn_id.as_str().to_owned(),
                turn.status,
                turn.items
                    .iter()
                    .map(|item| match item {
                        AgentItem::UserMessage { .. } => "userMessage",
                        AgentItem::AgentMessage { .. } => "agentMessage",
                        _ => "other",
                    })
                    .collect::<Vec<_>>(),
            )
        })
        .collect::<Vec<_>>();
    assert_eq!(
        shape,
        [(
            "p-1".to_owned(),
            TurnStatus::Completed,
            vec!["userMessage", "agentMessage"]
        )]
    );
    harness.close().await;
    Ok(())
}

#[tokio::test]
async fn fenced_reads_answer_with_a_stream_position() -> TestResult {
    let harness = harness(Options::default())?;
    store_with_terminal_session(&harness)?;
    create_thread(&harness.service, THREAD).await?;
    let (_, fence) = harness.service.read(&id(THREAD)?, true).await?;
    let position = fence.ok_or("no fence")?.await??;
    assert_eq!(position, 1, "after the create's thread.updated");
    let (_, fence) = harness.service.turns(turns_params(TERMINAL)?, true).await?;
    assert_eq!(fence.ok_or("no fence")?.await??, 1);
    harness.close().await;
    Ok(())
}

#[tokio::test]
async fn continues_a_session_in_its_own_directory_by_resuming_it() -> TestResult {
    let harness = harness(Options::default())?;
    store_with_terminal_session(&harness)?;
    start(&harness.service, TERMINAL, "and the other one").await?;
    let query = harness.runtime.query(0)?;
    assert_eq!(query.options.cwd.to_string_lossy(), "/repo");
    assert_eq!(
        query.options.identity,
        SessionIdentity::Resume(TERMINAL.into())
    );
    assert_eq!(query.options.profile, PermissionProfile::ReadOnly.options());
    harness.close().await;
    Ok(())
}

#[tokio::test]
async fn renames_through_claudes_store_and_emits_only_on_a_real_change() -> TestResult {
    let harness = harness(Options::default())?;
    store_with_terminal_session(&harness)?;
    let renamed = update(&harness, TERMINAL, rename(Some("Renamed"))).await?;
    assert_eq!(
        renamed.and_then(|thread| thread.name).as_deref(),
        Some("Renamed")
    );
    assert_eq!(
        custom_titles(&harness, TERMINAL),
        ["Flaky test fix", "Renamed"]
    );
    settle().await;
    let emitted = harness.events().len();
    let repeated = update(&harness, TERMINAL, rename(Some("Renamed"))).await?;
    assert_eq!(
        repeated.and_then(|thread| thread.name).as_deref(),
        Some("Renamed")
    );
    settle().await;
    assert_eq!(harness.events().len(), emitted);
    assert_eq!(custom_titles(&harness, TERMINAL).len(), 2);
    // Claude cannot clear a title: the service hides the current one.
    let cleared = update(&harness, TERMINAL, rename(None)).await?;
    assert_eq!(cleared.ok_or("no thread")?.name, None);
    let threads = listed(&harness.service, list_params()).await?;
    assert_eq!(find(&threads, TERMINAL)?.name, None);
    let back = update(&harness, TERMINAL, rename(Some("Back"))).await?;
    assert_eq!(back.and_then(|thread| thread.name).as_deref(), Some("Back"));
    harness.close().await;
    Ok(())
}

#[tokio::test]
async fn archives_with_host_metadata() -> TestResult {
    let harness = harness(Options::default())?;
    store_with_terminal_session(&harness)?;
    let archived = update(
        &harness,
        TERMINAL,
        ThreadChange::Archived { archived: true },
    )
    .await?;
    assert!(archived.ok_or("no thread")?.archived);
    assert!(listed(&harness.service, list_params()).await?.is_empty());
    let in_archive = ThreadListParams {
        archived: true,
        ..list_params()
    };
    assert_eq!(
        ids(&listed(&harness.service, in_archive).await?),
        [TERMINAL]
    );
    harness.close().await;
    Ok(())
}

#[tokio::test]
async fn deletes_through_claudes_store_repeats_succeed_and_never_resurrect_the_thread() -> TestResult
{
    let harness = harness(Options::default())?;
    store_with_terminal_session(&harness)?;
    assert_eq!(
        update(&harness, TERMINAL, ThreadChange::Deleted).await?,
        None
    );
    assert!(!session_file_exists(&harness, TERMINAL));
    assert_eq!(
        update(&harness, TERMINAL, ThreadChange::Deleted).await?,
        None
    );
    assert_eq!(
        rejected_code(
            harness
                .service
                .read(&id(TERMINAL)?, false)
                .await
                .map(|(read, _)| read)
        ),
        Some(-32_600)
    );
    assert!(listed(&harness.service, list_params()).await?.is_empty());
    assert!(
        update(&harness, UNKNOWN, ThreadChange::Deleted)
            .await
            .is_err()
    );
    harness.close().await;
    Ok(())
}

#[tokio::test]
async fn applies_a_name_given_before_claude_created_the_session_once_it_exists() -> TestResult {
    let harness = harness(Options::default())?;
    create_thread(&harness.service, THREAD).await?;
    let named = update(&harness, THREAD, rename(Some("Early name"))).await?;
    assert_eq!(
        named.and_then(|thread| thread.name).as_deref(),
        Some("Early name")
    );
    assert!(custom_titles(&harness, THREAD).is_empty());
    start(&harness.service, THREAD, "hello").await?;
    harness.runtime.query(0)?.push(frames::init()).await;
    settle().await;
    assert_eq!(custom_titles(&harness, THREAD), ["Early name"]);
    let (read, _) = harness.service.read(&id(THREAD)?, false).await?;
    assert_eq!(read.thread.name.as_deref(), Some("Early name"));
    harness.close().await;
    Ok(())
}

#[tokio::test]
async fn deletes_every_session_of_the_chain() -> TestResult {
    let harness = harness(Options::default())?;
    create_thread(&harness.service, THREAD).await?;
    start(&harness.service, THREAD, "hello").await?;
    let query = harness.runtime.query(0)?;
    query.push(frames::init()).await;
    query.push(frames::result()).await;
    settle().await;
    assert!(session_file_exists(&harness, THREAD));
    assert_eq!(update(&harness, THREAD, ThreadChange::Deleted).await?, None);
    assert!(!session_file_exists(&harness, THREAD));
    assert_eq!(update(&harness, THREAD, ThreadChange::Deleted).await?, None);
    harness.close().await;
    Ok(())
}

#[tokio::test]
async fn keeps_no_conversation_in_its_own_state() -> TestResult {
    let harness = harness(Options::default())?;
    create_thread(&harness.service, THREAD).await?;
    start(&harness.service, THREAD, "a secret prompt").await?;
    let query = harness.runtime.query(0)?;
    query.push(frames::init()).await;
    query.push(frames::text("m1", "a secret answer")).await;
    query.push(frames::result()).await;
    settle().await;
    let directory = harness.state_directory().join("threads").join(THREAD);
    let files = std::fs::read_dir(&directory)?
        .filter_map(Result::ok)
        .map(|entry| entry.file_name().to_string_lossy().into_owned())
        .collect::<Vec<_>>();
    assert_eq!(files, ["state.json"]);
    let state = std::fs::read_to_string(directory.join("state.json"))?;
    assert!(!state.contains("secret"));
    harness.close().await;
    Ok(())
}

#[tokio::test]
async fn converts_a_version_1_journal_keeping_turn_ids_and_client_message_ids() -> TestResult {
    let root = Arc::new(tempfile::tempdir()?);
    let directory = root.path().join("journal").join("threads").join(THREAD);
    std::fs::create_dir_all(directory.join("turns"))?;
    let settings = json!({"effort": null, "model": "sonnet", "permissionProfile": ":workspace", "serviceTier": null});
    std::fs::write(
        directory.join("thread.json"),
        json!({"appThreadId": THREAD, "archived": true, "claudeSessionId": THREAD, "createdAt": 10,
            "cwd": "/workspace", "deletedAt": null, "firstUserMessage": "hello", "name": "Old name",
            "pendingSettings": null, "preview": "hello", "recencyAt": 11, "sessionStarted": true,
            "settings": settings, "totalUsage": {"cachedInputTokens": 0, "inputTokens": 1,
            "outputTokens": 2, "reasoningOutputTokens": 0, "totalTokens": 3}, "turnCount": 1,
            "updatedAt": 12, "version": 1})
        .to_string(),
    )?;
    let turn = json!({"completedAt": 12, "error": null, "origin": "user", "startedAt": 11,
        "status": "completed", "turnId": "legacy-turn", "items": [{"clientMessageId": "client-1",
        "content": [{"text": "hello", "type": "text"}], "itemId": "legacy-turn:user:0", "type": "userMessage"}]});
    std::fs::write(
        directory.join("turns").join("00000001.json"),
        json!({"prompts": [{"clientMessageId": "client-1", "uuid": "p-legacy"}], "seq": 1,
            "turn": turn, "version": 1})
        .to_string(),
    )?;
    let harness = harness(Options {
        root: Some(root),
        ..Options::default()
    })?;
    write_session(
        &harness.projects(),
        "/workspace",
        THREAD,
        &[
            stored_prompt(THREAD, "/workspace", "p-legacy", "hello"),
            stored_answer(THREAD, "a-legacy", "hi", "claude-sonnet-4-6"),
        ],
        1_760_000_200_000,
    )?;
    assert!(harness.service.load().await?.is_empty());
    let mut files = std::fs::read_dir(&directory)?
        .filter_map(Result::ok)
        .map(|entry| entry.file_name().to_string_lossy().into_owned())
        .collect::<Vec<_>>();
    files.sort();
    assert_eq!(files, ["state.json", "thread.json", "turns"]);
    settle().await;
    assert_eq!(custom_titles(&harness, THREAD), ["Old name"]);
    let in_archive = ThreadListParams {
        archived: true,
        ..list_params()
    };
    assert_eq!(ids(&listed(&harness.service, in_archive).await?), [THREAD]);
    let (turns, _) = harness.service.turns(turns_params(THREAD)?, false).await?;
    let echoes = turns
        .turns
        .iter()
        .map(|turn| {
            let client_message_id = match turn.items.first() {
                Some(AgentItem::UserMessage {
                    client_message_id, ..
                }) => client_message_id.as_ref().map(|id| id.as_str().to_owned()),
                _ => None,
            };
            (turn.turn_id.as_str().to_owned(), client_message_id)
        })
        .collect::<Vec<_>>();
    assert_eq!(
        echoes,
        [("legacy-turn".to_owned(), Some("client-1".to_owned()))]
    );
    harness.close().await;
    Ok(())
}

#[tokio::test]
async fn locks_a_session_another_process_runs_refuses_its_turns_and_releases_it_live() -> TestResult
{
    let harness = harness(Options {
        poll: std::time::Duration::from_millis(5),
        ..Options::default()
    })?;
    store_with_terminal_session(&harness)?;
    listed(&harness.service, list_params()).await?;
    harness.running.add(TERMINAL);
    harness.service.read(&id(TERMINAL)?, false).await?;
    settle().await;
    assert_eq!(harness.statuses(TERMINAL), [ThreadStatus::OpenElsewhere]);
    let (read, _) = harness.service.read(&id(TERMINAL)?, false).await?;
    assert_eq!(read.thread.status, ThreadStatus::OpenElsewhere);
    let refused = harness
        .service
        .turn_start(TurnStartParams {
            app_thread_id: id(TERMINAL)?,
            client_message_id: None,
            input: text("continue"),
            client_tools: None,
        })
        .await;
    match refused {
        Err(ProviderError::Rejected(error)) => {
            assert!(
                error
                    .message
                    .contains("conversation is open in another app")
            );
        }
        other => return Err(format!("expected a refusal, got {other:?}").into()),
    }
    assert!(harness.runtime.queries().is_empty());
    harness.running.remove(TERMINAL);
    for _ in 0..50 {
        if harness.statuses(TERMINAL).len() >= 2 {
            break;
        }
        settle().await;
    }
    assert_eq!(
        harness.statuses(TERMINAL),
        [ThreadStatus::OpenElsewhere, ThreadStatus::NotLoaded]
    );
    start(&harness.service, TERMINAL, "continue").await?;
    assert_eq!(harness.runtime.queries().len(), 1);
    harness.close().await;
    Ok(())
}

#[tokio::test]
async fn does_not_count_the_session_of_its_own_live_query() -> TestResult {
    let harness = harness(Options::default())?;
    create_thread(&harness.service, THREAD).await?;
    start(&harness.service, THREAD, "hello").await?;
    harness.runtime.query(0)?.push(frames::init()).await;
    settle().await;
    harness.running.add(THREAD);
    harness.service.read(&id(THREAD)?, false).await?;
    settle().await;
    assert!(
        !harness
            .statuses(THREAD)
            .contains(&ThreadStatus::OpenElsewhere)
    );
    let (read, _) = harness.service.read(&id(THREAD)?, false).await?;
    assert_eq!(read.thread.status, ThreadStatus::Active);
    harness.close().await;
    Ok(())
}

#[tokio::test]
async fn does_not_take_its_own_just_released_query_for_another_process() -> TestResult {
    let harness = harness(Options::default())?;
    create_thread(&harness.service, THREAD).await?;
    start(&harness.service, THREAD, "hello").await?;
    let query = harness.runtime.query(0)?;
    query.push(frames::init()).await;
    query.push(frames::result()).await;
    settle().await;
    // The CLI lists the service's own process while its query is open.
    harness.running.add(THREAD);
    harness.service.read(&id(THREAD)?, false).await?;
    settle().await;
    // A model change closes the idle query so the next turn reopens with it.
    let changed = update(
        &harness,
        THREAD,
        ThreadChange::Settings {
            model: Some("opus".into()),
            effort: None,
            permission_profile: None,
            service_tier: None,
        },
    )
    .await?;
    assert!(changed.is_some());
    settle().await;
    assert!(
        !harness
            .statuses(THREAD)
            .contains(&ThreadStatus::OpenElsewhere)
    );
    let (read, _) = harness.service.read(&id(THREAD)?, false).await?;
    assert_eq!(read.thread.status, ThreadStatus::NotLoaded);
    harness.close().await;
    Ok(())
}

#[tokio::test]
async fn reports_and_continues_with_the_catalog_model_the_session_last_answered_with() -> TestResult
{
    let harness = harness(Options {
        model_id_for: Arc::new(|recorded| {
            if recorded == "claude-opus-5-5" {
                "opus".to_owned()
            } else {
                recorded.to_owned()
            }
        }),
        ..Options::default()
    })?;
    write_session(
        &harness.projects(),
        "/repo",
        TERMINAL,
        &[
            stored_prompt(TERMINAL, "/repo", "p-1", "Fix the flaky test"),
            stored_answer(TERMINAL, "a-1", "Done.", "claude-sonnet-4-6"),
            stored_prompt(TERMINAL, "/repo", "p-2", "Now refactor"),
            stored_answer(TERMINAL, "a-2", "Done.", "claude-opus-5-5"),
            stored_answer(TERMINAL, "a-3", "Done.", "<synthetic>"),
        ],
        1_760_000_200_000,
    )?;
    let (read, _) = harness.service.read(&id(TERMINAL)?, false).await?;
    assert_eq!(read.thread.settings.model, "opus");
    start(&harness.service, TERMINAL, "continue").await?;
    assert_eq!(harness.runtime.query(0)?.options.model, "opus");
    harness.close().await;
    Ok(())
}

#[tokio::test]
async fn keeps_the_exact_model_a_thread_was_created_with() -> TestResult {
    let harness = harness(Options {
        model_id_for: Arc::new(|recorded| {
            if recorded == "claude-opus-5-5" {
                "opus".to_owned()
            } else {
                recorded.to_owned()
            }
        }),
        ..Options::default()
    })?;
    // A spawned agent names the full model id it was given; the thread stays
    // pinned to it (its name comes from the catalog, not from an alias swap).
    harness
        .service
        .create(ThreadCreateParams {
            app_thread_id: Some(id(THREAD)?),
            cwd: "/workspace".into(),
            settings: ThreadSettings {
                model: "claude-opus-5-5".into(),
                ..super::settings(":workspace")
            },
            client_tools: None,
        })
        .await?;
    let (read, _) = harness.service.read(&id(THREAD)?, false).await?;
    assert_eq!(read.thread.settings.model, "claude-opus-5-5");
    harness.close().await;
    Ok(())
}

#[tokio::test]
async fn keeps_the_default_when_the_session_recorded_no_model() -> TestResult {
    let harness = harness(Options::default())?;
    write_session(
        &harness.projects(),
        "/repo",
        TERMINAL,
        &[stored_prompt(
            TERMINAL,
            "/repo",
            "p-1",
            "Fix the flaky test",
        )],
        1_760_000_200_000,
    )?;
    let (read, _) = harness.service.read(&id(TERMINAL)?, false).await?;
    assert_eq!(read.thread.settings.model, "default");
    harness.close().await;
    Ok(())
}
