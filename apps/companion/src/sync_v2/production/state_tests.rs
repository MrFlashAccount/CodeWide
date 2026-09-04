#![allow(clippy::unwrap_used)]

use super::*;
use serde_json::json;

use crate::sync_v2::{
    domain::SnapshotLimits,
    protocol::{CatalogIntent, PendingRequestScope},
    source::CoordinatorEvent,
};
use std::sync::{
    atomic::{AtomicBool, Ordering},
    mpsc::sync_channel,
};
use std::time::Duration;

fn context(device_id: &str) -> AuthenticatedContextKey {
    AuthenticatedContextKey::derive(&AuthorizationContext::Session {
        device_id: device_id.into(),
        expires_at: u64::MAX,
    })
    .unwrap()
}

#[test]
fn full_turn_keeps_source_items_and_adds_indexed_display_metadata() {
    let source = json!({
        "id": "turn-1",
        "items": [{"type": "agentMessage", "id": "answer", "text": "Done"}],
        "status": "completed",
        "durationMs": 3200
    });
    let local = json!({
        "id": "turn-1",
        "items": [{"type": "agentMessage", "id": "summary", "text": "Summary"}],
        "codewide": {
            "activity": {"count": 2, "kinds": ["commandExecution"]},
            "usage": {
                "tokens": {"input": 26000, "output": 1900},
                "cost": {"totalCostUsd": 0.014}
            }
        }
    });
    let metadata = HashMap::from([("turn-1".to_owned(), local)]);

    let enriched = merge_turn_display_metadata(&source, &metadata);

    assert_eq!(enriched.pointer("/items/0/id"), Some(&json!("answer")));
    assert_eq!(enriched.pointer("/durationMs"), Some(&json!(3200)));
    assert_eq!(
        enriched.pointer("/codewide/activity/count"),
        Some(&json!(2))
    );
    assert_eq!(
        enriched.pointer("/codewide/usage/tokens/input"),
        Some(&json!(26000))
    );
}

#[test]
fn resumed_settings_fill_a_read_only_thread_shell() {
    let thread = serde_json::from_value(json!({
        "id": "thread-1",
        "parentId": null,
        "title": null,
        "preview": "",
        "workspace": "/tmp",
        "archived": false,
        "state": "idle",
        "settings": null,
        "readState": {
            "kind": "unknown",
            "latestActivityMarker": null,
            "readThroughMarker": null,
            "unreadCount": null
        },
        "createdAt": "2026-08-31T00:00:00Z",
        "updatedAt": "2026-08-31T00:00:00Z",
        "lastActivityAt": null,
        "headTurnId": null
    }))
    .unwrap();
    let settings = serde_json::from_value(json!({
        "model": "gpt-5.6-sol",
        "effort": "low",
        "approvalPolicy": "never",
        "sandbox": "unrestricted",
        "personality": null
    }))
    .unwrap();

    let enriched = with_cached_thread_settings(thread, Some(&settings));

    assert_eq!(
        enriched
            .settings
            .as_ref()
            .and_then(|value| value.model.as_deref()),
        Some("gpt-5.6-sol")
    );
}

#[test]
fn witness_eviction_reinitializes_the_affected_recipient() {
    let coordinator = SubscriptionCoordinator::default();
    let first = context("device-a");
    let receiver = coordinator.register(
        Id::new("recipient-a").unwrap(),
        1,
        first.clone(),
        OpenIntent {
            catalog: CatalogIntent {
                active_limit: 0,
                archived_limit: 0,
            },
            current_thread: None,
            pending_requests: PendingRequestScope::CurrentThread,
        },
        SnapshotLimits::default(),
    );
    let mut witnesses = BoundedMap::new(1);
    assert!(insert_thread_access(&mut witnesses, &first, &Id::new("a").unwrap(), 1).is_none());
    let evicted = insert_thread_access(
        &mut witnesses,
        &context("device-b"),
        &Id::new("b").unwrap(),
        1,
    )
    .unwrap();
    coordinator.invalidate_context(&evicted.0.context);
    let (event, _) = receiver.try_recv().unwrap().into_parts();
    assert!(matches!(event, CoordinatorEvent::RoutingInvalidated { .. }));
}

#[test]
fn live_turn_refreshes_coalesce_events_arriving_during_an_inflight_read() {
    let thread_id = Id::new("thread-1").unwrap();
    let mut refreshes = LiveTurnRefreshes::new(2);

    let LiveTurnRefreshAdmission::Spawn { token } = refreshes.admit(&thread_id, 7, false) else {
        panic!("first refresh must spawn");
    };
    assert_eq!(refreshes.begin(&thread_id, 7, token), Some(false));
    assert_eq!(
        refreshes.admit(&thread_id, 7, true),
        LiveTurnRefreshAdmission::Coalesced
    );
    assert_eq!(
        refreshes.complete(&thread_id, 7, token),
        LiveTurnRefreshCompletion::Repeat
    );
    assert_eq!(refreshes.begin(&thread_id, 7, token), Some(true));
    assert_eq!(
        refreshes.complete(&thread_id, 7, token),
        LiveTurnRefreshCompletion::Complete
    );
    assert_eq!(refreshes.begin(&thread_id, 7, token), None);
}

#[test]
fn live_turn_refreshes_bound_distinct_threads_without_dropping_coalescing() {
    let first = Id::new("thread-1").unwrap();
    let second = Id::new("thread-2").unwrap();
    let mut refreshes = LiveTurnRefreshes::new(1);

    assert!(matches!(
        refreshes.admit(&first, 7, false),
        LiveTurnRefreshAdmission::Spawn { .. }
    ));
    assert_eq!(
        refreshes.admit(&first, 7, false),
        LiveTurnRefreshAdmission::Coalesced
    );
    assert_eq!(
        refreshes.admit(&second, 7, false),
        LiveTurnRefreshAdmission::Saturated
    );
}

#[test]
fn old_generation_completion_cannot_remove_a_new_refresh() {
    let thread_id = Id::new("thread-1").unwrap();
    let mut refreshes = LiveTurnRefreshes::new(1);

    let LiveTurnRefreshAdmission::Spawn { token: old_token } =
        refreshes.admit(&thread_id, 7, false)
    else {
        panic!("old refresh must spawn");
    };
    refreshes.clear();
    let LiveTurnRefreshAdmission::Spawn { token: new_token } =
        refreshes.admit(&thread_id, 8, false)
    else {
        panic!("new refresh must spawn");
    };
    assert_eq!(
        refreshes.complete(&thread_id, 7, old_token),
        LiveTurnRefreshCompletion::Complete
    );
    assert_eq!(refreshes.begin(&thread_id, 8, new_token), Some(false));
    assert!(refreshes.is_active(&thread_id, 8, new_token));
    assert!(!refreshes.is_active(&thread_id, 7, old_token));
}

#[test]
fn superseding_same_generation_event_revokes_the_detached_refresh_token() {
    let thread_id = Id::new("thread-1").unwrap();
    let mut refreshes = LiveTurnRefreshes::new(1);
    let LiveTurnRefreshAdmission::Spawn { token: stale_token } =
        refreshes.admit(&thread_id, 7, false)
    else {
        panic!("stale refresh must spawn");
    };
    assert_eq!(refreshes.begin(&thread_id, 7, stale_token), Some(false));
    assert!(refreshes.abort_current(&thread_id, 7));
    let LiveTurnRefreshAdmission::Spawn {
        token: current_token,
    } = refreshes.admit(&thread_id, 7, false)
    else {
        panic!("replacement refresh must spawn");
    };

    assert_ne!(stale_token, current_token);
    assert!(!refreshes.is_active(&thread_id, 7, stale_token));
    assert!(refreshes.is_active(&thread_id, 7, current_token));
}

#[test]
fn superseding_remove_serializes_after_inflight_publication_and_wins() {
    let thread_id = Id::new("thread-1").unwrap();
    let refreshes = Arc::new(Mutex::new(LiveTurnRefreshes::new(1)));
    let LiveTurnRefreshAdmission::Spawn { token } =
        refreshes.lock().unwrap().admit(&thread_id, 7, false)
    else {
        panic!("refresh must spawn");
    };
    let projected = Arc::new(AtomicBool::new(false));
    let (publication_started_tx, publication_started_rx) = sync_channel(0);
    let (release_publication_tx, release_publication_rx) = sync_channel(0);
    let refresh_task = {
        let refreshes = refreshes.clone();
        let thread_id = thread_id.clone();
        let projected = projected.clone();
        std::thread::spawn(move || {
            let refreshes = refreshes.lock().unwrap();
            assert!(refreshes.publish_if_active(&thread_id, 7, token, || {
                publication_started_tx.send(()).unwrap();
                release_publication_rx.recv().unwrap();
                projected.store(true, Ordering::SeqCst);
            }));
        })
    };
    publication_started_rx
        .recv_timeout(Duration::from_secs(2))
        .unwrap();
    let (remove_started_tx, remove_started_rx) = sync_channel(0);
    let remove_task = {
        let refreshes = refreshes.clone();
        let thread_id = thread_id.clone();
        let projected = projected.clone();
        std::thread::spawn(move || {
            remove_started_tx.send(()).unwrap();
            assert!(refreshes.lock().unwrap().abort_current(&thread_id, 7));
            projected.store(false, Ordering::SeqCst);
        })
    };
    remove_started_rx
        .recv_timeout(Duration::from_secs(2))
        .unwrap();
    release_publication_tx.send(()).unwrap();
    refresh_task.join().unwrap();
    remove_task.join().unwrap();

    assert!(!projected.load(Ordering::SeqCst));
}

#[test]
fn refresh_cannot_publish_after_superseding_remove_already_won() {
    let thread_id = Id::new("thread-1").unwrap();
    let mut refreshes = LiveTurnRefreshes::new(1);
    let LiveTurnRefreshAdmission::Spawn { token } = refreshes.admit(&thread_id, 7, false) else {
        panic!("refresh must spawn");
    };
    assert!(refreshes.abort_current(&thread_id, 7));
    let projected = AtomicBool::new(false);

    assert!(!refreshes.publish_if_active(&thread_id, 7, token, || {
        projected.store(true, Ordering::SeqCst);
    }));
    assert!(!projected.load(Ordering::SeqCst));
}

#[test]
fn terminal_catalog_page_has_no_continuation_witness() {
    assert_eq!(source_catalog_cursor(&json!({"nextCursor": null})), None);
    assert_eq!(source_catalog_cursor(&json!({})), None);
    assert_eq!(
        source_catalog_cursor(&json!({"nextCursor": "opaque"})),
        Some("opaque")
    );
}
