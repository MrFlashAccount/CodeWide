//! Auth flow reservations and the flow cap.

use super::*;

#[test]
fn reservations_are_exclusive_per_pair_and_capped() {
    let flows = AuthFlows::default();
    let Ok(Reserved::Slot(first)) = flows.reserve("github", "github.com") else {
        panic!("first reservation");
    };
    assert!(matches!(
        flows.reserve("github", "GitHub.com"),
        Err(ForgeError::Conflict { .. })
    ));
    let Ok(Reserved::Slot(_second)) = flows.reserve("arcanum", "a.example") else {
        panic!("second pair");
    };
    assert!(matches!(
        flows.reserve("other", "o.example"),
        Err(ForgeError::CapabilityUnavailable { .. })
    ));
    drop(first);
    assert!(matches!(
        flows.reserve("github", "github.com"),
        Ok(Reserved::Slot(_))
    ));
}

#[test]
fn redaction_removes_an_echoed_token_and_drops_the_account() {
    let error = ForgeError::ForgeRejected {
        reason: "bad token ghp_sentinel".into(),
    };
    let redacted = redact(error, "ghp_sentinel");
    let rpc = redacted.to_rpc_error();
    assert_eq!(rpc["code"], -32_081);
    assert!(!rpc.to_string().contains("ghp_sentinel"));
    assert_eq!(rpc["data"]["account"], Value::Null);
}
