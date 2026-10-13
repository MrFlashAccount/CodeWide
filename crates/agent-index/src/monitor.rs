//! Watches transcript files written by other processes of a provider and
//! reports one debounced change per file key. A provider's own process
//! notifications are connection-local, so the files are the only shared
//! invalidation boundary between the companion and the provider's other
//! front ends.

use std::{
    collections::HashMap,
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
    time::Duration,
};

use notify::{Config, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use tokio::sync::mpsc;
use tracing::warn;

const CHANGE_DEBOUNCE: Duration = Duration::from_millis(180);
const CHANGE_CHANNEL_CAPACITY: usize = 2_048;

/// A directory to watch recursively, and whether files under it are archived.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct WatchRoot {
    pub path: PathBuf,
    pub archived: bool,
}

/// One changed file, identified by the key the provider derives from its path.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct FileChange {
    pub key: String,
    pub path: PathBuf,
    pub archived: bool,
}

/// Watches `roots`; `key_of` names the file a path belongs to (`None` for
/// paths the provider does not index). Changes of one key within the
/// debounce window collapse into the last one.
///
/// # Errors
///
/// Returns the platform watcher error when an existing root cannot be
/// observed.
pub fn spawn(
    roots: Vec<WatchRoot>,
    key_of: impl Fn(&Path) -> Option<String> + Send + Sync + 'static,
) -> Result<mpsc::Receiver<FileChange>, notify::Error> {
    let (sender, receiver) = mpsc::channel(CHANGE_CHANNEL_CAPACITY);
    let watched_roots = roots
        .into_iter()
        .filter(|root| root.path.is_dir())
        // FSEvents reports resolved paths (for example /private/var instead
        // of /var). Keep roots and changes in the same namespace so archived
        // files cannot be misclassified as active after a symlink hop.
        .map(|root| root.path.canonicalize().map(|path| (path, root.archived)))
        .collect::<Result<Vec<_>, _>>()
        .map_err(notify::Error::io)?;
    if watched_roots.is_empty() {
        return Ok(receiver);
    }

    let pending = Arc::new(Mutex::new(HashMap::<String, FileChange>::new()));
    let callback_roots = watched_roots.clone();
    let callback_pending = pending.clone();
    let callback_sender = sender.clone();
    let runtime = tokio::runtime::Handle::current();
    let mut watcher = RecommendedWatcher::new(
        move |result: notify::Result<notify::Event>| match result {
            Ok(event) if relevant_kind(event.kind) => {
                for path in event.paths {
                    let path = path.canonicalize().unwrap_or(path);
                    let Some(key) = key_of(&path) else {
                        continue;
                    };
                    let archived = callback_roots
                        .iter()
                        .find(|(root, _archived)| path.starts_with(root))
                        .is_some_and(|(_root, archived)| *archived);
                    let change = FileChange {
                        key: key.clone(),
                        path,
                        archived,
                    };
                    let should_schedule = match callback_pending.lock() {
                        Ok(mut pending) => pending.insert(key.clone(), change).is_none(),
                        Err(poisoned) => {
                            poisoned.into_inner().insert(key.clone(), change).is_none()
                        }
                    };
                    if !should_schedule {
                        continue;
                    }
                    let pending = callback_pending.clone();
                    let sender = callback_sender.clone();
                    runtime.spawn(async move {
                        tokio::time::sleep(CHANGE_DEBOUNCE).await;
                        let change = match pending.lock() {
                            Ok(mut pending) => pending.remove(&key),
                            Err(poisoned) => poisoned.into_inner().remove(&key),
                        };
                        if let Some(change) = change {
                            let _ = sender.send(change).await;
                        }
                    });
                }
            }
            Ok(_) => {}
            Err(error) => warn!(%error, "transcript file watcher failed"),
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
    use std::io::Write;

    use super::*;

    fn stem(path: &Path) -> Option<String> {
        path.file_stem()
            .and_then(|stem| stem.to_str())
            .map(ToOwned::to_owned)
    }

    #[tokio::test]
    async fn reports_external_changes_by_key() -> Result<(), Box<dyn std::error::Error>> {
        let directory = tempfile::tempdir()?;
        let live = directory.path().join("live/2026");
        let archived = directory.path().join("archived");
        std::fs::create_dir_all(&live)?;
        std::fs::create_dir_all(&archived)?;
        let mut changes = spawn(
            vec![
                WatchRoot {
                    path: directory.path().join("live"),
                    archived: false,
                },
                WatchRoot {
                    path: archived.clone(),
                    archived: true,
                },
            ],
            stem,
        )?;
        let path = live.join("thread-a.jsonl");
        let mut file = std::fs::File::create(&path)?;
        writeln!(file, "{{}}")?;
        file.sync_all()?;

        let change = tokio::time::timeout(Duration::from_secs(3), changes.recv())
            .await?
            .ok_or("watcher stopped")?;
        assert_eq!(change.key, "thread-a");
        assert_eq!(change.path, path.canonicalize()?);
        assert!(!change.archived);

        std::fs::write(archived.join("thread-b.jsonl"), "{}\n")?;
        let change = tokio::time::timeout(Duration::from_secs(3), changes.recv())
            .await?
            .ok_or("watcher stopped")?;
        assert_eq!(change.key, "thread-b");
        assert!(change.archived);
        Ok(())
    }

    #[test]
    fn ignores_access_events() {
        assert!(!relevant_kind(EventKind::Access(
            notify::event::AccessKind::Any
        )));
    }
}
