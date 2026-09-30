use codewide_relay::{
    Result,
    adapter::Adapter,
    admin::{ControlServer, Reply, Request, SOCKET, read_frame, write_frame},
    enrollment::{Enrollment, Phase},
    enrollment_client::EnrollmentClient,
    registry::Registry,
    server::{Relay, serve},
    transport_tls::RelayTlsIdentity,
};
use futures_util::{SinkExt, StreamExt};
use std::{sync::Arc, time::Duration};
use tokio::{
    net::{TcpListener, UnixStream},
    task::JoinSet,
};
use tokio_util::sync::CancellationToken;

struct Fixture {
    state: tempfile::TempDir,
    registry: Registry,
    enrollment: Enrollment,
    address: String,
    pin: String,
    stop: CancellationToken,
    tasks: JoinSet<()>,
}

impl Drop for Fixture {
    fn drop(&mut self) {
        self.stop.cancel();
    }
}

impl Fixture {
    async fn start() -> Result<Self> {
        let state = tempfile::tempdir()?;
        let registry = Registry::open(state.path())?;
        let identity = RelayTlsIdentity::load_or_create(state.path())?;
        let relay = Relay::new(registry.clone());
        let enrollment = relay.enrollment();
        let listener = TcpListener::bind("127.0.0.1:0").await?;
        let address = listener.local_addr()?;
        let stop = CancellationToken::new();
        let control = ControlServer::bind(
            state.path(),
            registry.clone(),
            relay.clone(),
            address.port(),
            identity.pin(),
            false,
        )?;
        let mut tasks = JoinSet::new();
        let worker_stop = stop.clone();
        let tls = identity.server_config()?;
        tasks.spawn(async move {
            let _ = serve(relay, listener, tls, worker_stop).await;
        });
        let worker_stop = stop.clone();
        tasks.spawn(async move {
            let _ = control.run(worker_stop).await;
        });
        Ok(Self {
            state,
            registry,
            enrollment,
            address: address.to_string(),
            pin: identity.pin(),
            stop,
            tasks,
        })
    }

    async fn control(&self) -> Result<UnixStream> {
        Ok(UnixStream::connect(self.state.path().join(SOCKET)).await?)
    }

    async fn open(&self) -> Result<UnixStream> {
        let mut control = self.control().await?;
        write_frame(&mut control, &Request::Pair).await?;
        assert!(matches!(
            read_frame::<Reply>(&mut control).await?,
            Reply::Pairing {
                phase: Phase::Waiting,
                remaining_seconds: 60
            }
        ));
        Ok(control)
    }

    async fn approve(&self, control: &mut UnixStream, client: &EnrollmentClient) -> Result<()> {
        let Reply::Pairing {
            phase:
                Phase::Confirm {
                    candidate,
                    code,
                    label,
                },
            ..
        } = read_frame(control).await?
        else {
            return Err("Missing confirmation".into());
        };
        assert_eq!(code, client.code);
        assert_eq!(label, "Test MacBook");
        assert_eq!(client.pin, self.pin);
        assert!(self.registry.routes()?.is_empty());
        write_frame(control, &Request::Approve { candidate }).await?;
        Ok(())
    }
}

#[tokio::test]
async fn terminal_approval_pins_tls_stores_label_and_waits_for_live_adapter() -> Result<()> {
    let mut fixture = Fixture::start().await?;
    assert!(
        EnrollmentClient::connect(&fixture.address, "Test MacBook")
            .await
            .is_err()
    );
    let mut control = fixture.open().await?;
    let mut client = EnrollmentClient::connect(&fixture.address, "Test MacBook").await?;
    fixture.approve(&mut control, &client).await?;
    let credentials = client.credentials().await?;
    let route_id = credentials.route_id.clone();
    let target = "127.0.0.1:9".parse()?;
    let adapter = Adapter {
        companion_url: Arc::from(format!("wss://{}", fixture.address)),
        relay_tls_pin_sha256: Arc::from(client.pin.clone()),
        route_id: Arc::from(credentials.route_id),
        access_token: Arc::from(credentials.access_token),
        device_target: target,
        pairing_target: target,
    };
    let stop = fixture.stop.clone();
    fixture.tasks.spawn(async move {
        let _ = adapter.run(stop).await;
    });
    tokio::time::timeout(Duration::from_secs(5), client.complete()).await??;
    let mut connected = false;
    for _ in 0..4 {
        match read_frame::<Reply>(&mut control).await? {
            Reply::Pairing {
                phase:
                    Phase::Connected {
                        label,
                        route_id: actual,
                    },
                ..
            } => {
                assert_eq!(label, "Test MacBook");
                assert_eq!(actual, route_id);
                connected = true;
                break;
            }
            Reply::Pairing { .. } => {}
            _ => return Err("Unexpected admin response".into()),
        }
    }
    assert!(connected);
    drop(control);
    assert!(fixture.enrollment.current().is_none());
    let summaries = fixture.registry.summaries()?;
    assert_eq!(summaries.len(), 1);
    assert_eq!(summaries[0].label.as_deref(), Some("Test MacBook"));
    assert!(
        EnrollmentClient::connect(&fixture.address, "Another MacBook")
            .await
            .is_err()
    );
    Ok(())
}

#[tokio::test]
async fn owner_disconnect_revokes_provisional_credentials() -> Result<()> {
    let fixture = Fixture::start().await?;
    let mut control = fixture.open().await?;
    let mut client = EnrollmentClient::connect(&fixture.address, "Test MacBook").await?;
    fixture.approve(&mut control, &client).await?;
    let credentials = client.credentials().await?;
    assert!(
        fixture
            .registry
            .authorize(&credentials.route_id, &credentials.access_token)
            .is_ok()
    );
    drop(control);
    assert!(
        tokio::time::timeout(Duration::from_secs(2), client.complete())
            .await?
            .is_err()
    );
    assert!(
        fixture
            .registry
            .authorize(&credentials.route_id, &credentials.access_token)
            .is_err()
    );
    assert!(fixture.enrollment.current().is_none());
    Ok(())
}

#[tokio::test]
async fn second_candidate_cannot_replace_the_displayed_code() -> Result<()> {
    let fixture = Fixture::start().await?;
    let mut control = fixture.open().await?;
    let client = EnrollmentClient::connect(&fixture.address, "Test MacBook").await?;
    assert!(
        EnrollmentClient::connect(&fixture.address, "Intruder")
            .await
            .is_err()
    );
    fixture.approve(&mut control, &client).await?;
    assert!(fixture.enrollment.current().is_some());
    Ok(())
}

#[tokio::test]
async fn explicit_cancellation_and_unsafe_labels_never_create_routes() -> Result<()> {
    let fixture = Fixture::start().await?;
    let mut control = fixture.open().await?;
    for name in ["\u{1b}[2J", "a\nb", "\u{202e}spoof", ""] {
        assert!(
            EnrollmentClient::connect(&fixture.address, name)
                .await
                .is_err()
        );
    }
    write_frame(&mut control, &Request::Cancel).await?;
    assert!(matches!(
        read_frame::<Reply>(&mut control).await?,
        Reply::Pairing {
            phase: Phase::Cancelled,
            ..
        }
    ));
    assert!(fixture.enrollment.current().is_none());
    assert!(fixture.registry.routes()?.is_empty());
    Ok(())
}

#[tokio::test]
async fn control_socket_renames_and_revokes_a_saved_computer() -> Result<()> {
    let fixture = Fixture::start().await?;
    let paired = fixture.registry.register("Old name")?;
    let mut control = fixture.control().await?;
    write_frame(
        &mut control,
        &Request::Rename {
            route: paired.route_id.clone(),
            label: "New name".into(),
        },
    )
    .await?;
    assert!(matches!(
        read_frame::<Reply>(&mut control).await?,
        Reply::Renamed { updated: true }
    ));
    assert_eq!(
        fixture.registry.summaries()?[0].label.as_deref(),
        Some("New name")
    );

    let mut control = fixture.control().await?;
    write_frame(
        &mut control,
        &Request::Revoke {
            route: paired.route_id,
        },
    )
    .await?;
    assert!(matches!(
        read_frame::<Reply>(&mut control).await?,
        Reply::Revoked { removed: true }
    ));
    assert!(fixture.registry.routes()?.is_empty());
    Ok(())
}

#[tokio::test]
async fn idle_window_expires_after_one_real_minute() -> Result<()> {
    let fixture = Fixture::start().await?;
    let started = tokio::time::Instant::now();
    let mut control = fixture.open().await?;
    let reply =
        tokio::time::timeout(Duration::from_secs(63), read_frame::<Reply>(&mut control)).await??;
    assert!(matches!(
        reply,
        Reply::Pairing {
            phase: Phase::Expired,
            ..
        }
    ));
    assert!(started.elapsed() >= Duration::from_secs(59));
    assert!(fixture.enrollment.current().is_none());
    assert!(fixture.registry.routes()?.is_empty());
    Ok(())
}

#[tokio::test]
async fn invalid_nonce_reveal_closes_window_without_displaying_symbols_or_issuing_keys()
-> Result<()> {
    use codewide_relay::enrollment::{ClientMessage, ServerMessage, WIRE_VERSION};
    use tokio_tungstenite::tungstenite::Message;
    let fixture = Fixture::start().await?;
    let mut control = fixture.open().await?;
    let tcp = tokio::net::TcpStream::connect(&fixture.address).await?;
    let tls = tokio_rustls::TlsConnector::from(
        codewide_relay::transport_tls::pinned_client_config(&fixture.pin)?,
    )
    .connect(rustls::pki_types::ServerName::try_from("localhost")?, tcp)
    .await?;
    let (mut socket, _) =
        tokio_tungstenite::client_async(format!("wss://{}/relay/enroll", fixture.address), tls)
            .await?;
    socket
        .send(Message::Text(
            serde_json::to_string(&ClientMessage::Hello {
                version: WIRE_VERSION,
                label: "Untrusted candidate".into(),
                commitment: "00".repeat(32),
            })?
            .into(),
        ))
        .await?;
    let Some(Ok(Message::Text(challenge))) = socket.next().await else {
        return Err("Missing nonce challenge".into());
    };
    assert!(matches!(
        serde_json::from_str::<ServerMessage>(&challenge)?,
        ServerMessage::Challenge { .. }
    ));
    socket
        .send(Message::Text(
            serde_json::to_string(&ClientMessage::Reveal {
                nonce: "11".repeat(32),
            })?
            .into(),
        ))
        .await?;
    assert!(matches!(
        tokio::time::timeout(Duration::from_secs(2), read_frame::<Reply>(&mut control)).await??,
        Reply::Pairing {
            phase: Phase::Cancelled,
            ..
        }
    ));
    assert!(fixture.registry.routes()?.is_empty());
    assert!(fixture.enrollment.current().is_none());
    Ok(())
}
