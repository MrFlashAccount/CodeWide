use std::{
    fs::{File, OpenOptions},
    io::{self, Write as _},
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};

use companion_control::{RuntimeHealth, RuntimePhase, RuntimeVersions, UpdateStatus};
use serde::{Deserialize, Serialize};
use tempfile::NamedTempFile;
use thiserror::Error;

const STATE_SCHEMA_VERSION: u32 = 1;
const STATE_FILE_NAME: &str = "runtime-state.json";
const LOCK_FILE_NAME: &str = "runtime.lock";

#[derive(Debug, Error)]
pub enum RuntimeHostError {
    #[error("another Companion runtime already owns {0}")]
    AlreadyRunning(PathBuf),
    #[error("runtime state schema {found} is newer than supported schema {supported}")]
    UnsupportedStateSchema { found: u32, supported: u32 },
    #[error("runtime state is invalid: {0}")]
    InvalidState(String),
    #[error(transparent)]
    Io(#[from] io::Error),
    #[error(transparent)]
    Json(#[from] serde_json::Error),
    #[error("failed to replace runtime state: {0}")]
    Persist(#[from] tempfile::PersistError),
}

pub struct RuntimeHost {
    state_path: PathBuf,
    state: StoredRuntimeState,
    versions: RuntimeVersions,
    phase: RuntimePhase,
    started_at_unix_ms: u64,
    _lock: File,
}

impl RuntimeHost {
    /// Opens and exclusively owns one platform-host state directory.
    ///
    /// # Errors
    ///
    /// Returns an error when another runtime owns the directory, state cannot
    /// be read or migrated, or a durable launch checkpoint cannot be written.
    pub fn open(
        state_directory: impl AsRef<Path>,
        app_version: impl Into<String>,
        host_version: impl Into<String>,
    ) -> Result<Self, RuntimeHostError> {
        let state_directory = state_directory.as_ref();
        create_private_directory(state_directory)?;
        let lock_path = state_directory.join(LOCK_FILE_NAME);
        let lock = open_private_file(&lock_path)?;
        fs2::FileExt::try_lock_exclusive(&lock)
            .map_err(|_| RuntimeHostError::AlreadyRunning(lock_path))?;

        let state_path = state_directory.join(STATE_FILE_NAME);
        let core_version = env!("CODEWIDE_CORE_VERSION").to_owned();
        let app_version = app_version.into();
        let host_version = host_version.into();
        let mut state = load_or_initialize_state(&state_path)?;
        let previous_version = state.last_core_version.clone();
        state.launch_count = state.launch_count.saturating_add(1);
        state.last_core_version = Some(core_version.clone());
        if let Some(pending) = state.pending_update.take() {
            if pending.target_version == app_version {
                state.last_update = Some(StoredUpdateResult::Applied {
                    from_version: pending.from_version,
                    to_version: app_version.clone(),
                });
            } else {
                state.pending_update = Some(pending);
            }
        } else if let Some(previous_version) = previous_version.filter(|old| old != &core_version) {
            state.last_update = Some(StoredUpdateResult::Applied {
                from_version: previous_version,
                to_version: core_version.clone(),
            });
        }
        write_state(&state_path, &state)?;

        Ok(Self {
            state_path,
            state,
            versions: RuntimeVersions {
                app: app_version,
                host: host_version,
                core: core_version,
                state_schema: STATE_SCHEMA_VERSION,
            },
            phase: RuntimePhase::Running,
            started_at_unix_ms: unix_time_ms()?,
            _lock: lock,
        })
    }

    #[must_use]
    pub fn health(&self) -> RuntimeHealth {
        RuntimeHealth {
            phase: self.phase.clone(),
            versions: self.versions.clone(),
            process_id: std::process::id(),
            launch_count: self.state.launch_count,
            started_at_unix_ms: self.started_at_unix_ms,
            update: self.update_status(),
        }
    }

    /// Atomically records the intended target before the platform host exits.
    ///
    /// # Errors
    ///
    /// Returns an error for an empty target version or when the checkpoint
    /// cannot be durably persisted.
    pub fn prepare_for_update(
        &mut self,
        target_version: impl Into<String>,
    ) -> Result<RuntimeHealth, RuntimeHostError> {
        let target_version = target_version.into();
        if target_version.trim().is_empty() {
            return Err(RuntimeHostError::InvalidState(
                "target update version must not be empty".to_owned(),
            ));
        }
        self.state.pending_update = Some(StoredPendingUpdate {
            from_version: self.versions.app.clone(),
            target_version,
        });
        write_state(&self.state_path, &self.state)?;
        self.phase = RuntimePhase::PreparingUpdate;
        Ok(self.health())
    }

    fn update_status(&self) -> UpdateStatus {
        if let Some(pending) = &self.state.pending_update {
            return UpdateStatus::Prepared {
                from_version: pending.from_version.clone(),
                target_version: pending.target_version.clone(),
            };
        }
        match &self.state.last_update {
            Some(StoredUpdateResult::Applied {
                from_version,
                to_version,
            }) => UpdateStatus::Applied {
                from_version: from_version.clone(),
                to_version: to_version.clone(),
            },
            Some(StoredUpdateResult::Failed {
                target_version,
                reason,
            }) => UpdateStatus::Failed {
                target_version: target_version.clone(),
                reason: reason.clone(),
            },
            None => UpdateStatus::None,
        }
    }
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct StoredRuntimeState {
    schema_version: u32,
    launch_count: u64,
    last_core_version: Option<String>,
    pending_update: Option<StoredPendingUpdate>,
    last_update: Option<StoredUpdateResult>,
}

impl Default for StoredRuntimeState {
    fn default() -> Self {
        Self {
            schema_version: STATE_SCHEMA_VERSION,
            launch_count: 0,
            last_core_version: None,
            pending_update: None,
            last_update: None,
        }
    }
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct StoredPendingUpdate {
    from_version: String,
    target_version: String,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", tag = "status")]
enum StoredUpdateResult {
    Applied {
        from_version: String,
        to_version: String,
    },
    Failed {
        target_version: String,
        reason: String,
    },
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct LegacyRuntimeStateV0 {
    #[serde(default)]
    launch_count: u64,
    #[serde(default)]
    last_core_version: Option<String>,
}

fn load_or_initialize_state(path: &Path) -> Result<StoredRuntimeState, RuntimeHostError> {
    let raw = match std::fs::read(path) {
        Ok(raw) => raw,
        Err(error) if error.kind() == io::ErrorKind::NotFound => {
            return Ok(StoredRuntimeState::default());
        }
        Err(error) => return Err(error.into()),
    };
    let value: serde_json::Value = serde_json::from_slice(&raw)?;
    let schema = value
        .get("schemaVersion")
        .and_then(serde_json::Value::as_u64)
        .ok_or_else(|| RuntimeHostError::InvalidState("schemaVersion is missing".to_owned()))?;
    let schema = u32::try_from(schema)
        .map_err(|_| RuntimeHostError::InvalidState("schemaVersion is out of range".to_owned()))?;
    match schema {
        STATE_SCHEMA_VERSION => Ok(serde_json::from_value(value)?),
        0 => {
            let legacy: LegacyRuntimeStateV0 = serde_json::from_value(value)?;
            let backup_path = path.with_extension("v0.backup.json");
            if !backup_path.exists() {
                std::fs::copy(path, &backup_path)?;
                set_private_file_permissions(&backup_path)?;
            }
            Ok(StoredRuntimeState {
                launch_count: legacy.launch_count,
                last_core_version: legacy.last_core_version,
                ..StoredRuntimeState::default()
            })
        }
        found => Err(RuntimeHostError::UnsupportedStateSchema {
            found,
            supported: STATE_SCHEMA_VERSION,
        }),
    }
}

fn write_state(path: &Path, state: &StoredRuntimeState) -> Result<(), RuntimeHostError> {
    let directory = path.parent().ok_or_else(|| {
        RuntimeHostError::InvalidState("runtime state path has no parent".to_owned())
    })?;
    let mut temporary = NamedTempFile::new_in(directory)?;
    serde_json::to_writer(&mut temporary, state)?;
    temporary.write_all(b"\n")?;
    temporary.flush()?;
    temporary.as_file().sync_all()?;
    temporary.persist(path)?;
    set_private_file_permissions(path)?;
    File::open(directory)?.sync_all()?;
    Ok(())
}

fn unix_time_ms() -> Result<u64, RuntimeHostError> {
    let duration = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|error| RuntimeHostError::InvalidState(error.to_string()))?;
    u64::try_from(duration.as_millis())
        .map_err(|_| RuntimeHostError::InvalidState("system time is out of range".to_owned()))
}

fn open_private_file(path: &Path) -> io::Result<File> {
    let mut options = OpenOptions::new();
    options.read(true).write(true).create(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt as _;
        options.mode(0o600);
    }
    let file = options.open(path)?;
    set_private_file_permissions(path)?;
    Ok(file)
}

fn create_private_directory(path: &Path) -> io::Result<()> {
    std::fs::create_dir_all(path)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt as _;
        std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o700))?;
    }
    Ok(())
}

fn set_private_file_permissions(path: &Path) -> io::Result<()> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt as _;
        std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600))?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn update_checkpoint_survives_restart_and_preserves_other_state() -> Result<(), RuntimeHostError>
    {
        let directory = tempfile::tempdir()?;
        std::fs::write(directory.path().join("devices.json"), b"keep")?;
        let mut first = RuntimeHost::open(directory.path(), "1.0.0", "1.0.0")?;
        first.prepare_for_update("1.1.0")?;
        drop(first);

        let second = RuntimeHost::open(directory.path(), "1.1.0", "1.1.0")?;
        assert_eq!(
            second.health().update,
            UpdateStatus::Applied {
                from_version: "1.0.0".to_owned(),
                to_version: "1.1.0".to_owned(),
            }
        );
        assert_eq!(
            std::fs::read(directory.path().join("devices.json"))?,
            b"keep"
        );
        Ok(())
    }

    #[test]
    fn legacy_state_is_backed_up_before_migration() -> Result<(), RuntimeHostError> {
        let directory = tempfile::tempdir()?;
        let state_path = directory.path().join(STATE_FILE_NAME);
        std::fs::write(
            &state_path,
            br#"{"schemaVersion":0,"launchCount":4,"lastCoreVersion":"0.9.0"}"#,
        )?;

        let runtime = RuntimeHost::open(directory.path(), "1.0.0", "1.0.0")?;
        assert_eq!(runtime.health().launch_count, 5);
        assert!(state_path.with_extension("v0.backup.json").is_file());
        Ok(())
    }

    #[test]
    fn one_state_directory_has_one_runtime_owner() -> Result<(), RuntimeHostError> {
        let directory = tempfile::tempdir()?;
        let _first = RuntimeHost::open(directory.path(), "1.0.0", "1.0.0")?;
        let second = RuntimeHost::open(directory.path(), "1.0.0", "1.0.0");
        assert!(matches!(second, Err(RuntimeHostError::AlreadyRunning(_))));
        Ok(())
    }
}
