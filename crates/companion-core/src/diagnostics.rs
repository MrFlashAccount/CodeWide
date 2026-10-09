//! Durable, lossless diagnostic reports, separate from bounded numeric telemetry.

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::BTreeMap,
    fs,
    io::{Read, Write},
    path::{Path, PathBuf},
    sync::Mutex,
};

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DiagnosticError {
    pub name: String,
    pub message: String,
    pub stack: String,
    #[serde(default)]
    pub native_stack: String,
    #[serde(default)]
    pub causes: Vec<DiagnosticCause>,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DiagnosticCause {
    pub name: String,
    pub message: String,
    pub stack: String,
    #[serde(default)]
    pub native_stack: String,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum DiagnosticSource {
    Javascript,
    Jvm,
    ProcessExit,
    Logcat,
    NativeTrace,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum DiagnosticLevel {
    Debug,
    Info,
    Warn,
    Error,
    Fatal,
}

/// A validated application report. Text has no truncation or length limit.
#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DiagnosticReport {
    pub version: u32,
    pub report_id: String,
    pub occurred_at_unix_ms: u64,
    pub app_version: String,
    pub source: DiagnosticSource,
    pub event: String,
    pub level: DiagnosticLevel,
    #[serde(default)]
    pub message: String,
    pub err: Option<DiagnosticError>,
    pub fields: BTreeMap<String, serde_json::Value>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DiagnosticReceipt {
    pub report_id: String,
    pub sha256: String,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct StoredDiagnosticMetadata {
    pub received_at_unix_ms: u64,
    pub device_id: String,
    pub receipt: DiagnosticReceipt,
}

#[derive(Debug, thiserror::Error)]
pub enum DiagnosticStoreError {
    #[error("invalid diagnostic report")]
    Invalid,
    #[error("diagnostic report identifier conflicts with persisted content")]
    Conflict,
    #[error("diagnostic storage failed")]
    Io(#[from] std::io::Error),
    #[error("diagnostic document is invalid")]
    Json(#[from] serde_json::Error),
}

pub struct DiagnosticStore {
    directory: PathBuf,
    commit_lock: Mutex<()>,
}

impl DiagnosticStore {
    /// Opens a private archive. Reports are retained until explicitly removed by the host owner.
    ///
    /// # Errors
    /// Returns an error if the private archive cannot be created.
    pub fn open(directory: impl AsRef<Path>) -> Result<Self, DiagnosticStoreError> {
        let directory = directory.as_ref().to_path_buf();
        private_directory(&directory)?;
        if let Some(parent) = directory.parent() {
            fs::File::open(parent)?.sync_all()?;
        }
        Ok(Self {
            directory,
            commit_lock: Mutex::new(()),
        })
    }

    /// Creates a private disk spool; HTTP ingress never materializes the entire body.
    ///
    /// # Errors
    /// Returns an error if the spool cannot be created.
    pub fn incoming(&self) -> Result<tempfile::NamedTempFile, DiagnosticStoreError> {
        Ok(tempfile::NamedTempFile::new_in(&self.directory)?)
    }

    /// Validates and atomically publishes both complete report bytes and their receipt.
    ///
    /// # Errors
    /// Rejects invalid or conflicting reports and propagates storage failures without acknowledging them.
    pub fn commit(
        &self,
        device_id: &str,
        report_id: &str,
        incoming: &tempfile::NamedTempFile,
    ) -> Result<DiagnosticReceipt, DiagnosticStoreError> {
        if !valid_report_id(report_id) {
            return Err(DiagnosticStoreError::Invalid);
        }
        let report: DiagnosticReport = serde_json::from_reader(fs::File::open(incoming.path())?)?;
        validate_report(&report, report_id)?;
        let sha256 = digest_file(incoming.path())?;
        let device_directory = self
            .directory
            .join(hex::encode(Sha256::digest(device_id.as_bytes())));
        private_directory(&device_directory)?;
        let destination = device_directory.join(report_id);
        let _lock = self
            .commit_lock
            .lock()
            .map_err(|_| DiagnosticStoreError::Invalid)?;
        if destination.exists() {
            let stored: StoredDiagnosticMetadata =
                serde_json::from_reader(fs::File::open(destination.join("receipt.json"))?)?;
            return if stored.receipt.sha256 == sha256 {
                fs::File::open(destination.join("report.json"))?.sync_all()?;
                fs::File::open(destination.join("receipt.json"))?.sync_all()?;
                fs::File::open(&destination)?.sync_all()?;
                fs::File::open(&device_directory)?.sync_all()?;
                fs::File::open(&self.directory)?.sync_all()?;
                Ok(stored.receipt)
            } else {
                Err(DiagnosticStoreError::Conflict)
            };
        }
        let receipt = DiagnosticReceipt {
            report_id: report_id.to_owned(),
            sha256,
        };
        let pending = tempfile::tempdir_in(&device_directory)?;
        let report_path = pending.path().join("report.json");
        fs::rename(incoming.path(), &report_path)?;
        fs::File::open(&report_path)?.sync_all()?;
        let metadata = StoredDiagnosticMetadata {
            received_at_unix_ms: u64::try_from(
                std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .unwrap_or_default()
                    .as_millis(),
            )
            .unwrap_or(u64::MAX),
            device_id: device_id.to_owned(),
            receipt: receipt.clone(),
        };
        let mut file = fs::File::create(pending.path().join("receipt.json"))?;
        serde_json::to_writer(&mut file, &metadata)?;
        file.flush()?;
        file.sync_all()?;
        fs::File::open(pending.path())?.sync_all()?;
        fs::rename(pending.path(), &destination)?;
        fs::File::open(&device_directory)?.sync_all()?;
        fs::File::open(&self.directory)?.sync_all()?;
        Ok(receipt)
    }

    /// Lists receipts without loading potentially large report contents.
    ///
    /// # Errors
    /// Returns an error if an archive entry cannot be read.
    pub fn list(&self) -> Result<Vec<StoredDiagnosticMetadata>, DiagnosticStoreError> {
        let mut result: Vec<StoredDiagnosticMetadata> = Vec::new();
        for device in fs::read_dir(&self.directory)? {
            let device = device?;
            if !device.file_type()?.is_dir() {
                continue;
            }
            for report in fs::read_dir(device.path())? {
                let report = report?;
                if !valid_report_id(&report.file_name().to_string_lossy()) {
                    continue;
                }
                result.push(serde_json::from_reader(fs::File::open(
                    report.path().join("receipt.json"),
                )?)?);
            }
        }
        result.sort_unstable_by_key(|entry| entry.received_at_unix_ms);
        Ok(result)
    }

    /// Resolves an administrator's complete report, scoped to its authenticated device archive.
    ///
    /// # Errors
    /// Rejects report identifiers outside the UUID filename contract.
    pub fn report_path(
        &self,
        device_id: &str,
        report_id: &str,
    ) -> Result<PathBuf, DiagnosticStoreError> {
        if !valid_report_id(report_id) {
            return Err(DiagnosticStoreError::Invalid);
        }
        Ok(self
            .directory
            .join(hex::encode(Sha256::digest(device_id.as_bytes())))
            .join(report_id)
            .join("report.json"))
    }
}

fn validate_report(report: &DiagnosticReport, report_id: &str) -> Result<(), DiagnosticStoreError> {
    if report.version != 1
        || report.report_id != report_id
        || report.occurred_at_unix_ms == 0
        || report.app_version.is_empty()
        || report.event.is_empty()
        || !report
            .event
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b"._-".contains(&b))
    {
        return Err(DiagnosticStoreError::Invalid);
    }
    for (key, value) in &report.fields {
        if key.is_empty() || value.is_array() || value.is_object() {
            return Err(DiagnosticStoreError::Invalid);
        }
    }
    Ok(())
}

fn valid_report_id(id: &str) -> bool {
    id.len() == 36
        && id.bytes().enumerate().all(|(i, b)| {
            if [8, 13, 18, 23].contains(&i) {
                b == b'-'
            } else {
                b.is_ascii_hexdigit()
            }
        })
}

fn digest_file(path: &Path) -> Result<String, std::io::Error> {
    let mut input = fs::File::open(path)?;
    let mut digest = Sha256::new();
    let mut buffer = [0_u8; 8 * 1024];
    loop {
        let count = input.read(&mut buffer)?;
        if count == 0 {
            break;
        }
        digest.update(&buffer[..count]);
    }
    Ok(hex::encode(digest.finalize()))
}

fn private_directory(path: &Path) -> Result<(), std::io::Error> {
    fs::create_dir_all(path)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(path, fs::Permissions::from_mode(0o700))?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    type TestResult<T> = Result<T, Box<dyn std::error::Error>>;
    const ID: &str = "a070bca3-7b4b-4f16-96a0-c31b4956fe66";
    fn spool(store: &DiagnosticStore, message: &str) -> TestResult<tempfile::NamedTempFile> {
        let report = serde_json::json!({"version":1,"reportId":ID,"occurredAtUnixMs":123,
            "appVersion":"test","source":"javascript","event":"render.root.failed","level":"error",
            "err":{"name":"Error","message":message,"stack":format!("Error: {message}\n at render")},
            "fields":{"requestId":"request-opaque"}});
        let mut file = store.incoming()?;
        serde_json::to_writer(&mut file, &report)?;
        Ok(file)
    }
    #[test]
    fn full_text_survives_restart_and_retry_and_conflicting_retry_is_rejected() -> TestResult<()> {
        let root = tempfile::tempdir()?;
        let message = "diagnostic λ ".repeat(100_000);
        let store = DiagnosticStore::open(root.path())?;
        let receipt = store.commit("device-a", ID, &spool(&store, &message)?)?;
        drop(store);
        let store = DiagnosticStore::open(root.path())?;
        let decoded: DiagnosticReport =
            serde_json::from_reader(fs::File::open(store.report_path("device-a", ID)?)?)?;
        assert_eq!(
            decoded.err.ok_or("missing diagnostic exception")?.message,
            message
        );
        assert_eq!(
            store
                .commit("device-a", ID, &spool(&store, &message)?)?
                .sha256,
            receipt.sha256
        );
        assert!(matches!(
            store.commit("device-a", ID, &spool(&store, "different")?),
            Err(DiagnosticStoreError::Conflict)
        ));
        assert_eq!(store.list()?.len(), 1);
        assert!(!store.report_path("device-b", ID)?.exists());
        Ok(())
    }
    #[test]
    fn incomplete_invalid_and_traversal_reports_never_receive_a_receipt() -> TestResult<()> {
        let root = tempfile::tempdir()?;
        let store = DiagnosticStore::open(root.path())?;
        let mut file = store.incoming()?;
        file.write_all(b"{\"version\":1")?;
        assert!(store.commit("device-a", ID, &file).is_err());
        assert!(
            store
                .commit("device-a", "../escape", &spool(&store, "message")?)
                .is_err()
        );
        assert!(store.list()?.is_empty());
        Ok(())
    }
}
