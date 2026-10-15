#![cfg(unix)]
//! `codewide-companion update` against a scripted Companion control socket.

use std::{
    os::unix::fs::PermissionsExt,
    path::Path,
    sync::{Arc, Mutex},
};

use axum::{
    Json, Router,
    extract::{Path as UrlPath, State},
    http::{HeaderMap, StatusCode},
    routing::{get, post},
};
use serde_json::{Value, json};
use tokio::{net::UnixListener, process::Command};

const ADMIN_TOKEN: &str = "administrator-token-long-enough-for-cli-test";
const FINGERPRINT: &str = "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee";

/// What the scripted Companion saw and how far its update got.
#[derive(Default)]
struct Script {
    available: bool,
    applied: Vec<Value>,
    reads: usize,
    receipts: usize,
}

type Shared = Arc<Mutex<Script>>;

fn authorized(headers: &HeaderMap) -> bool {
    headers
        .get("authorization")
        .and_then(|value| value.to_str().ok())
        == Some("Bearer administrator-token-long-enough-for-cli-test")
}

fn operation(phase: &str) -> Value {
    json!({
        "operationId": "upd_terminal_000000000001",
        "phase": phase,
        "currentVersion": "0.6.3",
        "targetVersion": "0.6.4",
        "targetFingerprint": FINGERPRINT,
        "startedAt": 1,
        "updatedAt": 2,
        "errorCode": null,
        "errorMessage": null,
    })
}

async fn check(State(script): State<Shared>, headers: HeaderMap) -> (StatusCode, Json<Value>) {
    if !authorized(&headers) {
        return (
            StatusCode::UNAUTHORIZED,
            Json(json!({"error": "admin_authorization_required", "message": "no"})),
        );
    }
    let available = script.lock().is_ok_and(|script| script.available);
    let target = available.then(|| {
        json!({
            "target": {
                "platform": "linux-x86-64",
                "version": "0.6.4",
                "build": "cccccccccccc",
                "sourceRevision": "c".repeat(40),
                "artifactUrl": "https://example.invalid/companion.tar.gz",
                "sha256": "d".repeat(64),
                "bootstrapVersion": 1,
                "journalVersion": 1,
                "stateEpoch": 1,
                "rollbackCompatibleFrom": ["b".repeat(64)],
            },
            "targetFingerprint": FINGERPRINT,
            "releaseSequence": 7,
            "expiresAt": u64::MAX,
        })
    });
    (
        StatusCode::OK,
        Json(json!({
            "platform": "linux-x86-64",
            "currentVersion": "0.6.3",
            "currentBuild": "aaaaaaaaaaaa",
            "currentSourceRevision": "a".repeat(40),
            "currentDigest": "b".repeat(64),
            "capability": {
                "apiVersion": 1,
                "guardianContractVersion": 1,
                "journalVersion": 1,
                "bootstrapVersion": 1,
                "applySupported": true,
                "unavailableReason": null,
            },
            "availableTarget": target,
            "activeOperation": null,
        })),
    )
}

async fn apply(
    State(script): State<Shared>,
    headers: HeaderMap,
    Json(request): Json<Value>,
) -> (StatusCode, Json<Value>) {
    assert!(authorized(&headers));
    if let Ok(mut script) = script.lock() {
        script.applied.push(request);
    }
    (
        StatusCode::ACCEPTED,
        Json(json!({"operationId": "upd_terminal_000000000001", "phase": "accepted"})),
    )
}

async fn read_operation(
    State(script): State<Shared>,
    UrlPath(operation_id): UrlPath<String>,
    headers: HeaderMap,
) -> Json<Value> {
    assert!(authorized(&headers));
    assert_eq!(operation_id, "upd_terminal_000000000001");
    let reads = script.lock().map_or(0, |mut script| {
        script.reads += 1;
        script.reads
    });
    Json(operation(if reads == 1 {
        "installing"
    } else {
        "awaitingReconnect"
    }))
}

async fn reconnect(State(script): State<Shared>, headers: HeaderMap) -> Json<Value> {
    assert!(authorized(&headers));
    if let Ok(mut script) = script.lock() {
        script.receipts += 1;
    }
    Json(operation("committed"))
}

fn serve(endpoint: &Path, script: Shared) -> Result<tokio::task::JoinHandle<()>, std::io::Error> {
    let listener = UnixListener::bind(endpoint)?;
    let router = Router::new()
        .route("/v1/host-update/check", post(check))
        .route("/v1/host-update/apply", post(apply))
        .route(
            "/v1/host-update/operations/{operation_id}",
            get(read_operation),
        )
        .route(
            "/v1/host-update/operations/{operation_id}/reconnect",
            post(reconnect),
        )
        .with_state(script);
    Ok(tokio::spawn(async move {
        let _ = axum::serve(listener, router).await;
    }))
}

async fn run_cli(
    directory: &Path,
    arguments: &[&str],
) -> Result<std::process::Output, Box<dyn std::error::Error>> {
    let token_file = directory.join("host.token");
    std::fs::write(&token_file, format!("{ADMIN_TOKEN}\n"))?;
    std::fs::set_permissions(&token_file, std::fs::Permissions::from_mode(0o600))?;
    Ok(Command::new(env!("CARGO_BIN_EXE_codewide-companion"))
        .arg("update")
        .args(arguments)
        .arg("--control-endpoint")
        .arg(directory.join("control.sock"))
        .arg("--token-file")
        .arg(&token_file)
        .output()
        .await?)
}

#[tokio::test]
async fn update_applies_the_release_and_confirms_the_restarted_companion()
-> Result<(), Box<dyn std::error::Error>> {
    let directory = tempfile::tempdir()?;
    let script = Arc::new(Mutex::new(Script {
        available: true,
        ..Script::default()
    }));
    let server = serve(&directory.path().join("control.sock"), script.clone())?;

    let output = run_cli(directory.path(), &[]).await?;
    server.abort();

    let stdout = String::from_utf8_lossy(&output.stdout);
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    assert!(
        stdout.contains("Updating Companion 0.6.3 -> 0.6.4"),
        "{stdout}"
    );
    assert!(
        stdout.ends_with("Updated Companion to 0.6.4.\n"),
        "{stdout}"
    );
    let script = script.lock().map_err(|_| "script poisoned")?;
    assert_eq!(script.applied.len(), 1);
    assert_eq!(script.applied[0]["targetFingerprint"], FINGERPRINT);
    assert_eq!(
        script.receipts, 1,
        "the terminal confirms the restarted Companion once"
    );
    Ok(())
}

#[tokio::test]
async fn update_check_reports_the_newer_release_without_applying_it()
-> Result<(), Box<dyn std::error::Error>> {
    let directory = tempfile::tempdir()?;
    let script = Arc::new(Mutex::new(Script {
        available: true,
        ..Script::default()
    }));
    let server = serve(&directory.path().join("control.sock"), script.clone())?;

    let output = run_cli(directory.path(), &["--check", "--json"]).await?;
    server.abort();

    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    let report: Value = serde_json::from_slice(&output.stdout)?;
    assert_eq!(report["result"], "available");
    assert_eq!(report["targetVersion"], "0.6.4");
    assert!(report.get("targetFingerprint").is_none());
    assert!(
        script
            .lock()
            .map_err(|_| "script poisoned")?
            .applied
            .is_empty()
    );
    Ok(())
}

#[tokio::test]
async fn update_leaves_an_up_to_date_companion_alone() -> Result<(), Box<dyn std::error::Error>> {
    let directory = tempfile::tempdir()?;
    let script = Arc::new(Mutex::new(Script::default()));
    let server = serve(&directory.path().join("control.sock"), script.clone())?;

    let output = run_cli(directory.path(), &[]).await?;
    server.abort();

    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    assert_eq!(
        String::from_utf8_lossy(&output.stdout),
        "Companion 0.6.3 is up to date.\n"
    );
    assert!(
        script
            .lock()
            .map_err(|_| "script poisoned")?
            .applied
            .is_empty()
    );
    Ok(())
}

#[tokio::test]
async fn update_explains_a_companion_that_is_not_running() -> Result<(), Box<dyn std::error::Error>>
{
    let directory = tempfile::tempdir()?;

    let output = run_cli(directory.path(), &[]).await?;

    assert!(!output.status.success());
    let stderr = String::from_utf8_lossy(&output.stderr);
    assert!(
        stderr.contains("Cannot reach the running Companion"),
        "{stderr}"
    );
    Ok(())
}
