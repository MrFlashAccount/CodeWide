use std::{
    collections::HashMap,
    fs::File,
    io::{BufRead, BufReader, Read, Seek, SeekFrom},
    path::Path,
};

use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

use crate::store::TurnRef;
use crate::usage::{
    TokenCounts, TurnUsageProjection, parse_rollout_usage, projection_from_rollout,
};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TurnDigest {
    pub id: String,
    pub status: String,
    pub started_at: Option<i64>,
    pub completed_at: Option<i64>,
    pub duration_ms: Option<i64>,
    pub user_text_bytes: Option<usize>,
    pub final_agent_text_bytes: Option<usize>,
    pub activity_count: usize,
    pub activity_kinds: Vec<String>,
    pub unknown_event_kinds: Vec<String>,
}

#[derive(Debug, thiserror::Error)]
pub enum HistoryError {
    #[error(transparent)]
    Io(#[from] std::io::Error),
    #[error("turn span is invalid: {start}..{end}")]
    InvalidSpan { start: u64, end: u64 },
    #[error("invalid event JSON at byte {offset}: {source}")]
    InvalidEvent {
        offset: u64,
        source: serde_json::Error,
    },
}

#[derive(Clone, Debug, Deserialize, Serialize)]
struct ProjectedItem {
    key: String,
    kind: String,
    text_bytes: Option<usize>,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
struct DigestBuilder {
    status: String,
    started_at: Option<i64>,
    completed_at: Option<i64>,
    duration_ms: Option<i64>,
    items: Vec<ProjectedItem>,
    item_indexes: HashMap<String, usize>,
    generated: u64,
    unknown_event_kinds: Vec<String>,
}

impl DigestBuilder {
    fn handle_event(&mut self, payload: &Value) {
        let Some(kind) = payload.get("type").and_then(Value::as_str) else {
            return;
        };
        match kind {
            "task_started" => {
                self.status = "inProgress".into();
                self.started_at = integer(payload, "started_at");
            }
            "task_complete" => {
                self.status = if payload.get("error").is_some_and(|value| !value.is_null()) {
                    "failed".into()
                } else {
                    "completed".into()
                };
                self.completed_at = integer(payload, "completed_at");
                self.duration_ms = integer(payload, "duration_ms");
                if self.final_agent().is_none()
                    && let Some(message) = payload.get("last_agent_message").and_then(Value::as_str)
                {
                    self.push_generated("agentMessage", Some(message.len()));
                }
            }
            "turn_aborted" => {
                self.status = "interrupted".into();
                self.completed_at = integer(payload, "completed_at");
                self.duration_ms = integer(payload, "duration_ms");
            }
            "user_message" => {
                let bytes = payload.get("message").and_then(Value::as_str).map(str::len);
                self.push_generated("userMessage", bytes);
            }
            "agent_message" => {
                if let Some(message) = payload.get("message").and_then(Value::as_str)
                    && !message.is_empty()
                {
                    self.push_generated("agentMessage", Some(message.len()));
                }
            }
            "agent_reasoning" | "agent_reasoning_raw_content" => {
                if payload
                    .get("text")
                    .and_then(Value::as_str)
                    .is_some_and(|text| !text.is_empty())
                    && self
                        .items
                        .last()
                        .is_none_or(|item| item.kind != "reasoning")
                {
                    self.push_generated("reasoning", None);
                }
            }
            "web_search_begin" | "web_search_end" => self.upsert_payload(payload, "webSearch"),
            "exec_command_begin" | "exec_command_end" | "guardian_assessment" => {
                self.upsert_payload(payload, "commandExecution");
            }
            "apply_patch_approval_request" | "patch_apply_begin" | "patch_apply_end" => {
                self.upsert_payload(payload, "fileChange");
            }
            "dynamic_tool_call_request" | "dynamic_tool_call_response" => {
                self.upsert_payload(payload, "dynamicToolCall");
            }
            "mcp_tool_call_begin" | "mcp_tool_call_end" => {
                self.upsert_payload(payload, "mcpToolCall");
            }
            "view_image_tool_call" => self.upsert_payload(payload, "imageView"),
            "image_generation_begin" | "image_generation_end" => {
                self.upsert_payload(payload, "imageGeneration");
            }
            "collab_agent_spawn_begin"
            | "collab_agent_spawn_end"
            | "collab_agent_interaction_begin"
            | "collab_agent_interaction_end"
            | "collab_waiting_begin"
            | "collab_waiting_end"
            | "collab_close_begin"
            | "collab_close_end"
            | "collab_resume_begin"
            | "collab_resume_end" => self.upsert_payload(payload, "collabAgentToolCall"),
            "sub_agent_activity" => self.upsert_payload(payload, "subAgentActivity"),
            "context_compacted" => self.push_generated("contextCompaction", None),
            "entered_review_mode" => self.upsert_or_generate(payload, "enteredReviewMode"),
            "exited_review_mode" => self.upsert_or_generate(payload, "exitedReviewMode"),
            "item_started" | "item_completed" => self.upsert_materialized_item(payload),
            "error"
            | "token_count"
            | "thread_rolled_back"
            | "hook_started"
            | "hook_completed"
            | "thread_settings_applied" => {}
            other => {
                if !self
                    .unknown_event_kinds
                    .iter()
                    .any(|candidate| candidate == other)
                {
                    self.unknown_event_kinds.push(other.to_owned());
                }
            }
        }
    }

    fn push_generated(&mut self, kind: &str, text_bytes: Option<usize>) {
        self.generated = self.generated.saturating_add(1);
        self.items.push(ProjectedItem {
            key: format!("generated:{}", self.generated),
            kind: kind.to_owned(),
            text_bytes,
        });
    }

    fn upsert_payload(&mut self, payload: &Value, kind: &str) {
        let key = ["call_id", "item_id", "id"]
            .iter()
            .find_map(|name| payload.get(*name).and_then(Value::as_str))
            .map_or_else(
                || {
                    self.generated = self.generated.saturating_add(1);
                    format!("generated:{}", self.generated)
                },
                ToOwned::to_owned,
            );
        self.upsert(key, kind);
    }

    fn upsert_or_generate(&mut self, payload: &Value, kind: &str) {
        if payload.get("item_id").and_then(Value::as_str).is_some() {
            self.upsert_payload(payload, kind);
        } else {
            self.push_generated(kind, None);
        }
    }

    fn upsert_materialized_item(&mut self, payload: &Value) {
        let Some(item) = payload.get("item") else {
            return;
        };
        let (Some(id), Some(kind)) = (
            item.get("id").and_then(Value::as_str),
            item.get("type").and_then(Value::as_str),
        ) else {
            return;
        };
        self.upsert(id.to_owned(), canonical_materialized_item_kind(kind));
    }

    fn upsert(&mut self, key: String, kind: &str) {
        if let Some(index) = self.item_indexes.get(&key).copied() {
            kind.clone_into(&mut self.items[index].kind);
            return;
        }
        self.item_indexes.insert(key.clone(), self.items.len());
        self.items.push(ProjectedItem {
            key,
            kind: kind.to_owned(),
            text_bytes: None,
        });
    }

    fn final_agent(&self) -> Option<&ProjectedItem> {
        self.items
            .iter()
            .rev()
            .find(|item| item.kind == "agentMessage")
    }

    fn finish(self, id: String) -> TurnDigest {
        let first_user = self.items.iter().find(|item| item.kind == "userMessage");
        let final_agent_key = self.final_agent().map(|item| item.key.as_str());
        let final_agent_text_bytes = self.final_agent().and_then(|item| item.text_bytes);
        let activity_kinds: Vec<String> = self
            .items
            .iter()
            .filter(|item| item.kind != "userMessage")
            .filter(|item| Some(item.key.as_str()) != final_agent_key)
            .map(|item| item.kind.clone())
            .collect();
        TurnDigest {
            id,
            status: self.status,
            started_at: self.started_at,
            completed_at: self.completed_at,
            duration_ms: self.duration_ms,
            user_text_bytes: first_user.and_then(|item| item.text_bytes),
            final_agent_text_bytes,
            activity_count: activity_kinds.len(),
            activity_kinds,
            unknown_event_kinds: self.unknown_event_kinds,
        }
    }
}

fn canonical_materialized_item_kind(kind: &str) -> &str {
    match kind {
        "AgentMessage" => "agentMessage",
        "UserMessage" => "userMessage",
        _ => kind,
    }
}

/// Projects a bounded turn span into a privacy-safe semantic digest.
///
/// # Errors
///
/// Returns an error if the span is invalid or cannot be read. Malformed
/// crash-fragment records are skipped while later durable records remain
/// available.
pub fn digest_turn(path: &Path, turn: &TurnRef) -> Result<TurnDigest, HistoryError> {
    if turn.end_offset < turn.start_offset {
        return Err(HistoryError::InvalidSpan {
            start: turn.start_offset,
            end: turn.end_offset,
        });
    }
    let mut file = File::open(path)?;
    file.seek(SeekFrom::Start(turn.start_offset))?;
    let span_bytes = turn.end_offset - turn.start_offset;
    let mut reader = BufReader::new(file.take(span_bytes));
    let mut line = Vec::new();
    let mut builder = DigestBuilder {
        status: "inProgress".into(),
        ..DigestBuilder::default()
    };
    let mut malformed_records = 0_u64;
    loop {
        line.clear();
        let bytes = reader.read_until(b'\n', &mut line)?;
        if bytes == 0 {
            break;
        }
        if memchr::memmem::find(&line, b"\"type\":\"event_msg\"").is_some() {
            match serde_json::from_slice::<Value>(&line) {
                Ok(envelope) => {
                    if let Some(payload) = envelope.get("payload") {
                        builder.handle_event(payload);
                    }
                }
                Err(_) => malformed_records = malformed_records.saturating_add(1),
            }
        }
    }
    if malformed_records > 0 {
        tracing::warn!(malformed_records, "skipped malformed rollout records");
    }
    Ok(builder.finish(turn.id.clone()))
}

/// Projects one bounded rollout span into the V1 summary turn used by the UI.
///
/// Only user and final-agent response messages are materialized. Tool payloads
/// contribute activity metadata but never expand the summary response.
///
/// # Errors
///
/// Returns an error for invalid spans or I/O failures. Malformed crash
/// fragments are skipped while later durable records remain available.
pub fn project_summary_turn(path: &Path, turn: &TurnRef) -> Result<Value, HistoryError> {
    let file = File::open(path)?;
    project_summary_turn_from_file(&file, turn)
}

/// Projects from an already-open rollout snapshot so offsets and bytes always
/// refer to the same inode even while the canonical path is replaced.
pub(crate) fn project_summary_turn_from_file(
    file: &File,
    turn: &TurnRef,
) -> Result<Value, HistoryError> {
    Ok(summary_projection_state_from_file(file, turn)?.project())
}

pub(crate) fn summary_projection_state_from_file(
    file: &File,
    turn: &TurnRef,
) -> Result<SummaryProjectionState, HistoryError> {
    if turn.end_offset < turn.start_offset {
        return Err(HistoryError::InvalidSpan {
            start: turn.start_offset,
            end: turn.end_offset,
        });
    }
    let mut snapshot = file.try_clone()?;
    snapshot.seek(SeekFrom::Start(turn.start_offset))?;
    let mut reader = BufReader::new(snapshot.take(turn.end_offset - turn.start_offset));
    let mut line = Vec::new();
    let mut builder = SummaryProjectionState::new(turn.id.clone());
    let mut malformed_records = 0_u64;
    let mut offset = turn.start_offset;
    loop {
        line.clear();
        let bytes = reader.read_until(b'\n', &mut line)?;
        if bytes == 0 {
            break;
        }
        if builder.ingest_rollout_record(&line, offset).is_err() {
            malformed_records = malformed_records.saturating_add(1);
        }
        offset = offset.saturating_add(bytes as u64);
    }
    if malformed_records > 0 {
        tracing::warn!(malformed_records, "skipped malformed rollout records");
    }
    Ok(builder)
}

const SUMMARY_PROJECTION_VERSION: u8 = 2;

#[derive(Clone, Debug, Deserialize, Serialize)]
pub(crate) struct SummaryProjectionState {
    #[serde(default)]
    projection_version: u8,
    id: String,
    digest: DigestBuilder,
    user: Option<Value>,
    client_id: Option<String>,
    agent: Option<Value>,
    fallback_user: Option<String>,
    fallback_agent: Option<String>,
    fallback_agent_phase: Option<String>,
    error: Option<Value>,
    model: Option<String>,
    usage_baseline: Option<TokenCounts>,
    usage_total: Option<TokenCounts>,
    latest_request: Option<TokenCounts>,
    usage_requests: Vec<TokenCounts>,
    model_context_window: Option<u64>,
}

impl SummaryProjectionState {
    pub(crate) fn new(id: String) -> Self {
        Self {
            projection_version: SUMMARY_PROJECTION_VERSION,
            id,
            digest: DigestBuilder {
                status: "inProgress".into(),
                ..DigestBuilder::default()
            },
            user: None,
            client_id: None,
            agent: None,
            fallback_user: None,
            fallback_agent: None,
            fallback_agent_phase: None,
            error: None,
            model: None,
            usage_baseline: None,
            usage_total: None,
            latest_request: None,
            usage_requests: Vec::new(),
            model_context_window: None,
        }
    }

    fn handle_turn_context(&mut self, payload: &Value) {
        if let Some(model) = payload.get("model").and_then(Value::as_str) {
            self.model = Some(model.to_owned());
        }
    }

    fn handle_event(&mut self, payload: &Value) {
        match payload.get("type").and_then(Value::as_str) {
            Some("user_message") => {
                if self.fallback_user.is_none() {
                    self.fallback_user = payload
                        .get("message")
                        .and_then(Value::as_str)
                        .map(ToOwned::to_owned);
                }
                if self.client_id.is_none() {
                    self.client_id = payload
                        .get("client_id")
                        .and_then(Value::as_str)
                        .filter(|value| !value.is_empty())
                        .map(ToOwned::to_owned);
                }
            }
            Some("agent_message") => {
                if let Some(message) = payload.get("message").and_then(Value::as_str)
                    && !message.is_empty()
                {
                    self.fallback_agent = Some(message.to_owned());
                    self.fallback_agent_phase = payload
                        .get("phase")
                        .and_then(Value::as_str)
                        .map(ToOwned::to_owned);
                }
            }
            Some("task_complete") => {
                if let Some(message) = payload.get("last_agent_message").and_then(Value::as_str)
                    && !message.is_empty()
                {
                    self.fallback_agent = Some(message.to_owned());
                    self.fallback_agent_phase = Some("final_answer".into());
                }
                if let Some(error) = payload.get("error")
                    && !error.is_null()
                {
                    self.error = Some(json!({ "message": error_message(error) }));
                }
            }
            Some("token_count") => {
                if let Some((total, last, context)) = parse_rollout_usage(payload) {
                    self.usage_baseline
                        .get_or_insert_with(|| total.saturating_sub(last));
                    if self.usage_total != Some(total) {
                        self.usage_requests.push(last);
                    }
                    self.usage_total = Some(total);
                    self.latest_request = Some(last);
                    self.model_context_window = context.or(self.model_context_window);
                }
            }
            Some("item_started" | "item_completed") => {
                // Newer App Server rollouts materialize the authored prompt as
                // an item event instead of emitting a separate `user_message`
                // event. The stable client id is the ownership key used by the
                // Android optimistic row, so dropping it here leaves both the
                // canonical turn and the optimistic row visible forever.
                let item = payload.get("item");
                let user_message = item
                    .and_then(|item| item.get("type"))
                    .and_then(Value::as_str)
                    .is_some_and(|kind| matches!(kind, "UserMessage" | "userMessage"));
                if user_message && self.client_id.is_none() {
                    self.client_id = item
                        .and_then(|item| item.get("client_id").or_else(|| item.get("clientId")))
                        .and_then(Value::as_str)
                        .filter(|value| !value.is_empty())
                        .map(ToOwned::to_owned);
                }
            }
            _ => {}
        }
        self.digest.handle_event(payload);
    }

    pub(crate) const fn is_current(&self) -> bool {
        self.projection_version == SUMMARY_PROJECTION_VERSION
    }

    fn handle_response_message(&mut self, payload: &Value) {
        let Some(role) = payload.get("role").and_then(Value::as_str) else {
            return;
        };
        if role == "user" && is_environment_context_response_message(payload) {
            return;
        }
        let id = payload
            .get("id")
            .and_then(Value::as_str)
            .map_or_else(|| format!("{}:{role}", self.id), ToOwned::to_owned);
        match role {
            // A turn may contain injected context as an earlier user message.
            // App Server exposes the final user message as the actual prompt.
            "user" => {
                let content = payload
                    .get("content")
                    .and_then(Value::as_array)
                    .map_or_else(Vec::new, |content| {
                        content.iter().filter_map(project_user_input).collect()
                    });
                self.user = Some(json!({
                    "type": "userMessage",
                    "id": id,
                    "clientId": Value::Null,
                    "content": content
                }));
            }
            "assistant" => {
                let text = payload
                    .get("content")
                    .and_then(Value::as_array)
                    .map(|content| {
                        content
                            .iter()
                            .filter_map(|item| item.get("text").and_then(Value::as_str))
                            .collect::<String>()
                    })
                    .unwrap_or_default();
                if !text.is_empty() {
                    self.agent = Some(json!({
                        "type": "agentMessage",
                        "id": id,
                        "text": text,
                        "phase": message_phase(payload.get("phase").and_then(Value::as_str)),
                        "memoryCitation": Value::Null
                    }));
                }
            }
            _ => {}
        }
    }

    pub(crate) fn ingest_rollout_record(
        &mut self,
        line: &[u8],
        offset: u64,
    ) -> Result<(), HistoryError> {
        // Envelope type always lives near the beginning. Bounding these probes
        // is crucial for compacted records whose opaque payload can be many
        // megabytes and is irrelevant to the thread summary.
        let prefix = &line[..line.len().min(8 * 1024)];
        let relevant_event = memchr::memmem::find(prefix, b"\"type\":\"event_msg\"").is_some();
        let turn_context = memchr::memmem::find(prefix, b"\"type\":\"turn_context\"").is_some();
        let response_message = memchr::memmem::find(
            prefix,
            b"\"type\":\"response_item\",\"payload\":{\"type\":\"message\"",
        )
        .is_some();
        if !relevant_event && !response_message && !turn_context {
            return Ok(());
        }
        let envelope = serde_json::from_slice::<Value>(line)
            .map_err(|source| HistoryError::InvalidEvent { offset, source })?;
        let Some(payload) = envelope.get("payload") else {
            return Ok(());
        };
        if turn_context {
            self.handle_turn_context(payload);
        } else if relevant_event {
            self.handle_event(payload);
        } else {
            self.handle_response_message(payload);
        }
        Ok(())
    }

    #[must_use]
    pub(crate) fn project(&self) -> Value {
        self.clone().finish()
    }

    fn finish(mut self) -> Value {
        let usage = self.usage_projection(self.digest.status != "inProgress");
        let client_id = self.client_id.take().map_or(Value::Null, Value::String);
        if let Some(text) = self.fallback_user.take() {
            if let Some(content) = self
                .user
                .as_mut()
                .and_then(|user| user.get_mut("content"))
                .and_then(Value::as_array_mut)
            {
                content.retain(|item| item.get("type").and_then(Value::as_str) != Some("text"));
                content.insert(
                    0,
                    json!({ "type": "text", "text": text, "text_elements": [] }),
                );
            } else {
                self.user = Some(json!({
                    "type": "userMessage",
                    "id": format!("{}:user", self.id),
                    "clientId": client_id.clone(),
                    "content": [{ "type": "text", "text": text, "text_elements": [] }]
                }));
            }
        }
        if let Some(user) = self.user.as_mut().and_then(Value::as_object_mut) {
            user.insert("clientId".into(), client_id);
        }
        if let Some(text) = self.fallback_agent.take() {
            let phase = self
                .fallback_agent_phase
                .take()
                .map_or(Value::Null, Value::String);
            if let Some(agent) = self.agent.as_mut().and_then(Value::as_object_mut) {
                // event_msg/task_complete is the authoritative text fallback,
                // but response_item owns item identity. Replacing the whole
                // value here used to rotate a canonical message id into the
                // synthetic `<turn>:agent` id on every history refresh. A
                // subsequent live replay then appended the canonical item and
                // rendered the same message twice.
                agent.insert("text".into(), Value::String(text));
                agent.insert("phase".into(), phase);
            } else {
                self.agent = Some(json!({
                    "type": "agentMessage",
                    "id": format!("{}:agent", self.id),
                    "text": text,
                    "phase": phase,
                    "memoryCitation": Value::Null
                }));
            }
        }
        let mut items = Vec::with_capacity(2);
        if let Some(user) = self.user {
            items.push(user);
        }
        if let Some(agent) = self.agent {
            items.push(agent);
        }
        let digest = self.digest.finish(self.id.clone());
        let mut turn = json!({
            "id": self.id,
            "items": items,
            "itemsView": "summary",
            "status": digest.status,
            "error": self.error,
            "startedAt": digest.started_at,
            "completedAt": digest.completed_at,
            "durationMs": digest.duration_ms
        });
        if digest.activity_count > 0 || usage.is_some() {
            let mut metadata = serde_json::Map::new();
            if digest.activity_count > 0 {
                metadata.insert(
                    "activity".into(),
                    json!({
                        "count": digest.activity_count,
                        "kinds": digest.activity_kinds
                    }),
                );
            }
            if let Some(usage) = usage {
                metadata.insert(
                    "usage".into(),
                    serde_json::to_value(usage).unwrap_or(Value::Null),
                );
            }
            if let Some(object) = turn.as_object_mut() {
                object.insert("codewide".into(), Value::Object(metadata));
            }
        }
        turn
    }

    fn usage_projection(&self, final_status: bool) -> Option<TurnUsageProjection> {
        Some(projection_from_rollout(
            self.model.as_deref(),
            self.usage_baseline?,
            self.usage_total?,
            self.latest_request?,
            &self.usage_requests,
            self.model_context_window,
            final_status,
        ))
    }
}

fn project_user_input(item: &Value) -> Option<Value> {
    match item.get("type").and_then(Value::as_str)? {
        "input_text" => Some(json!({
            "type": "text",
            "text": item.get("text").and_then(Value::as_str).unwrap_or_default(),
            "text_elements": []
        })),
        "input_image" => Some(json!({
            "type": "image",
            "url": item.get("image_url").and_then(Value::as_str).unwrap_or_default()
        })),
        "input_audio" => Some(json!({
            "type": "audio",
            "url": item.get("audio_url").and_then(Value::as_str).unwrap_or_default()
        })),
        _ => None,
    }
}

fn is_environment_context_response_message(payload: &Value) -> bool {
    payload
        .get("content")
        .and_then(Value::as_array)
        .is_some_and(|content| {
            content.iter().any(|item| {
                item.get("type").and_then(Value::as_str) == Some("input_text")
                    && item
                        .get("text")
                        .and_then(Value::as_str)
                        .is_some_and(is_environment_context_text)
            })
        })
}

fn is_environment_context_text(value: &str) -> bool {
    const OPEN: &str = "<environment_context>";
    const CLOSE: &str = "</environment_context>";

    let trimmed = value.trim();
    let starts_with_marker = trimmed
        .get(..OPEN.len())
        .is_some_and(|candidate| candidate.eq_ignore_ascii_case(OPEN));
    let ends_with_marker = trimmed
        .get(trimmed.len().saturating_sub(CLOSE.len())..)
        .is_some_and(|candidate| candidate.eq_ignore_ascii_case(CLOSE));
    starts_with_marker && ends_with_marker
}

fn message_phase(phase: Option<&str>) -> Value {
    match phase {
        Some(phase) => Value::String(phase.to_owned()),
        None => Value::Null,
    }
}

fn error_message(error: &Value) -> String {
    error
        .get("message")
        .and_then(Value::as_str)
        .or_else(|| error.as_str())
        .unwrap_or("Turn failed")
        .to_owned()
}

fn integer(value: &Value, key: &str) -> Option<i64> {
    value.get(key).and_then(Value::as_i64)
}

#[cfg(test)]
mod tests {
    use std::io::Write;

    use super::{SummaryProjectionState, digest_turn, project_summary_turn};
    use crate::store::TurnRef;

    #[test]
    fn digests_summary_and_deduplicates_activity_updates() -> Result<(), Box<dyn std::error::Error>>
    {
        let directory = tempfile::tempdir()?;
        let path = directory.path().join("rollout.jsonl");
        let mut file = std::fs::File::create(&path)?;
        let lines = [
            r#"{"type":"event_msg","payload":{"type":"task_started","turn_id":"turn","started_at":10}}"#,
            r#"{"type":"event_msg","payload":{"type":"user_message","message":"hello","client_id":"android-command"}}"#,
            r#"{"type":"event_msg","payload":{"type":"agent_reasoning","text":"one"}}"#,
            r#"{"type":"event_msg","payload":{"type":"agent_reasoning","text":"two"}}"#,
            r#"{"type":"event_msg","payload":{"type":"exec_command_begin","call_id":"call"}}"#,
            r#"{"type":"event_msg","payload":{"type":"exec_command_end","call_id":"call"}}"#,
            r#"{"type":"event_msg","payload":{"type":"agent_message","message":"final"}}"#,
            r#"{"type":"event_msg","payload":{"type":"task_complete","turn_id":"turn","completed_at":12,"duration_ms":2000}}"#,
        ];
        for line in lines {
            writeln!(file, "{line}")?;
        }
        file.sync_all()?;
        let end = file.metadata()?.len();
        let digest = digest_turn(
            &path,
            &TurnRef {
                id: "turn".into(),
                start_offset: 0,
                end_offset: end,
                completed: true,
            },
        )?;
        assert_eq!(digest.status, "completed");
        assert_eq!(digest.user_text_bytes, Some(5));
        assert_eq!(digest.final_agent_text_bytes, Some(5));
        assert_eq!(digest.activity_kinds, ["reasoning", "commandExecution"]);
        Ok(())
    }

    #[test]
    fn summary_prefers_authoritative_task_complete_text() -> Result<(), Box<dyn std::error::Error>>
    {
        let directory = tempfile::tempdir()?;
        let path = directory.path().join("rollout.jsonl");
        let mut file = std::fs::File::create(&path)?;
        let lines = [
            r#"{"type":"event_msg","payload":{"type":"task_started","turn_id":"turn","started_at":10}}"#,
            r#"{"type":"response_item","payload":{"type":"message","id":"context-id","role":"user","content":[{"type":"input_text","text":"injected context"}]}}"#,
            r#"{"type":"response_item","payload":{"type":"message","id":"user-id","role":"user","content":[{"type":"input_text","text":"hello"},{"type":"input_text","text":"injected metadata"},{"type":"input_image","image_url":"private://image"}]}}"#,
            r#"{"type":"event_msg","payload":{"type":"user_message","message":"hello","client_id":"android-command"}}"#,
            r#"{"type":"response_item","payload":{"type":"message","id":"agent-id","role":"assistant","phase":"final_answer","content":[{"type":"output_text","text":"draft that is longer"}]}}"#,
            r#"{"type":"event_msg","payload":{"type":"agent_reasoning","text":"thinking"}}"#,
            r#"{"type":"event_msg","payload":{"type":"task_complete","turn_id":"turn","last_agent_message":"final","completed_at":12,"duration_ms":2000}}"#,
        ];
        for line in lines {
            writeln!(file, "{line}")?;
        }
        file.sync_all()?;
        let projected = project_summary_turn(
            &path,
            &TurnRef {
                id: "turn".into(),
                start_offset: 0,
                end_offset: file.metadata()?.len(),
                completed: true,
            },
        )?;
        assert_eq!(projected["status"], "completed");
        assert_eq!(projected["items"][0]["content"][0]["text"], "hello");
        assert_eq!(projected["items"][0]["content"][1]["type"], "image");
        assert_eq!(projected["items"][0]["clientId"], "android-command");
        assert_eq!(projected["items"][1]["id"], "agent-id");
        assert_eq!(projected["items"][1]["text"], "final");
        assert_eq!(projected["items"][1]["phase"], "final_answer");
        assert_eq!(projected["codewide"]["activity"]["kinds"][0], "reasoning");
        Ok(())
    }

    #[test]
    fn summary_preserves_client_id_from_materialized_user_item()
    -> Result<(), Box<dyn std::error::Error>> {
        let directory = tempfile::tempdir()?;
        let path = directory.path().join("rollout.jsonl");
        let mut file = std::fs::File::create(&path)?;
        for line in [
            r#"{"type":"event_msg","payload":{"type":"task_started","turn_id":"turn","started_at":10}}"#,
            r#"{"type":"response_item","payload":{"type":"message","id":"user-id","role":"user","content":[{"type":"input_text","text":"Test"}]}}"#,
            r#"{"type":"event_msg","payload":{"type":"item_completed","thread_id":"thread","turn_id":"turn","item":{"type":"UserMessage","id":"item-id","client_id":"android-command","content":[{"type":"text","text":"Test"}]}}}"#,
            r#"{"type":"event_msg","payload":{"type":"task_complete","turn_id":"turn","completed_at":12}}"#,
        ] {
            writeln!(file, "{line}")?;
        }
        file.sync_all()?;

        let projected = project_summary_turn(
            &path,
            &TurnRef {
                id: "turn".into(),
                start_offset: 0,
                end_offset: file.metadata()?.len(),
                completed: true,
            },
        )?;

        assert_eq!(projected["items"][0]["clientId"], "android-command");
        Ok(())
    }

    #[test]
    fn summary_does_not_count_materialized_messages_as_activity()
    -> Result<(), Box<dyn std::error::Error>> {
        let directory = tempfile::tempdir()?;
        let path = directory.path().join("rollout.jsonl");
        let mut file = std::fs::File::create(&path)?;
        for line in [
            r#"{"type":"event_msg","payload":{"type":"task_started","turn_id":"turn","started_at":10}}"#,
            r#"{"type":"event_msg","payload":{"type":"item_completed","item":{"type":"UserMessage","id":"user-id"}}}"#,
            r#"{"type":"event_msg","payload":{"type":"item_completed","item":{"type":"AgentMessage","id":"agent-id"}}}"#,
            r#"{"type":"event_msg","payload":{"type":"task_complete","turn_id":"turn","completed_at":12}}"#,
        ] {
            writeln!(file, "{line}")?;
        }
        file.sync_all()?;

        let digest = digest_turn(
            &path,
            &TurnRef {
                id: "turn".into(),
                start_offset: 0,
                end_offset: file.metadata()?.len(),
                completed: true,
            },
        )?;

        assert_eq!(digest.activity_count, 0);
        assert!(digest.activity_kinds.is_empty());
        Ok(())
    }

    #[test]
    fn persisted_summary_without_projection_version_is_stale()
    -> Result<(), Box<dyn std::error::Error>> {
        let mut serialized = serde_json::to_value(SummaryProjectionState::new("turn".into()))?;
        serialized
            .as_object_mut()
            .ok_or("summary state must be an object")?
            .remove("projection_version");
        let restored: SummaryProjectionState = serde_json::from_value(serialized)?;
        assert!(!restored.is_current());
        Ok(())
    }

    #[test]
    fn summary_omits_codex_environment_context_user_message()
    -> Result<(), Box<dyn std::error::Error>> {
        let directory = tempfile::tempdir()?;
        let path = directory.path().join("rollout.jsonl");
        let mut file = std::fs::File::create(&path)?;
        let lines = [
            r#"{"type":"event_msg","payload":{"type":"task_started","turn_id":"turn","started_at":10}}"#,
            r#"{"type":"response_item","payload":{"type":"message","id":"context-id","role":"user","content":[{"type":"input_text","text":"  <ENVIRONMENT_CONTEXT>\n  <cwd>/tmp</cwd>\n  <subagents>worker</subagents>\n</environment_context>  "}]}}"#,
            r#"{"type":"response_item","payload":{"type":"message","id":"agent-id","role":"assistant","phase":"final_answer","content":[{"type":"output_text","text":"Done"}]}}"#,
            r#"{"type":"event_msg","payload":{"type":"task_complete","turn_id":"turn","completed_at":12,"duration_ms":2000}}"#,
        ];
        for line in lines {
            writeln!(file, "{line}")?;
        }
        file.sync_all()?;

        let projected = project_summary_turn(
            &path,
            &TurnRef {
                id: "turn".into(),
                start_offset: 0,
                end_offset: file.metadata()?.len(),
                completed: true,
            },
        )?;

        assert_eq!(projected["items"].as_array().map(Vec::len), Some(1));
        assert_eq!(projected["items"][0]["type"], "agentMessage");
        assert_eq!(projected["items"][0]["text"], "Done");
        Ok(())
    }

    #[test]
    fn summary_keeps_authored_text_that_quotes_environment_context()
    -> Result<(), Box<dyn std::error::Error>> {
        let directory = tempfile::tempdir()?;
        let path = directory.path().join("rollout.jsonl");
        let mut file = std::fs::File::create(&path)?;
        let lines = [
            r#"{"type":"event_msg","payload":{"type":"task_started","turn_id":"turn","started_at":10}}"#,
            r#"{"type":"response_item","payload":{"type":"message","id":"user-id","role":"user","content":[{"type":"input_text","text":"'''<environment_context>internal</environment_context>''' visible report"}]}}"#,
            r#"{"type":"event_msg","payload":{"type":"task_complete","turn_id":"turn","completed_at":12,"duration_ms":2000}}"#,
        ];
        for line in lines {
            writeln!(file, "{line}")?;
        }
        file.sync_all()?;

        let projected = project_summary_turn(
            &path,
            &TurnRef {
                id: "turn".into(),
                start_offset: 0,
                end_offset: file.metadata()?.len(),
                completed: true,
            },
        )?;

        assert_eq!(projected["items"][0]["type"], "userMessage");
        assert_eq!(
            projected["items"][0]["content"][0]["text"],
            "'''<environment_context>internal</environment_context>''' visible report"
        );
        Ok(())
    }

    #[test]
    fn summary_skips_a_crash_fragment_and_keeps_later_records()
    -> Result<(), Box<dyn std::error::Error>> {
        let directory = tempfile::tempdir()?;
        let path = directory.path().join("rollout.jsonl");
        let mut file = std::fs::File::create(&path)?;
        let lines = [
            r#"{"type":"event_msg","payload":{"type":"task_started","turn_id":"turn","started_at":10}}"#,
            r#"{"type":"event_msg","payload":{"type":"user_message","message":"hello"}}"#,
            r#"{"type":"event_msg","payload":{"type":"agent_reasoning","text":"crash fragment"#,
            r#"{"type":"event_msg","payload":{"type":"task_complete","turn_id":"turn","last_agent_message":"final","completed_at":12}}"#,
        ];
        for line in lines {
            writeln!(file, "{line}")?;
        }
        file.sync_all()?;
        let projected = project_summary_turn(
            &path,
            &TurnRef {
                id: "turn".into(),
                start_offset: 0,
                end_offset: file.metadata()?.len(),
                completed: true,
            },
        )?;
        assert_eq!(projected["status"], "completed");
        assert_eq!(projected["items"][0]["content"][0]["text"], "hello");
        assert_eq!(projected["items"][1]["text"], "final");
        Ok(())
    }

    #[test]
    fn summary_projects_turn_usage_and_cost_from_canonical_requests()
    -> Result<(), Box<dyn std::error::Error>> {
        let directory = tempfile::tempdir()?;
        let path = directory.path().join("rollout.jsonl");
        let mut file = std::fs::File::create(&path)?;
        let lines = [
            r#"{"type":"event_msg","payload":{"type":"task_started","turn_id":"turn"}}"#,
            r#"{"type":"turn_context","payload":{"turn_id":"turn","model":"gpt-5.6-terra"}}"#,
            r#"{"type":"event_msg","payload":{"type":"token_count","info":{"total_token_usage":{"input_tokens":1000,"cached_input_tokens":500,"cache_write_input_tokens":0,"output_tokens":100,"reasoning_output_tokens":20,"total_tokens":1100},"last_token_usage":{"input_tokens":1000,"cached_input_tokens":500,"cache_write_input_tokens":0,"output_tokens":100,"reasoning_output_tokens":20,"total_tokens":1100},"model_context_window":258400}}}"#,
            r#"{"type":"event_msg","payload":{"type":"token_count","info":{"total_token_usage":{"input_tokens":3000,"cached_input_tokens":1500,"cache_write_input_tokens":0,"output_tokens":300,"reasoning_output_tokens":40,"total_tokens":3300},"last_token_usage":{"input_tokens":2000,"cached_input_tokens":1000,"cache_write_input_tokens":0,"output_tokens":200,"reasoning_output_tokens":20,"total_tokens":2200},"model_context_window":258400}}}"#,
            r#"{"type":"event_msg","payload":{"type":"task_complete","turn_id":"turn"}}"#,
        ];
        for line in lines {
            writeln!(file, "{line}")?;
        }
        file.sync_all()?;
        let projected = project_summary_turn(
            &path,
            &TurnRef {
                id: "turn".into(),
                start_offset: 0,
                end_offset: file.metadata()?.len(),
                completed: true,
            },
        )?;
        assert_eq!(projected["codewide"]["usage"]["status"], "final");
        assert_eq!(
            projected["codewide"]["usage"]["turn"]["tokens"]["totalTokens"],
            3_300
        );
        assert_eq!(
            projected["codewide"]["usage"]["latestRequest"]["totalTokens"],
            2_200
        );
        assert_eq!(
            projected["codewide"]["usage"]["modelContextWindow"],
            258_400
        );
        assert_eq!(
            projected["codewide"]["usage"]["turn"]["cost"]["model"],
            "gpt-5.6-terra"
        );
        assert_eq!(
            projected["codewide"]["usage"]["turn"]["cost"]["pricingVersion"],
            "openai-api-2026-08-17"
        );
        assert_eq!(
            projected["codewide"]["usage"]["thread"]["cost"]["model"],
            "gpt-5.6-terra"
        );
        assert!(
            projected["codewide"]["usage"]["thread"]["cost"]["totalCostUsd"]
                .as_f64()
                .is_some_and(|cost| cost > 0.0)
        );
        Ok(())
    }
}
