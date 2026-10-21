use std::sync::Arc;

use serde::Serialize;
use serde_json::{Value, json};

use crate::agent::{
    client_wire::{
        gateway::{ClientWireGateway, Target},
        history as provider_history, items,
    },
    model::{
        ItemsView, SortDirection, ThreadSettings, ThreadStatus, ThreadTurnsParams,
        thread_not_found_message,
    },
    provider::{
        HistorySyncRequest, NativeSurface, NativeThreadStore, ProviderError, ProviderFence,
    },
};

pub const READ_MODEL_VERSION: u64 = 4;

// Match App Server's explicit instruction to inspect this unloaded child.
// A generic RPC error code is insufficient: unrelated failures must stay visible.
const UNLOADED_SUBAGENT_RESUME: &str = "cannot resume an unloaded multi-agent v2 sub-agent through its parent; resume the parent first, or use thread/read to inspect it";

enum ThreadShellAccess {
    ExternalWriter,
    Observed {
        execution_settings: ThreadExecutionSettingsSnapshot,
    },
    UnloadedSubagent,
}

struct ThreadShellRead {
    access: ThreadShellAccess,
    fence: ProviderFence,
    result: Value,
}

/// Current App Server execution authority for one thread.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ThreadActivity {
    /// A turn is currently executing and a queued turn must wait.
    Active,
    /// No turn is executing, so a queued turn may be admitted.
    Idle,
    /// App Server cannot establish a safe lifecycle state.
    Unavailable,
}

/// App Server-owned settings that apply to subsequent turns in one thread.
#[derive(Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
struct ThreadExecutionSettingsSnapshot {
    model: String,
    /// The provider catalog's name of `model`, for the client to show as is.
    #[serde(skip_serializing_if = "Option::is_none")]
    model_label: Option<String>,
    effort: Option<String>,
    service_tier: Option<String>,
    permissions: Option<String>,
    approval_policy: String,
    sandbox_policy: String,
}

#[derive(Clone)]
pub struct ThreadViewService {
    gateway: Arc<ClientWireGateway>,
}

#[derive(Debug, thiserror::Error)]
pub enum ThreadViewError {
    #[error(transparent)]
    Upstream(#[from] ProviderError),
    #[error("{0}")]
    Route(String),
    /// The native provider's stored history could not be read.
    #[error("{0}")]
    History(String),
    #[error("App Server request failed: {0}")]
    Rpc(String),
    #[error("thread sync request is invalid")]
    InvalidRequest,
    #[error("App Server returned an invalid thread status")]
    InvalidStatus,
    #[error("thread/sync returned an invalid active turn")]
    InvalidActiveTurn,
    #[error("thread/resume returned invalid execution settings")]
    InvalidExecutionSettings,
}

impl ThreadViewError {
    /// Whether the error says that `thread_id` does not exist: the companion
    /// knows no such thread, or its provider no longer has it.
    #[must_use]
    pub fn is_thread_not_found(&self, thread_id: &str) -> bool {
        let message = match self {
            Self::Route(message) | Self::Rpc(message) => message.as_str(),
            Self::Upstream(ProviderError::Rejected(error)) => error.message.as_str(),
            _ => return false,
        };
        message == thread_not_found_message(thread_id)
    }
}

impl ThreadViewService {
    #[must_use]
    pub fn new(gateway: Arc<ClientWireGateway>) -> Self {
        Self { gateway }
    }

    async fn target(&self, thread_id: &str) -> Result<Target, ThreadViewError> {
        self.gateway
            .resolve_thread(thread_id, None)
            .await
            .map_err(|failure| ThreadViewError::Route(failure.message))
    }

    /// Reads the provider-owned lifecycle used to admit a queued turn.
    ///
    /// # Errors
    ///
    /// Returns an error when the provider cannot provide a valid thread status.
    pub async fn activity(&self, thread_id: &str) -> Result<ThreadActivity, ThreadViewError> {
        let target = self.target(thread_id).await?;
        let Some(native) = target.native() else {
            let read = target.provider.thread_read(&target.thread_id).await?;
            return Ok(match read.thread.status {
                ThreadStatus::Active => ThreadActivity::Active,
                // A failed turn is not a permanent lock for neutral providers:
                // they accept the next turn.
                ThreadStatus::Idle | ThreadStatus::NotLoaded | ThreadStatus::Failed => {
                    ThreadActivity::Idle
                }
                // Another process holds the session: a queued turn waits until
                // it lets go instead of failing against it.
                ThreadStatus::OpenElsewhere => ThreadActivity::Unavailable,
            });
        };
        let response = native
            .request(json!({
                "id": "thread-view-activity",
                "method": "thread/read",
                "params": {
                    "threadId": thread_id,
                    "includeTurns": false,
                },
            }))
            .await?;
        let result = rpc_result(&response)?;
        queue_activity(&result)
    }

    /// Synchronizes immutable indexed history and the mutable App Server head,
    /// then leaves the single Companion transport observing resumable threads.
    /// Unloaded multi-agent children remain inspectable without reviving a parent.
    ///
    /// # Errors
    ///
    /// Returns an error when parameters are invalid or either authoritative
    /// source cannot produce its bounded projection.
    pub async fn sync(&self, params: &Value) -> Result<Value, ThreadViewError> {
        let params = params.as_object().ok_or(ThreadViewError::InvalidRequest)?;
        let thread_id = params
            .get("threadId")
            .and_then(Value::as_str)
            .ok_or(ThreadViewError::InvalidRequest)?;
        let after_turn_id = params.get("afterTurnId").and_then(Value::as_str);
        let source_witness = params
            .get("sourceWitness")
            .filter(|value| !value.is_null())
            .map(|value| value.as_str().ok_or(ThreadViewError::InvalidRequest))
            .transpose()?;
        let limit = params
            .get("limit")
            .and_then(Value::as_u64)
            .and_then(|value| usize::try_from(value).ok())
            .unwrap_or(36);

        let target = self.target(thread_id).await?;
        let Some(native) = target.native() else {
            return self
                .sync_neutral(&target, after_turn_id, source_witness, limit)
                .await;
        };
        let thread_store = native.thread_store().ok_or_else(|| {
            ThreadViewError::History("Thread history storage is unavailable".into())
        })?;
        let ThreadShellRead {
            access,
            fence: shell_fence,
            result,
        } = Self::read_thread_shell(native, thread_id).await?;
        let mut thread = result
            .get("thread")
            .cloned()
            .ok_or(ThreadViewError::InvalidStatus)?;
        let active = match thread.pointer("/status/type").and_then(Value::as_str) {
            Some("active") => true,
            Some("idle" | "notLoaded" | "systemError") => false,
            _ => return Err(ThreadViewError::InvalidStatus),
        };
        let thread_object = thread
            .as_object_mut()
            .ok_or(ThreadViewError::InvalidStatus)?;
        thread_object.insert("turns".into(), Value::Array(Vec::new()));
        if matches!(&access, ThreadShellAccess::ExternalWriter) {
            // `thread/read` does not own mutation authority. Publish the
            // proven writer conflict through the existing client capability.
            thread_object.insert("canAcceptDirectInput".into(), Value::Bool(false));
        }
        // The thread's agent, as on every other projected thread: the client
        // offers only its provider's models, so a switch goes through a fork.
        target.wire.attach_extension(&mut thread);
        let (execution_settings, mut active_turn, fence) = match access {
            ThreadShellAccess::ExternalWriter => {
                let active_turn = if active {
                    Self::read_external_active_turn(thread_store.as_ref(), thread_id).await?
                } else {
                    Value::Null
                };
                (None, active_turn, shell_fence)
            }
            ThreadShellAccess::Observed { execution_settings } => {
                let (active_turn, fence) = if active {
                    Self::read_active_turn(native, thread_id).await?
                } else {
                    (Value::Null, shell_fence)
                };
                (Some(execution_settings), active_turn, fence)
            }
            ThreadShellAccess::UnloadedSubagent => {
                let (active_turn, fence) = if active {
                    Self::read_active_turn(native, thread_id).await?
                } else {
                    (Value::Null, shell_fence)
                };
                (None, active_turn, fence)
            }
        };
        let active_turn_id = active_turn.get("id").and_then(Value::as_str);
        let mut history = thread_store
            .sync_history(HistorySyncRequest {
                thread_id,
                after_turn_id,
                limit,
                active_turn_id,
                source_witness,
            })
            .await
            .map_err(ThreadViewError::History)?;
        thread_store
            .enrich_active_turn(thread_id, &mut active_turn)
            .await
            .map_err(ThreadViewError::History)?;
        Self::label_turns(&target, &mut history, &mut active_turn);
        let through_cursor = fence.wait().await?;
        Ok(json!({
            "readModelVersion": READ_MODEL_VERSION,
            "throughCursor": through_cursor,
            "thread": thread,
            "executionSettings": execution_settings.map(|settings| Self::named(&target, settings)),
            "history": history,
            "activeTurn": active_turn,
        }))
    }

    async fn read_thread_shell(
        native: &dyn NativeSurface,
        thread_id: &str,
    ) -> Result<ThreadShellRead, ThreadViewError> {
        let (response, fence) = native
            .request_fenced(json!({
                "id": "thread-view-observe",
                "method": "thread/resume",
                "params": {
                    "threadId": thread_id,
                    "excludeTurns": true,
                },
            }))
            .await?;
        match rpc_result(&response) {
            Err(ThreadViewError::Rpc(message)) if message == UNLOADED_SUBAGENT_RESUME => {
                // Inspection must not restart the parent execution tree. Keep history
                // bounded through the stored history, rather than includeTurns=true.
                let (stored, stored_fence) = native
                    .request_fenced(json!({
                        "id": "thread-view-inspect",
                        "method": "thread/read",
                        "params": {"threadId": thread_id, "includeTurns": false},
                    }))
                    .await?;
                Ok(ThreadShellRead {
                    access: ThreadShellAccess::UnloadedSubagent,
                    fence: stored_fence,
                    result: rpc_result(&stored)?,
                })
            }
            Err(ThreadViewError::Rpc(message))
                if is_active_writer_conflict(&message, thread_id) =>
            {
                // Another App Server owns mutation, but its stored shell and
                // canonical rollout remain safe read-only authorities.
                let (stored, stored_fence) = native
                    .request_fenced(json!({
                        "id": "thread-view-read-external",
                        "method": "thread/read",
                        "params": {"threadId": thread_id, "includeTurns": false},
                    }))
                    .await?;
                Ok(ThreadShellRead {
                    access: ThreadShellAccess::ExternalWriter,
                    fence: stored_fence,
                    result: rpc_result(&stored)?,
                })
            }
            result => {
                let result = result?;
                let execution_settings = thread_execution_settings(&result)?;
                Ok(ThreadShellRead {
                    access: ThreadShellAccess::Observed { execution_settings },
                    fence,
                    result,
                })
            }
        }
    }

    async fn read_external_active_turn(
        thread_store: &dyn NativeThreadStore,
        thread_id: &str,
    ) -> Result<Value, ThreadViewError> {
        let params = json!({
            "threadId": thread_id,
            "cursor": null,
            "limit": 1,
            "sortDirection": "desc",
            "itemsView": "summary",
        });
        let Some(page) = thread_store.turns_page("thread/turns/list", &params).await else {
            return Err(ThreadViewError::InvalidActiveTurn);
        };
        let page = page.map_err(ThreadViewError::History)?;
        Ok(page
            .get("data")
            .and_then(Value::as_array)
            .and_then(|turns| turns.first())
            .filter(|turn| turn.get("status").and_then(Value::as_str) == Some("inProgress"))
            .cloned()
            .unwrap_or(Value::Null))
    }

    /// Reads the complete semantic mutable head. Large content is externalized
    /// by the downstream projector; item shells must remain present so the
    /// client can apply only the durable event tail after this snapshot.
    async fn read_active_turn(
        native: &dyn NativeSurface,
        thread_id: &str,
    ) -> Result<(Value, ProviderFence), ThreadViewError> {
        let (response, fence) = native
            .request_fenced(json!({
                "id": "thread-view-sync-active",
                "method": "thread/turns/list",
                "params": {
                    "threadId": thread_id,
                    "cursor": null,
                    "limit": 1,
                    "sortDirection": "desc",
                    "itemsView": "full",
                },
            }))
            .await?;
        let page = rpc_result(&response)?;
        let turn = page
            .get("data")
            .and_then(Value::as_array)
            .and_then(|turns| turns.first())
            .cloned()
            .ok_or(ThreadViewError::InvalidActiveTurn)?;
        Ok((turn, fence))
    }
}

fn is_active_writer_conflict(message: &str, thread_id: &str) -> bool {
    message == format!("thread {thread_id} already has an active writer")
}

impl ThreadViewService {
    /// The thread's provider's name of `model`, shown by the client as is.
    fn model_label(target: &Target, model: &str) -> Option<String> {
        target.provider.model_names()?.label(model)
    }

    /// The settings with the provider's name of their model.
    fn named(
        target: &Target,
        mut settings: ThreadExecutionSettingsSnapshot,
    ) -> ThreadExecutionSettingsSnapshot {
        settings.model_label = Self::model_label(target, &settings.model);
        settings
    }

    /// Names the model of every cost the snapshot's turns carry.
    fn label_turns(target: &Target, history: &mut Value, active_turn: &mut Value) {
        let Some(names) = target.provider.model_names() else {
            return;
        };
        if let Some(turns) = history.get_mut("turns").and_then(Value::as_array_mut) {
            crate::model_labels::label_turns(turns, names.as_ref());
        }
        if !active_turn.is_null() {
            crate::model_labels::label_turns(std::slice::from_mut(active_turn), names.as_ref());
        }
    }

    /// The same snapshot for a provider without the native surface: thread
    /// shell and active turn from neutral reads (fenced on the provider's
    /// event stream), history from its finished turns.
    async fn sync_neutral(
        &self,
        target: &Target,
        after_turn_id: Option<&str>,
        source_witness: Option<&str>,
        limit: usize,
    ) -> Result<Value, ThreadViewError> {
        let (read, shell_fence) = target
            .provider
            .thread_read_fenced(&target.thread_id)
            .await?;
        let (mut active_turn, fence) = if read.active_turn_id.is_some() {
            let (page, fence) = target
                .provider
                .thread_turns_fenced(ThreadTurnsParams {
                    app_thread_id: target.thread_id.clone(),
                    cursor: None,
                    limit: 1,
                    sort_direction: SortDirection::Desc,
                    items_view: ItemsView::Full,
                })
                .await?;
            let active = page
                .turns
                .first()
                .map_or(Value::Null, |turn| items::turn(turn, ItemsView::Full));
            (active, fence)
        } else {
            (Value::Null, shell_fence)
        };
        let (turns, head_turn_id, older_cursor) =
            provider_history::latest(target, limit.clamp(1, 100))
                .await
                .map_err(|failure| ThreadViewError::Route(failure.message))?;
        let mut history = provider_history::sync_history(
            &turns,
            head_turn_id.as_deref(),
            older_cursor.as_deref(),
            after_turn_id,
            source_witness,
        );
        Self::label_turns(target, &mut history, &mut active_turn);
        let thread = items::thread(&read.thread, &target.wire, &[]);
        let through_cursor = fence.wait().await?;
        Ok(json!({
            "readModelVersion": READ_MODEL_VERSION,
            "throughCursor": through_cursor,
            "thread": thread,
            "executionSettings": neutral_execution_settings(
                &read.thread.settings,
                Self::model_label(target, &read.thread.settings.model),
            ),
            "history": history,
            "activeTurn": active_turn,
        }))
    }
}

fn neutral_execution_settings(
    settings: &ThreadSettings,
    model_label: Option<String>,
) -> ThreadExecutionSettingsSnapshot {
    let (approval_policy, sandbox_policy) =
        crate::agent::client_wire::settings::legacy_policy_names(&settings.permission_profile);
    ThreadExecutionSettingsSnapshot {
        model: settings.model.clone(),
        model_label,
        effort: settings.effort.clone(),
        service_tier: settings.service_tier.clone(),
        permissions: Some(settings.permission_profile.clone()),
        approval_policy: approval_policy.to_owned(),
        sandbox_policy: sandbox_policy.to_owned(),
    }
}

fn thread_execution_settings(
    result: &Value,
) -> Result<ThreadExecutionSettingsSnapshot, ThreadViewError> {
    let model = required_string(result, "model")?;
    if model.is_empty() {
        return Err(ThreadViewError::InvalidExecutionSettings);
    }
    let active_permission_profile = result
        .get("activePermissionProfile")
        .ok_or(ThreadViewError::InvalidExecutionSettings)?;
    let permissions = if active_permission_profile.is_null() {
        None
    } else {
        Some(required_string(active_permission_profile, "id")?)
    };
    let approval_policy = match result.get("approvalPolicy") {
        Some(Value::String(value)) => value.clone(),
        Some(Value::Object(value)) if value.contains_key("granular") => "granular".to_owned(),
        _ => return Err(ThreadViewError::InvalidExecutionSettings),
    };
    let sandbox = result
        .get("sandbox")
        .ok_or(ThreadViewError::InvalidExecutionSettings)?;
    Ok(ThreadExecutionSettingsSnapshot {
        model,
        model_label: None,
        effort: nullable_string(result, "reasoningEffort")?,
        service_tier: nullable_string(result, "serviceTier")?,
        permissions,
        approval_policy,
        sandbox_policy: required_string(sandbox, "type")?,
    })
}

fn required_string(value: &Value, field: &str) -> Result<String, ThreadViewError> {
    value
        .get(field)
        .and_then(Value::as_str)
        .map(str::to_owned)
        .ok_or(ThreadViewError::InvalidExecutionSettings)
}

fn nullable_string(value: &Value, field: &str) -> Result<Option<String>, ThreadViewError> {
    match value.get(field) {
        Some(Value::Null) => Ok(None),
        Some(Value::String(value)) => Ok(Some(value.clone())),
        _ => Err(ThreadViewError::InvalidExecutionSettings),
    }
}

/// A failed turn is not a permanent input lock. Only an explicit capability
/// makes systemError dispatchable; active turns must still preserve queue order.
fn queue_activity(result: &Value) -> Result<ThreadActivity, ThreadViewError> {
    match result
        .pointer("/thread/status/type")
        .and_then(Value::as_str)
    {
        Some("active") => Ok(ThreadActivity::Active),
        Some("idle" | "notLoaded") => Ok(ThreadActivity::Idle),
        Some("systemError") => {
            if result
                .pointer("/thread/canAcceptDirectInput")
                .and_then(Value::as_bool)
                == Some(true)
            {
                Ok(ThreadActivity::Idle)
            } else {
                Ok(ThreadActivity::Unavailable)
            }
        }
        _ => Err(ThreadViewError::InvalidStatus),
    }
}

fn rpc_result(response: &Value) -> Result<Value, ThreadViewError> {
    if let Some(error) = response.get("error") {
        let message = error
            .get("message")
            .and_then(Value::as_str)
            .unwrap_or("unknown App Server error");
        return Err(ThreadViewError::Rpc(message.to_owned()));
    }
    response
        .get("result")
        .cloned()
        .ok_or(ThreadViewError::InvalidRequest)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::agent::model::RpcError;

    #[test]
    fn only_a_missing_thread_reads_as_not_found() {
        let missing = thread_not_found_message("t");
        assert!(ThreadViewError::Route(missing.clone()).is_thread_not_found("t"));
        assert!(ThreadViewError::Rpc(missing.clone()).is_thread_not_found("t"));
        assert!(
            ThreadViewError::Upstream(ProviderError::Rejected(RpcError::new(-32_600, missing)))
                .is_thread_not_found("t")
        );
        assert!(
            !ThreadViewError::Route(thread_not_found_message("other")).is_thread_not_found("t")
        );
        assert!(
            !ThreadViewError::Route("Thread binding is unavailable".into())
                .is_thread_not_found("t")
        );
        assert!(!ThreadViewError::InvalidRequest.is_thread_not_found("t"));
    }

    #[test]
    fn active_writer_conflict_matches_only_the_requested_thread() {
        assert!(is_active_writer_conflict(
            "thread t already has an active writer",
            "t"
        ));
        assert!(!is_active_writer_conflict(
            "thread other already has an active writer",
            "t"
        ));
        assert!(!is_active_writer_conflict("access denied", "t"));
    }

    #[test]
    fn failed_turn_allows_next_queued_prompt_only_with_explicit_authority()
    -> Result<(), ThreadViewError> {
        assert_eq!(
            queue_activity(&json!({"thread": {
                "status": {"type": "systemError"}, "canAcceptDirectInput": true
            }}))?,
            ThreadActivity::Idle
        );
        for capability in [json!(false), Value::Null, json!("true")] {
            assert_eq!(
                queue_activity(&json!({"thread": {
                    "status": {"type": "systemError"}, "canAcceptDirectInput": capability
                }}))?,
                ThreadActivity::Unavailable
            );
        }
        assert_eq!(
            queue_activity(&json!({"thread": {
                "status": {"type": "systemError"}
            }}))?,
            ThreadActivity::Unavailable
        );
        Ok(())
    }

    #[test]
    fn direct_input_capability_does_not_steer_a_queued_prompt_into_an_active_turn()
    -> Result<(), ThreadViewError> {
        assert_eq!(
            queue_activity(&json!({"thread": {
                "status": {"type": "active"}, "canAcceptDirectInput": true
            }}))?,
            ThreadActivity::Active
        );
        for status in ["idle", "notLoaded"] {
            assert_eq!(
                queue_activity(&json!({"thread": {
                    "status": {"type": status}
                }}))?,
                ThreadActivity::Idle
            );
        }
        assert!(matches!(
            queue_activity(&json!({"thread": {}})),
            Err(ThreadViewError::InvalidStatus)
        ));
        Ok(())
    }

    #[test]
    fn resume_settings_are_projected_as_one_authoritative_snapshot() -> Result<(), ThreadViewError>
    {
        let settings = thread_execution_settings(&json!({
            "model": "gpt-5.6-sol",
            "reasoningEffort": "high",
            "serviceTier": "priority",
            "activePermissionProfile": {"id": ":workspace"},
            "approvalPolicy": {"granular": {"rules": true}},
            "sandbox": {"type": "workspaceWrite"}
        }))?;

        assert_eq!(
            settings,
            ThreadExecutionSettingsSnapshot {
                model: "gpt-5.6-sol".to_owned(),
                model_label: None,
                effort: Some("high".to_owned()),
                service_tier: Some("priority".to_owned()),
                permissions: Some(":workspace".to_owned()),
                approval_policy: "granular".to_owned(),
                sandbox_policy: "workspaceWrite".to_owned(),
            }
        );
        Ok(())
    }

    #[test]
    fn neutral_settings_carry_the_provider_name_of_the_model() {
        let settings = crate::agent::testing::thread("claude", "thread-1", 1).settings;
        let named = serde_json::to_value(neutral_execution_settings(
            &settings,
            Some("Opus 5.5".into()),
        ));
        assert_eq!(
            named
                .ok()
                .and_then(|value| value.get("modelLabel").cloned()),
            Some(json!("Opus 5.5"))
        );
        let unnamed = serde_json::to_value(neutral_execution_settings(&settings, None));
        assert!(unnamed.is_ok_and(|value| value.get("modelLabel").is_none()));
    }

    #[test]
    fn resume_settings_preserve_explicit_default_and_nullable_values() -> Result<(), ThreadViewError>
    {
        let settings = thread_execution_settings(&json!({
            "model": "gpt-5.6-sol",
            "reasoningEffort": null,
            "serviceTier": "default",
            "activePermissionProfile": null,
            "approvalPolicy": "never",
            "sandbox": {"type": "dangerFullAccess"}
        }))?;

        assert_eq!(settings.service_tier.as_deref(), Some("default"));
        assert_eq!(settings.effort, None);
        assert_eq!(settings.permissions, None);
        assert_eq!(settings.approval_policy, "never");
        assert_eq!(settings.sandbox_policy, "dangerFullAccess");
        Ok(())
    }

    #[test]
    fn resume_settings_reject_an_incomplete_security_snapshot() {
        assert!(matches!(
            thread_execution_settings(&json!({
                "model": "gpt-5.6-sol",
                "reasoningEffort": "high",
                "serviceTier": "priority",
                "activePermissionProfile": null,
                "approvalPolicy": "never"
            })),
            Err(ThreadViewError::InvalidExecutionSettings)
        ));
    }
}
