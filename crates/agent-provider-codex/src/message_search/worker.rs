use super::{SearchError, catalog as search_catalog, index};
use crate::catalog::SessionCatalog;
use rusqlite::Connection;
use std::{
    collections::{HashMap, HashSet},
    sync::{
        Arc, Weak,
        atomic::{AtomicBool, AtomicUsize, Ordering},
    },
    time::{Duration, Instant},
};

const RETRY_BASE: Duration = Duration::from_secs(5);
const RETRY_MAX: Duration = Duration::from_mins(5);

struct SourceRetry {
    consecutive_failures: u32,
    retry_at: Instant,
}

pub(super) fn spawn(
    mut db: Connection,
    catalog: Arc<SessionCatalog>,
    state: Weak<AtomicBool>,
    failed: Arc<AtomicUsize>,
) {
    std::thread::spawn(move || {
        let mut source_retries = HashMap::new();
        let mut cycle_failures = 0_u32;
        while let Some(indexing) = state.upgrade() {
            indexing.store(true, Ordering::Release);
            let delay = match cycle(&mut db, &catalog, &state, &mut source_retries) {
                Ok((failures, complete)) => {
                    cycle_failures = 0;
                    failed.store(failures, Ordering::Release);
                    if complete {
                        RETRY_BASE
                    } else {
                        Duration::from_millis(50)
                    }
                }
                Err(error) => {
                    cycle_failures = cycle_failures.saturating_add(1);
                    failed.store(source_retries.len().saturating_add(1), Ordering::Release);
                    let delay = retry_delay(cycle_failures);
                    tracing::warn!(
                        err = ?error,
                        retry_after_ms = delay.as_millis(),
                        "search indexing cycle failed"
                    );
                    delay
                }
            };
            indexing.store(delay == Duration::from_millis(50), Ordering::Release);
            drop(indexing);
            std::thread::sleep(delay);
        }
    });
}

fn cycle(
    db: &mut Connection,
    catalog: &SessionCatalog,
    state: &Weak<AtomicBool>,
    retries: &mut HashMap<String, SourceRetry>,
) -> Result<(usize, bool), SearchError> {
    let entries = catalog.search_entries()?;
    search_catalog::prune(db, &entries)?;
    let retained: HashSet<_> = entries
        .iter()
        .map(|entry| entry.thread_id.as_str())
        .collect();
    retries.retain(|thread_id, _retry| retained.contains(thread_id.as_str()));
    let mut caught_up = true;
    // Refresh discovery between rounds. A large cold history must not hide
    // newly created or active chats until that history finishes indexing.
    for entry in &entries {
        let now = Instant::now();
        if retries
            .get(&entry.thread_id)
            .is_some_and(|retry| retry.retry_at > now)
        {
            continue;
        }
        match index::advance(db, &entry.path, &entry.thread_id) {
            Ok(complete) => {
                retries.remove(&entry.thread_id);
                search_catalog::update(db, entry)?;
                caught_up &= complete;
            }
            Err(SearchError::Io(error)) if error.kind() == std::io::ErrorKind::NotFound => {
                retries.remove(&entry.thread_id);
                search_catalog::remove(db, &entry.thread_id)?;
            }
            Err(error @ SearchError::Database(_)) => return Err(error),
            Err(error) => {
                let retry = retries
                    .entry(entry.thread_id.clone())
                    .or_insert(SourceRetry {
                        consecutive_failures: 0,
                        retry_at: now,
                    });
                retry.consecutive_failures = retry.consecutive_failures.saturating_add(1);
                let delay = retry_delay(retry.consecutive_failures);
                retry.retry_at = now + delay;
                tracing::warn!(
                    err = ?error,
                    thread_id = entry.thread_id,
                    retry_after_ms = delay.as_millis(),
                    "search source indexing failed"
                );
            }
        }
        if state.strong_count() == 1 {
            break;
        }
        std::thread::yield_now();
    }
    Ok((retries.len(), caught_up))
}

fn retry_delay(consecutive_failures: u32) -> Duration {
    let exponent = consecutive_failures.saturating_sub(1).min(6);
    RETRY_BASE.saturating_mul(1_u32 << exponent).min(RETRY_MAX)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn retry_delay_grows_exponentially_and_is_bounded() {
        assert_eq!(retry_delay(1), Duration::from_secs(5));
        assert_eq!(retry_delay(2), Duration::from_secs(10));
        assert_eq!(retry_delay(6), Duration::from_secs(160));
        assert_eq!(retry_delay(7), RETRY_MAX);
        assert_eq!(retry_delay(u32::MAX), RETRY_MAX);
    }
}
