use std::{
    collections::BTreeMap,
    fs::{self, OpenOptions},
    io::Write,
    os::unix::fs::{OpenOptionsExt, PermissionsExt},
    path::{Path, PathBuf},
};

use serde::{Deserialize, Serialize};

const STORE_VERSION: u8 = 1;
const SERVICE: &str = "dev.codewide.companion";
const MANIFEST_FILE: &str = "secure-store.json";
const FALLBACK_DIRECTORY: &str = "secure-store-fallback";

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "kebab-case")]
enum Backend {
    Platform,
    PrivateFile,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct SecretLocation {
    backend: Backend,
    key_id: String,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct StoreManifest {
    version: u8,
    entries: BTreeMap<String, SecretLocation>,
}

/// Durable byte-oriented secret storage. Platform credential storage is tried
/// first; a mode-0600 file is the explicit last-resort backend. The manifest
/// records the selected backend so a temporarily unavailable keyring can never
/// cause silent regeneration or accidental fallback to a different secret.
pub struct SecureStore {
    root: PathBuf,
    manifest: StoreManifest,
}

impl SecureStore {
    /// Opens the store and validates its durable backend map.
    ///
    /// # Errors
    ///
    /// Returns an error for insecure permissions, malformed state or I/O.
    pub fn open(root: &Path) -> Result<Self, SecureStoreError> {
        fs::create_dir_all(root)?;
        fs::set_permissions(root, fs::Permissions::from_mode(0o700))?;
        require_private_permissions(root, 0o077)?;
        let path = root.join(MANIFEST_FILE);
        let manifest = if path.exists() {
            require_private_permissions(&path, 0o077)?;
            let value: StoreManifest = serde_json::from_slice(&fs::read(path)?)?;
            if value.version != STORE_VERSION {
                return Err(SecureStoreError::UnsupportedVersion(value.version));
            }
            value
        } else {
            StoreManifest {
                version: STORE_VERSION,
                entries: BTreeMap::new(),
            }
        };
        Ok(Self {
            root: root.to_owned(),
            manifest,
        })
    }

    /// Returns one secret without changing its selected backend.
    ///
    /// # Errors
    ///
    /// Returns an error when the recorded backend is inaccessible or corrupt.
    pub fn get(&self, name: &str) -> Result<Option<Vec<u8>>, SecureStoreError> {
        validate_name(name)?;
        let Some(location) = self.manifest.entries.get(name) else {
            return Ok(None);
        };
        match location.backend {
            Backend::Platform => platform_get(&location.key_id).map(Some),
            Backend::PrivateFile => {
                let path = self.fallback_path(&location.key_id);
                require_private_permissions(&path, 0o077)?;
                Ok(Some(fs::read(path)?))
            }
        }
    }

    /// Saves a new secret to the strongest available backend. Existing names
    /// are immutable to prevent accidental identity rotation.
    ///
    /// # Errors
    ///
    /// Returns an error for duplicates or when no backend can durably commit.
    pub fn set_new(&mut self, name: &str, secret: &[u8]) -> Result<(), SecureStoreError> {
        validate_name(name)?;
        if self.manifest.entries.contains_key(name) {
            return Err(SecureStoreError::AlreadyExists(name.to_owned()));
        }
        if secret.is_empty() {
            return Err(SecureStoreError::EmptySecret);
        }
        let key_id = format!("{}-{}", name, hex::encode(rand::random::<[u8; 16]>()));
        let backend = if platform_set(&key_id, secret).is_ok() {
            Backend::Platform
        } else {
            self.write_fallback(&key_id, secret)?;
            Backend::PrivateFile
        };
        self.manifest
            .entries
            .insert(name.to_owned(), SecretLocation { backend, key_id });
        self.persist_manifest()
    }

    /// Moves a file-backed secret to platform storage when it becomes
    /// available. The file is deleted only after the new value is verified and
    /// the durable backend map has committed.
    ///
    /// # Errors
    ///
    /// Returns an error when the current secret cannot be read or persisted.
    pub fn migrate_to_stronger_backend(&mut self, name: &str) -> Result<bool, SecureStoreError> {
        validate_name(name)?;
        let Some(location) = self.manifest.entries.get(name).cloned() else {
            return Ok(false);
        };
        if location.backend == Backend::Platform {
            return Ok(false);
        }
        let secret = self
            .get(name)?
            .ok_or_else(|| SecureStoreError::Missing(name.to_owned()))?;
        if platform_set(&location.key_id, &secret).is_err() {
            return Ok(false);
        }
        if platform_get(&location.key_id)? != secret {
            return Err(SecureStoreError::PlatformVerification);
        }
        self.manifest
            .entries
            .get_mut(name)
            .ok_or_else(|| SecureStoreError::Missing(name.to_owned()))?
            .backend = Backend::Platform;
        self.persist_manifest()?;
        fs::remove_file(self.fallback_path(&location.key_id))?;
        sync_directory(&self.root.join(FALLBACK_DIRECTORY))?;
        Ok(true)
    }

    /// Deletes a secret from its recorded backend and then removes its durable
    /// descriptor.
    ///
    /// # Errors
    ///
    /// Returns an error when deletion or manifest persistence fails.
    pub fn delete(&mut self, name: &str) -> Result<bool, SecureStoreError> {
        validate_name(name)?;
        let Some(location) = self.manifest.entries.get(name).cloned() else {
            return Ok(false);
        };
        match location.backend {
            Backend::Platform => platform_delete(&location.key_id)?,
            Backend::PrivateFile => fs::remove_file(self.fallback_path(&location.key_id))?,
        }
        self.manifest.entries.remove(name);
        self.persist_manifest()?;
        Ok(true)
    }

    fn write_fallback(&self, key_id: &str, secret: &[u8]) -> Result<(), SecureStoreError> {
        let directory = self.root.join(FALLBACK_DIRECTORY);
        fs::create_dir_all(&directory)?;
        fs::set_permissions(&directory, fs::Permissions::from_mode(0o700))?;
        write_new_private(&directory.join(format!("{key_id}.bin")), secret)?;
        sync_directory(&directory)?;
        Ok(())
    }

    fn fallback_path(&self, key_id: &str) -> PathBuf {
        self.root
            .join(FALLBACK_DIRECTORY)
            .join(format!("{key_id}.bin"))
    }

    fn persist_manifest(&self) -> Result<(), SecureStoreError> {
        let path = self.root.join(MANIFEST_FILE);
        let temporary = self.root.join(format!(".{MANIFEST_FILE}.new"));
        if temporary.exists() {
            fs::remove_file(&temporary)?;
        }
        write_new_private(&temporary, &serde_json::to_vec_pretty(&self.manifest)?)?;
        fs::rename(&temporary, &path)?;
        sync_directory(&self.root)?;
        Ok(())
    }
}

fn platform_entry(key_id: &str) -> Result<keyring::Entry, SecureStoreError> {
    keyring::Entry::new(SERVICE, key_id)
        .map_err(|error| SecureStoreError::Platform(error.to_string()))
}

fn platform_get(key_id: &str) -> Result<Vec<u8>, SecureStoreError> {
    platform_entry(key_id)?
        .get_secret()
        .map_err(|error| SecureStoreError::Platform(error.to_string()))
}

fn platform_set(key_id: &str, secret: &[u8]) -> Result<(), SecureStoreError> {
    let entry = platform_entry(key_id)?;
    entry
        .set_secret(secret)
        .map_err(|error| SecureStoreError::Platform(error.to_string()))?;
    if entry
        .get_secret()
        .map_err(|error| SecureStoreError::Platform(error.to_string()))?
        != secret
    {
        return Err(SecureStoreError::PlatformVerification);
    }
    Ok(())
}

fn platform_delete(key_id: &str) -> Result<(), SecureStoreError> {
    platform_entry(key_id)?
        .delete_credential()
        .map_err(|error| SecureStoreError::Platform(error.to_string()))
}

fn validate_name(name: &str) -> Result<(), SecureStoreError> {
    if name.is_empty()
        || name.len() > 80
        || !name
            .bytes()
            .all(|value| value.is_ascii_alphanumeric() || matches!(value, b'.' | b'_' | b'-'))
    {
        return Err(SecureStoreError::InvalidName);
    }
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

fn require_private_permissions(path: &Path, forbidden: u32) -> Result<(), SecureStoreError> {
    if fs::metadata(path)?.permissions().mode() & forbidden != 0 {
        return Err(SecureStoreError::InsecurePermissions(path.to_owned()));
    }
    Ok(())
}

fn sync_directory(path: &Path) -> Result<(), std::io::Error> {
    fs::File::open(path)?.sync_all()
}

#[derive(Debug, thiserror::Error)]
pub enum SecureStoreError {
    #[error("secure store key name is invalid")]
    InvalidName,
    #[error("secure store secret cannot be empty")]
    EmptySecret,
    #[error("secure store entry already exists: {0}")]
    AlreadyExists(String),
    #[error("secure store entry is missing: {0}")]
    Missing(String),
    #[error("secure store version is unsupported: {0}")]
    UnsupportedVersion(u8),
    #[error("platform secure storage failed: {0}")]
    Platform(String),
    #[error("platform secure storage verification failed")]
    PlatformVerification,
    #[error("secure store path has insecure permissions: {0}")]
    InsecurePermissions(PathBuf),
    #[error(transparent)]
    Io(#[from] std::io::Error),
    #[error(transparent)]
    Json(#[from] serde_json::Error),
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn private_fallback_is_durable_and_backend_selection_is_sticky() -> Result<(), SecureStoreError>
    {
        let root = tempfile::tempdir().map_err(SecureStoreError::Io)?;
        let mut store = SecureStore::open(root.path())?;
        store.write_fallback("test-key", b"secret")?;
        store.manifest.entries.insert(
            "example".into(),
            SecretLocation {
                backend: Backend::PrivateFile,
                key_id: "test-key".into(),
            },
        );
        store.persist_manifest()?;
        assert_eq!(
            SecureStore::open(root.path())?.get("example")?,
            Some(b"secret".to_vec())
        );
        Ok(())
    }
}
