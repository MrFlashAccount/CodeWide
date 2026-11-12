//! Claude tool calls that are shell commands, so their items are `command`s.
//!
//! - `Bash` runs its input's `command` in the foreground or as a background
//!   task; `Monitor` runs it as a background task whose output lines wake
//!   the agent. Both are `command` items from their start, and name the
//!   background task they started (`backgroundTaskId`) from the structured
//!   result.
//! - `TaskStop` stops a background task of any kind. Only its result says
//!   whether the task was a shell (`task_type: local_bash`), so the call
//!   starts as a generic tool call and completes as a `command` (same item
//!   id) for a shell task. The `command` does not name the task as its
//!   `backgroundTaskId`: that field means the task the command started, and
//!   the output read takes the newest command naming a task as its launch.
//!
//! `TaskOutput`, `BashOutput` and `KillShell` stay generic tool calls: no
//! recorded result shows their structured shape. Pure.

use agent_core::model::{AgentItem, ExecutionStatus, ItemId, Provenance};
use serde_json::Value;

use super::{
    json::{record, str_of},
    task_notifications::SHELL_TASK_TYPE,
};
use crate::background_tasks::BackgroundTaskId;

/// The tool that stops a background task.
const TASK_STOP_TOOL: &str = "TaskStop";

/// A tool whose call runs the shell command its input's `command` names.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ShellTool {
    /// Runs the command in the foreground, or as a background task.
    Bash,
    /// Runs the command as a background task whose output lines wake the agent.
    Monitor,
}

impl ShellTool {
    #[must_use]
    pub fn of(name: &str) -> Option<Self> {
        match name {
            "Bash" => Some(Self::Bash),
            "Monitor" => Some(Self::Monitor),
            _ => None,
        }
    }

    /// The field of the structured result that names the background task
    /// the call started.
    const fn task_id_field(self) -> &'static str {
        match self {
            Self::Bash => "backgroundTaskId",
            Self::Monitor => "taskId",
        }
    }

    /// The background task the call started: the structured result's task
    /// id, when it has Claude's id shape.
    #[must_use]
    pub fn started_task_id(self, tool_use_result: &Value) -> Option<String> {
        record(tool_use_result)
            .and_then(|structured| str_of(structured, self.task_id_field()))
            .and_then(BackgroundTaskId::parse)
            .map(BackgroundTaskId::into_string)
    }
}

/// A `TaskStop` call that stopped a shell task, from its structured result
/// (`{message, task_id, task_type: "local_bash", command}`).
#[derive(Debug, Eq, PartialEq)]
pub struct StoppedShellTask<'a> {
    /// The command the stopped task ran.
    pub command: &'a str,
    /// Claude's confirmation, the call's output.
    pub message: &'a str,
}

impl<'a> StoppedShellTask<'a> {
    /// The stopped shell task, or `None` for another tool, another kind of
    /// task (a sub-agent) or a result without the structured fields.
    #[must_use]
    pub fn of(tool: &str, tool_use_result: &'a Value) -> Option<Self> {
        if tool != TASK_STOP_TOOL {
            return None;
        }
        let structured = record(tool_use_result)?;
        if str_of(structured, "task_type") != Some(SHELL_TASK_TYPE) {
            return None;
        }
        Some(Self {
            command: str_of(structured, "command").filter(|command| !command.is_empty())?,
            message: str_of(structured, "message").unwrap_or_default(),
        })
    }
}

/// The `command` item of a completed `TaskStop` call that stopped a shell task.
pub struct StoppedShellCommand<'a> {
    pub item_id: ItemId,
    pub provenance: Option<Provenance>,
    pub stopped: StoppedShellTask<'a>,
    pub cwd: &'a str,
    pub status: ExecutionStatus,
    pub duration_ms: i64,
}

impl StoppedShellCommand<'_> {
    /// No exit code: the stopped command's own is unknown.
    #[must_use]
    pub fn into_item(self, output_limit: usize) -> AgentItem {
        AgentItem::Command {
            item_id: self.item_id,
            provenance: self.provenance,
            command: self.stopped.command.to_owned(),
            cwd: self.cwd.to_owned(),
            status: self.status,
            output: Some(super::tools::keep_tail(self.stopped.message, output_limit)),
            exit_code: None,
            duration_ms: Some(self.duration_ms),
            background: None,
        }
    }
}
