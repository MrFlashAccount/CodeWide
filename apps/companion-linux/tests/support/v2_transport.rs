use std::{error::Error, time::Duration};

use axum::{
    Router,
    extract::{State, WebSocketUpgrade},
    http::HeaderMap,
    response::{IntoResponse, Response},
    routing::get,
};
use codewide_companion::{
    auth::{AuthorizationChange, AuthorizationContext},
    store::IndexStore,
    sync_v2::{AudienceSelector, AuthenticatedContextKey, SyncV2Runtime, scalar::Id},
};
use futures_util::{SinkExt, StreamExt};
use http::HeaderValue;
use serde_json::{Value, json};
use tokio::{net::TcpListener, task::JoinHandle, time::timeout};
use tokio_tungstenite::{
    MaybeTlsStream, WebSocketStream, connect_async,
    tungstenite::{Message, client::IntoClientRequest},
};

pub type Client = WebSocketStream<MaybeTlsStream<tokio::net::TcpStream>>;

#[derive(Clone)]
struct AuthorizationTestState {
    runtime: SyncV2Runtime,
    changes: tokio::sync::broadcast::Sender<AuthorizationChange>,
}

pub async fn start_server(
    root: &std::path::Path,
    runtime: SyncV2Runtime,
) -> Result<(std::net::SocketAddr, JoinHandle<()>), Box<dyn Error>> {
    let _ = IndexStore::open(root.join("state.redb"))?;
    let app = Router::new()
        .route("/v2/sync", get(test_upgrade))
        .with_state(runtime);
    let listener = TcpListener::bind("127.0.0.1:0").await?;
    let address = listener.local_addr()?;
    let task = tokio::spawn(async move {
        let _ = axum::serve(listener, app).await;
    });
    Ok((address, task))
}

pub async fn start_server_with_authorization_changes(
    root: &std::path::Path,
    runtime: SyncV2Runtime,
) -> Result<
    (
        std::net::SocketAddr,
        JoinHandle<()>,
        tokio::sync::broadcast::Sender<AuthorizationChange>,
    ),
    Box<dyn Error>,
> {
    let _ = IndexStore::open(root.join("state-auth.redb"))?;
    let (changes, _) = tokio::sync::broadcast::channel(1);
    let app = Router::new()
        .route("/v2/sync", get(test_upgrade_with_authorization_changes))
        .with_state(AuthorizationTestState {
            runtime,
            changes: changes.clone(),
        });
    let listener = TcpListener::bind("127.0.0.1:0").await?;
    let address = listener.local_addr()?;
    let task = tokio::spawn(async move {
        let _ = axum::serve(listener, app).await;
    });
    Ok((address, task, changes))
}

pub async fn connect(url: &str) -> Result<Client, Box<dyn Error>> {
    connect_as(url, "device-a").await
}

pub async fn connect_as(url: &str, device_id: &str) -> Result<Client, Box<dyn Error>> {
    let mut request = url.into_client_request()?;
    request
        .headers_mut()
        .insert("x-test-device", HeaderValue::from_str(device_id)?);
    Ok(connect_async(request).await?.0)
}

pub async fn connect_as_expires(
    url: &str,
    device_id: &str,
    expires_at: u64,
) -> Result<Client, Box<dyn Error>> {
    let mut request = url.into_client_request()?;
    request
        .headers_mut()
        .insert("x-test-device", HeaderValue::from_str(device_id)?);
    request.headers_mut().insert(
        "x-test-expires-at",
        HeaderValue::from_str(&expires_at.to_string())?,
    );
    Ok(connect_async(request).await?.0)
}

pub async fn test_upgrade(
    State(runtime): State<SyncV2Runtime>,
    headers: HeaderMap,
    upgrade: WebSocketUpgrade,
) -> Response {
    let Some(device_id) = headers
        .get("x-test-device")
        .and_then(|value| value.to_str().ok())
        .map(ToOwned::to_owned)
    else {
        return axum::http::StatusCode::UNAUTHORIZED.into_response();
    };
    let expires_at = headers
        .get("x-test-expires-at")
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.parse().ok())
        .unwrap_or(u64::MAX);
    upgrade.on_upgrade(move |socket| {
        runtime.serve(
            socket,
            AuthorizationContext::Session {
                device_id,
                expires_at,
            },
            None,
        )
    })
}

async fn test_upgrade_with_authorization_changes(
    State(state): State<AuthorizationTestState>,
    headers: HeaderMap,
    upgrade: WebSocketUpgrade,
) -> Response {
    let Some(device_id) = headers
        .get("x-test-device")
        .and_then(|value| value.to_str().ok())
        .map(ToOwned::to_owned)
    else {
        return axum::http::StatusCode::UNAUTHORIZED.into_response();
    };
    let changes = state.changes.subscribe();
    upgrade.on_upgrade(move |socket| {
        state.runtime.serve(
            socket,
            AuthorizationContext::Session {
                device_id,
                expires_at: u64::MAX,
            },
            Some(changes),
        )
    })
}

pub fn current_thread_audience(
    device_id: &str,
    thread_id: &str,
) -> Result<AudienceSelector, Box<dyn Error>> {
    let authorization = AuthorizationContext::Session {
        device_id: device_id.into(),
        expires_at: u64::MAX,
    };
    Ok(AudienceSelector::CurrentThread {
        context: AuthenticatedContextKey::derive(&authorization)
            .map_err(|error| format!("context derivation failed: {error:?}"))?,
        thread_id: Id::new(thread_id)?,
    })
}

pub async fn open(client: &mut Client, thread_id: &str) -> Result<Value, Box<dyn Error>> {
    send(
        client,
        json!({
            "type": "open",
            "version": 2,
            "intent": {
                "catalog": {"activeLimit": 1, "archivedLimit": 1},
                "currentThread": {"threadId": thread_id, "turnLimit": 1},
                "pendingRequests": "currentThread"
            }
        }),
    )
    .await?;
    let snapshot = receive(client).await?;
    if snapshot["type"] != "snapshot" {
        return Err(format!("expected snapshot, got {snapshot}").into());
    }
    Ok(snapshot)
}

pub async fn open_and_commit(client: &mut Client, thread_id: &str) -> Result<(), Box<dyn Error>> {
    let snapshot = open(client, thread_id).await?;
    send(
        client,
        json!({
            "type": "snapshotCommitted",
            "epochId": snapshot["epochId"],
            "revision": snapshot["revision"],
            "watermark": snapshot["watermark"]
        }),
    )
    .await?;
    let live = receive(client).await?;
    if live["type"] != "live" {
        return Err(format!("expected live, got {live}").into());
    }
    Ok(())
}

pub async fn send(client: &mut Client, value: Value) -> Result<(), Box<dyn Error>> {
    client.send(Message::Text(value.to_string().into())).await?;
    Ok(())
}

pub async fn receive(client: &mut Client) -> Result<Value, Box<dyn Error>> {
    let message = timeout(Duration::from_secs(3), client.next())
        .await?
        .ok_or("websocket closed")??;
    match message {
        Message::Text(text) => Ok(serde_json::from_str(&text)?),
        other => Err(format!("expected text frame, got {other:?}").into()),
    }
}

pub async fn expect_close_code(client: &mut Client, expected: u16) -> Result<(), Box<dyn Error>> {
    let message = timeout(Duration::from_secs(3), client.next())
        .await?
        .ok_or("websocket closed without close frame")??;
    let Message::Close(Some(frame)) = message else {
        return Err(format!("expected close frame, got {message:?}").into());
    };
    let actual: u16 = frame.code.into();
    if actual != expected {
        return Err(format!("expected close {expected}, got {actual}").into());
    }
    Ok(())
}
