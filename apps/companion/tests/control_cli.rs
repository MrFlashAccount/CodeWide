#![cfg(unix)]

use std::{
    os::unix::fs::PermissionsExt,
    time::{SystemTime, UNIX_EPOCH},
};

use axum::{
    Json, Router,
    http::{HeaderMap, Uri},
    routing::{get, post},
};
use serde_json::{Value, json};
use tokio::{net::UnixListener, process::Command};

const ADMIN_TOKEN: &str = "administrator-token-long-enough-for-cli-test";

#[tokio::test]
async fn native_cli_queries_structured_telemetry_filters() -> Result<(), Box<dyn std::error::Error>>
{
    let directory = tempfile::tempdir()?;
    let endpoint = directory.path().join("control.sock");
    let token_file = directory.path().join("host.token");
    std::fs::write(&token_file, format!("{ADMIN_TOKEN}\n"))?;
    std::fs::set_permissions(&token_file, std::fs::Permissions::from_mode(0o600))?;
    let listener = UnixListener::bind(&endpoint)?;
    let router = Router::new().route("/v1/telemetry/events", get(telemetry_query_echo));
    let server = tokio::spawn(async move {
        let _ = axum::serve(listener, router).await;
    });

    let output = Command::new(env!("CARGO_BIN_EXE_codewide-companion"))
        .arg("telemetry")
        .arg("query")
        .arg("--request-id")
        .arg("request/1")
        .arg("--session-id")
        .arg("session 1")
        .arg("--tag-name")
        .arg("renderer")
        .arg("--tag-value")
        .arg("react-native")
        .arg("--descending")
        .arg("--control-endpoint")
        .arg(&endpoint)
        .arg("--token-file")
        .arg(&token_file)
        .output()
        .await?;
    server.abort();

    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    let response: Value = serde_json::from_slice(&output.stdout)?;
    let query = response["query"].as_str().ok_or("query missing")?;
    assert!(query.contains("requestId=request%2F1"));
    assert!(query.contains("sessionId=session+1"));
    assert!(query.contains("tagName=renderer"));
    assert!(query.contains("tagValue=react-native"));
    assert!(query.contains("descending=true"));
    Ok(())
}

#[tokio::test]
async fn native_cli_creates_a_pairing_through_local_control_only()
-> Result<(), Box<dyn std::error::Error>> {
    let directory = tempfile::tempdir()?;
    let endpoint = directory.path().join("control.sock");
    let token_file = directory.path().join("host.token");
    std::fs::write(&token_file, format!("{ADMIN_TOKEN}\n"))?;
    std::fs::set_permissions(&token_file, std::fs::Permissions::from_mode(0o600))?;

    let listener = UnixListener::bind(&endpoint)?;
    let router = Router::new().route("/v1/pairing/start", post(pairing_start_tls));
    let server = tokio::spawn(async move {
        let _ = axum::serve(listener, router).await;
    });
    let output = Command::new(env!("CARGO_BIN_EXE_codewide-companion"))
        .arg("pair")
        .arg("--json")
        .arg("--control-endpoint")
        .arg(&endpoint)
        .arg("--token-file")
        .arg(&token_file)
        .env("CODEWIDE_PUBLIC_ENDPOINT", "ws://127.0.0.1:8766/v1/sync")
        .output()
        .await?;
    server.abort();

    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    assert!(output.stderr.is_empty());
    let response: Value = serde_json::from_slice(&output.stdout)?;
    assert_eq!(
        response["pairingToken"],
        "pairing-token-long-enough-for-cli-test"
    );
    assert_eq!(response["endpoint"], "ws://127.0.0.1:8766/v1/sync");
    assert!(
        response["pairingLink"]
            .as_str()
            .is_some_and(|link| link.starts_with("codewide://pair?"))
    );
    let payload: Value = serde_json::from_str(
        response["pairingPayload"]
            .as_str()
            .ok_or("pairing payload missing")?,
    )?;
    assert_eq!(payload["type"], "codewide-pairing");
    assert_eq!(
        payload["tlsPinSha256"],
        format!("sha256/{}=", "A".repeat(43))
    );
    Ok(())
}

#[tokio::test]
async fn native_cli_binds_wss_pairing_to_the_running_companion_identity()
-> Result<(), Box<dyn std::error::Error>> {
    let directory = tempfile::tempdir()?;
    let endpoint = directory.path().join("control.sock");
    let token_file = directory.path().join("host.token");
    std::fs::write(&token_file, format!("{ADMIN_TOKEN}\n"))?;
    std::fs::set_permissions(&token_file, std::fs::Permissions::from_mode(0o600))?;
    let listener = UnixListener::bind(&endpoint)?;
    let router = Router::new().route("/v1/pairing/start", post(pairing_start_tls));
    let server = tokio::spawn(async move {
        let _ = axum::serve(listener, router).await;
    });
    let output = Command::new(env!("CARGO_BIN_EXE_codewide-companion"))
        .arg("pair")
        .arg("--json")
        .arg("--control-endpoint")
        .arg(&endpoint)
        .arg("--token-file")
        .arg(&token_file)
        .env(
            "CODEWIDE_PUBLIC_ENDPOINT",
            "wss://companion.example/v1/sync",
        )
        .output()
        .await?;
    server.abort();
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    let response: Value = serde_json::from_slice(&output.stdout)?;
    let payload: Value = serde_json::from_str(
        response["pairingPayload"]
            .as_str()
            .ok_or("pairing payload missing")?,
    )?;
    assert_eq!(
        payload["tlsPinSha256"],
        format!("sha256/{}=", "A".repeat(43))
    );
    assert_eq!(payload["identityExpiresAt"], 4_102_444_800_000_u64);
    assert!(
        response["pairingLink"]
            .as_str()
            .is_some_and(|link| link.contains("p=sha256%2F") && link.contains("y=4102444800000"))
    );
    Ok(())
}

#[tokio::test]
async fn native_cli_rejects_pairing_without_a_companion_identity_pin()
-> Result<(), Box<dyn std::error::Error>> {
    let directory = tempfile::tempdir()?;
    let endpoint = directory.path().join("control.sock");
    let token_file = directory.path().join("host.token");
    std::fs::write(&token_file, format!("{ADMIN_TOKEN}\n"))?;
    std::fs::set_permissions(&token_file, std::fs::Permissions::from_mode(0o600))?;
    let listener = UnixListener::bind(&endpoint)?;
    let router = Router::new().route("/v1/pairing/start", post(pairing_start));
    let server = tokio::spawn(async move {
        let _ = axum::serve(listener, router).await;
    });
    let output = Command::new(env!("CARGO_BIN_EXE_codewide-companion"))
        .arg("pair")
        .arg("--json")
        .arg("--control-endpoint")
        .arg(&endpoint)
        .arg("--token-file")
        .arg(&token_file)
        .env("CODEWIDE_PUBLIC_ENDPOINT", "wss://legacy.example/v1/sync")
        .output()
        .await?;
    server.abort();
    assert!(!output.status.success());
    assert!(
        String::from_utf8_lossy(&output.stderr)
            .contains("running companion returned no TLS identity pin")
    );
    Ok(())
}

#[tokio::test]
async fn native_cli_renders_terminal_qr_and_private_svg_fallback()
-> Result<(), Box<dyn std::error::Error>> {
    let directory = tempfile::tempdir()?;
    let endpoint = directory.path().join("control.sock");
    let token_file = directory.path().join("host.token");
    let svg_file = directory.path().join("pairing.svg");
    std::fs::write(&token_file, format!("{ADMIN_TOKEN}\n"))?;
    std::fs::set_permissions(&token_file, std::fs::Permissions::from_mode(0o600))?;

    let listener = UnixListener::bind(&endpoint)?;
    let router = Router::new().route("/v1/pairing/start", post(pairing_start_tls));
    let server = tokio::spawn(async move {
        let _ = axum::serve(listener, router).await;
    });

    let unicode = Command::new(env!("CARGO_BIN_EXE_codewide-companion"))
        .arg("pair")
        .arg("--qr")
        .arg("unicode")
        .arg("--control-endpoint")
        .arg(&endpoint)
        .arg("--token-file")
        .arg(&token_file)
        .env("CODEWIDE_PUBLIC_ENDPOINT", "ws://127.0.0.1:8766/v1/sync")
        .output()
        .await?;
    assert!(
        unicode.status.success(),
        "{}",
        String::from_utf8_lossy(&unicode.stderr)
    );
    let unicode_stdout = String::from_utf8(unicode.stdout)?;
    assert!(unicode_stdout.contains("\u{1b}[47;30m"));
    assert!(
        unicode_stdout.contains('▀')
            || unicode_stdout.contains('▄')
            || unicode_stdout.contains('█')
    );
    let first_line = unicode_stdout.lines().next().ok_or("missing JSON line")?;
    let response: Value = serde_json::from_str(first_line)?;
    assert!(
        response["pairingLink"]
            .as_str()
            .is_some_and(|link| link.starts_with("codewide://pair?"))
    );

    let svg = Command::new(env!("CARGO_BIN_EXE_codewide-companion"))
        .arg("pair")
        .arg("--qr")
        .arg("svg")
        .arg("--qr-output")
        .arg(&svg_file)
        .arg("--control-endpoint")
        .arg(&endpoint)
        .arg("--token-file")
        .arg(&token_file)
        .env("CODEWIDE_PUBLIC_ENDPOINT", "ws://127.0.0.1:8766/v1/sync")
        .output()
        .await?;
    server.abort();

    assert!(
        svg.status.success(),
        "{}",
        String::from_utf8_lossy(&svg.stderr)
    );
    assert_eq!(
        std::fs::metadata(&svg_file)?.permissions().mode() & 0o777,
        0o600
    );
    assert!(std::fs::read_to_string(&svg_file)?.starts_with("<svg "));
    assert!(String::from_utf8(svg.stderr)?.contains(svg_file.to_string_lossy().as_ref()));
    Ok(())
}

#[tokio::test]
async fn native_cli_creates_a_private_administrator_token_without_overwriting()
-> Result<(), Box<dyn std::error::Error>> {
    let directory = tempfile::tempdir()?;
    let token_file = directory.path().join("private/host.token");
    let first = Command::new(env!("CARGO_BIN_EXE_codewide-companion"))
        .arg("create-token")
        .arg("--token-file")
        .arg(&token_file)
        .output()
        .await?;
    assert!(
        first.status.success(),
        "{}",
        String::from_utf8_lossy(&first.stderr)
    );
    assert_eq!(
        std::fs::metadata(&token_file)?.permissions().mode() & 0o777,
        0o600
    );
    assert!(std::fs::read_to_string(&token_file)?.trim().len() >= 32);

    let second = Command::new(env!("CARGO_BIN_EXE_codewide-companion"))
        .arg("create-token")
        .arg("--token-file")
        .arg(&token_file)
        .output()
        .await?;
    assert!(!second.status.success());
    Ok(())
}

async fn pairing_start(headers: HeaderMap) -> Json<Value> {
    assert_eq!(
        headers
            .get("authorization")
            .and_then(|value| value.to_str().ok()),
        Some("Bearer administrator-token-long-enough-for-cli-test")
    );
    let now = u64::try_from(
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis(),
    )
    .unwrap_or(u64::MAX);
    Json(json!({
        "pairingToken": "pairing-token-long-enough-for-cli-test",
        "expiresAt": now + 300_000,
    }))
}

async fn pairing_start_tls(headers: HeaderMap) -> Json<Value> {
    let mut response = pairing_start(headers).await.0;
    response["tlsPinSha256"] = json!(format!("sha256/{}=", "A".repeat(43)));
    response["identityExpiresAt"] = json!(4_102_444_800_000_u64);
    Json(response)
}

async fn telemetry_query_echo(headers: HeaderMap, uri: Uri) -> Json<Value> {
    assert_eq!(
        headers
            .get("authorization")
            .and_then(|value| value.to_str().ok()),
        Some("Bearer administrator-token-long-enough-for-cli-test")
    );
    Json(json!({ "query": uri.query().unwrap_or_default() }))
}
