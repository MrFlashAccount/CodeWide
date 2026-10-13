use super::*;
use crate::{HostUpdateDeadlines, HostUpdateRelayState};

const NOW: u64 = 10 * TERMINAL_OUTCOME_TTL_MS;

fn digest(fill: char) -> String {
    fill.to_string().repeat(64)
}

/// A 1.0.0 (`a`) -> 1.1.0 (`b`) journal in `phase`, last updated at `updated_at`.
fn journal(phase: HostUpdatePhase, updated_at: u64) -> HostUpdateJournalV1 {
    HostUpdateJournalV1 {
        journal_version: 1,
        operation_id: "upd_00000000000000000000000000000000".to_owned(),
        nonce: "fence_00000000000000000000".to_owned(),
        initiating_device_id: "device_0000000000000000000".to_owned(),
        current_digest: digest('a'),
        target_digest: digest('b'),
        target_fingerprint: digest('c'),
        pre_update_relay: HostUpdateRelayState {
            configured: true,
            enabled: true,
            upstream_live: true,
        },
        deadlines: HostUpdateDeadlines {
            install_by: 2,
            target_ready_by: 3,
            reconnect_by: 4,
            rollback_by: 5,
        },
        phase,
        started_at: 1,
        restart_started_at: None,
        updated_at,
        error_code: None,
        error_message: None,
    }
}

#[test]
fn terminal_outcome_is_reported_only_for_the_generation_it_describes() {
    use HostUpdatePhase::{Committed, Failed, RolledBack};
    let cases = [
        (Committed, 'b', None),
        (Committed, 'a', Some(DiscardReason::Superseded)),
        (RolledBack, 'a', None),
        (RolledBack, 'b', Some(DiscardReason::Superseded)),
        (Failed, 'a', None),
        (Failed, 'b', None),
        (Failed, 'e', Some(DiscardReason::Superseded)),
        (Committed, 'e', Some(DiscardReason::Superseded)),
        (RolledBack, 'e', Some(DiscardReason::Superseded)),
    ];
    for (phase, installed, expected) in cases {
        assert_eq!(
            discard_reason(&journal(phase, NOW), &digest(installed), NOW),
            expected,
            "{phase:?} with {installed} installed"
        );
    }
}

#[test]
fn terminal_outcome_expires_after_the_retention_window() {
    let at_limit = journal(HostUpdatePhase::RolledBack, NOW - TERMINAL_OUTCOME_TTL_MS);
    assert_eq!(discard_reason(&at_limit, &digest('a'), NOW), None);
    let expired = journal(
        HostUpdatePhase::RolledBack,
        NOW - TERMINAL_OUTCOME_TTL_MS - 1,
    );
    assert_eq!(
        discard_reason(&expired, &digest('a'), NOW),
        Some(DiscardReason::Expired)
    );
    let from_the_future = journal(HostUpdatePhase::RolledBack, NOW + 1);
    assert_eq!(discard_reason(&from_the_future, &digest('a'), NOW), None);
}

#[test]
fn in_flight_phases_are_never_discarded() {
    for phase in [
        HostUpdatePhase::Accepted,
        HostUpdatePhase::Installing,
        HostUpdatePhase::TargetReady,
        HostUpdatePhase::AwaitingReconnect,
        HostUpdatePhase::RollingBack,
    ] {
        assert_eq!(
            discard_reason(&journal(phase, 0), &digest('e'), NOW),
            None,
            "{phase:?}"
        );
    }
}

#[test]
fn contended_lock_hides_the_outcome_and_defers_pointer_removal() {
    let directory = tempfile::tempdir().expect("temporary directory");
    let state = directory.path();
    let pointer = state.join("active.json");
    store::write_json(
        &state.join("operations/upd_00000000000000000000000000000000.json"),
        &serde_json::json!({ "not": "an operation record" }),
    )
    .expect("corrupt record");
    store::write_json(&pointer, &"upd_00000000000000000000000000000000").expect("pointer");

    let held = store::lock(&state.join("guardian.lock")).expect("writer lock");
    assert!(
        reported_operation(state, &digest('a'), NOW)
            .expect("status read")
            .is_none()
    );
    assert!(pointer.exists(), "a held lock must not be bypassed");
    drop(held);

    assert!(
        reported_operation(state, &digest('a'), NOW)
            .expect("status read")
            .is_none()
    );
    assert!(!pointer.exists());
}

#[test]
fn removal_never_deletes_a_newer_pointer() {
    let directory = tempfile::tempdir().expect("temporary directory");
    let state = directory.path();
    let pointer = state.join("active.json");
    store::write_json(&pointer, &"upd_11111111111111111111111111111111").expect("newer pointer");
    assert!(!discard_pointer(state, "upd_00000000000000000000000000000000").expect("compare"));
    assert_eq!(
        store::read_json::<String>(&pointer).expect("pointer kept"),
        "upd_11111111111111111111111111111111"
    );
}
