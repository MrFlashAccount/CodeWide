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
