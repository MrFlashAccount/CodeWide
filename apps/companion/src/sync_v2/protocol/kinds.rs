//! Exact request/result kind pairing shared by runtime validation and the ledger.

use super::{Command, CommandResult, Query, QueryResult};

pub const QUERY_KINDS: &[&str] = &[
    "capabilities.read",
    "models.list",
    "skills.list",
    "thread.goal",
    "thread.agents",
    "catalog.page",
    "catalog.search",
    "history.page",
    "turn.items",
    "item.output",
    "thread.resources",
    "workspace.file",
    "thread.change",
    "thread.changeOutput",
    "projects.list",
    "workspace.inspect",
    "queue.list",
    "operation.get",
    "accounts.list",
    "thread.processes",
];
pub const COMMAND_KINDS: &[&str] = &[
    "thread.create",
    "thread.fork",
    "thread.update",
    "thread.delete",
    "thread.markRead",
    "turn.submit",
    "turn.steer",
    "review.start",
    "turn.interrupt",
    "thread.compact",
    "thread.rollback",
    "project.add",
    "workspace.create",
    "queue.mutate",
    "account.update",
    "account.login.start",
    "account.login.cancel",
    "process.terminate",
    "request.resolve",
];

impl Query {
    #[must_use]
    pub const fn kind(&self) -> &'static str {
        match self {
            Self::CapabilitiesRead => "capabilities.read",
            Self::ModelsList => "models.list",
            Self::CatalogPage { .. } => "catalog.page",
            Self::CatalogSearch { .. } => "catalog.search",
            Self::HistoryPage { .. } => "history.page",
            Self::TurnItems { .. } => "turn.items",
            Self::ItemOutput { .. } => "item.output",
            Self::ThreadResources { .. } => "thread.resources",
            Self::WorkspaceFile { .. } => "workspace.file",
            Self::ThreadChange { .. } => "thread.change",
            Self::ThreadChangeOutput { .. } => "thread.changeOutput",
            Self::ProjectsList => "projects.list",
            Self::WorkspaceInspect { .. } => "workspace.inspect",
            Self::QueueList { .. } => "queue.list",
            Self::SkillsList { .. } => "skills.list",
            Self::ThreadGoal { .. } => "thread.goal",
            Self::ThreadAgents { .. } => "thread.agents",
            Self::OperationGet { .. } => "operation.get",
            Self::AccountsList => "accounts.list",
            Self::ThreadProcesses { .. } => "thread.processes",
        }
    }
}

impl Command {
    #[must_use]
    pub const fn kind(&self) -> &'static str {
        match self {
            Self::ThreadCreate { .. } => "thread.create",
            Self::ThreadFork { .. } => "thread.fork",
            Self::ThreadUpdate { .. } => "thread.update",
            Self::ThreadDelete { .. } => "thread.delete",
            Self::TurnSubmit { .. } => "turn.submit",
            Self::TurnSteer { .. } => "turn.steer",
            Self::TurnInterrupt { .. } => "turn.interrupt",
            Self::ThreadCompact { .. } => "thread.compact",
            Self::ThreadRollback { .. } => "thread.rollback",
            Self::ProjectAdd { .. } => "project.add",
            Self::WorkspaceCreate { .. } => "workspace.create",
            Self::QueueMutate { .. } => "queue.mutate",
            Self::AccountUpdate { .. } => "account.update",
            Self::AccountLoginStart => "account.login.start",
            Self::AccountLoginCancel { .. } => "account.login.cancel",
            Self::ThreadMarkRead { .. } => "thread.markRead",
            Self::ReviewStart { .. } => "review.start",
            Self::ProcessTerminate { .. } => "process.terminate",
            Self::RequestResolve { .. } => "request.resolve",
        }
    }
}

impl QueryResult {
    #[must_use]
    pub const fn kind(&self) -> &'static str {
        match self {
            Self::CapabilitiesRead { .. } => "capabilities.read",
            Self::ModelsList { .. } => "models.list",
            Self::CatalogPage { .. } => "catalog.page",
            Self::CatalogSearch { .. } => "catalog.search",
            Self::HistoryPage { .. } => "history.page",
            Self::TurnItems { .. } => "turn.items",
            Self::ItemOutput { .. } => "item.output",
            Self::ThreadResources { .. } => "thread.resources",
            Self::WorkspaceFile { .. } => "workspace.file",
            Self::ThreadChange { .. } => "thread.change",
            Self::ThreadChangeOutput { .. } => "thread.changeOutput",
            Self::ProjectsList { .. } => "projects.list",
            Self::WorkspaceInspect { .. } => "workspace.inspect",
            Self::QueueList { .. } => "queue.list",
            Self::SkillsList { .. } => "skills.list",
            Self::ThreadGoal { .. } => "thread.goal",
            Self::ThreadAgents { .. } => "thread.agents",
            Self::OperationGet { .. } => "operation.get",
            Self::AccountsList { .. } => "accounts.list",
            Self::ThreadProcesses { .. } => "thread.processes",
        }
    }
}

impl CommandResult {
    #[must_use]
    pub const fn kind(&self) -> &'static str {
        match self {
            Self::ThreadCreate { .. } => "thread.create",
            Self::ThreadFork { .. } => "thread.fork",
            Self::ThreadUpdate { .. } => "thread.update",
            Self::ThreadDelete { .. } => "thread.delete",
            Self::TurnSubmit { .. } => "turn.submit",
            Self::TurnSteer { .. } => "turn.steer",
            Self::TurnInterrupt { .. } => "turn.interrupt",
            Self::ThreadCompact { .. } => "thread.compact",
            Self::ThreadRollback { .. } => "thread.rollback",
            Self::ProjectAdd { .. } => "project.add",
            Self::WorkspaceCreate { .. } => "workspace.create",
            Self::QueueMutate { .. } => "queue.mutate",
            Self::AccountUpdate { .. } => "account.update",
            Self::AccountLoginStart { .. } => "account.login.start",
            Self::AccountLoginCancel { .. } => "account.login.cancel",
            Self::ThreadMarkRead { .. } => "thread.markRead",
            Self::ReviewStart { .. } => "review.start",
            Self::ProcessTerminate { .. } => "process.terminate",
            Self::RequestResolve { .. } => "request.resolve",
        }
    }
}
