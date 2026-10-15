//! Relay remote updates on the shared Linux generation updater.
//!
//! `codewide-host-update` owns the signed release, durable journal, immutable
//! generations, the single atomic `current` switch and rollback. This module
//! declares the Relay payload, proves the restarted Relay's health through its
//! control socket, and keeps the established `/relay/update` wire shapes for
//! Companions, which act as the initiating device of an update.

use std::{
    fs,
    path::{Path, PathBuf},
    sync::Arc,
    time::Duration,
};

use codewide_host_update::{
    ApplyHostUpdateAccepted, ApplyHostUpdateCommand, GuardianError, GuardianErrorCode,
    HostPlatform, HostUpdateCapability, HostUpdateGuardian, HostUpdateOperation, HostUpdatePhase,
    HostUpdateProgress, HostUpdateRelayState, HostUpdateStatus, LOCAL_ADMINISTRATOR_DEVICE_ID,
    ReconnectReceipt, ReleaseTrust,
    linux::{
        GenerationMetadataV1, LinuxActivationProduct, LinuxGuardianConfig, LinuxHostUpdateGuardian,
        LinuxProduct, ServiceHealth, ServiceHealthContext, SystemdScope, main_pid,
    },
};
use serde::{Deserialize, Serialize};

use crate::{admin, transport_tls::RelayTlsIdentity};

/// Name of the guardian state directory inside the Relay state root.
pub const GUARDIAN_STATE: &str = "host-update";

pub static RELAY: LinuxProduct = LinuxProduct {
    activation: LinuxActivationProduct {
        executable_name: "codewide-relay",
        service_unit: "codewide-relay.service",
        // A healthy Relay attests within a second of starting.
        ready_timeout: Some(Duration::from_secs(30)),
    },
    platform: HostPlatform::RelayLinuxX86_64,
    bundle_directory: "codewide-relay-x86_64-unknown-linux-musl",
    payload_executables: &[],
    bootstrap_only: &["bootstrap", "systemd", "install.sh"],
    bootstrap_guardian: "codewide-relay-update-guardian",
    running_version: env!("CODEWIDE_RELAY_VERSION"),
};

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum RelayUpdatePhase {
    Accepted,
    Installing,
    TargetReady,
    AwaitingReconnect,
    Committed,
    RollingBack,
    RolledBack,
    Failed,
}

impl RelayUpdatePhase {
    #[must_use]
    pub const fn is_terminal(self) -> bool {
        matches!(self, Self::Committed | Self::RolledBack | Self::Failed)
    }
}

impl From<HostUpdatePhase> for RelayUpdatePhase {
    fn from(phase: HostUpdatePhase) -> Self {
        match phase {
            HostUpdatePhase::Accepted => Self::Accepted,
            HostUpdatePhase::Installing => Self::Installing,
            HostUpdatePhase::TargetReady => Self::TargetReady,
            HostUpdatePhase::AwaitingReconnect => Self::AwaitingReconnect,
            HostUpdatePhase::Committed => Self::Committed,
            HostUpdatePhase::RollingBack => Self::RollingBack,
            HostUpdatePhase::RolledBack => Self::RolledBack,
            HostUpdatePhase::Failed => Self::Failed,
        }
    }
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RelayUpdateCapability {
    pub api_version: u16,
    pub updater_contract_version: u16,
    pub journal_version: u16,
    pub bootstrap_version: u16,
    pub apply_supported: bool,
    pub unavailable_reason: Option<String>,
}

impl From<HostUpdateCapability> for RelayUpdateCapability {
    fn from(capability: HostUpdateCapability) -> Self {
        Self {
            api_version: capability.api_version,
            updater_contract_version: capability.guardian_contract_version,
            journal_version: capability.journal_version,
            bootstrap_version: capability.bootstrap_version,
            apply_supported: capability.apply_supported,
            unavailable_reason: capability.unavailable_reason,
        }
    }
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AvailableRelayUpdate {
    pub version: String,
    pub build: String,
    pub source_revision: String,
    pub target_fingerprint: String,
    pub release_sequence: u64,
    pub expires_at: u64,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RelayUpdateOperation {
    pub operation_id: String,
    pub phase: RelayUpdatePhase,
    pub current_version: String,
    pub target_version: String,
    pub target_fingerprint: String,
    pub started_at: u64,
    pub updated_at: u64,
    pub error_code: Option<String>,
    pub error_message: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub progress: Option<HostUpdateProgress>,
}

impl From<HostUpdateOperation> for RelayUpdateOperation {
    fn from(operation: HostUpdateOperation) -> Self {
        Self {
            operation_id: operation.operation_id,
            phase: operation.phase.into(),
            current_version: operation.current_version,
            target_version: operation.target_version,
            target_fingerprint: operation.target_fingerprint,
            started_at: operation.started_at,
            updated_at: operation.updated_at,
            error_code: operation.error_code,
            error_message: operation.error_message,
            progress: operation.progress,
        }
    }
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RelayUpdateStatus {
    pub current_version: String,
    pub current_build: String,
    pub current_source_revision: String,
    pub current_digest: String,
    pub capability: RelayUpdateCapability,
    pub available_target: Option<AvailableRelayUpdate>,
    pub active_operation: Option<RelayUpdateOperation>,
}

impl From<HostUpdateStatus> for RelayUpdateStatus {
    fn from(status: HostUpdateStatus) -> Self {
        Self {
            current_version: status.current_version,
            current_build: status.current_build,
            current_source_revision: status.current_source_revision,
            current_digest: status.current_digest,
            capability: status.capability.into(),
            available_target: status
                .available_target
                .map(|available| AvailableRelayUpdate {
                    version: available.target.version,
                    build: available.target.build,
                    source_revision: available.target.source_revision,
                    target_fingerprint: available.target_fingerprint,
                    release_sequence: available.release_sequence,
                    expires_at: available.expires_at,
                }),
            active_operation: status.active_operation.map(Into::into),
        }
    }
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ApplyRelayUpdateRequest {
    pub target_fingerprint: String,
    pub idempotency_key: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ApplyRelayUpdateAccepted {
    pub operation_id: String,
    pub phase: RelayUpdatePhase,
}

#[derive(Clone, Debug, thiserror::Error)]
#[error("{message}")]
pub struct RelayUpdateError {
    pub code: &'static str,
    pub message: String,
}

impl From<GuardianError> for RelayUpdateError {
    fn from(error: GuardianError) -> Self {
        Self {
            code: error.code.reason(),
            message: error.message,
        }
    }
}

/// In-process Relay update owner. Every Companion route is an initiating
/// device: it applies an update and proves the restarted Relay by reconnecting.
#[derive(Clone)]
pub struct RelayUpdater {
    guardian: Arc<LinuxHostUpdateGuardian>,
}

impl RelayUpdater {
    /// The guardian of a Relay installed as an immutable generation under
    /// `<install root>/generations/<digest>/bin/codewide-relay`. Any other
    /// installation reports `manual_bootstrap_required`.
    #[must_use]
    pub fn new(relay_state_root: &Path, identity_pin: String) -> Self {
        let guardian = Arc::new(LinuxHostUpdateGuardian::new(LinuxGuardianConfig {
            product: &RELAY,
            root: running_install_root().unwrap_or_else(|| relay_state_root.join("unmanaged")),
            state_root: relay_state_root.join(GUARDIAN_STATE),
            identity_pin,
            identity_manifest: relay_state_root.to_path_buf(),
            relay_probe: Arc::new(|| HostUpdateRelayState {
                configured: false,
                enabled: false,
                upstream_live: false,
            }),
            trust: ReleaseTrust::embedded(),
        }));
        guardian.resume_preparation();
        Self { guardian }
    }

    /// Reads the durable update state of this Relay.
    ///
    /// # Errors
    /// Returns an error when durable update state cannot be read.
    pub async fn status(&self) -> Result<RelayUpdateStatus, RelayUpdateError> {
        match self.guardian.status().await {
            Ok(status) => Ok(status.into()),
            Err(error) if error.code == GuardianErrorCode::ManualUpdateRequired => {
                Ok(unmanaged_status(self.guardian.capability()))
            }
            Err(error) => Err(error.into()),
        }
    }

    /// Downloads and admits the current signed release.
    ///
    /// # Errors
    /// Returns an error when the release cannot be downloaded or admitted.
    pub async fn check(&self) -> Result<RelayUpdateStatus, RelayUpdateError> {
        Ok(self.guardian.check().await?.into())
    }

    /// Durably queues one update operation initiated by a Companion route.
    ///
    /// # Errors
    /// Returns an error when the intent is invalid, unsafe, or cannot be persisted.
    pub async fn apply(
        &self,
        route_id: &str,
        request: ApplyRelayUpdateRequest,
    ) -> Result<ApplyRelayUpdateAccepted, RelayUpdateError> {
        let accepted = self
            .guardian
            .apply(ApplyHostUpdateCommand {
                target_fingerprint: request.target_fingerprint,
                idempotency_key: request.idempotency_key,
                initiating_device_id: route_id.to_owned(),
            })
            .await?;
        Ok(ApplyRelayUpdateAccepted {
            operation_id: accepted.operation_id,
            phase: accepted.phase.into(),
        })
    }

    /// Reads one durable update operation.
    ///
    /// # Errors
    /// Returns an error when the operation does not exist or cannot be decoded.
    pub async fn operation(
        &self,
        operation_id: &str,
    ) -> Result<RelayUpdateOperation, RelayUpdateError> {
        Ok(self.guardian.operation(operation_id).await?.into())
    }

    /// Commits an update when its initiating route reconnected to the target.
    ///
    /// # Errors
    /// Returns an error when the receipt is stale, from another route, or the
    /// operation is not awaiting reconnect.
    pub async fn reconnect(
        &self,
        route_id: &str,
        operation_id: &str,
    ) -> Result<RelayUpdateOperation, RelayUpdateError> {
        Ok(self
            .guardian
            .reconnect(ReconnectReceipt {
                operation_id: operation_id.to_owned(),
                device_id: route_id.to_owned(),
            })
            .await?
            .into())
    }

    /// Admits the current signed release for an update started at this
    /// host's terminal (`codewide-relay update`).
    ///
    /// # Errors
    /// Returns an error when the release cannot be downloaded or admitted, or
    /// this installation cannot update itself.
    pub async fn local_check(&self) -> Result<HostUpdateStatus, GuardianError> {
        self.guardian.check().await
    }

    /// Queues an update whose initiating device is the local administrator.
    ///
    /// # Errors
    /// Returns an error when the intent is invalid, unsafe, or cannot be persisted.
    pub async fn local_apply(
        &self,
        target_fingerprint: String,
        idempotency_key: String,
    ) -> Result<ApplyHostUpdateAccepted, GuardianError> {
        self.guardian
            .apply(ApplyHostUpdateCommand {
                target_fingerprint,
                idempotency_key,
                initiating_device_id: LOCAL_ADMINISTRATOR_DEVICE_ID.to_owned(),
            })
            .await
    }

    /// Reads one durable update operation for the terminal.
    ///
    /// # Errors
    /// Returns an error when the operation does not exist or cannot be decoded.
    pub async fn local_operation(
        &self,
        operation_id: &str,
    ) -> Result<HostUpdateOperation, GuardianError> {
        self.guardian.operation(operation_id).await
    }

    /// Commits a terminal-started update once the terminal reached the
    /// restarted Relay.
    ///
    /// # Errors
    /// Returns an error when the receipt is stale, the update was started by
    /// another device, or the operation is not awaiting reconnect.
    pub async fn local_reconnect(
        &self,
        operation_id: &str,
    ) -> Result<HostUpdateOperation, GuardianError> {
        self.guardian
            .reconnect(ReconnectReceipt {
                operation_id: operation_id.to_owned(),
                device_id: LOCAL_ADMINISTRATOR_DEVICE_ID.to_owned(),
            })
            .await
    }

    /// Records that the initiating Companion reached the restarted Relay. The
    /// connection may arrive before the runner has proved readiness, so wait
    /// for `awaitingReconnect` until the operation leaves its active phases.
    pub async fn observe_route_reconnect(&self, route_id: &str) {
        loop {
            let Ok(status) = self.guardian.status().await else {
                return;
            };
            let Some(operation) = status.active_operation else {
                return;
            };
            match operation.phase {
                HostUpdatePhase::AwaitingReconnect => {
                    let _ = self.reconnect(route_id, &operation.operation_id).await;
                    return;
                }
                HostUpdatePhase::Installing | HostUpdatePhase::TargetReady => {
                    tokio::time::sleep(Duration::from_millis(500)).await;
                }
                _ => return,
            }
        }
    }
}

fn unmanaged_status(capability: HostUpdateCapability) -> RelayUpdateStatus {
    let source_revision = env!("CODEWIDE_RELAY_SOURCE_REVISION").to_owned();
    RelayUpdateStatus {
        current_version: env!("CODEWIDE_RELAY_VERSION").to_owned(),
        current_build: source_revision.chars().take(12).collect(),
        current_source_revision: source_revision,
        current_digest: String::new(),
        capability: capability.into(),
        available_target: None,
        active_operation: None,
    }
}

/// `<root>` of a Relay running from `<root>/generations/<digest>/bin/<name>`.
fn running_install_root() -> Option<PathBuf> {
    let executable = fs::canonicalize(std::env::current_exe().ok()?).ok()?;
    let generations = executable.parent()?.parent()?.parent()?;
    (generations.file_name()? == "generations")
        .then(|| generations.parent().map(Path::to_path_buf))?
}

/// Proves that the Relay service runs the exact generation through its
/// private control socket and kept its TLS identity.
pub struct RelayHealth;

impl ServiceHealth for RelayHealth {
    fn identity_pin(&self, context: &ServiceHealthContext) -> Option<String> {
        RelayTlsIdentity::load_existing(&context.identity_manifest)
            .ok()
            .map(|identity| identity.pin())
    }

    fn serves(&self, expected: &GenerationMetadataV1, context: &ServiceHealthContext) -> bool {
        let Some(pid) = main_pid(SystemdScope::User, RELAY.activation.service_unit) else {
            return false;
        };
        let socket = context.identity_manifest.join(admin::SOCKET);
        admin::attest_blocking(&socket, Duration::from_secs(2)).is_some_and(|artifact| {
            artifact.process_id == pid
                && artifact.version == expected.version
                && artifact.build == expected.build
                && artifact.source_revision == expected.source_revision
                && artifact.artifact_digest == expected.artifact_digest
        })
    }
}

/// Runs one queued Relay update from the stable bootstrap executable.
///
/// # Errors
/// Returns an error when the durable journal is corrupt or the runner cannot
/// persist, activate, verify, or roll back a generation.
pub async fn run_pending(
    install_root: PathBuf,
    state_root: PathBuf,
) -> Result<(), Box<dyn std::error::Error>> {
    codewide_host_update::linux::run_pending(
        &RELAY.activation,
        &RelayHealth,
        install_root,
        state_root,
        SystemdScope::User,
    )
    .await
}

#[cfg(test)]
mod tests {
    use super::*;
    use codewide_host_update::{AvailableHostUpdate, HostUpdateRunningArtifact, ReleaseTargetV1};
    use std::io::{Read as _, Write as _};

    #[test]
    fn relay_status_keeps_its_flat_wire_shape() -> Result<(), Box<dyn std::error::Error>> {
        let status = RelayUpdateStatus::from(HostUpdateStatus {
            platform: HostPlatform::RelayLinuxX86_64,
            current_version: "0.6.2".to_owned(),
            current_build: "aaaaaaaaaaaa".to_owned(),
            current_source_revision: "a".repeat(40),
            current_digest: "b".repeat(64),
            capability: HostUpdateCapability::disabled("manual_bootstrap_required"),
            available_target: Some(AvailableHostUpdate {
                target: ReleaseTargetV1 {
                    platform: HostPlatform::RelayLinuxX86_64,
                    version: "0.6.3".to_owned(),
                    build: "cccccccccccc".to_owned(),
                    source_revision: "c".repeat(40),
                    artifact_url: "https://github.com/MrFlashAccount/CodeWide/releases/download/r/relay.tar.gz".to_owned(),
                    sha256: "d".repeat(64),
                    bootstrap_version: 1,
                    journal_version: 1,
                    state_epoch: 1,
                    rollback_compatible_from: vec!["b".repeat(64)],
                },
                target_fingerprint: "e".repeat(64),
                release_sequence: 7,
                expires_at: 9,
            }),
            active_operation: Some(HostUpdateOperation {
                operation_id: "upd_1".to_owned(),
                phase: HostUpdatePhase::TargetReady,
                current_version: "0.6.2".to_owned(),
                target_version: "0.6.3".to_owned(),
                target_fingerprint: "e".repeat(64),
                started_at: 1,
                updated_at: 2,
                error_code: None,
                error_message: None,
                progress: None,
            }),
        });
        let json = serde_json::to_value(status)?;
        assert_eq!(json["availableTarget"]["version"], "0.6.3");
        assert_eq!(json["availableTarget"]["targetFingerprint"], "e".repeat(64));
        assert_eq!(json["capability"]["updaterContractVersion"], 0);
        assert_eq!(json["activeOperation"]["phase"], "targetReady");
        assert!(json["activeOperation"].get("progress").is_none());
        Ok(())
    }

    #[test]
    fn attestation_is_read_without_an_async_runtime() -> Result<(), Box<dyn std::error::Error>> {
        let directory = tempfile::tempdir()?;
        let socket = directory.path().join(admin::SOCKET);
        let listener = std::os::unix::net::UnixListener::bind(&socket)?;
        let server = std::thread::spawn(move || -> Result<(), String> {
            let (mut stream, _) = listener.accept().map_err(|error| error.to_string())?;
            let mut length = [0_u8; 4];
            stream
                .read_exact(&mut length)
                .map_err(|error| error.to_string())?;
            let length =
                usize::try_from(u32::from_be_bytes(length)).map_err(|error| error.to_string())?;
            let mut request = vec![0; length];
            stream
                .read_exact(&mut request)
                .map_err(|error| error.to_string())?;
            if request != br#"{"command":"attest"}"# {
                return Err(String::from_utf8_lossy(&request).into_owned());
            }
            let reply = serde_json::to_vec(&admin::Reply::Attestation {
                artifact: Some(HostUpdateRunningArtifact {
                    process_id: 42,
                    version: "0.6.3".to_owned(),
                    build: "cccccccccccc".to_owned(),
                    source_revision: "c".repeat(40),
                    artifact_digest: "d".repeat(64),
                }),
            })
            .map_err(|error| error.to_string())?;
            let length = u32::try_from(reply.len()).map_err(|error| error.to_string())?;
            stream
                .write_all(&length.to_be_bytes())
                .and_then(|()| stream.write_all(&reply))
                .map_err(|error| error.to_string())
        });
        let artifact = admin::attest_blocking(&socket, Duration::from_secs(2));
        server.join().map_err(|_| "attestation server panicked")??;
        assert_eq!(artifact.map(|value| value.process_id), Some(42));
        Ok(())
    }
}
