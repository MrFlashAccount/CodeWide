use std::{
    collections::HashMap,
    os::unix::fs::MetadataExt,
    path::{Path, PathBuf},
    sync::Arc,
};

use sha2::{Digest, Sha256};
use tokio::{
    fs::File,
    io::AsyncReadExt,
    sync::{Mutex, Semaphore},
};

const MAX_HASH_ENTRIES: usize = 4_096;
const MAX_CONCURRENT_HASHES: usize = 2;

#[derive(Clone)]
pub(crate) struct FileRevisionCache {
    state: Arc<Mutex<RevisionState>>,
    hashing: Arc<Semaphore>,
}

#[derive(Default)]
struct RevisionState {
    entries: HashMap<PathBuf, HashEntry>,
    clock: u64,
}

struct HashEntry {
    fingerprint: FileFingerprint,
    last_access: u64,
    sha256: String,
}

#[derive(Clone, Copy, Eq, PartialEq)]
struct FileFingerprint {
    changed_nanoseconds: i64,
    changed_seconds: i64,
    device: u64,
    inode: u64,
    length: u64,
    modified_nanoseconds: i64,
    modified_seconds: i64,
}

impl Default for FileRevisionCache {
    fn default() -> Self {
        Self::new()
    }
}

impl FileRevisionCache {
    pub(crate) fn new() -> Self {
        Self {
            state: Arc::new(Mutex::new(RevisionState::default())),
            hashing: Arc::new(Semaphore::new(MAX_CONCURRENT_HASHES)),
        }
    }

    pub(crate) async fn sha256(&self, path: &Path) -> Result<String, std::io::Error> {
        let initial = tokio::fs::metadata(path).await?;
        let initial_fingerprint = FileFingerprint::from(&initial);
        if let Some(hash) = self.cached(path, initial_fingerprint).await {
            return Ok(hash);
        }
        let _permit = self
            .hashing
            .acquire()
            .await
            .map_err(|_| std::io::Error::other("file hash service closed"))?;
        for _ in 0..2 {
            let before = tokio::fs::metadata(path).await?;
            let fingerprint = FileFingerprint::from(&before);
            if let Some(hash) = self.cached(path, fingerprint).await {
                return Ok(hash);
            }
            let hash = sha256_file(path).await?;
            let after = tokio::fs::metadata(path).await?;
            if FileFingerprint::from(&after) == fingerprint {
                self.remember(path.to_path_buf(), fingerprint, hash.clone())
                    .await;
                return Ok(hash);
            }
        }
        Err(std::io::Error::new(
            std::io::ErrorKind::Interrupted,
            "file changed while hashing",
        ))
    }

    pub(crate) fn source_revision(path: &Path, metadata: &std::fs::Metadata) -> String {
        let fingerprint = FileFingerprint::from(metadata);
        let mut value = blake3::Hasher::new();
        value.update(path.as_os_str().as_encoded_bytes());
        value.update(&fingerprint.device.to_le_bytes());
        value.update(&fingerprint.inode.to_le_bytes());
        value.update(&fingerprint.length.to_le_bytes());
        value.update(&fingerprint.modified_seconds.to_le_bytes());
        value.update(&fingerprint.modified_nanoseconds.to_le_bytes());
        value.update(&fingerprint.changed_seconds.to_le_bytes());
        value.update(&fingerprint.changed_nanoseconds.to_le_bytes());
        value.finalize().to_hex().to_string()
    }

    async fn cached(&self, path: &Path, fingerprint: FileFingerprint) -> Option<String> {
        let mut state = self.state.lock().await;
        state.clock = state.clock.saturating_add(1);
        let clock = state.clock;
        let entry = state.entries.get_mut(path)?;
        if entry.fingerprint != fingerprint {
            state.entries.remove(path);
            return None;
        }
        entry.last_access = clock;
        Some(entry.sha256.clone())
    }

    async fn remember(&self, path: PathBuf, fingerprint: FileFingerprint, sha256: String) {
        let mut state = self.state.lock().await;
        state.clock = state.clock.saturating_add(1);
        let clock = state.clock;
        state.entries.insert(
            path,
            HashEntry {
                fingerprint,
                last_access: clock,
                sha256,
            },
        );
        if state.entries.len() <= MAX_HASH_ENTRIES {
            return;
        }
        if let Some(oldest) = state
            .entries
            .iter()
            .min_by_key(|(_, entry)| entry.last_access)
            .map(|(path, _)| path.clone())
        {
            state.entries.remove(&oldest);
        }
    }
}

impl From<&std::fs::Metadata> for FileFingerprint {
    fn from(metadata: &std::fs::Metadata) -> Self {
        Self {
            changed_nanoseconds: metadata.ctime_nsec(),
            changed_seconds: metadata.ctime(),
            device: metadata.dev(),
            inode: metadata.ino(),
            length: metadata.len(),
            modified_nanoseconds: metadata.mtime_nsec(),
            modified_seconds: metadata.mtime(),
        }
    }
}

pub(crate) async fn sha256_file(path: &Path) -> Result<String, std::io::Error> {
    let mut file = File::open(path).await?;
    let mut hash = Sha256::new();
    let mut buffer = vec![0_u8; 128 * 1024];
    loop {
        let read = file.read(&mut buffer).await?;
        if read == 0 {
            break;
        }
        hash.update(&buffer[..read]);
    }
    Ok(hex::encode(hash.finalize()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn invalidates_hash_when_file_identity_changes() -> Result<(), Box<dyn std::error::Error>>
    {
        let directory = tempfile::tempdir()?;
        let path = directory.path().join("change.txt");
        tokio::fs::write(&path, b"first").await?;
        let cache = FileRevisionCache::new();
        let first = cache.sha256(&path).await?;
        assert_eq!(first, cache.sha256(&path).await?);
        tokio::fs::write(&path, b"second-value").await?;
        let second = cache.sha256(&path).await?;
        assert_ne!(first, second);
        Ok(())
    }
}
