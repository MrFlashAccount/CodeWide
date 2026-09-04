#![cfg(unix)]
#![allow(clippy::too_many_lines)]

use std::{
    io::{Cursor, Read, Write},
    path::PathBuf,
    sync::Arc,
    time::Duration,
};

use base64::{Engine as _, engine::general_purpose};
use codewide_companion::{
    auth::{DeviceRegistry, pairing_claim_message},
    catalog::SessionCatalog,
    device_tls,
    history_service::HistoryService,
    identity::CompanionIdentity,
    server,
    store::IndexStore,
    sync::SyncHub,
    telemetry::TelemetryStore,
    upstream::{ConnectionStatus, UpstreamHandle},
};
use futures_util::{SinkExt, StreamExt};
use http::StatusCode;
use p256::{
    ecdsa::{Signature, SigningKey, signature::Signer},
    pkcs8::DecodePrivateKey,
};
use rcgen::PublicKeyData;
use rustls::{
    ClientConfig, ClientConnection, RootCertStore,
    pki_types::{CertificateDer, PrivateKeyDer, ServerName},
};
use serde_json::{Value, json};
use tokio::{
    net::{TcpListener, UnixListener, UnixStream},
    time::timeout,
};
use tokio_tungstenite::{WebSocketStream, accept_async, connect_async, tungstenite::Message};

const ADMIN_TOKEN: &str = "admin-token-that-is-long-enough-for-auth-test";

struct TestDeviceIdentity {
    signing: SigningKey,
    certificate: Vec<u8>,
    private_key: Vec<u8>,
    public_key_spki: String,
}

#[tokio::test]
async fn pairing_proof_session_and_full_grant_work_over_wire()
-> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let directory = tempfile::tempdir()?;
    let socket_path = directory.path().join("app-server.sock");
    let fake = tokio::spawn(run_fake_app_server(socket_path.clone()));
    let upstream = UpstreamHandle::spawn(socket_path);
    wait_for_live(&upstream).await?;
    let store = Arc::new(IndexStore::open(directory.path().join("state.redb"))?);
    let history = HistoryService::new(
        Arc::new(SessionCatalog::scan(directory.path())),
        store.clone(),
    );
    let sync = SyncHub::with_mutations(upstream, store.clone(), history);
    let registry = Arc::new(
        DeviceRegistry::open(
            Arc::from(ADMIN_TOKEN),
            directory.path().join("devices.json"),
            None,
        )
        .await?,
    );
    let telemetry = Arc::new(TelemetryStore::open(
        directory.path().join("telemetry.redb"),
    )?);
    let public_listener = TcpListener::bind("127.0.0.1:0").await?;
    let public_address = public_listener.local_addr()?;
    let identity = CompanionIdentity::load_or_create(&directory.path().join("identity"))?;
    let certificate = identity.certificate_der().to_vec();
    let bootstrap_listener = std::net::TcpListener::bind("127.0.0.1:0")?;
    bootstrap_listener.set_nonblocking(true)?;
    let bootstrap_address = bootstrap_listener.local_addr()?;
    let inner_listener = std::net::TcpListener::bind("127.0.0.1:0")?;
    inner_listener.set_nonblocking(true)?;
    let inner_address = inner_listener.local_addr()?;
    let control_path = directory.path().join("companion-control.sock");
    let control_listener = UnixListener::bind(&control_path)?;
    let routers = server::split_routers_with_registry_and_services(
        store,
        registry.clone(),
        sync,
        server::CompanionServices {
            telemetry: Some(telemetry),
            transport_identity: Some(identity.public().clone()),
            bootstrap_tls_target: Some(bootstrap_address),
            bootstrap_tls_limit: Some(Arc::new(tokio::sync::Semaphore::new(4))),
            inner_tls_target: Some(inner_address),
            inner_tls_limit: Some(Arc::new(tokio::sync::Semaphore::new(16))),
            ..server::CompanionServices::default()
        },
    );
    let public_task = tokio::spawn(async move {
        let _ = axum::serve(public_listener, routers.public).await;
    });
    let control_task = tokio::spawn(async move {
        let _ = axum::serve(control_listener, routers.control).await;
    });
    let bootstrap_tls = device_tls::bootstrap_config(&identity)?;
    let inner_tls = device_tls::device_bound_config(&identity, registry.trusted_client_spki())?;
    let bootstrap_task = tokio::spawn(async move {
        let server = axum_server::from_tcp_rustls(bootstrap_listener, bootstrap_tls);
        if let Ok(server) = server {
            let _ = server.serve(routers.bootstrap.into_make_service()).await;
        }
    });
    let inner_task = tokio::spawn(async move {
        let server = axum_server::from_tcp(inner_listener)
            .map(|server| server.acceptor(device_tls::DeviceTlsAcceptor::new(inner_tls)));
        if let Ok(server) = server {
            let _ = server.serve(routers.inner.into_make_service()).await;
        }
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
    let device_identity = test_device_identity()?;
    assert!(
        tunneled_json_request(
            public_address,
            &certificate,
            "/v1/e2ee-tunnel",
            Some(&device_identity),
            "/v1/auth",
            None,
            &json!({"action": "challenge"}),
        )
        .await
        .is_err(),
        "an unregistered device certificate must not complete TLS"
    );
    let (session_token, device_id) = secure_pair_and_authorize(
        &public_client,
        &control_client,
        &public_base,
        control_base,
        public_address,
        &certificate,
        &device_identity,
    )
    .await?;
    assert!(
        tunneled_json_request(
            public_address,
            &certificate,
            "/v1/e2ee-tunnel",
            None,
            "/v1/auth",
            None,
            &json!({"action": "challenge"}),
        )
        .await
        .is_err(),
        "the data tunnel must require a client certificate"
    );
    let (bootstrap_challenge_status, _) = tunneled_json_request(
        public_address,
        &certificate,
        "/v1/e2ee-bootstrap-tunnel",
        None,
        "/v1/auth",
        None,
        &json!({"action": "challenge"}),
    )
    .await?;
    assert_eq!(bootstrap_challenge_status, StatusCode::FORBIDDEN);
    let second_identity = test_device_identity()?;
    let _ = secure_pair_and_authorize(
        &public_client,
        &control_client,
        &public_base,
        control_base,
        public_address,
        &certificate,
        &second_identity,
    )
    .await?;
    let (mismatched_status, _) = tunneled_json_request(
        public_address,
        &certificate,
        "/v1/e2ee-tunnel",
        Some(&second_identity),
        "/v1/telemetry/events",
        Some(&session_token),
        &telemetry_batch(),
    )
    .await?;
    assert_eq!(mismatched_status, StatusCode::UNAUTHORIZED);
    for path in [
        "/v1/auth",
        "/v1/sync",
        "/v1/terminals",
        "/v1/files/download",
        "/v1/telemetry/events",
        "/v1/security/bootstrap",
        "/v1/security/upgrade",
        "/v1/security/upgrade/confirm",
    ] {
        assert_eq!(
            public_client
                .post(format!("{public_base}{path}"))
                .bearer_auth(&session_token)
                .json(&json!({}))
                .send()
                .await?
                .status(),
            StatusCode::NOT_FOUND,
            "private route escaped inner TLS: {path}"
        );
    }
    let (accepted_status, accepted) = tunneled_json_request(
        public_address,
        &certificate,
        "/v1/e2ee-tunnel",
        Some(&device_identity),
        "/v1/telemetry/events",
        Some(&session_token),
        &telemetry_batch(),
    )
    .await?;
    assert_eq!(accepted_status, StatusCode::ACCEPTED);
    assert_eq!(accepted, json!({"accepted": 1, "duplicates": 0}));
    let page: Value = control_client
        .get(format!(
            "{control_base}/v1/telemetry/events?requestId=request-1"
        ))
        .bearer_auth(ADMIN_TOKEN)
        .send()
        .await?
        .error_for_status()?
        .json()
        .await?;
    assert_eq!(page["events"][0]["deviceId"], device_id);
    assert_eq!(page["events"][0]["requestId"], "request-1");
    let devices: Value = control_client
        .get(format!("{control_base}/v1/devices"))
        .bearer_auth(ADMIN_TOKEN)
        .send()
        .await?
        .error_for_status()?
        .json()
        .await?;
    assert!(
        devices["devices"][0]
            .get("secureTransportRequired")
            .is_none()
    );
    control_client
        .delete(format!("{control_base}/v1/devices/{device_id}"))
        .bearer_auth(ADMIN_TOKEN)
        .send()
        .await?
        .error_for_status()?;
    assert!(
        tunneled_json_request(
            public_address,
            &certificate,
            "/v1/e2ee-tunnel",
            Some(&device_identity),
            "/v1/telemetry/events",
            Some(&session_token),
            &telemetry_batch(),
        )
        .await
        .is_err(),
        "revocation must reject the next TLS handshake"
    );
    public_task.abort();
    bootstrap_task.abort();
    inner_task.abort();
    control_task.abort();
    fake.abort();
    Ok(())
}

fn telemetry_batch() -> Value {
    json!({
        "version": 1,
        "batchId": "batch-1",
        "sentAtUnixMs": 10,
        "clientSessionId": "client-1",
        "events": [{
            "eventId": "event-1",
            "occurredAtUnixMs": 9,
            "name": "stream.react_commit",
            "sessionId": "thread-1",
            "requestId": "request-1",
            "connectionId": "connection-1",
            "threadId": "thread-1",
            "values": {"latencyMs": 12},
            "tags": {"renderer": "react-native"}
        }]
    })
}

async fn secure_pair_and_authorize(
    public_client: &reqwest::Client,
    control_client: &reqwest::Client,
    public_base: &str,
    control_base: &str,
    address: std::net::SocketAddr,
    certificate: &[u8],
    identity: &TestDeviceIdentity,
) -> Result<(String, String), Box<dyn std::error::Error + Send + Sync>> {
    let pairing: Value = control_client
        .post(format!("{control_base}/v1/pairing/start"))
        .bearer_auth(ADMIN_TOKEN)
        .send()
        .await?
        .error_for_status()?
        .json()
        .await?;
    let proof: Signature = identity.signing.sign(&pairing_claim_message(
        pairing["pairingToken"]
            .as_str()
            .ok_or("pairing token missing")?,
        "Secure Fold",
        &identity.public_key_spki,
    ));
    let (claim_status, claim) = tunneled_json_request(
        address,
        certificate,
        "/v1/e2ee-bootstrap-tunnel",
        None,
        "/v1/auth",
        None,
        &json!({
            "action": "register",
            "pairingToken": pairing["pairingToken"],
            "deviceName": "Secure Fold",
            "publicKeySpki": identity.public_key_spki,
            "proof": general_purpose::STANDARD.encode(proof.to_der().as_bytes())
        }),
    )
    .await?;
    assert_eq!(claim_status, StatusCode::CREATED);
    assert_eq!(claim["secureTransportRequired"], true);
    let device_token = claim["capabilityToken"]
        .as_str()
        .ok_or("device token missing")?;

    assert_eq!(
        public_client
            .post(format!("{public_base}/v1/auth"))
            .bearer_auth(device_token)
            .json(&json!({"action": "challenge"}))
            .send()
            .await?
            .status(),
        StatusCode::NOT_FOUND
    );

    let (challenge_status, challenge) = tunneled_json_request(
        address,
        certificate,
        "/v1/e2ee-tunnel",
        Some(identity),
        "/v1/auth",
        Some(device_token),
        &json!({"action": "challenge"}),
    )
    .await?;
    assert_eq!(challenge_status, StatusCode::CREATED);
    let nonce = general_purpose::URL_SAFE_NO_PAD
        .decode(challenge["challenge"].as_str().ok_or("challenge missing")?)?;
    let signature: Signature = identity.signing.sign(&nonce);
    let (session_status, session) = tunneled_json_request(
        address,
        certificate,
        "/v1/e2ee-tunnel",
        Some(identity),
        "/v1/auth",
        Some(device_token),
        &json!({
            "action": "session",
            "challengeId": challenge["challengeId"],
            "signature": general_purpose::STANDARD.encode(signature.to_der().as_bytes())
        }),
    )
    .await?;
    assert_eq!(session_status, StatusCode::CREATED);
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

async fn tunneled_json_request(
    address: std::net::SocketAddr,
    certificate: &[u8],
    tunnel_path: &str,
    identity: Option<&TestDeviceIdentity>,
    path: &str,
    bearer: Option<&str>,
    body: &Value,
) -> Result<(StatusCode, Value), Box<dyn std::error::Error + Send + Sync>> {
    let (mut socket, _) = connect_async(format!("ws://{address}{tunnel_path}")).await?;
    let mut roots = RootCertStore::empty();
    roots.add(CertificateDer::from(certificate.to_vec()))?;
    let builder = ClientConfig::builder().with_root_certificates(roots);
    let config = match identity {
        Some(identity) => builder.with_client_auth_cert(
            vec![CertificateDer::from(identity.certificate.clone())],
            PrivateKeyDer::try_from(identity.private_key.clone())?,
        )?,
        None => builder.with_no_client_auth(),
    };
    let mut tls = ClientConnection::new(
        Arc::new(config),
        ServerName::try_from("codewide-companion")?.to_owned(),
    )?;
    drive_inner_tls(&mut socket, &mut tls).await?;

    let body = serde_json::to_vec(body)?;
    let authorization = bearer.map_or_else(String::new, |token| {
        format!("Authorization: Bearer {token}\r\n")
    });
    let request = format!(
        "POST {path} HTTP/1.1\r\nHost: codewide-companion\r\nContent-Type: application/json\r\n{authorization}Content-Length: {}\r\nConnection: close\r\n\r\n",
        body.len()
    );
    tls.writer().write_all(request.as_bytes())?;
    tls.writer().write_all(&body)?;
    flush_inner_tls(&mut socket, &mut tls).await?;

    let mut plaintext = Vec::new();
    loop {
        if let Some(response) = parse_http_json_response(&plaintext)? {
            return Ok(response);
        }
        let message = timeout(Duration::from_secs(5), socket.next())
            .await?
            .ok_or("inner TLS tunnel closed before the HTTP response")??;
        if let Message::Binary(bytes) = message {
            tls.read_tls(&mut Cursor::new(bytes))?;
            tls.process_new_packets()?;
            drain_plaintext(&mut tls, &mut plaintext)?;
        }
        flush_inner_tls(&mut socket, &mut tls).await?;
    }
}

fn test_device_identity() -> Result<TestDeviceIdentity, Box<dyn std::error::Error + Send + Sync>> {
    let key_pair = rcgen::KeyPair::generate()?;
    let certificate = rcgen::CertificateParams::new(vec!["codewide-device".to_owned()])?
        .self_signed(&key_pair)?;
    let private_key = key_pair.serialize_der();
    Ok(TestDeviceIdentity {
        signing: SigningKey::from_pkcs8_der(&private_key)?,
        certificate: certificate.der().to_vec(),
        public_key_spki: general_purpose::STANDARD.encode(key_pair.subject_public_key_info()),
        private_key,
    })
}

fn drain_plaintext(
    tls: &mut ClientConnection,
    plaintext: &mut Vec<u8>,
) -> Result<(), std::io::Error> {
    let mut buffer = [0_u8; 16 * 1024];
    loop {
        match tls.reader().read(&mut buffer) {
            Ok(0) => return Ok(()),
            Ok(length) => plaintext.extend_from_slice(&buffer[..length]),
            Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => return Ok(()),
            Err(error) => return Err(error),
        }
    }
}

fn parse_http_json_response(
    response: &[u8],
) -> Result<Option<(StatusCode, Value)>, Box<dyn std::error::Error + Send + Sync>> {
    let Some(header_end) = response.windows(4).position(|part| part == b"\r\n\r\n") else {
        return Ok(None);
    };
    let header_end = header_end + 4;
    let headers = std::str::from_utf8(&response[..header_end])?;
    let status = headers
        .lines()
        .next()
        .and_then(|line| line.split_whitespace().nth(1))
        .ok_or("HTTP status missing")?
        .parse::<u16>()?;
    let content_length = headers
        .lines()
        .find_map(|line| {
            let (name, value) = line.split_once(':')?;
            name.eq_ignore_ascii_case("content-length")
                .then(|| value.trim().parse::<usize>())
        })
        .transpose()?
        .ok_or("HTTP content-length missing")?;
    if response.len() < header_end + content_length {
        return Ok(None);
    }
    let body = serde_json::from_slice(&response[header_end..header_end + content_length])?;
    Ok(Some((StatusCode::from_u16(status)?, body)))
}

async fn drive_inner_tls(
    socket: &mut WebSocketStream<tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>>,
    tls: &mut ClientConnection,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    while tls.is_handshaking() {
        flush_inner_tls(socket, tls).await?;
        let message = socket
            .next()
            .await
            .ok_or("inner TLS tunnel closed during handshake")??;
        if let Message::Binary(bytes) = message {
            tls.read_tls(&mut Cursor::new(bytes))?;
            tls.process_new_packets()?;
        }
    }
    flush_inner_tls(socket, tls).await
}

async fn flush_inner_tls(
    socket: &mut WebSocketStream<tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>>,
    tls: &mut ClientConnection,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    while tls.wants_write() {
        let mut records = Vec::new();
        tls.write_tls(&mut records)?;
        socket.send(Message::Binary(records.into())).await?;
    }
    Ok(())
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
