//! Exact process, identity, upstream, and Relay health proof for update outcomes.

use std::{
    fs,
    path::{Path, PathBuf},
    process::{Command, Stdio},
};

use super::{GenerationMetadataV1, OperationRecord, store};

pub(super) fn target_is_ready(root: &Path, operation: &OperationRecord) -> bool {
    let Ok(metadata) =
        store::read_json::<GenerationMetadataV1>(&root.join("current/metadata.json"))
    else {
        return false;
    };
    if metadata.version != operation.target.version
        || metadata.build != operation.target.build
        || metadata.source_revision != operation.target.source_revision
        || metadata.artifact_digest != operation.target.sha256
        || !running_companion_is_current(root)
        || identity_pin(&operation.identity_manifest).as_deref()
            != Some(operation.identity_pin.as_str())
        || !health_is_ready()
    {
        return false;
    }
    relay_requirement_is_ready(operation)
}

pub(super) fn rollback_is_ready(root: &Path, operation: &OperationRecord) -> bool {
    store::read_json::<GenerationMetadataV1>(&root.join("current/metadata.json")).is_ok_and(
        |metadata| {
            metadata.artifact_digest == operation.current.artifact_digest
                && metadata.version == operation.current.version
                && metadata.build == operation.current.build
                && metadata.source_revision == operation.current.source_revision
        },
    ) && running_companion_is_current(root)
        && identity_pin(&operation.identity_manifest).as_deref()
            == Some(operation.identity_pin.as_str())
        && health_is_ready()
        && relay_requirement_is_ready(operation)
}

fn relay_requirement_is_ready(operation: &OperationRecord) -> bool {
    !operation.journal.pre_update_relay.enabled
        || !operation.journal.pre_update_relay.upstream_live
        || relay_is_online()
}

fn running_companion_is_current(root: &Path) -> bool {
    let output = Command::new("systemctl")
        .args([
            "--user",
            "show",
            "--property",
            "MainPID",
            "--value",
            "codewide-companion.service",
        ])
        .output();
    let Some(pid) = output
        .ok()
        .filter(|value| value.status.success())
        .and_then(|value| String::from_utf8(value.stdout).ok())
        .and_then(|value| value.trim().parse::<u32>().ok())
        .filter(|pid| *pid != 0)
    else {
        return false;
    };
    let expected = fs::canonicalize(root.join("current/bin/codewide-companion"));
    let running = fs::canonicalize(format!("/proc/{pid}/exe"));
    matches!((expected, running), (Ok(expected), Ok(running)) if expected == running)
}

fn health_is_ready() -> bool {
    let Some(socket) = control_socket() else {
        return false;
    };
    Command::new("curl")
        .args(["--fail", "--silent", "--max-time", "2", "--unix-socket"])
        .arg(socket)
        .arg("http://localhost/readyz")
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .is_ok_and(|status| status.success())
}

fn relay_is_online() -> bool {
    let (Some(socket), Some(token)) = (control_socket(), administrator_token()) else {
        return false;
    };
    let output = Command::new("curl")
        .args(["--fail", "--silent", "--max-time", "2", "--unix-socket"])
        .arg(socket)
        .arg("-H")
        .arg(format!("Authorization: Bearer {token}"))
        .arg("http://localhost/v1/relay")
        .output();
    output.is_ok_and(|value| {
        value.status.success()
            && serde_json::from_slice::<serde_json::Value>(&value.stdout).is_ok_and(|json| {
                json.get("connection").and_then(serde_json::Value::as_str) == Some("online")
            })
    })
}

fn identity_pin(manifest: &Path) -> Option<String> {
    let bytes = fs::read(manifest).ok()?;
    serde_json::from_slice::<serde_json::Value>(&bytes)
        .ok()?
        .get("tlsPinSha256")?
        .as_str()
        .map(ToOwned::to_owned)
}

fn administrator_token() -> Option<String> {
    let home = std::env::var_os("HOME")?;
    fs::read_to_string(PathBuf::from(home).join(".codewide/host.token"))
        .ok()
        .map(|value| value.trim().to_owned())
        .filter(|value| !value.is_empty())
}

fn control_socket() -> Option<PathBuf> {
    std::env::var_os("XDG_RUNTIME_DIR")
        .map(PathBuf::from)
        .or_else(|| {
            Command::new("id")
                .arg("-u")
                .output()
                .ok()
                .filter(|value| value.status.success())
                .and_then(|value| String::from_utf8(value.stdout).ok())
                .map(|value| PathBuf::from(format!("/run/user/{}", value.trim())))
        })
        .map(|root| root.join("codewide/companion-control.sock"))
}
