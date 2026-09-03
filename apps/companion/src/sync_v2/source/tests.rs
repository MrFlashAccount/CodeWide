use super::*;
use crate::sync_v2::epoch::ConnectionEpoch;
use crate::sync_v2::protocol::{CatalogIntent, CurrentThreadIntent, PendingRequestScope};
use serde_json::json;

fn id(value: &str) -> Id {
    Id::new(value).unwrap_or_else(|error| panic!("invalid test id: {error}"))
}

fn context(device_id: &str) -> AuthenticatedContextKey {
    AuthenticatedContextKey::derive(&AuthorizationContext::Session {
        device_id: device_id.into(),
        scopes: vec!["threads.read".into()],
        expires_at: u64::MAX,
    })
    .unwrap_or_else(|error| panic!("invalid test context: {error:?}"))
}

fn intent(active_limit: u16, current_thread: Option<&str>) -> OpenIntent {
    OpenIntent {
        catalog: CatalogIntent {
            active_limit,
            archived_limit: 0,
        },
        current_thread: current_thread.map(|thread_id| CurrentThreadIntent {
            thread_id: id(thread_id),
            turn_limit: 1,
        }),
        pending_requests: PendingRequestScope::CurrentThread,
    }
}

fn thread_with_partition(thread_id: &str, archived: bool) -> ThreadSummary {
    serde_json::from_value(json!({
        "id": thread_id,
        "parentId": null,
        "title": null,
        "preview": "",
        "workspace": "/tmp",
        "archived": archived,
        "state": "idle",
        "settings": {
            "model": null,
            "effort": null,
            "approvalPolicy": "never",
            "sandbox": "readOnly",
            "personality": null
        },
        "readState": {
            "kind": "unknown",
            "latestActivityMarker": null,
            "readThroughMarker": null,
            "unreadCount": null
        },
        "createdAt": "2026-08-27T00:00:00Z",
        "updatedAt": "2026-08-27T00:00:00Z",
        "lastActivityAt": null,
        "headTurnId": null
    }))
    .unwrap_or_else(|error| panic!("invalid test thread: {error}"))
}

fn thread(thread_id: &str) -> ThreadSummary {
    thread_with_partition(thread_id, false)
}

#[test]
fn exact_context_routing_isolated_and_ambiguous_routing_invalidates() {
    let coordinator = SubscriptionCoordinator::default();
    let first = id("recipient-a");
    let second = id("recipient-b");
    let context_a = context("device-a");
    let context_b = context("device-b");
    let first_events = coordinator.register(
        first.clone(),
        7,
        context_a.clone(),
        intent(0, None),
        SnapshotLimits::default(),
    );
    let second_events = coordinator.register(
        second.clone(),
        7,
        context_b,
        intent(0, None),
        SnapshotLimits::default(),
    );

    coordinator.publish(
        7,
        AudienceSelector::ExactContext(context_a),
        ProjectionChange::AccountsChanged {
            revision: "context-a".into(),
        },
    );
    let CoordinatorEvent::Change { recipient_ids, .. } = first_events
        .try_recv_event()
        .unwrap_or_else(|error| panic!("missing event: {error:?}"))
    else {
        panic!("expected routed change");
    };
    assert_eq!(recipient_ids.as_ref(), &HashSet::from([first.clone()]));
    assert!(matches!(
        second_events.try_recv_event(),
        Err(CoordinatorRecvError::Empty)
    ));

    coordinator.publish(
        7,
        AudienceSelector::Ambiguous,
        ProjectionChange::AccountsChanged {
            revision: "must-not-leak".into(),
        },
    );
    let CoordinatorEvent::RoutingInvalidated { recipient_ids, .. } = first_events
        .try_recv_event()
        .unwrap_or_else(|error| panic!("missing invalidation: {error:?}"))
    else {
        panic!("expected routing invalidation");
    };
    assert_eq!(
        recipient_ids.as_ref(),
        &HashSet::from([first.clone(), second.clone()])
    );
    let CoordinatorEvent::RoutingInvalidated { recipient_ids, .. } = second_events
        .try_recv_event()
        .unwrap_or_else(|error| panic!("missing second invalidation: {error:?}"))
    else {
        panic!("expected second routing invalidation");
    };
    assert_eq!(recipient_ids.as_ref(), &HashSet::from([first, second]));
}

#[test]
fn pending_scope_reaches_headless_subscribers_without_cross_context_routing() {
    let coordinator = SubscriptionCoordinator::default();
    let owner = context("device-a");
    let other = context("device-b");
    let current_events = coordinator.register(
        id("current"),
        7,
        owner.clone(),
        intent(0, Some("thread-1")),
        SnapshotLimits::default(),
    );
    let mut headless_intent = intent(0, None);
    headless_intent.pending_requests = PendingRequestScope::AllAccessible;
    let headless_events = coordinator.register(
        id("headless"),
        7,
        owner.clone(),
        headless_intent.clone(),
        SnapshotLimits::default(),
    );
    let other_events = coordinator.register(
        id("other"),
        7,
        other,
        headless_intent,
        SnapshotLimits::default(),
    );

    coordinator.publish(
        7,
        AudienceSelector::PendingRequests {
            context: owner.clone(),
            thread_id: Some(id("thread-1")),
        },
        ProjectionChange::AccountsChanged {
            revision: "pending-thread-1".into(),
        },
    );
    assert!(current_events.try_recv_event().is_ok());
    assert!(headless_events.try_recv_event().is_ok());
    assert!(matches!(
        other_events.try_recv_event(),
        Err(CoordinatorRecvError::Empty)
    ));

    coordinator.publish(
        7,
        AudienceSelector::PendingRequests {
            context: owner,
            thread_id: Some(id("thread-2")),
        },
        ProjectionChange::AccountsChanged {
            revision: "pending-thread-2".into(),
        },
    );
    assert!(matches!(
        current_events.try_recv_event(),
        Err(CoordinatorRecvError::Empty)
    ));
    assert!(headless_events.try_recv_event().is_ok());
    assert!(matches!(
        other_events.try_recv_event(),
        Err(CoordinatorRecvError::Empty)
    ));
}

#[test]
fn upstream_unavailability_is_preserved_as_a_distinct_invalidation_reason() {
    let coordinator = SubscriptionCoordinator::default();
    let recipient = id("recipient");
    let events = coordinator.register(
        recipient.clone(),
        11,
        context("device"),
        intent(0, None),
        SnapshotLimits::default(),
    );
    coordinator.invalidate_generation_for(11, SourceInvalidationReason::UpstreamUnavailable);
    let CoordinatorEvent::RoutingInvalidated {
        generation,
        recipient_ids,
        reason,
    } = events
        .try_recv_event()
        .unwrap_or_else(|error| panic!("missing invalidation: {error:?}"))
    else {
        panic!("expected upstream invalidation");
    };
    assert_eq!(generation, 11);
    assert_eq!(recipient_ids.as_ref(), &HashSet::from([recipient]));
    assert_eq!(reason, SourceInvalidationReason::UpstreamUnavailable);
}

#[test]
fn catalog_window_emits_outside_scope_and_current_thread_stays_coherent() {
    let coordinator = SubscriptionCoordinator::default();
    let recipient = id("recipient");
    let context = context("device");
    let events = coordinator.register(
        recipient.clone(),
        3,
        context.clone(),
        intent(1, Some("current")),
        SnapshotLimits::default(),
    );
    coordinator.set_snapshot_membership(&recipient, &[thread("old")], &[]);

    coordinator.publish_catalog_upsert(3, &context, &thread("new"));
    let CoordinatorEvent::Change { change, .. } = events
        .try_recv_event()
        .unwrap_or_else(|error| panic!("missing upsert: {error:?}"))
    else {
        panic!("expected catalog upsert");
    };
    assert!(
        matches!(change, ProjectionChange::ThreadUpserted { thread } if thread.id == id("new"))
    );
    let CoordinatorEvent::Change { change, .. } = events
        .try_recv_event()
        .unwrap_or_else(|error| panic!("missing outside-scope removal: {error:?}"))
    else {
        panic!("expected catalog removal");
    };
    assert!(matches!(
        change,
        ProjectionChange::ThreadRemoved { thread_id, reason: RemovalReason::OutsideScope }
            if thread_id == id("old")
    ));

    coordinator.publish_catalog_upsert(3, &context, &thread("current"));
    let CoordinatorEvent::Change { change, .. } = events
        .try_recv_event()
        .unwrap_or_else(|error| panic!("missing current-thread update: {error:?}"))
    else {
        panic!("expected current-thread update");
    };
    assert!(
        matches!(change, ProjectionChange::ThreadUpserted { thread } if thread.id == id("current"))
    );
}

#[test]
fn snapshot_membership_replays_catalog_changes_that_arrived_during_initialization() {
    let coordinator = SubscriptionCoordinator::default();
    let recipient = id("recipient");
    let context = context("device");
    let events = coordinator.register(
        recipient.clone(),
        3,
        context.clone(),
        intent(1, None),
        SnapshotLimits::default(),
    );

    coordinator.publish_catalog_upsert(3, &context, &thread("new"));
    let CoordinatorEvent::Change { change, .. } = events
        .try_recv_event()
        .unwrap_or_else(|error| panic!("missing initializing upsert: {error:?}"))
    else {
        panic!("expected initializing upsert");
    };
    assert!(matches!(
        change,
        ProjectionChange::ThreadUpserted { thread } if thread.id == id("new")
    ));

    coordinator.set_snapshot_membership(&recipient, &[thread("old")], &[]);
    let CoordinatorEvent::Change { change, .. } = events
        .try_recv_event()
        .unwrap_or_else(|error| panic!("missing reconciled eviction: {error:?}"))
    else {
        panic!("expected reconciled eviction");
    };
    assert!(matches!(
        change,
        ProjectionChange::ThreadRemoved { thread_id, reason: RemovalReason::OutsideScope }
            if thread_id == id("old")
    ));

    coordinator.publish_thread_removed(3, &context, &id("new"), RemovalReason::Deleted);
    let CoordinatorEvent::Change { change, .. } = events
        .try_recv_event()
        .unwrap_or_else(|error| panic!("missing delete after snapshot reconciliation: {error:?}"))
    else {
        panic!("expected delete after snapshot reconciliation");
    };
    assert!(matches!(
        change,
        ProjectionChange::ThreadRemoved { thread_id, reason: RemovalReason::Deleted }
            if thread_id == id("new")
    ));
}

#[test]
fn removal_during_snapshot_is_delivered_and_not_restored_by_snapshot_membership() {
    let coordinator = SubscriptionCoordinator::default();
    let recipient = id("recipient");
    let context = context("device");
    let events = coordinator.register(
        recipient.clone(),
        3,
        context.clone(),
        intent(1, None),
        SnapshotLimits::default(),
    );

    coordinator.publish_thread_removed(3, &context, &id("old"), RemovalReason::Deleted);
    let CoordinatorEvent::Change { change, .. } = events
        .try_recv_event()
        .unwrap_or_else(|error| panic!("missing initializing removal: {error:?}"))
    else {
        panic!("expected initializing removal");
    };
    assert!(matches!(
        change,
        ProjectionChange::ThreadRemoved { thread_id, reason: RemovalReason::Deleted }
            if thread_id == id("old")
    ));

    coordinator.set_snapshot_membership(&recipient, &[thread("old")], &[]);
    coordinator.publish(
        3,
        AudienceSelector::CatalogPartition {
            context,
            archived: false,
        },
        ProjectionChange::ResourcesChanged {
            thread_id: id("old"),
            revision: "removed-thread".into(),
        },
    );
    assert!(matches!(
        events.try_recv_event(),
        Err(CoordinatorRecvError::Empty)
    ));
}

#[test]
fn mailbox_overflow_is_bounded_and_isolated_per_recipient() {
    let coordinator = SubscriptionCoordinator::default();
    let context = context("device");
    let limits = SnapshotLimits {
        queue_max_events: 1,
        queue_max_bytes: 1_024,
        ..SnapshotLimits::default()
    };
    let slow = coordinator.register(id("slow"), 1, context.clone(), intent(0, None), limits);
    let fast = coordinator.register(id("fast"), 1, context.clone(), intent(0, None), limits);

    coordinator.publish(
        1,
        AudienceSelector::ExactContext(context.clone()),
        ProjectionChange::AccountsChanged {
            revision: "one".into(),
        },
    );
    assert!(fast.try_recv_event().is_ok());
    coordinator.publish(
        1,
        AudienceSelector::ExactContext(context),
        ProjectionChange::AccountsChanged {
            revision: "two".into(),
        },
    );

    assert!(matches!(
        slow.try_recv_event(),
        Err(CoordinatorRecvError::Overflow)
    ));
    assert_eq!(slow.queued_usage(), (0, 0));
    assert!(fast.try_recv_event().is_ok());
    assert_eq!(fast.queued_usage(), (0, 0));
}

#[test]
fn one_budget_follows_an_event_from_mailbox_through_snapshot_send() {
    let coordinator = SubscriptionCoordinator::default();
    let context = context("device");
    let limits = SnapshotLimits {
        queue_max_events: 1,
        queue_max_bytes: 1_024,
        ..SnapshotLimits::default()
    };
    let recipient = id("recipient");
    let events = coordinator.register(
        recipient.clone(),
        1,
        context.clone(),
        intent(0, None),
        limits,
    );
    let budget = events.budget();
    coordinator.publish(
        1,
        AudienceSelector::ExactContext(context),
        ProjectionChange::AccountsChanged {
            revision: "one".into(),
        },
    );
    assert_eq!(budget.usage().0, 1);

    let received = events
        .try_recv()
        .unwrap_or_else(|error| panic!("missing event: {error:?}"));
    assert_eq!(events.queued_usage(), (0, 0));
    assert_eq!(budget.usage().0, 1);
    let (event, reservation) = received.into_parts();
    let CoordinatorEvent::Change { change, .. } = event else {
        panic!("expected change");
    };
    let mut epoch = ConnectionEpoch::new_with_budget(recipient, 1, intent(0, None), budget.clone());
    epoch.begin_initializing();
    epoch
        .enqueue_reserved(change, reservation)
        .unwrap_or_else(|error| panic!("enqueue failed: {error:?}"));
    let (_, tail) = epoch.cut_snapshot("sync-v2-revision:test".into());
    assert_eq!(tail.len(), 1);
    assert_eq!(budget.usage().0, 1);
    epoch.confirm_snapshot_sent();
    assert_eq!(budget.usage(), (0, 0));
}

#[test]
fn partition_transitions_remove_threads_when_target_partition_is_unsubscribed() {
    let coordinator = SubscriptionCoordinator::default();
    let context = context("device");

    let active_recipient = id("active-only");
    let active_events = coordinator.register(
        active_recipient.clone(),
        1,
        context.clone(),
        intent(1, None),
        SnapshotLimits::default(),
    );
    coordinator.set_snapshot_membership(&active_recipient, &[thread("to-archive")], &[]);
    coordinator.publish_catalog_upsert(1, &context, &thread_with_partition("to-archive", true));
    assert!(matches!(
        active_events.try_recv_event(),
        Ok(CoordinatorEvent::Change {
            change: ProjectionChange::ThreadRemoved { thread_id, reason: RemovalReason::OutsideScope },
            ..
        }) if thread_id == id("to-archive")
    ));

    let archived_recipient = id("archived-only");
    let archived_intent = OpenIntent {
        catalog: CatalogIntent {
            active_limit: 0,
            archived_limit: 1,
        },
        current_thread: None,
        pending_requests: PendingRequestScope::CurrentThread,
    };
    let archived_events = coordinator.register(
        archived_recipient.clone(),
        1,
        context.clone(),
        archived_intent,
        SnapshotLimits::default(),
    );
    coordinator.set_snapshot_membership(
        &archived_recipient,
        &[],
        &[thread_with_partition("to-active", true)],
    );
    coordinator.publish_catalog_upsert(1, &context, &thread("to-active"));
    assert!(matches!(
        archived_events.try_recv_event(),
        Ok(CoordinatorEvent::Change {
            change: ProjectionChange::ThreadRemoved { thread_id, reason: RemovalReason::OutsideScope },
            ..
        }) if thread_id == id("to-active")
    ));
}
