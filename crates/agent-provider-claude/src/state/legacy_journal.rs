//! One-way reader of the version-1 journal written by the former Claude
//! sidecar (`threads/<id>/thread.json` plus `turns/<seq>.json`, which copied
//! every turn), as `host/src/state/legacyJournal.ts`. It converts a v1
//! thread into the v2 metadata record: the session chain, settings,
//! archive/tombstone state, a pending title for a `CodeWide`-only name, and
//! the turn index (prompt uuids become anchors, so history read from
//! Claude's store keeps the old turn ids and `clientMessageId` echoes). The
//! copied conversation is not carried over. Pure apart from reading the
//! given files.

use std::{io, path::Path};

use agent_core::model::{
    AgentTurn, AppThreadId, ThreadSettings, TokenUsage, TurnError, TurnErrorKind, TurnStatus,
};
use serde::Deserialize;

use crate::live::usage::initial_thread_cost;

use super::{
    codec::{claude_turn, with_cache_writes},
    store::{StateError, StoredThread},
    thread_state::{
        FormatVersion, PromptRecord, PromptRole, SessionChain, StateVersion, ThreadPresence,
        ThreadState, ThreadStateOrigin, TitleOverride, TurnOutcomeRecord, TurnRecord,
        UsageBaseline,
    },
};

/// The v1 thread record, next to the v2 `state.json`.
pub const LEGACY_THREAD_FILE: &str = "thread.json";
const TURNS_DIRECTORY: &str = "turns";
const TURN_FILE_DIGITS: usize = 8;

type LegacyVersion = FormatVersion<1>;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct LegacyThread {
    #[serde(rename = "version")]
    _version: LegacyVersion,
    app_thread_id: AppThreadId,
    archived: bool,
    claude_session_id: String,
    created_at: i64,
    cwd: String,
    deleted_at: Option<i64>,
    name: Option<String>,
    pending_settings: Option<ThreadSettings>,
    recency_at: Option<i64>,
    session_started: bool,
    settings: ThreadSettings,
    total_usage: TokenUsage,
    updated_at: i64,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct LegacyPrompt {
    client_message_id: Option<String>,
    uuid: Option<String>,
}

#[derive(Deserialize)]
struct LegacyTurn {
    #[serde(rename = "version")]
    _version: LegacyVersion,
    prompts: Vec<LegacyPrompt>,
    turn: AgentTurn,
}

/// `<8 digits>.json`, the name of a v1 turn file.
fn is_turn_file(name: &str) -> bool {
    name.strip_suffix(".json").is_some_and(|stem| {
        stem.len() == TURN_FILE_DIGITS && stem.bytes().all(|byte| byte.is_ascii_digit())
    })
}

fn decode<T: for<'de> Deserialize<'de>>(path: &Path, file: &str) -> Result<T, StateError> {
    let bytes = std::fs::read(path)?;
    serde_json::from_slice(&bytes).map_err(|source| StateError::Decode {
        file: file.to_owned(),
        source,
    })
}

fn legacy_turns(directory: &Path) -> Result<Vec<LegacyTurn>, StateError> {
    let turns_directory = directory.join(TURNS_DIRECTORY);
    let entries = match std::fs::read_dir(&turns_directory) {
        Ok(entries) => entries,
        Err(err) if err.kind() == io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(err) => return Err(err.into()),
    };
    let mut names = Vec::new();
    for entry in entries {
        if let Ok(name) = entry?.file_name().into_string()
            && is_turn_file(&name)
        {
            names.push(name);
        }
    }
    // Sorting needs the whole listing; the zero-padded names sort by sequence.
    names.sort_unstable();
    names
        .iter()
        .map(|name| {
            let legacy: LegacyTurn = decode(&turns_directory.join(name), name)?;
            let turn = claude_turn(legacy.turn).map_err(|source| StateError::Decode {
                file: name.clone(),
                source,
            })?;
            Ok(LegacyTurn { turn, ..legacy })
        })
        .collect()
}

fn outcome_of(turn: &AgentTurn) -> TurnOutcomeRecord {
    match turn.status {
        TurnStatus::Failed => TurnOutcomeRecord::Failed {
            error: turn.error.clone().unwrap_or_else(|| TurnError {
                kind: TurnErrorKind::Unknown,
                message: "Claude turn failed".to_owned(),
            }),
        },
        TurnStatus::Completed => TurnOutcomeRecord::Completed,
        TurnStatus::InProgress => TurnOutcomeRecord::InProgress,
        TurnStatus::Interrupted => TurnOutcomeRecord::Interrupted,
    }
}

/// The v2 index entry of a v1 turn, and the turn itself. v1 did not record
/// why a prompt was offered; later prompts are taken as steers.
fn turn_record(legacy: LegacyTurn) -> (TurnRecord, AgentTurn) {
    let turn = legacy.turn;
    let anchors = legacy
        .prompts
        .iter()
        .filter_map(|prompt| prompt.uuid.clone())
        .collect();
    let prompts = legacy
        .prompts
        .into_iter()
        .enumerate()
        .map(|(index, prompt)| PromptRecord {
            client_message_id: prompt.client_message_id,
            role: if index == 0 {
                PromptRole::First
            } else {
                PromptRole::Steer
            },
            uuid: prompt.uuid,
        })
        .collect();
    let record = TurnRecord {
        anchors,
        completed_at: turn.completed_at,
        origin: turn.origin,
        outcome: outcome_of(&turn),
        prompts,
        started_at: turn.started_at,
        turn_id: turn.turn_id.as_str().to_owned(),
        usage: None,
    };
    (record, turn)
}

fn session_chain(thread: &LegacyThread) -> SessionChain {
    let mut chain = SessionChain::new(thread.app_thread_id.as_str().to_owned());
    if thread.claude_session_id != thread.app_thread_id.as_str() {
        chain.push(thread.claude_session_id.clone());
    }
    chain
}

/// Reads and converts the v1 thread in `directory`, with the turn a
/// previous process left in progress, if any. `None` when the directory
/// holds no v1 journal.
///
/// # Errors
/// When a v1 file cannot be read or is not a v1 record, or the record names
/// another thread than `app_thread_id`.
pub fn convert_legacy_thread(
    directory: &Path,
    app_thread_id: &AppThreadId,
) -> Result<Option<StoredThread>, StateError> {
    let thread: LegacyThread = match decode(&directory.join(LEGACY_THREAD_FILE), LEGACY_THREAD_FILE)
    {
        Ok(thread) => thread,
        Err(StateError::Io(err)) if err.kind() == io::ErrorKind::NotFound => return Ok(None),
        Err(err) => return Err(err),
    };
    if &thread.app_thread_id != app_thread_id {
        return Err(StateError::LegacyThreadIdMismatch);
    }
    let mut active_turn = None;
    let mut turns = Vec::new();
    for legacy in legacy_turns(directory)? {
        let (record, turn) = turn_record(legacy);
        turns.push(record);
        if active_turn.is_none() && turn.status == TurnStatus::InProgress {
            active_turn = Some(turn);
        }
    }
    let total_usage = with_cache_writes(thread.total_usage);
    let session_ids = session_chain(&thread);
    let state = ThreadState {
        app_thread_id: thread.app_thread_id,
        created_at: thread.created_at,
        cwd: thread.cwd,
        origin: ThreadStateOrigin::Created,
        pending_settings: thread.pending_settings,
        presence: match thread.deleted_at {
            None => ThreadPresence::Listed {
                archived: thread.archived,
            },
            Some(deleted_at) => ThreadPresence::Deleted { deleted_at },
        },
        recency_at: thread.recency_at,
        session_ids,
        session_started: thread.session_started,
        settings: thread.settings,
        title: match thread.name {
            None => TitleOverride::None,
            Some(name) => TitleOverride::Pending { name },
        },
        total_cost: initial_thread_cost(&total_usage),
        total_usage,
        turns,
        updated_at: thread.updated_at,
        // The former sidecar kept no per-model totals.
        usage_baseline: UsageBaseline::Unknown,
        version: StateVersion::default(),
    };
    Ok(Some(StoredThread { active_turn, state }))
}
