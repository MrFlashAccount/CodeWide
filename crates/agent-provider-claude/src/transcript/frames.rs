//! Structural classification of Claude's messages: the stored rows of a
//! session file and the frames of the CLI's stream-json output have the same
//! shapes (the stream adds `parent_tool_use_id` and `session_id`). The message
//! union is wide and grows between CLI versions; this module reads every
//! message structurally into a small enum and never fails: anything it does
//! not understand becomes [`ClaudeFrame::Other`]. Pure.

use std::collections::HashMap;

use serde_json::Value;

use super::{
    json::{JsonRecord, arr_of, elements, int_of, is_true, record, record_of, str_of, str_of2},
    task_reports::{TaskReport, live_task_report},
};

/// One content block of an assistant message snapshot.
#[derive(Clone, Debug, PartialEq)]
pub enum AssistantBlock {
    Text {
        text: String,
    },
    Thinking {
        text: String,
    },
    ToolUse {
        id: String,
        input: JsonRecord,
        name: String,
    },
    Other,
}

#[derive(Clone, Debug, PartialEq)]
pub struct ToolResultBlock {
    /// Raw content blocks, kept for MCP results.
    pub blocks: Vec<Value>,
    pub is_error: bool,
    /// Text content joined from string or `{type:"text"}` blocks.
    pub text: String,
    pub tool_use_id: String,
}

/// Token counts of one model request (`message.usage` of an assistant message).
#[derive(Clone, Copy, Debug, Default, Eq, PartialEq)]
pub struct RequestFigures {
    pub cache_creation_input_tokens: i64,
    pub cache_read_input_tokens: i64,
    /// Uncached prompt tokens only, as the API reports them.
    pub input_tokens: i64,
    pub output_tokens: i64,
}

/// Which price table the CLI priced a model's latest request with. An
/// absent field means `List` (CLI contract).
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum CostBasis {
    List,
    Managed,
    Unknown,
}

/// One model's cumulative totals from a result's `modelUsage`.
#[derive(Clone, Debug, PartialEq)]
pub struct ModelTotals {
    pub cache_creation_input_tokens: i64,
    pub cache_read_input_tokens: i64,
    pub canonical_model: Option<String>,
    pub context_window: Option<i64>,
    pub cost_basis: CostBasis,
    pub cost_usd: f64,
    pub input_tokens: i64,
    /// The `modelUsage` key (raw model string).
    pub model: String,
    /// Includes `thinking_tokens`.
    pub output_tokens: i64,
    pub thinking_tokens: i64,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum BlockKind {
    Text,
    Thinking,
    ToolUse,
    Other,
}

#[derive(Clone, Debug, PartialEq)]
pub enum StreamEvent {
    MessageStart { message_id: String },
    BlockStart { block: BlockKind, index: i64 },
    TextDelta { index: i64, text: String },
    ThinkingDelta { index: i64, text: String },
    BlockStop { index: i64 },
    Other,
}

/// A background task Claude started (`task_started`).
#[derive(Clone, Debug, PartialEq)]
pub struct TaskStartedFrame {
    /// The `Agent` call's description for a sub-agent, the command's for a shell task.
    pub description: Option<String>,
    /// Owned by a sub-agent: its reports go to that sub-agent, not to this conversation.
    pub nested: bool,
    /// For a sub-agent, its agent id.
    pub task_id: String,
    /// `local_agent`, `local_bash`, ...
    pub task_type: Option<String>,
    /// The spawning call.
    pub tool_use_id: Option<String>,
}

#[derive(Clone, Debug, PartialEq)]
pub struct AssistantFrame {
    pub blocks: Vec<AssistantBlock>,
    pub error: Option<String>,
    pub message_id: String,
    /// Canonical API model id of the request that produced the message.
    pub model: Option<String>,
    pub parent_tool_use_id: Option<String>,
    pub usage: Option<RequestFigures>,
    /// Uuid Claude persists the message under.
    pub uuid: Option<String>,
}

#[derive(Clone, Debug, PartialEq)]
pub struct UserFrame {
    pub is_synthetic: bool,
    /// `tool_result_meta[].non_execution_kind` by tool use id.
    pub non_execution: HashMap<String, String>,
    pub parent_tool_use_id: Option<String>,
    pub tool_results: Vec<ToolResultBlock>,
    /// The structured result the CLI persists or streams next to the block.
    pub tool_use_result: Value,
    pub uuid: Option<String>,
}

#[derive(Clone, Debug, PartialEq)]
pub struct ResultFrame {
    pub errors: Vec<String>,
    pub is_error: bool,
    /// The result's own main-loop usage (per turn; subagents excluded).
    pub main_loop_usage: Option<RequestFigures>,
    /// Cumulative per-model totals of the query; empty when the result carries none.
    pub model_usage: Vec<ModelTotals>,
    pub num_turns: i64,
    /// `origin.kind` (`task-notification`, `peer`, ...) or `None` for a user turn.
    pub origin: Option<String>,
    pub result: Option<String>,
    pub subtype: String,
    pub terminal_reason: Option<String>,
    pub user_message_uuids: Vec<String>,
}

#[derive(Clone, Debug, PartialEq)]
pub enum ClaudeFrame {
    Init {
        mcp_servers: Vec<String>,
        session_id: Option<String>,
    },
    Stream {
        event: StreamEvent,
        parent_tool_use_id: Option<String>,
    },
    Assistant(AssistantFrame),
    User(UserFrame),
    Result(ResultFrame),
    CompactBoundary {
        uuid: Option<String>,
    },
    /// Claude started compacting the context; the boundary follows when it is done.
    Compacting,
    BackgroundTasks {
        count: usize,
    },
    TaskStarted(TaskStartedFrame),
    /// A task reported (`task_notification`): finished, stopped or an interim result.
    TaskNotification(TaskReport),
    RateLimit {
        status: Option<String>,
        info: Value,
    },
    Other {
        kind: String,
    },
}

fn request_figures(value: Option<&Value>) -> Option<RequestFigures> {
    let figures = value?.as_object()?;
    Some(RequestFigures {
        cache_creation_input_tokens: int_of(figures, "cache_creation_input_tokens").unwrap_or(0),
        cache_read_input_tokens: int_of(figures, "cache_read_input_tokens").unwrap_or(0),
        input_tokens: int_of(figures, "input_tokens").unwrap_or(0),
        output_tokens: int_of(figures, "output_tokens").unwrap_or(0),
    })
}

fn model_totals(model: &str, entry: &JsonRecord) -> ModelTotals {
    let count = |name: &str| int_of(entry, name).unwrap_or(0);
    ModelTotals {
        cache_creation_input_tokens: count("cacheCreationInputTokens"),
        cache_read_input_tokens: count("cacheReadInputTokens"),
        canonical_model: str_of(entry, "canonicalModel").map(ToOwned::to_owned),
        context_window: int_of(entry, "contextWindow"),
        cost_basis: match str_of(entry, "costBasis") {
            Some("managed") => CostBasis::Managed,
            Some("unknown") => CostBasis::Unknown,
            _ => CostBasis::List,
        },
        cost_usd: entry
            .get("costUSD")
            .and_then(Value::as_f64)
            .filter(|cost| cost.is_finite())
            .unwrap_or(0.0),
        input_tokens: count("inputTokens"),
        model: model.to_owned(),
        output_tokens: count("outputTokens"),
        thinking_tokens: count("thinkingTokens"),
    }
}

fn model_usage(value: Option<&Value>) -> Vec<ModelTotals> {
    value
        .and_then(Value::as_object)
        .map(|usage| {
            usage
                .iter()
                .filter_map(|(model, entry)| {
                    entry.as_object().map(|entry| model_totals(model, entry))
                })
                .collect()
        })
        .unwrap_or_default()
}

fn assistant_block(value: &Value) -> AssistantBlock {
    let Some(block) = record(value) else {
        return AssistantBlock::Other;
    };
    match str_of(block, "type") {
        Some("text") => AssistantBlock::Text {
            text: str_of(block, "text").unwrap_or_default().to_owned(),
        },
        Some("thinking") => AssistantBlock::Thinking {
            text: str_of(block, "thinking").unwrap_or_default().to_owned(),
        },
        Some("tool_use") => match (str_of(block, "id"), str_of(block, "name")) {
            (Some(id), Some(name)) => AssistantBlock::ToolUse {
                id: id.to_owned(),
                input: record_of(block, "input").cloned().unwrap_or_default(),
                name: name.to_owned(),
            },
            _ => AssistantBlock::Other,
        },
        _ => AssistantBlock::Other,
    }
}

/// Joins the text of a `tool_result` `content` (string or block list).
#[must_use]
pub fn tool_result_text(content: Option<&Value>) -> String {
    if let Some(text) = content.and_then(Value::as_str) {
        return text.to_owned();
    }
    elements(content)
        .iter()
        .filter_map(|block| {
            let block = record(block)?;
            (str_of(block, "type") == Some("text"))
                .then(|| str_of(block, "text").unwrap_or_default())
                .filter(|text| !text.is_empty())
        })
        .collect::<Vec<_>>()
        .join("\n")
}

fn block_kind(block: Option<&Value>) -> BlockKind {
    match block
        .and_then(Value::as_object)
        .and_then(|block| str_of(block, "type"))
    {
        Some("text") => BlockKind::Text,
        Some("thinking") => BlockKind::Thinking,
        Some("tool_use") => BlockKind::ToolUse,
        _ => BlockKind::Other,
    }
}

fn stream_event(value: Option<&Value>) -> StreamEvent {
    let Some(event) = value.and_then(Value::as_object) else {
        return StreamEvent::Other;
    };
    let index = int_of(event, "index").unwrap_or(-1);
    match str_of(event, "type") {
        Some("message_start") => {
            match record_of(event, "message").and_then(|message| str_of(message, "id")) {
                Some(message_id) => StreamEvent::MessageStart {
                    message_id: message_id.to_owned(),
                },
                None => StreamEvent::Other,
            }
        }
        Some("content_block_start") => StreamEvent::BlockStart {
            block: block_kind(event.get("content_block")),
            index,
        },
        Some("content_block_delta") => {
            let Some(delta) = record_of(event, "delta") else {
                return StreamEvent::Other;
            };
            match str_of(delta, "type") {
                Some("text_delta") => StreamEvent::TextDelta {
                    index,
                    text: str_of(delta, "text").unwrap_or_default().to_owned(),
                },
                Some("thinking_delta") => StreamEvent::ThinkingDelta {
                    index,
                    text: str_of(delta, "thinking").unwrap_or_default().to_owned(),
                },
                _ => StreamEvent::Other,
            }
        }
        Some("content_block_stop") => StreamEvent::BlockStop { index },
        _ => StreamEvent::Other,
    }
}

fn system_frame(value: &JsonRecord) -> ClaudeFrame {
    let subtype = str_of(value, "subtype").unwrap_or_default();
    match subtype {
        "init" => ClaudeFrame::Init {
            mcp_servers: arr_of(value, "mcp_servers")
                .iter()
                .filter_map(|server| record(server).and_then(|server| str_of(server, "name")))
                .map(ToOwned::to_owned)
                .collect(),
            session_id: str_of(value, "session_id").map(ToOwned::to_owned),
        },
        "compact_boundary" => ClaudeFrame::CompactBoundary {
            uuid: str_of(value, "uuid").map(ToOwned::to_owned),
        },
        "status" if str_of(value, "status") == Some("compacting") => ClaudeFrame::Compacting,
        "status" => ClaudeFrame::Other {
            kind: "system:status".into(),
        },
        "background_tasks_changed" => ClaudeFrame::BackgroundTasks {
            count: arr_of(value, "tasks").len(),
        },
        "task_started" => task_started_frame(value),
        "task_notification" => match live_task_report(value) {
            Some(report) => ClaudeFrame::TaskNotification(report),
            None => ClaudeFrame::Other {
                kind: "system:task_notification".into(),
            },
        },
        other => ClaudeFrame::Other {
            kind: format!("system:{other}"),
        },
    }
}

/// The spawn depth of a task the main conversation started.
const TOP_LEVEL_SPAWN_DEPTH: i64 = 1;

fn task_started_frame(value: &JsonRecord) -> ClaudeFrame {
    let Some(task_id) = str_of(value, "task_id") else {
        return ClaudeFrame::Other {
            kind: "system:task_started".into(),
        };
    };
    ClaudeFrame::TaskStarted(TaskStartedFrame {
        description: str_of(value, "description").map(ToOwned::to_owned),
        nested: is_true(value, "owned_by_subagent")
            || int_of(value, "spawn_depth").is_some_and(|depth| depth > TOP_LEVEL_SPAWN_DEPTH),
        task_id: task_id.to_owned(),
        task_type: str_of(value, "task_type").map(ToOwned::to_owned),
        tool_use_id: str_of(value, "tool_use_id").map(ToOwned::to_owned),
    })
}

/// Whether `value` is the placeholder Claude Code writes for an interrupted
/// turn ("No response requested.") once the next prompt arrives: a synthetic
/// message that reports no API error. It is no model answer. Synthetic API
/// error messages (`error` live, `isApiErrorMessage` stored) stay visible.
fn is_interrupt_placeholder(value: &JsonRecord, message: &JsonRecord) -> bool {
    str_of(message, "model") == Some("<synthetic>")
        && str_of(value, "error").is_none()
        && !is_true(value, "isApiErrorMessage")
}

fn assistant_frame(value: &JsonRecord) -> ClaudeFrame {
    let Some(message) = record_of(value, "message") else {
        return ClaudeFrame::Other {
            kind: "assistant".into(),
        };
    };
    if is_interrupt_placeholder(value, message) {
        return ClaudeFrame::Other {
            kind: "assistant".into(),
        };
    }
    ClaudeFrame::Assistant(AssistantFrame {
        blocks: arr_of(message, "content")
            .iter()
            .map(assistant_block)
            .collect(),
        error: str_of(value, "error").map(ToOwned::to_owned),
        message_id: str_of(message, "id")
            .or_else(|| str_of(value, "uuid"))
            .unwrap_or("message")
            .to_owned(),
        model: str_of(message, "model").map(ToOwned::to_owned),
        parent_tool_use_id: str_of(value, "parent_tool_use_id").map(ToOwned::to_owned),
        usage: request_figures(message.get("usage")),
        uuid: str_of(value, "uuid").map(ToOwned::to_owned),
    })
}

fn tool_result(value: &Value) -> Option<ToolResultBlock> {
    let block = record(value)?;
    if str_of(block, "type") != Some("tool_result") {
        return None;
    }
    let tool_use_id = str_of(block, "tool_use_id")?;
    let content = block.get("content");
    Some(ToolResultBlock {
        blocks: match content.and_then(Value::as_str) {
            Some(text) => vec![serde_json::json!({"text": text, "type": "text"})],
            None => elements(content).to_vec(),
        },
        is_error: is_true(block, "is_error"),
        text: tool_result_text(content),
        tool_use_id: tool_use_id.to_owned(),
    })
}

fn non_execution_kinds(meta: &[Value]) -> HashMap<String, String> {
    meta.iter()
        .filter_map(|entry| {
            let entry = record(entry)?;
            Some((
                str_of(entry, "id")?.to_owned(),
                str_of(entry, "non_execution_kind")?.to_owned(),
            ))
        })
        .collect()
}

fn user_frame(value: &JsonRecord) -> ClaudeFrame {
    let content = record_of(value, "message").and_then(|message| message.get("content"));
    ClaudeFrame::User(UserFrame {
        is_synthetic: is_true(value, "isSynthetic"),
        non_execution: non_execution_kinds(arr_of(value, "tool_result_meta")),
        parent_tool_use_id: str_of(value, "parent_tool_use_id").map(ToOwned::to_owned),
        tool_results: elements(content).iter().filter_map(tool_result).collect(),
        tool_use_result: value
            .get("tool_use_result")
            .or_else(|| value.get("toolUseResult"))
            .cloned()
            .unwrap_or(Value::Null),
        uuid: str_of(value, "uuid").map(ToOwned::to_owned),
    })
}

fn strings(values: &[Value]) -> Vec<String> {
    values
        .iter()
        .filter_map(Value::as_str)
        .map(ToOwned::to_owned)
        .collect()
}

fn result_frame(value: &JsonRecord) -> ClaudeFrame {
    let mut uuids = Vec::new();
    if let Some(single) = str_of(value, "user_message_uuid") {
        uuids.push(single.to_owned());
    }
    for uuid in strings(arr_of(value, "user_message_uuids")) {
        if !uuids.contains(&uuid) {
            uuids.push(uuid);
        }
    }
    ClaudeFrame::Result(ResultFrame {
        errors: strings(arr_of(value, "errors")),
        is_error: is_true(value, "is_error"),
        main_loop_usage: request_figures(value.get("usage")),
        model_usage: model_usage(value.get("modelUsage")),
        num_turns: int_of(value, "num_turns").unwrap_or(0),
        origin: record_of(value, "origin")
            .map(|origin| str_of(origin, "kind").unwrap_or("unknown").to_owned()),
        result: str_of(value, "result").map(ToOwned::to_owned),
        subtype: str_of(value, "subtype").unwrap_or("unknown").to_owned(),
        terminal_reason: str_of(value, "terminal_reason").map(ToOwned::to_owned),
        user_message_uuids: uuids,
    })
}

/// Classifies one raw message. Never fails.
#[must_use]
pub fn classify_frame(value: &Value) -> ClaudeFrame {
    match record(value) {
        Some(message) => classify_message(message),
        None => ClaudeFrame::Other {
            kind: "invalid".into(),
        },
    }
}

/// Classifies one message object. Never fails.
#[must_use]
pub fn classify_message(message: &JsonRecord) -> ClaudeFrame {
    match str_of(message, "type").unwrap_or("unknown") {
        "assistant" => assistant_frame(message),
        "user" => user_frame(message),
        "result" => result_frame(message),
        "system" => system_frame(message),
        "stream_event" => ClaudeFrame::Stream {
            event: stream_event(message.get("event")),
            parent_tool_use_id: str_of(message, "parent_tool_use_id").map(ToOwned::to_owned),
        },
        "rate_limit_event" => {
            let info = message.get("rate_limit_info");
            ClaudeFrame::RateLimit {
                status: info
                    .and_then(Value::as_object)
                    .and_then(|info| str_of(info, "status"))
                    .map(ToOwned::to_owned),
                info: info.cloned().unwrap_or(Value::Null),
            }
        }
        other => ClaudeFrame::Other {
            kind: other.to_owned(),
        },
    }
}

/// The `origin.kind` of a message, `None` when it has no origin and
/// `"unknown"` for an origin without a kind.
#[must_use]
pub fn origin_kind(value: &JsonRecord) -> Option<&str> {
    let origin = record_of(value, "origin")?;
    Some(str_of(origin, "kind").unwrap_or("unknown"))
}

/// The uuid of a message under either spelling.
#[must_use]
pub fn message_uuid(value: &JsonRecord) -> Option<&str> {
    str_of2(value, "uuid", "id")
}
