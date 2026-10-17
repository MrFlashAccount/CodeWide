//! `/v1/sync` interest contract: mandatory `hello.interest`, send-time
//! filtering of thread topics, the `afterCursor` chain with `advance`, the
//! interest-before-`companion/thread/sync` ordering and the catalog preview of
//! a streaming answer. Events enter the journal through the provider-local
//! event channel, so no App Server traffic is needed except for the sync RPC.

#![cfg(unix)]

use std::{sync::Arc, time::Duration};

use codewide_companion::{
    catalog::SessionCatalog,
    history_service::HistoryService,
    rollout_store::RolloutStore,
    server,
    store::IndexStore,
    sync::{
        SyncHub,
        interest::{INTEREST_CLOSE_CODE, MAX_INTEREST_THREADS},
    },
    thread_preview::{THREAD_PREVIEW_KIND, THREAD_PREVIEW_METHOD},
    upstream::{ConnectionStatus, UpstreamHandle},
};
use futures_util::{SinkExt, StreamExt};
use http::HeaderValue;
use serde_json::{Value, json};
use tokio::{
    net::{TcpListener, UnixListener, UnixStream},
    sync::broadcast,
    task::JoinHandle,
    time::timeout,
};
use tokio_tungstenite::{
    WebSocketStream, accept_async, connect_async,
    tungstenite::{Message, client::IntoClientRequest, protocol::frame::coding::CloseCode},
};

const TOKEN: &str = "test-token-that-is-long-enough-for-production-shape";
const THREAD: &str = "019fe7af-e2fa-70f3-88e8-99d59e10bd63";
const OTHER_THREAD: &str = "019fe7af-e2fa-70f3-88e8-99d59e10bd64";
type ClientSocket = WebSocketStream<tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>>;

/// A companion with a shell App Server behind it and a direct journal input.
struct Harness {
    url: String,
    store: Arc<IndexStore>,
    events: broadcast::Sender<Value>,
    tasks: Vec<JoinHandle<()>>,
    _directory: tempfile::TempDir,
}

impl Harness {
    async fn start() -> Result<Self, Box<dyn std::error::Error>> {
        let directory = tempfile::tempdir()?;
        let socket_path = directory.path().join("app-server.sock");
        let app_server = tokio::spawn(async move {
            let _ = run_shell_app_server(socket_path).await;
        });
        let upstream = UpstreamHandle::spawn(directory.path().join("app-server.sock"));
        wait_for_live(&upstream).await?;
        let store = Arc::new(IndexStore::open(directory.path().join("state.redb"))?);
        let history = HistoryService::new(
            Arc::new(SessionCatalog::scan(directory.path())),
            Arc::new(RolloutStore::attach(store.database(), store.clone())?),
        );
        let sync = SyncHub::with_mutations(upstream, store.clone(), history);
        let (events, receiver) = broadcast::channel(64);
        sync.forward_provider_local_events(receiver);
        let listener = TcpListener::bind("127.0.0.1:0").await?;
        let address = listener.local_addr()?;
        let app = server::router(store.clone(), Arc::from(TOKEN), sync);
        let server = tokio::spawn(async move {
            let _ = axum::serve(listener, app).await;
        });
        Ok(Self {
            url: format!("ws://{address}/v1/sync"),
            store,
            events,
            tasks: vec![app_server, server],
            _directory: directory,
        })
    }

    /// Journals one event and waits until it is durable.
    async fn journal(&self, payload: Value) -> Result<u64, Box<dyn std::error::Error>> {
        let before = self.store.replay_head()?;
        self.events.send(payload)?;
        let store = self.store.clone();
        timeout(Duration::from_secs(2), async move {
            loop {
                let head = store.replay_head()?;
                if head > before {
                    return Ok::<u64, Box<dyn std::error::Error>>(head);
                }
                tokio::time::sleep(Duration::from_millis(5)).await;
            }
        })
        .await?
    }

    async fn authenticated(&self) -> Result<ClientSocket, Box<dyn std::error::Error>> {
        let mut request = self.url.as_str().into_client_request()?;
        request.headers_mut().insert(
            "authorization",
            HeaderValue::from_str(&format!("Bearer {TOKEN}"))?,
        );
        let (socket, _response) = connect_async(request).await?;
        Ok(socket)
    }

    /// Connects with a null cursor: snapshot, then an empty replay.
    async fn connect(
        &self,
        interest: Value,
    ) -> Result<(ClientSocket, u64), Box<dyn std::error::Error>> {
        let mut socket = self.authenticated().await?;
        send_json(
            &mut socket,
            &json!({"type": "hello", "protocolVersion": 1, "cursor": null, "interest": interest}),
        )
        .await?;
        let hello = receive_type(&mut socket, "hello").await?;
        assert_eq!(hello["snapshotRequired"], true);
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
        Ok((socket, caught_up["cursor"].as_u64().ok_or("cursor")?))
    }

    /// Connects inside the replay window and returns everything up to `caughtUp`.
    async fn connect_replay(
        &self,
        cursor: u64,
        interest: Value,
    ) -> Result<(ClientSocket, Vec<Value>), Box<dyn std::error::Error>> {
        let mut socket = self.authenticated().await?;
        send_json(
            &mut socket,
            &json!({"type": "hello", "protocolVersion": 1, "cursor": cursor, "interest": interest}),
        )
        .await?;
        let hello = receive_type(&mut socket, "hello").await?;
        assert_eq!(hello["snapshotRequired"], false);
        let mut frames = Vec::new();
        loop {
            let frame = receive_frame(&mut socket).await?;
            let kind = frame["type"].as_str().unwrap_or_default().to_owned();
            if !matches!(kind.as_str(), "event" | "advance" | "caughtUp") {
                continue;
            }
            frames.push(frame);
            if kind == "caughtUp" {
                break;
            }
        }
        Ok((socket, frames))
    }

    fn stop(self) {
        for task in self.tasks {
            task.abort();
        }
    }
}

fn delta(thread_id: &str, item_id: &str, text: &str) -> Value {
    json!({
        "method": "item/agentMessage/delta",
        "params": {"threadId": thread_id, "turnId": "turn", "itemId": item_id, "delta": text}
    })
}

fn turn_diff(thread_id: &str) -> Value {
    json!({
        "method": "turn/diff/updated",
        "params": {"threadId": thread_id, "turnId": "turn", "diff": "--- a\n+++ b"}
    })
}

fn turn_started(thread_id: &str) -> Value {
    json!({
        "method": "turn/started",
        "params": {"threadId": thread_id, "turn": {"id": "turn", "items": [], "startedAt": 1}}
    })
}

fn item_completed(thread_id: &str, item_id: &str, text: &str) -> Value {
    json!({
        "method": "item/completed",
        "params": {
            "threadId": thread_id,
            "turnId": "turn",
            "item": {"type": "agentMessage", "id": item_id, "phase": "final_answer", "text": text}
        }
    })
}

#[tokio::test]
async fn hello_without_interest_or_with_invalid_interest_is_closed()
-> Result<(), Box<dyn std::error::Error>> {
    let harness = Harness::start().await?;
    let too_many = (0..=MAX_INTEREST_THREADS)
        .map(|index| format!("thread-{index}"))
        .collect::<Vec<_>>();
    for (hello, reason) in [
        (
            json!({"type": "hello", "protocolVersion": 1, "cursor": null}),
            "interest_required",
        ),
        (
            json!({"type": "hello", "protocolVersion": 1, "cursor": null, "interest": "thread"}),
            "invalid_interest",
        ),
        (
            json!({"type": "hello", "protocolVersion": 1, "cursor": null, "interest": [""]}),
            "invalid_interest",
        ),
        (
            json!({"type": "hello", "protocolVersion": 1, "cursor": null, "interest": too_many}),
            "interest_limit_exceeded",
        ),
    ] {
        let mut socket = harness.authenticated().await?;
        send_json(&mut socket, &hello).await?;
        let close = receive_close(&mut socket).await?;
        assert_eq!(close, (INTEREST_CLOSE_CODE, reason.to_owned()), "{hello}");
    }
    harness.stop();
    Ok(())
}

#[tokio::test]
async fn invalid_interest_frames_close_the_session() -> Result<(), Box<dyn std::error::Error>> {
    let harness = Harness::start().await?;
    let (mut socket, _) = harness.connect(json!([])).await?;
    send_json(&mut socket, &json!({"type": "interest", "add": [1]})).await?;
    assert_eq!(
        receive_close(&mut socket).await?,
        (INTEREST_CLOSE_CODE, "invalid_interest".to_owned())
    );

    let (mut socket, _) = harness.connect(json!([THREAD])).await?;
    let fill = (0..MAX_INTEREST_THREADS)
        .map(|index| format!("thread-{index}"))
        .collect::<Vec<_>>();
    send_json(&mut socket, &json!({"type": "interest", "add": fill})).await?;
    assert_eq!(
        receive_close(&mut socket).await?,
        (INTEREST_CLOSE_CODE, "interest_limit_exceeded".to_owned())
    );
    harness.stop();
    Ok(())
}

#[tokio::test]
async fn live_events_chain_after_cursor_and_skipped_tails_advance()
-> Result<(), Box<dyn std::error::Error>> {
    let harness = Harness::start().await?;
    let (mut list_only, start) = harness.connect(json!([])).await?;
    let (mut subscribed, _) = harness.connect(json!([THREAD])).await?;
    assert_eq!(start, 0);

    // Catalog topic: delivered to both with the chain starting at the snapshot cursor.
    harness.journal(turn_started(THREAD)).await?;
    for socket in [&mut list_only, &mut subscribed] {
        let event = receive_type(socket, "event").await?;
        assert_eq!(event["cursor"], 1);
        assert_eq!(event["afterCursor"], 0);
        assert_eq!(event["payload"]["method"], "turn/started");
    }

    // Thread topic without preview: skipped for the list, delivered when subscribed.
    harness.journal(turn_diff(THREAD)).await?;
    let advance = receive_type(&mut list_only, "advance").await?;
    assert_eq!(
        advance,
        json!({"type": "advance", "cursor": 2, "afterCursor": 1})
    );
    let event = receive_type(&mut subscribed, "event").await?;
    assert_eq!(event["cursor"], 2);
    assert_eq!(event["afterCursor"], 1);
    assert_eq!(
        event["payload"]["codewideThreadPatch"]["operation"]["kind"],
        "turnDiff"
    );

    // The next catalog event continues each socket's own chain.
    harness.journal(turn_started(OTHER_THREAD)).await?;
    for socket in [&mut list_only, &mut subscribed] {
        let event = receive_type(socket, "event").await?;
        assert_eq!(event["cursor"], 3);
        assert_eq!(event["afterCursor"], 2);
    }

    // A thread topic of a thread nobody subscribed to advances both.
    harness.journal(turn_diff(OTHER_THREAD)).await?;
    for socket in [&mut list_only, &mut subscribed] {
        let advance = receive_type(socket, "advance").await?;
        assert_eq!(
            advance,
            json!({"type": "advance", "cursor": 4, "afterCursor": 3})
        );
    }
    harness.stop();
    Ok(())
}

#[tokio::test]
async fn reconnect_replays_through_interest_with_advance_before_caught_up()
-> Result<(), Box<dyn std::error::Error>> {
    let harness = Harness::start().await?;
    harness.journal(turn_started(THREAD)).await?; // 1
    harness.journal(turn_diff(THREAD)).await?; // 2
    harness.journal(turn_started(OTHER_THREAD)).await?; // 3
    harness.journal(turn_diff(OTHER_THREAD)).await?; // 4
    let head = harness.journal(turn_diff(THREAD)).await?; // 5
    assert_eq!(head, 5);

    let (_list_only, frames) = harness.connect_replay(1, json!([])).await?;
    assert_eq!(
        frames
            .iter()
            .map(|frame| {
                (
                    frame["type"].as_str().unwrap_or_default().to_owned(),
                    frame["cursor"].as_u64(),
                    frame["afterCursor"].as_u64(),
                )
            })
            .collect::<Vec<_>>(),
        [
            ("event".to_owned(), Some(3), Some(1)),
            ("advance".to_owned(), Some(5), Some(3)),
            ("caughtUp".to_owned(), Some(5), None),
        ]
    );

    let (_subscribed, frames) = harness.connect_replay(1, json!([THREAD])).await?;
    assert_eq!(
        frames
            .iter()
            .map(|frame| {
                (
                    frame["type"].as_str().unwrap_or_default().to_owned(),
                    frame["cursor"].as_u64(),
                    frame["afterCursor"].as_u64(),
                )
            })
            .collect::<Vec<_>>(),
        [
            ("event".to_owned(), Some(2), Some(1)),
            ("event".to_owned(), Some(3), Some(2)),
            ("event".to_owned(), Some(5), Some(3)),
            ("caughtUp".to_owned(), Some(5), None),
        ]
    );

    // Outside the window a snapshot is still required: nothing is replayed.
    let mut socket = harness.authenticated().await?;
    send_json(
        &mut socket,
        &json!({"type": "hello", "protocolVersion": 1, "cursor": 9, "interest": []}),
    )
    .await?;
    assert_eq!(
        receive_type(&mut socket, "hello").await?["snapshotRequired"],
        true
    );
    harness.stop();
    Ok(())
}

#[tokio::test]
async fn interest_add_before_thread_sync_loses_no_delta() -> Result<(), Box<dyn std::error::Error>>
{
    let harness = Harness::start().await?;
    let (mut socket, _) = harness.connect(json!([])).await?;
    harness.journal(turn_started(THREAD)).await?; // 1
    assert_eq!(receive_type(&mut socket, "event").await?["cursor"], 1);
    harness.journal(turn_diff(THREAD)).await?; // 2: skipped
    assert_eq!(receive_type(&mut socket, "advance").await?["cursor"], 2);

    // Window mount: interest add, deltas written in between, then the sync RPC.
    send_json(&mut socket, &json!({"type": "interest", "add": [THREAD]})).await?;
    harness.journal(turn_diff(THREAD)).await?; // 3
    send_json(
        &mut socket,
        &json!({
            "type": "rpc",
            "request": {
                "id": "sync",
                "method": "companion/thread/sync",
                "params": {"threadId": THREAD, "afterTurnId": null, "limit": 36}
            }
        }),
    )
    .await?;
    // Entry 3 may be delivered (or advanced over, if the page was read before
    // the interest frame) before or after the RPC answer: the chain is checked
    // on every frame while waiting for the fence.
    let mut chain = CursorChain::after(2);
    let fence = loop {
        let frame = receive_frame(&mut socket).await?;
        if frame["type"] == "rpc" {
            break frame["response"]["result"]["throughCursor"]
                .as_u64()
                .ok_or("throughCursor")?;
        }
        chain.observe(&frame)?;
    };
    assert!(fence >= 3, "the fence covers every commit before the RPC");
    harness.journal(turn_diff(THREAD)).await?; // 4: delivered, after the fence
    while chain.delivered.last() != Some(&4) {
        let frame = receive_frame(&mut socket).await?;
        chain.observe(&frame)?;
    }
    let delivered = chain.delivered;

    // Every delta of the thread is either covered by the fence or delivered.
    for cursor in 3..=4 {
        assert!(
            cursor <= fence || delivered.contains(&cursor),
            "delta {cursor} neither fenced ({fence}) nor delivered ({delivered:?})"
        );
    }

    // Window release: the thread's topics advance again.
    send_json(
        &mut socket,
        &json!({"type": "interest", "remove": [THREAD]}),
    )
    .await?;
    tokio::time::sleep(Duration::from_millis(20)).await;
    harness.journal(turn_diff(THREAD)).await?; // 5
    assert_eq!(
        receive_type(&mut socket, "advance").await?["afterCursor"],
        4
    );
    harness.stop();
    Ok(())
}

#[tokio::test]
async fn a_streaming_answer_reaches_the_list_as_a_rate_limited_preview()
-> Result<(), Box<dyn std::error::Error>> {
    let harness = Harness::start().await?;
    let (mut list_only, _) = harness.connect(json!([])).await?;
    harness.journal(delta(THREAD, "answer", "Hello")).await?;
    let preview = receive_type(&mut list_only, "event").await?;
    assert_eq!(preview["payload"]["method"], THREAD_PREVIEW_METHOD);
    assert_eq!(preview["cursor"], 2, "the preview follows its delta");
    assert_eq!(
        preview["afterCursor"], 0,
        "the skipped delta did not move the position"
    );
    let patch = &preview["payload"]["codewideThreadPatch"];
    assert_eq!(patch["threadId"], THREAD);
    assert_eq!(patch["operation"]["kind"], THREAD_PREVIEW_KIND);
    assert_eq!(
        patch["operation"]["summary"],
        json!({
            "activity": true,
            "conversationMessage": false,
            "finalAgentResponse": false,
            "previewText": "Hello"
        })
    );

    // Inside the interval the next delta is skipped without a preview.
    harness.journal(delta(THREAD, "answer", ", world")).await?;
    assert_eq!(
        receive_type(&mut list_only, "advance").await?,
        json!({"type": "advance", "cursor": 3, "afterCursor": 2})
    );

    // Completion carries the full text as today and clears the stream.
    harness
        .journal(item_completed(THREAD, "answer", "Hello, world!"))
        .await?;
    let completed = receive_type(&mut list_only, "event").await?;
    assert_eq!(completed["cursor"], 4);
    assert_eq!(completed["afterCursor"], 3);
    assert_eq!(
        completed["payload"]["codewideThreadPatch"]["operation"]["summary"]["previewText"],
        "Hello, world!"
    );
    harness.stop();
    Ok(())
}

/// Checks the `afterCursor` chain of received `event` / `advance` frames and
/// records the delivered event cursors.
struct CursorChain {
    position: u64,
    delivered: Vec<u64>,
}

impl CursorChain {
    const fn after(position: u64) -> Self {
        Self {
            position,
            delivered: Vec::new(),
        }
    }

    fn observe(&mut self, frame: &Value) -> Result<(), Box<dyn std::error::Error>> {
        let is_event = frame["type"] == "event";
        if !is_event && frame["type"] != "advance" {
            return Ok(());
        }
        assert_eq!(frame["afterCursor"], self.position, "{frame}");
        self.position = frame["cursor"].as_u64().ok_or("cursor")?;
        if is_event {
            self.delivered.push(self.position);
        }
        Ok(())
    }
}

async fn run_shell_app_server(
    socket_path: std::path::PathBuf,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let listener = UnixListener::bind(socket_path)?;
    let (stream, _) = listener.accept().await?;
    let mut socket: WebSocketStream<UnixStream> = accept_async(stream).await?;
    let initialize = receive_value(&mut socket).await?;
    send_value(&mut socket, &json!({"id": initialize["id"], "result": {}})).await?;
    let initialized = receive_value(&mut socket).await?;
    if initialized.get("method").and_then(Value::as_str) != Some("initialized") {
        return Err("initialized notification missing".into());
    }
    while let Some(frame) = socket.next().await {
        let Message::Text(raw) = frame? else {
            continue;
        };
        let request: Value = serde_json::from_str(&raw)?;
        let Some(id) = request.get("id").cloned() else {
            continue;
        };
        let method = request
            .get("method")
            .and_then(Value::as_str)
            .unwrap_or_default();
        let thread_id = request
            .pointer("/params/threadId")
            .and_then(Value::as_str)
            .unwrap_or(THREAD);
        let thread = json!({
            "id": thread_id,
            "name": "Shell thread",
            "recencyAt": 10,
            "status": {"type": "idle"},
            "turns": []
        });
        let result = match method {
            "thread/resume" => json!({
                "thread": thread,
                "model": "gpt-test",
                "reasoningEffort": "high",
                "serviceTier": "priority",
                "activePermissionProfile": {"id": ":workspace", "extends": null},
                "approvalPolicy": "never",
                "sandbox": {"type": "dangerFullAccess"}
            }),
            "thread/read" => json!({"thread": thread}),
            "thread/turns/list" => json!({"data": [], "nextCursor": null}),
            _ => json!({}),
        };
        send_value(&mut socket, &json!({"id": id, "result": result})).await?;
    }
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

async fn receive_frame(socket: &mut ClientSocket) -> Result<Value, Box<dyn std::error::Error>> {
    timeout(Duration::from_secs(2), async {
        loop {
            let frame = socket.next().await.ok_or("WebSocket closed")??;
            if let Message::Text(raw) = frame {
                return Ok(serde_json::from_str::<Value>(&raw)?);
            }
        }
    })
    .await?
}

async fn receive_type(
    socket: &mut ClientSocket,
    expected_type: &str,
) -> Result<Value, Box<dyn std::error::Error>> {
    timeout(Duration::from_secs(2), async {
        loop {
            let frame = socket.next().await.ok_or("WebSocket closed")??;
            if let Message::Text(raw) = frame {
                let value: Value = serde_json::from_str(&raw)?;
                let kind = value.get("type").and_then(Value::as_str);
                if kind == Some(expected_type) {
                    return Ok(value);
                }
                if matches!(kind, Some("event" | "advance")) {
                    return Err(format!("unexpected {expected_type} wait: {value}").into());
                }
            }
        }
    })
    .await?
}

async fn receive_close(
    socket: &mut ClientSocket,
) -> Result<(u16, String), Box<dyn std::error::Error>> {
    timeout(Duration::from_secs(2), async {
        loop {
            let frame = socket.next().await.ok_or("WebSocket closed")??;
            if let Message::Close(Some(frame)) = frame {
                let code: u16 = match frame.code {
                    CloseCode::Policy => 1008,
                    other => u16::from(other),
                };
                return Ok((code, frame.reason.to_string()));
            }
        }
    })
    .await?
}

async fn send_json(
    socket: &mut ClientSocket,
    value: &Value,
) -> Result<(), Box<dyn std::error::Error>> {
    socket.send(Message::Text(value.to_string().into())).await?;
    Ok(())
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
