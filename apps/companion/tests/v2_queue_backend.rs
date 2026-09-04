#![cfg(unix)]

use std::sync::Arc;

use codewide_companion::{
    auth::AuthorizationContext,
    catalog::SessionCatalog,
    history_service::HistoryService,
    store::{
        IndexStore, OutboxClaimOutcome, OutboxClaimResolution, OutboxPresentation,
        OutboxQueueInputBlock, OutboxState,
    },
    sync_v2::{
        AuthenticatedContextKey, CommandExecution, ProductionServices, SemanticSource,
        UpstreamSemanticSource,
        protocol::{Command, ErrorCode, Query, QueryResult, QueueMutation, Recovery, V2Error},
        scalar::OperationId,
    },
    upstream::UpstreamHandle,
};
use serde_json::json;

fn authorization(device_id: &str) -> AuthorizationContext {
    AuthorizationContext::Session {
        device_id: device_id.into(),
        expires_at: u64::MAX,
    }
}

#[tokio::test]
async fn queue_list_preserves_authoritative_attachment_identity_and_name()
-> Result<(), Box<dyn std::error::Error>> {
    let directory = tempfile::tempdir()?;
    let store = Arc::new(IndexStore::open(directory.path().join("state.redb"))?);
    let owner = context("device-a")?;
    store.outbox_put_turn_start_for_owner_with_queue_input(
        "operation-attachment",
        "thread-1",
        json!({
            "threadId": "thread-1",
            "clientUserMessageId": "operation-attachment",
            "input": [{"type": "mention", "name": "architecture final.md", "path": "/tmp/architecture-final.md"}]
        }),
        owner.as_str(),
        &[OutboxQueueInputBlock::Attachment {
            attachment_id: "attachment-stable".into(),
            name: "architecture final.md".into(),
        }],
    )?;

    let source = source(&directory, store);
    let QueryResult::QueueList { items, .. } = v2_result(
        source
            .query(
                Query::QueueList {
                    thread_id: None,
                    cursor: None,
                    limit: 100,
                },
                &authorization("device-a"),
                &owner,
                source.generation(),
            )
            .await,
    )?
    else {
        return Err("queue query returned the wrong result".into());
    };

    assert_eq!(items.len(), 1);
    assert_eq!(items[0].input.len(), 1);
    assert!(matches!(
        &items[0].input[0],
        codewide_companion::sync_v2::domain::InputBlock::Attachment { attachment_id }
            if attachment_id.as_str() == "attachment-stable"
    ));
    assert_eq!(items[0].attachments.len(), 1);
    assert_eq!(items[0].attachments[0].id.as_str(), "attachment-stable");
    assert_eq!(items[0].attachments[0].name, "architecture final.md");
    Ok(())
}

fn v2_result<T>(result: Result<T, V2Error>) -> Result<T, Box<dyn std::error::Error>> {
    result.map_err(|error| format!("{error:?}").into())
}

fn context(device_id: &str) -> Result<AuthenticatedContextKey, Box<dyn std::error::Error>> {
    v2_result(AuthenticatedContextKey::derive(&authorization(device_id)))
}

fn source(directory: &tempfile::TempDir, store: Arc<IndexStore>) -> Arc<UpstreamSemanticSource> {
    let catalog = Arc::new(SessionCatalog::scan(directory.path()));
    let history = HistoryService::new(catalog.clone(), store.clone());
    UpstreamSemanticSource::new(
        UpstreamHandle::spawn(directory.path().join("absent-app-server.sock")),
        store,
        history,
        catalog,
        ProductionServices::default(),
    )
}

fn put(
    store: &IndexStore,
    owner: &AuthenticatedContextKey,
    command_id: &str,
    state: Option<OutboxState>,
) -> Result<(), Box<dyn std::error::Error>> {
    store.outbox_put_turn_start_for_owner(
        command_id,
        "thread-1",
        json!({
            "threadId": "thread-1",
            "clientUserMessageId": command_id,
            "input": [{"type": "text", "text": command_id}]
        }),
        None,
        OutboxPresentation::Queue,
        owner.as_str(),
    )?;
    if let Some(state) = state {
        store.outbox_set_state(command_id, state, Some("rejected"))?;
    }
    Ok(())
}

#[tokio::test]
async fn queue_list_preserves_the_bounded_authoritative_failure_message()
-> Result<(), Box<dyn std::error::Error>> {
    let directory = tempfile::tempdir()?;
    let store = Arc::new(IndexStore::open(directory.path().join("state.redb"))?);
    let owner = context("device-a")?;
    put(&store, &owner, "operation-failed", None)?;
    let source_error = format!(
        "observer rejected operation: invalid cwd `/srv/project` (code E_CWD_17); details={}",
        "x".repeat(600)
    );
    let bounded_error = source_error.chars().take(500).collect::<String>();
    store.outbox_set_state("operation-failed", OutboxState::Failed, Some(&source_error))?;

    let source = source(&directory, store);
    let result = v2_result(
        source
            .query(
                Query::QueueList {
                    thread_id: None,
                    cursor: None,
                    limit: 100,
                },
                &authorization("device-a"),
                &owner,
                source.generation(),
            )
            .await,
    )?;
    let QueryResult::QueueList { items, .. } = result else {
        return Err("queue query returned the wrong result".into());
    };

    assert_eq!(items.len(), 1);
    assert_eq!(items[0].last_error.as_deref(), Some(bounded_error.as_str()));
    Ok(())
}

#[tokio::test]
async fn queue_list_distinguishes_active_delivery_from_indeterminate_delivery()
-> Result<(), Box<dyn std::error::Error>> {
    let directory = tempfile::tempdir()?;
    let store = Arc::new(IndexStore::open(directory.path().join("state.redb"))?);
    let owner = context("device-a")?;
    put(&store, &owner, "operation-running", None)?;
    let OutboxClaimOutcome::Acquired { token, .. } =
        store.outbox_claim_dispatch("operation-running")?
    else {
        return Err("queue dispatch was not claimed".into());
    };
    let source = source(&directory, store.clone());

    let QueryResult::QueueList { items, .. } = v2_result(
        source
            .query(
                Query::QueueList {
                    thread_id: None,
                    cursor: None,
                    limit: 100,
                },
                &authorization("device-a"),
                &owner,
                source.generation(),
            )
            .await,
    )?
    else {
        return Err("queue query returned the wrong result".into());
    };
    assert_eq!(
        items[0].state,
        codewide_companion::sync_v2::protocol::QueueState::Running
    );

    store.outbox_resolve_claim(
        "operation-running",
        token,
        OutboxClaimResolution::Indeterminate {
            error: "connection lost after send",
            retry_after_ms: 0,
        },
    )?;
    let QueryResult::QueueList { items, .. } = v2_result(
        source
            .query(
                Query::QueueList {
                    thread_id: None,
                    cursor: None,
                    limit: 100,
                },
                &authorization("device-a"),
                &owner,
                source.generation(),
            )
            .await,
    )?
    else {
        return Err("queue query returned the wrong result".into());
    };
    assert_eq!(
        items[0].state,
        codewide_companion::sync_v2::protocol::QueueState::Uncertain
    );
    Ok(())
}

#[tokio::test]
async fn queue_pages_more_than_one_thousand_owned_items_and_survives_restarts()
-> Result<(), Box<dyn std::error::Error>> {
    let directory = tempfile::tempdir()?;
    let path = directory.path().join("state.redb");
    let owner = context("device-a")?;
    {
        let store = IndexStore::open(&path)?;
        for index in 0..1_001 {
            put(&store, &owner, &format!("operation-{index:04}"), None)?;
        }
    }

    let store = Arc::new(IndexStore::open(&path)?);
    let thread_id = codewide_companion::sync_v2::scalar::Id::new("thread-1")?;
    let source_before_reset = source(&directory, store.clone());
    let first_result = v2_result(
        source_before_reset
            .query(
                Query::QueueList {
                    thread_id: Some(thread_id.clone()),
                    cursor: None,
                    limit: 100,
                },
                &authorization("device-a"),
                &owner,
                source_before_reset.generation(),
            )
            .await,
    )?;
    let QueryResult::QueueList {
        items: first_page,
        revision,
        ..
    } = first_result
    else {
        return Err("queue query returned the wrong result".into());
    };
    assert_eq!(first_page.len(), 100);

    // Construct a fresh semantic source with no in-memory access witnesses.
    // Durable queue ownership must remain sufficient after source restart.
    let source = source(&directory, store);
    let generation = source.generation();
    let owned_mutation = Command::QueueMutate {
        mutation: QueueMutation::Cancel {
            item_id: codewide_companion::sync_v2::scalar::Id::new("operation-0000")?,
            expected_revision: revision,
        },
    };
    v2_result(
        source
            .authorize_command(
                &owned_mutation,
                &authorization("device-a"),
                &owner,
                generation,
            )
            .await,
    )?;
    assert!(
        source
            .authorize_command(
                &owned_mutation,
                &authorization("device-b"),
                &context("device-b")?,
                generation,
            )
            .await
            .is_err()
    );
    let mut cursor = None;
    let mut ids = Vec::new();
    loop {
        let result = v2_result(
            source
                .query(
                    Query::QueueList {
                        thread_id: Some(thread_id.clone()),
                        cursor,
                        limit: 100,
                    },
                    &authorization("device-a"),
                    &owner,
                    generation,
                )
                .await,
        )?;
        let QueryResult::QueueList {
            items, next_cursor, ..
        } = result
        else {
            return Err("queue query returned the wrong result".into());
        };
        ids.extend(items.into_iter().map(|item| item.id.as_str().to_owned()));
        let Some(next) = next_cursor else {
            break;
        };
        cursor = Some(next);
    }
    assert_eq!(ids.len(), 1_001);
    assert_eq!(ids.first().map(String::as_str), Some("operation-0000"));
    assert_eq!(ids.last().map(String::as_str), Some("operation-1000"));
    Ok(())
}

#[tokio::test]
async fn queue_cursor_fails_stale_and_owner_scope_does_not_leak()
-> Result<(), Box<dyn std::error::Error>> {
    let directory = tempfile::tempdir()?;
    let store = Arc::new(IndexStore::open(directory.path().join("state.redb"))?);
    let owner_a = context("device-a")?;
    let owner_b = context("device-b")?;
    for index in 0..101 {
        put(&store, &owner_a, &format!("a-{index:03}"), None)?;
    }
    put(&store, &owner_b, "b-000", None)?;
    let source = source(&directory, store.clone());
    let generation = source.generation();
    let first = v2_result(
        source
            .query(
                Query::QueueList {
                    thread_id: None,
                    cursor: None,
                    limit: 100,
                },
                &authorization("device-a"),
                &owner_a,
                generation,
            )
            .await,
    )?;
    let QueryResult::QueueList {
        items,
        next_cursor: Some(cursor),
        ..
    } = first
    else {
        return Err("first queue page was not bounded".into());
    };
    assert_eq!(items.len(), 100);
    assert!(items.iter().all(|item| item.id.as_str().starts_with("a-")));

    put(&store, &owner_a, "a-101", None)?;
    let result = source
        .query(
            Query::QueueList {
                thread_id: None,
                cursor: Some(cursor),
                limit: 100,
            },
            &authorization("device-a"),
            &owner_a,
            generation,
        )
        .await;
    let Err(error) = result else {
        return Err("mutated queue accepted a stale cursor".into());
    };
    assert_eq!(
        error.code,
        codewide_companion::sync_v2::protocol::ErrorCode::StaleCursor
    );
    Ok(())
}

#[tokio::test]
async fn concurrent_clients_cannot_commit_mutations_from_the_same_queue_revision()
-> Result<(), Box<dyn std::error::Error>> {
    let directory = tempfile::tempdir()?;
    let store = Arc::new(IndexStore::open(directory.path().join("state.redb"))?);
    let owner = context("device-a")?;
    put(&store, &owner, "operation-a", None)?;
    put(&store, &owner, "operation-b", None)?;
    let source = source(&directory, store);
    let generation = source.generation();
    let thread_id = codewide_companion::sync_v2::scalar::Id::new("thread-1")?;
    let snapshot = v2_result(
        source
            .query(
                Query::QueueList {
                    thread_id: Some(thread_id),
                    cursor: None,
                    limit: 100,
                },
                &authorization("device-a"),
                &owner,
                generation,
            )
            .await,
    )?;
    let QueryResult::QueueList { revision, .. } = snapshot else {
        return Err("queue query returned the wrong result".into());
    };
    let first = Command::QueueMutate {
        mutation: QueueMutation::Cancel {
            item_id: codewide_companion::sync_v2::scalar::Id::new("operation-a")?,
            expected_revision: revision.clone(),
        },
    };
    let stale = Command::QueueMutate {
        mutation: QueueMutation::Cancel {
            item_id: codewide_companion::sync_v2::scalar::Id::new("operation-b")?,
            expected_revision: revision,
        },
    };

    // Both connections authorize against the same snapshot before either write.
    v2_result(
        source
            .authorize_command(&first, &authorization("device-a"), &owner, generation)
            .await,
    )?;
    v2_result(
        source
            .authorize_command(&stale, &authorization("device-a"), &owner, generation)
            .await,
    )?;

    let first_result = source
        .execute(
            &OperationId::new("client-a-cancel")?,
            first,
            &authorization("device-a"),
            &owner,
            generation,
        )
        .await;
    assert!(matches!(first_result, CommandExecution::Completed(_)));
    let stale_result = source
        .execute(
            &OperationId::new("client-b-cancel")?,
            stale,
            &authorization("device-a"),
            &owner,
            generation,
        )
        .await;
    let CommandExecution::Failed(error) = stale_result else {
        return Err("stale queue mutation unexpectedly committed".into());
    };
    assert_eq!(error.code, ErrorCode::Conflict);
    assert_eq!(error.recovery, Recovery::Requery);
    Ok(())
}
