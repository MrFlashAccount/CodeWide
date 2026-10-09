//! Codex App Server wire values → neutral model, and neutral params → Codex
//! request params. Pure functions owned by the Codex adapter.
//!
//! The mapping is deliberately lossy towards neutral: fields without a
//! neutral meaning stay on the `codex.native` pass-through path, which is the
//! one the client wire uses for Codex threads.

use serde_json::{Map, Value, json};

use agent_core::model::{
    AgentItem, AgentThread, AgentTurn, AppThreadId, CallStatus, ClientMessageId, ExecutionStatus,
    FileChange, FileChangeKind, InputModality, ItemId, ItemsView, McpToolResult, MessagePhase,
    ModelEffort, ModelEntry, PermissionProfileEntry, ProviderId, SortDirection, ThreadChange,
    ThreadListParams, ThreadOrigin, ThreadSettings, ThreadSortKey, ThreadStatus, TurnError,
    TurnErrorKind, TurnId, TurnOrigin, TurnStatus, UserContent, WebSearchAction,
};

/// Every Codex source kind: the neutral list covers all origins.
const ALL_SOURCE_KINDS: [&str; 10] = [
    "cli",
    "vscode",
    "exec",
    "appServer",
    "subAgent",
    "subAgentReview",
    "subAgentCompact",
    "subAgentThreadSpawn",
    "subAgentOther",
    "unknown",
];

fn str_field<'a>(value: &'a Value, field: &str) -> Option<&'a str> {
    value.get(field).and_then(Value::as_str)
}

fn opt_string(value: &Value, field: &str) -> Option<String> {
    str_field(value, field).map(str::to_owned)
}

fn int_field(value: &Value, field: &str) -> Option<i64> {
    value.get(field).and_then(Value::as_i64)
}

/// Maps a Codex `Thread`; `None` when required identity is missing.
#[must_use]
pub fn thread(provider: &ProviderId, thread: &Value, archived: bool) -> Option<AgentThread> {
    let id = AppThreadId::parse(str_field(thread, "id")?)?;
    let status = match thread.pointer("/status/type").and_then(Value::as_str) {
        Some("active") => ThreadStatus::Active,
        Some("idle") => ThreadStatus::Idle,
        Some("systemError") => ThreadStatus::Failed,
        _ => ThreadStatus::NotLoaded,
    };
    let origin = match thread.get("source") {
        Some(Value::String(source)) if source == "appServer" => ThreadOrigin::Interactive,
        _ => ThreadOrigin::External,
    };
    Some(AgentThread {
        app_thread_id: id,
        provider: provider.clone(),
        cwd: opt_string(thread, "cwd").unwrap_or_default(),
        name: opt_string(thread, "name"),
        preview: opt_string(thread, "preview").unwrap_or_default(),
        created_at: int_field(thread, "createdAt").unwrap_or(0),
        updated_at: int_field(thread, "updatedAt").unwrap_or(0),
        recency_at: int_field(thread, "recencyAt"),
        archived,
        origin,
        status,
        settings: ThreadSettings {
            model: opt_string(thread, "model").unwrap_or_default(),
            effort: opt_string(thread, "reasoningEffort"),
            permission_profile: thread
                .pointer("/activePermissionProfile/id")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_owned(),
            service_tier: None,
        },
    })
}

/// Maps a Codex `Turn`.
#[must_use]
pub fn turn(turn: &Value) -> Option<AgentTurn> {
    let turn_id = TurnId::parse(str_field(turn, "id")?)?;
    let status = match str_field(turn, "status") {
        Some("completed") => TurnStatus::Completed,
        Some("interrupted") => TurnStatus::Interrupted,
        Some("failed") => TurnStatus::Failed,
        _ => TurnStatus::InProgress,
    };
    let items = turn
        .get("items")
        .and_then(Value::as_array)
        .map(|items| items.iter().filter_map(item).collect::<Vec<_>>())
        .unwrap_or_default();
    let origin = if items
        .iter()
        .any(|item| matches!(item, AgentItem::UserMessage { .. }))
    {
        TurnOrigin::User
    } else {
        TurnOrigin::Provider
    };
    Some(AgentTurn {
        provenance: None,
        turn_id,
        status,
        origin,
        started_at: int_field(turn, "startedAt").unwrap_or(0),
        completed_at: int_field(turn, "completedAt"),
        error: turn.get("error").and_then(|error| {
            str_field(error, "message").map(|message| TurnError {
                kind: TurnErrorKind::Provider,
                message: message.to_owned(),
            })
        }),
        items,
    })
}

fn execution_status(value: Option<&str>) -> ExecutionStatus {
    match value {
        Some("completed") => ExecutionStatus::Completed,
        Some("failed") => ExecutionStatus::Failed,
        Some("declined") => ExecutionStatus::Declined,
        _ => ExecutionStatus::InProgress,
    }
}

fn call_status(value: Option<&str>) -> CallStatus {
    match value {
        Some("completed") => CallStatus::Completed,
        Some("failed") => CallStatus::Failed,
        _ => CallStatus::InProgress,
    }
}

fn user_content(value: &Value) -> Option<UserContent> {
    match str_field(value, "type")? {
        "text" => Some(UserContent::Text {
            text: opt_string(value, "text")?,
        }),
        "image" => Some(UserContent::Image {
            url: opt_string(value, "url")?,
        }),
        "localImage" => Some(UserContent::LocalImage {
            path: opt_string(value, "path")?,
        }),
        _ => None,
    }
}

/// Maps a Codex `ThreadItem`. Kinds without a neutral counterpart become a
/// `capabilityItem` under `codex.native` carrying the original item.
// WHY: one exhaustive match over the Codex item kinds is the mapping table.
#[allow(clippy::too_many_lines)]
#[must_use]
pub fn item(item: &Value) -> Option<AgentItem> {
    let item_id = ItemId::parse(str_field(item, "id")?)?;
    let kind = str_field(item, "type")?;
    Some(match kind {
        "userMessage" => AgentItem::UserMessage {
            provenance: None,
            item_id,
            client_message_id: str_field(item, "clientId").and_then(ClientMessageId::parse),
            content: item
                .get("content")
                .and_then(Value::as_array)
                .map(|content| content.iter().filter_map(user_content).collect())
                .unwrap_or_default(),
        },
        "agentMessage" => AgentItem::AgentMessage {
            provenance: None,
            item_id,
            text: opt_string(item, "text").unwrap_or_default(),
            phase: if str_field(item, "phase") == Some("final_answer") {
                MessagePhase::Final
            } else {
                MessagePhase::Commentary
            },
        },
        "reasoning" => AgentItem::Reasoning {
            provenance: None,
            item_id,
            summary: string_list(item.get("summary")),
            content: string_list(item.get("content")),
        },
        "commandExecution" => AgentItem::Command {
            provenance: None,
            item_id,
            command: opt_string(item, "command").unwrap_or_default(),
            cwd: opt_string(item, "cwd").unwrap_or_default(),
            status: execution_status(str_field(item, "status")),
            output: opt_string(item, "aggregatedOutput"),
            exit_code: int_field(item, "exitCode"),
            duration_ms: int_field(item, "durationMs"),
        },
        "fileChange" => AgentItem::FileChange {
            provenance: None,
            item_id,
            changes: item
                .get("changes")
                .and_then(Value::as_array)
                .map(|changes| changes.iter().filter_map(file_change).collect())
                .unwrap_or_default(),
            status: execution_status(str_field(item, "status")),
        },
        "mcpToolCall" => AgentItem::McpToolCall {
            provenance: None,
            item_id,
            server: opt_string(item, "server").unwrap_or_default(),
            tool: opt_string(item, "tool").unwrap_or_default(),
            arguments: item.get("arguments").cloned().unwrap_or(Value::Null),
            status: call_status(str_field(item, "status")),
            result: item
                .get("result")
                .filter(|value| !value.is_null())
                .map(|result| McpToolResult {
                    content: result
                        .get("content")
                        .and_then(Value::as_array)
                        .cloned()
                        .unwrap_or_default(),
                    structured_content: result
                        .get("structuredContent")
                        .cloned()
                        .unwrap_or(Value::Null),
                }),
            error: item
                .pointer("/error/message")
                .and_then(Value::as_str)
                .map(str::to_owned),
            duration_ms: int_field(item, "durationMs"),
        },
        "dynamicToolCall" => AgentItem::ToolCall {
            provenance: None,
            item_id,
            namespace: opt_string(item, "namespace"),
            tool: opt_string(item, "tool").unwrap_or_default(),
            arguments: item.get("arguments").cloned().unwrap_or(Value::Null),
            output: item
                .get("contentItems")
                .and_then(Value::as_array)
                .map(|items| {
                    items
                        .iter()
                        .filter_map(|entry| str_field(entry, "text"))
                        .collect::<Vec<_>>()
                        .join("\n")
                }),
            status: call_status(str_field(item, "status")),
            duration_ms: int_field(item, "durationMs"),
        },
        "webSearch" => AgentItem::WebSearch {
            provenance: None,
            item_id,
            query: opt_string(item, "query").unwrap_or_default(),
            action: item
                .get("action")
                .and_then(|action| match str_field(action, "type") {
                    Some("search") => Some(WebSearchAction::Search {
                        query: opt_string(action, "query").unwrap_or_default(),
                    }),
                    Some("openPage") => Some(WebSearchAction::OpenPage {
                        url: opt_string(action, "url").unwrap_or_default(),
                    }),
                    _ => None,
                }),
        },
        "imageView" => AgentItem::ImageView {
            provenance: None,
            item_id,
            path: opt_string(item, "path").unwrap_or_default(),
        },
        "plan" => AgentItem::Plan {
            provenance: None,
            item_id,
            text: opt_string(item, "text").unwrap_or_default(),
        },
        "contextCompaction" => AgentItem::Compaction {
            item_id,
            provenance: None,
        },
        other => AgentItem::CapabilityItem {
            provenance: None,
            item_id,
            capability: "codex.native".into(),
            kind: other.to_owned(),
            payload: item.clone(),
        },
    })
}

fn string_list(value: Option<&Value>) -> Vec<String> {
    value
        .and_then(Value::as_array)
        .map(|values| {
            values
                .iter()
                .filter_map(Value::as_str)
                .map(str::to_owned)
                .collect()
        })
        .unwrap_or_default()
}

fn file_change(change: &Value) -> Option<FileChange> {
    let kind = match change.pointer("/kind/type").and_then(Value::as_str)? {
        "add" => FileChangeKind::Add,
        "delete" => FileChangeKind::Delete,
        _ => FileChangeKind::Update,
    };
    Some(FileChange {
        path: opt_string(change, "path")?,
        kind,
        move_path: change
            .pointer("/kind/move_path")
            .and_then(Value::as_str)
            .map(str::to_owned),
        diff: opt_string(change, "diff").unwrap_or_default(),
    })
}

/// Maps a Codex `Model` row.
#[must_use]
pub fn model(row: &Value) -> Option<ModelEntry> {
    Some(ModelEntry {
        id: opt_string(row, "id")?,
        model: opt_string(row, "model")?,
        display_name: opt_string(row, "displayName").unwrap_or_default(),
        description: opt_string(row, "description").unwrap_or_default(),
        is_default: row
            .get("isDefault")
            .and_then(Value::as_bool)
            .unwrap_or(false),
        hidden: row.get("hidden").and_then(Value::as_bool).unwrap_or(false),
        efforts: row
            .get("supportedReasoningEfforts")
            .and_then(Value::as_array)
            .map(|efforts| {
                efforts
                    .iter()
                    .filter_map(|effort| {
                        Some(ModelEffort {
                            effort: opt_string(effort, "reasoningEffort")?,
                            description: opt_string(effort, "description").unwrap_or_default(),
                        })
                    })
                    .collect()
            })
            .unwrap_or_default(),
        default_effort: opt_string(row, "defaultReasoningEffort"),
        input_modalities: row
            .get("inputModalities")
            .and_then(Value::as_array)
            .map(|modalities| {
                modalities
                    .iter()
                    .filter_map(|modality| match modality.as_str() {
                        Some("text") => Some(InputModality::Text),
                        Some("image") => Some(InputModality::Image),
                        _ => None,
                    })
                    .collect()
            })
            .unwrap_or_default(),
    })
}

/// Maps a Codex `PermissionProfileSummary` row.
#[must_use]
pub fn permission_profile(row: &Value) -> Option<PermissionProfileEntry> {
    let id = opt_string(row, "id")?;
    Some(PermissionProfileEntry {
        display_name: id.clone(),
        description: opt_string(row, "description").unwrap_or_default(),
        id,
    })
}

/// Neutral list params → Codex `thread/list` params: every origin, every
/// model provider, state DB only.
#[must_use]
pub fn thread_list_params(params: &ThreadListParams) -> Value {
    let mut object = Map::new();
    object.insert("archived".into(), json!(params.archived));
    object.insert("cursor".into(), json!(params.cursor));
    object.insert("limit".into(), json!(params.limit));
    object.insert(
        "sortKey".into(),
        json!(match params.sort_key {
            ThreadSortKey::CreatedAt => "created_at",
            ThreadSortKey::UpdatedAt => "updated_at",
            ThreadSortKey::RecencyAt => "recency_at",
        }),
    );
    object.insert(
        "sortDirection".into(),
        json!(match params.sort_direction {
            SortDirection::Asc => "asc",
            SortDirection::Desc => "desc",
        }),
    );
    object.insert("modelProviders".into(), json!([]));
    object.insert("sourceKinds".into(), json!(ALL_SOURCE_KINDS));
    object.insert("useStateDbOnly".into(), json!(true));
    if let Some(cwd) = &params.cwd {
        object.insert("cwd".into(), json!(cwd));
    }
    if let Some(search) = &params.search_term {
        object.insert("searchTerm".into(), json!(search));
    }
    Value::Object(object)
}

/// Neutral items view → Codex `itemsView`.
#[must_use]
pub const fn items_view(view: ItemsView) -> &'static str {
    match view {
        ItemsView::NotLoaded => "notLoaded",
        ItemsView::Summary => "summary",
        ItemsView::Full => "full",
    }
}

/// Neutral user content → Codex `UserInput`.
#[must_use]
pub fn user_input(content: &UserContent) -> Value {
    match content {
        UserContent::Text { text } => json!({"type": "text", "text": text, "text_elements": []}),
        UserContent::Image { url } => json!({"type": "image", "url": url}),
        UserContent::LocalImage { path } => json!({"type": "localImage", "path": path}),
    }
}

/// Neutral thread change → Codex method and params.
#[must_use]
pub fn thread_change(thread_id: &AppThreadId, change: &ThreadChange) -> (&'static str, Value) {
    let id = thread_id.as_str();
    match change {
        ThreadChange::Name { name } => (
            "thread/name/set",
            json!({"threadId": id, "name": name.clone().unwrap_or_default()}),
        ),
        ThreadChange::Archived { archived: true } => ("thread/archive", json!({"threadId": id})),
        ThreadChange::Archived { archived: false } => ("thread/unarchive", json!({"threadId": id})),
        ThreadChange::Deleted => ("thread/delete", json!({"threadId": id})),
        ThreadChange::Settings {
            model,
            effort,
            permission_profile,
            service_tier,
        } => {
            let mut params = Map::new();
            params.insert("threadId".into(), json!(id));
            if let Some(model) = model {
                params.insert("model".into(), json!(model));
            }
            if let Some(effort) = effort {
                params.insert("effort".into(), json!(effort));
            }
            if let Some(profile) = permission_profile {
                params.insert("permissions".into(), json!(profile));
            }
            if let Some(tier) = service_tier {
                params.insert("serviceTier".into(), json!(tier));
            }
            ("thread/settings/update", Value::Object(params))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn maps_codex_threads_turns_and_unknown_items() -> Result<(), &'static str> {
        let provider = ProviderId::parse("codex").ok_or("provider")?;
        let mapped = thread(
            &provider,
            &json!({
                "id": "019a-thread", "cwd": "/w", "name": null, "preview": "hi",
                "createdAt": 1, "updatedAt": 2, "recencyAt": null,
                "status": {"type": "active", "activeFlags": []},
                "source": "cli", "model": "gpt-5.5", "reasoningEffort": "high"
            }),
            false,
        )
        .ok_or("thread")?;
        assert_eq!(mapped.status, ThreadStatus::Active);
        assert_eq!(mapped.origin, ThreadOrigin::External);
        assert_eq!(mapped.settings.model, "gpt-5.5");

        let mapped_turn = turn(&json!({
            "id": "turn-1", "status": "completed", "startedAt": 5, "completedAt": 6, "error": null,
            "items": [
                {"type": "userMessage", "id": "u", "clientId": "android-1",
                 "content": [{"type": "text", "text": "hi", "text_elements": []}]},
                {"type": "agentMessage", "id": "a", "text": "done", "phase": "final_answer"},
                {"type": "enteredReviewMode", "id": "r", "review": "x"}
            ]
        }))
        .ok_or("turn")?;
        assert_eq!(mapped_turn.origin, TurnOrigin::User);
        assert_eq!(mapped_turn.items.len(), 3);
        assert!(matches!(
            &mapped_turn.items[2],
            AgentItem::CapabilityItem { capability, kind, .. }
                if capability == "codex.native" && kind == "enteredReviewMode"
        ));
        Ok(())
    }

    #[test]
    fn neutral_list_params_cover_every_origin_from_the_state_db() {
        let params = thread_list_params(&ThreadListParams {
            archived: true,
            cwd: None,
            search_term: None,
            sort_key: ThreadSortKey::CreatedAt,
            sort_direction: SortDirection::Desc,
            window: None,
            cursor: None,
            limit: 100,
        });
        assert_eq!(params["sourceKinds"].as_array().map(Vec::len), Some(10));
        assert_eq!(params["useStateDbOnly"], true);
        assert_eq!(params["modelProviders"], json!([]));
        assert_eq!(params["sortKey"], "created_at");
    }
}
