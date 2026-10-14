//! Claude's requests to a session: `can_use_tool` (allowed, denied, or
//! asked of the user as an approval or a question) and `mcp_message` for the
//! companion's client tools; the user's answers and their cancellation.
//!
//! Rules owned here:
//! - Client tools are allowed without a prompt under every profile (the
//!   companion enforces their limits).
//! - `ExitPlanMode` shows its plan item and is denied, so the turn goes on.
//! - A tool `:read-only` does not allow is denied without asking; under
//!   full access every tool is allowed without a request.
//! - Any failure denies and ends the turn's tool call (`cancelled`); an
//!   `error` answer from the client never allows.
//! - Open requests are resolved before `turn.completed`.

use agent_core::model::{
    AgentEvent, ItemId, NativeRequestId, RequestResolution, RuntimeRequest, RuntimeResponse,
    ToolCallParams, ToolCallResult,
};
use serde_json::Value;

use super::{
    actor::{Internal, PendingKind, PendingRequest, Session},
    client_tools::{NO_ACTIVE_TURN, TOOL_CALL_CANCELLED, failed},
};
use crate::{
    cli::{
        command::{CLIENT_TOOL_SERVER, PermissionProfile},
        mcp::{self, McpMessage},
        protocol::{ControlRequest, PermissionDecision},
    },
    live::permissions::{
        ApprovalSubject, EXIT_PLAN_MESSAGE, allow_once, approval_decision, approval_request,
        cancelled_decision, deny, profile_allows_tool, profile_of, read_only_deny_message,
        user_input_decision, user_input_questions,
    },
    transcript::{
        client_tools::{client_tool_of, qualified_client_tool_name},
        json::JsonRecord,
        tools::{ToolContext, ToolDisposition, tool_disposition},
    },
};

/// A `can_use_tool` request.
struct ToolRequest {
    request_id: String,
    tool_name: String,
    input: JsonRecord,
    tool_use_id: String,
    decision_reason: Option<String>,
    suggestions: Vec<Value>,
}

impl Session {
    pub(super) async fn on_control_request(&mut self, request_id: String, request: ControlRequest) {
        match request {
            ControlRequest::CanUseTool {
                tool_name,
                input,
                tool_use_id,
                decision_reason,
                suggestions,
            } => {
                let Some(tool_use_id) = tool_use_id else {
                    self.answer(request_id, Err("can_use_tool names no tool use".into()));
                    return;
                };
                self.can_use_tool(ToolRequest {
                    request_id,
                    tool_name,
                    input,
                    tool_use_id,
                    decision_reason,
                    suggestions,
                })
                .await;
            }
            ControlRequest::McpMessage {
                server_name,
                message,
            } => self.on_mcp_message(request_id, &server_name, &message),
            ControlRequest::Other { subtype } => {
                self.answer(
                    request_id,
                    Err(format!("unsupported control request: {subtype}")),
                );
            }
        }
    }

    /// Writes the answer to Claude's request `request_id`.
    fn answer(&self, request_id: String, outcome: Result<Value, String>) {
        if let Some(query) = &self.query {
            query.handle.respond(request_id, outcome);
        }
    }

    fn decide(&self, request_id: String, tool_use_id: &str, decision: &PermissionDecision) {
        self.answer(request_id, Ok(decision.to_response(Some(tool_use_id))));
    }

    async fn can_use_tool(&mut self, request: ToolRequest) {
        self.active_or_wake().await;
        let Some(item_id) = ItemId::parse(&request.tool_use_id) else {
            self.decide(
                request.request_id,
                &request.tool_use_id,
                &cancelled_decision(),
            );
            return;
        };
        if self.owns_client_tool(&request.tool_name) {
            self.start_tool(&request).await;
            self.decide(
                request.request_id,
                &request.tool_use_id,
                &allow_once(request.input),
            );
            return;
        }
        match tool_disposition(&request.tool_name) {
            ToolDisposition::ExitPlan => {
                self.start_tool(&request).await;
                self.decide(
                    request.request_id,
                    &request.tool_use_id,
                    &deny(EXIT_PLAN_MESSAGE),
                );
            }
            ToolDisposition::Question => {
                let questions = user_input_questions(&request.input);
                let runtime_request = RuntimeRequest::UserInput {
                    item_id,
                    questions: questions.clone(),
                };
                self.open_request(
                    request,
                    runtime_request,
                    PendingKind::UserInput { questions },
                )
                .await;
            }
            ToolDisposition::Item | ToolDisposition::Plan => {
                self.ask_approval(request, item_id).await;
            }
        }
    }

    fn owns_client_tool(&self, tool_name: &str) -> bool {
        client_tool_of(tool_name)
            .is_some_and(|tool| self.query_tools.iter().any(|spec| spec.name == tool))
    }

    async fn start_tool(&mut self, request: &ToolRequest) {
        let now = self.now_ms();
        let events = match &mut self.active {
            Some(active) => {
                active.builder.set_now(now);
                active
                    .builder
                    .start_tool(&request.tool_use_id, &request.tool_name, &request.input)
            }
            None => Vec::new(),
        };
        self.emit_all(events).await;
    }

    async fn ask_approval(&mut self, request: ToolRequest, item_id: ItemId) {
        let profile = profile_of(&self.state.settings.permission_profile);
        if !profile_allows_tool(profile, &request.tool_name) {
            if let Some(active) = &mut self.active {
                active.builder.mark_declined(&request.tool_use_id);
            }
            let decision = deny(&read_only_deny_message(&request.tool_name));
            self.decide(request.request_id, &request.tool_use_id, &decision);
            return;
        }
        self.start_tool(&request).await;
        if profile == PermissionProfile::FullAccess {
            // Full access chosen while the query still runs in an asking mode.
            self.decide(
                request.request_id,
                &request.tool_use_id,
                &allow_once(request.input),
            );
            return;
        }
        let runtime_request = approval_request(ApprovalSubject {
            item_id,
            tool_name: &request.tool_name,
            input: &request.input,
            detail: request.decision_reason.as_deref(),
            context: ToolContext {
                cwd: &self.state.cwd,
                mcp_servers: &self.mcp_servers,
            },
        });
        let suggestions = request.suggestions.clone();
        self.open_request(
            request,
            runtime_request,
            PendingKind::Approval { suggestions },
        )
        .await;
    }

    /// Shows the request to the user; [`Self::respond`] answers it.
    async fn open_request(
        &mut self,
        request: ToolRequest,
        runtime_request: RuntimeRequest,
        kind: PendingKind,
    ) {
        let Some(turn_id) = self
            .active
            .as_ref()
            .map(|active| active.builder.turn_id().clone())
        else {
            self.decide(
                request.request_id,
                &request.tool_use_id,
                &cancelled_decision(),
            );
            return;
        };
        let pending_id = format!("perm-{}", request.tool_use_id);
        self.pending.insert(
            pending_id.clone(),
            PendingRequest {
                claude_request_id: request.request_id,
                tool_use_id: request.tool_use_id,
                input: request.input,
                kind,
            },
        );
        self.emit_all(vec![AgentEvent::RequestOpened {
            app_thread_id: self.app_thread_id.clone(),
            turn_id,
            request_id: NativeRequestId::Text(pending_id),
            request: runtime_request,
        }])
        .await;
    }

    /// Delivers the user's answer to a pending request; `false` when none is
    /// pending under `request_id`.
    pub(super) async fn respond(
        &mut self,
        request_id: &NativeRequestId,
        response: &RuntimeResponse,
    ) -> bool {
        let NativeRequestId::Text(key) = request_id else {
            return false;
        };
        let Some(pending) = self.pending.remove(key) else {
            return false;
        };
        self.resolve_request(key, RequestResolution::Responded)
            .await;
        let decision = match &pending.kind {
            PendingKind::Approval { suggestions } => {
                approval_decision(response, pending.input, suggestions)
            }
            PendingKind::UserInput { questions } => {
                user_input_decision(response, pending.input, questions)
            }
        };
        if matches!(pending.kind, PendingKind::Approval { .. })
            && matches!(decision, PermissionDecision::Deny { .. })
            && let Some(active) = &mut self.active
        {
            active.builder.mark_declined(&pending.tool_use_id);
        }
        self.decide(pending.claude_request_id, &pending.tool_use_id, &decision);
        true
    }

    /// Claude stopped waiting for `request_id`: a pending question or
    /// approval is withdrawn, a client tool call stopped.
    pub(super) async fn on_request_cancelled(&mut self, request_id: &str) {
        let key = self
            .pending
            .iter()
            .find(|(_, pending)| pending.claude_request_id == request_id)
            .map(|(key, _)| key.clone());
        if let Some(key) = key {
            self.pending.remove(&key);
            self.resolve_request(&key, RequestResolution::Cancelled)
                .await;
            return;
        }
        self.tool_calls.abandoned(request_id);
    }

    pub(super) async fn resolve_all_pending(&mut self, reason: RequestResolution) {
        let pending: Vec<(String, PendingRequest)> = self.pending.drain().collect();
        for (key, request) in pending {
            self.resolve_request(&key, reason).await;
            self.decide(
                request.claude_request_id,
                &request.tool_use_id,
                &cancelled_decision(),
            );
        }
    }

    // ------------------------------------------------------- client tools

    fn on_mcp_message(&mut self, request_id: String, server_name: &str, message: &Value) {
        if server_name != CLIENT_TOOL_SERVER {
            self.answer(
                request_id,
                Err(format!("SDK MCP server not found: {server_name}")),
            );
            return;
        }
        match mcp::classify(message, &self.query_tools) {
            McpMessage::Answer(answer) => {
                self.answer(request_id, Ok(mcp::control_response(&answer)));
            }
            McpMessage::Call {
                id,
                tool,
                arguments,
            } => self.call_client_tool(request_id, id, tool, arguments),
        }
    }

    fn call_client_tool(
        &mut self,
        request_id: String,
        mcp_id: Value,
        tool: String,
        arguments: Value,
    ) {
        let Some(active) = &self.active else {
            let result = failed(NO_ACTIVE_TURN);
            self.answer(
                request_id,
                Ok(mcp::control_response(&mcp::call_response(&mcp_id, &result))),
            );
            return;
        };
        let open = active
            .builder
            .open_tool_calls(&qualified_client_tool_name(&tool));
        let turn_id = active.builder.turn_id().clone();
        let call_id = self.tool_calls.claim(open, || (self.deps.new_uuid)());
        let call = self.deps.client_tools.call(ToolCallParams {
            app_thread_id: self.app_thread_id.clone(),
            turn_id,
            call_id: call_id.clone(),
            tool,
            arguments,
        });
        let internal = self.internal.clone();
        let done_call_id = call_id.clone();
        let done_request_id = request_id.clone();
        let done_mcp_id = mcp_id.clone();
        let task = tokio::spawn(async move {
            let result = call.await;
            let _ = internal.send(Internal::ToolCallDone {
                call_id: done_call_id,
                request_id: done_request_id,
                mcp_id: done_mcp_id,
                result,
            });
        });
        self.tool_calls
            .started(call_id, task.abort_handle(), request_id, mcp_id);
    }

    pub(super) fn on_tool_call_done(
        &mut self,
        call_id: &str,
        request_id: String,
        mcp_id: &Value,
        result: &ToolCallResult,
    ) {
        if self.tool_calls.finished(call_id) {
            self.answer(
                request_id,
                Ok(mcp::control_response(&mcp::call_response(mcp_id, result))),
            );
        }
    }

    /// Cancels every running client tool call; Claude learns each was cancelled.
    pub(super) fn cancel_tool_calls(&mut self) {
        for cancelled in self.tool_calls.cancel_all() {
            let result = failed(TOOL_CALL_CANCELLED);
            self.answer(
                cancelled.request_id,
                Ok(mcp::control_response(&mcp::call_response(
                    &cancelled.mcp_id,
                    &result,
                ))),
            );
        }
    }
}
