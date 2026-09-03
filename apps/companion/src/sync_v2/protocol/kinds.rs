//! Exact request/result kind pairing shared by runtime validation and the ledger.

use super::{Command, CommandResult, Query, QueryResult, QueueMutation};

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

/// Returns the fixed scope that authorizes a query kind.
///
/// `operation.get` returns `None`: its exact scope comes from the durable
/// operation record because it can recover a command from any scope family.
#[must_use]
pub fn query_scope_for_kind(kind: &str) -> Option<&'static str> {
    match kind {
        "capabilities.read" | "models.list" | "skills.list" | "thread.goal" | "thread.agents"
        | "catalog.page" | "catalog.search" | "history.page" | "turn.items" | "item.output"
        | "thread.processes" => Some("threads.read"),
        "thread.resources"
        | "workspace.file"
        | "thread.change"
        | "thread.changeOutput"
        | "projects.list"
        | "workspace.inspect" => Some("files.download.workspace"),
        "queue.list" => Some("turns.start"),
        "accounts.list" => Some("accounts.read"),
        _ => None,
    }
}

/// Returns the fixed scope used to admit this query payload, when it has one.
#[must_use]
pub fn query_required_scope(query: &Query) -> Option<&'static str> {
    query_scope_for_kind(query.kind())
}

/// Returns the least-privilege scope that authorizes a durable command kind.
#[must_use]
pub fn command_scope_for_kind(kind: &str) -> Option<&'static str> {
    match kind {
        "request.resolve" => Some("approvals.respond"),
        "turn.submit" => Some("turns.start"),
        "turn.steer" => Some("turns.steer"),
        "turn.interrupt" | "process.terminate" => Some("processes.manage"),
        "account.update" | "account.login.start" | "account.login.cancel" => {
            Some("accounts.manage")
        }
        "project.add" | "workspace.create" => Some("files.upload.workspace"),
        "thread.create" | "thread.fork" | "thread.update" | "thread.delete" | "thread.markRead"
        | "review.start" | "thread.compact" | "thread.rollback" => Some("threads.write"),
        _ => None,
    }
}

/// Returns the exact scope used to admit this command payload.
#[must_use]
pub fn command_required_scope(command: &Command) -> &'static str {
    match command {
        Command::RequestResolve { .. } => "approvals.respond",
        Command::TurnSubmit { .. }
        | Command::QueueMutate {
            mutation:
                QueueMutation::Put { .. }
                | QueueMutation::Edit { .. }
                | QueueMutation::Cancel { .. }
                | QueueMutation::Move { .. }
                | QueueMutation::Retry { .. },
        } => "turns.start",
        Command::TurnSteer { .. }
        | Command::QueueMutate {
            mutation: QueueMutation::Steer { .. },
        } => "turns.steer",
        Command::TurnInterrupt { .. } | Command::ProcessTerminate { .. } => "processes.manage",
        Command::AccountUpdate { .. }
        | Command::AccountLoginStart
        | Command::AccountLoginCancel { .. } => "accounts.manage",
        Command::ProjectAdd { .. } | Command::WorkspaceCreate { .. } => "files.upload.workspace",
        Command::ThreadCreate { .. }
        | Command::ThreadFork { .. }
        | Command::ThreadUpdate { .. }
        | Command::ThreadDelete { .. }
        | Command::ThreadMarkRead { .. }
        | Command::ReviewStart { .. }
        | Command::ThreadCompact { .. }
        | Command::ThreadRollback { .. } => "threads.write",
    }
}
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::sync_v2::scalar::Id;

    fn id(value: &str) -> Id {
        match Id::new(value.to_owned()) {
            Ok(id) => id,
            Err(error) => panic!("test id must be valid: {error}"),
        }
    }

    #[test]
    fn every_durable_command_family_has_an_exact_recovery_scope() {
        let expected = [
            ("request.resolve", "approvals.respond"),
            ("turn.submit", "turns.start"),
            ("turn.steer", "turns.steer"),
            ("turn.interrupt", "processes.manage"),
            ("process.terminate", "processes.manage"),
            ("account.update", "accounts.manage"),
            ("account.login.start", "accounts.manage"),
            ("account.login.cancel", "accounts.manage"),
            ("project.add", "files.upload.workspace"),
            ("workspace.create", "files.upload.workspace"),
            ("thread.create", "threads.write"),
            ("thread.fork", "threads.write"),
            ("thread.update", "threads.write"),
            ("thread.delete", "threads.write"),
            ("thread.markRead", "threads.write"),
            ("review.start", "threads.write"),
            ("thread.compact", "threads.write"),
            ("thread.rollback", "threads.write"),
        ];
        for (kind, scope) in expected {
            assert_eq!(command_scope_for_kind(kind), Some(scope));
        }
        assert_eq!(command_scope_for_kind("queue.mutate"), None);
        assert_eq!(COMMAND_KINDS.len(), expected.len() + 1);

        let put = Command::QueueMutate {
            mutation: QueueMutation::Put {
                thread_id: id("thread"),
                input: Vec::new(),
            },
        };
        let steer = Command::QueueMutate {
            mutation: QueueMutation::Steer {
                item_id: id("item"),
                turn_id: id("turn"),
                expected_revision: "revision".into(),
            },
        };
        assert_eq!(command_required_scope(&put), "turns.start");
        assert_eq!(command_required_scope(&steer), "turns.steer");
    }
}
