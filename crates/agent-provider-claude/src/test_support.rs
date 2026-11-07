//! Test doubles: an in-memory companion thread index and fixture reads.

use std::{
    collections::BTreeMap,
    sync::{Mutex, PoisonError},
};

use agent_core::model::{
    AgentItem, AgentTurn, AppThreadId, ItemId, MessagePhase, NativeSession,
    NativeSessionReadResult, TurnId, TurnOrigin, TurnStatus, UserContent,
};
use companion_host::{
    index::StoreError,
    thread_index::{HostThreadIndex, IndexedThreadMetadata, ThreadPinSnapshot},
};

#[derive(Default)]
pub(crate) struct MemoryThreadIndex {
    threads: Mutex<BTreeMap<String, IndexedThreadMetadata>>,
}

impl MemoryThreadIndex {
    pub(crate) fn cwd(&self, thread: &str) -> Option<String> {
        self.threads
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .get(thread)
            .map(|metadata| metadata.cwd.clone())
    }

    pub(crate) fn metadata(&self, thread: &str) -> Option<IndexedThreadMetadata> {
        self.threads
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .get(thread)
            .cloned()
    }
}

impl HostThreadIndex for MemoryThreadIndex {
    fn put_thread_metadata(&self, metadata: &IndexedThreadMetadata) -> Result<(), StoreError> {
        self.put_thread_metadata_batch(std::slice::from_ref(metadata))
    }

    fn put_thread_metadata_batch(
        &self,
        metadata: &[IndexedThreadMetadata],
    ) -> Result<(), StoreError> {
        let mut threads = self.threads.lock().unwrap_or_else(PoisonError::into_inner);
        for value in metadata {
            threads.insert(value.id.clone(), value.clone());
        }
        Ok(())
    }

    fn thread_descendants(&self, _root: &str) -> Result<Vec<IndexedThreadMetadata>, StoreError> {
        Ok(Vec::new())
    }

    fn thread_pin_snapshot(&self) -> Result<ThreadPinSnapshot, StoreError> {
        Ok(ThreadPinSnapshot {
            cursor: 0,
            thread_ids: Vec::new(),
        })
    }
}

/// A completed user turn `<session>-<prompt>` with the prompt and an answer.
pub(crate) fn turn(session: &str, prompt: &str, started_at: i64) -> AgentTurn {
    let turn_id = format!("{session}-{prompt}");
    AgentTurn {
        provenance: None,
        turn_id: TurnId::parse(&turn_id).unwrap_or_else(|| TurnId::from_static("fixture")),
        status: TurnStatus::Completed,
        origin: TurnOrigin::User,
        started_at,
        completed_at: Some(started_at + 1),
        error: None,
        items: vec![
            AgentItem::UserMessage {
                provenance: None,
                item_id: ItemId::parse(&format!("{turn_id}:user"))
                    .unwrap_or_else(|| ItemId::from_static("fixture")),
                client_message_id: None,
                content: vec![UserContent::Text {
                    text: prompt.to_owned(),
                }],
            },
            AgentItem::AgentMessage {
                provenance: None,
                item_id: ItemId::parse(&format!("{turn_id}:answer"))
                    .unwrap_or_else(|| ItemId::from_static("fixture")),
                text: format!("answer to {prompt}"),
                phase: MessagePhase::Final,
            },
        ],
        usage: None,
    }
}

/// A read of `session` (belonging to `thread`) whose record has `size`
/// bytes, modified at `size × 1000` ms, with one turn per prompt.
pub(crate) fn session_read(
    session: &str,
    thread: &str,
    size: i64,
    prompts: &[&str],
) -> NativeSessionReadResult {
    NativeSessionReadResult {
        session: NativeSession {
            app_thread_id: AppThreadId::parse(thread)
                .unwrap_or_else(|| AppThreadId::from_static("fixture")),
            codewide: None,
            created_at_ms: Some(size * 1000),
            cwd: Some(format!("/work/{session}")),
            file_size: Some(size),
            first_prompt: prompts.first().map(|prompt| (*prompt).to_owned()),
            interactive: true,
            last_modified_ms: size * 1000,
            session_id: session.to_owned(),
            summary: prompts
                .first()
                .map_or_else(String::new, |prompt| (*prompt).to_owned()),
            title: None,
        },
        subagents: Vec::new(),
        turns: prompts
            .iter()
            .enumerate()
            .map(|(index, prompt)| turn(session, prompt, size + i64::try_from(index).unwrap_or(0)))
            .collect(),
    }
}

/// Preview files that authorize nothing.
#[derive(Default)]
pub(crate) struct RecordingPreviewFiles;

#[async_trait::async_trait]
impl companion_host::files::PreviewFiles for RecordingPreviewFiles {
    async fn observe_preview_paths(&self, _paths: Vec<std::path::PathBuf>) {}

    async fn observe_preview_paths_within(
        &self,
        _root: std::path::PathBuf,
        _paths: Vec<std::path::PathBuf>,
    ) {
    }

    async fn mark_thread_attachments_deleted(
        &self,
        _thread_id: &str,
    ) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        Ok(())
    }
}

/// The row a catalog test lists: a stored session with the turns of `read`
/// as the index would aggregate them.
pub(crate) fn stored_session(read: &NativeSessionReadResult) -> crate::store::StoredSession {
    crate::store::StoredSession {
        session: read.session.clone(),
        subagents: Vec::new(),
        has_user_turn: read.turns.iter().any(|turn| {
            turn.origin == TurnOrigin::User
                || turn
                    .items
                    .iter()
                    .any(|item| matches!(item, AgentItem::UserMessage { .. }))
        }),
        newest_message: crate::preview::newest_message(&read.turns),
        path: std::path::PathBuf::from(format!("/sessions/{}.jsonl", read.session.session_id)),
        sidecars: Vec::new(),
        activity: crate::runtime::open_elsewhere::SessionActivity::Stopped,
        hints: BTreeMap::new(),
    }
}

/// A Claude store on disk and the index over it: session files written
/// row by row, indexed as the indexer indexes them.
pub(crate) struct StoreFixture {
    pub(crate) directory: tempfile::TempDir,
    pub(crate) store: std::sync::Arc<crate::store::ClaudeStore>,
    pub(crate) threads: std::sync::Arc<MemoryThreadIndex>,
    pub(crate) history: std::sync::Arc<crate::index::history::IndexedHistory>,
    pub(crate) search: std::sync::Arc<crate::search::ClaudeSearch>,
}

/// The uuid-shaped id of fixture session `n`.
pub(crate) fn session_id(n: u32) -> String {
    format!("{n:08x}-0000-4000-8000-000000000000")
}

impl StoreFixture {
    pub(crate) fn new() -> Result<Self, Box<dyn std::error::Error>> {
        let directory = tempfile::tempdir()?;
        let database = companion_host::database::open(directory.path().join("index.redb"), "test")?;
        let threads = std::sync::Arc::new(MemoryThreadIndex::default());
        let store = std::sync::Arc::new(crate::store::ClaudeStore::attach(
            database,
            threads.clone(),
        )?);
        let history = std::sync::Arc::new(crate::index::history::IndexedHistory::new(
            store.clone(),
            std::sync::Arc::new(crate::native::host_state::HostStateCache::new(
                directory.path().join("journal"),
            )),
        ));
        let search = std::sync::Arc::new(crate::search::ClaudeSearch::open(
            &directory.path().join("search.sqlite"),
            store.clone(),
            history.clone(),
        )?);
        Ok(Self {
            directory,
            store,
            threads,
            history,
            search,
        })
    }

    pub(crate) fn projects(&self) -> std::path::PathBuf {
        self.directory.path().join("projects")
    }

    pub(crate) fn journal(&self) -> std::path::PathBuf {
        self.directory.path().join("journal")
    }

    /// The session file of `session` in the project of `cwd`.
    pub(crate) fn path(&self, session: &str, cwd: &str) -> std::path::PathBuf {
        self.projects()
            .join(cwd.replace('/', "-"))
            .join(format!("{session}.jsonl"))
    }

    /// Appends rows to `session`'s file (created with its project).
    pub(crate) fn append(
        &self,
        session: &str,
        cwd: &str,
        rows: &[serde_json::Value],
    ) -> Result<(), Box<dyn std::error::Error>> {
        use std::io::Write as _;
        let path = self.path(session, cwd);
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let mut file = std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(path)?;
        for row in rows {
            writeln!(file, "{row}")?;
        }
        Ok(())
    }

    /// Appends one prompt and its answer per entry of `prompts`, at
    /// seconds `second`, `second + 1`, …, parented on the file's last row.
    pub(crate) fn exchange(
        &self,
        session: &str,
        cwd: &str,
        second: u32,
        prompts: &[&str],
    ) -> Result<(), Box<dyn std::error::Error>> {
        let path = self.path(session, cwd);
        let mut parent = std::fs::read_to_string(&path).ok().and_then(|text| {
            text.lines()
                .rev()
                .find_map(|line| serde_json::from_str::<serde_json::Value>(line).ok())
                .and_then(|row| {
                    row.get("uuid")
                        .and_then(serde_json::Value::as_str)
                        .map(ToOwned::to_owned)
                })
        });
        let mut rows = Vec::new();
        for (index, prompt) in prompts.iter().enumerate() {
            let at = second + 2 * u32::try_from(index).unwrap_or(0);
            let prompt_uuid = format!("{session}-{prompt}");
            let answer_uuid = format!("{session}-{prompt}-answer");
            rows.push(
                serde_json::json!({"type": "user", "uuid": prompt_uuid, "parentUuid": parent,
                "timestamp": timestamp(at), "sessionId": session, "cwd": cwd, "entrypoint": "cli",
                "isSidechain": false, "message": {"role": "user", "content": prompt}}),
            );
            rows.push(serde_json::json!({"type": "assistant", "uuid": answer_uuid, "parentUuid": prompt_uuid,
                "timestamp": timestamp(at + 1), "sessionId": session, "cwd": cwd, "isSidechain": false,
                "message": {"id": format!("msg_{answer_uuid}"), "model": "claude-opus-5-5", "role": "assistant",
                    "content": [{"type": "text", "text": format!("answer to {prompt}")}]}}));
            parent = Some(answer_uuid);
        }
        self.append(session, cwd, &rows)
    }

    /// The session index over this fixture's store.
    pub(crate) fn session_index(
        &self,
        freshness: std::sync::Arc<crate::storage::Freshness>,
    ) -> crate::index::sessions::SessionIndex {
        crate::index::sessions::SessionIndex::new(
            self.store.clone(),
            self.history.clone(),
            Some(self.search.clone()),
            self.sessions(),
            freshness,
        )
    }

    pub(crate) fn sessions(&self) -> crate::native::LocalSessions {
        crate::native::LocalSessions::for_test(
            self.projects(),
            self.journal(),
            std::collections::HashSet::new(),
        )
    }

    /// Indexes `session` and writes its search documents, as one indexer pass.
    pub(crate) fn index(
        &self,
        session: &str,
    ) -> Result<crate::index::session::SessionChanges, Box<dyn std::error::Error>> {
        let threads = self.history.host().threads();
        let sessions = self.sessions();
        let (file, listed) = sessions
            .listed_session(session, &threads)
            .ok_or("listed session")?;
        let changes = crate::index::session::index_session(
            &self.store,
            &crate::index::session::ListedSession {
                file: &file,
                session: listed,
                owner: threads.owner_of(session),
            },
            crate::runtime::open_elsewhere::SessionActivity::Stopped,
        )?;
        self.search.apply(&changes)?;
        Ok(changes)
    }
}

/// Fixture second `second` as an RFC 3339 time.
pub(crate) fn timestamp(second: u32) -> String {
    format!("2026-10-01T10:{:02}:{:02}.000Z", second / 60, second % 60)
}
