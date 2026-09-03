use std::{
    io::{Cursor, Read, Write},
    net::SocketAddr,
    sync::Arc,
    time::Duration,
};

use axum::{
    Router,
    extract::{State, WebSocketUpgrade},
    http::StatusCode,
    response::{IntoResponse, Response},
    routing::get,
};
use axum_server::{Handle, tls_rustls::RustlsConfig};
use codewide_companion::{
    identity::{CompanionIdentity, rotate},
    ports,
};
use futures_util::{SinkExt, StreamExt};
use rustls::{
    ClientConfig, ClientConnection, RootCertStore,
    pki_types::{CertificateDer, ServerName},
};
use tokio::net::{TcpListener, TcpStream};
use tokio_tungstenite::{connect_async, tungstenite::Message};

#[tokio::test]
async fn companion_identity_survives_reconnect_and_rejects_wrong_or_rotated_identity()
-> Result<(), Box<dyn std::error::Error>> {
    let root = tempfile::tempdir()?;
    let identity_path = root.path().join("identity");
    let identity = CompanionIdentity::load_or_create(&identity_path)?;
    let original_certificate = identity.certificate_der().to_vec();
    let (first_handle, first_address) = start_tls_probe(identity).await?;

    let original_client = client_for(&original_certificate, first_address)?;
    let url = format!("https://codewide-companion:{}/probe", first_address.port());
    assert_eq!(
        original_client.get(&url).send().await?.text().await?,
        "secure"
    );
    assert_eq!(
        original_client.get(&url).send().await?.text().await?,
        "secure"
    );

    let attacker_root = root.path().join("attacker");
    let attacker = CompanionIdentity::load_or_create(&attacker_root)?;
    let attacker_client = client_for(attacker.certificate_der(), first_address)?;
    assert!(attacker_client.get(&url).send().await.is_err());

    first_handle.shutdown();
    tokio::time::sleep(Duration::from_millis(50)).await;
    let rotated = rotate(&identity_path)?;
    let rotated_certificate = rotated.certificate_der().to_vec();
    let (rotated_handle, rotated_address) = start_tls_probe(rotated).await?;
    let rotated_url = format!(
        "https://codewide-companion:{}/probe",
        rotated_address.port()
    );
    let stale_client = client_for(&original_certificate, rotated_address)?;
    assert!(stale_client.get(&rotated_url).send().await.is_err());
    assert_eq!(
        client_for(&rotated_certificate, rotated_address)?
            .get(&rotated_url)
            .send()
            .await?
            .text()
            .await?,
        "secure"
    );
    rotated_handle.shutdown();
    Ok(())
}

#[tokio::test]
async fn tls_13_remains_end_to_end_inside_a_blind_websocket_tunnel()
-> Result<(), Box<dyn std::error::Error>> {
    let root = tempfile::tempdir()?;
    let identity = CompanionIdentity::load_or_create(&root.path().join("identity"))?;
    let certificate = identity.certificate_der().to_vec();
    let (inner_handle, inner_address) = start_tls_probe(identity).await?;
    let listener = TcpListener::bind("127.0.0.1:0").await?;
    let outer_address = listener.local_addr()?;
    let outer = tokio::spawn(async move {
        let router = Router::new()
            .route("/v1/e2ee-tunnel", get(test_tunnel))
            .with_state(inner_address);
        let _ = axum::serve(listener, router).await;
    });
    let (mut socket, _) = connect_async(format!("ws://{outer_address}/v1/e2ee-tunnel")).await?;

    let mut roots = RootCertStore::empty();
    roots.add(CertificateDer::from(certificate))?;
    let config = ClientConfig::builder()
        .with_root_certificates(roots)
        .with_no_client_auth();
    let mut tls = ClientConnection::new(
        Arc::new(config),
        ServerName::try_from("codewide-companion")?.to_owned(),
    )?;
    drive_tls(&mut socket, &mut tls).await?;
    assert_eq!(
        tls.protocol_version(),
        Some(rustls::ProtocolVersion::TLSv1_3)
    );
    tls.writer().write_all(
        b"GET /probe HTTP/1.1\r\nHost: codewide-companion\r\nConnection: close\r\n\r\n",
    )?;
    flush_tls(&mut socket, &mut tls).await?;

    let mut plaintext = Vec::new();
    while !plaintext
        .windows(b"secure".len())
        .any(|value| value == b"secure")
    {
        let message = tokio::time::timeout(Duration::from_secs(5), socket.next())
            .await?
            .ok_or("blind tunnel closed before the TLS response")??;
        if let Message::Binary(bytes) = message {
            tls.read_tls(&mut Cursor::new(bytes))?;
            tls.process_new_packets()?;
            tls.reader().read_to_end(&mut plaintext)?;
        }
    }
    assert!(plaintext.starts_with(b"HTTP/1.1 200"));
    inner_handle.shutdown();
    outer.abort();
    Ok(())
}

async fn test_tunnel(State(target): State<SocketAddr>, upgrade: WebSocketUpgrade) -> Response {
    let Ok(stream) = TcpStream::connect(target).await else {
        return StatusCode::SERVICE_UNAVAILABLE.into_response();
    };
    upgrade.on_upgrade(move |socket| ports::bridge_tcp(socket, stream))
}

async fn drive_tls(
    socket: &mut tokio_tungstenite::WebSocketStream<tokio_tungstenite::MaybeTlsStream<TcpStream>>,
    tls: &mut ClientConnection,
) -> Result<(), Box<dyn std::error::Error>> {
    while tls.is_handshaking() {
        flush_tls(socket, tls).await?;
        let message = socket
            .next()
            .await
            .ok_or("blind tunnel closed during TLS")??;
        let Message::Binary(bytes) = message else {
            continue;
        };
        tls.read_tls(&mut Cursor::new(bytes))?;
        tls.process_new_packets()?;
    }
    flush_tls(socket, tls).await
}

async fn flush_tls(
    socket: &mut tokio_tungstenite::WebSocketStream<tokio_tungstenite::MaybeTlsStream<TcpStream>>,
    tls: &mut ClientConnection,
) -> Result<(), Box<dyn std::error::Error>> {
    while tls.wants_write() {
        let mut records = Vec::new();
        tls.write_tls(&mut records)?;
        socket.send(Message::Binary(records.into())).await?;
    }
    Ok(())
}

async fn start_tls_probe(
    identity: CompanionIdentity,
) -> Result<(Handle<SocketAddr>, SocketAddr), Box<dyn std::error::Error>> {
    let tls = RustlsConfig::from_der(
        vec![identity.certificate_der().to_vec()],
        identity.private_key_der().to_vec(),
    )
    .await?;
    let handle = Handle::new();
    let task_handle = handle.clone();
    tokio::spawn(async move {
        let router = Router::new().route("/probe", get(|| async { "secure" }));
        let _ = axum_server::bind_rustls(SocketAddr::from(([127, 0, 0, 1], 0)), tls)
            .handle(task_handle)
            .serve(router.into_make_service())
            .await;
    });
    let address = tokio::time::timeout(Duration::from_secs(5), handle.listening())
        .await?
        .ok_or("TLS test server did not bind")?;
    Ok((handle, address))
}

fn client_for(
    certificate: &[u8],
    address: SocketAddr,
) -> Result<reqwest::Client, Box<dyn std::error::Error>> {
    Ok(reqwest::Client::builder()
        .no_proxy()
        .tls_built_in_root_certs(false)
        .add_root_certificate(reqwest::Certificate::from_der(certificate)?)
        .resolve("codewide-companion", address)
        .build()?)
}
