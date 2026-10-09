//! Linux implementation of the authenticated Companion host-update contract.
//!
//! The running Companion admits only a pinned, signed release descriptor and
//! durably queues an operation. A stable bootstrap copy of the same executable
//! performs activation and rollback under systemd, so replacing or killing the
//! payload process cannot strand the installation.

mod runner;
mod runner_health;
mod store;

use std::{
    fs,
    os::unix::fs::MetadataExt,
    path::{Path, PathBuf},
    process::Command,
    sync::Arc,
    time::{SystemTime, UNIX_EPOCH},
};

use async_trait::async_trait;
use companion_core::host_update::{
    ApplyHostUpdateAccepted, ApplyHostUpdateCommand, AvailableHostUpdate, GuardianError,
    GuardianErrorCode, HOST_UPDATE_API_VERSION, HOST_UPDATE_BOOTSTRAP_VERSION,
    HOST_UPDATE_GUARDIAN_CONTRACT_VERSION, HOST_UPDATE_JOURNAL_VERSION, HostPlatform,
    HostUpdateCapability, HostUpdateDeadlines, HostUpdateGuardian, HostUpdateJournalV1,
    HostUpdateOperation, HostUpdatePhase, HostUpdateRelayState, HostUpdateStatus, ReconnectReceipt,
    ReleaseAdmission, ReleaseAdmissionError, ReleaseTargetV1, SignedReleaseDescriptor,
    admit_signed_release, verify_signed_release_descriptor,
};
use serde::{Deserialize, Serialize};
use tokio::sync::Mutex;

const DEFAULT_MANIFEST_URL: &str =
    "https://github.com/MrFlashAccount/CodeWide/releases/latest/download/release-manifest.json";
const MINIMUM_FREE_BYTES: u64 = 512 * 1024 * 1024;
const RETAIN_TERMINAL_OPERATIONS: usize = 32;

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct BootstrapConfigV1 {
    pub schema_version: u16,
    pub key_id: String,
    pub public_key_spki: String,
    #[serde(default = "default_manifest_url")]
    pub manifest_url: String,
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

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct CachedRelease {
    envelope: SignedReleaseDescriptor,
    available: AvailableHostUpdate,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct OperationRecord {
    pub journal: HostUpdateJournalV1,
    pub idempotency_key: String,
    pub current: GenerationMetadataV1,
    pub target: ReleaseTargetV1,
    pub release_sequence: u64,
    pub identity_pin: String,
    pub identity_manifest: PathBuf,
    pub previous_generation: String,
}

#[derive(Clone)]
pub struct LinuxHostUpdateGuardian {
    inner: Arc<GuardianInner>,
}

struct GuardianInner {
    root: PathBuf,
    state_root: PathBuf,
    identity_pin: String,
    identity_manifest: PathBuf,
    relay_probe: Arc<dyn Fn() -> HostUpdateRelayState + Send + Sync>,
    in_process: Mutex<()>,
}

impl LinuxHostUpdateGuardian {
    #[must_use]
    pub fn new(
        root: PathBuf,
        state_root: PathBuf,
        identity_pin: String,
        relay: HostUpdateRelayState,
    ) -> Self {
        Self::with_relay_probe(
            root,
            state_root,
            identity_pin,
            default_identity_manifest(),
            Arc::new(move || relay.clone()),
        )
    }

    #[must_use]
    pub fn new_with_runtime(
        root: PathBuf,
        state_root: PathBuf,
        identity_pin: String,
        identity_manifest: PathBuf,
        relay: companion_core::relay::RelayRuntime,
    ) -> Self {
        Self::with_relay_probe(
            root,
            state_root,
            identity_pin,
            identity_manifest,
            Arc::new(move || {
                relay.status().map_or(
                    HostUpdateRelayState {
                        configured: false,
                        enabled: false,
                        upstream_live: false,
                    },
                    |status| HostUpdateRelayState {
                        configured: status.configured,
                        enabled: status.enabled,
                        upstream_live: matches!(
                            status.connection,
                            companion_core::relay::RelayConnectionStatus::Online
                        ),
                    },
                )
            }),
        )
    }

    fn with_relay_probe(
        root: PathBuf,
        state_root: PathBuf,
        identity_pin: String,
        identity_manifest: PathBuf,
        relay_probe: Arc<dyn Fn() -> HostUpdateRelayState + Send + Sync>,
    ) -> Self {
        Self {
            inner: Arc::new(GuardianInner {
                state_root,
                root,
                identity_pin,
                identity_manifest,
                relay_probe,
                in_process: Mutex::new(()),
            }),
        }
    }

    #[must_use]
    pub fn default_root() -> PathBuf {
        std::env::var_os("CODEWIDE_COMPANION_INSTALL_ROOT").map_or_else(
            || {
                std::env::var_os("HOME").map_or_else(
                    || PathBuf::from(".local/lib/codewide"),
                    |home| PathBuf::from(home).join(".local/lib/codewide"),
                )
            },
            PathBuf::from,
        )
    }

    #[must_use]
    pub fn default_state_root() -> PathBuf {
        std::env::var_os("XDG_STATE_HOME").map_or_else(
            || {
                std::env::var_os("HOME").map_or_else(
                    || PathBuf::from(".local/state/codewide/host-update"),
                    |home| PathBuf::from(home).join(".local/state/codewide/host-update"),
                )
            },
            |root| PathBuf::from(root).join("codewide/host-update"),
        )
    }

    fn bootstrap(&self) -> Result<BootstrapConfigV1, GuardianError> {
        let bootstrap_root = self.inner.root.join("bootstrap");
        let config_path = bootstrap_root.join("config.json");
        let guardian_path = bootstrap_root.join("codewide-companion-update-guardian");
        let directory = fs::symlink_metadata(&bootstrap_root)
            .map_err(|_| manual("manual_bootstrap_required"))?;
        let config_metadata =
            fs::symlink_metadata(&config_path).map_err(|_| manual("manual_bootstrap_required"))?;
        let guardian_metadata = fs::symlink_metadata(&guardian_path)
            .map_err(|_| manual("manual_bootstrap_required"))?;
        if !directory.is_dir()
            || directory.mode() & 0o077 != 0
            || !config_metadata.is_file()
            || config_metadata.file_type().is_symlink()
            || config_metadata.mode() & 0o077 != 0
            || config_metadata.uid() != directory.uid()
            || !guardian_metadata.is_file()
            || guardian_metadata.file_type().is_symlink()
            || guardian_metadata.mode() & 0o111 == 0
            || guardian_metadata.mode() & 0o022 != 0
            || guardian_metadata.uid() != directory.uid()
        {
            return Err(manual("manual_bootstrap_required"));
        }
        let config: BootstrapConfigV1 =
            store::read_json(&config_path).map_err(|_| manual("manual_bootstrap_required"))?;
        if config.schema_version != HOST_UPDATE_BOOTSTRAP_VERSION
            || config.manifest_url != DEFAULT_MANIFEST_URL
            || config.key_id.is_empty()
            || config.public_key_spki.is_empty()
        {
            return Err(manual("manual_bootstrap_required"));
        }
        Ok(config)
    }

    fn current(&self) -> Result<GenerationMetadataV1, GuardianError> {
        let current = self.inner.root.join("current");
        let metadata = current.join("metadata.json");
        if !fs::symlink_metadata(&current).is_ok_and(|value| value.file_type().is_symlink()) {
            return Err(manual("manual_bootstrap_required"));
        }
        let target = self.current_link()?;
        let value: GenerationMetadataV1 =
            store::read_json(&metadata).map_err(|_| manual("manual_bootstrap_required"))?;
        if target != format!("generations/{}", value.artifact_digest)
            || !lower_hex(&value.artifact_digest, 64)
            || !lower_hex(&value.source_revision, 40)
        {
            return Err(manual("manual_bootstrap_required"));
        }
        Ok(value)
    }

    fn current_link(&self) -> Result<String, GuardianError> {
        let target = fs::read_link(self.inner.root.join("current"))
            .map_err(|_| manual("manual_bootstrap_required"))?;
        let target = target
            .to_str()
            .ok_or_else(|| manual("manual_bootstrap_required"))?;
        let Some(digest) = target.strip_prefix("generations/") else {
            return Err(manual("manual_bootstrap_required"));
        };
        if !lower_hex(digest, 64) || digest.contains('/') {
            return Err(manual("manual_bootstrap_required"));
        }
        Ok(target.to_owned())
    }

    fn operation_path(&self, operation_id: &str) -> PathBuf {
        self.inner
            .state_root
            .join("operations")
            .join(format!("{operation_id}.json"))
    }

    fn active_operation(&self) -> Result<Option<OperationRecord>, GuardianError> {
        let Some(operation_id) =
            store::read_optional_json::<String>(&self.inner.state_root.join("active.json"))
                .map_err(internal)?
        else {
            return Ok(None);
        };
        let operation =
            store::read_optional_json(&self.operation_path(&operation_id)).map_err(internal)?;
        Ok(operation.filter(|value: &OperationRecord| !value.journal.phase.is_terminal()))
    }

    fn highest_sequence(&self) -> Result<u64, GuardianError> {
        let mut highest =
            store::read_optional_json::<u64>(&self.inner.state_root.join("highest-sequence.json"))
                .map_err(internal)?
                .unwrap_or(0);
        let Ok(entries) = fs::read_dir(self.inner.state_root.join("operations")) else {
            return Ok(highest);
        };
        for entry in entries {
            let entry = entry.map_err(internal)?;
            if let Ok(operation) = store::read_json::<OperationRecord>(&entry.path()) {
                highest = highest.max(operation.release_sequence);
            }
        }
        Ok(highest)
    }

    fn read_operation(&self, operation_id: &str) -> Result<OperationRecord, GuardianError> {
        store::read_optional_json(&self.operation_path(operation_id))
            .map_err(internal)?
            .ok_or_else(|| GuardianError::new(GuardianErrorCode::NotFound, "operation_not_found"))
    }

    fn status_inner(&self) -> Result<HostUpdateStatus, GuardianError> {
        let current = self.current()?;
        let available = store::read_optional_json::<CachedRelease>(
            &self.inner.state_root.join("available.json"),
        )
        .map_err(internal)?
        .map(|value| value.available);
        let active_operation = self.active_operation()?.map(|value| operation_view(&value));
        Ok(HostUpdateStatus {
            platform: HostPlatform::LinuxX86_64,
            current_version: current.version,
            current_build: current.build,
            current_source_revision: current.source_revision,
            current_digest: current.artifact_digest,
            capability: self.capability(),
            available_target: available,
            active_operation,
        })
    }
}

#[async_trait]
impl HostUpdateGuardian for LinuxHostUpdateGuardian {
    fn capability(&self) -> HostUpdateCapability {
        if self.bootstrap().is_err() || self.current().is_err() {
            return HostUpdateCapability::disabled("manual_bootstrap_required");
        }
        HostUpdateCapability {
            api_version: HOST_UPDATE_API_VERSION,
            guardian_contract_version: HOST_UPDATE_GUARDIAN_CONTRACT_VERSION,
            journal_version: HOST_UPDATE_JOURNAL_VERSION,
            bootstrap_version: HOST_UPDATE_BOOTSTRAP_VERSION,
            apply_supported: true,
            unavailable_reason: None,
        }
    }

    async fn status(&self) -> Result<HostUpdateStatus, GuardianError> {
        self.status_inner()
    }

    async fn check(&self) -> Result<HostUpdateStatus, GuardianError> {
        let _process = self.inner.in_process.lock().await;
        let bootstrap = self.bootstrap()?;
        let current = self.current()?;
        let envelope = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(15))
            .redirect(reqwest::redirect::Policy::limited(3))
            .build()
            .map_err(internal)?
            .get(&bootstrap.manifest_url)
            .send()
            .await
            .map_err(|_| precondition("release_manifest_unavailable"))?
            .error_for_status()
            .map_err(|_| precondition("release_manifest_unavailable"))?
            .json::<SignedReleaseDescriptor>()
            .await
            .map_err(|_| precondition("release_manifest_invalid"))?;
        let highest_sequence = self.highest_sequence()?;
        let verified = verify_signed_release_descriptor(
            &envelope,
            &bootstrap.public_key_spki,
            unix_seconds(),
            &bootstrap.key_id,
        )
        .map_err(|error| precondition(&format!("release_not_eligible:{error}")))?;
        let matching_targets = verified
            .targets
            .iter()
            .filter(|target| target.platform == HostPlatform::LinuxX86_64)
            .collect::<Vec<_>>();
        if matching_targets.len() == 1
            && matching_targets[0].version == current.version
            && matching_targets[0].sha256 == current.artifact_digest
        {
            store::write_json(
                &self.inner.state_root.join("highest-sequence.json"),
                &highest_sequence.max(verified.sequence),
            )
            .map_err(internal)?;
            remove_if_present(&self.inner.state_root.join("available.json"))?;
            return self.status_inner();
        }
        let admission = ReleaseAdmission {
            trusted_key_id: &bootstrap.key_id,
            platform: HostPlatform::LinuxX86_64,
            current_version: &current.version,
            current_digest: &current.artifact_digest,
            highest_sequence,
            state_epoch: 1,
            bootstrap_version: HOST_UPDATE_BOOTSTRAP_VERSION,
            journal_version: HOST_UPDATE_JOURNAL_VERSION,
        };
        let (descriptor, target, target_fingerprint) = admit_signed_release(
            &envelope,
            &bootstrap.public_key_spki,
            unix_seconds(),
            &admission,
        )
        .map_err(admission_error)?;
        let available = AvailableHostUpdate {
            target,
            target_fingerprint,
            release_sequence: descriptor.sequence,
            expires_at: descriptor.expires_at,
        };
        store::write_json(
            &self.inner.state_root.join("available.json"),
            &CachedRelease {
                envelope,
                available,
            },
        )
        .map_err(internal)?;
        self.status_inner()
    }

    #[allow(clippy::too_many_lines)]
    async fn apply(
        &self,
        command: ApplyHostUpdateCommand,
    ) -> Result<ApplyHostUpdateAccepted, GuardianError> {
        let _process = self.inner.in_process.lock().await;
        let _lock = store::lock(&self.inner.state_root.join("guardian.lock")).map_err(internal)?;
        let bootstrap = self.bootstrap()?;
        let current = self.current()?;
        let cached: CachedRelease = store::read_json(&self.inner.state_root.join("available.json"))
            .map_err(|_| precondition("update_check_required"))?;
        if cached.available.target_fingerprint != command.target_fingerprint {
            return Err(precondition("target_fingerprint_changed"));
        }
        if let Some(active) = self.active_operation()? {
            if active.idempotency_key == command.idempotency_key
                && active.journal.initiating_device_id == command.initiating_device_id
                && active.journal.target_fingerprint == command.target_fingerprint
            {
                start_runner()?;
                return Ok(ApplyHostUpdateAccepted {
                    operation_id: active.journal.operation_id,
                    phase: HostUpdatePhase::Accepted,
                });
            }
            return Err(GuardianError::new(
                GuardianErrorCode::Locked,
                "another_update_is_active",
            ));
        }
        if let Some(existing) = find_idempotency(&self.inner.state_root, &command.idempotency_key)?
        {
            if existing.journal.initiating_device_id == command.initiating_device_id
                && existing.journal.target_fingerprint == command.target_fingerprint
            {
                return Ok(ApplyHostUpdateAccepted {
                    operation_id: existing.journal.operation_id,
                    phase: HostUpdatePhase::Accepted,
                });
            }
            return Err(GuardianError::new(
                GuardianErrorCode::IdempotencyConflict,
                "idempotency_key_reused",
            ));
        }
        if cached.available.release_sequence <= self.highest_sequence()? {
            return Err(precondition("release_sequence_replayed"));
        }
        let admission = ReleaseAdmission {
            trusted_key_id: &bootstrap.key_id,
            platform: HostPlatform::LinuxX86_64,
            current_version: &current.version,
            current_digest: &current.artifact_digest,
            highest_sequence: cached.available.release_sequence.saturating_sub(1),
            state_epoch: 1,
            bootstrap_version: HOST_UPDATE_BOOTSTRAP_VERSION,
            journal_version: HOST_UPDATE_JOURNAL_VERSION,
        };
        let (descriptor, admitted_target, admitted_fingerprint) = admit_signed_release(
            &cached.envelope,
            &bootstrap.public_key_spki,
            unix_seconds(),
            &admission,
        )
        .map_err(admission_error)?;
        if descriptor.sequence != cached.available.release_sequence
            || descriptor.expires_at != cached.available.expires_at
            || admitted_target != cached.available.target
            || admitted_fingerprint != cached.available.target_fingerprint
        {
            return Err(precondition("cached_release_mismatch"));
        }
        let content_length = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(15))
            .redirect(reqwest::redirect::Policy::limited(3))
            .build()
            .map_err(internal)?
            .head(&cached.available.target.artifact_url)
            .send()
            .await
            .map_err(|_| precondition("artifact_size_unavailable"))?
            .error_for_status()
            .map_err(|_| precondition("artifact_size_unavailable"))?
            .content_length()
            .ok_or_else(|| precondition("artifact_size_unavailable"))?;
        let required_bytes = content_length
            .saturating_mul(4)
            .saturating_add(128 * 1024 * 1024)
            .max(MINIMUM_FREE_BYTES);
        if free_bytes(&self.inner.root).map_err(internal)? < required_bytes {
            return Err(precondition("insufficient_free_space"));
        }
        let now = unix_millis();
        let operation_id = random_id("upd")?;
        let nonce = random_id("fence")?;
        let previous_generation = self.current_link()?;
        let record = OperationRecord {
            journal: HostUpdateJournalV1 {
                journal_version: HOST_UPDATE_JOURNAL_VERSION,
                operation_id: operation_id.clone(),
                nonce,
                initiating_device_id: command.initiating_device_id,
                current_digest: current.artifact_digest.clone(),
                target_digest: cached.available.target.sha256.clone(),
                target_fingerprint: command.target_fingerprint,
                pre_update_relay: (self.inner.relay_probe)(),
                deadlines: HostUpdateDeadlines {
                    install_by: now + 5 * 60_000,
                    target_ready_by: now + 7 * 60_000,
                    reconnect_by: now + 9 * 60_000,
                    rollback_by: now + 12 * 60_000,
                },
                phase: HostUpdatePhase::Accepted,
                started_at: now,
                restart_started_at: None,
                updated_at: now,
                error_code: None,
                error_message: None,
            },
            idempotency_key: command.idempotency_key,
            current,
            target: cached.available.target,
            release_sequence: cached.available.release_sequence,
            identity_pin: self.inner.identity_pin.clone(),
            identity_manifest: self.inner.identity_manifest.clone(),
            previous_generation,
        };
        store::write_json(&self.operation_path(&operation_id), &record).map_err(internal)?;
        store::write_json(&self.inner.state_root.join("active.json"), &operation_id)
            .map_err(internal)?;
        store::write_json(
            &self.inner.state_root.join("highest-sequence.json"),
            &record.release_sequence,
        )
        .map_err(internal)?;
        prune_operations(&self.inner.state_root)?;
        start_runner()?;
        Ok(ApplyHostUpdateAccepted {
            operation_id,
            phase: HostUpdatePhase::Accepted,
        })
    }

    async fn operation(&self, operation_id: &str) -> Result<HostUpdateOperation, GuardianError> {
        self.read_operation(operation_id)
            .map(|value| operation_view(&value))
    }

    async fn reconnect(
        &self,
        receipt: ReconnectReceipt,
    ) -> Result<HostUpdateOperation, GuardianError> {
        let _process = self.inner.in_process.lock().await;
        let _lock = store::lock(&self.inner.state_root.join("guardian.lock")).map_err(internal)?;
        let path = self.operation_path(&receipt.operation_id);
        let mut operation: OperationRecord = store::read_optional_json(&path)
            .map_err(internal)?
            .ok_or_else(|| {
                GuardianError::new(GuardianErrorCode::NotFound, "operation_not_found")
            })?;
        let nonce = operation.journal.nonce.clone();
        operation
            .journal
            .accept_reconnect(&nonce, &receipt, unix_millis())
            .map_err(|_| precondition("invalid_reconnect_receipt"))?;
        store::write_json(&path, &operation).map_err(internal)?;
        store::write_json(
            &self.inner.state_root.join("highest-sequence.json"),
            &operation.release_sequence,
        )
        .map_err(internal)?;
        remove_if_present(&self.inner.state_root.join("available.json"))?;
        Ok(operation_view(&operation))
    }
}

fn operation_view(value: &OperationRecord) -> HostUpdateOperation {
    HostUpdateOperation {
        operation_id: value.journal.operation_id.clone(),
        phase: value.journal.phase,
        current_version: value.current.version.clone(),
        target_version: value.target.version.clone(),
        target_fingerprint: value.journal.target_fingerprint.clone(),
        started_at: value.journal.started_at,
        updated_at: value.journal.updated_at,
        error_code: value.journal.error_code.clone(),
        error_message: value.journal.error_message.clone(),
    }
}

fn find_idempotency(root: &Path, key: &str) -> Result<Option<OperationRecord>, GuardianError> {
    let operations = root.join("operations");
    let Ok(entries) = fs::read_dir(operations) else {
        return Ok(None);
    };
    for entry in entries {
        let entry = entry.map_err(internal)?;
        if entry
            .path()
            .extension()
            .is_some_and(|value| value == "json")
        {
            let operation: OperationRecord = store::read_json(&entry.path()).map_err(internal)?;
            if operation.idempotency_key == key {
                return Ok(Some(operation));
            }
        }
    }
    Ok(None)
}

fn prune_operations(root: &Path) -> Result<(), GuardianError> {
    let operations = root.join("operations");
    let Ok(entries) = fs::read_dir(&operations) else {
        return Ok(());
    };
    let mut terminal = Vec::new();
    for entry in entries {
        let entry = entry.map_err(internal)?;
        let record: OperationRecord = match store::read_json(&entry.path()) {
            Ok(value) => value,
            Err(_) => continue,
        };
        if record.journal.phase.is_terminal() {
            terminal.push((record.journal.updated_at, entry.path()));
        }
    }
    terminal.sort_by_key(|value| std::cmp::Reverse(value.0));
    for (_, path) in terminal.into_iter().skip(RETAIN_TERMINAL_OPERATIONS) {
        fs::remove_file(path).map_err(internal)?;
    }
    Ok(())
}

fn remove_if_present(path: &Path) -> Result<(), GuardianError> {
    match fs::remove_file(path) {
        Ok(()) => {
            if let Some(parent) = path.parent() {
                store::sync_directory(parent).map_err(internal)?;
            }
            Ok(())
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(internal(error)),
    }
}

fn random_id(prefix: &str) -> Result<String, GuardianError> {
    let mut bytes = [0_u8; 16];
    rand::TryRngCore::try_fill_bytes(&mut rand::rngs::OsRng, &mut bytes).map_err(internal)?;
    Ok(format!("{prefix}_{}", hex::encode(bytes)))
}

fn lower_hex(value: &str, length: usize) -> bool {
    value.len() == length
        && value
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
}

fn start_runner() -> Result<(), GuardianError> {
    if Command::new("systemctl")
        .args([
            "--user",
            "start",
            "--no-block",
            "codewide-companion-update.service",
        ])
        .status()
        .is_ok_and(|status| status.success())
    {
        Ok(())
    } else {
        Err(GuardianError::new(
            GuardianErrorCode::Internal,
            "update_runner_unavailable",
        ))
    }
}

fn unix_seconds() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |value| value.as_secs())
}

pub(super) fn unix_millis() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |value| value.as_millis().try_into().unwrap_or(u64::MAX))
}

fn free_bytes(path: &Path) -> std::io::Result<u64> {
    fs2::available_space(path)
}

fn default_manifest_url() -> String {
    DEFAULT_MANIFEST_URL.to_owned()
}

fn default_identity_manifest() -> PathBuf {
    std::env::var_os("HOME").map_or_else(
        || PathBuf::from(".local/state/codewide/companion/identity/identity.json"),
        |home| PathBuf::from(home).join(".local/state/codewide/companion/identity/identity.json"),
    )
}

fn manual(message: &str) -> GuardianError {
    GuardianError::new(GuardianErrorCode::ManualUpdateRequired, message)
}

fn precondition(message: &str) -> GuardianError {
    GuardianError::new(GuardianErrorCode::PreconditionFailed, sanitize(message))
}

fn admission_error(error: ReleaseAdmissionError) -> GuardianError {
    match error {
        ReleaseAdmissionError::UnsupportedGuardianContract
        | ReleaseAdmissionError::IncompatibleStateEpoch
        | ReleaseAdmissionError::RollbackIncompatible => manual("manual_update_required"),
        other => precondition(&format!("release_not_eligible:{other}")),
    }
}

fn internal(error: impl std::fmt::Display) -> GuardianError {
    tracing::error!(reason = %error, "Linux host-update guardian failed");
    GuardianError::new(GuardianErrorCode::Internal, "update_internal_error")
}

fn sanitize(value: &str) -> String {
    value.chars().take(160).collect()
}

/// Runs one queued operation from the stable bootstrap executable.
///
/// # Errors
/// Returns an error when the durable journal is corrupt or the platform runner
/// cannot persist, activate, verify, or roll back a generation.
pub async fn run_pending(
    root: PathBuf,
    state_root: PathBuf,
) -> Result<(), Box<dyn std::error::Error>> {
    runner::run_pending(root, state_root).await
}

#[cfg(test)]
#[allow(clippy::expect_used)]
#[path = "host_update/tests.rs"]
mod tests;
