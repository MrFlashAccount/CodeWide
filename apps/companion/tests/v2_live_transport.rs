#![cfg(unix)]
#![allow(clippy::unwrap_used, clippy::too_many_lines)]

use std::{
    error::Error,
    sync::{
        Arc,
        atomic::{AtomicU64, Ordering},
    },
    time::Duration,
};

use async_trait::async_trait;
use base64::{Engine as _, engine::general_purpose};
use codewide_companion::{
    auth::{
        AuthorizationContext, DeviceRegistry, PairingClaim, SessionProof, pairing_claim_message,
    },
    catalog::SessionCatalog,
    dictation::DictationService,
    history_service::HistoryService,
    server::{self, CompanionServices},
    store::{IndexStore, IndexedThreadMetadata},
    sync::SyncHub,
    sync_v2::{
        AuthenticatedContextKey, CommandExecution, SemanticSource, SnapshotData,
        SubscriptionCoordinator, SyncV2Mode, SyncV2Runtime,
        domain::{CatalogPartitionScope, CatalogScope},
        protocol::{CatalogSnapshot, Command, OpenIntent, Query, QueryResult, V2Error},
        scalar::{Id, OperationId},
    },
    upstream::UpstreamHandle,
};
use futures_util::{SinkExt, StreamExt};
use http::{HeaderValue, header::AUTHORIZATION};
use p256::{
    ecdsa::{Signature, SigningKey, signature::Signer},
    pkcs8::EncodePublicKey,
};
use serde_json::{Value, json};
use tokio::{net::TcpListener, sync::watch, time::timeout};
use tokio_tungstenite::{
    MaybeTlsStream, WebSocketStream, connect_async,
    tungstenite::{Message, client::IntoClientRequest},
};

const TOKEN: &str = "v2-live-transport-token-long-enough";
const THREAD_ID: &str = "01a03e19-ee87-7a33-adcb-a93b9e5b0768";

struct ReadySource {
    coordinator: SubscriptionCoordinator,
    generation: AtomicU64,
    _generation_tx: watch::Sender<u64>,
    generation_rx: watch::Receiver<u64>,
}

impl ReadySource {
    fn new() -> Arc<Self> {
        let (generation_tx, generation_rx) = watch::channel(1);
        Arc::new(Self {
            coordinator: SubscriptionCoordinator::default(),
            generation: AtomicU64::new(1),
            _generation_tx: generation_tx,
            generation_rx,
        })
    }
}

#[async_trait]
impl SemanticSource for ReadySource {
    fn generation(&self) -> u64 {
        self.generation.load(Ordering::SeqCst)
    }
    fn subscribe_generation(&self) -> watch::Receiver<u64> {
        self.generation_rx.clone()
    }
    fn coordinator(&self) -> &SubscriptionCoordinator {
        &self.coordinator
    }
    async fn purge_context(&self, context: &AuthenticatedContextKey) -> Result<(), V2Error> {
        self.coordinator.invalidate_context(context);
        Ok(())
    }
    async fn install_intent(
        &self,
        _recipient_id: &Id,
        _intent: &OpenIntent,
        _authorization: &AuthorizationContext,
        _context: &AuthenticatedContextKey,
        _generation: u64,
    ) -> Result<(), V2Error> {
        Ok(())
    }
    async fn remove_intent(&self, recipient_id: &Id) {
        self.coordinator.remove(recipient_id);
    }
    async fn snapshot(
        &self,
        intent: &OpenIntent,
        _authorization: &AuthorizationContext,
        _context: &AuthenticatedContextKey,
        generation: u64,
    ) -> Result<SnapshotData, V2Error> {
        Ok(SnapshotData {
            scope: CatalogScope {
                active: CatalogPartitionScope {
                    limit: intent.catalog.active_limit,
                    returned: 0,
                    complete: true,
                },
                archived: CatalogPartitionScope {
                    limit: intent.catalog.archived_limit,
                    returned: 0,
                    complete: true,
                },
            },
            catalog: CatalogSnapshot {
                active: Vec::new(),
                archived: Vec::new(),
            },
            current_thread: None,
            pending_requests: Vec::new(),
            source_witness: format!("ready-{generation}"),
        })
    }
    async fn query(
        &self,
        _query: Query,
        _authorization: &AuthorizationContext,
        _context: &AuthenticatedContextKey,
        _generation: u64,
    ) -> Result<QueryResult, V2Error> {
        Err(V2Error::invalid_request("unused test query"))
    }
    async fn authorize_command(
        &self,
        _command: &Command,
        _authorization: &AuthorizationContext,
        _context: &AuthenticatedContextKey,
        _generation: u64,
    ) -> Result<(), V2Error> {
        Err(V2Error::forbidden("unused test command"))
    }
    async fn execute(
        &self,
        _operation_id: &OperationId,
        _command: Command,
        _authorization: &AuthorizationContext,
        _context: &AuthenticatedContextKey,
        _generation: u64,
    ) -> CommandExecution {
        CommandExecution::Failed(V2Error::invalid_request("unused test command"))
    }
}

type Socket = WebSocketStream<MaybeTlsStream<tokio::net::TcpStream>>;

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn authenticated_resources_are_transport_independent_and_device_revocation_closes_streams()
-> Result<(), Box<dyn Error>> {
    let directory = tempfile::tempdir()?;
    let store = Arc::new(IndexStore::open(directory.path().join("state.redb"))?);
    let cwd = directory.path().join("workspace");
    std::fs::create_dir(&cwd)?;
    store.put_thread_metadata(&IndexedThreadMetadata {
        id: THREAD_ID.into(),
        parent_thread_id: None,
        cwd: cwd.canonicalize()?.to_string_lossy().into_owned(),
        created_at: 1,
        updated_at: 1,
        model_provider: "openai".into(),
        cli_version: "test".into(),
        source: json!("test"),
        agent_nickname: None,
        agent_role: None,
        archived: false,
    })?;
    let catalog = Arc::new(SessionCatalog::scan(directory.path()));
    let history = HistoryService::new(catalog, store.clone());
    let dictation = Arc::new(
        DictationService::open(
            directory.path().join("absent-auth.json"),
            directory.path().join("dictation"),
        )
        .await?,
    );
    let sync = SyncHub::with_mutations(
        UpstreamHandle::spawn(directory.path().join("absent-v1.sock")),
        store.clone(),
        history,
    )
    .with_dictation(dictation);
    let runtime = SyncV2Runtime::new(
        ReadySource::new(),
        directory.path().join("v2-operations.redb"),
        "test-pin",
    )?;
    let registry = Arc::new(
        DeviceRegistry::open(
            Arc::from(TOKEN),
            directory.path().join("devices.json"),
            None,
        )
        .await?,
    );
    let (session_token, device_id) = paired_session(&registry).await?;
    let listener = TcpListener::bind("127.0.0.1:0").await?;
    let address = listener.local_addr()?;
    let app = server::router_with_registry_and_services(
        store,
        registry.clone(),
        sync,
        CompanionServices {
            sync_v2: Some(runtime),
            sync_v2_mode: SyncV2Mode::Canary,
            ..CompanionServices::default()
        },
    );
    let server_task = tokio::spawn(async move {
        let _ = axum::serve(listener, app).await;
    });

    // Auxiliary resources are authorized by the paired device session. They do
    // not require a Sync WebSocket to exist first.
    let ports = reqwest::Client::new()
        .get(format!("http://{address}/v2/ports"))
        .bearer_auth(&session_token)
        .send()
        .await?;
    assert_eq!(ports.status(), reqwest::StatusCode::OK);

    let mut terminal = connect(&format!("ws://{address}/v2/terminals"), &session_token).await?;
    send(&mut terminal, json!({"type":"open","version":2,"sessionId":"terminal-12345678-1234-1234-1234-123456789abc","threadId":THREAD_ID,"generation":"1","cwd":null,"cols":120,"rows":40,"offset":"0","create":true})).await?;
    let opened = receive(&mut terminal).await?;
    assert_eq!(
        opened["type"], "opened",
        "terminal failed to open: {opened}"
    );
    send(&mut terminal, json!({"type":"input","data":general_purpose::STANDARD.encode(b"printf v2-terminal-live\\n")})).await?;
    let output = receive_until(&mut terminal, "output").await?;
    let decoded = general_purpose::STANDARD
        .decode(output["data"].as_str().ok_or("missing terminal data")?)?;
    assert!(String::from_utf8_lossy(&decoded).contains("v2-terminal-live"));
    terminal.close(None).await?;

    let mut terminal = connect(&format!("ws://{address}/v2/terminals"), &session_token).await?;
    send(&mut terminal, json!({"type":"open","version":2,"sessionId":"terminal-12345678-1234-1234-1234-123456789abc","threadId":THREAD_ID,"generation":"1","cwd":null,"cols":120,"rows":40,"offset":"0","create":false})).await?;
    assert_eq!(receive(&mut terminal).await?["type"], "opened");
    let replay = receive_until(&mut terminal, "output").await?;
    assert_eq!(replay["offset"], "0");

    let mut terminal_loss_seed =
        connect(&format!("ws://{address}/v2/terminals"), &session_token).await?;
    send(&mut terminal_loss_seed, json!({"type":"open","version":2,"sessionId":"terminal-32345678-1234-1234-1234-123456789abc","threadId":THREAD_ID,"generation":"1","cwd":null,"cols":120,"rows":40,"offset":"0","create":true})).await?;
    assert_eq!(receive(&mut terminal_loss_seed).await?["type"], "opened");
    send(&mut terminal_loss_seed, json!({"type":"input","data":general_purpose::STANDARD.encode(b"printf v2-terminal-replay-loss\n")})).await?;
    assert_eq!(
        receive_until(&mut terminal_loss_seed, "output").await?["type"],
        "output"
    );
    terminal_loss_seed.close(None).await?;

    let mut terminal_loss_probe =
        connect(&format!("ws://{address}/v2/terminals"), &session_token).await?;
    send(&mut terminal_loss_probe, json!({"type":"open","version":2,"sessionId":"terminal-32345678-1234-1234-1234-123456789abc","threadId":THREAD_ID,"generation":"1","cwd":null,"cols":120,"rows":40,"offset":"999999999","create":false})).await?;
    let replay_loss = receive(&mut terminal_loss_probe).await?;
    assert_eq!(replay_loss["type"], "error");
    assert_eq!(replay_loss["error"]["code"], "replayUnavailable");

    let mut terminal_bounds =
        connect(&format!("ws://{address}/v2/terminals"), &session_token).await?;
    send(&mut terminal_bounds, json!({"type":"open","version":2,"sessionId":"terminal-22345678-1234-1234-1234-123456789abc","threadId":THREAD_ID,"generation":"1","cwd":null,"cols":120,"rows":40,"offset":"0","create":true})).await?;
    assert_eq!(receive(&mut terminal_bounds).await?["type"], "opened");
    send(
        &mut terminal_bounds,
        json!({"type":"input","data":"x".repeat(1_398_105)}),
    )
    .await?;
    assert_eq!(
        receive_until(&mut terminal_bounds, "error").await?["error"]["code"],
        "invalidRequest"
    );

    let mut voice = connect(&format!("ws://{address}/v2/voice"), &session_token).await?;
    send(&mut voice, voice_start()).await?;
    let started = receive(&mut voice).await?;
    assert_eq!(started["type"], "started");
    let voice_id = started["sessionId"]
        .as_str()
        .ok_or("missing voice session")?
        .to_owned();
    send(&mut voice, json!({"type":"batch","sessionId":voice_id,"sequence":"0","sampleRate":48000,"numChannels":1,"samplesPerChannel":1,"data":"AAA="})).await?;
    assert_eq!(receive(&mut voice).await?["type"], "ack");
    send(&mut voice, json!({"type":"batch","sessionId":voice_id,"sequence":"0","sampleRate":48000,"numChannels":1,"samplesPerChannel":1,"data":"AAA="})).await?;
    assert_eq!(receive(&mut voice).await?["type"], "ack");
    send(&mut voice, json!({"type":"finish","sessionId":voice_id})).await?;
    assert_eq!(receive(&mut voice).await?["type"], "retry");
    send(&mut voice, json!({"type":"cancel","sessionId":voice_id})).await?;
    assert_eq!(receive(&mut voice).await?["type"], "cancelled");
    send(&mut voice, voice_start()).await?;
    let retry_started = receive(&mut voice).await?;
    let retry_id = retry_started["sessionId"]
        .as_str()
        .ok_or("missing retry session")?;
    send(&mut voice, json!({"type":"batch","sessionId":retry_id,"sequence":"0","sampleRate":48000,"numChannels":1,"samplesPerChannel":1,"data":"AAA="})).await?;
    assert_eq!(receive(&mut voice).await?["type"], "ack");
    send(&mut voice, json!({"type":"batch","sessionId":retry_id,"sequence":"0","sampleRate":48000,"numChannels":1,"samplesPerChannel":1,"data":"AQA="})).await?;
    assert_eq!(
        receive_until(&mut voice, "error").await?["error"]["code"],
        "conflict"
    );

    let mut voice_bounds = connect(&format!("ws://{address}/v2/voice"), &session_token).await?;
    send(&mut voice_bounds, voice_start()).await?;
    let bounds_started = receive(&mut voice_bounds).await?;
    let bounds_id = bounds_started["sessionId"]
        .as_str()
        .ok_or("missing bounds session")?;
    send(&mut voice_bounds, json!({"type":"batch","sessionId":bounds_id,"sequence":"0","sampleRate":48000,"numChannels":1,"samplesPerChannel":1,"data":"x".repeat(1_398_105)})).await?;
    assert_eq!(
        receive_until(&mut voice_bounds, "error").await?["error"]["code"],
        "invalidRequest"
    );

    let mut voice = connect(&format!("ws://{address}/v2/voice"), &session_token).await?;
    send(&mut voice, voice_start()).await?;
    let active_voice = receive(&mut voice).await?;
    assert_eq!(active_voice["type"], "started");
    let active_voice_id = active_voice["sessionId"]
        .as_str()
        .ok_or("missing active voice session")?
        .to_owned();

    // Two Live Sync epochs for the same device are valid. Opening the second
    // transport must not supersede or revoke the first transport or resources.
    let mut sync_socket = connect(&format!("ws://{address}/v2/sync"), &session_token).await?;
    send(&mut sync_socket, json!({"type":"open","version":2,"intent":{"catalog":{"activeLimit":1,"archivedLimit":1},"currentThread":{"threadId":THREAD_ID,"turnLimit":1},"pendingRequests":"currentThread"}})).await?;
    let snapshot = receive(&mut sync_socket).await?;
    send(&mut sync_socket, json!({"type":"snapshotCommitted","epochId":snapshot["epochId"],"revision":snapshot["revision"],"watermark":snapshot["watermark"]})).await?;
    assert_eq!(receive(&mut sync_socket).await?["type"], "live");

    let mut replacement = connect(&format!("ws://{address}/v2/sync"), &session_token).await?;
    send(&mut replacement, json!({"type":"open","version":2,"intent":{"catalog":{"activeLimit":1,"archivedLimit":1},"currentThread":{"threadId":THREAD_ID,"turnLimit":1},"pendingRequests":"currentThread"}})).await?;
    let replacement_snapshot = receive(&mut replacement).await?;
    send(&mut replacement, json!({"type":"snapshotCommitted","epochId":replacement_snapshot["epochId"],"revision":replacement_snapshot["revision"],"watermark":replacement_snapshot["watermark"]})).await?;
    assert_eq!(receive(&mut replacement).await?["type"], "live");

    send(
        &mut sync_socket,
        json!({"type":"query","requestId":"first-still-live","query":{"kind":"capabilities.read"}}),
    )
    .await?;
    assert_eq!(receive(&mut sync_socket).await?["type"], "queryFailed");
    send(
        &mut replacement,
        json!({"type":"query","requestId":"second-still-live","query":{"kind":"capabilities.read"}}),
    )
    .await?;
    assert_eq!(receive(&mut replacement).await?["type"], "queryFailed");

    send(&mut terminal, json!({"type":"input","data":general_purpose::STANDARD.encode(b"printf transport-independent\n")})).await?;
    assert_eq!(
        receive_until(&mut terminal, "output").await?["type"],
        "output"
    );
    send(&mut voice, json!({"type":"batch","sessionId":active_voice_id,"sequence":"0","sampleRate":48000,"numChannels":1,"samplesPerChannel":1,"data":"AAA="})).await?;
    assert_eq!(receive(&mut voice).await?["type"], "ack");

    assert!(registry.revoke(&device_id).await?);

    let terminal_loss = receive_until(&mut terminal, "error").await?;
    assert_eq!(terminal_loss["error"]["code"], "forbidden");
    let voice_loss = receive_until(&mut voice, "error").await?;
    assert_eq!(voice_loss["error"]["code"], "forbidden");
    let revoked_ports = reqwest::Client::new()
        .get(format!("http://{address}/v2/ports"))
        .bearer_auth(&session_token)
        .send()
        .await?;
    assert_eq!(revoked_ports.status(), reqwest::StatusCode::UNAUTHORIZED);
    server_task.abort();
    Ok(())
}

fn voice_start() -> Value {
    json!({"type":"start","version":2,"generation":"1","inputScope":{"kind":"generic","id":"composer"},"threadId":null,"language":null})
}

async fn connect(url: &str, token: &str) -> Result<Socket, Box<dyn Error>> {
    let mut request = url.into_client_request()?;
    request.headers_mut().insert(
        AUTHORIZATION,
        HeaderValue::from_str(&format!("Bearer {token}"))?,
    );
    Ok(connect_async(request).await?.0)
}

async fn send(socket: &mut Socket, value: Value) -> Result<(), Box<dyn Error>> {
    socket.send(Message::Text(value.to_string().into())).await?;
    Ok(())
}

async fn receive(socket: &mut Socket) -> Result<Value, Box<dyn Error>> {
    let message = timeout(Duration::from_secs(5), socket.next())
        .await?
        .ok_or("websocket closed")??;
    match message {
        Message::Text(text) => Ok(serde_json::from_str(&text)?),
        other => Err(format!("expected text, got {other:?}").into()),
    }
}

async fn receive_until(socket: &mut Socket, expected: &str) -> Result<Value, Box<dyn Error>> {
    loop {
        let value = receive(socket).await?;
        if value["type"] == expected {
            return Ok(value);
        }
    }
}

async fn paired_session(registry: &DeviceRegistry) -> Result<(String, String), Box<dyn Error>> {
    let signing = SigningKey::from_bytes((&[13_u8; 32]).into())?;
    let public_key_spki =
        general_purpose::STANDARD.encode(signing.verifying_key().to_public_key_der()?.as_bytes());
    let pairing = registry.create_pairing().await?;
    let proof: Signature = signing.sign(&pairing_claim_message(
        &pairing.pairing_token,
        "Android V2 Live",
        &public_key_spki,
    ));
    let claim = registry
        .claim(PairingClaim {
            pairing_token: pairing.pairing_token,
            device_name: "Android V2 Live".into(),
            public_key_spki,
            proof: general_purpose::STANDARD.encode(proof.to_der().as_bytes()),
        })
        .await?;
    let bearer = format!("Bearer {}", claim.capability_token);
    let challenge = registry.challenge(Some(&bearer)).await?;
    let signature: Signature =
        signing.sign(&general_purpose::URL_SAFE_NO_PAD.decode(&challenge.challenge)?);
    let session = registry
        .create_session(
            Some(&bearer),
            SessionProof {
                challenge_id: challenge.challenge_id,
                signature: general_purpose::STANDARD.encode(signature.to_der().as_bytes()),
            },
        )
        .await?;
    Ok((session.session_token, claim.device_id))
}
