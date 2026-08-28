//! Closed Sync V2 request, response, and frame registry.

use serde::{Deserialize, Serialize};

use super::{
    domain::{
        Attachment, CatalogAnchor, CatalogScope, Effort, FileChangeKind, InputBlock,
        ProjectionChange, SequencedChange, SnapshotLimits, ThreadSettings, ThreadSummary,
        ThreadWindow, TurnView,
    },
    scalar::{Id, OperationId, Timestamp, U64},
};

mod error;
mod kinds;
#[cfg(test)]
mod tests;

pub use kinds::{ACTION_KINDS, COMMAND_KINDS, QUERY_KINDS};

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct OpenIntent {
    pub catalog: CatalogIntent,
    pub current_thread: Option<CurrentThreadIntent>,
}

impl OpenIntent {
    /// Validates requested snapshot bounds.
    ///
    /// # Errors
    ///
    /// Returns `invalidRequest` when a window exceeds negotiated limits.
    pub fn validate(&self, limits: SnapshotLimits) -> Result<(), V2Error> {
        if self.catalog.active_limit > limits.catalog_per_partition_max
            || self.catalog.archived_limit > limits.catalog_per_partition_max
            || self.current_thread.as_ref().is_some_and(|current| {
                current.turn_limit == 0 || current.turn_limit > limits.turn_window_max
            })
        {
            return Err(V2Error::invalid_request(
                "open intent exceeds negotiated limits",
            ));
        }
        Ok(())
    }
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CatalogIntent {
    pub active_limit: u16,
    pub archived_limit: u16,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CurrentThreadIntent {
    pub thread_id: Id,
    pub turn_limit: u16,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum ClientFrame {
    Open {
        version: u8,
        intent: OpenIntent,
    },
    SnapshotCommitted {
        epoch_id: Id,
        revision: String,
        watermark: U64,
    },
    Query {
        request_id: Id,
        query: Query,
    },
    Command {
        request_id: Id,
        operation_id: OperationId,
        command: Command,
    },
    Action {
        request_id: Id,
        action: Action,
    },
    Ping {
        nonce: String,
    },
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(tag = "kind", rename_all_fields = "camelCase", deny_unknown_fields)]
pub enum Query {
    #[serde(rename = "capabilities.read")]
    CapabilitiesRead,
    #[serde(rename = "models.list")]
    ModelsList,
    #[serde(rename = "catalog.page")]
    CatalogPage {
        partition: CatalogPartition,
        before: Option<CatalogAnchor>,
        limit: u16,
    },
    #[serde(rename = "history.page", rename_all = "camelCase")]
    HistoryPage {
        thread_id: Id,
        cursor: Option<String>,
        direction: HistoryDirection,
        limit: u16,
        detail: HistoryDetail,
    },
    #[serde(rename = "thread.resources", rename_all = "camelCase")]
    ThreadResources { thread_id: Id, scope: ResourceScope },
    #[serde(rename = "projects.list")]
    ProjectsList,
    #[serde(rename = "workspace.inspect")]
    WorkspaceInspect { path: String },
    #[serde(rename = "queue.list", rename_all = "camelCase")]
    QueueList { thread_id: Option<Id> },
    #[serde(rename = "operation.get", rename_all = "camelCase")]
    OperationGet { operation_id: OperationId },
    #[serde(rename = "accounts.list")]
    AccountsList,
}

impl Query {
    /// Validates query-specific page bounds.
    ///
    /// # Errors
    ///
    /// Returns `invalidRequest` when the query exceeds negotiated limits.
    pub fn validate(&self, limits: SnapshotLimits) -> Result<(), V2Error> {
        match self {
            Self::CatalogPage { limit, .. } | Self::HistoryPage { limit, .. }
                if *limit == 0 || *limit > limits.history_page_max =>
            {
                Err(V2Error::invalid_request(
                    "page limit must be between 1 and 100",
                ))
            }
            _ => Ok(()),
        }
    }
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum CatalogPartition {
    Active,
    Archived,
}
#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum HistoryDirection {
    Older,
    Newer,
}
#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum HistoryDetail {
    Summary,
    Full,
}
#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum ResourceScope {
    Session,
    LastTurn,
    Staged,
    Unstaged,
    Branch,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(tag = "kind", rename_all_fields = "camelCase", deny_unknown_fields)]
pub enum Command {
    #[serde(rename = "thread.create")]
    ThreadCreate {
        workspace: String,
        title: Option<String>,
        settings: ThreadSettings,
    },
    #[serde(rename = "thread.fork", rename_all = "camelCase")]
    ThreadFork {
        thread_id: Id,
        through_turn_id: Option<Id>,
    },
    #[serde(rename = "thread.update", rename_all = "camelCase")]
    ThreadUpdate { thread_id: Id, change: ThreadUpdate },
    #[serde(rename = "thread.delete", rename_all = "camelCase")]
    ThreadDelete { thread_id: Id },
    #[serde(rename = "turn.submit", rename_all = "camelCase")]
    TurnSubmit {
        thread_id: Option<Id>,
        workspace: Option<String>,
        input: Vec<InputBlock>,
        intent: TurnIntent,
        settings: Option<ThreadSettings>,
    },
    #[serde(rename = "turn.steer", rename_all = "camelCase")]
    TurnSteer {
        thread_id: Id,
        turn_id: Id,
        input: Vec<InputBlock>,
    },
    #[serde(rename = "turn.interrupt", rename_all = "camelCase")]
    TurnInterrupt { thread_id: Id, turn_id: Id },
    #[serde(rename = "thread.compact", rename_all = "camelCase")]
    ThreadCompact { thread_id: Id },
    #[serde(rename = "thread.rollback", rename_all = "camelCase")]
    ThreadRollback {
        thread_id: Id,
        through_turn_id: Id,
        drop_following_turns: bool,
    },
    #[serde(rename = "project.add")]
    ProjectAdd {
        path: String,
        name: Option<String>,
        pinned: bool,
    },
    #[serde(rename = "workspace.create", rename_all = "camelCase")]
    WorkspaceCreate {
        provider: Id,
        parent_path: String,
        name: String,
    },
    #[serde(rename = "queue.mutate")]
    QueueMutate { mutation: QueueMutation },
    #[serde(rename = "account.update")]
    AccountUpdate { change: AccountChange },
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum ThreadUpdate {
    Title {
        title: Option<String>,
    },
    Archive {
        archived: bool,
    },
    Goal {
        goal: Option<String>,
    },
    Settings {
        settings: ThreadSettings,
    },
    Section {
        section_id: Option<Id>,
        position: Option<U64>,
    },
}
#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum TurnIntent {
    Chat,
    Review,
}
#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum QueueMutation {
    Put {
        thread_id: Id,
        input: Vec<InputBlock>,
    },
    Edit {
        item_id: Id,
        input: Vec<InputBlock>,
    },
    Cancel {
        item_id: Id,
    },
    Move {
        item_id: Id,
        before_item_id: Option<Id>,
    },
    Retry {
        item_id: Id,
    },
}
#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum AccountChange {
    Activate {
        profile_id: Id,
    },
    Configure {
        profile_id: Id,
        enabled: bool,
        priority: i64,
    },
    Remove {
        profile_id: Id,
    },
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(tag = "kind", rename_all_fields = "camelCase", deny_unknown_fields)]
pub enum Action {
    #[serde(rename = "request.resolve", rename_all = "camelCase")]
    RequestResolve {
        request_id: Id,
        generation: U64,
        resolution: RequestResolution,
    },
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum RequestResolution {
    Approval { decision: ApprovalDecision },
    UserInput { answers: Vec<QuestionAnswer> },
    Elicitation { values: Vec<FieldValue> },
    Cancel,
}
#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum ApprovalDecision {
    AllowOnce,
    AllowSession,
    Deny,
}
#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct QuestionAnswer {
    pub question_id: Id,
    pub value: String,
}
#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FieldValue {
    pub field_id: Id,
    pub value: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(tag = "kind", rename_all_fields = "camelCase", deny_unknown_fields)]
pub enum QueryResult {
    #[serde(rename = "capabilities.read")]
    CapabilitiesRead {
        commands: Vec<String>,
        queries: Vec<String>,
        actions: Vec<String>,
        limits: SnapshotLimits,
    },
    #[serde(rename = "models.list")]
    ModelsList { models: Vec<Model> },
    #[serde(rename = "catalog.page")]
    CatalogPage {
        threads: Vec<ThreadSummary>,
        next: Option<CatalogAnchor>,
    },
    #[serde(rename = "history.page", rename_all = "camelCase")]
    HistoryPage {
        thread_id: Id,
        turns: Vec<TurnView>,
        older_cursor: Option<String>,
        newer_cursor: Option<String>,
    },
    #[serde(rename = "thread.resources", rename_all = "camelCase")]
    ThreadResources {
        thread_id: Id,
        revision: String,
        changes: Vec<ResourceChange>,
        attachments: Vec<Attachment>,
    },
    #[serde(rename = "projects.list")]
    ProjectsList { projects: Vec<Project> },
    #[serde(rename = "workspace.inspect")]
    WorkspaceInspect { support: Option<WorkspaceSupport> },
    #[serde(rename = "queue.list")]
    QueueList { items: Vec<QueueItem> },
    #[serde(rename = "operation.get", rename_all = "camelCase")]
    OperationGet {
        operation_id: OperationId,
        receipt: Box<OperationReceipt>,
    },
    #[serde(rename = "accounts.list", rename_all = "camelCase")]
    AccountsList {
        active_profile_id: Option<Id>,
        profiles: Vec<AccountProfile>,
        all_exhausted: bool,
    },
}

#[allow(clippy::large_enum_variant)]
#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(
    tag = "state",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum OperationReceipt {
    Admitted {
        accepted_at: Timestamp,
    },
    Completed {
        accepted_at: Timestamp,
        result: CommandResult,
    },
    Failed {
        accepted_at: Timestamp,
        error: V2Error,
    },
    Indeterminate {
        accepted_at: Timestamp,
        error: V2Error,
    },
    Expired {
        accepted_at: Timestamp,
        terminal: OperationTerminal,
    },
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum OperationTerminal {
    Completed,
    Failed,
    Indeterminate,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Model {
    pub id: Id,
    pub label: String,
    pub efforts: Vec<Effort>,
    pub default_effort: Option<String>,
}
#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ResourceChange {
    pub path: String,
    pub change: FileChangeKind,
    pub additions: U64,
    pub deletions: U64,
}
#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Project {
    pub path: String,
    pub name: String,
    pub pinned: bool,
    pub added_at: Timestamp,
    pub last_used_at: Option<Timestamp>,
}
#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct WorkspaceSupport {
    pub provider: Id,
    pub repository_root: String,
    pub can_create: bool,
}
#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct QueueItem {
    pub id: Id,
    pub thread_id: Id,
    pub position: U64,
    pub state: QueueState,
    pub summary: String,
    pub last_error: Option<String>,
}
#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum QueueState {
    Queued,
    Running,
    Failed,
    Done,
}
#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AccountProfile {
    pub id: Id,
    pub email: Option<String>,
    pub plan: Option<String>,
    pub enabled: bool,
    pub priority: i64,
    pub exhausted_until: Option<Timestamp>,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(tag = "kind", rename_all_fields = "camelCase", deny_unknown_fields)]
pub enum CommandResult {
    #[serde(rename = "thread.create")]
    ThreadCreate { thread: ThreadSummary },
    #[serde(rename = "thread.fork")]
    ThreadFork { thread: ThreadSummary },
    #[serde(rename = "thread.update")]
    ThreadUpdate { thread: ThreadSummary },
    #[serde(rename = "thread.delete", rename_all = "camelCase")]
    ThreadDelete { thread_id: Id },
    #[serde(rename = "turn.submit", rename_all = "camelCase")]
    TurnSubmit { thread_id: Id, turn_id: Id },
    #[serde(rename = "turn.steer", rename_all = "camelCase")]
    TurnSteer {
        thread_id: Id,
        turn_id: Id,
        item_id: Id,
    },
    #[serde(rename = "turn.interrupt", rename_all = "camelCase")]
    TurnInterrupt {
        thread_id: Id,
        turn_id: Id,
        state: InterruptState,
    },
    #[serde(rename = "thread.compact", rename_all = "camelCase")]
    ThreadCompact { thread_id: Id, turn_id: Id },
    #[serde(rename = "thread.rollback", rename_all = "camelCase")]
    ThreadRollback {
        thread: ThreadSummary,
        head_turn_id: Option<Id>,
    },
    #[serde(rename = "project.add")]
    ProjectAdd { project: Project },
    #[serde(rename = "workspace.create", rename_all = "camelCase")]
    WorkspaceCreate {
        path: String,
        repository_root: String,
    },
    #[serde(rename = "queue.mutate")]
    QueueMutate { item: Option<QueueItem> },
    #[serde(rename = "account.update", rename_all = "camelCase")]
    AccountUpdate {
        active_profile_id: Option<Id>,
        affected_profile_id: Id,
    },
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum InterruptState {
    Interrupted,
    AlreadyTerminal,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(tag = "kind", rename_all_fields = "camelCase", deny_unknown_fields)]
pub enum ActionResult {
    #[serde(rename = "request.resolve", rename_all = "camelCase")]
    RequestResolve {
        request_id: Id,
        state: ResolutionState,
    },
}
#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum ResolutionState {
    Resolved,
    AlreadyResolved,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum ErrorCode {
    InvalidRequest,
    InvalidQuery,
    Unauthorized,
    Forbidden,
    NotFound,
    Conflict,
    SourceUnavailable,
    RateLimited,
    InvalidCursor,
    StaleCursor,
    OperationIdConflict,
    OperationExpired,
    OperationIndeterminate,
    RequestExpired,
    GenerationChanged,
    UnsupportedCapability,
}
#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Recovery {
    None,
    Retry,
    Requery,
    Reinitialize,
    UserAction,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct V2Error {
    pub code: ErrorCode,
    pub recovery: Recovery,
    pub message: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct RawV2Error {
    code: ErrorCode,
    recovery: Recovery,
    message: String,
}

impl<'de> Deserialize<'de> for V2Error {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        let raw = RawV2Error::deserialize(deserializer)?;
        let legal = matches!(
            (raw.code, raw.recovery),
            (
                ErrorCode::InvalidRequest
                    | ErrorCode::InvalidQuery
                    | ErrorCode::InvalidCursor
                    | ErrorCode::UnsupportedCapability,
                Recovery::None
            ) | (
                ErrorCode::Unauthorized
                    | ErrorCode::Forbidden
                    | ErrorCode::OperationIdConflict
                    | ErrorCode::OperationExpired,
                Recovery::UserAction
            ) | (
                ErrorCode::NotFound
                    | ErrorCode::Conflict
                    | ErrorCode::StaleCursor
                    | ErrorCode::OperationIndeterminate
                    | ErrorCode::RequestExpired,
                Recovery::Requery
            ) | (
                ErrorCode::SourceUnavailable | ErrorCode::RateLimited,
                Recovery::Retry
            ) | (ErrorCode::GenerationChanged, Recovery::Reinitialize)
        );
        if !legal {
            return Err(serde::de::Error::custom(
                "illegal Sync V2 error code/recovery pair",
            ));
        }
        Ok(Self {
            code: raw.code,
            recovery: raw.recovery,
            message: raw.message,
        })
    }
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum ReinitializeReason {
    QueueOverflow,
    UpstreamUnavailable,
    UpstreamGenerationChanged,
    SnapshotFailed,
    SourceGap,
    InvalidCommit,
}

#[allow(clippy::large_enum_variant)]
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum ServerFrame {
    Snapshot {
        version: u8,
        epoch_id: Id,
        revision: String,
        watermark: U64,
        scope: CatalogScope,
        catalog: CatalogSnapshot,
        current_thread: Option<ThreadWindow>,
        pending_requests: Vec<super::domain::PendingRequest>,
        included_tail: Vec<SequencedChange>,
        limits: SnapshotLimits,
    },
    Change {
        epoch_id: Id,
        watermark: U64,
        change: ProjectionChange,
    },
    Live {
        epoch_id: Id,
        watermark: U64,
    },
    Reinitialize {
        epoch_id: Id,
        reason: ReinitializeReason,
    },
    QueryCompleted {
        request_id: Id,
        result: QueryResult,
    },
    QueryFailed {
        request_id: Id,
        error: V2Error,
    },
    CommandRejected {
        request_id: Id,
        operation_id: OperationId,
        error: V2Error,
    },
    CommandExpired {
        request_id: Id,
        operation_id: OperationId,
        error: V2Error,
    },
    CommandAccepted {
        request_id: Id,
        operation_id: OperationId,
        accepted_at: Timestamp,
    },
    CommandCompleted {
        operation_id: OperationId,
        result: CommandResult,
    },
    CommandFailed {
        operation_id: OperationId,
        error: V2Error,
    },
    CommandIndeterminate {
        operation_id: OperationId,
        error: V2Error,
    },
    ActionCompleted {
        request_id: Id,
        result: ActionResult,
    },
    ActionFailed {
        request_id: Id,
        error: V2Error,
    },
    Pong {
        nonce: String,
    },
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CatalogSnapshot {
    pub active: Vec<ThreadSummary>,
    pub archived: Vec<ThreadSummary>,
}
