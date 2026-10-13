//! Sub-agents Claude starts with its `Agent` (formerly `Task`) tool, as
//! neutral `subagent` items, and the child thread id of each sub-agent's
//! transcript.
//!
//! The same rules serve live frames and stored history:
//! - the item starts `Running` from the tool input;
//! - the spawning call's result names the agent (`tool_use_result.agentId`
//!   live, the `agentId: <id>` line of the result text in both); a background
//!   launch keeps it `Running`, a foreground result completes it;
//! - a task notification (`<task-notification>` message in history, a
//!   `task_notification` system frame live) carries the final status.
//!
//! Child thread id: `<app thread id>:agent:<agent id>` (`crate::subagents`).
//! Pure.

use std::collections::HashMap;

use agent_core::model::{AgentItem, AppThreadId, ItemId, SubagentStatus};
use serde_json::Value;

use super::{
    frames::ToolResultBlock,
    json::{JsonRecord, is_true, record, str_of},
};
use crate::subagents::{child_thread_id, parse_child_thread_id};

const AGENT_ID_LINE: &str = "agentId: ";
const ASYNC_LAUNCH: &str = "Async agent launched";

/// Tool names that start a sub-agent (`Task` is the former name of `Agent`).
#[must_use]
pub fn is_subagent_tool(name: &str) -> bool {
    matches!(name, "Agent" | "Task")
}

/// The fields of a `subagent` item, so the mapping can rebuild one with a change.
#[derive(Clone, Debug, PartialEq)]
pub struct SubagentItem {
    pub item_id: ItemId,
    pub agent_thread_id: Option<AppThreadId>,
    pub agent_type: Option<String>,
    pub background: bool,
    pub description: String,
    pub model: Option<String>,
    pub prompt: String,
    pub result: Option<String>,
    pub status: SubagentStatus,
}

impl SubagentItem {
    /// The item as the neutral model carries it.
    #[must_use]
    pub fn into_item(self) -> AgentItem {
        AgentItem::Subagent {
            item_id: self.item_id,
            provenance: None,
            agent_thread_id: self.agent_thread_id,
            agent_type: self.agent_type,
            background: self.background,
            description: self.description,
            model: self.model,
            prompt: self.prompt,
            result: self.result,
            status: self.status,
        }
    }

    /// The fields of a neutral `subagent` item; `None` for any other item.
    #[must_use]
    pub fn from_item(item: &AgentItem) -> Option<Self> {
        match item {
            AgentItem::Subagent {
                item_id,
                agent_thread_id,
                agent_type,
                background,
                description,
                model,
                prompt,
                result,
                status,
                ..
            } => Some(Self {
                item_id: item_id.clone(),
                agent_thread_id: agent_thread_id.clone(),
                agent_type: agent_type.clone(),
                background: *background,
                description: description.clone(),
                model: model.clone(),
                prompt: prompt.clone(),
                result: result.clone(),
                status: *status,
            }),
            _ => None,
        }
    }
}

/// The in-progress item for an `Agent` tool call.
#[must_use]
pub fn start_subagent(tool_use_id: &str, input: &JsonRecord) -> Option<SubagentItem> {
    Some(SubagentItem {
        item_id: ItemId::parse(tool_use_id)?,
        agent_thread_id: None,
        agent_type: str_of(input, "subagent_type").map(ToOwned::to_owned),
        background: is_true(input, "run_in_background"),
        description: str_of(input, "description").unwrap_or_default().to_owned(),
        model: str_of(input, "model").map(ToOwned::to_owned),
        prompt: str_of(input, "prompt").unwrap_or_default().to_owned(),
        result: None,
        status: SubagentStatus::Running,
    })
}

/// Where the `agentId: <id>` line starts in `text`, and the id.
fn agent_id_line(text: &str) -> Option<(usize, &str)> {
    let mut search = 0;
    while let Some(found) = text[search..].find(AGENT_ID_LINE) {
        let at = search + found;
        if at == 0 || text.as_bytes()[at - 1] == b'\n' {
            let rest = &text[at + AGENT_ID_LINE.len()..];
            let end = rest
                .find(|character: char| {
                    !(character.is_ascii_alphanumeric() || character == '_' || character == '-')
                })
                .unwrap_or(rest.len());
            if end > 0 {
                return Some((at, &rest[..end]));
            }
        }
        search = at + AGENT_ID_LINE.len();
    }
    None
}

/// The agent id the spawning call's result names, or `None`.
#[must_use]
pub fn spawned_agent_id(result: &ToolResultBlock, tool_use_result: &Value) -> Option<String> {
    record(tool_use_result)
        .and_then(|structured| str_of(structured, "agentId"))
        .map(ToOwned::to_owned)
        .or_else(|| agent_id_line(&result.text).map(|(_, id)| id.to_owned()))
}

fn is_async_launch(result: &ToolResultBlock, tool_use_result: &Value) -> bool {
    record(tool_use_result).is_some_and(|structured| {
        is_true(structured, "isAsync") || str_of(structured, "status") == Some("async_launched")
    }) || result.text.starts_with(ASYNC_LAUNCH)
}

/// The agent's answer without the trailing agent id and usage block Claude appends.
fn answer_text(result: &ToolResultBlock) -> String {
    let cut = agent_id_line(&result.text).map_or(result.text.len(), |(at, _)| at);
    result.text[..cut].trim_end().to_owned()
}

/// How the spawning call ended.
pub struct SubagentOutcome<'a> {
    pub app_thread_id: &'a AppThreadId,
    /// The call completed (not refused, cancelled or an error result).
    pub completed: bool,
    pub result: &'a ToolResultBlock,
    pub tool_use_result: &'a Value,
}

/// The item after its spawning call returned.
#[must_use]
pub fn complete_subagent(started: SubagentItem, outcome: &SubagentOutcome<'_>) -> SubagentItem {
    let agent_thread_id = spawned_agent_id(outcome.result, outcome.tool_use_result)
        .and_then(|agent_id| child_thread_id(outcome.app_thread_id, &agent_id))
        .or(started.agent_thread_id);
    if !outcome.completed {
        return SubagentItem {
            agent_thread_id,
            result: Some(outcome.result.text.clone()),
            status: SubagentStatus::Failed,
            ..started
        };
    }
    if is_async_launch(outcome.result, outcome.tool_use_result) {
        return SubagentItem {
            agent_thread_id,
            background: true,
            ..started
        };
    }
    SubagentItem {
        agent_thread_id,
        result: Some(answer_text(outcome.result)),
        status: SubagentStatus::Completed,
        ..started
    }
}

/// The agent thread once Claude names the agent (`task_started`), before the call returns.
#[must_use]
pub fn with_agent(item: SubagentItem, app_thread_id: &AppThreadId, agent_id: &str) -> SubagentItem {
    SubagentItem {
        agent_thread_id: child_thread_id(app_thread_id, agent_id).or(item.agent_thread_id),
        ..item
    }
}

/// A sub-agent's status as a task notification reports it, or `None` for a status that is not final.
#[must_use]
pub fn notified_status(status: Option<&str>) -> Option<SubagentStatus> {
    match status {
        Some("completed") => Some(SubagentStatus::Completed),
        Some("failed") => Some(SubagentStatus::Failed),
        Some("killed" | "stopped") => Some(SubagentStatus::Stopped),
        _ => None,
    }
}

/// The facts of a stored `<task-notification>` message.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct TaskNotification {
    pub status: Option<SubagentStatus>,
    pub task_id: String,
    pub tool_use_id: Option<String>,
}

fn tagged<'a>(text: &'a str, tag: &str) -> Option<&'a str> {
    let open = format!("<{tag}>");
    let close = format!("</{tag}>");
    let start = text.find(&open)? + open.len();
    let end = text[start..].find(&close)? + start;
    Some(&text[start..end])
}

fn is_identifier(value: &str) -> bool {
    !value.is_empty()
        && value.chars().all(|character| {
            character.is_ascii_alphanumeric() || character == '_' || character == '-'
        })
}

/// The notification's facts, or `None` for text without a task id.
#[must_use]
pub fn task_notification_of(text: &str) -> Option<TaskNotification> {
    let task_id = tagged(text, "task-id").filter(|id| is_identifier(id))?;
    Some(TaskNotification {
        status: notified_status(
            tagged(text, "status")
                .filter(|status| status.chars().all(|c| c.is_ascii_lowercase() || c == '_')),
        ),
        task_id: task_id.to_owned(),
        tool_use_id: tagged(text, "tool-use-id")
            .filter(|id| is_identifier(id))
            .map(ToOwned::to_owned),
    })
}

/// The item with a later status; a turn ending under a running foreground agent stops it.
#[must_use]
pub fn with_status(item: SubagentItem, status: SubagentStatus) -> SubagentItem {
    SubagentItem { status, ..item }
}

/// The agent id of a child thread id, or `None`.
#[must_use]
pub fn agent_id_of(agent_thread_id: &AppThreadId) -> Option<&str> {
    parse_child_thread_id(agent_thread_id).map(|(_, agent_id)| agent_id)
}

/// The latest final status each notified sub-agent reported, by spawning call and by agent id.
#[derive(Default)]
pub struct NotifiedStatuses {
    by_agent: HashMap<String, SubagentStatus>,
    by_tool_use: HashMap<String, SubagentStatus>,
}

impl NotifiedStatuses {
    pub fn record(&mut self, notification: &TaskNotification) {
        let Some(status) = notification.status else {
            return;
        };
        self.by_agent.insert(notification.task_id.clone(), status);
        if let Some(tool_use_id) = &notification.tool_use_id {
            self.by_tool_use.insert(tool_use_id.clone(), status);
        }
    }

    /// The item with the status a later notification reported; only a running item changes.
    #[must_use]
    pub fn apply(&self, item: SubagentItem) -> SubagentItem {
        if item.status != SubagentStatus::Running {
            return item;
        }
        let by_agent = item
            .agent_thread_id
            .as_ref()
            .and_then(agent_id_of)
            .and_then(|agent_id| self.by_agent.get(agent_id));
        match self.by_tool_use.get(item.item_id.as_str()).or(by_agent) {
            Some(status) => with_status(item, *status),
            None => item,
        }
    }
}
