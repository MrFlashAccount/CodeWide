//! Exhaustive tag extractors for top-level Sync V2 frame variants.

use crate::sync_v2::protocol::*;

pub(super) fn terminal_client_tag(value: &TerminalClientRecord) -> &'static str {
    match value {
        TerminalClientRecord::Open { .. } => "open",
        TerminalClientRecord::Input { .. } => "input",
        TerminalClientRecord::Resize { .. } => "resize",
        TerminalClientRecord::Close => "close",
    }
}

pub(super) fn terminal_server_tag(value: &TerminalServerRecord) -> &'static str {
    match value {
        TerminalServerRecord::Opened { .. } => "opened",
        TerminalServerRecord::Output { .. } => "output",
        TerminalServerRecord::Exited { .. } => "exited",
        TerminalServerRecord::Error { .. } => "error",
    }
}

pub(super) fn voice_client_tag(value: &VoiceClientRecord) -> &'static str {
    match value {
        VoiceClientRecord::Start { .. } => "start",
        VoiceClientRecord::Batch { .. } => "batch",
        VoiceClientRecord::Finish { .. } => "finish",
        VoiceClientRecord::Cancel { .. } => "cancel",
    }
}

pub(super) fn voice_server_tag(value: &VoiceServerRecord) -> &'static str {
    match value {
        VoiceServerRecord::Started { .. } => "started",
        VoiceServerRecord::Ack { .. } => "ack",
        VoiceServerRecord::Result { .. } => "result",
        VoiceServerRecord::Retry { .. } => "retry",
        VoiceServerRecord::Cancelled { .. } => "cancelled",
        VoiceServerRecord::Error { .. } => "error",
    }
}

pub(super) fn client_frame_tag(value: &ClientFrame) -> &'static str {
    match value {
        ClientFrame::Open { .. } => "open",
        ClientFrame::SnapshotCommitted { .. } => "snapshotCommitted",
        ClientFrame::ThreadWatch { .. } => "threadWatch",
        ClientFrame::Query { .. } => "query",
        ClientFrame::Command { .. } => "command",
        ClientFrame::Ping { .. } => "ping",
    }
}

pub(super) fn query_tag(value: &Query) -> &'static str {
    match value {
        Query::CapabilitiesRead => "capabilities.read",
        Query::ModelsList => "models.list",
        Query::SkillsList { .. } => "skills.list",
        Query::ThreadGoal { .. } => "thread.goal",
        Query::ThreadAgents { .. } => "thread.agents",
        Query::CatalogPage { .. } => "catalog.page",
        Query::CatalogSearch { .. } => "catalog.search",
        Query::HistoryPage { .. } => "history.page",
        Query::TurnItems { .. } => "turn.items",
        Query::ItemOutput { .. } => "item.output",
        Query::ThreadResources { .. } => "thread.resources",
        Query::WorkspaceFile { .. } => "workspace.file",
        Query::ThreadChange { .. } => "thread.change",
        Query::ThreadChangeOutput { .. } => "thread.changeOutput",
        Query::ProjectsList => "projects.list",
        Query::WorkspaceInspect { .. } => "workspace.inspect",
        Query::QueueList { .. } => "queue.list",
        Query::OperationGet { .. } => "operation.get",
        Query::AccountsList => "accounts.list",
        Query::ThreadProcesses { .. } => "thread.processes",
    }
}

pub(super) fn command_tag(value: &Command) -> &'static str {
    match value {
        Command::ThreadCreate { .. } => "thread.create",
        Command::ThreadFork { .. } => "thread.fork",
        Command::ThreadUpdate { .. } => "thread.update",
        Command::ThreadDelete { .. } => "thread.delete",
        Command::ThreadMarkRead { .. } => "thread.markRead",
        Command::TurnSubmit { .. } => "turn.submit",
        Command::TurnSteer { .. } => "turn.steer",
        Command::ReviewStart { .. } => "review.start",
        Command::TurnInterrupt { .. } => "turn.interrupt",
        Command::ThreadCompact { .. } => "thread.compact",
        Command::ThreadRollback { .. } => "thread.rollback",
        Command::ProjectAdd { .. } => "project.add",
        Command::WorkspaceCreate { .. } => "workspace.create",
        Command::QueueMutate { .. } => "queue.mutate",
        Command::AccountUpdate { .. } => "account.update",
        Command::AccountLoginStart => "account.login.start",
        Command::AccountLoginCancel { .. } => "account.login.cancel",
        Command::ProcessTerminate { .. } => "process.terminate",
        Command::RequestResolve { .. } => "request.resolve",
    }
}

pub(super) fn server_frame_tag(value: &ServerFrame) -> &'static str {
    match value {
        ServerFrame::Snapshot { .. } => "snapshot",
        ServerFrame::Change { .. } => "change",
        ServerFrame::Live { .. } => "live",
        ServerFrame::Reinitialize { .. } => "reinitialize",
        ServerFrame::ThreadWatched { .. } => "threadWatched",
        ServerFrame::ThreadWatchFailed { .. } => "threadWatchFailed",
        ServerFrame::QueryCompleted { .. } => "queryCompleted",
        ServerFrame::QueryFailed { .. } => "queryFailed",
        ServerFrame::CommandRejected { .. } => "commandRejected",
        ServerFrame::CommandExpired { .. } => "commandExpired",
        ServerFrame::CommandAccepted { .. } => "commandAccepted",
        ServerFrame::CommandCompleted { .. } => "commandCompleted",
        ServerFrame::CommandFailed { .. } => "commandFailed",
        ServerFrame::CommandIndeterminate { .. } => "commandIndeterminate",
        ServerFrame::Pong { .. } => "pong",
    }
}

pub(super) fn query_result_tag(value: &QueryResult) -> &'static str {
    match value {
        QueryResult::CapabilitiesRead { .. } => "capabilities.read",
        QueryResult::ModelsList { .. } => "models.list",
        QueryResult::SkillsList { .. } => "skills.list",
        QueryResult::ThreadGoal { .. } => "thread.goal",
        QueryResult::ThreadAgents { .. } => "thread.agents",
        QueryResult::CatalogPage { .. } => "catalog.page",
        QueryResult::CatalogSearch { .. } => "catalog.search",
        QueryResult::HistoryPage { .. } => "history.page",
        QueryResult::TurnItems { .. } => "turn.items",
        QueryResult::ItemOutput { .. } => "item.output",
        QueryResult::ThreadResources { .. } => "thread.resources",
        QueryResult::WorkspaceFile { .. } => "workspace.file",
        QueryResult::ThreadChange { .. } => "thread.change",
        QueryResult::ThreadChangeOutput { .. } => "thread.changeOutput",
        QueryResult::ProjectsList { .. } => "projects.list",
        QueryResult::WorkspaceInspect { .. } => "workspace.inspect",
        QueryResult::QueueList { .. } => "queue.list",
        QueryResult::OperationGet { .. } => "operation.get",
        QueryResult::AccountsList { .. } => "accounts.list",
        QueryResult::ThreadProcesses { .. } => "thread.processes",
    }
}

pub(super) fn command_result_tag(value: &CommandResult) -> &'static str {
    match value {
        CommandResult::ThreadCreate { .. } => "thread.create",
        CommandResult::ThreadFork { .. } => "thread.fork",
        CommandResult::ThreadUpdate { .. } => "thread.update",
        CommandResult::ThreadDelete { .. } => "thread.delete",
        CommandResult::ThreadMarkRead { .. } => "thread.markRead",
        CommandResult::TurnSubmit { .. } => "turn.submit",
        CommandResult::TurnSteer { .. } => "turn.steer",
        CommandResult::ReviewStart { .. } => "review.start",
        CommandResult::TurnInterrupt { .. } => "turn.interrupt",
        CommandResult::ThreadCompact { .. } => "thread.compact",
        CommandResult::ThreadRollback { .. } => "thread.rollback",
        CommandResult::ProjectAdd { .. } => "project.add",
        CommandResult::WorkspaceCreate { .. } => "workspace.create",
        CommandResult::QueueMutate { .. } => "queue.mutate",
        CommandResult::AccountUpdate { .. } => "account.update",
        CommandResult::AccountLoginStart { .. } => "account.login.start",
        CommandResult::AccountLoginCancel { .. } => "account.login.cancel",
        CommandResult::ProcessTerminate { .. } => "process.terminate",
        CommandResult::RequestResolve { .. } => "request.resolve",
    }
}

pub(super) fn operation_receipt_tag(value: &OperationReceipt) -> &'static str {
    match value {
        OperationReceipt::Admitted { .. } => "admitted",
        OperationReceipt::Completed { .. } => "completed",
        OperationReceipt::Failed { .. } => "failed",
        OperationReceipt::Indeterminate { .. } => "indeterminate",
        OperationReceipt::Expired { .. } => "expired",
    }
}
