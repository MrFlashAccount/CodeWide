//! Claude's sessions read by the companion itself: the native index's
//! source, in place of the Claude host's `nativeSession.list`.
//!
//! A listing reads only the head and tail of each session file
//! (`meta.rs`); the turns of a session are indexed from its files' appended
//! tails by `crate::index`. What Claude's files cannot tell (which
//! `CodeWide` thread a session belongs to, its list metadata, its turn index
//! and a running turn's snapshot) comes from the host's own files
//! (`host_state.rs`).
//!
//! Writes to Claude's store (`write.rs`: rename, removal, fork) follow the
//! Agent SDK's session mutations on local files; `fork_cut.rs` decides which
//! sessions of a thread's chain a fork copies, and through which message.

pub mod files;
mod fork_branch;
mod fork_copy;
pub mod fork_cut;
pub mod host_state;
pub mod meta;
pub mod write;

use std::{collections::HashSet, path::PathBuf, sync::Arc};

use agent_core::{
    model::{
        AgentTurn, AppThreadId, NativeSession, NativeSessionListParams, NativeSessionListResult,
        RpcError,
    },
    provider::ProviderError,
};
#[cfg(test)]
use async_trait::async_trait;

#[cfg(test)]
use crate::runtime::running_sessions::RunningProcess;
use crate::{
    runtime::open_elsewhere::{OpenElsewhere, SessionActivity},
    transcript::turn_index::TurnRecord,
};

pub use self::{
    fork_cut::{ForkCut, SessionCut},
    write::{ForkError, Removal, RenameError, SessionLocation},
};

use self::{
    files::SessionFile,
    host_state::{HostThread, HostThreads},
    meta::SessionMeta,
};

const MAX_PAGE: usize = 500;
const CURSOR_PREFIX: &str = "v1:";

/// Claude's local session store and the host's thread metadata.
#[derive(Clone)]
pub struct LocalSessions {
    inner: Arc<Paths>,
}

struct Paths {
    projects_root: PathBuf,
    journal_directory: PathBuf,
    activity: Arc<OpenElsewhere>,
}

impl LocalSessions {
    #[must_use]
    pub fn new(
        projects_root: PathBuf,
        journal_directory: PathBuf,
        activity: Arc<OpenElsewhere>,
    ) -> Self {
        Self {
            inner: Arc::new(Paths {
                projects_root,
                journal_directory,
                activity,
            }),
        }
    }

    #[cfg(test)]
    pub(crate) fn for_test(
        projects_root: PathBuf,
        journal_directory: PathBuf,
        running_sessions: HashSet<String>,
    ) -> Self {
        let running_sessions = running_sessions
            .into_iter()
            .map(|session_id| (session_id, RunningProcess::StartUnknown))
            .collect();
        Self::for_test_processes(projects_root, journal_directory, running_sessions)
    }

    #[cfg(test)]
    pub(crate) fn for_test_processes(
        projects_root: PathBuf,
        journal_directory: PathBuf,
        running_sessions: crate::runtime::running_sessions::RunningSessionMap,
    ) -> Self {
        use crate::runtime::open_elsewhere::OpenElsewhereDeps;

        let sessions = Arc::new(TestRunningSessions { running_sessions });
        let activity = Arc::new(OpenElsewhere::new(OpenElsewhereDeps {
            running: sessions,
            owns_live: Arc::new(|_| false),
            changed: Arc::new(|_| {}),
            activity_changed: Arc::new(|_| {}),
            poll: std::time::Duration::from_mins(1),
        }));
        Self::new(projects_root, journal_directory, activity)
    }
}

#[cfg(test)]
struct TestRunningSessions {
    running_sessions: crate::runtime::running_sessions::RunningSessionMap,
}

#[cfg(test)]
#[async_trait]
impl crate::runtime::running_sessions::RunningSessions for TestRunningSessions {
    async fn list(
        &self,
    ) -> Result<
        crate::runtime::running_sessions::RunningSessionMap,
        crate::runtime::running_sessions::RunningSessionsError,
    > {
        Ok(self.running_sessions.clone())
    }
}

fn worker_error(error: &tokio::task::JoinError) -> ProviderError {
    ProviderError::Protocol(format!("Claude session read failed: {error}"))
}

impl LocalSessions {
    /// Every session of the store, a listing page at a time.
    ///
    /// # Errors
    ///
    /// Returns an invalid cursor or a failed blocking read.
    pub async fn list(
        &self,
        params: NativeSessionListParams,
    ) -> Result<NativeSessionListResult, ProviderError> {
        let paths = self.inner.clone();
        tokio::task::spawn_blocking(move || list(&paths, &params))
            .await
            .map_err(|error| worker_error(&error))?
    }

    /// Whether a Claude process holds the session now; `None` while the
    /// running-session authority cannot be read.
    pub async fn activity(&self, session_id: &str) -> Option<SessionActivity> {
        self.inner.activity.activity(session_id).await
    }

    /// Claude's projects root.
    #[must_use]
    pub fn projects_root(&self) -> &std::path::Path {
        &self.inner.projects_root
    }

    /// The thread state directory of `CodeWide`'s threads.
    #[must_use]
    pub fn journal_directory(&self) -> &std::path::Path {
        &self.inner.journal_directory
    }

    /// The session file of `session_id` and its listing row; `None` when
    /// the store has no such session.
    #[must_use]
    pub fn listed_session(
        &self,
        session_id: &str,
        threads: &HostThreads,
    ) -> Option<(SessionFile, NativeSession)> {
        let file = files::find_session(&self.inner.projects_root, session_id)?;
        let (head, tail) = files::head_and_tail(&file.path).ok()?;
        let meta = meta::session_meta(&head, &tail)?;
        let session = native_session(&file, meta, threads.owner_of(session_id))?;
        Some((file, session))
    }
}

/// A listed session: its file and its listing facts.
struct Listed {
    file: SessionFile,
    meta: SessionMeta,
}

fn listed(file: SessionFile) -> Option<Listed> {
    let (head, tail) = files::head_and_tail(&file.path).ok()?;
    let meta = meta::session_meta(&head, &tail)?;
    Some(Listed { file, meta })
}

fn list(
    paths: &Paths,
    params: &NativeSessionListParams,
) -> Result<NativeSessionListResult, ProviderError> {
    let offset = match params.cursor.as_deref() {
        None => 0,
        Some(cursor) => cursor
            .strip_prefix(CURSOR_PREFIX)
            .and_then(|offset| offset.parse::<usize>().ok())
            .ok_or_else(|| {
                ProviderError::Rejected(RpcError::new(
                    agent_core::model::ERROR_INVALID_PARAMS,
                    "invalid native session cursor",
                ))
            })?,
    };
    let limit = usize::try_from(params.limit)
        .unwrap_or(MAX_PAGE)
        .clamp(1, MAX_PAGE);
    let mut sessions = files::sessions(&paths.projects_root)
        .into_iter()
        .filter_map(listed)
        .filter(|session| params.dir.is_none() || session.meta.cwd == params.dir)
        .collect::<Vec<_>>();
    let present = sessions
        .iter()
        .map(|session| session.file.session_id.clone())
        .collect::<HashSet<_>>();
    // A session another one continues is that session's history.
    sessions.retain(|session| {
        session
            .meta
            .continued_in
            .as_ref()
            .is_none_or(|next| !present.contains(next))
    });
    sessions.sort_by(|left, right| {
        right
            .file
            .modified_ms
            .cmp(&left.file.modified_ms)
            .then_with(|| left.file.session_id.cmp(&right.file.session_id))
    });
    let threads = HostThreads::read(&paths.journal_directory);
    let total = sessions.len();
    let page = sessions
        .into_iter()
        .skip(offset)
        .take(limit)
        .filter_map(|session| {
            native_session(
                &session.file,
                session.meta,
                threads.owner_of(&session.file.session_id),
            )
        })
        .collect();
    Ok(NativeSessionListResult {
        next_cursor: (offset + limit < total).then(|| format!("{CURSOR_PREFIX}{}", offset + limit)),
        sessions: page,
    })
}

pub(crate) fn native_session(
    file: &SessionFile,
    meta: SessionMeta,
    owner: Option<&HostThread>,
) -> Option<NativeSession> {
    let app_thread_id = match owner {
        Some(owner) => owner.app_thread_id.clone(),
        None => AppThreadId::parse(&file.session_id)?,
    };
    Some(NativeSession {
        app_thread_id,
        codewide: owner.map(|owner| owner.codewide.clone()),
        created_at_ms: meta.created_at_ms,
        cwd: meta.cwd,
        file_size: i64::try_from(file.size).ok(),
        first_prompt: meta.first_prompt,
        interactive: meta.interactive,
        last_modified_ms: file.modified_ms,
        session_id: file.session_id.clone(),
        summary: meta.summary,
        title: meta.title,
    })
}

/// Places the snapshot of the turn running in the session into the rebuilt
/// history: in place of the turn with its id, else after the history (a
/// provider turn not in the turn index replaces the last such turn).
pub(crate) fn with_active_turn(
    mut turns: Vec<AgentTurn>,
    active: Option<AgentTurn>,
    records: &[TurnRecord],
) -> Vec<AgentTurn> {
    let Some(active) = active else {
        return turns;
    };
    if let Some(index) = turns.iter().position(|turn| turn.turn_id == active.turn_id) {
        turns[index] = active;
        return turns;
    }
    let last_is_unindexed_wake = turns.last().is_some_and(|last| {
        active.origin == agent_core::model::TurnOrigin::Provider
            && last.origin == agent_core::model::TurnOrigin::Provider
            && !records
                .iter()
                .any(|record| record.turn_id == last.turn_id.as_str())
    });
    if last_is_unindexed_wake {
        turns.pop();
    }
    turns.push(active);
    turns
}

/// The projects root and journal of a test: one session and its sidecars.
#[cfg(test)]
pub(crate) fn fixture_paths(root: &std::path::Path) -> (PathBuf, PathBuf) {
    (root.join("projects"), root.join("journal"))
}

#[cfg(test)]
mod parity_tests;
#[cfg(test)]
mod subagent_model_tests;
#[cfg(test)]
mod tests;
#[cfg(test)]
mod write_tests;
