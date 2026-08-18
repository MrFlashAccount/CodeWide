use std::{
    collections::HashMap,
    path::PathBuf,
    sync::{Arc, Mutex},
    time::Duration,
};

use notify::{Config, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use tokio::sync::mpsc;
use tracing::warn;

use crate::catalog::thread_id_from_path;

const CHANGE_DEBOUNCE: Duration = Duration::from_millis(180);
const CHANGE_CHANNEL_CAPACITY: usize = 2_048;

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct RolloutChange {
    pub thread_id: String,
    pub path: PathBuf,
    pub archived: bool,
}

/// Watches canonical rollout files written by other Codex App Server
/// processes. App Server notifications are connection-local, so the rollout
/// directory is the only shared invalidation boundary between the companion,
/// Codex CLI and Codex Desktop.
///
/// # Errors
///
/// Returns the platform watcher error when an existing rollout root cannot be
/// observed.
pub fn spawn(roots: Vec<PathBuf>) -> Result<mpsc::Receiver<RolloutChange>, notify::Error> {
    let (sender, receiver) = mpsc::channel(CHANGE_CHANNEL_CAPACITY);
    let watched_roots = roots
        .into_iter()
        .enumerate()
        .filter(|(_index, root)| root.is_dir())
        .map(|(index, root)| (root, index == 1))
        .collect::<Vec<_>>();
    if watched_roots.is_empty() {
        return Ok(receiver);
    }

    let pending = Arc::new(Mutex::new(HashMap::<String, RolloutChange>::new()));
    let callback_roots = watched_roots.clone();
    let callback_pending = pending.clone();
    let callback_sender = sender.clone();
    let runtime = tokio::runtime::Handle::current();
    let mut watcher = RecommendedWatcher::new(
        move |result: notify::Result<notify::Event>| match result {
            Ok(event) if relevant_kind(event.kind) => {
                for path in event.paths {
                    let Some(thread_id) = thread_id_from_path(&path) else {
                        continue;
                    };
                    let archived = callback_roots
                        .iter()
                        .find(|(root, _archived)| path.starts_with(root))
                        .is_some_and(|(_root, archived)| *archived);
                    let change = RolloutChange {
                        thread_id: thread_id.clone(),
                        path,
                        archived,
                    };
                    let should_schedule = match callback_pending.lock() {
                        Ok(mut pending) => pending.insert(thread_id.clone(), change).is_none(),
                        Err(poisoned) => poisoned
                            .into_inner()
                            .insert(thread_id.clone(), change)
                            .is_none(),
                    };
                    if !should_schedule {
                        continue;
                    }
                    let pending = callback_pending.clone();
                    let sender = callback_sender.clone();
                    runtime.spawn(async move {
                        tokio::time::sleep(CHANGE_DEBOUNCE).await;
                        let change = match pending.lock() {
                            Ok(mut pending) => pending.remove(&thread_id),
                            Err(poisoned) => poisoned.into_inner().remove(&thread_id),
                        };
                        if let Some(change) = change {
                            let _ = sender.send(change).await;
                        }
                    });
                }
            }
            Ok(_) => {}
            Err(error) => warn!(%error, "canonical rollout watcher failed"),
        },
        Config::default(),
    )?;
    for (root, _archived) in &watched_roots {
        watcher.watch(root, RecursiveMode::Recursive)?;
    }

    tokio::spawn(async move {
        sender.closed().await;
        drop(watcher);
    });
    Ok(receiver)
}

fn relevant_kind(kind: EventKind) -> bool {
    matches!(kind, EventKind::Create(_) | EventKind::Modify(_))
}

#[cfg(test)]
mod tests {
    use std::{io::Write, path::Path};

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
        assert_eq!(change.path, path);
        assert!(!change.archived);
        Ok(())
    }

    #[test]
    fn ignores_access_events() {
        assert!(!relevant_kind(EventKind::Access(
            notify::event::AccessKind::Any
        )));
    }

    #[test]
    fn classifies_nested_paths() {
        let root = Path::new("sessions");
        assert!(Path::new("sessions/2026/08/17/thread.jsonl").starts_with(root));
    }
}
