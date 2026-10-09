//! Golden replay of recorded Codex App Server streams through the Codex
//! adapter and the client-wire projector.
//!
//! `testdata/app_server_streams.jsonl` holds sanitized App Server frames
//! recorded from Codex 0.162 (paths and host names replaced). With one
//! provider every frame must reach the client wire byte-for-byte; with
//! several providers the only difference is the additive `codewideAgent`
//! extension on `thread/started` threads.

use std::{path::Path, time::Duration};

use futures_util::{SinkExt, StreamExt};
use serde_json::{Value, json};
use tokio::net::UnixListener;
use tokio_tungstenite::{accept_async, tungstenite::Message};

use super::codex::CodexProvider;
use crate::{
    agent::{
        client_wire::{WireProvider, events::EventProjector},
        provider::{AgentProvider, ProviderEvent, ProviderStatus},
    },
    upstream::UpstreamHandle,
};

fn recorded_frames() -> Result<Vec<Value>, Box<dyn std::error::Error>> {
    let path = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("src/agent/providers/testdata/app_server_streams.jsonl");
    let mut frames = std::fs::read_to_string(path)?
        .lines()
        .map(|line| serde_json::from_str::<Value>(line).map(|record| record["frame"].clone()))
        .collect::<Result<Vec<_>, _>>()?;
    // Server requests the client answers, as the App Server sends them.
    frames.extend([
        json!({"id": 0, "method": "item/commandExecution/requestApproval", "params": {
            "kind": "command", "threadId": "01a12092-346f-7d32-8dc8-ef1150dced2e",
            "turnId": "01a12092-36a6-7df3-af79-ab1bedb6bfe4", "itemId": "call_1",
            "startedAtMs": 1, "environmentId": null, "command": "ls", "cwd": "/workspace"}}),
        json!({"id": "srv-7", "method": "item/tool/requestUserInput", "params": {
            "threadId": "01a12092-346f-7d32-8dc8-ef1150dced2e", "turnId": "t", "itemId": "i",
            "questions": [], "isBlocking": true, "autoResolutionMs": null}}),
        json!({"id": 9, "method": "item/tool/call", "params": {
            "threadId": "01a12092-346f-7d32-8dc8-ef1150dced2e", "turnId": "t", "callId": "c",
            "tool": "readChat", "arguments": {}}}),
    ]);
    Ok(frames)
}

async fn replay(
    frames: Vec<Value>,
    multi_provider: bool,
    expected: usize,
) -> Result<Vec<Value>, Box<dyn std::error::Error>> {
    let directory = tempfile::tempdir()?;
    let socket_path = directory.path().join("app-server.sock");
    let listener = UnixListener::bind(&socket_path)?;
    let outgoing = frames.clone();
    let server = tokio::spawn(async move {
        let (stream, _) = listener.accept().await?;
        let mut socket = accept_async(stream).await?;
        let Some(Ok(Message::Text(initialize))) = socket.next().await else {
            return Err::<(), Box<dyn std::error::Error + Send + Sync>>("no initialize".into());
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
        for frame in outgoing {
            socket.send(Message::Text(frame.to_string().into())).await?;
        }
        tokio::time::sleep(Duration::from_secs(5)).await;
        Ok(())
    });
    let provider = CodexProvider::new(UpstreamHandle::spawn(socket_path));
    let mut events = provider.take_events();
    let mut projector = EventProjector::new(WireProvider {
        descriptor: provider.descriptor(),
        capabilities: provider.capabilities(),
        primary_id: provider.descriptor().id,
        multi_provider,
    });
    let mut projected = Vec::new();
    tokio::time::timeout(Duration::from_secs(5), async {
        while projected.len() < expected {
            match events.recv().await {
                Some(ProviderEvent::Event(event)) => projected.extend(projector.project(*event)),
                Some(ProviderEvent::Fence(_)) => {}
                None => break,
            }
        }
    })
    .await?;
    assert_eq!(provider.status(), ProviderStatus::Live);
    server.abort();
    Ok(projected)
}

#[tokio::test]
async fn single_provider_wire_is_byte_identical_to_the_app_server_stream()
-> Result<(), Box<dyn std::error::Error>> {
    let frames = recorded_frames()?;
    assert!(frames.len() > 80);
    let projected = replay(frames.clone(), false, frames.len()).await?;
    assert_eq!(projected.len(), frames.len());
    for (frame, projected) in frames.iter().zip(&projected) {
        assert_eq!(projected.to_string(), frame.to_string());
    }
    Ok(())
}

#[tokio::test]
async fn multi_provider_wire_only_adds_the_thread_extension()
-> Result<(), Box<dyn std::error::Error>> {
    let frames = recorded_frames()?;
    let projected = replay(frames.clone(), true, frames.len()).await?;
    assert_eq!(projected.len(), frames.len());
    let mut extended = 0;
    for (frame, projected) in frames.iter().zip(&projected) {
        let mut stripped = projected.clone();
        if let Some(thread) = stripped
            .pointer_mut("/params/thread")
            .and_then(Value::as_object_mut)
            && let Some(extension) = thread.remove("codewideAgent")
        {
            assert_eq!(frame["method"], "thread/started");
            assert_eq!(extension["provider"], "codex");
            assert_eq!(extension["primary"], true);
            extended += 1;
        }
        assert_eq!(stripped.to_string(), frame.to_string());
    }
    assert!(extended > 0);
    Ok(())
}

#[tokio::test]
async fn an_ambiguous_primary_request_id_is_dropped() -> Result<(), Box<dyn std::error::Error>> {
    let kept = json!({"method": "thread/status/changed", "params": {"threadId": "t", "status": {"type": "idle"}}});
    let frames = vec![
        json!({"id": "cw-claude:1", "method": "item/tool/requestUserInput", "params": {"threadId": "t"}}),
        kept.clone(),
    ];
    assert_eq!(replay(frames, false, 1).await?, vec![kept]);
    Ok(())
}
