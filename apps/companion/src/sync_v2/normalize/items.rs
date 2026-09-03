//! App Server activity-item normalization.

use percent_encoding::{NON_ALPHANUMERIC, utf8_percent_encode};
use serde_json::Value;

use super::nonnegative_safe_integer;
use crate::sync_v2::{
    domain::{
        Effort, ExecutionState, FileChangeEntry, FileChangeKind, FileChangeState, ImageDetail,
        Item, MemoryCitation, MemoryCitationEntry, MessagePhase, PlanStep, PlanStepState,
        ReviewModeState, ToolAppContext, ToolError, UserMessageBlock, UserTextByteRange,
        UserTextElement,
    },
    protocol::V2Error,
    scalar::Id,
};

pub fn item(value: &Value) -> Result<Item, V2Error> {
    let kind = required_string(value, "type")?;
    let id = required_id(value, "id")?;
    match kind {
        "userMessage" | "agentMessage" | "reasoning" => message_item(kind, id, value),
        "commandExecution" => command_item(id, value),
        "fileChange" => file_change_item(id, value),
        "mcpToolCall" | "dynamicToolCall" | "tool" => tool_item(kind, id, value),
        "plan" => plan_item(id, value),
        "hookPrompt" => hook_prompt_item(id, value),
        "collabAgentToolCall" => collaboration_item(id, value),
        "subAgentActivity" => subagent_activity_item(id, value),
        "webSearch" | "imageView" | "sleep" | "imageGeneration" => media_item(kind, id, value),
        "enteredReviewMode" | "exitedReviewMode" => review_mode_item(kind, id, value),
        "contextCompaction" => Ok(Item::ContextCompaction { id }),
        _ => {
            let (payload_json, payload_truncated) = unsupported_payload(value);
            Ok(Item::Unsupported {
                id,
                source_kind: kind.chars().take(128).collect(),
                payload_json,
                payload_truncated,
            })
        }
    }
}

fn unsupported_payload(value: &Value) -> (String, bool) {
    let mut changed = false;
    let sanitized = sanitize_unsupported_value(value, 0, &mut changed);
    let encoded = serde_json::to_string_pretty(&sanitized).unwrap_or_else(|_| "{}".to_owned());
    if encoded.len() <= 65_536 {
        return (encoded, changed);
    }
    let fallback = serde_json::json!({
        "type": value.get("type").and_then(Value::as_str).unwrap_or("unknown"),
        "note": "Unsupported item payload exceeded the safe preview limit"
    });
    (
        serde_json::to_string_pretty(&fallback).unwrap_or_else(|_| "{}".to_owned()),
        true,
    )
}

fn sanitize_unsupported_value(value: &Value, depth: usize, changed: &mut bool) -> Value {
    if depth >= 8 {
        *changed = true;
        return Value::String("[truncated]".to_owned());
    }
    match value {
        Value::Array(values) => {
            if values.len() > 128 {
                *changed = true;
            }
            Value::Array(
                values
                    .iter()
                    .take(128)
                    .map(|value| sanitize_unsupported_value(value, depth + 1, changed))
                    .collect(),
            )
        }
        Value::Object(values) => {
            if values.len() > 128 {
                *changed = true;
            }
            Value::Object(
                values
                    .iter()
                    .take(128)
                    .map(|(key, value)| {
                        let sanitized = if sensitive_payload_key(key) {
                            *changed = true;
                            Value::String("[redacted]".to_owned())
                        } else {
                            sanitize_unsupported_value(value, depth + 1, changed)
                        };
                        (key.clone(), sanitized)
                    })
                    .collect(),
            )
        }
        Value::String(value) => {
            if value.len() <= 4_096 {
                Value::String(value.clone())
            } else {
                *changed = true;
                Value::String(value.chars().take(4_096).collect())
            }
        }
        primitive => primitive.clone(),
    }
}

fn sensitive_payload_key(key: &str) -> bool {
    let normalized = key.to_ascii_lowercase().replace(['-', '_'], "");
    [
        "accesstoken",
        "apikey",
        "authtoken",
        "authorization",
        "clientsecret",
        "cookie",
        "credential",
        "devicekey",
        "identitykey",
        "keymaterial",
        "leasekey",
        "pairingtoken",
        "password",
        "privatekey",
        "refreshtoken",
        "secret",
        "sessiontoken",
        "token",
    ]
    .iter()
    .any(|sensitive| normalized.contains(sensitive))
}

fn message_item(kind: &str, id: Id, value: &Value) -> Result<Item, V2Error> {
    match kind {
        "userMessage" => Ok(Item::UserMessage {
            id,
            client_id: optional_string(value, "clientId")?,
            content: user_message_content(value)?,
        }),
        "agentMessage" => Ok(Item::AssistantText {
            id,
            text: required_string(value, "text")?.to_owned(),
            phase: message_phase(value.get("phase"))?,
            memory_citation: memory_citation(value.get("memoryCitation"))?,
        }),
        "reasoning" => {
            let summary_parts = optional_string_parts(value, "summary")?;
            let content_parts = optional_string_parts(value, "content")?;
            Ok(Item::Reasoning {
                id,
                summary: summary_parts.join("\n"),
                summary_parts: Some(summary_parts),
                content_parts: Some(content_parts),
            })
        }
        _ => Err(invalid("message item type is invalid")),
    }
}

fn command_item(id: Id, value: &Value) -> Result<Item, V2Error> {
    Ok(Item::Command {
        id,
        command: required_string(value, "command")?.to_owned(),
        cwd: required_string(value, "cwd")?.to_owned(),
        status: execution_state(value.get("status"), true)?,
        exit_code: optional_i64(value, "exitCode")?,
        output_preview: optional_string(value, "aggregatedOutput")?
            .unwrap_or_default()
            .chars()
            .take(16_384)
            .collect(),
        duration_ms: optional_nonnegative_integer(value, "durationMs")?,
    })
}

fn file_change_item(id: Id, value: &Value) -> Result<Item, V2Error> {
    let source_changes = required_array(value, "changes")?;
    if source_changes.len() > 4_096 {
        return Err(invalid("file change entry limit exceeded"));
    }
    let changes = source_changes
        .iter()
        .map(file_change_entry)
        .collect::<Result<Vec<_>, _>>()?;
    let first = changes
        .first()
        .ok_or_else(|| invalid("file change item omitted changes"))?;
    Ok(Item::FileChange {
        id,
        path: first.path.clone(),
        change: first.change,
        status: file_change_state(value.get("status"))?,
        changes: Some(changes),
    })
}

fn tool_item(kind: &str, id: Id, value: &Value) -> Result<Item, V2Error> {
    let (name, server, arguments, result, app_context, plugin_id, read_only_hint, success) =
        match kind {
            "mcpToolCall" => (
                required_string(value, "tool")?,
                Some(required_string(value, "server")?.to_owned()),
                Some(required_value(value, "arguments")?),
                value.get("result"),
                optional_tool_app_context(value.get("appContext"))?,
                optional_string(value, "pluginId")?,
                optional_bool(value, "readOnlyHint")?,
                None,
            ),
            "dynamicToolCall" => (
                required_string(value, "tool")?,
                optional_string(value, "namespace")?,
                Some(required_value(value, "arguments")?),
                value.get("contentItems"),
                None,
                None,
                None,
                optional_bool(value, "success")?,
            ),
            "tool" => (
                required_string(value, "name")?,
                optional_string(value, "server")?,
                value.get("arguments"),
                value.get("result"),
                optional_tool_app_context(value.get("appContext"))?,
                optional_string(value, "pluginId")?,
                optional_bool(value, "readOnlyHint")?,
                optional_bool(value, "success")?,
            ),
            _ => return Err(invalid("tool item type is invalid")),
        };
    let error = optional_tool_error(value.get("error"))?;
    Ok(Item::Tool {
        id,
        name: name.to_owned(),
        status: execution_state(value.get("status"), false)?,
        summary: optional_string(value, "summary")?.unwrap_or_default(),
        server,
        arguments_json: bounded_optional_json(arguments, "tool arguments")?,
        result_json: bounded_optional_json(result, "tool result")?,
        app_context,
        plugin_id,
        read_only_hint,
        success,
        error,
        duration_ms: optional_nonnegative_integer(value, "durationMs")?,
    })
}

fn optional_tool_app_context(value: Option<&Value>) -> Result<Option<ToolAppContext>, V2Error> {
    let Some(value) = value else {
        return Ok(None);
    };
    if value.is_null() {
        return Ok(None);
    }
    Ok(Some(ToolAppContext {
        connector_id: required_string(value, "connectorId")?.to_owned(),
        link_id: optional_string(value, "linkId")?,
        resource_uri: optional_string(value, "resourceUri")?,
        app_name: optional_string(value, "appName")?,
        action_name: optional_string(value, "actionName")?,
    }))
}

fn optional_tool_error(value: Option<&Value>) -> Result<Option<ToolError>, V2Error> {
    let Some(value) = value else {
        return Ok(None);
    };
    if value.is_null() {
        return Ok(None);
    }
    let message = match value {
        Value::String(message) => message.clone(),
        Value::Object(_) => required_string(value, "message")?.to_owned(),
        _ => return Err(invalid("source item has invalid error")),
    };
    if message.len() > 4_194_304 {
        return Err(invalid("tool error message limit exceeded"));
    }
    Ok(Some(ToolError { message }))
}

fn plan_item(id: Id, value: &Value) -> Result<Item, V2Error> {
    let steps = match value.get("steps") {
        None => Vec::new(),
        Some(Value::Array(steps)) if steps.len() <= 256 => steps
            .iter()
            .map(|step| {
                Ok(PlanStep {
                    text: required_string(step, "text")?.to_owned(),
                    status: plan_step_state(step.get("status"))?,
                })
            })
            .collect::<Result<Vec<_>, V2Error>>()?,
        Some(Value::Array(_)) => return Err(invalid("plan step limit exceeded")),
        Some(_) => return Err(invalid("plan steps are invalid")),
    };
    Ok(Item::Plan {
        id,
        steps,
        text: Some(required_string(value, "text")?.to_owned()),
    })
}

fn hook_prompt_item(id: Id, value: &Value) -> Result<Item, V2Error> {
    let source_fragments = required_array(value, "fragments")?;
    if source_fragments.len() > 256 {
        return Err(invalid("hook prompt fragment limit exceeded"));
    }
    let fragments = source_fragments
        .iter()
        .map(|fragment| Ok(required_string(fragment, "text")?.to_owned()))
        .collect::<Result<Vec<_>, V2Error>>()?;
    Ok(Item::HookPrompt { id, fragments })
}

fn collaboration_item(id: Id, value: &Value) -> Result<Item, V2Error> {
    let receivers = required_array(value, "receiverThreadIds")?;
    if receivers.len() > 256 {
        return Err(invalid("collaboration receiver limit exceeded"));
    }
    let receiver_thread_ids = receivers
        .iter()
        .map(|candidate| {
            Id::new(
                candidate
                    .as_str()
                    .ok_or_else(|| invalid("collaboration receiver is invalid"))?
                    .to_owned(),
            )
            .map_err(|_| invalid("collaboration receiver is invalid"))
        })
        .collect::<Result<Vec<_>, _>>()?;
    Ok(Item::Collaboration {
        id,
        tool: required_string(value, "tool")?.to_owned(),
        status: execution_state(value.get("status"), false)?,
        sender_thread_id: Some(required_id(value, "senderThreadId")?),
        receiver_thread_ids,
        prompt: optional_string(value, "prompt")?,
        model: optional_string(value, "model")?,
        effort: optional_effort(value.get("reasoningEffort"))?,
        agents_states_json: Some(bounded_json(
            required_object(value, "agentsStates")?,
            "agent states",
        )?),
    })
}

fn subagent_activity_item(id: Id, value: &Value) -> Result<Item, V2Error> {
    let activity_kind = required_string(value, "kind")?;
    if !matches!(activity_kind, "started" | "interacted" | "interrupted") {
        return Err(invalid("subagent activity kind is invalid"));
    }
    Ok(Item::SubagentActivity {
        id,
        activity_kind: activity_kind.to_owned(),
        agent_thread_id: required_id(value, "agentThreadId")?,
        agent_path: required_string(value, "agentPath")?
            .split('/')
            .filter(|segment| !segment.is_empty())
            .take(64)
            .map(ToOwned::to_owned)
            .collect(),
    })
}

fn media_item(kind: &str, id: Id, value: &Value) -> Result<Item, V2Error> {
    match kind {
        "webSearch" => Ok(Item::WebSearch {
            id,
            query: required_string(value, "query")?.to_owned(),
            action_json: bounded_optional_json(value.get("action"), "web search action")?,
            results_json: bounded_optional_json(value.get("results"), "web search results")?,
        }),
        "imageView" => Ok(Item::ImageView {
            id,
            path: required_string(value, "path")?.to_owned(),
            source_url: private_file_source(required_string(value, "path")?),
        }),
        "sleep" => Ok(Item::Sleep {
            id,
            duration_ms: required_nonnegative_integer(value, "durationMs")?,
        }),
        "imageGeneration" => image_generation_item(id, value),
        _ => Err(invalid("media item type is invalid")),
    }
}

fn image_generation_item(id: Id, value: &Value) -> Result<Item, V2Error> {
    let result = required_string(value, "result")?;
    if result.len() > 16_777_216 {
        return Err(invalid("image generation result limit exceeded"));
    }
    let saved_path = optional_string(value, "savedPath")?;
    let source_url = saved_path.as_deref().map(private_file_source);
    Ok(Item::ImageGeneration {
        id,
        prompt: optional_string(value, "revisedPrompt")?.unwrap_or_default(),
        result: result.to_owned(),
        saved_path,
        source_url,
        status: execution_state(value.get("status"), false)?,
    })
}

fn private_file_source(path: &str) -> String {
    format!(
        "/v2/files/preview?path={}",
        utf8_percent_encode(path, NON_ALPHANUMERIC)
    )
}

fn review_mode_item(kind: &str, id: Id, value: &Value) -> Result<Item, V2Error> {
    Ok(Item::ReviewMode {
        id,
        state: if kind == "enteredReviewMode" {
            ReviewModeState::Entered
        } else {
            ReviewModeState::Exited
        },
        review: Some(required_string(value, "review")?.to_owned()),
    })
}

fn user_message_content(value: &Value) -> Result<Vec<UserMessageBlock>, V2Error> {
    let source = required_array(value, "content")?;
    if source.len() > 4_096 {
        return Err(invalid("user input block limit exceeded"));
    }
    source.iter().map(user_message_block).collect()
}

fn user_message_block(block: &Value) -> Result<UserMessageBlock, V2Error> {
    match block.get("type").and_then(Value::as_str) {
        Some("text") => text_block(block),
        Some("image") => Ok(UserMessageBlock::Image {
            url: bounded_user_input_string(block, "url")?,
            detail: image_detail(block.get("detail"))?,
        }),
        Some("localImage") => Ok(UserMessageBlock::LocalImage {
            path: bounded_user_input_string(block, "path")?,
            detail: image_detail(block.get("detail"))?,
        }),
        Some("audio") => Ok(UserMessageBlock::Audio {
            url: bounded_user_input_string(block, "url")?,
        }),
        Some("localAudio") => Ok(UserMessageBlock::LocalAudio {
            path: bounded_user_input_string(block, "path")?,
        }),
        Some("skill") => Ok(UserMessageBlock::Skill {
            name: bounded_user_input_name(block)?,
            path: bounded_user_input_string(block, "path")?,
        }),
        Some("mention") => Ok(UserMessageBlock::Mention {
            name: bounded_user_input_name(block)?,
            path: bounded_user_input_string(block, "path")?,
        }),
        _ => Err(invalid("user input block type is invalid")),
    }
}

fn text_block(block: &Value) -> Result<UserMessageBlock, V2Error> {
    let text = required_string(block, "text")?;
    if text.len() > 4_194_304 {
        return Err(invalid("user input text limit exceeded"));
    }
    let source_elements = match block.get("text_elements") {
        None => &[][..],
        Some(Value::Array(elements)) if elements.len() <= 4_096 => elements.as_slice(),
        Some(Value::Array(_)) => return Err(invalid("user text element limit exceeded")),
        Some(_) => return Err(invalid("user text elements are invalid")),
    };
    let text_elements = source_elements
        .iter()
        .map(|element| user_text_element(element, text.len()))
        .collect::<Result<Vec<_>, _>>()?;
    Ok(UserMessageBlock::Text {
        text: text.to_owned(),
        text_elements,
    })
}

fn user_text_element(value: &Value, text_bytes: usize) -> Result<UserTextElement, V2Error> {
    let range = required_object(value, "byteRange")?;
    let start = required_nonnegative_integer(range, "start")?;
    let end = required_nonnegative_integer(range, "end")?;
    if start > end || usize::try_from(end).map_or(true, |end| end > text_bytes) {
        return Err(invalid("user text element range is invalid"));
    }
    Ok(UserTextElement {
        byte_range: UserTextByteRange { start, end },
        placeholder: optional_string(value, "placeholder")?,
    })
}

fn image_detail(value: Option<&Value>) -> Result<Option<ImageDetail>, V2Error> {
    match value {
        None | Some(Value::Null) => Ok(None),
        Some(Value::String(value)) if value == "auto" => Ok(Some(ImageDetail::Auto)),
        Some(Value::String(value)) if value == "low" => Ok(Some(ImageDetail::Low)),
        Some(Value::String(value)) if value == "high" => Ok(Some(ImageDetail::High)),
        Some(Value::String(value)) if value == "original" => Ok(Some(ImageDetail::Original)),
        Some(_) => Err(invalid("user image detail is invalid")),
    }
}

fn bounded_user_input_name(value: &Value) -> Result<String, V2Error> {
    let name = required_string(value, "name")?;
    if name.is_empty() || name.len() > 1_024 {
        return Err(invalid("user input name is invalid"));
    }
    Ok(name.to_owned())
}

fn bounded_user_input_string(value: &Value, field: &str) -> Result<String, V2Error> {
    let content = required_string(value, field)?;
    if content.is_empty() || content.len() > 4_194_304 {
        return Err(invalid(format!("user input {field} is invalid")));
    }
    Ok(content.to_owned())
}

fn message_phase(value: Option<&Value>) -> Result<Option<MessagePhase>, V2Error> {
    match value {
        None | Some(Value::Null) => Ok(None),
        Some(Value::String(value)) if value == "commentary" => Ok(Some(MessagePhase::Commentary)),
        Some(Value::String(value)) if value == "final_answer" => Ok(Some(MessagePhase::Final)),
        Some(_) => Err(invalid("message phase is invalid")),
    }
}

fn memory_citation(value: Option<&Value>) -> Result<Option<MemoryCitation>, V2Error> {
    let Some(value) = value else {
        return Ok(None);
    };
    if value.is_null() {
        return Ok(None);
    }
    let source_entries = required_array(value, "entries")?;
    let source_thread_ids = required_array(value, "threadIds")?;
    if source_entries.len() > 4_096 || source_thread_ids.len() > 4_096 {
        return Err(invalid("memory citation limit exceeded"));
    }
    let entries = source_entries
        .iter()
        .map(|entry| {
            let line_start = required_nonnegative_integer(entry, "lineStart")?;
            let line_end = required_nonnegative_integer(entry, "lineEnd")?;
            if line_end < line_start {
                return Err(invalid("memory citation line range is invalid"));
            }
            Ok(MemoryCitationEntry {
                path: bounded_memory_citation_string(entry, "path")?,
                line_start,
                line_end,
                note: bounded_memory_citation_string(entry, "note")?,
            })
        })
        .collect::<Result<Vec<_>, V2Error>>()?;
    let thread_ids = source_thread_ids
        .iter()
        .map(|thread_id| {
            Id::new(
                thread_id
                    .as_str()
                    .ok_or_else(|| invalid("memory citation thread id is invalid"))?
                    .to_owned(),
            )
            .map_err(|_| invalid("memory citation thread id is invalid"))
        })
        .collect::<Result<Vec<_>, V2Error>>()?;
    Ok(Some(MemoryCitation {
        entries,
        thread_ids,
    }))
}

fn bounded_memory_citation_string(value: &Value, field: &str) -> Result<String, V2Error> {
    let content = required_string(value, field)?;
    if content.len() > 4_194_304 {
        return Err(invalid(format!("memory citation {field} limit exceeded")));
    }
    Ok(content.to_owned())
}

fn execution_state(
    value: Option<&Value>,
    accepts_declined: bool,
) -> Result<ExecutionState, V2Error> {
    match value.and_then(Value::as_str) {
        Some("inProgress" | "running") => Ok(ExecutionState::Running),
        Some("completed") => Ok(ExecutionState::Completed),
        Some("failed") => Ok(ExecutionState::Failed),
        Some("declined") if accepts_declined => Ok(ExecutionState::Failed),
        _ => Err(invalid("execution status is invalid")),
    }
}

fn file_change_state(value: Option<&Value>) -> Result<FileChangeState, V2Error> {
    match value.and_then(Value::as_str) {
        Some("inProgress") => Ok(FileChangeState::Pending),
        Some("completed") => Ok(FileChangeState::Applied),
        Some("failed" | "declined") => Ok(FileChangeState::Rejected),
        _ => Err(invalid("file change status is invalid")),
    }
}

fn plan_step_state(value: Option<&Value>) -> Result<PlanStepState, V2Error> {
    match value.and_then(Value::as_str) {
        Some("pending") => Ok(PlanStepState::Pending),
        Some("running" | "inProgress") => Ok(PlanStepState::Running),
        Some("completed") => Ok(PlanStepState::Completed),
        _ => Err(invalid("plan step status is invalid")),
    }
}

fn string_parts(parts: &[Value], field: &str) -> Result<Vec<String>, V2Error> {
    if parts.len() > 256 {
        return Err(invalid(format!("{field} part limit exceeded")));
    }
    parts
        .iter()
        .map(|part| {
            part.as_str()
                .map(ToOwned::to_owned)
                .ok_or_else(|| invalid(format!("{field} part is invalid")))
        })
        .collect()
}

fn optional_string_parts(value: &Value, field: &str) -> Result<Vec<String>, V2Error> {
    match value.get(field) {
        None => Ok(Vec::new()),
        Some(Value::Array(parts)) => string_parts(parts, field),
        Some(_) => Err(invalid(format!("{field} parts are invalid"))),
    }
}

fn file_change_entry(value: &Value) -> Result<FileChangeEntry, V2Error> {
    let kind = value
        .pointer("/kind/type")
        .or_else(|| value.get("kind"))
        .or_else(|| value.get("change"))
        .and_then(Value::as_str);
    Ok(FileChangeEntry {
        path: required_string(value, "path")?.to_owned(),
        change: match kind {
            Some("add" | "added") => FileChangeKind::Add,
            Some("delete" | "deleted") => FileChangeKind::Delete,
            Some("update" | "updated") => FileChangeKind::Update,
            _ => return Err(invalid("file change kind is invalid")),
        },
        diff: Some(match required_string(value, "diff")? {
            diff if diff.len() <= 4_194_304 => diff.to_owned(),
            _ => return Err(invalid("file change diff limit exceeded")),
        }),
    })
}

fn optional_effort(value: Option<&Value>) -> Result<Option<Effort>, V2Error> {
    match value {
        None | Some(Value::Null) => Ok(None),
        Some(value) => parse_effort(value).map(Some),
    }
}

fn parse_effort(value: &Value) -> Result<Effort, V2Error> {
    match value.as_str() {
        Some("none") => Ok(Effort::None),
        Some("minimal") => Ok(Effort::Minimal),
        Some("low") => Ok(Effort::Low),
        Some("medium") => Ok(Effort::Medium),
        Some("high") => Ok(Effort::High),
        Some("xhigh") => Ok(Effort::Xhigh),
        Some("max") => Ok(Effort::Max),
        Some("ultra") => Ok(Effort::Ultra),
        _ => Err(invalid("reasoning effort is invalid")),
    }
}

fn bounded_optional_json(value: Option<&Value>, field: &str) -> Result<Option<String>, V2Error> {
    match value {
        None | Some(Value::Null) => Ok(None),
        Some(value) => bounded_json(value, field).map(Some),
    }
}

fn bounded_json(value: &Value, field: &str) -> Result<String, V2Error> {
    let encoded = value.to_string();
    if encoded.len() > 4_194_304 {
        return Err(invalid(format!("{field} limit exceeded")));
    }
    Ok(encoded)
}

fn required_value<'a>(value: &'a Value, field: &str) -> Result<&'a Value, V2Error> {
    value
        .get(field)
        .ok_or_else(|| invalid(format!("source item omitted {field}")))
}

fn required_object<'a>(value: &'a Value, field: &str) -> Result<&'a Value, V2Error> {
    value
        .get(field)
        .filter(|candidate| candidate.is_object())
        .ok_or_else(|| invalid(format!("source item omitted or invalid {field}")))
}

fn required_array<'a>(value: &'a Value, field: &str) -> Result<&'a [Value], V2Error> {
    value
        .get(field)
        .and_then(Value::as_array)
        .map(Vec::as_slice)
        .ok_or_else(|| invalid(format!("source item omitted or invalid {field}")))
}

fn required_string<'a>(value: &'a Value, field: &str) -> Result<&'a str, V2Error> {
    value
        .get(field)
        .and_then(Value::as_str)
        .ok_or_else(|| invalid(format!("source item omitted or invalid {field}")))
}

fn optional_string(value: &Value, field: &str) -> Result<Option<String>, V2Error> {
    match value.get(field) {
        None | Some(Value::Null) => Ok(None),
        Some(Value::String(value)) => Ok(Some(value.clone())),
        Some(_) => Err(invalid(format!("source item has invalid {field}"))),
    }
}

fn optional_bool(value: &Value, field: &str) -> Result<Option<bool>, V2Error> {
    match value.get(field) {
        None | Some(Value::Null) => Ok(None),
        Some(Value::Bool(value)) => Ok(Some(*value)),
        Some(_) => Err(invalid(format!("source item has invalid {field}"))),
    }
}

fn required_id(value: &Value, field: &str) -> Result<Id, V2Error> {
    Id::new(required_string(value, field)?.to_owned())
        .map_err(|_| invalid(format!("source item has invalid {field}")))
}

fn optional_i64(value: &Value, field: &str) -> Result<Option<i64>, V2Error> {
    match value.get(field) {
        None | Some(Value::Null) => Ok(None),
        Some(value) => value
            .as_i64()
            .map(Some)
            .ok_or_else(|| invalid(format!("source item has invalid {field}"))),
    }
}

fn required_nonnegative_integer(value: &Value, field: &str) -> Result<i64, V2Error> {
    nonnegative_safe_integer(value.get(field))
        .ok_or_else(|| invalid(format!("source item omitted or invalid {field}")))
}

fn optional_nonnegative_integer(value: &Value, field: &str) -> Result<Option<i64>, V2Error> {
    match value.get(field) {
        None | Some(Value::Null) => Ok(None),
        Some(_) => required_nonnegative_integer(value, field).map(Some),
    }
}

fn invalid(message: impl Into<String>) -> V2Error {
    V2Error::source_unavailable(message.into())
}
