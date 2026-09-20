//! Regression tests for delivery-settlement accounting and ambiguous realtime input.

use super::*;

#[tokio::test]
async fn dequeued_envelope_remains_in_count_budget_until_delivery_settles()
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
    registry.route(started_notification("thread")).await;
    let _blocked_delivery = receiver.recv().await.ok_or("started event missing")?;
    for _ in 1..GLOBAL_SUPERVISOR_LIMITS_V1.live_channel_max_envelopes {
        registry.route(delta_notification("thread", 1)).await;
    }
    assert_eq!(
        receiver.len(),
        GLOBAL_SUPERVISOR_LIMITS_V1.live_channel_max_envelopes - 1
    );
    registry.route(delta_notification("thread", 1)).await;
    assert_eq!(
        terminal_receiver
            .recv()
            .await
            .ok_or("terminal control missing")?["reason"],
        "channelOverflow"
    );
    Ok(())
}

#[tokio::test]
async fn dequeued_envelopes_remain_in_byte_budget_until_delivery_settles()
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
    registry.route(started_notification("thread")).await;
    let started = receiver.recv().await.ok_or("started event missing")?;
    let mut retained_bytes = started.encoded_bytes;
    let mut sequence = 2_u64;
    while retained_bytes < GLOBAL_SUPERVISOR_LIMITS_V1.live_channel_max_bytes {
        let remaining = GLOBAL_SUPERVISOR_LIMITS_V1
            .live_channel_max_bytes
            .saturating_sub(retained_bytes);
        let target = remaining.min(GLOBAL_SUPERVISOR_LIMITS_V1.live_envelope_max_bytes);
        let payload = delta_notification_for_envelope_size(sequence, target)?;
        registry.route(payload).await;
        let envelope = receiver.recv().await.ok_or("delta event missing")?;
        assert_eq!(envelope.encoded_bytes, target);
        retained_bytes += envelope.encoded_bytes;
        sequence += 1;
    }
    assert_eq!(
        retained_bytes,
        GLOBAL_SUPERVISOR_LIMITS_V1.live_channel_max_bytes
    );
    registry.route(delta_notification("thread", 1)).await;
    assert_eq!(
        terminal_receiver
            .recv()
            .await
            .ok_or("terminal control missing")?["reason"],
        "channelOverflow"
    );
    Ok(())
}

#[tokio::test]
async fn malformed_realtime_notification_fences_starting_and_active_channels()
-> Result<(), &'static str> {
    let registry = Arc::new(LiveChannelRegistry::default());
    let (starting_sender, mut starting_receiver) = tokio::sync::mpsc::channel(4);
    let (starting_terminal_sender, mut starting_terminal_receiver) =
        tokio::sync::mpsc::unbounded_channel();
    registry
        .subscribe(
            "starting-owner",
            "starting-channel".into(),
            "starting-thread".into(),
            starting_sender,
            starting_terminal_sender,
        )
        .await
        .map_err(|_error| "starting subscription should be accepted")?;
    let (active_sender, mut active_receiver) = tokio::sync::mpsc::channel(4);
    let (active_terminal_sender, mut active_terminal_receiver) =
        tokio::sync::mpsc::unbounded_channel();
    registry
        .subscribe(
            "active-owner",
            "active-channel".into(),
            "active-thread".into(),
            active_sender,
            active_terminal_sender,
        )
        .await
        .map_err(|_error| "active subscription should be accepted")?;
    registry.route(started_notification("active-thread")).await;
    let started = active_receiver
        .recv()
        .await
        .ok_or("started event missing")?;
    registry
        .acknowledge_delivery(&started.channel_id, started.encoded_bytes)
        .await;

    assert!(
        registry
            .route(json!({
                "method": "thread/realtime/transcript/delta",
                "params": {"delta": "missing thread id"}
            }))
            .await
    );
    assert_eq!(
        starting_terminal_receiver
            .recv()
            .await
            .ok_or("starting terminal missing")?["reason"],
        "invalidRealtimeNotification"
    );
    assert_eq!(
        active_terminal_receiver
            .recv()
            .await
            .ok_or("active terminal missing")?["reason"],
        "invalidRealtimeNotification"
    );
    assert!(starting_receiver.recv().await.is_none());
    assert!(active_receiver.recv().await.is_none());
    Ok(())
}

fn started_notification(thread_id: &str) -> Value {
    json!({
        "method": "thread/realtime/started",
        "params": {
            "threadId": thread_id,
            "version": "v3",
            "realtimeSessionId": "session"
        }
    })
}

fn delta_notification(thread_id: &str, delta_bytes: usize) -> Value {
    json!({
        "method": "thread/realtime/transcript/delta",
        "params": {
            "threadId": thread_id,
            "delta": "x".repeat(delta_bytes),
            "role": "assistant"
        }
    })
}

fn delta_notification_for_envelope_size(
    sequence: u64,
    target_bytes: usize,
) -> Result<Value, &'static str> {
    let payload = delta_notification("thread", 0);
    let envelope = json!({
        "type": "liveEvent",
        "channelId": "channel",
        "threadId": "thread",
        "sequence": sequence,
        "payload": payload
    });
    let base_bytes = serde_json::to_vec(&envelope)
        .map_err(|_error| "test envelope should serialize")?
        .len();
    if target_bytes < base_bytes {
        return Err("target envelope is smaller than its JSON framing");
    }
    Ok(delta_notification("thread", target_bytes - base_bytes))
}
