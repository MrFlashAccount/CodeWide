use std::sync::{Arc, Mutex};

use companion_core::runtime_host::{
    RuntimeHealth, RuntimeHost, RuntimeHostError, RuntimePhase, UpdateStatus,
};
use companion_core::{
    managed_runtime::{
        ManagedRuntime, ManagedRuntimeConfig, PairingPresentation, relay_connection_label,
    },
    relay::RelayStatus,
    secure_store::SecretStoragePolicy,
};

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
pub struct FfiDeviceStatus {
    pub id: String,
    pub name: String,
    pub created_at_unix_ms: u64,
    pub last_seen_at_unix_ms: u64,
    pub active_connections: u32,
}

#[derive(Clone, Debug, uniffi::Record)]
pub struct FfiPairing {
    pub link: String,
    pub expires_at_unix_ms: u64,
}

#[derive(uniffi::Object)]
pub struct CoreHost {
    lifecycle: Mutex<RuntimeHost>,
    companion: ManagedRuntime,
    executor: tokio::runtime::Runtime,
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
    pub fn new(
        state_directory: String,
        codex_home: String,
        app_version: String,
        host_version: String,
    ) -> Result<Arc<Self>, CompanionFfiError> {
        let lifecycle = RuntimeHost::open(&state_directory, app_version, host_version)?;
        let executor = tokio::runtime::Builder::new_multi_thread()
            .enable_all()
            .thread_name("codewide-core")
            .build()
            .map_err(CompanionFfiError::runtime)?;
        let config = ManagedRuntimeConfig::desktop(state_directory.into(), codex_home.into())
            .with_secret_storage_policy(SecretStoragePolicy::PrivateFileOnly);
        let companion = executor
            .block_on(ManagedRuntime::start(config))
            .map_err(CompanionFfiError::runtime)?;
        Ok(Arc::new(Self {
            lifecycle: Mutex::new(lifecycle),
            companion,
            executor,
        }))
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

    /// Enables or disables the configured Relay adapter.
    /// # Errors
    /// Returns an adapter error when Relay state cannot be changed durably.
    pub fn set_relay_enabled(&self, enabled: bool) -> Result<FfiRelayStatus, CompanionFfiError> {
        self.executor
            .block_on(self.companion.set_relay_enabled(enabled))
            .map(Into::into)
            .map_err(CompanionFfiError::runtime)
    }

    /// Creates a time-bounded device pairing link.
    /// # Errors
    /// Returns an adapter error when Relay is unavailable or state cannot persist.
    pub fn create_pairing(&self) -> Result<FfiPairing, CompanionFfiError> {
        self.executor
            .block_on(self.companion.create_pairing())
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

uniffi::setup_scaffolding!();
