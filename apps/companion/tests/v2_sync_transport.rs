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
        SubscriptionCoordinator, SyncV2Runtime, WatchedThreadData,
        domain::{
            ApprovalDecision, CatalogPartitionScope, CatalogScope, PendingRequest,
            ProjectionChange, SnapshotLimits, ThreadWindow,
        },
        protocol::{
            CatalogSnapshot, Command, CommandResult, CurrentThreadIntent, OpenIntent, Query,
            QueryResult, V2Error,
        },
        scalar::{Id, OperationId, U64},
    },
};
use serde_json::json;
use tokio::{
    sync::{Notify, watch},
    time::timeout,
};

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
    completed_executions: watch::Receiver<usize>,
    completed_executions_tx: watch::Sender<usize>,
    execute_entered: Notify,
    execute_cancelled: Notify,
    query_entered: Notify,
    remove_entered: Notify,
    hang_snapshot: AtomicBool,
    hang_install: AtomicBool,
    hang_query: AtomicBool,
    hang_authorize: AtomicBool,
    hang_execute: AtomicBool,
    hang_remove: AtomicBool,
    fail_purge: AtomicBool,
    thread_access: Mutex<HashSet<(AuthenticatedContextKey, Id)>>,
    block_first_install: AtomicBool,
    first_install_started: Notify,
    release_first_install: Notify,
    later_install_started: Notify,
    install_invocations: AtomicUsize,
    install_recipient_counts: Mutex<Vec<usize>>,
}

impl FakeSource {
    fn new() -> Arc<Self> {
        let (generation_tx, generation) = watch::channel(1);
        let (completed_executions_tx, completed_executions) = watch::channel(0);
        Arc::new(Self {
            coordinator: SubscriptionCoordinator::default(),
            generation,
            generation_tx,
            generation_value: AtomicU64::new(1),
            executions: AtomicUsize::new(0),
            completed_executions,
            completed_executions_tx,
            execute_entered: Notify::new(),
            execute_cancelled: Notify::new(),
            query_entered: Notify::new(),
            remove_entered: Notify::new(),
            hang_snapshot: AtomicBool::new(false),
            hang_install: AtomicBool::new(false),
            hang_query: AtomicBool::new(false),
            hang_authorize: AtomicBool::new(false),
            hang_execute: AtomicBool::new(false),
            hang_remove: AtomicBool::new(false),
            fail_purge: AtomicBool::new(false),
            thread_access: Mutex::new(HashSet::new()),
            block_first_install: AtomicBool::new(false),
            first_install_started: Notify::new(),
            release_first_install: Notify::new(),
            later_install_started: Notify::new(),
            install_invocations: AtomicUsize::new(0),
            install_recipient_counts: Mutex::new(Vec::new()),
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

    async fn wait_for_completed_execution(&self, expected: usize) -> Result<(), Box<dyn Error>> {
        let mut completed = self.completed_executions.clone();
        while *completed.borrow_and_update() < expected {
            timeout(Duration::from_secs(1), completed.changed()).await??;
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
        intent: &OpenIntent,
        _authorization: &AuthorizationContext,
        context: &AuthenticatedContextKey,
        generation: u64,
    ) -> Result<(), V2Error> {
        if self.hang_install.load(Ordering::SeqCst) {
            std::future::pending::<()>().await;
        }
        let invocation = self.install_invocations.fetch_add(1, Ordering::SeqCst);
        if invocation == 0 && self.block_first_install.swap(false, Ordering::SeqCst) {
            self.first_install_started.notify_one();
            self.release_first_install.notified().await;
        } else {
            self.later_install_started.notify_one();
        }
        if let Some(current) = &intent.current_thread {
            self.install_recipient_counts
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner)
                .push(
                    self.coordinator
                        .current_thread_recipient_count(&current.thread_id, generation),
                );
            self.thread_access
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner)
                .insert((context.clone(), current.thread_id.clone()));
        }
        Ok(())
    }

    async fn remove_intent(&self, recipient_id: &Id) {
        if self.hang_remove.load(Ordering::SeqCst) {
            self.remove_entered.notify_one();
            std::future::pending::<()>().await;
        }
        self.coordinator.remove(recipient_id);
    }

    async fn watch_thread(
        &self,
        recipient_id: &Id,
        thread: &CurrentThreadIntent,
        _authorization: &AuthorizationContext,
        context: &AuthenticatedContextKey,
        _generation: u64,
    ) -> Result<WatchedThreadData, V2Error> {
        self.thread_access
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .insert((context.clone(), thread.thread_id.clone()));
        self.coordinator
            .set_current_thread(recipient_id, Some(thread.clone()));
        let current_thread: ThreadWindow = serde_json::from_value(json!({
            "thread": {
                "id": thread.thread_id.as_str(), "parentId": null, "title": "Watched",
                "preview": "", "workspace": "/tmp", "archived": false, "state": "idle",
                "settings": null,
                "readState": {
                    "kind": "unknown", "latestActivityMarker": null,
                    "readThroughMarker": null, "unreadCount": null
                },
                "createdAt": "2026-08-27T00:00:00Z",
                "updatedAt": "2026-08-27T00:00:00Z", "lastActivityAt": null,
                "headTurnId": null
            },
            "turns": [], "olderCursor": null, "newerCursor": null
        }))
        .map_err(|_| V2Error::source_unavailable("fake watch projection is invalid"))?;
        Ok(WatchedThreadData {
            current_thread,
            pending_requests: Vec::new(),
        })
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
            self.query_entered.notify_one();
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
        _authorization: &AuthorizationContext,
        context: &AuthenticatedContextKey,
        _generation: u64,
    ) -> Result<(), V2Error> {
        if self.hang_authorize.load(Ordering::SeqCst) {
            std::future::pending::<()>().await;
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
            struct CancellationWitness<'a>(&'a Notify);

            impl Drop for CancellationWitness<'_> {
                fn drop(&mut self) {
                    self.0.notify_one();
                }
            }

            let _cancellation_witness = CancellationWitness(&self.execute_cancelled);
            self.execute_entered.notify_one();
            std::future::pending::<()>().await;
        }
        let execution = match command {
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
        };
        self.completed_executions_tx
            .send_modify(|completed| *completed = completed.saturating_add(1));
        execution
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn thread_watch_reuses_the_live_epoch_without_a_snapshot() -> Result<(), Box<dyn Error>> {
    let directory = tempfile::tempdir()?;
    let source = FakeSource::new();
    let runtime = SyncV2Runtime::new(
        source,
        directory.path().join("v2-watch-ledger.redb"),
        TEST_PIN,
    )?;
    let (address, server_task) = start_server(directory.path(), runtime).await?;
    let mut client = connect(&format!("ws://{address}/v2/sync")).await?;
    let snapshot = open(&mut client, "thread-a").await?;
    let epoch_id = snapshot["epochId"].clone();
    send(
        &mut client,
        json!({
            "type": "snapshotCommitted",
            "epochId": epoch_id,
            "revision": snapshot["revision"],
            "watermark": snapshot["watermark"]
        }),
    )
    .await?;
    assert_eq!(receive(&mut client).await?["type"], "live");

    send(
        &mut client,
        json!({
            "type": "threadWatch",
            "requestId": "watch-b",
            "threadId": "thread-b",
            "turnLimit": 36
        }),
    )
    .await?;
    let replacement = receive(&mut client).await?;
    assert_eq!(replacement["type"], "change");
    assert_eq!(replacement["epochId"], epoch_id);
    assert_eq!(replacement["change"]["kind"], "currentThreadReplaced");
    assert_eq!(
        replacement["change"]["currentThread"]["thread"]["id"],
        "thread-b"
    );
    let watched = receive(&mut client).await?;
    assert_eq!(watched["type"], "threadWatched");
    assert_eq!(watched["epochId"], epoch_id);

    client.close(None).await?;
    server_task.abort();
    Ok(())
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn concurrent_first_opens_serialize_registration_and_thread_installation()
-> Result<(), Box<dyn Error>> {
    let directory = tempfile::tempdir()?;
    let source = FakeSource::new();
    source.block_first_install.store(true, Ordering::SeqCst);
    let runtime = SyncV2Runtime::new(
        source.clone(),
        directory.path().join("v2-install-race-ledger.redb"),
        TEST_PIN,
    )?;
    let (address, server_task) = start_server(directory.path(), runtime).await?;
    let url = format!("ws://{address}/v2/sync");
    let mut first = connect_as(&url, "same-device").await?;
    send(
        &mut first,
        json!({
            "type": "open",
            "version": 2,
            "intent": {
                "catalog": {"activeLimit": 1, "archivedLimit": 1},
                "currentThread": {"threadId": "same-thread", "turnLimit": 1},
                "pendingRequests": "currentThread"
            }
        }),
    )
    .await?;
    timeout(
        Duration::from_secs(1),
        source.first_install_started.notified(),
    )
    .await?;

    let mut second = connect_as(&url, "other-device").await?;
    send(
        &mut second,
        json!({
            "type": "open",
            "version": 2,
            "intent": {
                "catalog": {"activeLimit": 1, "archivedLimit": 1},
                "currentThread": {"threadId": "same-thread", "turnLimit": 1},
                "pendingRequests": "currentThread"
            }
        }),
    )
    .await?;
    assert!(
        timeout(
            Duration::from_millis(100),
            source.later_install_started.notified()
        )
        .await
        .is_err(),
        "a second installation entered before the first installation completed"
    );
    source.release_first_install.notify_one();

    assert_eq!(receive(&mut first).await?["type"], "snapshot");
    assert_eq!(receive(&mut second).await?["type"], "snapshot");
    assert_eq!(
        *source
            .install_recipient_counts
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner),
        vec![1, 2]
    );

    first.close(None).await?;
    second.close(None).await?;
    server_task.abort();
    Ok(())
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn paired_session_replays_receipts_and_accepts_new_commands() -> Result<(), Box<dyn Error>> {
    let directory = tempfile::tempdir()?;
    let source = FakeSource::new();
    let runtime = SyncV2Runtime::new(
        source.clone(),
        directory.path().join("v2-retained-auth-ledger.redb"),
        TEST_PIN,
    )?;
    let (address, server_task) = start_server(directory.path(), runtime).await?;
    let url = format!("ws://{address}/v2/sync");
    let command = json!({
        "type": "command",
        "requestId": "delete-initial",
        "operationId": "delete-operation",
        "command": {"kind": "thread.delete", "threadId": "deleted-thread"}
    });

    let mut authorized = connect_as(&url, "retained-device").await?;
    open_and_commit(&mut authorized, "deleted-thread").await?;
    send(&mut authorized, command.clone()).await?;
    assert_eq!(receive(&mut authorized).await?["type"], "commandAccepted");
    assert_eq!(receive(&mut authorized).await?["type"], "commandCompleted");
    authorized.close(None).await?;

    let mut reconnected = connect_as(&url, "retained-device").await?;
    open_and_commit(&mut reconnected, "deleted-thread").await?;
    let mut retry = command;
    retry["requestId"] = json!("delete-retry-after-reconnect");
    send(&mut reconnected, retry).await?;
    assert_eq!(receive(&mut reconnected).await?["type"], "commandAccepted");
    assert_eq!(receive(&mut reconnected).await?["type"], "commandCompleted");
    assert_eq!(source.executions.load(Ordering::SeqCst), 1);

    send(
        &mut reconnected,
        json!({
            "type": "query",
            "requestId": "operation-after-reconnect",
            "query": {"kind": "operation.get", "operationId": "delete-operation"}
        }),
    )
    .await?;
    assert_eq!(receive(&mut reconnected).await?["type"], "queryCompleted");

    let fresh = json!({
        "type": "command",
        "requestId": "fresh-after-reconnect",
        "operationId": "fresh-operation",
        "command": {"kind": "thread.delete", "threadId": "deleted-thread"}
    });
    send(&mut reconnected, fresh.clone()).await?;
    assert_eq!(receive(&mut reconnected).await?["type"], "commandAccepted");
    assert_eq!(receive(&mut reconnected).await?["type"], "commandCompleted");
    assert_eq!(source.executions.load(Ordering::SeqCst), 2);
    reconnected.close(None).await?;

    let mut restored = connect_as(&url, "retained-device").await?;
    open_and_commit(&mut restored, "deleted-thread").await?;
    send(
        &mut restored,
        json!({
            "type": "query",
            "requestId": "operation-after-second-reconnect",
            "query": {"kind": "operation.get", "operationId": "delete-operation"}
        }),
    )
    .await?;
    assert_eq!(receive(&mut restored).await?["type"], "queryCompleted");
    send(&mut restored, fresh).await?;
    assert_eq!(receive(&mut restored).await?["type"], "commandAccepted");
    assert_eq!(receive(&mut restored).await?["type"], "commandCompleted");
    assert_eq!(source.executions.load(Ordering::SeqCst), 2);

    restored.close(None).await?;
    server_task.abort();
    Ok(())
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn epochs_isolate_clients_reinitialize_and_recover_commands() -> Result<(), Box<dyn Error>> {
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

    let mut missing_nullable = connect_as(&url, "invalid-device").await?;
    send(
        &mut missing_nullable,
        json!({
            "type": "open",
            "version": 2,
            "intent": {
                "catalog": {"activeLimit": 0, "archivedLimit": 0},
                "pendingRequests": "currentThread"
            }
        }),
    )
    .await?;
    expect_close_code(&mut missing_nullable, 1008).await?;

    let mut first = connect_as(&url, "device-a").await?;
    let mut second = connect_as(&url, "device-b").await?;
    open_and_commit(&mut first, "thread-a").await?;
    open_and_commit(&mut second, "thread-b").await?;
    let mut shared = connect(&url).await?;
    open_and_commit(&mut shared, "thread-a").await?;
    let mut shared_other_device = connect_as(&url, "device-c").await?;
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
            request: PendingRequest::CommandApproval {
                id: Id::new("approval-a")?,
                generation: U64::new(1),
                thread_id: Id::new("thread-a")?,
                turn_id: Id::new("turn-a")?,
                item_id: Id::new("item-a")?,
                command: Some("echo approval".into()),
                cwd: Some("/tmp".into()),
                reason: Some("approval".into()),
                network_approval_context_json: None,
                available_decisions: vec![ApprovalDecision::Accept, ApprovalDecision::Decline],
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
        &mut first,
        json!({
            "type": "query",
            "requestId": "operation-receipt",
            "query": {"kind": "operation.get", "operationId": "stable-operation"}
        }),
    )
    .await?;
    let receipt = receive(&mut first).await?;
    assert_eq!(receipt["type"], "queryCompleted");
    assert_eq!(receipt["result"]["kind"], "operation.get");
    assert_eq!(receipt["result"]["receipt"]["state"], "completed");
    send(
        &mut second,
        json!({
            "type": "query",
            "requestId": "cross-context-operation-receipt",
            "query": {"kind": "operation.get", "operationId": "stable-operation"}
        }),
    )
    .await?;
    let missing_receipt = receive(&mut second).await?;
    assert_eq!(missing_receipt["type"], "queryFailed");
    assert_eq!(missing_receipt["error"]["code"], "notFound");
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
                    "sandbox": "readOnly",
                    "personality": null
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

    let executions_before_full_grant = source.executions.load(Ordering::SeqCst);
    let mut paired = connect_as(&url, "limited-device").await?;
    open_and_commit(&mut paired, "thread-limited").await?;
    send(
        &mut paired,
        json!({
            "type": "command",
            "requestId": "paired-command",
            "operationId": "full-grant-operation",
            "command": {"kind": "thread.delete", "threadId": "thread-limited"}
        }),
    )
    .await?;
    assert_eq!(receive(&mut paired).await?["type"], "commandAccepted");
    assert_eq!(receive(&mut paired).await?["type"], "commandCompleted");
    assert_eq!(
        source.executions.load(Ordering::SeqCst),
        executions_before_full_grant + 1
    );
    paired.close(None).await?;
    let executions_before_replay = source.executions.load(Ordering::SeqCst);
    let mut reconnected = connect_as(&url, "limited-device").await?;
    open_and_commit(&mut reconnected, "thread-limited").await?;
    send(
        &mut reconnected,
        json!({
            "type": "command",
            "requestId": "full-grant-replay",
            "operationId": "full-grant-operation",
            "command": {"kind": "thread.delete", "threadId": "thread-limited"}
        }),
    )
    .await?;
    assert_eq!(receive(&mut reconnected).await?["type"], "commandAccepted");
    assert_eq!(receive(&mut reconnected).await?["type"], "commandCompleted");
    assert_eq!(
        source.executions.load(Ordering::SeqCst),
        executions_before_replay
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
    source
        .wait_for_completed_execution(executions_before_loss + 1)
        .await?;
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
    reconnected.close(None).await?;
    recovered.close(None).await?;
    other_authorized.close(None).await?;
    server_task.abort();
    Ok(())
}
