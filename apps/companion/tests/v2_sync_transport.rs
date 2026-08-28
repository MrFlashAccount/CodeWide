#![cfg(unix)]
#![allow(clippy::too_many_lines)]

use std::{
    collections::HashSet,
    error::Error,
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, AtomicU64, AtomicUsize, Ordering},
    },
    time::{Duration, SystemTime, UNIX_EPOCH},
};

use async_trait::async_trait;
use codewide_companion::{
    auth::{AuthorizationChange, AuthorizationChangeReason, AuthorizationContext},
    sync_v2::{
        AudienceSelector, AuthenticatedContextKey, CommandExecution, SemanticSource, SnapshotData,
        SubscriptionCoordinator, SyncV2Runtime,
        domain::{
            ApprovalAction, CatalogPartitionScope, CatalogScope, PendingRequest, ProjectionChange,
            SnapshotLimits,
        },
        protocol::{
            Action, ActionResult, CatalogSnapshot, Command, CommandResult, OpenIntent, Query,
            QueryResult, ResolutionState, V2Error,
        },
        scalar::{Id, OperationId, U64},
    },
};
use serde_json::json;
use tokio::{sync::watch, time::timeout};

const TEST_PIN: &str = "sha256/test-companion-pin";

#[path = "v2_sync_transport/lifecycle.rs"]
mod lifecycle;
mod support;

use support::v2_transport::*;

struct FakeSource {
    coordinator: SubscriptionCoordinator,
    generation: watch::Receiver<u64>,
    generation_tx: watch::Sender<u64>,
    generation_value: AtomicU64,
    executions: AtomicUsize,
    hang_snapshot: AtomicBool,
    hang_install: AtomicBool,
    hang_query: AtomicBool,
    hang_authorize: AtomicBool,
    hang_execute: AtomicBool,
    hang_resolve: AtomicBool,
    hang_remove: AtomicBool,
    fail_purge: AtomicBool,
    thread_access: Mutex<HashSet<(AuthenticatedContextKey, Id)>>,
}

impl FakeSource {
    fn new() -> Arc<Self> {
        let (generation_tx, generation) = watch::channel(1);
        Arc::new(Self {
            coordinator: SubscriptionCoordinator::default(),
            generation,
            generation_tx,
            generation_value: AtomicU64::new(1),
            executions: AtomicUsize::new(0),
            hang_snapshot: AtomicBool::new(false),
            hang_install: AtomicBool::new(false),
            hang_query: AtomicBool::new(false),
            hang_authorize: AtomicBool::new(false),
            hang_execute: AtomicBool::new(false),
            hang_resolve: AtomicBool::new(false),
            hang_remove: AtomicBool::new(false),
            fail_purge: AtomicBool::new(false),
            thread_access: Mutex::new(HashSet::new()),
        })
    }

    fn advance_generation(&self, generation: u64) {
        self.generation_value.store(generation, Ordering::SeqCst);
        let _ = self.generation_tx.send(generation);
    }

    fn publish_thread_change(&self, thread_id: &str, revision: &str) -> Result<(), V2Error> {
        let thread_id = Id::new(thread_id.to_owned())
            .map_err(|_| V2Error::invalid_request("invalid fake thread id"))?;
        let contexts = self
            .thread_access
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .iter()
            .filter(|(_, candidate)| candidate == &thread_id)
            .map(|(context, _)| context.clone())
            .collect::<HashSet<_>>();
        for context in contexts {
            self.coordinator.publish(
                self.generation(),
                AudienceSelector::CurrentThread {
                    context,
                    thread_id: thread_id.clone(),
                },
                ProjectionChange::AccountsChanged {
                    revision: revision.into(),
                },
            );
        }
        Ok(())
    }
}

#[async_trait]
impl SemanticSource for FakeSource {
    fn generation(&self) -> u64 {
        self.generation_value.load(Ordering::SeqCst)
    }

    fn subscribe_generation(&self) -> watch::Receiver<u64> {
        self.generation.clone()
    }

    fn coordinator(&self) -> &SubscriptionCoordinator {
        &self.coordinator
    }

    async fn purge_context(&self, context: &AuthenticatedContextKey) -> Result<(), V2Error> {
        if self.fail_purge.load(Ordering::SeqCst) {
            return Err(V2Error::source_unavailable("injected purge failure"));
        }
        self.thread_access
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .retain(|(candidate, _)| candidate != context);
        self.coordinator.invalidate_context(context);
        Ok(())
    }

    async fn install_intent(
        &self,
        _recipient_id: &Id,
        _intent: &OpenIntent,
        _authorization: &AuthorizationContext,
        context: &AuthenticatedContextKey,
        _generation: u64,
    ) -> Result<(), V2Error> {
        if self.hang_install.load(Ordering::SeqCst) {
            std::future::pending::<()>().await;
        }
        if let Some(current) = &_intent.current_thread {
            self.thread_access
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner)
                .insert((context.clone(), current.thread_id.clone()));
        }
        Ok(())
    }

    async fn remove_intent(&self, recipient_id: &Id) {
        if self.hang_remove.load(Ordering::SeqCst) {
            std::future::pending::<()>().await;
        }
        self.coordinator.remove(recipient_id);
    }

    async fn snapshot(
        &self,
        intent: &OpenIntent,
        _authorization: &AuthorizationContext,
        _context: &AuthenticatedContextKey,
        generation: u64,
    ) -> Result<SnapshotData, V2Error> {
        if self.hang_snapshot.load(Ordering::SeqCst) {
            std::future::pending::<()>().await;
        }
        Ok(SnapshotData {
            scope: CatalogScope {
                active: CatalogPartitionScope {
                    limit: intent.catalog.active_limit,
                    returned: 0,
                    complete: true,
                },
                archived: CatalogPartitionScope {
                    limit: intent.catalog.archived_limit,
                    returned: 0,
                    complete: true,
                },
            },
            catalog: CatalogSnapshot {
                active: Vec::new(),
                archived: Vec::new(),
            },
            current_thread: None,
            pending_requests: Vec::new(),
            source_witness: format!("fake-generation-{generation}"),
        })
    }

    async fn query(
        &self,
        query: Query,
        _authorization: &AuthorizationContext,
        _context: &AuthenticatedContextKey,
        _generation: u64,
    ) -> Result<QueryResult, V2Error> {
        if self.hang_query.load(Ordering::SeqCst) {
            std::future::pending::<()>().await;
        }
        match query {
            Query::CapabilitiesRead => Ok(QueryResult::AccountsList {
                active_profile_id: None,
                profiles: Vec::new(),
                all_exhausted: false,
            }),
            _ => Err(V2Error::invalid_request("query not used by transport test")),
        }
    }

    async fn authorize_command(
        &self,
        command: &Command,
        authorization: &AuthorizationContext,
        context: &AuthenticatedContextKey,
        _generation: u64,
    ) -> Result<(), V2Error> {
        if self.hang_authorize.load(Ordering::SeqCst) {
            std::future::pending::<()>().await;
        }
        let allowed = matches!(authorization, AuthorizationContext::Session { scopes, .. } if scopes.iter().any(|scope| scope == "threads.write"));
        if !allowed {
            return Err(V2Error::forbidden("threads.write scope required"));
        }
        if let Command::ThreadDelete { thread_id } = command
            && !self
                .thread_access
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner)
                .contains(&(context.clone(), thread_id.clone()))
        {
            return Err(V2Error::forbidden("thread access was not authorized"));
        }
        Ok(())
    }

    async fn execute(
        &self,
        _operation_id: &OperationId,
        command: Command,
        _authorization: &AuthorizationContext,
        _context: &AuthenticatedContextKey,
        _generation: u64,
    ) -> CommandExecution {
        self.executions.fetch_add(1, Ordering::SeqCst);
        if self.hang_execute.load(Ordering::SeqCst) {
            std::future::pending::<()>().await;
        }
        tokio::time::sleep(Duration::from_millis(40)).await;
        match command {
            Command::ThreadDelete { thread_id } => {
                CommandExecution::Completed(CommandResult::ThreadDelete { thread_id })
            }
            Command::ThreadCreate { .. } => {
                let Ok(thread_id) = Id::new("mismatched-result") else {
                    return CommandExecution::Failed(V2Error::source_unavailable(
                        "static test id is invalid",
                    ));
                };
                CommandExecution::Completed(CommandResult::ThreadDelete { thread_id })
            }
            _ => CommandExecution::Failed(V2Error::invalid_request("unsupported fake command")),
        }
    }

    async fn resolve(
        &self,
        action: Action,
        _authorization: &AuthorizationContext,
        _context: &AuthenticatedContextKey,
        _generation: u64,
    ) -> Result<ActionResult, V2Error> {
        if self.hang_resolve.load(Ordering::SeqCst) {
            std::future::pending::<()>().await;
        }
        let Action::RequestResolve { request_id, .. } = action;
        Ok(ActionResult::RequestResolve {
            request_id,
            state: ResolutionState::AlreadyResolved,
        })
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn epochs_isolate_clients_reinitialize_and_replay_commands() -> Result<(), Box<dyn Error>> {
    let directory = tempfile::tempdir()?;
    let source = FakeSource::new();
    let limits = SnapshotLimits {
        queue_max_events: 1,
        queue_max_bytes: 1_024,
        ..SnapshotLimits::default()
    };
    let runtime = SyncV2Runtime::new(
        source.clone(),
        directory.path().join("v2-ledger.redb"),
        TEST_PIN,
    )?
    .with_limits(limits);
    let (address, server_task) = start_server(directory.path(), runtime).await?;
    let url = format!("ws://{address}/v2/sync");

    let mut missing_nullable = connect_as(&url, "invalid-device", "threads.read").await?;
    send(
        &mut missing_nullable,
        json!({
            "type": "open",
            "version": 2,
            "intent": {"catalog": {"activeLimit": 0, "archivedLimit": 0}}
        }),
    )
    .await?;
    expect_close_code(&mut missing_nullable, 1008).await?;

    let mut first = connect(&url).await?;
    let mut second = connect_as(&url, "device-b", "threads.read,threads.write").await?;
    open_and_commit(&mut first, "thread-a").await?;
    open_and_commit(&mut second, "thread-b").await?;
    let mut shared = connect(&url).await?;
    open_and_commit(&mut shared, "thread-a").await?;
    let mut shared_other_device =
        connect_as(&url, "device-c", "threads.read,threads.write").await?;
    open_and_commit(&mut shared_other_device, "thread-a").await?;

    source
        .publish_thread_change("thread-a", "for-a")
        .map_err(|error| std::io::Error::other(format!("{error:?}")))?;
    assert_eq!(receive(&mut first).await?["type"], "change");
    assert_eq!(receive(&mut shared).await?["type"], "change");
    assert_eq!(receive(&mut shared_other_device).await?["type"], "change");
    assert!(
        timeout(Duration::from_millis(100), receive(&mut second))
            .await
            .is_err()
    );
    source.coordinator.publish(
        1,
        current_thread_audience("device-b", "thread-b")?,
        ProjectionChange::AccountsChanged {
            revision: "for-b".into(),
        },
    );
    assert_eq!(receive(&mut second).await?["type"], "change");

    source.coordinator.publish(
        1,
        current_thread_audience("device-a", "thread-a")?,
        ProjectionChange::PendingRequestOpened {
            request: PendingRequest::Approval {
                id: Id::new("approval-a")?,
                generation: U64::new(1),
                thread_id: Id::new("thread-a")?,
                turn_id: Id::new("turn-a")?,
                action: ApprovalAction::RunCommand,
                summary: "approval".into(),
            },
        },
    );
    assert_eq!(
        receive(&mut first).await?["change"]["request"]["id"],
        "approval-a"
    );
    assert_eq!(
        receive(&mut shared).await?["change"]["request"]["id"],
        "approval-a"
    );
    assert!(
        timeout(Duration::from_millis(100), receive(&mut second))
            .await
            .is_err()
    );

    send(
        &mut first,
        json!({
            "type": "command",
            "requestId": "request-1",
            "operationId": "stable-operation",
            "command": {"kind": "thread.delete", "threadId": "thread-a"}
        }),
    )
    .await?;
    send(
        &mut shared,
        json!({
            "type": "command",
            "requestId": "request-concurrent",
            "operationId": "stable-operation",
            "command": {"kind": "thread.delete", "threadId": "thread-a"}
        }),
    )
    .await?;
    assert_eq!(receive(&mut first).await?["type"], "commandAccepted");
    assert_eq!(receive(&mut first).await?["type"], "commandCompleted");
    assert_eq!(receive(&mut shared).await?["type"], "commandAccepted");
    assert_eq!(receive(&mut shared).await?["type"], "commandCompleted");
    send(
        &mut first,
        json!({
            "type": "command",
            "requestId": "request-2",
            "operationId": "stable-operation",
            "command": {"kind": "thread.delete", "threadId": "thread-a"}
        }),
    )
    .await?;
    assert_eq!(receive(&mut first).await?["type"], "commandAccepted");
    assert_eq!(receive(&mut first).await?["type"], "commandCompleted");
    assert_eq!(source.executions.load(Ordering::SeqCst), 1);
    send(
        &mut second,
        json!({
            "type": "command",
            "requestId": "cross-context",
            "operationId": "cross-context-operation",
            "command": {"kind": "thread.delete", "threadId": "thread-a"}
        }),
    )
    .await?;
    let denied = receive(&mut second).await?;
    assert_eq!(denied["type"], "commandRejected");
    assert_eq!(denied["error"]["code"], "forbidden");
    assert_eq!(source.executions.load(Ordering::SeqCst), 1);
    let mut other_authorized = connect(&url).await?;
    open_and_commit(&mut other_authorized, "other-thread").await?;
    send(
        &mut first,
        json!({
            "type": "command",
            "requestId": "request-3",
            "operationId": "stable-operation",
            "command": {"kind": "thread.delete", "threadId": "other-thread"}
        }),
    )
    .await?;
    let conflict = receive(&mut first).await?;
    assert_eq!(conflict["type"], "commandRejected");
    assert_eq!(conflict["error"]["code"], "operationIdConflict");

    let mut invalid_commit = connect(&url).await?;
    let snapshot = open(&mut invalid_commit, "thread-c").await?;
    send(
        &mut invalid_commit,
        json!({
            "type": "snapshotCommitted",
            "epochId": snapshot["epochId"],
            "revision": "sync-v2-revision:wrong",
            "watermark": snapshot["watermark"]
        }),
    )
    .await?;
    let reinitialize = receive(&mut invalid_commit).await?;
    assert_eq!(reinitialize["type"], "reinitialize");
    assert_eq!(reinitialize["reason"], "invalidCommit");
    open_and_commit(&mut invalid_commit, "thread-c").await?;

    let mut overflowing = connect(&url).await?;
    let _snapshot = open(&mut overflowing, "thread-d").await?;
    for revision in ["queued-one", "queued-two"] {
        source.coordinator.publish(
            1,
            current_thread_audience("device-a", "thread-d")?,
            ProjectionChange::AccountsChanged {
                revision: revision.into(),
            },
        );
    }
    let overflow = receive(&mut overflowing).await?;
    assert_eq!(overflow["type"], "reinitialize");
    assert_eq!(overflow["reason"], "queueOverflow");

    send(&mut first, json!({"type": "ping", "nonce": "still-live"})).await?;
    assert_eq!(receive(&mut first).await?["type"], "pong");

    source
        .publish_thread_change("thread-a", "shared-intent")
        .map_err(|error| std::io::Error::other(format!("{error:?}")))?;
    assert_eq!(
        receive(&mut first).await?["change"]["revision"],
        "shared-intent"
    );
    assert_eq!(
        receive(&mut shared).await?["change"]["revision"],
        "shared-intent"
    );
    assert_eq!(
        receive(&mut shared_other_device).await?["change"]["revision"],
        "shared-intent"
    );

    let mut mismatched_query = connect(&url).await?;
    open_and_commit(&mut mismatched_query, "thread-query").await?;
    send(
        &mut mismatched_query,
        json!({
            "type": "query",
            "requestId": "mismatched-query",
            "query": {"kind": "capabilities.read"}
        }),
    )
    .await?;
    let query_reset = receive(&mut mismatched_query).await?;
    assert_eq!(query_reset["reason"], "sourceGap");

    send(
        &mut invalid_commit,
        json!({
            "type": "command",
            "requestId": "mismatched-command",
            "operationId": "mismatched-command-operation",
            "command": {
                "kind": "thread.create",
                "workspace": "/tmp",
                "title": null,
                "settings": {
                    "model": null,
                    "effort": null,
                    "approvalPolicy": "never",
                    "sandbox": "readOnly"
                }
            }
        }),
    )
    .await?;
    assert_eq!(
        receive(&mut invalid_commit).await?["type"],
        "commandAccepted"
    );
    let mismatch = receive(&mut invalid_commit).await?;
    assert_eq!(mismatch["type"], "commandIndeterminate");
    assert_eq!(mismatch["error"]["code"], "operationIndeterminate");

    let mut forbidden = connect_as(&url, "limited-device", "threads.read").await?;
    open_and_commit(&mut forbidden, "thread-limited").await?;
    send(
        &mut forbidden,
        json!({
            "type": "command",
            "requestId": "forbidden-before-admission",
            "operationId": "forbidden-then-allowed",
            "command": {"kind": "thread.delete", "threadId": "thread-limited"}
        }),
    )
    .await?;
    assert_eq!(receive(&mut forbidden).await?["type"], "commandRejected");
    forbidden.close(None).await?;
    let executions_before_allowed = source.executions.load(Ordering::SeqCst);
    let mut allowed = connect_as(&url, "limited-device", "threads.read,threads.write").await?;
    open_and_commit(&mut allowed, "thread-limited").await?;
    send(
        &mut allowed,
        json!({
            "type": "command",
            "requestId": "allowed-after-forbidden",
            "operationId": "forbidden-then-allowed",
            "command": {"kind": "thread.delete", "threadId": "thread-limited"}
        }),
    )
    .await?;
    assert_eq!(receive(&mut allowed).await?["type"], "commandAccepted");
    assert_eq!(receive(&mut allowed).await?["type"], "commandCompleted");
    assert_eq!(
        source.executions.load(Ordering::SeqCst),
        executions_before_allowed + 1
    );

    let mut response_lost = connect(&url).await?;
    open_and_commit(&mut response_lost, "thread-a").await?;
    let executions_before_loss = source.executions.load(Ordering::SeqCst);
    send(
        &mut response_lost,
        json!({
            "type": "command",
            "requestId": "response-lost",
            "operationId": "response-lost-operation",
            "command": {"kind": "thread.delete", "threadId": "thread-a"}
        }),
    )
    .await?;
    assert_eq!(
        receive(&mut response_lost).await?["type"],
        "commandAccepted"
    );
    response_lost.close(None).await?;
    tokio::time::sleep(Duration::from_millis(100)).await;
    let mut recovered = connect(&url).await?;
    open_and_commit(&mut recovered, "thread-a").await?;
    send(
        &mut recovered,
        json!({
            "type": "command",
            "requestId": "response-recovered",
            "operationId": "response-lost-operation",
            "command": {"kind": "thread.delete", "threadId": "thread-a"}
        }),
    )
    .await?;
    assert_eq!(receive(&mut recovered).await?["type"], "commandAccepted");
    assert_eq!(receive(&mut recovered).await?["type"], "commandCompleted");
    assert_eq!(
        source.executions.load(Ordering::SeqCst),
        executions_before_loss + 1
    );

    let mut oversized = connect(&url).await?;
    open_and_commit(&mut oversized, "thread-oversized").await?;
    let input = (0..129)
        .map(|index| json!({"kind": "text", "text": format!("{index}")}))
        .collect::<Vec<_>>();
    send(
        &mut oversized,
        json!({
            "type": "command",
            "requestId": "too-many-inputs",
            "operationId": "too-many-inputs",
            "command": {
                "kind": "turn.submit",
                "threadId": "thread-oversized",
                "workspace": null,
                "input": input,
                "intent": "chat",
                "settings": null
            }
        }),
    )
    .await?;
    expect_close_code(&mut oversized, 1008).await?;

    second.close(None).await?;
    send(&mut first, json!({"type": "ping", "nonce": "peer-closed"})).await?;
    assert_eq!(receive(&mut first).await?["nonce"], "peer-closed");

    source.advance_generation(2);
    let first_generation = receive(&mut first).await?;
    let shared_generation = receive(&mut shared).await?;
    let shared_other_generation = receive(&mut shared_other_device).await?;
    assert_eq!(first_generation["reason"], "upstreamGenerationChanged");
    assert_eq!(shared_generation["reason"], "upstreamGenerationChanged");
    assert_eq!(
        shared_other_generation["reason"],
        "upstreamGenerationChanged"
    );

    first.close(None).await?;
    shared.close(None).await?;
    shared_other_device.close(None).await?;
    invalid_commit.close(None).await?;
    mismatched_query.close(None).await?;
    overflowing.close(None).await?;
    allowed.close(None).await?;
    recovered.close(None).await?;
    other_authorized.close(None).await?;
    server_task.abort();
    Ok(())
}
