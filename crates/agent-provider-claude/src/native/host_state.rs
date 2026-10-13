//! The Claude agent host's own thread metadata, read for the native index:
//! which sessions a `CodeWide` thread consists of, its list metadata, its
//! turn index and the snapshot of a turn still running.
//!
//! The host writes `<journal dir>/threads/<app thread id>/state.json`
//! (`ThreadState` v2, `host/src/state/threadState.ts`) and, while a turn
//! runs, `active-turn.json` next to it. This module only reads them; a file
//! it cannot parse is skipped and logged, never repaired.

use std::{
    collections::HashMap,
    path::{Path, PathBuf},
};

use agent_core::model::{
    AgentTurn, AppThreadId, NativeSessionCodewide, NativeThreadOrigin, NativeThreadPresence,
    NativeTitleOverride, ThreadSettings,
};
use serde::Deserialize;
use tracing::warn;

use crate::transcript::turn_index::TurnRecord;

const STATE_FILE: &str = "state.json";
const ACTIVE_TURN_FILE: &str = "active-turn.json";

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq)]
#[serde(rename_all = "camelCase")]
enum StateOrigin {
    Created,
    Discovered,
}

/// The fields of a host `ThreadState` the index needs.
#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ThreadStateFile {
    app_thread_id: String,
    created_at: i64,
    cwd: String,
    origin: StateOrigin,
    pending_settings: Option<ThreadSettings>,
    presence: NativeThreadPresence,
    recency_at: Option<i64>,
    session_ids: Vec<String>,
    settings: ThreadSettings,
    title: NativeTitleOverride,
    turns: Vec<TurnRecord>,
    updated_at: i64,
}

#[derive(Deserialize)]
struct ActiveTurnFile {
    turn: AgentTurn,
}

/// One `CodeWide` thread the host keeps metadata for.
#[derive(Clone, Debug)]
pub struct HostThread {
    pub app_thread_id: AppThreadId,
    /// Session chain, oldest first; the last is the current session.
    pub session_ids: Vec<String>,
    pub cwd: String,
    pub codewide: NativeSessionCodewide,
    pub turns: Vec<TurnRecord>,
    directory: PathBuf,
}

impl HostThread {
    /// The snapshot of the turn running in the current session, if the host
    /// left one.
    #[must_use]
    pub fn active_turn(&self) -> Option<AgentTurn> {
        let text = std::fs::read(self.directory.join(ACTIVE_TURN_FILE)).ok()?;
        match serde_json::from_slice::<ActiveTurnFile>(&text) {
            Ok(file) => Some(file.turn),
            Err(err) => {
                warn!(err = %err, thread_id = %self.app_thread_id, "Claude host active turn is unreadable");
                None
            }
        }
    }

    /// Whether `session_id` is the session the thread talks to now.
    #[must_use]
    pub fn is_current(&self, session_id: &str) -> bool {
        self.session_ids
            .last()
            .is_some_and(|current| current == session_id)
    }
}

/// Every host thread, by each session of its chain.
#[derive(Default)]
pub struct HostThreads {
    by_session: HashMap<String, HostThread>,
}

impl HostThreads {
    /// Reads `<journal dir>/threads/*/state.json`. A missing directory is
    /// an empty set (the host has written nothing yet).
    #[must_use]
    pub fn read(journal_directory: &Path) -> Self {
        let mut threads = Self::default();
        let Ok(entries) = std::fs::read_dir(journal_directory.join("threads")) else {
            return threads;
        };
        for entry in entries.flatten() {
            let directory = entry.path();
            let Ok(text) = std::fs::read(directory.join(STATE_FILE)) else {
                continue;
            };
            let state = match serde_json::from_slice::<ThreadStateFile>(&text) {
                Ok(state) => state,
                Err(err) => {
                    warn!(err = %err, directory = %directory.display(), "Claude host thread state is unreadable");
                    continue;
                }
            };
            let Some(thread) = host_thread(state, directory) else {
                continue;
            };
            for session_id in &thread.session_ids {
                threads
                    .by_session
                    .insert(session_id.clone(), thread.clone());
            }
        }
        threads
    }

    /// The host thread whose chain contains `session_id`.
    #[must_use]
    pub fn owner_of(&self, session_id: &str) -> Option<&HostThread> {
        self.by_session.get(session_id)
    }
}

fn host_thread(state: ThreadStateFile, directory: PathBuf) -> Option<HostThread> {
    let app_thread_id = AppThreadId::parse(&state.app_thread_id)?;
    Some(HostThread {
        app_thread_id,
        session_ids: state.session_ids,
        cwd: state.cwd.clone(),
        codewide: NativeSessionCodewide {
            created_at: state.created_at,
            cwd: state.cwd,
            origin: match state.origin {
                StateOrigin::Created => NativeThreadOrigin::Interactive,
                StateOrigin::Discovered => NativeThreadOrigin::External,
            },
            presence: state.presence,
            recency_at: state.recency_at,
            settings: state.pending_settings.unwrap_or(state.settings),
            title: state.title,
            updated_at: state.updated_at,
        },
        turns: state.turns,
        directory,
    })
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    #[test]
    fn reads_the_hosts_thread_state_and_running_turn() -> Result<(), Box<dyn std::error::Error>> {
        let journal = tempfile::tempdir()?;
        let directory = journal.path().join("threads/thread-1");
        std::fs::create_dir_all(&directory)?;
        let settings = json!({"model": "opus", "effort": null, "permissionProfile": ":workspace", "serviceTier": null});
        std::fs::write(
            directory.join(STATE_FILE),
            serde_json::to_vec(&json!({
                "appThreadId": "thread-1", "createdAt": 10, "cwd": "/work", "origin": "created",
                "pendingSettings": null, "presence": {"type": "listed", "archived": true},
                "recencyAt": 30, "sessionIds": ["s-old", "s-new"], "sessionStarted": true,
                "settings": settings, "title": {"type": "cleared", "hiddenTitle": "Old"},
                "totalCost": {"type": "known", "usd": 0}, "totalUsage": {}, "usageBaseline": {},
                "turns": [{"anchors": ["u1"], "completedAt": 20, "origin": "user",
                    "outcome": {"status": "completed"},
                    "prompts": [{"clientMessageId": "c1", "role": "first", "uuid": "u1"}],
                    "startedAt": 15, "turnId": "turn-1", "usage": null}],
                "updatedAt": 25, "version": 2
            }))?,
        )?;
        std::fs::write(
            directory.join(ACTIVE_TURN_FILE),
            serde_json::to_vec(
                &json!({"version": 2, "turn": {"turnId": "turn-2", "status": "inProgress",
                "origin": "user", "startedAt": 40, "completedAt": null, "error": null, "items": []}}),
            )?,
        )?;
        std::fs::create_dir_all(journal.path().join("threads/broken"))?;
        std::fs::write(journal.path().join("threads/broken").join(STATE_FILE), b"{")?;

        let threads = HostThreads::read(journal.path());
        let thread = threads.owner_of("s-old").ok_or("chain session")?;
        assert_eq!(thread.app_thread_id.as_str(), "thread-1");
        assert!(thread.is_current("s-new") && !thread.is_current("s-old"));
        assert_eq!(thread.turns.len(), 1);
        assert_eq!(
            thread.codewide.presence,
            NativeThreadPresence::Listed { archived: true }
        );
        assert_eq!(
            thread.codewide.title,
            NativeTitleOverride::Cleared {
                hidden_title: "Old".into()
            }
        );
        assert_eq!(thread.codewide.origin, NativeThreadOrigin::Interactive);
        assert_eq!(
            thread.active_turn().map(|turn| turn.turn_id.into_string()),
            Some("turn-2".into())
        );
        assert!(threads.owner_of("unknown").is_none());
        assert!(
            HostThreads::read(&journal.path().join("missing"))
                .owner_of("s-new")
                .is_none()
        );
        Ok(())
    }
}
