//! Neutral events → client-wire notifications and server requests.
//!
//! The projector is stateful per provider stream: it remembers the last
//! projected lifecycle of each thread so a full `thread.updated` snapshot
//! becomes only the wire notifications that describe what changed (the
//! client treats `thread/started` as a replacement, so it is never emitted
//! for an existing thread). Thread creation emits `thread/started` from the
//! creating RPC instead.

use std::collections::HashMap;

use serde_json::{Value, json};
use tracing::debug;

use super::{WireProvider, items, request_ids, settings};
use crate::agent::model::{
    AgentEvent, AgentThread, AppThreadId, ApprovalDecision, ApprovalKind, Capability, ItemDelta,
    NativeRequestId, PlanStepStatus, RuntimeRequest, RuntimeRequestId, ThreadSettings,
    ThreadStatus, TokenUsage,
};

/// Appended to the text of a multi-select question: the client card offers
/// a single choice, so several answers travel in the free-text answer.
pub const MULTI_SELECT_NOTE: &str =
    " (several allowed: type them in your own answer, separated by commas)";

const MAX_TRACKED_THREADS: usize = 8_192;

#[derive(Clone, Debug, PartialEq)]
struct ThreadSnapshot {
    status: ThreadStatus,
    name: Option<String>,
    archived: bool,
    settings: ThreadSettings,
}

impl From<&AgentThread> for ThreadSnapshot {
    fn from(thread: &AgentThread) -> Self {
        Self {
            status: thread.status,
            name: thread.name.clone(),
            archived: thread.archived,
            settings: thread.settings.clone(),
        }
    }
}

/// Projects one provider's ordered neutral events.
pub struct EventProjector {
    provider: WireProvider,
    threads: HashMap<AppThreadId, ThreadSnapshot>,
}

impl EventProjector {
    #[must_use]
    pub fn new(provider: WireProvider) -> Self {
        Self {
            provider,
            threads: HashMap::new(),
        }
    }

    /// The provider whose events this projector translates.
    #[must_use]
    pub fn provider_id(&self) -> &crate::agent::model::ProviderId {
        &self.provider.descriptor.id
    }

    /// Records a thread the companion just created or read, so later
    /// snapshots are diffed against it.
    pub fn observe_thread(&mut self, thread: &AgentThread) {
        if self.threads.len() >= MAX_TRACKED_THREADS {
            self.threads.clear();
        }
        self.threads
            .insert(thread.app_thread_id.clone(), ThreadSnapshot::from(thread));
    }

    /// Projects one event into zero or more wire payloads, in order.
    // WHY: one exhaustive match over the event union is the projection table;
    // splitting it would scatter the wire shapes across helpers.
    #[allow(clippy::too_many_lines)]
    #[must_use]
    pub fn project(&mut self, event: AgentEvent) -> Vec<Value> {
        match event {
            AgentEvent::ThreadUpdated { thread } => self.thread_updated(&thread),
            AgentEvent::TurnStarted {
                app_thread_id,
                turn,
            } => vec![json!({
                "method": "turn/started",
                "params": {
                    "threadId": app_thread_id.as_str(),
                    "turn": items::turn(&turn, crate::agent::model::ItemsView::Full),
                }
            })],
            AgentEvent::TurnCompleted {
                app_thread_id,
                turn,
            } => vec![json!({
                "method": "turn/completed",
                "params": {
                    "threadId": app_thread_id.as_str(),
                    "turn": items::turn(&turn, crate::agent::model::ItemsView::Full),
                }
            })],
            AgentEvent::ItemStarted {
                app_thread_id,
                turn_id,
                item,
            } => vec![json!({
                "method": "item/started",
                "params": {
                    "item": items::item(&item),
                    "threadId": app_thread_id.as_str(),
                    "turnId": turn_id.as_str(),
                    "startedAtMs": now_ms(),
                }
            })],
            AgentEvent::ItemCompleted {
                app_thread_id,
                turn_id,
                item,
            } => vec![json!({
                "method": "item/completed",
                "params": {
                    "item": items::item(&item),
                    "threadId": app_thread_id.as_str(),
                    "turnId": turn_id.as_str(),
                    "completedAtMs": now_ms(),
                }
            })],
            AgentEvent::ItemDelta {
                app_thread_id,
                turn_id,
                item_id,
                delta,
            } => {
                let (method, extra) = match delta {
                    ItemDelta::Text { text } => ("item/agentMessage/delta", json!({"delta": text})),
                    ItemDelta::Reasoning {
                        text,
                        summary_index,
                    } => (
                        "item/reasoning/summaryTextDelta",
                        json!({"delta": text, "summaryIndex": summary_index}),
                    ),
                    ItemDelta::Output { text } => {
                        ("item/commandExecution/outputDelta", json!({"delta": text}))
                    }
                    ItemDelta::FileChanges { changes } => (
                        "item/fileChange/patchUpdated",
                        json!({"changes": items::file_changes(&changes)}),
                    ),
                };
                let mut params = json!({
                    "threadId": app_thread_id.as_str(),
                    "turnId": turn_id.as_str(),
                    "itemId": item_id.as_str(),
                });
                merge(&mut params, extra);
                vec![json!({"method": method, "params": params})]
            }
            AgentEvent::RequestOpened {
                app_thread_id,
                turn_id,
                request_id,
                request,
            } => self
                .request_opened(&app_thread_id, turn_id.as_str(), request_id, request)
                .into_iter()
                .collect(),
            AgentEvent::RequestResolved {
                app_thread_id,
                request_id,
                ..
            } => vec![json!({
                "method": "serverRequest/resolved",
                "params": {
                    "threadId": app_thread_id.as_str(),
                    "requestId": self.wire_request_id(request_id),
                }
            })],
            AgentEvent::UsageUpdated {
                app_thread_id,
                turn_id,
                last,
                total,
                context_window,
                cost,
                model,
            } => {
                let mut notification = json!({
                    "method": "thread/tokenUsage/updated",
                    "params": {
                        "threadId": app_thread_id.as_str(),
                        "turnId": turn_id.as_str(),
                        "tokenUsage": {
                            "total": usage(&total),
                            "last": usage(&last),
                            "modelContextWindow": context_window,
                        }
                    }
                });
                if let Some(cost) = cost
                    && let Ok(cost) = serde_json::to_value(cost)
                    && let Some(params) = notification["params"].as_object_mut()
                {
                    params.insert(agent_core::usage::PROVIDER_COST_FIELD.into(), cost);
                }
                if let Some(model) = model
                    && let Some(params) = notification["params"].as_object_mut()
                {
                    params.insert(agent_core::usage::REQUEST_MODEL_FIELD.into(), json!(model));
                }
                vec![notification]
            }
            AgentEvent::PlanUpdated {
                app_thread_id,
                turn_id,
                explanation,
                plan,
            } => vec![json!({
                "method": "turn/plan/updated",
                "params": {
                    "threadId": app_thread_id.as_str(),
                    "turnId": turn_id.as_str(),
                    "explanation": explanation,
                    "plan": plan.iter().map(|step| json!({
                        "step": step.step,
                        "status": match step.status {
                            PlanStepStatus::Pending => "pending",
                            PlanStepStatus::InProgress => "inProgress",
                            PlanStepStatus::Completed => "completed",
                        },
                    })).collect::<Vec<_>>(),
                }
            })],
            AgentEvent::DiffUpdated {
                app_thread_id,
                turn_id,
                diff,
            } => vec![json!({
                "method": "turn/diff/updated",
                "params": {
                    "threadId": app_thread_id.as_str(),
                    "turnId": turn_id.as_str(),
                    "diff": diff,
                }
            })],
            AgentEvent::CapabilityEvent {
                capability,
                payload,
                ..
            } => self.capability_event(&capability, payload),
        }
    }

    fn wire_request_id(&self, native_id: NativeRequestId) -> Value {
        request_ids::encode(
            &RuntimeRequestId {
                provider: self.provider.descriptor.id.clone(),
                native_id,
            },
            &self.provider.primary_id,
        )
    }

    fn capability_event(&self, capability: &str, payload: Value) -> Vec<Value> {
        // `codex.native` carries an unchanged client-wire payload; any other
        // capability event has no client-wire form in phase 1.
        if capability == Capability::CodexNative.name()
            && self.provider.capabilities.supports(Capability::CodexNative)
        {
            let mut payload = payload;
            self.provider.attach_to_native_notification(&mut payload);
            return vec![payload];
        }
        debug!(provider = %self.provider.descriptor.id, capability, "capability event has no client-wire projection");
        Vec::new()
    }

    fn thread_updated(&mut self, thread: &AgentThread) -> Vec<Value> {
        let next = ThreadSnapshot::from(thread);
        let previous = self.threads.get(&thread.app_thread_id).cloned();
        let id = thread.app_thread_id.as_str();
        let mut payloads = Vec::new();
        if previous
            .as_ref()
            .is_none_or(|previous| previous.status != next.status)
        {
            let mut params = json!({"threadId": id, "status": items::thread_status(next.status)});
            // The client keeps the lock of a thread open elsewhere live from
            // this field; an unloaded thread leaves its last known value.
            if let Some(accepts) = items::can_accept_direct_input(next.status) {
                params["canAcceptDirectInput"] = json!(accepts);
            }
            payloads.push(json!({"method": "thread/status/changed", "params": params}));
        }
        let name_changed = previous
            .as_ref()
            .map_or(next.name.is_some(), |previous| previous.name != next.name);
        if name_changed {
            let mut params = json!({"threadId": id});
            if let Some(name) = &next.name {
                params["threadName"] = json!(name);
            }
            payloads.push(json!({"method": "thread/name/updated", "params": params}));
        }
        if let Some(previous) = &previous
            && previous.archived != next.archived
        {
            let method = if next.archived {
                "thread/archived"
            } else {
                "thread/unarchived"
            };
            payloads.push(json!({"method": method, "params": {"threadId": id}}));
        }
        // Without a snapshot (the first update of a thread since this
        // companion started) the client's settings may be anything: send them.
        if previous
            .as_ref()
            .is_none_or(|previous| previous.settings != next.settings)
        {
            payloads.push(json!({
                "method": "thread/settings/updated",
                "params": {
                    "threadId": id,
                    "threadSettings": settings::thread_settings(
                        &next.settings,
                        &thread.cwd,
                        &self.provider.descriptor.model_provider,
                    ),
                }
            }));
        }
        self.observe_thread(thread);
        payloads
    }

    fn request_opened(
        &self,
        app_thread_id: &AppThreadId,
        turn_id: &str,
        request_id: NativeRequestId,
        request: RuntimeRequest,
    ) -> Option<Value> {
        let id = self.wire_request_id(request_id);
        let thread_id = app_thread_id.as_str();
        match request {
            RuntimeRequest::Approval {
                kind,
                item_id,
                title,
                detail,
                command,
                cwd,
                decisions,
            } => {
                let decisions = decisions
                    .iter()
                    .map(|decision| match decision {
                        ApprovalDecision::Accept => "accept",
                        ApprovalDecision::AcceptForSession => "acceptForSession",
                        ApprovalDecision::Decline => "decline",
                        ApprovalDecision::Cancel => "cancel",
                    })
                    .collect::<Vec<_>>();
                let (method, params) = match kind {
                    ApprovalKind::FileChange => (
                        "item/fileChange/requestApproval",
                        json!({
                            "threadId": thread_id,
                            "turnId": turn_id,
                            "itemId": item_id.as_str(),
                            "startedAtMs": now_ms(),
                            "reason": detail,
                            "grantRoot": null,
                            "codewideApprovalTitle": title,
                        }),
                    ),
                    ApprovalKind::Command | ApprovalKind::Tool => (
                        "item/commandExecution/requestApproval",
                        json!({
                            "kind": "command",
                            "threadId": thread_id,
                            "turnId": turn_id,
                            "itemId": item_id.as_str(),
                            "startedAtMs": now_ms(),
                            "approvalId": null,
                            "environmentId": null,
                            "reason": detail,
                            "command": command,
                            "cwd": cwd,
                            "availableDecisions": decisions,
                            "codewideApprovalTitle": title,
                        }),
                    ),
                };
                Some(json!({"id": id, "method": method, "params": params}))
            }
            RuntimeRequest::UserInput { item_id, questions } => Some(json!({
                "id": id,
                "method": "item/tool/requestUserInput",
                "params": {
                    "threadId": thread_id,
                    "turnId": turn_id,
                    "itemId": item_id.as_str(),
                    "questions": questions.iter().map(|question| json!({
                        "id": question.id,
                        "header": question.header,
                        "question": if question.multi_select {
                            format!("{}{MULTI_SELECT_NOTE}", question.question)
                        } else {
                            question.question.clone()
                        },
                        "isOther": question.allow_other || question.multi_select,
                        "isSecret": question.secret,
                        "options": (!question.options.is_empty()).then(|| question.options.iter().map(|option| json!({
                            "label": option.label,
                            "description": option.description,
                        })).collect::<Vec<_>>()),
                    })).collect::<Vec<_>>(),
                    "isBlocking": true,
                    "autoResolutionMs": null,
                }
            })),
            RuntimeRequest::CapabilityRequest { capability, .. } => {
                debug!(provider = %self.provider.descriptor.id, capability, "capability request has no client-wire projection");
                None
            }
        }
    }
}

fn usage(usage: &TokenUsage) -> Value {
    json!({
        "totalTokens": usage.total_tokens,
        "inputTokens": usage.input_tokens,
        "cachedInputTokens": usage.cached_input_tokens,
        "cacheWriteInputTokens": usage.cache_write_input_tokens.unwrap_or(0),
        "outputTokens": usage.output_tokens,
        "reasoningOutputTokens": usage.reasoning_output_tokens,
    })
}

fn merge(target: &mut Value, extra: Value) {
    if let (Some(target), Value::Object(extra)) = (target.as_object_mut(), extra) {
        target.extend(extra);
    }
}

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |elapsed| {
            u64::try_from(elapsed.as_millis()).unwrap_or(u64::MAX)
        })
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;
    use crate::agent::model::{
        AgentThread, ApprovalDecision, CapabilitySet, ItemId, ProviderDescriptor, ProviderId,
        QuestionOption, StartWhileActiveMode, ThreadOrigin, ThreadSettings, ThreadStatus, TurnId,
        UserInputQuestion,
    };

    fn projector() -> EventProjector {
        EventProjector::new(WireProvider {
            descriptor: ProviderDescriptor {
                id: ProviderId::from_static("claude"),
                display_name: "Claude".into(),
                model_provider: "anthropic".into(),
                version: "1".into(),
            },
            capabilities: CapabilitySet::none(StartWhileActiveMode::Busy),
            primary_id: ProviderId::from_static("codex"),
            multi_provider: true,
        })
    }

    fn thread(
        status: ThreadStatus,
        name: Option<&str>,
        archived: bool,
        model: &str,
    ) -> AgentThread {
        AgentThread {
            app_thread_id: AppThreadId::from_static("t"),
            provider: ProviderId::from_static("claude"),
            cwd: "/w".into(),
            name: name.map(str::to_owned),
            preview: String::new(),
            created_at: 1,
            updated_at: 1,
            recency_at: None,
            archived,
            origin: ThreadOrigin::Interactive,
            status,
            settings: ThreadSettings {
                model: model.into(),
                effort: None,
                permission_profile: ":workspace".into(),
                service_tier: None,
            },
        }
    }

    fn methods(payloads: &[Value]) -> Vec<&str> {
        payloads
            .iter()
            .filter_map(|payload| payload["method"].as_str())
            .collect()
    }

    #[test]
    fn thread_snapshots_become_only_the_changes_and_never_thread_started() {
        let mut projector = projector();
        let first = projector.project(AgentEvent::ThreadUpdated {
            thread: thread(ThreadStatus::Idle, None, false, "m"),
        });
        // The first snapshot since startup carries the settings: a settings
        // change is often the first update a thread gets after a restart.
        assert_eq!(
            methods(&first),
            ["thread/status/changed", "thread/settings/updated"]
        );
        assert_eq!(first[1]["params"]["threadSettings"]["model"], "m");
        let unchanged = projector.project(AgentEvent::ThreadUpdated {
            thread: thread(ThreadStatus::Idle, None, false, "m"),
        });
        assert!(unchanged.is_empty());
        let changed = projector.project(AgentEvent::ThreadUpdated {
            thread: thread(ThreadStatus::Active, Some("Named"), true, "m2"),
        });
        assert_eq!(
            methods(&changed),
            [
                "thread/status/changed",
                "thread/name/updated",
                "thread/archived",
                "thread/settings/updated"
            ]
        );
        assert_eq!(changed[1]["params"]["threadName"], "Named");
        assert_eq!(changed[3]["params"]["threadSettings"]["model"], "m2");
    }

    #[test]
    fn a_thread_open_elsewhere_locks_and_releases_direct_input_live() {
        let mut projector = projector();
        let _ = projector.project(AgentEvent::ThreadUpdated {
            thread: thread(ThreadStatus::Idle, None, false, "m"),
        });
        let locked = projector.project(AgentEvent::ThreadUpdated {
            thread: thread(ThreadStatus::OpenElsewhere, None, false, "m"),
        });
        assert_eq!(methods(&locked), ["thread/status/changed"]);
        assert_eq!(locked[0]["params"]["status"], json!({"type": "idle"}));
        assert_eq!(locked[0]["params"]["canAcceptDirectInput"], false);
        let released = projector.project(AgentEvent::ThreadUpdated {
            thread: thread(ThreadStatus::Idle, None, false, "m"),
        });
        assert_eq!(released[0]["params"]["canAcceptDirectInput"], true);
        let unloaded = projector.project(AgentEvent::ThreadUpdated {
            thread: thread(ThreadStatus::NotLoaded, None, false, "m"),
        });
        assert!(unloaded[0]["params"].get("canAcceptDirectInput").is_none());
    }

    #[test]
    fn requests_are_namespaced_and_multi_select_questions_say_so() {
        let mut projector = projector();
        let opened = projector.project(AgentEvent::RequestOpened {
            app_thread_id: AppThreadId::from_static("t"),
            turn_id: TurnId::from_static("u"),
            request_id: NativeRequestId::Text("perm-1".into()),
            request: RuntimeRequest::UserInput {
                item_id: ItemId::from_static("i"),
                questions: vec![UserInputQuestion {
                    id: "q".into(),
                    header: "Runner".into(),
                    question: "Which?".into(),
                    options: vec![QuestionOption {
                        label: "a".into(),
                        description: String::new(),
                    }],
                    multi_select: true,
                    secret: false,
                    allow_other: false,
                }],
            },
        });
        assert_eq!(opened[0]["id"], "cw-claude:\"perm-1\"");
        assert_eq!(opened[0]["method"], "item/tool/requestUserInput");
        assert_eq!(
            opened[0]["params"]["questions"][0]["question"],
            format!("Which?{MULTI_SELECT_NOTE}")
        );
        assert_eq!(opened[0]["params"]["questions"][0]["isOther"], true);
        let approval = projector.project(AgentEvent::RequestOpened {
            app_thread_id: AppThreadId::from_static("t"),
            turn_id: TurnId::from_static("u"),
            request_id: NativeRequestId::Number(4),
            request: RuntimeRequest::Approval {
                kind: ApprovalKind::FileChange,
                item_id: ItemId::from_static("toolu_edit"),
                title: "Edit a.ts".into(),
                detail: None,
                command: None,
                cwd: None,
                decisions: vec![ApprovalDecision::Accept],
            },
        });
        assert_eq!(approval[0]["method"], "item/fileChange/requestApproval");
        assert_eq!(approval[0]["params"]["codewideApprovalTitle"], "Edit a.ts");
        let resolved = projector.project(AgentEvent::RequestResolved {
            app_thread_id: AppThreadId::from_static("t"),
            request_id: NativeRequestId::Number(4),
            reason: crate::agent::model::RequestResolution::Responded,
        });
        assert_eq!(resolved[0]["params"]["requestId"], "cw-claude:4");
    }

    #[test]
    fn a_non_native_capability_event_has_no_wire_form() {
        let mut projector = projector();
        assert!(
            projector
                .project(AgentEvent::CapabilityEvent {
                    app_thread_id: None,
                    capability: "codex.native".into(),
                    payload: json!({"method": "account/updated"}),
                })
                .is_empty()
        );
    }

    #[test]
    fn usage_carries_cache_writes_and_only_a_reported_provider_cost() {
        let usage = TokenUsage {
            input_tokens: 1_330,
            cached_input_tokens: 1_000,
            cache_write_input_tokens: Some(300),
            output_tokens: 40,
            reasoning_output_tokens: 5,
            total_tokens: 1_370,
        };
        let event = |cost, model: Option<&str>| AgentEvent::UsageUpdated {
            app_thread_id: AppThreadId::from_static("t"),
            turn_id: TurnId::from_static("u"),
            last: usage,
            total: usage,
            context_window: Some(200_000),
            cost,
            model: model.map(str::to_owned),
        };
        let mut projector = projector();
        let unpriced = projector.project(event(None, None));
        let params = &unpriced[0]["params"];
        assert_eq!(params["tokenUsage"]["last"]["cacheWriteInputTokens"], 300);
        assert!(params.get(agent_core::usage::PROVIDER_COST_FIELD).is_none());
        assert!(params.get(agent_core::usage::REQUEST_MODEL_FIELD).is_none());
        let live = projector.project(event(None, Some("claude-opus-5-5")));
        assert_eq!(
            live[0]["params"][agent_core::usage::REQUEST_MODEL_FIELD],
            "claude-opus-5-5"
        );
        let priced = projector.project(event(
            Some(crate::agent::model::ProviderCost {
                basis: crate::agent::model::ProviderCostBasis::Managed,
                model: "claude-sonnet-4-6".into(),
                turn_usd: 0.25,
                thread_usd: None,
            }),
            None,
        ));
        assert_eq!(
            priced[0]["params"][agent_core::usage::PROVIDER_COST_FIELD],
            json!({"basis": "managed", "model": "claude-sonnet-4-6", "turnUsd": 0.25, "threadUsd": null})
        );
    }
}
