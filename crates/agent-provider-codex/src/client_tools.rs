//! Codex wiring of the companion's client-side tools: the declaration as
//! App Server `dynamicTools` on `thread/start`, and the `item/tool/call`
//! server requests for those tools, which this adapter answers itself
//! instead of publishing them to the client.
//!
//! Shapes (App Server protocol 0.155.1, `v2/Dynamic*.ts`): a `DynamicToolSpec`
//! of type `function` is `{type, name, description, inputSchema}`; the
//! request params are `{threadId, turnId, callId, namespace, tool,
//! arguments}`; the response is `{contentItems: [{type: "inputText", text}],
//! success}`. Tools are declared without a namespace, so only a call with a
//! `null` namespace can be one of them.

use std::{
    collections::{HashSet, VecDeque},
    sync::{Arc, Mutex, OnceLock},
};

use agent_core::{
    model::{
        AppThreadId, ClientToolSpec, ProviderId, ToolCallParams, ToolCallResult, ToolResultContent,
        TurnId,
    },
    provider::ClientToolHost,
};
use agent_transport::UpstreamHandle;
use serde_json::{Value, json};
use tracing::{error, warn};

const TOOL_CALL_METHOD: &str = "item/tool/call";
const RESOLVED_METHOD: &str = "serverRequest/resolved";
/// Request ids answered here whose `serverRequest/resolved` notification is
/// still expected; bounded so a lost notification cannot grow it.
const MAX_ANSWERED_REQUESTS: usize = 256;

/// The installed client tools and the requests this adapter answered.
#[derive(Default)]
pub(crate) struct CodexClientTools {
    host: OnceLock<Arc<dyn ClientToolHost>>,
    answered: Mutex<VecDeque<String>>,
}

impl CodexClientTools {
    /// Installs the host once; a second installation is ignored.
    pub(crate) fn install(&self, host: Arc<dyn ClientToolHost>) {
        if self.host.set(host).is_err() {
            warn!("client tools are already installed on the Codex adapter");
        }
    }

    fn host(&self) -> Option<&Arc<dyn ClientToolHost>> {
        self.host.get()
    }

    /// Adds the installed tools as `dynamicTools` to a `thread/start`
    /// request (`{method, params}` envelope). Without installed tools, or
    /// for another method, the request is unchanged.
    pub(crate) fn declare_on_thread_start(&self, request: &mut Value) {
        if request.get("method").and_then(Value::as_str) != Some("thread/start") {
            return;
        }
        let Some(host) = self.host() else {
            return;
        };
        let Some(params) = request.get_mut("params") else {
            return;
        };
        declare_on_params(params, host.specs());
    }

    /// Adds the installed tools to bare `thread/start` params.
    pub(crate) fn declare_on_params(&self, params: &mut Value) {
        if let Some(host) = self.host() {
            declare_on_params(params, host.specs());
        }
    }

    /// Takes one App Server message off the client path when this adapter
    /// answers it: a `item/tool/call` request for an installed tool (answered
    /// on a spawned task) or the `serverRequest/resolved` notification of a
    /// request answered here. Returns whether the message was consumed.
    pub(crate) fn intercept(
        self: &Arc<Self>,
        payload: &Value,
        upstream: &UpstreamHandle,
        provider: &ProviderId,
    ) -> bool {
        let Some(host) = self.host() else {
            return false;
        };
        match payload.get("method").and_then(Value::as_str) {
            Some(TOOL_CALL_METHOD) => {
                let Some((id, call)) = tool_call(payload, host.as_ref()) else {
                    return false;
                };
                self.remember(&id);
                let host = host.clone();
                let upstream = upstream.clone();
                let provider = provider.clone();
                tokio::spawn(async move {
                    let result = host.call(&provider, call).await;
                    if let Err(err) = upstream.respond(response(&id, &result)).await {
                        error!(err = %err, "Codex client tool result was not delivered");
                    }
                });
                true
            }
            Some(RESOLVED_METHOD) => payload
                .pointer("/params/requestId")
                .is_some_and(|id| self.forget(id)),
            _ => false,
        }
    }

    fn remember(&self, id: &Value) {
        let mut answered = self
            .answered
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        if answered.len() >= MAX_ANSWERED_REQUESTS {
            answered.pop_front();
        }
        answered.push_back(id.to_string());
    }

    fn forget(&self, id: &Value) -> bool {
        let key = id.to_string();
        let mut answered = self
            .answered
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        let Some(position) = answered.iter().position(|known| *known == key) else {
            return false;
        };
        answered.remove(position);
        true
    }
}

fn declare_on_params(params: &mut Value, specs: &[ClientToolSpec]) {
    let Some(object) = params.as_object_mut() else {
        return;
    };
    let declared = object
        .entry("dynamicTools")
        .or_insert_with(|| Value::Array(Vec::new()));
    if declared.is_null() {
        *declared = Value::Array(Vec::new());
    }
    let Some(declared) = declared.as_array_mut() else {
        return;
    };
    let present = declared
        .iter()
        .filter_map(|tool| tool.get("name").and_then(Value::as_str))
        .map(str::to_owned)
        .collect::<HashSet<_>>();
    declared.extend(
        specs
            .iter()
            .filter(|spec| !present.contains(&spec.name))
            .map(dynamic_tool),
    );
}

/// One `DynamicToolSpec` of type `function`.
fn dynamic_tool(spec: &ClientToolSpec) -> Value {
    json!({
        "type": "function",
        "name": spec.name,
        "description": spec.description,
        "inputSchema": spec.input_schema,
    })
}

/// The request id and neutral call of an `item/tool/call` for a declared tool.
fn tool_call(payload: &Value, host: &dyn ClientToolHost) -> Option<(Value, ToolCallParams)> {
    let id = payload.get("id")?.clone();
    let params = payload.get("params")?;
    if !params.get("namespace").is_none_or(Value::is_null) {
        return None;
    }
    let tool = params.get("tool").and_then(Value::as_str)?;
    if !host.declares(tool) {
        return None;
    }
    let text = |field: &str| params.get(field).and_then(Value::as_str);
    Some((
        id,
        ToolCallParams {
            app_thread_id: AppThreadId::parse(text("threadId")?)?,
            turn_id: TurnId::parse(text("turnId")?)?,
            call_id: text("callId")?.to_owned(),
            tool: tool.to_owned(),
            arguments: params.get("arguments").cloned().unwrap_or(Value::Null),
        },
    ))
}

/// The JSON-RPC response carrying a `DynamicToolCallResponse`.
fn response(id: &Value, result: &ToolCallResult) -> Value {
    let content_items = result
        .content
        .iter()
        .map(|content| match content {
            ToolResultContent::Text { text } => json!({"type": "inputText", "text": text}),
        })
        .collect::<Vec<_>>();
    json!({
        "id": id,
        "result": {"contentItems": content_items, "success": result.success},
    })
}

#[cfg(test)]
mod tests {
    use async_trait::async_trait;

    use super::*;

    struct Echo(Vec<ClientToolSpec>);

    #[async_trait]
    impl ClientToolHost for Echo {
        fn specs(&self) -> &[ClientToolSpec] {
            &self.0
        }

        async fn call(&self, _: &ProviderId, call: ToolCallParams) -> ToolCallResult {
            ToolCallResult::text(call.tool)
        }
    }

    fn installed() -> Arc<CodexClientTools> {
        let tools = Arc::new(CodexClientTools::default());
        tools.install(Arc::new(Echo(vec![ClientToolSpec {
            name: "codewide_list_agents".into(),
            description: "List".into(),
            input_schema: json!({"type": "object"}),
        }])));
        tools
    }

    #[test]
    fn thread_start_gains_function_dynamic_tools_once() {
        let tools = installed();
        let mut request = json!({"id": 1, "method": "thread/start", "params": {"cwd": "/w"}});
        tools.declare_on_thread_start(&mut request);
        tools.declare_on_thread_start(&mut request);
        assert_eq!(
            request["params"]["dynamicTools"],
            json!([{
                "type": "function", "name": "codewide_list_agents", "description": "List",
                "inputSchema": {"type": "object"}
            }])
        );
        let mut other = json!({"id": 2, "method": "thread/resume", "params": {"threadId": "t"}});
        let before = other.clone();
        tools.declare_on_thread_start(&mut other);
        assert_eq!(other, before);
    }

    #[test]
    fn without_installed_tools_thread_start_is_unchanged() {
        let tools = CodexClientTools::default();
        let mut request = json!({"id": 1, "method": "thread/start", "params": {"cwd": "/w"}});
        let before = request.clone();
        tools.declare_on_thread_start(&mut request);
        assert_eq!(request, before);
    }

    #[test]
    fn only_declared_tools_without_a_namespace_are_calls() -> Result<(), &'static str> {
        let host = Echo(vec![ClientToolSpec {
            name: "codewide_list_agents".into(),
            description: String::new(),
            input_schema: json!({}),
        }]);
        let call = |tool: &str, namespace: Value| {
            json!({"id": 9, "method": "item/tool/call", "params": {
                "threadId": "th", "turnId": "tu", "callId": "c", "namespace": namespace,
                "tool": tool, "arguments": {"a": 1}}})
        };
        let (id, params) =
            tool_call(&call("codewide_list_agents", Value::Null), &host).ok_or("not a call")?;
        assert_eq!(id, json!(9));
        assert_eq!(params.app_thread_id.as_str(), "th");
        assert_eq!(params.turn_id.as_str(), "tu");
        assert_eq!(params.arguments, json!({"a": 1}));
        assert!(tool_call(&call("readChat", Value::Null), &host).is_none());
        assert!(tool_call(&call("codewide_list_agents", json!("codex_app")), &host).is_none());
        Ok(())
    }

    #[test]
    fn results_are_dynamic_tool_call_responses() {
        assert_eq!(
            response(&json!("srv-1"), &ToolCallResult::failure("nope".into())),
            json!({"id": "srv-1", "result": {
                "contentItems": [{"type": "inputText", "text": "nope"}], "success": false}})
        );
    }
}
