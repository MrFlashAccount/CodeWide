//! The plugin-owned store of pasted tokens.
//!
//! One file per `(host, login)` with mode `0600` inside a `0700` `secrets`
//! directory under the plugin state directory the companion passes in
//! `initialize`. Writes are atomic: a temporary file in the same directory,
//! `fsync`, then `rename`. The companion never reads this directory.

use std::{
    fs::{self, OpenOptions},
    io::Write as _,
    os::unix::fs::{OpenOptionsExt as _, PermissionsExt as _},
    path::{Path, PathBuf},
};

use forge_protocol::Secret;

const DIRECTORY_MODE: u32 = 0o700;
const FILE_MODE: u32 = 0o600;

#[derive(Debug, thiserror::Error)]
pub enum SecretStoreError {
    #[error("secret store I/O failed: {0}")]
    Io(#[from] std::io::Error),
    #[error("secret file is not valid UTF-8")]
    Encoding,
}

/// Pasted-token storage, keyed by host and login.
#[derive(Clone, Debug)]
pub struct SecretStore {
    directory: PathBuf,
}

impl SecretStore {
    /// A store under `state_directory/secrets`; nothing is created until the
    /// first save.
    #[must_use]
    pub fn new(state_directory: &Path) -> Self {
        Self {
            directory: state_directory.join("secrets"),
        }
    }

    #[must_use]
    pub fn directory(&self) -> &Path {
        &self.directory
    }

    /// Saves a token atomically, replacing an earlier one for the account.
    ///
    /// # Errors
    ///
    /// Returns an error when the directory or file cannot be created with
    /// private permissions or the rename fails.
    pub fn save(&self, host: &str, login: &str, token: &Secret) -> Result<(), SecretStoreError> {
        self.ensure_directory()?;
        let target = self.path(host, login);
        let temporary = self.directory.join(format!(
            ".{}.{}.tmp",
            file_stem(host, login),
            std::process::id()
        ));
        let result = (|| {
            let mut file = OpenOptions::new()
                .create_new(true)
                .write(true)
                .mode(FILE_MODE)
                .open(&temporary)?;
            file.write_all(token.expose().as_bytes())?;
            file.sync_all()?;
            fs::rename(&temporary, &target)?;
            Ok::<(), std::io::Error>(())
        })();
        if result.is_err() {
            let _ = fs::remove_file(&temporary);
        }
        result?;
        Ok(())
    }

    /// The saved token of an account, if any.
    ///
    /// # Errors
    ///
    /// Returns an error when the file exists but cannot be read.
    pub fn load(&self, host: &str, login: &str) -> Result<Option<Secret>, SecretStoreError> {
        match fs::read(self.path(host, login)) {
            Ok(bytes) => {
                let value = String::from_utf8(bytes).map_err(|_| SecretStoreError::Encoding)?;
                Ok(Some(Secret::new(value.trim().to_owned())))
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
            Err(error) => Err(error.into()),
        }
    }

    /// Deletes the saved token of an account; a missing file is not an error.
    ///
    /// # Errors
    ///
    /// Returns an error when an existing file cannot be removed.
    pub fn forget(&self, host: &str, login: &str) -> Result<bool, SecretStoreError> {
        match fs::remove_file(self.path(host, login)) {
            Ok(()) => Ok(true),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(false),
            Err(error) => Err(error.into()),
        }
    }

    fn ensure_directory(&self) -> Result<(), SecretStoreError> {
        fs::create_dir_all(&self.directory)?;
        fs::set_permissions(&self.directory, fs::Permissions::from_mode(DIRECTORY_MODE))?;
        Ok(())
    }

    fn path(&self, host: &str, login: &str) -> PathBuf {
        self.directory
            .join(format!("{}.token", file_stem(host, login)))
    }
}

/// A filesystem-safe, collision-free name for an account: hex of
/// `host NUL login` with logins compared case-insensitively, as GitHub does.
fn file_stem(host: &str, login: &str) -> String {
    let key = format!(
        "{}\0{}",
        host.to_ascii_lowercase(),
        login.to_ascii_lowercase()
    );
    key.bytes()
        .fold(String::with_capacity(key.len() * 2), |mut out, byte| {
            use std::fmt::Write as _;
            let _ = write!(out, "{byte:02x}");
            out
        })
}

#[cfg(test)]
#[allow(clippy::expect_used)]
mod tests {
    use super::*;

    #[test]
    fn saves_private_files_atomically_and_forgets_them() {
        let state = tempfile::tempdir().expect("state");
        let store = SecretStore::new(state.path());
        let token = Secret::new("ghp_sentinel".into());
        store.save("github.com", "Octo", &token).expect("save");
        let directory_mode = fs::metadata(store.directory())
            .expect("dir")
            .permissions()
            .mode()
            & 0o777;
        assert_eq!(directory_mode, DIRECTORY_MODE);
        let entries: Vec<_> = fs::read_dir(store.directory())
            .expect("list")
            .map(|entry| entry.expect("entry").path())
            .collect();
        assert_eq!(entries.len(), 1, "no temporary file remains");
        let file_mode = fs::metadata(&entries[0])
            .expect("file")
            .permissions()
            .mode()
            & 0o777;
        assert_eq!(file_mode, FILE_MODE);
        assert_eq!(store.load("github.com", "octo").expect("load"), Some(token));
        assert!(store.forget("github.com", "octo").expect("forget"));
        assert_eq!(store.load("github.com", "octo").expect("load"), None);
        assert!(!store.forget("github.com", "octo").expect("idempotent"));
    }
}
