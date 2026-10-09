//! Shared contracts for authenticated, guardian-owned Companion host updates.
//!
//! The core owns wire shapes, release admission, and fenced phase semantics.
//! Platform guardians own downloads, the durable journal, activation, health
//! proof, rollback, and terminal outcomes.

use std::sync::Arc;

use async_trait::async_trait;
use base64::{Engine as _, engine::general_purpose};
use p256::{
    ecdsa::{Signature, VerifyingKey, signature::Verifier},
    pkcs8::DecodePublicKey,
};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use thiserror::Error;

pub const HOST_UPDATE_API_VERSION: u16 = 1;
pub const HOST_UPDATE_GUARDIAN_CONTRACT_VERSION: u16 = 1;
pub const HOST_UPDATE_JOURNAL_VERSION: u16 = 1;
pub const HOST_UPDATE_BOOTSTRAP_VERSION: u16 = 1;
pub const HOST_UPDATE_RELEASE_SCHEMA_VERSION: u16 = 1;
pub const HOST_UPDATE_RELEASE_MAX_LIFETIME_SECONDS: u64 = 180 * 24 * 60 * 60;
#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum HostPlatform {
    LinuxX86_64,
    MacosUniversal,
    RelayLinuxX86_64,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum HostUpdatePhase {
    Accepted,
    Installing,
    TargetReady,
    AwaitingReconnect,
    Committed,
    RollingBack,
    RolledBack,
    Failed,
}

impl HostUpdatePhase {
    #[must_use]
    pub const fn is_terminal(self) -> bool {
        matches!(self, Self::Committed | Self::RolledBack | Self::Failed)
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HostUpdateCapability {
    pub api_version: u16,
    pub guardian_contract_version: u16,
    pub journal_version: u16,
    pub bootstrap_version: u16,
    pub apply_supported: bool,
    pub unavailable_reason: Option<String>,
}

impl HostUpdateCapability {
    #[must_use]
    pub fn disabled(reason: impl Into<String>) -> Self {
        Self {
            api_version: HOST_UPDATE_API_VERSION,
            guardian_contract_version: 0,
            journal_version: 0,
            bootstrap_version: 0,
            apply_supported: false,
            unavailable_reason: Some(reason.into()),
        }
    }

    #[must_use]
    pub const fn supports_remote_apply(&self) -> bool {
        self.apply_supported
            && self.api_version == HOST_UPDATE_API_VERSION
            && self.guardian_contract_version == HOST_UPDATE_GUARDIAN_CONTRACT_VERSION
            && self.journal_version == HOST_UPDATE_JOURNAL_VERSION
            && self.bootstrap_version == HOST_UPDATE_BOOTSTRAP_VERSION
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReleaseTargetV1 {
    pub platform: HostPlatform,
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

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReleaseDescriptorV1 {
    pub schema_version: u16,
    pub channel: String,
    pub sequence: u64,
    pub issued_at: u64,
    pub expires_at: u64,
    pub targets: Vec<ReleaseTargetV1>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SignedReleaseDescriptor {
    pub schema_version: u16,
    pub key_id: String,
    pub algorithm: String,
    pub payload: String,
    pub signature: String,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ReleaseAdmission<'a> {
    pub trusted_key_id: &'a str,
    pub platform: HostPlatform,
    pub current_version: &'a str,
    pub current_digest: &'a str,
    pub highest_sequence: u64,
    pub state_epoch: u32,
    pub bootstrap_version: u16,
    pub journal_version: u16,
}

#[derive(Clone, Debug, Eq, Error, PartialEq)]
pub enum ReleaseAdmissionError {
    #[error("release descriptor envelope is unsupported")]
    UnsupportedEnvelope,
    #[error("release descriptor payload is malformed")]
    MalformedPayload,
    #[error("release descriptor signature is invalid")]
    InvalidSignature,
    #[error("release descriptor is not currently fresh")]
    StaleDescriptor,
    #[error("release sequence is not newer than the accepted sequence")]
    Replay,
    #[error("release target is missing for this platform")]
    MissingPlatform,
    #[error("release target would not upgrade the current version")]
    Downgrade,
    #[error("release target metadata is invalid")]
    InvalidTarget,
    #[error("release target requires a newer bootstrap or journal contract")]
    UnsupportedGuardianContract,
    #[error("release target changes the Companion state epoch")]
    IncompatibleStateEpoch,
    #[error("release target does not certify rollback from the installed digest")]
    RollbackIncompatible,
    #[error("downloaded artifact digest does not match the signed target")]
    WrongArtifactDigest,
}

/// Verifies a signed descriptor and returns the one admissible platform target.
/// The public key is a pinned DER SPKI value, never a key supplied by the envelope.
///
/// # Errors
/// Returns a specific admission error for invalid trust, freshness, monotonicity,
/// platform, version, guardian compatibility, state, or rollback metadata.
pub fn admit_signed_release(
    envelope: &SignedReleaseDescriptor,
    public_key_spki: &str,
    now: u64,
    installed: &ReleaseAdmission<'_>,
) -> Result<(ReleaseDescriptorV1, ReleaseTargetV1, String), ReleaseAdmissionError> {
    let descriptor =
        verify_signed_release_descriptor(envelope, public_key_spki, now, installed.trusted_key_id)?;
    if descriptor.sequence <= installed.highest_sequence {
        return Err(ReleaseAdmissionError::Replay);
    }
    let mut platform_targets = descriptor
        .targets
        .iter()
        .filter(|target| target.platform == installed.platform);
    let target = platform_targets
        .next()
        .cloned()
        .ok_or(ReleaseAdmissionError::MissingPlatform)?;
    if platform_targets.next().is_some() {
        return Err(ReleaseAdmissionError::InvalidTarget);
    }
    validate_target(&target)?;
    if compare_stable_versions(&target.version, installed.current_version)?
        != std::cmp::Ordering::Greater
    {
        return Err(ReleaseAdmissionError::Downgrade);
    }
    if target.bootstrap_version > installed.bootstrap_version
        || target.journal_version > installed.journal_version
    {
        return Err(ReleaseAdmissionError::UnsupportedGuardianContract);
    }
    if target.state_epoch != installed.state_epoch {
        return Err(ReleaseAdmissionError::IncompatibleStateEpoch);
    }
    if !target
        .rollback_compatible_from
        .iter()
        .any(|digest| digest == installed.current_digest)
    {
        return Err(ReleaseAdmissionError::RollbackIncompatible);
    }
    let fingerprint = hex::encode(Sha256::digest(
        serde_json::to_vec(&target).map_err(|_| ReleaseAdmissionError::MalformedPayload)?,
    ));
    Ok((descriptor, target, fingerprint))
}

/// Verifies the immutable trust and freshness of a signed release descriptor.
///
/// This is the bootstrap-safe verifier for establishing a first trusted release
/// receipt. It intentionally does not decide whether any target upgrades an
/// installed release or certifies rollback from its digest; callers must prove
/// the artifact and installed bundle before persisting that receipt.
///
/// # Errors
/// Returns a specific admission error for an unsupported envelope, malformed
/// payload, invalid signature, stale descriptor, or structurally invalid
/// sequence.
pub fn verify_signed_release_descriptor(
    envelope: &SignedReleaseDescriptor,
    public_key_spki: &str,
    now: u64,
    trusted_key_id: &str,
) -> Result<ReleaseDescriptorV1, ReleaseAdmissionError> {
    if envelope.schema_version != HOST_UPDATE_RELEASE_SCHEMA_VERSION
        || envelope.algorithm != "ES256"
        || envelope.key_id != trusted_key_id
        || envelope.payload.is_empty()
        || envelope.signature.is_empty()
    {
        return Err(ReleaseAdmissionError::UnsupportedEnvelope);
    }
    let payload = general_purpose::URL_SAFE_NO_PAD
        .decode(&envelope.payload)
        .map_err(|_| ReleaseAdmissionError::MalformedPayload)?;
    let key_der = general_purpose::STANDARD
        .decode(public_key_spki)
        .map_err(|_| ReleaseAdmissionError::InvalidSignature)?;
    let key = VerifyingKey::from_public_key_der(&key_der)
        .map_err(|_| ReleaseAdmissionError::InvalidSignature)?;
    let signature_bytes = general_purpose::STANDARD
        .decode(&envelope.signature)
        .map_err(|_| ReleaseAdmissionError::InvalidSignature)?;
    let signature = Signature::from_der(&signature_bytes)
        .map_err(|_| ReleaseAdmissionError::InvalidSignature)?;
    key.verify(&payload, &signature)
        .map_err(|_| ReleaseAdmissionError::InvalidSignature)?;
    let descriptor: ReleaseDescriptorV1 =
        serde_json::from_slice(&payload).map_err(|_| ReleaseAdmissionError::MalformedPayload)?;
    if descriptor.schema_version != HOST_UPDATE_RELEASE_SCHEMA_VERSION
        || descriptor.channel != "stable"
    {
        return Err(ReleaseAdmissionError::MalformedPayload);
    }
    if descriptor.issued_at > now
        || descriptor.expires_at < now
        || descriptor.expires_at <= descriptor.issued_at
        || descriptor.expires_at - descriptor.issued_at > HOST_UPDATE_RELEASE_MAX_LIFETIME_SECONDS
    {
        return Err(ReleaseAdmissionError::StaleDescriptor);
    }
    if descriptor.sequence == 0 {
        return Err(ReleaseAdmissionError::Replay);
    }
    Ok(descriptor)
}

/// Checks the downloaded bytes against the digest authenticated by the descriptor.
///
/// # Errors
/// Returns `WrongArtifactDigest` when the bytes do not match the signed digest.
pub fn verify_artifact_digest(
    target: &ReleaseTargetV1,
    artifact: &[u8],
) -> Result<(), ReleaseAdmissionError> {
    let actual = hex::encode(Sha256::digest(artifact));
    (actual == target.sha256)
        .then_some(())
        .ok_or(ReleaseAdmissionError::WrongArtifactDigest)
}

fn validate_target(target: &ReleaseTargetV1) -> Result<(), ReleaseAdmissionError> {
    if target.build.is_empty()
        || !is_lower_hex(&target.source_revision, 40)
        || !is_lower_hex(&target.sha256, 64)
        || !target
            .artifact_url
            .starts_with("https://github.com/MrFlashAccount/CodeWide/releases/download/")
        || target
            .rollback_compatible_from
            .iter()
            .any(|digest| !is_lower_hex(digest, 64))
    {
        return Err(ReleaseAdmissionError::InvalidTarget);
    }
    let _ = stable_version(&target.version)?;
    Ok(())
}

fn is_lower_hex(value: &str, length: usize) -> bool {
    value.len() == length
        && value
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
}

fn stable_version(value: &str) -> Result<[u64; 3], ReleaseAdmissionError> {
    let components = value
        .split('.')
        .map(str::parse::<u64>)
        .collect::<Result<Vec<_>, _>>()
        .map_err(|_| ReleaseAdmissionError::InvalidTarget)?;
    components
        .try_into()
        .map_err(|_| ReleaseAdmissionError::InvalidTarget)
}

fn compare_stable_versions(
    target: &str,
    current: &str,
) -> Result<std::cmp::Ordering, ReleaseAdmissionError> {
    Ok(stable_version(target)?.cmp(&stable_version(current)?))
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HostUpdateRelayState {
    pub configured: bool,
    pub enabled: bool,
    pub upstream_live: bool,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HostUpdateDeadlines {
    pub install_by: u64,
    pub target_ready_by: u64,
    pub reconnect_by: u64,
    pub rollback_by: u64,
}

/// The exact V1 record that the out-of-process guardian must persist and fsync
/// before an apply request may receive HTTP 202.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HostUpdateJournalV1 {
    pub journal_version: u16,
    pub operation_id: String,
    pub nonce: String,
    pub initiating_device_id: String,
    pub current_digest: String,
    pub target_digest: String,
    pub target_fingerprint: String,
    pub pre_update_relay: HostUpdateRelayState,
    pub deadlines: HostUpdateDeadlines,
    pub phase: HostUpdatePhase,
    pub started_at: u64,
    pub restart_started_at: Option<u64>,
    pub updated_at: u64,
    pub error_code: Option<String>,
    pub error_message: Option<String>,
}

#[derive(Clone, Debug, Eq, Error, PartialEq)]
pub enum TransitionError {
    #[error("operation nonce does not match")]
    StaleFence,
    #[error("operation phase changed before the requested transition")]
    CompareAndSwapFailed,
    #[error("operation phase transition is invalid")]
    InvalidTransition,
    #[error("reconnect receipt came from a different device")]
    WrongDevice,
    #[error("reconnect receipt is not fresh for the restarted process")]
    StaleReconnect,
}

impl HostUpdateJournalV1 {
    /// Applies an in-memory CAS/fence check. Guardians must durably persist the
    /// returned phase before acknowledging the transition.
    ///
    /// # Errors
    /// Returns a fence, compare-and-swap, or transition error without mutation.
    pub fn transition(
        &mut self,
        nonce: &str,
        expected: HostUpdatePhase,
        next: HostUpdatePhase,
        now: u64,
    ) -> Result<(), TransitionError> {
        if self.nonce != nonce {
            return Err(TransitionError::StaleFence);
        }
        if self.phase != expected {
            return Err(TransitionError::CompareAndSwapFailed);
        }
        if !valid_transition(expected, next) {
            return Err(TransitionError::InvalidTransition);
        }
        self.phase = next;
        self.updated_at = now;
        Ok(())
    }

    /// Validates one guardian-timestamped reconnect receipt.
    /// # Errors
    /// Returns a fence, actor, freshness, or phase error without commit.
    pub fn accept_reconnect(
        &mut self,
        nonce: &str,
        receipt: &ReconnectReceipt,
        observed_at: u64,
    ) -> Result<(), TransitionError> {
        if receipt.operation_id != self.operation_id || nonce != self.nonce {
            return Err(TransitionError::StaleFence);
        }
        if receipt.device_id != self.initiating_device_id {
            return Err(TransitionError::WrongDevice);
        }
        let Some(restart_started_at) = self.restart_started_at else {
            return Err(TransitionError::StaleReconnect);
        };
        if observed_at <= restart_started_at || observed_at > self.deadlines.reconnect_by {
            return Err(TransitionError::StaleReconnect);
        }
        self.transition(
            nonce,
            HostUpdatePhase::AwaitingReconnect,
            HostUpdatePhase::Committed,
            observed_at,
        )
    }
}

fn valid_transition(current: HostUpdatePhase, next: HostUpdatePhase) -> bool {
    matches!(
        (current, next),
        (HostUpdatePhase::Accepted, HostUpdatePhase::Installing)
            | (HostUpdatePhase::Installing, HostUpdatePhase::TargetReady)
            | (
                HostUpdatePhase::TargetReady,
                HostUpdatePhase::AwaitingReconnect
            )
            | (
                HostUpdatePhase::AwaitingReconnect,
                HostUpdatePhase::Committed
            )
            | (
                HostUpdatePhase::Accepted
                    | HostUpdatePhase::Installing
                    | HostUpdatePhase::TargetReady
                    | HostUpdatePhase::AwaitingReconnect,
                HostUpdatePhase::RollingBack
            )
            | (
                HostUpdatePhase::RollingBack,
                HostUpdatePhase::RolledBack | HostUpdatePhase::Failed
            )
            | (
                HostUpdatePhase::Accepted | HostUpdatePhase::Installing,
                HostUpdatePhase::Failed
            )
    )
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HostUpdateStatus {
    pub platform: HostPlatform,
    pub current_version: String,
    pub current_build: String,
    pub current_source_revision: String,
    pub current_digest: String,
    pub capability: HostUpdateCapability,
    pub available_target: Option<AvailableHostUpdate>,
    pub active_operation: Option<HostUpdateOperation>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AvailableHostUpdate {
    pub target: ReleaseTargetV1,
    pub target_fingerprint: String,
    pub release_sequence: u64,
    pub expires_at: u64,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HostUpdateOperation {
    pub operation_id: String,
    pub phase: HostUpdatePhase,
    pub current_version: String,
    pub target_version: String,
    pub target_fingerprint: String,
    pub started_at: u64,
    pub updated_at: u64,
    pub error_code: Option<String>,
    pub error_message: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ApplyHostUpdateRequest {
    pub target_fingerprint: String,
    pub idempotency_key: String,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ApplyHostUpdateCommand {
    pub target_fingerprint: String,
    pub idempotency_key: String,
    pub initiating_device_id: String,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ApplyHostUpdateAccepted {
    pub operation_id: String,
    pub phase: HostUpdatePhase,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReconnectReceipt {
    pub operation_id: String,
    pub device_id: String,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum GuardianErrorCode {
    NotFound,
    Conflict,
    IdempotencyConflict,
    PreconditionFailed,
    Locked,
    ManualUpdateRequired,
    Internal,
}

impl GuardianErrorCode {
    #[must_use]
    pub const fn reason(self) -> &'static str {
        match self {
            Self::NotFound => "operation_not_found",
            Self::Conflict => "operation_conflict",
            Self::IdempotencyConflict => "idempotency_conflict",
            Self::PreconditionFailed => "precondition_failed",
            Self::Locked => "update_locked",
            Self::ManualUpdateRequired => "manual_update_required",
            Self::Internal => "update_internal_error",
        }
    }
}

#[derive(Clone, Debug, Eq, Error, PartialEq)]
#[error("{message}")]
pub struct GuardianError {
    pub code: GuardianErrorCode,
    pub message: String,
}

impl GuardianError {
    #[must_use]
    pub fn new(code: GuardianErrorCode, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
        }
    }
}

/// Platform guardian boundary. Implementations must be outside companion-core
/// and exclusively own operation journaling and terminal results.
#[async_trait]
pub trait HostUpdateGuardian: Send + Sync {
    fn capability(&self) -> HostUpdateCapability;
    async fn status(&self) -> Result<HostUpdateStatus, GuardianError>;
    async fn check(&self) -> Result<HostUpdateStatus, GuardianError>;
    /// Enforces single-active and idempotency rules, persists and fsyncs the
    /// V1 journal, then and only then returns an accepted operation.
    async fn apply(
        &self,
        command: ApplyHostUpdateCommand,
    ) -> Result<ApplyHostUpdateAccepted, GuardianError>;
    async fn operation(&self, operation_id: &str) -> Result<HostUpdateOperation, GuardianError>;
    async fn reconnect(
        &self,
        receipt: ReconnectReceipt,
    ) -> Result<HostUpdateOperation, GuardianError>;
}

pub type SharedHostUpdateGuardian = Arc<dyn HostUpdateGuardian>;
#[cfg(test)]
#[path = "host_update/tests.rs"]
mod tests;
