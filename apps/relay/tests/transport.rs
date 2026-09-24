use codewide_relay::{
    Result,
    adapter::Adapter,
    auth,
    pairing::{PairRequest, PairResponse},
    registry::Registry,
    server::Relay,
    transport_tls::{RelayTlsIdentity, pinned_client_config},
};
use futures_util::{SinkExt, StreamExt, future::join_all};
use std::{net::SocketAddr, sync::Arc, time::Duration};
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::{TcpListener, TcpStream},
    task::{JoinHandle, JoinSet},
};
use tokio_rustls::{TlsAcceptor, TlsConnector};
use tokio_tungstenite::{
    Connector, MaybeTlsStream, WebSocketStream, connect_async, connect_async_tls_with_config,
    tungstenite::{Message, client::IntoClientRequest, http::HeaderValue},
};
use tokio_util::sync::CancellationToken;

type Client = WebSocketStream<MaybeTlsStream<TcpStream>>;

struct Fixture {
    tasks: JoinSet<()>,
    relay_task: Option<JoinHandle<()>>,
    relay_stop: CancellationToken,
    adapter_stops: Vec<CancellationToken>,
    relay: SocketAddr,
    relay_tls: Arc<rustls::ServerConfig>,
    relay_tls_pin_sha256: String,
    route_id: String,
    registry: Registry,
    _state: tempfile::TempDir,
    adapter: Adapter,
}

impl Fixture {
    async fn start() -> Result<Self> {
        let relay_listener = TcpListener::bind("127.0.0.1:0").await?;
        let relay = relay_listener.local_addr()?;
        let target = TcpListener::bind("127.0.0.1:0").await?;
        let state = tempfile::tempdir()?;
        let registry = Registry::open(state.path())?;
        let identity = RelayTlsIdentity::load_or_create(state.path())?;
        let relay_tls = identity.server_config()?;
        let relay_tls_pin_sha256 = identity.pin();
        let invitation = registry.create_invitation(None)?;
        let paired = registry.pair(&invitation.route_id, &invitation.token)?;
        let relay_stop = CancellationToken::new();
        let mut result = Self {
            tasks: JoinSet::new(),
            relay_task: Some(spawn_relay(
                relay_listener,
                registry.clone(),
                relay_tls.clone(),
                relay_stop.clone(),
            )),
            relay_stop,
            adapter_stops: Vec::new(),
            relay,
            relay_tls,
            relay_tls_pin_sha256: relay_tls_pin_sha256.clone(),
            route_id: paired.route_id.clone(),
            registry,
            _state: state,
            adapter: Adapter {
                companion_url: Arc::from(format!("wss://{relay}")),
                relay_tls_pin_sha256: Arc::from(relay_tls_pin_sha256),
                route_id: Arc::from(paired.route_id),
                access_token: Arc::from(paired.access_token),
                device_target: target.local_addr()?,
                pairing_target: target.local_addr()?,
            },
        };
        result.tasks.spawn(async move {
            let mut streams = JoinSet::new();
            loop {
                tokio::select! {
                    Some(_) = streams.join_next(), if !streams.is_empty() => {},
                    accepted = target.accept() => {
                        let Ok((mut stream, _)) = accepted else { break; };
                        streams.spawn(async move {
                            let (mut read, mut write) = stream.split();
                            let _ = tokio::io::copy(&mut read, &mut write).await;
                        });
                    }
                }
            }
        });
        result.start_adapter();
        Ok(result)
    }

    fn start_adapter(&mut self) {
        let stop = CancellationToken::new();
        self.adapter_stops.push(stop.clone());
        let adapter = self.adapter.clone();
        self.tasks.spawn(async move {
            let _ = adapter.run(stop).await;
        });
    }

    fn stop_latest_adapter(&mut self) -> Result<()> {
        self.adapter_stops
            .pop()
            .ok_or_else(|| std::io::Error::other("fixture must have an adapter"))?
            .cancel();
        Ok(())
    }

    async fn restart_relay(&mut self) -> Result<()> {
        self.relay_stop.cancel();
        if let Some(task) = self.relay_task.take() {
            task.await?;
        }
        let relay_listener = TcpListener::bind(self.relay).await?;
        self.relay_stop = CancellationToken::new();
        self.relay_task = Some(spawn_relay(
            relay_listener,
            self.registry.clone(),
            self.relay_tls.clone(),
            self.relay_stop.clone(),
        ));
        Ok(())
    }

    async fn client(&self, suffix: &str) -> Result<Client> {
        self.client_route(&self.route_id, suffix).await
    }

    async fn client_route(&self, route_id: &str, suffix: &str) -> Result<Client> {
        let address = format!("ws://{}/c/{route_id}/v1/{suffix}", self.relay);
        tokio::time::timeout(Duration::from_secs(30), async {
            loop {
                if let Ok((socket, _)) = connect_async(&address).await {
                    return Ok(socket);
                }
                tokio::time::sleep(Duration::from_millis(30)).await;
            }
        })
        .await?
    }

    async fn pinned_client(&self, route_id: &str, suffix: &str) -> Result<Client> {
        let address = format!("wss://{}/v1/{suffix}", self.relay);
        let mut request = address.into_client_request()?;
        request
            .headers_mut()
            .insert("x-codewide-relay-route", HeaderValue::from_str(route_id)?);
        let tls = pinned_client_config(&self.relay_tls_pin_sha256)?;
        Ok(tokio::time::timeout(Duration::from_secs(30), async {
            loop {
                match connect_async_tls_with_config(
                    request.clone(),
                    None,
                    true,
                    Some(Connector::Rustls(tls.clone())),
                )
                .await
                {
                    Ok((socket, _)) => return Ok(socket),
                    Err(error) if route_id != self.route_id => return Err(error),
                    Err(_) => tokio::time::sleep(Duration::from_millis(30)).await,
                }
            }
        })
        .await??)
    }
}

impl Drop for Fixture {
    fn drop(&mut self) {
        self.relay_stop.cancel();
        for stop in &self.adapter_stops {
            stop.cancel();
        }
        if let Some(task) = &self.relay_task {
            task.abort();
        }
        self.tasks.abort_all();
    }
}

fn spawn_relay(
    relay_listener: TcpListener,
    registry: Registry,
    tls: Arc<rustls::ServerConfig>,
    stop: CancellationToken,
) -> JoinHandle<()> {
    let relay = Relay::new(registry);
    tokio::spawn(async move {
        let _ = codewide_relay::server::serve(relay, relay_listener, tls, stop).await;
    })
}

async fn connect_companion(
    request: tokio_tungstenite::tungstenite::http::Request<()>,
    pin: &str,
) -> Result<Client> {
    Ok(connect_async_tls_with_config(
        request,
        None,
        true,
        Some(Connector::Rustls(pinned_client_config(pin)?)),
    )
    .await?
    .0)
}

fn pinned_http_client(pin: &str) -> Result<reqwest::Client> {
    let tls = pinned_client_config(pin)?;
    Ok(reqwest::Client::builder()
        .https_only(true)
        .use_preconfigured_tls(tls.as_ref().clone())
        .build()?)
}

async fn echoed(client: &mut Client, payload: &[u8]) -> Result<()> {
    client
        .send(Message::Binary(payload.to_vec().into()))
        .await?;
    let mut actual = Vec::new();
    tokio::time::timeout(Duration::from_secs(5), async {
        while actual.len() < payload.len() {
            match client.next().await.transpose()? {
                Some(Message::Binary(bytes)) => actual.extend_from_slice(&bytes),
                Some(Message::Ping(bytes)) => client.send(Message::Pong(bytes)).await?,
                _ => return Err(std::io::Error::other("stream closed early").into()),
            }
        }
        Ok::<(), codewide_relay::Error>(())
    })
    .await??;
    assert_eq!(actual, payload);
    Ok(())
}

async fn assert_closed(client: &mut Client) -> Result<()> {
    tokio::time::timeout(Duration::from_secs(10), async {
        loop {
            match client.next().await {
                None | Some(Err(_) | Ok(Message::Close(_))) => break,
                Some(Ok(Message::Ping(bytes))) => {
                    let _ = client.send(Message::Pong(bytes)).await;
                }
                _ => {}
            }
        }
    })
    .await?;
    Ok(())
}

#[tokio::test]
async fn normal_companion_paths_forward_opaque_device_and_pairing_bytes() -> Result<()> {
    let fixture = Fixture::start().await?;
    let mut first = fixture.client("e2ee-tunnel").await?;
    let mut second = fixture.client("e2ee-bootstrap-tunnel").await?;
    echoed(&mut first, &vec![0xa5; 50_000]).await?;
    echoed(&mut second, b"independent bootstrap stream").await?;
    Ok(())
}

#[tokio::test]
async fn pinned_public_routes_use_header_without_exposing_route_in_url() -> Result<()> {
    let fixture = Fixture::start().await?;
    let mut device = fixture
        .pinned_client(&fixture.route_id, "e2ee-tunnel")
        .await?;
    let mut pairing = fixture
        .pinned_client(&fixture.route_id, "e2ee-bootstrap-tunnel")
        .await?;
    echoed(&mut device, b"pinned device bytes").await?;
    echoed(&mut pairing, b"pinned pairing bytes").await?;
    assert!(
        fixture
            .pinned_client("unknown", "e2ee-tunnel")
            .await
            .is_err()
    );
    Ok(())
}

#[tokio::test]
async fn companion_disconnect_closes_old_stream_and_reconnect_recovers() -> Result<()> {
    let mut fixture = Fixture::start().await?;
    let mut old = fixture.client("e2ee-tunnel").await?;
    echoed(&mut old, b"before disconnect").await?;
    fixture.stop_latest_adapter()?;
    assert_closed(&mut old).await?;
    fixture.start_adapter();
    let mut fresh = fixture.client("e2ee-tunnel").await?;
    echoed(&mut fresh, b"after reconnect").await?;
    Ok(())
}

#[tokio::test]
async fn fresh_control_supersedes_a_half_open_connection() -> Result<()> {
    let mut fixture = Fixture::start().await?;
    let mut old = fixture.client("e2ee-tunnel").await?;
    echoed(&mut old, b"old connection").await?;
    fixture.start_adapter();
    assert_closed(&mut old).await?;
    let mut fresh = fixture.client("e2ee-tunnel").await?;
    echoed(&mut fresh, b"new connection").await?;
    Ok(())
}

#[tokio::test]
async fn relay_restart_recovers_with_the_same_token() -> Result<()> {
    let mut fixture = Fixture::start().await?;
    let mut old = fixture.client("e2ee-tunnel").await?;
    echoed(&mut old, b"before relay crash").await?;
    fixture.restart_relay().await?;
    assert_closed(&mut old).await?;
    let mut fresh = fixture.client("e2ee-tunnel").await?;
    echoed(&mut fresh, b"after relay restart").await?;
    Ok(())
}

#[tokio::test]
async fn wrong_companion_token_cannot_claim_the_companion_slot() -> Result<()> {
    let fixture = Fixture::start().await?;
    let public_address = format!("ws://{}/relay/control/{}", fixture.relay, fixture.route_id);
    assert!(connect_async(&public_address).await.is_err());
    let address = format!("wss://{}/relay/control/{}", fixture.relay, fixture.route_id);
    assert!(connect_async(&address).await.is_err());
    let mut request = address.into_client_request()?;
    request.headers_mut().insert(
        "authorization",
        HeaderValue::from_static("Bearer wrong-token-that-is-long-enough-000000"),
    );
    assert!(
        connect_companion(request, &fixture.relay_tls_pin_sha256)
            .await
            .is_err()
    );
    let mut client = fixture.client("e2ee-tunnel").await?;
    echoed(&mut client, b"authorized companion remains active").await?;
    Ok(())
}

#[tokio::test]
async fn health_pair_and_control_are_absent_from_the_plain_carrier() -> Result<()> {
    let fixture = Fixture::start().await?;
    let public = reqwest::Client::new();
    assert_eq!(
        public
            .get(format!("http://{}/healthz", fixture.relay))
            .send()
            .await?
            .status(),
        reqwest::StatusCode::NOT_FOUND
    );
    assert_eq!(
        public
            .post(format!(
                "http://{}/relay/pair/{}",
                fixture.relay, fixture.route_id
            ))
            .send()
            .await?
            .status(),
        reqwest::StatusCode::NOT_FOUND
    );
    let companion = pinned_http_client(&fixture.relay_tls_pin_sha256)?;
    assert_eq!(
        companion
            .get(format!("https://{}/healthz", fixture.relay))
            .send()
            .await?
            .status(),
        reqwest::StatusCode::NO_CONTENT
    );
    Ok(())
}

#[tokio::test]
async fn pairing_api_exchanges_tokens_once_and_replaces_the_old_session() -> Result<()> {
    let fixture = Fixture::start().await?;
    let invitation = fixture.registry.create_invitation(None)?;
    let wrong_identity = RelayTlsIdentity::load_or_create(tempfile::tempdir()?.path())?;
    let wrong_client = pinned_http_client(&wrong_identity.pin())?;
    let endpoint = format!(
        "https://{}/relay/pair/{}",
        fixture.relay, invitation.route_id
    );
    assert!(
        wrong_client
            .post(&endpoint)
            .json(&PairRequest {
                invitation: invitation.token.clone(),
            })
            .send()
            .await
            .is_err()
    );
    let client = pinned_http_client(&fixture.relay_tls_pin_sha256)?;
    let response = client
        .post(&endpoint)
        .json(&PairRequest {
            invitation: invitation.token.clone(),
        })
        .send()
        .await?
        .error_for_status()?
        .json::<PairResponse>()
        .await?;
    assert_eq!(response.generation, 1);
    assert_eq!(response.route_id, invitation.route_id);
    assert!(auth::validate(&response.access_token).is_ok());
    assert!(
        fixture
            .registry
            .authorize(&response.route_id, &response.access_token)
            .is_ok()
    );
    assert!(
        client
            .post(endpoint)
            .json(&PairRequest {
                invitation: invitation.token,
            })
            .send()
            .await?
            .status()
            .is_client_error()
    );
    Ok(())
}

#[tokio::test]
async fn routes_isolate_companions_credentials_and_revocation() -> Result<()> {
    let mut fixture = Fixture::start().await?;
    let invitation = fixture.registry.create_invitation(None)?;
    let paired = fixture
        .registry
        .pair(&invitation.route_id, &invitation.token)?;
    let second = Adapter {
        companion_url: fixture.adapter.companion_url.clone(),
        relay_tls_pin_sha256: fixture.adapter.relay_tls_pin_sha256.clone(),
        route_id: Arc::from(paired.route_id.clone()),
        access_token: Arc::from(paired.access_token.clone()),
        device_target: fixture.adapter.device_target,
        pairing_target: fixture.adapter.pairing_target,
    };
    let second_stop = CancellationToken::new();
    fixture.adapter_stops.push(second_stop.clone());
    fixture.tasks.spawn(async move {
        let _ = second.run(second_stop).await;
    });

    let mut first_stream = fixture.client("e2ee-tunnel").await?;
    let mut second_stream = fixture
        .client_route(&paired.route_id, "e2ee-tunnel")
        .await?;
    echoed(&mut first_stream, b"first route").await?;
    echoed(&mut second_stream, b"second route").await?;

    let mut cross_route = format!("wss://{}/relay/control/{}", fixture.relay, fixture.route_id)
        .into_client_request()?;
    cross_route.headers_mut().insert(
        "authorization",
        HeaderValue::from_str(&format!("Bearer {}", paired.access_token))?,
    );
    assert!(
        connect_companion(cross_route, &fixture.relay_tls_pin_sha256)
            .await
            .is_err()
    );

    assert!(fixture.registry.revoke(&fixture.route_id)?);
    assert_closed(&mut first_stream).await?;
    echoed(&mut second_stream, b"second survives first revoke").await?;
    Ok(())
}

#[tokio::test]
async fn oversized_phone_frame_isolated_from_other_streams() -> Result<()> {
    let fixture = Fixture::start().await?;
    let mut bad = fixture.client("e2ee-tunnel").await?;
    let mut good = fixture.client("e2ee-tunnel").await?;
    let _ = bad.send(Message::Binary(vec![0; 65_537].into())).await;
    assert_closed(&mut bad).await?;
    echoed(&mut good, b"healthy stream remains isolated").await?;
    Ok(())
}

#[tokio::test]
async fn slow_consumer_capacity_is_bounded_and_recovers() -> Result<()> {
    let fixture = Fixture::start().await?;
    let opened = tokio::time::timeout(
        Duration::from_secs(45),
        join_all((0..64).map(|_| fixture.client("e2ee-tunnel"))),
    )
    .await?;
    let clients = opened.into_iter().collect::<Result<Vec<_>>>()?;
    let overflow = connect_async(format!(
        "ws://{}/c/{}/v1/e2ee-tunnel",
        fixture.relay, fixture.route_id
    ))
    .await;
    assert!(overflow.is_err(), "the 65th stream must fail closed");
    drop(clients);
    let mut recovered = fixture.client("e2ee-tunnel").await?;
    echoed(&mut recovered, b"capacity released").await?;
    Ok(())
}

#[tokio::test]
async fn existing_inner_tls_remains_end_to_end_through_the_relay() -> Result<()> {
    let mut fixture = Fixture::start().await?;
    fixture.stop_latest_adapter()?;
    let server = TestIdentity::generate()?;
    let client = TestIdentity::generate()?;
    let acceptor = TlsAcceptor::from(server.server(&client.certificate)?);
    let target = TcpListener::bind("127.0.0.1:0").await?;
    fixture.adapter.device_target = target.local_addr()?;
    fixture.tasks.spawn(async move {
        while let Ok((socket, _)) = target.accept().await {
            let acceptor = acceptor.clone();
            tokio::spawn(async move {
                if let Ok(stream) = acceptor.accept(socket).await {
                    let (mut read, mut write) = tokio::io::split(stream);
                    let _ = tokio::io::copy(&mut read, &mut write).await;
                }
            });
        }
    });
    fixture.start_adapter();
    let tls = client.client(&server.certificate)?;
    let mut stream = inner_stream(&fixture, tls).await?;
    stream.write_all(b"private application payload").await?;
    let mut response = [0; 27];
    stream.read_exact(&mut response).await?;
    assert_eq!(&response, b"private application payload");
    let stranger = TestIdentity::generate()?;
    assert!(
        inner_stream(&fixture, client.client(&stranger.certificate)?)
            .await
            .is_err()
    );
    Ok(())
}

struct TestIdentity {
    certificate: Vec<u8>,
    key: Vec<u8>,
}

impl TestIdentity {
    fn generate() -> Result<Self> {
        let generated = rcgen::generate_simple_self_signed(vec!["companion.test".to_owned()])?;
        Ok(Self {
            certificate: generated.cert.der().to_vec(),
            key: generated.signing_key.serialize_der(),
        })
    }

    fn server(&self, client_certificate: &[u8]) -> Result<Arc<rustls::ServerConfig>> {
        let mut roots = rustls::RootCertStore::empty();
        roots.add(rustls::pki_types::CertificateDer::from(
            client_certificate.to_vec(),
        ))?;
        let verifier = rustls::server::WebPkiClientVerifier::builder(Arc::new(roots)).build()?;
        let config = rustls::ServerConfig::builder_with_provider(Arc::new(
            rustls::crypto::ring::default_provider(),
        ))
        .with_protocol_versions(&[&rustls::version::TLS13])?
        .with_client_cert_verifier(verifier)
        .with_single_cert(
            vec![rustls::pki_types::CertificateDer::from(
                self.certificate.clone(),
            )],
            rustls::pki_types::PrivateKeyDer::try_from(self.key.clone())
                .map_err(std::io::Error::other)?,
        )?;
        Ok(Arc::new(config))
    }

    fn client(&self, server_certificate: &[u8]) -> Result<Arc<rustls::ClientConfig>> {
        let mut roots = rustls::RootCertStore::empty();
        roots.add(rustls::pki_types::CertificateDer::from(
            server_certificate.to_vec(),
        ))?;
        let config = rustls::ClientConfig::builder_with_provider(Arc::new(
            rustls::crypto::ring::default_provider(),
        ))
        .with_protocol_versions(&[&rustls::version::TLS13])?
        .with_root_certificates(roots)
        .with_client_auth_cert(
            vec![rustls::pki_types::CertificateDer::from(
                self.certificate.clone(),
            )],
            rustls::pki_types::PrivateKeyDer::try_from(self.key.clone())
                .map_err(std::io::Error::other)?,
        )?;
        Ok(Arc::new(config))
    }
}

async fn inner_stream(
    fixture: &Fixture,
    tls: Arc<rustls::ClientConfig>,
) -> Result<tokio_rustls::client::TlsStream<tokio::io::DuplexStream>> {
    let client = fixture.client("e2ee-tunnel").await?;
    let (left, right) = tokio::io::duplex(64 * 1024);
    tokio::spawn(async move {
        let (mut ws_write, mut ws_read) = client.split();
        let (mut read, mut write) = tokio::io::split(right);
        let outbound = async {
            let mut bytes = [0; 16 * 1024];
            loop {
                let size = read.read(&mut bytes).await?;
                if size == 0 {
                    break;
                }
                ws_write
                    .send(Message::Binary(bytes[..size].to_vec().into()))
                    .await?;
            }
            Ok::<(), codewide_relay::Error>(())
        };
        let incoming = async {
            while let Some(message) = ws_read.next().await {
                if let Message::Binary(bytes) = message? {
                    write.write_all(&bytes).await?;
                }
            }
            Ok::<(), codewide_relay::Error>(())
        };
        tokio::select! { _ = outbound => {}, _ = incoming => {} }
    });
    Ok(tokio::time::timeout(
        Duration::from_secs(5),
        TlsConnector::from(tls).connect(
            rustls::pki_types::ServerName::try_from("companion.test")?,
            left,
        ),
    )
    .await??)
}
