//! Exact process, identity, upstream, and Relay health proof for update outcomes.

use std::{
    fs,
    path::{Path, PathBuf},
    process::{Command, Stdio},
};

use super::{GenerationMetadataV1, OperationRecord, store};
use companion_core::host_update::HostUpdateRunningArtifact;

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct ProcessHealth {
    artifact: Option<HostUpdateRunningArtifact>,
    ready: bool,
    relay_online: bool,
}

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
        || identity_pin(&operation.identity_manifest).as_deref()
            != Some(operation.identity_pin.as_str())
    {
        return false;
    }
    process_is_ready(root, &metadata, operation)
}

pub(super) fn rollback_is_ready(root: &Path, operation: &OperationRecord) -> bool {
    store::read_json::<GenerationMetadataV1>(&root.join("current/metadata.json")).is_ok_and(
        |metadata| {
            metadata.artifact_digest == operation.current.artifact_digest
                && metadata.version == operation.current.version
                && metadata.build == operation.current.build
                && metadata.source_revision == operation.current.source_revision
        },
    ) && identity_pin(&operation.identity_manifest).as_deref()
        == Some(operation.identity_pin.as_str())
        && process_is_ready(root, &operation.current, operation)
}

fn process_is_ready(
    root: &Path,
    expected: &GenerationMetadataV1,
    operation: &OperationRecord,
) -> bool {
    if let Some(health) = process_health() {
        return process_health_matches(&health, expected, main_pid(), relay_required(operation));
    }
    // Legacy payloads have no self-attestation endpoint. Preserve their exact
    // executable proof when /proc is accessible; never accept readiness alone.
    running_companion_is_current(root) && health_is_ready() && relay_requirement_is_ready(operation)
}

fn process_health_matches(
    health: &ProcessHealth,
    expected: &GenerationMetadataV1,
    pid: Option<u32>,
    require_relay: bool,
) -> bool {
    health.artifact.as_ref().is_some_and(|artifact| {
        artifact_matches(artifact, expected)
            && pid == Some(artifact.process_id)
            && health.ready
            && (!require_relay || health.relay_online)
    })
}

fn artifact_matches(artifact: &HostUpdateRunningArtifact, expected: &GenerationMetadataV1) -> bool {
    artifact.version == expected.version
        && artifact.build == expected.build
        && artifact.source_revision == expected.source_revision
        && artifact.artifact_digest == expected.artifact_digest
}

fn relay_required(operation: &OperationRecord) -> bool {
    operation.journal.pre_update_relay.enabled && operation.journal.pre_update_relay.upstream_live
}

fn process_health() -> Option<ProcessHealth> {
    let (Some(socket), Some(token)) = (control_socket(), administrator_token()) else {
        return None;
    };
    let output = Command::new("curl")
        .args(["--fail", "--silent", "--max-time", "2", "--unix-socket"])
        .arg(socket)
        .arg("-H")
        .arg(format!("Authorization: Bearer {token}"))
        .arg("http://localhost/v1/host-update/health")
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    serde_json::from_slice(&output.stdout).ok()
}

fn relay_requirement_is_ready(operation: &OperationRecord) -> bool {
    !operation.journal.pre_update_relay.enabled
        || !operation.journal.pre_update_relay.upstream_live
        || relay_is_online()
}

fn running_companion_is_current(root: &Path) -> bool {
    let Some(pid) = main_pid() else {
        return false;
    };
    let expected = fs::canonicalize(root.join("current/bin/codewide-companion"));
    let running = fs::canonicalize(format!("/proc/{pid}/exe"));
    matches!((expected, running), (Ok(expected), Ok(running)) if expected == running)
}

fn main_pid() -> Option<u32> {
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
    output
        .ok()
        .filter(|value| value.status.success())
        .and_then(|value| String::from_utf8(value.stdout).ok())
        .and_then(|value| value.trim().parse::<u32>().ok())
        .filter(|pid| *pid != 0)
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn process_attestation_requires_exact_generation_pid_and_readiness_without_proc_access() {
        let expected = GenerationMetadataV1 {
            schema_version: 1,
            version: "1.2.0".to_owned(),
            build: "build".to_owned(),
            source_revision: "a".repeat(40),
            artifact_digest: "b".repeat(64),
        };
        let mut health = ProcessHealth {
            artifact: Some(HostUpdateRunningArtifact {
                process_id: 42,
                version: expected.version.clone(),
                build: expected.build.clone(),
                source_revision: expected.source_revision.clone(),
                artifact_digest: expected.artifact_digest.clone(),
            }),
            ready: true,
            relay_online: true,
        };
        assert!(process_health_matches(&health, &expected, Some(42), true));
        assert!(!process_health_matches(&health, &expected, Some(43), true));
        assert!(!process_health_matches(&health, &expected, None, true));
        health.relay_online = false;
        assert!(!process_health_matches(&health, &expected, Some(42), true));
        assert!(process_health_matches(&health, &expected, Some(42), false));
        health.ready = false;
        assert!(!process_health_matches(&health, &expected, Some(42), false));
        health.ready = true;
        if let Some(artifact) = &mut health.artifact {
            artifact.artifact_digest = "c".repeat(64);
        }
        assert!(!process_health_matches(&health, &expected, Some(42), false));
        health.artifact = None;
        assert!(!process_health_matches(&health, &expected, Some(42), false));
    }
}
