//! `/v1/sync` thread-list stream: mandatory `hello.listStream`, the inline
//! `listStream` frame, coalesced `threadListRows` frames, `codewideList` on
//! `thread/list` pages with the pre-read journal head, and the first-row read
//! of a thread far below every page. Events enter the journal through the
//! provider-local event channel; a shell App Server answers `thread/list`
//! (optionally held open) and `thread/read`.

#![cfg(unix)]

use std::{
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};

use codewide_companion::{
    catalog::SessionCatalog,
    history_service::HistoryService,
    rollout_store::RolloutStore,
    server,
    store::IndexStore,
    sync::SyncHub,
    thread_list::{COALESCE_INTERVAL, FRAME_TYPE, LIST_STREAM_CLOSE_CODE, ROW_FIELD},
    upstream::{ConnectionStatus, UpstreamHandle},
};
use futures_util::{SinkExt, StreamExt};
use http::HeaderValue;
use serde_json::{Value, json};
use tokio::{
    net::{TcpListener, UnixListener, UnixStream},
    sync::{Semaphore, broadcast},
    task::JoinHandle,
    time::timeout,
};
use tokio_tungstenite::{
    WebSocketStream, accept_async, connect_async,
    tungstenite::{Message, client::IntoClientRequest, protocol::frame::coding::CloseCode},
};

const TOKEN: &str = "test-token-that-is-long-enough-for-production-shape";
type ClientSocket = WebSocketStream<tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>>;
type TestResult = Result<(), Box<dyn std::error::Error>>;

fn thread_id(index: usize) -> String {
    format!("019fe7af-e2fa-70f3-88e8-99d59e10{index:04x}")
}

fn listed_thread(id: &str) -> Value {
    json!({
        "id": id,
        "name": "Listed thread",
        "preview": "listed",
        "source": "cli",
        "status": {"type": "idle"},
        "recencyAt": 10,
        "updatedAt": 10,
        "turns": []
    })
}

/// What the shell App Server answers to `thread/list`, and the gate that can
/// hold the answer open.
#[derive(Clone)]
struct ShellCatalog {
    rows: Arc<Mutex<Vec<Value>>>,
    gate: Arc<Semaphore>,
    held: Arc<Mutex<bool>>,
}

impl ShellCatalog {
    fn new() -> Self {
        Self {
            rows: Arc::new(Mutex::new(Vec::new())),
            gate: Arc::new(Semaphore::new(0)),
            held: Arc::new(Mutex::new(false)),
        }
    }

    fn set_rows(&self, rows: Vec<Value>) {
        if let Ok(mut current) = self.rows.lock() {
            *current = rows;
        }
    }

    fn hold(&self, held: bool) {
        if let Ok(mut current) = self.held.lock() {
            *current = held;
        }
    }

    fn release(&self) {
        self.gate.add_permits(1);
    }
}

struct Harness {
    url: String,
    store: Arc<IndexStore>,
    events: broadcast::Sender<Value>,
    catalog: ShellCatalog,
    tasks: Vec<JoinHandle<()>>,
    _directory: tempfile::TempDir,
}

impl Harness {
    async fn start() -> Result<Self, Box<dyn std::error::Error>> {
        let directory = tempfile::tempdir()?;
        let socket_path = directory.path().join("app-server.sock");
        let catalog = ShellCatalog::new();
        let shell_catalog = catalog.clone();
        let app_server = tokio::spawn(async move {
            let _ = run_shell_app_server(socket_path, shell_catalog).await;
        });
        let upstream = UpstreamHandle::spawn(directory.path().join("app-server.sock"));
        wait_for_live(&upstream).await?;
        let store = Arc::new(IndexStore::open(directory.path().join("state.redb"))?);
        let history = HistoryService::new(
            Arc::new(SessionCatalog::scan(directory.path())),
            Arc::new(RolloutStore::attach(store.database(), store.clone())?),
        );
        let sync = SyncHub::with_mutations(upstream, store.clone(), history);
        let (events, receiver) = broadcast::channel(256);
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
            catalog,
            tasks: vec![app_server, server],
            _directory: directory,
        })
    }

    /// Journals one event and waits until it is durable.
    async fn journal(&self, payload: Value) -> Result<u64, Box<dyn std::error::Error>> {
        self.journal_all([payload]).await
    }

    /// Sends the events back to back, so the ingest journals them as one
    /// batch, and waits until every one is durable. Journaling them one at a
    /// time would make each wait for its own commit.
    async fn journal_all(
        &self,
        payloads: impl IntoIterator<Item = Value>,
    ) -> Result<u64, Box<dyn std::error::Error>> {
        let before = self.store.replay_head()?;
        let mut sent = 0;
        for payload in payloads {
            self.events.send(payload)?;
            sent += 1;
        }
        let store = self.store.clone();
        timeout(Duration::from_secs(2), async move {
            loop {
                let head = store.replay_head()?;
                if head >= before + sent {
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

    /// Connects with a null cursor and the given interest and visibility.
    async fn connect(
        &self,
        interest: Value,
        visible: bool,
    ) -> Result<ClientSocket, Box<dyn std::error::Error>> {
        let mut socket = self.authenticated().await?;
        send_json(
            &mut socket,
            &json!({
                "type": "hello", "protocolVersion": 1, "cursor": null,
                "interest": interest, "listStream": {"visible": visible}
            }),
        )
        .await?;
        let hello = receive_type(&mut socket, "hello").await?;
        send_json(
            &mut socket,
            &json!({"type": "snapshotApplied", "cursor": hello["headCursor"]}),
        )
        .await?;
        receive_type(&mut socket, "caughtUp").await?;
        Ok(socket)
    }

    /// Reads one `thread/list` page on `socket` and returns its rows.
    async fn list(
        &self,
        socket: &mut ClientSocket,
        archived: bool,
    ) -> Result<Vec<Value>, Box<dyn std::error::Error>> {
        send_json(
            socket,
            &json!({"type": "rpc", "request": {
                "id": "list", "method": "thread/list",
                "params": {"limit": 50, "archived": archived, "sourceKinds": ["cli", "vscode"]}
            }}),
        )
        .await?;
        let response = receive_type(socket, "rpc").await?;
        Ok(response["response"]["result"]["data"]
            .as_array()
            .cloned()
            .ok_or("thread/list has no rows")?)
    }

    fn stop(self) {
        for task in self.tasks {
            task.abort();
        }
    }
}

fn delta(thread_id: &str, text: &str) -> Value {
    json!({
        "method": "item/agentMessage/delta",
        "params": {"threadId": thread_id, "turnId": "turn", "itemId": "answer", "delta": text}
    })
}

fn turn_started(thread_id: &str, started_at: i64) -> Value {
    json!({
        "method": "turn/started",
        "params": {"threadId": thread_id, "turn": {"id": "turn", "items": [], "startedAt": started_at}}
    })
}

fn frame_ids(frame: &Value) -> Vec<String> {
    frame["rows"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|row| row["id"].as_str().map(str::to_owned))
        .collect()
}

#[tokio::test]
async fn hello_without_list_stream_and_invalid_frames_are_closed() -> TestResult {
    let harness = Harness::start().await?;
    for (hello, reason) in [
        (
            json!({"type": "hello", "protocolVersion": 1, "cursor": null, "interest": []}),
            "list_stream_required",
        ),
        (
            json!({"type": "hello", "protocolVersion": 1, "cursor": null, "interest": [],
                "listStream": {"visible": "yes"}}),
            "invalid_list_stream",
        ),
    ] {
        let mut socket = harness.authenticated().await?;
        send_json(&mut socket, &hello).await?;
        assert_eq!(
            receive_close(&mut socket).await?,
            (LIST_STREAM_CLOSE_CODE, reason.to_owned()),
            "{hello}"
        );
    }
    let mut socket = harness.connect(json!([]), true).await?;
    send_json(&mut socket, &json!({"type": "listStream"})).await?;
    assert_eq!(
        receive_close(&mut socket).await?,
        (LIST_STREAM_CLOSE_CODE, "invalid_list_stream".to_owned())
    );
    harness.stop();
    Ok(())
}

#[tokio::test]
async fn page_rows_carry_the_pre_read_head_and_ten_changes_share_one_frame() -> TestResult {
    let harness = Harness::start().await?;
    let threads = (0..10).map(thread_id).collect::<Vec<_>>();
    harness
        .catalog
        .set_rows(threads.iter().map(|id| listed_thread(id)).collect());
    let mut socket = harness.connect(json!([]), true).await?;
    let head = harness.journal(turn_started(&thread_id(99), 1)).await?;
    let rows = harness.list(&mut socket, true).await?;
    assert_eq!(rows.len(), threads.len());
    for row in &rows {
        assert_eq!(
            row[ROW_FIELD],
            json!({"cursor": head, "archived": true, "liveActivity": null})
        );
    }

    // The leading edge after silence flushes the first change at once.
    harness.journal(delta(&threads[0], "first")).await?;
    let first = receive_type(&mut socket, FRAME_TYPE).await?;
    assert_eq!(frame_ids(&first), [threads[0].clone()]);
    let started = Instant::now();
    harness
        .journal_all(threads.iter().map(|id| delta(id, " more")))
        .await?;
    assert!(
        started.elapsed() < COALESCE_INTERVAL,
        "the changes share one interval"
    );
    let batch = receive_type(&mut socket, FRAME_TYPE).await?;
    assert_eq!(frame_ids(&batch), threads, "one frame with ten rows");
    assert_eq!(batch["removed"], json!([]));
    assert_eq!(batch["rows"][3]["preview"], " more");
    assert!(
        batch["rows"][3][ROW_FIELD]["cursor"]
            .as_u64()
            .is_some_and(|cursor| cursor > head)
    );
    harness.stop();
    Ok(())
}

#[tokio::test]
async fn a_page_answered_after_a_change_keeps_the_hub_row() -> TestResult {
    let harness = Harness::start().await?;
    let thread = thread_id(1);
    harness.catalog.set_rows(vec![listed_thread(&thread)]);
    let mut socket = harness.connect(json!([]), false).await?;
    harness.list(&mut socket, false).await?;
    let head = harness.store.replay_head()?;

    harness.catalog.hold(true);
    send_json(
        &mut socket,
        &json!({"type": "rpc", "request": {"id": "held", "method": "thread/list", "params": {"limit": 50}}}),
    )
    .await?;
    // The page is being read; the thread starts a turn meanwhile.
    tokio::time::sleep(Duration::from_millis(100)).await;
    let changed = harness.journal(turn_started(&thread, 77)).await?;
    assert!(changed > head);
    harness.catalog.release();
    let response = receive_type(&mut socket, "rpc").await?;
    let row = &response["response"]["result"]["data"][0];
    assert_eq!(row["status"], json!({"type": "active", "activeFlags": []}));
    assert_eq!(row["recencyAt"], 77);
    assert_eq!(
        row[ROW_FIELD]["cursor"], changed,
        "provider content never claims the cursor of a later change"
    );
    harness.stop();
    Ok(())
}

#[tokio::test]
async fn an_invisible_socket_receives_no_rows_until_visible() -> TestResult {
    let harness = Harness::start().await?;
    let thread = thread_id(1);
    harness.catalog.set_rows(vec![listed_thread(&thread)]);
    let mut socket = harness.connect(json!([]), false).await?;
    harness.list(&mut socket, false).await?;
    harness.journal(turn_started(&thread, 20)).await?;
    // A pong proves the socket is idle: no rows frame came before it.
    send_json(&mut socket, &json!({"type": "ping", "nonce": "idle"})).await?;
    let pong = receive_any(&mut socket, &["pong", FRAME_TYPE]).await?;
    assert_eq!(pong["type"], "pong");

    send_json(&mut socket, &json!({"type": "listStream", "visible": true})).await?;
    harness.journal(delta(&thread, "visible now")).await?;
    let frame = receive_type(&mut socket, FRAME_TYPE).await?;
    assert_eq!(frame["rows"][0]["preview"], "visible now");
    harness.stop();
    Ok(())
}

#[tokio::test]
async fn a_thread_below_every_page_appears_when_its_turn_starts() -> TestResult {
    let harness = Harness::start().await?;
    let mut socket = harness.connect(json!([]), true).await?;
    let far = thread_id(42);
    let cursor = harness.journal(turn_started(&far, 500)).await?;
    let frame = receive_type(&mut socket, FRAME_TYPE).await?;
    let row = &frame["rows"][0];
    assert_eq!(row["id"], far);
    assert_eq!(row["status"]["type"], "active");
    assert_eq!(row["recencyAt"], 500);
    assert_eq!(row["turns"], json!([]));
    assert!(
        row[ROW_FIELD]["cursor"]
            .as_u64()
            .is_some_and(|row_cursor| row_cursor >= cursor)
    );
    harness.stop();
    Ok(())
}

#[tokio::test]
async fn an_interest_thread_flushes_before_the_coalesce_interval() -> TestResult {
    let harness = Harness::start().await?;
    let thread = thread_id(1);
    harness.catalog.set_rows(vec![listed_thread(&thread)]);
    let mut open = harness.connect(json!([thread]), true).await?;
    let mut list = harness.connect(json!([]), true).await?;
    harness.list(&mut open, false).await?;
    harness.journal(delta(&thread, "a")).await?;
    receive_type(&mut open, FRAME_TYPE).await?;
    receive_type(&mut list, FRAME_TYPE).await?;
    // Both sockets flushed just now; the next change is inside both intervals.
    let flushed_at = Instant::now();
    harness.journal(delta(&thread, "b")).await?;
    receive_type(&mut open, FRAME_TYPE).await?;
    let open_elapsed = flushed_at.elapsed();
    receive_type(&mut list, FRAME_TYPE).await?;
    let list_elapsed = flushed_at.elapsed();
    assert!(
        open_elapsed < Duration::from_secs(1),
        "the open chat's row followed in {open_elapsed:?}"
    );
    assert!(
        list_elapsed + Duration::from_millis(100) >= COALESCE_INTERVAL,
        "the list-only socket waited for the coalesce interval ({list_elapsed:?})"
    );
    harness.stop();
    Ok(())
}

#[tokio::test]
async fn deletion_reaches_the_list_as_a_tombstone() -> TestResult {
    let harness = Harness::start().await?;
    let thread = thread_id(1);
    harness.catalog.set_rows(vec![listed_thread(&thread)]);
    let mut socket = harness.connect(json!([]), true).await?;
    harness.list(&mut socket, false).await?;
    let cursor = harness
        .journal(json!({"method": "thread/deleted", "params": {"threadId": thread}}))
        .await?;
    let frame = receive_type(&mut socket, FRAME_TYPE).await?;
    assert_eq!(frame["rows"], json!([]));
    assert_eq!(
        frame["removed"],
        json!([{"threadId": thread, "cursor": cursor}])
    );
    harness.stop();
    Ok(())
}

async fn run_shell_app_server(
    socket_path: std::path::PathBuf,
    catalog: ShellCatalog,
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
        let result = match method {
            "thread/list" => {
                let held = catalog.held.lock().is_ok_and(|held| *held);
                if held {
                    catalog.gate.acquire().await?.forget();
                    catalog.hold(false);
                }
                let rows = catalog
                    .rows
                    .lock()
                    .map(|rows| rows.clone())
                    .unwrap_or_default();
                json!({"data": rows, "nextCursor": null, "backwardsCursor": null})
            }
            "thread/read" => {
                let thread_id = request
                    .pointer("/params/threadId")
                    .and_then(Value::as_str)
                    .unwrap_or_default();
                let mut thread = listed_thread(thread_id);
                thread["status"] = json!({"type": "notLoaded"});
                json!({"thread": thread})
            }
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

/// The next frame of one of `types`, skipping journal and status frames.
async fn receive_any(
    socket: &mut ClientSocket,
    types: &[&str],
) -> Result<Value, Box<dyn std::error::Error>> {
    timeout(Duration::from_secs(4), async {
        loop {
            let frame = socket.next().await.ok_or("WebSocket closed")??;
            if let Message::Text(raw) = frame {
                let value: Value = serde_json::from_str(&raw)?;
                if value
                    .get("type")
                    .and_then(Value::as_str)
                    .is_some_and(|kind| types.contains(&kind))
                {
                    return Ok(value);
                }
            }
        }
    })
    .await?
}

async fn receive_type(
    socket: &mut ClientSocket,
    expected_type: &str,
) -> Result<Value, Box<dyn std::error::Error>> {
    receive_any(socket, &[expected_type]).await
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

async fn send_json(socket: &mut ClientSocket, value: &Value) -> TestResult {
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
