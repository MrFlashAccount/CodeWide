#![cfg(unix)]
#![allow(clippy::too_many_lines)]

use std::{
    collections::VecDeque,
    error::Error,
    path::{Path, PathBuf},
    sync::Arc,
    time::{Duration, SystemTime, UNIX_EPOCH},
};

use axum::{
    Router,
    extract::{State, ws::WebSocketUpgrade},
    http::HeaderMap,
    response::Response,
    routing::get,
};
use codewide_companion::{
    auth::AuthorizationContext,
    catalog::SessionCatalog,
    history_service::HistoryService,
    store::IndexStore,
    sync_v2::{ProductionServices, SyncV2Runtime, UpstreamSemanticSource},
    upstream::{ConnectionStatus, UpstreamHandle},
};
use futures_util::{SinkExt, StreamExt};
use http::HeaderValue;
use serde_json::{Value, json};
use tokio::{
    io::copy_bidirectional,
    net::{TcpListener, UnixListener, UnixStream},
    sync::{broadcast, mpsc, watch},
    task::JoinHandle,
    time::timeout,
};
use tokio_tungstenite::{
    MaybeTlsStream, WebSocketStream, accept_async, connect_async,
    tungstenite::{Message, client::IntoClientRequest},
};

const TOKEN: &str = "live-v2-contract-token-that-is-long-enough";
const LIVE_TIMEOUT: Duration = Duration::from_mins(2);
type TestResult<T = ()> = Result<T, Box<dyn Error>>;
type ClientSocket = WebSocketStream<MaybeTlsStream<tokio::net::TcpStream>>;

enum ObserverEvent {
    ThreadChanged(String),
    ApprovalOpened {
        request_id: String,
        thread_id: String,
    },
    Disconnect,
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn production_observer_routes_same_thread_to_distinct_devices_only() -> TestResult {
    let temporary = tempfile::tempdir()?;
    let app_server_socket = temporary.path().join("observer-app-server.sock");
    let listener = UnixListener::bind(&app_server_socket)?;
    let (event_tx, event_rx) = mpsc::channel(1);
    let fake_app_server = tokio::spawn(run_observer_app_server(listener, event_rx));
    let v2_upstream = UpstreamHandle::spawn(app_server_socket);
    wait_for_live(&v2_upstream).await?;

    let store = Arc::new(IndexStore::open(
        temporary.path().join("observer-state.redb"),
    )?);
    let catalog = Arc::new(SessionCatalog::scan(temporary.path()));
    let history = HistoryService::new(catalog.clone(), store.clone());
    let source = UpstreamSemanticSource::new(
        v2_upstream,
        store,
        history,
        catalog,
        ProductionServices::default(),
    );
    let runtime = SyncV2Runtime::new(
        source,
        temporary.path().join("observer-operations.redb"),
        "sha256/observer-test-pin",
    )?;
    let (address, server_task) = start_server(runtime).await?;
    let url = format!("ws://{address}/v2/sync");

    let mut first = connect_live(&url, "observer-device-a").await?;
    let mut second = connect_live(&url, "observer-device-b").await?;
    let mut disjoint = connect_live(&url, "observer-device-c").await?;
    let mut catalog_client = connect_live(&url, "observer-device-catalog").await?;
    open_live_thread(&mut first, "shared-thread").await?;
    open_live_thread(&mut second, "shared-thread").await?;
    open_live_thread(&mut disjoint, "other-thread").await?;
    open_live_catalog(&mut catalog_client, 10).await?;

    event_tx
        .send(ObserverEvent::ThreadChanged("shared-thread".into()))
        .await?;
    for client in [&mut first, &mut second] {
        let change = receive(client).await?;
        require_type(&change, "change")?;
        if change.pointer("/change/thread/id") != Some(&json!("shared-thread")) {
            return Err(format!("Observer change had wrong routed thread: {change}").into());
        }
    }
    let catalog_change = receive(&mut catalog_client).await?;
    if catalog_change.pointer("/change/thread/id") != Some(&json!("shared-thread")) {
        return Err(format!("catalog client missed Observer change: {catalog_change}").into());
    }
    if timeout(Duration::from_millis(200), receive(&mut disjoint))
        .await
        .is_ok()
    {
        return Err("disjoint device received another thread's Observer event".into());
    }

    event_tx
        .send(ObserverEvent::ThreadChanged("external-thread".into()))
        .await?;
    let discovered = receive(&mut catalog_client).await?;
    if discovered.pointer("/change/thread/id") != Some(&json!("external-thread")) {
        return Err(
            format!("external Observer thread was not catalog-routed: {discovered}").into(),
        );
    }

    event_tx
        .send(ObserverEvent::ApprovalOpened {
            request_id: "approval-live".into(),
            thread_id: "shared-thread".into(),
        })
        .await?;
    for client in [&mut first, &mut second] {
        let opened = receive(client).await?;
        if opened.pointer("/change/request/id") != Some(&json!("approval-live")) {
            return Err(format!("pending request was not routed: {opened}").into());
        }
    }
    let mut late = connect_live(&url, "observer-device-d").await?;
    let late_snapshot = open_live_thread_snapshot(&mut late, "shared-thread").await?;
    if late_snapshot.pointer("/pendingRequests/0/id") != Some(&json!("approval-live")) {
        return Err(
            format!("late authorized context missed pending request: {late_snapshot}").into(),
        );
    }
    send(
        &mut first,
        json!({
            "type": "action",
            "requestId": "resolve-live",
            "action": {
                "kind": "request.resolve",
                "requestId": "approval-live",
                "generation": "1",
                "resolution": {"kind": "approval", "decision": "allowOnce"}
            }
        }),
    )
    .await?;
    require_type(&receive(&mut first).await?, "actionCompleted")?;
    for client in [&mut first, &mut second, &mut late] {
        let closed = receive(client).await?;
        if closed.pointer("/change/requestId") != Some(&json!("approval-live")) {
            return Err(format!("pending closure missed a retaining context: {closed}").into());
        }
    }
    late.close(None).await?;
    let mut recovered = connect_live(&url, "observer-device-d").await?;
    let recovered_snapshot = open_live_thread_snapshot(&mut recovered, "shared-thread").await?;
    if recovered_snapshot["pendingRequests"] != json!([]) {
        return Err(
            format!("resolved request reappeared after reconnect: {recovered_snapshot}").into(),
        );
    }

    event_tx
        .send(ObserverEvent::ApprovalOpened {
            request_id: "approval-lost".into(),
            thread_id: "shared-thread".into(),
        })
        .await?;
    let opened = receive(&mut first).await?;
    if opened.pointer("/change/request/id") != Some(&json!("approval-lost")) {
        return Err(format!("disconnect fixture missed pending request: {opened}").into());
    }
    event_tx.send(ObserverEvent::Disconnect).await?;
    let mut saw_source_lost = false;
    let disconnected = loop {
        let frame = receive(&mut first).await?;
        if frame.pointer("/change/reason") == Some(&json!("sourceLost")) {
            saw_source_lost = true;
        }
        if frame["type"] == "reinitialize" {
            break frame;
        }
    };
    if !saw_source_lost || disconnected["reason"] != "upstreamUnavailable" {
        return Err(
            format!("upstream loss was not explicit and fail-closed: {disconnected}").into(),
        );
    }
    let catalog_disconnected = receive(&mut catalog_client).await?;
    require_type(&catalog_disconnected, "reinitialize")?;
    if catalog_disconnected["reason"] != "upstreamUnavailable" {
        return Err(format!("catalog epoch survived upstream loss: {catalog_disconnected}").into());
    }
    let reconnected_snapshot = open_live_thread_snapshot(&mut first, "shared-thread").await?;
    if reconnected_snapshot["pendingRequests"] != json!([]) {
        return Err(format!("source-lost request reappeared: {reconnected_snapshot}").into());
    }
    open_live_catalog(&mut catalog_client, 10).await?;

    event_tx
        .send(ObserverEvent::ThreadChanged("unreadable-thread".into()))
        .await?;
    let invalidated = receive(&mut catalog_client).await?;
    require_type(&invalidated, "reinitialize")?;
    if invalidated["reason"] != "sourceGap" {
        return Err(format!("normalization failure did not fail closed: {invalidated}").into());
    }

    first.close(None).await?;
    second.close(None).await?;
    disjoint.close(None).await?;
    catalog_client.close(None).await?;
    recovered.close(None).await?;
    server_task.abort();
    fake_app_server.abort();
    Ok(())
}

/// Exercises the real managed App Server through the V2 semantic adapter.
///
/// This read-only seam proof requests no catalog records or conversation
/// content. Run it explicitly with `CODEWIDE_LIVE_E2E=1 cargo test -p
/// codewide-companion --test live_v2_backend_contract -- --ignored --nocapture`.
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
#[ignore = "requires the real managed Codex App Server and current account"]
async fn two_v2_clients_share_the_real_backend_without_sharing_epoch_state() -> TestResult {
    require_live_opt_in()?;
    let app_server_socket = managed_app_server_socket()?;
    let temporary = tempfile::tempdir()?;
    let v2_upstream = UpstreamHandle::spawn(app_server_socket);
    wait_for_live(&v2_upstream).await?;

    let store = Arc::new(IndexStore::open(temporary.path().join("state.redb"))?);
    let catalog = Arc::new(SessionCatalog::scan(temporary.path()));
    let history = HistoryService::new(catalog.clone(), store.clone());
    let source = UpstreamSemanticSource::new(
        v2_upstream,
        store.clone(),
        history.clone(),
        catalog,
        ProductionServices::default(),
    );
    let runtime = SyncV2Runtime::new(
        source,
        temporary.path().join("v2-operations.redb"),
        "sha256/live-contract-placeholder-pin",
    )?;
    let (address, server_task) = start_server(runtime).await?;

    let url = format!("ws://{address}/v2/sync");
    let mut first = connect_live(&url, "live-v2-device-a").await?;
    let mut second = connect_live(&url, "live-v2-device-b").await?;
    open_live(&mut first).await?;
    open_live(&mut second).await?;

    send(
        &mut first,
        json!({
            "type": "query",
            "requestId": "models",
            "query": {"kind": "models.list"}
        }),
    )
    .await?;
    let models = receive(&mut first).await?;
    require_type(&models, "queryCompleted")?;
    if models
        .pointer("/result/models")
        .and_then(Value::as_array)
        .is_none()
    {
        return Err(format!("real models query returned an invalid V2 result: {models}").into());
    }

    first.close(None).await?;
    send(
        &mut second,
        json!({
            "type": "query",
            "requestId": "capabilities-after-peer-close",
            "query": {"kind": "capabilities.read"}
        }),
    )
    .await?;
    let capabilities = receive(&mut second).await?;
    require_type(&capabilities, "queryCompleted")?;
    require_type(
        &json!({"type": capabilities["result"]["kind"]}),
        "capabilities.read",
    )?;
    second.close(None).await?;
    server_task.abort();
    Ok(())
}

/// Proves the complete client-visible V2 synchronization contract against the
/// real managed App Server. Unlike the small seam proof above, this exercises
/// real threads, turns, reconnects, pagination, command idempotency and the
/// snapshot-to-live barrier. Every created thread is deleted in cleanup.
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
#[ignore = "requires the real managed Codex App Server and current account"]
async fn v2_authoritative_refresh_covers_real_client_use_cases() -> TestResult {
    require_live_opt_in()?;
    let socket_path = managed_app_server_socket()?;
    let temporary = tempfile::tempdir()?;
    let relay = ManagedSocketRelay::start(
        temporary.path().join("managed-app-server.sock"),
        socket_path.clone(),
    )?;
    let companion_upstream = UpstreamHandle::spawn(relay.path().to_owned());
    let companion_status = companion_upstream.clone();
    let observer = UpstreamHandle::spawn(socket_path);
    wait_for_live(&companion_upstream).await?;
    wait_for_live(&observer).await?;

    let store = Arc::new(IndexStore::open(temporary.path().join("state.redb"))?);
    let catalog = Arc::new(SessionCatalog::scan(temporary.path()));
    let history = HistoryService::new(catalog.clone(), store.clone());
    let source = UpstreamSemanticSource::new(
        companion_upstream,
        store,
        history,
        catalog,
        ProductionServices::default(),
    );
    let runtime = SyncV2Runtime::new(
        source,
        temporary.path().join("v2-operations.redb"),
        "sha256/live-v2-full-contract-pin",
    )?;
    let (address, server_task) = start_server(runtime).await?;
    let url = format!("ws://{address}/v2/sync");

    let run_id = unique_run_id();
    let primary_thread_id =
        create_test_thread(&observer, &format!("CodeWide V2 live contract {run_id}")).await?;
    let secondary_thread_id = match create_test_thread(
        &observer,
        &format!("CodeWide V2 live contract secondary {run_id}"),
    )
    .await
    {
        Ok(thread_id) => thread_id,
        Err(error) => {
            let _ = observer
                .request(json!({
                    "method": "thread/delete",
                    "params": {"threadId": primary_thread_id},
                }))
                .await;
            return Err(error);
        }
    };
    let outcome = run_v2_authoritative_refresh_scenarios(
        &observer,
        &url,
        &primary_thread_id,
        &secondary_thread_id,
        &run_id,
        &relay,
        &companion_status,
    )
    .await;

    let mut cleanup_errors = Vec::new();
    for thread_id in [&primary_thread_id, &secondary_thread_id] {
        if let Err(error) = observer
            .request(json!({
                "method": "thread/delete",
                "params": {"threadId": thread_id},
            }))
            .await
        {
            cleanup_errors.push(format!("{thread_id}: {error}"));
        }
    }
    server_task.abort();
    if !cleanup_errors.is_empty() {
        eprintln!("live V2 E2E cleanup failed: {}", cleanup_errors.join(", "));
    }
    outcome
}

#[allow(clippy::too_many_arguments, clippy::too_many_lines)]
async fn run_v2_authoritative_refresh_scenarios(
    observer: &UpstreamHandle,
    url: &str,
    primary_thread_id: &str,
    secondary_thread_id: &str,
    run_id: &str,
    relay: &ManagedSocketRelay,
    companion_status: &UpstreamHandle,
) -> TestResult {
    eprintln!("stage=v2_empty_authoritative_snapshot thread_id={primary_thread_id}");
    let mut control = V2LiveClient::connect(url, "live-v2-control").await?;
    let empty_snapshot = control.open(Some(primary_thread_id)).await?;
    let empty_turns = empty_snapshot
        .pointer("/currentThread/turns")
        .and_then(Value::as_array)
        .ok_or("V2 empty snapshot omitted currentThread.turns")?;
    if !empty_turns.is_empty() {
        return Err("new empty thread did not produce an authoritative empty V2 snapshot".into());
    }
    let mut reconnecting = V2LiveClient::connect(url, "live-v2-reconnecting").await?;
    reconnecting.open(Some(primary_thread_id)).await?;

    let initial_message = format!("LIVE_V2_INITIAL_{run_id}");
    eprintln!("stage=v2_initial_external_turn token={initial_message}");
    start_turn(observer, primary_thread_id, &initial_message).await?;
    let initial_watermark = control.wait_for_turn_text(&initial_message).await?;
    control
        .wait_for_turn_completed(primary_thread_id, &initial_message)
        .await?;
    reconnecting.wait_for_turn_text(&initial_message).await?;
    reconnecting
        .wait_for_turn_completed(primary_thread_id, &initial_message)
        .await?;

    eprintln!("stage=v2_two_client_authoritative_snapshot");
    let mut first_snapshot_client = V2LiveClient::connect(url, "live-v2-snapshot-a").await?;
    let first_snapshot = first_snapshot_client.open(Some(primary_thread_id)).await?;
    let mut second_snapshot_client = V2LiveClient::connect(url, "live-v2-snapshot-b").await?;
    let second_snapshot = second_snapshot_client.open(Some(primary_thread_id)).await?;
    assert_v2_snapshot_contains_completed_message(&first_snapshot, &initial_message)?;
    assert_v2_snapshot_contains_completed_message(&second_snapshot, &initial_message)?;
    if first_snapshot.pointer("/currentThread/turns")
        != second_snapshot.pointer("/currentThread/turns")
    {
        return Err("two V2 clients received different authoritative turn windows".into());
    }
    first_snapshot_client.close().await?;
    second_snapshot_client.close().await?;

    reconnecting.close().await?;
    let missed_message = format!("LIVE_V2_MISSED_{run_id}");
    eprintln!("stage=v2_downstream_disconnected token={missed_message}");
    start_turn(observer, primary_thread_id, &missed_message).await?;
    let missed_watermark = control.wait_for_turn_text(&missed_message).await?;
    if missed_watermark <= initial_watermark {
        return Err("V2 live watermark did not advance for a later external turn".into());
    }
    control
        .wait_for_turn_completed(primary_thread_id, &missed_message)
        .await?;
    reconnecting = V2LiveClient::connect(url, "live-v2-reconnecting").await?;
    let refreshed = reconnecting.open(Some(primary_thread_id)).await?;
    assert_v2_snapshot_contains_completed_message(&refreshed, &initial_message)?;
    assert_v2_snapshot_contains_completed_message(&refreshed, &missed_message)?;

    let raced_message = format!("LIVE_V2_RACE_{run_id}");
    eprintln!("stage=v2_snapshot_live_race token={raced_message}");
    reconnecting.close().await?;
    reconnecting = V2LiveClient::connect(url, "live-v2-reconnecting").await?;
    let opening = reconnecting.open(Some(primary_thread_id));
    let external_turn = start_turn(observer, primary_thread_id, &raced_message);
    let (raced_snapshot, turn_result) = tokio::join!(opening, external_turn);
    let raced_snapshot = raced_snapshot?;
    turn_result?;
    if !value_contains_string(&raced_snapshot, &raced_message)
        && !reconnecting.buffer_contains(&raced_message)
    {
        reconnecting.wait_for_turn_text(&raced_message).await?;
    }
    reconnecting
        .wait_for_turn_completed(primary_thread_id, &raced_message)
        .await?;
    let history = reconnecting
        .query(json!({
            "kind": "history.page",
            "threadId": primary_thread_id,
            "cursor": null,
            "direction": "older",
            "limit": 100,
            "detail": "full"
        }))
        .await?;
    require_query_completed(&history)?;
    assert_history_contains_completed_message(&history, &raced_message)?;

    verify_v2_idempotent_turn_submit(url, &mut control, primary_thread_id, run_id).await?;
    verify_v2_two_thread_delivery(
        observer,
        url,
        &mut control,
        primary_thread_id,
        secondary_thread_id,
        run_id,
    )
    .await?;

    eprintln!("stage=v2_snapshot_live_seam_stress iterations=50");
    stress_v2_snapshot_live_boundary(observer, url, primary_thread_id, run_id).await?;
    let retained_cursor = verify_v2_pagination(url, primary_thread_id).await?;

    eprintln!("stage=v2_upstream_disconnect");
    let generation = companion_status.generation();
    relay.pause();
    wait_for_status(companion_status, ConnectionStatus::Reconnecting).await?;
    let mut observer_events = observer.subscribe_events();
    let outage_message = format!("LIVE_V2_UPSTREAM_OUTAGE_{run_id}");
    start_turn(observer, primary_thread_id, &outage_message).await?;
    wait_for_upstream_event(&mut observer_events, |event| {
        upstream_event_is_turn_completed(event, primary_thread_id)
    })
    .await?;
    let outage_name = format!("CodeWide V2 outage {run_id}");
    observer_rpc(
        observer,
        "thread/name/set",
        json!({"threadId": primary_thread_id, "name": outage_name}),
    )
    .await?;
    relay.resume();
    wait_for_generation(companion_status, generation).await?;
    control.wait_for_reinitialize().await?;

    control.close().await?;
    control = V2LiveClient::connect(url, "live-v2-control").await?;
    let recovered = control.open(Some(primary_thread_id)).await?;
    assert_v2_snapshot_contains_completed_message(&recovered, &outage_message)?;
    if recovered
        .pointer("/currentThread/thread/title")
        .and_then(Value::as_str)
        != Some(&outage_name)
    {
        return Err("V2 reconnect snapshot omitted external thread rename".into());
    }
    let stale = control
        .query(json!({
            "kind": "history.page",
            "threadId": primary_thread_id,
            "cursor": retained_cursor,
            "direction": "older",
            "limit": 1,
            "detail": "full"
        }))
        .await?;
    require_query_error_code(&stale, "staleCursor")?;

    let post_reconnect_message = format!("LIVE_V2_AFTER_UPSTREAM_RECONNECT_{run_id}");
    start_turn(observer, primary_thread_id, &post_reconnect_message).await?;
    control.wait_for_turn_text(&post_reconnect_message).await?;
    control
        .wait_for_turn_completed(primary_thread_id, &post_reconnect_message)
        .await?;

    eprintln!("stage=v2_archive_live_projection");
    observer_rpc(
        observer,
        "thread/archive",
        json!({"threadId": primary_thread_id}),
    )
    .await?;
    control
        .wait_for_thread_archived(primary_thread_id, true)
        .await?;
    observer_rpc(
        observer,
        "thread/unarchive",
        json!({"threadId": primary_thread_id}),
    )
    .await?;
    control
        .wait_for_thread_archived(primary_thread_id, false)
        .await?;
    Ok(())
}

async fn verify_v2_idempotent_turn_submit(
    url: &str,
    control: &mut V2LiveClient,
    thread_id: &str,
    run_id: &str,
) -> TestResult {
    eprintln!("stage=v2_idempotent_turn_submit");
    let token = format!("LIVE_V2_IDEMPOTENT_{run_id}");
    let operation_id = format!("live-v2-idempotent-{run_id}");
    let command = json!({
        "kind": "turn.submit",
        "threadId": thread_id,
        "workspace": null,
        "input": [{"kind": "text", "text": format!("Reply exactly with {token}")}],
        "intent": "chat",
        "settings": null
    });
    let mut sender = V2LiveClient::connect(url, "live-v2-idempotent-device").await?;
    sender.open(Some(thread_id)).await?;
    let first = sender.command(&operation_id, command.clone()).await?;
    require_type(&first, "commandCompleted")?;
    control.wait_for_turn_text(&token).await?;
    control.wait_for_turn_completed(thread_id, &token).await?;
    sender.close().await?;

    let mut recovered = V2LiveClient::connect(url, "live-v2-idempotent-device").await?;
    recovered.open(Some(thread_id)).await?;
    let repeated = recovered.command(&operation_id, command).await?;
    require_type(&repeated, "commandCompleted")?;
    let history = recovered
        .query(json!({
            "kind": "history.page",
            "threadId": thread_id,
            "cursor": null,
            "direction": "older",
            "limit": 100,
            "detail": "full"
        }))
        .await?;
    require_query_completed(&history)?;
    let occurrences = count_v2_user_text_occurrences(&history, &token)?;
    if occurrences != 1 {
        return Err(format!(
            "repeating one V2 operationId produced {occurrences} authoritative user items"
        )
        .into());
    }
    recovered.close().await?;
    Ok(())
}

async fn verify_v2_two_thread_delivery(
    observer: &UpstreamHandle,
    url: &str,
    control: &mut V2LiveClient,
    primary_thread_id: &str,
    secondary_thread_id: &str,
    run_id: &str,
) -> TestResult {
    eprintln!("stage=v2_two_thread_external_delivery");
    let mut primary_context = V2LiveClient::connect(url, "live-v2-multi-thread").await?;
    primary_context.open(Some(primary_thread_id)).await?;
    let mut secondary_context = V2LiveClient::connect(url, "live-v2-multi-thread").await?;
    secondary_context.open(Some(secondary_thread_id)).await?;
    let mut catalog_context = V2LiveClient::connect(url, "live-v2-multi-thread").await?;
    catalog_context.open(None).await?;

    let primary_message = format!("LIVE_V2_PRIMARY_PARALLEL_{run_id}");
    let secondary_message = format!("LIVE_V2_SECONDARY_PARALLEL_{run_id}");
    let primary = start_turn(observer, primary_thread_id, &primary_message);
    let secondary = start_turn(observer, secondary_thread_id, &secondary_message);
    let (primary_result, secondary_result) = tokio::join!(primary, secondary);
    primary_result?;
    secondary_result?;

    primary_context.wait_for_turn_text(&primary_message).await?;
    primary_context
        .wait_for_turn_completed(primary_thread_id, &primary_message)
        .await?;
    secondary_context
        .wait_for_turn_text(&secondary_message)
        .await?;
    secondary_context
        .wait_for_turn_completed(secondary_thread_id, &secondary_message)
        .await?;
    catalog_context
        .wait_for_thread_upsert(primary_thread_id)
        .await?;
    catalog_context
        .wait_for_thread_upsert(secondary_thread_id)
        .await?;

    let mut primary_snapshot = V2LiveClient::connect(url, "live-v2-multi-snapshot-a").await?;
    let primary = primary_snapshot.open(Some(primary_thread_id)).await?;
    let mut secondary_snapshot = V2LiveClient::connect(url, "live-v2-multi-snapshot-b").await?;
    let secondary = secondary_snapshot.open(Some(secondary_thread_id)).await?;
    assert_v2_snapshot_contains_completed_message(&primary, &primary_message)?;
    assert_v2_snapshot_contains_completed_message(&secondary, &secondary_message)?;
    control.wait_for_thread_upsert(primary_thread_id).await?;

    primary_context.close().await?;
    secondary_context.close().await?;
    catalog_context.close().await?;
    primary_snapshot.close().await?;
    secondary_snapshot.close().await?;
    Ok(())
}

async fn stress_v2_snapshot_live_boundary(
    observer: &UpstreamHandle,
    url: &str,
    thread_id: &str,
    run_id: &str,
) -> TestResult {
    for iteration in 0..50 {
        let mut client = V2LiveClient::connect(url, "live-v2-seam-device").await?;
        let title = format!("CodeWide V2 seam {run_id}-{iteration}");
        let opening = client.open(Some(thread_id));
        let rename = observer_rpc(
            observer,
            "thread/name/set",
            json!({"threadId": thread_id, "name": title}),
        );
        let (snapshot, renamed) = tokio::join!(opening, rename);
        let snapshot = snapshot?;
        renamed?;
        if !value_contains_string(&snapshot, &title) && !client.buffer_contains(&title) {
            client.wait_for_thread_title(thread_id, &title).await?;
        }
        client.close().await?;
    }
    Ok(())
}

async fn verify_v2_pagination(url: &str, thread_id: &str) -> TestResult<String> {
    eprintln!("stage=v2_history_and_catalog_pagination");
    let mut client = V2LiveClient::connect(url, "live-v2-pagination").await?;
    client.open(Some(thread_id)).await?;
    let summary_without_rollout = client
        .query(json!({
            "kind": "history.page",
            "threadId": thread_id,
            "cursor": null,
            "direction": "older",
            "limit": 1,
            "detail": "summary"
        }))
        .await?;
    require_query_completed(&summary_without_rollout)?;
    let _ = query_turn_id(&summary_without_rollout)?;
    let first = client
        .query(history_query(thread_id, None, "older"))
        .await?;
    require_query_completed(&first)?;
    let first_id = query_turn_id(&first)?;
    let older_cursor = first
        .pointer("/result/olderCursor")
        .and_then(Value::as_str)
        .ok_or("V2 older page omitted olderCursor")?
        .to_owned();
    let older = client
        .query(history_query(thread_id, Some(&older_cursor), "older"))
        .await?;
    require_query_completed(&older)?;
    if query_turn_id(&older)? == first_id {
        return Err("V2 older pagination repeated the same turn".into());
    }

    let earliest = client
        .query(history_query(thread_id, None, "newer"))
        .await?;
    require_query_completed(&earliest)?;
    let earliest_id = query_turn_id(&earliest)?;
    let newer_cursor = earliest
        .pointer("/result/newerCursor")
        .and_then(Value::as_str)
        .ok_or("V2 newer page omitted newerCursor")?
        .to_owned();
    let newer = client
        .query(history_query(thread_id, Some(&newer_cursor), "newer"))
        .await?;
    require_query_completed(&newer)?;
    if query_turn_id(&newer)? == earliest_id {
        return Err("V2 newer pagination repeated the same turn".into());
    }

    let invalid = client
        .query(history_query(
            thread_id,
            Some("definitely-not-a-v2-history-cursor"),
            "older",
        ))
        .await?;
    require_query_error_code(&invalid, "invalidCursor")?;

    let mut other_device = V2LiveClient::connect(url, "live-v2-pagination-other").await?;
    other_device.open(Some(thread_id)).await?;
    let foreign = other_device
        .query(history_query(thread_id, Some(&older_cursor), "older"))
        .await?;
    require_query_error_code(&foreign, "staleCursor")?;

    let first_catalog = client
        .query(json!({
            "kind": "catalog.page",
            "partition": "active",
            "before": null,
            "limit": 1
        }))
        .await?;
    require_query_completed(&first_catalog)?;
    if let Some(anchor) = first_catalog
        .pointer("/result/next")
        .filter(|value| !value.is_null())
    {
        let first_catalog_id = first_catalog
            .pointer("/result/threads/0/id")
            .and_then(Value::as_str)
            .ok_or("first V2 catalog page was empty")?;
        let next_catalog = client
            .query(json!({
                "kind": "catalog.page",
                "partition": "active",
                "before": anchor,
                "limit": 1
            }))
            .await?;
        require_query_completed(&next_catalog)?;
        if next_catalog
            .pointer("/result/threads/0/id")
            .and_then(Value::as_str)
            == Some(first_catalog_id)
        {
            return Err("V2 catalog pagination repeated the same thread".into());
        }
    }
    other_device.close().await?;
    client.close().await?;
    Ok(older_cursor)
}

fn history_query(thread_id: &str, cursor: Option<&str>, direction: &str) -> Value {
    json!({
        "kind": "history.page",
        "threadId": thread_id,
        "cursor": cursor,
        "direction": direction,
        "limit": 1,
        "detail": "full"
    })
}

fn query_turn_id(response: &Value) -> TestResult<&str> {
    response
        .pointer("/result/turns/0/id")
        .and_then(Value::as_str)
        .ok_or_else(|| "V2 history page was empty".into())
}

async fn create_test_thread(observer: &UpstreamHandle, title: &str) -> TestResult<String> {
    let response = observer_rpc(
        observer,
        "thread/start",
        json!({
            "cwd": std::env::current_dir()?.to_string_lossy(),
            "approvalPolicy": "never",
            "sandbox": "read-only",
            "baseInstructions": "You are a transport contract test. Reply exactly with the token requested by the user. Do not call tools.",
            "developerInstructions": "Return only the requested token and no other text.",
        }),
    )
    .await?;
    let thread_id = response
        .pointer("/result/thread/id")
        .and_then(Value::as_str)
        .ok_or("thread/start did not return a thread id")?
        .to_owned();
    observer_rpc(
        observer,
        "thread/name/set",
        json!({"threadId": thread_id, "name": title}),
    )
    .await?;
    Ok(thread_id)
}

async fn start_turn(observer: &UpstreamHandle, thread_id: &str, token: &str) -> TestResult {
    observer_rpc(
        observer,
        "turn/start",
        json!({
            "threadId": thread_id,
            "clientUserMessageId": token,
            "input": [{
                "type": "text",
                "text": format!("Reply exactly with {token}"),
                "text_elements": [],
            }],
            "effort": "low",
        }),
    )
    .await?;
    Ok(())
}

async fn observer_rpc(observer: &UpstreamHandle, method: &str, params: Value) -> TestResult<Value> {
    let response = timeout(
        LIVE_TIMEOUT,
        observer.request(json!({"method": method, "params": params})),
    )
    .await??;
    if let Some(error) = response.get("error") {
        return Err(format!("{method} failed: {error}").into());
    }
    Ok(response)
}

async fn wait_for_upstream_event(
    events: &mut broadcast::Receiver<Value>,
    predicate: impl Fn(&Value) -> bool,
) -> TestResult<Value> {
    timeout(LIVE_TIMEOUT, async {
        loop {
            match events.recv().await {
                Ok(event) if predicate(&event) => return Ok(event),
                Ok(_) | Err(broadcast::error::RecvError::Lagged(_)) => {}
                Err(broadcast::error::RecvError::Closed) => {
                    return Err("Observer event stream closed".into());
                }
            }
        }
    })
    .await?
}

fn upstream_event_is_turn_completed(event: &Value, thread_id: &str) -> bool {
    event.get("method").and_then(Value::as_str) == Some("turn/completed")
        && event.pointer("/params/threadId").and_then(Value::as_str) == Some(thread_id)
}

fn assert_v2_snapshot_contains_completed_message(snapshot: &Value, token: &str) -> TestResult {
    let turns = snapshot
        .pointer("/currentThread/turns")
        .and_then(Value::as_array)
        .ok_or("V2 snapshot omitted currentThread.turns")?;
    if !turns
        .iter()
        .any(|turn| turn["state"] == "completed" && value_contains_string(turn, token))
    {
        return Err(format!("V2 snapshot omitted completed message {token}: {snapshot}").into());
    }
    Ok(())
}

fn assert_history_contains_completed_message(response: &Value, token: &str) -> TestResult {
    let turns = response
        .pointer("/result/turns")
        .and_then(Value::as_array)
        .ok_or("V2 history response omitted result.turns")?;
    if !turns
        .iter()
        .any(|turn| turn["state"] == "completed" && value_contains_string(turn, token))
    {
        return Err(format!("V2 history omitted completed message {token}").into());
    }
    Ok(())
}

fn count_v2_user_text_occurrences(response: &Value, token: &str) -> TestResult<usize> {
    let turns = response
        .pointer("/result/turns")
        .and_then(Value::as_array)
        .ok_or("V2 history response omitted result.turns")?;
    Ok(turns
        .iter()
        .filter_map(|turn| turn.get("items").and_then(Value::as_array))
        .flatten()
        .filter(|item| {
            item.get("kind").and_then(Value::as_str) == Some("userText")
                && item
                    .get("text")
                    .and_then(Value::as_str)
                    .is_some_and(|text| text.contains(token))
        })
        .count())
}

fn value_contains_string(value: &Value, needle: &str) -> bool {
    match value {
        Value::String(text) => text.contains(needle),
        Value::Array(values) => values
            .iter()
            .any(|value| value_contains_string(value, needle)),
        Value::Object(values) => values
            .values()
            .any(|value| value_contains_string(value, needle)),
        Value::Null | Value::Bool(_) | Value::Number(_) => false,
    }
}

fn require_query_completed(value: &Value) -> TestResult {
    require_type(value, "queryCompleted")
}

fn require_query_error_code(value: &Value, expected: &str) -> TestResult {
    require_type(value, "queryFailed")?;
    if value.pointer("/error/code").and_then(Value::as_str) == Some(expected) {
        Ok(())
    } else {
        Err(format!("expected V2 query error {expected}, got {value}").into())
    }
}

struct V2LiveClient {
    socket: ClientSocket,
    buffered: VecDeque<Value>,
    next_request_id: u64,
}

impl V2LiveClient {
    async fn connect(url: &str, device_id: &str) -> TestResult<Self> {
        Ok(Self {
            socket: connect_live(url, device_id).await?,
            buffered: VecDeque::new(),
            next_request_id: 1,
        })
    }

    async fn open(&mut self, thread_id: Option<&str>) -> TestResult<Value> {
        send(
            &mut self.socket,
            json!({
                "type": "open",
                "version": 2,
                "intent": {
                    "catalog": {"activeLimit": 100, "archivedLimit": 100},
                    "currentThread": thread_id.map(|thread_id| json!({
                        "threadId": thread_id,
                        "turnLimit": 36
                    }))
                }
            }),
        )
        .await?;
        let snapshot = receive(&mut self.socket).await?;
        require_type(&snapshot, "snapshot")?;
        send(
            &mut self.socket,
            json!({
                "type": "snapshotCommitted",
                "epochId": snapshot["epochId"],
                "revision": snapshot["revision"],
                "watermark": snapshot["watermark"]
            }),
        )
        .await?;
        loop {
            let frame = receive(&mut self.socket).await?;
            match frame["type"].as_str() {
                Some("live") => break,
                Some("change") => self.buffered.push_back(frame),
                Some("reinitialize") => {
                    return Err(format!("V2 initialization was invalidated: {frame}").into());
                }
                _ => return Err(format!("unexpected V2 initialization frame: {frame}").into()),
            }
        }
        Ok(snapshot)
    }

    async fn query(&mut self, query: Value) -> TestResult<Value> {
        let request_id = format!("live-v2-query-{}", self.next_request_id);
        self.next_request_id += 1;
        send(
            &mut self.socket,
            json!({"type": "query", "requestId": request_id, "query": query}),
        )
        .await?;
        self.wait_for_frame(|frame| {
            frame.get("requestId").and_then(Value::as_str) == Some(&request_id)
                && matches!(
                    frame.get("type").and_then(Value::as_str),
                    Some("queryCompleted" | "queryFailed")
                )
        })
        .await
    }

    async fn command(&mut self, operation_id: &str, command: Value) -> TestResult<Value> {
        let request_id = format!("live-v2-command-{}", self.next_request_id);
        self.next_request_id += 1;
        send(
            &mut self.socket,
            json!({
                "type": "command",
                "requestId": request_id,
                "operationId": operation_id,
                "command": command
            }),
        )
        .await?;
        let admission = self
            .wait_for_frame(|frame| {
                frame.get("requestId").and_then(Value::as_str) == Some(&request_id)
                    && matches!(
                        frame.get("type").and_then(Value::as_str),
                        Some("commandAccepted" | "commandRejected" | "commandExpired")
                    )
            })
            .await?;
        require_type(&admission, "commandAccepted")?;
        self.wait_for_frame(|frame| {
            frame.get("operationId").and_then(Value::as_str) == Some(operation_id)
                && matches!(
                    frame.get("type").and_then(Value::as_str),
                    Some("commandCompleted" | "commandFailed" | "commandIndeterminate")
                )
        })
        .await
    }

    async fn wait_for_turn_text(&mut self, token: &str) -> TestResult<u64> {
        let frame = self
            .wait_for_frame(|frame| {
                frame.pointer("/change/kind").and_then(Value::as_str) == Some("turnUpserted")
                    && value_contains_string(
                        frame.pointer("/change").unwrap_or(&Value::Null),
                        token,
                    )
            })
            .await?;
        let watermark = frame["watermark"]
            .as_str()
            .ok_or("V2 change omitted string watermark")?
            .parse::<u64>()
            .map_err(|_| "V2 change watermark was not a valid u64")?;
        if frame.pointer("/change/turn/state").and_then(Value::as_str) == Some("completed") {
            self.buffered.push_back(frame);
        }
        Ok(watermark)
    }

    async fn wait_for_turn_completed(&mut self, thread_id: &str, token: &str) -> TestResult {
        self.wait_for_frame(|frame| {
            frame.pointer("/change/kind").and_then(Value::as_str) == Some("turnUpserted")
                && frame
                    .pointer("/change/turn/threadId")
                    .and_then(Value::as_str)
                    == Some(thread_id)
                && frame.pointer("/change/turn/state").and_then(Value::as_str) == Some("completed")
                && value_contains_string(frame.pointer("/change").unwrap_or(&Value::Null), token)
        })
        .await?;
        Ok(())
    }

    async fn wait_for_thread_upsert(&mut self, thread_id: &str) -> TestResult {
        self.wait_for_frame(|frame| {
            frame.pointer("/change/kind").and_then(Value::as_str) == Some("threadUpserted")
                && frame.pointer("/change/thread/id").and_then(Value::as_str) == Some(thread_id)
        })
        .await?;
        Ok(())
    }

    async fn wait_for_thread_title(&mut self, thread_id: &str, title: &str) -> TestResult {
        self.wait_for_frame(|frame| {
            frame.pointer("/change/kind").and_then(Value::as_str) == Some("threadUpserted")
                && frame.pointer("/change/thread/id").and_then(Value::as_str) == Some(thread_id)
                && frame
                    .pointer("/change/thread/title")
                    .and_then(Value::as_str)
                    == Some(title)
        })
        .await?;
        Ok(())
    }

    async fn wait_for_thread_archived(&mut self, thread_id: &str, archived: bool) -> TestResult {
        self.wait_for_frame(|frame| {
            frame.pointer("/change/kind").and_then(Value::as_str) == Some("threadUpserted")
                && frame.pointer("/change/thread/id").and_then(Value::as_str) == Some(thread_id)
                && frame
                    .pointer("/change/thread/archived")
                    .and_then(Value::as_bool)
                    == Some(archived)
        })
        .await?;
        Ok(())
    }

    async fn wait_for_reinitialize(&mut self) -> TestResult {
        let frame = self
            .wait_for_frame(|frame| frame["type"] == "reinitialize")
            .await?;
        if frame["reason"] != "upstreamUnavailable" {
            return Err(format!("unexpected V2 reinitialize reason: {frame}").into());
        }
        Ok(())
    }

    async fn wait_for_frame(&mut self, predicate: impl Fn(&Value) -> bool) -> TestResult<Value> {
        if let Some(index) = self.buffered.iter().position(&predicate) {
            return self
                .buffered
                .remove(index)
                .ok_or_else(|| "buffered V2 frame disappeared".into());
        }
        loop {
            let frame = receive(&mut self.socket).await?;
            if predicate(&frame) {
                return Ok(frame);
            }
            self.buffered.push_back(frame);
        }
    }

    fn buffer_contains(&self, needle: &str) -> bool {
        self.buffered
            .iter()
            .any(|frame| value_contains_string(frame, needle))
    }

    async fn close(&mut self) -> TestResult {
        self.socket.close(None).await?;
        Ok(())
    }
}

async fn connect_live(url: &str, device_id: &str) -> TestResult<ClientSocket> {
    let mut request = url.into_client_request()?;
    request.headers_mut().insert(
        "authorization",
        HeaderValue::from_str(&format!("Bearer {TOKEN}"))?,
    );
    request
        .headers_mut()
        .insert("x-live-device-id", HeaderValue::from_str(device_id)?);
    Ok(connect_async(request).await?.0)
}

async fn open_live(socket: &mut ClientSocket) -> TestResult {
    send(
        socket,
        json!({
            "type": "open",
            "version": 2,
            "intent": {
                "catalog": {"activeLimit": 0, "archivedLimit": 0},
                "currentThread": null
            }
        }),
    )
    .await?;
    let snapshot = receive(socket).await?;
    require_type(&snapshot, "snapshot")?;
    send(
        socket,
        json!({
            "type": "snapshotCommitted",
            "epochId": snapshot["epochId"],
            "revision": snapshot["revision"],
            "watermark": snapshot["watermark"]
        }),
    )
    .await?;
    require_type(&receive(socket).await?, "live")
}

async fn open_live_catalog(socket: &mut ClientSocket, active_limit: u16) -> TestResult {
    send(
        socket,
        json!({
            "type": "open",
            "version": 2,
            "intent": {
                "catalog": {"activeLimit": active_limit, "archivedLimit": 0},
                "currentThread": null
            }
        }),
    )
    .await?;
    let snapshot = receive(socket).await?;
    require_type(&snapshot, "snapshot")?;
    send(
        socket,
        json!({
            "type": "snapshotCommitted",
            "epochId": snapshot["epochId"],
            "revision": snapshot["revision"],
            "watermark": snapshot["watermark"]
        }),
    )
    .await?;
    require_type(&receive(socket).await?, "live")
}

async fn open_live_thread(socket: &mut ClientSocket, thread_id: &str) -> TestResult {
    let _ = open_live_thread_snapshot(socket, thread_id).await?;
    Ok(())
}

async fn open_live_thread_snapshot(
    socket: &mut ClientSocket,
    thread_id: &str,
) -> TestResult<Value> {
    send(
        socket,
        json!({
            "type": "open",
            "version": 2,
            "intent": {
                "catalog": {"activeLimit": 0, "archivedLimit": 0},
                "currentThread": {"threadId": thread_id, "turnLimit": 1}
            }
        }),
    )
    .await?;
    let snapshot = receive(socket).await?;
    require_type(&snapshot, "snapshot")?;
    send(
        socket,
        json!({
            "type": "snapshotCommitted",
            "epochId": snapshot["epochId"],
            "revision": snapshot["revision"],
            "watermark": snapshot["watermark"]
        }),
    )
    .await?;
    require_type(&receive(socket).await?, "live")?;
    Ok(snapshot)
}

async fn run_observer_app_server(
    listener: UnixListener,
    mut events: mpsc::Receiver<ObserverEvent>,
) -> Result<(), Box<dyn Error + Send + Sync>> {
    loop {
        let (stream, _) = listener.accept().await?;
        let mut socket = accept_async(stream).await?;
        let initialize = receive_upstream(&mut socket).await?;
        socket
            .send(Message::Text(
                json!({"id": initialize["id"], "result": {}})
                    .to_string()
                    .into(),
            ))
            .await?;
        let initialized = receive_upstream(&mut socket).await?;
        if initialized["method"] != "initialized" {
            return Err("App Server initialized notification was missing".into());
        }

        loop {
            tokio::select! {
                event = events.recv() => {
                    let Some(event) = event else { return Ok(()); };
                    let payload = match event {
                        ObserverEvent::ThreadChanged(thread_id) => json!({
                            "method": "thread/name/updated",
                            "params": {"threadId": thread_id}
                        }),
                        ObserverEvent::ApprovalOpened { request_id, thread_id } => json!({
                            "id": request_id,
                            "method": "item/commandExecution/requestApproval",
                            "params": {
                                "threadId": thread_id,
                                "turnId": "observer-turn",
                                "reason": "approval"
                            }
                        }),
                        ObserverEvent::Disconnect => {
                            socket.close(None).await?;
                            break;
                        }
                    };
                    socket.send(Message::Text(payload.to_string().into())).await?;
                }
                frame = socket.next() => {
                    let Some(frame) = frame else { break; };
                    let request: Value = serde_json::from_str(frame?.into_text()?.as_str())?;
                    let Some(id) = request.get("id").cloned() else { continue; };
                    if request.get("method").is_none() {
                        continue;
                    }
                    let method = request["method"].as_str().unwrap_or_default();
                    let thread_id = request.pointer("/params/threadId")
                        .and_then(Value::as_str)
                        .unwrap_or("shared-thread");
                    if method == "thread/read" && thread_id == "unreadable-thread" {
                        socket.send(Message::Text(json!({
                            "id": id,
                            "error": {"code": -32000, "message": "unreadable test thread"}
                        }).to_string().into())).await?;
                        continue;
                    }
                    let result = match method {
                        "thread/read" | "thread/resume" => {
                            json!({"thread": observer_thread(thread_id)})
                        }
                        "thread/list" | "thread/turns/list" => {
                            json!({"data": [], "nextCursor": null})
                        }
                        "thread/unsubscribe" => json!({}),
                        _ => return Err(format!("unexpected production adapter method: {method}").into()),
                    };
                    socket.send(Message::Text(json!({"id": id, "result": result}).to_string().into())).await?;
                }
            }
        }
    }
}

async fn receive_upstream<S>(
    socket: &mut WebSocketStream<S>,
) -> Result<Value, Box<dyn Error + Send + Sync>>
where
    S: tokio::io::AsyncRead + tokio::io::AsyncWrite + Unpin,
{
    let frame = socket.next().await.ok_or("App Server socket closed")??;
    Ok(serde_json::from_str(frame.into_text()?.as_str())?)
}

fn observer_thread(thread_id: &str) -> Value {
    json!({
        "id": thread_id,
        "parentId": null,
        "title": "Observed",
        "cwd": "/tmp",
        "archived": false,
        "status": {"type": "idle"},
        "model": null,
        "reasoningEffort": null,
        "approvalPolicy": "never",
        "sandbox": {"type": "read-only"},
        "createdAt": 1_787_891_696,
        "updatedAt": 1_787_891_696,
        "turns": []
    })
}

async fn start_server(
    runtime: SyncV2Runtime,
) -> TestResult<(std::net::SocketAddr, JoinHandle<()>)> {
    let listener = TcpListener::bind("127.0.0.1:0").await?;
    let address = listener.local_addr()?;
    let app = Router::new()
        .route("/v2/sync", get(live_upgrade))
        .with_state(runtime);
    let task = tokio::spawn(async move {
        let _ = axum::serve(listener, app).await;
    });
    Ok((address, task))
}

async fn live_upgrade(
    State(runtime): State<SyncV2Runtime>,
    headers: HeaderMap,
    upgrade: WebSocketUpgrade,
) -> Response {
    let device_id = headers
        .get("x-live-device-id")
        .and_then(|value| value.to_str().ok())
        .unwrap_or("missing-live-device-id")
        .to_owned();
    upgrade.on_upgrade(move |socket| {
        runtime.serve(
            socket,
            AuthorizationContext::Session {
                device_id,
                scopes: vec![
                    "threads.read".into(),
                    "threads.write".into(),
                    "turns.start".into(),
                    "approvals.respond".into(),
                ],
                expires_at: u64::MAX,
            },
            None,
        )
    })
}

async fn send(socket: &mut ClientSocket, value: Value) -> TestResult {
    socket.send(Message::Text(value.to_string().into())).await?;
    Ok(())
}

async fn receive(socket: &mut ClientSocket) -> TestResult<Value> {
    loop {
        let frame = timeout(LIVE_TIMEOUT, socket.next())
            .await?
            .ok_or("V2 socket closed")??;
        match frame {
            Message::Text(raw) => return Ok(serde_json::from_str(&raw)?),
            Message::Ping(bytes) => socket.send(Message::Pong(bytes)).await?,
            Message::Close(frame) => return Err(format!("V2 socket closed: {frame:?}").into()),
            Message::Binary(_) | Message::Pong(_) | Message::Frame(_) => {}
        }
    }
}

fn require_type(value: &Value, expected: &str) -> TestResult {
    if value["type"] == expected {
        Ok(())
    } else {
        Err(format!("expected {expected}, got {value}").into())
    }
}

async fn wait_for_live(upstream: &UpstreamHandle) -> TestResult {
    wait_for_status(upstream, ConnectionStatus::Live).await
}

async fn wait_for_status(upstream: &UpstreamHandle, expected: ConnectionStatus) -> TestResult {
    let mut status = upstream.subscribe_status();
    timeout(Duration::from_secs(10), async {
        loop {
            if *status.borrow() == expected {
                return Ok::<_, Box<dyn Error>>(());
            }
            status
                .changed()
                .await
                .map_err(|_| "status channel closed")?;
        }
    })
    .await?
}

async fn wait_for_generation(upstream: &UpstreamHandle, previous: u64) -> TestResult {
    let mut status = upstream.subscribe_status();
    timeout(Duration::from_secs(30), async {
        loop {
            if *status.borrow() == ConnectionStatus::Live && upstream.generation() > previous {
                return Ok::<_, Box<dyn Error>>(());
            }
            status
                .changed()
                .await
                .map_err(|_| "status channel closed")?;
        }
    })
    .await?
}

struct ManagedSocketRelay {
    path: PathBuf,
    available: watch::Sender<bool>,
    task: JoinHandle<()>,
}

impl ManagedSocketRelay {
    fn start(path: PathBuf, target: PathBuf) -> TestResult<Self> {
        let listener = UnixListener::bind(&path)?;
        let (available, mut availability) = watch::channel(true);
        let task = tokio::spawn(async move {
            loop {
                while !*availability.borrow() {
                    if availability.changed().await.is_err() {
                        return;
                    }
                }
                let Ok((mut downstream, _)) = listener.accept().await else {
                    return;
                };
                if !*availability.borrow() {
                    continue;
                }
                let Ok(mut upstream) = UnixStream::connect(&target).await else {
                    continue;
                };
                loop {
                    tokio::select! {
                        _ = copy_bidirectional(&mut downstream, &mut upstream) => break,
                        changed = availability.changed() => {
                            if changed.is_err() || !*availability.borrow() {
                                break;
                            }
                        }
                    }
                }
            }
        });
        Ok(Self {
            path,
            available,
            task,
        })
    }

    fn path(&self) -> &Path {
        &self.path
    }

    fn pause(&self) {
        let _ = self.available.send(false);
    }

    fn resume(&self) {
        let _ = self.available.send(true);
    }
}

impl Drop for ManagedSocketRelay {
    fn drop(&mut self) {
        self.task.abort();
    }
}

fn require_live_opt_in() -> TestResult {
    if std::env::var("CODEWIDE_LIVE_E2E").as_deref() != Ok("1") {
        return Err("set CODEWIDE_LIVE_E2E=1 to run the real-account V2 contract test".into());
    }
    Ok(())
}

fn managed_app_server_socket() -> TestResult<PathBuf> {
    let codex_home = std::env::var_os("CODEX_HOME")
        .map(PathBuf::from)
        .or_else(|| std::env::var_os("HOME").map(|home| Path::new(&home).join(".codex")))
        .ok_or("CODEX_HOME and HOME are unavailable")?;
    let path = codex_home.join("app-server-control/app-server-control.sock");
    path.exists()
        .then_some(path)
        .ok_or_else(|| "managed App Server socket is missing".into())
}

fn unique_run_id() -> String {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
        .to_string()
}
