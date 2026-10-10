//! Client-side tools (mirror of the additive `clientTools` / `tool.call`
//! part of `packages/agent-protocol` v1).
//!
//! The companion declares tools to a provider's model through the provider's
//! own channel (`thread.create` / `turn.start` `clientTools`); the provider
//! calls them back with the host → companion request `tool.call`. The caller
//! identity is the channel and the `appThreadId` it names, never a token.

use serde::{Deserialize, Serialize};
use serde_json::Value;

use super::ids::{AppThreadId, TurnId};

/// One tool the companion declares to a provider's model.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClientToolSpec {
    pub name: String,
    pub description: String,
    /// JSON Schema of the tool's arguments object.
    pub input_schema: Value,
}

/// `tool.call`: the provider's model called a declared client tool.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolCallParams {
    /// The calling app thread.
    pub app_thread_id: AppThreadId,
    pub turn_id: TurnId,
    /// The provider's id of this tool call.
    pub call_id: String,
    pub tool: String,
    pub arguments: Value,
}

/// One content block of a tool result.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum ToolResultContent {
    Text { text: String },
}

/// Answer to `tool.call`. A failed tool is an unsuccessful result, never a
/// JSON-RPC error.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct ToolCallResult {
    pub success: bool,
    pub content: Vec<ToolResultContent>,
}

impl ToolCallResult {
    /// A successful result with one text block.
    #[must_use]
    pub fn text(text: String) -> Self {
        Self {
            success: true,
            content: vec![ToolResultContent::Text { text }],
        }
    }

    /// An unsuccessful result whose text explains the failure to the model.
    #[must_use]
    pub fn failure(message: String) -> Self {
        Self {
            success: false,
            content: vec![ToolResultContent::Text { text: message }],
        }
    }
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;
    use crate::model::{OperationCall, RequestEnvelope, ThreadCreateParams, TurnStartParams};

    /// The wire shapes of the contract, independent of the package fixtures
    /// (which round-trip in `fixture_tests.rs` once they carry these messages).
    #[test]
    fn tool_call_request_and_result_keep_the_contract_shape() -> Result<(), serde_json::Error> {
        let request = json!({
            "id": "codewide-stdio:9",
            "method": "tool.call",
            "params": {
                "appThreadId": "0199a3c4-7a8e-7b2c-9d1e-2f3a4b5c6d7e",
                "turnId": "0199a3c4-8000-7000-8000-000000000001",
                "callId": "toolu_01",
                "tool": "codewide_list_agents",
                "arguments": {}
            }
        });
        let typed: RequestEnvelope = serde_json::from_value(request.clone())?;
        assert!(matches!(&typed.call, OperationCall::ToolCall(call) if call.call_id == "toolu_01"));
        assert_eq!(serde_json::to_value(&typed)?, request);
        let result = json!({"success": false, "content": [{"type": "text", "text": "no"}]});
        let typed: ToolCallResult = serde_json::from_value(result.clone())?;
        assert_eq!(typed, ToolCallResult::failure("no".into()));
        assert_eq!(serde_json::to_value(typed)?, result);
        Ok(())
    }

    #[test]
    fn client_tools_are_additive_on_thread_create_and_turn_start() -> Result<(), serde_json::Error>
    {
        let without = json!({
            "appThreadId": null, "cwd": "/w",
            "settings": {"model": "m", "effort": null, "permissionProfile": ":workspace", "serviceTier": null}
        });
        let typed: ThreadCreateParams = serde_json::from_value(without.clone())?;
        assert_eq!(typed.client_tools, None);
        assert_eq!(serde_json::to_value(&typed)?, without);
        let with = json!({
            "appThreadId": "t", "clientMessageId": null, "input": [],
            "clientTools": [{"name": "codewide_list_agents", "description": "d", "inputSchema": {"type": "object"}}]
        });
        let typed: TurnStartParams = serde_json::from_value(with.clone())?;
        assert_eq!(typed.client_tools.as_ref().map(Vec::len), Some(1));
        assert_eq!(serde_json::to_value(&typed)?, with);
        Ok(())
    }
}
