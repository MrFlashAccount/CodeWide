use std::sync::{Arc, Mutex};

use companion_core::runtime_host::{
    RuntimeHealth, RuntimeHost, RuntimeHostError, RuntimePhase, UpdateStatus,
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

#[derive(uniffi::Object)]
pub struct CoreHost {
    runtime: Mutex<RuntimeHost>,
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
        app_version: String,
        host_version: String,
    ) -> Result<Arc<Self>, CompanionFfiError> {
        let runtime = RuntimeHost::open(state_directory, app_version, host_version)?;
        Ok(Arc::new(Self {
            runtime: Mutex::new(runtime),
        }))
    }

    /// Returns the current lifecycle and version proof.
    ///
    /// # Errors
    ///
    /// Returns an adapter error if another thread poisoned the runtime lock.
    pub fn health(&self) -> Result<FfiRuntimeHealth, CompanionFfiError> {
        let runtime = self
            .runtime
            .lock()
            .map_err(|_| CompanionFfiError::LockPoisoned)?;
        Ok(runtime.health().into())
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
        let mut runtime = self
            .runtime
            .lock()
            .map_err(|_| CompanionFfiError::LockPoisoned)?;
        Ok(runtime.prepare_for_update(target_version)?.into())
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
