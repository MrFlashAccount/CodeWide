use std::{
    collections::{HashMap, HashSet},
    fs::OpenOptions,
    io::Write,
    os::unix::fs::{OpenOptionsExt, PermissionsExt},
    path::{Path, PathBuf},
    sync::Arc,
    time::{SystemTime, UNIX_EPOCH},
};

use base64::{Engine as _, engine::general_purpose};
use p256::{
    ecdsa::{Signature, VerifyingKey, signature::Verifier},
    pkcs8::DecodePublicKey,
};
use rand::{TryRngCore, rngs::OsRng};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

const PAIRING_TTL_MS: u64 = 5 * 60 * 1_000;
const DEFAULT_SESSION_TTL_MS: u64 = 15 * 60 * 1_000;
const CHALLENGE_TTL_MS: u64 = 60 * 1_000;
const MAX_SESSIONS_PER_DEVICE: usize = 16;
const MAX_CHALLENGES_PER_DEVICE: usize = 8;
const REGISTRY_VERSION: u8 = 4;
const DEVICE_SCOPES: [&str; 11] = [
    "approvals.respond",
    "files.download.workspace",
    "files.upload.workspace",
    "localhost.forward",
    "processes.manage",
    "shell.explicit",
    "threads.read",
    "threads.write",
    "tools.call",
    "turns.start",
    "turns.steer",
];
const DEFAULT_DEVICE_SCOPES: [&str; 9] = [
    "approvals.respond",
    "files.download.workspace",
    "files.upload.workspace",
    "localhost.forward",
    "processes.manage",
    "threads.read",
    "threads.write",
    "turns.start",
    "turns.steer",
];
/// Returns the frozen V1 scope vocabulary accepted by the companion.
#[must_use]
pub const fn contract_device_scopes() -> &'static [&'static str] {
    &DEVICE_SCOPES
}

/// Returns the frozen V1 default scope grant.
#[must_use]
pub const fn contract_default_device_scopes() -> &'static [&'static str] {
    &DEFAULT_DEVICE_SCOPES
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum AuthorizationContext {
    Admin,
    Device {
        device_id: String,
    },
    Session {
        device_id: String,
        scopes: Vec<String>,
        expires_at: u64,
    },
}

impl AuthorizationContext {
    #[must_use]
    pub fn device_id(&self) -> Option<&str> {
        match self {
            Self::Session { device_id, .. } | Self::Device { device_id } => Some(device_id),
            Self::Admin => None,
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum AuthorizationChangeReason {
    DeviceRevoked,
    DeviceScopesChanged,
    DeviceRepaired,
}

impl AuthorizationChangeReason {
    #[must_use]
    pub const fn close_reason(self) -> &'static str {
        match self {
            Self::DeviceRevoked => "device_revoked",
            Self::DeviceScopesChanged => "device_scopes_changed",
            Self::DeviceRepaired => "device_repaired",
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct AuthorizationChange {
    pub device_id: String,
    pub reason: AuthorizationChangeReason,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Device {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub public_key_spki: Option<String>,
    #[serde(default = "default_scopes")]
    pub scopes: Vec<String>,
    pub created_at: u64,
    pub last_seen_at: u64,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct StoredDevice {
    id: String,
    name: String,
    token_hash: String,
    #[serde(default)]
    public_key_spki: Option<String>,
    #[serde(default = "default_scopes")]
    scopes: Vec<String>,
    created_at: u64,
    last_seen_at: u64,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct Pairing {
    token_hash: String,
    expires_at: u64,
}

#[derive(Debug, Deserialize, Serialize)]
struct RegistryFile {
    version: u8,
    devices: Vec<StoredDevice>,
    pairings: Vec<Pairing>,
}

#[derive(Clone, Debug)]
struct DeviceSession {
    token_hash: String,
    device_id: String,
    scopes: Vec<String>,
    expires_at: u64,
}

#[derive(Clone, Debug)]
struct DeviceChallenge {
    id: String,
    device_id: String,
    nonce: String,
    expires_at: u64,
}

struct RegistryState {
    devices: HashMap<String, StoredDevice>,
    pairings: HashMap<String, Pairing>,
    sessions: HashMap<String, DeviceSession>,
    challenges: HashMap<String, DeviceChallenge>,
}

pub struct DeviceRegistry {
    admin_token: Arc<str>,
    path: PathBuf,
    session_ttl_ms: u64,
    state: tokio::sync::Mutex<RegistryState>,
    trusted_client_spki: TrustedClientSpki,
    authorization_changes: tokio::sync::broadcast::Sender<AuthorizationChange>,
}

/// A synchronous, live view of device public keys trusted for mTLS handshakes.
/// It is deliberately separate from the async registry lock because rustls
/// certificate verification cannot await.
#[derive(Clone, Debug, Default)]
pub struct TrustedClientSpki(Arc<std::sync::RwLock<HashSet<String>>>);

impl TrustedClientSpki {
    #[must_use]
    pub fn contains(&self, public_key_spki: &str) -> bool {
        self.0
            .read()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .contains(public_key_spki)
    }

    fn replace(&self, values: impl IntoIterator<Item = String>) {
        *self
            .0
            .write()
            .unwrap_or_else(std::sync::PoisonError::into_inner) = values.into_iter().collect();
    }
}

#[derive(Debug, thiserror::Error)]
pub enum AuthError {
    #[error("invalid device registry")]
    InvalidRegistry,
    #[error("invalid device metadata")]
    InvalidDeviceMetadata,
    #[error("invalid or expired pairing")]
    InvalidPairing,
    #[error("pairing key proof is invalid")]
    InvalidPairingProof,
    #[error("device authorization required")]
    DeviceAuthorizationRequired,
    #[error("device key required repair")]
    DeviceKeyRequired,
    #[error("invalid or expired device proof")]
    InvalidDeviceProof,
    #[error("device key mismatch repair")]
    DeviceKeyMismatch,
    #[error("device not found")]
    DeviceNotFound,
    #[error("valid scopes with threads.read required")]
    InvalidScopes,
    #[error(transparent)]
    Io(#[from] std::io::Error),
    #[error(transparent)]
    Json(#[from] serde_json::Error),
    #[error("secure randomness unavailable")]
    Random,
    #[error("registry worker failed")]
    Worker,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PairingResult {
    pub pairing_token: String,
    pub expires_at: u64,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PairingClaim {
    pub pairing_token: String,
    pub device_name: String,
    pub public_key_spki: String,
    pub proof: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PairingClaimResult {
    pub device_id: String,
    pub capability_token: String,
    pub scopes: Vec<String>,
    #[serde(skip)]
    pub replaced_existing: bool,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChallengeResult {
    pub challenge_id: String,
    pub challenge: String,
    pub expires_at: u64,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionProof {
    pub challenge_id: String,
    pub signature: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionResult {
    pub session_token: String,
    pub expires_at: u64,
    pub scopes: Vec<String>,
}

impl DeviceRegistry {
    /// Opens the durable device registry.
    ///
    /// # Errors
    ///
    /// Returns an error when the registry is unreadable, malformed, or uses
    /// unsupported credentials or scopes.
    pub async fn open(
        admin_token: Arc<str>,
        path: PathBuf,
        session_ttl_ms: Option<u64>,
    ) -> Result<Self, AuthError> {
        let mut invalidated_legacy_registry = false;
        let registry = if tokio::fs::try_exists(&path).await? {
            let raw = tokio::fs::read(&path).await?;
            let parsed: RegistryFile = serde_json::from_slice(&raw)?;
            match parsed.version {
                REGISTRY_VERSION => parsed,
                1..=3 => {
                    invalidated_legacy_registry = true;
                    RegistryFile {
                        version: REGISTRY_VERSION,
                        devices: Vec::new(),
                        pairings: Vec::new(),
                    }
                }
                _ => return Err(AuthError::InvalidRegistry),
            }
        } else {
            RegistryFile {
                version: REGISTRY_VERSION,
                devices: Vec::new(),
                pairings: Vec::new(),
            }
        };
        let now = unix_time_ms();
        let mut devices = HashMap::new();
        for device in registry.devices {
            if !valid_id(&device.id)
                || !valid_name(&device.name)
                || !valid_scopes(&device.scopes)
                || !device
                    .public_key_spki
                    .as_deref()
                    .is_some_and(valid_public_key)
            {
                return Err(AuthError::InvalidRegistry);
            }
            devices.insert(device.id.clone(), device);
        }
        let pairings = registry
            .pairings
            .into_iter()
            .filter(|pairing| pairing.expires_at > now)
            .map(|pairing| (pairing.token_hash.clone(), pairing))
            .collect();
        let ttl = session_ttl_ms.unwrap_or(DEFAULT_SESSION_TTL_MS);
        if ttl < 1_000 {
            return Err(AuthError::InvalidRegistry);
        }
        let (authorization_changes, _) = tokio::sync::broadcast::channel(64);
        let trusted_client_spki = TrustedClientSpki::default();
        trusted_client_spki.replace(
            devices
                .values()
                .filter_map(|device| device.public_key_spki.clone()),
        );
        let opened = Self {
            admin_token,
            path,
            session_ttl_ms: ttl,
            state: tokio::sync::Mutex::new(RegistryState {
                devices,
                pairings,
                sessions: HashMap::new(),
                challenges: HashMap::new(),
            }),
            trusted_client_spki,
            authorization_changes,
        };
        if invalidated_legacy_registry {
            let state = opened.state.lock().await;
            opened.persist_locked(&state).await?;
        }
        Ok(opened)
    }

    #[must_use]
    pub fn subscribe_authorization_changes(
        &self,
    ) -> tokio::sync::broadcast::Receiver<AuthorizationChange> {
        self.authorization_changes.subscribe()
    }

    #[must_use]
    pub fn trusted_client_spki(&self) -> TrustedClientSpki {
        self.trusted_client_spki.clone()
    }

    pub async fn authorization_context(
        &self,
        authorization: Option<&str>,
    ) -> Option<AuthorizationContext> {
        let token = bearer_token(authorization)?;
        if constant_time_eq(token.as_bytes(), self.admin_token.as_bytes()) {
            return Some(AuthorizationContext::Admin);
        }
        let hash = token_hash(token);
        let now = unix_time_ms();
        let mut state = self.state.lock().await;
        purge_expired(&mut state, now);
        if let Some(device) = state
            .devices
            .values_mut()
            .find(|device| constant_time_eq(device.token_hash.as_bytes(), hash.as_bytes()))
        {
            device.last_seen_at = now;
            return Some(AuthorizationContext::Device {
                device_id: device.id.clone(),
            });
        }
        state
            .sessions
            .values()
            .find(|session| constant_time_eq(session.token_hash.as_bytes(), hash.as_bytes()))
            .map(|session| AuthorizationContext::Session {
                device_id: session.device_id.clone(),
                scopes: session.scopes.clone(),
                expires_at: session.expires_at,
            })
    }

    pub async fn authorize_session(&self, authorization: Option<&str>, scope: &str) -> bool {
        match self.authorization_context(authorization).await {
            Some(AuthorizationContext::Admin) => true,
            Some(AuthorizationContext::Session { scopes, .. }) => {
                scopes.iter().any(|candidate| candidate == scope)
            }
            Some(AuthorizationContext::Device { .. }) | None => false,
        }
    }

    pub async fn authorize_admin(&self, authorization: Option<&str>) -> bool {
        matches!(
            self.authorization_context(authorization).await,
            Some(AuthorizationContext::Admin)
        )
    }

    /// Creates and durably persists a one-use five-minute pairing token.
    ///
    /// # Errors
    ///
    /// Returns an error when secure randomness or persistence fails.
    pub async fn create_pairing(&self) -> Result<PairingResult, AuthError> {
        let token = random_token(32)?;
        let pairing = Pairing {
            token_hash: token_hash(&token),
            expires_at: unix_time_ms().saturating_add(PAIRING_TTL_MS),
        };
        let mut state = self.state.lock().await;
        purge_expired(&mut state, unix_time_ms());
        state
            .pairings
            .insert(pairing.token_hash.clone(), pairing.clone());
        self.persist_locked(&state).await?;
        Ok(PairingResult {
            pairing_token: token,
            expires_at: pairing.expires_at,
        })
    }

    /// Exchanges one pairing token for a device credential.
    ///
    /// # Errors
    ///
    /// Returns an error for invalid metadata or key proof, expired/reused
    /// tokens, randomness failures, or persistence failures.
    pub async fn claim(&self, claim: PairingClaim) -> Result<PairingClaimResult, AuthError> {
        if !valid_name(claim.device_name.trim()) || !valid_public_key(&claim.public_key_spki) {
            return Err(AuthError::InvalidDeviceMetadata);
        }
        let now = unix_time_ms();
        let mut state = self.state.lock().await;
        purge_expired(&mut state, now);
        let pairing_hash = token_hash(&claim.pairing_token);
        let Some(pairing_key) = state
            .pairings
            .keys()
            .find(|key| constant_time_eq(key.as_bytes(), pairing_hash.as_bytes()))
            .cloned()
        else {
            return Err(AuthError::InvalidPairing);
        };
        let proof_message = pairing_claim_message(
            &claim.pairing_token,
            claim.device_name.trim(),
            &claim.public_key_spki,
        );
        if !valid_message_signature(&claim.public_key_spki, &proof_message, &claim.proof) {
            return Err(AuthError::InvalidPairingProof);
        }
        state.pairings.remove(&pairing_key);
        let device_id = device_id_for_public_key(&claim.public_key_spki)?;
        let capability_token = random_token(32)?;
        let existing = state.devices.get(&device_id).cloned();
        let scopes = existing
            .as_ref()
            .map_or_else(default_scopes, |device| device.scopes.clone());
        let created_at = existing.as_ref().map_or(now, |device| device.created_at);
        state
            .sessions
            .retain(|_, session| session.device_id != device_id);
        state
            .challenges
            .retain(|_, challenge| challenge.device_id != device_id);
        state.devices.insert(
            device_id.clone(),
            StoredDevice {
                id: device_id.clone(),
                name: claim.device_name.trim().to_owned(),
                token_hash: token_hash(&capability_token),
                public_key_spki: Some(claim.public_key_spki),
                scopes: scopes.clone(),
                created_at,
                last_seen_at: now,
            },
        );
        self.persist_locked(&state).await?;
        self.sync_trusted_client_spki(&state);
        if existing.is_some() {
            let _ = self.authorization_changes.send(AuthorizationChange {
                device_id: device_id.clone(),
                reason: AuthorizationChangeReason::DeviceRepaired,
            });
        }
        Ok(PairingClaimResult {
            device_id,
            capability_token,
            scopes,
            replaced_existing: existing.is_some(),
        })
    }

    /// Creates a short-lived proof-of-possession challenge.
    ///
    /// # Errors
    ///
    /// Returns an error for missing device authorization, legacy credentials,
    /// or randomness failure.
    pub async fn challenge(
        &self,
        authorization: Option<&str>,
    ) -> Result<ChallengeResult, AuthError> {
        let Some(AuthorizationContext::Device { device_id }) =
            self.authorization_context(authorization).await
        else {
            return Err(AuthError::DeviceAuthorizationRequired);
        };
        let mut state = self.state.lock().await;
        if state
            .devices
            .get(&device_id)
            .and_then(|device| device.public_key_spki.as_deref())
            .is_none()
        {
            return Err(AuthError::DeviceKeyRequired);
        }
        let challenge = DeviceChallenge {
            id: random_token(16)?,
            device_id: device_id.clone(),
            nonce: random_token(32)?,
            expires_at: unix_time_ms().saturating_add(CHALLENGE_TTL_MS),
        };
        trim_challenges(&mut state, &device_id);
        state
            .challenges
            .insert(challenge.id.clone(), challenge.clone());
        Ok(ChallengeResult {
            challenge_id: challenge.id,
            challenge: challenge.nonce,
            expires_at: challenge.expires_at,
        })
    }

    /// Verifies a signed challenge and creates a scoped short-lived session.
    ///
    /// # Errors
    ///
    /// Returns an error for invalid authorization, challenge, key, signature,
    /// or randomness failure.
    pub async fn create_session(
        &self,
        authorization: Option<&str>,
        proof: SessionProof,
    ) -> Result<SessionResult, AuthError> {
        let Some(AuthorizationContext::Device { device_id }) =
            self.authorization_context(authorization).await
        else {
            return Err(AuthError::DeviceAuthorizationRequired);
        };
        let now = unix_time_ms();
        let mut state = self.state.lock().await;
        let Some(challenge) = state.challenges.remove(&proof.challenge_id) else {
            return Err(AuthError::InvalidDeviceProof);
        };
        let Some(device) = state.devices.get(&device_id).cloned() else {
            return Err(AuthError::InvalidDeviceProof);
        };
        if challenge.device_id != device_id || challenge.expires_at <= now {
            return Err(AuthError::InvalidDeviceProof);
        }
        let Some(public_key) = device.public_key_spki.as_deref() else {
            return Err(AuthError::InvalidDeviceProof);
        };
        if !valid_signature(public_key, &challenge.nonce, &proof.signature) {
            return Err(AuthError::DeviceKeyMismatch);
        }
        trim_sessions(&mut state, &device_id);
        let session_token = random_token(32)?;
        let expires_at = now.saturating_add(self.session_ttl_ms);
        let session = DeviceSession {
            token_hash: token_hash(&session_token),
            device_id,
            scopes: device.scopes.clone(),
            expires_at,
        };
        state.sessions.insert(session.token_hash.clone(), session);
        Ok(SessionResult {
            session_token,
            expires_at,
            scopes: device.scopes,
        })
    }

    pub async fn devices(&self) -> Vec<Device> {
        self.state
            .lock()
            .await
            .devices
            .values()
            .cloned()
            .map(Into::into)
            .collect()
    }

    /// Revokes a device and its transient challenges and sessions.
    ///
    /// # Errors
    ///
    /// Returns an error when durable registry persistence fails.
    pub async fn revoke(&self, device_id: &str) -> Result<bool, AuthError> {
        let mut state = self.state.lock().await;
        let removed = state.devices.remove(device_id).is_some();
        if removed {
            state
                .sessions
                .retain(|_, session| session.device_id != device_id);
            state
                .challenges
                .retain(|_, challenge| challenge.device_id != device_id);
            self.persist_locked(&state).await?;
            self.sync_trusted_client_spki(&state);
            let _ = self.authorization_changes.send(AuthorizationChange {
                device_id: device_id.to_owned(),
                reason: AuthorizationChangeReason::DeviceRevoked,
            });
        }
        Ok(removed)
    }

    fn sync_trusted_client_spki(&self, state: &RegistryState) {
        self.trusted_client_spki.replace(
            state
                .devices
                .values()
                .filter_map(|device| device.public_key_spki.clone()),
        );
    }

    /// Replaces a device's scopes and revokes existing sessions.
    ///
    /// # Errors
    ///
    /// Returns an error for missing devices, invalid scopes, or persistence
    /// failure.
    pub async fn update_scopes(
        &self,
        device_id: &str,
        scopes: Vec<String>,
    ) -> Result<Device, AuthError> {
        if !valid_scopes(&scopes) || !scopes.iter().any(|scope| scope == "threads.read") {
            return Err(AuthError::InvalidScopes);
        }
        let mut state = self.state.lock().await;
        let Some(device) = state.devices.get_mut(device_id) else {
            return Err(AuthError::DeviceNotFound);
        };
        device.scopes = deduplicate_scopes(scopes);
        let public: Device = device.clone().into();
        state
            .sessions
            .retain(|_, session| session.device_id != device_id);
        state
            .challenges
            .retain(|_, challenge| challenge.device_id != device_id);
        self.persist_locked(&state).await?;
        let _ = self.authorization_changes.send(AuthorizationChange {
            device_id: device_id.to_owned(),
            reason: AuthorizationChangeReason::DeviceScopesChanged,
        });
        Ok(public)
    }

    async fn persist_locked(&self, state: &RegistryState) -> Result<(), AuthError> {
        let snapshot = RegistryFile {
            version: REGISTRY_VERSION,
            devices: state.devices.values().cloned().collect(),
            pairings: state.pairings.values().cloned().collect(),
        };
        let path = self.path.clone();
        tokio::task::spawn_blocking(move || persist_registry(&path, &snapshot))
            .await
            .map_err(|_| AuthError::Worker)??;
        Ok(())
    }
}

impl From<StoredDevice> for Device {
    fn from(device: StoredDevice) -> Self {
        Self {
            id: device.id,
            name: device.name,
            public_key_spki: device.public_key_spki,
            scopes: device.scopes,
            created_at: device.created_at,
            last_seen_at: device.last_seen_at,
        }
    }
}

fn persist_registry(path: &Path, registry: &RegistryFile) -> Result<(), AuthError> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
        std::fs::set_permissions(parent, std::fs::Permissions::from_mode(0o700))?;
    }
    let temporary = path.with_extension(format!("tmp-{}", std::process::id()));
    let bytes = serde_json::to_vec(registry)?;
    let mut file = OpenOptions::new()
        .create(true)
        .truncate(true)
        .write(true)
        .mode(0o600)
        .open(&temporary)?;
    file.write_all(&bytes)?;
    file.write_all(b"\n")?;
    file.sync_all()?;
    std::fs::rename(&temporary, path)?;
    std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600))?;
    Ok(())
}

fn purge_expired(state: &mut RegistryState, now: u64) {
    state.pairings.retain(|_, pairing| pairing.expires_at > now);
    state.sessions.retain(|_, session| session.expires_at > now);
    state
        .challenges
        .retain(|_, challenge| challenge.expires_at > now);
}

fn trim_sessions(state: &mut RegistryState, device_id: &str) {
    let mut sessions = state
        .sessions
        .values()
        .filter(|session| session.device_id == device_id)
        .map(|session| (session.token_hash.clone(), session.expires_at))
        .collect::<Vec<_>>();
    sessions.sort_by_key(|entry| entry.1);
    let remove = sessions.len().saturating_sub(MAX_SESSIONS_PER_DEVICE - 1);
    for (token, _) in sessions.into_iter().take(remove) {
        state.sessions.remove(&token);
    }
}

fn trim_challenges(state: &mut RegistryState, device_id: &str) {
    let mut challenges = state
        .challenges
        .values()
        .filter(|challenge| challenge.device_id == device_id)
        .map(|challenge| (challenge.id.clone(), challenge.expires_at))
        .collect::<Vec<_>>();
    challenges.sort_by_key(|entry| entry.1);
    let remove = challenges
        .len()
        .saturating_sub(MAX_CHALLENGES_PER_DEVICE - 1);
    for (id, _) in challenges.into_iter().take(remove) {
        state.challenges.remove(&id);
    }
}

fn valid_name(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 80
        && !value
            .bytes()
            .any(|byte| byte.is_ascii_control() || byte == 0x7f)
}

fn valid_id(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 128
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'_' | b':' | b'-'))
}

fn valid_scopes(scopes: &[String]) -> bool {
    scopes
        .iter()
        .all(|scope| DEVICE_SCOPES.contains(&scope.as_str()))
}

fn default_scopes() -> Vec<String> {
    DEFAULT_DEVICE_SCOPES
        .iter()
        .map(ToString::to_string)
        .collect()
}

fn deduplicate_scopes(scopes: Vec<String>) -> Vec<String> {
    let mut unique = Vec::with_capacity(scopes.len());
    for scope in scopes {
        if !unique.contains(&scope) {
            unique.push(scope);
        }
    }
    unique
}

fn valid_public_key(encoded: &str) -> bool {
    (64..=512).contains(&encoded.len())
        && general_purpose::STANDARD
            .decode(encoded)
            .ok()
            .and_then(|der| VerifyingKey::from_public_key_der(&der).ok())
            .is_some()
}

fn valid_signature(public_key: &str, nonce: &str, signature: &str) -> bool {
    let Some(message) = general_purpose::URL_SAFE_NO_PAD.decode(nonce).ok() else {
        return false;
    };
    valid_message_signature(public_key, &message, signature)
}

fn valid_message_signature(public_key: &str, message: &[u8], signature: &str) -> bool {
    let Some(key) = general_purpose::STANDARD
        .decode(public_key)
        .ok()
        .and_then(|der| VerifyingKey::from_public_key_der(&der).ok())
    else {
        return false;
    };
    let Some(signature) = general_purpose::STANDARD
        .decode(signature)
        .ok()
        .and_then(|der| Signature::from_der(&der).ok())
    else {
        return false;
    };
    key.verify(message, &signature).is_ok()
}

/// Builds the domain-separated byte sequence an enrolling device must sign.
/// The proof binds the one-use invitation, the displayed device name, and the
/// exact non-exportable public key into one registration transcript.
#[must_use]
pub fn pairing_claim_message(
    pairing_token: &str,
    device_name: &str,
    public_key_spki: &str,
) -> Vec<u8> {
    format!(
        "codewide-pairing-v2\n{}\n{}\n{}",
        pairing_token,
        device_name.trim(),
        public_key_spki
    )
    .into_bytes()
}

fn device_id_for_public_key(public_key: &str) -> Result<String, AuthError> {
    let der = general_purpose::STANDARD
        .decode(public_key)
        .map_err(|_| AuthError::InvalidDeviceMetadata)?;
    Ok(format!("device-{}", hex::encode(Sha256::digest(der))))
}

fn bearer_token(authorization: Option<&str>) -> Option<&str> {
    authorization?.strip_prefix("Bearer ")
}

fn token_hash(token: &str) -> String {
    hex::encode(Sha256::digest(token.as_bytes()))
}

fn random_token(bytes: usize) -> Result<String, AuthError> {
    let mut output = vec![0_u8; bytes];
    OsRng
        .try_fill_bytes(&mut output)
        .map_err(|_| AuthError::Random)?;
    Ok(general_purpose::URL_SAFE_NO_PAD.encode(output))
}

fn constant_time_eq(left: &[u8], right: &[u8]) -> bool {
    if left.len() != right.len() {
        return false;
    }
    left.iter()
        .zip(right)
        .fold(0_u8, |difference, (left, right)| {
            difference | (left ^ right)
        })
        == 0
}

fn unix_time_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |duration| {
            u64::try_from(duration.as_millis()).unwrap_or(u64::MAX)
        })
}

#[cfg(test)]
mod tests {
    use super::*;
    use p256::{
        ecdsa::{SigningKey, signature::Signer},
        pkcs8::EncodePublicKey,
    };

    #[test]
    fn scope_and_metadata_validation_is_strict() {
        assert!(valid_id("device.one:2-test"));
        assert!(!valid_id("../device"));
        assert!(valid_name("Android Fold"));
        assert!(!valid_name("bad\nname"));
        assert!(valid_scopes(&default_scopes()));
        assert!(!valid_scopes(&["root".into()]));
    }

    #[test]
    fn pairing_proof_uses_the_v2_domain_and_exact_transcript() {
        assert_eq!(
            pairing_claim_message("token", " Android Fold ", "public-key"),
            b"codewide-pairing-v2\ntoken\nAndroid Fold\npublic-key"
        );
    }

    #[tokio::test]
    async fn pairing_and_signed_session_survive_registry_restart()
    -> Result<(), Box<dyn std::error::Error>> {
        let directory = tempfile::tempdir()?;
        let path = directory.path().join("devices.json");
        let admin: Arc<str> = Arc::from("admin-token-that-is-long-enough-for-tests");
        let registry = DeviceRegistry::open(admin.clone(), path.clone(), Some(60_000)).await?;
        let pairing = registry.create_pairing().await?;
        let signing = SigningKey::from_bytes((&[7_u8; 32]).into())?;
        let public_key = signing.verifying_key().to_public_key_der()?;
        let public_key_spki = general_purpose::STANDARD.encode(public_key.as_bytes());
        let proof: Signature = signing.sign(&pairing_claim_message(
            &pairing.pairing_token,
            "Android Fold",
            &public_key_spki,
        ));
        let claimed = registry
            .claim(PairingClaim {
                pairing_token: pairing.pairing_token.clone(),
                device_name: "Android Fold".into(),
                public_key_spki: public_key_spki.clone(),
                proof: general_purpose::STANDARD.encode(proof.to_der().as_bytes()),
            })
            .await?;
        assert!(matches!(
            registry
                .claim(PairingClaim {
                    pairing_token: pairing.pairing_token,
                    device_name: "Replay".into(),
                    public_key_spki: public_key_spki.clone(),
                    proof: String::new(),
                })
                .await,
            Err(AuthError::InvalidPairing)
        ));
        let device_bearer = format!("Bearer {}", claimed.capability_token);
        let rejected_challenge = registry.challenge(Some(&device_bearer)).await?;
        let rejected_message =
            general_purpose::URL_SAFE_NO_PAD.decode(&rejected_challenge.challenge)?;
        let wrong_signing = SigningKey::from_bytes((&[8_u8; 32]).into())?;
        let wrong_signature: Signature = wrong_signing.sign(&rejected_message);
        assert!(matches!(
            registry
                .create_session(
                    Some(&device_bearer),
                    SessionProof {
                        challenge_id: rejected_challenge.challenge_id,
                        signature: general_purpose::STANDARD
                            .encode(wrong_signature.to_der().as_bytes()),
                    },
                )
                .await,
            Err(AuthError::DeviceKeyMismatch)
        ));
        let challenge = registry.challenge(Some(&device_bearer)).await?;
        let message = general_purpose::URL_SAFE_NO_PAD.decode(&challenge.challenge)?;
        let signature: Signature = signing.sign(&message);
        let session = registry
            .create_session(
                Some(&device_bearer),
                SessionProof {
                    challenge_id: challenge.challenge_id,
                    signature: general_purpose::STANDARD.encode(signature.to_der().as_bytes()),
                },
            )
            .await?;
        assert!(
            registry
                .authorize_session(
                    Some(&format!("Bearer {}", session.session_token)),
                    "threads.read"
                )
                .await
        );
        assert!(
            registry
                .authorize_session(
                    Some(&format!("Bearer {}", session.session_token)),
                    "threads.read"
                )
                .await
        );

        let repair = registry.create_pairing().await?;
        let repair_proof: Signature = signing.sign(&pairing_claim_message(
            &repair.pairing_token,
            "Android Fold",
            &public_key_spki,
        ));
        let repaired = registry
            .claim(PairingClaim {
                pairing_token: repair.pairing_token,
                device_name: "Android Fold".into(),
                public_key_spki,
                proof: general_purpose::STANDARD.encode(repair_proof.to_der().as_bytes()),
            })
            .await?;
        let repaired_bearer = format!("Bearer {}", repaired.capability_token);

        let reopened = DeviceRegistry::open(admin, path, None).await?;
        assert!(matches!(
            reopened.authorization_context(Some(&repaired_bearer)).await,
            Some(AuthorizationContext::Device { device_id }) if device_id == claimed.device_id
        ));
        Ok(())
    }

    #[tokio::test]
    async fn legacy_registry_is_invalidated_before_accepting_connections()
    -> Result<(), Box<dyn std::error::Error>> {
        let directory = tempfile::tempdir()?;
        let path = directory.path().join("devices.json");
        let capability = "legacy-capability-token-that-is-long-enough";
        let signing = SigningKey::from_bytes((&[9_u8; 32]).into())?;
        let public_key = signing.verifying_key().to_public_key_der()?;
        let public_key_spki = general_purpose::STANDARD.encode(public_key.as_bytes());
        let now = unix_time_ms();
        let legacy_device_id = "550e8400-e29b-41d4-a716-446655440000";
        let registry_file = RegistryFile {
            version: 3,
            devices: vec![StoredDevice {
                id: legacy_device_id.into(),
                name: "Legacy Android".into(),
                token_hash: token_hash(capability),
                public_key_spki: Some(public_key_spki),
                scopes: default_scopes(),
                created_at: now,
                last_seen_at: now,
            }],
            pairings: Vec::new(),
        };
        tokio::fs::write(&path, serde_json::to_vec(&registry_file)?).await?;

        let registry = DeviceRegistry::open(
            Arc::from("admin-token-that-is-long-enough-for-tests"),
            path.clone(),
            Some(60_000),
        )
        .await?;
        assert!(
            registry
                .authorization_context(Some(&format!("Bearer {capability}")))
                .await
                .is_none()
        );
        let migrated: RegistryFile = serde_json::from_slice(&tokio::fs::read(path).await?)?;
        assert_eq!(migrated.version, REGISTRY_VERSION);
        assert!(migrated.devices.is_empty());
        assert!(migrated.pairings.is_empty());
        Ok(())
    }
}
