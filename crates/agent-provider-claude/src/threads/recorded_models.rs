//! The last answering model of sessions `CodeWide` never configured
//! (`host/src/threads/recordedModels.ts`) for the thread service: read from
//! Claude's store through [`RecordedModels`] and kept until the session file
//! changes; projections read the cache without I/O.

use std::{
    collections::HashMap,
    path::PathBuf,
    sync::{Mutex, PoisonError},
};

use tracing::warn;

use super::{history::session_values, session_catalog::CatalogSession};
use crate::runtime::recorded_model::RecordedModels;

/// The recorded models of discovered sessions.
pub struct RecordedModelCache {
    projects_root: PathBuf,
    /// Serializes reads, so one session file is read at most once per change.
    loader: tokio::sync::Mutex<RecordedModels>,
    /// The latest read per session, for synchronous projections.
    latest: Mutex<HashMap<String, String>>,
}

impl RecordedModelCache {
    #[must_use]
    pub fn new(projects_root: PathBuf) -> Self {
        Self {
            projects_root,
            loader: tokio::sync::Mutex::new(RecordedModels::default()),
            latest: Mutex::new(HashMap::new()),
        }
    }

    /// The recorded model of the last read; `None` before one or when the
    /// session recorded none.
    #[must_use]
    pub fn cached(&self, session_id: &str) -> Option<String> {
        self.latest
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .get(session_id)
            .cloned()
    }

    /// Reads the session's model unless the cached read saw the same file.
    /// A failed read is logged and keeps the previous answer.
    pub async fn load(&self, session: &CatalogSession) {
        let mut loader = self.loader.lock().await;
        let root = self.projects_root.clone();
        let session_id = session.session_id.clone();
        let read = || async move {
            tokio::task::spawn_blocking(move || session_values(&root, &session_id))
                .await
                .map_err(std::io::Error::other)?
        };
        let model = match loader
            .load(&session.session_id, session.last_modified_ms, read)
            .await
        {
            Ok(model) => model.map(ToOwned::to_owned),
            Err(err) => {
                warn!(session_id = %session.session_id, err = %err, "recorded model of a Claude session is unreadable");
                return;
            }
        };
        let mut latest = self.latest.lock().unwrap_or_else(PoisonError::into_inner);
        match model {
            Some(model) => latest.insert(session.session_id.clone(), model),
            None => latest.remove(&session.session_id),
        };
    }
}
