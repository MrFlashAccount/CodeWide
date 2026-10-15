//! Crash-safe Linux generation updates under systemd services.
//!
//! The running service admits a release and prepares a complete local
//! generation. A stable, network-dark bootstrap executable only activates that
//! prepared generation and rolls it back under systemd, so replacing or killing
//! the payload process cannot strand the installation.
//!
//! Layout under the install root:
//!
//! - `generations/<artifact sha256>/` holds one immutable, verified payload
//!   with its `metadata.json`;
//! - `current` is a relative symlink to the active generation and is switched
//!   by a single `rename(2)`, which is the only activation and rollback step;
//! - `bootstrap/<guardian>` is the stable runner that is never replaced by a
//!   remote update.

mod generation;
mod guardian;
mod health;
pub mod local_update;
mod outcome;
mod prepare;
mod runner;
mod store;
#[cfg(test)]
mod test_support;

use std::{
    fs,
    path::PathBuf,
    process::Command,
    time::{Duration, SystemTime, UNIX_EPOCH},
};

// Release hosts resolve through the host's NSS resolver, not musl's.
use codewide_host_resolver as host_resolver;
use serde::{Deserialize, Serialize};

use crate::{
    HostPlatform, HostUpdateJournalV1, HostUpdateProgress, HostUpdateRunningArtifact,
    ReleaseTargetV1, SignedReleaseDescriptor,
};

pub use guardian::{LinuxGuardianConfig, LinuxHostUpdateGuardian};
pub use runner::run_pending;

/// Everything that distinguishes one updatable Linux product from another.
/// The generation layout, journal, activation and rollback are shared.
#[derive(Debug)]
pub struct LinuxProduct {
    /// Stable lifecycle contract consumed by the network-dark runner.
    pub activation: LinuxActivationProduct,
    /// Release-manifest platform whose target this product installs.
    pub platform: HostPlatform,
    /// Single top-level directory of the release archive.
    pub bundle_directory: &'static str,
    /// Other executables, relative to the payload, that a generation must contain.
    pub payload_executables: &'static [&'static str],
    /// Installer-only payload entries removed before a generation is published.
    pub bootstrap_only: &'static [&'static str],
    /// Stable runner executable under `<root>/bootstrap/`.
    pub bootstrap_guardian: &'static str,
    /// Version compiled into the running executable.
    pub running_version: &'static str,
}

/// The complete product knowledge allowed inside the stable activation runner.
#[derive(Debug)]
pub struct LinuxActivationProduct {
    /// Executable name at `bin/<name>` in every admitted generation.
    pub executable_name: &'static str,
    /// Fixed systemd unit of the service being updated.
    pub service_unit: &'static str,
    /// How long a restarted target may take to prove its health before it is
    /// rolled back; `None` waits until the operation's readiness deadline.
    pub ready_timeout: Option<Duration>,
}

/// Narrow runtime context exposed to product-owned health checks. It contains
/// lifecycle state only, never release delivery or package metadata.
#[derive(Clone, Debug)]
pub struct ServiceHealthContext {
    pub identity_pin: String,
    pub identity_manifest: PathBuf,
    pub pre_update_relay: crate::HostUpdateRelayState,
}

/// Product-owned proof that the restarted service is the exact generation and
/// that its long-lived identity survived the update.
pub trait ServiceHealth: Send + Sync {
    /// Current pin of the identity recorded before activation.
    fn identity_pin(&self, context: &ServiceHealthContext) -> Option<String>;

    /// Whether the service process runs exactly `expected` and is ready.
    fn serves(&self, expected: &GenerationMetadataV1, context: &ServiceHealthContext) -> bool;
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
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
    /// Signed authority retained by the replaceable product-side preparer.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub release: Option<SignedReleaseDescriptor>,
    /// Expected download size discovered before accepting the operation. The
    /// digest remains authoritative; the size is a resource bound.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub artifact_size: Option<u64>,
    /// `None` identifies an operation written by the older all-in-one runner.
    /// New operations become admitted only after a complete verified artifact
    /// is durably published for the activation guardian.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub activation_admitted: Option<bool>,
    /// Complete local generation accepted for activation. This is the only
    /// target contract consumed by the stable bootstrap runner.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub activation_target: Option<GenerationMetadataV1>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub progress: Option<HostUpdateProgress>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub recovery_error: Option<String>,
}

/// Which systemd manager owns the service lifecycle. The update protocol is
/// identical for user and system services; only the fixed manager invocation
/// differs at the product boundary.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum SystemdScope {
    User,
    System,
}

impl SystemdScope {
    fn command(self) -> Command {
        let mut command = Command::new("systemctl");
        if self == Self::User {
            command.arg("--user");
        }
        command
    }
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

/// Main PID of a systemd unit, if it is running.
#[must_use]
pub fn main_pid(scope: SystemdScope, unit: &str) -> Option<u32> {
    scope
        .command()
        .args(["show", "--property", "MainPID", "--value", unit])
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
