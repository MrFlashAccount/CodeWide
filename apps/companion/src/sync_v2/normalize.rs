//! Narrow App Server/local-service to Sync V2 semantic normalization boundary.

use std::collections::HashMap;

use percent_encoding::{NON_ALPHANUMERIC, utf8_percent_encode};
use serde_json::Value;
use time::{OffsetDateTime, format_description::well_known::Rfc3339};

use super::{
    domain::{
        ApprovalPolicy, Attachment, Effort, ExecutionState, FileChangeKind, FileChangeState,
        InputBlock, Item, ItemLifecycle, LifecyclePhase, NetworkAccess, Personality, Sandbox,
        ThreadReadState, ThreadSettings, ThreadState, ThreadSummary, TurnActivity, TurnState,
        TurnUsage, TurnView, UsageStatus,
    },
    protocol::{
        AccountProfile, Model, Project, QueueAttachment, QueueItem, QueueState, ResourceChange,
        V2Error, WeeklyRateLimit, WorkspaceSupport,
    },
    scalar::{Id, Timestamp, U64},
};

mod goals;
mod items;

pub use goals::thread_goal;
pub use items::item;

pub fn item_lifecycle(item: Item, phase: LifecyclePhase, pre_turn: bool) -> ItemLifecycle {
    ItemLifecycle {
        item,
        phase,
        pre_turn,
    }
}

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
    let state = thread_state(value.get("status"))?;
    let created_at = required_timestamp_alias(value, "createdAt", "created_at")?;
    let updated_at = timestamp(
        value
            .get("recencyAt")
            .filter(|recency| !recency.is_null())
            .or_else(|| value.get("updatedAt"))
            .or_else(|| value.get("updated_at")),
    )
    .ok_or_else(|| source_invalid("source record omitted or invalid updatedAt"))?;
    Ok(ThreadSummary {
        id,
        parent_id: optional_id(thread_parent_id(value))?,
        title: semantic_thread_title(value)?,
        preview: required_string(value, "preview")?.to_owned(),
        workspace: value
            .get("workspace")
            .or_else(|| value.get("cwd"))
            .and_then(Value::as_str)
            .ok_or_else(|| source_invalid("source record omitted workspace"))?
            .to_owned(),
        archived: value
            .get("archived")
            .and_then(Value::as_bool)
            .unwrap_or(false),
        state,
        settings: optional_thread_settings(settings_source)?,
        read_state: ThreadReadState::Unknown {
            latest_activity_marker: None,
            read_through_marker: None,
            unread_count: None,
        },
        created_at,
        updated_at: updated_at.clone(),
        last_activity_at: Some(updated_at),
        head_turn_id: optional_id(value.get("headTurnId"))?,
    })
}

pub fn is_user_catalog_thread(value: &Value) -> bool {
    !value
        .get("ephemeral")
        .and_then(Value::as_bool)
        .unwrap_or(false)
        && thread_parent_id(value).is_none()
        && subagent_source(value).is_none()
}

fn thread_parent_id(value: &Value) -> Option<&Value> {
    value
        .get("parentId")
        .filter(|parent| parent.as_str().is_some())
        .or_else(|| {
            value
                .get("parentThreadId")
                .filter(|parent| parent.as_str().is_some())
        })
        .or_else(|| {
            subagent_source(value)?
                .get("thread_spawn")?
                .get("parent_thread_id")
                .filter(|parent| parent.as_str().is_some())
        })
}

fn subagent_source(value: &Value) -> Option<&Value> {
    let source = value.get("source")?.as_object()?;
    source.get("subAgent").or_else(|| source.get("subagent"))
}

fn semantic_thread_title(value: &Value) -> Result<Option<String>, V2Error> {
    let title = optional_string_from(
        value.get("name").or_else(|| value.get("title")),
        "thread title",
    )?;
    Ok(title
        .as_deref()
        .map(str::trim)
        .filter(|title| !title.is_empty() && !title.eq_ignore_ascii_case("Untitled thread"))
        .map(ToOwned::to_owned))
}

fn thread_state(value: Option<&Value>) -> Result<ThreadState, V2Error> {
    match value {
        Some(Value::Object(status)) => match status.get("type").and_then(Value::as_str) {
            Some("notLoaded" | "idle") => Ok(ThreadState::Idle),
            Some("systemError") => Ok(ThreadState::Failed),
            Some("active") => active_thread_state(status.get("activeFlags")),
            _ => Err(source_invalid("thread status is invalid")),
        },
        Some(Value::String(status)) => match status.as_str() {
            "idle" | "notLoaded" => Ok(ThreadState::Idle),
            "active" | "running" | "inProgress" => Ok(ThreadState::Running),
            "waitingForApproval" => Ok(ThreadState::WaitingForApproval),
            "waitingForInput" => Ok(ThreadState::WaitingForInput),
            "completed" => Ok(ThreadState::Completed),
            "failed" | "systemError" => Ok(ThreadState::Failed),
            "interrupted" => Ok(ThreadState::Interrupted),
            _ => Err(source_invalid("thread status is invalid")),
        },
        _ => Err(source_invalid("thread status is missing")),
    }
}

fn active_thread_state(value: Option<&Value>) -> Result<ThreadState, V2Error> {
    let flags = value
        .and_then(Value::as_array)
        .ok_or_else(|| source_invalid("active thread flags are invalid"))?;
    let mut waiting_for_approval = false;
    let mut waiting_for_input = false;
    for flag in flags {
        match flag.as_str() {
            Some("waitingOnApproval") => waiting_for_approval = true,
            Some("waitingOnUserInput") => waiting_for_input = true,
            _ => return Err(source_invalid("active thread flag is invalid")),
        }
    }
    if waiting_for_approval {
        Ok(ThreadState::WaitingForApproval)
    } else if waiting_for_input {
        Ok(ThreadState::WaitingForInput)
    } else {
        Ok(ThreadState::Running)
    }
}

pub fn turn_view(thread_id: &Id, value: &Value) -> Result<TurnView, V2Error> {
    let state = match value.get("status").and_then(Value::as_str) {
        Some("queued") => TurnState::Queued,
        Some("inProgress") => TurnState::Running,
        Some("completed") => TurnState::Completed,
        Some("failed") => TurnState::Failed,
        Some("interrupted") => TurnState::Interrupted,
        _ => return Err(source_invalid("turn status is invalid")),
    };
    let source_items = required_array(value, "items")?;
    if source_items.len() > 2_048 {
        return Err(V2Error::source_unavailable("turn item limit exceeded"));
    }
    let items = source_items
        .iter()
        .map(item)
        .collect::<Result<Vec<_>, _>>()?;
    let lifecycle = snapshot_lifecycle(&items, state);
    Ok(TurnView {
        id: required_id(value, "id")?,
        thread_id: thread_id.clone(),
        state,
        created_at: timestamp(value.get("startedAt").or_else(|| value.get("createdAt"))),
        completed_at: timestamp(value.get("completedAt")),
        duration_ms: nonnegative_safe_integer(value.get("durationMs")),
        activity: turn_activity(value)?,
        usage: turn_usage(value)?,
        items,
        lifecycle,
    })
}

fn snapshot_lifecycle(items: &[Item], turn_state: TurnState) -> Vec<ItemLifecycle> {
    let mut seen_user_message = false;
    let last_index = items.len().saturating_sub(1);
    items
        .iter()
        .enumerate()
        .map(|(index, item)| {
            let pre_turn = !seen_user_message && !matches!(item, Item::UserMessage { .. });
            if matches!(item, Item::UserMessage { .. }) {
                seen_user_message = true;
            }
            item_lifecycle(
                item.clone(),
                snapshot_lifecycle_phase(item, turn_state, index == last_index),
                pre_turn,
            )
        })
        .collect()
}

fn snapshot_lifecycle_phase(item: &Item, turn_state: TurnState, is_last: bool) -> LifecyclePhase {
    match item {
        Item::Command { status, .. }
        | Item::Tool { status, .. }
        | Item::Collaboration { status, .. }
        | Item::ImageGeneration { status, .. } => execution_lifecycle_phase(*status),
        Item::FileChange { status, .. } => match status {
            FileChangeState::Pending => LifecyclePhase::Started,
            FileChangeState::Applied | FileChangeState::Rejected => LifecyclePhase::Completed,
        },
        _ if turn_state == TurnState::Running && is_last => LifecyclePhase::Started,
        _ => LifecyclePhase::Completed,
    }
}

fn execution_lifecycle_phase(status: ExecutionState) -> LifecyclePhase {
    match status {
        ExecutionState::Running => LifecyclePhase::Started,
        ExecutionState::Completed | ExecutionState::Failed => LifecyclePhase::Completed,
    }
}

fn turn_activity(value: &Value) -> Result<Option<TurnActivity>, V2Error> {
    let Some(activity) = value.pointer("/codewide/activity") else {
        return Ok(None);
    };
    let count = required_nonnegative_integer(activity, "count")?;
    let source_kinds = required_array(activity, "kinds")?;
    if source_kinds.len() > 256 {
        return Err(source_invalid("turn activity kind limit exceeded"));
    }
    let kinds = source_kinds
        .iter()
        .map(|kind| {
            kind.as_str()
                .map(ToOwned::to_owned)
                .ok_or_else(|| source_invalid("turn activity kind is invalid"))
        })
        .collect::<Result<Vec<_>, _>>()?;
    Ok(Some(TurnActivity { count, kinds }))
}

fn turn_usage(value: &Value) -> Result<Option<TurnUsage>, V2Error> {
    let Some(usage) = value.pointer("/codewide/usage") else {
        return Ok(None);
    };
    let tokens = required_object(usage.pointer("/turn/tokens"), "turn usage tokens")?;
    let thread_tokens = required_object(usage.pointer("/thread/tokens"), "thread usage tokens")?;
    let input_tokens = required_nonnegative_integer(tokens, "inputTokens")?;
    let output_tokens = required_nonnegative_integer(tokens, "outputTokens")?;
    let total_cost_usd = optional_nonnegative_number(usage.pointer("/turn/cost/totalCostUsd"))?;
    let thread_total_cost_usd =
        optional_nonnegative_number(usage.pointer("/thread/cost/totalCostUsd"))?;
    Ok(Some(TurnUsage {
        input_tokens,
        cached_input_tokens: required_nonnegative_integer(tokens, "cachedInputTokens")?,
        cache_write_input_tokens: required_nonnegative_integer(tokens, "cacheWriteInputTokens")?,
        output_tokens,
        reasoning_output_tokens: required_nonnegative_integer(tokens, "reasoningOutputTokens")?,
        total_cost_usd,
        latest_request_tokens: required_nonnegative_integer(
            required_object(usage.get("latestRequest"), "latest request usage")?,
            "totalTokens",
        )?,
        model_context_window: optional_nonnegative_integer(usage, "modelContextWindow")?,
        thread_input_tokens: required_nonnegative_integer(thread_tokens, "inputTokens")?,
        thread_cached_input_tokens: required_nonnegative_integer(
            thread_tokens,
            "cachedInputTokens",
        )?,
        thread_cache_write_input_tokens: required_nonnegative_integer(
            thread_tokens,
            "cacheWriteInputTokens",
        )?,
        thread_output_tokens: required_nonnegative_integer(thread_tokens, "outputTokens")?,
        thread_reasoning_output_tokens: required_nonnegative_integer(
            thread_tokens,
            "reasoningOutputTokens",
        )?,
        thread_total_tokens: required_nonnegative_integer(thread_tokens, "totalTokens")?,
        thread_total_cost_usd,
        thread_compaction_count: optional_nonnegative_integer_from(
            usage.pointer("/thread/compactionCount"),
            "thread compaction count",
        )?,
        model: optional_string_from(
            value
                .pointer("/codewide/execution/model")
                .or_else(|| usage.get("model")),
            "usage model",
        )?,
        status: match usage.get("status").and_then(Value::as_str) {
            Some("live") => UsageStatus::Live,
            Some("final") | None => UsageStatus::Final,
            Some(_) => return Err(source_invalid("usage status is invalid")),
        },
        cache_hit: optional_bool(usage, "cacheHit")?,
    }))
}

fn nonnegative_safe_integer(value: Option<&Value>) -> Option<i64> {
    value
        .and_then(Value::as_i64)
        .filter(|number| (0..=9_007_199_254_740_991).contains(number))
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
            InputBlock::Skill { name, path } => Ok(serde_json::json!({
                "type": "skill",
                "name": name,
                "path": path,
            })),
        })
        .collect()
}

pub fn models(result: &Value) -> Result<Vec<Model>, V2Error> {
    required_collection(result, "data", "models")?
        .iter()
        .map(model)
        .collect()
}

fn model(value: &Value) -> Result<Model, V2Error> {
    let id_value = value
        .get("model")
        .or_else(|| value.get("id"))
        .and_then(Value::as_str)
        .ok_or_else(|| source_invalid("model record omitted identity"))?;
    let efforts = value
        .get("supportedReasoningEfforts")
        .or_else(|| value.get("efforts"))
        .and_then(Value::as_array)
        .ok_or_else(|| source_invalid("model record omitted efforts"))?
        .iter()
        .map(|value| parse_effort(reasoning_effort(value)?))
        .collect::<Result<Vec<_>, _>>()?;
    Ok(Model {
        id: Id::new(id_value.to_owned())
            .map_err(|_| source_invalid("model record has invalid identity"))?,
        label: value
            .get("displayName")
            .or_else(|| value.get("label"))
            .and_then(Value::as_str)
            .ok_or_else(|| source_invalid("model record omitted display name"))?
            .to_owned(),
        efforts,
        default_effort: optional_string_from(
            value
                .get("defaultReasoningEffort")
                .or_else(|| value.get("defaultEffort")),
            "model default effort",
        )?,
        // App Server defines this field with a protocol-level default of false.
        supports_personality: optional_bool(value, "supportsPersonality")?.unwrap_or(false),
    })
}

fn reasoning_effort(value: &Value) -> Result<&str, V2Error> {
    value
        .as_str()
        .or_else(|| value.get("reasoningEffort").and_then(Value::as_str))
        .ok_or_else(|| source_invalid("model effort is invalid"))
}

fn parse_effort(value: &str) -> Result<Effort, V2Error> {
    match value {
        "none" => Ok(Effort::None),
        "minimal" => Ok(Effort::Minimal),
        "low" => Ok(Effort::Low),
        "medium" => Ok(Effort::Medium),
        "high" => Ok(Effort::High),
        "xhigh" => Ok(Effort::Xhigh),
        "max" => Ok(Effort::Max),
        "ultra" => Ok(Effort::Ultra),
        _ => Err(source_invalid("model effort is unrecognized")),
    }
}

pub fn projects(result: &Value) -> Result<Vec<Project>, V2Error> {
    required_collection(result, "data", "projects")?
        .iter()
        .map(project)
        .collect()
}

fn project(value: &Value) -> Result<Project, V2Error> {
    Ok(Project {
        path: required_string(value, "path")?.to_owned(),
        name: required_string(value, "name")?.to_owned(),
        pinned: required_bool(value, "pinned")?,
        added_at: required_timestamp(value, "addedAt")?,
        last_used_at: optional_timestamp(value, "lastUsedAt")?,
    })
}

pub fn workspace_support(result: &Value) -> Result<Option<WorkspaceSupport>, V2Error> {
    let Some(value) = result.get("support") else {
        return Ok(None);
    };
    let capability = required_string(value, "capability")?;
    if capability != crate::vcs::WORKSPACE_CREATE_CAPABILITY {
        return Ok(None);
    }
    Ok(Some(WorkspaceSupport {
        provider: Id::new(
            value
                .get("provider")
                .or_else(|| value.get("providerId"))
                .and_then(Value::as_str)
                .ok_or_else(|| source_invalid("workspace support omitted provider"))?
                .to_owned(),
        )
        .map_err(|_| source_invalid("workspace support provider is invalid"))?,
        repository_root: required_string(value, "repositoryRoot")?.to_owned(),
        can_create: true,
    }))
}

pub fn queue_items(result: &Value) -> Result<Vec<QueueItem>, V2Error> {
    required_collection(result, "items", "data")?
        .iter()
        .map(queue_item)
        .collect()
}

fn queue_item(value: &Value) -> Result<QueueItem, V2Error> {
    let id = value
        .get("commandId")
        .or_else(|| value.get("id"))
        .and_then(Value::as_str)
        .ok_or_else(|| source_invalid("queue item omitted identity"))?;
    let thread_id = value
        .get("remoteThreadId")
        .or_else(|| value.get("threadId"))
        .and_then(Value::as_str)
        .ok_or_else(|| source_invalid("queue item omitted thread identity"))?;
    let position = value
        .get("order")
        .or_else(|| value.get("position"))
        .and_then(Value::as_u64)
        .ok_or_else(|| source_invalid("queue item position is invalid"))?;
    let state = match value.get("state").and_then(Value::as_str) {
        Some("queued") => QueueState::Queued,
        Some("running") => QueueState::Running,
        Some("uncertain")
            if value.pointer("/claim/resolved").and_then(Value::as_bool) == Some(false) =>
        {
            QueueState::Running
        }
        Some("uncertain") => QueueState::Uncertain,
        Some("failed") => QueueState::Failed,
        Some("delivered" | "done") => QueueState::Done,
        _ => return Err(source_invalid("queue item state is invalid")),
    };
    let (input, attachments) = queue_input(value)?;
    Ok(QueueItem {
        id: Id::new(id.to_owned()).map_err(|_| source_invalid("queue item identity is invalid"))?,
        thread_id: Id::new(thread_id.to_owned())
            .map_err(|_| source_invalid("queue thread identity is invalid"))?,
        position: U64::new(position),
        state,
        input,
        attachments,
        summary: optional_string_from(
            value
                .get("summary")
                .or_else(|| value.pointer("/params/input/0/text")),
            "queue item summary",
        )?
        .unwrap_or_default(),
        last_error: optional_string_from(value.get("lastError"), "queue item error")?,
    })
}

pub fn accounts(result: &Value) -> Result<(Option<Id>, Vec<AccountProfile>, bool), V2Error> {
    let active = match result.get("activeProfileId") {
        None | Some(Value::Null) => None,
        Some(Value::String(value)) => Some(
            Id::new(value.clone())
                .map_err(|_| source_invalid("active account identity is invalid"))?,
        ),
        Some(_) => return Err(source_invalid("active account identity is invalid")),
    };
    let profiles = required_array(result, "profiles")?
        .iter()
        .map(account)
        .collect::<Result<Vec<_>, _>>()?;
    Ok((active, profiles, required_bool(result, "allExhausted")?))
}

fn account(value: &Value) -> Result<AccountProfile, V2Error> {
    let id = value
        .get("id")
        .or_else(|| value.get("key"))
        .and_then(Value::as_str)
        .ok_or_else(|| source_invalid("account omitted identity"))?;
    Ok(AccountProfile {
        id: Id::new(id.to_owned()).map_err(|_| source_invalid("account identity is invalid"))?,
        email: optional_string(value, "email")?,
        plan: optional_string_from(
            value.get("plan").or_else(|| value.get("planType")),
            "account plan",
        )?,
        enabled: required_bool(value, "enabled")?,
        priority: required_i64(value, "priority")?,
        exhausted_until: optional_timestamp(value, "exhaustedUntil")?,
        exhausted_indefinitely: required_bool(value, "exhaustedIndefinitely")?,
        weekly_limit: weekly_rate_limit(value.get("rateLimits"))?,
        rate_limits_updated_at: optional_timestamp(value, "rateLimitsUpdatedAt")?,
        rate_limits_failed: value
            .get("rateLimitsError")
            .is_some_and(|error| !error.is_null()),
    })
}

fn weekly_rate_limit(value: Option<&Value>) -> Result<Option<WeeklyRateLimit>, V2Error> {
    let Some(response) = value else {
        return Ok(None);
    };
    if response.is_null() {
        return Ok(None);
    }
    let response = response
        .as_object()
        .ok_or_else(|| source_invalid("account rate limits are invalid"))?;
    let mut snapshots = match response.get("rateLimitsByLimitId") {
        None | Some(Value::Null) => Vec::new(),
        Some(Value::Object(values)) => values.values().collect::<Vec<_>>(),
        Some(_) => return Err(source_invalid("account rate limit map is invalid")),
    };
    if let Some(snapshot) = response.get("rateLimits")
        && !snapshot.is_null()
    {
        snapshots.push(snapshot);
    }
    for snapshot in snapshots {
        let snapshot = snapshot
            .as_object()
            .ok_or_else(|| source_invalid("account rate limit snapshot is invalid"))?;
        for name in ["primary", "secondary"] {
            let Some(window) = snapshot.get(name) else {
                continue;
            };
            let duration = required_i64(window, "windowDurationMins")?;
            if duration != 10_080 {
                continue;
            }
            let used = required_f64(window, "usedPercent")?;
            if !used.is_finite() || !(0.0..=100.0).contains(&used) {
                return Err(source_invalid("weekly rate limit usage is invalid"));
            }
            return Ok(Some(WeeklyRateLimit {
                remaining_percent: 100.0 - used,
                resets_at: optional_timestamp(window, "resetsAt")?,
            }));
        }
    }
    Ok(None)
}

pub fn resource_changes(result: &Value) -> Result<Vec<ResourceChange>, V2Error> {
    required_array(result, "changes")?
        .iter()
        .map(resource_change)
        .collect()
}

fn resource_change(value: &Value) -> Result<ResourceChange, V2Error> {
    let kind = value
        .get("change")
        .or_else(|| value.get("kind"))
        .and_then(Value::as_str);
    Ok(ResourceChange {
        path: required_string(value, "path")?.to_owned(),
        change: match kind {
            Some("add" | "added") => FileChangeKind::Add,
            Some("delete" | "deleted") => FileChangeKind::Delete,
            Some("update" | "updated") => FileChangeKind::Update,
            _ => return Err(source_invalid("resource change kind is invalid")),
        },
        additions: U64::new(required_u64(value, "additions")?),
        deletions: U64::new(required_u64(value, "deletions")?),
    })
}

pub fn attachments(result: &Value) -> Result<Vec<Attachment>, V2Error> {
    required_array(result, "attachments")?
        .iter()
        .map(attachment)
        .collect()
}

fn attachment(value: &Value) -> Result<Attachment, V2Error> {
    let id = value
        .get("id")
        .or_else(|| value.get("key"))
        .and_then(Value::as_str)
        .ok_or_else(|| source_invalid("attachment omitted identity"))?;
    let download_url = optional_string(value, "downloadUrl")?
        .or(optional_string(value, "url")?)
        .or_else(|| {
            value.get("path").and_then(Value::as_str).map(|path| {
                format!(
                    "/v2/files/preview?path={}",
                    utf8_percent_encode(path, NON_ALPHANUMERIC)
                )
            })
        });
    let media_type = match value.get("mediaType") {
        Some(Value::String(media_type)) => media_type.clone(),
        None => match value.get("kind").and_then(Value::as_str) {
            Some("image") => "image/*".to_owned(),
            Some("audio") => "audio/*".to_owned(),
            Some("file") => "application/octet-stream".to_owned(),
            _ => return Err(source_invalid("attachment media kind is invalid")),
        },
        Some(_) => return Err(source_invalid("attachment media type is invalid")),
    };
    Ok(Attachment {
        id: Id::new(id.to_owned()).map_err(|_| source_invalid("attachment identity is invalid"))?,
        name: required_string(value, "name")?.to_owned(),
        media_type,
        // The resource service does not expose a byte count. Zero is its explicit unknown sentinel.
        size_bytes: U64::new(optional_u64(value, "sizeBytes")?.unwrap_or(0)),
        download_url,
    })
}

fn optional_thread_settings(value: &Value) -> Result<Option<ThreadSettings>, V2Error> {
    let approval = value
        .get("approvalPolicy")
        .filter(|setting| !setting.is_null());
    let sandbox = value
        .get("sandboxPolicy")
        .or_else(|| value.get("sandbox"))
        .filter(|setting| !setting.is_null());
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

pub(super) fn thread_settings(value: &Value) -> Result<ThreadSettings, V2Error> {
    let effort = match value.get("reasoningEffort").or_else(|| value.get("effort")) {
        None | Some(Value::Null) => None,
        Some(Value::String(value)) => Some(parse_effort(value)?),
        Some(_) => return Err(V2Error::source_unavailable("unrecognized effort setting")),
    };
    let approval_policy = approval_policy(value.get("approvalPolicy"))?;
    let source_sandbox = value.get("sandboxPolicy").or_else(|| value.get("sandbox"));
    let sandbox_kind = source_sandbox.and_then(|sandbox| {
        sandbox
            .get("type")
            .and_then(Value::as_str)
            .or_else(|| sandbox.as_str())
    });
    let sandbox = match sandbox_kind {
        Some("read-only" | "readOnly") => Sandbox::ReadOnly,
        Some("workspace-write" | "workspaceWrite") => Sandbox::WorkspaceWrite,
        Some("danger-full-access" | "dangerFullAccess") => Sandbox::Unrestricted,
        Some("external-sandbox" | "externalSandbox") => Sandbox::ExternalSandbox {
            network_access: match source_sandbox.and_then(|sandbox| sandbox.get("networkAccess")) {
                None | Some(Value::Null) => NetworkAccess::Restricted,
                Some(Value::String(value)) if value == "restricted" => NetworkAccess::Restricted,
                Some(Value::String(value)) if value == "enabled" => NetworkAccess::Enabled,
                _ => {
                    return Err(V2Error::source_unavailable(
                        "unrecognized external sandbox network setting",
                    ));
                }
            },
        },
        _ => return Err(V2Error::source_unavailable("unrecognized sandbox setting")),
    };
    Ok(ThreadSettings {
        model: optional_string(value, "model")?,
        effort,
        approval_policy,
        sandbox,
        personality: match value.get("personality") {
            None | Some(Value::Null) => None,
            Some(Value::String(personality)) if personality == "none" => Some(Personality::None),
            Some(Value::String(personality)) if personality == "friendly" => {
                Some(Personality::Friendly)
            }
            Some(Value::String(personality)) if personality == "pragmatic" => {
                Some(Personality::Pragmatic)
            }
            Some(_) => return Err(source_invalid("unrecognized personality setting")),
        },
    })
}

fn approval_policy(value: Option<&Value>) -> Result<ApprovalPolicy, V2Error> {
    match value {
        Some(Value::String(policy)) if policy == "never" => Ok(ApprovalPolicy::Never),
        Some(Value::String(policy)) if policy == "on-request" => Ok(ApprovalPolicy::OnRequest),
        Some(Value::String(policy)) if policy == "untrusted" => Ok(ApprovalPolicy::Untrusted),
        Some(Value::Object(policy)) => {
            let granular = policy
                .get("granular")
                .and_then(Value::as_object)
                .ok_or_else(|| source_invalid("unrecognized approval setting"))?;
            Ok(ApprovalPolicy::Granular(
                super::domain::GranularApprovalConfig {
                    sandbox_approval: required_bool_map(granular, "sandbox_approval")?,
                    rules: required_bool_map(granular, "rules")?,
                    skill_approval: required_bool_map(granular, "skill_approval")?,
                    request_permissions: required_bool_map(granular, "request_permissions")?,
                    mcp_elicitations: required_bool_map(granular, "mcp_elicitations")?,
                },
            ))
        }
        _ => Err(source_invalid("unrecognized approval setting")),
    }
}

fn queue_input(value: &Value) -> Result<(Vec<InputBlock>, Vec<QueueAttachment>), V2Error> {
    if let Some(queue_input) = value.get("queueInput") {
        let blocks = queue_input
            .as_array()
            .ok_or_else(|| source_invalid("queue presentation input is invalid"))?;
        let mut input = Vec::with_capacity(blocks.len());
        let mut attachments = Vec::new();
        for block in blocks {
            match block.get("kind").and_then(Value::as_str) {
                Some("text") => input.push(InputBlock::Text {
                    text: required_string(block, "text")?.to_owned(),
                }),
                Some("attachment") => {
                    let id = Id::new(required_string(block, "attachmentId")?.to_owned())
                        .map_err(|_| source_invalid("queue attachment identity is invalid"))?;
                    let name = required_string(block, "name")?;
                    if name.is_empty() || name.chars().count() > 512 || name.len() > 2048 {
                        return Err(source_invalid("queue attachment name is invalid"));
                    }
                    input.push(InputBlock::Attachment {
                        attachment_id: id.clone(),
                    });
                    attachments.push(QueueAttachment {
                        id,
                        name: name.to_owned(),
                    });
                }
                Some("skill") => input.push(InputBlock::Skill {
                    name: required_string(block, "name")?.to_owned(),
                    path: required_string(block, "path")?.to_owned(),
                }),
                _ => return Err(source_invalid("queue presentation input block is invalid")),
            }
        }
        return Ok((input, attachments));
    }
    let input = value
        .pointer("/params/input")
        .or_else(|| value.get("input"))
        .and_then(Value::as_array)
        .ok_or_else(|| source_invalid("queue input is invalid"))?
        .iter()
        .map(|block| match block.get("type").and_then(Value::as_str) {
            Some("text") => Ok(InputBlock::Text {
                text: required_string(block, "text")?.to_owned(),
            }),
            Some("remoteFile" | "attachment") => Ok(InputBlock::Attachment {
                attachment_id: Id::new(
                    block
                        .get("attachmentId")
                        .or_else(|| block.get("id"))
                        .and_then(Value::as_str)
                        .ok_or_else(|| source_invalid("queue attachment identity is missing"))?
                        .to_owned(),
                )
                .map_err(|_| source_invalid("queue attachment identity is invalid"))?,
            }),
            Some("skill") => Ok(InputBlock::Skill {
                name: required_string(block, "name")?.to_owned(),
                path: required_string(block, "path")?.to_owned(),
            }),
            _ => Err(source_invalid("queue input block is invalid")),
        })
        .collect::<Result<Vec<_>, _>>()?;
    Ok((input, Vec::new()))
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
    match value {
        None | Some(Value::Null) => Ok(None),
        Some(Value::String(value)) => Id::new(value.to_owned())
            .map_err(|_| V2Error::source_unavailable("source record has invalid id"))
            .map(Some),
        Some(_) => Err(V2Error::source_unavailable("source record has invalid id")),
    }
}

fn required_collection<'a>(
    value: &'a Value,
    primary: &str,
    alternate: &str,
) -> Result<&'a [Value], V2Error> {
    value
        .get(primary)
        .or_else(|| value.get(alternate))
        .and_then(Value::as_array)
        .map(Vec::as_slice)
        .ok_or_else(|| source_invalid(format!("source result omitted {primary}")))
}

fn required_array<'a>(value: &'a Value, field: &str) -> Result<&'a [Value], V2Error> {
    value
        .get(field)
        .and_then(Value::as_array)
        .map(Vec::as_slice)
        .ok_or_else(|| source_invalid(format!("source record omitted or invalid {field}")))
}

fn required_object<'a>(value: Option<&'a Value>, field: &str) -> Result<&'a Value, V2Error> {
    value
        .filter(|value| value.is_object())
        .ok_or_else(|| source_invalid(format!("source record omitted or invalid {field}")))
}

fn required_string<'a>(value: &'a Value, field: &str) -> Result<&'a str, V2Error> {
    value
        .get(field)
        .and_then(Value::as_str)
        .ok_or_else(|| source_invalid(format!("source record omitted or invalid {field}")))
}

fn optional_string(value: &Value, field: &str) -> Result<Option<String>, V2Error> {
    optional_string_from(value.get(field), field)
}

fn optional_string_from(value: Option<&Value>, field: &str) -> Result<Option<String>, V2Error> {
    match value {
        None | Some(Value::Null) => Ok(None),
        Some(Value::String(value)) => Ok(Some(value.clone())),
        Some(_) => Err(source_invalid(format!("source record has invalid {field}"))),
    }
}

fn required_bool(value: &Value, field: &str) -> Result<bool, V2Error> {
    value
        .get(field)
        .and_then(Value::as_bool)
        .ok_or_else(|| source_invalid(format!("source record omitted or invalid {field}")))
}

fn required_bool_map(value: &serde_json::Map<String, Value>, field: &str) -> Result<bool, V2Error> {
    value
        .get(field)
        .and_then(Value::as_bool)
        .ok_or_else(|| source_invalid(format!("source record omitted or invalid {field}")))
}

fn optional_bool(value: &Value, field: &str) -> Result<Option<bool>, V2Error> {
    match value.get(field) {
        None | Some(Value::Null) => Ok(None),
        Some(Value::Bool(value)) => Ok(Some(*value)),
        Some(_) => Err(source_invalid(format!("source record has invalid {field}"))),
    }
}

fn required_i64(value: &Value, field: &str) -> Result<i64, V2Error> {
    value
        .get(field)
        .and_then(Value::as_i64)
        .ok_or_else(|| source_invalid(format!("source record omitted or invalid {field}")))
}

fn required_u64(value: &Value, field: &str) -> Result<u64, V2Error> {
    value
        .get(field)
        .and_then(Value::as_u64)
        .ok_or_else(|| source_invalid(format!("source record omitted or invalid {field}")))
}

fn optional_u64(value: &Value, field: &str) -> Result<Option<u64>, V2Error> {
    match value.get(field) {
        None | Some(Value::Null) => Ok(None),
        Some(value) => value
            .as_u64()
            .map(Some)
            .ok_or_else(|| source_invalid(format!("source record has invalid {field}"))),
    }
}

fn required_f64(value: &Value, field: &str) -> Result<f64, V2Error> {
    value
        .get(field)
        .and_then(Value::as_f64)
        .ok_or_else(|| source_invalid(format!("source record omitted or invalid {field}")))
}

fn required_nonnegative_integer(value: &Value, field: &str) -> Result<i64, V2Error> {
    nonnegative_safe_integer(value.get(field))
        .ok_or_else(|| source_invalid(format!("source record omitted or invalid {field}")))
}

fn optional_nonnegative_integer(value: &Value, field: &str) -> Result<Option<i64>, V2Error> {
    match value.get(field) {
        None | Some(Value::Null) => Ok(None),
        Some(_) => required_nonnegative_integer(value, field).map(Some),
    }
}

fn optional_nonnegative_integer_from(
    value: Option<&Value>,
    field: &str,
) -> Result<Option<i64>, V2Error> {
    match value {
        None | Some(Value::Null) => Ok(None),
        Some(value) => nonnegative_safe_integer(Some(value))
            .map(Some)
            .ok_or_else(|| source_invalid(format!("source record has invalid {field}"))),
    }
}

fn optional_nonnegative_number(value: Option<&Value>) -> Result<Option<f64>, V2Error> {
    match value {
        None | Some(Value::Null) => Ok(None),
        Some(value) => value
            .as_f64()
            .filter(|number| number.is_finite() && *number >= 0.0)
            .map(Some)
            .ok_or_else(|| source_invalid("source record has invalid nonnegative number")),
    }
}

fn required_timestamp(value: &Value, field: &str) -> Result<Timestamp, V2Error> {
    timestamp(value.get(field))
        .ok_or_else(|| source_invalid(format!("source record omitted or invalid {field}")))
}

fn required_timestamp_alias(
    value: &Value,
    primary: &str,
    alternate: &str,
) -> Result<Timestamp, V2Error> {
    timestamp(value.get(primary).or_else(|| value.get(alternate)))
        .ok_or_else(|| source_invalid(format!("source record omitted or invalid {primary}")))
}

fn optional_timestamp(value: &Value, field: &str) -> Result<Option<Timestamp>, V2Error> {
    match value.get(field) {
        None | Some(Value::Null) => Ok(None),
        Some(raw) => timestamp(Some(raw))
            .map(Some)
            .ok_or_else(|| source_invalid(format!("source record has invalid {field}"))),
    }
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
    const FALLBACK: &str = "source request failed";
    const PREFIX: &str = "App Server error";
    const MAX_PUBLIC_CHARS: usize = 128;

    let code = error.get("code").and_then(source_error_code);
    let prefix = code.as_ref().map_or_else(
        || format!("{PREFIX}: "),
        |code| format!("{PREFIX} {code}: "),
    );
    let message = error
        .get("message")
        .and_then(Value::as_str)
        .and_then(safe_source_error_message)
        .map(|message| bounded_chars(&message, MAX_PUBLIC_CHARS.saturating_sub(prefix.len())));

    match (code, message) {
        (_, Some(message)) => format!("{prefix}{message}"),
        (Some(code), _) => format!("{PREFIX} {code}"),
        (None, None) => FALLBACK.to_owned(),
    }
}

fn source_error_code(value: &Value) -> Option<String> {
    let code = match value {
        Value::Number(value) if value.is_i64() => value.to_string(),
        Value::String(value) => value.clone(),
        _ => return None,
    };
    if code.is_empty()
        || code.len() > 32
        || !code
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || ".-_".contains(character))
    {
        return None;
    }
    Some(code)
}

fn safe_source_error_message(message: &str) -> Option<String> {
    let trimmed = message.trim();
    if trimmed.is_empty() || trimmed.chars().any(char::is_control) {
        return None;
    }
    let lowercase = trimmed.to_ascii_lowercase();
    if [
        "access token",
        "api key",
        "authorization:",
        "bearer ",
        "credential",
        "cookie:",
        "private key",
        "private_sentinel",
        "refresh token",
        "secret",
        "/home/",
        "/token",
        "/users/",
        "\\users\\",
    ]
    .iter()
    .any(|sensitive| lowercase.contains(sensitive))
    {
        return None;
    }
    Some(trimmed.to_owned())
}

fn bounded_chars(value: &str, limit: usize) -> String {
    let mut bounded = value.chars().take(limit).collect::<String>();
    if value.chars().count() > limit && limit > 0 {
        bounded.pop();
        bounded.push('…');
    }
    bounded
}

fn source_invalid(message: impl Into<String>) -> V2Error {
    V2Error::source_unavailable(message.into())
}

#[cfg(test)]
mod tests;
