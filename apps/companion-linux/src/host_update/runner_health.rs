//! Exact process, identity, upstream, and Relay health proof of the Companion.

use std::{
    fs,
    path::{Path, PathBuf},
    process::{Command, Stdio},
};

use codewide_host_update::{
    HostUpdateRunningArtifact,
    linux::{GenerationMetadataV1, ServiceHealth, ServiceHealthContext, SystemdScope, main_pid},
};

use super::COMPANION;

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct ProcessHealth {
    artifact: Option<HostUpdateRunningArtifact>,
    ready: bool,
    relay_online: bool,
}

pub(super) struct CompanionHealth {
    pub root: PathBuf,
}

impl ServiceHealth for CompanionHealth {
    fn identity_pin(&self, context: &ServiceHealthContext) -> Option<String> {
        identity_pin(&context.identity_manifest)
    }

    fn serves(&self, expected: &GenerationMetadataV1, context: &ServiceHealthContext) -> bool {
        let pid = main_pid(SystemdScope::User, COMPANION.activation.service_unit);
        if let Some(health) = process_health() {
            return process_health_matches(&health, expected, pid, relay_required(context));
        }
        // Legacy payloads have no self-attestation endpoint. Preserve their exact
        // executable proof when /proc is accessible; never accept readiness alone.
        running_companion_is_current(&self.root, pid)
            && health_is_ready()
            && relay_requirement_is_ready(context)
    }
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

fn relay_required(context: &ServiceHealthContext) -> bool {
    context.pre_update_relay.enabled && context.pre_update_relay.upstream_live
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

fn relay_requirement_is_ready(context: &ServiceHealthContext) -> bool {
    !context.pre_update_relay.enabled
        || !context.pre_update_relay.upstream_live
        || relay_is_online()
}

fn running_companion_is_current(root: &Path, pid: Option<u32>) -> bool {
    let Some(pid) = pid else {
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
