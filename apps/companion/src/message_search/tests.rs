use super::{SearchQuery, index, query};
use rusqlite::Connection;
use serde_json::json;
use std::{fs::OpenOptions, io::Write};

fn record(kind: &str, payload: &serde_json::Value) -> String {
    format!(
        "{}\n",
        json!({"type":kind,"timestamp":"2026-09-06T10:00:00Z","payload":payload})
    )
}

fn history(text: &str) -> String {
    [
        record("session_meta", &json!({"cwd":"/project"})),
        record(
            "event_msg",
            &json!({"type":"task_started","turn_id":"turn-a"}),
        ),
        record("event_msg", &json!({"type":"user_message","message":text})),
        record(
            "event_msg",
            &json!({"type":"agent_message","message":"Ответ с кириллицей"}),
        ),
    ]
    .concat()
}

fn database() -> rusqlite::Result<Connection> {
    let db = Connection::open_in_memory()?;
    db.execute_batch(include_str!("schema.sql"))?;
    Ok(db)
}

#[test]
fn search_window_reads_old_canonical_turns_without_a_reverse_history_index()
-> Result<(), Box<dyn std::error::Error>> {
    let temp = tempfile::tempdir()?;
    let path = temp.path().join("rollout.jsonl");
    let mut records = history("needle");
    records.push_str(&record(
        "event_msg",
        &json!({"type":"user_message","message":"needle"}),
    ));
    for number in 0..40 {
        records.push_str(&record(
            "event_msg",
            &json!({"type":"task_started","turn_id":format!("turn-{number}")}),
        ));
        records.push_str(&record(
            "event_msg",
            &json!({"type":"agent_message","message":format!("answer {number}")}),
        ));
        records.push_str(&record(
            "event_msg",
            &json!({"type":"task_complete","turn_id":format!("turn-{number}")}),
        ));
    }
    std::fs::write(&path, &records)?;
    let mut db = database()?;
    index::advance(&mut db, &path, "thread-a")?;
    let hits = query::read(
        &db,
        &SearchQuery {
            query: "needle".into(),
            ..SearchQuery::default()
        },
    )?;
    assert_eq!(hits.data.len(), 2);
    let target = hits.data[1].message_id;
    let request = serde_json::from_value(
        json!({"threadId":"thread-a","messageId":target,"direction":"around"}),
    )?;
    let window = super::window::read(&db, &request)?;
    let turns = window["turns"].as_array().ok_or("missing turns")?;
    assert!(turns.len() < 15);
    let first = turns
        .iter()
        .find(|turn| turn["id"] == "turn-a")
        .ok_or("missing target turn")?;
    let items = first["items"].as_array().ok_or("missing items")?;
    assert_eq!(
        items
            .iter()
            .filter(|item| item["type"] == "userMessage")
            .count(),
        2
    );
    assert!(
        items
            .iter()
            .any(|item| item["id"] == format!("search-message:{target}"))
    );
    assert_eq!(first["itemsView"], "summary");
    // Same inode and length do not make an in-place rewritten source valid.
    std::fs::write(&path, records.replace("needle", "broken"))?;
    assert!(super::window::read(&db, &request).is_err());
    Ok(())
}

#[test]
fn protocol_mirrors_preserve_repeated_messages_and_response_only_content()
-> Result<(), Box<dyn std::error::Error>> {
    let temp = tempfile::tempdir()?;
    let path = temp.path().join("rollout.jsonl");
    let mut records = history("Test");
    records.push_str(&record(
        "event_msg",
        &json!({"type":"user_message","message":"Test"}),
    ));
    for _ in 0..2 {
        records.push_str(&record("response_item", &json!({"type":"message","role":"user","content":[{"type":"input_text","text":"Test"}]})));
    }
    records.push_str(&record("response_item", &json!({"type":"message","role":"assistant","content":[{"type":"output_text","text":"unique commentary"}]})));
    records.push_str(&record("event_msg", &json!({"type":"item_completed","item":{"type":"userMessage","content":[{"type":"text","text":"item prompt"}]}})));
    std::fs::write(&path, records)?;
    let mut db = database()?;
    index::advance(&mut db, &path, "thread-a")?;
    for (text, count) in [("Test", 2), ("commentary", 1), ("item prompt", 1)] {
        let result = query::read(
            &db,
            &SearchQuery {
                query: text.into(),
                ..SearchQuery::default()
            },
        )?;
        assert_eq!(result.data.len(), count, "{text}");
    }
    Ok(())
}

fn context_page(
    db: &Connection,
    id: i64,
    direction: &str,
) -> Result<serde_json::Value, Box<dyn std::error::Error>> {
    let request = serde_json::from_value(
        json!({"threadId":"thread-a","messageId":id,"direction":direction}),
    )?;
    Ok(serde_json::to_value(super::context::read(db, &request)?)?)
}

#[test]
fn context_pages_survive_restart_and_reject_replaced_hits() -> Result<(), Box<dyn std::error::Error>>
{
    let temp = tempfile::tempdir()?;
    let path = temp.path().join("rollout.jsonl");
    let mut records = history("needle");
    for index in 0..40 {
        records.push_str(&record(
            "event_msg",
            &json!({"type":"agent_message","message":format!("entry{index:02}")}),
        ));
    }
    std::fs::write(&path, records)?;
    let db_path = temp.path().join("search.sqlite");
    let mut db = Connection::open(&db_path)?;
    db.execute_batch(include_str!("schema.sql"))?;
    index::advance(&mut db, &path, "thread-a")?;
    drop(db);
    let mut db = Connection::open(&db_path)?;
    let hit = query::read(
        &db,
        &SearchQuery {
            query: "entry20".into(),
            ..SearchQuery::default()
        },
    )?
    .data
    .remove(0);
    let around = context_page(&db, hit.message_id, "around")?;
    let messages = around["messages"].as_array().ok_or("missing context")?;
    assert!(messages.iter().any(|message| message["text"] == "entry20"));
    let older = context_page(
        &db,
        around["older"].as_i64().ok_or("missing older")?,
        "older",
    )?;
    let newer = context_page(
        &db,
        around["newer"].as_i64().ok_or("missing newer")?,
        "newer",
    )?;
    assert_eq!(
        older["messages"]
            .as_array()
            .and_then(|messages| messages.last())
            .map(|m| &m["text"]),
        Some(&json!("entry14"))
    );
    assert_eq!(
        messages.first().map(|m| &m["text"]),
        Some(&json!("entry15"))
    );
    assert_eq!(messages.last().map(|m| &m["text"]), Some(&json!("entry26")));
    assert_eq!(newer["messages"][0]["text"], "entry27");
    // Same inode, rewritten and longer: an old row id cannot point into new text.
    std::fs::write(&path, history(&"replacement ".repeat(2000)))?;
    index::advance(&mut db, &path, "thread-a")?;
    assert!(context_page(&db, hit.message_id, "around").is_err());
    assert!(
        query::read(
            &db,
            &SearchQuery {
                query: "entry20".into(),
                ..SearchQuery::default()
            }
        )?
        .data
        .is_empty()
    );
    Ok(())
}

#[test]
fn catalog_rename_project_move_and_deletion_update_search() -> Result<(), Box<dyn std::error::Error>>
{
    let temp = tempfile::tempdir()?;
    let path = temp.path().join("rollout.jsonl");
    std::fs::write(&path, history("body"))?;
    let mut db = database()?;
    index::advance(&mut db, &path, "thread-a")?;
    let mut entry = crate::catalog::SearchCatalogEntry {
        thread_id: "thread-a".into(),
        path,
        title: "original name".into(),
        cwd: "/project".into(),
        timestamp: "2026-09-06T10:00:00Z".into(),
    };
    super::catalog::update(&mut db, &entry)?;
    entry.title = "renamed chat".into();
    entry.cwd = "/moved".into();
    super::catalog::update(&mut db, &entry)?;
    assert!(
        query::read(
            &db,
            &SearchQuery {
                query: "original".into(),
                ..SearchQuery::default()
            }
        )?
        .data
        .is_empty()
    );
    assert_eq!(
        query::read(
            &db,
            &SearchQuery {
                query: "renamed".into(),
                project: Some("/moved".into()),
                ..SearchQuery::default()
            }
        )?
        .data
        .len(),
        1
    );
    super::catalog::prune(&mut db, &[])?;
    assert!(
        query::read(
            &db,
            &SearchQuery {
                query: "body".into(),
                ..SearchQuery::default()
            }
        )?
        .data
        .is_empty()
    );
    Ok(())
}

#[test]
fn search_is_persistent_idempotent_and_never_needs_the_source()
-> Result<(), Box<dyn std::error::Error>> {
    let temp = tempfile::tempdir()?;
    let path = temp.path().join("rollout.jsonl");
    std::fs::write(&path, history("A needle beyond the loaded chat window"))?;
    let mut db = database()?;
    assert!(index::advance(&mut db, &path, "thread-a")?);
    assert!(index::advance(&mut db, &path, "thread-a")?);
    std::fs::remove_file(&path)?;
    let query = SearchQuery {
        query: "needle".into(),
        ..SearchQuery::default()
    };
    let page = query::read(&db, &query)?;
    assert_eq!(page.data.len(), 1);
    assert_eq!(page.data[0].thread_id, "thread-a");
    assert_eq!(page.data[0].turn_id, "turn-a");
    assert!(page.data[0].excerpt.contains("needle"));
    Ok(())
}

#[test]
fn filters_and_unicode_are_applied_to_indexed_documents() -> Result<(), Box<dyn std::error::Error>>
{
    let temp = tempfile::tempdir()?;
    let path = temp.path().join("rollout.jsonl");
    std::fs::write(&path, history("hello"))?;
    let mut db = database()?;
    index::advance(&mut db, &path, "thread-a")?;
    let mut request = SearchQuery {
        query: "КИРИЛ".into(),
        project: Some("/project".into()),
        ..SearchQuery::default()
    };
    assert_eq!(query::read(&db, &request)?.data.len(), 1);
    request.thread_id = Some("other".into());
    assert!(query::read(&db, &request)?.data.is_empty());
    request.thread_id = None;
    request.until = Some("2026-09-06T00:00:00Z".into());
    assert!(query::read(&db, &request)?.data.is_empty());
    request.until = Some("invalid".into());
    assert!(query::read(&db, &request).is_err());
    Ok(())
}

#[test]
fn partial_append_rollback_and_replacement_do_not_leave_phantom_hits()
-> Result<(), Box<dyn std::error::Error>> {
    let temp = tempfile::tempdir()?;
    let path = temp.path().join("rollout.jsonl");
    std::fs::write(&path, history("original needle"))?;
    let mut db = database()?;
    index::advance(&mut db, &path, "thread-a")?;
    let next = record(
        "event_msg",
        &json!({"type":"agent_message","message":"second needle"}),
    );
    let split = next.len() / 2;
    let mut file = OpenOptions::new().append(true).open(&path)?;
    file.write_all(&next.as_bytes()[..split])?;
    index::advance(&mut db, &path, "thread-a")?;
    let request = SearchQuery {
        query: "needle".into(),
        ..SearchQuery::default()
    };
    assert_eq!(query::read(&db, &request)?.data.len(), 1);
    file.write_all(&next.as_bytes()[split..])?;
    index::advance(&mut db, &path, "thread-a")?;
    assert_eq!(query::read(&db, &request)?.data.len(), 2);
    file.write_all(
        record(
            "event_msg",
            &json!({"type":"thread_rolled_back","num_turns":1}),
        )
        .as_bytes(),
    )?;
    index::advance(&mut db, &path, "thread-a")?;
    assert!(query::read(&db, &request)?.data.is_empty());
    let replacement = temp.path().join("replacement.jsonl");
    std::fs::write(&replacement, history("replacement needle"))?;
    std::fs::rename(replacement, &path)?;
    index::advance(&mut db, &path, "thread-a")?;
    assert_eq!(query::read(&db, &request)?.data.len(), 1);
    Ok(())
}

#[test]
fn malformed_durable_record_is_skipped_and_later_turns_remain_searchable()
-> Result<(), Box<dyn std::error::Error>> {
    let temp = tempfile::tempdir()?;
    let path = temp.path().join("rollout.jsonl");
    let malformed =
        "{\"type\":\"response_item\",\"payload\":{\"type\":\"reasoning\",\"text\":\"truncated\n";
    let records = [
        history("before corruption"),
        malformed.into(),
        record(
            "event_msg",
            &json!({"type":"task_started","turn_id":"turn-after"}),
        ),
        record(
            "event_msg",
            &json!({"type":"agent_message","message":"searchable after corruption"}),
        ),
    ]
    .concat();
    std::fs::write(&path, &records)?;
    let mut db = database()?;

    assert!(index::advance(&mut db, &path, "thread-a")?);
    assert!(index::advance(&mut db, &path, "thread-a")?);

    let page = query::read(
        &db,
        &SearchQuery {
            query: "searchable".into(),
            ..SearchQuery::default()
        },
    )?;
    assert_eq!(page.data.len(), 1);
    assert_eq!(page.data[0].turn_id, "turn-after");
    let indexed_offset: i64 = db.query_row(
        "SELECT offset FROM sources WHERE thread_id='thread-a'",
        [],
        |row| row.get(0),
    )?;
    assert_eq!(usize::try_from(indexed_offset)?, records.len());
    Ok(())
}
