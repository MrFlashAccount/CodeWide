//! File-spool IPC proxy for the immutable macOS update guardian.
//!
//! The proxy never owns update state. It only submits versioned requests to
//! the external `LaunchAgent` and reads the guardian-authored reply.

use std::{
    fmt::Write as _,
    fs::{self, File, OpenOptions},
    io::{ErrorKind, Write},
    os::unix::fs::{MetadataExt, OpenOptionsExt, PermissionsExt},
    path::{Path, PathBuf},
    sync::Arc,
    time::{Duration, Instant},
};

use async_trait::async_trait;
use companion_core::host_update::{
    ApplyHostUpdateAccepted, ApplyHostUpdateCommand, GuardianError, GuardianErrorCode,
    HOST_UPDATE_API_VERSION, HOST_UPDATE_BOOTSTRAP_VERSION, HOST_UPDATE_GUARDIAN_CONTRACT_VERSION,
    HOST_UPDATE_JOURNAL_VERSION, HOST_UPDATE_UNOFFICIAL_BUILD_REASON, HostUpdateCapability,
    HostUpdateGuardian, HostUpdateOperation, HostUpdateStatus, ReconnectReceipt, ReleaseTrust,
    SharedHostUpdateGuardian,
};
use rand::TryRngCore;
use serde::{Deserialize, Serialize, de::DeserializeOwned};

const IPC_VERSION: u16 = 1;
const REQUEST_TIMEOUT: Duration = Duration::from_secs(8);
const CHECK_TIMEOUT: Duration = Duration::from_mins(10);
const POLL_INTERVAL: Duration = Duration::from_millis(20);

#[derive(Debug)]
pub(crate) struct MacOsHostUpdateGuardian {
    updater_root: PathBuf,
    timeout: Duration,
    /// Whether this build embeds the release signing key. The Swift guardian
    /// verifies releases with the bundle's copy; a build without it never applies.
    official_build: bool,
}

impl MacOsHostUpdateGuardian {
    pub(crate) fn shared(updater_root: PathBuf) -> SharedHostUpdateGuardian {
        Arc::new(Self {
            updater_root,
            timeout: REQUEST_TIMEOUT,
            official_build: ReleaseTrust::embedded().is_some(),
        })
    }

    fn bootstrap_paths(&self) -> (PathBuf, PathBuf) {
        let root = self.updater_root.join("bootstrap-v1");
        (root.join("CodeWideUpdateGuardian"), root.join("trust.json"))
    }

    fn ipc_root(&self) -> PathBuf {
        self.updater_root.join("v1/ipc")
    }

    fn capability_receipt(&self) -> PathBuf {
        self.updater_root.join("v1/capability-v1.json")
    }

    fn bootstrap_available(&self) -> bool {
        let (executable, trust) = self.bootstrap_paths();
        let Ok(root_metadata) = fs::symlink_metadata(&self.updater_root) else {
            return false;
        };
        if !root_metadata.is_dir()
            || root_metadata.file_type().is_symlink()
            || root_metadata.permissions().mode() & 0o077 != 0
        {
            return false;
        }
        let owner = root_metadata.uid();
        let bootstrap = self.updater_root.join("bootstrap-v1");
        if !private_directory(&bootstrap, owner) {
            return false;
        }
        private_regular_file(&executable, true, owner) && private_regular_file(&trust, false, owner)
    }

    fn apply_ready(&self) -> bool {
        let Ok(owner) = fs::symlink_metadata(&self.updater_root).map(|metadata| metadata.uid())
        else {
            return false;
        };
        self.bootstrap_available() && private_regular_file(&self.capability_receipt(), false, owner)
    }

    async fn request<T: DeserializeOwned + Send + 'static>(
        &self,
        body: GuardianRequestBody,
        timeout: Duration,
    ) -> Result<T, GuardianError> {
        if !self.official_build {
            return Err(GuardianError::new(
                GuardianErrorCode::ManualUpdateRequired,
                HOST_UPDATE_UNOFFICIAL_BUILD_REASON,
            ));
        }
        if !self.bootstrap_available() {
            return Err(GuardianError::new(
                GuardianErrorCode::ManualUpdateRequired,
                "The immutable macOS update guardian has not been bootstrapped",
            ));
        }
        let updater_root = self.updater_root.clone();
        let ipc_root = self.ipc_root();
        tokio::task::spawn_blocking(move || {
            send_request::<T>(&updater_root, &ipc_root, body, timeout)
        })
        .await
        .map_err(|error| GuardianError::new(GuardianErrorCode::Internal, error.to_string()))?
    }
}

#[async_trait]
impl HostUpdateGuardian for MacOsHostUpdateGuardian {
    fn capability(&self) -> HostUpdateCapability {
        if !self.official_build {
            HostUpdateCapability::disabled(HOST_UPDATE_UNOFFICIAL_BUILD_REASON)
        } else if self.apply_ready() {
            HostUpdateCapability {
                api_version: HOST_UPDATE_API_VERSION,
                guardian_contract_version: HOST_UPDATE_GUARDIAN_CONTRACT_VERSION,
                journal_version: HOST_UPDATE_JOURNAL_VERSION,
                bootstrap_version: HOST_UPDATE_BOOTSTRAP_VERSION,
                apply_supported: true,
                unavailable_reason: None,
            }
        } else {
            HostUpdateCapability::disabled("manual_bootstrap_required")
        }
    }

    async fn status(&self) -> Result<HostUpdateStatus, GuardianError> {
        self.request(GuardianRequestBody::Status, self.timeout)
            .await
    }

    async fn check(&self) -> Result<HostUpdateStatus, GuardianError> {
        self.request(GuardianRequestBody::Check, CHECK_TIMEOUT)
            .await
    }

    async fn apply(
        &self,
        command: ApplyHostUpdateCommand,
    ) -> Result<ApplyHostUpdateAccepted, GuardianError> {
        self.request(GuardianRequestBody::Apply { command }, self.timeout)
            .await
    }

    async fn operation(&self, operation_id: &str) -> Result<HostUpdateOperation, GuardianError> {
        self.request(
            GuardianRequestBody::Operation {
                operation_id: operation_id.to_owned(),
            },
            self.timeout,
        )
        .await
    }

    async fn reconnect(
        &self,
        receipt: ReconnectReceipt,
    ) -> Result<HostUpdateOperation, GuardianError> {
        self.request(GuardianRequestBody::Reconnect { receipt }, self.timeout)
            .await
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct GuardianRequest {
    ipc_version: u16,
    api_version: u16,
    guardian_contract_version: u16,
    journal_version: u16,
    bootstrap_version: u16,
    request_id: String,
    #[serde(flatten)]
    body: GuardianRequestBody,
}

#[derive(Debug, Serialize)]
#[serde(tag = "method", rename_all = "camelCase")]
enum GuardianRequestBody {
    Status,
    Check,
    Apply { command: ApplyHostUpdateCommand },
    Operation { operation_id: String },
    Reconnect { receipt: ReconnectReceipt },
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct GuardianResponse<T> {
    ipc_version: u16,
    request_id: String,
    payload: Option<T>,
    error: Option<GuardianResponseError>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct GuardianResponseError {
    code: String,
    message: String,
}

fn send_request<T: DeserializeOwned>(
    updater_root: &Path,
    ipc_root: &Path,
    body: GuardianRequestBody,
    timeout: Duration,
) -> Result<T, GuardianError> {
    ensure_private_directory(updater_root, None)?;
    let owner = fs::symlink_metadata(updater_root).map_err(internal)?.uid();
    ensure_private_directory(&updater_root.join("v1"), Some(owner))?;
    let inbox = ipc_root.join("inbox");
    let outbox = ipc_root.join("outbox");
    ensure_private_directory(ipc_root, Some(owner))?;
    ensure_private_directory(&inbox, Some(owner))?;
    ensure_private_directory(&outbox, Some(owner))?;
    let request_id = random_identifier()?;
    let request = GuardianRequest {
        ipc_version: IPC_VERSION,
        api_version: HOST_UPDATE_API_VERSION,
        guardian_contract_version: HOST_UPDATE_GUARDIAN_CONTRACT_VERSION,
        journal_version: HOST_UPDATE_JOURNAL_VERSION,
        bootstrap_version: HOST_UPDATE_BOOTSTRAP_VERSION,
        request_id: request_id.clone(),
        body,
    };
    let bytes = serde_json::to_vec(&request).map_err(internal)?;
    atomic_private_write(&inbox.join(format!("{request_id}.json")), &bytes)?;

    let response_path = outbox.join(format!("{request_id}.json"));
    let started = Instant::now();
    loop {
        match fs::read(&response_path) {
            Ok(bytes) => {
                fs::remove_file(&response_path).map_err(internal)?;
                sync_directory(&outbox)?;
                let response: GuardianResponse<T> =
                    serde_json::from_slice(&bytes).map_err(internal)?;
                if response.ipc_version != IPC_VERSION || response.request_id != request_id {
                    return Err(GuardianError::new(
                        GuardianErrorCode::Internal,
                        "The macOS guardian returned a mismatched IPC response",
                    ));
                }
                return match (response.payload, response.error) {
                    (Some(payload), None) => Ok(payload),
                    (None, Some(error)) => Err(GuardianError::new(
                        guardian_error_code(&error.code),
                        error.message,
                    )),
                    _ => Err(GuardianError::new(
                        GuardianErrorCode::Internal,
                        "The macOS guardian returned an invalid IPC response",
                    )),
                };
            }
            Err(error) if error.kind() == ErrorKind::NotFound => {}
            Err(error) => return Err(internal(error)),
        }
        if started.elapsed() >= timeout {
            return Err(GuardianError::new(
                GuardianErrorCode::Internal,
                "The macOS update guardian did not answer before the IPC deadline",
            ));
        }
        std::thread::sleep(POLL_INTERVAL);
    }
}

fn guardian_error_code(value: &str) -> GuardianErrorCode {
    match value {
        "operation_not_found" => GuardianErrorCode::NotFound,
        "operation_conflict" => GuardianErrorCode::Conflict,
        "idempotency_conflict" => GuardianErrorCode::IdempotencyConflict,
        "precondition_failed" => GuardianErrorCode::PreconditionFailed,
        "update_locked" => GuardianErrorCode::Locked,
        "manual_update_required" => GuardianErrorCode::ManualUpdateRequired,
        _ => GuardianErrorCode::Internal,
    }
}

fn random_identifier() -> Result<String, GuardianError> {
    let mut bytes = [0_u8; 16];
    rand::rngs::OsRng
        .try_fill_bytes(&mut bytes)
        .map_err(internal)?;
    let mut identifier = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        write!(&mut identifier, "{byte:02x}").map_err(internal)?;
    }
    Ok(identifier)
}

fn ensure_private_directory(path: &Path, expected_owner: Option<u32>) -> Result<(), GuardianError> {
    fs::create_dir_all(path).map_err(internal)?;
    fs::set_permissions(path, fs::Permissions::from_mode(0o700)).map_err(internal)?;
    let metadata = fs::symlink_metadata(path).map_err(internal)?;
    if !metadata.is_dir()
        || metadata.file_type().is_symlink()
        || expected_owner.is_some_and(|owner| metadata.uid() != owner)
    {
        return Err(GuardianError::new(
            GuardianErrorCode::ManualUpdateRequired,
            "The macOS guardian spool is not a private user-owned directory",
        ));
    }
    Ok(())
}

fn private_regular_file(path: &Path, executable: bool, expected_owner: u32) -> bool {
    let Ok(metadata) = fs::symlink_metadata(path) else {
        return false;
    };
    let mode = metadata.permissions().mode();
    metadata.is_file()
        && !metadata.file_type().is_symlink()
        && metadata.uid() == expected_owner
        && mode & 0o022 == 0
        && (!executable || mode & 0o100 != 0)
}

#[allow(clippy::verbose_bit_mask)]
fn private_directory(path: &Path, expected_owner: u32) -> bool {
    let Ok(metadata) = fs::symlink_metadata(path) else {
        return false;
    };
    metadata.is_dir()
        && !metadata.file_type().is_symlink()
        && metadata.uid() == expected_owner
        && metadata.permissions().mode() & 0o077 == 0
}

fn atomic_private_write(path: &Path, bytes: &[u8]) -> Result<(), GuardianError> {
    let parent = path
        .parent()
        .ok_or_else(|| GuardianError::new(GuardianErrorCode::Internal, "IPC path has no parent"))?;
    let temporary = parent.join(format!(".{}.tmp", random_identifier()?));
    let mut file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .mode(0o600)
        .open(&temporary)
        .map_err(internal)?;
    file.write_all(bytes).map_err(internal)?;
    file.sync_all().map_err(internal)?;
    fs::rename(&temporary, path).map_err(internal)?;
    sync_directory(parent)
}

fn sync_directory(path: &Path) -> Result<(), GuardianError> {
    File::open(path)
        .and_then(|file| file.sync_all())
        .map_err(internal)
}

fn internal(error: impl std::fmt::Display) -> GuardianError {
    GuardianError::new(GuardianErrorCode::Internal, error.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn build_without_embedded_trust_reports_an_unofficial_build()
    -> Result<(), Box<dyn std::error::Error>> {
        let root = tempfile::tempdir()?;
        let guardian = MacOsHostUpdateGuardian {
            updater_root: root.path().to_owned(),
            timeout: Duration::from_millis(20),
            official_build: false,
        };
        let capability = guardian.capability();
        assert!(!capability.apply_supported);
        assert_eq!(
            capability.unavailable_reason.as_deref(),
            Some(HOST_UPDATE_UNOFFICIAL_BUILD_REASON)
        );
        Ok(())
    }

    #[test]
    fn capability_stays_disabled_without_an_immutable_bootstrap()
    -> Result<(), Box<dyn std::error::Error>> {
        let root = tempfile::tempdir()?;
        let guardian = MacOsHostUpdateGuardian {
            updater_root: root.path().to_owned(),
            timeout: Duration::from_millis(20),
            official_build: true,
        };
        let capability = guardian.capability();
        assert!(!capability.apply_supported);
        assert_eq!(
            capability.unavailable_reason.as_deref(),
            Some("manual_bootstrap_required")
        );
        Ok(())
    }

    #[test]
    fn bootstrap_must_be_private_and_user_owned() -> Result<(), Box<dyn std::error::Error>> {
        let root = tempfile::tempdir()?;
        fs::set_permissions(root.path(), fs::Permissions::from_mode(0o700))?;
        let bootstrap = root.path().join("bootstrap-v1");
        fs::create_dir(&bootstrap)?;
        fs::set_permissions(&bootstrap, fs::Permissions::from_mode(0o700))?;
        fs::write(bootstrap.join("CodeWideUpdateGuardian"), b"guardian")?;
        fs::write(bootstrap.join("trust.json"), b"{}")?;
        fs::set_permissions(
            bootstrap.join("CodeWideUpdateGuardian"),
            fs::Permissions::from_mode(0o755),
        )?;
        fs::set_permissions(
            bootstrap.join("trust.json"),
            fs::Permissions::from_mode(0o666),
        )?;
        let guardian = MacOsHostUpdateGuardian {
            updater_root: root.path().to_owned(),
            timeout: Duration::from_millis(20),
            official_build: true,
        };
        assert!(!guardian.capability().apply_supported);
        Ok(())
    }

    #[test]
    fn bootstrap_without_guardian_verified_receipt_cannot_apply()
    -> Result<(), Box<dyn std::error::Error>> {
        let root = tempfile::tempdir()?;
        let bootstrap = root.path().join("bootstrap-v1");
        fs::create_dir(&bootstrap)?;
        fs::set_permissions(&bootstrap, fs::Permissions::from_mode(0o700))?;
        fs::write(bootstrap.join("CodeWideUpdateGuardian"), b"guardian")?;
        fs::write(bootstrap.join("trust.json"), b"{}")?;
        fs::set_permissions(
            bootstrap.join("CodeWideUpdateGuardian"),
            fs::Permissions::from_mode(0o700),
        )?;
        fs::set_permissions(
            bootstrap.join("trust.json"),
            fs::Permissions::from_mode(0o600),
        )?;
        let guardian = MacOsHostUpdateGuardian {
            updater_root: root.path().to_owned(),
            timeout: Duration::from_millis(20),
            official_build: true,
        };
        assert!(!guardian.capability().apply_supported);
        Ok(())
    }

    #[test]
    fn guardian_verified_receipt_enables_remote_apply_capability()
    -> Result<(), Box<dyn std::error::Error>> {
        let root = tempfile::tempdir()?;
        fs::set_permissions(root.path(), fs::Permissions::from_mode(0o700))?;
        let bootstrap = root.path().join("bootstrap-v1");
        let state = root.path().join("v1");
        fs::create_dir(&bootstrap)?;
        fs::create_dir(&state)?;
        fs::set_permissions(&bootstrap, fs::Permissions::from_mode(0o700))?;
        fs::write(bootstrap.join("CodeWideUpdateGuardian"), b"guardian")?;
        fs::write(bootstrap.join("trust.json"), b"{}")?;
        fs::write(state.join("capability-v1.json"), b"{}")?;
        for (path, mode) in [
            (bootstrap.join("CodeWideUpdateGuardian"), 0o700),
            (bootstrap.join("trust.json"), 0o600),
            (state.join("capability-v1.json"), 0o600),
        ] {
            fs::set_permissions(path, fs::Permissions::from_mode(mode))?;
        }
        let guardian = MacOsHostUpdateGuardian {
            updater_root: root.path().to_owned(),
            timeout: Duration::from_millis(20),
            official_build: true,
        };
        assert!(guardian.capability().apply_supported);
        Ok(())
    }
}
