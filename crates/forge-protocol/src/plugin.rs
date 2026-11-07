//! The plugin side of the protocol: a request loop over any byte streams,
//! dispatching to a [`ForgePlugin`] until the companion closes stdin.

use serde::Serialize;
use serde_json::{Value, json};
use tokio::io::{AsyncBufRead, AsyncWrite};

use crate::{
    code,
    framing::{FrameError, read_frame, write_frame},
};

/// A typed plugin error. `message` is a short reason without forge content
/// or credentials; `data` carries code-specific fields such as
/// `headRevision` for [`code::STALE_HEAD`].
#[derive(Clone, Debug, PartialEq)]
pub struct PluginError {
    pub code: i64,
    pub message: String,
    pub data: Option<Value>,
}

impl PluginError {
    #[must_use]
    pub fn new(code: i64, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
            data: None,
        }
    }

    #[must_use]
    pub fn with_data(mut self, data: Value) -> Self {
        self.data = Some(data);
        self
    }

    #[must_use]
    pub fn invalid_params(message: impl Into<String>) -> Self {
        Self::new(code::INVALID_PARAMS, message)
    }

    #[must_use]
    pub fn auth_required(message: impl Into<String>) -> Self {
        Self::new(code::AUTH_REQUIRED, message)
    }

    #[must_use]
    pub fn stale_head(head_revision: &str) -> Self {
        Self::new(code::STALE_HEAD, "the pull request head moved")
            .with_data(json!({ "headRevision": head_revision }))
    }

    #[must_use]
    pub fn internal(message: impl Into<String>) -> Self {
        Self::new(code::INTERNAL, message)
    }
}

impl std::fmt::Display for PluginError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(formatter, "plugin error {}: {}", self.code, self.message)
    }
}

impl std::error::Error for PluginError {}

/// One forge plugin. The loop calls [`ForgePlugin::handle`] for every request
/// in order; state such as a running host login lives in `self` and is
/// dropped when the companion closes the stream.
#[async_trait::async_trait]
pub trait ForgePlugin: Send {
    async fn handle(&mut self, method: &str, params: Value) -> Result<Value, PluginError>;
}

/// Encodes a typed result, mapping an encoding failure to an internal error.
///
/// # Errors
///
/// Returns [`code::INTERNAL`] when `value` cannot be encoded.
pub fn to_result<T: Serialize>(value: &T) -> Result<Value, PluginError> {
    serde_json::to_value(value).map_err(|error| PluginError::internal(error.to_string()))
}

/// Decodes typed params, mapping a shape error to invalid params.
///
/// # Errors
///
/// Returns [`code::INVALID_PARAMS`] when `params` does not match `T`.
pub fn from_params<T: serde::de::DeserializeOwned>(params: Value) -> Result<T, PluginError> {
    serde_json::from_value(params)
        .map_err(|error| PluginError::invalid_params(format!("invalid params: {error}")))
}

/// Serves requests until the reader reaches a clean end of stream.
///
/// A malformed request frame gets a JSON-RPC error response; a broken stream
/// ends the loop with an error.
///
/// # Errors
///
/// Returns a framing error when the transport breaks.
pub async fn serve<P, R, W>(
    plugin: &mut P,
    reader: &mut R,
    writer: &mut W,
) -> Result<(), FrameError>
where
    P: ForgePlugin + ?Sized,
    R: AsyncBufRead + Unpin,
    W: AsyncWrite + Unpin,
{
    while let Some(frame) = read_frame(reader).await? {
        let response = match serde_json::from_slice::<Value>(&frame) {
            Ok(request) => respond(plugin, request).await,
            Err(_) => error_response(&Value::Null, -32_700, "invalid JSON", None),
        };
        let encoded = serde_json::to_vec(&response).unwrap_or_else(|_| {
            br#"{"jsonrpc":"2.0","id":null,"error":{"code":-32603,"message":"encoding failed"}}"#
                .to_vec()
        });
        write_frame(writer, &encoded).await?;
    }
    Ok(())
}

async fn respond<P: ForgePlugin + ?Sized>(plugin: &mut P, request: Value) -> Value {
    let id = request.get("id").cloned().unwrap_or(Value::Null);
    if request.get("jsonrpc").and_then(Value::as_str) != Some("2.0") {
        return error_response(&id, -32_600, "invalid JSON-RPC version", None);
    }
    let Some(method) = request.get("method").and_then(Value::as_str) else {
        return error_response(&id, -32_600, "request has no method", None);
    };
    let params = request.get("params").cloned().unwrap_or_else(|| json!({}));
    match plugin.handle(method, params).await {
        Ok(result) => json!({ "jsonrpc": "2.0", "id": id, "result": result }),
        Err(error) => error_response(&id, error.code, &error.message, error.data),
    }
}

fn error_response(id: &Value, code: i64, message: &str, data: Option<Value>) -> Value {
    let mut error = json!({ "code": code, "message": message });
    if let Some(data) = data {
        error["data"] = data;
    }
    json!({ "jsonrpc": "2.0", "id": id, "error": error })
}

#[cfg(test)]
#[allow(clippy::expect_used)]
mod tests {
    use super::*;

    struct Echo;

    #[async_trait::async_trait]
    impl ForgePlugin for Echo {
        async fn handle(&mut self, method: &str, params: Value) -> Result<Value, PluginError> {
            match method {
                "echo" => Ok(params),
                _ => Err(PluginError::stale_head("abc")),
            }
        }
    }

    #[tokio::test]
    async fn answers_each_request_in_order_with_typed_errors() {
        let mut input = Vec::new();
        for request in [
            json!({"jsonrpc": "2.0", "id": 1, "method": "echo", "params": {"a": 1}}),
            json!({"jsonrpc": "2.0", "id": 2, "method": "other"}),
        ] {
            write_frame(&mut input, &serde_json::to_vec(&request).expect("encode"))
                .await
                .expect("frame");
        }
        let mut reader = tokio::io::BufReader::new(input.as_slice());
        let mut output = Vec::new();
        serve(&mut Echo, &mut reader, &mut output)
            .await
            .expect("serve");
        let mut reader = tokio::io::BufReader::new(output.as_slice());
        let first: Value =
            serde_json::from_slice(&read_frame(&mut reader).await.expect("r").expect("frame"))
                .expect("json");
        assert_eq!(first["result"], json!({"a": 1}));
        let second: Value =
            serde_json::from_slice(&read_frame(&mut reader).await.expect("r").expect("frame"))
                .expect("json");
        assert_eq!(second["error"]["code"], json!(code::STALE_HEAD));
        assert_eq!(second["error"]["data"]["headRevision"], json!("abc"));
    }
}
