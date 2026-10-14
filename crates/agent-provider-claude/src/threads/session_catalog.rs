//! Claude's session listing as the thread service reads it
//! (`host/src/threads/sessionCatalog.ts`), plus the last metadata seen per
//! session (title, first prompt, times, directory), so live `thread.updated`
//! projections need no I/O. Every listing rescans Claude's store; the
//! companion's native index owns any longer-lived cache.
//!
//! A session's facts come from the head and tail of its file
//! ([`crate::native::meta`]), as Claude's own listing reads them.

use std::{
    collections::HashMap,
    path::{Path, PathBuf},
    sync::{Mutex, MutexGuard, PoisonError},
};

use agent_core::provider::ProviderError;

use super::errors::internal;
use crate::native::{
    files::{self, SessionFile},
    meta,
};

/// What the service knows about one session in Claude's store.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct CatalogSession {
    pub session_id: String,
    /// The working directory Claude recorded, when it did.
    pub cwd: Option<String>,
    /// Start time from the first entry, when known (ms since the epoch).
    pub created_at_ms: Option<i64>,
    /// The session file's modification time (ms since the epoch).
    pub last_modified_ms: i64,
    /// The first meaningful user prompt; `None` while the session has none.
    pub first_prompt: Option<String>,
    /// Custom title, else Claude's generated one.
    pub title: Option<String>,
    /// Started by a person (terminal, IDE), not programmatically.
    pub interactive: bool,
    /// The session that continues this one, when Claude recorded it.
    pub continued_in: Option<String>,
}

impl CatalogSession {
    /// When the session started: its first entry, else its file time.
    #[must_use]
    pub fn started_at_ms(&self) -> i64 {
        self.created_at_ms.unwrap_or(self.last_modified_ms)
    }
}

fn read_session(file: &SessionFile) -> Option<CatalogSession> {
    let (head, tail) = files::head_and_tail(&file.path).ok()?;
    let meta = meta::session_meta(&head, &tail)?;
    Some(CatalogSession {
        session_id: file.session_id.clone(),
        cwd: meta.cwd,
        created_at_ms: meta.created_at_ms,
        last_modified_ms: file.modified_ms,
        first_prompt: meta.first_prompt,
        title: meta.title,
        interactive: meta.interactive,
        continued_in: meta.continued_in,
    })
}

fn scan(projects_root: &Path) -> HashMap<String, CatalogSession> {
    files::sessions(projects_root)
        .iter()
        .filter_map(read_session)
        .map(|session| (session.session_id.clone(), session))
        .collect()
}

/// Claude's sessions with the last metadata seen per session.
pub struct SessionCatalog {
    projects_root: PathBuf,
    known: Mutex<HashMap<String, CatalogSession>>,
}

impl SessionCatalog {
    /// A catalog of the sessions under `projects_root`; nothing is known yet.
    #[must_use]
    pub fn new(projects_root: PathBuf) -> Self {
        Self {
            projects_root,
            known: Mutex::new(HashMap::new()),
        }
    }

    fn known(&self) -> MutexGuard<'_, HashMap<String, CatalogSession>> {
        self.known.lock().unwrap_or_else(PoisonError::into_inner)
    }

    /// Every session of every project, by id; remembered for projections.
    ///
    /// # Errors
    /// When the scan task fails.
    pub async fn snapshot(&self) -> Result<HashMap<String, CatalogSession>, ProviderError> {
        let root = self.projects_root.clone();
        let sessions = tokio::task::spawn_blocking(move || scan(&root))
            .await
            .map_err(|err| internal("session listing", &err))?;
        self.known().extend(
            sessions
                .iter()
                .map(|(session_id, session)| (session_id.clone(), session.clone())),
        );
        Ok(sessions)
    }

    /// The last known metadata of a session, without I/O.
    #[must_use]
    pub fn cached(&self, session_id: &str) -> Option<CatalogSession> {
        self.known().get(session_id).cloned()
    }

    /// Reads one session's metadata and remembers it; a session that is
    /// gone is forgotten.
    ///
    /// # Errors
    /// When the read task fails.
    pub async fn refresh(&self, session_id: &str) -> Result<Option<CatalogSession>, ProviderError> {
        let root = self.projects_root.clone();
        let id = session_id.to_owned();
        let session = tokio::task::spawn_blocking(move || {
            files::find_session(&root, &id).and_then(|file| read_session(&file))
        })
        .await
        .map_err(|err| internal("session read", &err))?;
        let mut known = self.known();
        match &session {
            Some(session) => {
                known.insert(session.session_id.clone(), session.clone());
            }
            None => {
                known.remove(session_id);
            }
        }
        Ok(session)
    }

    /// Records a title the service just set, so projections show it at once.
    pub fn remember_title(&self, session_id: &str, title: &str) {
        if let Some(session) = self.known().get_mut(session_id) {
            session.title = Some(title.to_owned());
        }
    }

    /// Forgets a deleted session.
    pub fn forget(&self, session_id: &str) {
        self.known().remove(session_id);
    }
}
