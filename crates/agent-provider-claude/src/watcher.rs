//! Change detection on Claude's native session store
//! (`<config dir>/projects/<project>/<session id>.jsonl`, the config dir being
//! `CLAUDE_CONFIG_DIR` or `~/.claude`).
//!
//! The watcher only compares each session record's size and modification
//! time; it never opens a record or interprets Claude's format. Reading a
//! changed session is the Claude host's job (`nativeSession.read`). A
//! filesystem notification triggers a debounced rescan; a periodic rescan
//! covers a store created later and missed notifications.

use std::{
    collections::HashMap,
    path::{Path, PathBuf},
    sync::Arc,
    time::{Duration, UNIX_EPOCH},
};

use notify::{Config, RecommendedWatcher, RecursiveMode, Watcher};
use tokio::sync::{Notify, mpsc};
use tracing::warn;

use crate::store::Observation;

const CHANGE_DEBOUNCE: Duration = Duration::from_millis(250);
const CHANGE_CHANNEL_CAPACITY: usize = 1_024;
const RECORD_EXTENSION: &str = "jsonl";

/// A session record that appeared, changed or (`observed: None`) disappeared.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SessionChange {
    pub session_id: String,
    pub observed: Option<Observation>,
}

/// `<CLAUDE_CONFIG_DIR or ~/.claude>/projects`; `None` without either.
#[must_use]
pub fn projects_root() -> Option<PathBuf> {
    let config = std::env::var_os("CLAUDE_CONFIG_DIR")
        .filter(|value| !value.is_empty())
        .map(PathBuf::from)
        .or_else(|| {
            std::env::var_os("HOME")
                .filter(|value| !value.is_empty())
                .map(|home| PathBuf::from(home).join(".claude"))
        })?;
    Some(config.join("projects"))
}

/// Observes every session record directly under a project directory of
/// `root`. A missing root has no sessions.
#[must_use]
pub fn scan(root: &Path) -> HashMap<String, Observation> {
    let mut sessions = HashMap::new();
    let Ok(projects) = std::fs::read_dir(root) else {
        return sessions;
    };
    for project in projects.filter_map(Result::ok) {
        let Ok(records) = std::fs::read_dir(project.path()) else {
            continue;
        };
        for record in records.filter_map(Result::ok) {
            let path = record.path();
            if path.extension().and_then(|extension| extension.to_str()) != Some(RECORD_EXTENSION) {
                continue;
            }
            let (Some(session_id), Ok(metadata)) = (
                path.file_stem().and_then(|stem| stem.to_str()),
                record.metadata(),
            ) else {
                continue;
            };
            if !metadata.is_file() || session_id.is_empty() {
                continue;
            }
            let last_modified_ms = metadata
                .modified()
                .ok()
                .and_then(|modified| modified.duration_since(UNIX_EPOCH).ok())
                .and_then(|elapsed| i64::try_from(elapsed.as_millis()).ok())
                .unwrap_or(0);
            sessions.insert(
                session_id.to_owned(),
                Observation {
                    file_size: metadata.len(),
                    last_modified_ms,
                },
            );
        }
    }
    sessions
}

/// The changes from `previous` to `current`, by session id.
#[must_use]
pub fn diff<S: std::hash::BuildHasher>(
    previous: &HashMap<String, Observation, S>,
    current: &HashMap<String, Observation, S>,
) -> Vec<SessionChange> {
    let mut changes = current
        .iter()
        .filter(|(session_id, observed)| previous.get(*session_id) != Some(*observed))
        .map(|(session_id, observed)| SessionChange {
            session_id: session_id.clone(),
            observed: Some(*observed),
        })
        .chain(
            previous
                .keys()
                .filter(|session_id| !current.contains_key(*session_id))
                .map(|session_id| SessionChange {
                    session_id: session_id.clone(),
                    observed: None,
                }),
        )
        .collect::<Vec<_>>();
    changes.sort_by(|left, right| left.session_id.cmp(&right.session_id));
    changes
}

/// Watches `root`. The first scan reports every existing session; later scans
/// report differences. The watch ends when the receiver is dropped.
#[must_use]
pub fn spawn(root: PathBuf, rescan: Duration) -> mpsc::Receiver<SessionChange> {
    let (sender, receiver) = mpsc::channel(CHANGE_CHANNEL_CAPACITY);
    tokio::spawn(run(root, rescan, sender));
    receiver
}

async fn run(root: PathBuf, rescan: Duration, sender: mpsc::Sender<SessionChange>) {
    let notified = Arc::new(Notify::new());
    let mut watcher: Option<RecommendedWatcher> = None;
    let mut known = HashMap::new();
    let mut interval = tokio::time::interval(rescan);
    loop {
        tokio::select! {
            () = notified.notified() => tokio::time::sleep(CHANGE_DEBOUNCE).await,
            _ = interval.tick() => {}
            () = sender.closed() => return,
        }
        if watcher.is_none() && root.is_dir() {
            watcher = watch(&root, notified.clone());
        }
        let scan_root = root.clone();
        let Ok(current) = tokio::task::spawn_blocking(move || scan(&scan_root)).await else {
            continue;
        };
        for change in diff(&known, &current) {
            if sender.send(change).await.is_err() {
                return;
            }
        }
        known = current;
    }
}

fn watch(root: &Path, notified: Arc<Notify>) -> Option<RecommendedWatcher> {
    let mut watcher = match RecommendedWatcher::new(
        move |result: notify::Result<notify::Event>| match result {
            Ok(_) => notified.notify_one(),
            Err(error) => warn!(%error, "Claude session store watcher failed"),
        },
        Config::default(),
    ) {
        Ok(watcher) => watcher,
        Err(error) => {
            warn!(%error, "Claude session store cannot be watched; polling only");
            return None;
        }
    };
    match watcher.watch(root, RecursiveMode::Recursive) {
        Ok(()) => Some(watcher),
        Err(error) => {
            warn!(%error, "Claude session store cannot be watched; polling only");
            None
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn write(path: &Path, bytes: &[u8]) -> std::io::Result<()> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        std::fs::write(path, bytes)
    }

    #[test]
    fn scan_reports_only_session_records_and_diff_reports_changes()
    -> Result<(), Box<dyn std::error::Error>> {
        let directory = tempfile::tempdir()?;
        let root = directory.path().join("projects");
        write(&root.join("-work/session-a.jsonl"), b"one")?;
        write(&root.join("-work/notes.txt"), b"ignored")?;
        write(
            &root.join("-work/session-a/subagents/agent.jsonl"),
            b"nested",
        )?;
        let first = scan(&root);
        assert_eq!(first.keys().collect::<Vec<_>>(), ["session-a"]);
        assert_eq!(first["session-a"].file_size, 3);

        assert_eq!(diff(&first, &first), []);
        write(&root.join("-work/session-a.jsonl"), b"one two")?;
        write(&root.join("-other/session-b.jsonl"), b"b")?;
        let second = scan(&root);
        let changes = diff(&first, &second);
        assert_eq!(
            changes
                .iter()
                .map(|change| (
                    change.session_id.as_str(),
                    change.observed.map(|o| o.file_size)
                ))
                .collect::<Vec<_>>(),
            [("session-a", Some(7)), ("session-b", Some(1))]
        );
        std::fs::remove_file(root.join("-other/session-b.jsonl"))?;
        assert_eq!(
            diff(&second, &scan(&root)),
            [SessionChange {
                session_id: "session-b".into(),
                observed: None
            }]
        );
        assert!(scan(&directory.path().join("missing")).is_empty());
        Ok(())
    }

    #[tokio::test]
    async fn the_watch_reports_existing_then_changed_sessions()
    -> Result<(), Box<dyn std::error::Error>> {
        let directory = tempfile::tempdir()?;
        let root = directory.path().join("projects");
        write(&root.join("-work/session-a.jsonl"), b"one")?;
        let mut changes = spawn(root.clone(), Duration::from_millis(50));
        let first = tokio::time::timeout(Duration::from_secs(5), changes.recv())
            .await?
            .ok_or("watch ended")?;
        assert_eq!(first.session_id, "session-a");
        write(&root.join("-work/session-b.jsonl"), b"two")?;
        let second = tokio::time::timeout(Duration::from_secs(5), changes.recv())
            .await?
            .ok_or("watch ended")?;
        assert_eq!(second.session_id, "session-b");
        assert_eq!(second.observed.map(|observed| observed.file_size), Some(3));
        Ok(())
    }
}
