//! Companion-owned redb page-cache budget; durable data remains on disk.

use std::{path::Path, sync::Arc, time::Duration};

use redb::{Database, DatabaseError, ReadableDatabase};

const CACHE_BYTES: usize = 0;

pub(crate) fn open(
    path: impl AsRef<Path>,
    name: &'static str,
) -> Result<Arc<Database>, DatabaseError> {
    // The OS already caches file pages and can reclaim them under pressure.
    // Avoid an additional, independently budgeted 1 GiB cache per database.
    let database = Arc::new(
        Database::builder()
            .set_cache_size(CACHE_BYTES)
            .create(path)?,
    );
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
    Ok(database)
}

#[cfg(test)]
mod tests {
    use super::*;
    use redb::TableDefinition;

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
