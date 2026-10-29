//! What a background task output read (`thread.backgroundTask.read`) needs
//! from the thread service: the session files of the thread's own chain,
//! newest first, and what its live session knows of the task. Reading the
//! output itself is `crate::background_tasks`. Also the state of the
//! background commands the live session launched, which a history read adds
//! (`transcript::background_commands`).

use std::{collections::HashMap, sync::PoisonError, time::Duration};

use agent_core::{
    model::{AgentTurn, AppThreadId, BackgroundCommandState},
    provider::ProviderError,
};

use super::{
    errors::{internal, not_found, session_gone},
    service::{Listed, ThreadService},
};
use crate::{
    background_tasks::{BackgroundTaskId, LiveTaskState},
    native::files::{self, SessionFile},
    runtime::{open_elsewhere::SessionActivity, running_sessions::RunningProcess},
    transcript::background_commands::{
        HoldingProcess, has_unended_background_command, overlay_holding_process,
        overlay_live_background_commands,
    },
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

    /// What the thread's live session knows: the state of every background
    /// command its open query launched, by task id, or `None` without an
    /// open query; with the session the thread runs in.
    ///
    /// # Errors
    /// `-32600` for an unknown or deleted thread.
    pub async fn live_session_knowledge(
        &self,
        app_thread_id: &AppThreadId,
    ) -> Result<(Option<HashMap<String, BackgroundCommandState>>, String), ProviderError> {
        let id = app_thread_id.as_str();
        match self.inner.resolve(id).await?.listed() {
            Some(Listed::Entry(handle)) => {
                let live = handle
                    .background_commands()
                    .await
                    .map_err(|err| session_gone(&err))?;
                Ok((live, handle.state().current_session_id().to_owned()))
            }
            Some(Listed::Discovered(session)) => Ok((None, session.session_id)),
            None => Err(not_found(id)),
        }
    }

    /// Gives every background command of `turns` the state
    /// `transcript::background_commands::command_state` answers from what the
    /// turns' history proves and what is live — the open query's own
    /// knowledge (the rule the live republication applies), else the
    /// process that holds the session. Every `thread.turns` answer passes
    /// through here, whether the index or this service read it; nothing live
    /// is asked when every launch has ended.
    ///
    /// # Errors
    /// `-32600` for an unknown or deleted thread.
    pub async fn overlay_live_background_commands(
        &self,
        app_thread_id: &AppThreadId,
        turns: &mut [AgentTurn],
    ) -> Result<(), ProviderError> {
        if !has_unended_background_command(turns) {
            return Ok(());
        }
        let (live, session_id) = self.live_session_knowledge(app_thread_id).await?;
        if let Some(live) = live {
            overlay_live_background_commands(turns, &live);
            return Ok(());
        }
        let process = self.holding_process(&session_id).await;
        let now_s = (self.inner.clock)().div_euclid(MS_PER_SECOND);
        let mut losses = self
            .inner
            .background_losses
            .lock()
            .unwrap_or_else(PoisonError::into_inner);
        overlay_holding_process(turns, process, &mut |background| {
            *losses
                .entry((
                    app_thread_id.as_str().to_owned(),
                    background.task_id.clone(),
                ))
                .or_insert(now_s)
        });
        Ok(())
    }

    /// The process that holds `session_id`, from the running-session
    /// authority. An unreadable authority is retried with a short backoff
    /// before the read gives up and proves nothing new.
    async fn holding_process(&self, session_id: &str) -> HoldingProcess {
        let mut attempt = self.inner.open_elsewhere.activity(session_id).await;
        for backoff in HOLDER_READ_BACKOFF {
            if let Some(activity) = attempt {
                return holding_process_of(activity);
            }
            tokio::time::sleep(backoff).await;
            attempt = self.inner.open_elsewhere.activity(session_id).await;
        }
        attempt.map_or(HoldingProcess::Unavailable, holding_process_of)
    }
}

const MS_PER_SECOND: i64 = 1000;

/// Waits between reads of an unavailable running-session authority.
const HOLDER_READ_BACKOFF: [Duration; 3] = [
    Duration::from_millis(100),
    Duration::from_millis(400),
    Duration::from_millis(1_600),
];

fn holding_process_of(activity: SessionActivity) -> HoldingProcess {
    match activity {
        SessionActivity::Stopped => HoldingProcess::Stopped,
        SessionActivity::Running(RunningProcess::StartedAt(started_at_ms)) => {
            HoldingProcess::Running {
                started_at_ms: Some(started_at_ms),
            }
        }
        SessionActivity::Running(RunningProcess::StartUnknown) => HoldingProcess::Running {
            started_at_ms: None,
        },
    }
}
