//! Full-text search over indexed Claude threads, in the shared
//! `agent-search` format (its own `SQLite` file). Documents are the user and
//! agent messages of a thread's turns, written turn by turn as the index
//! reads a turn again (a turn whose range changed) or loses it; a window
//! reads the hit's turns from their byte ranges and returns them as neutral
//! turns whose message items are the indexed messages.

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
    documents::{self, Document, DocumentKind, ThreadInfo, TurnDocuments},
};
use async_trait::async_trait;
use rusqlite::{Connection, OpenFlags, params};
use serde_json::Value;

use crate::{
    index::{history::IndexedHistory, read::ReadError, session::SessionChanges},
    store::{ClaudeStore, StoredSession},
};

/// Bits of a document position below a session's: the turn's start offset
/// and the document's place in the turn.
const SESSION_SHIFT: u32 = 52;
const DOCUMENT_BITS: u32 = 10;

/// The position each session of a thread was indexed at: a session that
/// starts before ones indexed earlier (a chain that gains an older session)
/// moves them, and the thread is then written again.
const SESSION_POSITIONS: &str = "CREATE TABLE IF NOT EXISTS claude_session_positions (
    thread_id TEXT NOT NULL,
    session_id TEXT NOT NULL,
    position INTEGER NOT NULL,
    PRIMARY KEY(thread_id, session_id)
)";

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
    #[error("Search history is unavailable: {0}")]
    History(#[from] ReadError),
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
    history: Arc<IndexedHistory>,
    indexing: AtomicBool,
}

/// Where a turn's documents sit in its thread: after every earlier
/// session's and every earlier turn's of its own session.
fn position(session: usize, start_offset: u64) -> i64 {
    let session = i64::try_from(session).unwrap_or(i64::MAX >> SESSION_SHIFT);
    let start = i64::try_from(start_offset).unwrap_or(i64::MAX);
    (session << SESSION_SHIFT) | ((start << DOCUMENT_BITS) & ((1 << SESSION_SHIFT) - 1))
}

impl ClaudeSearch {
    /// Opens (or creates) the index at `path`.
    ///
    /// # Errors
    /// Returns an error when the database cannot be opened or initialized.
    pub fn open(
        path: &Path,
        store: Arc<ClaudeStore>,
        history: Arc<IndexedHistory>,
    ) -> Result<Self, ClaudeSearchError> {
        let db = Connection::open(path)?;
        db.execute_batch(agent_search::SCHEMA)?;
        db.execute_batch(SESSION_POSITIONS)?;
        Ok(Self {
            path: path.to_path_buf(),
            store,
            history,
            indexing: AtomicBool::new(true),
        })
    }

    /// Marks whether a backfill is still indexing sessions.
    pub fn set_indexing(&self, indexing: bool) {
        self.indexing.store(indexing, Ordering::Release);
    }

    fn connection(&self) -> Result<Connection, ClaudeSearchError> {
        let db = Connection::open(&self.path)?;
        db.busy_timeout(std::time::Duration::from_secs(5))?;
        Ok(db)
    }

    fn info(thread: &AppThreadId, sessions: &[StoredSession]) -> ThreadInfo {
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
        ThreadInfo {
            thread_id: thread.as_str().to_owned(),
            cwd,
            title,
            timestamp,
        }
    }

    /// Whether every session of `sessions` already indexed for the thread
    /// sits at the position it was indexed at.
    fn positions_hold(
        db: &Connection,
        thread: &AppThreadId,
        sessions: &[StoredSession],
    ) -> Result<bool, ClaudeSearchError> {
        let mut statement = db.prepare(
            "SELECT session_id, position FROM claude_session_positions WHERE thread_id=?1",
        )?;
        let indexed = statement
            .query_map([thread.as_str()], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?))
            })?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(indexed.iter().all(|(session_id, position)| {
            sessions
                .iter()
                .position(|stored| &stored.session.session_id == session_id)
                .is_none_or(|now| i64::try_from(now).ok() == Some(*position))
        }))
    }

    /// Records the position of every session of the thread.
    fn record_positions(
        db: &mut Connection,
        thread: &AppThreadId,
        sessions: &[StoredSession],
    ) -> Result<(), ClaudeSearchError> {
        let transaction = db.transaction()?;
        transaction.execute(
            "DELETE FROM claude_session_positions WHERE thread_id=?1",
            [thread.as_str()],
        )?;
        for (position, stored) in sessions.iter().enumerate() {
            transaction.execute(
                "INSERT INTO claude_session_positions VALUES (?1, ?2, ?3)",
                params![
                    thread.as_str(),
                    stored.session.session_id,
                    i64::try_from(position).unwrap_or(i64::MAX)
                ],
            )?;
        }
        transaction.commit()?;
        Ok(())
    }

    /// The thread's sessions, or `None` when it is deleted or gone and must
    /// not be searchable (its documents are removed).
    fn searchable(
        &self,
        db: &mut Connection,
        thread: &AppThreadId,
    ) -> Result<Option<Vec<StoredSession>>, ClaudeSearchError> {
        let sessions = self.store.thread_sessions(thread)?;
        if sessions.is_empty() || crate::catalog::is_deleted(&sessions.iter().collect::<Vec<_>>()) {
            documents::remove_thread(db, thread.as_str())?;
            db.execute(
                "DELETE FROM claude_session_positions WHERE thread_id=?1",
                [thread.as_str()],
            )?;
            return Ok(None);
        }
        Ok(Some(sessions))
    }

    /// Writes the documents of the turns one session index pass read again
    /// and removes those of the turns it lost.
    ///
    /// # Errors
    /// Returns an error when the index cannot be read or written.
    pub fn apply(&self, changes: &SessionChanges) -> Result<(), ClaudeSearchError> {
        let mut db = self.connection()?;
        let thread = changes.stored.app_thread_id();
        if let Some(previous) = changes
            .previous
            .as_ref()
            .filter(|previous| previous.app_thread_id() != thread)
        {
            self.reindex_thread(previous.app_thread_id())?;
        }
        let Some(sessions) = self.searchable(&mut db, thread)? else {
            return Ok(());
        };
        if !Self::positions_hold(&db, thread, &sessions)? {
            // An older session joined the chain: every later session's
            // documents move, so the thread is written again, once.
            drop(db);
            return self.reindex_thread(thread);
        }
        Self::record_positions(&mut db, thread, &sessions)?;
        let session = sessions
            .iter()
            .position(|stored| stored.session.session_id == changes.stored.session.session_id)
            .unwrap_or(sessions.len());
        let later = sessions
            .get(session + 1..)
            .unwrap_or_default()
            .iter()
            .map(|stored| agent_index::file_id(&stored.path))
            .collect::<Vec<_>>();
        let hidden = |turn_id: &str| -> Result<bool, ClaudeSearchError> {
            for file_id in &later {
                if self
                    .store
                    .segments()
                    .index()
                    .turn_by_id(file_id, turn_id)?
                    .is_some()
                {
                    return Ok(true);
                }
            }
            Ok(false)
        };
        let mut turns = Vec::new();
        for changed in &changes.changed {
            if hidden(changed.turn.turn_id.as_str())? {
                continue;
            }
            turns.push(TurnDocuments {
                turn_id: changed.turn.turn_id.as_str().to_owned(),
                position: position(session, changed.start_offset),
                documents: turn_documents(&changed.turn),
            });
        }
        // A turn gone from one session may still be another's.
        let mut removed = Vec::new();
        for turn_id in &changes.removed {
            if turns.iter().any(|turn| &turn.turn_id == turn_id) {
                continue;
            }
            removed.push(turn_id.clone());
            for (index, stored) in sessions.iter().enumerate().rev() {
                let file_id = agent_index::file_id(&stored.path);
                if let Some(turn) = self
                    .store
                    .segments()
                    .index()
                    .turn_by_id(&file_id, turn_id)?
                {
                    if let Some(read) = self
                        .history
                        .turns_by_id(thread, [turn_id.as_str()])?
                        .into_iter()
                        .next()
                    {
                        turns.push(TurnDocuments {
                            turn_id: turn_id.clone(),
                            position: position(index, turn.start_offset),
                            documents: turn_documents(&read),
                        });
                    }
                    break;
                }
            }
        }
        documents::replace_turns(&mut db, &Self::info(thread, &sessions), &removed, &turns)?;
        Ok(())
    }

    /// Rewrites the thread's title document and source row (its listing
    /// facts changed), or removes the thread when it is no longer searchable.
    ///
    /// # Errors
    /// Returns an error when the index cannot be read or written.
    pub fn update_info(&self, thread: &AppThreadId) -> Result<(), ClaudeSearchError> {
        let mut db = self.connection()?;
        let Some(sessions) = self.searchable(&mut db, thread)? else {
            return Ok(());
        };
        documents::replace_turns(&mut db, &Self::info(thread, &sessions), &[], &[])?;
        Ok(())
    }

    /// Replaces every document of the thread, reading each of its turns
    /// (a thread whose sessions moved to another thread).
    ///
    /// # Errors
    /// Returns an error when the index cannot be read or written.
    pub fn reindex_thread(&self, thread: &AppThreadId) -> Result<(), ClaudeSearchError> {
        let mut db = self.connection()?;
        documents::remove_thread(&mut db, thread.as_str())?;
        let Some(sessions) = self.searchable(&mut db, thread)? else {
            return Ok(());
        };
        let mut turns = Vec::new();
        for (index, stored) in sessions.iter().enumerate() {
            let file_id = agent_index::file_id(&stored.path);
            for turn in self.store.file_turns(&file_id)? {
                if let Some(read) = self
                    .history
                    .turns_by_id(thread, [turn.id.as_str()])?
                    .into_iter()
                    .next()
                {
                    turns.push(TurnDocuments {
                        turn_id: turn.id.clone(),
                        position: position(index, turn.start_offset),
                        documents: turn_documents(&read),
                    });
                }
            }
        }
        documents::replace_turns(&mut db, &Self::info(thread, &sessions), &[], &turns)?;
        Self::record_positions(&mut db, thread, &sessions)?;
        Ok(())
    }

    /// Removes every document of the thread.
    ///
    /// # Errors
    /// Returns an error when the index cannot be written.
    pub fn remove_thread(&self, thread: &AppThreadId) -> Result<(), ClaudeSearchError> {
        let mut db = self.connection()?;
        documents::remove_thread(&mut db, thread.as_str())?;
        db.execute(
            "DELETE FROM claude_session_positions WHERE thread_id=?1",
            [thread.as_str()],
        )?;
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
        let mut ids = Vec::new();
        for message in &page.messages {
            if !ids.contains(&message.turn_id.as_str()) {
                ids.push(message.turn_id.as_str());
            }
        }
        let indexed = self.history.turns_by_id(&thread, ids.iter().copied())?;
        let mut turns = Vec::with_capacity(ids.len());
        for id in ids {
            let turn = indexed
                .iter()
                .find(|turn| turn.turn_id.as_str() == id)
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
        usage: None,
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
    use crate::test_support::{StoreFixture, session_id};

    #[tokio::test]
    async fn indexed_threads_are_searchable_with_context_and_window()
    -> Result<(), Box<dyn std::error::Error>> {
        let fixture = StoreFixture::new()?;
        let session = session_id(1);
        fixture.exchange(&session, "/work/a", 1, &["parser bug", "rename module"])?;
        fixture.index(&session)?;

        let page = fixture.search.search(&json!({"query": "parser"})).await?;
        let hits = page["data"].as_array().ok_or("hits")?;
        // The prompt, the answer quoting it and the thread title.
        assert_eq!(hits.len(), 3);
        let prompt = hits
            .iter()
            .find(|hit| hit["kind"] == "user_message")
            .ok_or("prompt hit")?;
        assert_eq!(prompt["threadId"], session.as_str());
        assert_eq!(prompt["turnId"], format!("{session}-parser bug"));
        assert_eq!(prompt["project"], "/work/a");
        let message_id = prompt["messageId"].clone();

        let context = fixture
            .search
            .context(&json!({"threadId": session, "messageId": message_id, "direction": "around"}))
            .await?;
        assert_eq!(context["messages"].as_array().map(Vec::len), Some(4));

        let window = fixture
            .search
            .window(&json!({"threadId": session, "messageId": message_id, "direction": "around"}))
            .await?;
        assert_eq!(window.turns.len(), 2);
        assert!(
            window.turns[0].items[0]
                .item_id()
                .as_str()
                .starts_with("search-message:")
        );

        fixture.store.remove_session(&session)?;
        fixture
            .search
            .reindex_thread(&AppThreadId::parse(&session).ok_or("thread id")?)?;
        let empty = fixture.search.search(&json!({"query": "parser"})).await?;
        assert_eq!(empty["data"].as_array().map(Vec::len), Some(0));
        Ok(())
    }

    #[tokio::test]
    async fn an_invalid_query_reports_the_shared_message() -> Result<(), Box<dyn std::error::Error>>
    {
        let fixture = StoreFixture::new()?;
        let error = fixture.search.search(&json!({"query": ""})).await.err();
        assert_eq!(error.as_deref(), Some("Invalid search query or date range"));
        Ok(())
    }
}
