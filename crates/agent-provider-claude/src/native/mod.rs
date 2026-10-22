//! Claude's sessions read by the companion itself: the native index's
//! source, in place of the Claude host's `nativeSession.list` and
//! `nativeSession.read`.
//!
//! A listing reads only the head and tail of each session file
//! (`meta.rs`); a read parses one file, keeps its active branch
//! (`transcript::chain`) and rebuilds its turns and its sub-agents' turns
//! with the same reconstruction live turns use. What Claude's files cannot
//! tell (which `CodeWide` thread a session belongs to, its list metadata,
//! its turn index and a running turn's snapshot) comes from the host's own
//! files (`host_state.rs`). Ids depend only on that input, so reading
//! unchanged input twice yields equal results.
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
        AgentTurn, AppThreadId, ERROR_INVALID_REQUEST, NativeSession, NativeSessionListParams,
        NativeSessionListResult, NativeSessionReadResult, NativeSubagent, RpcError,
        native_session_not_found_message,
    },
    provider::ProviderError,
};
use async_trait::async_trait;
use serde_json::Value;
use time::{OffsetDateTime, format_description::well_known::Rfc3339};

use crate::{
    indexer::NativeSessions,
    runtime::{
        open_elsewhere::{OpenElsewhere, SessionActivity},
        recorded_model::last_recorded_model,
        running_sessions::RunningProcess,
    },
    transcript::{
        agents::SubagentRuns,
        chain::active_branch,
        json::{JsonRecord, str_of},
        reconstruct::{
            HistoryContext, reconstruct_subagent_turns, reconstruct_turns, record_transcript_runs,
            running_agents, settle_named_orphaned_subagent_items, settle_orphaned_subagent_items,
            settle_subagent_items,
        },
        turn_index::TurnRecord,
    },
};

pub use self::{
    fork_cut::{ChainSession, ForkCut, SessionCut, fork_cut},
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

fn not_found(session_id: &str) -> ProviderError {
    ProviderError::Rejected(RpcError::new(
        ERROR_INVALID_REQUEST,
        native_session_not_found_message(session_id),
    ))
}

fn io_error(error: &std::io::Error) -> ProviderError {
    ProviderError::Protocol(format!("Claude session file cannot be read: {error}"))
}

#[async_trait]
impl NativeSessions for LocalSessions {
    async fn list(
        &self,
        params: NativeSessionListParams,
    ) -> Result<NativeSessionListResult, ProviderError> {
        let paths = self.inner.clone();
        tokio::task::spawn_blocking(move || list(&paths, &params))
            .await
            .map_err(|error| worker_error(&error))?
    }

    async fn read(&self, session_id: &str) -> Result<NativeSessionReadResult, ProviderError> {
        let Some(activity) = self.inner.activity.activity(session_id).await else {
            return Err(ProviderError::Disconnected(
                "Claude running-session state is unavailable".into(),
            ));
        };
        let paths = self.inner.clone();
        let session_id = session_id.to_owned();
        tokio::task::spawn_blocking(move || read(&paths, &session_id, activity))
            .await
            .map_err(|error| worker_error(&error))?
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

fn native_session(
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

fn read(
    paths: &Paths,
    session_id: &str,
    activity: SessionActivity,
) -> Result<NativeSessionReadResult, ProviderError> {
    let file = files::find_session(&paths.projects_root, session_id)
        .ok_or_else(|| not_found(session_id))?;
    let (head, tail) = files::head_and_tail(&file.path).map_err(|error| io_error(&error))?;
    let meta = meta::session_meta(&head, &tail).ok_or_else(|| not_found(session_id))?;
    let rows = files::rows(&file.path).map_err(|error| io_error(&error))?;
    let threads = HostThreads::read(&paths.journal_directory);
    let owner = threads.owner_of(session_id);
    let context = HistoryContext {
        app_thread_id: match owner {
            Some(owner) => owner.app_thread_id.clone(),
            None => AppThreadId::parse(session_id).ok_or_else(|| not_found(session_id))?,
        },
        cwd: owner.map_or_else(
            || meta.cwd.clone().unwrap_or_default(),
            |owner| owner.cwd.clone(),
        ),
    };
    let records = owner.map_or(&[][..], |owner| owner.turns.as_slice());
    let branch = active_branch(&rows);
    let messages = branch.iter().map(AsRef::as_ref).collect::<Vec<_>>();
    let active = owner
        .filter(|owner| owner.is_current(session_id))
        .and_then(HostThread::active_turn);
    let turns = with_active_turn(
        reconstruct_turns(&messages, records, &context),
        active,
        records,
    );
    let transcripts = subagent_transcripts(&file);
    let runs = session_runs(&messages, &transcripts);
    let turns = settle_subagent_items(turns, &runs);
    let orphaned = orphaned_agents(&transcripts, activity);
    let turns = match activity {
        SessionActivity::Stopped => settle_orphaned_subagent_items(turns),
        SessionActivity::Running(_) => settle_named_orphaned_subagent_items(turns, &orphaned),
    };
    let subagents = native_subagents(&transcripts, &turns, &context, &runs, activity, &orphaned);
    let session = native_session(&file, meta, owner).ok_or_else(|| not_found(session_id))?;
    Ok(NativeSessionReadResult {
        session,
        subagents,
        turns,
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

/// The rows of a sub-agent transcript in file order: every row of its own
/// conversation level is a side-chain row.
fn transcript_rows(rows: &[Value]) -> Vec<&JsonRecord> {
    rows.iter()
        .filter_map(Value::as_object)
        .filter(|row| matches!(str_of(row, "type"), Some("user" | "assistant" | "system")))
        .filter(|row| str_of(row, "uuid").is_some())
        .collect()
}

/// One stored sub-agent transcript of a session.
struct SubagentTranscript {
    agent_id: String,
    rows: Vec<Value>,
    sidecar: files::SubagentSidecar,
}

fn recorded_at_ms(row: &Value) -> Option<i64> {
    let text = row.get("timestamp")?.as_str()?;
    let timestamp = OffsetDateTime::parse(text, &Rfc3339).ok()?;
    i64::try_from(timestamp.unix_timestamp_nanos().div_euclid(1_000_000)).ok()
}

fn transcript_updated_at_ms(transcript: &SubagentTranscript) -> Option<i64> {
    transcript.rows.iter().filter_map(recorded_at_ms).max()
}

/// Unfinished transcripts written only by an earlier process generation.
fn orphaned_agents(
    transcripts: &[SubagentTranscript],
    activity: SessionActivity,
) -> HashSet<String> {
    let SessionActivity::Running(RunningProcess::StartedAt(started_at_ms)) = activity else {
        return HashSet::new();
    };
    transcripts
        .iter()
        .filter(|transcript| {
            transcript_updated_at_ms(transcript).is_some_and(|updated| updated < started_at_ms)
        })
        .map(|transcript| transcript.agent_id.clone())
        .collect()
}

fn subagent_transcripts(session: &SessionFile) -> Vec<SubagentTranscript> {
    files::subagents(session)
        .into_iter()
        .filter_map(|subagent| {
            let rows = files::rows(&subagent.path).ok()?;
            let sidecar = files::subagent_sidecar(&subagent);
            Some(SubagentTranscript {
                agent_id: subagent.agent_id,
                rows,
                sidecar,
            })
        })
        .collect()
}

/// The sub-agent runs recorded anywhere in the session: a report reaches
/// whichever conversation was there to take it, not always the one that
/// spawned its agent, and any conversation may resume an agent.
fn session_runs(messages: &[&JsonRecord], transcripts: &[SubagentTranscript]) -> SubagentRuns {
    let mut runs = SubagentRuns::default();
    record_transcript_runs(&mut runs, messages);
    for transcript in transcripts {
        let rows = transcript
            .rows
            .iter()
            .filter_map(Value::as_object)
            .collect::<Vec<_>>();
        record_transcript_runs(&mut runs, &rows);
    }
    runs
}

/// Each sub-agent transcript as neutral turns with the model it last answered
/// with; a sub-agent its spawning item
/// (in the main conversation or another sub-agent) reports `running` keeps
/// its last turn in progress. A spawning item is running until a report
/// anywhere in the session settles it, and again while a resume of its agent
/// is unreported.
fn native_subagents(
    transcripts: &[SubagentTranscript],
    turns: &[AgentTurn],
    context: &HistoryContext,
    runs: &SubagentRuns,
    activity: SessionActivity,
    orphaned: &HashSet<String>,
) -> Vec<NativeSubagent> {
    let subagent_turns = |transcript: &SubagentTranscript, running: bool| {
        let turns = settle_subagent_items(
            reconstruct_subagent_turns(&transcript_rows(&transcript.rows), context, running),
            runs,
        );
        match activity {
            SessionActivity::Stopped => settle_orphaned_subagent_items(turns),
            SessionActivity::Running(_) => settle_named_orphaned_subagent_items(turns, orphaned),
        }
    };
    let settled = transcripts
        .iter()
        .map(|transcript| subagent_turns(transcript, false))
        .collect::<Vec<_>>();
    let mut running = running_agents(turns).into_iter().collect::<HashSet<_>>();
    for turns in &settled {
        running.extend(running_agents(turns));
    }
    transcripts
        .iter()
        .zip(settled)
        .map(|(transcript, settled)| NativeSubagent {
            agent_id: transcript.agent_id.clone(),
            // Stored sidecar rows name no `parent_tool_use_id`, so every
            // assistant row of the transcript is the sub-agent's own answer.
            model: last_recorded_model(&transcript.rows).map(ToOwned::to_owned),
            parent_agent_id: transcript.sidecar.parent_agent_id.clone(),
            parent_tool_use_id: transcript.sidecar.tool_use_id.clone(),
            turns: if matches!(activity, SessionActivity::Running(_))
                && !orphaned.contains(&transcript.agent_id)
                && running.contains(&transcript.agent_id)
            {
                subagent_turns(transcript, true)
            } else {
                settled
            },
        })
        .collect()
}

/// The projects root and journal of a test: one session and its sidecars.
#[cfg(test)]
pub(crate) fn fixture_paths(root: &std::path::Path) -> (PathBuf, PathBuf) {
    (root.join("projects"), root.join("journal"))
}

#[cfg(test)]
mod subagent_model_tests;
#[cfg(test)]
mod tests;
#[cfg(test)]
mod write_tests;
