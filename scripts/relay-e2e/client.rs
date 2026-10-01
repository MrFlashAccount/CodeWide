//! Isolated real Companion + software phone. No account, live Codex or handset.
use base64::{Engine as _, engine::general_purpose};
use companion_core::{
    auth::pairing_claim_message,
    host_identity::HostDisplayName,
    identity::CompanionIdentity,
    managed_runtime::{ManagedRuntime, ManagedRuntimeConfig},
    secure_store::SecretStoragePolicy,
};
use futures_util::{SinkExt, StreamExt};
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
use std::{
    collections::HashMap,
    io::{Cursor, Read, Write},
    sync::Arc,
    time::Duration,
};
use tokio_tungstenite::{
    Connector, MaybeTlsStream, WebSocketStream, connect_async_tls_with_config,
    tungstenite::{Message, client::IntoClientRequest},
};

type Result<T> = std::result::Result<T, Box<dyn std::error::Error + Send + Sync>>;
type Socket = WebSocketStream<MaybeTlsStream<tokio::net::TcpStream>>;

fn main() -> Result<()> {
    if std::env::args().nth(1).as_deref() == Some("missing-codex") {
        return missing_codex();
    }
    tokio::runtime::Runtime::new()?
        .block_on(async { tokio::time::timeout(Duration::from_secs(300), relay()).await? })
}

fn missing_codex() -> Result<()> {
    let directory = tempfile::tempdir()?;
    let home = directory.path().join("home");
    let codex = home.join(".codex");
    std::fs::create_dir_all(&codex)?;
    let host = companion_swift_ffi::CoreHost::new(
        directory.path().join("state").display().to_string(),
        codex.display().to_string(),
        "test".into(),
        "test".into(),
        "Isolated missing Codex".into(),
        "127.0.0.1:0".into(),
    )?;
    let profiles = host.discover_app_servers(home.display().to_string())?;
    assert_eq!(host.health()?.phase, "running");
    assert!(!profiles.is_empty());
    assert!(profiles.iter().all(|profile| matches!(
        profile.availability,
        companion_swift_ffi::FfiAppServerAvailability::Unavailable
    )));
    assert!(matches!(
        host.codex_installation(home.display().to_string()),
        companion_swift_ffi::FfiCodexInstallation::NotFound { .. }
    ));
    let error = host
        .start_app_server(codex.display().to_string(), home.display().to_string())
        .expect_err("Absent Codex must not start");
    assert!(
        error
            .to_string()
            .contains("No compatible Codex installation was found")
    );
    println!(
        "missing_codex: real shared FFI starts, discovery returns unavailable, installation is NotFound, start fails actionably"
    );
    Ok(())
}

async fn relay() -> Result<()> {
    let address = std::env::args()
        .nth(1)
        .ok_or("Pass the isolated Relay loopback IP:port")?;
    let socket_address: std::net::SocketAddr = address.parse()?;
    if !socket_address.ip().is_loopback() {
        return Err("Only an isolated loopback Relay is allowed".into());
    }
    let directory = tempfile::tempdir()?;
    let state = directory.path().join("companion");
    let home = directory.path().join("codex");
    std::fs::create_dir_all(&home)?;
    let runtime = ManagedRuntime::start(
        ManagedRuntimeConfig::desktop(
            state.clone(),
            home,
            HostDisplayName::new("E2E isolated Companion")?,
        )
        .with_secret_storage_policy(SecretStoragePolicy::PrivateFileOnly)
        .with_listen_address("127.0.0.1:0".parse()?),
    )
    .await?;
    let enrollment = runtime.begin_relay_enrollment(&address)?;
    let mut printed = false;
    loop {
        let status = runtime.relay_enrollment_status(&enrollment.id)?;
        if let Some(code) = status.code
            && !printed
        {
            println!("code={}", serde_json::to_string(&code)?);
            std::io::stdout().flush()?;
            printed = true;
        }
        match status.state.as_str() {
            "connected" => break,
            "failed" | "cancelled" => return Err(status.message.unwrap_or(status.state).into()),
            _ => tokio::time::sleep(Duration::from_millis(25)).await,
        }
    }
    verify_phone(&runtime, &state, &address).await?;
    if std::env::args().nth(2).as_deref() == Some("--hold") {
        for line in std::io::stdin().lines() {
            if line? != "verify" {
                return Err("Unknown fixture command".into());
            }
            tokio::time::timeout(Duration::from_secs(30), async {
                while runtime.relay_status()?.connection
                    != companion_core::relay::RelayConnectionStatus::Online
                {
                    tokio::time::sleep(Duration::from_millis(25)).await;
                }
                verify_phone(&runtime, &state, &address).await
            })
            .await??;
        }
    }
    Ok(())
}

async fn verify_phone(
    runtime: &ManagedRuntime,
    state: &std::path::Path,
    address: &str,
) -> Result<()> {
    let pairing = runtime.create_pairing(None).await?;
    let link = url::Url::parse(&pairing.link)?;
    let query: HashMap<_, _> = link.query_pairs().collect();
    assert_eq!(query.get("v").map(AsRef::as_ref), Some("2"));
    let route = query.get("r").ok_or("Missing route")?;
    let pin = query.get("q").ok_or("Missing Relay pin")?;
    let token = query.get("t").ok_or("Missing device pairing token")?;
    let companion = CompanionIdentity::load_or_create_with_policy(
        &state.join("identity"),
        SecretStoragePolicy::PrivateFileOnly,
    )?;
    let certificate = companion.certificate_der();
    let key = rcgen::KeyPair::generate()?;
    let device_certificate = rcgen::CertificateParams::new(vec!["codewide-device".to_owned()])?
        .self_signed(&key)?
        .der()
        .to_vec();
    let private_key = key.serialize_der();
    let public_key = general_purpose::STANDARD.encode(key.subject_public_key_info());
    let signing = SigningKey::from_pkcs8_der(&private_key)?;
    let signature: Signature = signing.sign(&pairing_claim_message(
        token,
        "Software E2E phone",
        &public_key,
    ));
    let body = serde_json::to_vec(
        &json!({"action":"register", "pairingToken":token, "deviceName":"Software E2E phone",
        "publicKeySpki":public_key, "proof":general_purpose::STANDARD.encode(signature.to_der().as_bytes())}),
    )?;
    let pairing_url = format!("wss://{address}/v1/e2ee-bootstrap-tunnel");
    let (mut socket, mut tls) = tunnel(&pairing_url, route, pin, certificate, None).await?;
    tls.writer().write_all(format!("POST /v1/auth HTTP/1.1\r\nHost: codewide-companion\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n", body.len()).as_bytes())?;
    tls.writer().write_all(&body)?;
    flush(&mut socket, &mut tls).await?;
    let response = read_http(&mut socket, &mut tls, true).await?;
    assert_eq!(response.0, 201);
    let claim: Value = serde_json::from_slice(&response.1)?;
    let capability = claim["capabilityToken"]
        .as_str()
        .ok_or("Missing capability")?;
    let device_id = claim["deviceId"].as_str().ok_or("Missing device ID")?;
    assert_eq!(runtime.devices().await.len(), 1);
    let device_url = format!("wss://{address}/v1/e2ee-tunnel");
    let (mut socket, mut tls) = tunnel(
        &device_url,
        route,
        pin,
        certificate,
        Some((&device_certificate, &private_key)),
    )
    .await?;
    let ws_key = tokio_tungstenite::tungstenite::handshake::client::generate_key();
    let sync_request = format!(
        "GET /v1/sync HTTP/1.1\r\nHost: codewide-companion\r\nAuthorization: Bearer {capability}\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Key: {ws_key}\r\n\r\n"
    );
    tls.writer().write_all(sync_request.as_bytes())?;
    flush(&mut socket, &mut tls).await?;
    assert_eq!(read_http(&mut socket, &mut tls, false).await?.0, 101);
    socket.close(None).await?;
    assert!(runtime.revoke_device(device_id.to_owned()).await?);
    // TLS 1.3 can let the client send Finished before the server has verified
    // its certificate. Prove refusal through the first application response,
    // not the client's local handshake state alone.
    let revoked_request = async {
        let (mut socket, mut tls) = tunnel(
            &device_url,
            route,
            pin,
            certificate,
            Some((&device_certificate, &private_key)),
        )
        .await?;
        tls.writer().write_all(sync_request.as_bytes())?;
        flush(&mut socket, &mut tls).await?;
        read_http(&mut socket, &mut tls, false).await
    };
    assert!(revoked_request.await.is_err());
    assert!(runtime.failure().is_none());
    println!(
        "relay_e2e: actual shared Companion enrolled, software phone registered through pinned Relay + inner TLS, mTLS sync upgraded, revoke rejected access"
    );
    Ok(())
}

async fn tunnel(
    url: &str,
    route: &str,
    pin: &str,
    certificate: &[u8],
    device: Option<(&[u8], &[u8])>,
) -> Result<(Socket, ClientConnection)> {
    let connector = Connector::Rustls(codewide_relay::transport_tls::pinned_client_config(pin)?);
    let mut request = url.into_client_request()?;
    request
        .headers_mut()
        .insert("x-codewide-relay-route", route.parse()?);
    let (mut socket, _) =
        connect_async_tls_with_config(request, None, false, Some(connector)).await?;
    let mut roots = RootCertStore::empty();
    roots.add(CertificateDer::from(certificate.to_vec()))?;
    let builder = ClientConfig::builder().with_root_certificates(roots);
    let config = match device {
        Some((cert, key)) => builder.with_client_auth_cert(
            vec![CertificateDer::from(cert.to_vec())],
            PrivateKeyDer::try_from(key.to_vec())?,
        )?,
        None => builder.with_no_client_auth(),
    };
    let mut tls = ClientConnection::new(
        Arc::new(config),
        ServerName::try_from("codewide-companion")?.to_owned(),
    )?;
    while tls.is_handshaking() {
        flush(&mut socket, &mut tls).await?;
        receive(&mut socket, &mut tls, &mut Vec::new()).await?;
    }
    flush(&mut socket, &mut tls).await?;
    Ok((socket, tls))
}

async fn flush(socket: &mut Socket, tls: &mut ClientConnection) -> Result<()> {
    while tls.wants_write() {
        let mut records = Vec::new();
        tls.write_tls(&mut records)?;
        socket.send(Message::Binary(records.into())).await?;
    }
    Ok(())
}

async fn receive(
    socket: &mut Socket,
    tls: &mut ClientConnection,
    plaintext: &mut Vec<u8>,
) -> Result<()> {
    let message = tokio::time::timeout(Duration::from_secs(5), socket.next())
        .await?
        .ok_or("Tunnel closed")??;
    if let Message::Binary(bytes) = message {
        tls.read_tls(&mut Cursor::new(bytes))?;
        tls.process_new_packets()?;
        let mut buffer = [0; 16384];
        loop {
            match tls.reader().read(&mut buffer) {
                Ok(0) => break,
                Ok(length) => plaintext.extend_from_slice(&buffer[..length]),
                Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => break,
                Err(error) => return Err(error.into()),
            }
        }
    }
    flush(socket, tls).await
}

async fn read_http(
    socket: &mut Socket,
    tls: &mut ClientConnection,
    body: bool,
) -> Result<(u16, Vec<u8>)> {
    let mut plaintext = Vec::new();
    loop {
        if let Some(end) = plaintext.windows(4).position(|part| part == b"\r\n\r\n") {
            let headers = std::str::from_utf8(&plaintext[..end])?;
            let status = headers
                .split_whitespace()
                .nth(1)
                .ok_or("Missing status")?
                .parse()?;
            if !body {
                return Ok((status, Vec::new()));
            }
            let length: usize = headers
                .lines()
                .find_map(|line| {
                    let (name, value) = line.split_once(':')?;
                    name.eq_ignore_ascii_case("content-length")
                        .then_some(value.trim())
                })
                .ok_or("Missing content length")?
                .parse()?;
            if plaintext.len() >= end + 4 + length {
                return Ok((status, plaintext[end + 4..end + 4 + length].to_vec()));
            }
        }
        receive(socket, tls, &mut plaintext).await?;
    }
}
