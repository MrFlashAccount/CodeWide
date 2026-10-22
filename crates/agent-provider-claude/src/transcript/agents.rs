//! Sub-agents Claude starts with its `Agent` (formerly `Task`) tool, as
//! neutral `subagent` items, and the child thread id of each sub-agent's
//! transcript.
//!
//! The same rules serve live frames and stored history:
//! - the item starts `Running` from the tool input;
//! - the spawning call's result names the agent (`tool_use_result.agentId`
//!   live, the `agentId: <id>` line of the result text in both); a background
//!   launch keeps it `Running`, a foreground result completes it;
//! - a task report (`<task-notification>` message in history, a
//!   `task_notification` system frame live, both read by `task_reports`)
//!   carries the final status;
//! - a `SendMessage` call that resumes a finished agent (`resumedAgentId` in
//!   its result) makes it running again until a later report settles that
//!   agent; older status facts never override newer ones.
//!
//! Child thread id: `<app thread id>:agent:<agent id>` (`crate::subagents`).
//! Pure.

use std::collections::HashMap;

use agent_core::model::{AgentItem, AppThreadId, ItemId, SubagentStatus};
use serde_json::Value;

use super::{
    frames::ToolResultBlock,
    json::{JsonRecord, is_true, record, str_of},
    task_reports::TaskReport,
};
use crate::subagents::{child_thread_id, parse_child_thread_id};

const AGENT_ID_LINE: &str = "agentId: ";
const ASYNC_LAUNCH: &str = "Async agent launched";
const SEND_MESSAGE: &str = "SendMessage";

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

/// Whether a tool call sends a message to another agent (`SendMessage`).
#[must_use]
pub fn is_send_message_tool(name: &str) -> bool {
    name == SEND_MESSAGE
}

/// The agent a `SendMessage` call woke, or `None`: a message to an agent
/// that is still working is only queued for it, and a stopped agent is not
/// resumed. The result text is the JSON object Claude also stores as
/// `toolUseResult`.
#[must_use]
pub fn resumed_agent_id(result: &ToolResultBlock, tool_use_result: &Value) -> Option<String> {
    if result.is_error {
        return None;
    }
    let resumed = |value: &Value| {
        record(value)
            .and_then(|structured| str_of(structured, "resumedAgentId"))
            .map(ToOwned::to_owned)
    };
    serde_json::from_str::<Value>(&result.text)
        .ok()
        .as_ref()
        .and_then(resumed)
        .or_else(|| resumed(tool_use_result))
}

/// The runs of a session's sub-agents: the latest status fact recorded by
/// the call that started each run and by agent id.
///
/// A run is started by the spawning `Agent` call or by a resuming
/// `SendMessage` call, and a later task report ends it. Facts are ordered by
/// their stored timestamps, so an older unreported call cannot keep an agent
/// running after a newer run reported completion.
#[derive(Default)]
pub struct SubagentRuns {
    by_agent: HashMap<String, TimedStatus>,
    by_tool_use: HashMap<String, TimedStatus>,
}

#[derive(Clone, Copy)]
struct TimedStatus {
    timestamp_ms: i64,
    status: SubagentStatus,
}

impl SubagentRuns {
    pub fn record(&mut self, report: &TaskReport, timestamp_ms: i64) {
        let Some(status) = notified_status(report.status.as_deref()) else {
            return;
        };
        Self::record_status(&mut self.by_agent, &report.task_id, timestamp_ms, status);
        if let Some(tool_use_id) = &report.tool_use_id {
            Self::record_status(&mut self.by_tool_use, tool_use_id, timestamp_ms, status);
        }
    }

    /// A `SendMessage` call resumed `agent_id`.
    pub fn record_resume(&mut self, tool_use_id: &str, agent_id: &str, timestamp_ms: i64) {
        Self::record_status(
            &mut self.by_agent,
            agent_id,
            timestamp_ms,
            SubagentStatus::Running,
        );
        Self::record_status(
            &mut self.by_tool_use,
            tool_use_id,
            timestamp_ms,
            SubagentStatus::Running,
        );
    }

    fn record_status(
        statuses: &mut HashMap<String, TimedStatus>,
        key: &str,
        timestamp_ms: i64,
        status: SubagentStatus,
    ) {
        let replace = statuses
            .get(key)
            .is_none_or(|current| timestamp_ms >= current.timestamp_ms);
        if replace {
            statuses.insert(
                key.to_owned(),
                TimedStatus {
                    timestamp_ms,
                    status,
                },
            );
        }
    }

    /// The item with the latest status recorded for its agent or spawning call.
    #[must_use]
    pub fn apply(&self, item: SubagentItem) -> SubagentItem {
        let agent_id = item.agent_thread_id.as_ref().and_then(agent_id_of);
        let status = agent_id
            .and_then(|agent_id| self.by_agent.get(agent_id))
            .or_else(|| self.by_tool_use.get(item.item_id.as_str()))
            .map(|status| status.status);
        match status {
            Some(SubagentStatus::Running) => with_status(item, SubagentStatus::Running),
            Some(status) if item.status == SubagentStatus::Running => with_status(item, status),
            _ => item,
        }
    }
}
