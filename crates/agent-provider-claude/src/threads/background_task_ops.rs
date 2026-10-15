//! What a background task output read (`thread.backgroundTask.read`) needs
//! from the thread service: the session files of the thread's own chain,
//! newest first, and what its live session knows of the task. Reading the
//! output itself is `crate::background_tasks`.

use agent_core::{model::AppThreadId, provider::ProviderError};

use super::{
    errors::{internal, not_found, session_gone},
    service::{Listed, ThreadService},
};
use crate::{
    background_tasks::{BackgroundTaskId, LiveTaskState},
    native::files::{self, SessionFile},
};

/// The thread's side of a background task.
pub struct BackgroundTaskThread {
    /// The session files of the thread's chain that Claude's store still
    /// has, newest first.
    pub sessions: Vec<SessionFile>,
    /// What the thread's open query knows of the task.
    pub live: Option<LiveTaskState>,
}

impl ThreadService {
    /// The sessions and live knowledge a read of `task`'s output needs.
    ///
    /// # Errors
    /// `-32600` for an unknown or deleted thread.
    pub async fn background_task_thread(
        &self,
        app_thread_id: &AppThreadId,
        task: &BackgroundTaskId,
    ) -> Result<BackgroundTaskThread, ProviderError> {
        let inner = &self.inner;
        let id = app_thread_id.as_str();
        let listed = inner
            .resolve(id)
            .await?
            .listed()
            .ok_or_else(|| not_found(id))?;
        let (mut session_ids, live) = match listed {
            Listed::Entry(handle) => {
                let live = handle
                    .background_task(task.as_str().to_owned())
                    .await
                    .map_err(|err| session_gone(&err))?;
                let state = handle.state();
                let ids = state
                    .session_ids
                    .iter()
                    .map(ToOwned::to_owned)
                    .collect::<Vec<_>>();
                (ids, live)
            }
            Listed::Discovered(session) => (vec![session.session_id], None),
        };
        session_ids.reverse();
        let root = inner.projects_root.clone();
        let sessions = tokio::task::spawn_blocking(move || {
            session_ids
                .iter()
                .filter_map(|session_id| files::find_session(&root, session_id))
                .collect()
        })
        .await
        .map_err(|err| internal("background task", &err))?;
        Ok(BackgroundTaskThread { sessions, live })
    }
}
