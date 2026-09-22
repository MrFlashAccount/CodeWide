//! Search owns a historical viewport, never the live thread's cache or cursor.
use std::{collections::HashSet, fs::File, os::unix::fs::MetadataExt};

use rusqlite::{Connection, params};
use serde_json::{Value, json};

use super::{ContextQuery, SearchError, context, index};
use crate::{history::project_summary_turn_from_file, store::TurnRef};

pub(super) fn read(db: &Connection, query: &ContextQuery) -> Result<Value, SearchError> {
    let page = context::read(db, query)?;
    let (path, identity, end, checkpoint): (String, String, i64, Vec<u8>) = db.query_row(
        "SELECT path, identity, offset, checkpoint FROM sources WHERE thread_id=?1",
        [&query.thread_id],
        |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
    )?;
    let file = File::open(path)?;
    let metadata = file.metadata()?;
    let file_end = u64::try_from(end).map_err(|_| SearchError::InvalidQuery)?;
    if identity != format!("{}:{}", metadata.dev(), metadata.ino()) || metadata.len() < file_end {
        return Err(SearchError::InvalidQuery);
    }
    if index::checkpoint(&file, end)? != checkpoint {
        return Err(SearchError::InvalidQuery);
    }
    let mut seen = HashSet::new();
    let mut turns = Vec::new();
    for message in &page.messages {
        if !seen.insert(&message.turn_id) {
            continue;
        }
        let (start, finish): (i64, i64) = db.query_row(
            "SELECT source_offset, COALESCE((SELECT MIN(source_offset) FROM turns WHERE thread_id=?1 AND source_offset > t.source_offset), ?3) FROM turns t WHERE thread_id=?1 AND turn_id=?2",
            params![query.thread_id, message.turn_id, end],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )?;
        let span = TurnRef {
            id: message.turn_id.clone(),
            start_offset: u64::try_from(start).map_err(|_| SearchError::InvalidQuery)?,
            end_offset: u64::try_from(finish).map_err(|_| SearchError::InvalidQuery)?,
            completed: false,
        };
        let mut turn = project_summary_turn_from_file(&file, &span)?;
        include_indexed_messages(db, &query.thread_id, &mut turn)?;
        turns.push(turn);
    }
    if index::checkpoint(&file, end)? != checkpoint {
        return Err(SearchError::InvalidQuery);
    }
    let mut value = serde_json::to_value(page)?;
    value["turns"] = Value::Array(turns);
    Ok(value)
}

// Summary projection normally keeps just the prompt and final answer. Search
// must also expose an indexed intermediate answer, including repeated text.
// Reuse canonical message payloads where present to retain attached media.
fn include_indexed_messages(
    db: &Connection,
    thread_id: &str,
    turn: &mut Value,
) -> Result<(), SearchError> {
    let turn_id = turn["id"]
        .as_str()
        .ok_or(SearchError::InvalidQuery)?
        .to_owned();
    let mut canonical = turn["items"]
        .as_array_mut()
        .ok_or(SearchError::InvalidQuery)?
        .drain(..)
        .collect::<Vec<_>>();
    let mut statement = db.prepare("SELECT id, kind, body FROM messages_content WHERE thread_id=?1 AND turn_id=?2 AND kind != 'thread' ORDER BY source_offset")?;
    let rows = statement.query_map(params![thread_id, turn_id], |row| {
        Ok((
            row.get::<_, i64>(0)?,
            row.get::<_, String>(1)?,
            row.get::<_, String>(2)?,
        ))
    })?;
    let mut items = Vec::new();
    for row in rows {
        let (id, kind, text) = row?;
        let item_type = if kind == "user_message" {
            "userMessage"
        } else {
            "agentMessage"
        };
        let position = canonical
            .iter()
            .position(|item| item["type"] == item_type && message_text(item) == text);
        let mut item = if let Some(position) = position {
            canonical.remove(position)
        } else if kind == "user_message" {
            json!({"type":"userMessage", "clientId":null, "content":[{"type":"text","text":text,"text_elements":[]}]})
        } else {
            json!({"type":"agentMessage","text":text,"phase":null,"memoryCitation":null})
        };
        item["id"] = json!(format!("search-message:{id}"));
        items.push(item);
    }
    items.extend(
        canonical
            .into_iter()
            .filter(|item| !matches!(item["type"].as_str(), Some("userMessage" | "agentMessage"))),
    );
    turn["items"] = Value::Array(items);
    Ok(())
}

fn message_text(item: &Value) -> String {
    if let Some(text) = item["text"].as_str() {
        return text.to_owned();
    }
    item["content"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|part| part["text"].as_str())
        .collect::<Vec<_>>()
        .join("\n")
}
