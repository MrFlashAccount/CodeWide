//! Durable turn-delivery storage and claim regressions.

use std::sync::{Arc, Barrier};

use serde_json::json;

use super::{
    IndexStore, MAX_OUTBOX_OWNER_BYTES, OutboxClaimOutcome, OutboxClaimResolution,
    OutboxClaimResolutionOutcome, OutboxPresentation, OutboxState, StoreError,
    ensure_outbox_owner_quota, ensure_outbox_owner_replacement_quota,
};

fn put_queued(store: &IndexStore, command_id: &str) -> Result<(), StoreError> {
    store.outbox_put_turn_start_with_presentation(
        command_id,
        "thread-a",
        json!({
            "threadId": "thread-a",
            "clientUserMessageId": command_id,
            "input": [{"type": "text", "text": command_id}],
        }),
        Some(1),
        OutboxPresentation::Queue,
    )?;
    Ok(())
}

#[test]
fn owner_queue_byte_quota_has_an_explicit_non_destructive_boundary() {
    assert!(ensure_outbox_owner_quota(MAX_OUTBOX_OWNER_BYTES - 1, 1).is_ok());
    assert!(matches!(
        ensure_outbox_owner_quota(MAX_OUTBOX_OWNER_BYTES, 1),
        Err(StoreError::OutboxOwnerQuotaExceeded { limit_bytes })
            if limit_bytes == MAX_OUTBOX_OWNER_BYTES
    ));
    assert!(ensure_outbox_owner_replacement_quota(MAX_OUTBOX_OWNER_BYTES, 1, 1).is_ok());
    assert!(matches!(
        ensure_outbox_owner_replacement_quota(MAX_OUTBOX_OWNER_BYTES, 1, 2),
        Err(StoreError::OutboxOwnerQuotaExceeded { limit_bytes })
            if limit_bytes == MAX_OUTBOX_OWNER_BYTES
    ));
}

#[test]
fn dispatch_and_steer_claims_have_exactly_one_winner() -> Result<(), Box<dyn std::error::Error>> {
    let directory = tempfile::tempdir()?;
    let store = Arc::new(IndexStore::open(directory.path().join("index.redb"))?);
    put_queued(&store, "command-a")?;
    let barrier = Arc::new(Barrier::new(3));
    let (dispatch, steer) = std::thread::scope(|scope| {
        let dispatch_store = Arc::clone(&store);
        let dispatch_barrier = Arc::clone(&barrier);
        let dispatch = scope.spawn(move || {
            dispatch_barrier.wait();
            dispatch_store.outbox_claim_dispatch("command-a")
        });
        let steer_store = Arc::clone(&store);
        let steer_barrier = Arc::clone(&barrier);
        let steer = scope.spawn(move || {
            steer_barrier.wait();
            steer_store.outbox_claim_steer("command-a", "steer-a")
        });
        barrier.wait();
        let dispatch = dispatch
            .join()
            .map_err(|_| std::io::Error::other("dispatch claim panicked"))?;
        let steer = steer
            .join()
            .map_err(|_| std::io::Error::other("steer claim panicked"))?;
        Ok::<_, Box<dyn std::error::Error>>((dispatch?, steer?))
    })?;

    let acquired = usize::from(matches!(dispatch, OutboxClaimOutcome::Acquired { .. }))
        + usize::from(matches!(steer, OutboxClaimOutcome::Acquired { .. }));
    assert_eq!(acquired, 1);
    assert_eq!(store.outbox_list(None)?[0].state, OutboxState::Uncertain);
    assert!(!store.outbox_cancel("command-a")?);
    assert!(
        store
            .outbox_fail_queued("command-a", "stale failure")?
            .is_none()
    );
    assert!(
        store
            .outbox_edit_prompt(
                "command-a",
                &json!([{"type": "text", "text": "replacement"}]),
            )
            .is_err()
    );
    assert!(store.outbox_place("command-a", None).is_err());
    Ok(())
}

#[test]
fn terminal_steer_resolution_is_idempotent_and_stale_safe() -> Result<(), Box<dyn std::error::Error>>
{
    let directory = tempfile::tempdir()?;
    let store = IndexStore::open(directory.path().join("index.redb"))?;
    put_queued(&store, "command-a")?;
    let OutboxClaimOutcome::Acquired { token, .. } =
        store.outbox_claim_steer("command-a", "steer-a")?
    else {
        return Err("steer claim was not acquired".into());
    };

    assert!(matches!(
        store.outbox_resolve_claim(
            "command-a",
            token,
            OutboxClaimResolution::Rejected { error: "rejected" },
        )?,
        OutboxClaimResolutionOutcome::Applied(_)
    ));
    assert!(matches!(
        store.outbox_resolve_claim(
            "command-a",
            token,
            OutboxClaimResolution::Delivered { turn_id: None },
        )?,
        OutboxClaimResolutionOutcome::AlreadyResolved(_)
    ));
    store.outbox_retry_failed("command-a")?;
    assert!(matches!(
        store.outbox_claim_steer("command-a", "steer-a")?,
        OutboxClaimOutcome::Duplicate(_)
    ));
    let OutboxClaimOutcome::Acquired {
        token: retry_token, ..
    } = store.outbox_claim_steer("command-a", "steer-b")?
    else {
        return Err("new steer operation was not acquired".into());
    };
    assert!(retry_token > token);
    assert!(matches!(
        store.outbox_resolve_claim(
            "command-a",
            token,
            OutboxClaimResolution::Delivered { turn_id: None },
        )?,
        OutboxClaimResolutionOutcome::Stale(_)
    ));
    assert!(matches!(
        store.outbox_resolve_claim(
            "command-a",
            retry_token,
            OutboxClaimResolution::Delivered { turn_id: None },
        )?,
        OutboxClaimResolutionOutcome::Applied(_)
    ));
    assert_eq!(store.outbox_list(None)?[0].state, OutboxState::Delivered);

    put_queued(&store, "command-b")?;
    let OutboxClaimOutcome::Acquired {
        token: dispatch_token,
        ..
    } = store.outbox_claim_dispatch("command-b")?
    else {
        return Err("dispatch claim was not acquired".into());
    };
    store.outbox_resolve_claim(
        "command-b",
        dispatch_token,
        OutboxClaimResolution::NotSent { retry_after_ms: 0 },
    )?;
    let OutboxClaimOutcome::Acquired {
        token: next_dispatch_token,
        ..
    } = store.outbox_claim_dispatch("command-b")?
    else {
        return Err("not-sent dispatch was not reacquired".into());
    };
    assert!(next_dispatch_token > dispatch_token);
    Ok(())
}

#[test]
fn indeterminate_steer_claim_survives_restart_without_reacquisition()
-> Result<(), Box<dyn std::error::Error>> {
    let directory = tempfile::tempdir()?;
    let path = directory.path().join("index.redb");
    {
        let store = IndexStore::open(&path)?;
        put_queued(&store, "command-a")?;
        let OutboxClaimOutcome::Acquired { token, .. } =
            store.outbox_claim_steer("command-a", "steer-a")?
        else {
            return Err("steer claim was not acquired".into());
        };
        store.outbox_resolve_claim(
            "command-a",
            token,
            OutboxClaimResolution::Indeterminate {
                error: "connection lost",
                retry_after_ms: 500,
            },
        )?;
    }

    let reopened = IndexStore::open(&path)?;
    assert!(matches!(
        reopened.outbox_claim_steer("command-a", "steer-a")?,
        OutboxClaimOutcome::Duplicate(_)
    ));
    assert!(matches!(
        reopened.outbox_claim_dispatch("command-a")?,
        OutboxClaimOutcome::Unavailable(Some(_))
    ));
    assert_eq!(reopened.outbox_list(None)?[0].state, OutboxState::Uncertain);
    Ok(())
}
