//! The Codex adapter's thread subscriptions against a fake App Server.
//!
//! The shared App Server delivers a thread's events only to subscribed
//! connections, and the companion's connection is new after each restart. A
//! turn started on a thread this connection never subscribed to subscribes
//! first with a history-free `thread/resume`; a thread this connection
//! started, resumed or already observed is not resumed again.

use std::{sync::Arc, time::Duration};

use futures_util::{SinkExt, StreamExt};
use serde_json::{Value, json};
use tokio::{net::UnixListener, sync::mpsc};
use tokio_tungstenite::{accept_async, tungstenite::Message};

use super::codex::CodexProvider;
use crate::{
    agent::{
        model::AppThreadId,
        provider::{AgentProvider, NativeSurface},
    },
    upstream::UpstreamHandle,
};

type TestResult = Result<(), Box<dyn std::error::Error>>;

const THREAD: &str = "01a174d1-5a37-7b71-972f-434248b34506";
const OTHER: &str = "01a174e8-a279-7e72-8cf2-8c5b51e10fff";

/// Answers `initialize`, then every request (forwarded to `received`) with a
/// result naming the request's thread.
async fn fake_app_server(
    listener: UnixListener,
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
        let thread_id = message
            .pointer("/params/threadId")
            .and_then(Value::as_str)
            .unwrap_or("t-new");
        let result = match message["method"].as_str() {
            Some("turn/start") => {
                json!({"turn": {"id": "turn-1", "status": "inProgress", "items": []}})
            }
            _ => json!({"thread": {"id": thread_id, "status": {"type": "idle"}, "turns": []}}),
        };
        socket
            .send(Message::Text(
                json!({"id": message["id"], "result": result})
                    .to_string()
                    .into(),
            ))
            .await?;
        let _ = received.send(message);
    }
    Ok(())
}

struct Connected {
    provider: Arc<CodexProvider>,
    received: mpsc::UnboundedReceiver<Value>,
    _directory: tempfile::TempDir,
}

async fn connect() -> Result<Connected, Box<dyn std::error::Error>> {
    let directory = tempfile::tempdir()?;
    let socket_path = directory.path().join("app-server.sock");
    let listener = UnixListener::bind(&socket_path)?;
    let (received_tx, received) = mpsc::unbounded_channel();
    tokio::spawn(fake_app_server(listener, received_tx));
    let upstream = UpstreamHandle::spawn(socket_path);
    tokio::time::timeout(Duration::from_secs(5), async {
        while upstream.status() != crate::upstream::ConnectionStatus::Live {
            tokio::time::sleep(Duration::from_millis(5)).await;
        }
    })
    .await?;
    Ok(Connected {
        provider: Arc::new(CodexProvider::new(upstream)),
        received,
        _directory: directory,
    })
}

async fn next(
    received: &mut mpsc::UnboundedReceiver<Value>,
) -> Result<Value, Box<dyn std::error::Error>> {
    Ok(
        tokio::time::timeout(Duration::from_secs(5), received.recv())
            .await?
            .ok_or("channel closed")?,
    )
}

async fn quiet(received: &mut mpsc::UnboundedReceiver<Value>) -> bool {
    tokio::time::timeout(Duration::from_millis(100), received.recv())
        .await
        .is_err()
}

fn turn_start(thread_id: &str, message: &str) -> Value {
    json!({"id": format!("start-{message}"), "method": "turn/start", "params": {
        "threadId": thread_id,
        "clientUserMessageId": message,
        "input": [{"type": "text", "text": message, "text_elements": []}],
    }})
}

fn assert_history_free_resume(request: &Value, thread_id: &str) {
    assert_eq!(request["method"], "thread/resume");
    // Exactly the thread and `excludeTurns`: no history is returned or read.
    assert_eq!(
        request["params"],
        json!({"threadId": thread_id, "excludeTurns": true})
    );
}

#[tokio::test]
async fn a_turn_on_an_unsubscribed_thread_subscribes_once_without_history() -> TestResult {
    let mut connected = connect().await?;
    connected
        .provider
        .dispatch_turn_start(turn_start(THREAD, "first"))
        .await
        .map_err(|error| error.to_string())?;
    assert_history_free_resume(&next(&mut connected.received).await?, THREAD);
    let first = next(&mut connected.received).await?;
    assert_eq!(first["method"], "turn/start");
    assert_eq!(first["params"]["clientUserMessageId"], "first");

    connected
        .provider
        .dispatch_turn_start(turn_start(THREAD, "follow-up"))
        .await
        .map_err(|error| error.to_string())?;
    let follow_up = next(&mut connected.received).await?;
    assert_eq!(
        follow_up["method"], "turn/start",
        "the connection is already subscribed"
    );
    assert!(quiet(&mut connected.received).await);
    Ok(())
}

#[tokio::test]
async fn observing_a_thread_subscribes_it_once_and_a_started_thread_needs_no_resume() -> TestResult
{
    let mut connected = connect().await?;
    let thread = AppThreadId::parse(THREAD).ok_or("thread id")?;
    connected.provider.thread_observe(&thread).await?;
    assert_history_free_resume(&next(&mut connected.received).await?, THREAD);
    connected.provider.thread_observe(&thread).await?;
    assert!(
        quiet(&mut connected.received).await,
        "an observed thread is not resumed again"
    );

    // A thread this connection resumed for a client (its sync) is subscribed.
    NativeSurface::request(
        connected.provider.as_ref(),
        json!({"id": "sync", "method": "thread/resume", "params": {"threadId": OTHER, "excludeTurns": true}}),
    )
    .await?;
    assert_eq!(
        next(&mut connected.received).await?["method"],
        "thread/resume"
    );
    connected
        .provider
        .dispatch_turn_start(turn_start(OTHER, "after-sync"))
        .await
        .map_err(|error| error.to_string())?;
    assert_eq!(next(&mut connected.received).await?["method"], "turn/start");
    assert!(quiet(&mut connected.received).await);
    Ok(())
}
