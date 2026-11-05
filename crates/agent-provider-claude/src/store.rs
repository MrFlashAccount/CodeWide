//! The Claude session index: tables the Claude adapter derives from Claude's
//! native session store inside the companion's host index database.
//!
//! Turns are never copied. Each session file and sub-agent transcript is a
//! file of the shared segmented offset index (`agent_index::segment`, tables
//! [`CLAUDE_SEGMENT_TABLES`]): its turns are byte ranges of Claude's own
//! file, with the scan state each starts from, the uuids later rows name and
//! the facts later rows report. What the index derives from a turn when it
//! changes is its [`TurnDigest`] (preview, sub-agent launches, resources),
//! kept in the turn summary table; a session row ([`StoredSession`]) keeps
//! the session's listing facts and the aggregates of its digests.
//!
//! The tables are disposable: [`CLAUDE_INDEX_SCHEMA`] drops them when the
//! companion schema asks for a rebuild or when [`CLAUDE_INDEX_LOGIC_VERSION`]
//! changes, and the indexer reads every file again from its first byte.
//! Thread metadata stays companion state, published through
//! [`HostThreadIndex`], including one row per sub-agent child thread
//! ([`crate::subagents`]) under its parent, which serves
//! `companion/threadSubagents/read`.

use std::{collections::BTreeMap, path::PathBuf, sync::Arc};

use agent_core::model::{AppThreadId, NativeSession, SubagentStatus};
use agent_index::{IndexTables, SegmentStore, SegmentTables, TurnRef};
use agent_resources::data::ResourceData;
use companion_host::{
    index::{DerivedIndexSchema, META, StoreError, attach_derived, logic_version, table_exists},
    thread_index::{HostThreadIndex, IndexedThreadMetadata},
};
use redb::{
    Database, ReadTransaction, ReadableDatabase, ReadableTable, TableDefinition, WriteTransaction,
};
use serde::{Deserialize, Serialize};
use serde_json::json;
use tracing::warn;

use crate::{
    runtime::open_elsewhere::SessionActivity,
    subagents::{self, IndexedSubagent},
};

/// Session id → [`StoredSession`].
const SESSIONS: TableDefinition<&str, &[u8]> = TableDefinition::new("claude_sessions");
/// `app thread id \0 session id` → presence.
const THREAD_SESSIONS: TableDefinition<&[u8], u8> = TableDefinition::new("claude_thread_sessions");
/// Copies of neutral turns the index kept before logic version 17; dropped.
const RETIRED_SESSION_TURNS: TableDefinition<&[u8], &[u8]> =
    TableDefinition::new("claude_session_turns");
const RETIRED_SUBAGENT_TURNS: TableDefinition<&[u8], &[u8]> =
    TableDefinition::new("claude_subagent_turns");

const LOGIC_VERSION_KEY: &str = "claude_index_logic_version";
/// Bumped whenever the derived rows change meaning; a change drops them.
/// 2: person prompts of interactive sessions, `subagent` items, sub-agent
/// turns in their own table. 3: each session's newest conversation message
/// ([`StoredSession::newest_message`]). 4: thread metadata of a session
/// without its own `cwd` (republishes threads the earlier guard skipped).
/// 5: a compacted session's whole history (the host read only the part after
/// the last compaction, so compacted threads lost their earlier turns).
/// 6: sessions read from Claude's files by the companion (`native`), not
/// through the Claude host. 7: background task reports as items. 8: a
/// nested background agent settled by a report in any transcript of its
/// session (they stayed running forever), and the background task a
/// `command` item started (`backgroundTaskId`). 9: a finished sub-agent a
/// `SendMessage` call resumed is running again until that run reports (it
/// stayed finished). 10: each sub-agent's own model ([`IndexedSubagent::model`]).
/// 11: every background agent a report naming several tasks stopped (only
/// the first one stopped; the others stayed running forever), and a
/// sub-agent cut off before its answer is interrupted, not completed. 12:
/// `Monitor` calls and `TaskStop` calls that stopped a shell task are
/// `command` items (they were generic tool calls). 13: the newest status fact
/// wins for a resumed sub-agent (an older unreported resume no longer keeps
/// a later finished run working forever). 14: each sub-agent's recorded
/// effort ([`IndexedSubagent::effort`]). 15: a background command item
/// carries its task and state (`background`, which replaced
/// `backgroundTaskId`), settled by its stored report. 16: that `background`
/// carries its required `startedAt` (rows an earlier build stored under 15
/// lack it and fail to decode). 17: turns are byte ranges of Claude's files
/// on the shared segmented index, indexed from each file's appended tail;
/// the copies of whole turns (`claude_session_turns`,
/// `claude_subagent_turns`) are dropped.
pub const CLAUDE_INDEX_LOGIC_VERSION: u64 = 17;

/// The segmented offset index of Claude's files.
pub const CLAUDE_SEGMENT_TABLES: SegmentTables = SegmentTables {
    index: IndexTables {
        files: "claude_index_files",
        records: "claude_index_records",
        turns: "claude_index_turns",
        turns_by_id: "claude_index_turns_by_id",
        removed_turns: "claude_index_removed_turns",
        turn_summaries: "claude_index_turn_digests",
        content: "claude_index_content",
        content_by_file: "claude_index_content_by_file",
        logic_version_key: "claude_segment_logic_version",
        logic_version: CLAUDE_INDEX_LOGIC_VERSION,
    },
    record_keys: "claude_index_record_keys",
    scan_states: "claude_index_scan_states",
    turn_states: "claude_index_turn_states",
    facts: "claude_index_facts",
};

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
            write.delete_table(THREAD_SESSIONS)?;
            write.delete_table(RETIRED_SESSION_TURNS)?;
            write.delete_table(RETIRED_SUBAGENT_TURNS)?;
        }
        write.open_table(SESSIONS)?;
        write.open_table(THREAD_SESSIONS)?;
        CLAUDE_SEGMENT_TABLES.migrate(write, rebuild)
    }

    fn is_current(&self, read: &ReadTransaction) -> Result<bool, StoreError> {
        Ok(
            logic_version(read, LOGIC_VERSION_KEY)? == Some(CLAUDE_INDEX_LOGIC_VERSION)
                && table_exists(read, THREAD_SESSIONS)?
                && CLAUDE_SEGMENT_TABLES.is_current(read)?,
        )
    }
}

/// One sub-agent transcript of a session, as last indexed.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StoredSidecar {
    pub agent_id: String,
    pub path: PathBuf,
    /// The sub-agent that spawned this one; `None` for the main conversation.
    pub parent_agent_id: Option<String>,
    pub parent_tool_use_id: Option<String>,
    /// The newest time any of its rows records.
    pub updated_at_ms: Option<i64>,
}

/// One indexed session: its listing facts, where its files are, and the
/// aggregates of its turn digests.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StoredSession {
    pub session: NativeSession,
    /// The session's sub-agents.
    pub subagents: Vec<IndexedSubagent>,
    /// Whether a person's turn exists (a thread without one is a shell).
    pub has_user_turn: bool,
    /// The preview of the session's newest conversation message
    /// ([`crate::preview::newest_message`]); `None` when no turn holds one.
    pub newest_message: Option<String>,
    /// The session file.
    pub path: PathBuf,
    pub sidecars: Vec<StoredSidecar>,
    /// Whether a Claude process held the session when it was last indexed;
    /// reads settle unfinished sub-agents with it.
    pub activity: SessionActivity,
    /// The turn index hints the session file was scanned with, by the uuid
    /// each names: a changed one rescans the turn its record lies in.
    pub hints: BTreeMap<String, String>,
}

impl StoredSession {
    #[must_use]
    pub fn app_thread_id(&self) -> &AppThreadId {
        &self.session.app_thread_id
    }
}

/// One sub-agent launch a turn holds, before later reports settle it.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SpawnDigest {
    /// The spawning tool call.
    pub item_id: String,
    pub agent_id: Option<String>,
    pub description: String,
    pub agent_type: Option<String>,
    pub status: SubagentStatus,
}

/// What the index derives from one turn when its range changes; it never
/// holds the turn itself.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TurnDigest {
    /// The turn id and range the digest was derived from; an open turn's
    /// range ends at the checkpoint it was read at. A turn that was open
    /// reads differently once closed (prompts queued after the last message
    /// count as delivered only to the open one).
    pub turn_id: String,
    pub end_offset: u64,
    pub open: bool,
    /// The turn's rows hold no entry: it is not shown.
    pub empty: bool,
    /// A person's turn (user origin or a user message).
    pub user_turn: bool,
    /// The turn's preview message ([`crate::preview::newest_message`]).
    pub preview: Option<String>,
    pub started_at: i64,
    pub completed_at: Option<i64>,
    pub spawns: Vec<SpawnDigest>,
    /// The turn's resources (file changes, attachments); `None` when it has none.
    pub resources: Option<ResourceData>,
}

/// The size and modification time a change detector observed for a
/// session's native record.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct Observation {
    pub file_size: u64,
    pub last_modified_ms: i64,
}

/// The Claude session index over the shared host index database.
pub struct ClaudeStore {
    database: Arc<Database>,
    threads: Arc<dyn HostThreadIndex>,
    segments: SegmentStore,
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
        let segments =
            SegmentStore::attach(database.clone(), threads.clone(), CLAUDE_SEGMENT_TABLES)?;
        Ok(Self {
            database,
            threads,
            segments,
        })
    }

    /// The segmented offset index of Claude's files.
    #[must_use]
    pub const fn segments(&self) -> &SegmentStore {
        &self.segments
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

    /// Writes one session's row; returns whether it changed. The thread's
    /// metadata is published to the companion thread index after a change.
    ///
    /// # Errors
    ///
    /// Returns an error when serialization or the index transaction fails.
    pub fn put_session(&self, stored: &StoredSession) -> Result<bool, StoreError> {
        let session_id = stored.session.session_id.as_str();
        let previous = self.session(session_id)?;
        if previous.as_ref() == Some(stored) {
            return Ok(false);
        }
        let encoded = serde_json::to_vec(stored)?;
        let write = self.database.begin_write()?;
        {
            write
                .open_table(SESSIONS)?
                .insert(session_id, encoded.as_slice())?;
            let mut threads = write.open_table(THREAD_SESSIONS)?;
            if let Some(previous) = &previous {
                threads
                    .remove(thread_session_key(previous.app_thread_id(), session_id).as_slice())?;
            }
            threads.insert(
                thread_session_key(stored.app_thread_id(), session_id).as_slice(),
                1,
            )?;
        }
        write.commit()?;
        if let Some(previous) =
            previous.filter(|previous| previous.app_thread_id() != stored.app_thread_id())
        {
            self.publish_metadata(previous.app_thread_id())?;
        }
        self.publish_metadata(stored.app_thread_id())?;
        Ok(true)
    }

    /// Replaces the listed facts of an indexed session (title, summary,
    /// `CodeWide` metadata) without reading its files. Returns whether the
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
        self.put_session(&stored)
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

    /// Removes a session Claude's store no longer has, with everything
    /// derived from its files.
    ///
    /// # Errors
    ///
    /// Returns an error when the index transaction fails.
    pub fn remove_session(&self, session_id: &str) -> Result<Option<AppThreadId>, StoreError> {
        let Some(previous) = self.session(session_id)? else {
            return Ok(None);
        };
        self.segments
            .reset_file(&agent_index::file_id(&previous.path))?;
        for sidecar in &previous.sidecars {
            self.segments
                .reset_file(&agent_index::file_id(&sidecar.path))?;
        }
        self.segments.remove_group(&session_group(session_id))?;
        let write = self.database.begin_write()?;
        {
            write.open_table(SESSIONS)?.remove(session_id)?;
            write
                .open_table(THREAD_SESSIONS)?
                .remove(thread_session_key(previous.app_thread_id(), session_id).as_slice())?;
        }
        write.commit()?;
        Ok(Some(previous.session.app_thread_id))
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

    /// The digest of the turn starting at `start_offset` of `file_id`.
    ///
    /// # Errors
    ///
    /// Returns an error when the index cannot be read or the digest is invalid.
    pub fn digest(
        &self,
        file_id: &[u8; 32],
        start_offset: u64,
    ) -> Result<Option<TurnDigest>, StoreError> {
        self.segments
            .index()
            .turn_summary_state(file_id, start_offset)
    }

    /// Stores the digest of the turn starting at `start_offset`.
    ///
    /// # Errors
    ///
    /// Returns an error when the index transaction fails.
    pub fn put_digest(
        &self,
        file_id: &[u8; 32],
        start_offset: u64,
        digest: &TurnDigest,
    ) -> Result<(), StoreError> {
        self.segments
            .index()
            .put_turn_summary_state(file_id, start_offset, digest)
    }

    /// Every live turn of `file_id`, oldest first.
    ///
    /// # Errors
    ///
    /// Returns an error when the index cannot be read.
    pub fn file_turns(&self, file_id: &[u8; 32]) -> Result<Vec<TurnRef>, StoreError> {
        self.segments.index().turns_asc_from(file_id, 0, usize::MAX)
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
        // The newest session that names a directory: the CodeWide thread's,
        // else the session's own. The SDK leaves a session's `cwd` unknown
        // when its first `cwd` lies past the 64 KiB head it reads, so a
        // missing one must not keep the thread, or its sub-agents, out of
        // the index.
        let cwd = sessions
            .iter()
            .rev()
            .map(thread_cwd)
            .find(|cwd| !cwd.is_empty());
        let Some(cwd) = cwd else {
            warn!(
                thread = %thread,
                "Claude thread metadata not published: no session names a directory"
            );
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
            running: None,
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

/// The group a session's files merge their facts in.
#[must_use]
pub fn session_group(session_id: &str) -> [u8; 32] {
    use sha2::{Digest, Sha256};
    let mut hash = Sha256::new();
    hash.update(b"claude-session\0");
    hash.update(session_id.as_bytes());
    hash.finalize().into()
}

/// Where a session's turns run: the `CodeWide` thread's directory, else the session's.
#[must_use]
pub fn thread_cwd(stored: &StoredSession) -> String {
    stored
        .session
        .codewide
        .as_ref()
        .map(|codewide| codewide.cwd.clone())
        .or_else(|| stored.session.cwd.clone())
        .unwrap_or_default()
}

/// When the session started; a store without a creation time sorts it by its
/// last modification.
#[must_use]
pub fn session_start(session: &NativeSession) -> i64 {
    session.created_at_ms.unwrap_or(session.last_modified_ms)
}

fn thread_session_key(thread: &AppThreadId, session_id: &str) -> Vec<u8> {
    let mut key = Vec::with_capacity(thread.as_str().len() + 1 + session_id.len());
    key.extend_from_slice(thread.as_str().as_bytes());
    key.push(0);
    key.extend_from_slice(session_id.as_bytes());
    key
}
