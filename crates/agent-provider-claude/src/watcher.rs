//! Change detection on Claude's native session store
//! (`<config dir>/projects/<project>/<session id>.jsonl`, the config dir being
//! `CLAUDE_CONFIG_DIR` or `~/.claude`).
//!
//! The watcher only compares each session record's size and modification
//! time; it never opens a record or interprets Claude's format. Reading a
//! changed session is the Claude host's job (`nativeSession.read`). A
//! filesystem notification triggers a debounced rescan; a periodic rescan
//! covers a store created later and missed notifications. Sub-agent
//! transcripts (`<project>/<session id>/subagents/*.jsonl`) grow while their
//! parent's record may stay unchanged (a background agent works while its
//! parent waits), so a change among them re-reads the parent session.

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
const SUBAGENTS_DIRECTORY: &str = "subagents";

/// A session record that appeared, changed or (`observed: None`) disappeared.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SessionChange {
    pub session_id: String,
    pub observed: Option<Observation>,
    /// Only the session's sub-agent transcripts changed: its record matches
    /// the index, yet the session must be read again.
    pub subagents_changed: bool,
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
    scan_store(root).records
}

/// Session records and, per session, the folded size and newest modification
/// of its sub-agent transcripts.
#[derive(Default)]
struct StoreScan {
    records: HashMap<String, Observation>,
    subagents: HashMap<String, Observation>,
}

fn scan_store(root: &Path) -> StoreScan {
    let mut scanned = StoreScan::default();
    let Ok(projects) = std::fs::read_dir(root) else {
        return scanned;
    };
    for project in projects.filter_map(Result::ok) {
        let Ok(records) = std::fs::read_dir(project.path()) else {
            continue;
        };
        for record in records.filter_map(Result::ok) {
            let path = record.path();
            let Some(session_id) = path
                .file_stem()
                .and_then(|stem| stem.to_str())
                .filter(|stem| !stem.is_empty())
            else {
                continue;
            };
            if path.extension().and_then(|extension| extension.to_str()) == Some(RECORD_EXTENSION) {
                if let Some(observed) = observe_record(&path) {
                    scanned.records.insert(session_id.to_owned(), observed);
                }
            } else if let Some(observed) = observe_subagents(&path.join(SUBAGENTS_DIRECTORY)) {
                scanned.subagents.insert(session_id.to_owned(), observed);
            }
        }
    }
    scanned
}

/// Size and modification time of one regular file.
fn observe_record(path: &Path) -> Option<Observation> {
    let metadata = std::fs::metadata(path)
        .ok()
        .filter(std::fs::Metadata::is_file)?;
    let last_modified_ms = metadata
        .modified()
        .ok()
        .and_then(|modified| modified.duration_since(UNIX_EPOCH).ok())
        .and_then(|elapsed| i64::try_from(elapsed.as_millis()).ok())
        .unwrap_or(0);
    Some(Observation {
        file_size: metadata.len(),
        last_modified_ms,
    })
}

/// The folded observation of every transcript in a sub-agent directory;
/// `None` without one.
fn observe_subagents(directory: &Path) -> Option<Observation> {
    let transcripts = std::fs::read_dir(directory).ok()?;
    transcripts
        .filter_map(Result::ok)
        .map(|entry| entry.path())
        .filter(|path| {
            path.extension().and_then(|extension| extension.to_str()) == Some(RECORD_EXTENSION)
        })
        .filter_map(|path| observe_record(&path))
        .reduce(|folded, observed| Observation {
            file_size: folded.file_size.saturating_add(observed.file_size),
            last_modified_ms: folded.last_modified_ms.max(observed.last_modified_ms),
        })
}

/// Sessions whose record is unchanged while their sub-agent transcripts
/// changed, by session id.
fn subagent_changes(
    previous: &StoreScan,
    current: &StoreScan,
    record_changes: &[SessionChange],
) -> Vec<SessionChange> {
    let mut changes = current
        .subagents
        .iter()
        .filter(|(session_id, observed)| previous.subagents.get(*session_id) != Some(*observed))
        .filter(|(session_id, _)| {
            !record_changes
                .iter()
                .any(|change| &change.session_id == *session_id)
        })
        .filter_map(|(session_id, _)| {
            current.records.get(session_id).map(|record| SessionChange {
                session_id: session_id.clone(),
                observed: Some(*record),
                subagents_changed: true,
            })
        })
        .collect::<Vec<_>>();
    changes.sort_by(|left, right| left.session_id.cmp(&right.session_id));
    changes
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
            subagents_changed: false,
        })
        .chain(
            previous
                .keys()
                .filter(|session_id| !current.contains_key(*session_id))
                .map(|session_id| SessionChange {
                    session_id: session_id.clone(),
                    observed: None,
                    subagents_changed: false,
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
    let mut known = StoreScan::default();
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
        let Ok(current) = tokio::task::spawn_blocking(move || scan_store(&scan_root)).await else {
            continue;
        };
        let records = diff(&known.records, &current.records);
        let subagents = subagent_changes(&known, &current, &records);
        for change in records.into_iter().chain(subagents) {
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
                observed: None,
                subagents_changed: false,
            }]
        );
        assert!(scan(&directory.path().join("missing")).is_empty());
        Ok(())
    }

    #[test]
    fn a_growing_subagent_transcript_rereads_its_unchanged_parent()
    -> Result<(), Box<dyn std::error::Error>> {
        let directory = tempfile::tempdir()?;
        let root = directory.path().join("projects");
        write(&root.join("-work/parent.jsonl"), b"parent")?;
        write(&root.join("-work/parent/subagents/agent-a.jsonl"), b"a")?;
        let first = scan_store(&root);
        assert_eq!(first.records.keys().collect::<Vec<_>>(), ["parent"]);

        // The background agent writes; its parent's record stays as it was.
        write(&root.join("-work/parent/subagents/agent-a.jsonl"), b"a b")?;
        write(&root.join("-work/parent/subagents/agent-b.jsonl"), b"b")?;
        let second = scan_store(&root);
        let records = diff(&first.records, &second.records);
        assert_eq!(records, []);
        assert_eq!(
            subagent_changes(&first, &second, &records),
            [SessionChange {
                session_id: "parent".into(),
                observed: Some(first.records["parent"]),
                subagents_changed: true,
            }]
        );

        // A parent record change already re-reads the session.
        write(&root.join("-work/parent.jsonl"), b"parent grows")?;
        write(&root.join("-work/parent/subagents/agent-b.jsonl"), b"b c")?;
        let third = scan_store(&root);
        let records = diff(&second.records, &third.records);
        assert_eq!(records.len(), 1);
        assert_eq!(subagent_changes(&second, &third, &records), []);
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
