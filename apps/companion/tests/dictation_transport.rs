#![cfg(unix)]

use std::{
    os::unix::fs::PermissionsExt,
    sync::{
        Arc,
        atomic::{AtomicUsize, Ordering},
    },
};

use axum::{
    Router,
    body::{Body, to_bytes},
    extract::State,
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    routing::post,
};
use base64::{Engine as _, engine::general_purpose::STANDARD};
use codewide_companion::{
    catalog::SessionCatalog, dictation::DictationService, history_service::HistoryService, server,
    store::IndexStore, sync::SyncHub, upstream::UpstreamHandle,
};
use futures_util::{SinkExt, StreamExt};
use http::HeaderValue;
use serde_json::{Value, json};
use tokio::net::TcpListener;
use tokio_tungstenite::{
    connect_async,
    tungstenite::{Message, client::IntoClientRequest},
};

const TOKEN: &str = "dictation-transport-admin-token-that-is-long-enough";

#[tokio::test]
#[allow(clippy::too_many_lines)]
async fn dictation_stays_local_retries_and_replays_completed_result()
-> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let attempts = Arc::new(AtomicUsize::new(0));
    let transcription = Router::new()
        .route("/transcribe", post(transcribe))
        .with_state(attempts.clone());
    let transcription_listener = TcpListener::bind("127.0.0.1:0").await?;
    let transcription_address = transcription_listener.local_addr()?;
    let transcription_task = tokio::spawn(async move {
        let _ = axum::serve(transcription_listener, transcription).await;
    });

    let directory = tempfile::tempdir()?;
    let auth_file = directory.path().join("auth.json");
    tokio::fs::write(
        &auth_file,
        serde_json::to_vec(&json!({"tokens": {
            "access_token": "oauth-access-token-that-is-long-enough",
            "account_id": "account-1",
            "refresh_token": "must-never-leave-host"
        }}))?,
    )
    .await?;
    tokio::fs::set_permissions(&auth_file, std::fs::Permissions::from_mode(0o600)).await?;
    let dictation_root = directory.path().join("dictation");
    let endpoint = format!("http://{transcription_address}/transcribe");
    let dictation = Arc::new(
        DictationService::open_with_endpoint(
            auth_file.clone(),
            dictation_root.clone(),
            endpoint.clone(),
        )
        .await?,
    );
    let store = Arc::new(IndexStore::open(directory.path().join("state.redb"))?);
    let history = HistoryService::new(Arc::new(SessionCatalog::scan(directory.path())));
    let sync = SyncHub::new(
        UpstreamHandle::spawn(directory.path().join("missing.sock")),
        store.clone(),
        history,
    )
    .with_dictation(dictation);
    let app = server::router(store, Arc::from(TOKEN), sync);
    let listener = TcpListener::bind("127.0.0.1:0").await?;
    let address = listener.local_addr()?;
    let server_task = tokio::spawn(async move {
        let _ = axum::serve(listener, app).await;
    });

    let mut request = format!("ws://{address}/v1/sync").into_client_request()?;
    request.headers_mut().insert(
        "authorization",
        HeaderValue::from_str(&format!("Bearer {TOKEN}"))?,
    );
    let (mut socket, _) = connect_async(request).await?;
    socket
        .send(Message::Text(
            json!({"type":"hello","protocolVersion":1,"cursor":0})
                .to_string()
                .into(),
        ))
        .await?;
    wait_for_type(&mut socket, "caughtUp").await?;

    send_rpc(
        &mut socket,
        1,
        "companion/dictation/start",
        json!({"captureSource": {"future": "opaque"}, "language": "ru"}),
    )
    .await?;
    let started = wait_for_rpc(&mut socket, 1).await?;
    let session_id = started["result"]["sessionId"]
        .as_str()
        .ok_or("missing session id")?;
    let pcm = [1_u8, 0, 2, 0, 3, 0, 4, 0];
    let batch = json!({
        "sessionId": session_id,
        "batchId": "batch-0",
        "chunks": [{
            "data": STANDARD.encode(pcm),
            "sampleRate": 24_000,
            "numChannels": 1,
            "samplesPerChannel": 4
        }]
    });
    send_rpc(
        &mut socket,
        2,
        "companion/dictation/appendBatch",
        batch.clone(),
    )
    .await?;
    assert_eq!(
        wait_for_rpc(&mut socket, 2).await?["result"]["accepted"],
        true
    );
    send_rpc(&mut socket, 3, "companion/dictation/appendBatch", batch).await?;
    assert_eq!(
        wait_for_rpc(&mut socket, 3).await?["result"]["accepted"],
        true
    );

    send_rpc(
        &mut socket,
        4,
        "companion/dictation/finish",
        json!({"sessionId": session_id}),
    )
    .await?;
    assert_eq!(
        wait_for_rpc(&mut socket, 4).await?["result"]["text"],
        "Привет, Codex"
    );
    send_rpc(
        &mut socket,
        5,
        "companion/dictation/finish",
        json!({"sessionId": session_id}),
    )
    .await?;
    assert_eq!(
        wait_for_rpc(&mut socket, 5).await?["result"]["text"],
        "Привет, Codex"
    );
    assert_eq!(attempts.load(Ordering::SeqCst), 2);

    socket.close(None).await?;
    server_task.abort();
    let recovered =
        DictationService::open_with_endpoint(auth_file, dictation_root, endpoint).await?;
    assert_eq!(
        recovered
            .handle(
                "admin",
                "companion/dictation/finish",
                &json!({"sessionId": session_id}),
            )
            .await?["text"],
        "Привет, Codex"
    );
    assert_eq!(attempts.load(Ordering::SeqCst), 2);
    transcription_task.abort();
    Ok(())
}

async fn transcribe(
    State(attempts): State<Arc<AtomicUsize>>,
    headers: HeaderMap,
    body: Body,
) -> Response {
    if headers
        .get("authorization")
        .and_then(|value| value.to_str().ok())
        != Some("Bearer oauth-access-token-that-is-long-enough")
        || headers
            .get("chatgpt-account-id")
            .and_then(|value| value.to_str().ok())
            != Some("account-1")
    {
        return StatusCode::UNAUTHORIZED.into_response();
    }
    let Ok(body) = to_bytes(body, 1024 * 1024).await else {
        return StatusCode::BAD_REQUEST.into_response();
    };
    if !body.windows(4).any(|window| window == b"RIFF")
        || !body.windows(4).any(|window| window == b"WAVE")
    {
        return StatusCode::UNSUPPORTED_MEDIA_TYPE.into_response();
    }
    if attempts.fetch_add(1, Ordering::SeqCst) == 0 {
        return (StatusCode::TOO_MANY_REQUESTS, [("retry-after", "0")]).into_response();
    }
    axum::Json(json!({"text": "Привет, Codex", "asset_pointer": "private"})).into_response()
}

async fn send_rpc<S>(
    socket: &mut tokio_tungstenite::WebSocketStream<S>,
    id: u64,
    method: &str,
    params: Value,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>>
where
    S: tokio::io::AsyncRead + tokio::io::AsyncWrite + Unpin,
{
    socket
        .send(Message::Text(
            json!({"type":"rpc","request":{"id":id,"method":method,"params":params}})
                .to_string()
                .into(),
        ))
        .await?;
    Ok(())
}

async fn wait_for_type<S>(
    socket: &mut tokio_tungstenite::WebSocketStream<S>,
    expected: &str,
) -> Result<Value, Box<dyn std::error::Error + Send + Sync>>
where
    S: tokio::io::AsyncRead + tokio::io::AsyncWrite + Unpin,
{
    loop {
        let frame = socket.next().await.ok_or("socket closed")??;
        let Message::Text(text) = frame else { continue };
        let value = serde_json::from_str::<Value>(&text)?;
        if value["type"] == expected {
            return Ok(value);
        }
    }
}

async fn wait_for_rpc<S>(
    socket: &mut tokio_tungstenite::WebSocketStream<S>,
    id: u64,
) -> Result<Value, Box<dyn std::error::Error + Send + Sync>>
where
    S: tokio::io::AsyncRead + tokio::io::AsyncWrite + Unpin,
{
    loop {
        let value = wait_for_type(socket, "rpc").await?;
        if value["response"]["id"] == id {
            return Ok(value["response"].clone());
        }
    }
}
