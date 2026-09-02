//! Narrow App Server/local-service to Sync V2 semantic normalization boundary.

#![allow(clippy::too_many_lines)]

use std::collections::HashMap;

use serde_json::Value;
use time::{OffsetDateTime, format_description::well_known::Rfc3339};

use super::{
    domain::{
        ApprovalPolicy, Attachment, Effort, ExecutionState, FileChangeKind, FileChangeState,
        InputBlock, Item, PlanStep, PlanStepState, Sandbox, ThreadSettings, ThreadState,
        ThreadSummary, TurnActivity, TurnState, TurnUsage, TurnView,
    },
    protocol::{
        AccountProfile, Model, Project, QueueItem, QueueState, ResourceChange, V2Error,
        WeeklyRateLimit, WorkspaceSupport,
    },
    scalar::{Id, Timestamp, U64},
};

pub fn rpc_result(response: &Value) -> Result<Value, V2Error> {
    if let Some(error) = response.get("error") {
        return Err(V2Error::source_unavailable(safe_source_error(error)));
    }
    response
        .get("result")
        .cloned()
        .ok_or_else(|| V2Error::source_unavailable("source response omitted result"))
}

pub fn thread_summary(value: &Value) -> Result<ThreadSummary, V2Error> {
    thread_summary_with_settings(value, value)
}

pub fn thread_summary_in_partition(
    value: &Value,
    archived: bool,
) -> Result<ThreadSummary, V2Error> {
    let mut summary = thread_summary(value)?;
    summary.archived = archived;
    Ok(summary)
}

pub fn thread_summary_from_response(value: &Value) -> Result<ThreadSummary, V2Error> {
    thread_summary_with_settings(value.get("thread").unwrap_or(value), value)
}

fn thread_summary_with_settings(
    value: &Value,
    settings_source: &Value,
) -> Result<ThreadSummary, V2Error> {
    let id = required_id(value, "id")?;
    let state = match value
        .pointer("/status/type")
        .and_then(Value::as_str)
        .or_else(|| value.get("status").and_then(Value::as_str))
    {
        Some("active" | "running" | "inProgress") => ThreadState::Running,
        Some("waitingForApproval") => ThreadState::WaitingForApproval,
        Some("waitingForInput") => ThreadState::WaitingForInput,
        Some("completed") => ThreadState::Completed,
        Some("failed") => ThreadState::Failed,
        Some("interrupted") => ThreadState::Interrupted,
        _ => ThreadState::Idle,
    };
    let created_at = timestamp(value.get("createdAt").or_else(|| value.get("created_at")))
        .unwrap_or_else(Timestamp::now);
    let updated_at = timestamp(
        value
            .get("updatedAt")
            .or_else(|| value.get("recencyAt"))
            .or_else(|| value.get("updated_at")),
    )
    .unwrap_or_else(|| created_at.clone());
    Ok(ThreadSummary {
        id,
        parent_id: optional_id(
            value
                .get("parentId")
                .or_else(|| value.get("parentThreadId")),
        )?,
        title: semantic_thread_title(value),
        preview: value
            .get("preview")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_owned(),
        workspace: value
            .get("workspace")
            .or_else(|| value.get("cwd"))
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_owned(),
        archived: value
            .get("archived")
            .and_then(Value::as_bool)
            .unwrap_or(false),
        state,
        settings: optional_thread_settings(settings_source)?,
        created_at,
        updated_at: updated_at.clone(),
        last_activity_at: Some(updated_at),
        head_turn_id: optional_id(value.get("headTurnId"))?,
    })
}

fn semantic_thread_title(value: &Value) -> Option<String> {
    value
        .get("name")
        .or_else(|| value.get("title"))
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|title| !title.is_empty() && !title.eq_ignore_ascii_case("Untitled thread"))
        .map(ToOwned::to_owned)
}

pub fn turn_view(thread_id: &Id, value: &Value) -> Result<TurnView, V2Error> {
    let state = match value.get("status").and_then(Value::as_str) {
        Some("queued") => TurnState::Queued,
        Some("inProgress" | "running") => TurnState::Running,
        Some("failed") => TurnState::Failed,
        Some("interrupted") => TurnState::Interrupted,
        _ => TurnState::Completed,
    };
    let source_items = value
        .get("items")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    if source_items.len() > 2_048 {
        return Err(V2Error::source_unavailable("turn item limit exceeded"));
    }
    let items = source_items.iter().filter_map(item).collect();
    Ok(TurnView {
        id: required_id(value, "id")?,
        thread_id: thread_id.clone(),
        state,
        created_at: timestamp(value.get("startedAt").or_else(|| value.get("createdAt")))
            .unwrap_or_else(Timestamp::now),
        completed_at: timestamp(value.get("completedAt")),
        duration_ms: nonnegative_safe_integer(value.get("durationMs")),
        activity: turn_activity(value),
        usage: turn_usage(value),
        items,
    })
}

fn turn_activity(value: &Value) -> Option<TurnActivity> {
    let activity = value.pointer("/codewide/activity")?;
    let count = nonnegative_safe_integer(activity.get("count"))?;
    let kinds = activity
        .get("kinds")?
        .as_array()?
        .iter()
        .filter_map(Value::as_str)
        .take(256)
        .map(ToOwned::to_owned)
        .collect();
    Some(TurnActivity { count, kinds })
}

fn turn_usage(value: &Value) -> Option<TurnUsage> {
    let tokens = value.pointer("/codewide/usage/turn/tokens")?;
    let thread_tokens = value.pointer("/codewide/usage/thread/tokens")?;
    let input_tokens = nonnegative_safe_integer(tokens.get("inputTokens"))?;
    let output_tokens = nonnegative_safe_integer(tokens.get("outputTokens"))?;
    let total_cost_usd = value
        .pointer("/codewide/usage/turn/cost/totalCostUsd")
        .and_then(Value::as_f64)
        .filter(|cost| cost.is_finite() && *cost >= 0.0);
    let thread_total_cost_usd = value
        .pointer("/codewide/usage/thread/cost/totalCostUsd")
        .and_then(Value::as_f64)
        .filter(|cost| cost.is_finite() && *cost >= 0.0);
    Some(TurnUsage {
        input_tokens,
        output_tokens,
        total_cost_usd,
        latest_request_tokens: nonnegative_safe_integer(
            value.pointer("/codewide/usage/latestRequest/totalTokens"),
        )?,
        model_context_window: value
            .pointer("/codewide/usage/modelContextWindow")
            .and_then(Value::as_i64)
            .filter(|number| (0..=9_007_199_254_740_991).contains(number)),
        thread_input_tokens: nonnegative_safe_integer(thread_tokens.get("inputTokens"))?,
        thread_output_tokens: nonnegative_safe_integer(thread_tokens.get("outputTokens"))?,
        thread_total_tokens: nonnegative_safe_integer(thread_tokens.get("totalTokens"))?,
        thread_total_cost_usd,
    })
}

fn nonnegative_safe_integer(value: Option<&Value>) -> Option<i64> {
    value
        .and_then(Value::as_i64)
        .filter(|number| (0..=9_007_199_254_740_991).contains(number))
}

pub fn item(value: &Value) -> Option<Item> {
    let kind = value.get("type")?.as_str()?;
    let id = Id::new(value.get("id")?.as_str()?.to_owned()).ok()?;
    match kind {
        "userMessage" => Some(Item::UserText {
            id,
            text: message_text(value),
        }),
        "agentMessage" => Some(Item::AssistantText {
            id,
            text: value
                .get("text")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_owned(),
        }),
        "reasoning" => Some(Item::Reasoning {
            id,
            summary: value
                .get("summary")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_owned(),
        }),
        "commandExecution" => Some(Item::Command {
            id,
            command: value
                .get("command")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_owned(),
            cwd: value
                .get("cwd")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_owned(),
            status: execution_state(value.get("status")),
            exit_code: value.get("exitCode").and_then(Value::as_i64),
            output_preview: value
                .get("aggregatedOutput")
                .or_else(|| value.get("output"))
                .and_then(Value::as_str)
                .unwrap_or_default()
                .chars()
                .take(16_384)
                .collect(),
        }),
        "fileChange" => Some(Item::FileChange {
            id,
            path: value
                .get("path")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_owned(),
            change: match value.get("change").and_then(Value::as_str) {
                Some("add") => FileChangeKind::Add,
                Some("delete") => FileChangeKind::Delete,
                _ => FileChangeKind::Update,
            },
            status: match value.get("status").and_then(Value::as_str) {
                Some("applied") => FileChangeState::Applied,
                Some("rejected") => FileChangeState::Rejected,
                _ => FileChangeState::Pending,
            },
        }),
        "mcpToolCall" | "tool" => Some(Item::Tool {
            id,
            name: value
                .get("name")
                .or_else(|| value.get("tool"))
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_owned(),
            status: execution_state(value.get("status")),
            summary: value
                .get("summary")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_owned(),
        }),
        "plan" => Some(Item::Plan {
            id,
            steps: value
                .get("steps")
                .and_then(Value::as_array)
                .map(|steps| {
                    steps
                        .iter()
                        .filter_map(|step| {
                            Some(PlanStep {
                                text: step.get("text")?.as_str()?.to_owned(),
                                status: match step.get("status").and_then(Value::as_str) {
                                    Some("running" | "inProgress") => PlanStepState::Running,
                                    Some("completed") => PlanStepState::Completed,
                                    _ => PlanStepState::Pending,
                                },
                            })
                        })
                        .collect()
                })
                .unwrap_or_default(),
        }),
        _ => None,
    }
}

pub fn input_blocks(
    input: &[InputBlock],
    resolved_attachments: &HashMap<Id, Value>,
) -> Result<Vec<Value>, V2Error> {
    input
        .iter()
        .map(|block| match block {
            InputBlock::Text { text } => {
                Ok(serde_json::json!({"type": "text", "text": text, "text_elements": []}))
            }
            InputBlock::Attachment { attachment_id } => resolved_attachments
                .get(attachment_id)
                .cloned()
                .ok_or_else(|| V2Error {
                    code: super::protocol::ErrorCode::NotFound,
                    recovery: super::protocol::Recovery::Requery,
                    message: "attachment identity was not resolved".into(),
                }),
        })
        .collect()
}

pub fn models(result: &Value) -> Vec<Model> {
    result
        .get("data")
        .or_else(|| result.get("models"))
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|value| {
            Some(Model {
                id: Id::new(value.get("id")?.as_str()?.to_owned()).ok()?,
                label: value
                    .get("displayName")
                    .or_else(|| value.get("label"))
                    .and_then(Value::as_str)
                    .unwrap_or_else(|| value.get("id").and_then(Value::as_str).unwrap_or_default())
                    .to_owned(),
                efforts: value
                    .get("supportedReasoningEfforts")
                    .or_else(|| value.get("efforts"))
                    .and_then(Value::as_array)
                    .map(|values| {
                        values
                            .iter()
                            .filter_map(|value| match value.as_str()? {
                                "low" => Some(Effort::Low),
                                "medium" => Some(Effort::Medium),
                                "high" => Some(Effort::High),
                                "xhigh" => Some(Effort::Xhigh),
                                _ => None,
                            })
                            .collect()
                    })
                    .unwrap_or_default(),
                default_effort: value
                    .get("defaultReasoningEffort")
                    .or_else(|| value.get("defaultEffort"))
                    .and_then(Value::as_str)
                    .map(ToOwned::to_owned),
            })
        })
        .collect()
}

pub fn projects(result: &Value) -> Vec<Project> {
    result
        .get("data")
        .or_else(|| result.get("projects"))
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|value| {
            Some(Project {
                path: value.get("path")?.as_str()?.to_owned(),
                name: value
                    .get("name")
                    .and_then(Value::as_str)
                    .unwrap_or_default()
                    .to_owned(),
                pinned: value
                    .get("pinned")
                    .and_then(Value::as_bool)
                    .unwrap_or(false),
                added_at: timestamp(value.get("addedAt")).unwrap_or_else(Timestamp::now),
                last_used_at: timestamp(value.get("lastUsedAt")),
            })
        })
        .collect()
}

pub fn workspace_support(result: &Value) -> Option<WorkspaceSupport> {
    let value = result.get("support")?;
    Some(WorkspaceSupport {
        provider: Id::new(
            value
                .get("provider")
                .or_else(|| value.get("providerId"))?
                .as_str()?
                .to_owned(),
        )
        .ok()?,
        repository_root: value.get("repositoryRoot")?.as_str()?.to_owned(),
        can_create: value
            .get("canCreate")
            .and_then(Value::as_bool)
            .unwrap_or(false),
    })
}

pub fn queue_items(result: &Value) -> Vec<QueueItem> {
    result
        .get("items")
        .or_else(|| result.get("data"))
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|value| {
            Some(QueueItem {
                id: Id::new(
                    value
                        .get("commandId")
                        .or_else(|| value.get("id"))?
                        .as_str()?
                        .to_owned(),
                )
                .ok()?,
                thread_id: Id::new(
                    value
                        .get("remoteThreadId")
                        .or_else(|| value.get("threadId"))?
                        .as_str()?
                        .to_owned(),
                )
                .ok()?,
                position: U64::new(
                    value
                        .get("order")
                        .or_else(|| value.get("position"))
                        .and_then(Value::as_u64)
                        .unwrap_or(0),
                ),
                state: match value.get("state").and_then(Value::as_str) {
                    Some("queued") => QueueState::Queued,
                    Some("failed" | "uncertain") => QueueState::Failed,
                    Some("delivered" | "done") => QueueState::Done,
                    _ => QueueState::Running,
                },
                summary: value
                    .get("summary")
                    .or_else(|| value.pointer("/params/input/0/text"))
                    .and_then(Value::as_str)
                    .unwrap_or_default()
                    .to_owned(),
                last_error: value
                    .get("lastError")
                    .and_then(Value::as_str)
                    .map(|_| "queue item failed; inspect the authoritative source".to_owned()),
            })
        })
        .collect()
}

pub fn accounts(result: &Value) -> (Option<Id>, Vec<AccountProfile>, bool) {
    let active = result
        .get("activeProfileId")
        .and_then(Value::as_str)
        .and_then(|value| Id::new(value.to_owned()).ok());
    let profiles = result
        .get("profiles")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|value| {
            Some(AccountProfile {
                id: Id::new(
                    value
                        .get("id")
                        .or_else(|| value.get("key"))?
                        .as_str()?
                        .to_owned(),
                )
                .ok()?,
                email: value
                    .get("email")
                    .and_then(Value::as_str)
                    .map(ToOwned::to_owned),
                plan: value
                    .get("plan")
                    .or_else(|| value.get("planType"))
                    .and_then(Value::as_str)
                    .map(ToOwned::to_owned),
                enabled: value
                    .get("enabled")
                    .and_then(Value::as_bool)
                    .unwrap_or(true),
                priority: value.get("priority").and_then(Value::as_i64).unwrap_or(0),
                exhausted_until: timestamp(value.get("exhaustedUntil")),
                exhausted_indefinitely: value
                    .get("exhaustedIndefinitely")
                    .and_then(Value::as_bool)
                    .unwrap_or(false),
                weekly_limit: weekly_rate_limit(value.get("rateLimits")),
                rate_limits_updated_at: timestamp(value.get("rateLimitsUpdatedAt")),
                rate_limits_failed: value
                    .get("rateLimitsError")
                    .is_some_and(|error| !error.is_null()),
            })
        })
        .collect();
    (
        active,
        profiles,
        result
            .get("allExhausted")
            .and_then(Value::as_bool)
            .unwrap_or(false),
    )
}

fn weekly_rate_limit(value: Option<&Value>) -> Option<WeeklyRateLimit> {
    let response = value?;
    let mut snapshots = response
        .get("rateLimitsByLimitId")
        .and_then(Value::as_object)
        .into_iter()
        .flat_map(serde_json::Map::values)
        .collect::<Vec<_>>();
    if let Some(snapshot) = response.get("rateLimits") {
        snapshots.push(snapshot);
    }
    snapshots.into_iter().find_map(|snapshot| {
        ["primary", "secondary"].into_iter().find_map(|name| {
            let window = snapshot.get(name)?;
            if window.get("windowDurationMins").and_then(Value::as_i64) != Some(10_080) {
                return None;
            }
            let used = window.get("usedPercent")?.as_f64()?;
            if !used.is_finite() {
                return None;
            }
            Some(WeeklyRateLimit {
                remaining_percent: (100.0 - used).clamp(0.0, 100.0),
                resets_at: timestamp(window.get("resetsAt")),
            })
        })
    })
}

pub fn resource_changes(result: &Value) -> Vec<ResourceChange> {
    result
        .get("changes")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|value| {
            Some(ResourceChange {
                path: value.get("path")?.as_str()?.to_owned(),
                change: match value
                    .get("change")
                    .or_else(|| value.get("kind"))
                    .and_then(Value::as_str)
                {
                    Some("add" | "added") => FileChangeKind::Add,
                    Some("delete" | "deleted") => FileChangeKind::Delete,
                    _ => FileChangeKind::Update,
                },
                additions: U64::new(value.get("additions").and_then(Value::as_u64).unwrap_or(0)),
                deletions: U64::new(value.get("deletions").and_then(Value::as_u64).unwrap_or(0)),
            })
        })
        .collect()
}

pub fn attachments(result: &Value) -> Vec<Attachment> {
    result
        .get("attachments")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|value| {
            Some(Attachment {
                id: Id::new(value.get("id")?.as_str()?.to_owned()).ok()?,
                name: value
                    .get("name")
                    .and_then(Value::as_str)
                    .unwrap_or_default()
                    .to_owned(),
                media_type: value.get("mediaType").and_then(Value::as_str).map_or_else(
                    || {
                        match value.get("kind").and_then(Value::as_str) {
                            Some("image") => "image/*",
                            Some("audio") => "audio/*",
                            _ => "application/octet-stream",
                        }
                        .to_owned()
                    },
                    ToOwned::to_owned,
                ),
                size_bytes: U64::new(value.get("sizeBytes").and_then(Value::as_u64).unwrap_or(0)),
                download_url: value
                    .get("downloadUrl")
                    .and_then(Value::as_str)
                    .map(ToOwned::to_owned),
            })
        })
        .collect()
}

fn optional_thread_settings(value: &Value) -> Result<Option<ThreadSettings>, V2Error> {
    let approval = value
        .get("approvalPolicy")
        .filter(|setting| !setting.is_null());
    let sandbox = value.get("sandbox").filter(|setting| !setting.is_null());
    match (approval, sandbox) {
        (None, None) => return Ok(None),
        (Some(_), Some(_)) => {}
        _ => {
            return Err(V2Error::source_unavailable(
                "source settings payload is incomplete",
            ));
        }
    }
    thread_settings(value).map(Some)
}

fn thread_settings(value: &Value) -> Result<ThreadSettings, V2Error> {
    let effort = match value.get("reasoningEffort").or_else(|| value.get("effort")) {
        None | Some(Value::Null) => None,
        Some(Value::String(value)) if value == "low" => Some(Effort::Low),
        Some(Value::String(value)) if value == "medium" => Some(Effort::Medium),
        Some(Value::String(value)) if value == "high" => Some(Effort::High),
        Some(Value::String(value)) if value == "xhigh" => Some(Effort::Xhigh),
        Some(_) => return Err(V2Error::source_unavailable("unrecognized effort setting")),
    };
    let approval_policy = match value.get("approvalPolicy").and_then(Value::as_str) {
        Some("never") => ApprovalPolicy::Never,
        Some("on-request") => ApprovalPolicy::OnRequest,
        Some("untrusted") => ApprovalPolicy::Untrusted,
        _ => return Err(V2Error::source_unavailable("unrecognized approval setting")),
    };
    let sandbox = match (
        value.pointer("/sandbox/type").and_then(Value::as_str),
        value.get("sandbox").and_then(Value::as_str),
    ) {
        (Some("read-only" | "readOnly"), _) | (None, Some("read-only")) => Sandbox::ReadOnly,
        (Some("workspace-write" | "workspaceWrite"), _) | (None, Some("workspace-write")) => {
            Sandbox::WorkspaceWrite
        }
        (Some("danger-full-access" | "dangerFullAccess"), _)
        | (None, Some("danger-full-access")) => Sandbox::Unrestricted,
        _ => return Err(V2Error::source_unavailable("unrecognized sandbox setting")),
    };
    Ok(ThreadSettings {
        model: value
            .get("model")
            .and_then(Value::as_str)
            .map(ToOwned::to_owned),
        effort,
        approval_policy,
        sandbox,
    })
}

fn execution_state(value: Option<&Value>) -> ExecutionState {
    match value.and_then(Value::as_str) {
        Some("failed") => ExecutionState::Failed,
        Some("completed") => ExecutionState::Completed,
        _ => ExecutionState::Running,
    }
}

fn message_text(value: &Value) -> String {
    value
        .get("content")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter(|block| block.get("type").and_then(Value::as_str) == Some("text"))
        .filter_map(|block| block.get("text").and_then(Value::as_str))
        .collect::<Vec<_>>()
        .join("\n")
}

fn required_id(value: &Value, field: &str) -> Result<Id, V2Error> {
    Id::new(
        value
            .get(field)
            .and_then(Value::as_str)
            .ok_or_else(|| V2Error::source_unavailable(format!("source record omitted {field}")))?
            .to_owned(),
    )
    .map_err(|_| V2Error::source_unavailable(format!("source record has invalid {field}")))
}

fn optional_id(value: Option<&Value>) -> Result<Option<Id>, V2Error> {
    value
        .and_then(Value::as_str)
        .map(|value| {
            Id::new(value.to_owned())
                .map_err(|_| V2Error::source_unavailable("source record has invalid id"))
        })
        .transpose()
}

fn timestamp(value: Option<&Value>) -> Option<Timestamp> {
    let value = value?;
    if let Some(value) = value.as_str() {
        return Timestamp::new(value.to_owned()).ok();
    }
    let raw = value.as_i64()?;
    let seconds = if raw.abs() > 10_000_000_000 {
        raw / 1_000
    } else {
        raw
    };
    let formatted = OffsetDateTime::from_unix_timestamp(seconds)
        .ok()?
        .format(&Rfc3339)
        .ok()?;
    Timestamp::new(formatted).ok()
}

fn safe_source_error(error: &Value) -> String {
    let _ = error;
    "source request failed".into()
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn source_thread(settings: &Value) -> Value {
        let mut thread = json!({
            "id": "thread",
            "createdAt": "2026-08-27T00:00:00Z",
            "updatedAt": "2026-08-27T00:00:00Z"
        });
        let object = thread
            .as_object_mut()
            .unwrap_or_else(|| panic!("test thread must be an object"));
        object.extend(
            settings
                .as_object()
                .unwrap_or_else(|| panic!("test settings must be an object"))
                .clone(),
        );
        thread
    }

    #[test]
    fn source_settings_accept_only_proven_source_spellings() {
        let accepted = source_thread(&json!({
            "model": null,
            "reasoningEffort": "xhigh",
            "approvalPolicy": "on-request",
            "sandbox": {"type": "workspace-write"}
        }));
        let summary = thread_summary(&accepted)
            .unwrap_or_else(|error| panic!("source settings should normalize: {error:?}"));
        let settings = summary
            .settings
            .unwrap_or_else(|| panic!("source settings should be present"));
        assert_eq!(settings.effort, Some(Effort::Xhigh));
        assert_eq!(settings.approval_policy, ApprovalPolicy::OnRequest);
        assert_eq!(settings.sandbox, Sandbox::WorkspaceWrite);

        for rejected in [
            json!({
                "approvalPolicy": "onRequest",
                "sandbox": "workspace-write"
            }),
            json!({
                "approvalPolicy": "never",
                "sandbox": "readOnly"
            }),
            json!({
                "approvalPolicy": "never",
                "sandbox": "read-only",
                "effort": "extreme"
            }),
        ] {
            assert!(thread_summary(&source_thread(&rejected)).is_err());
        }
    }

    #[test]
    fn thread_list_and_read_records_without_settings_remain_truthful() {
        let summary = thread_summary(&source_thread(&json!({ "preview": "Newest answer" })))
            .unwrap_or_else(|error| panic!("real thread DTO should normalize: {error:?}"));
        assert_eq!(summary.settings, None);
        assert_eq!(summary.preview, "Newest answer");
    }

    #[test]
    fn app_server_placeholder_title_does_not_override_the_canonical_preview() {
        let summary = thread_summary(&source_thread(&json!({
            "title": "Untitled thread",
            "preview": "Newest answer"
        })))
        .unwrap_or_else(|error| panic!("placeholder title should normalize: {error:?}"));

        assert_eq!(summary.title, None);
        assert_eq!(summary.preview, "Newest answer");
    }

    #[test]
    fn catalog_partition_supplies_archived_state_missing_from_thread_dto() {
        let summary = thread_summary_in_partition(&source_thread(&json!({})), true)
            .unwrap_or_else(|error| panic!("catalog thread should normalize: {error:?}"));
        assert!(summary.archived);
    }

    #[test]
    fn response_level_settings_are_attached_to_the_nested_thread() {
        let response = json!({
            "thread": source_thread(&json!({})),
            "model": "gpt-5.6",
            "reasoningEffort": "high",
            "approvalPolicy": "never",
            "sandbox": {"type": "dangerFullAccess"}
        });
        let summary = thread_summary_from_response(&response)
            .unwrap_or_else(|error| panic!("response settings should normalize: {error:?}"));
        let settings = summary
            .settings
            .unwrap_or_else(|| panic!("response settings should be present"));
        assert_eq!(settings.model.as_deref(), Some("gpt-5.6"));
        assert_eq!(settings.effort, Some(Effort::High));
        assert_eq!(settings.approval_policy, ApprovalPolicy::Never);
        assert_eq!(settings.sandbox, Sandbox::Unrestricted);
    }

    #[test]
    fn canonical_turn_display_metadata_survives_v2_normalization() {
        let source = json!({
            "id": "turn",
            "createdAt": "2026-08-27T11:59:00Z",
            "startedAt": "2026-08-27T12:00:00Z",
            "completedAt": "2026-08-27T12:00:03Z",
            "durationMs": 3200,
            "status": "completed",
            "items": [
                {"type": "userMessage", "id": "user", "content": [{"type": "text", "text": "Question"}]},
                {"type": "agentMessage", "id": "agent", "text": "Answer"}
            ],
            "codewide": {
                "activity": {"count": 2, "kinds": ["reasoning", "commandExecution"]},
                "usage": {
                    "latestRequest": {"totalTokens": 25_700},
                    "modelContextWindow": 258_400,
                    "turn": {
                        "tokens": {"inputTokens": 26_000, "outputTokens": 19},
                        "cost": {"totalCostUsd": 0.014}
                    },
                    "thread": {
                        "tokens": {"inputTokens": 76_000, "outputTokens": 1000, "totalTokens": 77_000},
                        "cost": {"totalCostUsd": 0.044}
                    }
                }
            }
        });
        let normalized = turn_view(
            &Id::new("thread").unwrap_or_else(|error| panic!("valid id: {error:?}")),
            &source,
        )
        .unwrap_or_else(|error| panic!("turn should normalize: {error:?}"));

        assert_eq!(normalized.created_at.as_str(), "2026-08-27T12:00:00Z");
        assert_eq!(normalized.duration_ms, Some(3200));
        assert_eq!(
            normalized
                .activity
                .unwrap_or_else(|| panic!("activity must survive"))
                .kinds,
            ["reasoning", "commandExecution"]
        );
        let usage = normalized
            .usage
            .unwrap_or_else(|| panic!("usage must survive"));
        assert_eq!(usage.input_tokens, 26_000);
        assert_eq!(usage.output_tokens, 19);
        assert_eq!(usage.total_cost_usd, Some(0.014));
        assert_eq!(usage.latest_request_tokens, 25_700);
        assert_eq!(usage.model_context_window, Some(258_400));
        assert_eq!(usage.thread_input_tokens, 76_000);
        assert_eq!(usage.thread_output_tokens, 1000);
        assert_eq!(usage.thread_total_tokens, 77_000);
        assert_eq!(usage.thread_total_cost_usd, Some(0.044));
    }

    #[test]
    fn account_weekly_limit_survives_v2_normalization() {
        let result = json!({
            "activeProfileId": "profile-1",
            "allExhausted": false,
            "profiles": [{
                "id": "profile-1",
                "email": "person@example.com",
                "planType": "pro",
                "enabled": true,
                "priority": 0,
                "active": true,
                "exhaustedUntil": null,
                "exhaustedIndefinitely": false,
                "rateLimits": {
                    "rateLimits": {
                        "primary": {"usedPercent": 10, "windowDurationMins": 300, "resetsAt": 1_788_000_000},
                        "secondary": {"usedPercent": 13, "windowDurationMins": 10_080, "resetsAt": 1_789_000_000}
                    },
                    "rateLimitsByLimitId": null
                },
                "rateLimitsUpdatedAt": 1_787_000_000,
                "rateLimitsError": null
            }]
        });
        let (active, profiles, exhausted) = accounts(&result);
        assert_eq!(active.as_ref().map(Id::as_str), Some("profile-1"));
        assert!(!exhausted);
        let profile = profiles
            .first()
            .unwrap_or_else(|| panic!("profile should normalize"));
        assert_eq!(profile.plan.as_deref(), Some("pro"));
        assert_eq!(
            profile
                .rate_limits_updated_at
                .as_ref()
                .map(Timestamp::as_str),
            Some("2026-08-17T20:53:20Z")
        );
        let weekly = profile
            .weekly_limit
            .as_ref()
            .unwrap_or_else(|| panic!("weekly limit should normalize"));
        assert!((weekly.remaining_percent - 87.0).abs() < f64::EPSILON);
        assert_eq!(
            weekly.resets_at.as_ref().map(Timestamp::as_str),
            Some("2026-09-10T00:26:40Z")
        );
    }

    #[test]
    fn source_error_content_never_enters_public_error() {
        let secret = "PRIVATE_SENTINEL_/home/user/token";
        let Err(error) = rpc_result(&json!({
            "error": {"message": secret, "data": {"credential": secret}}
        })) else {
            panic!("source error must fail");
        };
        let encoded = serde_json::to_string(&error.for_wire())
            .unwrap_or_else(|failure| panic!("error must serialize: {failure}"));
        assert!(!encoded.contains(secret));
        assert!(encoded.len() <= 256);
    }
}
