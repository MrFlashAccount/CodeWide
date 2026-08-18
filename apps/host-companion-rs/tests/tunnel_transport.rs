use std::sync::Arc;

use axum::{
    Router,
    body::to_bytes,
    extract::{Request, WebSocketUpgrade, ws::Message as AxumMessage},
    http::StatusCode,
    response::IntoResponse,
    routing::{any, get},
};
use codewide_host_rs::{
    catalog::SessionCatalog,
    history_service::HistoryService,
    server::{self, CompanionServices},
    store::IndexStore,
    sync::SyncHub,
    tunnels::LocalhostTunnelService,
    upstream::UpstreamHandle,
};
use futures_util::{SinkExt, StreamExt};
use http::HeaderValue;
use serde_json::{Value, json};
use tokio::net::TcpListener;
use tokio_tungstenite::{connect_async, tungstenite::client::IntoClientRequest};

const TOKEN: &str = "tunnel-transport-test-admin-token-that-is-long-enough";

#[tokio::test]
#[allow(clippy::too_many_lines)]
async fn localhost_tunnel_proxies_http_cookie_websocket_and_revoke()
-> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let target = Router::new()
        .route("/echo/{*path}", any(echo_http))
        .route("/hmr", get(echo_websocket));
    let target_listener = TcpListener::bind("127.0.0.1:0").await?;
    let target_port = target_listener.local_addr()?.port();
    let target_task = tokio::spawn(async move {
        let _ = axum::serve(target_listener, target).await;
    });

    let directory = tempfile::tempdir()?;
    let store = Arc::new(IndexStore::open(directory.path().join("state.redb"))?);
    let history = HistoryService::new(Arc::new(SessionCatalog::scan(directory.path())));
    let sync = SyncHub::new(
        UpstreamHandle::spawn(directory.path().join("missing.sock")),
        store.clone(),
        history,
    );
    let tunnels = Arc::new(LocalhostTunnelService::new()?);
    let app = server::router_with_services(
        store,
        Arc::from(TOKEN),
        sync,
        CompanionServices {
            tunnels: Some(tunnels),
            ..CompanionServices::default()
        },
    );
    let listener = TcpListener::bind("127.0.0.1:0").await?;
    let address = listener.local_addr()?;
    let server_task = tokio::spawn(async move {
        let _ = axum::serve(listener, app).await;
    });
    let client = reqwest::Client::new();
    let base = format!("http://{address}");

    let unauthorized = client
        .post(format!("{base}/v1/tunnels"))
        .json(&json!({"port": target_port}))
        .send()
        .await?;
    assert_eq!(unauthorized.status(), reqwest::StatusCode::UNAUTHORIZED);

    let created = client
        .post(format!("{base}/v1/tunnels"))
        .bearer_auth(TOKEN)
        .json(&json!({"port": target_port, "ttlSeconds": 30}))
        .send()
        .await?;
    assert_eq!(created.status(), reqwest::StatusCode::CREATED);
    let created = created.json::<Value>().await?;
    let id = created["id"].as_str().ok_or("missing tunnel id")?;
    let proxy = format!("{base}/v1/tunnels/{id}/echo/deep?answer=42");

    let response = client
        .post(&proxy)
        .bearer_auth(TOKEN)
        .header("x-forward-me", "yes")
        .body("payload")
        .send()
        .await?;
    assert_eq!(response.status(), reqwest::StatusCode::OK);
    let cookie = response
        .headers()
        .get("set-cookie")
        .and_then(|value| value.to_str().ok())
        .ok_or("missing browser cookie")?
        .split(';')
        .next()
        .ok_or("bad browser cookie")?
        .to_owned();
    let echoed = response.json::<Value>().await?;
    assert_eq!(echoed["method"], "POST");
    assert_eq!(echoed["path"], "/echo/deep?answer=42");
    assert_eq!(echoed["body"], "payload");
    assert_eq!(echoed["forwarded"], "yes");
    assert_eq!(echoed["authorization"], Value::Null);

    let browser = client
        .get(&proxy)
        .header("cookie", &cookie)
        .header("host", address.to_string())
        .header("origin", format!("http://{address}"))
        .send()
        .await?;
    assert_eq!(browser.status(), reqwest::StatusCode::OK);
    let cross_origin = client
        .get(&proxy)
        .header("cookie", &cookie)
        .header("host", address.to_string())
        .header("origin", "https://attacker.invalid")
        .send()
        .await?;
    assert_eq!(cross_origin.status(), reqwest::StatusCode::UNAUTHORIZED);

    let mut websocket_request =
        format!("ws://{address}/v1/tunnels/{id}/hmr").into_client_request()?;
    websocket_request.headers_mut().insert(
        "authorization",
        HeaderValue::from_str(&format!("Bearer {TOKEN}"))?,
    );
    let (mut websocket, _) = connect_async(websocket_request).await?;
    websocket
        .send(tokio_tungstenite::tungstenite::Message::Text(
            "refresh".into(),
        ))
        .await?;
    let echoed = websocket.next().await.ok_or("websocket closed")??;
    assert_eq!(echoed.into_text()?, "refresh");

    let revoked = client
        .delete(format!("{base}/v1/tunnels/{id}"))
        .bearer_auth(TOKEN)
        .send()
        .await?;
    assert_eq!(revoked.status(), reqwest::StatusCode::OK);
    let after_revoke = client.get(&proxy).bearer_auth(TOKEN).send().await?;
    assert_eq!(after_revoke.status(), reqwest::StatusCode::NOT_FOUND);

    let closed = tokio::time::timeout(std::time::Duration::from_secs(2), websocket.next()).await?;
    assert!(closed.is_none_or(|frame| frame.is_ok_and(|frame| frame.is_close())));

    server_task.abort();
    target_task.abort();
    Ok(())
}

async fn echo_http(request: Request) -> impl IntoResponse {
    let (parts, body) = request.into_parts();
    let body = to_bytes(body, 64 * 1024).await.unwrap_or_default();
    (
        StatusCode::OK,
        axum::Json(json!({
            "method": parts.method.as_str(),
            "path": parts.uri.path_and_query().map(ToString::to_string),
            "body": String::from_utf8_lossy(&body),
            "forwarded": parts.headers.get("x-forward-me").and_then(|value| value.to_str().ok()),
            "authorization": parts.headers.get("authorization").and_then(|value| value.to_str().ok()),
        })),
    )
}

async fn echo_websocket(upgrade: WebSocketUpgrade) -> impl IntoResponse {
    upgrade.on_upgrade(|mut socket| async move {
        while let Some(Ok(message)) = socket.recv().await {
            match message {
                AxumMessage::Text(text) => {
                    if socket.send(AxumMessage::Text(text)).await.is_err() {
                        break;
                    }
                }
                AxumMessage::Binary(bytes) => {
                    if socket.send(AxumMessage::Binary(bytes)).await.is_err() {
                        break;
                    }
                }
                AxumMessage::Close(_) => break,
                AxumMessage::Ping(_) | AxumMessage::Pong(_) => {}
            }
        }
    })
}
