//! Live-provider smoke support and the explicitly ignored Claude host probe.

use super::*;

pub(super) async fn wait_for_state(
    store: &Arc<IndexStore>,
    command_id: &str,
    state: OutboxState,
) -> TestResult {
    timeout(Duration::from_secs(3), async {
        loop {
            if store
                .outbox_list(None)?
                .iter()
                .any(|command| command.command_id == command_id && command.state == state)
            {
                return Ok::<(), Box<dyn std::error::Error>>(());
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    })
    .await??;
    Ok(())
}

pub(super) async fn connect_client_with_hello(
    url: &str,
) -> Result<(ClientSocket, Value), Box<dyn std::error::Error>> {
    let mut request = url.into_client_request()?;
    request.headers_mut().insert(
        "authorization",
        HeaderValue::from_str(&format!("Bearer {TOKEN}"))?,
    );
    let (mut socket, _response) = connect_async(request).await?;
    send_json(
        &mut socket,
        &json!({"type": "hello", "protocolVersion": 1, "listStream": {"visible": false}, "cursor": null, "interest": []}),
    )
    .await?;
    let hello = receive_type_where(&mut socket, "hello").await?;
    send_json(
        &mut socket,
        &json!({"type": "snapshotApplied", "cursor": hello["headCursor"]}),
    )
    .await?;
    receive_type_where(&mut socket, "caughtUp").await?;
    Ok((socket, hello))
}

pub(super) async fn receive_any(
    socket: &mut ClientSocket,
) -> Result<Value, Box<dyn std::error::Error>> {
    loop {
        let frame = socket.next().await.ok_or("WebSocket closed")??;
        if let Message::Text(raw) = frame {
            return Ok(serde_json::from_str(&raw)?);
        }
    }
}

pub(super) async fn receive_type_where(
    socket: &mut ClientSocket,
    expected: &str,
) -> Result<Value, Box<dyn std::error::Error>> {
    timeout(Duration::from_secs(3), async {
        loop {
            let value = receive_any(socket).await?;
            if value["type"] == expected {
                return Ok(value);
            }
        }
    })
    .await?
}

pub(super) async fn send_json(socket: &mut ClientSocket, value: &Value) -> TestResult {
    socket.send(Message::Text(value.to_string().into())).await?;
    Ok(())
}

pub(super) async fn wait_for_live(upstream: &UpstreamHandle) -> TestResult {
    let mut status = upstream.subscribe_status();
    timeout(Duration::from_secs(2), async {
        loop {
            if *status.borrow() == ConnectionStatus::Live {
                return Ok::<(), Box<dyn std::error::Error>>(());
            }
            status.changed().await?;
        }
    })
    .await??;
    Ok(())
}

pub(super) async fn receive_value(
    socket: &mut WebSocketStream<UnixStream>,
) -> Result<Value, Box<dyn std::error::Error + Send + Sync>> {
    loop {
        let frame = socket.next().await.ok_or("WebSocket closed")??;
        if let Message::Text(raw) = frame {
            return Ok(serde_json::from_str(&raw)?);
        }
    }
}

pub(super) async fn send_value(
    socket: &mut WebSocketStream<UnixStream>,
    value: &Value,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    socket.send(Message::Text(value.to_string().into())).await?;
    Ok(())
}

/// Real `claude` smoke without any model call. Run with
/// `CODEWIDE_SMOKE_CLAUDE=<claude> cargo test -p codewide-companion --test
/// agent_providers -- --ignored real_claude`.
#[tokio::test]
#[ignore = "needs the claude CLI on the host"]
async fn real_claude_serves_threads_catalogs_and_degradation_without_a_turn() -> TestResult {
    use codewide_companion::agent::{
        providers::claude::{ClaudeConfig, ClaudeProvider, config::ClaudeDefaults},
        registry::ProviderRegistry,
    };

    let variable = |name: &str| std::env::var(name).map_err(|_| format!("{name} is not set"));
    let directory = tempfile::tempdir()?;
    let socket_path = directory.path().join("app-server.sock");
    let upstream_path = socket_path.clone();
    let (_pushed, pushed_rx) = mpsc::channel(4);
    let (observed_tx, _observed) = mpsc::unbounded_channel();
    let app_server = tokio::spawn(async move {
        let _ = run_app_server(socket_path, pushed_rx, observed_tx, default_answer).await;
    });
    let upstream = UpstreamHandle::spawn(upstream_path);
    wait_for_live(&upstream).await?;
    let claude = ClaudeProvider::spawn(&ClaudeConfig::parse(
        &json!({
            "claudeExecutable": variable("CODEWIDE_SMOKE_CLAUDE")?,
            "journalDirectory": directory.path().join("journal"),
        }),
        &ClaudeDefaults::default(),
    )?);
    let mut status = claude.subscribe_status();
    timeout(Duration::from_secs(30), async {
        while *status.borrow() != ProviderStatus::Live {
            status.changed().await?;
        }
        Ok::<(), Box<dyn std::error::Error>>(())
    })
    .await??;
    let store = Arc::new(IndexStore::open(directory.path().join("state.redb"))?);
    let history = HistoryService::new(
        Arc::new(SessionCatalog::scan(directory.path())),
        Arc::new(RolloutStore::attach(store.database(), store.clone())?),
    );
    let registry = ProviderRegistry::new(
        vec![
            Arc::new(CodexProvider::new(upstream).with_storage(CodexStorage::new(history)))
                as Arc<dyn AgentProvider>,
            claude.clone() as Arc<dyn AgentProvider>,
        ],
        &ProviderId::from_static("codex"),
        Vec::new(),
    )?;
    let sync = SyncHub::with_registry(Arc::new(registry), store.clone(), true);
    let listener = TcpListener::bind("127.0.0.1:0").await?;
    let address = listener.local_addr()?;
    let app = server::router(store.clone(), Arc::from(TOKEN), sync);
    let server_task = tokio::spawn(async move {
        let _ = axum::serve(listener, app).await;
    });
    let (client, _) = connect_client_with_hello(&format!("ws://{address}/v1/sync")).await?;
    let (fake, events) = FakeNeutral::new();
    let (pushed, _) = mpsc::channel(1);
    let (_, observed) = mpsc::unbounded_channel();
    let mut harness = Harness {
        client,
        fake,
        events,
        pushed,
        observed,
        store,
        url: String::new(),
        tasks: vec![app_server, server_task],
        _directory: directory,
    };
    let models = harness
        .rpc("models", "model/list", json!({"limit": 100}))
        .await?;
    let claude_rows = models["result"]["data"]
        .as_array()
        .map(|rows| {
            rows.iter()
                .filter(|row| row["codewideAgentProvider"] == "claude")
                .cloned()
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    assert!(!claude_rows.is_empty(), "{models}");
    assert!(claude_rows.iter().all(|row| {
        row["displayName"]
            .as_str()
            .is_some_and(|name| !name.is_empty())
    }));
    let model = claude_rows[0]["model"].clone();
    let started = harness
        .rpc(
            "start",
            "thread/start",
            json!({"cwd": "/tmp", "model": model, "codewideAgentProvider": "claude"}),
        )
        .await?;
    let thread_id = started["result"]["thread"]["id"]
        .as_str()
        .ok_or_else(|| format!("thread/start failed: {started}"))?
        .to_owned();
    assert_eq!(
        started["result"]["thread"]["codewideAgent"]["provider"],
        "claude"
    );
    let read = harness
        .rpc("read", "thread/read", json!({"threadId": thread_id}))
        .await?;
    assert_eq!(read["result"]["thread"]["id"], thread_id);
    let interrupted = harness
        .rpc(
            "interrupt",
            "turn/interrupt",
            json!({"threadId": thread_id, "turnId": null}),
        )
        .await?;
    assert_eq!(interrupted["result"], json!({}), "{interrupted}");
    let review = harness
        .rpc("review", "review/start", json!({"threadId": thread_id}))
        .await?;
    assert_eq!(review["error"]["code"], -32072);
    let synced = harness
        .rpc(
            "sync",
            "companion/thread/sync",
            json!({"threadId": thread_id, "limit": 20}),
        )
        .await?;
    assert_eq!(synced["result"]["history"]["kind"], "reset", "{synced}");
    // The snapshot carries the thread's sub-agent tree, the answer of
    // `companion/threadSubagents/read`; this thread spawned none.
    assert_eq!(
        synced["result"]["subagents"],
        json!({"threads": []}),
        "{synced}"
    );
    harness.stop();
    Ok(())
}
