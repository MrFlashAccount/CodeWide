#![cfg(unix)]
#![allow(clippy::too_many_lines)]

use std::{
    collections::HashMap,
    io::Write,
    path::PathBuf,
    sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
    },
    time::Duration,
};

use codewide_companion::{
    catalog::SessionCatalog,
    files::FileService,
    history_service::HistoryService,
    server,
    store::IndexStore,
    sync::SyncHub,
    upstream::{ConnectionStatus, UpstreamHandle},
};
use futures_util::{SinkExt, StreamExt};
use http::{HeaderValue, StatusCode};
use serde_json::{Value, json};
use tokio::{
    net::{TcpListener, UnixListener, UnixStream},
    sync::mpsc,
    task::JoinHandle,
    time::timeout,
};
use tokio_tungstenite::{
    WebSocketStream, accept_async, connect_async,
    tungstenite::{Message, client::IntoClientRequest},
};

const TOKEN: &str = "test-token-that-is-long-enough-for-production-shape";
const EXTERNAL_THREAD_ID: &str = "019fe7af-e2fa-70f3-88e8-99d59e10bd63";
type ClientSocket = WebSocketStream<tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>>;

#[tokio::test]
async fn opted_in_inventory_arrives_before_chat_snapshot_acknowledgement()
-> Result<(), Box<dyn std::error::Error>> {
    let directory = tempfile::tempdir()?;
    let socket_path = directory.path().join("app-server.sock");
    let (observed, _observed_rx) = mpsc::channel(4);
    let fake = tokio::spawn(run_idle_thread_app_server(socket_path.clone(), observed));
    let upstream = UpstreamHandle::spawn(socket_path);
    wait_for_live(&upstream).await?;
    let store = Arc::new(IndexStore::open(directory.path().join("state.redb"))?);
    let history = HistoryService::new(
        Arc::new(SessionCatalog::scan(directory.path())),
        store.clone(),
    );
    let sync = SyncHub::with_mutations(upstream, store.clone(), history);
    let (address, server_task) = start_server(store, sync).await?;
    let mut request = format!("ws://{address}/v1/sync").into_client_request()?;
    request.headers_mut().insert(
        "authorization",
        HeaderValue::from_str(&format!("Bearer {TOKEN}"))?,
    );
    let (mut client, _) = connect_async(request).await?;
    send_json(
        &mut client,
        &json!({
            "type": "hello", "protocolVersion": 1, "cursor": null, "portInventory": true
        }),
    )
    .await?;
    let hello = receive_type(&mut client, "hello").await?;
    assert_eq!(hello["snapshotRequired"], true);
    // The client deliberately has not acknowledged its chat snapshot.
    let inventory = receive_type(&mut client, "portInventory").await?;
    assert!(
        inventory["revision"]
            .as_u64()
            .is_some_and(|value| value > 0)
    );
    assert!(
        inventory["inventory"]["scannedAt"]
            .as_u64()
            .is_some_and(|value| value > 0)
    );
    let ports = inventory["inventory"]["ports"]
        .as_array()
        .ok_or("ports missing")?;
    assert!(
        ports
            .iter()
            .any(|row| row["port"].as_u64() == Some(u64::from(address.port())))
    );
    send_json(
        &mut client,
        &json!({"type": "ping", "nonce": "inventory-alive"}),
    )
    .await?;
    assert_eq!(
        receive_type(&mut client, "pong").await?["nonce"],
        "inventory-alive"
    );
    client.close(None).await?;
    server_task.abort();
    fake.abort();
    Ok(())
}

#[tokio::test]
async fn idle_sync_session_emits_transport_keepalive() -> Result<(), Box<dyn std::error::Error>> {
    let directory = tempfile::tempdir()?;
    let socket_path = directory.path().join("app-server.sock");
    let (observed, _observed_rx) = mpsc::channel(4);
    let fake = tokio::spawn(run_idle_thread_app_server(socket_path.clone(), observed));
    let upstream = UpstreamHandle::spawn(socket_path);
    wait_for_live(&upstream).await?;
    let store = Arc::new(IndexStore::open(directory.path().join("state.redb"))?);
    let history = HistoryService::new(
        Arc::new(SessionCatalog::scan(directory.path())),
        store.clone(),
    );
    let sync = SyncHub::with_mutations(upstream, store.clone(), history);
    let (address, server_task) = start_server(store, sync).await?;
    let (mut client, _) = connect_client(&format!("ws://{address}/v1/sync"), None).await?;

    timeout(Duration::from_secs(6), async {
        loop {
            let frame = client.next().await.ok_or("WebSocket closed")??;
            if matches!(frame, Message::Ping(_)) {
                return Ok::<(), Box<dyn std::error::Error>>(());
            }
        }
    })
    .await??;

    send_json(&mut client, &json!({"type": "ping", "nonce": "android:1"})).await?;
    assert_eq!(
        receive_type(&mut client, "pong").await?["nonce"],
        "android:1"
    );

    client.close(None).await?;
    server_task.abort();
    fake.abort();
    Ok(())
}

#[tokio::test]
async fn arbitrary_rpcs_and_upstream_errors_pass_through_the_v1_transport()
-> Result<(), Box<dyn std::error::Error>> {
    let directory = tempfile::tempdir()?;
    let socket_path = directory.path().join("app-server.sock");
    let (observed, mut observed_rx) = mpsc::channel(4);
    let fake = tokio::spawn(run_passthrough_app_server(socket_path.clone(), observed));
    let upstream = UpstreamHandle::spawn(socket_path);
    wait_for_live(&upstream).await?;
    let store = Arc::new(IndexStore::open(directory.path().join("state.redb"))?);
    let history = HistoryService::new(
        Arc::new(SessionCatalog::scan(directory.path())),
        store.clone(),
    );
    let sync = SyncHub::with_mutations(upstream, store.clone(), history);
    let (address, server_task) = start_server(store, sync).await?;
    let (mut client, _) = connect_client(&format!("ws://{address}/v1/sync"), None).await?;

    for method in [
        "future/feature/read",
        "future/feature/write",
        "companion/project/unknown",
        "companion/queue/unknown",
        "companion/accountPool/unknown",
        "companion/dictation/unknown",
        "companion/thread/observe",
        "companion/threadWindow/read",
        "thread/resume",
        "future/missing",
    ] {
        send_json(
            &mut client,
            &json!({
                "type": "rpc",
                "request": {
                    "id": method,
                    "method": method,
                    "params": {"threadId": EXTERNAL_THREAD_ID}
                }
            }),
        )
        .await?;
        let response = receive_type(&mut client, "rpc").await?;
        assert_eq!(response["response"]["id"], method);
        let request = timeout(Duration::from_secs(1), observed_rx.recv())
            .await?
            .ok_or("App Server observation channel closed")?;
        assert_eq!(request["method"], method);
        assert_eq!(request["params"], json!({"threadId": EXTERNAL_THREAD_ID}));
        if method == "future/missing" {
            assert_eq!(
                response["response"]["error"],
                json!({
                    "code": -32601,
                    "message": "Unknown method at App Server",
                    "data": {"source": "upstream"}
                })
            );
        } else {
            assert_eq!(
                response["response"]["result"],
                json!({
                    "method": method,
                    "params": {"threadId": EXTERNAL_THREAD_ID}
                })
            );
        }
    }

    client.close(None).await?;
    server_task.abort();
    fake.abort();
    Ok(())
}

#[tokio::test]
async fn passive_sync_never_executes_rpc_regardless_of_method()
-> Result<(), Box<dyn std::error::Error>> {
    let directory = tempfile::tempdir()?;
    let socket_path = directory.path().join("app-server.sock");
    let (observed, mut observed_rx) = mpsc::channel(4);
    let fake = tokio::spawn(run_passthrough_app_server(socket_path.clone(), observed));
    let upstream = UpstreamHandle::spawn(socket_path);
    wait_for_live(&upstream).await?;
    let store = Arc::new(IndexStore::open(directory.path().join("state.redb"))?);
    let history = HistoryService::new(
        Arc::new(SessionCatalog::scan(directory.path())),
        store.clone(),
    );
    let sync = SyncHub::new(upstream, store.clone(), history);
    let (address, server_task) = start_server(store, sync).await?;
    let (mut client, _) = connect_client(&format!("ws://{address}/v1/sync"), None).await?;
    for method in [
        "thread/list",
        "thread/delete",
        "future/unknown",
        "companion/project/home",
    ] {
        send_json(
            &mut client,
            &json!({
                "type": "rpc",
                "request": {"id": method, "method": method, "params": {}}
            }),
        )
        .await?;
        let response = receive_type(&mut client, "rpc").await?;
        assert_eq!(response["response"]["id"], method);
        assert_eq!(response["response"]["error"]["code"], -32010);
        assert_eq!(
            response["response"]["error"]["message"],
            "Passive companion does not execute RPC"
        );
    }
    assert!(
        timeout(Duration::from_millis(100), observed_rx.recv())
            .await
            .is_err()
    );
    client.close(None).await?;
    server_task.abort();
    fake.abort();
    Ok(())
}

#[tokio::test]
async fn read_only_rpcs_complete_out_of_order_without_head_of_line_blocking()
-> Result<(), Box<dyn std::error::Error>> {
    let directory = tempfile::tempdir()?;
    let socket_path = directory.path().join("app-server.sock");
    let fake = tokio::spawn(run_out_of_order_app_server(socket_path.clone()));
    let upstream = UpstreamHandle::spawn(socket_path);
    wait_for_live(&upstream).await?;
    let store = Arc::new(IndexStore::open(directory.path().join("state.redb"))?);
    let history = HistoryService::new(
        Arc::new(SessionCatalog::scan(directory.path())),
        store.clone(),
    );
    let sync = SyncHub::with_mutations(upstream, store.clone(), history);
    let (address, server_task) = start_server(store, sync).await?;
    let (mut client, _) = connect_client(&format!("ws://{address}/v1/sync"), None).await?;

    send_json(
        &mut client,
        &json!({
            "type": "rpc",
            "request": {"id": "slow", "method": "thread/list", "params": {}}
        }),
    )
    .await?;
    send_json(
        &mut client,
        &json!({
            "type": "rpc",
            "request": {"id": "fast", "method": "config/read", "params": {}}
        }),
    )
    .await?;

    let first = receive_type(&mut client, "rpc").await?;
    let second = receive_type(&mut client, "rpc").await?;
    assert_eq!(first["response"]["id"], "fast");
    assert_eq!(second["response"]["id"], "slow");

    client.close(None).await?;
    server_task.abort();
    fake.abort();
    Ok(())
}

#[tokio::test]
async fn mutations_on_different_threads_do_not_share_a_lane()
-> Result<(), Box<dyn std::error::Error>> {
    let directory = tempfile::tempdir()?;
    let socket_path = directory.path().join("app-server.sock");
    let fake = tokio::spawn(run_out_of_order_thread_mutation_app_server(
        socket_path.clone(),
    ));
    let upstream = UpstreamHandle::spawn(socket_path);
    wait_for_live(&upstream).await?;
    let store = Arc::new(IndexStore::open(directory.path().join("state.redb"))?);
    let history = HistoryService::new(
        Arc::new(SessionCatalog::scan(directory.path())),
        store.clone(),
    );
    let sync = SyncHub::with_mutations(upstream, store.clone(), history);
    let (address, server_task) = start_server(store, sync).await?;
    let (mut client, _) = connect_client(&format!("ws://{address}/v1/sync"), None).await?;

    for (id, thread_id) in [("slow", "thread-a"), ("fast", "thread-b")] {
        send_json(
            &mut client,
            &json!({
                "type": "rpc",
                "request": {
                    "id": id,
                    "method": "thread/name/set",
                    "params": {"threadId": thread_id, "name": id}
                }
            }),
        )
        .await?;
    }

    let first = timeout(Duration::from_secs(2), receive_type(&mut client, "rpc")).await??;
    let second = timeout(Duration::from_secs(2), receive_type(&mut client, "rpc")).await??;
    assert_eq!(first["response"]["id"], "fast");
    assert_eq!(second["response"]["id"], "slow");

    client.close(None).await?;
    server_task.abort();
    fake.abort();
    Ok(())
}

#[tokio::test]
async fn unloaded_subagent_sync_reads_history_without_resuming_its_parent()
-> Result<(), Box<dyn std::error::Error>> {
    let directory = tempfile::tempdir()?;
    let sessions = directory.path().join("sessions");
    std::fs::create_dir_all(&sessions)?;
    let mut rollout = std::fs::File::create(sessions.join(format!(
        "rollout-2026-09-07T00-00-00-{EXTERNAL_THREAD_ID}.jsonl"
    )))?;
    for line in [
        r#"{"type":"event_msg","payload":{"type":"task_started","turn_id":"child-turn","started_at":10}}"#,
        r#"{"type":"event_msg","payload":{"type":"user_message","message":"inspect this"}}"#,
        r#"{"type":"event_msg","payload":{"type":"agent_message","message":"stored child answer","phase":"final_answer"}}"#,
        r#"{"type":"event_msg","payload":{"type":"task_complete","turn_id":"child-turn","completed_at":11}}"#,
    ] {
        writeln!(rollout, "{line}")?;
    }
    rollout.sync_all()?;
    let socket_path = directory.path().join("app-server.sock");
    let (observed, mut requests) = mpsc::channel(4);
    let fake = tokio::spawn(run_thread_shell_app_server(
        socket_path.clone(),
        observed,
        Some(
            "cannot resume an unloaded multi-agent v2 sub-agent through its parent; resume the parent first, or use thread/read to inspect it",
        ),
    ));
    let upstream = UpstreamHandle::spawn(socket_path);
    wait_for_live(&upstream).await?;
    let store = Arc::new(IndexStore::open(directory.path().join("state.redb"))?);
    let history = HistoryService::new(
        Arc::new(SessionCatalog::scan(directory.path())),
        store.clone(),
    );
    let sync = SyncHub::with_mutations(upstream, store.clone(), history);
    let (address, server_task) = start_server(store, sync).await?;
    let (mut client, _) = connect_client(&format!("ws://{address}/v1/sync"), None).await?;
    send_json(
        &mut client,
        &json!({
            "type": "rpc",
            "request": {
                "id": "inspect-unloaded",
                "method": "companion/thread/sync",
                "params": {"threadId": EXTERNAL_THREAD_ID, "limit": 1}
            }
        }),
    )
    .await?;
    let response = receive_type(&mut client, "rpc").await?;
    let result = &response["response"]["result"];
    assert_eq!(result["thread"]["status"]["type"], "notLoaded");
    assert_eq!(result["history"]["turns"][0]["id"], "child-turn");
    assert!(
        result["history"]["turns"][0]["items"]
            .as_array()
            .ok_or("missing items")?
            .iter()
            .any(|item| item["text"] == "stored child answer")
    );
    assert!(result["activeTurn"].is_null());
    assert_eq!(requests.recv().await.as_deref(), Some("thread/resume"));
    assert_eq!(requests.recv().await.as_deref(), Some("thread/read"));
    assert!(
        requests.try_recv().is_err(),
        "inspection must not resume a parent or load all turns upstream"
    );
    client.close(None).await?;
    server_task.abort();
    fake.abort();
    Ok(())
}

#[tokio::test]
async fn thread_sync_does_not_hide_unrelated_resume_errors()
-> Result<(), Box<dyn std::error::Error>> {
    let directory = tempfile::tempdir()?;
    let socket_path = directory.path().join("app-server.sock");
    let (observed, mut requests) = mpsc::channel(4);
    let fake = tokio::spawn(run_thread_shell_app_server(
        socket_path.clone(),
        observed,
        Some("access denied"),
    ));
    let upstream = UpstreamHandle::spawn(socket_path);
    wait_for_live(&upstream).await?;
    let store = Arc::new(IndexStore::open(directory.path().join("state.redb"))?);
    let history = HistoryService::new(
        Arc::new(SessionCatalog::scan(directory.path())),
        store.clone(),
    );
    let sync = SyncHub::with_mutations(upstream, store.clone(), history);
    let (address, server_task) = start_server(store, sync).await?;
    let (mut client, _) = connect_client(&format!("ws://{address}/v1/sync"), None).await?;
    send_json(
        &mut client,
        &json!({
            "type": "rpc",
            "request": {
                "id": "sync-denied",
                "method": "companion/thread/sync",
                "params": {"threadId": EXTERNAL_THREAD_ID}
            }
        }),
    )
    .await?;
    let response = receive_type(&mut client, "rpc").await?;
    assert_eq!(
        response["response"]["error"]["message"],
        "App Server request failed: access denied"
    );
    assert_eq!(requests.recv().await.as_deref(), Some("thread/resume"));
    assert!(requests.try_recv().is_err());
    client.close(None).await?;
    server_task.abort();
    fake.abort();
    Ok(())
}

#[tokio::test]
async fn unified_sync_uses_the_observer_attachment_as_the_thread_shell()
-> Result<(), Box<dyn std::error::Error>> {
    let directory = tempfile::tempdir()?;
    let socket_path = directory.path().join("app-server.sock");
    let (observed, mut observed_rx) = mpsc::channel(4);
    let fake = tokio::spawn(run_idle_thread_app_server(socket_path.clone(), observed));
    let upstream = UpstreamHandle::spawn(socket_path);
    wait_for_live(&upstream).await?;
    let store = Arc::new(IndexStore::open(directory.path().join("state.redb"))?);
    let history = HistoryService::new(
        Arc::new(SessionCatalog::scan(directory.path())),
        store.clone(),
    );
    let sync = SyncHub::with_mutations(upstream, store.clone(), history);
    let (address, server_task) = start_server(store, sync).await?;
    let (mut client, _) = connect_client(&format!("ws://{address}/v1/sync"), None).await?;

    send_json(
        &mut client,
        &json!({
            "type": "rpc",
            "request": {
                "id": "sync-thread",
                "method": "companion/thread/sync",
                "params": {"threadId": EXTERNAL_THREAD_ID, "afterTurnId": null, "limit": 36}
            }
        }),
    )
    .await?;

    let response = receive_type(&mut client, "rpc").await?;
    assert_eq!(response["response"]["id"], "sync-thread");
    assert_eq!(response["response"]["result"]["readModelVersion"], 3);
    assert_eq!(observed_rx.recv().await.as_deref(), Some("thread/resume"));
    assert!(
        timeout(Duration::from_millis(100), observed_rx.recv())
            .await
            .is_err(),
        "thread sync must not reread the shell returned by thread/resume"
    );

    client.close(None).await?;
    server_task.abort();
    fake.abort();
    Ok(())
}

#[tokio::test]
async fn sync_reads_a_bounded_active_turn_checkpoint_from_app_server()
-> Result<(), Box<dyn std::error::Error>> {
    let directory = tempfile::tempdir()?;
    let sessions = directory.path().join("sessions/2026/08/17");
    std::fs::create_dir_all(&sessions)?;
    let path = sessions.join(format!(
        "rollout-2026-08-17T00-00-00-{EXTERNAL_THREAD_ID}.jsonl"
    ));
    let mut rollout = std::fs::File::create(path)?;
    for line in [
        r#"{"type":"event_msg","payload":{"type":"task_started","turn_id":"old-turn","started_at":10}}"#,
        r#"{"type":"event_msg","payload":{"type":"user_message","message":"old question"}}"#,
    ] {
        writeln!(rollout, "{line}")?;
    }
    rollout.sync_all()?;

    let socket_path = directory.path().join("app-server.sock");
    let (observed, mut observed_rx) = mpsc::channel(4);
    let fake = tokio::spawn(run_external_thread_app_server(
        socket_path.clone(),
        observed,
    ));
    let upstream = UpstreamHandle::spawn(socket_path);
    wait_for_live(&upstream).await?;
    let store = Arc::new(IndexStore::open(directory.path().join("state.redb"))?);
    let history = HistoryService::new(
        Arc::new(SessionCatalog::scan(directory.path())),
        store.clone(),
    );
    let sync = SyncHub::with_mutations(upstream, store.clone(), history);
    let (address, server_task) = start_server(store, sync).await?;
    let (mut client, _) = connect_client(&format!("ws://{address}/v1/sync"), None).await?;

    send_json(
        &mut client,
        &json!({
            "type": "rpc",
            "request": {
                "id": "sync-external",
                "method": "companion/thread/sync",
                "params": {
                    "threadId": EXTERNAL_THREAD_ID,
                    "afterTurnId": null,
                    "limit": 36
                }
            }
        }),
    )
    .await?;
    let response = receive_type(&mut client, "rpc").await?;
    assert_eq!(response["response"]["id"], "sync-external");
    assert!(
        response["response"].get("error").is_none(),
        "unexpected sync error: {response}"
    );
    assert_eq!(
        response["response"]["result"]["activeTurn"]["id"],
        "new-turn"
    );
    assert_eq!(
        response["response"]["result"]["activeTurn"]["itemsView"],
        "full"
    );
    assert_eq!(response["response"]["result"]["throughCursor"], 0);
    assert_eq!(observed_rx.recv().await.as_deref(), Some("thread/resume"));
    assert_eq!(
        observed_rx.recv().await.as_deref(),
        Some("thread/turns/list")
    );

    client.close(None).await?;
    server_task.abort();
    fake.abort();
    Ok(())
}

#[tokio::test]
async fn sync_keeps_every_active_turn_item_in_the_cursor_fenced_checkpoint()
-> Result<(), Box<dyn std::error::Error>> {
    let directory = tempfile::tempdir()?;
    let sessions = directory.path().join("sessions/2026/08/17");
    std::fs::create_dir_all(&sessions)?;
    let path = sessions.join(format!(
        "rollout-2026-08-17T00-00-00-{EXTERNAL_THREAD_ID}.jsonl"
    ));
    let mut rollout = std::fs::File::create(path)?;
    for line in [
        r#"{"type":"event_msg","payload":{"type":"task_started","turn_id":"old-turn","started_at":10}}"#,
        r#"{"type":"event_msg","payload":{"type":"user_message","message":"old question"}}"#,
        r#"{"type":"event_msg","payload":{"type":"task_complete","turn_id":"old-turn","completed_at":11,"duration_ms":1000}}"#,
        r#"{"type":"event_msg","payload":{"type":"task_started","turn_id":"new-turn","started_at":12}}"#,
        r#"{"type":"event_msg","payload":{"type":"user_message","message":"live question"}}"#,
    ] {
        writeln!(rollout, "{line}")?;
    }
    rollout.sync_all()?;

    let socket_path = directory.path().join("app-server.sock");
    let (observed, mut observed_rx) = mpsc::channel(4);
    let fake = tokio::spawn(run_external_thread_app_server(
        socket_path.clone(),
        observed,
    ));
    let upstream = UpstreamHandle::spawn(socket_path);
    wait_for_live(&upstream).await?;
    let store = Arc::new(IndexStore::open(directory.path().join("state.redb"))?);
    let history = HistoryService::new(
        Arc::new(SessionCatalog::scan(directory.path())),
        store.clone(),
    );
    let sync = SyncHub::with_mutations(upstream, store.clone(), history);
    let (address, server_task) = start_server(store, sync).await?;
    let (mut client, _) = connect_client(&format!("ws://{address}/v1/sync"), None).await?;

    send_json(
        &mut client,
        &json!({
            "type": "rpc",
            "request": {
                "id": "sync-active",
                "method": "companion/thread/sync",
                "params": {
                    "threadId": EXTERNAL_THREAD_ID,
                    "afterTurnId": null,
                    "limit": 36
                }
            }
        }),
    )
    .await?;
    let response = receive_type(&mut client, "rpc").await?;
    assert_eq!(response["response"]["id"], "sync-active");
    assert!(
        response["response"].get("error").is_none(),
        "unexpected thread sync error: {response}"
    );
    assert_eq!(
        response["response"]["result"]["activeTurn"]["id"],
        "new-turn"
    );
    assert_eq!(
        response["response"]["result"]["activeTurn"]["itemsView"],
        "full"
    );
    assert_eq!(
        response["response"]["result"]["activeTurn"]["items"][0]["type"],
        "userMessage"
    );
    assert_eq!(
        response["response"]["result"]["activeTurn"]["items"][1]["type"],
        "commandExecution"
    );
    assert_eq!(
        response["response"]["result"]["activeTurn"]["items"][2]["type"],
        "agentMessage"
    );
    assert_eq!(
        response["response"]["result"]["activeTurn"]["items"][3]["type"],
        "userMessage"
    );
    assert_eq!(response["response"]["result"]["throughCursor"], 0);
    assert_eq!(
        response["response"]["result"]["history"]["headTurnId"],
        "old-turn"
    );
    assert_eq!(
        response["response"]["result"]["history"]["turns"]
            .as_array()
            .map(|turns| turns
                .iter()
                .filter_map(|turn| turn["id"].as_str())
                .collect::<Vec<_>>()),
        Some(vec!["old-turn"]),
        "the active turn must exist only in activeTurn, never in immutable history"
    );
    assert_eq!(observed_rx.recv().await.as_deref(), Some("thread/resume"));
    assert_eq!(
        observed_rx.recv().await.as_deref(),
        Some("thread/turns/list")
    );
    assert!(
        timeout(Duration::from_millis(100), observed_rx.recv())
            .await
            .is_err(),
        "thread sync must read exactly one bounded active checkpoint"
    );

    client.close(None).await?;
    server_task.abort();
    fake.abort();
    Ok(())
}

#[tokio::test]
async fn cold_sync_serves_completed_history_from_the_index()
-> Result<(), Box<dyn std::error::Error>> {
    let directory = tempfile::tempdir()?;
    let sessions = directory.path().join("sessions/2026/08/17");
    std::fs::create_dir_all(&sessions)?;
    let path = sessions.join(format!(
        "rollout-2026-08-17T00-00-00-{EXTERNAL_THREAD_ID}.jsonl"
    ));
    let mut rollout = std::fs::File::create(path)?;
    for line in [
        r#"{"type":"event_msg","payload":{"type":"task_started","turn_id":"indexed-turn","started_at":10}}"#,
        r#"{"type":"event_msg","payload":{"type":"user_message","message":"indexed question","client_id":"indexed-client"}}"#,
        r#"{"type":"event_msg","payload":{"type":"agent_message","message":"indexed answer","phase":"final_answer"}}"#,
        r#"{"type":"event_msg","payload":{"type":"task_complete","turn_id":"indexed-turn","completed_at":11,"duration_ms":1000}}"#,
    ] {
        writeln!(rollout, "{line}")?;
    }
    rollout.sync_all()?;

    let socket_path = directory.path().join("app-server.sock");
    let (observed, mut observed_rx) = mpsc::channel(4);
    let fake = tokio::spawn(run_idle_thread_app_server(socket_path.clone(), observed));
    let upstream = UpstreamHandle::spawn(socket_path);
    wait_for_live(&upstream).await?;
    let store = Arc::new(IndexStore::open(directory.path().join("state.redb"))?);
    let history = HistoryService::new(
        Arc::new(SessionCatalog::scan(directory.path())),
        store.clone(),
    );
    let sync = SyncHub::with_mutations(upstream, store.clone(), history);
    let (address, server_task) = start_server(store, sync).await?;
    let (mut client, _) = connect_client(&format!("ws://{address}/v1/sync"), None).await?;

    send_json(
        &mut client,
        &json!({
            "type": "rpc",
            "request": {
                "id": "cold-indexed-sync",
                "method": "companion/thread/sync",
                "params": {
                    "threadId": EXTERNAL_THREAD_ID,
                    "afterTurnId": null,
                    "limit": 36
                }
            }
        }),
    )
    .await?;
    let response = receive_type(&mut client, "rpc").await?;
    assert_eq!(
        response["response"]["result"]["history"]["turns"][0]["id"],
        "indexed-turn"
    );
    assert_eq!(
        response["response"]["result"]["history"]["turns"][0]["items"][1]["text"],
        "indexed answer"
    );
    assert_eq!(observed_rx.recv().await.as_deref(), Some("thread/resume"));
    assert!(
        timeout(Duration::from_millis(100), observed_rx.recv())
            .await
            .is_err(),
        "completed history must come from the index without App Server turn reads"
    );

    client.close(None).await?;
    server_task.abort();
    fake.abort();
    Ok(())
}

#[tokio::test]
async fn thread_sync_attaches_observer_and_returns_indexed_history()
-> Result<(), Box<dyn std::error::Error>> {
    let directory = tempfile::tempdir()?;
    let sessions = directory.path().join("sessions/2026/08/17");
    std::fs::create_dir_all(&sessions)?;
    let path = sessions.join(format!(
        "rollout-2026-08-17T00-00-00-{EXTERNAL_THREAD_ID}.jsonl"
    ));
    let mut rollout = std::fs::File::create(path)?;
    for line in [
        r#"{"type":"event_msg","payload":{"type":"task_started","turn_id":"indexed-turn","started_at":10}}"#,
        r#"{"type":"event_msg","payload":{"type":"user_message","message":"indexed question","client_id":"indexed-client"}}"#,
        r#"{"type":"event_msg","payload":{"type":"agent_message","message":"indexed answer","phase":"final_answer"}}"#,
        r#"{"type":"event_msg","payload":{"type":"task_complete","turn_id":"indexed-turn","completed_at":11,"duration_ms":1000}}"#,
    ] {
        writeln!(rollout, "{line}")?;
    }
    rollout.sync_all()?;

    let socket_path = directory.path().join("app-server.sock");
    let (observed, mut observed_rx) = mpsc::channel(4);
    let fake = tokio::spawn(run_idle_thread_app_server(socket_path.clone(), observed));
    let upstream = UpstreamHandle::spawn(socket_path);
    wait_for_live(&upstream).await?;
    let store = Arc::new(IndexStore::open(directory.path().join("state.redb"))?);
    let history = HistoryService::new(
        Arc::new(SessionCatalog::scan(directory.path())),
        store.clone(),
    );
    let sync = SyncHub::with_mutations(upstream, store.clone(), history);
    let (address, server_task) = start_server(store, sync).await?;
    let (mut client, _) = connect_client(&format!("ws://{address}/v1/sync"), None).await?;

    send_json(
        &mut client,
        &json!({
            "type": "rpc",
            "request": {
                "id": "thread-sync",
                "method": "companion/thread/sync",
                "params": {"threadId": EXTERNAL_THREAD_ID, "afterTurnId": null, "limit": 36}
            }
        }),
    )
    .await?;
    let response = receive_type(&mut client, "rpc").await?;
    assert_eq!(response["response"]["result"]["readModelVersion"], 3);
    assert_eq!(response["response"]["result"]["history"]["kind"], "reset");
    assert_eq!(
        response["response"]["result"]["history"]["turns"][0]["id"],
        "indexed-turn"
    );
    assert!(response["response"]["result"]["activeTurn"].is_null());
    assert_eq!(observed_rx.recv().await.as_deref(), Some("thread/resume"));

    client.close(None).await?;
    server_task.abort();
    fake.abort();
    Ok(())
}

#[tokio::test]
async fn forward_history_page_does_not_resume_the_thread() -> Result<(), Box<dyn std::error::Error>>
{
    let directory = tempfile::tempdir()?;
    let sessions = directory.path().join("sessions/2026/08/17");
    std::fs::create_dir_all(&sessions)?;
    let path = sessions.join(format!(
        "rollout-2026-08-17T00-00-00-{EXTERNAL_THREAD_ID}.jsonl"
    ));
    let mut rollout = std::fs::File::create(path)?;
    for index in 0..3 {
        for line in [
            format!(
                "{{\"type\":\"event_msg\",\"payload\":{{\"type\":\"task_started\",\"turn_id\":\"turn-{index}\"}}}}"
            ),
            format!(
                "{{\"type\":\"event_msg\",\"payload\":{{\"type\":\"agent_message\",\"message\":\"answer-{index}\",\"phase\":\"final_answer\"}}}}"
            ),
            format!(
                "{{\"type\":\"event_msg\",\"payload\":{{\"type\":\"task_complete\",\"turn_id\":\"turn-{index}\",\"last_agent_message\":\"answer-{index}\"}}}}"
            ),
        ] {
            writeln!(rollout, "{line}")?;
        }
    }
    rollout.sync_all()?;

    let socket_path = directory.path().join("app-server.sock");
    let (observed, mut observed_rx) = mpsc::channel(4);
    let fake = tokio::spawn(run_idle_thread_app_server(socket_path.clone(), observed));
    let upstream = UpstreamHandle::spawn(socket_path);
    wait_for_live(&upstream).await?;
    let store = Arc::new(IndexStore::open(directory.path().join("state.redb"))?);
    let history = HistoryService::new(
        Arc::new(SessionCatalog::scan(directory.path())),
        store.clone(),
    );
    let sync = SyncHub::with_mutations(upstream, store.clone(), history);
    let (address, server_task) = start_server(store, sync).await?;
    let (mut client, _) = connect_client(&format!("ws://{address}/v1/sync"), None).await?;

    send_json(
        &mut client,
        &json!({
            "type": "rpc",
            "request": {
                "id": "history-after",
                "method": "companion/thread/history/after",
                "params": {"threadId": EXTERNAL_THREAD_ID, "afterTurnId": "turn-0", "limit": 1}
            }
        }),
    )
    .await?;
    let response = receive_type(&mut client, "rpc").await?;
    assert_eq!(response["response"]["result"]["data"][0]["id"], "turn-1");
    assert_eq!(response["response"]["result"]["hasMore"], true);
    let source_witness = response["response"]["result"]["sourceWitness"].clone();
    assert!(
        source_witness
            .as_str()
            .is_some_and(|value| !value.is_empty())
    );
    send_json(
        &mut client,
        &json!({
            "type": "rpc",
            "request": {
                "id": "history-before",
                "method": "companion/thread/history/before",
                "params": {"threadId": EXTERNAL_THREAD_ID, "beforeTurnId": "turn-2", "limit": 1,
                    "sourceWitness": source_witness}
            }
        }),
    )
    .await?;
    let before = receive_type(&mut client, "rpc").await?;
    assert_eq!(before["response"]["result"]["data"][0]["id"], "turn-1");
    assert_eq!(before["response"]["result"]["hasMore"], true);
    send_json(
        &mut client,
        &json!({
            "type": "rpc",
            "request": {
                "id": "history-missing",
                "method": "companion/thread/history/after",
                "params": {"threadId": EXTERNAL_THREAD_ID, "afterTurnId": "missing", "limit": 1}
            }
        }),
    )
    .await?;
    let expired = receive_type(&mut client, "rpc").await?;
    assert_eq!(expired["response"]["error"]["code"], -32021);
    assert!(
        timeout(Duration::from_millis(100), observed_rx.recv())
            .await
            .is_err(),
        "forward history pagination must stay on the canonical local index"
    );

    client.close(None).await?;
    server_task.abort();
    fake.abort();
    Ok(())
}

#[tokio::test]
async fn sync_auth_rpc_replay_and_forwarding() -> Result<(), Box<dyn std::error::Error>> {
    let directory = tempfile::tempdir()?;
    let socket_path = directory.path().join("app-server.sock");
    let (notifications, notification_rx) = mpsc::channel(4);
    let (observed, mut observed_rx) = mpsc::channel(8);
    let fake = tokio::spawn(run_fake_app_server(
        socket_path.clone(),
        notification_rx,
        observed,
    ));

    let upstream = UpstreamHandle::spawn(socket_path);
    wait_for_live(&upstream).await?;
    let store = Arc::new(IndexStore::open(directory.path().join("state.redb"))?);
    let catalog = SessionCatalog::scan(directory.path());
    let history = HistoryService::new(Arc::new(catalog), store.clone());
    let sync = SyncHub::with_mutations(upstream, store.clone(), history);
    let (address, server_task) = start_server(store.clone(), sync).await?;
    let url = format!("ws://{address}/v1/sync");

    let unauthorized = connect_async(url.as_str()).await;
    assert!(matches!(
        unauthorized,
        Err(tokio_tungstenite::tungstenite::Error::Http(response))
            if response.status() == StatusCode::UNAUTHORIZED
    ));

    let (mut first, _first_hello) = connect_client(&url, None).await?;
    let (mut second, _second_hello) = connect_client(&url, None).await?;

    send_json(
        &mut first,
        &json!({
            "type": "rpc",
            "request": {"id": "client-read", "method": "thread/list", "params": {"limit": 1}}
        }),
    )
    .await?;
    let response = receive_type(&mut first, "rpc").await?;
    assert_eq!(response["response"]["id"], "client-read");
    assert_eq!(response["response"]["result"]["data"][0]["id"], "thread-1");
    let observed_method = timeout(Duration::from_secs(1), observed_rx.recv())
        .await?
        .ok_or("fake App Server observation channel closed")?;
    assert_eq!(observed_method, "thread/list");

    verify_account_rate_limits_read(&mut first, &mut observed_rx).await?;

    send_json(
        &mut first,
        &json!({
            "type": "rpc",
            "request": {"id": "client-mutation", "method": "thread/delete", "params": {"threadId": "x"}}
        }),
    )
    .await?;
    let response = receive_type(&mut first, "rpc").await?;
    assert_eq!(response["response"]["id"], "client-mutation");
    assert_eq!(
        response["response"]["result"],
        json!({"data": [{"id": "thread-1"}]})
    );
    assert_eq!(
        timeout(Duration::from_secs(1), observed_rx.recv())
            .await?
            .as_deref(),
        Some("thread/delete")
    );

    let notification = json!({
        "method": "turn/started",
        "params": {"threadId": "thread-1", "turnId": "turn-1"}
    });
    notifications.send(notification.clone()).await?;
    let first_event = receive_type(&mut first, "event").await?;
    let second_event = receive_type(&mut second, "event").await?;
    assert_eq!(first_event["payload"]["method"], notification["method"]);
    assert_eq!(first_event["payload"]["params"], notification["params"]);
    assert_eq!(second_event["payload"], first_event["payload"]);
    assert_eq!(
        first_event["payload"]["codewideThreadPatch"]["operation"]["kind"],
        "turnStarted"
    );
    assert_eq!(first_event["cursor"], second_event["cursor"]);
    assert_eq!(
        store.replay_head()?,
        1,
        "one upstream event must be persisted once"
    );

    let mut third = verify_approval_flow(
        &notifications,
        &mut observed_rx,
        &store,
        &url,
        &mut first,
        &mut second,
    )
    .await?;

    first.close(None).await?;
    second.close(None).await?;
    third.close(None).await?;
    server_task.abort();
    fake.abort();
    Ok(())
}

#[tokio::test]
async fn user_messages_from_an_active_turn_and_another_desktop_thread_survive_reconnect()
-> Result<(), Box<dyn std::error::Error>> {
    let directory = tempfile::tempdir()?;
    let socket_path = directory.path().join("app-server.sock");
    let (notifications, notification_rx) = mpsc::channel(8);
    let (observed, mut observed_rx) = mpsc::channel(8);
    let fake = tokio::spawn(run_fake_app_server(
        socket_path.clone(),
        notification_rx,
        observed,
    ));
    let upstream = UpstreamHandle::spawn(socket_path);
    wait_for_live(&upstream).await?;
    let store = Arc::new(IndexStore::open(directory.path().join("state.redb"))?);
    let history = HistoryService::new(
        Arc::new(SessionCatalog::scan(directory.path())),
        store.clone(),
    );
    let sync = SyncHub::with_mutations(upstream, store.clone(), history);
    let (address, server_task) = start_server(store.clone(), sync).await?;
    let url = format!("ws://{address}/v1/sync");
    let (mut phone, _) = connect_client(&url, None).await?;

    send_json(
        &mut phone,
        &json!({
            "type": "rpc",
            "request": {
                "id": "sync-current",
                "method": "companion/thread/sync",
                "params": {"threadId": "current-thread", "afterTurnId": null, "limit": 36}
            }
        }),
    )
    .await?;
    let observed_response = receive_type(&mut phone, "rpc").await?;
    assert_eq!(
        observed_response["response"]["result"]["readModelVersion"],
        3
    );
    assert_eq!(observed_rx.recv().await.as_deref(), Some("thread/resume"));

    for (item_id, client_id, text) in [
        ("current-user-1", "android-first", "Test"),
        ("current-user-2", "android-second", "Test2"),
    ] {
        notifications
            .send(user_message_completed(
                "current-thread",
                "active-turn",
                item_id,
                client_id,
                text,
            ))
            .await?;
        let event = receive_type(&mut phone, "event").await?;
        assert_eq!(event["payload"]["params"]["item"]["clientId"], client_id);
        assert_eq!(
            event["payload"]["params"]["item"]["content"][0]["text"],
            text
        );
        assert_eq!(
            event["payload"]["codewideThreadPatch"]["threadId"],
            "current-thread"
        );
        assert_eq!(
            event["payload"]["codewideThreadPatch"]["operation"]["kind"],
            "itemUpsert"
        );
    }
    assert_eq!(store.replay_head()?, 2);
    phone.close(None).await?;

    notifications
        .send(user_message_completed(
            "other-thread",
            "desktop-turn",
            "desktop-user",
            "desktop-client",
            "Desktop follow-up",
        ))
        .await?;
    timeout(Duration::from_secs(2), async {
        while store.replay_head().ok() != Some(3) {
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    })
    .await?;

    let (mut reconnected, hello) = connect_replay_client(&url, 2).await?;
    assert_eq!(hello["headCursor"], 3);
    let replayed = receive_type(&mut reconnected, "event").await?;
    assert_eq!(replayed["cursor"], 3);
    assert_eq!(
        replayed["payload"]["codewideThreadPatch"]["threadId"],
        "other-thread"
    );
    assert_eq!(
        replayed["payload"]["params"]["item"]["content"][0]["text"],
        "Desktop follow-up"
    );
    assert_eq!(
        receive_type(&mut reconnected, "caughtUp").await?["cursor"],
        3
    );

    reconnected.close(None).await?;
    server_task.abort();
    fake.abort();
    Ok(())
}

#[tokio::test]
async fn completed_turn_replays_after_the_phone_was_offline()
-> Result<(), Box<dyn std::error::Error>> {
    let directory = tempfile::tempdir()?;
    let socket_path = directory.path().join("app-server.sock");
    let (notifications, notification_rx) = mpsc::channel(4);
    let (observed, _observed_rx) = mpsc::channel(4);
    let fake = tokio::spawn(run_fake_app_server(
        socket_path.clone(),
        notification_rx,
        observed,
    ));
    let upstream = UpstreamHandle::spawn(socket_path);
    wait_for_live(&upstream).await?;
    let store = Arc::new(IndexStore::open(directory.path().join("state.redb"))?);
    let history = HistoryService::new(
        Arc::new(SessionCatalog::scan(directory.path())),
        store.clone(),
    );
    let sync = SyncHub::with_mutations(upstream, store.clone(), history);
    let (address, server_task) = start_server(store.clone(), sync).await?;
    let url = format!("ws://{address}/v1/sync");
    let (mut phone, _) = connect_client(&url, None).await?;

    notifications
        .send(json!({
            "method": "turn/started",
            "params": {
                "threadId": "current-thread",
                "turn": {
                    "id": "active-turn",
                    "items": [],
                    "itemsView": "full",
                    "status": "inProgress",
                    "error": null,
                    "startedAt": 1,
                    "completedAt": null,
                    "durationMs": null
                }
            }
        }))
        .await?;
    let started = receive_type(&mut phone, "event").await?;
    assert_eq!(started["cursor"], 1);
    phone.close(None).await?;

    notifications
        .send(json!({
            "method": "turn/completed",
            "params": {
                "threadId": "current-thread",
                "turn": {
                    "id": "active-turn",
                    "items": [{
                        "id": "agent",
                        "type": "agentMessage",
                        "text": "Finished while offline",
                        "phase": "final_answer"
                    }],
                    "itemsView": "full",
                    "status": "completed",
                    "error": null,
                    "startedAt": 1,
                    "completedAt": 2,
                    "durationMs": 1
                }
            }
        }))
        .await?;
    timeout(Duration::from_secs(2), async {
        while store.replay_head().ok() != Some(2) {
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    })
    .await?;

    let (mut reconnected, hello) = connect_replay_client(&url, 1).await?;
    assert_eq!(hello["headCursor"], 2);
    let completed = receive_type(&mut reconnected, "event").await?;
    assert_eq!(completed["cursor"], 2);
    assert_eq!(completed["payload"]["method"], "turn/completed");
    assert_eq!(
        completed["payload"]["codewideThreadPatch"]["operation"]["kind"],
        "turnCompleted"
    );
    assert_eq!(
        completed["payload"]["params"]["turn"]["items"][0]["text"],
        "Finished while offline"
    );
    assert_eq!(
        receive_type(&mut reconnected, "caughtUp").await?["cursor"],
        2
    );

    reconnected.close(None).await?;
    server_task.abort();
    fake.abort();
    Ok(())
}

async fn verify_account_rate_limits_read(
    client: &mut ClientSocket,
    observed: &mut mpsc::Receiver<String>,
) -> Result<(), Box<dyn std::error::Error>> {
    send_json(
        client,
        &json!({
            "type": "rpc",
            "request": {"id": "rate-limits", "method": "account/rateLimits/read", "params": {}}
        }),
    )
    .await?;
    let rate_limits = receive_type(client, "rpc").await?;
    assert_eq!(rate_limits["response"]["id"], "rate-limits");
    assert_eq!(
        timeout(Duration::from_secs(1), observed.recv())
            .await?
            .ok_or("fake App Server observation channel closed")?,
        "account/rateLimits/read"
    );
    Ok(())
}

#[tokio::test]
async fn active_sync_forwards_mutations_and_pumps_durable_queue()
-> Result<(), Box<dyn std::error::Error>> {
    let directory = tempfile::tempdir()?;
    let socket_path = directory.path().join("app-server.sock");
    let (_notifications, notification_rx) = mpsc::channel(1);
    let (observed, mut observed_rx) = mpsc::channel(8);
    let fake = tokio::spawn(run_fake_app_server(
        socket_path.clone(),
        notification_rx,
        observed,
    ));
    let upstream = UpstreamHandle::spawn(socket_path);
    wait_for_live(&upstream).await?;
    let store = Arc::new(IndexStore::open(directory.path().join("state.redb"))?);
    let history = HistoryService::new(
        Arc::new(SessionCatalog::scan(directory.path())),
        store.clone(),
    );
    let sync = SyncHub::with_mutations(upstream, store.clone(), history);
    let (address, server_task) = start_server(store.clone(), sync).await?;
    let (mut client, _) = connect_client(&format!("ws://{address}/v1/sync"), None).await?;

    send_json(
        &mut client,
        &json!({
            "type": "rpc",
            "request": {
                "id": "queue-put",
                "method": "companion/queue/put",
                "params": {"command": {
                    "commandId": "message-1",
                    "remoteThreadId": "thread-1",
                    "method": "turn/start",
                    "params": {
                        "threadId": "thread-1",
                        "clientUserMessageId": "message-1",
                        "input": [{"type": "text", "text": "hello", "text_elements": []}]
                    }
                }}
            }
        }),
    )
    .await?;
    assert_eq!(
        receive_type(&mut client, "rpc").await?["response"]["id"],
        "queue-put"
    );
    assert_eq!(
        timeout(Duration::from_secs(2), observed_rx.recv())
            .await?
            .ok_or("observation channel closed")?,
        "thread/read"
    );
    assert_eq!(
        timeout(Duration::from_secs(2), observed_rx.recv())
            .await?
            .ok_or("observation channel closed")?,
        "turn/start"
    );
    timeout(Duration::from_secs(2), async {
        loop {
            if store
                .outbox_list(None)
                .ok()
                .and_then(|items| items.first().cloned())
                .is_some_and(|command| {
                    command.state == codewide_companion::store::OutboxState::Delivered
                })
            {
                return;
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    })
    .await?;

    send_json(
        &mut client,
        &json!({
            "type": "rpc",
            "request": {"id": "archive", "method": "thread/archive", "params": {"threadId": "thread-1"}}
        }),
    )
    .await?;
    assert_eq!(
        receive_type(&mut client, "rpc").await?["response"]["id"],
        "archive"
    );
    assert_eq!(observed_rx.recv().await.as_deref(), Some("thread/archive"));

    client.close(None).await?;
    server_task.abort();
    fake.abort();
    Ok(())
}

#[tokio::test]
async fn first_message_materializes_an_empty_new_thread() -> Result<(), Box<dyn std::error::Error>>
{
    let directory = tempfile::tempdir()?;
    let socket_path = directory.path().join("app-server.sock");
    let (observed, mut observed_rx) = mpsc::channel(8);
    let fake = tokio::spawn(run_empty_new_thread_app_server(
        socket_path.clone(),
        observed,
    ));
    let upstream = UpstreamHandle::spawn(socket_path);
    wait_for_live(&upstream).await?;
    let store = Arc::new(IndexStore::open(directory.path().join("state.redb"))?);
    let history = HistoryService::new(
        Arc::new(SessionCatalog::scan(directory.path())),
        store.clone(),
    );
    let sync = SyncHub::with_mutations(upstream, store.clone(), history);
    let (address, server_task) = start_server(store.clone(), sync).await?;
    let (mut client, _) = connect_client(&format!("ws://{address}/v1/sync"), None).await?;

    send_json(
        &mut client,
        &json!({
            "type": "rpc",
            "request": {
                "id": "queue-first-message",
                "method": "companion/queue/put",
                "params": {"command": {
                    "commandId": "first-message",
                    "remoteThreadId": "empty-thread",
                    "method": "turn/start",
                    "presentation": "delivery",
                    "params": {
                        "threadId": "empty-thread",
                        "clientUserMessageId": "first-message",
                        "input": [{"type": "text", "text": "hello", "text_elements": []}]
                    }
                }}
            }
        }),
    )
    .await?;
    assert_eq!(
        receive_type(&mut client, "rpc").await?["response"]["id"],
        "queue-first-message"
    );
    assert_eq!(
        timeout(Duration::from_secs(2), observed_rx.recv())
            .await?
            .ok_or("first turn was not started")?,
        "turn/start"
    );
    timeout(Duration::from_secs(2), async {
        loop {
            if store
                .outbox_list(None)
                .ok()
                .and_then(|items| items.first().cloned())
                .is_some_and(|command| {
                    command.state == codewide_companion::store::OutboxState::Delivered
                })
            {
                return;
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    })
    .await?;
    assert!(
        timeout(Duration::from_millis(300), observed_rx.recv())
            .await
            .is_err(),
        "the accepted first message must not enter a read retry loop"
    );

    client.close(None).await?;
    server_task.abort();
    fake.abort();
    Ok(())
}

#[tokio::test]
async fn queued_messages_reach_app_server_in_order_after_lifecycle_checks()
-> Result<(), Box<dyn std::error::Error>> {
    let directory = tempfile::tempdir()?;
    let socket_path = directory.path().join("app-server.sock");
    let (observed, mut observed_rx) = mpsc::channel(16);
    let active = Arc::new(AtomicBool::new(false));
    let fake = tokio::spawn(run_ordered_queue_app_server(
        socket_path.clone(),
        observed,
        active,
        "idle",
    ));
    let upstream = UpstreamHandle::spawn(socket_path);
    wait_for_live(&upstream).await?;
    let store = Arc::new(IndexStore::open(directory.path().join("state.redb"))?);
    let history = HistoryService::new(
        Arc::new(SessionCatalog::scan(directory.path())),
        store.clone(),
    );
    let sync = SyncHub::with_mutations(upstream, store.clone(), history);
    let (address, server_task) = start_server(store, sync).await?;
    let (mut client, _) = connect_client(&format!("ws://{address}/v1/sync"), None).await?;

    for command_id in ["first-message", "second-message"] {
        send_json(
            &mut client,
            &json!({
                "type": "rpc",
                "request": {
                    "id": format!("queue-{command_id}"),
                    "method": "companion/queue/put",
                    "params": {"command": {
                        "commandId": command_id,
                        "remoteThreadId": "thread-1",
                        "method": "turn/start",
                        "params": {
                            "threadId": "thread-1",
                            "clientUserMessageId": command_id,
                            "input": [{"type": "text", "text": command_id, "text_elements": []}]
                        }
                    }}
                }
            }),
        )
        .await?;
        let _ = receive_type(&mut client, "rpc").await?;
    }
    assert_eq!(
        timeout(Duration::from_millis(250), observed_rx.recv())
            .await?
            .ok_or("first queued turn was not forwarded")?,
        "first-message"
    );
    assert_eq!(
        timeout(Duration::from_secs(2), observed_rx.recv())
            .await?
            .ok_or("second queued turn was not forwarded")?,
        "second-message"
    );
    assert!(
        timeout(Duration::from_millis(100), observed_rx.recv())
            .await
            .is_err(),
        "the outbox must not forward another turn"
    );

    client.close(None).await?;
    server_task.abort();
    fake.abort();
    Ok(())
}

#[tokio::test]
async fn explicit_queue_follows_authoritative_lifecycle_when_rollout_is_stale()
-> Result<(), Box<dyn std::error::Error>> {
    assert_explicit_queue_recovers("idle").await
}

#[tokio::test]
async fn explicit_queue_recovers_after_failed_turn_when_server_accepts_input()
-> Result<(), Box<dyn std::error::Error>> {
    assert_explicit_queue_recovers("systemError").await
}

async fn assert_explicit_queue_recovers(
    terminal_status: &'static str,
) -> Result<(), Box<dyn std::error::Error>> {
    let directory = tempfile::tempdir()?;
    let sessions = directory.path().join("sessions/2026/08/17");
    std::fs::create_dir_all(&sessions)?;
    let path = sessions.join(format!(
        "rollout-2026-08-17T00-00-00-{EXTERNAL_THREAD_ID}.jsonl"
    ));
    let mut rollout = std::fs::File::create(path)?;
    writeln!(
        rollout,
        r#"{{"type":"event_msg","payload":{{"type":"task_started","turn_id":"active-turn","started_at":10}}}}"#
    )?;
    rollout.sync_all()?;

    let socket_path = directory.path().join("app-server.sock");
    let (observed, mut observed_rx) = mpsc::channel(8);
    let active = Arc::new(AtomicBool::new(true));
    let fake = tokio::spawn(run_ordered_queue_app_server(
        socket_path.clone(),
        observed,
        active.clone(),
        terminal_status,
    ));
    let upstream = UpstreamHandle::spawn(socket_path);
    wait_for_live(&upstream).await?;
    let store = Arc::new(IndexStore::open(directory.path().join("state.redb"))?);
    let history = HistoryService::new(
        Arc::new(SessionCatalog::scan(directory.path())),
        store.clone(),
    );
    let sync = SyncHub::with_mutations(upstream, store.clone(), history);
    let (address, server_task) = start_server(store, sync).await?;
    let (mut client, _) = connect_client(&format!("ws://{address}/v1/sync"), None).await?;

    send_json(
        &mut client,
        &json!({
            "type": "rpc",
            "request": {
                "id": "queue-next-turn",
                "method": "companion/queue/put",
                "params": {"command": {
                    "commandId": "next-turn",
                    "remoteThreadId": EXTERNAL_THREAD_ID,
                    "method": "turn/start",
                    "presentation": "queue",
                    "params": {
                        "threadId": EXTERNAL_THREAD_ID,
                        "clientUserMessageId": "next-turn",
                        "input": [{"type": "text", "text": "after", "text_elements": []}]
                    }
                }}
            }
        }),
    )
    .await?;
    let _ = receive_type(&mut client, "rpc").await?;
    let queued = receive_type(&mut client, "event").await?;
    assert_eq!(queued["payload"]["method"], "companion/queue/changed");
    assert_eq!(
        queued["payload"]["params"]["data"][0]["commandId"],
        "next-turn"
    );
    assert_eq!(queued["payload"]["params"]["data"][0]["state"], "queued");
    assert!(
        timeout(Duration::from_millis(300), observed_rx.recv())
            .await
            .is_err(),
        "an explicit queue item must not become a steer while App Server reports active"
    );

    active.store(false, Ordering::Release);
    assert_eq!(
        timeout(Duration::from_secs(2), observed_rx.recv())
            .await?
            .ok_or("queued turn was not released after App Server permitted input")?,
        "next-turn"
    );
    timeout(Duration::from_secs(2), async {
        loop {
            let event = receive_type(&mut client, "event").await?;
            if event["payload"]["method"] == "companion/queue/changed"
                && event["payload"]["params"]["data"][0]["state"] == "delivered"
            {
                return Ok::<(), Box<dyn std::error::Error>>(());
            }
        }
    })
    .await??;

    client.close(None).await?;
    server_task.abort();
    fake.abort();
    Ok(())
}

#[tokio::test]
async fn queued_message_rehydrates_missing_thread_before_one_safe_retry()
-> Result<(), Box<dyn std::error::Error>> {
    let directory = tempfile::tempdir()?;
    let socket_path = directory.path().join("app-server.sock");
    let (observed, mut observed_rx) = mpsc::channel(8);
    let fake = tokio::spawn(run_missing_thread_app_server(socket_path.clone(), observed));
    let upstream = UpstreamHandle::spawn(socket_path);
    wait_for_live(&upstream).await?;
    let store = Arc::new(IndexStore::open(directory.path().join("state.redb"))?);
    let history = HistoryService::new(
        Arc::new(SessionCatalog::scan(directory.path())),
        store.clone(),
    );
    let sync = SyncHub::with_mutations(upstream, store.clone(), history);
    let (address, server_task) = start_server(store.clone(), sync).await?;
    let (mut client, _) = connect_client(&format!("ws://{address}/v1/sync"), None).await?;

    send_json(
        &mut client,
        &json!({
            "type": "rpc",
            "request": {
                "id": "queue-missing-thread",
                "method": "companion/queue/put",
                "params": {"command": {
                    "commandId": "message-after-reconnect",
                    "remoteThreadId": "thread-1",
                    "method": "turn/start",
                    "params": {
                        "threadId": "thread-1",
                        "clientUserMessageId": "message-after-reconnect",
                        "input": [{"type": "text", "text": "continue", "text_elements": []}]
                    }
                }}
            }
        }),
    )
    .await?;
    let _ = receive_type(&mut client, "rpc").await?;

    let lifecycle = timeout(Duration::from_secs(2), observed_rx.recv())
        .await?
        .ok_or("thread lifecycle read missing")?;
    let first = timeout(Duration::from_secs(2), observed_rx.recv())
        .await?
        .ok_or("initial turn/start missing")?;
    let resume = timeout(Duration::from_secs(2), observed_rx.recv())
        .await?
        .ok_or("thread/resume missing")?;
    let retry = timeout(Duration::from_secs(2), observed_rx.recv())
        .await?
        .ok_or("retried turn/start missing")?;
    assert_eq!(lifecycle["method"], "thread/read");
    assert_eq!(lifecycle["params"]["includeTurns"], false);
    assert_eq!(first["method"], "turn/start");
    assert_eq!(resume["method"], "thread/resume");
    assert_eq!(
        resume["params"],
        json!({"threadId": "thread-1", "excludeTurns": true})
    );
    assert_eq!(retry["method"], "turn/start");
    assert_eq!(retry["params"], first["params"]);

    timeout(Duration::from_secs(2), async {
        loop {
            if store
                .outbox_list(Some("thread-1"))
                .ok()
                .and_then(|commands| commands.first().cloned())
                .is_some_and(|command| {
                    command.state == codewide_companion::store::OutboxState::Delivered
                })
            {
                return;
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    })
    .await?;
    assert!(
        timeout(Duration::from_millis(200), observed_rx.recv())
            .await
            .is_err(),
        "only the conclusively rejected start may be retried"
    );

    client.close(None).await?;
    server_task.abort();
    fake.abort();
    Ok(())
}

#[tokio::test]
async fn durable_queue_prepares_remote_files_and_broadcasts_delivery()
-> Result<(), Box<dyn std::error::Error>> {
    let directory = tempfile::tempdir()?;
    let socket_path = directory.path().join("app-server.sock");
    let attachment_root = directory.path().join("attachments");
    tokio::fs::create_dir(&attachment_root).await?;
    tokio::fs::write(attachment_root.join("screen.png"), b"png").await?;
    let canonical_image = tokio::fs::canonicalize(attachment_root.join("screen.png")).await?;
    let (observed, mut observed_rx) = mpsc::channel(8);
    let fake = tokio::spawn(run_remote_file_app_server(socket_path.clone(), observed));
    let upstream = UpstreamHandle::spawn(socket_path);
    wait_for_live(&upstream).await?;
    let store = Arc::new(IndexStore::open(directory.path().join("state.redb"))?);
    let history = HistoryService::new(
        Arc::new(SessionCatalog::scan(directory.path())),
        store.clone(),
    );
    let files = Arc::new(
        FileService::open(
            HashMap::from([("attachments".into(), attachment_root)]),
            Vec::new(),
            None,
            None,
        )
        .await?,
    );
    let sync = SyncHub::with_mutations(upstream, store.clone(), history).with_files(files);
    let (address, server_task) = start_server(store, sync).await?;
    let (mut client, _) = connect_client(&format!("ws://{address}/v1/sync"), None).await?;

    send_json(
        &mut client,
        &json!({
            "type": "rpc",
            "request": {
                "id": "direct-image",
                "method": "turn/start",
                "params": {
                    "threadId": "thread-direct",
                    "clientUserMessageId": "message-direct",
                    "input": [
                        {"type": "text", "text": "direct", "text_elements": []},
                        {"type": "remoteFile", "rootId": "attachments", "path": "screen.png", "name": "screen", "kind": "image"}
                    ]
                }
            }
        }),
    )
    .await?;
    assert_eq!(
        receive_type(&mut client, "rpc").await?["response"]["id"],
        "direct-image"
    );
    let direct = timeout(Duration::from_secs(2), observed_rx.recv())
        .await?
        .ok_or("direct turn start missing")?;
    assert_eq!(direct["method"], "turn/start");
    assert_eq!(
        direct["params"]["input"][1],
        json!({"type": "localImage", "path": canonical_image})
    );

    send_json(
        &mut client,
        &json!({
            "type": "rpc",
            "request": {
                "id": "queue-image",
                "method": "companion/queue/put",
                "params": {"command": {
                    "commandId": "message-image",
                    "remoteThreadId": "thread-1",
                    "method": "turn/start",
                    "params": {
                        "threadId": "thread-1",
                        "clientUserMessageId": "message-image",
                        "input": [
                            {"type": "text", "text": "look", "text_elements": []},
                            {"type": "remoteFile", "rootId": "attachments", "path": "screen.png", "name": "screen", "kind": "image"}
                        ]
                    }
                }}
            }
        }),
    )
    .await?;
    assert_eq!(
        receive_type(&mut client, "rpc").await?["response"]["id"],
        "queue-image"
    );
    let lifecycle = timeout(Duration::from_secs(2), observed_rx.recv())
        .await?
        .ok_or("thread lifecycle read missing")?;
    let start = timeout(Duration::from_secs(2), observed_rx.recv())
        .await?
        .ok_or("turn start missing")?;
    assert_eq!(lifecycle["method"], "thread/read");
    assert_eq!(lifecycle["params"]["includeTurns"], false);
    assert_eq!(start["method"], "turn/start");
    assert_eq!(
        start["params"]["input"][1],
        json!({"type": "localImage", "path": canonical_image})
    );

    timeout(Duration::from_secs(2), async {
        loop {
            let event = receive_type(&mut client, "event").await?;
            if event["payload"]["method"] == "companion/queue/changed"
                && event["payload"]["params"]["data"][0]["state"] == "delivered"
            {
                return Ok::<(), Box<dyn std::error::Error>>(());
            }
        }
    })
    .await??;

    client.close(None).await?;
    server_task.abort();
    fake.abort();
    Ok(())
}

#[tokio::test]
async fn direct_turn_retry_returns_the_existing_turn_without_duplicate_send()
-> Result<(), Box<dyn std::error::Error>> {
    let directory = tempfile::tempdir()?;
    let socket_path = directory.path().join("app-server.sock");
    let (observed, mut observed_rx) = mpsc::channel(8);
    let fake = tokio::spawn(run_idempotent_retry_app_server(
        socket_path.clone(),
        observed,
    ));
    let upstream = UpstreamHandle::spawn(socket_path);
    wait_for_live(&upstream).await?;
    let store = Arc::new(IndexStore::open(directory.path().join("state.redb"))?);
    let history = HistoryService::new(
        Arc::new(SessionCatalog::scan(directory.path())),
        store.clone(),
    );
    let sync = SyncHub::with_mutations(upstream, store.clone(), history);
    let (address, server_task) = start_server(store, sync).await?;
    let (mut client, _) = connect_client(&format!("ws://{address}/v1/sync"), None).await?;
    let params = json!({
        "threadId": "thread-1",
        "clientUserMessageId": "stable-message",
        "input": [{"type": "text", "text": "once", "text_elements": []}]
    });

    for request_id in ["first", "retry"] {
        send_json(
            &mut client,
            &json!({
                "type": "rpc",
                "request": {"id": request_id, "method": "turn/start", "params": params}
            }),
        )
        .await?;
        let response = receive_type(&mut client, "rpc").await?;
        assert_eq!(response["response"]["id"], request_id);
        assert_eq!(response["response"]["result"]["turn"]["id"], "turn-1");
    }

    let mut methods = Vec::new();
    for _ in 0..2 {
        methods.push(
            timeout(Duration::from_secs(2), observed_rx.recv())
                .await?
                .ok_or("observation channel closed")?,
        );
    }
    assert_eq!(methods, ["turn/start", "thread/turns/list"]);
    assert!(
        timeout(Duration::from_millis(200), observed_rx.recv())
            .await
            .is_err()
    );

    client.close(None).await?;
    server_task.abort();
    fake.abort();
    Ok(())
}

#[tokio::test]
async fn ambiguous_turn_delivery_never_reads_or_repeats_upstream()
-> Result<(), Box<dyn std::error::Error>> {
    let directory = tempfile::tempdir()?;
    let socket_path = directory.path().join("app-server.sock");
    let (observed, mut observed_rx) = mpsc::channel(8);
    let fake = tokio::spawn(run_ambiguous_app_server(socket_path.clone(), observed));
    let upstream = UpstreamHandle::spawn(socket_path);
    wait_for_live(&upstream).await?;
    let store = Arc::new(IndexStore::open(directory.path().join("state.redb"))?);
    let history = HistoryService::new(
        Arc::new(SessionCatalog::scan(directory.path())),
        store.clone(),
    );
    let sync = SyncHub::with_mutations(upstream, store.clone(), history);
    let (address, server_task) = start_server(store.clone(), sync).await?;
    let (mut client, _) = connect_client(&format!("ws://{address}/v1/sync"), None).await?;
    send_json(
        &mut client,
        &json!({
            "type": "rpc",
            "request": {
                "id": "queue-put",
                "method": "companion/queue/put",
                "params": {"command": {
                    "commandId": "ambiguous-1",
                    "remoteThreadId": "thread-1",
                    "method": "turn/start",
                    "params": {
                        "threadId": "thread-1",
                        "clientUserMessageId": "ambiguous-1",
                        "input": [{"type": "text", "text": "once", "text_elements": []}]
                    }
                }}
            }
        }),
    )
    .await?;
    let _ = receive_type(&mut client, "rpc").await?;
    assert_eq!(
        timeout(Duration::from_secs(2), observed_rx.recv())
            .await?
            .ok_or("thread lifecycle read was not forwarded")?,
        "thread/read"
    );
    assert_eq!(
        timeout(Duration::from_secs(2), observed_rx.recv())
            .await?
            .ok_or("turn/start was not forwarded")?,
        "turn/start"
    );
    timeout(Duration::from_secs(2), async {
        loop {
            if store
                .outbox_list(None)
                .ok()
                .and_then(|items| items.first().cloned())
                .is_some_and(|command| {
                    command.state == codewide_companion::store::OutboxState::Uncertain
                })
            {
                return;
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    })
    .await?;
    assert!(
        timeout(Duration::from_millis(750), observed_rx.recv())
            .await
            .is_err()
    );

    client.close(None).await?;
    server_task.abort();
    fake.abort();
    Ok(())
}

async fn verify_approval_flow(
    notifications: &mpsc::Sender<Value>,
    observed: &mut mpsc::Receiver<String>,
    store: &IndexStore,
    url: &str,
    first: &mut ClientSocket,
    second: &mut ClientSocket,
) -> Result<ClientSocket, Box<dyn std::error::Error>> {
    let approval = json!({
        "id": "approval-1",
        "method": "item/commandExecution/requestApproval",
        "params": {"command": "safe-test"}
    });
    notifications.send(approval.clone()).await?;
    assert_eq!(receive_type(first, "event").await?["payload"], approval);
    assert_eq!(receive_type(second, "event").await?["payload"], approval);
    let (third, third_hello) = connect_client(url, None).await?;
    assert_eq!(
        third_hello["pendingRequests"].as_array().map(Vec::len),
        Some(1)
    );
    assert_eq!(third_hello["pendingRequests"][0], approval);

    send_json(
        first,
        &json!({
            "type": "serverResponse",
            "response": {"id": "approval-1", "result": {"decision": "accept"}}
        }),
    )
    .await?;
    assert_eq!(
        receive_type(first, "serverResponseAccepted").await?["id"],
        "approval-1"
    );
    let observed_response = timeout(Duration::from_secs(1), observed.recv())
        .await?
        .ok_or("fake App Server observation channel closed")?;
    assert_eq!(observed_response, "serverResponse");
    assert_eq!(
        receive_type(first, "event").await?["payload"]["method"],
        "serverRequest/resolved"
    );

    send_json(
        second,
        &json!({
            "type": "serverResponse",
            "response": {"id": "approval-1", "result": {"decision": "accept"}}
        }),
    )
    .await?;
    assert_eq!(
        receive_type(second, "serverResponseRejected").await?["reason"],
        "already_resolved_or_unknown"
    );
    assert_eq!(store.replay_head()?, 3);
    Ok(third)
}

async fn start_server(
    store: Arc<IndexStore>,
    sync: SyncHub,
) -> Result<(std::net::SocketAddr, JoinHandle<()>), Box<dyn std::error::Error>> {
    let listener = TcpListener::bind("127.0.0.1:0").await?;
    let address = listener.local_addr()?;
    let app = server::router(store, Arc::from(TOKEN), sync);
    let task = tokio::spawn(async move {
        let _ = axum::serve(listener, app).await;
    });
    Ok((address, task))
}

async fn connect_client(
    url: &str,
    cursor: Option<u64>,
) -> Result<(ClientSocket, Value), Box<dyn std::error::Error>> {
    let mut request = url.into_client_request()?;
    request.headers_mut().insert(
        "authorization",
        HeaderValue::from_str(&format!("Bearer {TOKEN}"))?,
    );
    let (mut socket, _response) = connect_async(request).await?;
    send_json(
        &mut socket,
        &json!({"type": "hello", "protocolVersion": 1, "cursor": cursor}),
    )
    .await?;
    let hello = receive_type(&mut socket, "hello").await?;
    let _status = receive_type(&mut socket, "status").await?;
    send_json(
        &mut socket,
        &json!({"type": "snapshotApplied", "cursor": hello["headCursor"]}),
    )
    .await?;
    let replay_hello = receive_type(&mut socket, "hello").await?;
    assert_eq!(replay_hello["snapshotRequired"], false);
    let caught_up = receive_type(&mut socket, "caughtUp").await?;
    assert_eq!(caught_up["cursor"], replay_hello["headCursor"]);
    Ok((socket, hello))
}

async fn connect_replay_client(
    url: &str,
    cursor: u64,
) -> Result<(ClientSocket, Value), Box<dyn std::error::Error>> {
    let mut request = url.into_client_request()?;
    request.headers_mut().insert(
        "authorization",
        HeaderValue::from_str(&format!("Bearer {TOKEN}"))?,
    );
    let (mut socket, _response) = connect_async(request).await?;
    send_json(
        &mut socket,
        &json!({"type": "hello", "protocolVersion": 1, "cursor": cursor}),
    )
    .await?;
    let hello = receive_type(&mut socket, "hello").await?;
    assert_eq!(hello["snapshotRequired"], false);
    assert_eq!(receive_type(&mut socket, "status").await?["status"], "live");
    Ok((socket, hello))
}

fn user_message_completed(
    thread_id: &str,
    turn_id: &str,
    item_id: &str,
    client_id: &str,
    text: &str,
) -> Value {
    json!({
        "method": "item/completed",
        "params": {
            "threadId": thread_id,
            "turnId": turn_id,
            "item": {
                "type": "userMessage",
                "id": item_id,
                "clientId": client_id,
                "content": [{"type": "text", "text": text, "text_elements": []}]
            }
        }
    })
}

async fn receive_type<S>(
    socket: &mut WebSocketStream<S>,
    expected_type: &str,
) -> Result<Value, Box<dyn std::error::Error>>
where
    S: tokio::io::AsyncRead + tokio::io::AsyncWrite + Unpin,
{
    timeout(Duration::from_secs(2), async {
        loop {
            let frame = socket.next().await.ok_or("WebSocket closed")??;
            if let Message::Text(raw) = frame {
                let value: Value = serde_json::from_str(&raw)?;
                if value.get("type").and_then(Value::as_str) == Some(expected_type) {
                    return Ok(value);
                }
            }
        }
    })
    .await?
}

async fn send_json<S>(
    socket: &mut WebSocketStream<S>,
    value: &Value,
) -> Result<(), Box<dyn std::error::Error>>
where
    S: tokio::io::AsyncRead + tokio::io::AsyncWrite + Unpin,
{
    socket.send(Message::Text(value.to_string().into())).await?;
    Ok(())
}

async fn wait_for_live(upstream: &UpstreamHandle) -> Result<(), Box<dyn std::error::Error>> {
    let mut status = upstream.subscribe_status();
    timeout(Duration::from_secs(2), async {
        loop {
            if *status.borrow() == ConnectionStatus::Live {
                return Ok(());
            }
            status
                .changed()
                .await
                .map_err(|_| "status channel closed")?;
        }
    })
    .await?
}

async fn run_external_thread_app_server(
    socket_path: PathBuf,
    observed: mpsc::Sender<String>,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let listener = UnixListener::bind(socket_path)?;
    let (stream, _) = listener.accept().await?;
    let mut socket = accept_initialized(stream).await?;
    while let Some(frame) = socket.next().await {
        let frame = frame?;
        let Message::Text(raw) = frame else {
            continue;
        };
        let request: Value = serde_json::from_str(&raw)?;
        let method = request
            .get("method")
            .and_then(Value::as_str)
            .unwrap_or_default();
        observed.send(method.to_owned()).await?;
        let result = match method {
            "thread/read" => json!({
                "thread": {
                    "id": EXTERNAL_THREAD_ID,
                    "name": "External thread",
                    "recencyAt": 10,
                    "status": {"type": "active", "activeFlags": []},
                    "turns": []
                }
            }),
            "thread/resume" => json!({
                "thread": {
                    "id": EXTERNAL_THREAD_ID,
                    "name": "External thread",
                    "recencyAt": 10,
                    "status": {"type": "active", "activeFlags": []},
                    "turns": []
                },
                "model": "gpt-test",
                "reasoningEffort": "high",
                "approvalPolicy": "never",
                "sandbox": {"type": "dangerFullAccess"}
            }),
            "thread/turns/list"
                if request.pointer("/params/itemsView").and_then(Value::as_str) == Some("full") =>
            {
                json!({
                    "data": [{
                        "id": "new-turn",
                        "status": "inProgress",
                        "startedAt": 10,
                        "completedAt": null,
                        "itemsView": "full",
                        "items": [
                            {"type": "userMessage", "id": "user-new", "content": [{"type": "text", "text": "new question"}]},
                            {"type": "commandExecution", "id": "command-new", "command": "pnpm test", "status": "completed", "aggregatedOutput": "passed"},
                            {"type": "agentMessage", "id": "agent-new", "text": "working", "phase": null},
                            {"type": "userMessage", "id": "user-desktop-follow-up", "clientId": "desktop-client", "content": [{"type": "text", "text": "desktop follow-up"}]}
                        ]
                    }],
                    "nextCursor": null,
                    "backwardsCursor": null
                })
            }
            "thread/turns/list" => json!({
                "data": [{
                    "id": "new-turn",
                    "status": "inProgress",
                    "startedAt": 10,
                    "completedAt": null,
                    "itemsView": "summary",
                    "items": [
                        {"type": "userMessage", "id": "user-new", "content": [{"type": "text", "text": "new question"}]},
                        {"type": "agentMessage", "id": "agent-new", "text": "working", "phase": null}
                    ],
                    "codewide": {"activity": {"count": 1, "kinds": ["commandExecution"]}}
                }],
                "nextCursor": null,
                "backwardsCursor": null
            }),
            _ => json!({}),
        };
        send_value(
            &mut socket,
            &json!({"id": request["id"].clone(), "result": result}),
        )
        .await?;
    }
    Ok(())
}

async fn run_idle_thread_app_server(
    socket_path: PathBuf,
    observed: mpsc::Sender<String>,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    run_thread_shell_app_server(socket_path, observed, None).await
}

async fn run_thread_shell_app_server(
    socket_path: PathBuf,
    observed: mpsc::Sender<String>,
    resume_error: Option<&'static str>,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let listener = UnixListener::bind(socket_path)?;
    let (stream, _) = listener.accept().await?;
    let mut socket = accept_initialized(stream).await?;
    while let Some(frame) = socket.next().await {
        let Message::Text(raw) = frame? else {
            continue;
        };
        let request: Value = serde_json::from_str(&raw)?;
        let method = request
            .get("method")
            .and_then(Value::as_str)
            .unwrap_or_default();
        observed.send(method.to_owned()).await?;
        if method == "thread/resume"
            && let Some(message) = resume_error
        {
            send_value(
                &mut socket,
                &json!({"id": request["id"], "error": {"code": -32600, "message": message}}),
            )
            .await?;
            continue;
        }
        if method == "thread/read" {
            assert_eq!(request["params"]["threadId"], EXTERNAL_THREAD_ID);
            assert_eq!(request["params"]["includeTurns"], false);
        }
        let result = if matches!(method, "thread/read" | "thread/resume") {
            json!({
                "thread": {
                    "id": EXTERNAL_THREAD_ID,
                    "name": "Indexed thread",
                    "recencyAt": 10,
                    "status": {"type": if resume_error.is_some() { "notLoaded" } else { "idle" }},
                    "turns": []
                }
            })
        } else {
            json!({})
        };
        send_value(
            &mut socket,
            &json!({"id": request["id"].clone(), "result": result}),
        )
        .await?;
    }
    Ok(())
}

async fn run_out_of_order_app_server(
    socket_path: PathBuf,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let listener = UnixListener::bind(socket_path)?;
    let (stream, _) = listener.accept().await?;
    let mut socket = accept_initialized(stream).await?;
    let mut slow_id = None;
    while let Some(frame) = socket.next().await {
        let Message::Text(raw) = frame? else {
            continue;
        };
        let request: Value = serde_json::from_str(&raw)?;
        let id = request.get("id").cloned().unwrap_or(Value::Null);
        match request.get("method").and_then(Value::as_str) {
            Some("thread/list") => slow_id = Some(id),
            Some("config/read") => {
                send_value(&mut socket, &json!({"id": id, "result": {"fast": true}})).await?;
                let id = slow_id
                    .take()
                    .ok_or("slow request was not forwarded first")?;
                send_value(&mut socket, &json!({"id": id, "result": {"data": []}})).await?;
            }
            _ => send_value(&mut socket, &json!({"id": id, "result": {}})).await?,
        }
    }
    Ok(())
}

async fn run_out_of_order_thread_mutation_app_server(
    socket_path: PathBuf,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let listener = UnixListener::bind(socket_path)?;
    let (stream, _) = listener.accept().await?;
    let mut socket = accept_initialized(stream).await?;
    let mut slow_id = None;
    while let Some(frame) = socket.next().await {
        let Message::Text(raw) = frame? else {
            continue;
        };
        let request: Value = serde_json::from_str(&raw)?;
        let id = request.get("id").cloned().unwrap_or(Value::Null);
        match request.pointer("/params/threadId").and_then(Value::as_str) {
            Some("thread-a") => slow_id = Some(id),
            Some("thread-b") => {
                send_value(&mut socket, &json!({"id": id, "result": {}})).await?;
                let id = slow_id
                    .take()
                    .ok_or("thread-a mutation was not forwarded first")?;
                send_value(&mut socket, &json!({"id": id, "result": {}})).await?;
            }
            _ => send_value(&mut socket, &json!({"id": id, "result": {}})).await?,
        }
    }
    Ok(())
}

async fn run_passthrough_app_server(
    socket_path: PathBuf,
    observed: mpsc::Sender<Value>,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let listener = UnixListener::bind(socket_path)?;
    let (stream, _) = listener.accept().await?;
    let mut socket = accept_initialized(stream).await?;
    while let Some(frame) = socket.next().await {
        let Message::Text(raw) = frame? else {
            continue;
        };
        let request: Value = serde_json::from_str(&raw)?;
        let response = if request["method"] == "future/missing" {
            json!({"id": request["id"], "error": {
                "code": -32601,
                "message": "Unknown method at App Server",
                "data": {"source": "upstream"}
            }})
        } else {
            json!({"id": request["id"], "result": {
                "method": request["method"], "params": request["params"]
            }})
        };
        observed.send(request).await?;
        send_value(&mut socket, &response).await?;
    }
    Ok(())
}

async fn run_fake_app_server(
    socket_path: PathBuf,
    mut notifications: mpsc::Receiver<Value>,
    observed: mpsc::Sender<String>,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let listener = UnixListener::bind(socket_path)?;
    let (stream, _) = listener.accept().await?;
    let mut socket = accept_async::<UnixStream>(stream).await?;
    let initialize = receive_value(&mut socket).await?;
    let initialize_id = initialize
        .get("id")
        .cloned()
        .ok_or("initialize id missing")?;
    send_value(&mut socket, &json!({"id": initialize_id, "result": {}})).await?;
    let initialized = receive_value(&mut socket).await?;
    if initialized.get("method").and_then(Value::as_str) != Some("initialized") {
        return Err("initialized notification missing".into());
    }

    loop {
        tokio::select! {
            notification = notifications.recv() => {
                let Some(notification) = notification else { return Ok(()); };
                send_value(&mut socket, &notification).await?;
            }
            frame = socket.next() => {
                let Some(frame) = frame else { return Ok(()); };
                let frame = frame?;
                let Message::Text(raw) = frame else { continue; };
                let request: Value = serde_json::from_str(&raw)?;
                let method = request.get("method").and_then(Value::as_str);
                if method.is_none()
                    && request.get("id").is_some()
                    && (request.get("result").is_some() || request.get("error").is_some())
                {
                    observed.send("serverResponse".into()).await?;
                    continue;
                }
                observed.send(method.unwrap_or_default().to_owned()).await?;
                let id = request.get("id").cloned().unwrap_or(Value::Null);
                let result = if method == Some("thread/turns/list")
                    && request.pointer("/params/itemsView").and_then(Value::as_str) == Some("full")
                {
                    json!({
                        "data": [{
                            "id": "active-turn",
                            "items": [],
                            "itemsView": "full",
                            "status": "inProgress",
                            "error": null,
                            "startedAt": 1,
                            "completedAt": null,
                            "durationMs": null
                        }],
                        "nextCursor": null
                    })
                } else if method == Some("thread/turns/list") {
                    json!({
                        "data": [{
                            "id": "active-turn",
                            "items": [],
                            "itemsView": "summary",
                            "status": "inProgress",
                            "error": null,
                            "startedAt": 1,
                            "completedAt": null,
                            "durationMs": null
                        }],
                        "nextCursor": null
                    })
                } else if method == Some("thread/read") {
                    json!({
                        "thread": {
                            "id": request.pointer("/params/threadId").and_then(Value::as_str).unwrap_or("thread-1"),
                            "status": {"type": "idle"},
                            "turns": []
                        }
                    })
                } else if method == Some("thread/resume") {
                    json!({
                        "thread": {
                            "id": request.pointer("/params/threadId").and_then(Value::as_str).unwrap_or("current-thread"),
                            "status": {"type": "active", "activeFlags": []},
                            "turns": []
                        }
                    })
                } else if method == Some("turn/start") {
                    json!({"turn": {"id": "turn-1", "status": "inProgress", "items": []}})
                } else {
                    json!({"data": [{"id": "thread-1"}]})
                };
                send_value(&mut socket, &json!({"id": id, "result": result})).await?;
            }
        }
    }
}

async fn run_empty_new_thread_app_server(
    socket_path: PathBuf,
    observed: mpsc::Sender<String>,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let listener = UnixListener::bind(socket_path)?;
    let (stream, _) = listener.accept().await?;
    let mut socket = accept_initialized(stream).await?;
    while let Some(frame) = socket.next().await {
        let frame = frame?;
        let Message::Text(raw) = frame else {
            continue;
        };
        let request: Value = serde_json::from_str(&raw)?;
        let method = request
            .get("method")
            .and_then(Value::as_str)
            .unwrap_or_default();
        observed.send(method.to_owned()).await?;
        let response = match method {
            "thread/turns/list" => json!({
                "id": request["id"].clone(),
                "error": {
                    "code": -32600,
                    "message": "thread empty-thread is not materialized yet; thread/turns/list is unavailable before first user message"
                }
            }),
            "turn/start" => json!({
                "id": request["id"].clone(),
                "result": {"turn": {"id": "first-turn", "status": "inProgress", "items": []}}
            }),
            _ => json!({"id": request["id"].clone(), "result": {}}),
        };
        send_value(&mut socket, &response).await?;
    }
    Ok(())
}

async fn run_ordered_queue_app_server(
    socket_path: PathBuf,
    observed: mpsc::Sender<String>,
    active: Arc<AtomicBool>,
    terminal_status: &'static str,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let listener = UnixListener::bind(socket_path)?;
    let (stream, _) = listener.accept().await?;
    let mut socket = accept_initialized(stream).await?;
    while let Some(frame) = socket.next().await {
        let frame = frame?;
        let Message::Text(raw) = frame else {
            continue;
        };
        let request: Value = serde_json::from_str(&raw)?;
        let method = request
            .get("method")
            .and_then(Value::as_str)
            .unwrap_or_default();
        if method == "turn/start" {
            observed
                .send(
                    request
                        .pointer("/params/clientUserMessageId")
                        .and_then(Value::as_str)
                        .unwrap_or_default()
                        .to_owned(),
                )
                .await?;
        } else if method != "thread/read" {
            observed.send(method.to_owned()).await?;
        }
        let result = if method == "thread/read" {
            let status = if active.load(Ordering::Acquire) {
                json!({"type": "active", "activeFlags": []})
            } else {
                json!({"type": terminal_status})
            };
            json!({
                "thread": {
                    "id": request.pointer("/params/threadId").and_then(Value::as_str).unwrap_or("thread-1"),
                    "status": status,
                    "canAcceptDirectInput": true,
                    "turns": []
                }
            })
        } else {
            json!({"turn": {"id": format!("turn-{method}"), "status": "inProgress", "items": []}})
        };
        send_value(
            &mut socket,
            &json!({
                "id": request["id"].clone(),
                "result": result
            }),
        )
        .await?;
    }
    Ok(())
}

async fn run_missing_thread_app_server(
    socket_path: PathBuf,
    observed: mpsc::Sender<Value>,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let listener = UnixListener::bind(socket_path)?;
    let (stream, _) = listener.accept().await?;
    let mut socket = accept_initialized(stream).await?;
    let mut loaded = false;
    while let Some(frame) = socket.next().await {
        let frame = frame?;
        let Message::Text(raw) = frame else {
            continue;
        };
        let request: Value = serde_json::from_str(&raw)?;
        observed.send(request.clone()).await?;
        let method = request
            .get("method")
            .and_then(Value::as_str)
            .unwrap_or_default();
        let response = match method {
            "thread/read" => json!({
                "id": request["id"].clone(),
                "result": {
                    "thread": {
                        "id": "thread-1",
                        "status": {"type": "idle"},
                        "turns": []
                    }
                }
            }),
            "turn/start" if !loaded => json!({
                "id": request["id"].clone(),
                "error": {"code": -32600, "message": "thread not found: thread-1"}
            }),
            "thread/resume" => {
                loaded = true;
                json!({
                    "id": request["id"].clone(),
                    "result": {"thread": {"id": "thread-1", "turns": []}}
                })
            }
            "turn/start" => json!({
                "id": request["id"].clone(),
                "result": {"turn": {"id": "continued-turn", "status": "inProgress", "items": []}}
            }),
            _ => json!({"id": request["id"].clone(), "result": {}}),
        };
        send_value(&mut socket, &response).await?;
    }
    Ok(())
}

async fn run_remote_file_app_server(
    socket_path: PathBuf,
    observed: mpsc::Sender<Value>,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let listener = UnixListener::bind(socket_path)?;
    let (stream, _) = listener.accept().await?;
    let mut socket = accept_initialized(stream).await?;
    while let Some(frame) = socket.next().await {
        let frame = frame?;
        let Message::Text(raw) = frame else {
            continue;
        };
        let request: Value = serde_json::from_str(&raw)?;
        observed.send(request.clone()).await?;
        let result = match request.get("method").and_then(Value::as_str) {
            Some("thread/turns/list") => json!({"data": [], "nextCursor": null}),
            Some("thread/read") => json!({
                "thread": {
                    "id": "thread-1",
                    "status": {"type": "idle"},
                    "turns": []
                }
            }),
            _ => json!({"turn": {"id": "turn-image", "status": "inProgress", "items": []}}),
        };
        send_value(
            &mut socket,
            &json!({"id": request["id"].clone(), "result": result}),
        )
        .await?;
    }
    Ok(())
}

async fn run_idempotent_retry_app_server(
    socket_path: PathBuf,
    observed: mpsc::Sender<String>,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let listener = UnixListener::bind(socket_path)?;
    let (stream, _) = listener.accept().await?;
    let mut socket = accept_initialized(stream).await?;
    let mut accepted = false;
    while let Some(frame) = socket.next().await {
        let frame = frame?;
        let Message::Text(raw) = frame else {
            continue;
        };
        let request: Value = serde_json::from_str(&raw)?;
        let method = request
            .get("method")
            .and_then(Value::as_str)
            .unwrap_or_default();
        observed.send(method.to_owned()).await?;
        let result = match method {
            "thread/turns/list" if accepted => json!({
                "data": [{
                    "id": "turn-1",
                    "status": "completed",
                    "itemsView": "summary",
                    "items": [{
                        "type": "userMessage",
                        "id": "user-1",
                        "clientId": "stable-message",
                        "content": [{"type": "text", "text": "once"}]
                    }]
                }],
                "nextCursor": null
            }),
            "thread/turns/list" => json!({"data": [], "nextCursor": null}),
            "turn/start" => {
                accepted = true;
                json!({"turn": {"id": "turn-1", "status": "inProgress", "items": []}})
            }
            _ => json!({}),
        };
        send_value(
            &mut socket,
            &json!({"id": request["id"].clone(), "result": result}),
        )
        .await?;
    }
    Ok(())
}

async fn run_ambiguous_app_server(
    socket_path: PathBuf,
    observed: mpsc::Sender<String>,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let listener = UnixListener::bind(socket_path)?;
    let (stream, _) = listener.accept().await?;
    let mut first = accept_initialized(stream).await?;
    loop {
        let request = receive_value(&mut first).await?;
        let method = method_of(&request);
        observed.send(method.clone()).await?;
        if method == "turn/start" {
            break;
        }
        if method == "thread/read" {
            send_value(
                &mut first,
                &json!({
                    "id": request["id"].clone(),
                    "result": {
                        "thread": {
                            "id": "thread-1",
                            "status": {"type": "idle"},
                            "turns": []
                        }
                    }
                }),
            )
            .await?;
        }
    }
    drop(first);

    let (stream, _) = listener.accept().await?;
    let mut second = accept_initialized(stream).await?;
    while let Some(frame) = second.next().await {
        let frame = frame?;
        if let Message::Text(raw) = frame {
            let value: Value = serde_json::from_str(&raw)?;
            observed.send(method_of(&value)).await?;
        }
    }
    Ok(())
}

async fn accept_initialized(
    stream: UnixStream,
) -> Result<WebSocketStream<UnixStream>, Box<dyn std::error::Error + Send + Sync>> {
    let mut socket = accept_async(stream).await?;
    let initialize = receive_value(&mut socket).await?;
    send_value(&mut socket, &json!({"id": initialize["id"], "result": {}})).await?;
    let initialized = receive_value(&mut socket).await?;
    if initialized.get("method").and_then(Value::as_str) != Some("initialized") {
        return Err("initialized notification missing".into());
    }
    Ok(socket)
}

fn method_of(value: &Value) -> String {
    value
        .get("method")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_owned()
}

async fn receive_value(
    socket: &mut WebSocketStream<UnixStream>,
) -> Result<Value, Box<dyn std::error::Error + Send + Sync>> {
    loop {
        let frame = socket.next().await.ok_or("WebSocket closed")??;
        if let Message::Text(raw) = frame {
            return Ok(serde_json::from_str(&raw)?);
        }
    }
}

async fn send_value(
    socket: &mut WebSocketStream<UnixStream>,
    value: &Value,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    socket.send(Message::Text(value.to_string().into())).await?;
    Ok(())
}
