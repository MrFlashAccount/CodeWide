#![cfg(unix)]

use std::{collections::HashSet, sync::Arc, time::Duration};

use codewide_companion::{
    catalog::SessionCatalog,
    history_service::HistoryService,
    server::{self, CompanionServices},
    store::{IndexStore, IndexedThreadMetadata},
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

const TOKEN: &str = "companion-transport-test-admin-token-that-is-long-enough";

struct ThreadTerminalFixtures {
    catalog: Arc<SessionCatalog>,
    authoritative_cwd: std::path::PathBuf,
    client_cwd: std::path::PathBuf,
    catalog_cwd: std::path::PathBuf,
}

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
    let ThreadTerminalFixtures {
        catalog,
        authoritative_cwd,
        client_cwd,
        catalog_cwd,
    } = prepare_thread_terminal_fixtures(directory.path(), &store)?;
    let history = HistoryService::new(catalog.clone(), store.clone());
    let sync = SyncHub::new(upstream, store.clone(), history);
    let app = server::router_with_services(
        store.clone(),
        Arc::from(TOKEN),
        sync,
        CompanionServices {
            app_server_socket_path: Some(socket_path),
            catalog: Some(catalog),
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

    verify_port_discovery(address, echo_port).await?;

    verify_legacy_terminal(address).await?;

    verify_durable_terminal(address).await?;
    verify_thread_owned_terminal(
        address,
        "01a03e19-ee87-7a33-adcb-a93b9e5b0768",
        "01a03e20-ee87-7a33-adcb-a93b9e5b0768",
        "terminal-22345678-1234-1234-1234-123456789abc",
        &authoritative_cwd,
        &client_cwd,
    )
    .await?;
    verify_thread_owned_terminal(
        address,
        "01a03e20-ee87-7a33-adcb-a93b9e5b0768",
        "01a03e19-ee87-7a33-adcb-a93b9e5b0768",
        "terminal-32345678-1234-1234-1234-123456789abc",
        &catalog_cwd,
        &client_cwd,
    )
    .await?;

    raw.close(None).await?;
    forward.close(None).await?;
    server_task.abort();
    fake_app_server.abort();
    echo.abort();
    Ok(())
}

fn prepare_thread_terminal_fixtures(
    root: &std::path::Path,
    store: &IndexStore,
) -> Result<ThreadTerminalFixtures, Box<dyn std::error::Error + Send + Sync>> {
    let authoritative_cwd = root.join("authoritative-cwd");
    let client_cwd = root.join("client-cwd");
    std::fs::create_dir_all(&authoritative_cwd)?;
    std::fs::create_dir_all(&client_cwd)?;
    let authoritative_cwd = authoritative_cwd.canonicalize()?;
    let client_cwd = client_cwd.canonicalize()?;
    store.put_thread_metadata(&IndexedThreadMetadata {
        id: "01a03e19-ee87-7a33-adcb-a93b9e5b0768".into(),
        parent_thread_id: None,
        cwd: authoritative_cwd.to_string_lossy().into_owned(),
        created_at: 1,
        updated_at: 1,
        model_provider: "openai".into(),
        cli_version: "test".into(),
        source: json!("vscode"),
        agent_nickname: None,
        agent_role: None,
        archived: false,
    })?;
    let catalog_cwd = root.join("catalog-cwd");
    std::fs::create_dir_all(&catalog_cwd)?;
    let catalog_cwd = catalog_cwd.canonicalize()?;
    let rollout_directory = root.join("sessions/2026/08/26");
    std::fs::create_dir_all(&rollout_directory)?;
    std::fs::write(
        rollout_directory
            .join("rollout-2026-08-26T00-00-00-01a03e20-ee87-7a33-adcb-a93b9e5b0768.jsonl"),
        format!(
            "{{\"type\":\"session_meta\",\"payload\":{{\"id\":\"01a03e20-ee87-7a33-adcb-a93b9e5b0768\",\"cwd\":{}}}}}\n",
            serde_json::to_string(&catalog_cwd.to_string_lossy())?
        ),
    )?;
    Ok(ThreadTerminalFixtures {
        catalog: Arc::new(SessionCatalog::scan(root)),
        authoritative_cwd,
        client_cwd,
        catalog_cwd,
    })
}

async fn verify_legacy_terminal(
    address: std::net::SocketAddr,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let mut request =
        format!("ws://{address}/v1/terminals?cols=80&rows=24").into_client_request()?;
    request.headers_mut().insert(
        "authorization",
        HeaderValue::from_str(&format!("Bearer {TOKEN}"))?,
    );
    let (mut terminal, _) = connect_async(request).await?;
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
    Ok(())
}

async fn verify_thread_owned_terminal(
    address: std::net::SocketAddr,
    thread_id: &str,
    other_thread_id: &str,
    terminal_id: &str,
    authoritative_cwd: &std::path::Path,
    client_cwd: &std::path::Path,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let encoded_client_cwd =
        url::form_urlencoded::byte_serialize(client_cwd.to_string_lossy().as_bytes())
            .collect::<String>();
    let mut request = format!(
        "ws://{address}/v1/terminals?threadId={thread_id}&cwd={encoded_client_cwd}&cols=80&rows=24&sessionId={terminal_id}&offset=0&create=true"
    )
    .into_client_request()?;
    request.headers_mut().insert(
        "authorization",
        HeaderValue::from_str(&format!("Bearer {TOKEN}"))?,
    );
    let (mut terminal, _) = connect_async(request).await?;
    let mut input = vec![0_u8];
    input.extend_from_slice(b"pwd\r");
    terminal.send(Message::Binary(input.into())).await?;
    let expected = authoritative_cwd.to_string_lossy();
    let mut output = Vec::new();
    tokio::time::timeout(Duration::from_secs(3), async {
        while !String::from_utf8_lossy(&output).contains(expected.as_ref()) {
            let frame = terminal.next().await.ok_or("terminal closed")??;
            if let Message::Binary(bytes) = frame {
                output.extend_from_slice(&bytes);
            }
        }
        Ok::<(), Box<dyn std::error::Error + Send + Sync>>(())
    })
    .await
    .map_err(|_| {
        std::io::Error::other(format!(
            "thread-owned terminal did not report its working directory; output={}",
            String::from_utf8_lossy(&output)
        ))
    })??;
    assert!(!String::from_utf8_lossy(&output).contains(&*client_cwd.to_string_lossy()));

    let mut mismatched_request = format!(
        "ws://{address}/v1/terminals?threadId={other_thread_id}&cols=80&rows=24&sessionId={terminal_id}&offset=0&create=false"
    )
    .into_client_request()?;
    mismatched_request.headers_mut().insert(
        "authorization",
        HeaderValue::from_str(&format!("Bearer {TOKEN}"))?,
    );
    let Err(mismatch) = connect_async(mismatched_request).await else {
        return Err(
            std::io::Error::other("terminal attachment with another thread id succeeded").into(),
        );
    };
    match mismatch {
        tokio_tungstenite::tungstenite::Error::Http(response) => {
            assert_eq!(response.status(), http::StatusCode::UNPROCESSABLE_ENTITY);
        }
        error => return Err(error.into()),
    }

    terminal.send(Message::Binary(vec![2_u8].into())).await?;
    Ok(())
}

async fn verify_port_discovery(
    address: std::net::SocketAddr,
    echo_port: u16,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let response = reqwest::Client::new()
        .get(format!("http://{address}/v1/port-forwards/discovery"))
        .bearer_auth(TOKEN)
        .send()
        .await?;
    assert_eq!(response.status(), reqwest::StatusCode::OK);
    let discovery = response.json::<Value>().await?;
    let ports = discovery["ports"]
        .as_array()
        .ok_or("missing discovered ports")?;
    let service = ports
        .iter()
        .find(|service| service["port"] == echo_port)
        .ok_or("echo listener was not discovered")?;
    assert!(service["name"].is_string());
    assert!(service["group"].is_string());
    assert!(service["details"].is_string());
    assert_eq!(service["forwardingKey"].as_str().map(str::len), Some(64));
    assert!(service["defaultForwardingEnabled"].is_boolean());
    Ok(())
}

async fn verify_durable_terminal(
    address: std::net::SocketAddr,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let durable_id = "terminal-12345678-1234-1234-1234-123456789abc";
    let request = |create: bool| -> Result<_, Box<dyn std::error::Error + Send + Sync>> {
        let mut request = format!(
            "ws://{address}/v1/terminals?cols=80&rows=24&sessionId={durable_id}&offset=0&create={create}"
        )
        .into_client_request()?;
        request.headers_mut().insert(
            "authorization",
            HeaderValue::from_str(&format!("Bearer {TOKEN}"))?,
        );
        Ok(request)
    };

    let (mut durable, _) = connect_async(request(true)?).await?;
    let mut input = vec![0_u8];
    input.extend_from_slice(b"sleep 0.2; printf 'DURABLE-PTY-OK\\n'; exit\r");
    durable.send(Message::Binary(input.into())).await?;
    durable.close(None).await?;
    tokio::time::sleep(Duration::from_millis(400)).await;

    let (mut resumed, _) = connect_async(request(false)?).await?;
    let mut output = Vec::new();
    tokio::time::timeout(Duration::from_secs(3), async {
        while !String::from_utf8_lossy(&output).contains("DURABLE-PTY-OK") {
            let frame = resumed.next().await.ok_or("resumed terminal closed")??;
            if let Message::Binary(bytes) = frame {
                output.extend_from_slice(&bytes);
            }
        }
        Ok::<(), Box<dyn std::error::Error + Send + Sync>>(())
    })
    .await??;
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
