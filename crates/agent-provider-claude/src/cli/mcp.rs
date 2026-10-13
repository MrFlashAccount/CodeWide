//! The companion's client tools as the in-process MCP server Claude calls
//! them through (`mcp_message` control requests to the server named
//! [`super::command::CLIENT_TOOL_SERVER`]). The server answers the MCP
//! handshake and lists the declared tools itself; a tool call is handed to
//! the caller, whose result becomes an MCP result (a failed tool is an
//! `isError` result, never a JSON-RPC error). Pure.

use agent_core::model::{ClientToolSpec, ToolCallResult, ToolResultContent};
use serde_json::{Value, json};

const PROTOCOL_VERSION: &str = "2025-06-18";
const METHOD_NOT_FOUND: i64 = -32_601;
const INVALID_PARAMS: i64 = -32_602;

/// What one MCP message asks of the server.
#[derive(Clone, Debug, PartialEq)]
pub enum McpMessage {
    /// Answered at once with this JSON-RPC message.
    Answer(Value),
    /// A call of a declared tool; answer it with [`call_response`].
    Call {
        id: Value,
        tool: String,
        arguments: Value,
    },
}

/// Classifies one MCP message. A notification (no `id`) gets the empty
/// result the Agent SDK answers it with.
#[must_use]
pub fn classify(message: &Value, specs: &[ClientToolSpec]) -> McpMessage {
    let Some(id) = message.get("id").filter(|id| !id.is_null()).cloned() else {
        return McpMessage::Answer(json!({"jsonrpc": "2.0", "result": {}, "id": 0}));
    };
    let result = match message
        .get("method")
        .and_then(Value::as_str)
        .unwrap_or_default()
    {
        "initialize" => Ok(json!({
            "protocolVersion": message
                .pointer("/params/protocolVersion")
                .and_then(Value::as_str)
                .unwrap_or(PROTOCOL_VERSION),
            "capabilities": {"tools": {}},
            "serverInfo": {"name": super::command::CLIENT_TOOL_SERVER, "version": env!("CARGO_PKG_VERSION")},
        })),
        // `anthropic/alwaysLoad`: the tools are always in the model's tool
        // list rather than found through tool search, as the SDK server
        // declared them.
        "tools/list" => Ok(json!({
            "tools": specs
                .iter()
                .map(|spec| json!({
                    "name": spec.name,
                    "description": spec.description,
                    "inputSchema": spec.input_schema,
                    "_meta": {"anthropic/alwaysLoad": true},
                }))
                .collect::<Vec<_>>(),
        })),
        "tools/call" => match message.pointer("/params/name").and_then(Value::as_str) {
            Some(name) if specs.iter().any(|spec| spec.name == name) => {
                return McpMessage::Call {
                    id,
                    tool: name.to_owned(),
                    arguments: message
                        .pointer("/params/arguments")
                        .cloned()
                        .unwrap_or_else(|| json!({})),
                };
            }
            Some(name) => Err((INVALID_PARAMS, format!("unknown tool: {name}"))),
            None => Err((INVALID_PARAMS, "tools/call names no tool".to_owned())),
        },
        "ping" => Ok(json!({})),
        other => Err((METHOD_NOT_FOUND, format!("method not found: {other}"))),
    };
    McpMessage::Answer(match result {
        Ok(result) => json!({"jsonrpc": "2.0", "id": id, "result": result}),
        Err((code, message)) => {
            json!({"jsonrpc": "2.0", "id": id, "error": {"code": code, "message": message}})
        }
    })
}

/// The JSON-RPC answer to the tool call `id`.
#[must_use]
pub fn call_response(id: &Value, result: &ToolCallResult) -> Value {
    json!({
        "jsonrpc": "2.0",
        "id": id,
        "result": {
            "content": result
                .content
                .iter()
                .map(|ToolResultContent::Text { text }| json!({"type": "text", "text": text}))
                .collect::<Vec<_>>(),
            "isError": !result.success,
        },
    })
}

/// The `mcp_message` control response carrying `message`.
#[must_use]
pub fn control_response(message: &Value) -> Value {
    json!({"mcp_response": message})
}

#[cfg(test)]
mod tests {
    use super::*;

    fn specs() -> Vec<ClientToolSpec> {
        vec![ClientToolSpec {
            name: "codewide_spawn_agent".into(),
            description: "Spawn".into(),
            input_schema: json!({"type": "object"}),
        }]
    }

    fn answer(message: &Value) -> Value {
        match classify(message, &specs()) {
            McpMessage::Answer(answer) => answer,
            McpMessage::Call { .. } => panic!("expected an answer"),
        }
    }

    #[test]
    fn answers_the_handshake_and_lists_declared_tools() {
        let init = answer(
            &json!({"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {"protocolVersion": "2025-03-26"}}),
        );
        assert_eq!(init["result"]["protocolVersion"], "2025-03-26");
        let list = answer(&json!({"jsonrpc": "2.0", "id": 2, "method": "tools/list"}));
        assert_eq!(list["result"]["tools"][0]["name"], "codewide_spawn_agent");
        assert_eq!(
            list["result"]["tools"][0]["_meta"]["anthropic/alwaysLoad"],
            true
        );
        let unknown = answer(
            &json!({"jsonrpc": "2.0", "id": 4, "method": "tools/call", "params": {"name": "other"}}),
        );
        assert_eq!(unknown["error"]["code"], INVALID_PARAMS);
        assert_eq!(
            answer(&json!({"jsonrpc": "2.0", "method": "notifications/initialized"})),
            json!({"jsonrpc": "2.0", "result": {}, "id": 0})
        );
    }

    #[test]
    fn hands_declared_tool_calls_to_the_caller_and_maps_failures_to_is_error() {
        let call = classify(
            &json!({"jsonrpc": "2.0", "id": 3, "method": "tools/call", "params": {"name": "codewide_spawn_agent", "arguments": {"prompt": "p"}}}),
            &specs(),
        );
        assert_eq!(
            call,
            McpMessage::Call {
                id: json!(3),
                tool: "codewide_spawn_agent".into(),
                arguments: json!({"prompt": "p"}),
            }
        );
        let response = call_response(
            &json!(3),
            &ToolCallResult {
                success: false,
                content: vec![ToolResultContent::Text {
                    text: "busy".into(),
                }],
            },
        );
        assert_eq!(response["id"], 3);
        assert_eq!(response["result"]["isError"], true);
        assert_eq!(response["result"]["content"][0]["text"], "busy");
    }
}
