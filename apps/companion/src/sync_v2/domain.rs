//! Sync V2 semantic records. No source-protocol DTO is permitted here.

use serde::{Deserialize, Serialize};

fn required_option<'de, D, T>(deserializer: D) -> Result<Option<T>, D::Error>
where
    D: serde::Deserializer<'de>,
    T: Deserialize<'de>,
{
    Option::<T>::deserialize(deserializer)
}

use super::scalar::{Id, Timestamp, U64};

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Attachment {
    pub id: Id,
    pub name: String,
    pub media_type: String,
    pub size_bytes: U64,
    #[serde(deserialize_with = "required_option")]
    pub download_url: Option<String>,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum InputBlock {
    Text { text: String },
    Attachment { attachment_id: Id },
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum ThreadState {
    Idle,
    Running,
    WaitingForApproval,
    WaitingForInput,
    Completed,
    Failed,
    Interrupted,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum TurnState {
    Queued,
    Running,
    Completed,
    Failed,
    Interrupted,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Effort {
    Low,
    Medium,
    High,
    Xhigh,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum ApprovalPolicy {
    Never,
    OnRequest,
    Untrusted,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Sandbox {
    ReadOnly,
    WorkspaceWrite,
    Unrestricted,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ThreadSettings {
    #[serde(deserialize_with = "required_option")]
    pub model: Option<String>,
    #[serde(deserialize_with = "required_option")]
    pub effort: Option<Effort>,
    pub approval_policy: ApprovalPolicy,
    pub sandbox: Sandbox,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum Item {
    UserText {
        id: Id,
        text: String,
    },
    AssistantText {
        id: Id,
        text: String,
    },
    Reasoning {
        id: Id,
        summary: String,
    },
    Command {
        id: Id,
        command: String,
        cwd: String,
        status: ExecutionState,
        #[serde(deserialize_with = "required_option")]
        exit_code: Option<i64>,
        output_preview: String,
    },
    FileChange {
        id: Id,
        path: String,
        change: FileChangeKind,
        status: FileChangeState,
    },
    Tool {
        id: Id,
        name: String,
        status: ExecutionState,
        summary: String,
    },
    Plan {
        id: Id,
        steps: Vec<PlanStep>,
    },
    Attachment {
        id: Id,
        attachment: Attachment,
    },
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum ExecutionState {
    Running,
    Completed,
    Failed,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum FileChangeKind {
    Add,
    Update,
    Delete,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum FileChangeState {
    Pending,
    Applied,
    Rejected,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum PlanStepState {
    Pending,
    Running,
    Completed,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PlanStep {
    pub text: String,
    pub status: PlanStepState,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ThreadSummary {
    pub id: Id,
    #[serde(deserialize_with = "required_option")]
    pub parent_id: Option<Id>,
    #[serde(deserialize_with = "required_option")]
    pub title: Option<String>,
    pub workspace: String,
    pub archived: bool,
    pub state: ThreadState,
    /// Execution settings are absent from App Server `thread/list` and
    /// `thread/read` records. They are populated only when the source response
    /// carries an authoritative settings payload (for example start/resume/fork).
    #[serde(deserialize_with = "required_option")]
    pub settings: Option<ThreadSettings>,
    pub created_at: Timestamp,
    pub updated_at: Timestamp,
    #[serde(deserialize_with = "required_option")]
    pub last_activity_at: Option<Timestamp>,
    #[serde(deserialize_with = "required_option")]
    pub head_turn_id: Option<Id>,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TurnView {
    pub id: Id,
    pub thread_id: Id,
    pub state: TurnState,
    pub created_at: Timestamp,
    #[serde(deserialize_with = "required_option")]
    pub completed_at: Option<Timestamp>,
    pub items: Vec<Item>,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ThreadWindow {
    pub thread: ThreadSummary,
    pub turns: Vec<TurnView>,
    #[serde(deserialize_with = "required_option")]
    pub older_cursor: Option<String>,
    #[serde(deserialize_with = "required_option")]
    pub newer_cursor: Option<String>,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum PendingRequest {
    Approval {
        id: Id,
        generation: U64,
        thread_id: Id,
        turn_id: Id,
        action: ApprovalAction,
        summary: String,
    },
    UserInput {
        id: Id,
        generation: U64,
        thread_id: Id,
        turn_id: Id,
        questions: Vec<UserInputQuestion>,
    },
    Elicitation {
        id: Id,
        generation: U64,
        #[serde(deserialize_with = "required_option")]
        thread_id: Option<Id>,
        #[serde(deserialize_with = "required_option")]
        turn_id: Option<Id>,
        title: String,
        fields: Vec<ElicitationField>,
    },
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum ApprovalAction {
    RunCommand,
    ApplyFileChange,
    GrantPermission,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct UserInputQuestion {
    pub id: Id,
    pub prompt: String,
    pub choices: Vec<String>,
    pub allow_free_text: bool,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum ElicitationFieldType {
    Text,
    Secret,
    Boolean,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ElicitationField {
    pub id: Id,
    pub label: String,
    #[serde(rename = "type")]
    pub field_type: ElicitationFieldType,
    pub required: bool,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CatalogAnchor {
    #[serde(deserialize_with = "required_option")]
    pub last_activity_at: Option<Timestamp>,
    pub updated_at: Timestamp,
    pub thread_id: Id,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CatalogPartitionScope {
    pub limit: u16,
    pub returned: u16,
    pub complete: bool,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CatalogScope {
    pub active: CatalogPartitionScope,
    pub archived: CatalogPartitionScope,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SnapshotLimits {
    pub catalog_per_partition_max: u16,
    pub turn_window_max: u16,
    pub history_page_max: u16,
    pub queue_max_events: u32,
    pub queue_max_bytes: u32,
}

impl Default for SnapshotLimits {
    fn default() -> Self {
        Self {
            catalog_per_partition_max: 100,
            turn_window_max: 36,
            history_page_max: 100,
            queue_max_events: 2_048,
            queue_max_bytes: 4 * 1024 * 1024,
        }
    }
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum ProjectionChange {
    ThreadUpserted {
        thread: ThreadSummary,
    },
    ThreadRemoved {
        thread_id: Id,
        reason: RemovalReason,
    },
    TurnUpserted {
        turn: TurnView,
    },
    PendingRequestOpened {
        request: PendingRequest,
    },
    PendingRequestClosed {
        request_id: Id,
        generation: U64,
        reason: PendingCloseReason,
    },
    ResourcesChanged {
        thread_id: Id,
        revision: String,
    },
    QueueChanged {
        #[serde(deserialize_with = "required_option")]
        thread_id: Option<Id>,
        revision: String,
    },
    AccountsChanged {
        revision: String,
    },
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum RemovalReason {
    Deleted,
    OutsideScope,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum PendingCloseReason {
    Resolved,
    Cancelled,
    SourceLost,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SequencedChange {
    pub watermark: U64,
    pub change: ProjectionChange,
}
