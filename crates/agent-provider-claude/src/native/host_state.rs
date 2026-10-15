//! The Claude agent host's own thread metadata, read for the native index:
//! which sessions a `CodeWide` thread consists of, its list metadata, its
//! turn index and the snapshot of a turn still running.
//!
//! The format is owned by [`crate::state`] (`ThreadState` v2 in
//! `<journal dir>/threads/<app thread id>/state.json` and, while a turn
//! runs, `active-turn.json` next to it). The index only reads them, never
//! converts a v1 journal; a file it cannot read is skipped and logged, never
//! repaired.

use std::{collections::HashMap, io, path::Path};

use agent_core::model::{AgentTurn, AppThreadId, NativeSessionCodewide, NativeThreadOrigin};
use tracing::warn;

use crate::{
    state::{SessionChain, ThreadDirectory, ThreadState, ThreadStateOrigin},
    transcript::turn_index::TurnRecord,
};

/// One `CodeWide` thread the host keeps metadata for.
#[derive(Clone, Debug)]
pub struct HostThread {
    pub app_thread_id: AppThreadId,
    /// Session chain, oldest first; the last is the current session.
    pub session_ids: SessionChain,
    pub cwd: String,
    pub codewide: NativeSessionCodewide,
    pub turns: Vec<TurnRecord>,
    directory: ThreadDirectory,
}

impl HostThread {
    /// The snapshot of the turn running in the current session, if the host
    /// left one.
    #[must_use]
    pub fn active_turn(&self) -> Option<AgentTurn> {
        match self.directory.read_active_turn() {
            Ok(turn) => turn,
            Err(err) => {
                warn!(err = %err, thread_id = %self.app_thread_id, "Claude host active turn is unreadable");
                None
            }
        }
    }

    /// Whether `session_id` is the session the thread talks to now.
    #[must_use]
    pub fn is_current(&self, session_id: &str) -> bool {
        self.session_ids.current() == session_id
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
        let directories = match ThreadDirectory::list(journal_directory) {
            Ok(directories) => directories,
            Err(err) => {
                if err.kind() != io::ErrorKind::NotFound {
                    warn!(err = %err, "Claude host thread directory is unreadable");
                }
                return threads;
            }
        };
        for directory in directories {
            let state = match directory.read_state() {
                Ok(Some(state)) => state,
                Ok(None) => continue,
                Err(err) => {
                    warn!(err = %err, thread_id = %directory.app_thread_id(), "Claude host thread state is unreadable");
                    continue;
                }
            };
            let thread = host_thread(state, directory);
            for session_id in thread.session_ids.iter() {
                threads
                    .by_session
                    .insert(session_id.to_owned(), thread.clone());
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

fn host_thread(state: ThreadState, directory: ThreadDirectory) -> HostThread {
    let settings = state.pending_settings.unwrap_or(state.settings);
    HostThread {
        app_thread_id: state.app_thread_id,
        session_ids: state.session_ids,
        cwd: state.cwd.clone(),
        codewide: NativeSessionCodewide {
            created_at: state.created_at,
            cwd: state.cwd,
            origin: match state.origin {
                ThreadStateOrigin::Created => NativeThreadOrigin::Interactive,
                ThreadStateOrigin::Discovered => NativeThreadOrigin::External,
            },
            presence: state.presence,
            recency_at: state.recency_at,
            settings,
            title: state.title,
            updated_at: state.updated_at,
        },
        turns: state.turns,
        directory,
    }
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use agent_core::model::{NativeThreadPresence, NativeTitleOverride};

    use super::*;

    #[test]
    fn reads_the_hosts_thread_state_and_running_turn() -> Result<(), Box<dyn std::error::Error>> {
        let journal = tempfile::tempdir()?;
        let directory = journal.path().join("threads/thread-1");
        std::fs::create_dir_all(&directory)?;
        let settings = json!({"model": "opus", "effort": null, "permissionProfile": ":workspace", "serviceTier": null});
        std::fs::write(
            directory.join("state.json"),
            serde_json::to_vec(&json!({
                "appThreadId": "thread-1", "createdAt": 10, "cwd": "/work", "origin": "created",
                "pendingSettings": null, "presence": {"type": "listed", "archived": true},
                "recencyAt": 30, "sessionIds": ["s-old", "s-new"], "sessionStarted": true,
                "settings": settings, "title": {"type": "cleared", "hiddenTitle": "Old"},
                "totalCost": {"type": "known", "usd": 0},
                "totalUsage": {"inputTokens": 0, "cachedInputTokens": 0, "outputTokens": 0,
                    "reasoningOutputTokens": 0, "totalTokens": 0},
                "usageBaseline": {"type": "unknown"},
                "turns": [{"anchors": ["u1"], "completedAt": 20, "origin": "user",
                    "outcome": {"status": "completed"},
                    "prompts": [{"clientMessageId": "c1", "role": "first", "uuid": "u1"}],
                    "startedAt": 15, "turnId": "turn-1", "usage": null}],
                "updatedAt": 25, "version": 2
            }))?,
        )?;
        std::fs::write(
            directory.join("active-turn.json"),
            serde_json::to_vec(
                &json!({"version": 2, "turn": {"turnId": "turn-2", "status": "inProgress",
                "origin": "user", "startedAt": 40, "completedAt": null, "error": null, "items": []}}),
            )?,
        )?;
        std::fs::create_dir_all(journal.path().join("threads/broken"))?;
        std::fs::write(journal.path().join("threads/broken/state.json"), b"{")?;

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
