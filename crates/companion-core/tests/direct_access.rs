#![cfg(unix)]
#![allow(clippy::too_many_lines)]

use base64::{Engine as _, engine::general_purpose};
use companion_core::{
    auth::pairing_claim_message,
    host_identity::HostDisplayName,
    identity::CompanionIdentity,
    managed_runtime::{ManagedRuntime, ManagedRuntimeConfig},
    secure_store::SecretStoragePolicy,
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
use std::{
    collections::HashMap,
    io::{Cursor, Read, Write},
    net::{Ipv4Addr, SocketAddr},
    sync::Arc,
    time::Duration,
};
use tokio::time::timeout;
use tokio_tungstenite::{
    Connector, MaybeTlsStream, WebSocketStream, client_async_tls_with_config, tungstenite::Message,
};

type TestResult<T> = Result<T, Box<dyn std::error::Error + Send + Sync>>;

struct TestDeviceIdentity {
    signing: SigningKey,
    certificate: Vec<u8>,
    private_key: Vec<u8>,
    public_key_spki: String,
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn direct_desktop_pairing_authenticates_a_device_and_revoke_closes_access() -> TestResult<()>
{
    timeout(Duration::from_secs(20), direct_pairing_flow()).await?
}

async fn direct_pairing_flow() -> TestResult<()> {
    let directory = tempfile::tempdir()?;
    let state = directory.path().join("state");
    let home = directory.path().join("codex");
    std::fs::create_dir_all(&home)?;
    let runtime = ManagedRuntime::start(
        ManagedRuntimeConfig::desktop(state.clone(), home, HostDisplayName::new("Direct Mac")?)
            .with_secret_storage_policy(SecretStoragePolicy::PrivateFileOnly)
            .with_listen_address((Ipv4Addr::UNSPECIFIED, 0).into()),
    )
    .await?;
    assert!(runtime.listen_address().ip().is_unspecified());
    assert!(!runtime.relay_status()?.configured);
    let address = SocketAddr::from((Ipv4Addr::LOCALHOST, runtime.listen_address().port()));
    let identity = CompanionIdentity::load_or_create_with_policy(
        &state.join("identity"),
        SecretStoragePolicy::PrivateFileOnly,
    )?;
    let certificate = identity.certificate_der();
    let endpoint = format!("https://codewide-companion:{}", address.port());
    let public = reqwest::Client::builder()
        .no_proxy()
        .resolve("codewide-companion", address)
        .add_root_certificate(reqwest::Certificate::from_der(certificate)?)
        .build()?;
    for path in [
        "/healthz",
        "/v1/devices",
        "/v1/pairing/start",
        "/v1/auth",
        "/v1/sync",
    ] {
        assert_eq!(
            public
                .get(format!("{endpoint}{path}"))
                .send()
                .await?
                .status(),
            StatusCode::NOT_FOUND
        );
    }
    assert!(
        reqwest::Client::builder()
            .no_proxy()
            .resolve("codewide-companion", address)
            .build()?
            .get(format!("{endpoint}/healthz"))
            .send()
            .await
            .is_err()
    );

    let pairing = runtime.create_pairing(None).await?;
    let link = url::Url::parse(&pairing.link)?;
    let query = link.query_pairs().collect::<HashMap<_, _>>();
    assert_eq!(query.get("v").map(AsRef::as_ref), Some("1"));
    let advertised = query.get("e").ok_or("no endpoint")?;
    assert!(
        runtime
            .direct_endpoints()?
            .contains(&advertised.to_string())
    );
    assert!(!advertised.contains("0.0.0.0"));
    let token = query.get("t").ok_or("no pairing token")?;
    let device = test_device_identity()?;
    assert!(
        tunneled_sync_status(address, certificate, &device, "unregistered")
            .await
            .is_err()
    );
    let proof: Signature = device.signing.sign(&pairing_claim_message(
        token,
        "Direct phone",
        &device.public_key_spki,
    ));
    let claim_request = json!({
        "action": "register", "pairingToken": token, "deviceName": "Direct phone",
        "publicKeySpki": device.public_key_spki,
        "proof": general_purpose::STANDARD.encode(proof.to_der().as_bytes())
    });
    let (status, claim) = tunneled_json_request(
        address,
        certificate,
        "/v1/e2ee-bootstrap-tunnel",
        None,
        "/v1/auth",
        None,
        &claim_request,
    )
    .await?;
    assert_eq!(status, StatusCode::CREATED);
    let capability = claim["capabilityToken"].as_str().ok_or("no capability")?;
    let device_id = claim["deviceId"].as_str().ok_or("no device id")?;
    assert_eq!(
        tunneled_sync_status(address, certificate, &device, capability).await?,
        StatusCode::SWITCHING_PROTOCOLS
    );
    assert_eq!(runtime.devices().await.len(), 1);
    let (reused, _) = tunneled_json_request(
        address,
        certificate,
        "/v1/e2ee-bootstrap-tunnel",
        None,
        "/v1/auth",
        None,
        &claim_request,
    )
    .await?;
    assert_ne!(reused, StatusCode::CREATED);
    assert!(runtime.revoke_device(device_id.to_owned()).await?);
    assert!(runtime.devices().await.is_empty());
    assert!(
        tunneled_sync_status(address, certificate, &device, capability)
            .await
            .is_err()
    );
    assert!(runtime.failure().is_none());
    Ok(())
}

async fn connect_direct(
    address: SocketAddr,
    certificate: &[u8],
    path: &str,
) -> TestResult<WebSocketStream<MaybeTlsStream<tokio::net::TcpStream>>> {
    let mut roots = RootCertStore::empty();
    roots.add(CertificateDer::from(certificate.to_vec()))?;
    let config = ClientConfig::builder()
        .with_root_certificates(roots)
        .with_no_client_auth();
    let stream = tokio::net::TcpStream::connect(address).await?;
    // Resolve the fixture certificate's name locally without bypassing trust.
    let (socket, _) = client_async_tls_with_config(
        format!("wss://codewide-companion:{}{path}", address.port()),
        stream,
        None,
        Some(Connector::Rustls(Arc::new(config))),
    )
    .await?;
    Ok(socket)
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
    tunneled_http_request(
        address,
        certificate,
        tunnel_path,
        identity,
        path,
        bearer,
        ("POST", Some(body)),
    )
    .await
}

async fn tunneled_http_request(
    address: std::net::SocketAddr,
    certificate: &[u8],
    tunnel_path: &str,
    identity: Option<&TestDeviceIdentity>,
    path: &str,
    bearer: Option<&str>,
    method_and_body: (&str, Option<&Value>),
) -> Result<(StatusCode, Value), Box<dyn std::error::Error + Send + Sync>> {
    let mut socket = connect_direct(address, certificate, tunnel_path).await?;
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

    let (method, body) = method_and_body;
    let body = body.map_or_else(|| Ok(Vec::new()), serde_json::to_vec)?;
    let authorization = bearer.map_or_else(String::new, |token| {
        format!("Authorization: Bearer {token}\r\n")
    });
    let request = format!(
        "{method} {path} HTTP/1.1\r\nHost: codewide-companion\r\nContent-Type: application/json\r\n{authorization}Content-Length: {}\r\nConnection: close\r\n\r\n",
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

async fn tunneled_sync_status(
    address: std::net::SocketAddr,
    certificate: &[u8],
    identity: &TestDeviceIdentity,
    capability: &str,
) -> Result<StatusCode, Box<dyn std::error::Error + Send + Sync>> {
    let mut socket = connect_direct(address, certificate, "/v1/e2ee-tunnel").await?;
    let mut roots = RootCertStore::empty();
    roots.add(CertificateDer::from(certificate.to_vec()))?;
    let config = ClientConfig::builder()
        .with_root_certificates(roots)
        .with_client_auth_cert(
            vec![CertificateDer::from(identity.certificate.clone())],
            PrivateKeyDer::try_from(identity.private_key.clone())?,
        )?;
    let mut tls = ClientConnection::new(
        Arc::new(config),
        ServerName::try_from("codewide-companion")?.to_owned(),
    )?;
    timeout(
        Duration::from_secs(5),
        drive_inner_tls(&mut socket, &mut tls),
    )
    .await??;
    let websocket_key = tokio_tungstenite::tungstenite::handshake::client::generate_key();
    let request = format!(
        "GET /v1/sync HTTP/1.1\r\nHost: codewide-companion\r\nAuthorization: Bearer {capability}\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Key: {websocket_key}\r\n\r\n"
    );
    tls.writer().write_all(request.as_bytes())?;
    flush_inner_tls(&mut socket, &mut tls).await?;
    let mut plaintext = Vec::new();
    loop {
        if let Some(end) = plaintext.windows(4).position(|value| value == b"\r\n\r\n") {
            let headers = std::str::from_utf8(&plaintext[..end])?;
            let status = headers
                .split_whitespace()
                .nth(1)
                .ok_or("missing status")?
                .parse::<u16>()?;
            socket.close(None).await?;
            return Ok(StatusCode::from_u16(status)?);
        }
        let message = timeout(Duration::from_secs(5), socket.next())
            .await?
            .ok_or("tunnel closed before sync upgrade")??;
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
