//! The turn index a companion-driven thread keeps next to Claude's store:
//! what the store cannot tell about a turn. Its JSON is the host's
//! `ThreadState` v2 `turns` array (camelCase), so existing state files read
//! unchanged. Carries ids only, never content.

use agent_core::model::{TurnError, TurnOrigin, TurnUsageRecord};
use serde::{Deserialize, Serialize};

/// Why a prompt was offered: the turn's first prompt, an explicit steer, or
/// the first prompt resent (with a history prefix) to a replacement session.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum PromptRole {
    First,
    Resend,
    Steer,
}

/// One prompt the companion offered inside a turn.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PromptRecord {
    pub client_message_id: Option<String>,
    pub role: PromptRole,
    /// Uuid of the persisted user message, or `None` when the offer had none.
    pub uuid: Option<String>,
}

/// How a companion-driven turn ended. `InProgress` only while the turn runs.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "status", rename_all = "camelCase")]
pub enum TurnOutcomeRecord {
    Failed { error: TurnError },
    Completed,
    InProgress,
    Interrupted,
}

/// Index entry of one turn the companion drove.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TurnRecord {
    /// Persisted message uuids of this turn: its prompt uuids and its first persisted frame uuid.
    pub anchors: Vec<String>,
    pub completed_at: Option<i64>,
    pub origin: TurnOrigin,
    pub outcome: TurnOutcomeRecord,
    pub prompts: Vec<PromptRecord>,
    pub started_at: i64,
    pub turn_id: String,
    /// The usage `usage.updated` reported when the turn ended; `None` when none was measured.
    pub usage: Option<TurnUsageRecord>,
}

impl TurnRecord {
    /// The uuid of the first message Claude persisted for this turn.
    #[must_use]
    pub fn start_anchor(&self) -> Option<&str> {
        if self.origin == TurnOrigin::User {
            return self
                .prompts
                .iter()
                .find(|prompt| prompt.role == PromptRole::First)
                .and_then(|prompt| prompt.uuid.as_deref());
        }
        self.anchors.iter().map(String::as_str).find(|anchor| {
            !self
                .prompts
                .iter()
                .any(|prompt| prompt.uuid.as_deref() == Some(*anchor))
        })
    }
}
