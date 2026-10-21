#![cfg(unix)]

use std::{os::unix::fs::PermissionsExt, path::Path, process::Output};

use codewide_companion::http_proxy::{HttpProxySettings, HttpProxySettingsStore};
use serde_json::{Value, json};
use tokio::process::Command;

const PROXY_URL: &str = "http://operator:proxy-secret@proxy.example:8080";

async fn proxy_cli(state_dir: &Path, arguments: &[&str]) -> std::io::Result<Output> {
    Command::new(env!("CARGO_BIN_EXE_codewide-companion"))
        .arg("proxy")
        .args(arguments)
        .arg("--state-dir")
        .arg(state_dir)
        .output()
        .await
}

fn assert_no_secret(output: &Output) {
    for stream in [&output.stdout, &output.stderr] {
        let text = String::from_utf8_lossy(stream);
        assert!(!text.contains("proxy-secret"), "proxy credential leaked");
        assert!(!text.contains("proxy.example"), "proxy host leaked");
    }
}

#[tokio::test]
async fn configure_and_clear_round_trip_private_settings() -> Result<(), Box<dyn std::error::Error>>
{
    let directory = tempfile::tempdir()?;
    let store = HttpProxySettingsStore::new(directory.path());

    let configured = proxy_cli(
        directory.path(),
        &[
            "configure",
            "--https-proxy",
            PROXY_URL,
            "--no-proxy",
            "localhost",
        ],
    )
    .await?;
    assert!(
        configured.status.success(),
        "{}",
        String::from_utf8_lossy(&configured.stderr)
    );
    assert_no_secret(&configured);
    let report: Value = serde_json::from_slice(&configured.stdout)?;
    assert_eq!(report["configured"], json!(true));
    assert_eq!(report["httpProxy"], json!(false));
    assert_eq!(report["httpsProxy"], json!(true));
    assert_eq!(report["noProxy"], json!(true));
    assert_eq!(report["restartRequired"], json!(true));
    assert_eq!(
        store.load()?,
        HttpProxySettings {
            http_proxy: None,
            https_proxy: Some(PROXY_URL.into()),
            no_proxy: Some("localhost".into()),
        }
    );
    assert_eq!(
        std::fs::metadata(store.path())?.permissions().mode() & 0o777,
        0o600
    );

    let cleared = proxy_cli(directory.path(), &["clear"]).await?;
    assert!(
        cleared.status.success(),
        "{}",
        String::from_utf8_lossy(&cleared.stderr)
    );
    assert_eq!(
        serde_json::from_slice::<Value>(&cleared.stdout)?["configured"],
        json!(false)
    );
    assert!(!store.path().exists());
    Ok(())
}

#[tokio::test]
async fn configure_rejects_incomplete_or_invalid_settings_without_echoing_them()
-> Result<(), Box<dyn std::error::Error>> {
    let directory = tempfile::tempdir()?;
    let store = HttpProxySettingsStore::new(directory.path());

    let bypass_only =
        proxy_cli(directory.path(), &["configure", "--no-proxy", "localhost"]).await?;
    assert!(!bypass_only.status.success());
    assert!(!store.path().exists());

    let invalid = proxy_cli(
        directory.path(),
        &[
            "configure",
            "--https-proxy",
            "http://operator:proxy-secret@proxy.example:[bad",
        ],
    )
    .await?;
    assert!(!invalid.status.success());
    assert_no_secret(&invalid);
    assert!(!store.path().exists());
    Ok(())
}
