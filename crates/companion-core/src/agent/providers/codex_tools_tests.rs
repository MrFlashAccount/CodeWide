//! The Codex wiring of the orchestration tools against a fake App Server:
//! `thread/start` declares them as `dynamicTools`, an `item/tool/call` for
//! one of them is answered by the companion and never reaches the client,
//! and every other frame keeps today's byte-identical client wire.

use std::{sync::Arc, time::Duration};

use async_trait::async_trait;
use futures_util::{SinkExt, StreamExt};
use serde_json::{Value, json};
use tokio::{net::UnixListener, sync::mpsc};
use tokio_tungstenite::{accept_async, tungstenite::Message};

use super::codex::CodexProvider;
use crate::{
    agent::{
        client_wire::{WireProvider, events::EventProjector},
        model::{ClientToolSpec, ProviderId, ToolCallParams, ToolCallResult},
        provider::{AgentProvider, ClientToolHost, ProviderEvent},
    },
    upstream::UpstreamHandle,
};

type TestResult = Result<(), Box<dyn std::error::Error>>;

/// Records calls and answers with the tool name.
struct RecordingHost {
    specs: Vec<ClientToolSpec>,
    calls: mpsc::UnboundedSender<(ProviderId, ToolCallParams)>,
}

#[async_trait]
impl ClientToolHost for RecordingHost {
    fn specs(&self) -> &[ClientToolSpec] {
        &self.specs
    }

    async fn call(&self, provider: &ProviderId, call: ToolCallParams) -> ToolCallResult {
        let tool = call.tool.clone();
        let _ = self.calls.send((provider.clone(), call));
        ToolCallResult::text(format!("{{\"answered\":\"{tool}\"}}"))
    }
}

/// A fake App Server: answers `initialize`, sends `frames`, then forwards
/// every client message to `received` and answers requests with `{}`.
async fn fake_app_server(
    listener: UnixListener,
    frames: Vec<Value>,
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
    for frame in frames {
        socket.send(Message::Text(frame.to_string().into())).await?;
    }
    while let Some(Ok(Message::Text(text))) = socket.next().await {
        let message: Value = serde_json::from_str(&text)?;
        if message.get("method").is_some() {
            socket
                .send(Message::Text(
                    json!({"id": message["id"], "result": {"thread": {"id": "t-new"}}})
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
    provider: Arc<CodexProvider>,
    projected: mpsc::UnboundedReceiver<Value>,
    received: mpsc::UnboundedReceiver<Value>,
    calls: mpsc::UnboundedReceiver<(ProviderId, ToolCallParams)>,
    _directory: tempfile::TempDir,
}

fn connect(frames: Vec<Value>) -> Result<Connected, Box<dyn std::error::Error>> {
    let directory = tempfile::tempdir()?;
    let socket_path = directory.path().join("app-server.sock");
    let listener = UnixListener::bind(&socket_path)?;
    let (received_tx, received) = mpsc::unbounded_channel();
    tokio::spawn(fake_app_server(listener, frames, received_tx));
    let provider = Arc::new(CodexProvider::new(UpstreamHandle::spawn(socket_path)));
    let (calls_tx, calls) = mpsc::unbounded_channel();
    provider.install_client_tools(Arc::new(RecordingHost {
        specs: crate::agent::orchestration::tools::specs(),
        calls: calls_tx,
    }));
    let mut events = provider.take_events();
    let mut projector = EventProjector::new(WireProvider {
        descriptor: provider.descriptor(),
        capabilities: provider.capabilities(),
        primary_id: provider.descriptor().id,
        multi_provider: false,
    });
    let (projected_tx, projected) = mpsc::unbounded_channel();
    tokio::spawn(async move {
        while let Some(event) = events.recv().await {
            if let ProviderEvent::Event(event) = event {
                for payload in projector.project(*event) {
                    let _ = projected_tx.send(payload);
                }
            }
        }
    });
    Ok(Connected {
        provider,
        projected,
        received,
        calls,
        _directory: directory,
    })
}

async fn next<T>(
    receiver: &mut mpsc::UnboundedReceiver<T>,
) -> Result<T, Box<dyn std::error::Error>> {
    Ok(
        tokio::time::timeout(Duration::from_secs(5), receiver.recv())
            .await?
            .ok_or("channel closed")?,
    )
}

const THREAD: &str = "01a12092-346f-7d32-8dc8-ef1150dced2e";

#[tokio::test]
async fn orchestration_calls_are_answered_by_the_companion_and_hidden_from_the_client() -> TestResult
{
    let foreign = json!({"id": 9, "method": "item/tool/call", "params": {
        "threadId": THREAD, "turnId": "t", "callId": "c0", "namespace": null,
        "tool": "readChat", "arguments": {}}});
    let ours = json!({"id": "srv-41", "method": "item/tool/call", "params": {
        "threadId": THREAD, "turnId": "turn-1", "callId": "call-1", "namespace": null,
        "tool": "codewide_list_agents", "arguments": {}}});
    let namespaced = json!({"id": 42, "method": "item/tool/call", "params": {
        "threadId": THREAD, "turnId": "turn-1", "callId": "call-2", "namespace": "codex_app",
        "tool": "codewide_list_agents", "arguments": {}}});
    let resolved = json!({"method": "serverRequest/resolved", "params": {"threadId": THREAD, "requestId": "srv-41"}});
    let other_resolved =
        json!({"method": "serverRequest/resolved", "params": {"threadId": THREAD, "requestId": 9}});
    let marker = json!({"method": "thread/status/changed", "params": {"threadId": THREAD, "status": {"type": "idle"}}});
    let mut connected = connect(vec![
        foreign.clone(),
        ours,
        namespaced.clone(),
        resolved,
        other_resolved.clone(),
        marker.clone(),
    ])?;

    // The client wire keeps every frame except our call and its resolution,
    // byte for byte.
    for expected in [foreign, namespaced, other_resolved, marker] {
        assert_eq!(
            next(&mut connected.projected).await?.to_string(),
            expected.to_string()
        );
    }
    let (provider, call) = next(&mut connected.calls).await?;
    assert_eq!(provider.as_str(), "codex");
    assert_eq!(call.app_thread_id.as_str(), THREAD);
    assert_eq!(call.turn_id.as_str(), "turn-1");
    assert_eq!(call.call_id, "call-1");
    let response = next(&mut connected.received).await?;
    assert_eq!(
        response,
        json!({"id": "srv-41", "result": {
            "contentItems": [{"type": "inputText", "text": "{\"answered\":\"codewide_list_agents\"}"}],
            "success": true}})
    );
    Ok(())
}

#[tokio::test]
async fn thread_start_declares_the_tools_as_dynamic_functions() -> TestResult {
    let mut connected = connect(Vec::new())?;
    let mut status = connected.provider.subscribe_status();
    tokio::time::timeout(Duration::from_secs(5), async {
        while *status.borrow() != crate::agent::provider::ProviderStatus::Live {
            if status.changed().await.is_err() {
                break;
            }
        }
    })
    .await?;
    let native = connected
        .provider
        .native_surface()
        .ok_or("codex has the native surface")?;
    native
        .request(json!({"id": 1, "method": "thread/start", "params": {"cwd": "/w"}}))
        .await?;
    let start = next(&mut connected.received).await?;
    let declared = start["params"]["dynamicTools"]
        .as_array()
        .ok_or("no dynamicTools")?;
    assert_eq!(
        declared
            .iter()
            .map(|tool| (tool["type"].as_str(), tool["name"].as_str()))
            .collect::<Vec<_>>(),
        crate::agent::orchestration::tools::specs()
            .iter()
            .map(|spec| (Some("function"), Some(spec.name.as_str())))
            .collect::<Vec<_>>()
    );
    assert!(
        declared
            .iter()
            .all(|tool| tool["inputSchema"]["type"] == "object")
    );
    assert_eq!(start["params"]["cwd"], "/w");
    // Other requests are forwarded unchanged.
    native
        .request(json!({"id": 2, "method": "thread/resume", "params": {"threadId": "t"}}))
        .await?;
    let resume = next(&mut connected.received).await?;
    assert_eq!(resume["params"], json!({"threadId": "t"}));
    Ok(())
}
