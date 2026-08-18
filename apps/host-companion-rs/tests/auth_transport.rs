#![cfg(unix)]
#![allow(clippy::too_many_lines)]

use std::{path::PathBuf, sync::Arc, time::Duration};

use base64::{Engine as _, engine::general_purpose};
use codewide_host_rs::{
    auth::{DeviceRegistry, pairing_claim_message},
    catalog::SessionCatalog,
    history_service::HistoryService,
    server,
    store::IndexStore,
    sync::SyncHub,
    upstream::{ConnectionStatus, UpstreamHandle},
};
use futures_util::{SinkExt, StreamExt};
use http::{HeaderValue, StatusCode};
use p256::{
    ecdsa::{Signature, SigningKey, signature::Signer},
    pkcs8::EncodePublicKey,
};
use serde_json::{Value, json};
use tokio::{
    net::{TcpListener, UnixListener, UnixStream},
    time::timeout,
};
use tokio_tungstenite::{
    WebSocketStream, accept_async, connect_async,
    tungstenite::{Message, client::IntoClientRequest, protocol::frame::coding::CloseCode},
};

const ADMIN_TOKEN: &str = "admin-token-that-is-long-enough-for-auth-test";

#[tokio::test]
async fn pairing_proof_session_and_scope_gate_work_over_wire()
-> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let directory = tempfile::tempdir()?;
    let socket_path = directory.path().join("app-server.sock");
    let fake = tokio::spawn(run_fake_app_server(socket_path.clone()));
    let upstream = UpstreamHandle::spawn(socket_path);
    wait_for_live(&upstream).await?;
    let store = Arc::new(IndexStore::open(directory.path().join("state.redb"))?);
    let history = HistoryService::new(Arc::new(SessionCatalog::scan(directory.path())));
    let sync = SyncHub::with_mutations(upstream, store.clone(), history);
    let registry = Arc::new(
        DeviceRegistry::open(
            Arc::from(ADMIN_TOKEN),
            directory.path().join("devices.json"),
            None,
        )
        .await?,
    );
    let public_listener = TcpListener::bind("127.0.0.1:0").await?;
    let public_address = public_listener.local_addr()?;
    let control_path = directory.path().join("companion-control.sock");
    let control_listener = UnixListener::bind(&control_path)?;
    let routers = server::split_routers_with_registry_and_services(
        store,
        registry,
        sync,
        server::CompanionServices::default(),
    );
    let public_task = tokio::spawn(async move {
        let _ = axum::serve(public_listener, routers.public).await;
    });
    let control_task = tokio::spawn(async move {
        let _ = axum::serve(control_listener, routers.control).await;
    });
    let public_client = reqwest::Client::new();
    let control_client = reqwest::Client::builder()
        .unix_socket(control_path)
        .build()?;
    let public_base = format!("http://{public_address}");
    let control_base = "http://localhost";

    assert_eq!(
        public_client
            .post(format!("{public_base}/v1/pairing/start"))
            .bearer_auth(ADMIN_TOKEN)
            .send()
            .await?
            .status(),
        StatusCode::NOT_FOUND
    );
    for path in [
        "/healthz",
        "/readyz",
        "/v1/devices",
        "/v1/app-server",
        "/v1/pairing/claim",
        "/v1/sessions/challenge",
        "/v1/sessions",
        "/latest.apk",
    ] {
        assert_eq!(
            public_client
                .get(format!("{public_base}{path}"))
                .bearer_auth(ADMIN_TOKEN)
                .send()
                .await?
                .status(),
            StatusCode::NOT_FOUND,
            "public route unexpectedly exists: {path}"
        );
    }
    assert_eq!(
        control_client
            .post(format!("{control_base}/v1/auth"))
            .json(&json!({"action": "challenge"}))
            .send()
            .await?
            .status(),
        StatusCode::NOT_FOUND
    );
    assert!(matches!(
        connect_async(websocket_request(public_address, ADMIN_TOKEN)?).await,
        Err(tokio_tungstenite::tungstenite::Error::Http(response))
            if response.status() == StatusCode::UNAUTHORIZED
    ));
    let (session_token, device_id) = pair_and_authorize(
        &public_client,
        &control_client,
        &public_base,
        control_base,
        public_address,
    )
    .await?;
    assert!(matches!(
        connect_async(terminal_request(public_address, &session_token)?).await,
        Err(tokio_tungstenite::tungstenite::Error::Http(response))
            if response.status() == StatusCode::FORBIDDEN
    ));
    let (mut socket, _) = connect_async(websocket_request(public_address, &session_token)?).await?;
    send_json(&mut socket, &json!({"type": "hello", "protocolVersion": 1})).await?;
    let hello = receive_type(&mut socket, "hello").await?;
    let _ = receive_type(&mut socket, "status").await?;
    send_json(
        &mut socket,
        &json!({"type": "snapshotApplied", "cursor": hello["headCursor"]}),
    )
    .await?;
    let _ = receive_type(&mut socket, "caughtUp").await?;

    send_json(
        &mut socket,
        &json!({
            "type": "rpc",
            "request": {"id": "read", "method": "thread/list", "params": {"limit": 1}}
        }),
    )
    .await?;
    assert_eq!(
        receive_type(&mut socket, "rpc").await?["response"]["result"]["data"][0]["id"],
        "thread-1"
    );
    send_json(
        &mut socket,
        &json!({
            "type": "rpc",
            "request": {"id": "shell", "method": "command/exec", "params": {}}
        }),
    )
    .await?;
    assert_eq!(
        receive_type(&mut socket, "rpc").await?["response"]["error"]["code"],
        -32_001
    );

    control_client
        .delete(format!("{control_base}/v1/devices/{device_id}"))
        .bearer_auth(ADMIN_TOKEN)
        .send()
        .await?
        .error_for_status()?;
    let close = timeout(Duration::from_secs(2), socket.next())
        .await?
        .ok_or("WebSocket did not close")??;
    assert!(matches!(
        close,
        Message::Close(Some(frame))
            if frame.code == CloseCode::Library(4003) && frame.reason == "device_revoked"
    ));
    public_task.abort();
    control_task.abort();
    fake.abort();
    Ok(())
}

async fn pair_and_authorize(
    public_client: &reqwest::Client,
    control_client: &reqwest::Client,
    public_base: &str,
    control_base: &str,
    address: std::net::SocketAddr,
) -> Result<(String, String), Box<dyn std::error::Error + Send + Sync>> {
    let pairing: Value = control_client
        .post(format!("{control_base}/v1/pairing/start"))
        .bearer_auth(ADMIN_TOKEN)
        .send()
        .await?
        .error_for_status()?
        .json()
        .await?;
    let signing = SigningKey::from_bytes((&[9_u8; 32]).into())?;
    let public_key = signing.verifying_key().to_public_key_der()?;
    let public_key_spki = general_purpose::STANDARD.encode(public_key.as_bytes());
    let proof: Signature = signing.sign(&pairing_claim_message(
        pairing["pairingToken"]
            .as_str()
            .ok_or("pairing token missing")?,
        "Test Fold",
        &public_key_spki,
    ));
    let wrong_signing = SigningKey::from_bytes((&[10_u8; 32]).into())?;
    let wrong_proof: Signature = wrong_signing.sign(&pairing_claim_message(
        pairing["pairingToken"]
            .as_str()
            .ok_or("pairing token missing")?,
        "Test Fold",
        &public_key_spki,
    ));
    let rejected = public_client
        .post(format!("{public_base}/v1/auth"))
        .json(&json!({
            "action": "register",
            "pairingToken": pairing["pairingToken"],
            "deviceName": "Test Fold",
            "publicKeySpki": public_key_spki,
            "proof": general_purpose::STANDARD.encode(wrong_proof.to_der().as_bytes())
        }))
        .send()
        .await?;
    assert_eq!(rejected.status(), StatusCode::UNAUTHORIZED);
    assert_eq!(
        rejected.json::<Value>().await?["error"],
        "invalid_pairing_key_proof"
    );
    let claim: Value = public_client
        .post(format!("{public_base}/v1/auth"))
        .json(&json!({
            "action": "register",
            "pairingToken": pairing["pairingToken"],
            "deviceName": "Test Fold",
            "publicKeySpki": public_key_spki,
            "proof": general_purpose::STANDARD.encode(proof.to_der().as_bytes())
        }))
        .send()
        .await?
        .error_for_status()?
        .json()
        .await?;
    let device_token = claim["capabilityToken"]
        .as_str()
        .ok_or("device token missing")?;
    let direct_device_ws = websocket_request(address, device_token)?;
    assert!(matches!(
        connect_async(direct_device_ws).await,
        Err(tokio_tungstenite::tungstenite::Error::Http(response))
            if response.status() == StatusCode::UNAUTHORIZED
    ));

    let challenge: Value = public_client
        .post(format!("{public_base}/v1/auth"))
        .bearer_auth(device_token)
        .json(&json!({"action": "challenge"}))
        .send()
        .await?
        .error_for_status()?
        .json()
        .await?;
    let nonce = general_purpose::URL_SAFE_NO_PAD
        .decode(challenge["challenge"].as_str().ok_or("challenge missing")?)?;
    let signature: Signature = signing.sign(&nonce);
    let session: Value = public_client
        .post(format!("{public_base}/v1/auth"))
        .bearer_auth(device_token)
        .json(&json!({
            "action": "session",
            "challengeId": challenge["challengeId"],
            "signature": general_purpose::STANDARD.encode(signature.to_der().as_bytes())
        }))
        .send()
        .await?
        .error_for_status()?
        .json()
        .await?;
    Ok((
        session["sessionToken"]
            .as_str()
            .ok_or("session token missing")?
            .to_owned(),
        claim["deviceId"]
            .as_str()
            .ok_or("device id missing")?
            .to_owned(),
    ))
}

fn websocket_request(
    address: std::net::SocketAddr,
    token: &str,
) -> Result<http::Request<()>, Box<dyn std::error::Error + Send + Sync>> {
    let mut request = format!("ws://{address}/v1/sync").into_client_request()?;
    let value = HeaderValue::from_str(&format!("Bearer {token}"))?;
    request.headers_mut().insert("authorization", value);
    Ok(request)
}

fn terminal_request(
    address: std::net::SocketAddr,
    token: &str,
) -> Result<http::Request<()>, Box<dyn std::error::Error + Send + Sync>> {
    let mut request =
        format!("ws://{address}/v1/terminals?cols=80&rows=24").into_client_request()?;
    let value = HeaderValue::from_str(&format!("Bearer {token}"))?;
    request.headers_mut().insert("authorization", value);
    Ok(request)
}

async fn wait_for_live(
    upstream: &UpstreamHandle,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let mut status = upstream.subscribe_status();
    timeout(Duration::from_secs(2), async {
        loop {
            if *status.borrow() == ConnectionStatus::Live {
                return Ok::<(), tokio::sync::watch::error::RecvError>(());
            }
            status.changed().await?;
        }
    })
    .await??;
    Ok(())
}

async fn run_fake_app_server(
    socket_path: PathBuf,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let listener = UnixListener::bind(socket_path)?;
    let (stream, _) = listener.accept().await?;
    let mut socket = accept_async(stream).await?;
    let initialize = receive_value(&mut socket).await?;
    send_json(&mut socket, &json!({"id": initialize["id"], "result": {}})).await?;
    let _ = receive_value(&mut socket).await?;
    while let Some(frame) = socket.next().await {
        let frame = frame?;
        let Message::Text(raw) = frame else {
            continue;
        };
        let request: Value = serde_json::from_str(&raw)?;
        let id = request["id"].clone();
        send_json(
            &mut socket,
            &json!({"id": id, "result": {"data": [{"id": "thread-1"}]}}),
        )
        .await?;
    }
    Ok(())
}

async fn receive_type<S>(
    socket: &mut WebSocketStream<S>,
    expected: &str,
) -> Result<Value, Box<dyn std::error::Error + Send + Sync>>
where
    S: tokio::io::AsyncRead + tokio::io::AsyncWrite + Unpin,
{
    timeout(Duration::from_secs(2), async {
        loop {
            let frame = socket.next().await.ok_or("WebSocket closed")??;
            if let Message::Text(raw) = frame {
                let value: Value = serde_json::from_str(&raw)?;
                if value.get("type").and_then(Value::as_str) == Some(expected) {
                    return Ok(value);
                }
            }
        }
    })
    .await?
}

async fn receive_value(
    socket: &mut WebSocketStream<UnixStream>,
) -> Result<Value, Box<dyn std::error::Error + Send + Sync>> {
    loop {
        let frame = socket.next().await.ok_or("WebSocket closed")??;
        if let Message::Text(raw) = frame {
            return Ok(serde_json::from_str(&raw)?);
        }
    }
}

async fn send_json<S>(
    socket: &mut WebSocketStream<S>,
    value: &Value,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>>
where
    S: tokio::io::AsyncRead + tokio::io::AsyncWrite + Unpin,
{
    socket.send(Message::Text(value.to_string().into())).await?;
    Ok(())
}
