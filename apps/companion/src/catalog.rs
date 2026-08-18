use std::{
    collections::HashMap,
    path::{Path, PathBuf},
    sync::RwLock,
    time::SystemTime,
};

use walkdir::WalkDir;

#[derive(Debug, thiserror::Error)]
pub enum CatalogError {
    #[error("session catalog lock is poisoned")]
    Poisoned,
    #[error("thread rollout was not found: {0}")]
    NotFound(String),
}

pub struct SessionCatalog {
    roots: Vec<PathBuf>,
    paths: RwLock<HashMap<String, PathBuf>>,
}

impl SessionCatalog {
    /// Scans rollout filenames without reading their potentially huge content.
    #[must_use]
    pub fn scan(codex_home: &Path) -> Self {
        let roots = vec![
            codex_home.join("sessions"),
            codex_home.join("archived_sessions"),
        ];
        let paths = scan_roots(&roots);
        Self {
            roots,
            paths: RwLock::new(paths),
        }
    }

    /// Resolves a thread to the newest matching canonical rollout.
    ///
    /// # Errors
    ///
    /// Returns an error when the catalog lock is unavailable or the thread is
    /// absent after one targeted refresh.
    pub fn resolve(&self, thread_id: &str) -> Result<PathBuf, CatalogError> {
        if !valid_thread_id(thread_id) {
            return Err(CatalogError::NotFound(thread_id.to_owned()));
        }
        if let Some(path) = self
            .paths
            .read()
            .map_err(|_| CatalogError::Poisoned)?
            .get(thread_id)
            .cloned()
        {
            return Ok(path);
        }
        let candidate = newest_matching_rollout(&self.roots, thread_id)
            .ok_or_else(|| CatalogError::NotFound(thread_id.to_owned()))?;
        self.paths
            .write()
            .map_err(|_| CatalogError::Poisoned)?
            .insert(thread_id.to_owned(), candidate.clone());
        Ok(candidate)
    }

    #[must_use]
    pub fn len(&self) -> usize {
        self.paths.read().map_or(0, |paths| paths.len())
    }

    #[must_use]
    pub fn is_empty(&self) -> bool {
        self.len() == 0
    }

    #[must_use]
    pub(crate) fn rollout_roots(&self) -> Vec<PathBuf> {
        self.roots.clone()
    }

    pub(crate) fn observe_rollout(
        &self,
        thread_id: &str,
        path: PathBuf,
    ) -> Result<(), CatalogError> {
        if !valid_thread_id(thread_id) {
            return Err(CatalogError::NotFound(thread_id.to_owned()));
        }
        self.paths
            .write()
            .map_err(|_| CatalogError::Poisoned)?
            .insert(thread_id.to_owned(), path);
        Ok(())
    }
}

fn scan_roots(roots: &[PathBuf]) -> HashMap<String, PathBuf> {
    let mut entries: HashMap<String, (SystemTime, PathBuf)> = HashMap::new();
    for root in roots {
        for entry in WalkDir::new(root)
            .follow_links(false)
            .into_iter()
            .filter_map(Result::ok)
            .filter(|entry| entry.file_type().is_file())
        {
            let Some(thread_id) = thread_id_from_path(entry.path()) else {
                continue;
            };
            let modified = entry
                .metadata()
                .ok()
                .and_then(|metadata| metadata.modified().ok())
                .unwrap_or(SystemTime::UNIX_EPOCH);
            let replace = entries
                .get(&thread_id)
                .is_none_or(|(previous, _)| modified > *previous);
            if replace {
                entries.insert(thread_id, (modified, entry.path().to_path_buf()));
            }
        }
    }
    entries
        .into_iter()
        .map(|(thread_id, (_modified, path))| (thread_id, path))
        .collect()
}

fn newest_matching_rollout(roots: &[PathBuf], thread_id: &str) -> Option<PathBuf> {
    let expected_suffix = format!("-{thread_id}.jsonl");
    roots
        .iter()
        .flat_map(|root| WalkDir::new(root).follow_links(false).into_iter())
        .filter_map(Result::ok)
        .filter(|entry| entry.file_type().is_file())
        .filter(|entry| {
            entry
                .file_name()
                .to_string_lossy()
                .ends_with(&expected_suffix)
        })
        .filter_map(|entry| {
            let modified = entry.metadata().ok()?.modified().ok()?;
            Some((modified, entry.path().to_path_buf()))
        })
        .max_by_key(|(modified, _path)| *modified)
        .map(|(_modified, path)| path)
}

pub(crate) fn thread_id_from_path(path: &Path) -> Option<String> {
    let name = path.file_name()?.to_str()?;
    let stem = name.strip_suffix(".jsonl")?;
    let thread_id = stem.rsplit('-').take(5).collect::<Vec<_>>();
    if thread_id.len() != 5 {
        return None;
    }
    let thread_id = thread_id.into_iter().rev().collect::<Vec<_>>().join("-");
    valid_thread_id(&thread_id).then_some(thread_id)
}

fn valid_thread_id(value: &str) -> bool {
    value.len() == 36
        && value.bytes().enumerate().all(|(index, byte)| match index {
            8 | 13 | 18 | 23 => byte == b'-',
            _ => byte.is_ascii_hexdigit(),
        })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extracts_thread_id_from_rollout_name() {
        let path =
            Path::new("rollout-2026-08-09T21-01-31-019fe7af-e2fa-70f3-88e8-99d59e10bd63.jsonl");
        assert_eq!(
            thread_id_from_path(path).as_deref(),
            Some("019fe7af-e2fa-70f3-88e8-99d59e10bd63")
        );
    }
}
