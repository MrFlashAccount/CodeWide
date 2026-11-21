//! Display-only policy summaries for a native thread list. The Codex state DB
//! has the effective sandbox and approval mode but does not store a profile id.
use std::{path::Path, time::Duration};

use rusqlite::{Connection, OpenFlags};
use serde_json::{Value, json};

/// Reads the requested rows in one `SQLite` snapshot, including archived threads.
pub(super) fn annotate(path: &Path, threads: &mut [Value]) -> rusqlite::Result<()> {
    let db = Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_ONLY)?;
    db.busy_timeout(Duration::ZERO)?;
    let ids: Vec<_> = threads.iter().map(|thread| thread["id"].as_str()).collect();
    let ids = serde_json::to_string(&ids)
        .map_err(|error| rusqlite::Error::ToSqlConversionFailure(Box::new(error)))?;
    let mut statement = db.prepare(
        "SELECT wanted.key,
                CASE WHEN json_valid(t.sandbox_policy) THEN json_extract(t.sandbox_policy, '$.type') END,
                CASE WHEN json_valid(t.approval_mode) THEN
                     CASE WHEN json_type(t.approval_mode, '$.granular') = 'object' THEN 'granular'
                          ELSE json_extract(t.approval_mode, '$') END
                     ELSE t.approval_mode END
         FROM json_each(?1) AS wanted JOIN threads AS t ON t.id = wanted.value",
    )?;
    let mut rows = statement.query([ids])?;
    while let Some(row) = rows.next()? {
        let ordinal: i64 = row.get(0)?;
        let index = usize::try_from(ordinal)
            .map_err(|_| rusqlite::Error::IntegralValueOutOfRange(0, ordinal))?;
        let sandbox = match row.get_ref(1)?.as_str().ok() {
            Some("disabled" | "danger-full-access") => "dangerFullAccess",
            Some("read-only") => "readOnly",
            Some("workspace-write") => "workspaceWrite",
            Some("external" | "external-sandbox") => "externalSandbox",
            Some("managed") => "managed",
            _ => continue,
        };
        let approval = row.get_ref(2)?.as_str().ok().filter(|name| {
            matches!(
                *name,
                "never" | "on-request" | "untrusted" | "on-failure" | "granular"
            )
        });
        threads[index]["codewideAccessPolicy"] =
            json!({"sandboxPolicy":sandbox,"approvalPolicy":approval});
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_cold_catalog_page_reports_effective_policy_without_inventing_a_named_profile()
    -> Result<(), Box<dyn std::error::Error>> {
        let directory = tempfile::tempdir()?;
        let path = directory.path().join("state.sqlite");
        let db = Connection::open(&path)?;
        db.execute_batch(
            "CREATE TABLE threads(id TEXT PRIMARY KEY, sandbox_policy TEXT, approval_mode TEXT)",
        )?;
        for (id, sandbox, approval) in [
            ("a", r#"{"type":"disabled"}"#, "never"),
            (
                "b",
                r#"{"type":"managed","file_system":{"entries":[]}}"#,
                r#"{"granular":{"sandbox_approval":true}}"#,
            ),
            ("c", r#"{"type":"workspace-write"}"#, "on-request"),
            ("d", "invalid json", "never"),
        ] {
            db.execute(
                "INSERT INTO threads VALUES (?1, ?2, ?3)",
                [id, sandbox, approval],
            )?;
        }
        let mut rows = ["absent", "b", "d", "a", "c"].map(|id| json!({"id":id}));
        annotate(&path, &mut rows)?;
        assert!(rows[0].get("codewideAccessPolicy").is_none());
        assert_eq!(
            rows[1]["codewideAccessPolicy"],
            json!({"sandboxPolicy":"managed","approvalPolicy":"granular"})
        );
        assert!(rows[2].get("codewideAccessPolicy").is_none());
        assert_eq!(
            rows[3]["codewideAccessPolicy"],
            json!({"sandboxPolicy":"dangerFullAccess","approvalPolicy":"never"})
        );
        assert_eq!(
            rows[4]["codewideAccessPolicy"],
            json!({"sandboxPolicy":"workspaceWrite","approvalPolicy":"on-request"})
        );
        assert!(
            rows.iter()
                .all(|row| row.get("codewidePermissions").is_none())
        );
        Ok(())
    }
}
