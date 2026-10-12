//! Durable storage primitives for the Linux host-update guardian.

use std::{
    fs::{self, File, OpenOptions},
    io::{self, Write},
    os::unix::fs::{OpenOptionsExt, PermissionsExt},
    path::{Path, PathBuf},
};

use fs2::FileExt;
use serde::{Serialize, de::DeserializeOwned};

pub(super) struct StoreLock {
    file: File,
}

impl Drop for StoreLock {
    fn drop(&mut self) {
        let _ = self.file.unlock();
    }
}

pub(super) fn lock(path: &Path) -> io::Result<StoreLock> {
    let parent = path
        .parent()
        .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidInput, "lock has no parent"))?;
    private_directory(parent)?;
    let file = OpenOptions::new()
        .read(true)
        .write(true)
        .create(true)
        .truncate(false)
        .mode(0o600)
        .open(path)?;
    file.lock_exclusive()?;
    Ok(StoreLock { file })
}

pub(super) fn read_json<T: DeserializeOwned>(path: &Path) -> io::Result<T> {
    serde_json::from_slice(&fs::read(path)?).map_err(io::Error::other)
}

pub(super) fn read_optional_json<T: DeserializeOwned>(path: &Path) -> io::Result<Option<T>> {
    match fs::read(path) {
        Ok(bytes) => serde_json::from_slice(&bytes)
            .map(Some)
            .map_err(io::Error::other),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(error),
    }
}

/// Replaces one JSON record and fsyncs both data and the containing directory.
pub(super) fn write_json<T: Serialize>(path: &Path, value: &T) -> io::Result<()> {
    let parent = path
        .parent()
        .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidInput, "record has no parent"))?;
    private_directory(parent)?;
    let temporary = temporary_path(path)?;
    let result = (|| {
        let mut file = OpenOptions::new()
            .write(true)
            .create_new(true)
            .mode(0o600)
            .open(&temporary)?;
        serde_json::to_writer(&mut file, value).map_err(io::Error::other)?;
        file.write_all(b"\n")?;
        file.sync_all()?;
        fs::rename(&temporary, path)?;
        fs::set_permissions(path, fs::Permissions::from_mode(0o600))?;
        sync_directory(parent)
    })();
    if result.is_err() {
        let _ = fs::remove_file(&temporary);
    }
    result
}

pub(super) fn private_directory(path: &Path) -> io::Result<()> {
    fs::create_dir_all(path)?;
    fs::set_permissions(path, fs::Permissions::from_mode(0o700))
}

pub(super) fn sync_directory(path: &Path) -> io::Result<()> {
    File::open(path)?.sync_all()
}

fn temporary_path(path: &Path) -> io::Result<PathBuf> {
    let name = path
        .file_name()
        .and_then(|value| value.to_str())
        .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidInput, "invalid record name"))?;
    let mut random = [0_u8; 16];
    rand::TryRngCore::try_fill_bytes(&mut rand::rngs::OsRng, &mut random)
        .map_err(io::Error::other)?;
    Ok(path.with_file_name(format!(".{name}.{}.tmp", hex::encode(random))))
}

#[cfg(test)]
#[allow(clippy::expect_used)]
mod tests {
    use super::*;

    #[test]
    fn guardian_lock_excludes_a_second_writer() {
        let directory = tempfile::tempdir().expect("temporary directory");
        let path = directory.path().join("guardian.lock");
        let _held = lock(&path).expect("first lock");
        let contender = OpenOptions::new()
            .read(true)
            .write(true)
            .open(path)
            .expect("second file handle");
        assert!(contender.try_lock_exclusive().is_err());
    }
}
