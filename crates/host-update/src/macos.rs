//! Remote macOS updates installed by Sparkle.
//!
//! The runtime owns the device-facing contract: it checks the signed release
//! manifest, accepts and journals one operation, and hands a command to the
//! menu-bar app, which installs the confirmed release with Sparkle. Sparkle
//! verifies the archive with its own `EdDSA` key, replaces the bundle and
//! relaunches the app. The restarted runtime recognizes itself as the target
//! and waits for the initiating device to reconnect.
//!
//! Sparkle cannot roll back, so a failure before installation leaves the
//! previous version running and a broken release needs a manual reinstall.

use std::{
    fmt::Write as _,
    fs::{self, OpenOptions},
    io::{ErrorKind, Write as _},
    os::unix::fs::{OpenOptionsExt as _, PermissionsExt as _},
    path::{Path, PathBuf},
    sync::{Arc, OnceLock},
    time::{Duration, SystemTime, UNIX_EPOCH},
};

use async_trait::async_trait;
use rand::TryRngCore as _;
use serde::{Deserialize, Serialize, de::DeserializeOwned};
use tokio::sync::Mutex;

use crate::{
    ApplyHostUpdateAccepted, ApplyHostUpdateCommand, AvailableHostUpdate, GuardianError,
    GuardianErrorCode, HOST_UPDATE_API_VERSION, HOST_UPDATE_BOOTSTRAP_VERSION,
    HOST_UPDATE_GUARDIAN_CONTRACT_VERSION, HOST_UPDATE_JOURNAL_VERSION,
    HOST_UPDATE_UNOFFICIAL_BUILD_REASON, HostPlatform, HostUpdateCapability, HostUpdateDeadlines,
    HostUpdateGuardian, HostUpdateJournalV1, HostUpdateOperation, HostUpdatePhase,
    HostUpdateProgress, HostUpdateRelayState, HostUpdateStatus, ReconnectReceipt,
    ReleaseDescriptorV1, ReleaseTargetV1, ReleaseTrust, SignedReleaseDescriptor, is_newer_version,
    target_fingerprint, verify_signed_release_descriptor,
};

/// Reads the current Relay state for the operation record.
pub type RelayProbe = Box<dyn Fn() -> HostUpdateRelayState + Send + Sync>;

const DEFAULT_MANIFEST_URL: &str =
    "https://github.com/MrFlashAccount/CodeWide/releases/latest/download/release-manifest.json";
const MANIFEST_LIMIT_BYTES: usize = 1024 * 1024;
/// Highest release-target bootstrap contract this updater accepts. Version 2
/// marks releases installed by Sparkle alone; the earlier external guardian
/// accepts only version 1 and therefore refuses them.
const SPARKLE_BOOTSTRAP_VERSION: u16 = 2;
const STATE_EPOCH: u32 = 1;
/// A finished outcome stays visible to a phone that reconnects late.
const TERMINAL_OUTCOME_TTL_MS: u64 = 60 * 60_000;
const INSTALL_BUDGET_MS: u64 = 15 * 60_000;
const RECONNECT_BUDGET_MS: u64 = 25 * 60_000;

/// The installed release, read by the Swift runtime from its own bundle.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct InstalledRelease {
    pub version: String,
    pub build: String,
    pub source_revision: String,
}

/// Remote updater of the macOS runtime.
pub struct MacosSparkleUpdater {
    state_root: PathBuf,
    installed: InstalledRelease,
    trust: Option<ReleaseTrust>,
    relay: OnceLock<RelayProbe>,
    /// When this process started; a reconnect must be newer than the restart.
    started_at: u64,
    lock: Mutex<()>,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct OperationRecord {
    journal: HostUpdateJournalV1,
    idempotency_key: String,
    current_version: String,
    target: ReleaseTargetV1,
    release_sequence: u64,
    /// Latest Sparkle stage the app reported while installing.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    progress: Option<HostUpdateProgress>,
}

/// Command the menu-bar app executes with Sparkle.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct InstallCommand<'a> {
    operation_id: &'a str,
    nonce: &'a str,
    target_version: &'a str,
    target_build: &'a str,
}

/// Progress reported by the menu-bar app.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct InstallEvent {
    operation_id: String,
    nonce: String,
    kind: InstallEventKind,
    error_message: Option<String>,
    #[serde(default)]
    downloaded_bytes: Option<u64>,
    #[serde(default)]
    total_bytes: Option<u64>,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq)]
#[serde(rename_all = "camelCase")]
enum InstallEventKind {
    /// Sparkle is downloading the confirmed release.
    Downloading,
    /// Sparkle is extracting and validating the downloaded archive.
    Extracting,
    /// Sparkle verified the release and is about to replace the bundle.
    Installing,
    Failed,
}

impl InstallEvent {
    /// The stage this event reports, unless it ends the installation.
    fn progress(&self) -> Option<HostUpdateProgress> {
        match self.kind {
            InstallEventKind::Downloading => Some(HostUpdateProgress::Downloading {
                downloaded_bytes: self.downloaded_bytes.unwrap_or(0),
                total_bytes: self.total_bytes,
            }),
            InstallEventKind::Extracting => Some(HostUpdateProgress::Extracting),
            InstallEventKind::Installing => Some(HostUpdateProgress::Restarting),
            InstallEventKind::Failed => None,
        }
    }
}

impl MacosSparkleUpdater {
    #[must_use]
    pub fn new(updater_root: &Path, installed: InstalledRelease) -> Arc<Self> {
        Arc::new(Self {
            state_root: updater_root.join("v2"),
            installed,
            trust: ReleaseTrust::embedded(),
            relay: OnceLock::new(),
            started_at: unix_millis(),
            lock: Mutex::new(()),
        })
    }

    /// Supplies the Relay state each accepted operation records. The
    /// runtime's Relay exists only after the updater was handed to it.
    pub fn observe_relay(&self, probe: RelayProbe) {
        let _ = self.relay.set(probe);
    }

    fn trust(&self) -> Result<&ReleaseTrust, GuardianError> {
        self.trust
            .as_ref()
            .ok_or_else(|| manual(HOST_UPDATE_UNOFFICIAL_BUILD_REASON))
    }

    fn operation_path(&self, operation_id: &str) -> PathBuf {
        self.state_root
            .join("operations")
            .join(format!("{operation_id}.json"))
    }

    fn command_path(&self, operation_id: &str) -> PathBuf {
        self.state_root
            .join("commands")
            .join(format!("{operation_id}.json"))
    }

    fn event_path(&self, operation_id: &str) -> PathBuf {
        self.state_root
            .join("commands")
            .join(format!("{operation_id}.event.json"))
    }

    fn relay_state(&self) -> HostUpdateRelayState {
        self.relay.get().map_or(
            HostUpdateRelayState {
                configured: false,
                enabled: false,
                upstream_live: false,
            },
            |probe| probe(),
        )
    }

    fn installed_is(&self, target: &ReleaseTargetV1) -> bool {
        self.installed.version == target.version && self.installed.build == target.build
    }

    fn read_operation(&self, operation_id: &str) -> Result<OperationRecord, GuardianError> {
        if !valid_operation_id(operation_id) {
            return Err(not_found());
        }
        read_optional_json(&self.operation_path(operation_id))
            .map_err(internal)?
            .ok_or_else(not_found)
    }

    fn active_operation_id(&self) -> Result<Option<String>, GuardianError> {
        read_optional_json(&self.state_root.join("active.json")).map_err(internal)
    }

    /// Advances the operation from what the app reported and what this
    /// process is. Every change is persisted before it is reported.
    fn reconcile(&self, mut record: OperationRecord) -> Result<OperationRecord, GuardianError> {
        let now = unix_millis();
        let operation_id = record.journal.operation_id.clone();
        let nonce = record.journal.nonce.clone();
        let mut changed = false;
        if matches!(
            record.journal.phase,
            HostUpdatePhase::Accepted | HostUpdatePhase::Installing
        ) {
            let event = read_optional_json::<InstallEvent>(&self.event_path(&operation_id))
                .ok()
                .flatten()
                .filter(|event| event.operation_id == operation_id && event.nonce == nonce);
            if self.installed_is(&record.target) {
                // This process is the confirmed target: Sparkle installed and
                // relaunched it.
                if record.journal.phase == HostUpdatePhase::Accepted {
                    transition(&mut record, HostUpdatePhase::Installing, now)?;
                }
                record.journal.restart_started_at = Some(self.started_at);
                transition(&mut record, HostUpdatePhase::TargetReady, now)?;
                transition(&mut record, HostUpdatePhase::AwaitingReconnect, now)?;
                record.progress = None;
                changed = true;
            } else if let Some(event) = event
                .as_ref()
                .filter(|event| event.kind == InstallEventKind::Failed)
            {
                fail(
                    &mut record,
                    "sparkle_install_failed",
                    event
                        .error_message
                        .as_deref()
                        .unwrap_or("Sparkle could not install the update."),
                    now,
                )?;
                changed = true;
            } else if now > record.journal.deadlines.install_by {
                fail(
                    &mut record,
                    "install_timeout",
                    "The update was not installed before its deadline.",
                    now,
                )?;
                changed = true;
            } else if let Some(progress) = event.as_ref().and_then(InstallEvent::progress) {
                // Any reported stage means the app took the command.
                if record.journal.phase == HostUpdatePhase::Accepted {
                    transition(&mut record, HostUpdatePhase::Installing, now)?;
                    changed = true;
                }
                if record.progress.as_ref() != Some(&progress) {
                    record.progress = Some(progress);
                    changed = true;
                }
            }
        }
        if changed {
            write_json(&self.operation_path(&operation_id), &record).map_err(internal)?;
            if record.journal.phase.is_terminal()
                || record.journal.phase == HostUpdatePhase::AwaitingReconnect
            {
                remove_if_present(&self.command_path(&operation_id))?;
                remove_if_present(&self.event_path(&operation_id))?;
            }
            if record.journal.phase.is_terminal() || self.installed_is(&record.target) {
                remove_if_present(&self.state_root.join("available.json"))?;
            }
        }
        Ok(record)
    }

    /// The operation status reports: in-flight work, or a recent outcome.
    fn reported_operation(&self) -> Result<Option<OperationRecord>, GuardianError> {
        let Some(operation_id) = self.active_operation_id()? else {
            return Ok(None);
        };
        let record = match self.read_operation(&operation_id) {
            Ok(record) => self.reconcile(record)?,
            Err(error) if error.code == GuardianErrorCode::NotFound => return Ok(None),
            Err(error) => return Err(error),
        };
        let now = unix_millis();
        let stale = match record.journal.phase {
            HostUpdatePhase::AwaitingReconnect => now > record.journal.deadlines.reconnect_by,
            phase if phase.is_terminal() => {
                now.saturating_sub(record.journal.updated_at) > TERMINAL_OUTCOME_TTL_MS
            }
            _ => false,
        };
        Ok((!stale).then_some(record))
    }

    fn has_active_operation(&self) -> Result<bool, GuardianError> {
        Ok(self.reported_operation()?.is_some_and(|record| {
            !record.journal.phase.is_terminal()
                && record.journal.phase != HostUpdatePhase::AwaitingReconnect
        }))
    }

    fn status_inner(&self) -> Result<HostUpdateStatus, GuardianError> {
        let available =
            read_optional_json::<AvailableHostUpdate>(&self.state_root.join("available.json"))
                .map_err(internal)?
                .filter(|available| {
                    is_newer_version(&available.target.version, &self.installed.version)
                });
        Ok(HostUpdateStatus {
            platform: HostPlatform::MacosUniversal,
            current_version: self.installed.version.clone(),
            current_build: self.installed.build.clone(),
            current_source_revision: self.installed.source_revision.clone(),
            // Sparkle replaces the bundle in place; the installed artifact
            // digest is neither known nor needed without a rollback image.
            current_digest: "0".repeat(64),
            capability: self.capability(),
            available_target: available,
            active_operation: self
                .reported_operation()?
                .map(|record| operation_view(&record)),
        })
    }

    async fn fetch_latest(&self) -> Result<ReleaseDescriptorV1, GuardianError> {
        let trust = self.trust()?;
        let response = reqwest::Client::builder()
            .timeout(Duration::from_secs(15))
            .redirect(reqwest::redirect::Policy::limited(3))
            .build()
            .map_err(internal)?
            .get(DEFAULT_MANIFEST_URL)
            .send()
            .await
            .and_then(reqwest::Response::error_for_status)
            .map_err(|_| precondition("release_manifest_unavailable"))?;
        let bytes = response
            .bytes()
            .await
            .map_err(|_| precondition("release_manifest_unavailable"))?;
        if bytes.len() > MANIFEST_LIMIT_BYTES {
            return Err(precondition("release_manifest_invalid"));
        }
        let envelope: SignedReleaseDescriptor =
            serde_json::from_slice(&bytes).map_err(|_| precondition("release_manifest_invalid"))?;
        verify_signed_release_descriptor(
            &envelope,
            &trust.public_key_spki,
            unix_seconds(),
            &trust.key_id,
        )
        .map_err(|error| precondition(&format!("release_not_eligible:{error}")))
    }
}

#[async_trait]
impl HostUpdateGuardian for MacosSparkleUpdater {
    fn capability(&self) -> HostUpdateCapability {
        if self.trust.is_none() {
            return HostUpdateCapability::disabled(HOST_UPDATE_UNOFFICIAL_BUILD_REASON);
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
        let _lock = self.lock.lock().await;
        self.status_inner()
    }

    async fn check(&self) -> Result<HostUpdateStatus, GuardianError> {
        let descriptor = self.fetch_latest().await?;
        let _lock = self.lock.lock().await;
        let available_path = self.state_root.join("available.json");
        let highest_path = self.state_root.join("highest-sequence.json");
        let highest = read_optional_json::<u64>(&highest_path)
            .map_err(internal)?
            .unwrap_or(0);
        let mut targets = descriptor
            .targets
            .iter()
            .filter(|target| target.platform == HostPlatform::MacosUniversal);
        let target = targets.next().cloned();
        if targets.next().is_some() {
            return Err(precondition("release_not_eligible:invalid_target"));
        }
        let Some(target) = target.filter(|target| {
            // A failed install may retry the same release; the version check,
            // not the sequence, prevents a downgrade.
            descriptor.sequence >= highest
                && is_newer_version(&target.version, &self.installed.version)
        }) else {
            // The installed version is current, or the release was already
            // seen: nothing to update, which is not a failure.
            write_json(&highest_path, &highest.max(descriptor.sequence)).map_err(internal)?;
            remove_if_present(&available_path)?;
            return self.status_inner();
        };
        if target.state_epoch != STATE_EPOCH
            || target.journal_version > HOST_UPDATE_JOURNAL_VERSION
            || target.bootstrap_version > SPARKLE_BOOTSTRAP_VERSION
        {
            return Err(manual("manual_update_required"));
        }
        let available = AvailableHostUpdate {
            target_fingerprint: target_fingerprint(&target)
                .map_err(|error| precondition(&format!("release_not_eligible:{error}")))?,
            target,
            release_sequence: descriptor.sequence,
            expires_at: descriptor.expires_at,
        };
        write_json(&highest_path, &descriptor.sequence).map_err(internal)?;
        write_json(&available_path, &available).map_err(internal)?;
        self.status_inner()
    }

    async fn apply(
        &self,
        command: ApplyHostUpdateCommand,
    ) -> Result<ApplyHostUpdateAccepted, GuardianError> {
        self.trust()?;
        let _lock = self.lock.lock().await;
        if let Some(existing) = self.find_idempotency(&command.idempotency_key)? {
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
        if self.has_active_operation()? {
            return Err(GuardianError::new(
                GuardianErrorCode::Locked,
                "another_update_is_active",
            ));
        }
        let available =
            read_optional_json::<AvailableHostUpdate>(&self.state_root.join("available.json"))
                .map_err(internal)?
                .ok_or_else(|| precondition("update_check_required"))?;
        if available.target_fingerprint != command.target_fingerprint {
            return Err(precondition("target_fingerprint_changed"));
        }
        if available.expires_at < unix_seconds() {
            return Err(precondition("update_check_required"));
        }
        let now = unix_millis();
        let operation_id = random_id("upd")?;
        let nonce = random_id("fence")?;
        let record = OperationRecord {
            journal: HostUpdateJournalV1 {
                journal_version: HOST_UPDATE_JOURNAL_VERSION,
                operation_id: operation_id.clone(),
                nonce: nonce.clone(),
                initiating_device_id: command.initiating_device_id,
                current_digest: "0".repeat(64),
                target_digest: available.target.sha256.clone(),
                target_fingerprint: command.target_fingerprint,
                pre_update_relay: self.relay_state(),
                deadlines: HostUpdateDeadlines {
                    install_by: now + INSTALL_BUDGET_MS,
                    target_ready_by: now + INSTALL_BUDGET_MS,
                    reconnect_by: now + RECONNECT_BUDGET_MS,
                    rollback_by: now + RECONNECT_BUDGET_MS,
                },
                phase: HostUpdatePhase::Accepted,
                started_at: now,
                restart_started_at: None,
                updated_at: now,
                error_code: None,
                error_message: None,
            },
            idempotency_key: command.idempotency_key,
            current_version: self.installed.version.clone(),
            target: available.target,
            release_sequence: available.release_sequence,
            progress: None,
        };
        write_json(&self.operation_path(&operation_id), &record).map_err(internal)?;
        write_json(&self.state_root.join("active.json"), &operation_id).map_err(internal)?;
        write_json(
            &self.command_path(&operation_id),
            &InstallCommand {
                operation_id: &operation_id,
                nonce: &nonce,
                target_version: &record.target.version,
                target_build: &record.target.build,
            },
        )
        .map_err(internal)?;
        Ok(ApplyHostUpdateAccepted {
            operation_id,
            phase: HostUpdatePhase::Accepted,
        })
    }

    async fn operation(&self, operation_id: &str) -> Result<HostUpdateOperation, GuardianError> {
        let _lock = self.lock.lock().await;
        let record = self.reconcile(self.read_operation(operation_id)?)?;
        Ok(operation_view(&record))
    }

    async fn reconnect(
        &self,
        receipt: ReconnectReceipt,
    ) -> Result<HostUpdateOperation, GuardianError> {
        let _lock = self.lock.lock().await;
        let mut record = self.reconcile(self.read_operation(&receipt.operation_id)?)?;
        let nonce = record.journal.nonce.clone();
        record
            .journal
            .accept_reconnect(&nonce, &receipt, unix_millis())
            .map_err(|_| precondition("invalid_reconnect_receipt"))?;
        write_json(&self.operation_path(&receipt.operation_id), &record).map_err(internal)?;
        Ok(operation_view(&record))
    }
}

impl MacosSparkleUpdater {
    fn find_idempotency(&self, key: &str) -> Result<Option<OperationRecord>, GuardianError> {
        let Ok(entries) = fs::read_dir(self.state_root.join("operations")) else {
            return Ok(None);
        };
        for entry in entries {
            let path = entry.map_err(internal)?.path();
            if path
                .extension()
                .is_some_and(|extension| extension == "json")
                && let Some(record) = read_optional_json::<OperationRecord>(&path).ok().flatten()
                && record.idempotency_key == key
            {
                return Ok(Some(record));
            }
        }
        Ok(None)
    }
}

fn transition(
    record: &mut OperationRecord,
    next: HostUpdatePhase,
    now: u64,
) -> Result<(), GuardianError> {
    let nonce = record.journal.nonce.clone();
    let current = record.journal.phase;
    record
        .journal
        .transition(&nonce, current, next, now)
        .map_err(internal)
}

fn fail(
    record: &mut OperationRecord,
    code: &str,
    message: &str,
    now: u64,
) -> Result<(), GuardianError> {
    transition(record, HostUpdatePhase::Failed, now)?;
    record.journal.error_code = Some(code.to_owned());
    record.journal.error_message = Some(message.chars().take(160).collect());
    Ok(())
}

fn operation_view(record: &OperationRecord) -> HostUpdateOperation {
    HostUpdateOperation {
        operation_id: record.journal.operation_id.clone(),
        phase: record.journal.phase,
        current_version: record.current_version.clone(),
        target_version: record.target.version.clone(),
        target_fingerprint: record.journal.target_fingerprint.clone(),
        started_at: record.journal.started_at,
        updated_at: record.journal.updated_at,
        error_code: record.journal.error_code.clone(),
        error_message: record.journal.error_message.clone(),
        progress: match record.journal.phase {
            HostUpdatePhase::Installing => record
                .progress
                .clone()
                .or(Some(HostUpdateProgress::Restarting)),
            HostUpdatePhase::AwaitingReconnect => Some(HostUpdateProgress::AwaitingReconnect),
            _ => None,
        },
    }
}

fn valid_operation_id(value: &str) -> bool {
    value.strip_prefix("upd_").is_some_and(|suffix| {
        suffix.len() == 32
            && suffix
                .bytes()
                .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
    })
}

fn random_id(prefix: &str) -> Result<String, GuardianError> {
    let mut bytes = [0_u8; 16];
    rand::rngs::OsRng
        .try_fill_bytes(&mut bytes)
        .map_err(internal)?;
    let mut identifier = format!("{prefix}_");
    for byte in bytes {
        // Writing to a `String` cannot fail.
        let _ = write!(identifier, "{byte:02x}");
    }
    Ok(identifier)
}

fn read_optional_json<T: DeserializeOwned>(path: &Path) -> std::io::Result<Option<T>> {
    match fs::read(path) {
        Ok(bytes) => serde_json::from_slice(&bytes)
            .map(Some)
            .map_err(std::io::Error::other),
        Err(error) if error.kind() == ErrorKind::NotFound => Ok(None),
        Err(error) => Err(error),
    }
}

/// Replaces one private JSON record and fsyncs it and its directory.
fn write_json<T: Serialize>(path: &Path, value: &T) -> std::io::Result<()> {
    let parent = path
        .parent()
        .ok_or_else(|| std::io::Error::other("record has no parent"))?;
    fs::create_dir_all(parent)?;
    fs::set_permissions(parent, fs::Permissions::from_mode(0o700))?;
    let temporary = parent.join(format!(
        ".{}.{}.tmp",
        path.file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("record"),
        std::process::id()
    ));
    let result = (|| {
        let mut file = OpenOptions::new()
            .write(true)
            .create(true)
            .truncate(true)
            .mode(0o600)
            .open(&temporary)?;
        file.write_all(&serde_json::to_vec(value).map_err(std::io::Error::other)?)?;
        file.sync_all()?;
        fs::rename(&temporary, path)?;
        fs::File::open(parent)?.sync_all()
    })();
    if result.is_err() {
        let _ = fs::remove_file(&temporary);
    }
    result
}

fn remove_if_present(path: &Path) -> Result<(), GuardianError> {
    match fs::remove_file(path) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == ErrorKind::NotFound => Ok(()),
        Err(error) => Err(internal(error)),
    }
}

fn unix_millis() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |value| value.as_millis().try_into().unwrap_or(u64::MAX))
}

fn unix_seconds() -> u64 {
    unix_millis() / 1_000
}

fn manual(message: &str) -> GuardianError {
    GuardianError::new(GuardianErrorCode::ManualUpdateRequired, message)
}

fn precondition(message: &str) -> GuardianError {
    GuardianError::new(
        GuardianErrorCode::PreconditionFailed,
        message.chars().take(160).collect::<String>(),
    )
}

fn not_found() -> GuardianError {
    GuardianError::new(GuardianErrorCode::NotFound, "operation_not_found")
}

fn internal(error: impl std::fmt::Display) -> GuardianError {
    tracing::error!(reason = %error, "macOS host update failed");
    GuardianError::new(GuardianErrorCode::Internal, "update_internal_error")
}

#[cfg(test)]
#[allow(clippy::expect_used)]
#[path = "macos_tests.rs"]
mod tests;
