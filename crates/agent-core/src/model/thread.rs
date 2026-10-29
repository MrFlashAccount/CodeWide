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
    /// Another process of the provider holds the thread's native session; the
    /// provider cannot run a turn in it until that process lets go.
    OpenElsewhere,
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

/// Who spawned a sub-agent's read-only thread (added within v1).
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ThreadSpawn {
    /// The thread whose agent started this one.
    pub parent_thread_id: AppThreadId,
    /// The name the spawning call gave the agent, when it gave one.
    pub agent_nickname: Option<String>,
    /// The agent's type, when the spawning call named one.
    pub agent_role: Option<String>,
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
    /// Present only on a sub-agent's thread: its parent drives it, so it
    /// takes no direct input. Optional on the wire (added within v1).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub spawn: Option<ThreadSpawn>,
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

/// Lifecycle of a sub-agent (added within v1): `Running` while it works,
/// including a background agent whose spawning call already returned;
/// `Stopped` when it was stopped, killed or its turn ended under it.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum SubagentStatus {
    Running,
    Completed,
    Failed,
    Stopped,
}

/// How a background task's report reached the agent (added within v1):
/// `Wake` started a provider-origin turn and leads its items; `MidTurn` was
/// delivered into a running turn, at its item position.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum TaskNotificationDelivery {
    Wake,
    MidTurn,
}

/// A background task's reported outcome (added within v1). `Interim`: the
/// agent may report again and its result may be partial; `Lost`: the task did
/// not finish before the previous session ended; `Unknown`: no recognised
/// status.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum TaskNotificationStatus {
    Completed,
    Failed,
    Killed,
    Stopped,
    Interim,
    Lost,
    Unknown,
}

/// What reported (wire field `kind`). Only an agent can name its read-only
/// thread; the other kinds always carry `agentThreadId: null` (`()` encodes
/// that null).
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum TaskNotificationSource {
    Agent {
        agent_thread_id: Option<AppThreadId>,
    },
    Command {
        agent_thread_id: (),
    },
    Other {
        agent_thread_id: (),
    },
}

impl TaskNotificationSource {
    /// The reporting agent's thread, when the source is a known agent.
    #[must_use]
    pub const fn agent_thread_id(&self) -> Option<&AppThreadId> {
        match self {
            Self::Agent { agent_thread_id } => agent_thread_id.as_ref(),
            Self::Command { .. } | Self::Other { .. } => None,
        }
    }

    /// The wire `kind`.
    #[must_use]
    pub const fn kind(&self) -> &'static str {
        match self {
            Self::Agent { .. } => "agent",
            Self::Command { .. } => "command",
            Self::Other { .. } => "other",
        }
    }
}

/// What a provider knows of a background command's process (added within
/// v1). An ended state always carries the Unix time in seconds it ended;
/// `Completed` and `Failed` the exit code when the provider reports one.
/// `Stopped`: killed or stopped before it finished, or ended with the
/// process that ran it. `Unknown`: the provider cannot tell (kept for
/// providers without live process evidence; clients render it as ended).
#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(
    tag = "status",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum BackgroundCommandState {
    Running,
    Completed {
        ended_at: i64,
        exit_code: Option<i64>,
    },
    Failed {
        ended_at: i64,
        exit_code: Option<i64>,
    },
    Stopped {
        ended_at: i64,
    },
    Unknown,
}

impl BackgroundCommandState {
    /// Whether the process ended (`Completed`, `Failed` or `Stopped`).
    #[must_use]
    pub const fn has_ended(&self) -> bool {
        matches!(
            self,
            Self::Completed { .. } | Self::Failed { .. } | Self::Stopped { .. }
        )
    }

    /// The state after learning `next`: an ended state is final, so it never
    /// moves back to running or unknown, and a later report never replaces
    /// the first end. Every other state takes `next`.
    #[must_use]
    pub const fn advanced(self, next: Self) -> Self {
        if self.has_ended() { self } else { next }
    }
}

/// The background task a command started: the provider's own task id, when
/// it started (Unix seconds), the title the agent gave it, and what the
/// provider knows of its state.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BackgroundCommand {
    pub task_id: String,
    pub started_at: i64,
    /// The agent's short description of the command, when it gave one.
    pub description: Option<String>,
    #[serde(flatten)]
    pub state: BackgroundCommandState,
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
        /// The background task the command started and its current state
        /// (added within v1); absent for a command that ran in the
        /// foreground. `thread.backgroundTask.read` reads its output.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        background: Option<BackgroundCommand>,
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
    /// A sub-agent the turn started (added within v1). `agent_thread_id` is
    /// the read-only thread of the sub-agent's own transcript, once known.
    Subagent {
        item_id: ItemId,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        provenance: Option<Provenance>,
        agent_thread_id: Option<AppThreadId>,
        agent_type: Option<String>,
        background: bool,
        description: String,
        model: Option<String>,
        prompt: String,
        result: Option<String>,
        status: SubagentStatus,
    },
    /// A background task's report the provider delivered to the agent
    /// (added within v1). Every field is always present; absent facts are null.
    TaskNotification {
        item_id: ItemId,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        provenance: Option<Provenance>,
        delivery: TaskNotificationDelivery,
        #[serde(flatten)]
        source: TaskNotificationSource,
        task_id: String,
        name: String,
        status: TaskNotificationStatus,
        duration_ms: Option<i64>,
        tool_uses: Option<i64>,
        result: Option<String>,
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
            | Self::Subagent { provenance, .. }
            | Self::TaskNotification { provenance, .. }
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
        | Self::Subagent { provenance, .. }
        | Self::TaskNotification { provenance, .. }
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
            | Self::Subagent { item_id, .. }
            | Self::TaskNotification { item_id, .. }
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
    /// The step's present-tense label shown while it runs (Claude's
    /// `TodoWrite` `activeForm`). Absent when the provider has none.
    #[serde(
        default,
        rename = "activeForm",
        skip_serializing_if = "Option::is_none"
    )]
    pub active_form: Option<String>,
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::{
        AgentItem, AppThreadId, BackgroundCommand, BackgroundCommandState, TaskNotificationSource,
    };

    #[test]
    fn an_ended_background_command_never_runs_again_and_keeps_its_first_end() {
        let completed = BackgroundCommandState::Completed {
            ended_at: 10,
            exit_code: Some(0),
        };
        let stopped = BackgroundCommandState::Stopped { ended_at: 11 };
        assert_eq!(
            BackgroundCommandState::Running.advanced(completed),
            completed
        );
        assert_eq!(
            BackgroundCommandState::Unknown.advanced(BackgroundCommandState::Running),
            BackgroundCommandState::Running
        );
        assert_eq!(
            completed.advanced(BackgroundCommandState::Running),
            completed
        );
        assert_eq!(
            completed.advanced(BackgroundCommandState::Unknown),
            completed
        );
        assert_eq!(completed.advanced(stopped), completed);
        assert!(!BackgroundCommandState::Unknown.has_ended());
    }

    #[test]
    fn a_background_command_carries_an_end_only_once_it_ended() -> Result<(), serde_json::Error> {
        let running = BackgroundCommand {
            task_id: "b1".into(),
            started_at: 1_760_000_100,
            description: None,
            state: BackgroundCommandState::Running,
        };
        assert_eq!(
            serde_json::to_value(&running)?,
            json!({"taskId": "b1", "startedAt": 1_760_000_100, "description": null, "status": "running"})
        );
        let failed = BackgroundCommand {
            task_id: "b1".into(),
            started_at: 1_760_000_100,
            description: None,
            state: BackgroundCommandState::Failed {
                ended_at: 7,
                exit_code: None,
            },
        };
        assert_eq!(
            serde_json::to_value(&failed)?,
            json!({"taskId": "b1", "startedAt": 1_760_000_100, "description": null, "status": "failed", "endedAt": 7, "exitCode": null})
        );
        assert!(
            serde_json::from_value::<BackgroundCommand>(
                json!({"taskId": "b1", "startedAt": 1, "description": null, "status": "stopped"})
            )
            .is_err()
        );
        Ok(())
    }

    fn notification(kind: &str, agent_thread_id: &serde_json::Value) -> serde_json::Value {
        json!({
            "type": "taskNotification",
            "itemId": "turn:notification:0",
            "delivery": "wake",
            "kind": kind,
            "taskId": "a05d989c3914f829e",
            "name": "Find the failing test",
            "agentThreadId": agent_thread_id,
            "status": "completed",
            "durationMs": null,
            "toolUses": null,
            "result": null,
        })
    }

    #[test]
    fn only_an_agent_report_names_a_thread() -> Result<(), serde_json::Error> {
        let agent: AgentItem = serde_json::from_value(notification("agent", &json!("t:agent:a1")))?;
        let AgentItem::TaskNotification { source, .. } = &agent else {
            panic!("expected a task notification, got {agent:?}");
        };
        assert_eq!(source.kind(), "agent");
        assert_eq!(
            source.agent_thread_id().map(AppThreadId::as_str),
            Some("t:agent:a1")
        );
        assert_eq!(
            serde_json::to_value(&agent)?,
            notification("agent", &json!("t:agent:a1"))
        );

        let command: AgentItem = serde_json::from_value(notification("command", &json!(null)))?;
        assert!(matches!(
            command,
            AgentItem::TaskNotification {
                source: TaskNotificationSource::Command { .. },
                ..
            }
        ));
        assert_eq!(
            serde_json::to_value(&command)?,
            notification("command", &json!(null))
        );

        assert!(
            serde_json::from_value::<AgentItem>(notification("command", &json!("t:agent:a1")))
                .is_err()
        );
        Ok(())
    }
}
