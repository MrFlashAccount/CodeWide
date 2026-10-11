//! Replaces one thread's searchable documents from an already parsed,
//! provider-neutral history. A provider that reads its history in whole
//! threads uses this writer instead of an incremental source reader.

use rusqlite::{Connection, OptionalExtension, params};

use crate::SearchReadError;

/// The role of one searchable message.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum DocumentKind {
    UserMessage,
    AgentMessage,
}

impl DocumentKind {
    const fn as_str(self) -> &'static str {
        match self {
            Self::UserMessage => "user_message",
            Self::AgentMessage => "agent_message",
        }
    }
}

/// One searchable message, in history order.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Document {
    pub turn_id: String,
    /// RFC 3339 UTC timestamp.
    pub timestamp: String,
    pub kind: DocumentKind,
    pub body: String,
}

/// A thread's complete searchable history.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ThreadDocuments {
    pub thread_id: String,
    /// Opaque identity of the indexed source version; an unchanged identity
    /// makes a replacement a no-op.
    pub source: String,
    pub cwd: String,
    /// Thread title; empty means none.
    pub title: String,
    /// RFC 3339 UTC timestamp of the title document.
    pub timestamp: String,
    /// Turn ids in history order, including turns without messages.
    pub turns: Vec<String>,
    pub documents: Vec<Document>,
}

/// The source identity the thread was last indexed from.
///
/// # Errors
/// Returns database failures.
pub fn indexed_source(db: &Connection, thread_id: &str) -> Result<Option<String>, SearchReadError> {
    Ok(db
        .query_row(
            "SELECT identity FROM sources WHERE thread_id=?1",
            [thread_id],
            |row| row.get(0),
        )
        .optional()?)
}

/// Atomically replaces the thread's documents. Positions are the 1-based
/// document order; turn positions are the position of their first document
/// (or of the next document for a turn without messages). Replaying the same
/// `source` is a no-op.
///
/// # Errors
/// Returns database failures; the previous documents stay on failure.
pub fn replace_thread(
    db: &mut Connection,
    thread: &ThreadDocuments,
) -> Result<(), SearchReadError> {
    if indexed_source(db, &thread.thread_id)?.as_deref() == Some(thread.source.as_str()) {
        return Ok(());
    }
    let transaction = db.transaction()?;
    transaction.execute(
        "DELETE FROM messages_content WHERE thread_id=?1",
        [&thread.thread_id],
    )?;
    transaction.execute("DELETE FROM turns WHERE thread_id=?1", [&thread.thread_id])?;
    let mut position = 0_i64;
    let mut documents = thread.documents.iter().peekable();
    for turn_id in &thread.turns {
        transaction.execute(
            "INSERT OR IGNORE INTO turns VALUES (?1, ?2, ?3)",
            params![thread.thread_id, turn_id, position + 1],
        )?;
        while let Some(document) = documents.next_if(|document| &document.turn_id == turn_id) {
            position += 1;
            if document.body.is_empty() {
                continue;
            }
            transaction.execute(
                "INSERT INTO messages_content (body, thread_id, turn_id, timestamp, source_offset, kind) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                params![
                    document.body,
                    thread.thread_id,
                    document.turn_id,
                    document.timestamp,
                    position,
                    document.kind.as_str()
                ],
            )?;
        }
    }
    if !thread.title.is_empty() {
        transaction.execute(
            "INSERT INTO messages_content(body,thread_id,turn_id,timestamp,source_offset,kind) VALUES(?1,?2,'',?3,0,'thread')",
            params![thread.title, thread.thread_id, thread.timestamp],
        )?;
    }
    transaction.execute(
        "INSERT OR REPLACE INTO sources VALUES (?1, '', ?2, ?3, ?4, ?5, ?6, x'')",
        params![
            thread.thread_id,
            thread.source,
            position,
            thread.turns.last().map_or("", String::as_str),
            thread.cwd,
            thread.title
        ],
    )?;
    transaction.commit()?;
    Ok(())
}

/// Removes every derived document of the thread.
///
/// # Errors
/// Returns database failures.
pub fn remove_thread(db: &mut Connection, thread_id: &str) -> Result<(), SearchReadError> {
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        ContextQuery, SearchQuery,
        context::{self, Direction},
        query,
    };

    fn thread(source: &str, body: &str) -> ThreadDocuments {
        ThreadDocuments {
            thread_id: "thread".into(),
            source: source.into(),
            cwd: "/work".into(),
            title: "Title".into(),
            timestamp: "2026-01-01T00:00:00Z".into(),
            turns: vec!["turn-1".into(), "turn-2".into()],
            documents: vec![
                Document {
                    turn_id: "turn-1".into(),
                    timestamp: "2026-01-01T00:00:01Z".into(),
                    kind: DocumentKind::UserMessage,
                    body: "find the parser".into(),
                },
                Document {
                    turn_id: "turn-2".into(),
                    timestamp: "2026-01-01T00:00:02Z".into(),
                    kind: DocumentKind::AgentMessage,
                    body: body.into(),
                },
            ],
        }
    }

    fn search(db: &Connection, text: &str) -> Result<Vec<String>, SearchReadError> {
        Ok(query::read(
            db,
            &SearchQuery {
                query: text.into(),
                ..SearchQuery::default()
            },
        )?
        .data
        .into_iter()
        .map(|hit| format!("{}:{}:{}", hit.turn_id, hit.kind, hit.project))
        .collect())
    }

    #[test]
    fn replacement_is_searchable_idempotent_and_supersedes_the_old_version()
    -> Result<(), Box<dyn std::error::Error>> {
        let mut db = Connection::open_in_memory()?;
        db.execute_batch(crate::SCHEMA)?;
        replace_thread(&mut db, &thread("v1", "parser fixed"))?;
        replace_thread(&mut db, &thread("v1", "parser fixed"))?;
        assert_eq!(search(&db, "parser")?.len(), 2);
        assert_eq!(search(&db, "fixed")?, ["turn-2:agent_message:/work"]);

        replace_thread(&mut db, &thread("v2", "renamed module"))?;
        assert!(search(&db, "fixed")?.is_empty());
        assert_eq!(search(&db, "renamed")?.len(), 1);
        assert_eq!(indexed_source(&db, "thread")?.as_deref(), Some("v2"));

        let hit = query::read(
            &db,
            &SearchQuery {
                query: "renamed".into(),
                ..SearchQuery::default()
            },
        )?
        .data
        .remove(0);
        let around = context::read(
            &db,
            &ContextQuery {
                thread_id: "thread".into(),
                message_id: hit.message_id,
                direction: Direction::Around,
            },
        )?;
        assert_eq!(
            around
                .messages
                .iter()
                .map(|message| message.text.as_str())
                .collect::<Vec<_>>(),
            ["find the parser", "renamed module"]
        );

        remove_thread(&mut db, "thread")?;
        assert!(search(&db, "parser")?.is_empty());
        Ok(())
    }
}
