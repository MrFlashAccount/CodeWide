//! Transient Sync V1 realtime delivery and pending-request classification.
//!
//! Realtime payloads are diverted here before durable ingest. The registry is
//! process-only, socket-owned, bounded, and intentionally has no replay API.

use std::{collections::HashMap, sync::Arc, time::Instant};

use serde_json::{Value, json};
use tracing::info;

use crate::global_supervisor_limits::GLOBAL_SUPERVISOR_LIMITS_V1;

const REALTIME_NOTIFICATION_METHODS: [&str; 8] = [
    "thread/realtime/started",
    "thread/realtime/itemAdded",
    "thread/realtime/transcript/delta",
    "thread/realtime/transcript/done",
    "thread/realtime/outputAudio/delta",
    "thread/realtime/sdp",
    "thread/realtime/error",
    "thread/realtime/closed",
];

const USER_INTERACTION_METHODS: [&str; 5] = [
    "item/commandExecution/requestApproval",
    "item/fileChange/requestApproval",
    "item/tool/requestUserInput",
    "item/permissions/requestApproval",
    "mcpServer/elicitation/request",
];

/// Closed semantic classification used by pending-request transport owners.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum PendingRequestClass {
    UserInteraction,
    SystemDynamicTool,
}

pub(crate) fn classify_pending_request_method(method: &str) -> Option<PendingRequestClass> {
    if USER_INTERACTION_METHODS.contains(&method) {
        Some(PendingRequestClass::UserInteraction)
    } else if method == "item/tool/call" {
        Some(PendingRequestClass::SystemDynamicTool)
    } else {
        None
    }
}

pub(crate) fn is_realtime_notification(payload: &Value) -> bool {
    payload
        .get("method")
        .and_then(Value::as_str)
        .is_some_and(|method| REALTIME_NOTIFICATION_METHODS.contains(&method))
}

pub(crate) fn realtime_startup_notification_method(payload: &Value) -> Option<&str> {
    payload
        .get("method")
        .and_then(Value::as_str)
        .filter(|method| matches!(*method, "thread/realtime/started" | "thread/realtime/sdp"))
}

pub(crate) fn realtime_thread_id(payload: &Value) -> Option<&str> {
    payload
        .get("params")
        .and_then(Value::as_object)
        .and_then(|params| params.get("threadId"))
        .and_then(validated_live_thread_id)
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum ChannelPhase {
    AwaitingStarted,
    Active,
    Closing,
}

pub(crate) struct QueuedLiveEnvelope {
    pub(crate) channel_id: String,
    pub(crate) value: Value,
    pub(crate) encoded_bytes: usize,
    pub(crate) received_at: Instant,
}

struct LiveChannel {
    owner_id: String,
    thread_id: String,
    phase: ChannelPhase,
    realtime_session_id: Option<String>,
    realtime_version: Option<String>,
    next_sequence: u64,
    queued_envelopes: usize,
    queued_bytes: usize,
    sender: tokio::sync::mpsc::Sender<QueuedLiveEnvelope>,
    terminal_sender: tokio::sync::mpsc::UnboundedSender<Value>,
}

#[derive(Default)]
struct LiveRegistryState {
    channels: HashMap<String, LiveChannel>,
    channel_by_thread: HashMap<String, String>,
}

/// Process-only owner for authenticated live subscriptions.
#[derive(Default)]
pub(crate) struct LiveChannelRegistry {
    state: tokio::sync::Mutex<LiveRegistryState>,
}

#[derive(Debug, Eq, PartialEq)]
pub(crate) enum SubscribeError {
    DuplicateChannel,
    ThreadAlreadySubscribed,
}

pub(crate) enum LiveControlResult {
    Reply(Value),
    Invalid,
}

impl LiveChannelRegistry {
    pub(crate) async fn handle_control(
        self: &Arc<Self>,
        owner_id: &str,
        current_channel_id: &mut Option<String>,
        message: &Value,
        sender: &tokio::sync::mpsc::Sender<QueuedLiveEnvelope>,
        terminal_sender: &tokio::sync::mpsc::UnboundedSender<Value>,
    ) -> LiveControlResult {
        match message.get("type").and_then(Value::as_str) {
            Some("liveSubscribe") => {
                let Some((channel_id, thread_id)) = live_subscribe_fields(message) else {
                    return LiveControlResult::Invalid;
                };
                if current_channel_id.is_some() {
                    return LiveControlResult::Reply(json!({
                        "type": "liveSubscriptionRejected",
                        "channelId": channel_id,
                        "reason": "socketAlreadySubscribed"
                    }));
                }
                match self
                    .subscribe(
                        owner_id,
                        channel_id.clone(),
                        thread_id.clone(),
                        sender.clone(),
                        terminal_sender.clone(),
                    )
                    .await
                {
                    Ok(()) => {
                        *current_channel_id = Some(channel_id.clone());
                        LiveControlResult::Reply(json!({
                            "type": "liveSubscribed",
                            "channelId": channel_id,
                            "threadId": thread_id
                        }))
                    }
                    Err(error) => {
                        let reason = match error {
                            SubscribeError::DuplicateChannel => "duplicateChannel",
                            SubscribeError::ThreadAlreadySubscribed => "threadAlreadySubscribed",
                        };
                        LiveControlResult::Reply(json!({
                            "type": "liveSubscriptionRejected",
                            "channelId": channel_id,
                            "reason": reason
                        }))
                    }
                }
            }
            Some("liveUnsubscribe") => {
                let Some(channel_id) = live_unsubscribe_channel_id(message) else {
                    return LiveControlResult::Invalid;
                };
                if current_channel_id.as_deref() != Some(channel_id.as_str())
                    || !self.unsubscribe(owner_id, &channel_id).await
                {
                    return LiveControlResult::Reply(json!({
                        "type": "liveSubscriptionRejected",
                        "channelId": channel_id,
                        "reason": "unknownChannel"
                    }));
                }
                *current_channel_id = None;
                LiveControlResult::Reply(json!({
                    "type": "liveUnsubscribed",
                    "channelId": channel_id
                }))
            }
            _ => LiveControlResult::Invalid,
        }
    }

    pub(crate) async fn subscribe(
        self: &Arc<Self>,
        owner_id: &str,
        channel_id: String,
        thread_id: String,
        sender: tokio::sync::mpsc::Sender<QueuedLiveEnvelope>,
        terminal_sender: tokio::sync::mpsc::UnboundedSender<Value>,
    ) -> Result<(), SubscribeError> {
        {
            let mut state = self.state.lock().await;
            if state.channels.contains_key(&channel_id) {
                return Err(SubscribeError::DuplicateChannel);
            }
            if state.channel_by_thread.contains_key(&thread_id) {
                return Err(SubscribeError::ThreadAlreadySubscribed);
            }
            state
                .channel_by_thread
                .insert(thread_id.clone(), channel_id.clone());
            state.channels.insert(
                channel_id.clone(),
                LiveChannel {
                    owner_id: owner_id.to_owned(),
                    thread_id,
                    phase: ChannelPhase::AwaitingStarted,
                    realtime_session_id: None,
                    realtime_version: None,
                    next_sequence: 1,
                    queued_envelopes: 0,
                    queued_bytes: 0,
                    sender,
                    terminal_sender,
                },
            );
        }
        let registry = self.clone();
        let timeout_channel_id = channel_id.clone();
        tokio::spawn(async move {
            tokio::time::sleep(GLOBAL_SUPERVISOR_LIMITS_V1.realtime_startup_timeout()).await;
            registry
                .expire_startup(&timeout_channel_id, "startupTimeout")
                .await;
        });
        Ok(())
    }

    pub(crate) async fn unsubscribe(&self, owner_id: &str, channel_id: &str) -> bool {
        let mut state = self.state.lock().await;
        let Some(channel) = state.channels.get(channel_id) else {
            return false;
        };
        if channel.owner_id != owner_id {
            return false;
        }
        remove_channel(&mut state, channel_id);
        true
    }

    pub(crate) async fn unsubscribe_owner(&self, owner_id: &str) {
        let mut state = self.state.lock().await;
        let channel_ids = state
            .channels
            .iter()
            .filter(|(_channel_id, channel)| channel.owner_id == owner_id)
            .map(|(channel_id, _channel)| channel_id.clone())
            .collect::<Vec<_>>();
        for channel_id in channel_ids {
            remove_channel(&mut state, &channel_id);
        }
    }

    /// Diverts a realtime notification. Returns true for every whitelisted
    /// realtime method, even when no active subscription accepts the payload.
    pub(crate) async fn route(&self, payload: Value) -> bool {
        if !is_realtime_notification(&payload) {
            return false;
        }
        let received_at = Instant::now();
        let Some(thread_id) = realtime_thread_id(&payload).map(str::to_owned) else {
            let mut state = self.state.lock().await;
            terminate_all_channels(&mut state, "invalidRealtimeNotification");
            return true;
        };
        let method = payload
            .get("method")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_owned();
        if realtime_startup_notification_method(&payload).is_some() {
            info!(
                thread_id = %thread_id,
                method = %method,
                "global voice startup notification received from app server"
            );
        }
        let mut state = self.state.lock().await;
        let Some(channel_id) = state.channel_by_thread.get(&thread_id).cloned() else {
            return true;
        };
        let mut terminal_reason = None;
        {
            let Some(channel) = state.channels.get_mut(&channel_id) else {
                state.channel_by_thread.remove(&thread_id);
                return true;
            };
            match (channel.phase, method.as_str()) {
                (ChannelPhase::AwaitingStarted, "thread/realtime/started") => {
                    if let Some((session_id, version)) = started_binding(&payload) {
                        channel.realtime_session_id = Some(session_id.to_owned());
                        channel.realtime_version = Some(version.to_owned());
                        channel.phase = ChannelPhase::Active;
                    } else {
                        terminal_reason = Some("invalidStarted");
                    }
                }
                (ChannelPhase::AwaitingStarted, _) => {
                    terminal_reason = Some("eventBeforeStarted");
                }
                (ChannelPhase::Active, "thread/realtime/started") => {
                    terminal_reason = Some("duplicateStarted");
                }
                (ChannelPhase::Active, "thread/realtime/closed") => {
                    channel.phase = ChannelPhase::Closing;
                }
                (ChannelPhase::Active, _) => {}
                (ChannelPhase::Closing, _) => {
                    terminal_reason = Some("eventAfterClosed");
                }
            }
            if terminal_reason.is_none() {
                let envelope = json!({
                    "type": "liveEvent",
                    "channelId": channel_id,
                    "threadId": thread_id,
                    "sequence": channel.next_sequence,
                    "payload": payload
                });
                let encoded_bytes =
                    serde_json::to_vec(&envelope).map_or(usize::MAX, |bytes| bytes.len());
                if live_envelope_too_large(encoded_bytes) {
                    terminal_reason = Some("envelopeTooLarge");
                } else if live_queue_limit_exceeded(
                    channel.queued_envelopes,
                    channel.queued_bytes,
                    encoded_bytes,
                ) {
                    terminal_reason = Some("channelOverflow");
                } else {
                    match channel.sender.try_send(QueuedLiveEnvelope {
                        channel_id: channel_id.clone(),
                        value: envelope,
                        encoded_bytes,
                        received_at,
                    }) {
                        Ok(()) => {
                            channel.next_sequence = channel.next_sequence.saturating_add(1);
                            channel.queued_envelopes += 1;
                            channel.queued_bytes += encoded_bytes;
                        }
                        Err(_) => terminal_reason = Some("channelOverflow"),
                    }
                }
            }
        }
        if let Some(reason) = terminal_reason {
            terminate_channel(&mut state, &channel_id, reason);
        }
        true
    }

    pub(crate) async fn acknowledge_delivery(&self, channel_id: &str, encoded_bytes: usize) {
        let mut state = self.state.lock().await;
        let remove_after_delivery = {
            let Some(channel) = state.channels.get_mut(channel_id) else {
                return;
            };
            channel.queued_envelopes = channel.queued_envelopes.saturating_sub(1);
            channel.queued_bytes = channel.queued_bytes.saturating_sub(encoded_bytes);
            channel.phase == ChannelPhase::Closing
        };
        if remove_after_delivery {
            remove_channel(&mut state, channel_id);
        }
    }

    async fn expire_startup(&self, channel_id: &str, reason: &'static str) {
        let mut state = self.state.lock().await;
        let should_expire = state
            .channels
            .get(channel_id)
            .is_some_and(|channel| channel.phase == ChannelPhase::AwaitingStarted);
        if should_expire {
            terminate_channel(&mut state, channel_id, reason);
        }
    }
}

fn terminate_channel(state: &mut LiveRegistryState, channel_id: &str, reason: &'static str) {
    if let Some(channel) = state.channels.get(channel_id) {
        let _ = channel.terminal_sender.send(json!({
            "type": "liveOverflow",
            "channelId": channel_id,
            "reason": reason
        }));
    }
    remove_channel(state, channel_id);
}

fn terminate_all_channels(state: &mut LiveRegistryState, reason: &'static str) {
    let channel_ids = state.channels.keys().cloned().collect::<Vec<_>>();
    for channel_id in channel_ids {
        terminate_channel(state, &channel_id, reason);
    }
}

fn remove_channel(state: &mut LiveRegistryState, channel_id: &str) {
    if let Some(channel) = state.channels.remove(channel_id) {
        state.channel_by_thread.remove(&channel.thread_id);
    }
}

fn live_queue_limit_exceeded(
    queued_envelopes: usize,
    queued_bytes: usize,
    next_envelope_bytes: usize,
) -> bool {
    queued_envelopes >= GLOBAL_SUPERVISOR_LIMITS_V1.live_channel_max_envelopes
        || queued_bytes.saturating_add(next_envelope_bytes)
            > GLOBAL_SUPERVISOR_LIMITS_V1.live_channel_max_bytes
}

fn live_envelope_too_large(encoded_bytes: usize) -> bool {
    encoded_bytes > GLOBAL_SUPERVISOR_LIMITS_V1.live_envelope_max_bytes
}

fn started_binding(payload: &Value) -> Option<(&str, &str)> {
    let params = payload.get("params")?.as_object()?;
    let session_id = params.get("realtimeSessionId")?.as_str()?.trim();
    let version = params.get("version")?.as_str()?;
    if session_id.is_empty() || version != "v3" {
        return None;
    }
    Some((session_id, version))
}

fn live_subscribe_fields(message: &Value) -> Option<(String, String)> {
    let object = message.as_object()?;
    if object.len() != 3 {
        return None;
    }
    let channel_id = object.get("channelId")?.as_str()?.trim();
    let thread_id = validated_live_thread_id(object.get("threadId")?)?;
    if channel_id.is_empty() {
        return None;
    }
    Some((channel_id.to_owned(), thread_id.to_owned()))
}

fn validated_live_thread_id(value: &Value) -> Option<&str> {
    let thread_id = value.as_str()?;
    let trimmed = thread_id.trim();
    (!trimmed.is_empty() && trimmed == thread_id).then_some(thread_id)
}

fn live_unsubscribe_channel_id(message: &Value) -> Option<String> {
    let object = message.as_object()?;
    if object.len() != 2 {
        return None;
    }
    let channel_id = object.get("channelId")?.as_str()?.trim();
    (!channel_id.is_empty()).then(|| channel_id.to_owned())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pending_request_classification_is_closed() {
        for method in USER_INTERACTION_METHODS {
            assert_eq!(
                classify_pending_request_method(method),
                Some(PendingRequestClass::UserInteraction)
            );
        }
        assert_eq!(
            classify_pending_request_method("item/tool/call"),
            Some(PendingRequestClass::SystemDynamicTool)
        );
        assert_eq!(classify_pending_request_method("future/request"), None);
    }

    #[test]
    fn startup_notification_classification_is_closed() {
        for method in ["thread/realtime/started", "thread/realtime/sdp"] {
            assert_eq!(
                realtime_startup_notification_method(&json!({"method": method})),
                Some(method)
            );
        }
        assert_eq!(
            realtime_startup_notification_method(
                &json!({"method": "thread/realtime/transcript/delta"})
            ),
            None
        );
    }

    #[test]
    fn queue_byte_limit_accepts_exact_limit_and_rejects_one_more() {
        assert!(!live_queue_limit_exceeded(
            1,
            GLOBAL_SUPERVISOR_LIMITS_V1.live_channel_max_bytes - 100,
            100,
        ));
        assert!(live_queue_limit_exceeded(
            1,
            GLOBAL_SUPERVISOR_LIMITS_V1.live_channel_max_bytes - 100,
            101,
        ));
    }

    #[test]
    fn envelope_byte_limit_accepts_exact_limit_and_rejects_one_more() {
        assert!(!live_envelope_too_large(
            GLOBAL_SUPERVISOR_LIMITS_V1.live_envelope_max_bytes
        ));
        assert!(live_envelope_too_large(
            GLOBAL_SUPERVISOR_LIMITS_V1.live_envelope_max_bytes + 1
        ));
    }

    #[test]
    fn live_thread_id_uses_one_canonical_non_empty_contract() {
        assert_eq!(
            realtime_thread_id(&json!({"params": {"threadId": "thread"}})),
            Some("thread")
        );
        for invalid in [
            json!(""),
            json!(" \t\n "),
            json!(" thread "),
            json!(7),
            Value::Null,
        ] {
            assert_eq!(
                realtime_thread_id(&json!({"params": {"threadId": invalid}})),
                None
            );
        }
    }

    #[tokio::test]
    async fn live_channel_sequences_events_and_terminates_on_close() -> Result<(), &'static str> {
        let registry = Arc::new(LiveChannelRegistry::default());
        let (sender, mut receiver) =
            tokio::sync::mpsc::channel(GLOBAL_SUPERVISOR_LIMITS_V1.live_channel_max_envelopes);
        let (terminal_sender, mut terminal_receiver) = tokio::sync::mpsc::unbounded_channel();
        registry
            .subscribe(
                "owner",
                "channel".into(),
                "thread".into(),
                sender,
                terminal_sender,
            )
            .await
            .map_err(|_error| "subscription should be accepted")?;
        assert!(
            registry
                .route(json!({
                    "method": "thread/realtime/started",
                    "params": {"threadId": "thread", "version": "v3", "realtimeSessionId": "session"}
                }))
                .await
        );
        let started = receiver.recv().await.ok_or("started event missing")?;
        registry
            .acknowledge_delivery(&started.channel_id, started.encoded_bytes)
            .await;
        assert_eq!(started.value["sequence"], 1);
        assert!(
            registry
                .route(json!({
                    "method": "thread/realtime/closed",
                    "params": {"threadId": "thread"}
                }))
                .await
        );
        let closed = receiver.recv().await.ok_or("closed event missing")?;
        assert_eq!(closed.value["sequence"], 2);
        registry
            .acknowledge_delivery(&closed.channel_id, closed.encoded_bytes)
            .await;
        assert!(receiver.recv().await.is_none());
        assert!(terminal_receiver.try_recv().is_err());
        Ok(())
    }

    #[tokio::test]
    async fn oversized_envelope_terminates_without_queueing_payload() -> Result<(), &'static str> {
        let registry = Arc::new(LiveChannelRegistry::default());
        let (sender, mut receiver) =
            tokio::sync::mpsc::channel(GLOBAL_SUPERVISOR_LIMITS_V1.live_channel_max_envelopes);
        let (terminal_sender, mut terminal_receiver) = tokio::sync::mpsc::unbounded_channel();
        registry
            .subscribe(
                "owner",
                "channel".into(),
                "thread".into(),
                sender,
                terminal_sender,
            )
            .await
            .map_err(|_error| "subscription should be accepted")?;
        registry
            .route(json!({
                "method": "thread/realtime/started",
                "params": {"threadId": "thread", "version": "v3", "realtimeSessionId": "session"}
            }))
            .await;
        let started = receiver.recv().await.ok_or("started event missing")?;
        registry
            .acknowledge_delivery(&started.channel_id, started.encoded_bytes)
            .await;
        registry
            .route(json!({
                "method": "thread/realtime/outputAudio/delta",
                "params": {
                    "threadId": "thread",
                    "audio": {"data": "x".repeat(GLOBAL_SUPERVISOR_LIMITS_V1.live_envelope_max_bytes)}
                }
            }))
            .await;
        let terminal = terminal_receiver
            .recv()
            .await
            .ok_or("terminal control missing")?;
        assert_eq!(terminal["type"], "liveOverflow");
        assert_eq!(terminal["reason"], "envelopeTooLarge");
        assert!(receiver.recv().await.is_none());
        Ok(())
    }

    #[tokio::test]
    async fn channel_accepts_exact_count_limit_and_terminates_before_one_more()
    -> Result<(), &'static str> {
        let registry = Arc::new(LiveChannelRegistry::default());
        let (sender, mut receiver) =
            tokio::sync::mpsc::channel(GLOBAL_SUPERVISOR_LIMITS_V1.live_channel_max_envelopes);
        let (terminal_sender, mut terminal_receiver) = tokio::sync::mpsc::unbounded_channel();
        registry
            .subscribe(
                "owner",
                "channel".into(),
                "thread".into(),
                sender,
                terminal_sender,
            )
            .await
            .map_err(|_error| "subscription should be accepted")?;
        for index in 0..GLOBAL_SUPERVISOR_LIMITS_V1.live_channel_max_envelopes {
            let method = if index == 0 {
                "thread/realtime/started"
            } else {
                "thread/realtime/transcript/delta"
            };
            registry
                .route(json!({
                    "method": method,
                    "params": {
                        "threadId": "thread",
                        "delta": "x",
                        "role": "assistant",
                        "version": "v3",
                        "realtimeSessionId": "session"
                    }
                }))
                .await;
        }
        assert_eq!(
            receiver.len(),
            GLOBAL_SUPERVISOR_LIMITS_V1.live_channel_max_envelopes
        );
        registry
            .route(json!({
                "method": "thread/realtime/transcript/delta",
                "params": {"threadId": "thread", "delta": "x", "role": "assistant"}
            }))
            .await;
        let terminal = terminal_receiver
            .recv()
            .await
            .ok_or("terminal control missing")?;
        assert_eq!(terminal["reason"], "channelOverflow");
        for expected_sequence in 1..=GLOBAL_SUPERVISOR_LIMITS_V1.live_channel_max_envelopes {
            let envelope = receiver.recv().await.ok_or("accepted envelope missing")?;
            assert_eq!(envelope.value["sequence"], expected_sequence);
        }
        assert!(receiver.recv().await.is_none());
        Ok(())
    }

    #[tokio::test]
    async fn ordinary_event_is_not_consumed_by_live_routing() {
        let registry = LiveChannelRegistry::default();
        assert!(
            !registry
                .route(json!({
                    "method": "turn/completed",
                    "params": {"threadId": "thread"}
                }))
                .await
        );
    }
}

#[cfg(test)]
#[path = "sync_live_delivery_tests.rs"]
mod delivery_tests;
