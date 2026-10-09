//! Neutral thread, turn, item and runtime-request types (mirror of
//! `packages/agent-protocol/src/v1/model.ts`). Every field is always present
//! on the wire; absent values are `null`.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};
use serde_json::Value;

use super::ids::{AppThreadId, ClientMessageId, ItemId, ProviderId, TurnId};

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
        client_message_id: Option<ClientMessageId>,
        content: Vec<UserContent>,
    },
    AgentMessage {
        item_id: ItemId,
        text: String,
        phase: MessagePhase,
    },
    Reasoning {
        item_id: ItemId,
        summary: Vec<String>,
        content: Vec<String>,
    },
    Command {
        item_id: ItemId,
        command: String,
        cwd: String,
        status: ExecutionStatus,
        output: Option<String>,
        exit_code: Option<i64>,
        duration_ms: Option<i64>,
    },
    FileChange {
        item_id: ItemId,
        changes: Vec<FileChange>,
        status: ExecutionStatus,
    },
    McpToolCall {
        item_id: ItemId,
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
        namespace: Option<String>,
        tool: String,
        arguments: Value,
        output: Option<String>,
        status: CallStatus,
        duration_ms: Option<i64>,
    },
    WebSearch {
        item_id: ItemId,
        query: String,
        action: Option<WebSearchAction>,
    },
    ImageView {
        item_id: ItemId,
        path: String,
    },
    Plan {
        item_id: ItemId,
        text: String,
    },
    Compaction {
        item_id: ItemId,
    },
    CapabilityItem {
        item_id: ItemId,
        capability: String,
        kind: String,
        payload: Value,
    },
}

impl AgentItem {
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
            | Self::Compaction { item_id }
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

#[derive(Clone, Copy, Debug, Default, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TokenUsage {
    pub input_tokens: i64,
    pub cached_input_tokens: i64,
    pub output_tokens: i64,
    pub reasoning_output_tokens: i64,
    pub total_tokens: i64,
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
