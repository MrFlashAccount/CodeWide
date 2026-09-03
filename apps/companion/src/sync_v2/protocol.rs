//! Closed Sync V2 request, response, and frame registry.

use serde::{Deserialize, Serialize};

fn required_option<'de, D, T>(deserializer: D) -> Result<Option<T>, D::Error>
where
    D: serde::Deserializer<'de>,
    T: Deserialize<'de>,
{
    Option::<T>::deserialize(deserializer)
}

use super::{
    domain::{
        Attachment, CatalogAnchor, CatalogScope, Effort, FileChangeKind, InputBlock, Item,
        ProjectionChange, SequencedChange, SnapshotLimits, ThreadGoal, ThreadReadState,
        ThreadSummary, ThreadWindow, TurnView,
    },
    scalar::{Id, OperationId, Timestamp, U64},
};

mod commands;
mod error;
mod kinds;
#[cfg(test)]
mod tests;
mod transport;

pub use commands::*;
pub use kinds::{COMMAND_KINDS, QUERY_KINDS};
pub(crate) use kinds::{
    command_required_scope, command_scope_for_kind, query_required_scope, query_scope_for_kind,
};
pub use transport::*;

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct OpenIntent {
    pub catalog: CatalogIntent,
    #[serde(deserialize_with = "required_option")]
    pub current_thread: Option<CurrentThreadIntent>,
    pub pending_requests: PendingRequestScope,
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

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum PendingRequestScope {
    CurrentThread,
    AllAccessible,
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
    ThreadWatch {
        request_id: Id,
        thread_id: Id,
        turn_limit: u16,
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
    #[serde(rename = "skills.list", rename_all = "camelCase")]
    SkillsList {
        workspace: String,
        force_reload: bool,
    },
    #[serde(rename = "thread.goal", rename_all = "camelCase")]
    ThreadGoal { thread_id: Id },
    #[serde(rename = "thread.agents", rename_all = "camelCase")]
    ThreadAgents {
        thread_id: Id,
        #[serde(deserialize_with = "required_option")]
        cursor: Option<String>,
        limit: u16,
    },
    #[serde(rename = "catalog.page")]
    CatalogPage {
        partition: CatalogPartition,
        #[serde(deserialize_with = "required_option")]
        before: Option<CatalogAnchor>,
        limit: u16,
    },
    #[serde(rename = "catalog.search", rename_all = "camelCase")]
    CatalogSearch {
        partition: CatalogPartition,
        text: String,
        #[serde(deserialize_with = "required_option")]
        cursor: Option<String>,
        limit: u16,
    },
    #[serde(rename = "history.page", rename_all = "camelCase")]
    HistoryPage {
        thread_id: Id,
        #[serde(deserialize_with = "required_option")]
        cursor: Option<String>,
        direction: HistoryDirection,
        limit: u16,
        detail: HistoryDetail,
    },
    #[serde(rename = "turn.items", rename_all = "camelCase")]
    TurnItems {
        thread_id: Id,
        turn_id: Id,
        #[serde(deserialize_with = "required_option")]
        cursor: Option<String>,
        limit: u16,
    },
    #[serde(rename = "item.output", rename_all = "camelCase")]
    ItemOutput {
        thread_id: Id,
        turn_id: Id,
        item_id: Id,
        #[serde(deserialize_with = "required_option")]
        cursor: Option<String>,
        limit_bytes: u32,
    },
    #[serde(rename = "thread.resources", rename_all = "camelCase")]
    ThreadResources {
        thread_id: Id,
        scope: ResourceScope,
        #[serde(deserialize_with = "required_option")]
        cursor: Option<String>,
        limit: u16,
    },
    #[serde(rename = "workspace.file", rename_all = "camelCase")]
    WorkspaceFile { thread_id: Id, path: String },
    #[serde(rename = "thread.change", rename_all = "camelCase")]
    ThreadChange {
        thread_id: Id,
        path: String,
        scope: ResourceScope,
    },
    #[serde(rename = "thread.changeOutput", rename_all = "camelCase")]
    ThreadChangeOutput {
        thread_id: Id,
        path: String,
        scope: ResourceScope,
        #[serde(deserialize_with = "required_option")]
        cursor: Option<String>,
        limit_bytes: u32,
    },
    #[serde(rename = "projects.list")]
    ProjectsList,
    #[serde(rename = "workspace.inspect")]
    WorkspaceInspect { path: String },
    #[serde(rename = "queue.list", rename_all = "camelCase")]
    QueueList {
        #[serde(deserialize_with = "required_option")]
        thread_id: Option<Id>,
        #[serde(deserialize_with = "required_option")]
        cursor: Option<String>,
        limit: u16,
    },
    #[serde(rename = "operation.get", rename_all = "camelCase")]
    OperationGet { operation_id: OperationId },
    #[serde(rename = "accounts.list")]
    AccountsList,
    #[serde(rename = "thread.processes", rename_all = "camelCase")]
    ThreadProcesses {
        thread_id: Id,
        #[serde(deserialize_with = "required_option")]
        cursor: Option<String>,
        limit: u16,
    },
}

impl Query {
    /// Validates query-specific page bounds.
    ///
    /// # Errors
    ///
    /// Returns `invalidRequest` when the query exceeds negotiated limits.
    pub fn validate(&self, limits: SnapshotLimits) -> Result<(), V2Error> {
        match self {
            Self::CatalogPage { limit, .. }
            | Self::CatalogSearch { limit, .. }
            | Self::ThreadAgents { limit, .. }
            | Self::HistoryPage { limit, .. }
            | Self::TurnItems { limit, .. }
            | Self::ThreadResources { limit, .. }
            | Self::QueueList { limit, .. }
            | Self::ThreadProcesses { limit, .. }
                if *limit == 0 || *limit > limits.history_page_max =>
            {
                Err(V2Error::invalid_request(
                    "page limit must be between 1 and 100",
                ))
            }
            _ => Ok(()),
        }
        .and_then(|()| match self {
            Self::CatalogSearch { text, .. }
                if text.trim().is_empty()
                    || text.chars().count() > 256
                    || text.len() > 1_024 =>
            {
                Err(V2Error::invalid_request(
                    "catalog search text must contain between 1 and 256 code points and at most 1024 bytes",
                ))
            }
            _ => Ok(()),
        })
        .and_then(|()| match self {
            Self::ItemOutput { limit_bytes, .. } | Self::ThreadChangeOutput { limit_bytes, .. }
                if *limit_bytes < 4 || *limit_bytes > 65_536 =>
            {
                Err(V2Error::invalid_request(
                    "output byte limit must be between 4 and 65536",
                ))
            }
            _ => Ok(()),
        })
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

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum ItemOutputFormat {
    Terminal,
    Json,
    Text,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(tag = "kind", rename_all_fields = "camelCase", deny_unknown_fields)]
pub enum QueryResult {
    #[serde(rename = "capabilities.read")]
    CapabilitiesRead {
        commands: Vec<String>,
        queries: Vec<String>,
        limits: SnapshotLimits,
    },
    #[serde(rename = "models.list")]
    ModelsList { models: Vec<Model> },
    #[serde(rename = "skills.list")]
    SkillsList {
        workspace: String,
        skills: Vec<Skill>,
    },
    #[serde(rename = "thread.goal", rename_all = "camelCase")]
    ThreadGoal {
        thread_id: Id,
        #[serde(deserialize_with = "required_option")]
        goal: Option<ThreadGoal>,
    },
    #[serde(rename = "thread.agents", rename_all = "camelCase")]
    ThreadAgents {
        thread_id: Id,
        agents: Vec<ThreadSummary>,
        #[serde(deserialize_with = "required_option")]
        next: Option<String>,
    },
    #[serde(rename = "catalog.page")]
    CatalogPage {
        threads: Vec<ThreadSummary>,
        #[serde(deserialize_with = "required_option")]
        next: Option<CatalogAnchor>,
    },
    #[serde(rename = "catalog.search", rename_all = "camelCase")]
    CatalogSearch {
        threads: Vec<ThreadSummary>,
        #[serde(deserialize_with = "required_option")]
        next_cursor: Option<String>,
    },
    #[serde(rename = "history.page", rename_all = "camelCase")]
    HistoryPage {
        thread_id: Id,
        turns: Vec<TurnView>,
        #[serde(deserialize_with = "required_option")]
        older_cursor: Option<String>,
        #[serde(deserialize_with = "required_option")]
        newer_cursor: Option<String>,
    },
    #[serde(rename = "turn.items", rename_all = "camelCase")]
    TurnItems {
        thread_id: Id,
        turn_id: Id,
        items: Vec<Item>,
        #[serde(deserialize_with = "required_option")]
        next: Option<String>,
    },
    #[serde(rename = "item.output", rename_all = "camelCase")]
    ItemOutput {
        thread_id: Id,
        turn_id: Id,
        item_id: Id,
        format: ItemOutputFormat,
        content: String,
        total_bytes: U64,
        #[serde(deserialize_with = "required_option")]
        next: Option<String>,
    },
    #[serde(rename = "thread.resources", rename_all = "camelCase")]
    ThreadResources {
        thread_id: Id,
        revision: String,
        scope: ResourceScope,
        available_scopes: Vec<ResourceScope>,
        review: ReviewCapabilities,
        changes: Vec<ResourceChange>,
        attachments: Vec<Attachment>,
        #[serde(deserialize_with = "required_option")]
        next: Option<String>,
    },
    #[serde(rename = "workspace.file", rename_all = "camelCase")]
    WorkspaceFile {
        thread_id: Id,
        path: String,
        file: Attachment,
    },
    #[serde(rename = "thread.change", rename_all = "camelCase")]
    ThreadChange {
        thread_id: Id,
        path: String,
        scope: ResourceScope,
        patches: Vec<ThreadChangePatch>,
        #[serde(deserialize_with = "required_option")]
        source: Option<String>,
        truncated: bool,
    },
    #[serde(rename = "thread.changeOutput", rename_all = "camelCase")]
    ThreadChangeOutput {
        thread_id: Id,
        path: String,
        scope: ResourceScope,
        content: String,
        total_bytes: U64,
        #[serde(deserialize_with = "required_option")]
        next: Option<String>,
    },
    #[serde(rename = "projects.list")]
    ProjectsList { projects: Vec<Project> },
    #[serde(rename = "workspace.inspect")]
    WorkspaceInspect {
        #[serde(deserialize_with = "required_option")]
        support: Option<WorkspaceSupport>,
    },
    #[serde(rename = "queue.list", rename_all = "camelCase")]
    QueueList {
        items: Vec<QueueItem>,
        revision: String,
        #[serde(deserialize_with = "required_option")]
        next_cursor: Option<String>,
    },
    #[serde(rename = "operation.get", rename_all = "camelCase")]
    OperationGet {
        operation_id: OperationId,
        receipt: Box<OperationReceipt>,
    },
    #[serde(rename = "accounts.list", rename_all = "camelCase")]
    AccountsList {
        #[serde(deserialize_with = "required_option")]
        active_profile_id: Option<Id>,
        profiles: Vec<AccountProfile>,
        all_exhausted: bool,
    },
    #[serde(rename = "thread.processes", rename_all = "camelCase")]
    ThreadProcesses {
        thread_id: Id,
        processes: Vec<BackgroundProcess>,
        #[serde(deserialize_with = "required_option")]
        next_cursor: Option<String>,
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
    #[serde(deserialize_with = "required_option")]
    pub default_effort: Option<String>,
    pub supports_personality: bool,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Skill {
    pub name: String,
    pub description: String,
    pub path: String,
    pub enabled: bool,
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
pub struct ReviewCapabilities {
    pub target_kinds: Vec<ReviewTargetKind>,
    pub deliveries: Vec<ReviewDelivery>,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum ReviewTargetKind {
    UncommittedChanges,
    BaseBranch,
    Commit,
    Custom,
}
#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ThreadChangePatch {
    pub turn_id: String,
    pub item_id: String,
    pub kind: FileChangeKind,
    pub diff: String,
}
#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Project {
    pub path: String,
    pub name: String,
    pub pinned: bool,
    pub added_at: Timestamp,
    #[serde(deserialize_with = "required_option")]
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
    pub input: Vec<InputBlock>,
    pub attachments: Vec<QueueAttachment>,
    pub summary: String,
    #[serde(deserialize_with = "required_option")]
    pub last_error: Option<String>,
}
#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct QueueAttachment {
    pub id: Id,
    pub name: String,
}
#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum QueueState {
    Queued,
    Running,
    Uncertain,
    Failed,
    Done,
}
#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AccountProfile {
    pub id: Id,
    #[serde(deserialize_with = "required_option")]
    pub email: Option<String>,
    #[serde(deserialize_with = "required_option")]
    pub plan: Option<String>,
    pub enabled: bool,
    pub priority: i64,
    #[serde(deserialize_with = "required_option")]
    pub exhausted_until: Option<Timestamp>,
    pub exhausted_indefinitely: bool,
    #[serde(deserialize_with = "required_option")]
    pub weekly_limit: Option<WeeklyRateLimit>,
    #[serde(deserialize_with = "required_option")]
    pub rate_limits_updated_at: Option<Timestamp>,
    pub rate_limits_failed: bool,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct WeeklyRateLimit {
    pub remaining_percent: f64,
    #[serde(deserialize_with = "required_option")]
    pub resets_at: Option<Timestamp>,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct BackgroundProcess {
    pub item_id: Id,
    pub process_id: Id,
    pub command: String,
    pub cwd: String,
    #[serde(deserialize_with = "required_option")]
    pub os_pid: Option<U64>,
    #[serde(deserialize_with = "required_option")]
    pub cpu_percent: Option<f64>,
    #[serde(deserialize_with = "required_option")]
    pub rss_ki_b: Option<U64>,
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
    #[serde(rename = "thread.markRead", rename_all = "camelCase")]
    ThreadMarkRead {
        thread_id: Id,
        read_state: ThreadReadState,
    },
    #[serde(rename = "turn.submit", rename_all = "camelCase")]
    TurnSubmit { thread_id: Id, turn_id: Id },
    #[serde(rename = "turn.steer", rename_all = "camelCase")]
    TurnSteer {
        thread_id: Id,
        turn_id: Id,
        item_id: Id,
    },
    #[serde(rename = "review.start", rename_all = "camelCase")]
    ReviewStart {
        thread_id: Id,
        review_thread_id: Id,
        turn_id: Id,
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
        #[serde(deserialize_with = "required_option")]
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
    QueueMutate { outcome: QueueMutationOutcome },
    #[serde(rename = "account.update", rename_all = "camelCase")]
    AccountUpdate {
        #[serde(deserialize_with = "required_option")]
        active_profile_id: Option<Id>,
        affected_profile_id: Id,
    },
    #[serde(rename = "account.login.start", rename_all = "camelCase")]
    AccountLoginStart {
        login_id: Id,
        verification_url: String,
        user_code: String,
    },
    #[serde(rename = "account.login.cancel", rename_all = "camelCase")]
    AccountLoginCancel {
        login_id: Id,
        state: AccountLoginCancelState,
    },
    #[serde(rename = "process.terminate", rename_all = "camelCase")]
    ProcessTerminate {
        process_id: Id,
        state: ProcessTerminationState,
    },
    #[serde(rename = "request.resolve", rename_all = "camelCase")]
    RequestResolve {
        request_id: Id,
        state: ResolutionState,
    },
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum ProcessTerminationState {
    Terminated,
    NotFound,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum QueueMutationOutcome {
    Item {
        item: QueueItem,
    },
    Cancelled {
        item_id: Id,
    },
    Steered {
        item_id: Id,
        thread_id: Id,
        turn_id: Id,
    },
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum AccountLoginCancelState {
    Cancelled,
    NotFound,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum InterruptState {
    Interrupted,
    AlreadyTerminal,
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
#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum ServerFrame {
    Snapshot {
        version: u8,
        source_generation: U64,
        epoch_id: Id,
        revision: String,
        watermark: U64,
        scope: CatalogScope,
        catalog: CatalogSnapshot,
        #[serde(deserialize_with = "required_option")]
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
    ThreadWatched {
        request_id: Id,
        epoch_id: Id,
    },
    ThreadWatchFailed {
        request_id: Id,
        error: V2Error,
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
