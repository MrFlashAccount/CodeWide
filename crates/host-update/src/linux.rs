//! Crash-safe Linux generation updates under systemd user services.
//!
//! The running service admits only a pinned, signed release descriptor and
//! durably queues an operation. A stable bootstrap copy of the product
//! executable performs activation and rollback under systemd, so replacing or
//! killing the payload process cannot strand the installation.
//!
//! Layout under the install root:
//!
//! - `generations/<artifact sha256>/` holds one immutable, verified payload
//!   with its `metadata.json`;
//! - `current` is a relative symlink to the active generation and is switched
//!   by a single `rename(2)`, which is the only activation and rollback step;
//! - `bootstrap/<guardian>` is the stable runner that is never replaced by a
//!   remote update.

mod guardian;
mod health;
mod host_resolver;
mod runner;
mod store;
#[cfg(test)]
mod test_support;

use std::{
    fs,
    path::PathBuf,
    process::Command,
    time::{SystemTime, UNIX_EPOCH},
};

use serde::{Deserialize, Serialize};

use crate::{
    HostPlatform, HostUpdateJournalV1, HostUpdateProgress, HostUpdateRunningArtifact,
    ReleaseTargetV1,
};

pub use guardian::{LinuxGuardianConfig, LinuxHostUpdateGuardian};
pub use runner::run_pending;

/// Everything that distinguishes one updatable Linux product from another.
/// The generation layout, journal, activation and rollback are shared.
#[derive(Debug)]
pub struct LinuxProduct {
    /// Release-manifest platform whose target this product installs.
    pub platform: HostPlatform,
    /// Single top-level directory of the release archive.
    pub bundle_directory: &'static str,
    /// Executable name: the payload ships `bin/<name>`, which must print
    /// `<name> <version>` for `--version`.
    pub executable_name: &'static str,
    /// Other executables, relative to the payload, that a generation must contain.
    pub payload_executables: &'static [&'static str],
    /// Installer-only payload entries removed before a generation is published.
    pub bootstrap_only: &'static [&'static str],
    /// Stable runner executable under `<root>/bootstrap/`.
    pub bootstrap_guardian: &'static str,
    /// systemd user unit of the service being updated.
    pub service_unit: &'static str,
    /// systemd user unit that runs the bootstrap runner.
    pub update_unit: &'static str,
    /// Version compiled into the running executable.
    pub running_version: &'static str,
}

/// Product-owned proof that the restarted service is the exact generation and
/// that its long-lived identity survived the update.
pub trait ServiceHealth: Send + Sync {
    /// Current pin of the identity recorded in `operation.identity_pin`.
    fn identity_pin(&self, operation: &OperationRecord) -> Option<String>;

    /// Whether the service process runs exactly `expected` and is ready.
    fn serves(&self, expected: &GenerationMetadataV1, operation: &OperationRecord) -> bool;
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct GenerationMetadataV1 {
    pub schema_version: u16,
    pub version: String,
    pub build: String,
    pub source_revision: String,
    pub artifact_digest: String,
}

/// The durable operation record. Its serialized shape is shared with stable
/// bootstrap runners that are never replaced remotely; fields may only be
/// added as optional.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OperationRecord {
    pub journal: HostUpdateJournalV1,
    pub idempotency_key: String,
    pub current: GenerationMetadataV1,
    pub target: ReleaseTargetV1,
    pub release_sequence: u64,
    pub identity_pin: String,
    pub identity_manifest: PathBuf,
    pub previous_generation: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub progress: Option<HostUpdateProgress>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub recovery_error: Option<String>,
}

/// Identity of the running process, read from the immutable generation that
/// contains its own executable (`<generation>/bin/<name>`), never from the
/// mutable `current` link or another process's `/proc` entry.
#[must_use]
pub fn running_artifact(product: &LinuxProduct) -> Option<HostUpdateRunningArtifact> {
    let executable = fs::canonicalize(std::env::current_exe().ok()?).ok()?;
    let generation = executable.parent()?.parent()?;
    let metadata: GenerationMetadataV1 =
        store::read_json(&generation.join("metadata.json")).ok()?;
    if metadata.schema_version != 1 || metadata.version != product.running_version {
        return None;
    }
    Some(HostUpdateRunningArtifact {
        process_id: std::process::id(),
        version: metadata.version,
        build: metadata.build,
        source_revision: metadata.source_revision,
        artifact_digest: metadata.artifact_digest,
    })
}

/// Main PID of a systemd user unit, if it is running.
#[must_use]
pub fn main_pid(unit: &str) -> Option<u32> {
    Command::new("systemctl")
        .args(["--user", "show", "--property", "MainPID", "--value", unit])
        .output()
        .ok()
        .filter(|value| value.status.success())
        .and_then(|value| String::from_utf8(value.stdout).ok())
        .and_then(|value| value.trim().parse::<u32>().ok())
        .filter(|pid| *pid != 0)
}

pub(crate) fn unix_millis() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |value| value.as_millis().try_into().unwrap_or(u64::MAX))
}
