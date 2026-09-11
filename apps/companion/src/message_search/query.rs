use rusqlite::{Connection, params};
use serde::{Deserialize, Serialize};

use super::SearchError;

/// Search filters belong to the server which owns the indexed history.
#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SearchQuery {
    pub query: String,
    pub project: Option<String>,
    pub thread_id: Option<String>,
    /// Inclusive UTC timestamp in RFC 3339 form.
    pub from: Option<String>,
    /// Exclusive UTC timestamp in RFC 3339 form.
    pub until: Option<String>,
    #[serde(default)]
    pub offset: u32,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchHit {
    pub message_id: i64,
    pub thread_id: String,
    pub turn_id: String,
    pub title: String,
    pub project: String,
    pub timestamp: String,
    pub source_offset: i64,
    pub kind: String,
    /// Plain text. Highlights are separately represented by matched terms.
    pub excerpt: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchPage {
    pub data: Vec<SearchHit>,
    pub next_offset: Option<u32>,
    pub indexing: bool,
    pub failed_sources: usize,
}

/// Quotes each token rather than exposing FTS operators through the search box.
fn expression(query: &str) -> Result<String, SearchError> {
    if query.len() > 1024 {
        return Err(SearchError::InvalidQuery);
    }
    let terms: Vec<_> = query.split_whitespace().collect();
    if terms.is_empty() || terms.len() > 32 {
        return Err(SearchError::InvalidQuery);
    }
    Ok(terms
        .iter()
        .map(|term| format!("\"{}\"*", term.replace('"', "\"\"")))
        .collect::<Vec<_>>()
        .join(" AND "))
}

fn valid_date(value: Option<&str>) -> bool {
    value.is_none_or(|value| {
        time::OffsetDateTime::parse(value, &time::format_description::well_known::Rfc3339).is_ok()
    })
}

pub(super) fn read(db: &Connection, query: &SearchQuery) -> Result<SearchPage, SearchError> {
    if !valid_date(query.from.as_deref())
        || !valid_date(query.until.as_deref())
        || query.offset > 100_000
    {
        return Err(SearchError::InvalidQuery);
    }
    let expression = expression(&query.query)?;
    let mut statement = db.prepare(
        "SELECT m.thread_id, m.turn_id, s.title, s.cwd, m.timestamp,
                m.source_offset, m.kind, snippet(messages, 0, '', '', '…', 40), m.rowid
         FROM messages m JOIN sources s ON s.thread_id = m.thread_id
         WHERE messages MATCH ?1
           AND (?2 IS NULL OR s.cwd = ?2)
           AND (?3 IS NULL OR m.thread_id = ?3)
           AND (?4 IS NULL OR julianday(m.timestamp) >= julianday(?4))
           AND (?5 IS NULL OR julianday(m.timestamp) < julianday(?5))
         ORDER BY m.timestamp DESC, m.thread_id, m.source_offset DESC
         LIMIT 31 OFFSET ?6",
    )?;
    let mut data = statement
        .query_map(
            params![
                expression,
                query.project,
                query.thread_id,
                query.from,
                query.until,
                query.offset
            ],
            |row| {
                Ok(SearchHit {
                    message_id: row.get(8)?,
                    thread_id: row.get(0)?,
                    turn_id: row.get(1)?,
                    title: row.get(2)?,
                    project: row.get(3)?,
                    timestamp: row.get(4)?,
                    source_offset: row.get(5)?,
                    kind: row.get(6)?,
                    excerpt: row.get(7)?,
                })
            },
        )?
        .collect::<Result<Vec<_>, _>>()?;
    let next_offset = (data.len() > 30).then_some(query.offset + 30);
    data.truncate(30);
    Ok(SearchPage {
        data,
        next_offset,
        indexing: true,
        failed_sources: 0,
    })
}
