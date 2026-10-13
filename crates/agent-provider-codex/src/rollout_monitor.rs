//! Watches canonical rollout files written by other Codex App Server
//! processes. App Server notifications are connection-local, so the rollout
//! directory is the only shared invalidation boundary between the companion,
//! Codex CLI and Codex Desktop. The watching itself is the shared index's
//! (`agent_index::monitor`); this module names rollouts by thread id.

use std::path::PathBuf;

use agent_index::monitor::{FileChange, WatchRoot};
use tokio::sync::mpsc;

use crate::catalog::thread_id_from_path;

const CHANGE_CHANNEL_CAPACITY: usize = 2_048;

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct RolloutChange {
    pub thread_id: String,
    pub path: PathBuf,
    pub archived: bool,
}

impl From<FileChange> for RolloutChange {
    fn from(change: FileChange) -> Self {
        Self {
            thread_id: change.key,
            path: change.path,
            archived: change.archived,
        }
    }
}

/// Watches the rollout roots: the live sessions first, the archived
/// sessions second.
///
/// # Errors
///
/// Returns the platform watcher error when an existing rollout root cannot be
/// observed.
pub fn spawn(roots: Vec<PathBuf>) -> Result<mpsc::Receiver<RolloutChange>, notify::Error> {
    let roots = roots
        .into_iter()
        .enumerate()
        .map(|(index, path)| WatchRoot {
            path,
            archived: index == 1,
        })
        .collect();
    let mut changes = agent_index::monitor::spawn(roots, thread_id_from_path)?;
    let (sender, receiver) = mpsc::channel(CHANGE_CHANNEL_CAPACITY);
    tokio::spawn(async move {
        while let Some(change) = changes.recv().await {
            if sender.send(RolloutChange::from(change)).await.is_err() {
                return;
            }
        }
    });
    Ok(receiver)
}

#[cfg(test)]
mod tests {
    use std::{io::Write, path::Path, time::Duration};

    use super::*;

    const THREAD_ID: &str = "019fe7af-e2fa-70f3-88e8-99d59e10bd63";

    #[tokio::test]
    async fn reports_external_rollout_changes() -> Result<(), Box<dyn std::error::Error>> {
        let directory = tempfile::tempdir()?;
        let sessions = directory.path().join("sessions/2026/08/17");
        let archived = directory.path().join("archived_sessions");
        std::fs::create_dir_all(&sessions)?;
        std::fs::create_dir_all(&archived)?;
        let mut changes = spawn(vec![directory.path().join("sessions"), archived])?;
        let path = sessions.join(format!("rollout-2026-08-17T00-00-00-{THREAD_ID}.jsonl"));
        let mut rollout = std::fs::File::create(&path)?;
        writeln!(
            rollout,
            r#"{{"type":"event_msg","payload":{{"type":"task_started"}}}}"#
        )?;
        rollout.sync_all()?;

        let change = tokio::time::timeout(Duration::from_secs(3), changes.recv())
            .await?
            .ok_or("rollout watcher stopped")?;
        assert_eq!(change.thread_id, THREAD_ID);
        assert_eq!(change.path, path.canonicalize()?);
        assert!(!change.archived);
        Ok(())
    }

    #[tokio::test]
    async fn archived_rollout_under_a_symlinked_home_stays_archived()
    -> Result<(), Box<dyn std::error::Error>> {
        let directory = tempfile::tempdir()?;
        let home = directory.path().join("home");
        let alias = directory.path().join("alias");
        std::fs::create_dir_all(home.join("sessions"))?;
        std::fs::create_dir_all(home.join("archived_sessions"))?;
        std::os::unix::fs::symlink(&home, &alias)?;
        let mut changes = spawn(vec![
            alias.join("sessions"),
            alias.join("archived_sessions"),
        ])?;
        let path = home
            .join("archived_sessions")
            .join(format!("rollout-2026-08-17T00-00-00-{THREAD_ID}.jsonl"));
        std::fs::write(&path, "{}\n")?;

        let change = tokio::time::timeout(Duration::from_secs(5), changes.recv())
            .await?
            .ok_or("rollout watcher stopped")?;
        assert_eq!(change.thread_id, THREAD_ID);
        assert_eq!(change.path, path.canonicalize()?);
        assert!(change.archived);
        Ok(())
    }

    #[test]
    fn classifies_nested_paths() {
        let root = Path::new("sessions");
        assert!(Path::new("sessions/2026/08/17/thread.jsonl").starts_with(root));
    }
}
