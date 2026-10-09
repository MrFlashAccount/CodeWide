//! Neutral thread, turn and item → client wire (Codex App Server v0.155.1
//! shapes). Pure functions; the only place these shapes are produced for a
//! non-native provider.

use serde_json::{Value, json};

use super::WireProvider;
use crate::agent::model::{
    AgentItem, AgentThread, AgentTurn, CallStatus, ClientMessageId, ExecutionStatus, FileChange,
    FileChangeKind, ItemsView, MessagePhase, ThreadStatus, TurnStatus, UserContent,
    WebSearchAction,
};

/// Marker namespace of a capability item projected as a generic tool call.
const CAPABILITY_ITEM_NAMESPACE: &str = "codewide.capability";

/// Projects one neutral thread. `turns` are already projected wire turns.
#[must_use]
pub fn thread(thread: &AgentThread, provider: &WireProvider, turns: &[Value]) -> Value {
    let mut projected = json!({
        "id": thread.app_thread_id.as_str(),
        "environments": null,
        "extra": null,
        "sessionId": thread.app_thread_id.as_str(),
        "forkedFromId": null,
        "parentThreadId": null,
        "preview": thread.preview,
        "ephemeral": false,
        "section": null,
        "sectionEnteredAt": null,
        "projectId": null,
        "historyMode": "paginated",
        "modelProvider": provider.descriptor.model_provider,
        "model": thread.settings.model,
        "reasoningEffort": thread.settings.effort,
        "createdAt": thread.created_at,
        "updatedAt": thread.updated_at,
        "recencyAt": thread.recency_at,
        "status": thread_status(thread.status),
        "path": null,
        "cwd": thread.cwd,
        "cliVersion": provider.descriptor.version,
        "originator": null,
        "source": "appServer",
        "canAcceptDirectInput": (thread.status != ThreadStatus::NotLoaded).then_some(true),
        "threadSource": null,
        "agentNickname": null,
        "agentRole": null,
        "gitInfo": null,
        "name": thread.name,
        "daybreakEnabled": null,
        "turns": turns,
    });
    provider.attach_extension(&mut projected);
    projected
}

/// Projects a thread lifecycle status.
#[must_use]
pub fn thread_status(status: ThreadStatus) -> Value {
    match status {
        ThreadStatus::Idle => json!({"type": "idle"}),
        ThreadStatus::Active => json!({"type": "active", "activeFlags": []}),
        ThreadStatus::NotLoaded => json!({"type": "notLoaded"}),
        ThreadStatus::Failed => json!({"type": "systemError"}),
    }
}

const fn turn_status(status: TurnStatus) -> &'static str {
    match status {
        TurnStatus::InProgress => "inProgress",
        TurnStatus::Completed => "completed",
        TurnStatus::Interrupted => "interrupted",
        TurnStatus::Failed => "failed",
    }
}

const fn items_view(view: ItemsView) -> &'static str {
    match view {
        ItemsView::NotLoaded => "notLoaded",
        ItemsView::Summary => "summary",
        ItemsView::Full => "full",
    }
}

/// Projects one turn with the requested items view. `summary` keeps the
/// user messages and the final answer, which is what delivery reconciliation
/// and the thread preview read.
#[must_use]
pub fn turn(turn: &AgentTurn, view: ItemsView) -> Value {
    let items = match view {
        ItemsView::NotLoaded => Vec::new(),
        ItemsView::Summary => turn
            .items
            .iter()
            .filter(|item| {
                matches!(
                    item,
                    AgentItem::UserMessage { .. }
                        | AgentItem::AgentMessage {
                            phase: MessagePhase::Final,
                            ..
                        }
                )
            })
            .map(item)
            .collect(),
        ItemsView::Full => turn.items.iter().map(item).collect(),
    };
    let duration_ms = turn.completed_at.map(|completed| {
        completed
            .saturating_sub(turn.started_at)
            .saturating_mul(1_000)
    });
    json!({
        "id": turn.turn_id.as_str(),
        "items": items,
        "itemsView": items_view(view),
        "status": turn_status(turn.status),
        "error": turn.error.as_ref().map(|error| json!({
            "message": error.message,
            "codexErrorInfo": null,
            "additionalDetails": null,
            "misalignment": null,
        })),
        "startedAt": turn.started_at,
        "completedAt": turn.completed_at,
        "durationMs": duration_ms,
    })
}

fn user_content(content: &UserContent) -> Value {
    match content {
        UserContent::Text { text } => json!({"type": "text", "text": text, "text_elements": []}),
        UserContent::Image { url } => json!({"type": "image", "url": url}),
        UserContent::LocalImage { path } => json!({"type": "localImage", "path": path}),
    }
}

const fn execution_status(status: ExecutionStatus) -> &'static str {
    match status {
        ExecutionStatus::InProgress => "inProgress",
        ExecutionStatus::Completed => "completed",
        ExecutionStatus::Failed => "failed",
        ExecutionStatus::Declined => "declined",
    }
}

const fn call_status(status: CallStatus) -> &'static str {
    match status {
        CallStatus::InProgress => "inProgress",
        CallStatus::Completed => "completed",
        CallStatus::Failed => "failed",
    }
}

/// Projects file changes into `FileUpdateChange` entries.
#[must_use]
pub fn file_changes(changes: &[FileChange]) -> Value {
    Value::Array(
        changes
            .iter()
            .map(|change| {
                let kind = match change.kind {
                    FileChangeKind::Add => json!({"type": "add"}),
                    FileChangeKind::Delete => json!({"type": "delete"}),
                    FileChangeKind::Update => {
                        json!({"type": "update", "move_path": change.move_path})
                    }
                };
                json!({"path": change.path, "kind": kind, "diff": change.diff})
            })
            .collect(),
    )
}

/// Projects one neutral item.
// WHY: one exhaustive match is the projection table of the item union;
// splitting it would scatter the wire shapes across helpers.
#[allow(clippy::too_many_lines)]
#[must_use]
pub fn item(item: &AgentItem) -> Value {
    match item {
        AgentItem::UserMessage {
            item_id,
            client_message_id,
            content,
        } => json!({
            "type": "userMessage",
            "id": item_id.as_str(),
            "clientId": client_message_id.as_ref().map(ClientMessageId::as_str),
            "content": content.iter().map(user_content).collect::<Vec<_>>(),
        }),
        AgentItem::AgentMessage {
            item_id,
            text,
            phase,
        } => json!({
            "type": "agentMessage",
            "id": item_id.as_str(),
            "text": text,
            "phase": match phase {
                MessagePhase::Commentary => "commentary",
                MessagePhase::Final => "final_answer",
            },
            "memoryCitation": null,
            "delivery": null,
            "questions": null,
        }),
        AgentItem::Reasoning {
            item_id,
            summary,
            content,
        } => json!({
            "type": "reasoning",
            "id": item_id.as_str(),
            "summary": summary,
            "content": content,
        }),
        AgentItem::Command {
            item_id,
            command,
            cwd,
            status,
            output,
            exit_code,
            duration_ms,
        } => json!({
            "type": "commandExecution",
            "id": item_id.as_str(),
            "pluginId": null,
            "scriptPath": null,
            "command": command,
            "cwd": cwd,
            "processId": null,
            "source": "agent",
            "status": execution_status(*status),
            "commandActions": [{"type": "unknown", "command": command}],
            "aggregatedOutput": output,
            "exitCode": exit_code,
            "durationMs": duration_ms,
        }),
        AgentItem::FileChange {
            item_id,
            changes,
            status,
        } => json!({
            "type": "fileChange",
            "id": item_id.as_str(),
            "changes": file_changes(changes),
            "status": execution_status(*status),
        }),
        AgentItem::McpToolCall {
            item_id,
            server,
            tool,
            arguments,
            status,
            result,
            error,
            duration_ms,
        } => json!({
            "type": "mcpToolCall",
            "id": item_id.as_str(),
            "server": server,
            "tool": tool,
            "status": call_status(*status),
            "arguments": arguments,
            "appContext": null,
            "pluginId": null,
            "readOnlyHint": null,
            "result": result.as_ref().map(|result| json!({
                "content": result.content,
                "structuredContent": result.structured_content,
                "_meta": null,
            })),
            "error": error.as_ref().map(|message| json!({"message": message})),
            "durationMs": duration_ms,
        }),
        AgentItem::ToolCall {
            item_id,
            namespace,
            tool,
            arguments,
            output,
            status,
            duration_ms,
        } => json!({
            "type": "dynamicToolCall",
            "id": item_id.as_str(),
            "namespace": namespace,
            "tool": tool,
            "arguments": arguments,
            "status": call_status(*status),
            "contentItems": output.as_ref().map(|text| json!([{"type": "inputText", "text": text}])),
            "success": match status {
                CallStatus::InProgress => None,
                CallStatus::Completed => Some(true),
                CallStatus::Failed => Some(false),
            },
            "durationMs": duration_ms,
        }),
        AgentItem::WebSearch {
            item_id,
            query,
            action,
        } => json!({
            "type": "webSearch",
            "id": item_id.as_str(),
            "query": query,
            "action": action.as_ref().map(|action| match action {
                WebSearchAction::Search { query } => {
                    json!({"type": "search", "query": query, "queries": null})
                }
                WebSearchAction::OpenPage { url } => json!({"type": "openPage", "url": url}),
            }),
        }),
        AgentItem::ImageView { item_id, path } => {
            json!({"type": "imageView", "id": item_id.as_str(), "path": path})
        }
        AgentItem::Plan { item_id, text } => {
            json!({"type": "plan", "id": item_id.as_str(), "text": text})
        }
        AgentItem::Compaction { item_id } => {
            json!({"type": "contextCompaction", "id": item_id.as_str()})
        }
        AgentItem::CapabilityItem {
            item_id,
            capability,
            kind,
            payload,
        } => json!({
            "type": "dynamicToolCall",
            "id": item_id.as_str(),
            "namespace": format!("{CAPABILITY_ITEM_NAMESPACE}.{capability}"),
            "tool": kind,
            "arguments": payload,
            "status": "completed",
            "contentItems": null,
            "success": true,
            "durationMs": null,
        }),
    }
}
