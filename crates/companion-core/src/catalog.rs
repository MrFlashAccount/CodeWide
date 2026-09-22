use std::{
    collections::HashMap,
    path::{Path, PathBuf},
    sync::RwLock,
    time::SystemTime,
};

use rusqlite::{Connection, OpenFlags, OptionalExtension};
use walkdir::WalkDir;

#[derive(Debug, thiserror::Error)]
pub enum CatalogError {
    #[error("session catalog lock is poisoned")]
    Poisoned,
    #[error("thread rollout was not found: {0}")]
    NotFound(String),
    #[error("could not read Codex rollout authority: {0}")]
    Authority(#[from] rusqlite::Error),
}

pub struct SessionCatalog {
    roots: Vec<PathBuf>,
    paths: RwLock<HashMap<String, PathBuf>>,
    state_db: PathBuf,
    pub(crate) visibility: crate::catalog_visibility::CatalogVisibility,
}

pub(crate) struct SearchCatalogEntry {
    pub thread_id: String,
    pub path: PathBuf,
    pub title: String,
    pub cwd: String,
    pub timestamp: String,
}

impl SessionCatalog {
    /// Search follows the sidebar's interactive sources, including archives.
    pub(crate) fn search_entries(&self) -> Result<Vec<SearchCatalogEntry>, CatalogError> {
        if !self.state_db.is_file() {
            self.refresh()?;
            return Ok(self
                .rollout_paths()
                .into_iter()
                .filter_map(|path| {
                    thread_id_from_path(&path).map(|thread_id| SearchCatalogEntry {
                        thread_id,
                        path,
                        title: String::new(),
                        cwd: String::new(),
                        timestamp: String::new(),
                    })
                })
                .collect());
        }
        let db = Connection::open_with_flags(&self.state_db, OpenFlags::SQLITE_OPEN_READ_ONLY)?;
        db.busy_timeout(std::time::Duration::ZERO)?;
        let mut query = db.prepare(&format!("SELECT id, rollout_path, title, cwd, strftime('%Y-%m-%dT%H:%M:%fZ', updated_at, 'unixepoch') FROM threads WHERE source IN ('cli', 'vscode') AND {}", crate::catalog_visibility::ORDINARY_SOURCE_SQL))?;
        Ok(query
            .query_map([], |row| {
                Ok(SearchCatalogEntry {
                    thread_id: row.get(0)?,
                    path: PathBuf::from(row.get::<_, String>(1)?),
                    title: row.get(2)?,
                    cwd: row.get(3)?,
                    timestamp: row.get(4)?,
                })
            })?
            .collect::<Result<Vec<_>, _>>()?)
    }
    /// Creates an immediately usable catalog without walking rollout roots.
    /// Missing threads are still resolved by the targeted fallback in
    /// [`Self::resolve`], while [`Self::refresh`] can warm the full catalog in
    /// the background.
    #[must_use]
    pub fn empty(codex_home: &Path) -> Self {
        Self {
            roots: vec![
                codex_home.join("sessions"),
                codex_home.join("archived_sessions"),
            ],
            paths: RwLock::new(HashMap::new()),
            state_db: codex_home.join("state_5.sqlite"),
            visibility: crate::catalog_visibility::CatalogVisibility::new(
                codex_home.join("state_5.sqlite"),
            ),
        }
    }

    /// Scans rollout filenames without reading their potentially huge content.
    #[must_use]
    pub fn scan(codex_home: &Path) -> Self {
        let catalog = Self::empty(codex_home);
        let discovered = scan_roots(&catalog.roots);
        *catalog
            .paths
            .write()
            .unwrap_or_else(std::sync::PoisonError::into_inner) = discovered;
        catalog
    }

    /// Warms or repairs the catalog without discarding paths observed while
    /// the filesystem scan was in progress.
    ///
    /// # Errors
    ///
    /// Returns an error when the catalog lock is unavailable.
    pub fn refresh(&self) -> Result<usize, CatalogError> {
        let discovered = scan_roots(&self.roots);
        let mut paths = self.paths.write().map_err(|_| CatalogError::Poisoned)?;
        for (thread_id, candidate) in discovered {
            let replace = paths
                .get(&thread_id)
                .is_none_or(|current| modified_at(&candidate) > modified_at(current));
            if replace {
                paths.insert(thread_id, candidate);
            }
        }
        Ok(paths.len())
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
        // Codex may replace a rollout while its old file still exists (for
        // example, another writer takes over). File mtimes cannot identify
        // that authority: consult the indexed thread row before cached paths.
        if let Some(path) = self.authoritative_path(thread_id)? {
            if !path.is_file() {
                return Err(CatalogError::NotFound(thread_id.to_owned()));
            }
            return Ok(path);
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

    fn authoritative_path(&self, thread_id: &str) -> Result<Option<PathBuf>, CatalogError> {
        if !self.state_db.is_file() {
            return Ok(None);
        }
        let db = Connection::open_with_flags(&self.state_db, OpenFlags::SQLITE_OPEN_READ_ONLY)?;
        // Do not block history reads for SQLite's default five-second busy
        // timeout. An unavailable authority is a retryable error, not license
        // to publish history from a known potentially obsolete file.
        db.busy_timeout(std::time::Duration::ZERO)?;
        let path: Option<String> = db
            .query_row(
                "SELECT rollout_path FROM threads WHERE id = ?1",
                [thread_id],
                |row| row.get(0),
            )
            .optional()?;
        Ok(path.map(PathBuf::from))
    }

    pub(crate) fn summary(&self) -> Result<crate::catalog_summary::CatalogSummary, CatalogError> {
        Ok(crate::catalog_summary::read(&self.state_db)?)
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

    #[must_use]
    pub fn rollout_paths(&self) -> Vec<PathBuf> {
        self.paths.read().map_or_else(
            |poisoned| poisoned.into_inner().values().cloned().collect(),
            |paths| paths.values().cloned().collect(),
        )
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

fn modified_at(path: &Path) -> SystemTime {
    path.metadata()
        .ok()
        .and_then(|metadata| metadata.modified().ok())
        .unwrap_or(SystemTime::UNIX_EPOCH)
}

fn newest_matching_rollout(roots: &[PathBuf], thread_id: &str) -> Option<PathBuf> {
    roots
        .iter()
        .flat_map(|root| WalkDir::new(root).follow_links(false).into_iter())
        .filter_map(Result::ok)
        .filter(|entry| entry.file_type().is_file())
        .filter(|entry| thread_id_from_path(entry.path()).as_deref() == Some(thread_id))
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
    // The optional suffix identifies a writer, not the owning session.
    let stem = stem
        .split_once('_')
        .map_or(stem, |(session, _writer)| session);
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
    use std::fs;

    #[test]
    fn follows_authority_changes_even_when_an_old_rollout_is_cached_and_modified()
    -> Result<(), Box<dyn std::error::Error>> {
        let root = tempfile::tempdir()?;
        let sessions = root.path().join("sessions");
        fs::create_dir_all(&sessions)?;
        let thread = "01a06e07-16b7-71b0-b87c-6f6c6bc7cb1f";
        let old = sessions.join(format!("rollout-2026-09-04T23-05-53-{thread}.jsonl"));
        let current = sessions.join(format!("rollout-2026-09-04T23-07-25-{thread}_writer.jsonl"));
        fs::write(&old, b"old")?;
        let catalog = SessionCatalog::scan(root.path());
        assert_eq!(catalog.resolve(thread)?, old);
        let db = Connection::open(root.path().join("state_5.sqlite"))?;
        db.execute(
            "CREATE TABLE threads (id TEXT PRIMARY KEY, rollout_path TEXT NOT NULL)",
            [],
        )?;
        db.execute(
            "INSERT INTO threads VALUES (?1, ?2)",
            [thread, old.to_str().ok_or("path")?],
        )?;
        assert_eq!(catalog.resolve(thread)?, old);
        fs::write(&current, b"fresh")?;
        db.execute(
            "UPDATE threads SET rollout_path = ?2 WHERE id = ?1",
            [thread, current.to_str().ok_or("path")?],
        )?;
        catalog.observe_rollout(thread, old.clone())?;
        fs::write(&old, b"late old writer")?;
        assert_eq!(catalog.resolve(thread)?, current);
        fs::remove_file(&current)?;
        assert!(
            catalog.resolve(thread).is_err(),
            "must not substitute stale history when the authoritative file is unavailable"
        );
        Ok(())
    }

    #[test]
    fn resolves_suffixed_rollout_for_the_session_not_the_writer()
    -> Result<(), Box<dyn std::error::Error>> {
        let root = tempfile::tempdir()?;
        let sessions = root.path().join("sessions");
        fs::create_dir_all(&sessions)?;
        let thread = "01a06e07-16b7-71b0-b87c-6f6c6bc7cb1f";
        let writer = "01a06e08-7da9-7a12-adb1-93a380c70d6c";
        let path = sessions.join(format!(
            "rollout-2026-09-04T23-07-25-{thread}_{writer}.jsonl"
        ));
        fs::write(&path, b"")?;
        assert_eq!(thread_id_from_path(&path).as_deref(), Some(thread));
        assert_eq!(SessionCatalog::empty(root.path()).resolve(thread)?, path);
        assert!(SessionCatalog::scan(root.path()).resolve(writer).is_err());
        Ok(())
    }

    #[test]
    fn extracts_thread_id_from_rollout_name() {
        let path =
            Path::new("rollout-2026-08-09T21-01-31-019fe7af-e2fa-70f3-88e8-99d59e10bd63.jsonl");
        assert_eq!(
            thread_id_from_path(path).as_deref(),
            Some("019fe7af-e2fa-70f3-88e8-99d59e10bd63")
        );
    }

    #[test]
    fn empty_catalog_resolves_targeted_threads_and_accepts_background_refresh()
    -> Result<(), Box<dyn std::error::Error>> {
        let root = tempfile::tempdir()?;
        let sessions = root.path().join("sessions/2026/08/26");
        fs::create_dir_all(&sessions)?;
        let thread_id = "019fe7af-e2fa-70f3-88e8-99d59e10bd63";
        let rollout = sessions.join(format!("rollout-2026-08-26T10-00-00-{thread_id}.jsonl"));
        fs::write(&rollout, b"")?;

        let catalog = SessionCatalog::empty(root.path());
        assert!(catalog.is_empty());
        assert_eq!(catalog.resolve(thread_id)?, rollout);
        assert_eq!(catalog.refresh()?, 1);
        assert_eq!(catalog.len(), 1);
        Ok(())
    }
}
