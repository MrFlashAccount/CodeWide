//! Companion owns ordinary-catalog membership. Raw thread access remains available
//! to the supervisor; neither device binding state nor titles decide visibility.
use std::{collections::HashMap, path::PathBuf, sync::Mutex};

use rusqlite::{Connection, OpenFlags, OptionalExtension};
use serde_json::Value;

pub(crate) const SUPERVISOR_SOURCE_PREFIX: &str = "codewide-global-supervisor:";
pub(crate) const EXCLUDED_FIELD: &str = "codewideCatalogExcluded";
pub(crate) const ORDINARY_SOURCE_SQL: &str =
    "(thread_source IS NULL OR thread_source NOT GLOB 'codewide-global-supervisor:*')";

pub(crate) fn excludes_thread(thread: &Value) -> bool {
    thread.get("ephemeral").and_then(Value::as_bool) == Some(true)
        || thread
            .get("threadSource")
            .and_then(Value::as_str)
            .is_some_and(|source| source.starts_with(SUPERVISOR_SOURCE_PREFIX))
}

pub(crate) fn annotate_thread(thread: &mut Value) {
    let excluded = excludes_thread(thread);
    if let Some(thread) = thread.as_object_mut() {
        thread.insert(EXCLUDED_FIELD.into(), Value::Bool(excluded));
    }
}

/// Thread source is immutable. Cache resolved identities, but never cache a
/// missing row: a start notification may precede the upstream `SQLite` commit.
pub(crate) struct CatalogVisibility {
    path: PathBuf,
    known: Mutex<HashMap<String, bool>>,
}

impl CatalogVisibility {
    pub(crate) fn new(path: PathBuf) -> Self {
        Self {
            path,
            known: Mutex::new(HashMap::new()),
        }
    }

    pub(crate) fn filter_page(
        &self,
        result: &mut Value,
        supervisor_source: Option<&str>,
    ) -> Result<(), rusqlite::Error> {
        // State-db-only App Server lists can omit threadSource even when the
        // canonical row has it. Resolve all omissions through one read connection.
        if let Some(threads) = result.get_mut("data").and_then(Value::as_array_mut) {
            let needs_source =
                |thread: &Value| thread.get("threadSource").and_then(Value::as_str).is_none();
            if threads.iter().any(needs_source) && self.path.is_file() {
                let db = Connection::open_with_flags(&self.path, OpenFlags::SQLITE_OPEN_READ_ONLY)?;
                let mut query = db.prepare("SELECT thread_source FROM threads WHERE id = ?1")?;
                for thread in threads.iter_mut().filter(|thread| needs_source(thread)) {
                    let Some(id) = thread.get("id").and_then(Value::as_str) else {
                        continue;
                    };
                    let source: Option<Option<String>> =
                        query.query_row([id], |row| row.get(0)).optional()?;
                    if let Some(Some(source)) = source {
                        thread["threadSource"] = Value::String(source);
                    }
                }
            }
        }
        filter_page(result, supervisor_source);
        Ok(())
    }

    pub(crate) fn excluded(&self, id: &str) -> Result<bool, rusqlite::Error> {
        let mut known = self
            .known
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        if let Some(excluded) = known.get(id) {
            return Ok(*excluded);
        }
        if !self.path.is_file() {
            return Ok(false);
        }
        let db = Connection::open_with_flags(&self.path, OpenFlags::SQLITE_OPEN_READ_ONLY)?;
        let source: Option<Option<String>> = db
            .query_row(
                "SELECT thread_source FROM threads WHERE id = ?1",
                [id],
                |row| row.get(0),
            )
            .optional()?;
        let Some(source) = source else {
            return Ok(false);
        };
        let excluded = source.is_some_and(|source| source.starts_with(SUPERVISOR_SOURCE_PREFIX));
        known.insert(id.to_owned(), excluded);
        Ok(excluded)
    }

    pub(crate) fn event(&self, mut payload: Value) -> Result<Value, rusqlite::Error> {
        let thread = payload.pointer("/params/thread");
        let id = payload
            .pointer("/params/threadId")
            .and_then(Value::as_str)
            .or_else(|| {
                thread
                    .and_then(|thread| thread.get("id"))
                    .and_then(Value::as_str)
            })
            .or_else(|| {
                payload
                    .pointer("/codewideThreadPatch/threadId")
                    .and_then(Value::as_str)
            });
        let Some(id) = id else {
            return Ok(payload);
        };
        let excluded = if let Some(thread) = thread.filter(|thread| {
            excludes_thread(thread) || thread.get("threadSource").and_then(Value::as_str).is_some()
        }) {
            let excluded = excludes_thread(thread);
            self.known
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner)
                .insert(id.to_owned(), excluded);
            excluded
        } else {
            self.excluded(id)?
        };
        if let Some(object) = payload.as_object_mut() {
            object.insert(EXCLUDED_FIELD.into(), Value::Bool(excluded));
        }
        Ok(payload)
    }
}

/// Filter one upstream page, retaining its opaque continuation even for an empty
/// page. Only null exhausts a catalog. No device-side row-count inference is valid.
fn filter_page(result: &mut Value, supervisor_source: Option<&str>) {
    if let Some(threads) = result.get_mut("data").and_then(Value::as_array_mut) {
        threads.retain(|thread| match supervisor_source {
            Some(source) => thread.get("threadSource").and_then(Value::as_str) == Some(source),
            None => {
                !excludes_thread(thread) && thread.get("parentThreadId").is_none_or(Value::is_null)
            }
        });
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn omitted_list_sources_use_canonical_membership_and_keep_private_reconciliation()
    -> Result<(), Box<dyn std::error::Error>> {
        let temp = tempfile::tempdir()?;
        let path = temp.path().join("state.sqlite");
        let db = Connection::open(&path)?;
        db.execute_batch("CREATE TABLE threads (id TEXT PRIMARY KEY, thread_source TEXT); INSERT INTO threads VALUES ('home','codewide-global-supervisor:device'), ('ordinary',NULL)")?;
        let visibility = CatalogVisibility::new(path);
        let mut ordinary = json!({"data":[
            {"id":"home","threadSource":null},
            {"id":"ordinary","threadSource":null},
            {"id":"not-committed-yet"}
        ],"nextCursor":"opaque-next"});
        visibility.filter_page(&mut ordinary, None)?;
        assert_eq!(
            ordinary,
            json!({"data":[
            {"id":"ordinary","threadSource":null},
            {"id":"not-committed-yet"}
        ],"nextCursor":"opaque-next"})
        );

        let mut private = json!({"data":[{"id":"home"}],"nextCursor":null});
        visibility.filter_page(&mut private, Some("codewide-global-supervisor:device"))?;
        assert_eq!(private["data"][0]["id"], "home");
        assert_eq!(private["data"].as_array().map(Vec::len), Some(1));

        let mut empty = json!({"data":[{"id":"home","threadSource":null}],"nextCursor":"next"});
        visibility.filter_page(&mut empty, None)?;
        assert_eq!(empty, json!({"data":[],"nextCursor":"next"}));
        Ok(())
    }

    #[test]
    fn null_event_source_does_not_override_canonical_or_known_exclusion()
    -> Result<(), Box<dyn std::error::Error>> {
        let temp = tempfile::tempdir()?;
        let path = temp.path().join("state.sqlite");
        let db = Connection::open(&path)?;
        db.execute_batch("CREATE TABLE threads (id TEXT PRIMARY KEY, thread_source TEXT); INSERT INTO threads VALUES ('home','codewide-global-supervisor:device'), ('ordinary',NULL)")?;
        let visibility = CatalogVisibility::new(path);
        for id in ["home", "ordinary"] {
            let expected = id == "home";
            let event = json!({"method":"thread/started","params":{"thread":{"id":id,"threadSource":null}}});
            assert_eq!(visibility.event(event)?[EXCLUDED_FIELD], expected);
            let next = json!({"method":"turn/started","params":{"threadId":id}});
            assert_eq!(visibility.event(next)?[EXCLUDED_FIELD], expected);
        }
        let started = json!({"method":"thread/started","params":{"thread":{"id":"new","threadSource":"codewide-global-supervisor:new"}}});
        assert_eq!(visibility.event(started)?[EXCLUDED_FIELD], true);
        let missing =
            json!({"method":"thread/started","params":{"thread":{"id":"new","threadSource":null}}});
        assert_eq!(visibility.event(missing)?[EXCLUDED_FIELD], true);
        Ok(())
    }

    #[test]
    fn canonical_read_errors_do_not_publish_an_unfiltered_page()
    -> Result<(), Box<dyn std::error::Error>> {
        let temp = tempfile::tempdir()?;
        let path = temp.path().join("state.sqlite");
        let _db = Connection::open(&path)?;
        let visibility = CatalogVisibility::new(path);
        let mut page = json!({"data":[{"id":"home","threadSource":null}],"nextCursor":null});
        assert!(visibility.filter_page(&mut page, None).is_err());
        Ok(())
    }

    #[test]
    fn ordinary_pages_exclude_all_supervisors_and_preserve_empty_continuations() {
        let mut page = json!({"data": [
            {"id":"one", "threadSource":"codewide-global-supervisor:device-a"},
            {"id":"two", "threadSource":"codewide-global-supervisor:device-b"},
            {"id":"ephemeral", "ephemeral":true},
            {"id":"child", "parentThreadId":"parent"}
        ], "nextCursor":"opaque-next"});
        filter_page(&mut page, None);
        assert_eq!(page, json!({"data":[], "nextCursor":"opaque-next"}));
        let mut tail = json!({"data":[{"id":"ordinary", "name":"Global Voice", "threadSource":null}], "nextCursor":null});
        filter_page(&mut tail, None);
        assert_eq!(tail["data"][0]["id"], "ordinary");
        assert!(tail["nextCursor"].is_null());
    }

    #[test]
    fn reconciliation_has_a_separate_exact_source_page() {
        let mut page = json!({"data":[
            {"id":"one", "threadSource":"codewide-global-supervisor:a"},
            {"id":"two", "threadSource":"codewide-global-supervisor:b"},
            {"id":"ordinary", "threadSource":null}
        ], "nextCursor":"next"});
        filter_page(&mut page, Some("codewide-global-supervisor:b"));
        assert_eq!(
            page["data"],
            json!([{"id":"two", "threadSource":"codewide-global-supervisor:b"}])
        );
        assert_eq!(page["nextCursor"], "next");
    }

    #[test]
    fn replay_and_live_events_keep_private_payload_but_remove_catalog_membership()
    -> Result<(), Box<dyn std::error::Error>> {
        let temp = tempfile::tempdir()?;
        let path = temp.path().join("state.sqlite");
        let db = Connection::open(&path)?;
        db.execute_batch("CREATE TABLE threads (id TEXT PRIMARY KEY, thread_source TEXT); INSERT INTO threads VALUES ('home','codewide-global-supervisor:old'), ('ordinary',NULL)")?;
        let visibility = CatalogVisibility::new(path);
        let raw = json!({"method":"companion/thread/progress", "params":{"threadId":"home"}, "codewideThreadPatch":{"version":1,"threadId":"home","operation":{"kind":"threadProgress"}}});
        let replay = visibility.event(raw.clone())?;
        assert_eq!(replay[EXCLUDED_FIELD], true);
        assert_eq!(replay["params"], raw["params"]);
        assert_eq!(replay["codewideThreadPatch"], raw["codewideThreadPatch"]);
        let started = visibility.event(json!({"method":"thread/started","params":{"thread":{"id":"new","threadSource":"codewide-global-supervisor:new"}}}))?;
        assert_eq!(started[EXCLUDED_FIELD], true);
        // A source observed before SQLite commit fences subsequent id-only events.
        assert_eq!(
            visibility.event(json!({"method":"turn/started","params":{"threadId":"new"}}))?
                [EXCLUDED_FIELD],
            true
        );
        assert_eq!(
            visibility.event(json!({"method":"turn/started","params":{"threadId":"ordinary"}}))?
                [EXCLUDED_FIELD],
            false
        );
        Ok(())
    }

    #[test]
    fn missing_identity_is_rechecked_after_canonical_commit()
    -> Result<(), Box<dyn std::error::Error>> {
        let temp = tempfile::tempdir()?;
        let path = temp.path().join("state.sqlite");
        let db = Connection::open(&path)?;
        db.execute_batch("CREATE TABLE threads (id TEXT PRIMARY KEY, thread_source TEXT)")?;
        let visibility = CatalogVisibility::new(path);
        assert!(!visibility.excluded("later")?);
        db.execute_batch(
            "INSERT INTO threads VALUES ('later', 'codewide-global-supervisor:later')",
        )?;
        assert!(visibility.excluded("later")?);
        Ok(())
    }
}
