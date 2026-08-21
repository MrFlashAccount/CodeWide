#![allow(clippy::expect_used)]

use codewide_companion::store::{IndexStore, OutboxPresentation, OutboxState};
use serde_json::json;

#[test]
fn turn_start_outbox_is_idempotent_and_survives_restart() -> Result<(), Box<dyn std::error::Error>>
{
    let directory = tempfile::tempdir()?;
    let path = directory.path().join("state.redb");
    let params = json!({
        "threadId": "thread-1",
        "clientUserMessageId": "command-1",
        "input": [{"type": "text", "text": "hello"}]
    });
    {
        let store = IndexStore::open(&path)?;
        let first =
            store.outbox_put_turn_start("command-1", "thread-1", params.clone(), Some(10))?;
        let duplicate =
            store.outbox_put_turn_start("command-1", "thread-1", params.clone(), Some(20))?;
        assert_eq!(first, duplicate);
        assert_eq!(first.created_at, 10);
        assert_eq!(first.attempts, 0);
        assert_eq!(first.next_attempt_at, 0);
        assert!(
            store
                .outbox_put_turn_start(
                    "command-1",
                    "thread-1",
                    json!({
                        "threadId": "thread-1",
                        "clientUserMessageId": "command-1",
                        "input": [{"type": "text", "text": "different"}]
                    }),
                    None,
                )
                .is_err()
        );
        store.outbox_set_state("command-1", OutboxState::Uncertain, None)?;
    }

    let reopened = IndexStore::open(&path)?;
    let commands = reopened.outbox_list(None)?;
    assert_eq!(commands.len(), 1);
    assert_eq!(commands[0].state, OutboxState::Uncertain);
    assert_eq!(reopened.outbox_ready_heads()?.len(), 1);
    assert!(!reopened.outbox_cancel("command-1")?);
    reopened.outbox_set_state("command-1", OutboxState::Failed, Some("failed"))?;
    assert!(reopened.outbox_cancel("command-1")?);
    assert!(reopened.outbox_list(None)?.is_empty());
    Ok(())
}

#[test]
fn durable_delivery_is_not_presented_as_an_explicit_user_queue()
-> Result<(), Box<dyn std::error::Error>> {
    let directory = tempfile::tempdir()?;
    let store = IndexStore::open(directory.path().join("state.redb"))?;
    let command = store.outbox_put_turn_start_with_presentation(
        "direct-1",
        "thread-1",
        json!({
            "threadId": "thread-1",
            "clientUserMessageId": "direct-1",
            "input": [{"type": "text", "text": "hello"}]
        }),
        Some(10),
        OutboxPresentation::Delivery,
    )?;
    assert_eq!(command.presentation, OutboxPresentation::Delivery);
    assert_eq!(
        store.outbox_list(Some("thread-1"))?[0].presentation,
        OutboxPresentation::Delivery
    );
    Ok(())
}

#[test]
fn workspace_gate_is_durable_and_part_of_command_identity() -> Result<(), Box<dyn std::error::Error>>
{
    let directory = tempfile::tempdir()?;
    let path = directory.path().join("state.redb");
    let params = json!({
        "threadId": "thread-1",
        "clientUserMessageId": "workspace-command",
        "input": [{"type": "text", "text": "hello"}]
    });
    {
        let store = IndexStore::open(&path)?;
        let command = store.outbox_put_turn_start_with_workspace(
            "workspace-command",
            "thread-1",
            params.clone(),
            Some(10),
            OutboxPresentation::Delivery,
            Some("workspace-request-1"),
        )?;
        assert_eq!(
            command.workspace_request_id.as_deref(),
            Some("workspace-request-1")
        );
        assert!(
            store
                .outbox_put_turn_start_with_workspace(
                    "workspace-command",
                    "thread-1",
                    params,
                    Some(10),
                    OutboxPresentation::Delivery,
                    Some("different-workspace"),
                )
                .is_err()
        );
    }
    let reopened = IndexStore::open(path)?;
    assert_eq!(
        reopened.outbox_list(None)?[0]
            .workspace_request_id
            .as_deref(),
        Some("workspace-request-1")
    );
    Ok(())
}

#[test]
fn deferred_outbox_commands_wait_and_can_be_retried_with_the_same_identity()
-> Result<(), Box<dyn std::error::Error>> {
    let directory = tempfile::tempdir()?;
    let store = IndexStore::open(directory.path().join("state.redb"))?;
    store.outbox_put_turn_start(
        "command-1",
        "thread-1",
        json!({
            "threadId": "thread-1",
            "clientUserMessageId": "command-1",
            "input": [{"type": "text", "text": "hello"}]
        }),
        None,
    )?;

    let deferred = store.outbox_defer(
        "command-1",
        OutboxState::Uncertain,
        "connection dropped",
        60_000,
    )?;
    assert_eq!(deferred.attempts, 1);
    assert!(deferred.next_attempt_at > deferred.updated_at);
    assert!(store.outbox_ready_heads()?.is_empty());

    store.outbox_set_state("command-1", OutboxState::Failed, Some("not accepted"))?;
    let retried = store.outbox_retry_failed("command-1")?;
    assert_eq!(retried.command_id, "command-1");
    assert_eq!(retried.state, OutboxState::Queued);
    assert_eq!(retried.attempts, 0);
    assert_eq!(retried.next_attempt_at, 0);
    assert_eq!(retried.last_error, None);
    assert_eq!(store.outbox_ready_heads()?.len(), 1);
    Ok(())
}

#[test]
fn account_switch_waits_do_not_consume_retries_and_legacy_failures_recover()
-> Result<(), Box<dyn std::error::Error>> {
    let directory = tempfile::tempdir()?;
    let store = IndexStore::open(directory.path().join("state.redb"))?;
    for (command_id, thread_id) in [("waiting", "thread-a"), ("legacy", "thread-b")] {
        store.outbox_put_turn_start(
            command_id,
            thread_id,
            json!({
                "threadId": thread_id,
                "clientUserMessageId": command_id,
                "input": [{"type": "text", "text": command_id}]
            }),
            None,
        )?;
    }

    let (waiting, changed) = store.outbox_wait("waiting", OutboxState::Queued, None, 60_000)?;
    assert!(!changed);
    assert_eq!(waiting.state, OutboxState::Queued);
    assert_eq!(waiting.attempts, 0);
    assert!(waiting.next_attempt_at > waiting.updated_at);

    store.outbox_set_state(
        "legacy",
        OutboxState::Failed,
        Some(
            "Codex App Server restart failed: account switch deferred while another turn is active",
        ),
    )?;
    let recovered_threads = store.outbox_recover_legacy_account_pool_failures()?;
    assert_eq!(recovered_threads, ["thread-b"]);
    let legacy = store
        .outbox_list(Some("thread-b"))?
        .into_iter()
        .next()
        .expect("legacy command");
    assert_eq!(legacy.state, OutboxState::Queued);
    assert_eq!(legacy.attempts, 0);
    assert_eq!(legacy.next_attempt_at, 0);
    assert_eq!(legacy.last_error, None);
    assert_eq!(store.outbox_ready_heads()?.len(), 1);
    Ok(())
}

#[test]
fn outbox_dispatches_only_one_head_per_thread() -> Result<(), Box<dyn std::error::Error>> {
    let directory = tempfile::tempdir()?;
    let store = IndexStore::open(directory.path().join("state.redb"))?;
    for (command, thread) in [
        ("one", "thread-a"),
        ("two", "thread-a"),
        ("three", "thread-b"),
    ] {
        store.outbox_put_turn_start(
            command,
            thread,
            json!({
                "threadId": thread,
                "clientUserMessageId": command,
                "input": [{"type": "text", "text": command}]
            }),
            None,
        )?;
    }
    let mut heads = store.outbox_ready_heads()?;
    heads.sort_by(|left, right| left.remote_thread_id.cmp(&right.remote_thread_id));
    assert_eq!(heads.len(), 2);
    assert_eq!(heads[0].command_id, "one");
    assert_eq!(heads[1].command_id, "three");
    Ok(())
}

#[test]
fn queued_commands_can_be_edited_and_placed_idempotently() -> Result<(), Box<dyn std::error::Error>>
{
    let directory = tempfile::tempdir()?;
    let store = IndexStore::open(directory.path().join("state.redb"))?;
    for command in ["one", "two", "three"] {
        store.outbox_put_turn_start(
            command,
            "thread-a",
            json!({
                "threadId": "thread-a",
                "clientUserMessageId": command,
                "input": [
                    {"type": "text", "text": command, "text_elements": []},
                    {"type": "skill", "name": "test-skill", "path": "/tmp/SKILL.md"}
                ]
            }),
            None,
        )?;
    }
    let edited = store.outbox_edit_prompt(
        "two",
        &json!([
            {"type": "text", "text": "edited two", "text_elements": []},
            {"type": "remoteFile", "rootId": "attachments", "path": "notes.md", "name": "notes.md", "kind": "file"}
        ]),
    )?;
    assert_eq!(edited.params["input"][0]["text"], "edited two");
    assert_eq!(edited.params["input"][1]["type"], "remoteFile");
    assert_eq!(edited.params["input"][2]["type"], "skill");
    assert!(store.outbox_place("three", Some("one"))?);
    assert!(!store.outbox_place("three", Some("one"))?);
    assert_eq!(
        store
            .outbox_list(Some("thread-a"))?
            .into_iter()
            .map(|command| command.command_id)
            .collect::<Vec<_>>(),
        ["three", "one", "two"]
    );
    store.outbox_set_state("three", OutboxState::Uncertain, None)?;
    assert!(
        store
            .outbox_edit_prompt(
                "three",
                &json!([{"type": "text", "text": "too late", "text_elements": []}]),
            )
            .is_err()
    );
    Ok(())
}
