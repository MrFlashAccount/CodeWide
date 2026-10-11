use super::SearchError;
use rusqlite::{Connection, OptionalExtension, Transaction, params};
use serde_json::Value;
use std::{
    fs::File,
    io::{BufRead, BufReader, Seek, SeekFrom},
    os::unix::fs::{FileExt, MetadataExt},
    path::Path,
};

const BATCH_BYTES: i64 = 2 * 1024 * 1024;

struct Source {
    thread_id: String,
    path: String,
    identity: String,
    offset: i64,
    turn_id: String,
    cwd: String,
    title: String,
    checkpoint: Vec<u8>,
}

fn load(db: &Connection, path: &Path, thread_id: &str, file: &File) -> Result<Source, SearchError> {
    let metadata = file.metadata()?;
    let identity = format!("{}:{}", metadata.dev(), metadata.ino());
    let saved = db.query_row(
        "SELECT thread_id, path, identity, offset, turn_id, cwd, title, checkpoint FROM sources WHERE thread_id = ?1",
        [thread_id], |row| Ok(Source {
            thread_id: row.get(0)?, path: row.get(1)?, identity: row.get(2)?, offset: row.get(3)?,
            turn_id: row.get(4)?, cwd: row.get(5)?, title: row.get(6)?, checkpoint: row.get(7)?,
        }),
    ).optional()?;
    let path = path.to_string_lossy().into_owned();
    if let Some(saved) = saved
        && saved.path == path
        && saved.identity == identity
        && u64::try_from(saved.offset).is_ok_and(|offset| offset <= metadata.len())
        && saved.checkpoint == checkpoint(file, saved.offset)?
    {
        return Ok(saved);
    }
    Ok(Source {
        thread_id: thread_id.to_owned(),
        path,
        identity,
        offset: 0,
        turn_id: String::new(),
        cwd: String::new(),
        title: String::new(),
        checkpoint: Vec::new(),
    })
}

// Rollouts are append-only. Checking both the prefix and checkpoint tail detects
// replacement/truncate-regrowth without hashing an entire multi-GB history.
pub(super) fn checkpoint(file: &File, offset: i64) -> Result<Vec<u8>, SearchError> {
    let offset = u64::try_from(offset).map_err(|_| SearchError::Worker)?;
    let size = usize::try_from(offset.min(4096)).map_err(|_| SearchError::Worker)?;
    let mut bytes = vec![0; size];
    let mut hash = blake3::Hasher::new();
    file.read_exact_at(&mut bytes, 0)?;
    hash.update(&bytes);
    file.read_exact_at(&mut bytes, offset.saturating_sub(4096))?;
    hash.update(&bytes);
    Ok(hash.finalize().as_bytes().to_vec())
}

/// Commits the read checkpoint and its documents atomically, including empty turns.
pub(super) fn advance(
    db: &mut Connection,
    path: &Path,
    thread_id: &str,
) -> Result<bool, SearchError> {
    let file = File::open(path)?;
    let mut source = load(db, path, thread_id, &file)?;
    if source.offset > 0
        && u64::try_from(source.offset)
            .is_ok_and(|offset| offset == file.metadata().map_or(0, |metadata| metadata.len()))
    {
        return Ok(true);
    }
    let mut reader = BufReader::new(file);
    reader.seek(SeekFrom::Start(
        u64::try_from(source.offset).map_err(|_| SearchError::Worker)?,
    ))?;
    let transaction = db.transaction()?;
    if source.offset == 0 {
        transaction.execute(
            "DELETE FROM messages_content WHERE thread_id = ?1",
            [thread_id],
        )?;
        transaction.execute("DELETE FROM turns WHERE thread_id = ?1", [thread_id])?;
    }
    let complete = read_batch(&transaction, &mut reader, &mut source)?;
    source.checkpoint = checkpoint(reader.get_ref(), source.offset)?;
    transaction.execute(
        "INSERT OR REPLACE INTO sources VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        params![
            source.thread_id,
            source.path,
            source.identity,
            source.offset,
            source.turn_id,
            source.cwd,
            source.title,
            source.checkpoint
        ],
    )?;
    transaction.commit()?;
    Ok(complete)
}

fn read_batch(
    db: &Transaction<'_>,
    reader: &mut BufReader<File>,
    source: &mut Source,
) -> Result<bool, SearchError> {
    let start = source.offset;
    let mut line = Vec::new();
    while source.offset - start < BATCH_BYTES {
        line.clear();
        let bytes = reader.read_until(b'\n', &mut line)?;
        // A torn final JSONL record remains uncommitted and is retried after append.
        if bytes == 0 || line.last() != Some(&b'\n') {
            return Ok(true);
        }
        let record: Value = match serde_json::from_slice(&line) {
            Ok(record) => record,
            Err(error) => {
                tracing::warn!(
                    err = ?error,
                    thread_id = source.thread_id,
                    source_offset = source.offset,
                    record_bytes = bytes,
                    "skipping malformed durable search source record"
                );
                // A newline makes this a durable JSONL record rather than a
                // writer-owned partial tail. Do not attach later messages to
                // a turn whose boundary may have been the malformed record.
                source.turn_id.clear();
                source.offset += i64::try_from(bytes).map_err(|_| SearchError::Worker)?;
                continue;
            }
        };
        project(db, source, &record)?;
        source.offset += i64::try_from(bytes).map_err(|_| SearchError::Worker)?;
    }
    Ok(false)
}

fn project(db: &Transaction<'_>, source: &mut Source, record: &Value) -> Result<(), SearchError> {
    let payload = &record["payload"];
    match record["type"].as_str() {
        Some("session_meta") => {
            payload["cwd"]
                .as_str()
                .unwrap_or_default()
                .clone_into(&mut source.cwd);
        }
        Some("turn_context") => {
            if let Some(id) = payload["turn_id"].as_str() {
                start_turn(db, source, id)?;
            }
            if let Some(cwd) = payload["cwd"].as_str() {
                cwd.clone_into(&mut source.cwd);
            }
        }
        Some("event_msg") => project_event(db, source, record)?,
        Some("response_item") => project_response(db, source, record)?,
        _ => {}
    }
    Ok(())
}

fn start_turn(db: &Transaction<'_>, source: &mut Source, id: &str) -> Result<(), SearchError> {
    id.clone_into(&mut source.turn_id);
    db.execute(
        "INSERT OR IGNORE INTO turns VALUES (?1, ?2, ?3)",
        params![source.thread_id, id, source.offset],
    )?;
    Ok(())
}

fn project_event(
    db: &Transaction<'_>,
    source: &mut Source,
    record: &Value,
) -> Result<(), SearchError> {
    let payload = &record["payload"];
    let kind = payload["type"].as_str().unwrap_or_default();
    if let Some(turn_id) = payload["turn_id"].as_str() {
        start_turn(db, source, turn_id)?;
    }
    match kind {
        "task_started" => {
            if let Some(id) = payload["turn_id"].as_str() {
                start_turn(db, source, id)?;
            }
        }
        "user_message" | "agent_message" => {
            if let Some(text) = payload["message"].as_str() {
                insert_message(db, source, record, kind, text, 1)?;
            }
        }
        "item_completed" => {
            let item = &payload["item"];
            let kind = match item["type"].as_str() {
                Some("UserMessage" | "userMessage") => "user_message",
                Some("AgentMessage" | "agentMessage") => "agent_message",
                _ => return Ok(()),
            };
            let text = item["text"]
                .as_str()
                .map_or_else(|| message_text(&item["content"]), ToOwned::to_owned);
            insert_message(db, source, record, kind, &text, 4)?;
        }
        "task_complete" => {
            if let Some(text) = payload["last_agent_message"].as_str() {
                insert_message(db, source, record, "agent_message", text, 8)?;
            }
        }
        "thread_rolled_back" => rollback(db, source, payload["num_turns"].as_u64().unwrap_or(1))?,
        _ => {}
    }
    Ok(())
}

fn message_text(content: &Value) -> String {
    content.as_array().map_or_else(String::new, |parts| {
        parts
            .iter()
            .filter_map(|part| part["text"].as_str())
            .collect::<Vec<_>>()
            .join("\n")
    })
}

fn project_response(
    db: &Transaction<'_>,
    source: &mut Source,
    record: &Value,
) -> Result<(), SearchError> {
    let payload = &record["payload"];
    if payload["type"] != "message" {
        return Ok(());
    }
    let kind = match payload["role"].as_str() {
        Some("user") => "user_message",
        Some("assistant") => "agent_message",
        _ => return Ok(()),
    };
    let text = message_text(&payload["content"]);
    let trimmed = text.trim();
    if kind == "user_message"
        && trimmed.starts_with("<environment_context>")
        && trimmed.ends_with("</environment_context>")
    {
        return Ok(());
    }
    insert_message(db, source, record, kind, &text, 2)
}

fn insert_message(
    db: &Transaction<'_>,
    source: &mut Source,
    record: &Value,
    kind: &str,
    text: &str,
    representation: i64,
) -> Result<(), SearchError> {
    if text.is_empty() || source.turn_id.is_empty() {
        return Ok(());
    }
    if source.title.is_empty() && kind == "user_message" {
        source.title = text.chars().take(120).collect();
    }
    // A rollout records one message in multiple protocol representations. Pair
    // them one-to-one within its turn. Repeated messages in the same dialect,
    // including identical user prompts, remain distinct searchable documents.
    let mirrored: Option<i64> = db.query_row("SELECT id FROM messages_content WHERE thread_id=?1 AND turn_id=?2 AND kind=?3 AND body=?4 AND (representations & ?5)=0 ORDER BY source_offset LIMIT 1",
        params![source.thread_id, source.turn_id, kind, text, representation], |row| row.get(0)).optional()?;
    if let Some(id) = mirrored {
        db.execute(
            "UPDATE messages_content SET representations=representations | ?2 WHERE id=?1",
            params![id, representation],
        )?;
        return Ok(());
    }
    db.execute("INSERT INTO messages_content (body, thread_id, turn_id, timestamp, source_offset, kind, representations) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        params![text, source.thread_id, source.turn_id, record["timestamp"].as_str().unwrap_or_default(), source.offset, kind, representation])?;
    Ok(())
}

fn rollback(db: &Transaction<'_>, source: &mut Source, count: u64) -> Result<(), SearchError> {
    let count = i64::try_from(count).map_err(|_| SearchError::InvalidQuery)?;
    db.execute(
        "DELETE FROM messages_content WHERE thread_id = ?1 AND turn_id IN (
        SELECT turn_id FROM turns WHERE thread_id = ?1 ORDER BY source_offset DESC LIMIT ?2)",
        params![source.thread_id, count],
    )?;
    db.execute(
        "DELETE FROM turns WHERE thread_id = ?1 AND turn_id IN (
        SELECT turn_id FROM turns WHERE thread_id = ?1 ORDER BY source_offset DESC LIMIT ?2)",
        params![source.thread_id, count],
    )?;
    source.turn_id = db
        .query_row(
            "SELECT turn_id FROM turns WHERE thread_id = ?1 ORDER BY source_offset DESC LIMIT 1",
            [&source.thread_id],
            |row| row.get(0),
        )
        .optional()?
        .unwrap_or_default();
    Ok(())
}
