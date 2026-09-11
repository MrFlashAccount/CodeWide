use super::SearchError;
use crate::catalog::SearchCatalogEntry;
use rusqlite::{Connection, OptionalExtension, params};
use std::collections::HashSet;

pub(super) fn update(db: &mut Connection, entry: &SearchCatalogEntry) -> Result<(), SearchError> {
    if entry.title.is_empty() {
        return Ok(());
    }
    let existing: Option<(String, String, String)> = db.query_row("SELECT m.body,s.cwd,m.timestamp FROM messages_content m JOIN sources s ON s.thread_id=m.thread_id WHERE m.thread_id=?1 AND m.kind='thread'", [&entry.thread_id], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?))).optional()?;
    if existing.as_ref().is_some_and(|(title, cwd, timestamp)| {
        title == &entry.title && cwd == &entry.cwd && timestamp == &entry.timestamp
    }) {
        return Ok(());
    }
    let transaction = db.transaction()?;
    transaction.execute(
        "UPDATE sources SET title=?2,cwd=?3 WHERE thread_id=?1",
        params![entry.thread_id, entry.title, entry.cwd],
    )?;
    transaction.execute(
        "DELETE FROM messages_content WHERE thread_id=?1 AND kind='thread'",
        [&entry.thread_id],
    )?;
    transaction.execute("INSERT INTO messages_content(body,thread_id,turn_id,timestamp,source_offset,kind) VALUES(?1,?2,'',?3,0,'thread')", params![entry.title,entry.thread_id,entry.timestamp])?;
    transaction.commit()?;
    Ok(())
}

/// Catalog deletion removes derived search data, never canonical history.
pub(super) fn prune(
    db: &mut Connection,
    entries: &[SearchCatalogEntry],
) -> Result<(), SearchError> {
    let retained: HashSet<_> = entries
        .iter()
        .map(|entry| entry.thread_id.as_str())
        .collect();
    let mut statement = db.prepare("SELECT thread_id FROM sources")?;
    let obsolete = statement
        .query_map([], |row| row.get::<_, String>(0))?
        .collect::<Result<Vec<_>, _>>()?
        .into_iter()
        .filter(|id| !retained.contains(id.as_str()))
        .collect::<Vec<_>>();
    drop(statement);
    for id in obsolete {
        remove(db, &id)?;
    }
    Ok(())
}

pub(super) fn remove(db: &mut Connection, thread_id: &str) -> Result<(), SearchError> {
    let transaction = db.transaction()?;
    transaction.execute(
        "DELETE FROM messages_content WHERE thread_id=?1",
        [thread_id],
    )?;
    transaction.execute("DELETE FROM turns WHERE thread_id=?1", [thread_id])?;
    transaction.execute("DELETE FROM sources WHERE thread_id=?1", [thread_id])?;
    transaction.commit()?;
    Ok(())
}
