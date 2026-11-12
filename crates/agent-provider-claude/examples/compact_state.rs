//! Reclaiming a companion index database after the Claude index migration
//! (manual): runs the migration on a copy of `state.redb`, then the
//! companion's own `compact_if_sparse`, and checks that every table kept
//! its rows. Never point it at the live file. Prints sizes, counts and
//! durations only.
//!
//! `cargo run --release -p agent-provider-claude --example compact_state -- <copy of state.redb>`

use std::{collections::BTreeMap, time::Instant};

use companion_host::index::DerivedIndexSchema;
use redb::{ReadableDatabase, ReadableTableMetadata, TableHandle};

/// Rows per table, by name.
fn table_rows(
    database: &redb::Database,
) -> Result<BTreeMap<String, u64>, Box<dyn std::error::Error>> {
    let read = database.begin_read()?;
    let mut rows = BTreeMap::new();
    for table in read.list_tables()? {
        let name = table.name().to_owned();
        rows.insert(name, read.open_untyped_table(table)?.len()?);
    }
    Ok(rows)
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let path = std::env::args()
        .nth(1)
        .ok_or("usage: compact_state <copy of state.redb>")?;
    let path = std::path::Path::new(&path);
    let started = Instant::now();
    let mut database = companion_host::database::open_owned(path)?;
    println!(
        "opened in {} ms, {} bytes",
        started.elapsed().as_millis(),
        std::fs::metadata(path)?.len()
    );
    let started = Instant::now();
    let write = database.begin_write()?;
    agent_provider_claude::store::CLAUDE_INDEX_SCHEMA.migrate(&write, false)?;
    write.commit()?;
    println!("migrated in {} ms", started.elapsed().as_millis());
    let before = table_rows(&database)?;
    let compaction = companion_host::database::compact_if_sparse(&mut database, path, "index")?;
    println!("{compaction:?}");
    let after = table_rows(&database)?;
    println!("tables {} rows kept: {}", after.len(), before == after);
    let started = Instant::now();
    println!(
        "integrity {:?} in {} ms",
        database.check_integrity()?,
        started.elapsed().as_millis()
    );
    Ok(())
}
