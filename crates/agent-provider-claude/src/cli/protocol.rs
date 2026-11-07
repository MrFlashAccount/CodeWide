//! The JSON lines the companion and a `claude` process exchange over stdio
//! (`--input-format stream-json --output-format stream-json`), the protocol
//! the Agent SDK speaks.
//!
//! - The companion writes user messages, control requests (`initialize`,
//!   `interrupt`, `set_permission_mode`) and control responses.
//! - Claude writes conversation messages (the same shapes as its session
//!   rows, plus `stream_event`, `result` and `system` frames), control
//!   requests the companion answers (`can_use_tool`, `mcp_message`; others
//!   are refused) and control responses to the companion's requests.
//!
//! Inbound lines are classified structurally and never fail; anything that
//! is not a control envelope is a conversation message. Pure.

use serde_json::{Value, json};

use crate::transcript::json::{JsonRecord, record_of, str_of};

/// One line Claude wrote.
#[derive(Clone, Debug, PartialEq)]
pub enum Inbound {
    /// A request the companion must answer.
    ControlRequest {
        request_id: String,
        request: ControlRequest,
    },
    /// The answer to one of the companion's requests.
    ControlResponse {
        request_id: String,
        outcome: Result<Value, String>,
    },
    /// Claude no longer waits for the answer to `request_id`.
    ControlCancel { request_id: String },
    /// A conversation or system message.
    Message(Value),
}

/// A request Claude sends the companion.
#[derive(Clone, Debug, PartialEq)]
pub enum ControlRequest {
    /// May the tool run with this input?
    CanUseTool {
        tool_name: String,
        input: JsonRecord,
        tool_use_id: Option<String>,
        decision_reason: Option<String>,
        /// Permission updates Claude proposes for "always allow".
        suggestions: Vec<Value>,
        /// The sub-agent whose call this is (`agent_id`); `None` for a call
        /// of the main conversation.
        agent_id: Option<String>,
    },
    /// A JSON-RPC message for an in-process MCP server.
    McpMessage { server_name: String, message: Value },
    /// A request this companion does not serve.
    Other { subtype: String },
}

/// Classifies one line. Never fails: a line that is not JSON is a message
/// with the raw text as a string.
#[must_use]
pub fn classify_line(line: &str) -> Inbound {
    let Ok(value) = serde_json::from_str::<Value>(line) else {
        return Inbound::Message(Value::String(line.to_owned()));
    };
    let Some(record) = value.as_object() else {
        return Inbound::Message(value);
    };
    match str_of(record, "type") {
        Some("control_request") => {
            match (str_of(record, "request_id"), record_of(record, "request")) {
                (Some(request_id), Some(request)) => Inbound::ControlRequest {
                    request_id: request_id.to_owned(),
                    request: control_request(request),
                },
                _ => Inbound::Message(value),
            }
        }
        Some("control_response") => match record_of(record, "response") {
            Some(response) => match str_of(response, "request_id") {
                Some(request_id) => Inbound::ControlResponse {
                    request_id: request_id.to_owned(),
                    outcome: if str_of(response, "subtype") == Some("success") {
                        Ok(response.get("response").cloned().unwrap_or(Value::Null))
                    } else {
                        Err(str_of(response, "error")
                            .unwrap_or("control request failed")
                            .to_owned())
                    },
                },
                None => Inbound::Message(value),
            },
            None => Inbound::Message(value),
        },
        Some("control_cancel_request") => match str_of(record, "request_id") {
            Some(request_id) => Inbound::ControlCancel {
                request_id: request_id.to_owned(),
            },
            None => Inbound::Message(value),
        },
        _ => Inbound::Message(value),
    }
}

fn control_request(request: &JsonRecord) -> ControlRequest {
    match str_of(request, "subtype").unwrap_or_default() {
        "can_use_tool" => match str_of(request, "tool_name") {
            Some(tool_name) => ControlRequest::CanUseTool {
                tool_name: tool_name.to_owned(),
                input: record_of(request, "input").cloned().unwrap_or_default(),
                tool_use_id: str_of(request, "tool_use_id").map(ToOwned::to_owned),
                decision_reason: str_of(request, "decision_reason").map(ToOwned::to_owned),
                suggestions: request
                    .get("permission_suggestions")
                    .and_then(Value::as_array)
                    .cloned()
                    .unwrap_or_default(),
                agent_id: str_of(request, "agent_id").map(ToOwned::to_owned),
            },
            None => ControlRequest::Other {
                subtype: "can_use_tool".into(),
            },
        },
        "mcp_message" => match (str_of(request, "server_name"), request.get("message")) {
            (Some(server_name), Some(message)) => ControlRequest::McpMessage {
                server_name: server_name.to_owned(),
                message: message.clone(),
            },
            _ => ControlRequest::Other {
                subtype: "mcp_message".into(),
            },
        },
        other => ControlRequest::Other {
            subtype: other.to_owned(),
        },
    }
}

/// How the companion answers `can_use_tool`.
#[derive(Clone, Debug, PartialEq)]
pub enum PermissionDecision {
    /// Run the tool with this input; `updated_permissions` (Claude's
    /// suggestions with a `session` destination) also allows it for the
    /// rest of the session.
    Allow {
        input: JsonRecord,
        updated_permissions: Option<Vec<Value>>,
    },
    /// Refuse it; `interrupt` also ends the turn.
    Deny { message: String, interrupt: bool },
}

impl PermissionDecision {
    /// The `can_use_tool` answer, echoing the tool use id as the SDK does.
    #[must_use]
    pub fn to_response(&self, tool_use_id: Option<&str>) -> Value {
        let mut response = match self {
            Self::Allow {
                input,
                updated_permissions,
            } => {
                let mut allow = json!({"behavior": "allow", "updatedInput": input});
                if let Some(updates) = updated_permissions {
                    allow["updatedPermissions"] = json!(updates);
                }
                allow
            }
            Self::Deny { message, interrupt } => {
                json!({"behavior": "deny", "message": message, "interrupt": interrupt})
            }
        };
        if let Some(id) = tool_use_id {
            response["toolUseID"] = json!(id);
        }
        response
    }
}

/// A control request the companion sends.
#[must_use]
pub fn control_request_line(request_id: &str, request: &Value) -> String {
    json!({"type": "control_request", "request_id": request_id, "request": request}).to_string()
}

/// The companion's answer to one of Claude's control requests.
#[must_use]
pub fn control_response_line(request_id: &str, outcome: Result<&Value, &str>) -> String {
    let response = match outcome {
        Ok(response) => {
            json!({"subtype": "success", "request_id": request_id, "response": response})
        }
        Err(error) => json!({"subtype": "error", "request_id": request_id, "error": error}),
    };
    json!({"type": "control_response", "response": response}).to_string()
}

/// The `initialize` request: the in-process MCP servers the session uses.
#[must_use]
pub fn initialize_request(sdk_mcp_servers: &[&str]) -> Value {
    if sdk_mcp_servers.is_empty() {
        json!({"subtype": "initialize"})
    } else {
        json!({"subtype": "initialize", "sdkMcpServers": sdk_mcp_servers})
    }
}

/// Claude's suggested permission updates, kept for the rest of the session
/// only (an "allow for this session" answer).
#[must_use]
pub fn session_scoped(suggestions: &[Value]) -> Vec<Value> {
    suggestions
        .iter()
        .map(|update| {
            let mut update = update.clone();
            if let Some(record) = update.as_object_mut() {
                record.insert("destination".into(), json!("session"));
            }
            update
        })
        .collect()
}

/// When an offered message is read: `Now` interrupts the running model
/// request (a steer), `Queued` waits for the turn to reach it.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum Priority {
    Queued,
    Now,
}

/// Who a user message speaks for. `Adapter` is a message the adapter
/// composes for Claude, not a person's prompt (`isSynthetic`): Claude stores
/// it as a meta message, which its transcript readers hide.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum Author {
    Person,
    Adapter,
}

/// A user message: `content` is a string or Messages API content blocks;
/// `uuid` is the id Claude persists it under (a fresh one when `None`).
#[must_use]
pub fn user_message_line(
    content: &Value,
    uuid: Option<&str>,
    priority: Priority,
    author: Author,
) -> String {
    let mut message = json!({
        "type": "user",
        "message": {"role": "user", "content": content},
        "parent_tool_use_id": null,
    });
    if let Some(uuid) = uuid {
        message["uuid"] = json!(uuid);
    }
    if priority == Priority::Now {
        message["priority"] = json!("now");
    }
    if author == Author::Adapter {
        message["isSynthetic"] = json!(true);
    }
    message.to_string()
}

/// The plan rate-limit read (`get_usage`), without the behaviour hints.
#[must_use]
pub fn usage_request() -> Value {
    json!({"subtype": "get_usage", "skip_behaviors": true})
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn classifies_control_envelopes_and_messages() {
        let request = classify_line(
            r#"{"type":"control_request","request_id":"r1","request":{"subtype":"can_use_tool","tool_name":"Bash","input":{"command":"ls"},"tool_use_id":"toolu_1"}}"#,
        );
        assert!(matches!(
            request,
            Inbound::ControlRequest { ref request_id, request: ControlRequest::CanUseTool { ref tool_name, ref tool_use_id, ref agent_id, .. } }
                if request_id == "r1" && tool_name == "Bash" && tool_use_id.as_deref() == Some("toolu_1") && agent_id.is_none()
        ));
        let subagent_request = classify_line(
            r#"{"type":"control_request","request_id":"r2","request":{"subtype":"can_use_tool","tool_name":"Bash","input":{"command":"ls"},"tool_use_id":"toolu_2","agent_id":"a0001"}}"#,
        );
        assert!(matches!(
            subagent_request,
            Inbound::ControlRequest { request: ControlRequest::CanUseTool { ref agent_id, .. }, .. }
                if agent_id.as_deref() == Some("a0001")
        ));
        assert_eq!(
            classify_line(
                r#"{"type":"control_response","response":{"subtype":"success","request_id":"codewide-1","response":{"ok":true}}}"#
            ),
            Inbound::ControlResponse {
                request_id: "codewide-1".into(),
                outcome: Ok(json!({"ok": true}))
            }
        );
        assert_eq!(
            classify_line(
                r#"{"type":"control_response","response":{"subtype":"error","request_id":"codewide-2","error":"no"}}"#
            ),
            Inbound::ControlResponse {
                request_id: "codewide-2".into(),
                outcome: Err("no".into())
            }
        );
        assert!(matches!(
            classify_line(r#"{"type":"assistant","message":{}}"#),
            Inbound::Message(_)
        ));
        assert!(matches!(
            classify_line("not json"),
            Inbound::Message(Value::String(_))
        ));
        assert!(matches!(
            classify_line(r#"{"type":"control_request","request_id":"r2","request":{"subtype":"hook_callback"}}"#),
            Inbound::ControlRequest { request: ControlRequest::Other { ref subtype }, .. } if subtype == "hook_callback"
        ));
    }

    #[test]
    fn writes_the_sdks_shapes() {
        let allow = PermissionDecision::Allow {
            input: serde_json::from_value(json!({"command": "ls"})).unwrap_or_default(),
            updated_permissions: None,
        };
        assert_eq!(
            allow.to_response(Some("toolu_1")),
            json!({"behavior": "allow", "updatedInput": {"command": "ls"}, "toolUseID": "toolu_1"})
        );
        let deny = PermissionDecision::Deny {
            message: "no".into(),
            interrupt: false,
        };
        assert_eq!(deny.to_response(None)["behavior"], "deny");
        let line: Value =
            serde_json::from_str(&control_response_line("r1", Err("refused"))).unwrap_or_default();
        assert_eq!(line["response"]["subtype"], "error");
        let user: Value = serde_json::from_str(&user_message_line(
            &json!("hi"),
            Some("u1"),
            Priority::Queued,
            Author::Person,
        ))
        .unwrap_or_default();
        assert_eq!(user["message"]["content"], "hi");
        assert_eq!(user["uuid"], "u1");
        assert!(user.get("priority").is_none());
        assert!(user.get("isSynthetic").is_none());
        let resume: Value = serde_json::from_str(&user_message_line(
            &json!("go on"),
            Some("u2"),
            Priority::Queued,
            Author::Adapter,
        ))
        .unwrap_or_default();
        assert_eq!(resume["isSynthetic"], true);
        assert_eq!(resume["uuid"], "u2");
        // The Agent SDK leaves the session to the process: no `session_id`.
        assert!(user.get("session_id").is_none());
        let steer: Value = serde_json::from_str(&user_message_line(
            &json!("now"),
            None,
            Priority::Now,
            Author::Person,
        ))
        .unwrap_or_default();
        assert_eq!(steer["priority"], "now");
        assert!(steer.get("uuid").is_none());
        let scoped = session_scoped(&[json!({"type": "addRules", "destination": "localSettings"})]);
        assert_eq!(scoped[0]["destination"], "session");
        assert_eq!(
            initialize_request(&["codewide"])["sdkMcpServers"][0],
            "codewide"
        );
    }
}
