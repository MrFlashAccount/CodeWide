#![cfg(unix)]
#![allow(clippy::unwrap_used)]

use std::sync::Arc;

use codewide_companion::{
    catalog::SessionCatalog,
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
use serde_json::{Value, json};
use tokio::{net::TcpListener, task::JoinHandle};

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
    assert!(!CONTRACT.contains("/v1/sync"));
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
    let sync = SyncHub::with_mutations(v1_upstream, store.clone(), history.clone());
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
    let response = reqwest::Client::new()
        .get(format!("http://{address}/v2/sync"))
        .bearer_auth(TOKEN)
        .header("connection", "upgrade")
        .header("upgrade", "websocket")
        .header("sec-websocket-version", "13")
        .header("sec-websocket-key", "dGhlIHNhbXBsZSBub25jZQ==") // gitleaks:allow
        .send()
        .await?;
    assert_eq!(response.status(), reqwest::StatusCode::UNAUTHORIZED);
    task.abort();
    Ok(())
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
