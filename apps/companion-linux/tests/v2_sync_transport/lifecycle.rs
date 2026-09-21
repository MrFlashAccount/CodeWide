use super::*;

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn absolute_session_expiry_closes_open_socket_and_fresh_session_recovers()
-> Result<(), Box<dyn Error>> {
    let directory = tempfile::tempdir()?;
    let source = FakeSource::new();
    let runtime = SyncV2Runtime::new(
        source,
        directory.path().join("expiry-ledger.redb"),
        TEST_PIN,
    )?;
    let (address, server_task) = start_server(directory.path(), runtime).await?;
    let url = format!("ws://{address}/v2/sync");
    let now: u64 = SystemTime::now()
        .duration_since(UNIX_EPOCH)?
        .as_millis()
        .try_into()?;
    let mut expiring = connect_as_expires(&url, "expiry-device", now + 2_000).await?;
    open_and_commit(&mut expiring, "expiry-thread").await?;
    expect_close_code(&mut expiring, 1008).await?;

    let mut fresh = connect_as(&url, "expiry-device").await?;
    open_and_commit(&mut fresh, "expiry-thread").await?;
    fresh.close(None).await?;
    server_task.abort();
    Ok(())
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn authorization_invalidation_lag_fails_closed_before_later_dispatch()
-> Result<(), Box<dyn Error>> {
    let directory = tempfile::tempdir()?;
    let source = FakeSource::new();
    let runtime = SyncV2Runtime::new(
        source.clone(),
        directory.path().join("auth-lag-ledger.redb"),
        TEST_PIN,
    )?
    .with_deadlines(Duration::from_millis(200), Duration::from_secs(1));
    let (address, server_task, authorization_changes) =
        start_server_with_authorization_changes(directory.path(), runtime).await?;
    let url = format!("ws://{address}/v2/sync");
    let mut client = connect_as(&url, "lag-device").await?;
    open_and_commit(&mut client, "lag-thread").await?;

    source.hang_query.store(true, Ordering::SeqCst);
    send(
        &mut client,
        json!({
            "type": "query",
            "requestId": "lag-query",
            "query": {"kind": "capabilities.read"}
        }),
    )
    .await?;
    timeout(Duration::from_secs(1), source.query_entered.notified()).await?;
    for index in 0..4 {
        let _ = authorization_changes.send(AuthorizationChange {
            device_id: format!("unrelated-device-{index}"),
            reason: AuthorizationChangeReason::DeviceRepaired,
        });
    }
    expect_close_code(&mut client, 1008).await?;

    server_task.abort();
    Ok(())
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn device_revoke_cancels_admitted_destructive_execution_before_terminal_commit()
-> Result<(), Box<dyn Error>> {
    let directory = tempfile::tempdir()?;
    let source = FakeSource::new();
    let runtime = SyncV2Runtime::new(
        source.clone(),
        directory.path().join("revoke-execution-ledger.redb"),
        TEST_PIN,
    )?
    .with_deadlines(Duration::from_secs(10), Duration::from_secs(1));
    let (address, server_task, authorization_changes) =
        start_server_with_authorization_changes(directory.path(), runtime).await?;
    let url = format!("ws://{address}/v2/sync");
    let device = "revoked-execution-device";
    let command = json!({
        "type": "command",
        "requestId": "revoked-execution",
        "operationId": "revoked-operation",
        "command": {"kind": "thread.delete", "threadId": "revoked-thread"}
    });
    let mut client = connect_as(&url, device).await?;
    open_and_commit(&mut client, "revoked-thread").await?;

    source.hang_execute.store(true, Ordering::SeqCst);
    send(&mut client, command.clone()).await?;
    assert_eq!(receive(&mut client).await?["type"], "commandAccepted");
    timeout(Duration::from_secs(1), source.execute_entered.notified()).await?;
    authorization_changes.send(AuthorizationChange {
        device_id: device.to_owned(),
        reason: AuthorizationChangeReason::DeviceRevoked,
    })?;
    timeout(Duration::from_secs(1), source.execute_cancelled.notified()).await?;
    expect_close_code(&mut client, 1008).await?;
    assert_eq!(source.executions.load(Ordering::SeqCst), 1);
    assert_eq!(*source.completed_executions.borrow(), 0);

    source.hang_execute.store(false, Ordering::SeqCst);
    let mut repaired = connect_as(&url, device).await?;
    open_and_commit(&mut repaired, "revoked-thread").await?;
    send(
        &mut repaired,
        json!({
            "type": "query",
            "requestId": "revoked-operation-receipt",
            "query": {"kind": "operation.get", "operationId": "revoked-operation"}
        }),
    )
    .await?;
    let missing = receive(&mut repaired).await?;
    assert_eq!(missing["type"], "queryFailed");
    assert_eq!(missing["error"]["code"], "notFound");

    send(&mut repaired, command).await?;
    assert_eq!(receive(&mut repaired).await?["type"], "commandAccepted");
    assert_eq!(receive(&mut repaired).await?["type"], "commandCompleted");
    source.wait_for_completed_execution(1).await?;
    assert_eq!(source.executions.load(Ordering::SeqCst), 2);

    repaired.close(None).await?;
    server_task.abort();
    Ok(())
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn failed_purge_marker_survives_restart_and_blocks_successor_until_retry()
-> Result<(), Box<dyn Error>> {
    let directory = tempfile::tempdir()?;
    let ledger_path = directory.path().join("purge-restart-ledger.redb");
    let source = FakeSource::new();
    let runtime = SyncV2Runtime::new(source.clone(), &ledger_path, TEST_PIN)?;
    let purge = runtime.clone();
    let (address, server_task) = start_server(directory.path(), runtime).await?;
    let url = format!("ws://{address}/v2/sync");
    let device = "purge-restart-device";
    let mut original = connect_as(&url, device).await?;
    open_and_commit(&mut original, "purge-restart-thread").await?;

    source.fail_purge.store(true, Ordering::SeqCst);
    assert!(!purge.purge_device_context(device).await);
    expect_close_code(&mut original, 1008).await?;
    let mut blocked = connect_as(&url, device).await?;
    expect_close_code(&mut blocked, 1008).await?;
    server_task.abort();
    let _ = server_task.await;
    drop(purge);

    let restarted = SyncV2Runtime::new(source.clone(), &ledger_path, TEST_PIN)?;
    let (restarted_address, restarted_task) = start_server(directory.path(), restarted).await?;
    let restarted_url = format!("ws://{restarted_address}/v2/sync");
    let mut still_blocked = connect_as(&restarted_url, device).await?;
    expect_close_code(&mut still_blocked, 1008).await?;

    source.fail_purge.store(false, Ordering::SeqCst);
    let mut recovered = connect_as(&restarted_url, device).await?;
    open_and_commit(&mut recovered, "purge-restart-thread").await?;
    recovered.close(None).await?;
    restarted_task.abort();
    Ok(())
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn source_deadlines_close_outcomes_and_context_purge_removes_receipts()
-> Result<(), Box<dyn Error>> {
    let directory = tempfile::tempdir()?;
    let source = FakeSource::new();
    let runtime = SyncV2Runtime::new(
        source.clone(),
        directory.path().join("deadline-ledger.redb"),
        TEST_PIN,
    )?
    .with_deadlines(Duration::from_millis(50), Duration::from_secs(1));
    let purge_handle = runtime.clone();
    let (address, server_task) = start_server(directory.path(), runtime).await?;
    let url = format!("ws://{address}/v2/sync");
    let device = "deadline-device";

    let mut client = connect_as(&url, device).await?;
    source.hang_install.store(true, Ordering::SeqCst);
    send(
        &mut client,
        json!({
            "type": "open",
            "version": 2,
            "intent": {
                "catalog": {"activeLimit": 1, "archivedLimit": 1},
                "currentThread": {"threadId": "deadline-thread", "turnLimit": 1},
                "pendingRequests": "currentThread"
            }
        }),
    )
    .await?;
    let snapshot_timeout = receive(&mut client).await?;
    assert_eq!(snapshot_timeout["type"], "reinitialize");
    assert_eq!(snapshot_timeout["reason"], "snapshotFailed");

    source.hang_install.store(false, Ordering::SeqCst);
    source.hang_snapshot.store(true, Ordering::SeqCst);
    send(
        &mut client,
        json!({
            "type": "open",
            "version": 2,
            "intent": {
                "catalog": {"activeLimit": 1, "archivedLimit": 1},
                "currentThread": {"threadId": "deadline-thread", "turnLimit": 1},
                "pendingRequests": "currentThread"
            }
        }),
    )
    .await?;
    let snapshot_timeout = receive(&mut client).await?;
    assert_eq!(snapshot_timeout["type"], "reinitialize");
    assert_eq!(snapshot_timeout["reason"], "snapshotFailed");

    source.hang_snapshot.store(false, Ordering::SeqCst);
    open_and_commit(&mut client, "deadline-thread").await?;
    source.hang_query.store(true, Ordering::SeqCst);
    send(
        &mut client,
        json!({
            "type": "query",
            "requestId": "deadline-query",
            "query": {"kind": "capabilities.read"}
        }),
    )
    .await?;
    let query_timeout = receive(&mut client).await?;
    assert_eq!(query_timeout["type"], "queryFailed");
    assert_eq!(query_timeout["error"]["code"], "sourceUnavailable");
    source.hang_query.store(false, Ordering::SeqCst);

    let authorization_command = json!({
        "type": "command",
        "requestId": "authorization-deadline-command",
        "operationId": "authorization-deadline-operation",
        "command": {"kind": "thread.delete", "threadId": "deadline-thread"}
    });
    source.hang_authorize.store(true, Ordering::SeqCst);
    send(&mut client, authorization_command.clone()).await?;
    let rejected = receive(&mut client).await?;
    assert_eq!(rejected["type"], "commandRejected");
    assert_eq!(rejected["error"]["code"], "sourceUnavailable");
    assert_eq!(source.executions.load(Ordering::SeqCst), 0);
    source.hang_authorize.store(false, Ordering::SeqCst);
    send(&mut client, authorization_command).await?;
    assert_eq!(receive(&mut client).await?["type"], "commandAccepted");
    assert_eq!(receive(&mut client).await?["type"], "commandCompleted");
    assert_eq!(source.executions.load(Ordering::SeqCst), 1);

    source.hang_execute.store(true, Ordering::SeqCst);
    let command = json!({
        "type": "command",
        "requestId": "deadline-command",
        "operationId": "deadline-operation",
        "command": {"kind": "thread.delete", "threadId": "deadline-thread"}
    });
    send(&mut client, command.clone()).await?;
    assert_eq!(receive(&mut client).await?["type"], "commandAccepted");
    let indeterminate = receive(&mut client).await?;
    assert_eq!(indeterminate["type"], "commandIndeterminate");
    assert_eq!(indeterminate["error"]["code"], "operationIndeterminate");
    assert_eq!(source.executions.load(Ordering::SeqCst), 2);

    source.hang_execute.store(false, Ordering::SeqCst);
    send(&mut client, command.clone()).await?;
    assert_eq!(receive(&mut client).await?["type"], "commandAccepted");
    assert_eq!(receive(&mut client).await?["type"], "commandIndeterminate");
    assert_eq!(source.executions.load(Ordering::SeqCst), 2);

    assert!(purge_handle.purge_device_context(device).await);
    expect_close_code(&mut client, 1008).await?;

    let mut repaired = connect_as(&url, device).await?;
    open_and_commit(&mut repaired, "deadline-thread").await?;
    send(&mut repaired, command).await?;
    assert_eq!(receive(&mut repaired).await?["type"], "commandAccepted");
    assert_eq!(receive(&mut repaired).await?["type"], "commandCompleted");
    assert_eq!(source.executions.load(Ordering::SeqCst), 3);

    send(
        &mut repaired,
        json!({
            "type": "command",
            "requestId": "purge-race-command",
            "operationId": "purge-race-operation",
            "command": {"kind": "thread.delete", "threadId": "deadline-thread"}
        }),
    )
    .await?;
    assert_eq!(receive(&mut repaired).await?["type"], "commandAccepted");
    let purge_race = tokio::spawn(async move { purge_handle.purge_device_context(device).await });
    assert_eq!(receive(&mut repaired).await?["type"], "commandCompleted");
    assert!(purge_race.await?);
    expect_close_code(&mut repaired, 1008).await?;

    let mut cleanup = connect_as(&url, "cleanup-device").await?;
    open_and_commit(&mut cleanup, "cleanup-thread").await?;
    source.hang_remove.store(true, Ordering::SeqCst);
    cleanup.close(None).await?;
    timeout(Duration::from_secs(1), source.remove_entered.notified()).await?;
    let mut healthy = connect_as(&url, "healthy-device").await?;
    open_and_commit(&mut healthy, "healthy-thread").await?;
    source.hang_remove.store(false, Ordering::SeqCst);
    healthy.close(None).await?;
    server_task.abort();
    Ok(())
}
