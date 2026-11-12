//! Resolution of pending runtime requests, shared by every answerer.
//!
//! A device answers over its sync socket; a parent agent answers a linked
//! child's request through `codewide_answer_agent`. Both take
//! [`resolve_server_request`], so the first answer wins and the other sees
//! `already_resolved_or_unknown` (or `already_resolving` while it is being
//! delivered). [`ChildInputDeskAdapter`] is the orchestration-facing reader of
//! a thread's pending user-interaction requests.

use std::sync::Arc;

use async_trait::async_trait;
use serde_json::{Value, json};
use tracing::warn;

use super::provider_rpc;
use crate::{
    agent::{
        client_wire::{decode::runtime_response_result, gateway::ClientWireGateway},
        model::{AppThreadId, ApprovalDecision, RuntimeResponse},
        orchestration::input_requests::{
            ApprovalAction, ChildInputDesk, InputAnswerRejection, InputOption, InputQuestion,
            InputRequest, PendingInput,
        },
        provider::ProviderError,
    },
    sync_live::{PendingRequestClass, classify_pending_request_method},
    sync_pending::{
        PendingServerRequests, enforce_dynamic_tool_output_limit, remove_server_request, rpc_id_key,
    },
};

/// Why a response to a pending request was not delivered. `reason` is the
/// device wire's `serverResponseRejected.reason`.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(super) enum ResponseRejection {
    AlreadyResolvedOrUnknown,
    AlreadyResolving,
    UpstreamBackpressure,
    AppServerReconnecting,
    UpstreamDeliveryFailed,
}

impl ResponseRejection {
    pub(super) const fn reason(self) -> &'static str {
        match self {
            Self::AlreadyResolvedOrUnknown => "already_resolved_or_unknown",
            Self::AlreadyResolving => "already_resolving",
            Self::UpstreamBackpressure => "upstream_backpressure",
            Self::AppServerReconnecting => "app_server_reconnecting",
            Self::UpstreamDeliveryFailed => "upstream_delivery_failed",
        }
    }
}

/// The owners one resolution touches.
#[derive(Clone)]
pub(super) struct ServerRequestResolver {
    pub(super) requests: Arc<tokio::sync::Mutex<PendingServerRequests>>,
    pub(super) gateway: Arc<ClientWireGateway>,
    pub(super) local_events: tokio::sync::mpsc::Sender<Value>,
}

impl ServerRequestResolver {
    /// Delivers one JSON-RPC response (`id` with `result` or `error`) to the
    /// provider that asked, then resolves the request for every device.
    pub(super) async fn resolve(&self, response: Value) -> Result<(), ResponseRejection> {
        let id = response.get("id").cloned().unwrap_or(Value::Null);
        let key = rpc_id_key(&id);
        let (request_class, request_method, request_thread_id) = {
            let mut pending = self.requests.lock().await;
            let Some(request) = pending.requests.get(&key) else {
                return Err(ResponseRejection::AlreadyResolvedOrUnknown);
            };
            let request_method = request
                .get("method")
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_owned();
            let request_thread_id = request
                .pointer("/params/threadId")
                .and_then(Value::as_str)
                .map(str::to_owned);
            let request_class = classify_pending_request_method(&request_method);
            if !pending.resolving.insert(key.clone()) {
                return Err(ResponseRejection::AlreadyResolving);
            }
            (request_class, request_method, request_thread_id)
        };
        let response = enforce_dynamic_tool_output_limit(response, request_class);
        let delivered = provider_rpc::deliver_server_response(
            &self.gateway,
            &request_method,
            request_thread_id.as_deref(),
            response,
        )
        .await;
        match delivered {
            Ok(()) => {
                remove_server_request(&self.requests, &key).await;
                if self
                    .local_events
                    .send(json!({
                        "method": "serverRequest/resolved",
                        "params": {"requestId": id, "reason": "responded"}
                    }))
                    .await
                    .is_err()
                {
                    warn!("local replay ingestor closed after server response");
                }
                Ok(())
            }
            Err(error) => {
                self.requests.lock().await.resolving.remove(&key);
                Err(match error {
                    ProviderError::Backpressure(_) => ResponseRejection::UpstreamBackpressure,
                    ProviderError::Reconnecting(_) | ProviderError::Disconnected(_) => {
                        ResponseRejection::AppServerReconnecting
                    }
                    ProviderError::Protocol(_) | ProviderError::Rejected(_) => {
                        ResponseRejection::UpstreamDeliveryFailed
                    }
                })
            }
        }
    }
}

/// The opaque request id the agent tools show for a client-wire request id.
fn request_token(id: &Value) -> Option<String> {
    match id {
        Value::String(id) => Some(id.clone()),
        Value::Number(id) => Some(id.to_string()),
        Value::Null | Value::Bool(_) | Value::Array(_) | Value::Object(_) => None,
    }
}

/// Orchestration's view of the pending user-interaction requests.
pub(super) struct ChildInputDeskAdapter {
    pub(super) resolver: ServerRequestResolver,
    /// The pending set's change signal, taken before it was shared.
    pub(super) changes: tokio::sync::broadcast::Sender<String>,
}

impl ChildInputDeskAdapter {
    /// The thread's pending user-interaction requests with their tokens, in
    /// the order they opened.
    async fn thread_requests(&self, thread: &AppThreadId) -> Vec<(String, Value)> {
        let pending = self.resolver.requests.lock().await;
        let mut requests = pending
            .requests
            .values()
            .filter(|request| {
                request.pointer("/params/threadId").and_then(Value::as_str) == Some(thread.as_str())
                    && request
                        .get("method")
                        .and_then(Value::as_str)
                        .and_then(classify_pending_request_method)
                        == Some(PendingRequestClass::UserInteraction)
            })
            .filter_map(|request| Some((request_token(request.get("id")?)?, request.clone())))
            .collect::<Vec<_>>();
        drop(pending);
        requests.sort_by_key(|(token, request)| {
            (
                request
                    .pointer("/params/startedAtMs")
                    .and_then(Value::as_u64)
                    .unwrap_or(0),
                token.clone(),
            )
        });
        requests
    }
}

#[async_trait]
impl ChildInputDesk for ChildInputDeskAdapter {
    async fn pending(&self, thread: &AppThreadId) -> Vec<PendingInput> {
        self.thread_requests(thread)
            .await
            .into_iter()
            .filter_map(|(token, request)| pending_input(token, &request))
            .collect()
    }

    async fn respond(
        &self,
        thread: &AppThreadId,
        request_id: &str,
        response: RuntimeResponse,
    ) -> Result<(), InputAnswerRejection> {
        let mut matching = self
            .thread_requests(thread)
            .await
            .into_iter()
            .filter(|(token, _)| token == request_id);
        let (Some((_, request)), None) = (matching.next(), matching.next()) else {
            return Err(InputAnswerRejection::NotPending);
        };
        let method = request.get("method").and_then(Value::as_str).unwrap_or("");
        let result = runtime_response_result(method, &response).ok_or(match method {
            "item/tool/requestUserInput" => {
                InputAnswerRejection::Mismatch("a user-input request is answered with answers")
            }
            "item/commandExecution/requestApproval" | "item/fileChange/requestApproval" => {
                InputAnswerRejection::Mismatch("an approval is answered with a decision")
            }
            _ => InputAnswerRejection::Mismatch(
                "this kind of request can only be answered by the user in the agent's thread",
            ),
        })?;
        let id = request.get("id").cloned().unwrap_or(Value::Null);
        self.resolver
            .resolve(json!({"id": id, "result": result}))
            .await
            .map_err(|rejection| match rejection {
                ResponseRejection::AlreadyResolvedOrUnknown => InputAnswerRejection::NotPending,
                ResponseRejection::AlreadyResolving => InputAnswerRejection::Resolving,
                other => InputAnswerRejection::Delivery(other.reason()),
            })
    }

    fn subscribe(&self) -> tokio::sync::broadcast::Receiver<String> {
        self.changes.subscribe()
    }
}

fn text(value: Option<&Value>) -> Option<String> {
    value
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|text| !text.is_empty())
        .map(str::to_owned)
}

/// The neutral view of one client-wire user-interaction request.
fn pending_input(request_id: String, request: &Value) -> Option<PendingInput> {
    let params = request.get("params")?;
    let request_kind = match request.get("method").and_then(Value::as_str)? {
        "item/tool/requestUserInput" => InputRequest::UserInput {
            questions: params
                .get("questions")
                .and_then(Value::as_array)
                .map(|questions| questions.iter().filter_map(question).collect())
                .unwrap_or_default(),
        },
        method @ ("item/commandExecution/requestApproval" | "item/fileChange/requestApproval") => {
            InputRequest::Approval {
                action: if method == "item/fileChange/requestApproval" {
                    ApprovalAction::FileChange
                } else {
                    ApprovalAction::Command
                },
                title: text(params.get("codewideApprovalTitle")),
                command: command(params.get("command")),
                cwd: text(params.get("cwd")),
                reason: text(params.get("reason")),
                decisions: params
                    .get("availableDecisions")
                    .and_then(Value::as_array)
                    .map(|decisions| decisions.iter().filter_map(decision).collect())
                    .unwrap_or_default(),
            }
        }
        "item/permissions/requestApproval" => InputRequest::Permissions {
            reason: text(params.get("reason")),
        },
        "mcpServer/elicitation/request" => InputRequest::Elicitation {
            message: text(params.get("message")),
        },
        _ => return None,
    };
    Some(PendingInput {
        request_id,
        turn_id: text(params.get("turnId")),
        request: request_kind,
    })
}

/// A command as a string, or the shell words of an argv array joined.
fn command(value: Option<&Value>) -> Option<String> {
    match value? {
        Value::Array(words) => {
            let words = words.iter().filter_map(Value::as_str).collect::<Vec<_>>();
            (!words.is_empty()).then(|| words.join(" "))
        }
        other => text(Some(other)),
    }
}

fn decision(value: &Value) -> Option<ApprovalDecision> {
    match value.as_str()? {
        "accept" => Some(ApprovalDecision::Accept),
        "acceptForSession" => Some(ApprovalDecision::AcceptForSession),
        "decline" => Some(ApprovalDecision::Decline),
        "cancel" => Some(ApprovalDecision::Cancel),
        _ => None,
    }
}

fn question(value: &Value) -> Option<InputQuestion> {
    Some(InputQuestion {
        id: text(value.get("id"))?,
        header: text(value.get("header")),
        question: text(value.get("question"))?,
        options: value
            .get("options")
            .and_then(Value::as_array)
            .map(|options| {
                options
                    .iter()
                    .filter_map(|option| {
                        Some(InputOption {
                            label: text(option.get("label"))?,
                            description: text(option.get("description")),
                        })
                    })
                    .collect()
            })
            .unwrap_or_default(),
        allows_other: value.get("isOther").and_then(Value::as_bool) == Some(true),
        secret: value.get("isSecret").and_then(Value::as_bool) == Some(true),
    })
}

#[cfg(test)]
mod tests {
    use agent_core::request_ids;

    use super::*;
    use crate::{
        agent::{
            bindings::BindingStore,
            model::{
                CapabilitySet, NativeRequestId, ProviderId, RuntimeRequestId, StartWhileActiveMode,
                UserInputAnswer,
            },
            provider::AgentProvider,
            registry::ProviderRegistry,
            testing::ScriptedProvider,
        },
        store::IndexStore,
        sync_pending::observe_server_requests,
    };

    type TestResult = Result<(), Box<dyn std::error::Error>>;

    const CHILD: &str = "child-thread";

    struct Fixture {
        desk: ChildInputDeskAdapter,
        claude: Arc<ScriptedProvider>,
        lead: ProviderId,
        resolved: tokio::sync::mpsc::Receiver<Value>,
        _directory: tempfile::TempDir,
    }

    fn fixture() -> Result<Fixture, Box<dyn std::error::Error>> {
        let directory = tempfile::tempdir()?;
        let store = Arc::new(IndexStore::open(directory.path().join("state.redb"))?);
        let capabilities = CapabilitySet::none(StartWhileActiveMode::Busy);
        let codex: Arc<dyn AgentProvider> = Arc::new(ScriptedProvider::new("codex", capabilities));
        let claude = Arc::new(ScriptedProvider::new("claude", capabilities));
        let claude_dyn: Arc<dyn AgentProvider> = claude.clone();
        let registry = Arc::new(ProviderRegistry::new(vec![codex, claude_dyn])?);
        let lead = registry.lead_id().clone();
        let gateway = Arc::new(ClientWireGateway::new(
            registry,
            Arc::new(BindingStore::new(store)),
        ));
        let pending = PendingServerRequests::default();
        let changes = pending.user_request_changes();
        let (local_events, resolved) = tokio::sync::mpsc::channel(8);
        Ok(Fixture {
            desk: ChildInputDeskAdapter {
                resolver: ServerRequestResolver {
                    requests: Arc::new(tokio::sync::Mutex::new(pending)),
                    gateway,
                    local_events,
                },
                changes,
            },
            claude,
            lead,
            resolved,
            _directory: directory,
        })
    }

    /// A Claude request id as the client wire carries it.
    fn wire_id(fixture: &Fixture, native: &str) -> Value {
        request_ids::encode(
            &RuntimeRequestId {
                provider: ProviderId::from_static("claude"),
                native_id: NativeRequestId::Text(native.into()),
            },
            &fixture.lead,
        )
    }

    /// The projected `AskUserQuestion` of `events.rs`.
    fn user_input_request(id: &Value) -> Value {
        json!({"id": id, "method": "item/tool/requestUserInput", "params": {
            "threadId": CHILD, "turnId": "turn-1", "itemId": "item-1",
            "questions": [{"id": "language", "header": "Language",
                "question": "Which language?", "isOther": true, "isSecret": false,
                "options": [{"label": "Rust", "description": "fast"}, {"label": "Go", "description": null}]}],
            "isBlocking": true, "autoResolutionMs": null}})
    }

    fn approval_request(id: &Value) -> Value {
        json!({"id": id, "method": "item/commandExecution/requestApproval", "params": {
            "kind": "command", "threadId": CHILD, "turnId": "turn-1", "itemId": "item-2",
            "startedAtMs": 5, "reason": "Publish", "command": "cargo publish", "cwd": "/repo",
            "availableDecisions": ["accept", "decline"], "codewideApprovalTitle": "Bash"}})
    }

    #[tokio::test]
    async fn a_child_request_reads_as_a_neutral_view_and_signals_its_thread() -> TestResult {
        let fixture = fixture()?;
        let mut changes = fixture.desk.subscribe();
        let question_id = wire_id(&fixture, "ask");
        let approval_id = wire_id(&fixture, "approve");
        observe_server_requests(
            &fixture.desk.resolver.requests,
            &[
                user_input_request(&question_id),
                approval_request(&approval_id),
                json!({"id": wire_id(&fixture, "other"), "method": "item/tool/requestUserInput",
                    "params": {"threadId": "another", "questions": []}}),
            ],
        )
        .await
        .map_err(|()| "observation failed")?;
        assert_eq!(changes.recv().await?, CHILD);
        let pending = fixture.desk.pending(&AppThreadId::from_static(CHILD)).await;
        assert_eq!(pending.len(), 2);
        let question = pending
            .iter()
            .find(|input| Some(input.request_id.as_str()) == question_id.as_str())
            .ok_or("question missing")?;
        assert_eq!(question.turn_id.as_deref(), Some("turn-1"));
        assert_eq!(
            question.request,
            InputRequest::UserInput {
                questions: vec![InputQuestion {
                    id: "language".into(),
                    header: Some("Language".into()),
                    question: "Which language?".into(),
                    options: vec![
                        InputOption {
                            label: "Rust".into(),
                            description: Some("fast".into()),
                        },
                        InputOption {
                            label: "Go".into(),
                            description: None,
                        },
                    ],
                    allows_other: true,
                    secret: false,
                }],
            }
        );
        let approval = pending
            .iter()
            .find(|input| Some(input.request_id.as_str()) == approval_id.as_str())
            .ok_or("approval missing")?;
        assert_eq!(
            approval.request,
            InputRequest::Approval {
                action: ApprovalAction::Command,
                title: Some("Bash".into()),
                command: Some("cargo publish".into()),
                cwd: Some("/repo".into()),
                reason: Some("Publish".into()),
                decisions: vec![ApprovalDecision::Accept, ApprovalDecision::Decline],
            }
        );
        Ok(())
    }

    #[tokio::test]
    async fn the_first_answer_wins_whether_device_or_parent() -> TestResult {
        let mut fixture = fixture()?;
        let child = AppThreadId::from_static(CHILD);
        let question_id = wire_id(&fixture, "ask");
        let token = question_id.as_str().ok_or("string id")?.to_owned();
        observe_server_requests(
            &fixture.desk.resolver.requests,
            &[user_input_request(&question_id)],
        )
        .await
        .map_err(|()| "observation failed")?;
        let answer = RuntimeResponse::UserInput {
            answers: [(
                "language".to_owned(),
                UserInputAnswer {
                    answers: vec!["Rust".into()],
                },
            )]
            .into_iter()
            .collect(),
        };
        assert_eq!(
            fixture
                .desk
                .respond(
                    &child,
                    &token,
                    RuntimeResponse::Approval {
                        decision: ApprovalDecision::Accept
                    }
                )
                .await,
            Err(InputAnswerRejection::Mismatch(
                "a user-input request is answered with answers"
            ))
        );
        fixture
            .desk
            .respond(&child, &token, answer.clone())
            .await
            .map_err(|rejection| rejection.message(&token))?;
        let responded = fixture
            .claude
            .responded
            .lock()
            .map_err(|_| "poisoned")?
            .clone();
        assert_eq!(responded.len(), 1);
        assert_eq!(responded[0].app_thread_id, child);
        assert_eq!(responded[0].request_id, NativeRequestId::Text("ask".into()));
        assert_eq!(responded[0].response, answer);
        let resolved = fixture.resolved.recv().await.ok_or("no resolution")?;
        assert_eq!(resolved["method"], "serverRequest/resolved");
        assert_eq!(resolved["params"]["requestId"], question_id);
        assert!(fixture.desk.pending(&child).await.is_empty());
        // A device answering afterwards is told it was already resolved, and
        // a second parent answer is no longer pending.
        assert_eq!(
            fixture
                .desk
                .resolver
                .resolve(json!({"id": question_id, "result": {"answers": {}}}))
                .await,
            Err(ResponseRejection::AlreadyResolvedOrUnknown)
        );
        assert_eq!(
            fixture.desk.respond(&child, &token, answer.clone()).await,
            Err(InputAnswerRejection::NotPending)
        );

        // The other order: the device answers first, the parent loses.
        let approval_id = wire_id(&fixture, "approve");
        let approval_token = approval_id.as_str().ok_or("string id")?.to_owned();
        observe_server_requests(
            &fixture.desk.resolver.requests,
            &[approval_request(&approval_id)],
        )
        .await
        .map_err(|()| "observation failed")?;
        fixture
            .desk
            .resolver
            .resolve(json!({"id": approval_id, "result": {"decision": "decline"}}))
            .await
            .map_err(ResponseRejection::reason)?;
        assert_eq!(
            fixture
                .desk
                .respond(
                    &child,
                    &approval_token,
                    RuntimeResponse::Approval {
                        decision: ApprovalDecision::Accept
                    }
                )
                .await,
            Err(InputAnswerRejection::NotPending)
        );
        Ok(())
    }
}
