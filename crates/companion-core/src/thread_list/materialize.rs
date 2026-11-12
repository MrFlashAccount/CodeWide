//! Reads the first row of a thread the row hub does not know.
//!
//! A journaled change of a thread far below every loaded page has no row to
//! apply to. The hub buffers the thread's events and asks for one read here:
//! at most one read per thread (the hub's materializing set) and at most
//! [`MAX_CONCURRENT_READS`] at once. The journal head is taken before the
//! read, so the read row gets that head as its cursor and the buffered events
//! are replayed over it. Every failed or empty read is logged with the
//! thread id and its reason. A failed read is retried after a bounded,
//! doubling delay (and on the thread's next update); an empty read ignores the
//! thread until its next lifecycle event.
//!
//! The port is implemented by the sync layer, which owns the provider
//! routing and the row decorations.

use std::{
    sync::Arc,
    time::{SystemTime, UNIX_EPOCH},
};

use async_trait::async_trait;
use tokio::sync::Semaphore;
use tracing::{info, warn};

use super::{AfterRead, RowRead, ThreadListRows};

/// Most row reads in flight at once.
pub const MAX_CONCURRENT_READS: usize = 4;

/// Reads one decorated thread-list row.
#[async_trait]
pub trait RowReader: Send + Sync {
    /// The journal head now.
    ///
    /// # Errors
    /// Returns the storage failure.
    async fn journal_head(&self) -> Result<u64, String>;

    /// The thread's decorated row (`thread/list` shape), or the confirmed
    /// reason it has none.
    ///
    /// # Errors
    /// Returns a provider or storage failure that may be transient (no thread
    /// content).
    async fn read_row(&self, thread_id: &str) -> Result<RowRead, String>;
}

/// Runs the hub's row reads through a [`RowReader`].
#[derive(Clone)]
pub struct Materializer {
    rows: ThreadListRows,
    reader: Arc<dyn RowReader>,
    permits: Arc<Semaphore>,
}

impl Materializer {
    #[must_use]
    pub fn new(rows: ThreadListRows, reader: Arc<dyn RowReader>) -> Self {
        Self {
            rows,
            reader,
            permits: Arc::new(Semaphore::new(MAX_CONCURRENT_READS)),
        }
    }

    /// Starts the reads the hub asked for.
    pub fn spawn(&self, thread_ids: Vec<String>) {
        for thread_id in thread_ids {
            let materializer = self.clone();
            tokio::spawn(async move { materializer.read(thread_id).await });
        }
    }

    async fn read(self, thread_id: String) {
        loop {
            let read = {
                let Ok(_permit) = self.permits.clone().acquire_owned().await else {
                    return;
                };
                match self.reader.journal_head().await {
                    Ok(head) => self
                        .reader
                        .read_row(&thread_id)
                        .await
                        .map(|row| (head, row)),
                    Err(error) => Err(error),
                }
            };
            let (head, row) = match read {
                Ok((head, row)) => {
                    if let RowRead::Absent(reason) = &row {
                        info!(
                            thread_id = %thread_id,
                            reason = reason.as_str(),
                            "thread list row read empty; ignored until its next lifecycle event"
                        );
                    }
                    (head, Ok(row))
                }
                Err(error) => (0, Err(error)),
            };
            let failure = row.as_ref().err().cloned();
            let next = self
                .rows
                .complete_materialization(&thread_id, head, row, now_secs());
            if let Some(error) = failure {
                warn!(
                    thread_id = %thread_id,
                    reason = "read_failed",
                    err = %error,
                    retry = ?next,
                    failures = self.rows.materialization_failures(),
                    "thread list row read failed"
                );
            }
            match next {
                AfterRead::Done => return,
                AfterRead::ReadAgain => {}
                AfterRead::RetryAfter { attempt, delay } => {
                    tokio::time::sleep(delay).await;
                    if !self.rows.retry_materialization(&thread_id, attempt) {
                        return;
                    }
                }
            }
        }
    }
}

/// Seconds since the Unix epoch, the unit of `Thread.updatedAt`.
#[must_use]
pub fn now_secs() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .ok()
        .and_then(|elapsed| i64::try_from(elapsed.as_secs()).ok())
        .unwrap_or(0)
}
