use super::SearchError;
use rusqlite::{Connection, OptionalExtension, params};
use serde::{Deserialize, Serialize};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ContextQuery {
    pub(super) thread_id: String,
    pub(super) message_id: i64,
    direction: Direction,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
enum Direction {
    Around,
    Older,
    Newer,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ContextMessage {
    pub(super) message_id: i64,
    pub(super) turn_id: String,
    source_offset: i64,
    timestamp: String,
    pub(super) kind: String,
    pub(super) text: String,
}

#[derive(Serialize)]
pub struct ContextPage {
    pub(super) messages: Vec<ContextMessage>,
    older: Option<i64>,
    newer: Option<i64>,
}

pub(super) fn read(db: &Connection, query: &ContextQuery) -> Result<ContextPage, SearchError> {
    if query.thread_id.is_empty() || query.message_id <= 0 {
        return Err(SearchError::InvalidQuery);
    }
    let source_offset: i64 = db.query_row("SELECT source_offset FROM messages_content WHERE thread_id=?1 AND id=?2 AND kind != 'thread'",
        params![query.thread_id, query.message_id], |row| row.get(0)).optional()?.ok_or(SearchError::InvalidQuery)?;
    let (before, after) = match query.direction {
        Direction::Around => (5, 7),
        Direction::Older => (12, 0),
        Direction::Newer => (0, 12),
    };
    let mut statement = db.prepare("SELECT turn_id, source_offset, timestamp, kind, body, id FROM (
        SELECT * FROM (SELECT * FROM messages_content WHERE thread_id=?1 AND kind != 'thread' AND source_offset < ?2 ORDER BY source_offset DESC LIMIT ?3)
        UNION ALL
        SELECT * FROM (SELECT * FROM messages_content WHERE thread_id=?1 AND kind != 'thread' AND source_offset >= ?2 ORDER BY source_offset LIMIT ?4)
        ) ORDER BY source_offset")?;
    let messages = statement
        .query_map(
            params![query.thread_id, source_offset, before, after],
            |row| {
                Ok(ContextMessage {
                    message_id: row.get(5)?,
                    turn_id: row.get(0)?,
                    source_offset: row.get(1)?,
                    timestamp: row.get(2)?,
                    kind: row.get(3)?,
                    text: row.get(4)?,
                })
            },
        )?
        .collect::<Result<Vec<_>, _>>()?;
    let first = messages.first().map(|message| message.source_offset);
    let last = messages.last().map(|message| message.source_offset);
    let older: Option<i64> = db.query_row("SELECT MAX(source_offset) FROM messages_content WHERE thread_id=?1 AND kind != 'thread' AND source_offset < ?2",
        params![query.thread_id, first], |row| row.get(0))?;
    let newer: Option<i64> = db.query_row("SELECT id FROM messages_content WHERE thread_id=?1 AND kind != 'thread' AND source_offset > ?2 ORDER BY source_offset LIMIT 1",
        params![query.thread_id, last], |row| row.get(0)).optional()?;
    // Boundaries identify real records. Every next request revalidates them,
    // so a rollback produces a stale-result error, never a different message.
    let older = older.and(messages.first().map(|message| message.message_id));
    Ok(ContextPage {
        messages,
        older,
        newer,
    })
}
