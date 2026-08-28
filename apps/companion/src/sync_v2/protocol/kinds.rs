//! Exact request/result kind pairing shared by runtime validation and the ledger.

use super::{Command, CommandResult, Query, QueryResult};

pub const QUERY_KINDS: &[&str] = &[
    "capabilities.read",
    "models.list",
    "catalog.page",
    "history.page",
    "thread.resources",
    "projects.list",
    "workspace.inspect",
    "queue.list",
    "accounts.list",
];
pub const COMMAND_KINDS: &[&str] = &[
    "thread.create",
    "thread.fork",
    "thread.update",
    "thread.delete",
    "turn.submit",
    "turn.steer",
    "turn.interrupt",
    "thread.compact",
    "thread.rollback",
    "project.add",
    "workspace.create",
    "queue.mutate",
    "account.update",
];
pub const ACTION_KINDS: &[&str] = &["request.resolve"];

impl Query {
    #[must_use]
    pub const fn kind(&self) -> &'static str {
        match self {
            Self::CapabilitiesRead => "capabilities.read",
            Self::ModelsList => "models.list",
            Self::CatalogPage { .. } => "catalog.page",
            Self::HistoryPage { .. } => "history.page",
            Self::ThreadResources { .. } => "thread.resources",
            Self::ProjectsList => "projects.list",
            Self::WorkspaceInspect { .. } => "workspace.inspect",
            Self::QueueList { .. } => "queue.list",
            Self::AccountsList => "accounts.list",
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
            Self::HistoryPage { .. } => "history.page",
            Self::ThreadResources { .. } => "thread.resources",
            Self::ProjectsList { .. } => "projects.list",
            Self::WorkspaceInspect { .. } => "workspace.inspect",
            Self::QueueList { .. } => "queue.list",
            Self::AccountsList { .. } => "accounts.list",
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
        }
    }
}
