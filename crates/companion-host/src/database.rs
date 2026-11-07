//! Companion-owned redb page-cache budget; durable data remains on disk.

use std::{path::Path, sync::Arc, time::Duration};

use redb::{Database, DatabaseError, ReadableDatabase};

const CACHE_BYTES: usize = 0;

/// Opens (or creates) a redb database with the companion's page-cache budget
/// and periodic cache metrics under `name`.
///
/// # Errors
///
/// Returns an error when the database cannot be created or opened.
pub fn open(path: impl AsRef<Path>, name: &'static str) -> Result<Arc<Database>, DatabaseError> {
    Ok(share(open_owned(path)?, name))
}

/// Opens (or creates) a database its caller holds alone: maintenance that
/// needs exclusive access (migrations, [`compact_if_sparse`]) runs on it
/// before [`share`] hands it out.
///
/// # Errors
///
/// Returns an error when the database cannot be created or opened.
pub fn open_owned(path: impl AsRef<Path>) -> Result<Database, DatabaseError> {
    // The OS already caches file pages and can reclaim them under pressure.
    // Avoid an additional, independently budgeted 1 GiB cache per database.
    Database::builder().set_cache_size(CACHE_BYTES).create(path)
}

/// Shares a database and starts its periodic cache metrics under `name`.
#[must_use]
pub fn share(database: Database, name: &'static str) -> Arc<Database> {
    let database = Arc::new(database);
    if let Ok(runtime) = tokio::runtime::Handle::try_current() {
        let weak = Arc::downgrade(&database);
        runtime.spawn(async move {
            loop {
                tokio::time::sleep(Duration::from_mins(1)).await;
                let Some(database) = weak.upgrade() else {
                    break;
                };
                let stats = database.cache_stats();
                drop(database);
                tracing::info!(
                    database = name,
                    cache_budget_bytes = CACHE_BYTES,
                    cache_used_bytes = stats.used_bytes(),
                    cache_read_hits = stats.read_hits(),
                    cache_read_misses = stats.read_misses(),
                    cache_write_hits = stats.write_hits(),
                    cache_write_misses = stats.write_misses(),
                    cache_evictions = stats.evictions(),
                    "database page cache"
                );
            }
        });
    }
    database
}

/// Free space below which a database is not compacted: compacting moves
/// every live page, so it pays only when much of the file is free.
const COMPACT_MIN_FREE_BYTES: u64 = 256 * 1024 * 1024;

/// What [`compact_if_sparse`] did.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum Compaction {
    /// Too little of the file is free to be worth it.
    Skipped { file_bytes: u64, free_bytes: u64 },
    /// The file was compacted and shrunk.
    Compacted {
        before_bytes: u64,
        after_bytes: u64,
        elapsed: Duration,
    },
}

/// Why compaction could not run or finish. The database stays consistent:
/// redb compacts through ordinary commits, so a compaction cut short leaves
/// a valid (partly compacted) file.
#[derive(Debug, thiserror::Error)]
pub enum CompactionFailure {
    #[error(transparent)]
    Io(#[from] std::io::Error),
    #[error(transparent)]
    Transaction(#[from] redb::TransactionError),
    #[error(transparent)]
    Storage(#[from] redb::StorageError),
    #[error(transparent)]
    Compaction(#[from] redb::CompactionError),
    #[error(transparent)]
    Commit(#[from] redb::CommitError),
}

/// Bytes of the file at `path` no page of the database uses.
fn free_bytes(database: &Database, file_bytes: u64) -> Result<u64, CompactionFailure> {
    // Pages a commit freed are released by the next commits; release them
    // before counting (as `Database::compact` does first).
    for _ in 0..2 {
        database.begin_write()?.commit()?;
    }
    let write = database.begin_write()?;
    let stats = write.stats()?;
    write.abort()?;
    let used = stats
        .allocated_pages()
        .saturating_mul(u64::try_from(stats.page_size()).unwrap_or(u64::MAX));
    Ok(file_bytes.saturating_sub(used))
}

/// Compacts a database its caller holds alone when at least half of its
/// file (and at least 256 MiB) is free, as after a migration that dropped
/// large derived tables; the file then shrinks to its live pages. Logs the
/// sizes and the duration.
///
/// # Errors
///
/// Returns an error when the file's size or the database's statistics
/// cannot be read, or a compaction commit fails.
pub fn compact_if_sparse(
    database: &mut Database,
    path: &Path,
    name: &'static str,
) -> Result<Compaction, CompactionFailure> {
    compact_when_free(database, path, name, COMPACT_MIN_FREE_BYTES)
}

fn compact_when_free(
    database: &mut Database,
    path: &Path,
    name: &'static str,
    min_free_bytes: u64,
) -> Result<Compaction, CompactionFailure> {
    let file_bytes = std::fs::metadata(path)?.len();
    let free = free_bytes(database, file_bytes)?;
    if free < min_free_bytes || free.saturating_mul(2) < file_bytes {
        return Ok(Compaction::Skipped {
            file_bytes,
            free_bytes: free,
        });
    }
    tracing::info!(
        database = name,
        file_bytes,
        free_bytes = free,
        "compacting a sparse database before serving"
    );
    let started = std::time::Instant::now();
    database.compact()?;
    let compaction = Compaction::Compacted {
        before_bytes: file_bytes,
        after_bytes: std::fs::metadata(path)?.len(),
        elapsed: started.elapsed(),
    };
    if let Compaction::Compacted {
        before_bytes,
        after_bytes,
        elapsed,
    } = compaction
    {
        tracing::info!(
            database = name,
            before_bytes,
            after_bytes,
            elapsed_ms = elapsed.as_millis(),
            "database compacted"
        );
    }
    Ok(compaction)
}

#[cfg(test)]
mod tests {
    use super::*;
    use redb::TableDefinition;

    const DROPPED: TableDefinition<u64, &[u8]> = TableDefinition::new("dropped");

    #[test]
    fn a_database_mostly_freed_by_a_dropped_table_shrinks_and_keeps_its_rows()
    -> Result<(), Box<dyn std::error::Error>> {
        let directory = tempfile::tempdir()?;
        let path = directory.path().join("index.redb");
        let mut database = open_owned(&path)?;
        let write = database.begin_write()?;
        {
            let mut dropped = write.open_table(DROPPED)?;
            let page = vec![7_u8; 4096];
            for key in 0..2_000 {
                dropped.insert(key, page.as_slice())?;
            }
            write.open_table(VALUES)?.insert(1, b"kept".as_slice())?;
        }
        write.commit()?;
        // Little is free yet: nothing to do.
        assert!(matches!(
            compact_when_free(&mut database, &path, "test", 1)?,
            Compaction::Skipped { .. }
        ));
        let write = database.begin_write()?;
        write.delete_table(DROPPED)?;
        write.commit()?;
        let Compaction::Compacted {
            before_bytes,
            after_bytes,
            ..
        } = compact_when_free(&mut database, &path, "test", 1)?
        else {
            return Err("a mostly free database is compacted".into());
        };
        assert!(
            after_bytes * 2 < before_bytes,
            "{before_bytes} -> {after_bytes}"
        );
        let database = share(database, "test");
        let read = database.begin_read()?;
        assert_eq!(
            read.open_table(VALUES)?
                .get(1)?
                .map(|value| value.value().to_vec()),
            Some(b"kept".to_vec())
        );
        Ok(())
    }

    const VALUES: TableDefinition<u64, &[u8]> = TableDefinition::new("values");

    #[test]
    fn uncached_database_persists_and_reopens_without_retaining_read_pages()
    -> Result<(), Box<dyn std::error::Error>> {
        let directory = tempfile::tempdir()?;
        let path = directory.path().join("database.redb");
        let value = vec![7_u8; 4096];
        {
            let database = open(&path, "test")?;
            let write = database.begin_write()?;
            {
                let mut table = write.open_table(VALUES)?;
                for key in 0..512 {
                    table.insert(key, value.as_slice())?;
                }
            }
            write.commit()?;
        }
        let database = open(&path, "test")?;
        for _ in 0..2 {
            let read = database.begin_read()?;
            let table = read.open_table(VALUES)?;
            for key in 0..512 {
                let stored = table.get(key)?.ok_or("missing committed value")?;
                assert_eq!(stored.value(), value);
            }
        }
        let stats = database.cache_stats();
        assert_eq!(stats.used_bytes(), 0);
        assert!(stats.read_misses() > 0, "cache metrics must be enabled");
        Ok(())
    }

    #[tokio::test]
    async fn metrics_do_not_keep_a_database_open() -> Result<(), Box<dyn std::error::Error>> {
        let directory = tempfile::tempdir()?;
        let path = directory.path().join("database.redb");
        let database = open(&path, "test")?;
        let weak = Arc::downgrade(&database);
        drop(database);
        assert!(weak.upgrade().is_none());
        let reopened = open(&path, "test")?;
        drop(reopened);
        Ok(())
    }
}
