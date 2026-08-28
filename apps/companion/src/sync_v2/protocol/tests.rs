use super::*;

#[test]
fn error_code_recovery_pairs_are_executable() {
    let valid = r#"{"code":"sourceUnavailable","recovery":"retry","message":"safe"}"#;
    assert!(serde_json::from_str::<V2Error>(valid).is_ok());
    let invalid = r#"{"code":"sourceUnavailable","recovery":"none","message":"unsafe"}"#;
    assert!(serde_json::from_str::<V2Error>(invalid).is_err());
    let invalid_query = r#"{"code":"invalidQuery","recovery":"none","message":"safe"}"#;
    assert!(serde_json::from_str::<V2Error>(invalid_query).is_ok());
}

#[test]
fn closed_frames_reject_unknown_fields() {
    let frame = r#"{"type":"ping","nonce":"n","extra":true}"#;
    assert!(serde_json::from_str::<ClientFrame>(frame).is_err());
}
