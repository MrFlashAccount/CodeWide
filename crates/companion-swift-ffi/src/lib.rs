use std::{
    collections::HashSet,
    os::unix::fs::FileTypeExt,
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
    time::Duration,
};

use companion_core::runtime_host::{
    RuntimeHealth, RuntimeHost, RuntimeHostError, RuntimePhase, UpdateStatus,
};
use companion_core::{
    host_identity::HostDisplayName,
    host_update::{
        HOST_UPDATE_BOOTSTRAP_VERSION, HOST_UPDATE_JOURNAL_VERSION, HostPlatform, ReleaseAdmission,
        SignedReleaseDescriptor, admit_signed_release, verify_signed_release_descriptor,
    },
    managed_runtime::{
        AppServerConnection, ManagedRuntime, ManagedRuntimeConfig, PairingPresentation,
        relay_connection_label,
    },
    relay::{RelayEnrollmentStatus, RelayStatus},
    secure_store::SecretStoragePolicy,
    upstream::probe_app_server_version,
};

mod codex_installation;
mod macos_host_update;

pub use codex_installation::FfiCodexInstallation;
use codex_installation::{inspect_codex_installation, start_codex_app_server};

#[derive(Debug, thiserror::Error, uniffi::Error)]
pub enum CompanionFfiError {
    #[error("Companion runtime state is unavailable: {message}")]
    Runtime { message: String },
    #[error("Companion runtime lock is poisoned")]
    LockPoisoned,
}

impl From<RuntimeHostError> for CompanionFfiError {
    fn from(error: RuntimeHostError) -> Self {
        Self::Runtime {
            message: error.to_string(),
        }
    }
}

impl CompanionFfiError {
    fn runtime(error: impl std::fmt::Display) -> Self {
        Self::Runtime {
            message: error.to_string(),
        }
    }
}

#[derive(Clone, Debug, uniffi::Record)]
pub struct FfiRuntimeHealth {
    pub phase: String,
    pub degraded_reason: Option<String>,
    pub app_version: String,
    pub host_version: String,
    pub core_version: String,
    pub state_schema: u32,
    pub process_id: u32,
    pub launch_count: u64,
    pub started_at_unix_ms: u64,
    pub update_status: String,
    pub update_from_version: Option<String>,
    pub update_target_version: Option<String>,
    pub update_failure_reason: Option<String>,
}

#[derive(Clone, Debug, uniffi::Record)]
pub struct FfiRelayStatus {
    pub configured: bool,
    pub enabled: bool,
    pub connection: String,
    pub public_endpoint: Option<String>,
}

#[derive(Clone, Debug, uniffi::Record)]
pub struct FfiDirectAccess {
    pub listen_address: String,
    pub endpoints: Vec<String>,
}

#[derive(Clone, Debug, uniffi::Record)]
pub struct FfiDeviceStatus {
    pub id: String,
    pub name: String,
    pub created_at_unix_ms: u64,
    pub last_seen_at_unix_ms: u64,
    pub active_connections: u32,
}

#[derive(Clone, Debug, uniffi::Record)]
pub struct FfiHostUpdateTarget {
    pub platform: String,
    pub version: String,
    pub build: String,
    pub source_revision: String,
    pub artifact_url: String,
    pub sha256: String,
    pub bootstrap_version: u16,
    pub journal_version: u16,
    pub state_epoch: u32,
    pub rollback_compatible_from: Vec<String>,
}

#[derive(Clone, Debug, uniffi::Record)]
pub struct FfiVerifiedHostUpdateRelease {
    pub sequence: u64,
    pub expires_at: u64,
    pub targets: Vec<FfiHostUpdateTarget>,
}

#[derive(Clone, Debug, uniffi::Record)]
pub struct FfiAdmittedHostUpdate {
    pub sequence: u64,
    pub expires_at: u64,
    pub target_fingerprint: String,
    pub target: FfiHostUpdateTarget,
}

/// Verifies a signed stable descriptor for baseline receipt establishment.
/// This does not admit an update; callers must independently prove the
/// installed bundle is byte-identical to the verified current release image.
///
/// # Errors
///
/// Returns an error when the envelope, signature, trust key, channel, or
/// freshness contract is invalid.
#[uniffi::export]
#[allow(clippy::needless_pass_by_value)]
pub fn verify_host_update_release(
    envelope_json: String,
    public_key_spki: String,
    now_unix_seconds: u64,
    trusted_key_id: String,
) -> Result<FfiVerifiedHostUpdateRelease, CompanionFfiError> {
    let envelope: SignedReleaseDescriptor =
        serde_json::from_str(&envelope_json).map_err(CompanionFfiError::runtime)?;
    let descriptor = verify_signed_release_descriptor(
        &envelope,
        &public_key_spki,
        now_unix_seconds,
        &trusted_key_id,
    )
    .map_err(CompanionFfiError::runtime)?;
    Ok(FfiVerifiedHostUpdateRelease {
        sequence: descriptor.sequence,
        expires_at: descriptor.expires_at,
        targets: descriptor
            .targets
            .into_iter()
            .map(ffi_host_update_target)
            .collect(),
    })
}

/// Applies the complete shared admission policy to one macOS target.
///
/// # Errors
///
/// Returns an error when signature verification or any target, predecessor,
/// sequence, compatibility, or state-epoch admission rule fails.
#[uniffi::export]
#[allow(clippy::needless_pass_by_value, clippy::too_many_arguments)]
pub fn admit_macos_host_update_release(
    envelope_json: String,
    public_key_spki: String,
    now_unix_seconds: u64,
    trusted_key_id: String,
    current_version: String,
    current_digest: String,
    highest_sequence: u64,
    state_epoch: u32,
) -> Result<FfiAdmittedHostUpdate, CompanionFfiError> {
    let envelope: SignedReleaseDescriptor =
        serde_json::from_str(&envelope_json).map_err(CompanionFfiError::runtime)?;
    let admission = ReleaseAdmission {
        trusted_key_id: &trusted_key_id,
        platform: HostPlatform::MacosUniversal,
        current_version: &current_version,
        current_digest: &current_digest,
        highest_sequence,
        state_epoch,
        bootstrap_version: HOST_UPDATE_BOOTSTRAP_VERSION,
        journal_version: HOST_UPDATE_JOURNAL_VERSION,
    };
    let (descriptor, target, target_fingerprint) =
        admit_signed_release(&envelope, &public_key_spki, now_unix_seconds, &admission)
            .map_err(CompanionFfiError::runtime)?;
    Ok(FfiAdmittedHostUpdate {
        sequence: descriptor.sequence,
        expires_at: descriptor.expires_at,
        target_fingerprint,
        target: ffi_host_update_target(target),
    })
}

fn ffi_host_update_target(
    target: companion_core::host_update::ReleaseTargetV1,
) -> FfiHostUpdateTarget {
    FfiHostUpdateTarget {
        platform: match target.platform {
            HostPlatform::LinuxX86_64 => "linux-x86-64",
            HostPlatform::MacosUniversal => "macos-universal",
        }
        .to_owned(),
        version: target.version,
        build: target.build,
        source_revision: target.source_revision,
        artifact_url: target.artifact_url,
        sha256: target.sha256,
        bootstrap_version: target.bootstrap_version,
        journal_version: target.journal_version,
        state_epoch: target.state_epoch,
        rollback_compatible_from: target.rollback_compatible_from,
    }
}

#[derive(Clone, Debug, uniffi::Record)]
pub struct FfiPairing {
    pub link: String,
    pub expires_at_unix_ms: u64,
}

#[derive(Clone, Debug, uniffi::Enum)]
pub enum FfiAppServerAvailability {
    Available { version: String },
    Unavailable,
}

#[derive(Clone, Debug, uniffi::Enum)]
pub enum FfiAppServerConnection {
    Live { version: Option<String> },
    Reconnecting { last_known_version: Option<String> },
}

#[derive(Clone, Debug, uniffi::Record)]
pub struct FfiAppServerCandidate {
    pub id: String,
    pub display_name: String,
    pub codex_home: String,
    pub availability: FfiAppServerAvailability,
    pub selected: bool,
}

#[derive(uniffi::Object)]
pub struct CoreHost {
    lifecycle: Mutex<RuntimeHost>,
    companion: ManagedRuntime,
    executor: tokio::runtime::Runtime,
    codex_home: PathBuf,
}

#[uniffi::export]
impl CoreHost {
    /// Opens the shared core in the Swift `LaunchAgent` process.
    ///
    /// # Errors
    ///
    /// Returns an adapter error when the state directory cannot be opened,
    /// migrated, exclusively locked, or durably checkpointed.
    #[uniffi::constructor]
    // UniFFI constructors receive owned strings from the Swift boundary.
    #[allow(clippy::needless_pass_by_value)]
    pub fn new(
        state_directory: String,
        codex_home: String,
        app_version: String,
        host_version: String,
        computer_name: String,
        listen_address: String,
    ) -> Result<Arc<Self>, CompanionFfiError> {
        let lifecycle = RuntimeHost::open(&state_directory, app_version, host_version)?;
        let codex_home = PathBuf::from(codex_home);
        let executor = tokio::runtime::Builder::new_multi_thread()
            .enable_all()
            .thread_name("codewide-core")
            .build()
            .map_err(CompanionFfiError::runtime)?;
        let host_display_name =
            HostDisplayName::new(computer_name).map_err(CompanionFfiError::runtime)?;
        let updater_root = Path::new(&state_directory)
            .parent()
            .ok_or_else(|| CompanionFfiError::runtime("Companion state directory has no parent"))?
            .join("Updater");
        let config = ManagedRuntimeConfig::desktop(
            state_directory.into(),
            codex_home.clone(),
            host_display_name,
        )
        .with_secret_storage_policy(SecretStoragePolicy::PrivateFileOnly)
        .with_listen_address(listen_address.parse().map_err(CompanionFfiError::runtime)?)
        .with_host_update_guardian(macos_host_update::MacOsHostUpdateGuardian::shared(
            updater_root,
        ));
        let companion = executor
            .block_on(ManagedRuntime::start(config))
            .map_err(CompanionFfiError::runtime)?;
        Ok(Arc::new(Self {
            lifecycle: Mutex::new(lifecycle),
            companion,
            executor,
            codex_home,
        }))
    }

    #[must_use]
    pub fn app_server_connection(&self) -> FfiAppServerConnection {
        match self.companion.app_server_connection() {
            AppServerConnection::Live { version } => FfiAppServerConnection::Live { version },
            AppServerConnection::Reconnecting { last_known_version } => {
                FfiAppServerConnection::Reconnecting { last_known_version }
            }
        }
    }

    /// Finds local Codex homes with a reachable App Server endpoint.
    ///
    /// The default and currently selected homes remain visible while offline,
    /// so the macOS host can explain and recover the unavailable state.
    ///
    /// # Errors
    /// Returns when the user's home directory cannot be inspected safely.
    pub fn discover_app_servers(
        &self,
        home_directory: String,
    ) -> Result<Vec<FfiAppServerCandidate>, CompanionFfiError> {
        let home_directory = PathBuf::from(home_directory);
        let homes = candidate_codex_homes(&home_directory, &self.codex_home)
            .map_err(CompanionFfiError::runtime)?;
        Ok(homes
            .iter()
            .map(|codex_home| self.app_server_candidate(codex_home))
            .collect())
    }

    /// Describes whether a compatible installed Codex can start the selected App Server.
    #[must_use]
    pub fn codex_installation(&self, home_directory: String) -> FfiCodexInstallation {
        let home_directory = PathBuf::from(home_directory);
        let homes = candidate_codex_homes(&home_directory, &self.codex_home)
            .unwrap_or_else(|_| vec![self.codex_home.clone()]);
        self.executor
            .block_on(inspect_codex_installation(&home_directory, &homes))
    }

    /// Starts the installed Codex daemon for a previously discovered local home.
    ///
    /// # Errors
    /// Returns when the home was not discovered, Codex is missing or too old,
    /// the daemon command fails, or the App Server does not answer its handshake.
    pub fn start_app_server(
        &self,
        codex_home: String,
        home_directory: String,
    ) -> Result<FfiAppServerCandidate, CompanionFfiError> {
        let home_directory = PathBuf::from(home_directory);
        let codex_home = PathBuf::from(codex_home);
        let homes = candidate_codex_homes(&home_directory, &self.codex_home)
            .map_err(CompanionFfiError::runtime)?;
        if !homes.contains(&codex_home) {
            return Err(CompanionFfiError::runtime(
                "The requested Codex home was not discovered",
            ));
        }
        self.executor
            .block_on(start_codex_app_server(&home_directory, &codex_home))
            .map_err(CompanionFfiError::runtime)?;

        let socket_path = app_server_socket_path(&codex_home);
        let version = self
            .executor
            .block_on(async {
                tokio::time::timeout(Duration::from_secs(10), async {
                    loop {
                        if let Ok(version) = probe_app_server_version(&socket_path).await {
                            return version;
                        }
                        tokio::time::sleep(Duration::from_millis(200)).await;
                    }
                })
                .await
            })
            .map_err(|_| {
                CompanionFfiError::runtime(
                    "Codex started, but its App Server did not answer the initialize handshake",
                )
            })?;
        Ok(app_server_candidate(
            &codex_home,
            &self.codex_home,
            Some(version),
        ))
    }

    /// Returns the current lifecycle and version proof.
    ///
    /// # Errors
    ///
    /// Returns an adapter error if another thread poisoned the runtime lock.
    pub fn health(&self) -> Result<FfiRuntimeHealth, CompanionFfiError> {
        let lifecycle = self
            .lifecycle
            .lock()
            .map_err(|_| CompanionFfiError::LockPoisoned)?;
        let mut health: FfiRuntimeHealth = lifecycle.health().into();
        if let Some(reason) = self.companion.failure() {
            "degraded".clone_into(&mut health.phase);
            health.degraded_reason = Some(reason);
        }
        Ok(health)
    }

    /// Persists the update checkpoint before Swift terminates the host.
    ///
    /// # Errors
    ///
    /// Returns an adapter error if the target is invalid, state persistence
    /// fails, or another thread poisoned the runtime lock.
    pub fn prepare_for_update(
        &self,
        target_version: String,
    ) -> Result<FfiRuntimeHealth, CompanionFfiError> {
        let mut lifecycle = self
            .lifecycle
            .lock()
            .map_err(|_| CompanionFfiError::LockPoisoned)?;
        Ok(lifecycle.prepare_for_update(target_version)?.into())
    }

    /// Returns durable Relay configuration and live reachability.
    /// # Errors
    /// Returns an adapter error when Relay state is invalid or unsafe.
    pub fn relay_status(&self) -> Result<FfiRelayStatus, CompanionFfiError> {
        self.companion
            .relay_status()
            .map(Into::into)
            .map_err(CompanionFfiError::runtime)
    }

    /// Consumes a Relay invitation and starts its outbound adapter.
    /// # Errors
    /// Returns an adapter error for invalid input, trust, or network failure.
    pub fn pair_relay(
        &self,
        relay_address: String,
        invitation_json: String,
    ) -> Result<FfiRelayStatus, CompanionFfiError> {
        self.executor
            .block_on(self.companion.pair_relay(relay_address, invitation_json))
            .map(Into::into)
            .map_err(CompanionFfiError::runtime)
    }

    /// Starts address-only pairing and returns its local presentation handle.
    /// # Errors
    /// Rejects invalid input or a concurrent operation.
    #[allow(
        clippy::needless_pass_by_value,
        reason = "UniFFI lifts owned strings at this boundary"
    )]
    pub fn begin_relay_enrollment(
        &self,
        address: String,
    ) -> Result<FfiRelayEnrollmentStatus, CompanionFfiError> {
        let _runtime = self.executor.enter();
        self.companion
            .begin_relay_enrollment(&address)
            .map(Into::into)
            .map_err(CompanionFfiError::runtime)
    }

    /// Reads presentation state for one enrollment attempt.
    /// # Errors
    /// Rejects an unknown attempt.
    #[allow(
        clippy::needless_pass_by_value,
        reason = "UniFFI lifts owned strings at this boundary"
    )]
    pub fn relay_enrollment_status(
        &self,
        id: String,
    ) -> Result<FfiRelayEnrollmentStatus, CompanionFfiError> {
        self.companion
            .relay_enrollment_status(&id)
            .map(Into::into)
            .map_err(CompanionFfiError::runtime)
    }

    /// Cancels one enrollment attempt and restores previous settings.
    /// # Errors
    /// Propagates unavailable runtime state.
    #[allow(
        clippy::needless_pass_by_value,
        reason = "UniFFI lifts owned strings at this boundary"
    )]
    pub fn cancel_relay_enrollment(&self, id: String) -> Result<(), CompanionFfiError> {
        self.companion
            .cancel_relay_enrollment(&id)
            .map_err(CompanionFfiError::runtime)
    }

    /// Enables or disables the configured Relay adapter.
    /// # Errors
    /// Returns an adapter error when Relay state cannot be changed durably.
    pub fn set_relay_enabled(&self, enabled: bool) -> Result<FfiRelayStatus, CompanionFfiError> {
        self.executor
            .block_on(self.companion.set_relay_enabled(enabled))
            .map(Into::into)
            .map_err(CompanionFfiError::runtime)
    }

    /// Returns the direct listener and current network addresses.
    /// # Errors
    /// Returns an adapter error when interfaces cannot be read.
    pub fn direct_access(&self) -> Result<FfiDirectAccess, CompanionFfiError> {
        Ok(FfiDirectAccess {
            listen_address: self.companion.listen_address().to_string(),
            endpoints: self
                .companion
                .direct_endpoints()
                .map_err(CompanionFfiError::runtime)?,
        })
    }

    /// Creates a time-bounded device pairing link.
    /// # Errors
    /// Returns an adapter error when the address is unavailable or state cannot persist.
    pub fn create_pairing(
        &self,
        direct_endpoint: Option<String>,
    ) -> Result<FfiPairing, CompanionFfiError> {
        self.executor
            .block_on(self.companion.create_pairing(direct_endpoint))
            .map(Into::into)
            .map_err(CompanionFfiError::runtime)
    }

    pub fn devices(&self) -> Vec<FfiDeviceStatus> {
        self.executor
            .block_on(self.companion.devices())
            .into_iter()
            .map(|status| FfiDeviceStatus {
                id: status.device.id,
                name: status.device.name,
                created_at_unix_ms: status.device.created_at,
                last_seen_at_unix_ms: status.device.last_seen_at,
                active_connections: status.active_connections,
            })
            .collect()
    }

    /// Revokes one paired device.
    /// # Errors
    /// Returns an adapter error when the durable registry cannot be updated.
    pub fn revoke_device(&self, device_id: String) -> Result<bool, CompanionFfiError> {
        self.executor
            .block_on(self.companion.revoke_device(device_id))
            .map_err(CompanionFfiError::runtime)
    }
}

impl CoreHost {
    fn app_server_candidate(&self, codex_home: &Path) -> FfiAppServerCandidate {
        let version = self
            .executor
            .block_on(probe_app_server_version(&app_server_socket_path(
                codex_home,
            )))
            .ok();
        app_server_candidate(codex_home, &self.codex_home, version)
    }
}

fn app_server_candidate(
    codex_home: &Path,
    selected_codex_home: &Path,
    version: Option<String>,
) -> FfiAppServerCandidate {
    let availability = version.map_or(FfiAppServerAvailability::Unavailable, |version| {
        FfiAppServerAvailability::Available { version }
    });
    let id = codex_home.to_string_lossy().into_owned();
    FfiAppServerCandidate {
        display_name: app_server_display_name(codex_home),
        codex_home: id.clone(),
        selected: codex_home == selected_codex_home,
        id,
        availability,
    }
}

fn candidate_codex_homes(home_directory: &Path, selected: &Path) -> std::io::Result<Vec<PathBuf>> {
    let default = home_directory.join(".codex");
    let mut seen = HashSet::new();
    let mut homes = Vec::new();
    push_candidate(&mut homes, &mut seen, default);
    push_candidate(&mut homes, &mut seen, selected.to_path_buf());
    for entry in std::fs::read_dir(home_directory)? {
        let entry = entry?;
        let name = entry.file_name();
        let name = name.to_string_lossy();
        let path = entry.path();
        if (name == ".codex" || name.starts_with(".codex-"))
            && entry.file_type()?.is_dir()
            && has_app_server_socket(&path)
        {
            push_candidate(&mut homes, &mut seen, path);
        }
    }
    homes.sort_by(|left, right| {
        let left_default = left == &home_directory.join(".codex");
        let right_default = right == &home_directory.join(".codex");
        right_default
            .cmp(&left_default)
            .then_with(|| left.file_name().cmp(&right.file_name()))
    });
    Ok(homes)
}

fn has_app_server_socket(codex_home: &Path) -> bool {
    app_server_socket_path(codex_home)
        .metadata()
        .is_ok_and(|metadata| metadata.file_type().is_socket())
}

fn app_server_socket_path(codex_home: &Path) -> PathBuf {
    codex_home.join("app-server-control/app-server-control.sock")
}

fn push_candidate(homes: &mut Vec<PathBuf>, seen: &mut HashSet<PathBuf>, candidate: PathBuf) {
    if seen.insert(candidate.clone()) {
        homes.push(candidate);
    }
}

fn app_server_display_name(codex_home: &Path) -> String {
    match codex_home.file_name().and_then(|name| name.to_str()) {
        Some(".codex") => "Default".to_owned(),
        Some(name) => name.trim_start_matches(".codex-").to_owned(),
        None => "Codex App Server".to_owned(),
    }
}

#[derive(uniffi::Record)]
pub struct FfiRelayEnrollmentStatus {
    pub id: String,
    pub state: String,
    pub code: Option<String>,
    pub remaining_seconds: u32,
    pub message: Option<String>,
}

impl From<RelayEnrollmentStatus> for FfiRelayEnrollmentStatus {
    fn from(value: RelayEnrollmentStatus) -> Self {
        Self {
            id: value.id,
            state: value.state,
            code: value.code,
            remaining_seconds: value.remaining_seconds,
            message: value.message,
        }
    }
}

impl From<RelayStatus> for FfiRelayStatus {
    fn from(status: RelayStatus) -> Self {
        Self {
            configured: status.configured,
            enabled: status.enabled,
            connection: relay_connection_label(status.connection).to_owned(),
            public_endpoint: status.public_endpoint,
        }
    }
}

impl From<PairingPresentation> for FfiPairing {
    fn from(pairing: PairingPresentation) -> Self {
        Self {
            link: pairing.link,
            expires_at_unix_ms: pairing.expires_at,
        }
    }
}

impl From<RuntimeHealth> for FfiRuntimeHealth {
    fn from(health: RuntimeHealth) -> Self {
        let (phase, degraded_reason) = match health.phase {
            RuntimePhase::Starting => ("starting".to_owned(), None),
            RuntimePhase::Running => ("running".to_owned(), None),
            RuntimePhase::PreparingUpdate => ("preparingUpdate".to_owned(), None),
            RuntimePhase::Degraded { reason } => ("degraded".to_owned(), Some(reason)),
        };
        let (update_status, update_from_version, update_target_version, update_failure_reason) =
            match health.update {
                UpdateStatus::None => ("none".to_owned(), None, None, None),
                UpdateStatus::Prepared {
                    from_version,
                    target_version,
                } => (
                    "prepared".to_owned(),
                    Some(from_version),
                    Some(target_version),
                    None,
                ),
                UpdateStatus::Applied {
                    from_version,
                    to_version,
                } => (
                    "applied".to_owned(),
                    Some(from_version),
                    Some(to_version),
                    None,
                ),
                UpdateStatus::Failed {
                    target_version,
                    reason,
                } => (
                    "failed".to_owned(),
                    None,
                    Some(target_version),
                    Some(reason),
                ),
            };
        Self {
            phase,
            degraded_reason,
            app_version: health.versions.app,
            host_version: health.versions.host,
            core_version: health.versions.core,
            state_schema: health.versions.state_schema,
            process_id: health.process_id,
            launch_count: health.launch_count,
            started_at_unix_ms: health.started_at_unix_ms,
            update_status,
            update_from_version,
            update_target_version,
            update_failure_reason,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{os::unix::fs::symlink, os::unix::net::UnixListener};

    #[test]
    fn discovery_keeps_default_and_selected_but_ignores_inactive_profiles()
    -> Result<(), Box<dyn std::error::Error>> {
        // The profile suffix and control path must fit macOS's sockaddr_un.
        let home = tempfile::Builder::new().prefix("cw-").tempdir_in("/tmp")?;
        let default = home.path().join(".codex");
        let work = home.path().join(".codex-work");
        let inactive = home.path().join(".codex-inactive");
        std::fs::create_dir_all(work.join("app-server-control"))?;
        std::fs::create_dir_all(&inactive)?;
        let _socket = UnixListener::bind(work.join("app-server-control/app-server-control.sock"))?;

        let candidates = candidate_codex_homes(home.path(), &work)?;

        assert_eq!(candidates, vec![default, work]);
        assert!(!candidates.contains(&inactive));
        Ok(())
    }

    #[test]
    fn display_name_distinguishes_default_and_named_profiles() {
        assert_eq!(
            app_server_display_name(Path::new("/Users/me/.codex")),
            "Default"
        );
        assert_eq!(
            app_server_display_name(Path::new("/Users/me/.codex-work")),
            "work"
        );
    }

    #[test]
    fn discovery_accepts_the_stable_symlink_used_by_the_codex_daemon()
    -> Result<(), Box<dyn std::error::Error>> {
        let home = tempfile::tempdir()?;
        let codex_home = home.path().join(".codex");
        let control = codex_home.join("app-server-control");
        std::fs::create_dir_all(&control)?;
        let socket_directory = tempfile::tempdir()?;
        let socket_path = socket_directory.path().join("daemon.sock");
        let _socket = UnixListener::bind(&socket_path)?;
        symlink(&socket_path, control.join("app-server-control.sock"))?;

        assert!(has_app_server_socket(&codex_home));
        assert_eq!(
            candidate_codex_homes(home.path(), &codex_home)?,
            vec![codex_home]
        );
        Ok(())
    }
}

uniffi::setup_scaffolding!();
