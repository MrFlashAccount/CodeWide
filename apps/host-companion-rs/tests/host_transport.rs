#![cfg(unix)]

use std::{collections::HashSet, sync::Arc, time::Duration};

use codewide_host_rs::{
    catalog::SessionCatalog,
    history_service::HistoryService,
    server::{self, CompanionServices},
    store::IndexStore,
    sync::SyncHub,
    upstream::UpstreamHandle,
};
use futures_util::{SinkExt, StreamExt};
use http::HeaderValue;
use serde_json::{Value, json};
use tokio::net::{TcpListener, UnixListener};
use tokio_tungstenite::{
    accept_async, connect_async,
    tungstenite::{Message, client::IntoClientRequest},
};

const TOKEN: &str = "host-transport-test-admin-token-that-is-long-enough";

#[tokio::test]
async fn raw_app_server_and_binary_loopback_forward_match_v1_transport()
-> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let directory = tempfile::tempdir()?;
    let socket_path = directory.path().join("app-server.sock");
    let fake_app_server = tokio::spawn(run_fake_app_server(socket_path.clone()));

    let echo_listener = TcpListener::bind("127.0.0.1:0").await?;
    let echo_port = echo_listener.local_addr()?.port();
    let echo = tokio::spawn(async move {
        while let Ok((mut stream, _)) = echo_listener.accept().await {
            tokio::spawn(async move {
                let (mut read, mut write) = stream.split();
                let _ = tokio::io::copy(&mut read, &mut write).await;
            });
        }
    });

    let upstream = UpstreamHandle::spawn(socket_path.clone());
    let store = Arc::new(IndexStore::open(directory.path().join("state.redb"))?);
    let history = HistoryService::new(Arc::new(SessionCatalog::scan(directory.path())));
    let sync = SyncHub::new(upstream, store.clone(), history);
    let app = server::router_with_services(
        store,
        Arc::from(TOKEN),
        sync,
        CompanionServices {
            app_server_socket_path: Some(socket_path),
            excluded_ports: HashSet::new(),
            ..CompanionServices::default()
        },
    );
    let listener = TcpListener::bind("127.0.0.1:0").await?;
    let address = listener.local_addr()?;
    let server_task = tokio::spawn(async move {
        let _ = axum::serve(listener, app).await;
    });

    let mut raw_request = format!("ws://{address}/v1/app-server").into_client_request()?;
    raw_request.headers_mut().insert(
        "authorization",
        HeaderValue::from_str(&format!("Bearer {TOKEN}"))?,
    );
    let (mut raw, _) = connect_async(raw_request).await?;
    raw.send(Message::Text(
        json!({"id": 7, "method": "thread/list", "params": {}})
            .to_string()
            .into(),
    ))
    .await?;
    let raw_response = next_json(&mut raw).await?;
    assert_eq!(raw_response["id"], 7);
    assert_eq!(raw_response["result"]["method"], "thread/list");

    let mut forward_request =
        format!("ws://{address}/v1/port-forwards/{echo_port}").into_client_request()?;
    forward_request.headers_mut().insert(
        "authorization",
        HeaderValue::from_str(&format!("Bearer {TOKEN}"))?,
    );
    let (mut forward, _) = connect_async(forward_request).await?;
    forward
        .send(Message::Binary(b"opaque tcp".to_vec().into()))
        .await?;
    let echoed = tokio::time::timeout(Duration::from_secs(2), forward.next())
        .await?
        .ok_or("forward closed")??;
    assert_eq!(echoed.into_data().as_ref(), b"opaque tcp");

    let discovery = reqwest::Client::new()
        .get(format!("http://{address}/v1/port-forwards/discovery"))
        .bearer_auth(TOKEN)
        .send()
        .await?;
    assert_eq!(discovery.status(), reqwest::StatusCode::OK);
    assert!(discovery.json::<Value>().await?["ports"].is_array());

    let mut terminal_request =
        format!("ws://{address}/v1/terminals?cols=80&rows=24").into_client_request()?;
    terminal_request.headers_mut().insert(
        "authorization",
        HeaderValue::from_str(&format!("Bearer {TOKEN}"))?,
    );
    let (mut terminal, _) = connect_async(terminal_request).await?;
    let mut input = vec![0_u8];
    input.extend_from_slice(b"printf '\\x43\\x4f\\x44\\x45\\x57\\x49\\x44\\x45\\x2d\\x50\\x54\\x59\\x2d\\x4f\\x4b\\n'\r");
    terminal.send(Message::Binary(input.into())).await?;
    let mut output = Vec::new();
    tokio::time::timeout(Duration::from_secs(3), async {
        while !String::from_utf8_lossy(&output).contains("CODEWIDE-PTY-OK") {
            let frame = terminal.next().await.ok_or("terminal closed")??;
            if let Message::Binary(bytes) = frame {
                output.extend_from_slice(&bytes);
            }
        }
        Ok::<(), Box<dyn std::error::Error + Send + Sync>>(())
    })
    .await??;
    terminal.send(Message::Binary(vec![2_u8].into())).await?;

    raw.close(None).await?;
    forward.close(None).await?;
    server_task.abort();
    fake_app_server.abort();
    echo.abort();
    Ok(())
}

async fn run_fake_app_server(path: std::path::PathBuf) {
    let Ok(listener) = UnixListener::bind(path) else {
        return;
    };
    while let Ok((stream, _)) = listener.accept().await {
        tokio::spawn(async move {
            let Ok(mut socket) = accept_async(stream).await else {
                return;
            };
            while let Some(Ok(message)) = socket.next().await {
                let Message::Text(text) = message else {
                    continue;
                };
                let Ok(value) = serde_json::from_str::<Value>(&text) else {
                    continue;
                };
                let Some(id) = value.get("id").cloned() else {
                    continue;
                };
                let method = value.get("method").cloned().unwrap_or(Value::Null);
                let response = json!({"id": id, "result": {"method": method}});
                if socket
                    .send(Message::Text(response.to_string().into()))
                    .await
                    .is_err()
                {
                    break;
                }
            }
        });
    }
}

async fn next_json<S>(socket: &mut tokio_tungstenite::WebSocketStream<S>) -> Result<Value, String>
where
    S: tokio::io::AsyncRead + tokio::io::AsyncWrite + Unpin,
{
    let frame = tokio::time::timeout(Duration::from_secs(2), socket.next())
        .await
        .map_err(|_| "websocket timeout".to_owned())?
        .ok_or_else(|| "websocket closed".to_owned())?
        .map_err(|error| error.to_string())?;
    let Message::Text(text) = frame else {
        return Err("expected text frame".into());
    };
    serde_json::from_str(&text).map_err(|error| error.to_string())
}
