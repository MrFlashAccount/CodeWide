//! Client-wire request classification and neutral param decoding.
//!
//! Every client-wire method maps to one route: a thread-scoped call that
//! needs a capability (or none for core neutral operations), a host-level
//! call owned by the first provider declaring a capability, a merged call
//! answered from every provider, or thread creation. Unknown methods are
//! native host calls, which keeps unmapped Codex features working through
//! the `codex.native` surface.

use serde_json::Value;

use crate::agent::model::{
    AppThreadId, ApprovalDecision, Capability, ClientMessageId, ItemsView,
    MAX_BACKGROUND_TASK_PAGE_BYTES, RuntimeResponse, SortDirection, ThreadChange, TurnId,
    UserContent, UserInputAnswer,
};

/// Reads one page of a background task's output
/// (`threads.backgroundTaskOutput`).
pub const BACKGROUND_TASK_READ_METHOD: &str = "companion/thread/backgroundTask/read";

/// Methods answered from every enabled provider.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum MergedMethod {
    ThreadList,
    SupervisorThreadList,
    ModelList,
    PermissionProfileList,
}

/// Where a client-wire request goes.
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum MethodRoute {
    /// Thread-scoped. `requires` is `None` for core neutral operations.
    Thread {
        thread_id: String,
        requires: Option<Capability>,
    },
    /// Host-level, owned by the first provider declaring `owner`.
    Host {
        owner: Capability,
    },
    Merged(MergedMethod),
    ThreadStart,
}

/// Thread-scoped methods every provider supports through neutral operations.
const CORE_THREAD_METHODS: [&str; 11] = [
    "thread/read",
    "thread/resume",
    "thread/turns/list",
    "thread/items/list",
    "thread/name/set",
    "thread/archive",
    "thread/unarchive",
    "thread/delete",
    "thread/settings/update",
    "turn/start",
    "turn/interrupt",
];

/// The capability a thread-scoped method needs beyond the core operations.
#[must_use]
pub fn thread_capability(method: &str) -> Option<Capability> {
    if CORE_THREAD_METHODS.contains(&method) {
        return None;
    }
    Some(match method {
        "turn/steer" | "companion/queue/steer" => Capability::TurnsSteer,
        "thread/compact/start" => Capability::ThreadsCompact,
        "thread/fork" => Capability::ThreadsFork,
        "review/start" => Capability::Review,
        method if method.starts_with("thread/goal/") => Capability::Goals,
        method if method.starts_with("thread/backgroundTerminals/") => {
            Capability::BackgroundTerminals
        }
        method if method.starts_with("thread/realtime/") => Capability::RealtimeVoice,
        "companion/threadSubagents/read" => Capability::SubagentThreads,
        BACKGROUND_TASK_READ_METHOD => Capability::ThreadsBackgroundTaskOutput,
        method if is_thread_resource_method(method) => Capability::HistoryThreadResources,
        _ => Capability::CodexNative,
    })
}

/// Companion thread-resource reads served by the `history.threadResources` owner.
#[must_use]
pub fn is_thread_resource_method(method: &str) -> bool {
    matches!(
        method,
        "companion/threadResources/read"
            | "companion/threadAttachments/read"
            | "companion/threadChange/read"
            | "companion/threadChanges/read"
    )
}

/// The host capability that owns a connection-scoped method.
#[must_use]
pub fn host_capability(method: &str) -> Capability {
    match method {
        "config/read" => Capability::HostConfig,
        method if method.starts_with("fs/") => Capability::HostFs,
        "skills/list" => Capability::CatalogSkillsPlugins,
        method if method.starts_with("plugin/") || method.starts_with("app/") => {
            Capability::CatalogSkillsPlugins
        }
        "account/rateLimits/read" => Capability::AccountsRateLimits,
        method if method.starts_with("companion/accountPool/") => Capability::AccountsPool,
        "companion/providerRateLimits/reset/consume" => Capability::AccountsRateLimitResets,
        method if method.starts_with("companion/search") => Capability::HistoryMessageSearch,
        _ => Capability::CodexNative,
    }
}

/// Classifies one client-wire request.
#[must_use]
pub fn route(method: &str, params: &Value) -> MethodRoute {
    match method {
        "thread/start" => return MethodRoute::ThreadStart,
        "thread/list" => return MethodRoute::Merged(MergedMethod::ThreadList),
        "companion/supervisor/threadList" => {
            return MethodRoute::Merged(MergedMethod::SupervisorThreadList);
        }
        "model/list" => return MethodRoute::Merged(MergedMethod::ModelList),
        "permissionProfile/list" => {
            return MethodRoute::Merged(MergedMethod::PermissionProfileList);
        }
        _ => {}
    }
    if let Some(thread_id) = params.get("threadId").and_then(Value::as_str) {
        return MethodRoute::Thread {
            thread_id: thread_id.to_owned(),
            requires: thread_capability(method),
        };
    }
    MethodRoute::Host {
        owner: host_capability(method),
    }
}

/// Decodes client `UserInput` values. Skills, mentions and audio have no
/// neutral form; mentions and skills become their textual reference.
///
/// # Errors
/// Returns a message for an input kind the neutral protocol cannot carry.
pub fn user_contents(input: &Value) -> Result<Vec<UserContent>, String> {
    let Some(values) = input.as_array() else {
        return Err("input must be an array".into());
    };
    values
        .iter()
        .map(|value| {
            let kind = value.get("type").and_then(Value::as_str).unwrap_or("");
            let text = |field: &str| {
                value
                    .get(field)
                    .and_then(Value::as_str)
                    .map(str::to_owned)
                    .ok_or_else(|| format!("{kind} input requires {field}"))
            };
            match kind {
                "text" => Ok(UserContent::Text {
                    text: text("text")?,
                }),
                "image" => Ok(UserContent::Image { url: text("url")? }),
                "localImage" => Ok(UserContent::LocalImage {
                    path: text("path")?,
                }),
                "mention" | "skill" => Ok(UserContent::Text {
                    text: format!("@{}", text("path")?),
                }),
                other => Err(format!(
                    "{other} input is not supported by this thread's agent"
                )),
            }
        })
        .collect()
}

/// `clientUserMessageId` of a turn request.
#[must_use]
pub fn client_message_id(params: &Value) -> Option<ClientMessageId> {
    params
        .get("clientUserMessageId")
        .and_then(Value::as_str)
        .and_then(ClientMessageId::parse)
}

/// Thread id of a request.
#[must_use]
pub fn thread_id(params: &Value) -> Option<AppThreadId> {
    params
        .get("threadId")
        .and_then(Value::as_str)
        .and_then(AppThreadId::parse)
}

/// Turn id field of a request.
#[must_use]
pub fn turn_id(params: &Value, field: &str) -> Option<TurnId> {
    params
        .get(field)
        .and_then(Value::as_str)
        .and_then(TurnId::parse)
}

#[must_use]
pub fn sort_direction(params: &Value) -> SortDirection {
    match params.get("sortDirection").and_then(Value::as_str) {
        Some("asc") => SortDirection::Asc,
        _ => SortDirection::Desc,
    }
}

#[must_use]
pub fn items_view(params: &Value, default: ItemsView) -> ItemsView {
    match params.get("itemsView").and_then(Value::as_str) {
        Some("full") => ItemsView::Full,
        Some("summary") => ItemsView::Summary,
        Some("notLoaded") => ItemsView::NotLoaded,
        _ => default,
    }
}

/// The page `companion/thread/backgroundTask/read` asks for.
#[derive(Debug, Eq, PartialEq)]
pub struct BackgroundTaskPage {
    pub task_id: String,
    /// Byte offset; absent → 0.
    pub offset: u64,
    /// Page size in bytes; absent → the largest page, larger values are
    /// capped to it.
    pub limit: u32,
}

/// Decodes `{taskId, offset?, limit?}` of `companion/thread/backgroundTask/read`.
///
/// # Errors
/// Returns the `-32602` message for a missing task id, a negative or
/// fractional offset, or a limit that is not a positive integer.
pub fn background_task_page(params: &Value) -> Result<BackgroundTaskPage, &'static str> {
    let task_id = params
        .get("taskId")
        .and_then(Value::as_str)
        .filter(|task_id| !task_id.is_empty())
        .ok_or("taskId is required")?;
    let offset = match params.get("offset") {
        None | Some(Value::Null) => 0,
        Some(offset) => offset
            .as_u64()
            .ok_or("offset must be a non-negative integer")?,
    };
    let limit = match params.get("limit") {
        None | Some(Value::Null) => MAX_BACKGROUND_TASK_PAGE_BYTES,
        Some(limit) => limit
            .as_u64()
            .filter(|limit| *limit > 0)
            .ok_or("limit must be a positive integer")?
            .min(u64::from(MAX_BACKGROUND_TASK_PAGE_BYTES))
            .try_into()
            .unwrap_or(MAX_BACKGROUND_TASK_PAGE_BYTES),
    };
    Ok(BackgroundTaskPage {
        task_id: task_id.to_owned(),
        offset,
        limit,
    })
}

/// Settings change of `thread/settings/update` (fields the neutral model carries).
#[must_use]
pub fn settings_change(params: &Value) -> ThreadChange {
    let field = |name: &str| params.get(name).and_then(Value::as_str).map(str::to_owned);
    ThreadChange::Settings {
        model: field("model"),
        effort: field("effort"),
        permission_profile: field("permissions"),
        service_tier: field("serviceTier"),
    }
}

/// Execution overrides of a `turn/start` (the same fields as
/// `thread/settings/update`); `None` when the request carries none.
#[must_use]
pub fn turn_settings_overrides(params: &Value) -> Option<ThreadChange> {
    ["model", "effort", "permissions", "serviceTier"]
        .iter()
        .any(|name| params.get(*name).and_then(Value::as_str).is_some())
        .then(|| settings_change(params))
}

/// Execution settings a `thread/fork` request names for the new thread, in
/// the Codex `ThreadForkParams` shape: top-level `model` and `serviceTier`,
/// and `config.model_reasoning_effort`. A missing, non-string or empty
/// value is absent; values stay opaque provider strings.
#[derive(Debug, Default, Eq, PartialEq)]
pub struct RequestedSettings {
    pub model: Option<String>,
    pub effort: Option<String>,
    pub service_tier: Option<String>,
}

/// Decodes the [`RequestedSettings`] of a `thread/fork` request.
#[must_use]
pub fn requested_settings(params: &Value) -> RequestedSettings {
    let text = |value: Option<&Value>| {
        value
            .and_then(Value::as_str)
            .filter(|value| !value.is_empty())
            .map(str::to_owned)
    };
    RequestedSettings {
        model: text(params.get("model")),
        effort: text(params.pointer("/config/model_reasoning_effort")),
        service_tier: text(params.get("serviceTier")),
    }
}

/// Decodes a client answer to a runtime request into the neutral response.
/// Anything that is not a recognizable answer becomes `error`, which every
/// provider treats as a decline (never an allow).
#[must_use]
pub fn runtime_response(request_method: &str, response: &Value) -> RuntimeResponse {
    if let Some(error) = response.get("error") {
        return RuntimeResponse::Error {
            message: error
                .get("message")
                .and_then(Value::as_str)
                .unwrap_or("client rejected the request")
                .to_owned(),
        };
    }
    let result = response.get("result").unwrap_or(&Value::Null);
    match request_method {
        "item/commandExecution/requestApproval" | "item/fileChange/requestApproval" => {
            match result.get("decision").and_then(Value::as_str) {
                Some("accept") => RuntimeResponse::Approval {
                    decision: ApprovalDecision::Accept,
                },
                Some("acceptForSession") => RuntimeResponse::Approval {
                    decision: ApprovalDecision::AcceptForSession,
                },
                Some("decline") => RuntimeResponse::Approval {
                    decision: ApprovalDecision::Decline,
                },
                Some("cancel") => RuntimeResponse::Approval {
                    decision: ApprovalDecision::Cancel,
                },
                _ => RuntimeResponse::Error {
                    message: "unsupported approval decision".into(),
                },
            }
        }
        "item/tool/requestUserInput" => {
            let Some(answers) = result.get("answers").and_then(Value::as_object) else {
                return RuntimeResponse::Error {
                    message: "user input answer is missing".into(),
                };
            };
            RuntimeResponse::UserInput {
                answers: answers
                    .iter()
                    .map(|(question, answer)| {
                        let values = answer
                            .get("answers")
                            .and_then(Value::as_array)
                            .map(|values| {
                                values
                                    .iter()
                                    .filter_map(Value::as_str)
                                    .map(str::to_owned)
                                    .collect()
                            })
                            .unwrap_or_default();
                        (question.clone(), UserInputAnswer { answers: values })
                    })
                    .collect(),
            }
        }
        _ => RuntimeResponse::Capability {
            payload: result.clone(),
        },
    }
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    #[test]
    fn routes_follow_capabilities_not_provider_names() {
        assert_eq!(
            route("review/start", &json!({"threadId": "t"})),
            MethodRoute::Thread {
                thread_id: "t".into(),
                requires: Some(Capability::Review)
            }
        );
        assert_eq!(
            route("turn/start", &json!({"threadId": "t"})),
            MethodRoute::Thread {
                thread_id: "t".into(),
                requires: None
            }
        );
        assert_eq!(
            route("thread/goal/get", &json!({"threadId": "t"})),
            MethodRoute::Thread {
                thread_id: "t".into(),
                requires: Some(Capability::Goals)
            }
        );
        assert_eq!(
            route("fs/readDirectory", &json!({})),
            MethodRoute::Host {
                owner: Capability::HostFs
            }
        );
        assert_eq!(
            route(
                "companion/providerRateLimits/reset/consume",
                &json!({"providerId": "claude", "grantId": "weekly"})
            ),
            MethodRoute::Host {
                owner: Capability::AccountsRateLimitResets
            }
        );
        assert_eq!(
            route("future/method", &json!({})),
            MethodRoute::Host {
                owner: Capability::CodexNative
            }
        );
        assert_eq!(
            route("thread/list", &json!({})),
            MethodRoute::Merged(MergedMethod::ThreadList)
        );
    }

    #[test]
    fn a_background_task_read_needs_its_capability_and_a_bounded_page() {
        assert_eq!(
            route(
                BACKGROUND_TASK_READ_METHOD,
                &json!({"threadId": "t", "taskId": "b1"})
            ),
            MethodRoute::Thread {
                thread_id: "t".into(),
                requires: Some(Capability::ThreadsBackgroundTaskOutput)
            }
        );
        assert_eq!(
            background_task_page(&json!({"threadId": "t", "taskId": "b1"})),
            Ok(BackgroundTaskPage {
                task_id: "b1".into(),
                offset: 0,
                limit: MAX_BACKGROUND_TASK_PAGE_BYTES,
            })
        );
        assert_eq!(
            background_task_page(&json!({"taskId": "b1", "offset": 70_000, "limit": 1_000_000})),
            Ok(BackgroundTaskPage {
                task_id: "b1".into(),
                offset: 70_000,
                limit: MAX_BACKGROUND_TASK_PAGE_BYTES,
            })
        );
        assert_eq!(
            background_task_page(&json!({"taskId": "b1", "offset": null, "limit": 10})),
            Ok(BackgroundTaskPage {
                task_id: "b1".into(),
                offset: 0,
                limit: 10,
            })
        );
        assert_eq!(
            background_task_page(&json!({"taskId": ""})),
            Err("taskId is required")
        );
        assert_eq!(
            background_task_page(&json!({"taskId": "b1", "offset": -1})),
            Err("offset must be a non-negative integer")
        );
        assert_eq!(
            background_task_page(&json!({"taskId": "b1", "limit": 0})),
            Err("limit must be a positive integer")
        );
    }

    #[test]
    fn client_answers_decode_and_never_turn_failures_into_allow() {
        assert_eq!(
            runtime_response(
                "item/fileChange/requestApproval",
                &json!({"id": 1, "result": {"decision": "acceptForSession"}})
            ),
            RuntimeResponse::Approval {
                decision: ApprovalDecision::AcceptForSession
            }
        );
        for response in [
            json!({"id": 1, "error": {"message": "x"}}),
            json!({"id": 1, "result": {"decision": {"acceptWithExecpolicyAmendment": {}}}}),
            json!({"id": 1, "result": {}}),
        ] {
            assert!(matches!(
                runtime_response("item/commandExecution/requestApproval", &response),
                RuntimeResponse::Error { .. }
            ));
        }
        let answers = runtime_response(
            "item/tool/requestUserInput",
            &json!({"id": 1, "result": {"answers": {"q0": {"answers": ["a, b"]}}}}),
        );
        assert!(matches!(
            answers,
            RuntimeResponse::UserInput { answers } if answers["q0"].answers == ["a, b"]
        ));
    }

    #[test]
    fn decodes_user_input_and_rejects_audio() {
        let decoded = user_contents(&json!([
            {"type": "text", "text": "hi", "text_elements": []},
            {"type": "localImage", "path": "/a.png"},
            {"type": "mention", "name": "a", "path": "src/a.ts"}
        ]));
        assert_eq!(
            decoded,
            Ok(vec![
                UserContent::Text { text: "hi".into() },
                UserContent::LocalImage {
                    path: "/a.png".into()
                },
                UserContent::Text {
                    text: "@src/a.ts".into()
                },
            ])
        );
        assert!(user_contents(&json!([{"type": "audio", "url": "x"}])).is_err());
    }
}
