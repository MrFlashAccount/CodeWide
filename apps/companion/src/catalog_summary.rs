use std::path::Path;

use rusqlite::{Connection, OpenFlags};
use serde::Serialize;

/// Counts the interactive catalog, independently of the requested page or archive partition.
#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CatalogSummary {
    pub archived_count: u64,
}

pub(crate) fn read(path: &Path) -> Result<CatalogSummary, rusqlite::Error> {
    let db = Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_ONLY)?;
    db.busy_timeout(std::time::Duration::ZERO)?;
    // Match the interactive source filter used by CodeWide's catalog requests.
    // Spawned-agent sources are JSON objects, not these root source names.
    let count: i64 = db.query_row(
        "SELECT COUNT(*) FROM threads WHERE archived = 1 AND source IN ('cli', 'vscode')",
        [],
        |row| row.get(0),
    )?;
    let archived_count =
        u64::try_from(count).map_err(|_| rusqlite::Error::IntegralValueOutOfRange(0, count))?;
    Ok(CatalogSummary { archived_count })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn counts_the_full_archive_and_tracks_archive_changes() -> Result<(), Box<dyn std::error::Error>>
    {
        let temp = tempfile::tempdir()?;
        let path = temp.path().join("state.sqlite");
        let db = Connection::open(&path)?;
        db.execute_batch("CREATE TABLE threads (id INTEGER PRIMARY KEY, source TEXT NOT NULL, archived INTEGER NOT NULL)")?;
        for id in 0..80 {
            db.execute("INSERT INTO threads VALUES (?1, 'vscode', 1)", [id])?;
        }
        db.execute_batch("INSERT INTO threads VALUES (80, 'cli', 0), (81, '{\"subagent\":{}}', 1), (82, 'exec', 1)")?;
        assert_eq!(read(&path)?.archived_count, 80);
        db.execute("UPDATE threads SET archived = 1 WHERE id = 80", [])?;
        assert_eq!(read(&path)?.archived_count, 81);
        db.execute("UPDATE threads SET archived = 0 WHERE id = 0", [])?;
        assert_eq!(read(&path)?.archived_count, 80);
        assert!(read(&temp.path().join("missing.sqlite")).is_err());
        Ok(())
    }
}
