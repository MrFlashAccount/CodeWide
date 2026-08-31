#![cfg(unix)]
#![allow(clippy::unwrap_used)]

use std::sync::Arc;

use base64::{Engine as _, engine::general_purpose};
use codewide_companion::{
    auth::{DeviceRegistry, PairingClaim, SessionProof, pairing_claim_message},
    catalog::SessionCatalog,
    dictation::DictationService,
    history_service::HistoryService,
    server::{self, CompanionServices},
    store::IndexStore,
    sync::SyncHub,
    sync_v2::{
        ProductionServices, SyncV2Mode, SyncV2Runtime, UpstreamSemanticSource,
        protocol::{ACTION_KINDS, COMMAND_KINDS, QUERY_KINDS},
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
use tokio::{net::TcpListener, task::JoinHandle};
use tokio_tungstenite::{
    connect_async,
    tungstenite::{Message, client::IntoClientRequest},
};

const TOKEN: &str = "v2-contract-token-that-is-long-enough";
const CONTRACT: &str = include_str!("../contract/v2.json");

#[test]
fn executable_schema_matches_the_rust_registry_and_closed_scalar_rules() {
    let schema: Value = serde_json::from_str(CONTRACT).unwrap();
    assert_eq!(schema["protocolVersion"], 2);
    assert_eq!(schema["webSocketPath"], "/v2/sync");
    assert!(schema.get("additionalProperties").is_none());
    assert_eq!(schema["$defs"]["id"]["x-maxUtf8Bytes"], 256);
    assert_eq!(
        schema["$defs"]["v2Error"]["oneOf"]
            .as_array()
            .unwrap()
            .len(),
        5
    );
    assert_eq!(schema["x-codewide"]["queryKinds"], json!(QUERY_KINDS));
    assert_eq!(schema["x-codewide"]["commandKinds"], json!(COMMAND_KINDS));
    assert_eq!(schema["x-codewide"]["actionKinds"], json!(ACTION_KINDS));
    let paths = schema["x-codewide"]["paths"].as_object().unwrap();
    for endpoint in [
        "sync",
        "files",
        "media",
        "ports",
        "tunnels",
        "terminals",
        "voice",
    ] {
        assert!(
            paths[endpoint].as_str().unwrap().starts_with("/v2/"),
            "{endpoint} is not version isolated",
        );
    }
    assert_eq!(
        schema["x-codewide"]["sharedConnectionSubstrate"],
        json!({
            "pairingStart": "/v1/pairing/start",
            "pairingClaim": "/v1/pairing/claim",
            "sessionChallenge": "/v1/sessions/challenge",
            "sessionCreate": "/v1/sessions",
            "sessionCredential": "/v1/auth",
            "innerTlsTunnel": "/v1/e2ee-tunnel"
        })
    );
    for endpoint in [
        "pairingStart",
        "pairingClaim",
        "sessionChallenge",
        "sessionCreate",
    ] {
        assert!(
            paths.get(endpoint).is_none(),
            "{endpoint} must use the shared connection substrate"
        );
    }
}

#[test]
fn executable_schema_enforces_exact_integer_and_utc_z_timestamp_domains() {
    let schema: Value = serde_json::from_str(CONTRACT).unwrap();
    let validator = |definition: &str| {
        let mut focused = schema.clone();
        focused["oneOf"] = json!([{ "$ref": format!("#/$defs/{definition}") }]);
        jsonschema::draft202012::options()
            .should_validate_formats(true)
            .build(&focused)
            .unwrap()
    };

    let safe_integer = validator("safeInteger");
    assert!(safe_integer.is_valid(&json!(-9_007_199_254_740_991_i64)));
    assert!(safe_integer.is_valid(&json!(9_007_199_254_740_991_i64)));
    assert!(!safe_integer.is_valid(&json!(-9_007_199_254_740_992_i64)));
    assert!(!safe_integer.is_valid(&json!(9_007_199_254_740_992_i64)));
    assert!(!safe_integer.is_valid(&json!(1.5)));

    let non_negative = validator("nonNegativeInteger");
    assert!(non_negative.is_valid(&json!(0)));
    assert!(non_negative.is_valid(&json!(9_007_199_254_740_991_i64)));
    assert!(!non_negative.is_valid(&json!(-1)));
    assert!(!non_negative.is_valid(&json!(9_007_199_254_740_992_i64)));

    let timestamp = validator("timestamp");
    for valid in ["2026-08-28T12:34:56Z", "2026-08-28T12:34:56.123Z"] {
        assert!(timestamp.is_valid(&json!(valid)), "rejected {valid}");
    }
    for invalid in [
        "2026-08-28T12:34:56+00:00",
        "2026-08-28t12:34:56z",
        "2026-02-31T12:34:56Z",
        "2026-08-28T24:00:00Z",
        "2026-08-28T12:34:56",
    ] {
        assert!(!timestamp.is_valid(&json!(invalid)), "accepted {invalid}");
    }
}

#[tokio::test]
async fn disabled_mode_is_an_exact_fail_closed_http_contract()
-> Result<(), Box<dyn std::error::Error>> {
    let directory = tempfile::tempdir()?;
    let store = Arc::new(IndexStore::open(directory.path().join("state.redb"))?);
    let upstream = UpstreamHandle::spawn(directory.path().join("absent-app-server.sock"));
    let history = HistoryService::new(
        Arc::new(SessionCatalog::scan(directory.path())),
        store.clone(),
    );
    let sync = SyncHub::with_mutations(upstream, store.clone(), history);
    let (address, task) = start_server(store, sync).await?;

    let response = reqwest::Client::new()
        .get(format!("http://{address}/v2/sync"))
        .header("connection", "upgrade")
        .header("upgrade", "websocket")
        .header("sec-websocket-version", "13")
        .header("sec-websocket-key", "dGhlIHNhbXBsZSBub25jZQ==") // gitleaks:allow
        .send()
        .await?;
    assert_eq!(response.status(), reqwest::StatusCode::SERVICE_UNAVAILABLE);
    assert_eq!(
        response.headers().get("content-type").unwrap(),
        "application/problem+json"
    );
    assert_eq!(
        response.json::<Value>().await?,
        json!({
            "type": "https://codewide.dev/problems/sync-v2-disabled",
            "title": "Sync V2 disabled",
            "status": 503,
            "code": "sync_v2_disabled"
        })
    );
    task.abort();
    Ok(())
}

#[tokio::test]
async fn canary_route_rejects_admin_without_authenticated_device_context()
-> Result<(), Box<dyn std::error::Error>> {
    let directory = tempfile::tempdir()?;
    let store = Arc::new(IndexStore::open(directory.path().join("state.redb"))?);
    let catalog = Arc::new(SessionCatalog::scan(directory.path()));
    let history = HistoryService::new(catalog.clone(), store.clone());
    let v1_upstream = UpstreamHandle::spawn(directory.path().join("absent-v1.sock"));
    let v2_upstream = UpstreamHandle::spawn(directory.path().join("absent-v2.sock"));
    let dictation = Arc::new(
        DictationService::open(
            directory.path().join("absent-auth.json"),
            directory.path().join("dictation"),
        )
        .await?,
    );
    let sync = SyncHub::with_mutations(v1_upstream, store.clone(), history.clone())
        .with_dictation(dictation);
    let source = UpstreamSemanticSource::new(
        v2_upstream,
        store.clone(),
        history,
        catalog,
        ProductionServices::default(),
    );
    let runtime = SyncV2Runtime::new(
        source,
        directory.path().join("v2-operations.redb"),
        "test-pin",
    )?;
    let listener = TcpListener::bind("127.0.0.1:0").await?;
    let address = listener.local_addr()?;
    let app = server::router_with_services(
        store,
        Arc::from(TOKEN),
        sync,
        CompanionServices {
            sync_v2: Some(runtime),
            sync_v2_mode: SyncV2Mode::Canary,
            ..CompanionServices::default()
        },
    );
    let task = tokio::spawn(async move {
        let _ = axum::serve(listener, app).await;
    });
    for path in ["/v2/sync", "/v2/terminals", "/v2/voice"] {
        let response = reqwest::Client::new()
            .get(format!("http://{address}{path}"))
            .bearer_auth(TOKEN)
            .header("connection", "upgrade")
            .header("upgrade", "websocket")
            .header("sec-websocket-version", "13")
            .header("sec-websocket-key", "dGhlIHNhbXBsZSBub25jZQ==") // gitleaks:allow
            .send()
            .await?;
        let expected = if path == "/v2/sync" {
            reqwest::StatusCode::UNAUTHORIZED
        } else {
            reqwest::StatusCode::FORBIDDEN
        };
        assert_eq!(
            response.status(),
            expected,
            "admin token reached {path} without paired-device context",
        );
    }
    task.abort();
    Ok(())
}

#[tokio::test]
#[expect(
    clippy::too_many_lines,
    reason = "one public-transport gate intentionally exercises auth, HTTP, Terminal, and Voice together"
)]
async fn paired_session_reaches_auxiliary_routes_without_a_sync_epoch()
-> Result<(), Box<dyn std::error::Error>> {
    let directory = tempfile::tempdir()?;
    let store = Arc::new(IndexStore::open(directory.path().join("state.redb"))?);
    let catalog = Arc::new(SessionCatalog::scan(directory.path()));
    let history = HistoryService::new(catalog.clone(), store.clone());
    let v1_upstream = UpstreamHandle::spawn(directory.path().join("absent-v1.sock"));
    let v2_upstream = UpstreamHandle::spawn(directory.path().join("absent-v2.sock"));
    let dictation = Arc::new(
        DictationService::open(
            directory.path().join("absent-auth.json"),
            directory.path().join("dictation"),
        )
        .await?,
    );
    let sync = SyncHub::with_mutations(v1_upstream, store.clone(), history.clone())
        .with_dictation(dictation);
    let source = UpstreamSemanticSource::new(
        v2_upstream,
        store.clone(),
        history,
        catalog,
        ProductionServices::default(),
    );
    let runtime = SyncV2Runtime::new(
        source,
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
    let session_token = paired_session(&registry).await?;
    let listener = TcpListener::bind("127.0.0.1:0").await?;
    let address = listener.local_addr()?;
    let app = server::router_with_registry_and_services(
        store,
        registry,
        sync,
        CompanionServices {
            sync_v2: Some(runtime),
            sync_v2_mode: SyncV2Mode::Canary,
            ..CompanionServices::default()
        },
    );
    let task = tokio::spawn(async move {
        let _ = axum::serve(listener, app).await;
    });

    let ports = reqwest::Client::new()
        .get(format!("http://{address}/v2/ports"))
        .bearer_auth(&session_token)
        .send()
        .await?;
    assert_eq!(ports.status(), reqwest::StatusCode::OK);

    let malformed = reqwest::Client::new()
        .post(format!("http://{address}/v2/tunnels"))
        .bearer_auth(&session_token)
        .header("content-type", "application/json")
        .body("{")
        .send()
        .await?;
    assert_eq!(malformed.status(), reqwest::StatusCode::BAD_REQUEST);
    assert_eq!(
        malformed.json::<Value>().await?,
        json!({"code":"invalidRequest","message":"invalid closed V2 request"})
    );

    for (path, open) in [
        (
            "/v2/terminals",
            json!({"type":"open","version":2,"sessionId":"terminal-12345678-1234-1234-1234-123456789abc","threadId":"thread-a","generation":"1","cwd":null,"cols":120,"rows":40,"offset":"0","create":true}),
        ),
        (
            "/v2/voice",
            json!({"type":"start","version":2,"generation":"1","inputScope":{"kind":"generic","id":"composer"},"threadId":null,"language":null}),
        ),
    ] {
        let mut request = format!("ws://{address}{path}").into_client_request()?;
        request.headers_mut().insert(
            AUTHORIZATION,
            HeaderValue::from_str(&format!("Bearer {session_token}"))?,
        );
        let (mut socket, _) = connect_async(request).await?;
        socket.send(Message::Text(open.to_string().into())).await?;
        let response = socket
            .next()
            .await
            .ok_or("socket closed without failure")??;
        let Message::Text(response) = response else {
            return Err("expected closed V2 error record".into());
        };
        let response: Value = serde_json::from_str(&response)?;
        assert_eq!(response["type"], "error", "{path} did not fail closed");
        assert_eq!(
            response["error"]["code"], "generationChanged",
            "{path} depended on Sync transport instead of source generation"
        );
    }
    task.abort();
    Ok(())
}

async fn paired_session(registry: &DeviceRegistry) -> Result<String, Box<dyn std::error::Error>> {
    let signing = SigningKey::from_bytes((&[11_u8; 32]).into())?;
    let public_key_spki =
        general_purpose::STANDARD.encode(signing.verifying_key().to_public_key_der()?.as_bytes());
    let pairing = registry.create_pairing().await?;
    let proof: Signature = signing.sign(&pairing_claim_message(
        &pairing.pairing_token,
        "Android V2",
        &public_key_spki,
    ));
    let claim = registry
        .claim(PairingClaim {
            pairing_token: pairing.pairing_token,
            device_name: "Android V2".into(),
            public_key_spki,
            proof: general_purpose::STANDARD.encode(proof.to_der().as_bytes()),
        })
        .await?;
    registry
        .update_scopes(
            &claim.device_id,
            vec![
                "threads.read".into(),
                "localhost.forward".into(),
                "shell.explicit".into(),
                "turns.start".into(),
            ],
        )
        .await?;
    let device_bearer = format!("Bearer {}", claim.capability_token);
    let challenge = registry.challenge(Some(&device_bearer)).await?;
    let message = general_purpose::URL_SAFE_NO_PAD.decode(&challenge.challenge)?;
    let signature: Signature = signing.sign(&message);
    Ok(registry
        .create_session(
            Some(&device_bearer),
            SessionProof {
                challenge_id: challenge.challenge_id,
                signature: general_purpose::STANDARD.encode(signature.to_der().as_bytes()),
            },
        )
        .await?
        .session_token)
}

async fn start_server(
    store: Arc<IndexStore>,
    sync: SyncHub,
) -> Result<(std::net::SocketAddr, JoinHandle<()>), Box<dyn std::error::Error>> {
    let listener = TcpListener::bind("127.0.0.1:0").await?;
    let address = listener.local_addr()?;
    let app = server::router_with_services(
        store,
        Arc::from(TOKEN),
        sync,
        CompanionServices {
            sync_v2_mode: SyncV2Mode::Disabled,
            ..CompanionServices::default()
        },
    );
    let task = tokio::spawn(async move {
        let _ = axum::serve(listener, app).await;
    });
    Ok((address, task))
}
