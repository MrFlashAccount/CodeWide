use std::{
    fs::{self, OpenOptions},
    io::Write,
    os::unix::fs::{OpenOptionsExt, PermissionsExt},
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};

use base64::{Engine as _, engine::general_purpose};
use rcgen::{
    CertificateParams, DistinguishedName, DnType, ExtendedKeyUsagePurpose, KeyPair,
    KeyUsagePurpose, PublicKeyData,
};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use time::{Duration, OffsetDateTime};

use crate::secure_store::{SecureStore, SecureStoreError};

const IDENTITY_VERSION: u8 = 1;
const CERTIFICATE_LIFETIME_DAYS: i64 = 5 * 365;
const CERTIFICATE_FILE: &str = "tls-cert.der";
const PRIVATE_KEY_FILE: &str = "tls-key.der";
const PRIVATE_KEY_SECRET: &str = "tls-private-key";
const MANIFEST_FILE: &str = "identity.json";

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TransportIdentity {
    pub tls_pin_sha256: String,
    pub created_at: u64,
    pub expires_at: u64,
}

#[derive(Clone, Debug)]
pub struct CompanionIdentity {
    public: TransportIdentity,
    certificate_der: Vec<u8>,
    private_key_der: Vec<u8>,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct IdentityManifest {
    version: u8,
    tls_pin_sha256: String,
    created_at: u64,
    expires_at: u64,
}

impl CompanionIdentity {
    /// Loads the installation identity or creates it exactly once. A partial
    /// identity is never replaced automatically because that would silently
    /// rotate every paired device's trust anchor.
    ///
    /// # Errors
    ///
    /// Returns an error for invalid permissions, partial or corrupt state,
    /// expired identity material, certificate generation, or filesystem I/O.
    pub fn load_or_create(directory: &Path) -> Result<Self, IdentityError> {
        if directory.exists() {
            return Self::load(directory);
        }
        create_identity(directory)?;
        Self::load(directory)
    }

    /// Loads and verifies an existing installation identity.
    ///
    /// # Errors
    ///
    /// Returns an error when files are missing, insecure, corrupt, expired, or
    /// when the private key no longer matches the persisted public pin.
    pub fn load(directory: &Path) -> Result<Self, IdentityError> {
        let manifest_path = directory.join(MANIFEST_FILE);
        let certificate_path = directory.join(CERTIFICATE_FILE);
        let private_key_path = directory.join(PRIVATE_KEY_FILE);
        if !manifest_path.is_file() || !certificate_path.is_file() {
            return Err(IdentityError::Incomplete);
        }
        require_private_permissions(directory, 0o077)?;
        require_private_permissions(&manifest_path, 0o077)?;
        require_private_permissions(&certificate_path, 0o077)?;
        let manifest: IdentityManifest = serde_json::from_slice(&fs::read(manifest_path)?)?;
        if manifest.version != IDENTITY_VERSION || !valid_pin(&manifest.tls_pin_sha256) {
            return Err(IdentityError::InvalidManifest);
        }
        let mut secure_store = SecureStore::open(directory)?;
        let private_key_der = match secure_store.get(PRIVATE_KEY_SECRET)? {
            Some(secret) => secret,
            None if private_key_path.is_file() => {
                require_private_permissions(&private_key_path, 0o077)?;
                let legacy = fs::read(&private_key_path)?;
                secure_store.set_new(PRIVATE_KEY_SECRET, &legacy)?;
                fs::remove_file(&private_key_path)?;
                sync_directory(directory)?;
                legacy
            }
            None => return Err(IdentityError::Incomplete),
        };
        let _ = secure_store.migrate_to_stronger_backend(PRIVATE_KEY_SECRET)?;
        let key_pair = KeyPair::try_from(private_key_der.as_slice())?;
        let actual_pin = spki_pin(&key_pair.subject_public_key_info());
        if actual_pin != manifest.tls_pin_sha256 {
            return Err(IdentityError::KeyMismatch);
        }
        if manifest.expires_at <= unix_time_ms() {
            return Err(IdentityError::Expired);
        }
        Ok(Self {
            public: TransportIdentity {
                tls_pin_sha256: manifest.tls_pin_sha256,
                created_at: manifest.created_at,
                expires_at: manifest.expires_at,
            },
            certificate_der: fs::read(certificate_path)?,
            private_key_der,
        })
    }

    #[must_use]
    pub fn public(&self) -> &TransportIdentity {
        &self.public
    }

    #[must_use]
    pub fn certificate_der(&self) -> &[u8] {
        &self.certificate_der
    }

    #[must_use]
    pub fn private_key_der(&self) -> &[u8] {
        &self.private_key_der
    }
}

/// Replaces an installation identity only through an explicit operator action.
/// The retired private key is deleted after the new directory is active; its
/// public manifest and certificate remain as a local audit record.
///
/// # Errors
///
/// Returns an error if the current identity is invalid, replacement generation
/// fails, or the atomic filesystem transition cannot be completed.
pub fn rotate(directory: &Path) -> Result<CompanionIdentity, IdentityError> {
    let current = CompanionIdentity::load(directory)?;
    let parent = directory.parent().ok_or(IdentityError::InvalidPath)?;
    let stem = directory
        .file_name()
        .and_then(|value| value.to_str())
        .ok_or(IdentityError::InvalidPath)?;
    let suffix = unix_time_ms();
    let next = parent.join(format!(".{stem}.next-{suffix}"));
    let retired = parent.join(format!("{stem}.revoked-{suffix}"));
    create_identity(&next)?;
    let replacement = CompanionIdentity::load(&next)?;
    if replacement.public.tls_pin_sha256 == current.public.tls_pin_sha256 {
        return Err(IdentityError::RotationDidNotChangeKey);
    }
    fs::rename(directory, &retired)?;
    if let Err(error) = fs::rename(&next, directory) {
        let _ = fs::rename(&retired, directory);
        return Err(error.into());
    }
    let mut retired_store = SecureStore::open(&retired)?;
    if !retired_store.delete(PRIVATE_KEY_SECRET)? {
        return Err(IdentityError::Incomplete);
    }
    sync_directory(parent)?;
    CompanionIdentity::load(directory)
}

fn create_identity(directory: &Path) -> Result<(), IdentityError> {
    let parent = directory.parent().ok_or(IdentityError::InvalidPath)?;
    fs::create_dir_all(parent)?;
    fs::create_dir(directory)?;
    fs::set_permissions(directory, fs::Permissions::from_mode(0o700))?;

    let now = OffsetDateTime::now_utc();
    let not_before = now - Duration::days(1);
    let not_after = now + Duration::days(CERTIFICATE_LIFETIME_DAYS);
    let key_pair = KeyPair::generate()?;
    let mut parameters = CertificateParams::new(vec![
        "codewide-companion".to_owned(),
        "localhost".to_owned(),
    ])?;
    let mut name = DistinguishedName::new();
    name.push(DnType::CommonName, "CodeWide Companion");
    parameters.distinguished_name = name;
    parameters.not_before = not_before;
    parameters.not_after = not_after;
    parameters.key_usages = vec![KeyUsagePurpose::DigitalSignature];
    parameters.extended_key_usages = vec![ExtendedKeyUsagePurpose::ServerAuth];
    let certificate = parameters.self_signed(&key_pair)?;
    let created_at = unix_time_ms();
    let expires_at = u64::try_from(not_after.unix_timestamp())
        .map_err(|_| IdentityError::InvalidTime)?
        .saturating_mul(1_000);
    let manifest = IdentityManifest {
        version: IDENTITY_VERSION,
        tls_pin_sha256: spki_pin(&key_pair.subject_public_key_info()),
        created_at,
        expires_at,
    };

    SecureStore::open(directory)?.set_new(PRIVATE_KEY_SECRET, &key_pair.serialize_der())?;
    write_new_private(
        &directory.join(CERTIFICATE_FILE),
        certificate.der().as_ref(),
    )?;
    write_new_private(
        &directory.join(MANIFEST_FILE),
        &serde_json::to_vec_pretty(&manifest)?,
    )?;
    sync_directory(directory)?;
    sync_directory(parent)?;
    Ok(())
}

fn write_new_private(path: &Path, contents: &[u8]) -> Result<(), std::io::Error> {
    let mut file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .mode(0o600)
        .open(path)?;
    file.write_all(contents)?;
    file.sync_all()
}

fn require_private_permissions(path: &Path, forbidden: u32) -> Result<(), IdentityError> {
    if fs::metadata(path)?.permissions().mode() & forbidden != 0 {
        return Err(IdentityError::InsecurePermissions(path.to_owned()));
    }
    Ok(())
}

fn sync_directory(path: &Path) -> Result<(), std::io::Error> {
    fs::File::open(path)?.sync_all()
}

fn spki_pin(spki_der: &[u8]) -> String {
    format!(
        "sha256/{}",
        general_purpose::STANDARD.encode(Sha256::digest(spki_der))
    )
}

fn valid_pin(pin: &str) -> bool {
    let Some(encoded) = pin.strip_prefix("sha256/") else {
        return false;
    };
    general_purpose::STANDARD
        .decode(encoded)
        .is_ok_and(|digest| digest.len() == 32)
}

fn unix_time_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |duration| {
            u64::try_from(duration.as_millis()).unwrap_or(u64::MAX)
        })
}

#[derive(Debug, thiserror::Error)]
pub enum IdentityError {
    #[error("companion identity path is invalid")]
    InvalidPath,
    #[error("companion identity is incomplete; recover or rotate it explicitly")]
    Incomplete,
    #[error("companion identity manifest is invalid")]
    InvalidManifest,
    #[error("companion identity private key does not match its pin")]
    KeyMismatch,
    #[error("companion identity has expired; rotate it and re-pair devices")]
    Expired,
    #[error("companion identity rotation did not change the key")]
    RotationDidNotChangeKey,
    #[error("companion identity has insecure permissions: {0}")]
    InsecurePermissions(PathBuf),
    #[error("companion identity time is invalid")]
    InvalidTime,
    #[error(transparent)]
    SecureStore(#[from] SecureStoreError),
    #[error(transparent)]
    Io(#[from] std::io::Error),
    #[error(transparent)]
    Json(#[from] serde_json::Error),
    #[error(transparent)]
    Certificate(#[from] rcgen::Error),
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn identity_is_durable_private_and_rotation_changes_the_pin() -> Result<(), IdentityError> {
        let root = tempfile::tempdir()?;
        let path = root.path().join("identity");
        let first = CompanionIdentity::load_or_create(&path)?;
        let first_pin = first.public().tls_pin_sha256.clone();
        assert_eq!(
            CompanionIdentity::load_or_create(&path)?.public(),
            first.public()
        );
        assert!(!path.join(PRIVATE_KEY_FILE).exists());
        assert_eq!(
            fs::metadata(path.join("secure-store.json"))?
                .permissions()
                .mode()
                & 0o777,
            0o600
        );
        assert!(SecureStore::open(&path)?.get(PRIVATE_KEY_SECRET)?.is_some());

        let rotated = rotate(&path)?;
        assert_ne!(rotated.public().tls_pin_sha256, first_pin);
        let retired = fs::read_dir(root.path())?
            .filter_map(Result::ok)
            .find(|entry| {
                entry
                    .file_name()
                    .to_string_lossy()
                    .starts_with("identity.revoked-")
            })
            .ok_or(IdentityError::Incomplete)?;
        assert!(!retired.path().join(PRIVATE_KEY_FILE).exists());
        Ok(())
    }

    #[test]
    fn legacy_private_key_is_imported_and_raw_file_is_removed() -> Result<(), IdentityError> {
        let root = tempfile::tempdir()?;
        let path = root.path().join("identity");
        CompanionIdentity::load_or_create(&path)?;
        let mut store = SecureStore::open(&path)?;
        let private_key = store
            .get(PRIVATE_KEY_SECRET)?
            .ok_or(IdentityError::Incomplete)?;
        assert!(store.delete(PRIVATE_KEY_SECRET)?);
        write_new_private(&path.join(PRIVATE_KEY_FILE), &private_key)?;

        CompanionIdentity::load(&path)?;

        assert!(!path.join(PRIVATE_KEY_FILE).exists());
        assert_eq!(
            SecureStore::open(&path)?.get(PRIVATE_KEY_SECRET)?,
            Some(private_key)
        );
        Ok(())
    }

    #[test]
    fn partial_identity_fails_closed_instead_of_regenerating() -> Result<(), IdentityError> {
        let root = tempfile::tempdir()?;
        let path = root.path().join("identity");
        fs::create_dir(&path)?;
        fs::set_permissions(&path, fs::Permissions::from_mode(0o700))?;
        assert!(matches!(
            CompanionIdentity::load_or_create(&path),
            Err(IdentityError::Incomplete)
        ));
        Ok(())
    }

    #[test]
    fn expired_identity_fails_closed() -> Result<(), IdentityError> {
        let root = tempfile::tempdir()?;
        let path = root.path().join("identity");
        CompanionIdentity::load_or_create(&path)?;
        let manifest_path = path.join(MANIFEST_FILE);
        let mut manifest: serde_json::Value = serde_json::from_slice(&fs::read(&manifest_path)?)?;
        manifest["expiresAt"] = serde_json::Value::from(1_u64);
        fs::write(&manifest_path, serde_json::to_vec_pretty(&manifest)?)?;
        fs::set_permissions(&manifest_path, fs::Permissions::from_mode(0o600))?;
        assert!(matches!(
            CompanionIdentity::load(&path),
            Err(IdentityError::Expired)
        ));
        Ok(())
    }
}
