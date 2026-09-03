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

mod goals;

pub use goals::{ThreadGoal, ThreadGoalStatus, ThreadGoalUpdate};

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
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
    Skill { name: String, path: String },
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct UserTextByteRange {
    pub start: i64,
    pub end: i64,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct UserTextElement {
    pub byte_range: UserTextByteRange,
    #[serde(deserialize_with = "required_option")]
    pub placeholder: Option<String>,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum ImageDetail {
    Auto,
    Low,
    High,
    Original,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum UserMessageBlock {
    Text {
        text: String,
        text_elements: Vec<UserTextElement>,
    },
    Image {
        url: String,
        #[serde(deserialize_with = "required_option")]
        detail: Option<ImageDetail>,
    },
    LocalImage {
        path: String,
        #[serde(deserialize_with = "required_option")]
        detail: Option<ImageDetail>,
    },
    Audio {
        url: String,
    },
    LocalAudio {
        path: String,
    },
    Skill {
        name: String,
        path: String,
    },
    Mention {
        name: String,
        path: String,
    },
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
    None,
    Minimal,
    Low,
    Medium,
    High,
    Xhigh,
    Max,
    Ultra,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Personality {
    None,
    Friendly,
    Pragmatic,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", rename_all_fields = "camelCase")]
pub enum ApprovalPolicy {
    Never,
    OnRequest,
    Untrusted,
    Granular(GranularApprovalConfig),
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[expect(
    clippy::struct_excessive_bools,
    reason = "the App Server contract defines five independent approval switches"
)]
pub struct GranularApprovalConfig {
    pub sandbox_approval: bool,
    pub rules: bool,
    pub skill_approval: bool,
    pub request_permissions: bool,
    pub mcp_elicitations: bool,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum Sandbox {
    ReadOnly,
    WorkspaceWrite,
    Unrestricted,
    ExternalSandbox { network_access: NetworkAccess },
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum NetworkAccess {
    Restricted,
    Enabled,
}

#[derive(Deserialize, Serialize)]
#[serde(untagged)]
enum SandboxWire {
    Standard(StandardSandbox),
    External(ExternalSandboxWire),
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
enum StandardSandbox {
    ReadOnly,
    WorkspaceWrite,
    Unrestricted,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ExternalSandboxWire {
    #[serde(rename = "type")]
    kind: ExternalSandboxKind,
    network_access: NetworkAccess,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
enum ExternalSandboxKind {
    ExternalSandbox,
}

impl Serialize for Sandbox {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        let wire = match self {
            Self::ReadOnly => SandboxWire::Standard(StandardSandbox::ReadOnly),
            Self::WorkspaceWrite => SandboxWire::Standard(StandardSandbox::WorkspaceWrite),
            Self::Unrestricted => SandboxWire::Standard(StandardSandbox::Unrestricted),
            Self::ExternalSandbox { network_access } => {
                SandboxWire::External(ExternalSandboxWire {
                    kind: ExternalSandboxKind::ExternalSandbox,
                    network_access: *network_access,
                })
            }
        };
        wire.serialize(serializer)
    }
}

impl<'de> Deserialize<'de> for Sandbox {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        match SandboxWire::deserialize(deserializer)? {
            SandboxWire::Standard(StandardSandbox::ReadOnly) => Ok(Self::ReadOnly),
            SandboxWire::Standard(StandardSandbox::WorkspaceWrite) => Ok(Self::WorkspaceWrite),
            SandboxWire::Standard(StandardSandbox::Unrestricted) => Ok(Self::Unrestricted),
            SandboxWire::External(ExternalSandboxWire {
                kind: ExternalSandboxKind::ExternalSandbox,
                network_access,
            }) => Ok(Self::ExternalSandbox { network_access }),
        }
    }
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
    #[serde(deserialize_with = "required_option")]
    pub personality: Option<Personality>,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum Item {
    UserMessage {
        id: Id,
        #[serde(deserialize_with = "required_option")]
        client_id: Option<String>,
        content: Vec<UserMessageBlock>,
    },
    AssistantText {
        id: Id,
        text: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        phase: Option<MessagePhase>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        memory_citation: Option<MemoryCitation>,
    },
    Reasoning {
        id: Id,
        summary: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        summary_parts: Option<Vec<String>>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        content_parts: Option<Vec<String>>,
    },
    Command {
        id: Id,
        command: String,
        cwd: String,
        status: ExecutionState,
        #[serde(deserialize_with = "required_option")]
        exit_code: Option<i64>,
        output_preview: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        duration_ms: Option<i64>,
    },
    FileChange {
        id: Id,
        path: String,
        change: FileChangeKind,
        status: FileChangeState,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        changes: Option<Vec<FileChangeEntry>>,
    },
    Tool {
        id: Id,
        name: String,
        status: ExecutionState,
        summary: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        server: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        arguments_json: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        result_json: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        app_context: Option<ToolAppContext>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        plugin_id: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        read_only_hint: Option<bool>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        success: Option<bool>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        error: Option<ToolError>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        duration_ms: Option<i64>,
    },
    Plan {
        id: Id,
        steps: Vec<PlanStep>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        text: Option<String>,
    },
    Attachment {
        id: Id,
        attachment: Attachment,
    },
    HookPrompt {
        id: Id,
        fragments: Vec<String>,
    },
    Collaboration {
        id: Id,
        tool: String,
        status: ExecutionState,
        #[serde(deserialize_with = "required_option")]
        sender_thread_id: Option<Id>,
        receiver_thread_ids: Vec<Id>,
        #[serde(deserialize_with = "required_option")]
        prompt: Option<String>,
        #[serde(deserialize_with = "required_option")]
        model: Option<String>,
        #[serde(deserialize_with = "required_option")]
        effort: Option<Effort>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        agents_states_json: Option<String>,
    },
    SubagentActivity {
        id: Id,
        activity_kind: String,
        agent_thread_id: Id,
        agent_path: Vec<String>,
    },
    WebSearch {
        id: Id,
        query: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        action_json: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        results_json: Option<String>,
    },
    ImageView {
        id: Id,
        path: String,
        source_url: String,
    },
    Sleep {
        id: Id,
        duration_ms: i64,
    },
    ImageGeneration {
        id: Id,
        prompt: String,
        status: ExecutionState,
        result: String,
        #[serde(deserialize_with = "required_option")]
        saved_path: Option<String>,
        #[serde(deserialize_with = "required_option")]
        source_url: Option<String>,
    },
    ReviewMode {
        id: Id,
        state: ReviewModeState,
        #[serde(deserialize_with = "required_option")]
        review: Option<String>,
    },
    ContextCompaction {
        id: Id,
    },
    Unsupported {
        id: Id,
        source_kind: String,
        payload_json: String,
        payload_truncated: bool,
    },
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ToolAppContext {
    pub connector_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub link_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub resource_uri: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub app_name: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub action_name: Option<String>,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ToolError {
    pub message: String,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum MessagePhase {
    Commentary,
    Final,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MemoryCitation {
    pub entries: Vec<MemoryCitationEntry>,
    pub thread_ids: Vec<Id>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MemoryCitationEntry {
    pub path: String,
    pub line_start: i64,
    pub line_end: i64,
    pub note: String,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum ReviewModeState {
    Entered,
    Exited,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FileChangeEntry {
    pub path: String,
    pub change: FileChangeKind,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub diff: Option<String>,
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
    pub preview: String,
    pub workspace: String,
    pub archived: bool,
    pub state: ThreadState,
    /// Execution settings are absent from App Server `thread/list` and
    /// `thread/read` records. They are populated only when the source response
    /// carries an authoritative settings payload (for example start/resume/fork).
    #[serde(deserialize_with = "required_option")]
    pub settings: Option<ThreadSettings>,
    pub read_state: ThreadReadState,
    pub created_at: Timestamp,
    pub updated_at: Timestamp,
    #[serde(deserialize_with = "required_option")]
    pub last_activity_at: Option<Timestamp>,
    #[serde(deserialize_with = "required_option")]
    pub head_turn_id: Option<Id>,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum ThreadReadState {
    Read {
        #[serde(deserialize_with = "required_option")]
        latest_activity_marker: Option<String>,
        #[serde(deserialize_with = "required_option")]
        read_through_marker: Option<String>,
        unread_count: i64,
    },
    Unread {
        latest_activity_marker: String,
        #[serde(deserialize_with = "required_option")]
        read_through_marker: Option<String>,
        unread_count: i64,
    },
    Unknown {
        #[serde(deserialize_with = "required_option")]
        latest_activity_marker: Option<String>,
        #[serde(deserialize_with = "required_option")]
        read_through_marker: Option<String>,
        #[serde(deserialize_with = "required_option")]
        unread_count: Option<i64>,
    },
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TurnActivity {
    pub count: i64,
    pub kinds: Vec<String>,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TurnUsage {
    pub input_tokens: i64,
    pub cached_input_tokens: i64,
    pub cache_write_input_tokens: i64,
    pub output_tokens: i64,
    pub reasoning_output_tokens: i64,
    #[serde(deserialize_with = "required_option")]
    pub total_cost_usd: Option<f64>,
    pub latest_request_tokens: i64,
    #[serde(deserialize_with = "required_option")]
    pub model_context_window: Option<i64>,
    pub thread_input_tokens: i64,
    pub thread_cached_input_tokens: i64,
    pub thread_cache_write_input_tokens: i64,
    pub thread_output_tokens: i64,
    pub thread_reasoning_output_tokens: i64,
    pub thread_total_tokens: i64,
    #[serde(deserialize_with = "required_option")]
    pub thread_total_cost_usd: Option<f64>,
    #[serde(deserialize_with = "required_option")]
    pub thread_compaction_count: Option<i64>,
    #[serde(deserialize_with = "required_option")]
    pub model: Option<String>,
    pub status: UsageStatus,
    #[serde(deserialize_with = "required_option")]
    pub cache_hit: Option<bool>,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum UsageStatus {
    Live,
    Final,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TurnView {
    pub id: Id,
    pub thread_id: Id,
    pub state: TurnState,
    #[serde(deserialize_with = "required_option")]
    pub created_at: Option<Timestamp>,
    #[serde(deserialize_with = "required_option")]
    pub completed_at: Option<Timestamp>,
    #[serde(deserialize_with = "required_option")]
    pub duration_ms: Option<i64>,
    #[serde(deserialize_with = "required_option")]
    pub activity: Option<TurnActivity>,
    #[serde(deserialize_with = "required_option")]
    pub usage: Option<TurnUsage>,
    pub items: Vec<Item>,
    pub lifecycle: Vec<ItemLifecycle>,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ItemLifecycle {
    pub item: Item,
    pub phase: LifecyclePhase,
    pub pre_turn: bool,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum LifecyclePhase {
    Started,
    Completed,
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
    CommandApproval {
        id: Id,
        generation: U64,
        thread_id: Id,
        turn_id: Id,
        item_id: Id,
        #[serde(deserialize_with = "required_option")]
        command: Option<String>,
        #[serde(deserialize_with = "required_option")]
        cwd: Option<String>,
        #[serde(deserialize_with = "required_option")]
        reason: Option<String>,
        #[serde(deserialize_with = "required_option")]
        network_approval_context_json: Option<String>,
        available_decisions: Vec<ApprovalDecision>,
    },
    FileChangeApproval {
        id: Id,
        generation: U64,
        thread_id: Id,
        turn_id: Id,
        item_id: Id,
        #[serde(deserialize_with = "required_option")]
        reason: Option<String>,
        #[serde(deserialize_with = "required_option")]
        grant_root: Option<String>,
        available_decisions: Vec<ApprovalDecision>,
    },
    PermissionApproval {
        id: Id,
        generation: U64,
        thread_id: Id,
        turn_id: Id,
        item_id: Id,
        #[serde(deserialize_with = "required_option")]
        reason: Option<String>,
        permissions: PermissionProfile,
    },
    UserInput {
        id: Id,
        generation: U64,
        thread_id: Id,
        turn_id: Id,
        item_id: Id,
        questions: Vec<UserInputQuestion>,
    },
    Elicitation {
        id: Id,
        generation: U64,
        #[serde(deserialize_with = "required_option")]
        thread_id: Option<Id>,
        #[serde(deserialize_with = "required_option")]
        turn_id: Option<Id>,
        server_name: String,
        mode: ElicitationMode,
        message: String,
        #[serde(deserialize_with = "required_option")]
        url: Option<String>,
        #[serde(deserialize_with = "required_option")]
        elicitation_id: Option<Id>,
        fields: Vec<ElicitationField>,
        #[serde(deserialize_with = "required_option")]
        requested_schema_json: Option<String>,
        #[serde(deserialize_with = "required_option")]
        metadata_json: Option<String>,
    },
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum ApprovalDecision {
    Accept,
    AcceptForSession,
    AcceptWithExecpolicyAmendment {
        #[serde(rename = "execpolicy_amendment")]
        execpolicy_amendment: Vec<String>,
    },
    ApplyNetworkPolicyAmendment {
        #[serde(rename = "network_policy_amendment")]
        network_policy_amendment: NetworkPolicyAmendment,
    },
    Decline,
    Cancel,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NetworkPolicyAmendment {
    pub action: NetworkPolicyRuleAction,
    pub host: String,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum NetworkPolicyRuleAction {
    Allow,
    Deny,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PermissionProfile {
    #[serde(deserialize_with = "required_option")]
    pub network: Option<NetworkPermissions>,
    #[serde(deserialize_with = "required_option")]
    pub file_system: Option<FileSystemPermissions>,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NetworkPermissions {
    #[serde(deserialize_with = "required_option")]
    pub enabled: Option<bool>,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FileSystemPermissions {
    #[serde(deserialize_with = "required_option")]
    pub read: Option<Vec<String>>,
    #[serde(deserialize_with = "required_option")]
    pub write: Option<Vec<String>>,
    #[serde(deserialize_with = "required_option")]
    pub glob_scan_max_depth: Option<i64>,
    pub entries: Vec<FileSystemPermissionEntry>,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FileSystemPermissionEntry {
    pub path: FileSystemPath,
    pub access: FileSystemAccessMode,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum FileSystemAccessMode {
    Read,
    Write,
    Deny,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum FileSystemPath {
    Path { path: String },
    GlobPattern { pattern: String },
    Special { value: FileSystemSpecialPath },
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum FileSystemSpecialPath {
    Root,
    Minimal,
    ProjectRoots {
        #[serde(deserialize_with = "required_option")]
        subpath: Option<String>,
    },
    Tmpdir,
    SlashTmp,
    Unknown {
        path: String,
        #[serde(deserialize_with = "required_option")]
        subpath: Option<String>,
    },
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct UserInputQuestion {
    pub id: Id,
    pub header: String,
    pub question: String,
    pub is_other: bool,
    pub is_secret: bool,
    #[serde(deserialize_with = "required_option")]
    pub options: Option<Vec<UserInputOption>>,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct UserInputOption {
    pub label: String,
    pub description: String,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum ElicitationMode {
    Form,
    OpenaiForm,
    Url,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum ElicitationFieldType {
    Text,
    Secret,
    Boolean,
    Number,
    Integer,
    Select,
    Array,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(untagged)]
pub enum ElicitationValue {
    Boolean(bool),
    Number(serde_json::Number),
    String(String),
    StringArray(Vec<String>),
    Null,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum ElicitationDefault {
    Unset,
    Value { value: ElicitationValue },
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ElicitationOption {
    pub value: String,
    pub label: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ElicitationField {
    pub id: Id,
    pub label: String,
    #[serde(deserialize_with = "required_option")]
    pub description: Option<String>,
    #[serde(rename = "type")]
    pub field_type: ElicitationFieldType,
    pub required: bool,
    pub default_value: ElicitationDefault,
    #[serde(deserialize_with = "required_option")]
    pub options: Option<Vec<ElicitationOption>>,
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
    CurrentThreadReplaced {
        current_thread: ThreadWindow,
        pending_requests: Vec<PendingRequest>,
    },
    TurnUpserted {
        turn: TurnView,
    },
    ItemLifecycleChanged {
        thread_id: Id,
        turn_id: Id,
        lifecycle: ItemLifecycle,
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
    AgentsChanged {
        #[serde(deserialize_with = "required_option")]
        thread_id: Option<Id>,
        revision: String,
    },
    QueueChanged {
        #[serde(deserialize_with = "required_option")]
        thread_id: Option<Id>,
        revision: String,
    },
    ThreadGoalChanged {
        thread_id: Id,
        revision: String,
    },
    SkillsChanged {
        #[serde(deserialize_with = "required_option")]
        workspace: Option<String>,
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
