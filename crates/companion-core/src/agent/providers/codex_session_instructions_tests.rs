//! The `CodeWide` client conventions on the Codex adapter against a fake App
//! Server: the registry installs them, and every `thread/start`,
//! `thread/resume` and `thread/fork` sent upstream (neutral create, the
//! client's pass-through and the adapter's own history-free resume) carries
//! them as `developerInstructions` after the session's own instructions,
//! without repeating them.

use std::{sync::Arc, time::Duration};

use futures_util::{SinkExt, StreamExt};
use serde_json::{Value, json};
use tokio::{net::UnixListener, sync::mpsc};
use tokio_tungstenite::{accept_async, tungstenite::Message};

use super::{build_registry, codex::CodexProvider};
use crate::{
    agent::{
        client_conventions::CLIENT_CONVENTIONS,
        model::{AppThreadId, ThreadCreateParams, ThreadSettings},
        provider::{AgentProvider, NativeSurface, ProviderStatus},
    },
    upstream::UpstreamHandle,
};

type TestResult = Result<(), Box<dyn std::error::Error>>;

const THREAD: &str = "01a174d1-5a37-7b71-972f-434248b34506";

/// Answers `initialize`, `config/read` with `configured` as the effective
/// `developer_instructions`, and every other request with a thread result.
/// Every request is forwarded to `received`.
async fn fake_app_server(
    listener: UnixListener,
    configured: Value,
    received: mpsc::UnboundedSender<Value>,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let (stream, _) = listener.accept().await?;
    let mut socket = accept_async(stream).await?;
    let Some(Ok(Message::Text(initialize))) = socket.next().await else {
        return Err("no initialize".into());
    };
    let initialize: Value = serde_json::from_str(&initialize)?;
    socket
        .send(Message::Text(
            json!({"id": initialize["id"], "result": {}})
                .to_string()
                .into(),
        ))
        .await?;
    let _initialized = socket.next().await;
    while let Some(Ok(Message::Text(text))) = socket.next().await {
        let message: Value = serde_json::from_str(&text)?;
        if message.get("method").is_some() {
            let result = if message["method"] == "config/read" {
                json!({"config": {"developer_instructions": configured}, "origins": {}, "layers": null})
            } else {
                json!({"thread": {"id": THREAD}, "turn": {"id": "turn-1"}})
            };
            socket
                .send(Message::Text(
                    json!({"id": message["id"], "result": result})
                        .to_string()
                        .into(),
                ))
                .await?;
        }
        let _ = received.send(message);
    }
    Ok(())
}

struct Connected {
    codex: Arc<CodexProvider>,
    received: mpsc::UnboundedReceiver<Value>,
    _directory: tempfile::TempDir,
}

/// The Codex adapter of a registry built as the companion builds it, live
/// on a fake App Server whose configuration names `configured`.
async fn connect(configured: Value) -> Result<Connected, Box<dyn std::error::Error>> {
    let directory = tempfile::tempdir()?;
    let socket_path = directory.path().join("app-server.sock");
    let listener = UnixListener::bind(&socket_path)?;
    let (received_tx, received) = mpsc::unbounded_channel();
    tokio::spawn(fake_app_server(listener, configured, received_tx));
    let codex = Arc::new(CodexProvider::new(UpstreamHandle::spawn(socket_path)));
    // Codex only, so the test never runs the machine's `claude`.
    let _registry = build_registry(codex.clone(), Vec::new());
    let mut status = codex.subscribe_status();
    tokio::time::timeout(Duration::from_secs(5), async {
        while *status.borrow() != ProviderStatus::Live {
            if status.changed().await.is_err() {
                break;
            }
        }
    })
    .await?;
    Ok(Connected {
        codex,
        received,
        _directory: directory,
    })
}

/// The next request with `method`, skipping others.
async fn next_request(
    received: &mut mpsc::UnboundedReceiver<Value>,
    method: &str,
) -> Result<Value, Box<dyn std::error::Error>> {
    loop {
        let message = tokio::time::timeout(Duration::from_secs(5), received.recv())
            .await?
            .ok_or("channel closed")?;
        if message["method"] == method {
            return Ok(message);
        }
    }
}

fn conventions() -> &'static str {
    CLIENT_CONVENTIONS.text()
}

fn native(codex: &CodexProvider) -> Result<&dyn NativeSurface, Box<dyn std::error::Error>> {
    Ok(codex
        .native_surface()
        .ok_or("codex has the native surface")?)
}

#[tokio::test]
async fn a_new_thread_gets_the_conventions_after_the_configured_instructions() -> TestResult {
    let mut connected = connect(json!("Prefer small diffs.")).await?;
    native(&connected.codex)?
        .request(json!({"id": 1, "method": "thread/start", "params": {"cwd": "/w"}}))
        .await?;
    let read = next_request(&mut connected.received, "config/read").await?;
    assert_eq!(read["params"]["cwd"], "/w");
    let start = next_request(&mut connected.received, "thread/start").await?;
    assert_eq!(
        start["params"]["developerInstructions"],
        format!("Prefer small diffs.\n\n{}", conventions())
    );
    assert_eq!(start["params"]["cwd"], "/w");

    connected
        .codex
        .thread_create(ThreadCreateParams {
            app_thread_id: None,
            cwd: "/w".into(),
            settings: ThreadSettings {
                model: "gpt-5".into(),
                effort: None,
                permission_profile: ":workspace".into(),
                service_tier: None,
            },
            client_tools: None,
        })
        .await?;
    let start = next_request(&mut connected.received, "thread/start").await?;
    assert_eq!(
        start["params"]["developerInstructions"],
        format!("Prefer small diffs.\n\n{}", conventions())
    );
    Ok(())
}

#[tokio::test]
async fn every_resume_and_fork_carries_the_conventions_once() -> TestResult {
    let mut connected = connect(Value::Null).await?;
    let native = native(&connected.codex)?;
    for id in [1, 2] {
        native
            .request(json!({"id": id, "method": "thread/resume", "params": {"threadId": THREAD}}))
            .await?;
        let resume = next_request(&mut connected.received, "thread/resume").await?;
        assert_eq!(resume["params"]["developerInstructions"], conventions());
    }
    native
        .request(json!({"id": 3, "method": "thread/fork", "params": {"threadId": THREAD}}))
        .await?;
    let fork = next_request(&mut connected.received, "thread/fork").await?;
    assert_eq!(fork["params"]["developerInstructions"], conventions());
    // A request that already carries them is not given them again.
    native
        .request(json!({"id": 4, "method": "thread/resume", "params": {
            "threadId": THREAD,
            "developerInstructions": format!("Client.\n\n{}", conventions()),
        }}))
        .await?;
    let resume = next_request(&mut connected.received, "thread/resume").await?;
    assert_eq!(
        resume["params"]["developerInstructions"],
        format!("Client.\n\n{}", conventions())
    );
    Ok(())
}

#[tokio::test]
async fn client_instructions_are_kept_and_the_conventions_appended() -> TestResult {
    let mut connected = connect(json!("Configured, replaced by the client's.")).await?;
    let native = native(&connected.codex)?;
    native
        .request(json!({"id": 1, "method": "thread/fork", "params": {
            "threadId": THREAD,
            "developerInstructions": "Answer in French.",
        }}))
        .await?;
    let fork = next_request(&mut connected.received, "thread/fork").await?;
    assert_eq!(
        fork["params"]["developerInstructions"],
        format!("Answer in French.\n\n{}", conventions())
    );
    // A prediction fork refuses configuration overrides: unchanged.
    let prediction = json!({
        "threadId": THREAD,
        "experimentalPredictionMode": true,
        "ephemeral": true,
    });
    native
        .request(json!({"id": 2, "method": "thread/fork", "params": prediction}))
        .await?;
    let fork = next_request(&mut connected.received, "thread/fork").await?;
    assert_eq!(fork["params"], prediction);
    Ok(())
}

#[tokio::test]
async fn the_adapters_own_history_free_resume_carries_the_conventions() -> TestResult {
    let mut connected = connect(Value::Null).await?;
    let thread = AppThreadId::parse(THREAD).ok_or("thread id")?;
    connected.codex.thread_observe(&thread).await?;
    let resume = next_request(&mut connected.received, "thread/resume").await?;
    assert_eq!(resume["params"]["threadId"], THREAD);
    assert_eq!(resume["params"]["excludeTurns"], true);
    assert_eq!(resume["params"]["developerInstructions"], conventions());
    Ok(())
}
