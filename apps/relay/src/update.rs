//! Signed, crash-resumable Relay self-update owned by a short-lived updater process.

use crate::{Result, admin};
use base64::{Engine as _, engine::general_purpose};
use futures_util::StreamExt;
use p256::{
    ecdsa::{Signature, VerifyingKey, signature::Verifier},
    pkcs8::DecodePublicKey,
};
use serde::{Deserialize, Serialize, de::DeserializeOwned};
use sha2::{Digest, Sha256};
use std::{
    fs::{self, File, OpenOptions},
    io::{Read, Write},
    os::unix::fs::{OpenOptionsExt, PermissionsExt},
    path::{Path, PathBuf},
    process::Stdio,
    sync::Arc,
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use tokio::{net::UnixStream, process::Command, sync::Mutex};

const API_VERSION: u16 = 1;
const UPDATER_CONTRACT_VERSION: u16 = 1;
const JOURNAL_VERSION: u16 = 1;
const BOOTSTRAP_VERSION: u16 = 1;
const STATE_EPOCH: u32 = 1;
const MAX_MANIFEST_BYTES: usize = 1024 * 1024;
const MAX_ARTIFACT_BYTES: u64 = 128 * 1024 * 1024;
const MAX_DESCRIPTOR_LIFETIME: u64 = 180 * 24 * 60 * 60;
const MANIFEST_URL: &str =
    "https://github.com/MrFlashAccount/CodeWide/releases/latest/download/release-manifest.json";

#[must_use]
pub const fn embedded_trust() -> (&'static str, &'static str) {
    (
        env!("CODEWIDE_RELAY_UPDATE_KEY_ID"),
        env!("CODEWIDE_RELAY_UPDATE_PUBLIC_KEY_SPKI"),
    )
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum RelayUpdatePhase {
    Accepted,
    Installing,
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

impl RelayUpdateCapability {
    fn supported() -> Self {
        Self {
            api_version: API_VERSION,
            updater_contract_version: UPDATER_CONTRACT_VERSION,
            journal_version: JOURNAL_VERSION,
            bootstrap_version: BOOTSTRAP_VERSION,
            apply_supported: true,
            unavailable_reason: None,
        }
    }

    fn disabled(reason: &str) -> Self {
        Self {
            api_version: API_VERSION,
            updater_contract_version: 0,
            journal_version: 0,
            bootstrap_version: 0,
            apply_supported: false,
            unavailable_reason: Some(reason.to_owned()),
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

impl RelayUpdateError {
    fn new(code: &'static str, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
        }
    }
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct UpdaterConfigV1 {
    schema_version: u16,
    key_id: String,
    public_key_spki: String,
    #[serde(default = "default_manifest_url")]
    manifest_url: String,
    install_path: PathBuf,
    updater_path: PathBuf,
    service_scope: ServiceScope,
    service_name: String,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum ServiceScope {
    User,
    System,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct InstalledReceiptV1 {
    schema_version: u16,
    version: String,
    build: String,
    source_revision: String,
    artifact_digest: String,
    highest_sequence: u64,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct CachedRelease {
    envelope: SignedReleaseDescriptor,
    target: ReleaseTargetV1,
    target_fingerprint: String,
    sequence: u64,
    expires_at: u64,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct OperationRecord {
    journal_version: u16,
    operation_id: String,
    route_id: String,
    idempotency_key: String,
    current: InstalledReceiptV1,
    target: ReleaseTargetV1,
    target_fingerprint: String,
    release_sequence: u64,
    envelope: SignedReleaseDescriptor,
    phase: RelayUpdatePhase,
    started_at: u64,
    updated_at: u64,
    reconnect_by: u64,
    error_code: Option<String>,
    error_message: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct ReconnectReceipt {
    route_id: String,
    observed_at: u64,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct SignedReleaseDescriptor {
    schema_version: u16,
    key_id: String,
    algorithm: String,
    payload: String,
    signature: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct ReleaseDescriptorV1 {
    schema_version: u16,
    channel: String,
    sequence: u64,
    issued_at: u64,
    expires_at: u64,
    targets: Vec<ReleaseTargetV1>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct ReleaseTargetV1 {
    platform: String,
    version: String,
    build: String,
    source_revision: String,
    artifact_url: String,
    sha256: String,
    bootstrap_version: u16,
    journal_version: u16,
    state_epoch: u32,
    rollback_compatible_from: Vec<String>,
}

#[derive(Clone)]
pub struct RelayUpdater {
    root: Arc<PathBuf>,
    lock: Arc<Mutex<()>>,
}

pub struct RelayUpdaterRunConfig {
    pub relay_state_root: PathBuf,
    pub install_path: PathBuf,
    pub updater_path: PathBuf,
    pub service_scope: ServiceScope,
    pub service_name: String,
}

impl RelayUpdater {
    #[must_use]
    pub fn new(relay_state_root: &Path) -> Self {
        Self {
            root: Arc::new(relay_state_root.join("update")),
            lock: Arc::new(Mutex::new(())),
        }
    }

    /// Reads the durable Relay Updater projection.
    ///
    /// # Errors
    ///
    /// Returns an error when durable update state cannot be read safely.
    pub async fn status(&self) -> std::result::Result<RelayUpdateStatus, RelayUpdateError> {
        let _guard = self.lock.lock().await;
        self.status_inner()
    }

    /// Downloads, authenticates, and caches the current Relay release descriptor.
    ///
    /// # Errors
    ///
    /// Returns an error when the release cannot be downloaded or admitted.
    pub async fn check(&self) -> std::result::Result<RelayUpdateStatus, RelayUpdateError> {
        let _guard = self.lock.lock().await;
        let (config, receipt) = self.bootstrap()?;
        let bytes = download_bounded(&config.manifest_url, MAX_MANIFEST_BYTES as u64).await?;
        let envelope: SignedReleaseDescriptor = serde_json::from_slice(&bytes).map_err(|_| {
            update_error(
                "invalid_release_manifest",
                "The Relay release manifest is malformed.",
            )
        })?;
        let cached = admit_release(&envelope, &config, &receipt, unix_seconds()?)?;
        atomic_json(&self.root.join("release.json"), &cached)?;
        self.status_inner()
    }

    /// Persists one idempotent Relay update operation and triggers the updater.
    ///
    /// # Errors
    ///
    /// Returns an error when the intent is invalid, unsafe, or cannot be persisted.
    pub async fn apply(
        &self,
        route_id: &str,
        request: ApplyRelayUpdateRequest,
    ) -> std::result::Result<ApplyRelayUpdateAccepted, RelayUpdateError> {
        let _guard = self.lock.lock().await;
        validate_intent(&request)?;
        let (config, receipt) = self.bootstrap()?;
        let cached: CachedRelease = read_json(&self.root.join("release.json")).map_err(|_| {
            update_error(
                "precondition_failed",
                "Check for a Relay update before applying it.",
            )
        })?;
        let admitted = admit_release(&cached.envelope, &config, &receipt, unix_seconds()?)?;
        if admitted.target_fingerprint != request.target_fingerprint {
            return Err(update_error(
                "precondition_failed",
                "The selected Relay release changed. Check again before updating.",
            ));
        }
        if let Some(active_id) = read_optional_json::<String>(&self.root.join("active.json"))? {
            let active = read_operation(&self.root, &active_id)?;
            if active.idempotency_key == request.idempotency_key
                && active.route_id == route_id
                && active.target_fingerprint == request.target_fingerprint
            {
                return Ok(ApplyRelayUpdateAccepted {
                    operation_id: active.operation_id,
                    phase: active.phase,
                });
            }
            if !active.phase.is_terminal() {
                return Err(update_error(
                    "update_locked",
                    "Another Relay update is already running.",
                ));
            }
        }
        private_directory(&self.root.join("operations"))?;
        private_directory(&self.root.join("receipts"))?;
        let operation_id = crate::wire::nonce();
        let now = unix_millis()?;
        let operation = OperationRecord {
            journal_version: JOURNAL_VERSION,
            operation_id: operation_id.clone(),
            route_id: route_id.to_owned(),
            idempotency_key: request.idempotency_key,
            current: receipt,
            target: admitted.target,
            target_fingerprint: admitted.target_fingerprint,
            release_sequence: admitted.sequence,
            envelope: cached.envelope,
            phase: RelayUpdatePhase::Accepted,
            started_at: now,
            updated_at: now,
            reconnect_by: now.saturating_add(120_000),
            error_code: None,
            error_message: None,
        };
        atomic_json(&operation_path(&self.root, &operation_id), &operation)?;
        atomic_json(&self.root.join("active.json"), &operation_id)?;
        durable_marker(&self.root.join("pending"))?;
        trigger_updater(config.service_scope);
        Ok(ApplyRelayUpdateAccepted {
            operation_id,
            phase: RelayUpdatePhase::Accepted,
        })
    }

    /// Reads one durable Relay update operation.
    ///
    /// # Errors
    ///
    /// Returns an error when the operation does not exist or cannot be decoded.
    pub async fn operation(
        &self,
        operation_id: &str,
    ) -> std::result::Result<RelayUpdateOperation, RelayUpdateError> {
        let _guard = self.lock.lock().await;
        Ok(operation_view(&read_operation(&self.root, operation_id)?))
    }

    /// Records an authenticated Companion reconnect for an update operation.
    ///
    /// # Errors
    ///
    /// Returns an error when the operation is unavailable or proof cannot be persisted.
    pub async fn reconnect(
        &self,
        route_id: &str,
        operation_id: &str,
    ) -> std::result::Result<RelayUpdateOperation, RelayUpdateError> {
        let _guard = self.lock.lock().await;
        let operation = read_operation(&self.root, operation_id)?;
        if operation.route_id != route_id {
            return Err(update_error(
                "operation_not_found",
                "Relay update operation was not found.",
            ));
        }
        if operation.phase == RelayUpdatePhase::AwaitingReconnect {
            atomic_json(
                &self
                    .root
                    .join("receipts")
                    .join(format!("{operation_id}.json")),
                &ReconnectReceipt {
                    route_id: route_id.to_owned(),
                    observed_at: unix_millis()?,
                },
            )?;
        }
        Ok(operation_view(&operation))
    }

    /// Records proof that an authenticated paired Companion reached the exact
    /// target Relay binary after restart. Unlike the public endpoint, this may
    /// observe the connection while the updater is still completing readiness.
    pub async fn observe_route_reconnect(&self, route_id: &str) {
        let _guard = self.lock.lock().await;
        let Ok(Some(operation_id)) = read_optional_json::<String>(&self.root.join("active.json"))
        else {
            return;
        };
        let Ok(operation) = read_operation(&self.root, &operation_id) else {
            return;
        };
        if operation.route_id != route_id
            || operation.target.version != env!("CODEWIDE_RELAY_VERSION")
            || !matches!(
                operation.phase,
                RelayUpdatePhase::Installing | RelayUpdatePhase::AwaitingReconnect
            )
        {
            return;
        }
        let _ = atomic_json(
            &self
                .root
                .join("receipts")
                .join(format!("{operation_id}.json")),
            &ReconnectReceipt {
                route_id: route_id.to_owned(),
                observed_at: unix_millis().unwrap_or(operation.started_at),
            },
        );
    }

    fn status_inner(&self) -> std::result::Result<RelayUpdateStatus, RelayUpdateError> {
        let active_operation = read_optional_json::<String>(&self.root.join("active.json"))?
            .map(|id| read_operation(&self.root, &id).map(|operation| operation_view(&operation)))
            .transpose()?;
        let current_version = env!("CODEWIDE_RELAY_VERSION").to_owned();
        let current_source_revision = env!("CODEWIDE_RELAY_SOURCE_REVISION").to_owned();
        match self.bootstrap() {
            Ok((_config, receipt)) => {
                let available_target = read_optional_json::<CachedRelease>(
                    &self.root.join("release.json"),
                )?
                .map(|cached| AvailableRelayUpdate {
                    version: cached.target.version,
                    build: cached.target.build,
                    source_revision: cached.target.source_revision,
                    target_fingerprint: cached.target_fingerprint,
                    release_sequence: cached.sequence,
                    expires_at: cached.expires_at,
                });
                Ok(RelayUpdateStatus {
                    current_version: receipt.version,
                    current_build: receipt.build,
                    current_source_revision: receipt.source_revision,
                    current_digest: receipt.artifact_digest,
                    capability: RelayUpdateCapability::supported(),
                    available_target,
                    active_operation,
                })
            }
            Err(_) => Ok(RelayUpdateStatus {
                current_version,
                current_build: current_source_revision.chars().take(12).collect(),
                current_source_revision,
                current_digest: String::new(),
                capability: RelayUpdateCapability::disabled("manual_bootstrap_required"),
                available_target: None,
                active_operation,
            }),
        }
    }

    fn bootstrap(
        &self,
    ) -> std::result::Result<(UpdaterConfigV1, InstalledReceiptV1), RelayUpdateError> {
        let config: UpdaterConfigV1 = read_json(&self.root.join("config.json")).map_err(|_| {
            update_error("manual_update_required", "Relay Updater is not installed.")
        })?;
        let receipt: InstalledReceiptV1 =
            read_json(&self.root.join("installed.json")).map_err(|_| {
                update_error(
                    "manual_update_required",
                    "Relay update baseline is missing.",
                )
            })?;
        validate_bootstrap(&config, &receipt)?;
        Ok((config, receipt))
    }
}

fn admit_release(
    envelope: &SignedReleaseDescriptor,
    config: &UpdaterConfigV1,
    receipt: &InstalledReceiptV1,
    now: u64,
) -> std::result::Result<CachedRelease, RelayUpdateError> {
    if envelope.schema_version != 1
        || envelope.algorithm != "ES256"
        || envelope.key_id != config.key_id
    {
        return Err(update_error(
            "invalid_release_signature",
            "The Relay release signature is not trusted.",
        ));
    }
    let payload = general_purpose::URL_SAFE_NO_PAD
        .decode(&envelope.payload)
        .map_err(|_| {
            update_error(
                "invalid_release_manifest",
                "The Relay release payload is malformed.",
            )
        })?;
    let key = general_purpose::STANDARD
        .decode(&config.public_key_spki)
        .ok()
        .and_then(|der| VerifyingKey::from_public_key_der(&der).ok())
        .ok_or_else(|| {
            update_error(
                "manual_update_required",
                "Relay Updater trust configuration is invalid.",
            )
        })?;
    let signature = general_purpose::STANDARD
        .decode(&envelope.signature)
        .ok()
        .and_then(|bytes| Signature::from_der(&bytes).ok())
        .ok_or_else(|| {
            update_error(
                "invalid_release_signature",
                "The Relay release signature is invalid.",
            )
        })?;
    key.verify(&payload, &signature).map_err(|_| {
        update_error(
            "invalid_release_signature",
            "The Relay release signature is invalid.",
        )
    })?;
    let descriptor: ReleaseDescriptorV1 = serde_json::from_slice(&payload).map_err(|_| {
        update_error(
            "invalid_release_manifest",
            "The Relay release payload is malformed.",
        )
    })?;
    let schema_invalid = descriptor.schema_version != 1 || descriptor.channel != "stable";
    let sequence_replayed = descriptor.sequence <= receipt.highest_sequence;
    let clock_invalid = descriptor.issued_at > now || descriptor.expires_at < now;
    let lifetime_invalid = descriptor.expires_at <= descriptor.issued_at
        || descriptor.expires_at - descriptor.issued_at > MAX_DESCRIPTOR_LIFETIME;
    if schema_invalid || sequence_replayed || clock_invalid || lifetime_invalid {
        return Err(update_error(
            "release_not_admissible",
            "The Relay release is stale or replayed.",
        ));
    }
    let mut matches = descriptor
        .targets
        .into_iter()
        .filter(|target| target.platform == "relay-linux-x86-64");
    let target = matches
        .next()
        .ok_or_else(|| update_error("update_not_available", "This release has no Relay update."))?;
    if matches.next().is_some()
        || target.bootstrap_version > BOOTSTRAP_VERSION
        || target.journal_version > JOURNAL_VERSION
        || target.state_epoch != STATE_EPOCH
        || compare_versions(&target.version, &receipt.version)? != std::cmp::Ordering::Greater
        || !target
            .rollback_compatible_from
            .contains(&receipt.artifact_digest)
        || !valid_target(&target)
    {
        return Err(update_error(
            "manual_update_required",
            "This Relay release cannot be applied safely from the installed version.",
        ));
    }
    let target_fingerprint = hex::encode(Sha256::digest(serde_json::to_vec(&target).map_err(
        |_| update_error("invalid_release_manifest", "The Relay target is malformed."),
    )?));
    Ok(CachedRelease {
        envelope: envelope.clone(),
        target,
        target_fingerprint,
        sequence: descriptor.sequence,
        expires_at: descriptor.expires_at,
    })
}

fn validate_bootstrap(
    config: &UpdaterConfigV1,
    receipt: &InstalledReceiptV1,
) -> std::result::Result<(), RelayUpdateError> {
    if config.schema_version != BOOTSTRAP_VERSION
        || config.manifest_url != MANIFEST_URL
        || !config.install_path.is_absolute()
        || !config.updater_path.is_absolute()
        || config.service_name != "codewide-relay.service"
        || config.key_id.is_empty()
        || config.public_key_spki.is_empty()
        || receipt.schema_version != 1
        || !lower_hex(&receipt.artifact_digest, 64)
        || !lower_hex(&receipt.source_revision, 40)
        || stable_version(&receipt.version).is_err()
    {
        return Err(update_error(
            "manual_update_required",
            "Relay Updater configuration is invalid.",
        ));
    }
    Ok(())
}

fn valid_target(target: &ReleaseTargetV1) -> bool {
    target
        .artifact_url
        .starts_with("https://github.com/MrFlashAccount/CodeWide/releases/download/")
        && target
            .artifact_url
            .ends_with("/codewide-relay-x86_64-unknown-linux-musl")
        && lower_hex(&target.sha256, 64)
        && lower_hex(&target.source_revision, 40)
        && !target.build.is_empty()
        && stable_version(&target.version).is_ok()
        && target
            .rollback_compatible_from
            .iter()
            .all(|digest| lower_hex(digest, 64))
}

fn validate_intent(request: &ApplyRelayUpdateRequest) -> std::result::Result<(), RelayUpdateError> {
    if !lower_hex(&request.target_fingerprint, 64)
        || request.idempotency_key.len() < 16
        || request.idempotency_key.len() > 160
        || request
            .idempotency_key
            .bytes()
            .any(|byte| byte.is_ascii_control() || byte.is_ascii_whitespace())
    {
        return Err(update_error(
            "invalid_request",
            "Relay update request is invalid.",
        ));
    }
    Ok(())
}

fn stable_version(value: &str) -> std::result::Result<[u64; 3], RelayUpdateError> {
    value
        .split('.')
        .map(str::parse::<u64>)
        .collect::<std::result::Result<Vec<_>, _>>()
        .ok()
        .and_then(|parts| parts.try_into().ok())
        .ok_or_else(|| update_error("invalid_release_manifest", "Relay version is invalid."))
}

fn compare_versions(
    left: &str,
    right: &str,
) -> std::result::Result<std::cmp::Ordering, RelayUpdateError> {
    Ok(stable_version(left)?.cmp(&stable_version(right)?))
}

fn lower_hex(value: &str, length: usize) -> bool {
    value.len() == length
        && value
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
}

fn update_error(code: &'static str, message: &str) -> RelayUpdateError {
    RelayUpdateError::new(code, message)
}

fn operation_view(operation: &OperationRecord) -> RelayUpdateOperation {
    RelayUpdateOperation {
        operation_id: operation.operation_id.clone(),
        phase: operation.phase,
        current_version: operation.current.version.clone(),
        target_version: operation.target.version.clone(),
        target_fingerprint: operation.target_fingerprint.clone(),
        started_at: operation.started_at,
        updated_at: operation.updated_at,
        error_code: operation.error_code.clone(),
        error_message: operation.error_message.clone(),
    }
}

fn default_manifest_url() -> String {
    MANIFEST_URL.to_owned()
}

fn unix_seconds() -> std::result::Result<u64, RelayUpdateError> {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|value| value.as_secs())
        .map_err(|_| update_error("clock_invalid", "The Relay host clock is invalid."))
}

fn unix_millis() -> std::result::Result<u64, RelayUpdateError> {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .ok()
        .and_then(|value| u64::try_from(value.as_millis()).ok())
        .ok_or_else(|| update_error("clock_invalid", "The Relay host clock is invalid."))
}

fn private_directory(path: &Path) -> std::result::Result<(), RelayUpdateError> {
    fs::create_dir_all(path)
        .and_then(|()| fs::set_permissions(path, fs::Permissions::from_mode(0o700)))
        .map_err(|_| {
            update_error(
                "update_storage_failed",
                "Cannot prepare Relay update storage.",
            )
        })
}

fn atomic_json(path: &Path, value: &impl Serialize) -> std::result::Result<(), RelayUpdateError> {
    let parent = path
        .parent()
        .ok_or_else(|| update_error("update_storage_failed", "Relay update path has no parent."))?;
    private_directory(parent)?;
    let temporary = parent.join(format!(".update-{}", crate::wire::nonce()));
    let bytes = serde_json::to_vec(value)
        .map_err(|_| update_error("update_storage_failed", "Cannot encode Relay update state."))?;
    let mut file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .mode(0o600)
        .open(&temporary)
        .map_err(|_| update_error("update_storage_failed", "Cannot create Relay update state."))?;
    file.write_all(&bytes)
        .and_then(|()| file.sync_all())
        .and_then(|()| fs::rename(&temporary, path))
        .and_then(|()| sync_directory(parent))
        .map_err(|_| {
            update_error(
                "update_storage_failed",
                "Cannot persist Relay update state.",
            )
        })?;
    Ok(())
}

fn durable_marker(path: &Path) -> std::result::Result<(), RelayUpdateError> {
    let mut file = OpenOptions::new()
        .write(true)
        .create(true)
        .truncate(true)
        .mode(0o600)
        .open(path)
        .map_err(|_| {
            update_error(
                "update_storage_failed",
                "Cannot create Relay update trigger.",
            )
        })?;
    file.write_all(b"pending\n")
        .and_then(|()| file.sync_all())
        .and_then(|()| sync_directory(path.parent().unwrap_or_else(|| Path::new("/"))))
        .map_err(|_| {
            update_error(
                "update_storage_failed",
                "Cannot persist Relay update trigger.",
            )
        })
}

fn sync_directory(path: &Path) -> std::io::Result<()> {
    File::open(path)?.sync_all()
}

fn read_json<T: DeserializeOwned>(path: &Path) -> std::result::Result<T, RelayUpdateError> {
    let bytes = fs::read(path).map_err(|_| {
        update_error(
            "update_state_unavailable",
            "Relay update state is unavailable.",
        )
    })?;
    serde_json::from_slice(&bytes).map_err(|_| {
        update_error(
            "update_state_unavailable",
            "Relay update state is malformed.",
        )
    })
}

fn read_optional_json<T: DeserializeOwned>(
    path: &Path,
) -> std::result::Result<Option<T>, RelayUpdateError> {
    match fs::read(path) {
        Ok(bytes) => serde_json::from_slice(&bytes).map(Some).map_err(|_| {
            update_error(
                "update_state_unavailable",
                "Relay update state is malformed.",
            )
        }),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(_) => Err(update_error(
            "update_state_unavailable",
            "Relay update state is unavailable.",
        )),
    }
}

fn operation_path(root: &Path, operation_id: &str) -> PathBuf {
    root.join("operations").join(format!("{operation_id}.json"))
}

fn read_operation(
    root: &Path,
    operation_id: &str,
) -> std::result::Result<OperationRecord, RelayUpdateError> {
    if !lower_hex(operation_id, 64) {
        return Err(update_error(
            "operation_not_found",
            "Relay update operation was not found.",
        ));
    }
    read_json(&operation_path(root, operation_id)).map_err(|_| {
        update_error(
            "operation_not_found",
            "Relay update operation was not found.",
        )
    })
}

fn trigger_updater(scope: ServiceScope) {
    let mut command = Command::new("systemctl");
    if matches!(scope, ServiceScope::User) {
        command.arg("--user");
    }
    let _ = command
        .args(["start", "codewide-relay-update.service"])
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn();
}

async fn download_bounded(url: &str, limit: u64) -> std::result::Result<Vec<u8>, RelayUpdateError> {
    let client = reqwest::Client::builder()
        .https_only(true)
        .redirect(reqwest::redirect::Policy::limited(3))
        .connect_timeout(Duration::from_secs(15))
        .timeout(Duration::from_mins(4))
        .build()
        .map_err(|_| {
            update_error(
                "download_failed",
                "Cannot initialize the Relay update downloader.",
            )
        })?;
    let response = client
        .get(url)
        .send()
        .await
        .and_then(reqwest::Response::error_for_status)
        .map_err(|_| {
            update_error(
                "download_failed",
                "Cannot download the signed Relay release.",
            )
        })?;
    if response
        .content_length()
        .is_some_and(|length| length > limit)
    {
        return Err(update_error(
            "download_failed",
            "The Relay update download is oversized.",
        ));
    }
    let mut bytes = Vec::new();
    let mut stream = response.bytes_stream();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|_| {
            update_error(
                "download_failed",
                "The Relay update download was interrupted.",
            )
        })?;
        if u64::try_from(bytes.len() + chunk.len()).unwrap_or(u64::MAX) > limit {
            return Err(update_error(
                "download_failed",
                "The Relay update download is oversized.",
            ));
        }
        bytes.extend_from_slice(&chunk);
    }
    Ok(bytes)
}

fn prepare_update_run(
    run: &RelayUpdaterRunConfig,
    operation: &OperationRecord,
) -> std::result::Result<UpdaterConfigV1, RelayUpdateError> {
    let (key_id, public_key_spki) = embedded_trust();
    if key_id.is_empty() || public_key_spki.is_empty() {
        return Err(update_error(
            "manual_update_required",
            "Relay Updater has no embedded release trust anchor.",
        ));
    }
    let config = UpdaterConfigV1 {
        schema_version: BOOTSTRAP_VERSION,
        key_id: key_id.to_owned(),
        public_key_spki: public_key_spki.to_owned(),
        manifest_url: MANIFEST_URL.to_owned(),
        install_path: run.install_path.clone(),
        updater_path: run.updater_path.clone(),
        service_scope: run.service_scope,
        service_name: run.service_name.clone(),
    };
    validate_bootstrap(&config, &operation.current)?;
    let active_digest = file_digest(&config.install_path)?;
    let backup_exists = backup_path(&config, &operation.operation_id).exists();
    if !active_binary_matches_journal(
        operation.phase,
        &operation.current.artifact_digest,
        &operation.target.sha256,
        &active_digest,
        backup_exists,
    ) {
        return Err(update_error(
            "installed_binary_changed",
            "The installed Relay does not match the durable update journal.",
        ));
    }
    let admitted = admit_release(
        &operation.envelope,
        &config,
        &operation.current,
        unix_seconds()?,
    )?;
    let release_changed = admitted.target_fingerprint != operation.target_fingerprint;
    let sequence_changed = admitted.sequence != operation.release_sequence;
    if release_changed || sequence_changed {
        return Err(update_error(
            "release_changed",
            "The signed Relay target changed.",
        ));
    }
    Ok(config)
}

fn active_binary_matches_journal(
    phase: RelayUpdatePhase,
    current_digest: &str,
    target_digest: &str,
    active_digest: &str,
    backup_exists: bool,
) -> bool {
    let current_matches = active_digest == current_digest;
    let target_matches = active_digest == target_digest;
    match phase {
        RelayUpdatePhase::Accepted => current_matches,
        RelayUpdatePhase::Installing | RelayUpdatePhase::RollingBack => {
            current_matches || (target_matches && backup_exists)
        }
        RelayUpdatePhase::AwaitingReconnect => target_matches && backup_exists,
        RelayUpdatePhase::Committed | RelayUpdatePhase::RolledBack | RelayUpdatePhase::Failed => {
            false
        }
    }
}

/// Resumes the single durable Relay update operation and exits after a terminal result.
///
/// # Errors
///
/// Returns an error only when durable recovery or rollback cannot be completed.
pub async fn run_pending(run: RelayUpdaterRunConfig) -> Result<()> {
    let root = run.relay_state_root.join("update");
    let Some(operation_id) = read_optional_json::<String>(&root.join("active.json"))? else {
        let _ = fs::remove_file(root.join("pending"));
        return Ok(());
    };
    let mut operation = read_operation(&root, &operation_id)?;
    if operation.phase.is_terminal() {
        let _ = fs::remove_file(root.join("pending"));
        return Ok(());
    }
    let config = match prepare_update_run(&run, &operation) {
        Ok(config) => config,
        Err(error) => {
            terminal_failure(&root, &mut operation, error.code, &error.message)?;
            return Ok(());
        }
    };
    match operation.phase {
        RelayUpdatePhase::Accepted | RelayUpdatePhase::Installing => {
            operation.phase = RelayUpdatePhase::Installing;
            operation.updated_at = unix_millis()?;
            atomic_json(&operation_path(&root, &operation_id), &operation)?;
            if let Err(error) = install_and_restart(&root, &config, &operation).await {
                rollback(&root, &config, &mut operation, error.code, &error.message).await?;
                return Ok(());
            }
            operation.phase = RelayUpdatePhase::AwaitingReconnect;
            operation.updated_at = unix_millis()?;
            atomic_json(&operation_path(&root, &operation_id), &operation)?;
        }
        RelayUpdatePhase::AwaitingReconnect => {}
        RelayUpdatePhase::RollingBack => {
            finish_rollback(&root, &config, &mut operation).await?;
            return Ok(());
        }
        RelayUpdatePhase::Committed | RelayUpdatePhase::RolledBack | RelayUpdatePhase::Failed => {
            return Ok(());
        }
    }
    loop {
        if let Some(receipt) = read_optional_json::<ReconnectReceipt>(
            &root.join("receipts").join(format!("{operation_id}.json")),
        )? && receipt.route_id == operation.route_id
            && receipt.observed_at >= operation.started_at
            && receipt.observed_at <= operation.reconnect_by
        {
            atomic_json(
                &root.join("installed.json"),
                &InstalledReceiptV1 {
                    schema_version: 1,
                    version: operation.target.version.clone(),
                    build: operation.target.build.clone(),
                    source_revision: operation.target.source_revision.clone(),
                    artifact_digest: operation.target.sha256.clone(),
                    highest_sequence: operation.release_sequence,
                },
            )?;
            operation.phase = RelayUpdatePhase::Committed;
            operation.updated_at = unix_millis()?;
            atomic_json(&operation_path(&root, &operation_id), &operation)?;
            remove_backup(&config, &operation.operation_id);
            let _ = fs::remove_file(root.join("pending"));
            return Ok(());
        }
        if unix_millis()? > operation.reconnect_by {
            rollback(
                &root,
                &config,
                &mut operation,
                "companion_reconnect_timeout",
                "No paired Companion reconnected to the updated Relay before the deadline.",
            )
            .await?;
            return Ok(());
        }
        tokio::time::sleep(Duration::from_millis(250)).await;
    }
}

async fn install_and_restart(
    root: &Path,
    config: &UpdaterConfigV1,
    operation: &OperationRecord,
) -> std::result::Result<(), RelayUpdateError> {
    let bytes = download_bounded(&operation.target.artifact_url, MAX_ARTIFACT_BYTES).await?;
    let actual = hex::encode(Sha256::digest(&bytes));
    if actual != operation.target.sha256 {
        return Err(update_error(
            "artifact_digest_mismatch",
            "The Relay artifact digest is invalid.",
        ));
    }
    let parent = config
        .install_path
        .parent()
        .ok_or_else(|| update_error("install_failed", "Relay install path has no parent."))?;
    let stage = stage_path(config, &operation.operation_id);
    let backup = backup_path(config, &operation.operation_id);
    if !backup.exists() {
        fs::hard_link(&config.install_path, &backup)
            .and_then(|()| sync_directory(parent))
            .map_err(|_| {
                update_error(
                    "install_failed",
                    "Cannot preserve the current Relay executable.",
                )
            })?;
    }
    if file_digest(&config.install_path)? != operation.target.sha256 {
        let mut file = OpenOptions::new()
            .write(true)
            .create_new(true)
            .mode(0o755)
            .open(&stage)
            .map_err(|_| update_error("install_failed", "Cannot stage the Relay executable."))?;
        file.write_all(&bytes)
            .and_then(|()| file.sync_all())
            .map_err(|_| update_error("install_failed", "Cannot persist the Relay executable."))?;
        // Linux refuses to execute a binary while this process still holds it
        // open for writing (`ETXTBSY`). Close the staged file before probing it.
        drop(file);
        let Ok(reported) = Command::new(&stage).arg("--version").output().await else {
            let _ = fs::remove_file(&stage);
            return Err(update_error(
                "target_invalid",
                "The Relay update cannot execute.",
            ));
        };
        if !reported.status.success()
            || String::from_utf8_lossy(&reported.stdout).trim()
                != format!("codewide-relay {}", operation.target.version)
        {
            let _ = fs::remove_file(&stage);
            return Err(update_error(
                "target_invalid",
                "The Relay update reports the wrong version.",
            ));
        }
        fs::rename(&stage, &config.install_path)
            .and_then(|()| sync_directory(parent))
            .map_err(|_| update_error("install_failed", "Cannot activate the Relay executable."))?;
    }
    restart_service(config).await?;
    wait_ready(root.parent().unwrap_or(root), &operation.target.version).await
}

async fn restart_service(config: &UpdaterConfigV1) -> std::result::Result<(), RelayUpdateError> {
    let mut command = Command::new("systemctl");
    if matches!(config.service_scope, ServiceScope::User) {
        command.arg("--user");
    }
    let status = command
        .args(["restart", &config.service_name])
        .status()
        .await
        .map_err(|_| update_error("restart_failed", "Cannot restart the Relay service."))?;
    if !status.success() {
        return Err(update_error(
            "restart_failed",
            "The Relay service restart failed.",
        ));
    }
    Ok(())
}

async fn wait_ready(
    relay_state_root: &Path,
    expected_version: &str,
) -> std::result::Result<(), RelayUpdateError> {
    for _ in 0..100 {
        if let Ok(mut socket) = UnixStream::connect(relay_state_root.join(admin::SOCKET)).await
            && admin::write_frame(&mut socket, &admin::Request::Status)
                .await
                .is_ok()
            && let Ok(Ok(admin::Reply::Status { version, .. })) =
                tokio::time::timeout(Duration::from_secs(1), admin::read_frame(&mut socket)).await
            && version == expected_version
        {
            return Ok(());
        }
        tokio::time::sleep(Duration::from_millis(200)).await;
    }
    Err(update_error(
        "target_not_ready",
        "The updated Relay did not become ready.",
    ))
}

async fn rollback(
    root: &Path,
    config: &UpdaterConfigV1,
    operation: &mut OperationRecord,
    code: &'static str,
    message: &str,
) -> Result<()> {
    operation.phase = RelayUpdatePhase::RollingBack;
    operation.error_code = Some(code.to_owned());
    operation.error_message = Some(message.chars().take(240).collect());
    operation.updated_at = unix_millis()?;
    atomic_json(&operation_path(root, &operation.operation_id), operation)?;
    finish_rollback(root, config, operation).await
}

async fn finish_rollback(
    root: &Path,
    config: &UpdaterConfigV1,
    operation: &mut OperationRecord,
) -> Result<()> {
    let backup = backup_path(config, &operation.operation_id);
    let parent = config
        .install_path
        .parent()
        .ok_or("Relay install path has no parent")?;
    if backup.exists() {
        if file_digest(&config.install_path)
            .is_ok_and(|digest| digest == operation.current.artifact_digest)
        {
            fs::remove_file(&backup)?;
        } else {
            fs::rename(&backup, &config.install_path)?;
        }
    }
    let stage = stage_path(config, &operation.operation_id);
    if stage.exists() {
        fs::remove_file(stage)?;
    }
    sync_directory(parent)?;
    let rollback_result = async {
        restart_service(config).await?;
        wait_ready(root.parent().unwrap_or(root), &operation.current.version).await
    }
    .await;
    operation.phase = if rollback_result.is_ok() {
        RelayUpdatePhase::RolledBack
    } else {
        RelayUpdatePhase::Failed
    };
    if let Err(error) = rollback_result {
        operation.error_code = Some("rollback_failed".to_owned());
        operation.error_message = Some(error.message);
    }
    operation.updated_at = unix_millis()?;
    atomic_json(&operation_path(root, &operation.operation_id), operation)?;
    let _ = fs::remove_file(root.join("pending"));
    Ok(())
}

fn terminal_failure(
    root: &Path,
    operation: &mut OperationRecord,
    code: &str,
    message: &str,
) -> Result<()> {
    operation.phase = RelayUpdatePhase::Failed;
    operation.error_code = Some(code.to_owned());
    operation.error_message = Some(message.to_owned());
    operation.updated_at = unix_millis()?;
    atomic_json(&operation_path(root, &operation.operation_id), operation)?;
    let _ = fs::remove_file(root.join("pending"));
    Ok(())
}

fn backup_path(config: &UpdaterConfigV1, operation_id: &str) -> PathBuf {
    config
        .install_path
        .parent()
        .unwrap_or_else(|| Path::new("/"))
        .join(format!(".codewide-relay-rollback-{operation_id}"))
}

fn stage_path(config: &UpdaterConfigV1, operation_id: &str) -> PathBuf {
    config
        .install_path
        .parent()
        .unwrap_or_else(|| Path::new("/"))
        .join(format!(".codewide-relay-stage-{operation_id}"))
}

fn remove_backup(config: &UpdaterConfigV1, operation_id: &str) {
    let _ = fs::remove_file(backup_path(config, operation_id));
}

fn file_digest(path: &Path) -> std::result::Result<String, RelayUpdateError> {
    let mut file = File::open(path).map_err(|_| {
        update_error(
            "install_failed",
            "Cannot read the installed Relay executable.",
        )
    })?;
    let mut hasher = Sha256::new();
    let mut buffer = vec![0_u8; 64 * 1024];
    loop {
        let read = file.read(&mut buffer).map_err(|_| {
            update_error(
                "install_failed",
                "Cannot read the installed Relay executable.",
            )
        })?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
    }
    Ok(hex::encode(hasher.finalize()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn version_and_intent_validation_are_strict() {
        let Ok(version) = stable_version("1.2.3") else {
            panic!("valid stable version was rejected");
        };
        assert_eq!(version, [1, 2, 3]);
        assert!(stable_version("1.2").is_err());
        assert!(
            validate_intent(&ApplyRelayUpdateRequest {
                target_fingerprint: "a".repeat(64),
                idempotency_key: "relay-update-0123456789".to_owned(),
            })
            .is_ok()
        );
        assert!(
            validate_intent(&ApplyRelayUpdateRequest {
                target_fingerprint: "a".repeat(63),
                idempotency_key: "short".to_owned(),
            })
            .is_err()
        );
    }

    #[test]
    fn operation_ids_cannot_escape_storage() {
        let root = Path::new("/tmp/update-test");
        assert!(read_operation(root, "../active").is_err());
    }

    #[test]
    fn active_binary_must_match_the_crash_phase_and_preserved_backup() {
        assert!(active_binary_matches_journal(
            RelayUpdatePhase::Accepted,
            "current",
            "target",
            "current",
            false,
        ));
        assert!(!active_binary_matches_journal(
            RelayUpdatePhase::Accepted,
            "current",
            "target",
            "target",
            true,
        ));
        assert!(active_binary_matches_journal(
            RelayUpdatePhase::Installing,
            "current",
            "target",
            "target",
            true,
        ));
        assert!(!active_binary_matches_journal(
            RelayUpdatePhase::Installing,
            "current",
            "target",
            "target",
            false,
        ));
        assert!(active_binary_matches_journal(
            RelayUpdatePhase::RollingBack,
            "current",
            "target",
            "current",
            false,
        ));
    }
}
