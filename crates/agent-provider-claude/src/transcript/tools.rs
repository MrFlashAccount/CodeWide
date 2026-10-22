//! Mapping of Claude tool calls to neutral items.
//!
//! `start_item` builds the in-progress item from a `tool_use` input (so the
//! client sees the command or diff before any approval), `complete_item`
//! builds the final item from the matching `tool_result` and the structured
//! `toolUseResult`. Shell calls (`Bash`, `Monitor`, a `TaskStop` of a shell
//! task) are `command` items (`shell_tools`). Tools without a dedicated
//! neutral item become
//! `toolCall {namespace: "claude"}`; the companion's client tools become
//! `toolCall {namespace: null}` with their bare name. Pure.

use agent_core::model::{
    AgentItem, AppThreadId, CallStatus, ExecutionStatus, ItemId, McpToolResult, PlanStep,
    PlanStepStatus, WebSearchAction,
};
use serde_json::Value;

use super::{
    agents::{
        SubagentItem, SubagentOutcome, complete_subagent, is_subagent_tool, start_subagent,
        with_status,
    },
    client_tools::client_tool_of,
    diffs::{completed_diff, input_diff},
    frames::ToolResultBlock,
    json::{JsonRecord, arr_of, record, str_of},
    shell_tools::{ShellTool, StoppedShellCommand, StoppedShellTask},
};

const MIB: usize = 1024 * 1024;
/// Bash output kept on the item: the last 1 MiB.
pub const MAX_COMMAND_OUTPUT_BYTES: usize = MIB;
/// Text output kept on generic tool calls.
pub const MAX_TOOL_OUTPUT_BYTES: usize = MIB;
const MCP_PREFIX: &str = "mcp__";
const MCP_SEPARATOR: &str = "__";
const CLAUDE_AI_PREFIX: &str = "claude_ai_";

pub const READ_ONLY_TOOLS: [&str; 4] = ["Read", "Glob", "Grep", "LS"];
const FILE_EDIT_TOOLS: [&str; 4] = ["Edit", "Write", "MultiEdit", "NotebookEdit"];
const IMAGE_EXTENSIONS: [&str; 6] = ["png", "jpg", "jpeg", "gif", "webp", "bmp"];

/// What a tool call becomes in the neutral model.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ToolDisposition {
    Item,
    /// `TodoWrite`: a `plan.updated` event, no item.
    Plan,
    /// `AskUserQuestion`: a user-input request, no item.
    Question,
    /// `ExitPlanMode`: a `plan` item, then the call is denied.
    ExitPlan,
}

#[must_use]
pub fn tool_disposition(name: &str) -> ToolDisposition {
    match name {
        "TodoWrite" => ToolDisposition::Plan,
        "AskUserQuestion" => ToolDisposition::Question,
        "ExitPlanMode" => ToolDisposition::ExitPlan,
        _ => ToolDisposition::Item,
    }
}

/// Keeps the last `limit` bytes of `text` with a leading truncation line.
#[must_use]
pub fn keep_tail(text: &str, limit: usize) -> String {
    if text.len() <= limit {
        return text.to_owned();
    }
    let mut start = text.len() - limit;
    while !text.is_char_boundary(start) {
        start += 1;
    }
    format!(
        "[output truncated: first {start} bytes omitted]\n{}",
        &text[start..]
    )
}

fn normalize_server(server: &str) -> String {
    server
        .chars()
        .map(|character| {
            if character.is_ascii_alphanumeric() || character == '_' || character == '-' {
                character
            } else {
                '_'
            }
        })
        .collect()
}

/// Display name of a server name taken from the tool name itself.
fn display_server(raw: &str) -> String {
    match raw.strip_prefix(CLAUDE_AI_PREFIX) {
        Some(rest) => format!("claude.ai {}", rest.replace('_', " ")),
        None => raw.to_owned(),
    }
}

/// Splits `mcp__<server>__<tool>` using the longest known server name.
#[must_use]
pub fn split_mcp_tool_name(name: &str, known_servers: &[String]) -> Option<(String, String)> {
    let rest = name.strip_prefix(MCP_PREFIX)?;
    let mut candidates = known_servers.iter().collect::<Vec<_>>();
    candidates.sort_by_key(|server| std::cmp::Reverse(server.len()));
    for server in candidates {
        let prefix = format!("{}{MCP_SEPARATOR}", normalize_server(server));
        if let Some(tool) = rest.strip_prefix(prefix.as_str()) {
            return Some((server.clone(), tool.to_owned()));
        }
    }
    let separator = rest.find(MCP_SEPARATOR)?;
    if separator == 0 {
        return None;
    }
    Some((
        display_server(&rest[..separator]),
        rest[separator + MCP_SEPARATOR.len()..].to_owned(),
    ))
}

/// Context the mapping needs from the session.
pub struct ToolContext<'a> {
    pub cwd: &'a str,
    pub mcp_servers: &'a [String],
}

/// A tool call as the model issued it.
#[derive(Clone, Debug, PartialEq)]
pub struct ToolCallInput {
    pub id: String,
    pub input: JsonRecord,
    pub name: String,
}

fn web_item(call: &ToolCallInput, item_id: &ItemId) -> Option<AgentItem> {
    match call.name.as_str() {
        "WebSearch" => {
            let query = str_of(&call.input, "query").unwrap_or_default().to_owned();
            Some(AgentItem::WebSearch {
                item_id: item_id.clone(),
                provenance: None,
                query: query.clone(),
                action: Some(WebSearchAction::Search { query }),
            })
        }
        "WebFetch" => Some(AgentItem::WebSearch {
            item_id: item_id.clone(),
            provenance: None,
            query: String::new(),
            action: Some(WebSearchAction::OpenPage {
                url: str_of(&call.input, "url").unwrap_or_default().to_owned(),
            }),
        }),
        _ => None,
    }
}

fn call_item(call: &ToolCallInput, item_id: ItemId, context: &ToolContext<'_>) -> AgentItem {
    let arguments = Value::Object(call.input.clone());
    if let Some(client_tool) = client_tool_of(&call.name) {
        return AgentItem::ToolCall {
            item_id,
            provenance: None,
            namespace: None,
            tool: client_tool.to_owned(),
            arguments,
            output: None,
            status: CallStatus::InProgress,
            duration_ms: None,
        };
    }
    if let Some((server, tool)) = split_mcp_tool_name(&call.name, context.mcp_servers) {
        return AgentItem::McpToolCall {
            item_id,
            provenance: None,
            server,
            tool,
            arguments,
            status: CallStatus::InProgress,
            result: None,
            error: None,
            duration_ms: None,
        };
    }
    AgentItem::ToolCall {
        item_id,
        provenance: None,
        namespace: Some("claude".into()),
        tool: call.name.clone(),
        arguments,
        output: None,
        status: CallStatus::InProgress,
        duration_ms: None,
    }
}

/// In-progress item for a tool call, or `None` for tools without an item
/// (and for a tool use id that is not a valid item id).
#[must_use]
pub fn start_item(call: &ToolCallInput, context: &ToolContext<'_>) -> Option<AgentItem> {
    if tool_disposition(&call.name) != ToolDisposition::Item {
        return None;
    }
    let item_id = ItemId::parse(&call.id)?;
    if ShellTool::of(&call.name).is_some() {
        return Some(AgentItem::Command {
            item_id,
            provenance: None,
            command: str_of(&call.input, "command")
                .unwrap_or_default()
                .to_owned(),
            cwd: context.cwd.to_owned(),
            status: ExecutionStatus::InProgress,
            output: None,
            exit_code: None,
            duration_ms: None,
            background_task_id: None,
        });
    }
    if is_subagent_tool(&call.name) {
        return start_subagent(&call.id, &call.input).map(SubagentItem::into_item);
    }
    if FILE_EDIT_TOOLS.contains(&call.name.as_str()) {
        return Some(AgentItem::FileChange {
            item_id,
            provenance: None,
            changes: input_diff(&call.name, &call.input),
            status: ExecutionStatus::InProgress,
        });
    }
    Some(web_item(call, &item_id).unwrap_or_else(|| call_item(call, item_id, context)))
}

/// Image views that accompany a completed `Read` of an image file.
#[must_use]
pub fn image_view_for(id: &str, name: &str, input: &JsonRecord) -> Option<AgentItem> {
    if name != "Read" {
        return None;
    }
    let path = str_of(input, "file_path")?;
    let extension = path.rsplit_once('.')?.1.to_ascii_lowercase();
    if !IMAGE_EXTENSIONS.contains(&extension.as_str()) {
        return None;
    }
    Some(AgentItem::ImageView {
        item_id: ItemId::parse(&format!("{id}:image"))?,
        provenance: None,
        path: path.to_owned(),
    })
}

/// How a tool call ended, from the result block and the user's decision.
#[must_use]
pub fn execution_status(
    result: &ToolResultBlock,
    non_execution: Option<&str>,
    declined_by_user: bool,
) -> ExecutionStatus {
    if declined_by_user || non_execution == Some("permission-rule") {
        return ExecutionStatus::Declined;
    }
    if non_execution == Some("cancelled") || result.is_error {
        return ExecutionStatus::Failed;
    }
    ExecutionStatus::Completed
}

fn bash_output(result: &ToolResultBlock, tool_use_result: &Value) -> String {
    if let Some(structured) = record(tool_use_result) {
        let parts = [str_of(structured, "stdout"), str_of(structured, "stderr")]
            .into_iter()
            .flatten()
            .filter(|part| !part.is_empty())
            .collect::<Vec<_>>();
        if let Some(first) = parts.first() {
            let separator = if first.ends_with('\n') { "" } else { "\n" };
            return parts.join(separator);
        }
    }
    result.text.clone()
}

/// How a started tool call ended.
pub struct ToolOutcome<'a> {
    /// The thread the call ran in; names a spawned sub-agent's thread.
    pub app_thread_id: &'a AppThreadId,
    /// The session's working directory: the `cwd` of a call that becomes a
    /// `command` only once it completes.
    pub cwd: &'a str,
    pub duration_ms: i64,
    pub result: &'a ToolResultBlock,
    pub status: ExecutionStatus,
    /// The structured `toolUseResult`, when the record carried it.
    pub tool_use_result: &'a Value,
}

fn call_status(status: ExecutionStatus) -> CallStatus {
    if status == ExecutionStatus::Completed {
        CallStatus::Completed
    } else {
        CallStatus::Failed
    }
}

/// Final item of a generic tool call: the call with its output, or a
/// `command` (same item id) for a `TaskStop` that stopped a shell task,
/// since only the result tells a shell task apart.
fn complete_tool_call(
    started: AgentItem,
    call: &ToolCallInput,
    outcome: &ToolOutcome<'_>,
) -> AgentItem {
    let AgentItem::ToolCall {
        item_id,
        provenance,
        namespace,
        tool,
        arguments,
        ..
    } = started
    else {
        return started;
    };
    if let Some(stopped) = StoppedShellTask::of(&call.name, outcome.tool_use_result) {
        return StoppedShellCommand {
            item_id,
            provenance,
            stopped,
            cwd: outcome.cwd,
            status: outcome.status,
            duration_ms: outcome.duration_ms,
        }
        .into_item(MAX_COMMAND_OUTPUT_BYTES);
    }
    AgentItem::ToolCall {
        item_id,
        provenance,
        namespace,
        tool,
        arguments,
        output: Some(keep_tail(&outcome.result.text, MAX_TOOL_OUTPUT_BYTES)),
        status: call_status(outcome.status),
        duration_ms: Some(outcome.duration_ms),
    }
}

/// Final item for a started tool call and its result; other items are returned unchanged.
#[must_use]
pub fn complete_item(
    started: AgentItem,
    call: &ToolCallInput,
    outcome: &ToolOutcome<'_>,
) -> AgentItem {
    let completed = outcome.status == ExecutionStatus::Completed;
    match started {
        AgentItem::Subagent { .. } => {
            let Some(item) = SubagentItem::from_item(&started) else {
                return started;
            };
            complete_subagent(
                item,
                &SubagentOutcome {
                    app_thread_id: outcome.app_thread_id,
                    completed,
                    result: outcome.result,
                    tool_use_result: outcome.tool_use_result,
                },
            )
            .into_item()
        }
        AgentItem::Command {
            item_id,
            provenance,
            command,
            cwd,
            ..
        } => AgentItem::Command {
            item_id,
            provenance,
            command,
            cwd,
            status: outcome.status,
            output: Some(keep_tail(
                &bash_output(outcome.result, outcome.tool_use_result),
                MAX_COMMAND_OUTPUT_BYTES,
            )),
            exit_code: completed.then_some(0),
            duration_ms: Some(outcome.duration_ms),
            background_task_id: ShellTool::of(&call.name)
                .and_then(|tool| tool.started_task_id(outcome.tool_use_result)),
        },
        AgentItem::FileChange {
            item_id,
            provenance,
            changes,
            ..
        } => AgentItem::FileChange {
            item_id,
            provenance,
            changes: if completed {
                completed_diff(&call.name, &call.input, outcome.tool_use_result)
            } else {
                changes
            },
            status: outcome.status,
        },
        AgentItem::ToolCall { .. } => complete_tool_call(started, call, outcome),
        AgentItem::McpToolCall {
            item_id,
            provenance,
            server,
            tool,
            arguments,
            ..
        } => AgentItem::McpToolCall {
            item_id,
            provenance,
            server,
            tool,
            arguments,
            status: call_status(outcome.status),
            result: completed.then(|| McpToolResult {
                content: outcome.result.blocks.clone(),
                structured_content: Value::Null,
            }),
            error: (!completed).then(|| outcome.result.text.clone()),
            duration_ms: Some(outcome.duration_ms),
        },
        other => other,
    }
}

/// Closes an item that never received its result (interrupt, exit); a
/// sub-agent working for it is stopped.
#[must_use]
pub fn fail_open_item(item: AgentItem) -> AgentItem {
    match item {
        AgentItem::Subagent { .. } => SubagentItem::from_item(&item)
            .map(|subagent| {
                with_status(subagent, agent_core::model::SubagentStatus::Stopped).into_item()
            })
            .unwrap_or(item),
        AgentItem::Command {
            status: ExecutionStatus::InProgress,
            ..
        }
        | AgentItem::FileChange {
            status: ExecutionStatus::InProgress,
            ..
        } => with_execution_status(item, ExecutionStatus::Failed),
        AgentItem::ToolCall {
            item_id,
            provenance,
            namespace,
            tool,
            arguments,
            output,
            duration_ms,
            ..
        } => AgentItem::ToolCall {
            item_id,
            provenance,
            namespace,
            tool,
            arguments,
            output,
            status: CallStatus::Failed,
            duration_ms,
        },
        AgentItem::McpToolCall {
            item_id,
            provenance,
            server,
            tool,
            arguments,
            result,
            error,
            duration_ms,
            ..
        } => AgentItem::McpToolCall {
            item_id,
            provenance,
            server,
            tool,
            arguments,
            status: CallStatus::Failed,
            result,
            error,
            duration_ms,
        },
        other => other,
    }
}

fn with_execution_status(item: AgentItem, status: ExecutionStatus) -> AgentItem {
    match item {
        AgentItem::Command {
            item_id,
            provenance,
            command,
            cwd,
            output,
            exit_code,
            duration_ms,
            background_task_id,
            ..
        } => AgentItem::Command {
            item_id,
            provenance,
            command,
            cwd,
            status,
            output,
            exit_code,
            duration_ms,
            background_task_id,
        },
        AgentItem::FileChange {
            item_id,
            provenance,
            changes,
            ..
        } => AgentItem::FileChange {
            item_id,
            provenance,
            changes,
            status,
        },
        other => other,
    }
}

fn todo_status(raw: Option<&str>) -> PlanStepStatus {
    match raw {
        Some("completed") => PlanStepStatus::Completed,
        Some("in_progress") => PlanStepStatus::InProgress,
        _ => PlanStepStatus::Pending,
    }
}

/// Plan steps from a `TodoWrite` input; `activeForm` is the step's running label.
#[must_use]
pub fn todo_plan(input: &JsonRecord) -> Vec<PlanStep> {
    arr_of(input, "todos")
        .iter()
        .filter_map(|todo| {
            let todo = record(todo)?;
            let active_form = str_of(todo, "activeForm").filter(|form| !form.is_empty());
            Some(PlanStep {
                step: str_of(todo, "content")
                    .or(active_form)
                    .unwrap_or_default()
                    .to_owned(),
                status: todo_status(str_of(todo, "status")),
                active_form: active_form.map(ToOwned::to_owned),
            })
        })
        .collect()
}

/// Item id of a text or thinking block: `{message.id}:{block}`.
#[must_use]
pub fn block_item_id(message_id: &str, block_index: usize) -> Option<ItemId> {
    ItemId::parse(&format!("{message_id}:{block_index}"))
}

#[cfg(test)]
mod tests {
    use agent_core::model::{AgentItem, AppThreadId, ExecutionStatus};
    use serde_json::{Value, json};

    use super::{
        ToolCallInput, ToolContext, ToolOutcome, complete_item, keep_tail, split_mcp_tool_name,
        start_item,
    };
    use crate::transcript::frames::ToolResultBlock;

    fn completed_bash(tool_use_result: &Value) -> Result<Option<String>, &'static str> {
        let call = ToolCallInput {
            id: "toolu_bg".into(),
            input: json!({"command": "sleep 8 && echo BG_DONE", "run_in_background": true})
                .as_object()
                .cloned()
                .unwrap_or_default(),
            name: "Bash".into(),
        };
        let started = start_item(
            &call,
            &ToolContext {
                cwd: "/w",
                mcp_servers: &[],
            },
        )
        .ok_or("no started item")?;
        let text = "Command running in background with ID: bd3cb8oli. Output is being written to: /tmp/claude-1/-w/s/tasks/bd3cb8oli.output.";
        let result = ToolResultBlock {
            blocks: Vec::new(),
            is_error: false,
            text: text.into(),
            tool_use_id: "toolu_bg".into(),
        };
        let thread = AppThreadId::from_static("thread");
        match complete_item(
            started,
            &call,
            &ToolOutcome {
                app_thread_id: &thread,
                cwd: "/w",
                duration_ms: 3,
                result: &result,
                status: ExecutionStatus::Completed,
                tool_use_result,
            },
        ) {
            AgentItem::Command {
                background_task_id,
                output,
                ..
            } => {
                assert_eq!(output.as_deref(), Some(text));
                Ok(background_task_id)
            }
            _ => Err("not a command item"),
        }
    }

    #[test]
    fn a_background_bash_call_names_its_task_from_the_structured_result() {
        assert_eq!(
            completed_bash(&json!({"stdout": "", "stderr": "", "backgroundTaskId": "bd3cb8oli"})),
            Ok(Some("bd3cb8oli".into()))
        );
        // A foreground call, a missing structured result and an id that
        // could name another file carry no task.
        assert_eq!(
            completed_bash(&json!({"stdout": "", "stderr": ""})),
            Ok(None)
        );
        assert_eq!(completed_bash(&Value::Null), Ok(None));
        assert_eq!(
            completed_bash(&json!({"backgroundTaskId": "../../etc/passwd"})),
            Ok(None)
        );
    }

    #[test]
    fn command_output_keeps_its_last_mebibyte_with_a_truncation_line() {
        let text = "é".repeat(600_000);
        let kept = keep_tail(&text, 1024 * 1024);
        assert!(kept.starts_with("[output truncated: first "));
        assert!(kept.len() <= 1024 * 1024 + 64);
        assert!(kept.ends_with('é'));
        assert_eq!(keep_tail("short", 1024), "short");
    }

    #[test]
    fn mcp_names_split_by_the_longest_known_server() {
        let servers = vec!["probe".to_owned(), "probe__v2".to_owned()];
        assert_eq!(
            split_mcp_tool_name("mcp__probe__v2__write", &servers),
            Some(("probe__v2".into(), "write".into()))
        );
        assert_eq!(
            split_mcp_tool_name("mcp__claude_ai_Claude_Docs__read", &[]),
            Some(("claude.ai Claude Docs".into(), "read".into()))
        );
        assert_eq!(split_mcp_tool_name("Bash", &servers), None);
    }
}
