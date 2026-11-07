//! Memory of the Claude session index (manual, Linux): the peak resident
//! memory one step adds, measured in its own process (`VmHWM` minus the
//! `VmRSS` before the step), so earlier steps leave nothing behind.
//!
//! - `index <projects> <journal> <db> <session>` — advances the session on
//!   the index at `<db>` from its checkpoints (a first run indexes it whole).
//! - `page <projects> <journal> <db> <session>` — reads the newest page of
//!   20 turns from the index.
//! - `whole <projects> <session>` — the former read: every row parsed, the
//!   active branch rebuilt and every turn reconstructed.
//!
//! Prints sizes and counts only, never content. Typical run over a copy of
//! a large session: cut its file at a line boundary, `index` it, append the
//! rest, `index` again (the incremental step), then `page` and `whole`.

use std::{path::PathBuf, sync::Arc, time::Instant};

use agent_core::model::{AppThreadId, ItemsView, SortDirection};
use agent_provider_claude::{
    index::{
        history::{IndexedHistory, PageRequest},
        session::{ListedSession, index_session},
    },
    native::{files, host_state::HostStateCache, meta},
    runtime::open_elsewhere::SessionActivity,
    store::ClaudeStore,
    transcript::{
        chain::active_branch,
        reconstruct::{HistoryContext, reconstruct_turns},
    },
};
use companion_host::{
    index::StoreError,
    thread_index::{HostThreadIndex, IndexedThreadMetadata, ThreadPinSnapshot},
};

struct NoThreads;

impl HostThreadIndex for NoThreads {
    fn put_thread_metadata(&self, _metadata: &IndexedThreadMetadata) -> Result<(), StoreError> {
        Ok(())
    }

    fn put_thread_metadata_batch(
        &self,
        _metadata: &[IndexedThreadMetadata],
    ) -> Result<(), StoreError> {
        Ok(())
    }

    fn thread_descendants(&self, _root: &str) -> Result<Vec<IndexedThreadMetadata>, StoreError> {
        Ok(Vec::new())
    }

    fn thread_pin_snapshot(&self) -> Result<ThreadPinSnapshot, StoreError> {
        Ok(ThreadPinSnapshot {
            cursor: 0,
            thread_ids: Vec::new(),
        })
    }
}

/// `VmRSS` or `VmHWM` of this process, in KiB.
fn status_kib(field: &str) -> Result<u64, Box<dyn std::error::Error>> {
    let status = std::fs::read_to_string("/proc/self/status")?;
    let line = status
        .lines()
        .find(|line| line.starts_with(field))
        .ok_or("status field")?;
    Ok(line
        .split_whitespace()
        .nth(1)
        .ok_or("status value")?
        .parse()?)
}

fn store(db: &str) -> Result<Arc<ClaudeStore>, Box<dyn std::error::Error>> {
    let database = Arc::new(redb::Database::builder().set_cache_size(0).create(db)?);
    Ok(Arc::new(ClaudeStore::attach(
        database,
        Arc::new(NoThreads),
    )?))
}

fn index_step(
    projects: &str,
    journal: &str,
    db: &str,
    session: &str,
) -> Result<String, Box<dyn std::error::Error>> {
    let store = store(db)?;
    let host = HostStateCache::new(PathBuf::from(journal));
    let file = files::find_session(&PathBuf::from(projects), session).ok_or("session")?;
    let (head, tail) = files::head_and_tail(&file.path)?;
    let listing = meta::session_meta(&head, &tail).ok_or("session meta")?;
    let session_row = agent_core::model::NativeSession {
        app_thread_id: AppThreadId::parse(session).ok_or("thread id")?,
        codewide: None,
        created_at_ms: listing.created_at_ms,
        cwd: listing.cwd,
        file_size: i64::try_from(file.size).ok(),
        first_prompt: listing.first_prompt,
        interactive: listing.interactive,
        last_modified_ms: file.modified_ms,
        session_id: file.session_id.clone(),
        summary: listing.summary,
        title: listing.title,
    };
    let threads = host.threads();
    let changes = index_session(
        &store,
        &ListedSession {
            file: &file,
            session: session_row,
            owner: threads.owner_of(session),
        },
        SessionActivity::Stopped,
    )?;
    Ok(format!(
        "bytes={} turns_read={} turns_removed={}",
        file.size,
        changes.changed.len(),
        changes.removed.len()
    ))
}

fn page_step(journal: &str, db: &str, session: &str) -> Result<String, Box<dyn std::error::Error>> {
    let history = IndexedHistory::new(
        store(db)?,
        Arc::new(HostStateCache::new(PathBuf::from(journal))),
    );
    let page = history
        .page(
            &AppThreadId::parse(session).ok_or("thread id")?,
            &PageRequest {
                cursor: None,
                limit: 20,
                direction: SortDirection::Desc,
                view: ItemsView::Full,
            },
        )?
        .ok_or("not indexed")?;
    Ok(format!("turns={}", page.turns.len()))
}

fn whole_step(projects: &str, session: &str) -> Result<String, Box<dyn std::error::Error>> {
    let file = files::find_session(&PathBuf::from(projects), session).ok_or("session")?;
    let rows = std::fs::read(&file.path)?
        .split(|byte| *byte == b'\n')
        .filter(|line| !line.is_empty())
        .filter_map(|line| serde_json::from_slice(line).ok())
        .collect::<Vec<serde_json::Value>>();
    let branch = active_branch(&rows);
    let messages = branch.iter().map(AsRef::as_ref).collect::<Vec<_>>();
    let turns = reconstruct_turns(
        &messages,
        &[],
        &HistoryContext {
            app_thread_id: AppThreadId::parse(session).ok_or("thread id")?,
            cwd: String::new(),
        },
    );
    Ok(format!("bytes={} turns={}", file.size, turns.len()))
}

fn tables_step(db: &str) -> Result<String, Box<dyn std::error::Error>> {
    use redb::{ReadableDatabase, ReadableTable, ReadableTableMetadata, TableDefinition};
    let database = redb::Database::open(db)?;
    let read = database.begin_read()?;
    let tables = agent_provider_claude::store::CLAUDE_SEGMENT_TABLES;
    let mut sizes = Vec::new();
    for name in [
        tables.index.files,
        tables.index.turns,
        tables.index.turns_by_id,
        tables.index.turn_summaries,
        tables.record_keys,
        tables.scan_states,
        tables.turn_states,
        tables.facts,
    ] {
        let (rows, bytes) = if name == tables.index.turns_by_id {
            let table = read.open_table(TableDefinition::<&[u8], u64>::new(name))?;
            let bytes = table.iter()?.try_fold(0_usize, |sum, entry| {
                entry.map(|(key, _)| sum + key.value().len() + 8)
            })?;
            (table.len()?, bytes)
        } else {
            let table = read.open_table(TableDefinition::<&[u8], &[u8]>::new(name))?;
            let bytes = table.iter()?.try_fold(0_usize, |sum, entry| {
                entry.map(|(key, value)| sum + key.value().len() + value.value().len())
            })?;
            (table.len()?, bytes)
        };
        sizes.push(format!("{name}: rows={rows} bytes={bytes}"));
    }
    Ok(sizes.join("\n"))
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let args = std::env::args().skip(1).collect::<Vec<_>>();
    let mode = args.first().map(String::as_str).ok_or("mode")?;
    let before = status_kib("VmRSS:")?;
    std::fs::write("/proc/self/clear_refs", "5")?;
    let started = Instant::now();
    let detail = match (mode, args.as_slice()) {
        ("index", [_, projects, journal, db, session]) => {
            index_step(projects, journal, db, session)?
        }
        ("page", [_, _projects, journal, db, session]) => page_step(journal, db, session)?,
        ("whole", [_, projects, session]) => whole_step(projects, session)?,
        ("tables", [_, db]) => tables_step(db)?,
        _ => return Err("usage: index|page|whole|tables …".into()),
    };
    let peak = status_kib("VmHWM:")?;
    println!(
        "{mode}: {detail} elapsed_ms={} peak_added_kib={}",
        started.elapsed().as_millis(),
        peak.saturating_sub(before)
    );
    Ok(())
}
