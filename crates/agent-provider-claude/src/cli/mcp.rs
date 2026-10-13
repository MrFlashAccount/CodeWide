//! The companion's client tools as the in-process MCP server Claude calls
//! them through (`mcp_message` control requests to the server named
//! [`super::command::CLIENT_TOOL_SERVER`]). The server answers the MCP
//! handshake, lists the declared tools and runs a call through the caller;
//! a failed tool is an `isError` result, never a JSON-RPC error. Pure but
//! for the call it awaits.

use std::future::Future;

use agent_core::model::{ClientToolSpec, ToolCallResult, ToolResultContent};
use serde_json::{Value, json};

const PROTOCOL_VERSION: &str = "2025-06-18";
const METHOD_NOT_FOUND: i64 = -32_601;
const INVALID_PARAMS: i64 = -32_602;

/// The JSON-RPC response to one MCP message; a notification (no `id`) gets
/// the empty result the Agent SDK answers it with.
pub async fn handle<F, Fut>(message: &Value, specs: &[ClientToolSpec], call: F) -> Value
where
    F: FnOnce(String, Value) -> Fut,
    Fut: Future<Output = ToolCallResult>,
{
    let id = message.get("id").cloned();
    let method = message
        .get("method")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let Some(id) = id.filter(|id| !id.is_null()) else {
        return json!({"jsonrpc": "2.0", "result": {}, "id": 0});
    };
    let result = match method {
        "initialize" => Ok(json!({
            "protocolVersion": message
                .pointer("/params/protocolVersion")
                .and_then(Value::as_str)
                .unwrap_or(PROTOCOL_VERSION),
            "capabilities": {"tools": {}},
            "serverInfo": {"name": super::command::CLIENT_TOOL_SERVER, "version": env!("CARGO_PKG_VERSION")},
        })),
        "tools/list" => Ok(json!({
            "tools": specs
                .iter()
                .map(|spec| json!({"name": spec.name, "description": spec.description, "inputSchema": spec.input_schema}))
                .collect::<Vec<_>>(),
        })),
        "tools/call" => match message.pointer("/params/name").and_then(Value::as_str) {
            Some(name) if specs.iter().any(|spec| spec.name == name) => {
                let arguments = message
                    .pointer("/params/arguments")
                    .cloned()
                    .unwrap_or_else(|| json!({}));
                Ok(call_result(&call(name.to_owned(), arguments).await))
            }
            Some(name) => Err((INVALID_PARAMS, format!("unknown tool: {name}"))),
            None => Err((INVALID_PARAMS, "tools/call names no tool".to_owned())),
        },
        "ping" => Ok(json!({})),
        other => Err((METHOD_NOT_FOUND, format!("method not found: {other}"))),
    };
    match result {
        Ok(result) => json!({"jsonrpc": "2.0", "id": id, "result": result}),
        Err((code, message)) => {
            json!({"jsonrpc": "2.0", "id": id, "error": {"code": code, "message": message}})
        }
    }
}

fn call_result(result: &ToolCallResult) -> Value {
    json!({
        "content": result
            .content
            .iter()
            .map(|ToolResultContent::Text { text }| json!({"type": "text", "text": text}))
            .collect::<Vec<_>>(),
        "isError": !result.success,
    })
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

    #[tokio::test]
    async fn answers_the_handshake_lists_and_calls_declared_tools() {
        let never = |_: String, _: Value| async { ToolCallResult::text("unused".into()) };
        let init = handle(
            &json!({"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {"protocolVersion": "2025-03-26"}}),
            &specs(),
            never,
        )
        .await;
        assert_eq!(init["result"]["protocolVersion"], "2025-03-26");
        let list = handle(
            &json!({"jsonrpc": "2.0", "id": 2, "method": "tools/list"}),
            &specs(),
            never,
        )
        .await;
        assert_eq!(list["result"]["tools"][0]["name"], "codewide_spawn_agent");
        let called = handle(
            &json!({"jsonrpc": "2.0", "id": 3, "method": "tools/call", "params": {"name": "codewide_spawn_agent", "arguments": {"prompt": "p"}}}),
            &specs(),
            |tool: String, arguments: Value| async move {
                assert_eq!(tool, "codewide_spawn_agent");
                assert_eq!(arguments["prompt"], "p");
                ToolCallResult {
                    success: false,
                    content: vec![ToolResultContent::Text { text: "busy".into() }],
                }
            },
        )
        .await;
        assert_eq!(called["result"]["isError"], true);
        assert_eq!(called["result"]["content"][0]["text"], "busy");
        let unknown = handle(
            &json!({"jsonrpc": "2.0", "id": 4, "method": "tools/call", "params": {"name": "other"}}),
            &specs(),
            never,
        )
        .await;
        assert_eq!(unknown["error"]["code"], INVALID_PARAMS);
        let note = handle(
            &json!({"jsonrpc": "2.0", "method": "notifications/initialized"}),
            &specs(),
            never,
        )
        .await;
        assert_eq!(note, json!({"jsonrpc": "2.0", "result": {}, "id": 0}));
    }
}
