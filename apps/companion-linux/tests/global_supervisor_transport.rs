#![cfg(unix)]

use std::{path::PathBuf, sync::Arc, time::Duration};

use codewide_companion::{
    catalog::SessionCatalog,
    history_service::HistoryService,
    server,
    store::IndexStore,
    sync::SyncHub,
    upstream::{ConnectionStatus, UpstreamHandle},
};
use futures_util::{SinkExt, StreamExt};
use http::HeaderValue;
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
type ClientSocket = WebSocketStream<tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>>;

#[tokio::test]
async fn realtime_notifications_bypass_replay_and_ordinary_events_remain_durable()
-> Result<(), Box<dyn std::error::Error>> {
    let directory = tempfile::tempdir()?;
    let socket_path = directory.path().join("app-server.sock");
    let (notifications, notification_receiver) = mpsc::channel(8);
    let (observed, _observed_receiver) = mpsc::channel(8);
    let fake = tokio::spawn(run_notification_app_server(
        socket_path.clone(),
        notification_receiver,
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
    let mut client = connect_caught_up(&format!("ws://{address}/v1/sync")).await?;

    send_json(
        &mut client,
        &json!({
            "type": "liveSubscribe",
            "channelId": "activation-channel",
            "threadId": "supervisor-thread"
        }),
    )
    .await?;
    assert_eq!(
        receive_type(&mut client, "liveSubscribed").await?["channelId"],
        "activation-channel"
    );

    notifications
        .send(json!({
            "method": "thread/realtime/started",
            "params": {
                "threadId": "supervisor-thread",
                "version": "v3",
                "realtimeSessionId": "realtime-session"
            }
        }))
        .await?;
    let started = receive_type(&mut client, "liveEvent").await?;
    assert_eq!(started["sequence"], 1);
    assert_eq!(started["payload"]["method"], "thread/realtime/started");

    notifications
        .send(json!({
            "method": "thread/realtime/transcript/delta",
            "params": {
                "threadId": "supervisor-thread",
                "role": "assistant",
                "delta": "transient-secret-marker"
            }
        }))
        .await?;
    let transcript = receive_type(&mut client, "liveEvent").await?;
    assert_eq!(transcript["sequence"], 2);

    notifications
        .send(json!({
            "method": "thread/name/updated",
            "params": {"threadId": "ordinary-thread", "name": "Ordinary"}
        }))
        .await?;
    let durable = receive_type(&mut client, "event").await?;
    assert_eq!(durable["payload"]["method"], "thread/name/updated");

    let replay = store.replay_after(Some(0))?;
    assert_eq!(replay.entries.len(), 1);
    let persisted = String::from_utf8(replay.entries[0].1.clone())?;
    assert!(persisted.contains("thread/name/updated"));
    assert!(!persisted.contains("thread/realtime/"));
    assert!(!persisted.contains("transient-secret-marker"));

    client.close(None).await?;
    let mut replay_client = connect_with_cursor(&format!("ws://{address}/v1/sync"), 0).await?;
    let replayed = receive_type(&mut replay_client, "event").await?;
    assert_eq!(replayed["payload"]["method"], "thread/name/updated");
    assert_eq!(
        receive_type(&mut replay_client, "caughtUp").await?["cursor"],
        1
    );

    replay_client.close(None).await?;
    server_task.abort();
    fake.abort();
    Ok(())
}

#[tokio::test]
async fn invalid_realtime_thread_ids_fence_starting_and_active_channels_without_replay()
-> Result<(), Box<dyn std::error::Error>> {
    let directory = tempfile::tempdir()?;
    let socket_path = directory.path().join("app-server.sock");
    let (notifications, notification_receiver) = mpsc::channel(8);
    let (observed, _observed_receiver) = mpsc::channel(8);
    let fake = tokio::spawn(run_notification_app_server(
        socket_path.clone(),
        notification_receiver,
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
    let mut client = connect_caught_up(&format!("ws://{address}/v1/sync")).await?;

    send_json(
        &mut client,
        &json!({
            "type": "liveSubscribe",
            "channelId": "activation-channel",
            "threadId": "supervisor-thread"
        }),
    )
    .await?;
    let _subscribed = receive_type(&mut client, "liveSubscribed").await?;
    notifications
        .send(json!({
            "method": "thread/realtime/transcript/delta",
            "params": {"threadId": " \t\n ", "delta": "must-not-persist-starting"}
        }))
        .await?;
    let terminal = receive_type(&mut client, "liveOverflow").await?;
    assert_eq!(terminal["reason"], "invalidRealtimeNotification");

    send_json(
        &mut client,
        &json!({
            "type": "liveSubscribe",
            "channelId": "active-channel",
            "threadId": "supervisor-thread"
        }),
    )
    .await?;
    let _subscribed = receive_type(&mut client, "liveSubscribed").await?;
    notifications
        .send(json!({
            "method": "thread/realtime/started",
            "params": {
                "threadId": "supervisor-thread",
                "version": "v3",
                "realtimeSessionId": "realtime-session"
            }
        }))
        .await?;
    let _started = receive_type(&mut client, "liveEvent").await?;
    notifications
        .send(json!({
            "method": "thread/realtime/transcript/delta",
            "params": {"threadId": "   ", "delta": "must-not-persist-active"}
        }))
        .await?;
    let terminal = receive_type(&mut client, "liveOverflow").await?;
    assert_eq!(terminal["channelId"], "active-channel");
    assert_eq!(terminal["reason"], "invalidRealtimeNotification");
    assert!(store.replay_after(Some(0))?.entries.is_empty());

    client.close(None).await?;
    server_task.abort();
    fake.abort();
    Ok(())
}

#[tokio::test]
async fn realtime_start_resumes_an_unloaded_thread_and_retries_once()
-> Result<(), Box<dyn std::error::Error>> {
    let directory = tempfile::tempdir()?;
    let socket_path = directory.path().join("app-server.sock");
    let (observed, mut observed_receiver) = mpsc::channel(8);
    let fake = tokio::spawn(run_realtime_resume_app_server(
        socket_path.clone(),
        observed,
        RealtimeResumeFixture::Available,
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
    let mut client = connect_caught_up(&format!("ws://{address}/v1/sync")).await?;

    send_json(
        &mut client,
        &json!({
            "type": "rpc",
            "request": {
                "id": 7,
                "method": "thread/realtime/start",
                "params": {
                    "outputModality": "audio",
                    "threadId": "supervisor-thread",
                    "transport": {"type": "websocket"},
                    "version": "v3",
                    "voice": "cedar"
                }
            }
        }),
    )
    .await?;
    let response = receive_type(&mut client, "rpc").await?;
    assert_eq!(response["response"]["id"], 7);
    assert_eq!(
        response["response"]["result"]["realtimeSessionId"],
        "live-session"
    );

    let first_start = timeout(Duration::from_secs(2), observed_receiver.recv())
        .await?
        .ok_or("first realtime start missing")?;
    let resume = timeout(Duration::from_secs(2), observed_receiver.recv())
        .await?
        .ok_or("thread resume missing")?;
    let retry = timeout(Duration::from_secs(2), observed_receiver.recv())
        .await?
        .ok_or("realtime retry missing")?;
    assert_eq!(first_start["method"], "thread/realtime/start");
    assert_eq!(resume["method"], "thread/resume");
    assert_eq!(resume["params"]["threadId"], "supervisor-thread");
    assert_eq!(resume["params"]["excludeTurns"], true);
    assert_eq!(retry["method"], "thread/realtime/start");
    assert!(
        timeout(Duration::from_millis(50), observed_receiver.recv())
            .await
            .is_err(),
        "realtime start must retry only once"
    );

    client.close(None).await?;
    server_task.abort();
    fake.abort();
    Ok(())
}

#[tokio::test]
async fn realtime_start_reports_a_stable_error_when_the_bound_thread_has_no_rollout()
-> Result<(), Box<dyn std::error::Error>> {
    let directory = tempfile::tempdir()?;
    let socket_path = directory.path().join("app-server.sock");
    let (observed, mut observed_receiver) = mpsc::channel(8);
    let fake = tokio::spawn(run_realtime_resume_app_server(
        socket_path.clone(),
        observed,
        RealtimeResumeFixture::MissingRollout,
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
    let mut client = connect_caught_up(&format!("ws://{address}/v1/sync")).await?;

    send_json(
        &mut client,
        &json!({
            "type": "rpc",
            "request": {
                "id": 8,
                "method": "thread/realtime/start",
                "params": {"threadId": "supervisor-thread"}
            }
        }),
    )
    .await?;
    let response = receive_type(&mut client, "rpc").await?;
    assert_eq!(response["response"]["id"], 8);
    assert_eq!(response["response"]["error"]["code"], -32_061);
    assert_eq!(
        response["response"]["error"]["message"],
        "Global supervisor thread is unavailable"
    );

    assert_eq!(
        timeout(Duration::from_secs(2), observed_receiver.recv())
            .await?
            .ok_or("initial realtime start missing")?["method"],
        "thread/realtime/start"
    );
    assert_eq!(
        timeout(Duration::from_secs(2), observed_receiver.recv())
            .await?
            .ok_or("thread resume missing")?["method"],
        "thread/resume"
    );
    assert!(
        timeout(Duration::from_millis(50), observed_receiver.recv())
            .await
            .is_err(),
        "a missing rollout must not retry realtime start"
    );

    client.close(None).await?;
    server_task.abort();
    fake.abort();
    Ok(())
}

#[tokio::test]
async fn settings_update_restores_an_unloaded_supervisor_before_voice_start()
-> Result<(), Box<dyn std::error::Error>> {
    assert_settings_recovery(vec![
        ("thread/settings/update", settings_thread_not_found()),
        (
            "thread/resume",
            json!({"result": {"thread": {"id": "supervisor-thread", "turns": []}}}),
        ),
        ("thread/settings/update", json!({"result": {}})),
    ])
    .await
}

#[tokio::test]
async fn settings_update_on_a_loaded_thread_does_not_resume()
-> Result<(), Box<dyn std::error::Error>> {
    assert_settings_recovery(vec![("thread/settings/update", json!({"result": {}}))]).await
}

#[tokio::test]
async fn settings_update_preserves_unrelated_rejections_without_resuming()
-> Result<(), Box<dyn std::error::Error>> {
    assert_settings_recovery(vec![(
        "thread/settings/update",
        json!({"error": {"code": -32602, "message": "unsupported model"}}),
    )])
    .await
}

#[tokio::test]
async fn settings_update_does_not_resume_a_different_missing_thread()
-> Result<(), Box<dyn std::error::Error>> {
    assert_settings_recovery(vec![(
        "thread/settings/update",
        json!({"error": {"code": -32600, "message": "thread not found: other-thread"}}),
    )])
    .await
}

#[tokio::test]
async fn settings_update_preserves_a_missing_rollout_error_without_retrying()
-> Result<(), Box<dyn std::error::Error>> {
    assert_settings_recovery(vec![
        ("thread/settings/update", settings_thread_not_found()),
        (
            "thread/resume",
            json!({"error": {
                "code": -32600,
                "message": "no rollout found for thread id supervisor-thread"
            }}),
        ),
    ])
    .await
}

#[tokio::test]
async fn settings_update_stops_after_one_rejected_retry() -> Result<(), Box<dyn std::error::Error>>
{
    assert_settings_recovery(vec![
        ("thread/settings/update", settings_thread_not_found()),
        (
            "thread/resume",
            json!({"result": {"thread": {"id": "supervisor-thread", "turns": []}}}),
        ),
        ("thread/settings/update", settings_thread_not_found()),
    ])
    .await
}

#[tokio::test]
async fn dynamic_tool_request_is_snapshotted_separately_and_removed_only_after_resolution()
-> Result<(), Box<dyn std::error::Error>> {
    let directory = tempfile::tempdir()?;
    let socket_path = directory.path().join("app-server.sock");
    let (notifications, notification_receiver) = mpsc::channel(16);
    let (observed, mut observed_receiver) = mpsc::channel(8);
    let fake = tokio::spawn(run_notification_app_server(
        socket_path.clone(),
        notification_receiver,
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

    publish_pending_request_matrix(&notifications).await?;
    wait_for_replay_head(&store, 6).await?;

    let mut client = authenticated_client(&format!("ws://{address}/v1/sync")).await?;
    send_json(
        &mut client,
        &json!({"type": "hello", "protocolVersion": 1, "cursor": null}),
    )
    .await?;
    let hello = receive_type(&mut client, "hello").await?;
    assert_pending_request_matrix(&hello)?;
    let _status = receive_type(&mut client, "status").await?;
    send_json(
        &mut client,
        &json!({"type": "snapshotApplied", "cursor": hello["headCursor"]}),
    )
    .await?;
    let replay_hello = receive_type(&mut client, "hello").await?;
    assert_eq!(
        replay_hello["pendingRequests"].as_array().map(Vec::len),
        Some(6)
    );
    let _caught_up = receive_type(&mut client, "caughtUp").await?;

    send_json(
        &mut client,
        &json!({
            "type": "serverResponse",
            "response": {
                "id": "dynamic",
                "result": {
                    "contentItems": [{"type": "inputText", "text": "ok"}],
                    "success": true
                }
            }
        }),
    )
    .await?;
    assert_eq!(
        receive_type(&mut client, "serverResponseAccepted").await?["id"],
        "dynamic"
    );
    let upstream_response = timeout(Duration::from_secs(2), async {
        loop {
            let response = observed_receiver
                .recv()
                .await
                .ok_or("upstream response missing")?;
            if response["id"] == "dynamic" {
                return Ok::<Value, Box<dyn std::error::Error>>(response);
            }
        }
    })
    .await??;
    assert_eq!(upstream_response["id"], "dynamic");
    let resolved = receive_type(&mut client, "event").await?;
    assert_eq!(resolved["payload"]["method"], "serverRequest/resolved");

    client.close(None).await?;
    let mut second = authenticated_client(&format!("ws://{address}/v1/sync")).await?;
    send_json(
        &mut second,
        &json!({"type": "hello", "protocolVersion": 1, "cursor": null}),
    )
    .await?;
    let second_hello = receive_type(&mut second, "hello").await?;
    let pending = second_hello["pendingRequests"]
        .as_array()
        .ok_or("pending requests missing")?;
    assert_eq!(pending.len(), 5);
    assert!(!pending.iter().any(|request| request["id"] == "dynamic"));

    second.close(None).await?;
    server_task.abort();
    fake.abort();
    Ok(())
}

async fn publish_pending_request_matrix(
    notifications: &mpsc::Sender<Value>,
) -> Result<(), Box<dyn std::error::Error>> {
    let methods = [
        "item/commandExecution/requestApproval",
        "item/fileChange/requestApproval",
        "item/tool/requestUserInput",
        "item/permissions/requestApproval",
        "mcpServer/elicitation/request",
        "item/tool/call",
    ];
    for (index, method) in methods.into_iter().enumerate() {
        notifications
            .send(json!({
                "id": if method == "item/tool/call" { "dynamic".to_owned() } else { format!("user-{index}") },
                "method": method,
                "params": {"threadId": "supervisor-thread"}
            }))
            .await?;
    }
    Ok(())
}

async fn wait_for_replay_head(
    store: &IndexStore,
    expected: u64,
) -> Result<(), tokio::time::error::Elapsed> {
    timeout(Duration::from_secs(2), async {
        loop {
            if store.replay_head().is_ok_and(|head| head >= expected) {
                return;
            }
            tokio::task::yield_now().await;
        }
    })
    .await
}

fn assert_pending_request_matrix(hello: &Value) -> Result<(), Box<dyn std::error::Error>> {
    let pending = hello["pendingRequests"]
        .as_array()
        .ok_or("pending requests missing")?;
    assert_eq!(pending.len(), 6);
    assert!(
        pending
            .iter()
            .any(|request| { request["id"] == "dynamic" && request["method"] == "item/tool/call" })
    );
    Ok(())
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

async fn connect_caught_up(url: &str) -> Result<ClientSocket, Box<dyn std::error::Error>> {
    let mut socket = authenticated_client(url).await?;
    send_json(
        &mut socket,
        &json!({"type": "hello", "protocolVersion": 1, "cursor": null}),
    )
    .await?;
    let hello = receive_type(&mut socket, "hello").await?;
    let _status = receive_type(&mut socket, "status").await?;
    send_json(
        &mut socket,
        &json!({"type": "snapshotApplied", "cursor": hello["headCursor"]}),
    )
    .await?;
    assert_eq!(
        receive_type(&mut socket, "hello").await?["snapshotRequired"],
        false
    );
    let _caught_up = receive_type(&mut socket, "caughtUp").await?;
    Ok(socket)
}

async fn connect_with_cursor(
    url: &str,
    cursor: u64,
) -> Result<ClientSocket, Box<dyn std::error::Error>> {
    let mut socket = authenticated_client(url).await?;
    send_json(
        &mut socket,
        &json!({"type": "hello", "protocolVersion": 1, "cursor": cursor}),
    )
    .await?;
    assert_eq!(
        receive_type(&mut socket, "hello").await?["snapshotRequired"],
        false
    );
    let _status = receive_type(&mut socket, "status").await?;
    Ok(socket)
}

async fn authenticated_client(url: &str) -> Result<ClientSocket, Box<dyn std::error::Error>> {
    let mut request = url.into_client_request()?;
    request.headers_mut().insert(
        "authorization",
        HeaderValue::from_str(&format!("Bearer {TOKEN}"))?,
    );
    Ok(connect_async(request).await?.0)
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

async fn run_notification_app_server(
    socket_path: PathBuf,
    mut notifications: mpsc::Receiver<Value>,
    observed: mpsc::Sender<Value>,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let listener = UnixListener::bind(socket_path)?;
    let (stream, _) = listener.accept().await?;
    let mut socket = accept_initialized(stream).await?;
    loop {
        tokio::select! {
            notification = notifications.recv() => {
                let Some(notification) = notification else { return Ok(()); };
                send_value(&mut socket, &notification).await?;
            }
            frame = socket.next() => {
                let Some(frame) = frame else { return Ok(()); };
                let Message::Text(raw) = frame? else { continue; };
                let request: Value = serde_json::from_str(&raw)?;
                observed.send(request.clone()).await?;
                if request.get("method").is_some() && request.get("id").is_some() {
                    send_value(&mut socket, &json!({"id": request["id"], "result": {}})).await?;
                }
            }
        }
    }
}

#[derive(Clone, Copy)]
enum RealtimeResumeFixture {
    Available,
    MissingRollout,
}

async fn run_realtime_resume_app_server(
    socket_path: PathBuf,
    observed: mpsc::Sender<Value>,
    resume_fixture: RealtimeResumeFixture,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let listener = UnixListener::bind(socket_path)?;
    let (stream, _) = listener.accept().await?;
    let mut socket = accept_initialized(stream).await?;
    let mut realtime_start_attempts = 0_u8;
    loop {
        let request = receive_upstream_value(&mut socket).await?;
        observed.send(request.clone()).await?;
        let method = request.get("method").and_then(Value::as_str);
        let response = match method {
            Some("thread/realtime/start") if realtime_start_attempts == 0 => {
                realtime_start_attempts += 1;
                json!({
                    "id": request["id"],
                    "error": {
                        "code": -32600,
                        "message": "thread not found: supervisor-thread"
                    }
                })
            }
            Some("thread/realtime/start") => {
                realtime_start_attempts += 1;
                json!({
                    "id": request["id"],
                    "result": {"realtimeSessionId": "live-session"}
                })
            }
            Some("thread/resume") => match resume_fixture {
                RealtimeResumeFixture::Available => json!({
                    "id": request["id"],
                    "result": {"thread": {"id": "supervisor-thread", "turns": []}}
                }),
                RealtimeResumeFixture::MissingRollout => json!({
                    "id": request["id"],
                    "error": {
                        "code": -32600,
                        "message": "no rollout found for thread id supervisor-thread"
                    }
                }),
            },
            _ => json!({"id": request["id"], "result": {}}),
        };
        send_value(&mut socket, &response).await?;
    }
}

async fn accept_initialized(
    stream: UnixStream,
) -> Result<WebSocketStream<UnixStream>, Box<dyn std::error::Error + Send + Sync>> {
    let mut socket = accept_async(stream).await?;
    let initialize = receive_upstream_value(&mut socket).await?;
    send_value(&mut socket, &json!({"id": initialize["id"], "result": {}})).await?;
    let initialized = receive_upstream_value(&mut socket).await?;
    if initialized.get("method").and_then(Value::as_str) != Some("initialized") {
        return Err("initialized notification missing".into());
    }
    Ok(socket)
}

fn settings_thread_not_found() -> Value {
    json!({"error": {"code": -32600, "message": "thread not found: supervisor-thread"}})
}

async fn assert_settings_recovery(
    steps: Vec<(&'static str, Value)>,
) -> Result<(), Box<dyn std::error::Error>> {
    let directory = tempfile::tempdir()?;
    let socket_path = directory.path().join("app-server.sock");
    let (observed, mut observed_receiver) = mpsc::channel(8);
    let expected = steps
        .last()
        .ok_or("settings recovery script is empty")?
        .1
        .clone();
    let fake = tokio::spawn(run_settings_recovery_app_server(
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
    let mut client = connect_caught_up(&format!("ws://{address}/v1/sync")).await?;
    let settings =
        json!({"effort": "high", "model": "supervisor-model", "threadId": "supervisor-thread"});
    send_json(
        &mut client,
        &json!({"type": "rpc", "request": {
            "id": 9, "method": "thread/settings/update", "params": settings
        }}),
    )
    .await?;
    for (method, response) in steps {
        let (request, reply) = timeout(Duration::from_secs(2), observed_receiver.recv())
            .await?
            .ok_or("settings recovery request missing")?;
        assert_eq!(request["method"], method);
        if method == "thread/settings/update" {
            assert_eq!(request["params"], settings);
        } else {
            assert_eq!(request["params"]["threadId"], "supervisor-thread");
            assert_eq!(request["params"]["excludeTurns"], true);
        }
        reply.send(response).map_err(|_| "upstream reply dropped")?;
    }
    let response = receive_type(&mut client, "rpc").await?;
    assert_eq!(response["response"]["id"], 9);
    assert_eq!(response["response"]["result"], expected["result"]);
    assert_eq!(response["response"]["error"], expected["error"]);

    // An acknowledged read is a causal fence: any extra recovery RPC would
    // arrive first on the same upstream socket, without a timing-based sleep.
    send_json(
        &mut client,
        &json!({"type": "rpc", "request": {
            "id": 10, "method": "thread/realtime/listVoices", "params": {}
        }}),
    )
    .await?;
    let (fence, reply) = timeout(Duration::from_secs(2), observed_receiver.recv())
        .await?
        .ok_or("recovery fence missing")?;
    assert_eq!(fence["method"], "thread/realtime/listVoices");
    reply
        .send(json!({"result": {}}))
        .map_err(|_| "fence reply dropped")?;
    assert_eq!(
        receive_type(&mut client, "rpc").await?["response"]["id"],
        10
    );

    client.close(None).await?;
    server_task.abort();
    fake.abort();
    Ok(())
}

type SettingsRecoveryRequest = (Value, tokio::sync::oneshot::Sender<Value>);

async fn run_settings_recovery_app_server(
    socket_path: PathBuf,
    observed: mpsc::Sender<SettingsRecoveryRequest>,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let listener = UnixListener::bind(socket_path)?;
    let (stream, _) = listener.accept().await?;
    let mut socket = accept_initialized(stream).await?;
    loop {
        let request = receive_upstream_value(&mut socket).await?;
        let id = request["id"].clone();
        let (reply, response) = tokio::sync::oneshot::channel();
        observed.send((request, reply)).await?;
        let mut response = response.await?;
        response["id"] = id;
        send_value(&mut socket, &response).await?;
    }
}

async fn receive_upstream_value(
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
