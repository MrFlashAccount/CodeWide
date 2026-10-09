//! Full-text search over indexed Claude threads, in the shared
//! `agent-search` format (its own `SQLite` file). Documents are the user and
//! agent messages of a thread's indexed turns; a window returns the hit's
//! turns as neutral turns whose message items are the indexed messages.

use std::{
    path::{Path, PathBuf},
    sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
    },
};

use agent_core::{
    model::{AgentItem, AgentTurn, AppThreadId, ItemId, MessagePhase, UserContent},
    provider::{SearchWindow, StoredMessageSearch},
};
use agent_search::{
    ContextQuery, SearchQuery, SearchReadError,
    documents::{self, Document, DocumentKind, ThreadDocuments},
};
use async_trait::async_trait;
use rusqlite::{Connection, OpenFlags, params};
use serde_json::Value;
use sha2::{Digest, Sha256};

use crate::store::ClaudeStore;

#[derive(Debug, thiserror::Error)]
pub enum ClaudeSearchError {
    #[error("Search index is unavailable: {0}")]
    Database(#[from] rusqlite::Error),
    #[error("Invalid search query or date range")]
    InvalidQuery,
    #[error("Search source is invalid: {0}")]
    Json(#[from] serde_json::Error),
    #[error("Search history is unavailable: {0}")]
    Store(#[from] companion_host::index::StoreError),
    #[error("Search worker is unavailable")]
    Worker,
}

impl From<SearchReadError> for ClaudeSearchError {
    fn from(error: SearchReadError) -> Self {
        match error {
            SearchReadError::Database(error) => Self::Database(error),
            SearchReadError::InvalidQuery => Self::InvalidQuery,
        }
    }
}

/// The Claude search index.
pub struct ClaudeSearch {
    path: PathBuf,
    store: Arc<ClaudeStore>,
    indexing: AtomicBool,
}

impl ClaudeSearch {
    /// Opens (or creates) the index at `path`.
    ///
    /// # Errors
    /// Returns an error when the database cannot be opened or initialized.
    pub fn open(path: &Path, store: Arc<ClaudeStore>) -> Result<Self, ClaudeSearchError> {
        Connection::open(path)?.execute_batch(agent_search::SCHEMA)?;
        Ok(Self {
            path: path.to_path_buf(),
            store,
            indexing: AtomicBool::new(true),
        })
    }

    /// Marks whether a backfill is still indexing sessions.
    pub fn set_indexing(&self, indexing: bool) {
        self.indexing.store(indexing, Ordering::Release);
    }

    /// Replaces the thread's documents from the indexed turns, or removes
    /// them when the thread has no indexed session left.
    ///
    /// # Errors
    /// Returns an error when the index cannot be read or written.
    pub fn reindex_thread(&self, thread: &AppThreadId) -> Result<(), ClaudeSearchError> {
        let mut db = Connection::open(&self.path)?;
        db.busy_timeout(std::time::Duration::from_secs(5))?;
        let sessions = self.store.thread_sessions(thread)?;
        let deleted = crate::catalog::is_deleted(&sessions.iter().collect::<Vec<_>>());
        let turns = match self.store.thread_turns(thread)? {
            Some(turns) if !deleted => turns,
            // A thread deleted in CodeWide or gone from Claude's store is
            // not searchable.
            _ => {
                documents::remove_thread(&mut db, thread.as_str())?;
                return Ok(());
            }
        };
        let latest = sessions.last();
        let title = latest
            .and_then(|stored| stored.session.title.clone())
            .unwrap_or_else(|| {
                latest.map_or_else(String::new, |stored| stored.session.summary.clone())
            });
        let cwd = sessions
            .iter()
            .rev()
            .find_map(|stored| stored.session.cwd.clone())
            .unwrap_or_default();
        let timestamp = rfc3339(sessions.first().map_or(0, |stored| {
            stored
                .session
                .created_at_ms
                .unwrap_or(stored.session.last_modified_ms)
                / 1000
        }));
        let mut thread_documents = ThreadDocuments {
            thread_id: thread.as_str().to_owned(),
            source: String::new(),
            cwd,
            title,
            timestamp,
            turns: turns
                .iter()
                .map(|turn| turn.turn_id.as_str().to_owned())
                .collect(),
            documents: turns.iter().flat_map(turn_documents).collect(),
        };
        thread_documents.source = source_identity(&thread_documents);
        documents::replace_thread(&mut db, &thread_documents)?;
        Ok(())
    }

    fn read_only(&self) -> Result<Connection, ClaudeSearchError> {
        let db = Connection::open_with_flags(&self.path, OpenFlags::SQLITE_OPEN_READ_ONLY)?;
        db.busy_timeout(std::time::Duration::from_millis(100))?;
        Ok(db)
    }

    fn search_page(&self, params: &Value) -> Result<Value, ClaudeSearchError> {
        let query: SearchQuery = serde_json::from_value(params.clone())?;
        let mut page = agent_search::query::read(&self.read_only()?, &query)?;
        page.indexing = self.indexing.load(Ordering::Acquire);
        Ok(serde_json::to_value(page)?)
    }

    fn context_page(&self, params: &Value) -> Result<Value, ClaudeSearchError> {
        let query: ContextQuery = serde_json::from_value(params.clone())?;
        Ok(serde_json::to_value(agent_search::context::read(
            &self.read_only()?,
            &query,
        )?)?)
    }

    fn window_page(&self, params: &Value) -> Result<SearchWindow, ClaudeSearchError> {
        let query: ContextQuery = serde_json::from_value(params.clone())?;
        let db = self.read_only()?;
        let page = agent_search::context::read(&db, &query)?;
        let thread = AppThreadId::parse(&query.thread_id).ok_or(ClaudeSearchError::InvalidQuery)?;
        let indexed = self
            .store
            .thread_turns(&thread)?
            .ok_or(ClaudeSearchError::InvalidQuery)?;
        let mut seen = std::collections::HashSet::new();
        let mut turns = Vec::new();
        for message in &page.messages {
            if !seen.insert(message.turn_id.clone()) {
                continue;
            }
            let turn = indexed
                .iter()
                .find(|turn| turn.turn_id.as_str() == message.turn_id)
                .ok_or(ClaudeSearchError::InvalidQuery)?;
            turns.push(window_turn(&db, &query.thread_id, turn)?);
        }
        Ok(SearchWindow {
            page: serde_json::to_value(page)?,
            turns,
        })
    }
}

#[async_trait]
impl StoredMessageSearch for ClaudeSearch {
    async fn search(&self, params: &Value) -> Result<Value, String> {
        self.search_page(params).map_err(|error| error.to_string())
    }

    async fn context(&self, params: &Value) -> Result<Value, String> {
        self.context_page(params).map_err(|error| error.to_string())
    }

    async fn window(&self, params: &Value) -> Result<SearchWindow, String> {
        self.window_page(params).map_err(|error| error.to_string())
    }
}

/// The searchable messages of one turn: user text and every agent answer.
fn turn_documents(turn: &AgentTurn) -> Vec<Document> {
    let timestamp = rfc3339(turn.started_at);
    turn.items
        .iter()
        .filter_map(|item| match item {
            AgentItem::UserMessage { content, .. } => {
                Some((DocumentKind::UserMessage, user_text(content)))
            }
            AgentItem::AgentMessage { text, .. } => {
                Some((DocumentKind::AgentMessage, text.clone()))
            }
            _ => None,
        })
        .map(|(kind, body)| Document {
            turn_id: turn.turn_id.as_str().to_owned(),
            timestamp: timestamp.clone(),
            kind,
            body,
        })
        .collect()
}

fn user_text(content: &[UserContent]) -> String {
    content
        .iter()
        .filter_map(|part| match part {
            UserContent::Text { text } => Some(text.as_str()),
            UserContent::Image { .. } | UserContent::LocalImage { .. } => None,
        })
        .collect::<Vec<_>>()
        .join("\n")
}

/// The turn with its indexed messages as items (ids `search-message:<id>`),
/// reusing the canonical item where its text matches; other items follow.
fn window_turn(
    db: &Connection,
    thread_id: &str,
    turn: &AgentTurn,
) -> Result<AgentTurn, ClaudeSearchError> {
    let mut canonical = turn.items.clone();
    let mut statement = db.prepare(
        "SELECT id, kind, body FROM messages_content WHERE thread_id=?1 AND turn_id=?2 AND kind != 'thread' ORDER BY source_offset",
    )?;
    let rows = statement
        .query_map(params![thread_id, turn.turn_id.as_str()], |row| {
            Ok((
                row.get::<_, i64>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
            ))
        })?
        .collect::<Result<Vec<_>, _>>()?;
    let mut items = Vec::with_capacity(rows.len());
    for (id, kind, body) in rows {
        let item_id = ItemId::parse(&format!("search-message:{id}"))
            .ok_or(ClaudeSearchError::InvalidQuery)?;
        let position = canonical.iter().position(|item| match item {
            AgentItem::UserMessage { content, .. } => {
                kind == "user_message" && user_text(content) == body
            }
            AgentItem::AgentMessage { text, .. } => kind == "agent_message" && *text == body,
            _ => false,
        });
        let item = match position.map(|position| canonical.remove(position)) {
            Some(AgentItem::UserMessage {
                client_message_id,
                content,
                ..
            }) => AgentItem::UserMessage {
                item_id,
                client_message_id,
                content,
                provenance: None,
            },
            Some(AgentItem::AgentMessage { text, phase, .. }) => AgentItem::AgentMessage {
                item_id,
                text,
                phase,
                provenance: None,
            },
            _ if kind == "user_message" => AgentItem::UserMessage {
                provenance: None,
                item_id,
                client_message_id: None,
                content: vec![UserContent::Text { text: body }],
            },
            _ => AgentItem::AgentMessage {
                provenance: None,
                item_id,
                text: body,
                phase: MessagePhase::Final,
            },
        };
        items.push(item);
    }
    items.extend(canonical.into_iter().filter(|item| {
        !matches!(
            item,
            AgentItem::UserMessage { .. } | AgentItem::AgentMessage { .. }
        )
    }));
    Ok(AgentTurn {
        provenance: None,
        turn_id: turn.turn_id.clone(),
        status: turn.status,
        origin: turn.origin,
        started_at: turn.started_at,
        completed_at: turn.completed_at,
        error: turn.error.clone(),
        items,
    })
}

/// A digest of everything the documents depend on: unchanged input is a no-op.
fn source_identity(thread: &ThreadDocuments) -> String {
    let mut hash = Sha256::new();
    hash.update(thread.cwd.as_bytes());
    hash.update([0]);
    hash.update(thread.title.as_bytes());
    hash.update([0]);
    hash.update(thread.timestamp.as_bytes());
    for turn in &thread.turns {
        hash.update([0]);
        hash.update(turn.as_bytes());
    }
    for document in &thread.documents {
        hash.update([1]);
        hash.update(document.turn_id.as_bytes());
        hash.update([0]);
        hash.update(document.timestamp.as_bytes());
        hash.update([0]);
        hash.update(document.body.as_bytes());
        hash.update([u8::from(document.kind == DocumentKind::UserMessage)]);
    }
    format!("claude:{}", hex(&hash.finalize()))
}

fn hex(bytes: &[u8]) -> String {
    use std::fmt::Write as _;
    bytes
        .iter()
        .fold(String::with_capacity(bytes.len() * 2), |mut text, byte| {
            // WHY: writing into a String cannot fail.
            let _ = write!(text, "{byte:02x}");
            text
        })
}

/// Unix seconds as an RFC 3339 UTC timestamp.
fn rfc3339(seconds: i64) -> String {
    time::OffsetDateTime::from_unix_timestamp(seconds)
        .ok()
        .and_then(|value| {
            value
                .format(&time::format_description::well_known::Rfc3339)
                .ok()
        })
        .unwrap_or_else(|| "1970-01-01T00:00:00Z".to_owned())
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;
    use crate::test_support::{MemoryThreadIndex, session_read};

    fn fixture()
    -> Result<(tempfile::TempDir, Arc<ClaudeStore>, ClaudeSearch), Box<dyn std::error::Error>> {
        let directory = tempfile::tempdir()?;
        let database = companion_host::database::open(directory.path().join("index.redb"), "test")?;
        let store = Arc::new(ClaudeStore::attach(
            database,
            Arc::new(MemoryThreadIndex::default()),
        )?);
        let search = ClaudeSearch::open(&directory.path().join("search.sqlite"), store.clone())?;
        Ok((directory, store, search))
    }

    #[tokio::test]
    async fn indexed_threads_are_searchable_with_context_and_window()
    -> Result<(), Box<dyn std::error::Error>> {
        let (_directory, store, search) = fixture()?;
        let thread = AppThreadId::from_static("thread-a");
        store.replace_session(&session_read(
            "session-a",
            "thread-a",
            10,
            &["parser bug", "rename module"],
        ))?;
        search.reindex_thread(&thread)?;
        search.reindex_thread(&thread)?;

        let page = search.search(&json!({"query": "parser"})).await?;
        let hits = page["data"].as_array().ok_or("hits")?;
        // The prompt, the answer quoting it and the thread title.
        assert_eq!(hits.len(), 3);
        let prompt = hits
            .iter()
            .find(|hit| hit["kind"] == "user_message")
            .ok_or("prompt hit")?;
        assert_eq!(prompt["threadId"], "thread-a");
        assert_eq!(prompt["turnId"], "session-a-parser bug");
        assert_eq!(prompt["project"], "/work/session-a");
        let message_id = prompt["messageId"].clone();

        let context = search
            .context(
                &json!({"threadId": "thread-a", "messageId": message_id, "direction": "around"}),
            )
            .await?;
        assert_eq!(context["messages"].as_array().map(Vec::len), Some(4));

        let window = search
            .window(
                &json!({"threadId": "thread-a", "messageId": message_id, "direction": "around"}),
            )
            .await?;
        assert_eq!(window.turns.len(), 2);
        assert!(
            window.turns[0].items[0]
                .item_id()
                .as_str()
                .starts_with("search-message:")
        );

        store.remove_session("session-a")?;
        search.reindex_thread(&thread)?;
        let empty = search.search(&json!({"query": "parser"})).await?;
        assert_eq!(empty["data"].as_array().map(Vec::len), Some(0));
        Ok(())
    }

    #[tokio::test]
    async fn an_invalid_query_reports_the_shared_message() -> Result<(), Box<dyn std::error::Error>>
    {
        let (_directory, _store, search) = fixture()?;
        let error = search.search(&json!({"query": ""})).await.err();
        assert_eq!(error.as_deref(), Some("Invalid search query or date range"));
        Ok(())
    }
}
