//! Draft store fixtures: routing, versions and the Submit claim.
#![allow(clippy::expect_used)]

use super::*;
use crate::review::source::DiffSource;

fn input(id: &str) -> DraftInput {
    DraftInput {
        id: id.into(),
        revision: DiffSourceRevision {
            source: DiffSource::PullRequest {
                pull_request: "fpr1.x".into(),
            },
            revision: "head-1".into(),
        },
        anchor: DraftAnchor {
            path: "a.rs".into(),
            side: Side::New,
            start_line: 1,
            end_line: 1,
            hunk: None,
        },
        body: "note".into(),
        destination: Destination::Pr,
        target_thread_id: None,
    }
}

#[test]
fn a_claim_is_exclusive_and_freezes_edits_until_settled() {
    let directory = tempfile::tempdir().expect("dir");
    let store = DraftStore::new(Arc::new(
        IndexStore::open(directory.path().join("state.redb")).expect("store"),
    ));
    let id = "00000000-0000-4000-8000-000000000001";
    let draft = store
        .put(&input(id), None, Author::User, None, "t0")
        .expect("put");
    let ids = vec![id.to_owned()];
    let claimed = store
        .claim_for_submit(&ids, "fpr1.x", "head-1", "t1")
        .expect("first claim");
    assert_eq!(
        claimed[0].routing.pr().map(|pr| pr.state),
        Some(PrState::Submitting)
    );
    assert!(matches!(
        store.claim_for_submit(&ids, "fpr1.x", "head-1", "t2"),
        Err(ReviewError::Conflict(_))
    ));
    assert!(matches!(
        store.put(&input(id), Some(draft.version), Author::User, None, "t3"),
        Err(ReviewError::Conflict(_))
    ));
    assert!(matches!(
        store.delete(id, claimed[0].version),
        Err(ReviewError::Conflict(_))
    ));
    assert!(matches!(
        store.claim_for_submit(&ids, "fpr1.other", "head-1", "t4"),
        Err(ReviewError::Invalid(_))
    ));
    store.end_submit(&ids);
    // A crashed run (no in-flight marker) reopens as outcomeUnknown.
    let listed = store
        .list(&input(id).revision.source.storage_key())
        .expect("list");
    assert_eq!(
        listed[0]
            .routing
            .pr()
            .and_then(|pr| pr.error.clone())
            .as_deref(),
        Some("outcomeUnknown")
    );
}

#[test]
fn a_claim_that_repeats_a_draft_claims_nothing() {
    let directory = tempfile::tempdir().expect("dir");
    let store = DraftStore::new(Arc::new(
        IndexStore::open(directory.path().join("state.redb")).expect("store"),
    ));
    let id = "00000000-0000-4000-8000-000000000001";
    store
        .put(&input(id), None, Author::User, None, "t0")
        .expect("put");
    let repeated = vec![id.to_owned(), id.to_owned()];
    assert!(matches!(
        store.claim_for_submit(&repeated, "fpr1.x", "head-1", "t1"),
        Err(ReviewError::Invalid(_))
    ));
    let claimed = store
        .claim_for_submit(&repeated[..1], "fpr1.x", "head-1", "t2")
        .expect("the draft stayed claimable");
    assert_eq!(claimed.len(), 1);
}
