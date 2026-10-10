//! The Claude session index: tables the Claude adapter derives from Claude's
//! native session store inside the companion's host index database.
//!
//! Every row is a neutral read the Claude host returned for one session
//! (`session.read`). The tables are disposable: [`CLAUDE_INDEX_SCHEMA`]
//! drops them when the companion schema asks for a rebuild or when
//! [`CLAUDE_INDEX_LOGIC_VERSION`] changes, and the indexer reads every
//! session again. Thread metadata stays companion state, published through
//! [`HostThreadIndex`], including one row per sub-agent child thread
//! ([`crate::subagents`]) under its parent, which serves
//! `companion/threadSubagents/read`.

use std::sync::Arc;

use agent_core::model::{
    AgentItem, AgentTurn, AppThreadId, NativeSession, NativeSessionReadResult, TurnOrigin,
};
use companion_host::{
    index::{DerivedIndexSchema, META, StoreError, attach_derived, logic_version, table_exists},
    thread_index::{HostThreadIndex, IndexedThreadMetadata},
};
use redb::{
    Database, ReadTransaction, ReadableDatabase, ReadableTable, TableDefinition, WriteTransaction,
};
use serde::{Deserialize, Serialize};
use serde_json::json;

use crate::subagents::{self, ChildThread, IndexedSubagent};

/// Session id → [`StoredSession`].
const SESSIONS: TableDefinition<&str, &[u8]> = TableDefinition::new("claude_sessions");
/// `session id \0 ordinal (u32 BE)` → one neutral turn.
const SESSION_TURNS: TableDefinition<&[u8], &[u8]> = TableDefinition::new("claude_session_turns");
/// `app thread id \0 session id` → presence.
const THREAD_SESSIONS: TableDefinition<&[u8], u8> = TableDefinition::new("claude_thread_sessions");
/// `session id \0 agent id` → the sub-agent's neutral turns.
const SUBAGENT_TURNS: TableDefinition<&[u8], &[u8]> = TableDefinition::new("claude_subagent_turns");

const LOGIC_VERSION_KEY: &str = "claude_index_logic_version";
/// Bumped whenever the derived rows change meaning; a change drops them.
/// 2: person prompts of interactive sessions, `subagent` items, sub-agent
/// turns in their own table.
pub const CLAUDE_INDEX_LOGIC_VERSION: u64 = 2;

/// The Claude tables' schema in the host index.
pub const CLAUDE_INDEX_SCHEMA: ClaudeIndexSchema = ClaudeIndexSchema;

pub struct ClaudeIndexSchema;

impl DerivedIndexSchema for ClaudeIndexSchema {
    fn migrate(&self, write: &WriteTransaction, rebuild: bool) -> Result<(), StoreError> {
        let mut rebuild = rebuild;
        {
            let mut meta = write.open_table(META)?;
            if meta.get(LOGIC_VERSION_KEY)?.map(|entry| entry.value())
                != Some(CLAUDE_INDEX_LOGIC_VERSION)
            {
                rebuild = true;
                meta.insert(LOGIC_VERSION_KEY, CLAUDE_INDEX_LOGIC_VERSION)?;
            }
        }
        if rebuild {
            write.delete_table(SESSIONS)?;
            write.delete_table(SESSION_TURNS)?;
            write.delete_table(THREAD_SESSIONS)?;
            write.delete_table(SUBAGENT_TURNS)?;
        }
        write.open_table(SESSIONS)?;
        write.open_table(SESSION_TURNS)?;
        write.open_table(THREAD_SESSIONS)?;
        write.open_table(SUBAGENT_TURNS)?;
        Ok(())
    }

    fn is_current(&self, read: &ReadTransaction) -> Result<bool, StoreError> {
        Ok(
            logic_version(read, LOGIC_VERSION_KEY)? == Some(CLAUDE_INDEX_LOGIC_VERSION)
                && table_exists(read, THREAD_SESSIONS)?
                && table_exists(read, SUBAGENT_TURNS)?,
        )
    }
}

/// One indexed session.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StoredSession {
    pub session: NativeSession,
    /// The session's sub-agents; their turns live in their own table, so a
    /// session row stays small however much its sub-agents did.
    pub subagents: Vec<IndexedSubagent>,
    pub turn_count: u32,
    /// Whether a person's turn exists (a thread without one is a shell).
    #[serde(default)]
    pub has_user_turn: bool,
}

impl StoredSession {
    #[must_use]
    pub fn app_thread_id(&self) -> &AppThreadId {
        &self.session.app_thread_id
    }
}

/// The size and modification time a change detector observed for a
/// session's native record.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct Observation {
    pub file_size: u64,
    pub last_modified_ms: i64,
}

/// What [`ClaudeStore::replace_session`] did.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum Replaced {
    /// The session and its turns were already indexed exactly so.
    Unchanged,
    Written,
}

/// The Claude session index over the shared host index database.
pub struct ClaudeStore {
    database: Arc<Database>,
    threads: Arc<dyn HostThreadIndex>,
}

impl ClaudeStore {
    /// Attaches to a host index database, migrating the Claude tables when
    /// the index was opened without [`CLAUDE_INDEX_SCHEMA`].
    ///
    /// # Errors
    ///
    /// Returns an error when the tables cannot be checked or created.
    pub fn attach(
        database: Arc<Database>,
        threads: Arc<dyn HostThreadIndex>,
    ) -> Result<Self, StoreError> {
        attach_derived(&database, &CLAUDE_INDEX_SCHEMA)?;
        Ok(Self { database, threads })
    }

    /// The indexed session.
    ///
    /// # Errors
    ///
    /// Returns an error when the index cannot be read or a row is invalid.
    pub fn session(&self, session_id: &str) -> Result<Option<StoredSession>, StoreError> {
        let read = self.database.begin_read()?;
        let table = read.open_table(SESSIONS)?;
        table
            .get(session_id)?
            .map(|row| serde_json::from_slice(row.value()))
            .transpose()
            .map_err(StoreError::from)
    }

    /// Every indexed session id.
    ///
    /// # Errors
    ///
    /// Returns an error when the index cannot be read.
    pub fn session_ids(&self) -> Result<Vec<String>, StoreError> {
        let read = self.database.begin_read()?;
        let table = read.open_table(SESSIONS)?;
        table
            .iter()?
            .map(|entry| entry.map(|(key, _value)| key.value().to_owned()))
            .collect::<Result<_, _>>()
            .map_err(StoreError::from)
    }

    /// Whether the indexed session matches an observation of its record.
    ///
    /// # Errors
    ///
    /// Returns an error when the index cannot be read.
    pub fn is_current(&self, session_id: &str, observed: Observation) -> Result<bool, StoreError> {
        Ok(self.session(session_id)?.is_some_and(|stored| {
            stored.session.file_size.is_some_and(|size| {
                u64::try_from(size).is_ok_and(|size| size == observed.file_size)
            }) && stored.session.last_modified_ms == observed.last_modified_ms
        }))
    }

    /// Atomically replaces one session's turns with a fresh neutral read. A
    /// read identical to the indexed one writes nothing.
    ///
    /// # Errors
    ///
    /// Returns an error when serialization or the index transaction fails.
    pub fn replace_session(&self, read: &NativeSessionReadResult) -> Result<Replaced, StoreError> {
        let session_id = read.session.session_id.as_str();
        let thread = &read.session.app_thread_id;
        let stored = StoredSession {
            session: read.session.clone(),
            subagents: subagents::index(read),
            turn_count: u32::try_from(read.turns.len())
                .map_err(|_| StoreError::CorruptedIndex("too many turns in a session".into()))?,
            has_user_turn: read.turns.iter().any(|turn| {
                turn.origin == TurnOrigin::User
                    || turn
                        .items
                        .iter()
                        .any(|item| matches!(item, AgentItem::UserMessage { .. }))
            }),
        };
        if self.session(session_id)?.as_ref() == Some(&stored)
            && self.session_turns(session_id)? == read.turns
            && self.subagents_unchanged(session_id, read)?
        {
            return Ok(Replaced::Unchanged);
        }
        let encoded_subagents = read
            .subagents
            .iter()
            .map(|subagent| {
                Ok((
                    subagent_key(session_id, &subagent.agent_id),
                    serde_json::to_vec(&subagent.turns)?,
                ))
            })
            .collect::<Result<Vec<_>, StoreError>>()?;
        let encoded_turns = read
            .turns
            .iter()
            .map(serde_json::to_vec)
            .collect::<Result<Vec<_>, _>>()?;
        let encoded = serde_json::to_vec(&stored)?;
        let write = self.database.begin_write()?;
        {
            let mut sessions = write.open_table(SESSIONS)?;
            let previous = sessions
                .get(session_id)?
                .map(|row| serde_json::from_slice::<StoredSession>(row.value()))
                .transpose()?;
            sessions.insert(session_id, encoded.as_slice())?;
            let mut threads = write.open_table(THREAD_SESSIONS)?;
            if let Some(previous) = previous {
                threads
                    .remove(thread_session_key(previous.app_thread_id(), session_id).as_slice())?;
            }
            threads.insert(thread_session_key(thread, session_id).as_slice(), 1)?;
            let mut turns = write.open_table(SESSION_TURNS)?;
            let (start, end) = turn_range(session_id);
            turns.retain_in(start.as_slice()..=end.as_slice(), |_key, _value| false)?;
            for (ordinal, turn) in encoded_turns.iter().enumerate() {
                let ordinal = u32::try_from(ordinal).map_err(|_| {
                    StoreError::CorruptedIndex("too many turns in a session".into())
                })?;
                turns.insert(turn_key(session_id, ordinal).as_slice(), turn.as_slice())?;
            }
            let mut subagent_turns = write.open_table(SUBAGENT_TURNS)?;
            let (start, end) = subagent_range(session_id);
            subagent_turns.retain_in(start.as_slice()..=end.as_slice(), |_key, _value| false)?;
            for (key, value) in &encoded_subagents {
                subagent_turns.insert(key.as_slice(), value.as_slice())?;
            }
        }
        write.commit()?;
        self.publish_metadata(thread)?;
        Ok(Replaced::Written)
    }

    /// Replaces the listed facts of an indexed session (title, summary,
    /// `CodeWide` metadata) without re-reading its turns. Returns whether the
    /// row changed; `false` as well for a session not indexed yet.
    ///
    /// # Errors
    ///
    /// Returns an error when serialization or the index transaction fails.
    pub fn update_session(&self, session: &NativeSession) -> Result<bool, StoreError> {
        let Some(mut stored) = self.session(&session.session_id)? else {
            return Ok(false);
        };
        if &stored.session == session || stored.session.app_thread_id != session.app_thread_id {
            return Ok(false);
        }
        stored.session = session.clone();
        let encoded = serde_json::to_vec(&stored)?;
        let write = self.database.begin_write()?;
        write
            .open_table(SESSIONS)?
            .insert(session.session_id.as_str(), encoded.as_slice())?;
        write.commit()?;
        self.publish_metadata(&session.app_thread_id)?;
        Ok(true)
    }

    /// Every indexed session.
    ///
    /// # Errors
    ///
    /// Returns an error when the index cannot be read or a row is invalid.
    pub fn sessions(&self) -> Result<Vec<StoredSession>, StoreError> {
        let read = self.database.begin_read()?;
        let table = read.open_table(SESSIONS)?;
        table
            .iter()?
            .map(|entry| {
                let (_key, value) = entry?;
                Ok(serde_json::from_slice(value.value())?)
            })
            .collect()
    }

    /// Removes a session Claude's store no longer has.
    ///
    /// # Errors
    ///
    /// Returns an error when the index transaction fails.
    pub fn remove_session(&self, session_id: &str) -> Result<Option<AppThreadId>, StoreError> {
        let write = self.database.begin_write()?;
        let removed = {
            let mut sessions = write.open_table(SESSIONS)?;
            let previous = sessions
                .remove(session_id)?
                .map(|row| serde_json::from_slice::<StoredSession>(row.value()))
                .transpose()?;
            if let Some(previous) = &previous {
                write
                    .open_table(THREAD_SESSIONS)?
                    .remove(thread_session_key(previous.app_thread_id(), session_id).as_slice())?;
            }
            let mut turns = write.open_table(SESSION_TURNS)?;
            let (start, end) = turn_range(session_id);
            turns.retain_in(start.as_slice()..=end.as_slice(), |_key, _value| false)?;
            let mut subagent_turns = write.open_table(SUBAGENT_TURNS)?;
            let (start, end) = subagent_range(session_id);
            subagent_turns.retain_in(start.as_slice()..=end.as_slice(), |_key, _value| false)?;
            previous.map(|previous| previous.session.app_thread_id)
        };
        write.commit()?;
        Ok(removed)
    }

    /// The thread's indexed sessions, oldest first.
    ///
    /// # Errors
    ///
    /// Returns an error when the index cannot be read or a row is invalid.
    pub fn thread_sessions(&self, thread: &AppThreadId) -> Result<Vec<StoredSession>, StoreError> {
        let read = self.database.begin_read()?;
        let threads = read.open_table(THREAD_SESSIONS)?;
        let sessions = read.open_table(SESSIONS)?;
        let mut prefix = thread.as_str().as_bytes().to_vec();
        prefix.push(0);
        let mut end = prefix.clone();
        end.push(u8::MAX);
        let mut stored = Vec::new();
        for entry in threads.range(prefix.as_slice()..=end.as_slice())? {
            let (key, _value) = entry?;
            let session_id = std::str::from_utf8(&key.value()[prefix.len()..])
                .map_err(|_| StoreError::CorruptedIndex("session id is not UTF-8".into()))?;
            if let Some(row) = sessions.get(session_id)? {
                stored.push(serde_json::from_slice::<StoredSession>(row.value())?);
            }
        }
        stored.sort_by(|left, right| {
            (session_start(&left.session), &left.session.session_id)
                .cmp(&(session_start(&right.session), &right.session.session_id))
        });
        Ok(stored)
    }

    /// The thread's complete indexed history: its sessions' turns, oldest
    /// session first, one turn per id; `None` when no session of the thread
    /// is indexed.
    ///
    /// # Errors
    ///
    /// Returns an error when the index cannot be read or a row is invalid.
    pub fn thread_turns(&self, thread: &AppThreadId) -> Result<Option<Vec<AgentTurn>>, StoreError> {
        let sessions = self.thread_sessions(thread)?;
        if sessions.is_empty() {
            return Ok(None);
        }
        let mut turns: Vec<AgentTurn> = Vec::new();
        for session in &sessions {
            for turn in self.session_turns(&session.session.session_id)? {
                // A turn interrupted by a lost session reappears at the start
                // of its replacement session under the same id; the later
                // session's share wins.
                turns.retain(|earlier| earlier.turn_id != turn.turn_id);
                turns.push(turn);
            }
        }
        Ok(Some(turns))
    }

    /// Whether every indexed sub-agent transcript of the session equals the read's.
    fn subagents_unchanged(
        &self,
        session_id: &str,
        read: &NativeSessionReadResult,
    ) -> Result<bool, StoreError> {
        let transaction = self.database.begin_read()?;
        let table = transaction.open_table(SUBAGENT_TURNS)?;
        let (start, end) = subagent_range(session_id);
        let indexed = table.range(start.as_slice()..=end.as_slice())?.count();
        if indexed != read.subagents.len() {
            return Ok(false);
        }
        for subagent in &read.subagents {
            let key = subagent_key(session_id, &subagent.agent_id);
            let Some(row) = table.get(key.as_slice())? else {
                return Ok(false);
            };
            if serde_json::from_slice::<Vec<AgentTurn>>(row.value())? != subagent.turns {
                return Ok(false);
            }
        }
        Ok(true)
    }

    /// The indexed child thread of a sub-agent (`<parent>:agent:<agent id>`);
    /// `None` for any other id, an unknown agent or a deleted parent.
    ///
    /// # Errors
    ///
    /// Returns an error when the index cannot be read or a row is invalid.
    pub fn child_thread(&self, thread: &AppThreadId) -> Result<Option<ChildThread>, StoreError> {
        let Some((parent, agent_id)) = subagents::parse_child_thread_id(thread) else {
            return Ok(None);
        };
        let sessions = self.thread_sessions(&parent)?;
        if crate::catalog::is_deleted(&sessions.iter().collect::<Vec<_>>()) {
            return Ok(None);
        }
        for stored in sessions {
            let Some(subagent) = stored
                .subagents
                .iter()
                .find(|subagent| subagent.agent_id == agent_id)
            else {
                continue;
            };
            let transaction = self.database.begin_read()?;
            let table = transaction.open_table(SUBAGENT_TURNS)?;
            let key = subagent_key(&stored.session.session_id, agent_id);
            let turns = table
                .get(key.as_slice())?
                .map(|row| serde_json::from_slice::<Vec<AgentTurn>>(row.value()))
                .transpose()?
                .unwrap_or_default();
            let cwd = thread_cwd(&stored);
            return Ok(Some(ChildThread {
                thread_id: thread.clone(),
                parent,
                cwd,
                subagent: subagent.clone(),
                turns,
            }));
        }
        Ok(None)
    }

    fn session_turns(&self, session_id: &str) -> Result<Vec<AgentTurn>, StoreError> {
        let read = self.database.begin_read()?;
        let table = read.open_table(SESSION_TURNS)?;
        let (start, end) = turn_range(session_id);
        table
            .range(start.as_slice()..=end.as_slice())?
            .map(|entry| {
                let (_key, value) = entry?;
                Ok(serde_json::from_slice(value.value())?)
            })
            .collect()
    }

    /// Publishes the thread's working directory and times to the companion
    /// thread index (terminal working directory, subagent tree).
    fn publish_metadata(&self, thread: &AppThreadId) -> Result<(), StoreError> {
        let sessions = self.thread_sessions(thread)?;
        let (Some(first), Some(last)) = (sessions.first(), sessions.last()) else {
            return Ok(());
        };
        let updated_at = sessions
            .iter()
            .map(|session| session.session.last_modified_ms)
            .max()
            .unwrap_or(last.session.last_modified_ms);
        let Some(cwd) = sessions
            .iter()
            .rev()
            .find_map(|session| session.session.cwd.clone())
        else {
            return Ok(());
        };
        self.threads.put_thread_metadata(&IndexedThreadMetadata {
            id: thread.as_str().to_owned(),
            parent_thread_id: None,
            cwd,
            created_at: session_start(&first.session) / 1000,
            updated_at: updated_at / 1000,
            model_provider: "anthropic".into(),
            cli_version: String::new(),
            source: json!("claude"),
            agent_nickname: None,
            agent_role: None,
            archived: false,
        })?;
        let children = sessions
            .iter()
            .flat_map(|stored| {
                let cwd = thread_cwd(stored);
                let created_at = session_start(&stored.session) / 1000;
                stored.subagents.iter().filter_map(move |subagent| {
                    subagents::thread_metadata(thread, &cwd, created_at, subagent)
                })
            })
            .collect::<Vec<_>>();
        if children.is_empty() {
            return Ok(());
        }
        self.threads.put_thread_metadata_batch(&children)
    }
}

/// Where a session's turns run: the `CodeWide` thread's directory, else the session's.
fn thread_cwd(stored: &StoredSession) -> String {
    stored
        .session
        .codewide
        .as_ref()
        .map(|codewide| codewide.cwd.clone())
        .or_else(|| stored.session.cwd.clone())
        .unwrap_or_default()
}

fn subagent_key(session_id: &str, agent_id: &str) -> Vec<u8> {
    let mut key = Vec::with_capacity(session_id.len() + 1 + agent_id.len());
    key.extend_from_slice(session_id.as_bytes());
    key.push(0);
    key.extend_from_slice(agent_id.as_bytes());
    key
}

fn subagent_range(session_id: &str) -> (Vec<u8>, Vec<u8>) {
    let mut start = session_id.as_bytes().to_vec();
    start.push(0);
    let mut end = start.clone();
    end.push(u8::MAX);
    (start, end)
}

/// When the session started; a store without a creation time sorts it by its
/// last modification.
fn session_start(session: &NativeSession) -> i64 {
    session.created_at_ms.unwrap_or(session.last_modified_ms)
}

fn thread_session_key(thread: &AppThreadId, session_id: &str) -> Vec<u8> {
    let mut key = Vec::with_capacity(thread.as_str().len() + 1 + session_id.len());
    key.extend_from_slice(thread.as_str().as_bytes());
    key.push(0);
    key.extend_from_slice(session_id.as_bytes());
    key
}

fn turn_key(session_id: &str, ordinal: u32) -> Vec<u8> {
    let mut key = Vec::with_capacity(session_id.len() + 5);
    key.extend_from_slice(session_id.as_bytes());
    key.push(0);
    key.extend_from_slice(&ordinal.to_be_bytes());
    key
}

fn turn_range(session_id: &str) -> (Vec<u8>, Vec<u8>) {
    (turn_key(session_id, 0), turn_key(session_id, u32::MAX))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_support::{MemoryThreadIndex, session_read};

    fn open(path: &std::path::Path) -> Result<(ClaudeStore, Arc<MemoryThreadIndex>), StoreError> {
        let database = companion_host::database::open(path, "test")?;
        let threads = Arc::new(MemoryThreadIndex::default());
        Ok((ClaudeStore::attach(database, threads.clone())?, threads))
    }

    /// A session whose first turn spawned `agent` (still running when
    /// `running`), with the agent's own transcript.
    fn read_with_subagent(running: bool) -> NativeSessionReadResult {
        let mut read = session_read("session-s", "thread-s", 30, &["plan"]);
        let child = "thread-s:agent:a0001";
        if let Some(turn) = read.turns.first_mut() {
            turn.items.insert(
                1,
                AgentItem::Subagent {
                    item_id: agent_core::model::ItemId::from_static("toolu_spawn"),
                    provenance: None,
                    agent_thread_id: AppThreadId::parse(child),
                    agent_type: Some("Explore".into()),
                    background: true,
                    description: "Check the build".into(),
                    model: None,
                    prompt: "Run the build".into(),
                    result: None,
                    status: if running {
                        agent_core::model::SubagentStatus::Running
                    } else {
                        agent_core::model::SubagentStatus::Completed
                    },
                },
            );
        }
        let mut sub_turn = crate::test_support::turn("agent", "Run the build", 31);
        if running {
            sub_turn.status = agent_core::model::TurnStatus::InProgress;
            sub_turn.completed_at = None;
        }
        read.subagents.push(agent_core::model::NativeSubagent {
            agent_id: "a0001".into(),
            parent_agent_id: None,
            parent_tool_use_id: Some("toolu_spawn".into()),
            turns: vec![sub_turn],
        });
        read
    }

    #[test]
    fn sub_agents_are_child_threads_under_their_parent() -> Result<(), Box<dyn std::error::Error>> {
        let directory = tempfile::tempdir()?;
        let (store, threads) = open(&directory.path().join("index.redb"))?;
        let running = read_with_subagent(true);
        assert_eq!(store.replace_session(&running)?, Replaced::Written);
        assert_eq!(store.replace_session(&running)?, Replaced::Unchanged);

        let child_id = AppThreadId::from_static("thread-s:agent:a0001");
        let child = store.child_thread(&child_id)?.ok_or("child thread")?;
        assert_eq!(child.parent.as_str(), "thread-s");
        assert_eq!(child.turns.len(), 1);
        assert!(child.active_turn().is_some());
        let provider = agent_core::model::ProviderId::from_static("claude");
        let thread = child.thread(&provider);
        assert_eq!(thread.name.as_deref(), Some("Check the build"));
        assert_eq!(thread.status, agent_core::model::ThreadStatus::Active);
        assert_eq!(thread.preview, "Run the build");

        let row = threads.metadata(child_id.as_str()).ok_or("child row")?;
        assert_eq!(row.parent_thread_id.as_deref(), Some("thread-s"));
        assert_eq!(row.agent_nickname.as_deref(), Some("Check the build"));
        assert_eq!(row.agent_role.as_deref(), Some("Explore"));
        assert_eq!(row.cwd, "/work/session-s");

        // The agent finished: the same session re-read updates the child.
        let finished = read_with_subagent(false);
        assert_eq!(store.replace_session(&finished)?, Replaced::Written);
        let child = store.child_thread(&child_id)?.ok_or("child thread")?;
        assert!(child.active_turn().is_none());
        assert_eq!(
            child.thread(&provider).status,
            agent_core::model::ThreadStatus::Idle
        );

        assert!(
            store
                .child_thread(&AppThreadId::from_static("thread-s:agent:unknown"))?
                .is_none()
        );
        assert!(
            store
                .child_thread(&AppThreadId::from_static("thread-s"))?
                .is_none()
        );
        store.remove_session("session-s")?;
        assert!(store.child_thread(&child_id)?.is_none());
        Ok(())
    }

    #[test]
    fn reindexing_the_same_read_writes_nothing_and_a_new_read_replaces_turns()
    -> Result<(), Box<dyn std::error::Error>> {
        let directory = tempfile::tempdir()?;
        let (store, threads) = open(&directory.path().join("index.redb"))?;
        let thread = AppThreadId::from_static("thread-a");
        let first = session_read("session-a", "thread-a", 10, &["one", "two"]);
        assert_eq!(store.replace_session(&first)?, Replaced::Written);
        assert_eq!(store.replace_session(&first)?, Replaced::Unchanged);
        assert_eq!(
            store.thread_turns(&thread)?.map(|turns| turns.len()),
            Some(2)
        );
        assert_eq!(threads.cwd("thread-a").as_deref(), Some("/work/session-a"));

        let grown = session_read("session-a", "thread-a", 20, &["one"]);
        assert_eq!(store.replace_session(&grown)?, Replaced::Written);
        let turns = store.thread_turns(&thread)?.ok_or("indexed thread")?;
        assert_eq!(turns.len(), 1);
        assert!(store.is_current(
            "session-a",
            Observation {
                file_size: 20,
                last_modified_ms: 20_000
            }
        )?);
        assert!(!store.is_current(
            "session-a",
            Observation {
                file_size: 10,
                last_modified_ms: 10_000
            }
        )?);

        assert_eq!(store.remove_session("session-a")?, Some(thread.clone()));
        assert!(store.thread_turns(&thread)?.is_none());
        assert!(store.session_ids()?.is_empty());
        Ok(())
    }

    #[test]
    fn a_thread_concatenates_its_sessions_oldest_first() -> Result<(), Box<dyn std::error::Error>> {
        let directory = tempfile::tempdir()?;
        let (store, _threads) = open(&directory.path().join("index.redb"))?;
        store.replace_session(&session_read("late", "chain", 30, &["third"]))?;
        store.replace_session(&session_read("early", "chain", 10, &["first", "second"]))?;
        let turns = store
            .thread_turns(&AppThreadId::from_static("chain"))?
            .ok_or("indexed chain")?;
        assert_eq!(
            turns
                .iter()
                .map(|turn| turn.turn_id.as_str())
                .collect::<Vec<_>>(),
            ["early-first", "early-second", "late-third"]
        );
        Ok(())
    }

    #[test]
    fn a_replacement_session_supersedes_the_interrupted_turn_of_a_lost_one()
    -> Result<(), Box<dyn std::error::Error>> {
        let directory = tempfile::tempdir()?;
        let (store, _threads) = open(&directory.path().join("index.redb"))?;
        let mut lost = session_read("lost", "chain", 10, &["one", "two"]);
        let mut replacement = session_read("replacement", "chain", 20, &["three"]);
        // The resent prompt keeps the interrupted turn's id.
        replacement.turns.insert(0, lost.turns[1].clone());
        lost.turns[1].status = agent_core::model::TurnStatus::Interrupted;
        store.replace_session(&lost)?;
        store.replace_session(&replacement)?;
        let turns = store
            .thread_turns(&AppThreadId::from_static("chain"))?
            .ok_or("indexed chain")?;
        assert_eq!(
            turns
                .iter()
                .map(|turn| (turn.turn_id.as_str(), turn.status))
                .collect::<Vec<_>>(),
            [
                ("lost-one", agent_core::model::TurnStatus::Completed),
                ("lost-two", agent_core::model::TurnStatus::Completed),
                (
                    "replacement-three",
                    agent_core::model::TurnStatus::Completed
                ),
            ]
        );
        Ok(())
    }

    #[test]
    fn a_logic_version_change_rebuilds_only_claude_tables() -> Result<(), Box<dyn std::error::Error>>
    {
        const COMPANION: TableDefinition<&str, u64> = TableDefinition::new("companion_table");
        let directory = tempfile::tempdir()?;
        let path = directory.path().join("index.redb");
        {
            let (store, _threads) = open(&path)?;
            store.replace_session(&session_read("session", "thread", 10, &["one"]))?;
            let write = store.database.begin_write()?;
            write.open_table(COMPANION)?.insert("kept", 7)?;
            write
                .open_table(META)?
                .insert(LOGIC_VERSION_KEY, CLAUDE_INDEX_LOGIC_VERSION + 1)?;
            write.commit()?;
        }
        let (store, _threads) = open(&path)?;
        assert!(store.session_ids()?.is_empty());
        let read = store.database.begin_read()?;
        assert_eq!(
            read.open_table(COMPANION)?
                .get("kept")?
                .map(|row| row.value()),
            Some(7)
        );
        assert_eq!(
            logic_version(&read, LOGIC_VERSION_KEY)?,
            Some(CLAUDE_INDEX_LOGIC_VERSION)
        );
        Ok(())
    }
}
