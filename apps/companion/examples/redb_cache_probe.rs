//! Compare page-cache budgets on disposable databases, never production state.

use std::{error::Error, time::Instant};

use redb::{Database, ReadableDatabase, TableDefinition};

const VALUES: TableDefinition<u64, &[u8]> = TableDefinition::new("values");
const RECORDS: u64 = 2048;
const WINDOWS: u64 = 128;
const WINDOW_RECORDS: u64 = 36;

fn probe(cache_bytes: usize) -> Result<(), Box<dyn Error>> {
    let directory = tempfile::tempdir()?;
    let database = Database::builder()
        .set_cache_size(cache_bytes)
        .create(directory.path().join("probe.redb"))?;
    let value = vec![7_u8; 4096];
    let started = Instant::now();
    {
        let write = database.begin_write()?;
        {
            let mut table = write.open_table(VALUES)?;
            for key in 0..RECORDS {
                table.insert(key, value.as_slice())?;
            }
        }
        write.commit()?;
    }
    let initial_write_ms = started.elapsed().as_secs_f64() * 1000.0;
    let started = Instant::now();
    for window in 0..WINDOWS {
        let read = database.begin_read()?;
        let table = read.open_table(VALUES)?;
        for offset in 0..WINDOW_RECORDS {
            let key = (window * 97 + offset) % RECORDS;
            let stored = table.get(key)?.ok_or("missing record")?;
            if stored.value() != value {
                return Err("incorrect record".into());
            }
        }
    }
    let windows_ms = started.elapsed().as_secs_f64() * 1000.0;
    let started = Instant::now();
    for key in 0..100 {
        let write = database.begin_write()?;
        {
            let mut table = write.open_table(VALUES)?;
            table.insert(key, value.as_slice())?;
        }
        write.commit()?;
    }
    let updates_ms = started.elapsed().as_secs_f64() * 1000.0;
    let stats = database.cache_stats();
    println!(
        "{}",
        serde_json::json!({
            "cache_budget_bytes": cache_bytes,
            "cache_used_bytes": stats.used_bytes(),
            "initial_write_ms": initial_write_ms,
            "windows": WINDOWS,
            "records_per_window": WINDOW_RECORDS,
            "windows_ms": windows_ms,
            "updates": 100,
            "updates_ms": updates_ms,
            "read_hits": stats.read_hits(),
            "read_misses": stats.read_misses(),
        })
    );
    Ok(())
}

fn main() -> Result<(), Box<dyn Error>> {
    for cache_bytes in [0, 8 * 1024 * 1024, 1024 * 1024 * 1024] {
        probe(cache_bytes)?;
    }
    Ok(())
}
