//! Encoding and shape checks of the host's own state files. Records are
//! written only by the store, but they are still read through these checks
//! so that a truncated, foreign or older file is rejected instead of
//! trusted. Mirrors `host/src/state/codec.ts`: unknown extra fields are
//! ignored, `null` and an absent optional field both read as absent, the
//! version must be 2, the session chain must not be empty, an absent usage
//! baseline is unknown, an absent or `null` total cost is
//! [`initial_thread_cost`] of the total usage, and an absent
//! `cacheWriteInputTokens` reads as 0. Pure; no I/O.

use agent_core::model::{AgentTurn, AppThreadId, ThreadSettings, TokenUsage, TurnUsageRecord};
use serde::{Deserialize, Serialize, de};

use super::thread_state::{
    SessionChain, StateVersion, ThreadCost, ThreadPresence, ThreadState, ThreadStateOrigin,
    TitleOverride, TurnRecord, UsageBaseline,
};
use crate::{PROVIDER_ID, live::usage::initial_thread_cost};

/// `state.json` as it may be found on disk, before the defaults of fields
/// added later are applied.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ThreadStateRecord {
    app_thread_id: AppThreadId,
    created_at: i64,
    cwd: String,
    origin: ThreadStateOrigin,
    pending_settings: Option<ThreadSettings>,
    presence: ThreadPresence,
    recency_at: Option<i64>,
    session_ids: SessionChain,
    session_started: bool,
    settings: ThreadSettings,
    title: TitleOverride,
    /// Absent in state written before cost accounting.
    total_cost: Option<ThreadCost>,
    total_usage: TokenUsage,
    turns: Vec<TurnRecord>,
    updated_at: i64,
    /// Absent in state written before the baseline existed; `null` is invalid.
    #[serde(default = "unknown_baseline")]
    usage_baseline: UsageBaseline,
    version: StateVersion,
}

fn unknown_baseline() -> UsageBaseline {
    UsageBaseline::Unknown
}

impl From<ThreadStateRecord> for ThreadState {
    fn from(record: ThreadStateRecord) -> Self {
        let total_usage = with_cache_writes(record.total_usage);
        let mut turns = record.turns;
        for turn in &mut turns {
            if let Some(usage) = &mut turn.usage {
                complete_usage_record(usage);
            }
        }
        Self {
            app_thread_id: record.app_thread_id,
            created_at: record.created_at,
            cwd: record.cwd,
            origin: record.origin,
            pending_settings: record.pending_settings,
            presence: record.presence,
            recency_at: record.recency_at,
            session_ids: record.session_ids,
            session_started: record.session_started,
            settings: record.settings,
            title: record.title,
            total_cost: record
                .total_cost
                .unwrap_or_else(|| initial_thread_cost(&total_usage)),
            total_usage,
            turns,
            updated_at: record.updated_at,
            usage_baseline: record.usage_baseline,
            version: record.version,
        }
    }
}

/// Token usage with an absent `cacheWriteInputTokens` (written before it
/// existed) read as 0.
#[must_use]
pub fn with_cache_writes(usage: TokenUsage) -> TokenUsage {
    TokenUsage {
        cache_write_input_tokens: Some(usage.cache_write_input_tokens.unwrap_or(0)),
        ..usage
    }
}

fn complete_usage_record(usage: &mut TurnUsageRecord) {
    usage.last = with_cache_writes(usage.last);
    usage.turn = with_cache_writes(usage.turn);
    usage.total = with_cache_writes(usage.total);
}

#[derive(Deserialize)]
struct ActiveTurnRecord {
    turn: AgentTurn,
    #[serde(rename = "version")]
    _version: StateVersion,
}

#[derive(Serialize)]
struct ActiveTurnView<'turn> {
    turn: &'turn AgentTurn,
    version: StateVersion,
}

/// Decodes `state.json`.
///
/// # Errors
/// When the bytes are not JSON or not a v2 `ThreadState`.
pub fn decode_thread_state(bytes: &[u8]) -> Result<ThreadState, serde_json::Error> {
    serde_json::from_slice(bytes)
}

/// Encodes `state.json`.
///
/// # Errors
/// Only when serialization itself fails (it does not for valid values).
pub fn encode_thread_state(state: &ThreadState) -> Result<Vec<u8>, serde_json::Error> {
    serde_json::to_vec(state)
}

/// Decodes `active-turn.json` to the turn it holds.
///
/// # Errors
/// When the bytes are not JSON, not a v2 snapshot, or the turn or one of its
/// items carries another provider's provenance.
pub fn decode_active_turn(bytes: &[u8]) -> Result<AgentTurn, serde_json::Error> {
    let record: ActiveTurnRecord = serde_json::from_slice(bytes)?;
    claude_turn(record.turn)
}

/// Encodes `active-turn.json` for `turn`.
///
/// # Errors
/// Only when serialization itself fails (it does not for valid values).
pub fn encode_active_turn(turn: &AgentTurn) -> Result<Vec<u8>, serde_json::Error> {
    serde_json::to_vec(&ActiveTurnView {
        turn,
        version: StateVersion::default(),
    })
}

/// The host records only its own provider: a turn or item stamped with
/// another provider's provenance is foreign.
pub(crate) fn claude_turn(turn: AgentTurn) -> Result<AgentTurn, serde_json::Error> {
    let provenances = turn
        .provenance
        .iter()
        .chain(turn.items.iter().filter_map(|item| item.provenance()));
    for provenance in provenances {
        if provenance.provider.as_str() != PROVIDER_ID {
            return Err(de::Error::custom(format_args!(
                "provenance.provider: expected {PROVIDER_ID}"
            )));
        }
    }
    Ok(turn)
}
