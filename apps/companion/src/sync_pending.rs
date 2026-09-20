//! Durable pending-request observation for the Sync V1 transport.
//!
//! User interactions retain the legacy disconnect behavior. System dynamic
//! tools remain pending across reconnect until an explicit resolution.

use std::{
    collections::{HashMap, HashSet},
    sync::Arc,
    time::Duration,
};

use serde_json::{Value, json};
use tracing::warn;

use crate::{
    global_supervisor_limits::GLOBAL_SUPERVISOR_LIMITS_V1,
    sync_live::{PendingRequestClass, classify_pending_request_method},
    upstream::{ConnectionStatus, UpstreamError, UpstreamHandle},
};

const MAX_PENDING_SERVER_REQUESTS: usize = 1_024;
const MAX_PENDING_SERVER_REQUEST_BYTES: usize = 4 * 1024 * 1024;
const MAX_SINGLE_SERVER_REQUEST_BYTES: usize = 1024 * 1024;
const DYNAMIC_TOOL_REJECTION_RETRY_DELAY: Duration = Duration::from_millis(50);

struct PendingDynamicToolRejection {
    response: Value,
    retained_bytes: usize,
}

#[derive(Default)]
pub(crate) struct PendingServerRequests {
    pub(crate) requests: HashMap<String, Value>,
    pub(crate) resolving: HashSet<String>,
    bytes: usize,
    dynamic_tool_rejections: HashMap<String, PendingDynamicToolRejection>,
    dynamic_tool_rejection_bytes: usize,
    dynamic_tool_rejection_wakeup: Arc<tokio::sync::Notify>,
}

pub(crate) async fn reject_oversized_dynamic_tool_requests(
    state: &Arc<tokio::sync::Mutex<PendingServerRequests>>,
    payloads: Vec<Value>,
) -> Result<Vec<Value>, ()> {
    let mut admissible = Vec::with_capacity(payloads.len());
    for payload in payloads {
        let is_dynamic_tool =
            payload.get("method").and_then(Value::as_str) == Some("item/tool/call");
        if !is_dynamic_tool {
            admissible.push(payload);
            continue;
        }
        let Some(id) = bounded_dynamic_tool_request_id(&payload) else {
            continue;
        };
        let encoded_bytes =
            serde_json::to_vec(&payload).map_or(usize::MAX, |encoded| encoded.len());
        if encoded_bytes <= GLOBAL_SUPERVISOR_LIMITS_V1.dynamic_tool_input_max_bytes {
            admissible.push(payload);
            continue;
        }
        let response = fixed_dynamic_tool_failure_response(id, "dynamic_tool_input_too_large");
        if serde_json::to_vec(&response).map_or(true, |encoded| {
            encoded.len() > GLOBAL_SUPERVISOR_LIMITS_V1.dynamic_tool_output_max_bytes
        }) {
            continue;
        }
        retain_dynamic_tool_rejection(state, id, response).await?;
    }
    Ok(admissible)
}

fn bounded_dynamic_tool_request_id(payload: &Value) -> Option<&Value> {
    let id = payload.get("id")?;
    let has_valid_shape = match id {
        Value::String(_) => true,
        Value::Number(number) => number.as_i64().is_some(),
        Value::Null | Value::Bool(_) | Value::Array(_) | Value::Object(_) => false,
    };
    if !has_valid_shape
        || serde_json::to_vec(id).map_or(true, |encoded| {
            encoded.len() > GLOBAL_SUPERVISOR_LIMITS_V1.dynamic_tool_input_max_bytes
        })
    {
        return None;
    }
    Some(id)
}

async fn retain_dynamic_tool_rejection(
    state: &Arc<tokio::sync::Mutex<PendingServerRequests>>,
    id: &Value,
    response: Value,
) -> Result<(), ()> {
    let key = rpc_id_key(id);
    let retained_bytes = serde_json::to_vec(&response)
        .map_err(|_| ())?
        .len()
        .saturating_add(key.len());
    let wakeup = {
        let mut pending = state.lock().await;
        if pending.requests.contains_key(&key) {
            return Err(());
        }
        let previous_bytes = pending
            .dynamic_tool_rejections
            .get(&key)
            .map_or(0, |rejection| rejection.retained_bytes);
        let is_new = previous_bytes == 0;
        let next_count = pending
            .requests
            .len()
            .saturating_add(pending.dynamic_tool_rejections.len())
            .saturating_add(usize::from(is_new));
        let next_bytes = pending
            .bytes
            .saturating_add(pending.dynamic_tool_rejection_bytes)
            .saturating_sub(previous_bytes)
            .saturating_add(retained_bytes);
        if retained_bytes > MAX_SINGLE_SERVER_REQUEST_BYTES
            || next_count > MAX_PENDING_SERVER_REQUESTS
            || next_bytes > MAX_PENDING_SERVER_REQUEST_BYTES
        {
            return Err(());
        }
        pending.dynamic_tool_rejections.insert(
            key,
            PendingDynamicToolRejection {
                response,
                retained_bytes,
            },
        );
        pending.dynamic_tool_rejection_bytes = pending
            .dynamic_tool_rejection_bytes
            .saturating_sub(previous_bytes)
            .saturating_add(retained_bytes);
        pending.dynamic_tool_rejection_wakeup.clone()
    };
    wakeup.notify_one();
    Ok(())
}

/// Retries compact oversized-input failures without retaining or forwarding
/// the rejected tool payload. A response leaves the bounded state only after
/// the App Server transport confirms that it accepted the write.
pub(crate) async fn retry_oversized_dynamic_tool_rejections(
    upstream: UpstreamHandle,
    state: Arc<tokio::sync::Mutex<PendingServerRequests>>,
) {
    let mut status = upstream.subscribe_status();
    loop {
        while *status.borrow() != ConnectionStatus::Live {
            if status.changed().await.is_err() {
                return;
            }
        }
        let wakeup = {
            let pending = state.lock().await;
            pending.dynamic_tool_rejection_wakeup.clone()
        };
        let notified = wakeup.notified();
        let next = {
            let pending = state.lock().await;
            pending
                .dynamic_tool_rejections
                .iter()
                .next()
                .map(|(key, rejection)| {
                    // WHY: the retry owner must preserve the stored response
                    // across the await so a failed transport attempt can retry
                    // the same request id without holding the state lock.
                    (key.clone(), rejection.response.clone())
                })
        };
        let Some((key, response)) = next else {
            notified.await;
            continue;
        };
        match upstream.respond(response).await {
            Ok(()) => remove_dynamic_tool_rejection(&state, &key).await,
            Err(error) => {
                warn!(
                    failure_kind = upstream_failure_kind(&error),
                    "oversized dynamic tool rejection remains pending"
                );
                tokio::time::sleep(DYNAMIC_TOOL_REJECTION_RETRY_DELAY).await;
            }
        }
    }
}

pub(crate) fn fixed_dynamic_tool_failure_response(id: &Value, text: &'static str) -> Value {
    json!({
        "id": id,
        "result": {
            "contentItems": [{"type": "inputText", "text": text}],
            "success": false
        }
    })
}

pub(crate) fn enforce_dynamic_tool_output_limit(
    response: Value,
    request_class: Option<PendingRequestClass>,
) -> Value {
    if request_class != Some(PendingRequestClass::SystemDynamicTool)
        || serde_json::to_vec(&response).is_ok_and(|encoded| {
            encoded.len() <= GLOBAL_SUPERVISOR_LIMITS_V1.dynamic_tool_output_max_bytes
        })
    {
        return response;
    }
    let id = response.get("id").cloned().unwrap_or(Value::Null);
    fixed_dynamic_tool_failure_response(&id, "dynamic_tool_output_too_large")
}

pub(crate) async fn observe_server_requests(
    state: &Arc<tokio::sync::Mutex<PendingServerRequests>>,
    payloads: &[Value],
) -> Result<(), ()> {
    let mut pending = state.lock().await;
    for payload in payloads {
        let method = payload.get("method").and_then(Value::as_str);
        if method == Some("serverRequest/resolved") {
            if let Some(id) = payload
                .get("params")
                .and_then(|params| params.get("requestId"))
            {
                remove_server_request_locked(&mut pending, &rpc_id_key(id));
            }
            continue;
        }
        let Some(request_class) = method.and_then(classify_pending_request_method) else {
            continue;
        };
        if payload.get("params").and_then(Value::as_object).is_none() {
            continue;
        }
        let id = match request_class {
            PendingRequestClass::UserInteraction => payload.get("id"),
            PendingRequestClass::SystemDynamicTool => bounded_dynamic_tool_request_id(payload),
        };
        let Some(id) = id else {
            continue;
        };
        let bytes = serde_json::to_vec(payload).map_err(|_| ())?.len();
        let key = rpc_id_key(id);
        if pending.dynamic_tool_rejections.contains_key(&key) {
            return Err(());
        }
        let previous_bytes = pending
            .requests
            .get(&key)
            .and_then(|value| serde_json::to_vec(value).ok())
            .map_or(0, |value| value.len());
        let is_new = previous_bytes == 0;
        let next_count = pending
            .requests
            .len()
            .saturating_add(pending.dynamic_tool_rejections.len())
            .saturating_add(usize::from(is_new));
        let next_request_bytes = pending
            .bytes
            .saturating_sub(previous_bytes)
            .saturating_add(bytes);
        let next_total_bytes =
            next_request_bytes.saturating_add(pending.dynamic_tool_rejection_bytes);
        if bytes > MAX_SINGLE_SERVER_REQUEST_BYTES
            || next_count > MAX_PENDING_SERVER_REQUESTS
            || next_total_bytes > MAX_PENDING_SERVER_REQUEST_BYTES
        {
            return Err(());
        }
        pending.requests.insert(key, payload.clone());
        pending.bytes = next_request_bytes;
    }
    Ok(())
}

pub(crate) async fn clear_user_requests_on_disconnect(
    mut status: tokio::sync::watch::Receiver<ConnectionStatus>,
    state: Arc<tokio::sync::Mutex<PendingServerRequests>>,
    local_events: tokio::sync::mpsc::Sender<Value>,
) {
    while status.changed().await.is_ok() {
        if *status.borrow() != ConnectionStatus::Reconnecting {
            continue;
        }
        let ids = {
            let mut pending = state.lock().await;
            let removable = pending
                .requests
                .iter()
                .filter_map(|(key, request)| {
                    let method = request.get("method").and_then(Value::as_str)?;
                    (classify_pending_request_method(method)
                        == Some(PendingRequestClass::UserInteraction))
                    .then(|| (key.clone(), request.get("id").cloned()))
                })
                .collect::<Vec<_>>();
            for (key, _id) in &removable {
                remove_server_request_locked(&mut pending, key);
            }
            removable
                .into_iter()
                .filter_map(|(_key, id)| id)
                .collect::<Vec<_>>()
        };
        for id in ids {
            if local_events
                .send(json!({
                    "method": "serverRequest/resolved",
                    "params": {"requestId": id, "reason": "upstream_disconnected"}
                }))
                .await
                .is_err()
            {
                return;
            }
        }
    }
}

pub(crate) async fn remove_server_request(
    state: &Arc<tokio::sync::Mutex<PendingServerRequests>>,
    key: &str,
) {
    let mut pending = state.lock().await;
    remove_server_request_locked(&mut pending, key);
}

async fn remove_dynamic_tool_rejection(
    state: &Arc<tokio::sync::Mutex<PendingServerRequests>>,
    key: &str,
) {
    let mut pending = state.lock().await;
    if let Some(rejection) = pending.dynamic_tool_rejections.remove(key) {
        pending.dynamic_tool_rejection_bytes = pending
            .dynamic_tool_rejection_bytes
            .saturating_sub(rejection.retained_bytes);
    }
}

pub(crate) fn rpc_id_key(id: &Value) -> String {
    let kind = match id {
        Value::Null => "null",
        Value::Bool(_) => "bool",
        Value::Number(_) => "number",
        Value::String(_) => "string",
        Value::Array(_) => "array",
        Value::Object(_) => "object",
    };
    format!("{kind}:{id}")
}

fn remove_server_request_locked(state: &mut PendingServerRequests, key: &str) {
    if let Some(request) = state.requests.remove(key) {
        state.bytes = state
            .bytes
            .saturating_sub(serde_json::to_vec(&request).map_or(0, |serialized| serialized.len()));
    }
    if let Some(rejection) = state.dynamic_tool_rejections.remove(key) {
        state.dynamic_tool_rejection_bytes = state
            .dynamic_tool_rejection_bytes
            .saturating_sub(rejection.retained_bytes);
    }
    state.resolving.remove(key);
}

fn upstream_failure_kind(error: &UpstreamError) -> &'static str {
    match error {
        UpstreamError::Backpressure => "backpressure",
        UpstreamError::Reconnecting => "reconnecting",
        UpstreamError::Disconnected => "disconnected",
        UpstreamError::Protocol(_) => "protocol",
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[cfg(unix)]
    use futures_util::{SinkExt, StreamExt};
    #[cfg(unix)]
    use tokio::net::UnixListener;
    #[cfg(unix)]
    use tokio_tungstenite::{accept_async, tungstenite::Message};

    fn dynamic_request(argument_bytes: usize) -> Value {
        json!({
            "id": "dynamic",
            "method": "item/tool/call",
            "params": {
                "arguments": "x".repeat(argument_bytes),
                "callId": "call",
                "threadId": "thread",
                "tool": "readChat",
                "turnId": "turn"
            }
        })
    }

    #[tokio::test]
    async fn dynamic_tool_input_accepts_the_limit_and_rejects_one_more_byte()
    -> Result<(), Box<dyn std::error::Error>> {
        let empty_size = serde_json::to_vec(&dynamic_request(0))?.len();
        let argument_bytes = GLOBAL_SUPERVISOR_LIMITS_V1
            .dynamic_tool_input_max_bytes
            .saturating_sub(empty_size);
        let at_limit = dynamic_request(argument_bytes);
        assert_eq!(
            serde_json::to_vec(&at_limit)?.len(),
            GLOBAL_SUPERVISOR_LIMITS_V1.dynamic_tool_input_max_bytes
        );
        let state = Arc::new(tokio::sync::Mutex::new(PendingServerRequests::default()));
        let accepted = reject_oversized_dynamic_tool_requests(&state, vec![at_limit])
            .await
            .map_err(|()| "at-limit request should be accepted")?;
        assert_eq!(accepted.len(), 1);
        let rejected = reject_oversized_dynamic_tool_requests(
            &state,
            vec![dynamic_request(argument_bytes + 1)],
        )
        .await
        .map_err(|()| "oversized rejection should be retained")?;
        assert!(rejected.is_empty());
        let pending = state.lock().await;
        assert!(pending.requests.is_empty());
        assert_eq!(pending.dynamic_tool_rejections.len(), 1);
        assert_eq!(
            pending.dynamic_tool_rejections["string:\"dynamic\""].response["result"]["contentItems"]
                [0]["text"],
            "dynamic_tool_input_too_large"
        );
        Ok(())
    }

    #[tokio::test]
    async fn oversized_dynamic_tool_rejection_bounds_and_validates_request_identity()
    -> Result<(), Box<dyn std::error::Error>> {
        let state = Arc::new(tokio::sync::Mutex::new(PendingServerRequests::default()));
        let oversized_arguments = GLOBAL_SUPERVISOR_LIMITS_V1.dynamic_tool_input_max_bytes;
        let bounded_string_id = "i".repeat(
            GLOBAL_SUPERVISOR_LIMITS_V1
                .dynamic_tool_input_max_bytes
                .saturating_sub(2),
        );
        let mut bounded = dynamic_request(oversized_arguments);
        bounded["id"] = json!(bounded_string_id);
        let mut oversized_string = dynamic_request(oversized_arguments);
        oversized_string["id"] = json!(
            "i".repeat(
                GLOBAL_SUPERVISOR_LIMITS_V1
                    .dynamic_tool_input_max_bytes
                    .saturating_sub(1)
            )
        );
        let mut non_scalar = dynamic_request(oversized_arguments);
        non_scalar["id"] = json!({"nested": "id"});
        let mut missing = dynamic_request(oversized_arguments);
        missing
            .as_object_mut()
            .ok_or("request should be an object")?
            .remove("id");
        let ordinary = json!({
            "method": "turn/completed",
            "params": {"threadId": "ordinary-thread"}
        });

        let admissible = reject_oversized_dynamic_tool_requests(
            &state,
            vec![
                bounded,
                oversized_string,
                non_scalar,
                missing,
                ordinary.clone(),
            ],
        )
        .await
        .map_err(|()| "bounded rejection should not fail the batch")?;

        assert_eq!(admissible, vec![ordinary]);
        let pending = state.lock().await;
        assert_eq!(pending.dynamic_tool_rejections.len(), 1);
        let retained = pending
            .dynamic_tool_rejections
            .values()
            .next()
            .ok_or("bounded rejection missing")?;
        assert!(
            serde_json::to_vec(&retained.response)?.len()
                <= GLOBAL_SUPERVISOR_LIMITS_V1.dynamic_tool_output_max_bytes
        );
        assert_eq!(
            pending.dynamic_tool_rejection_bytes,
            retained.retained_bytes
        );
        assert!(pending.dynamic_tool_rejection_bytes <= MAX_PENDING_SERVER_REQUEST_BYTES);
        Ok(())
    }

    #[tokio::test]
    async fn dynamic_tool_identity_gate_discards_malformed_under_limit_requests_in_isolation()
    -> Result<(), Box<dyn std::error::Error>> {
        let state = Arc::new(tokio::sync::Mutex::new(PendingServerRequests::default()));
        let malformed_requests = || {
            [
                json!({"nested": "id"}),
                json!(true),
                Value::Null,
                json!(1.5),
            ]
            .into_iter()
            .map(|id| {
                let mut request = dynamic_request(0);
                request["id"] = id;
                request
            })
            .collect::<Vec<_>>()
        };
        let valid = dynamic_request(0);
        let unrelated = json!({
            "method": "turn/completed",
            "params": {"threadId": "ordinary-thread"}
        });

        let mut payloads = malformed_requests();
        payloads.push(unrelated.clone());
        payloads.push(valid.clone());
        let admissible = reject_oversized_dynamic_tool_requests(&state, payloads)
            .await
            .map_err(|()| "malformed identities should not fail unrelated ingest")?;

        assert_eq!(admissible, vec![unrelated, valid.clone()]);
        observe_server_requests(&state, &admissible)
            .await
            .map_err(|()| "valid request should be retained")?;
        let pending = state.lock().await;
        assert_eq!(pending.requests.len(), 1);
        assert_eq!(pending.requests["string:\"dynamic\""], valid);
        drop(pending);

        let direct_state = Arc::new(tokio::sync::Mutex::new(PendingServerRequests::default()));
        let mut direct_payloads = malformed_requests();
        direct_payloads.push(dynamic_request(0));
        observe_server_requests(&direct_state, &direct_payloads)
            .await
            .map_err(|()| "ordinary retention should discard malformed identities")?;
        let direct_pending = direct_state.lock().await;
        assert_eq!(direct_pending.requests.len(), 1);
        assert!(direct_pending.requests.contains_key("string:\"dynamic\""));
        Ok(())
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn oversized_dynamic_tool_rejection_survives_reconnect_and_resolves_once()
    -> Result<(), Box<dyn std::error::Error>> {
        let directory = tempfile::tempdir()?;
        let socket_path = directory.path().join("app-server.sock");
        let state = Arc::new(tokio::sync::Mutex::new(PendingServerRequests::default()));
        let oversized = dynamic_request(GLOBAL_SUPERVISOR_LIMITS_V1.dynamic_tool_input_max_bytes);
        assert!(
            reject_oversized_dynamic_tool_requests(&state, vec![oversized])
                .await
                .map_err(|()| "oversized rejection should be retained")?
                .is_empty()
        );

        let upstream = UpstreamHandle::spawn(socket_path.clone());
        let retry_task = tokio::spawn(retry_oversized_dynamic_tool_rejections(
            upstream,
            state.clone(),
        ));
        tokio::time::sleep(Duration::from_millis(100)).await;
        assert_eq!(state.lock().await.dynamic_tool_rejections.len(), 1);

        let listener = UnixListener::bind(socket_path)?;
        let response = tokio::time::timeout(Duration::from_secs(5), async move {
            let (stream, _) = listener.accept().await?;
            let mut socket = accept_async(stream).await?;
            let initialize = receive_test_value(&mut socket).await?;
            send_test_value(&mut socket, &json!({"id": initialize["id"], "result": {}})).await?;
            let initialized = receive_test_value(&mut socket).await?;
            if initialized["method"] != "initialized" {
                return Err::<Value, Box<dyn std::error::Error>>(
                    "missing initialized notification".into(),
                );
            }
            let response = receive_test_value(&mut socket).await?;
            if tokio::time::timeout(Duration::from_millis(200), socket.next())
                .await
                .is_ok()
            {
                return Err("duplicate rejection response".into());
            }
            Ok(response)
        })
        .await??;
        assert_eq!(response["id"], "dynamic");
        assert_eq!(response["result"]["success"], false);
        tokio::time::timeout(Duration::from_secs(1), async {
            loop {
                if state.lock().await.dynamic_tool_rejections.is_empty() {
                    return;
                }
                tokio::task::yield_now().await;
            }
        })
        .await?;
        retry_task.abort();
        Ok(())
    }

    #[cfg(unix)]
    async fn receive_test_value(
        socket: &mut tokio_tungstenite::WebSocketStream<tokio::net::UnixStream>,
    ) -> Result<Value, Box<dyn std::error::Error>> {
        loop {
            let frame = socket.next().await.ok_or("socket closed")??;
            if let Message::Text(raw) = frame {
                return Ok(serde_json::from_str(&raw)?);
            }
        }
    }

    #[cfg(unix)]
    async fn send_test_value(
        socket: &mut tokio_tungstenite::WebSocketStream<tokio::net::UnixStream>,
        value: &Value,
    ) -> Result<(), Box<dyn std::error::Error>> {
        socket.send(Message::Text(value.to_string().into())).await?;
        Ok(())
    }

    #[test]
    fn dynamic_tool_output_accepts_the_limit_and_replaces_one_more_byte()
    -> Result<(), Box<dyn std::error::Error>> {
        let response = |text_bytes| {
            json!({
                "id": "dynamic",
                "result": {
                    "contentItems": [{"type": "inputText", "text": "x".repeat(text_bytes)}],
                    "success": true
                }
            })
        };
        let empty_size = serde_json::to_vec(&response(0))?.len();
        let text_bytes = GLOBAL_SUPERVISOR_LIMITS_V1
            .dynamic_tool_output_max_bytes
            .saturating_sub(empty_size);
        let at_limit = response(text_bytes);
        assert_eq!(
            enforce_dynamic_tool_output_limit(
                at_limit.clone(),
                Some(PendingRequestClass::SystemDynamicTool)
            ),
            at_limit
        );
        let replaced = enforce_dynamic_tool_output_limit(
            response(text_bytes + 1),
            Some(PendingRequestClass::SystemDynamicTool),
        );
        assert_eq!(replaced["result"]["success"], false);
        assert_eq!(
            replaced["result"]["contentItems"][0]["text"],
            "dynamic_tool_output_too_large"
        );
        Ok(())
    }

    #[tokio::test]
    async fn disconnect_removes_only_user_interactions() -> Result<(), Box<dyn std::error::Error>> {
        let state = Arc::new(tokio::sync::Mutex::new(PendingServerRequests::default()));
        observe_server_requests(
            &state,
            &[
                json!({
                    "id": "user",
                    "method": "item/tool/requestUserInput",
                    "params": {"threadId": "thread"}
                }),
                json!({
                    "id": "system",
                    "method": "item/tool/call",
                    "params": {"threadId": "thread"}
                }),
            ],
        )
        .await
        .map_err(|()| "requests should fit")?;
        let (status_sender, status) = tokio::sync::watch::channel(ConnectionStatus::Live);
        let (event_sender, mut events) = tokio::sync::mpsc::channel(2);
        let task = tokio::spawn(clear_user_requests_on_disconnect(
            status,
            state.clone(),
            event_sender,
        ));
        status_sender.send(ConnectionStatus::Reconnecting)?;
        let resolved = tokio::time::timeout(std::time::Duration::from_secs(1), events.recv())
            .await?
            .ok_or("resolution event should exist")?;
        assert_eq!(resolved["params"]["requestId"], "user");
        let pending = state.lock().await;
        assert_eq!(pending.requests.len(), 1);
        assert!(
            pending
                .requests
                .values()
                .any(|request| request["id"] == "system")
        );
        task.abort();
        Ok(())
    }
}
