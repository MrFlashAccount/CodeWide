//! Neutral thread, turn, item and runtime-request types (mirror of
//! `packages/agent-protocol/src/v1/model.ts`). Every field is always present
//! on the wire; absent values are `null`.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};
use serde_json::Value;

use super::ids::{AppThreadId, ClientMessageId, ItemId, ProviderId, ProviderThreadRef, TurnId};

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ThreadStatus {
    Idle,
    Active,
    NotLoaded,
    Failed,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ThreadOrigin {
    Interactive,
    External,
    Supervisor,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ThreadSettings {
    pub model: String,
    pub effort: Option<String>,
    pub permission_profile: String,
    pub service_tier: Option<String>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentThread {
    pub app_thread_id: AppThreadId,
    pub provider: ProviderId,
    pub cwd: String,
    pub name: Option<String>,
    pub preview: String,
    pub created_at: i64,
    pub updated_at: i64,
    pub recency_at: Option<i64>,
    pub archived: bool,
    pub origin: ThreadOrigin,
    pub status: ThreadStatus,
    pub settings: ThreadSettings,
}

/// The provider native thread a turn or item belongs to: with in-thread
/// provider switching an app thread spans several native threads (binding
/// segments).
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Provenance {
    pub provider: ProviderId,
    pub native_thread_id: ProviderThreadRef,
}

impl AgentTurn {
    /// Records the turn's and its items' origin where none is recorded.
    pub fn stamp(&mut self, origin: &Provenance) {
        if self.provenance.is_none() {
            self.provenance = Some(origin.clone());
        }
        for item in &mut self.items {
            item.stamp(origin);
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum TurnStatus {
    InProgress,
    Completed,
    Interrupted,
    Failed,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum TurnOrigin {
    User,
    /// The provider started the turn by itself (a wake turn); no `userMessage`.
    Provider,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum TurnErrorKind {
    Provider,
    Authentication,
    ProcessExited,
    SessionLost,
    UsageLimit,
    Unknown,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TurnError {
    pub kind: TurnErrorKind,
    pub message: String,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentTurn {
    pub turn_id: TurnId,
    pub status: TurnStatus,
    pub origin: TurnOrigin,
    pub started_at: i64,
    pub completed_at: Option<i64>,
    pub error: Option<TurnError>,
    pub items: Vec<AgentItem>,
    /// The provider native thread the turn came from. Optional on the wire;
    /// the companion stamps it (see [`AgentTurn::stamp`]).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub provenance: Option<Provenance>,
    /// Recorded usage of a finished turn on a read. Optional on the wire
    /// (added within v1); absent when the provider does not know it.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub usage: Option<TurnUsageRecord>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum UserContent {
    Text { text: String },
    Image { url: String },
    LocalImage { path: String },
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ExecutionStatus {
    InProgress,
    Completed,
    Failed,
    Declined,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum CallStatus {
    InProgress,
    Completed,
    Failed,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum FileChangeKind {
    Add,
    Delete,
    Update,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileChange {
    pub path: String,
    pub kind: FileChangeKind,
    pub move_path: Option<String>,
    pub diff: String,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum WebSearchAction {
    Search { query: String },
    OpenPage { url: String },
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpToolResult {
    pub content: Vec<Value>,
    pub structured_content: Value,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum MessagePhase {
    Commentary,
    Final,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum AgentItem {
    UserMessage {
        item_id: ItemId,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        provenance: Option<Provenance>,
        client_message_id: Option<ClientMessageId>,
        content: Vec<UserContent>,
    },
    AgentMessage {
        item_id: ItemId,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        provenance: Option<Provenance>,
        text: String,
        phase: MessagePhase,
    },
    Reasoning {
        item_id: ItemId,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        provenance: Option<Provenance>,
        summary: Vec<String>,
        content: Vec<String>,
    },
    Command {
        item_id: ItemId,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        provenance: Option<Provenance>,
        command: String,
        cwd: String,
        status: ExecutionStatus,
        output: Option<String>,
        exit_code: Option<i64>,
        duration_ms: Option<i64>,
    },
    FileChange {
        item_id: ItemId,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        provenance: Option<Provenance>,
        changes: Vec<FileChange>,
        status: ExecutionStatus,
    },
    McpToolCall {
        item_id: ItemId,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        provenance: Option<Provenance>,
        server: String,
        tool: String,
        arguments: Value,
        status: CallStatus,
        result: Option<McpToolResult>,
        error: Option<String>,
        duration_ms: Option<i64>,
    },
    ToolCall {
        item_id: ItemId,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        provenance: Option<Provenance>,
        namespace: Option<String>,
        tool: String,
        arguments: Value,
        output: Option<String>,
        status: CallStatus,
        duration_ms: Option<i64>,
    },
    WebSearch {
        item_id: ItemId,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        provenance: Option<Provenance>,
        query: String,
        action: Option<WebSearchAction>,
    },
    ImageView {
        item_id: ItemId,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        provenance: Option<Provenance>,
        path: String,
    },
    Plan {
        item_id: ItemId,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        provenance: Option<Provenance>,
        text: String,
    },
    Compaction {
        item_id: ItemId,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        provenance: Option<Provenance>,
    },
    CapabilityItem {
        item_id: ItemId,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        provenance: Option<Provenance>,
        capability: String,
        kind: String,
        payload: Value,
    },
}

impl AgentItem {
    /// The provider native thread the item came from.
    #[must_use]
    pub fn provenance(&self) -> Option<&Provenance> {
        match self {
            Self::UserMessage { provenance, .. }
            | Self::AgentMessage { provenance, .. }
            | Self::Reasoning { provenance, .. }
            | Self::Command { provenance, .. }
            | Self::FileChange { provenance, .. }
            | Self::McpToolCall { provenance, .. }
            | Self::ToolCall { provenance, .. }
            | Self::WebSearch { provenance, .. }
            | Self::ImageView { provenance, .. }
            | Self::Plan { provenance, .. }
            | Self::Compaction { provenance, .. }
            | Self::CapabilityItem { provenance, .. } => provenance.as_ref(),
        }
    }

    /// Records the item's origin unless it already carries one.
    pub fn stamp(&mut self, origin: &Provenance) {
        let (Self::UserMessage { provenance, .. }
        | Self::AgentMessage { provenance, .. }
        | Self::Reasoning { provenance, .. }
        | Self::Command { provenance, .. }
        | Self::FileChange { provenance, .. }
        | Self::McpToolCall { provenance, .. }
        | Self::ToolCall { provenance, .. }
        | Self::WebSearch { provenance, .. }
        | Self::ImageView { provenance, .. }
        | Self::Plan { provenance, .. }
        | Self::Compaction { provenance, .. }
        | Self::CapabilityItem { provenance, .. }) = self;
        if provenance.is_none() {
            *provenance = Some(origin.clone());
        }
    }

    #[must_use]
    pub fn item_id(&self) -> &ItemId {
        match self {
            Self::UserMessage { item_id, .. }
            | Self::AgentMessage { item_id, .. }
            | Self::Reasoning { item_id, .. }
            | Self::Command { item_id, .. }
            | Self::FileChange { item_id, .. }
            | Self::McpToolCall { item_id, .. }
            | Self::ToolCall { item_id, .. }
            | Self::WebSearch { item_id, .. }
            | Self::ImageView { item_id, .. }
            | Self::Plan { item_id, .. }
            | Self::Compaction { item_id, .. }
            | Self::CapabilityItem { item_id, .. } => item_id,
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ApprovalDecision {
    Accept,
    AcceptForSession,
    Decline,
    Cancel,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ApprovalKind {
    Command,
    FileChange,
    Tool,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QuestionOption {
    pub label: String,
    pub description: String,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UserInputQuestion {
    pub id: String,
    pub header: String,
    pub question: String,
    pub options: Vec<QuestionOption>,
    pub multi_select: bool,
    pub secret: bool,
    pub allow_other: bool,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum RuntimeRequest {
    Approval {
        kind: ApprovalKind,
        item_id: ItemId,
        title: String,
        detail: Option<String>,
        command: Option<String>,
        cwd: Option<String>,
        decisions: Vec<ApprovalDecision>,
    },
    UserInput {
        item_id: ItemId,
        questions: Vec<UserInputQuestion>,
    },
    CapabilityRequest {
        capability: String,
        payload: Value,
    },
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct UserInputAnswer {
    pub answers: Vec<String>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum RuntimeResponse {
    Approval {
        decision: ApprovalDecision,
    },
    UserInput {
        answers: BTreeMap<String, UserInputAnswer>,
    },
    Capability {
        payload: Value,
    },
    /// The client failed to answer; providers treat it as a decline.
    Error {
        message: String,
    },
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum RequestResolution {
    Responded,
    Cancelled,
    TurnEnded,
    ProviderRestarted,
}

/// Token counters. `input_tokens` counts every prompt token, including the
/// cache reads and cache writes it contains; `output_tokens` includes
/// `reasoning_output_tokens`.
#[derive(Clone, Copy, Debug, Default, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TokenUsage {
    pub input_tokens: i64,
    pub cached_input_tokens: i64,
    /// Prompt tokens written to the provider's prompt cache. Optional on the
    /// wire (added within v1); absent means 0.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cache_write_input_tokens: Option<i64>,
    pub output_tokens: i64,
    pub reasoning_output_tokens: i64,
    pub total_tokens: i64,
}

/// Which price table a provider-reported cost used.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ProviderCostBasis {
    /// The provider's built-in list prices.
    List,
    /// Rates managed by the user's organization.
    Managed,
}

/// A cost the provider computed for its own usage: an estimate, not a bill.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderCost {
    pub basis: ProviderCostBasis,
    /// The priced model, or `"mixed"` when the turn used several.
    pub model: String,
    /// This turn's cost in USD.
    pub turn_usd: f64,
    /// The whole thread's cost in USD after this turn; `None` when an
    /// earlier turn's cost is unknown.
    pub thread_usd: Option<f64>,
}

/// The usage a provider recorded for one finished turn.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TurnUsageRecord {
    /// The turn's last model request: the context size the turn ended with.
    pub last: TokenUsage,
    /// This turn's own usage.
    pub turn: TokenUsage,
    /// The thread's cumulative usage after this turn.
    pub total: TokenUsage,
    pub context_window: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cost: Option<ProviderCost>,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum PlanStepStatus {
    Pending,
    InProgress,
    Completed,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct PlanStep {
    pub step: String,
    pub status: PlanStepStatus,
}
