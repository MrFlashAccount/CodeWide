//! Runtime request ids on the client wire — compatibility surface
//! `wire-request-ids-v0` (`keep_temporarily`, owner backend; removed when the
//! client speaks the neutral protocol).
//!
//! - The lead provider's ids (the provider speaking the client's native
//!   wire, Codex) are emitted unchanged: the client persists
//!   them across restarts.
//! - Every other provider's ids are emitted as
//!   `"cw-<provider>:" + JSON(nativeId)`.
//! - A lead-provider string id that starts with `cw-` is ambiguous and is
//!   rejected (the caller logs and drops it).

use serde_json::Value;

use crate::model::{NativeRequestId, ProviderId, RuntimeRequestId};

const PREFIX: &str = "cw-";

/// Encodes a provider's native id for the client.
#[must_use]
pub fn encode(id: &RuntimeRequestId, lead: &ProviderId) -> Value {
    if &id.provider == lead {
        return id.native_id.to_json();
    }
    let native = id.native_id.to_json().to_string();
    Value::String(format!("{PREFIX}{}:{native}", id.provider))
}

/// Whether a lead-provider id collides with the prefixed namespace.
#[must_use]
pub fn is_ambiguous_lead_id(id: &Value) -> bool {
    id.as_str().is_some_and(|text| text.starts_with(PREFIX))
}

/// Decodes a client-wire id. Unprefixed ids belong to the lead provider;
/// a malformed prefixed id decodes to `None`.
#[must_use]
pub fn decode(id: &Value, lead: &ProviderId) -> Option<RuntimeRequestId> {
    let Some(text) = id.as_str().and_then(|text| text.strip_prefix(PREFIX)) else {
        return NativeRequestId::from_json(id).map(|native_id| RuntimeRequestId {
            provider: lead.clone(),
            native_id,
        });
    };
    let (provider, native) = text.split_once(':')?;
    let provider = ProviderId::parse(provider)?;
    if &provider == lead {
        return None;
    }
    let native: Value = serde_json::from_str(native).ok()?;
    NativeRequestId::from_json(&native).map(|native_id| RuntimeRequestId {
        provider,
        native_id,
    })
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    fn provider(value: &str) -> Result<ProviderId, &'static str> {
        ProviderId::parse(value).ok_or("invalid provider")
    }

    #[test]
    fn lead_ids_pass_through_and_other_ids_are_namespaced() -> Result<(), &'static str> {
        let codex = provider("codex")?;
        let claude = provider("claude")?;
        for native in [json!(7), json!("abc")] {
            let lead_id = RuntimeRequestId {
                provider: codex.clone(),
                native_id: NativeRequestId::from_json(&native).ok_or("native")?,
            };
            assert_eq!(encode(&lead_id, &codex), native);
            assert_eq!(decode(&native, &codex), Some(lead_id));

            let claude_id = RuntimeRequestId {
                provider: claude.clone(),
                native_id: NativeRequestId::from_json(&native).ok_or("native")?,
            };
            let wire = encode(&claude_id, &codex);
            assert!(
                wire.as_str()
                    .is_some_and(|text| text.starts_with("cw-claude:"))
            );
            assert_eq!(decode(&wire, &codex), Some(claude_id));
        }
        Ok(())
    }

    #[test]
    fn the_same_native_id_of_two_providers_never_collides() -> Result<(), &'static str> {
        let codex = provider("codex")?;
        let native = NativeRequestId::Number(1);
        let first = encode(
            &RuntimeRequestId {
                provider: codex.clone(),
                native_id: native.clone(),
            },
            &codex,
        );
        let second = encode(
            &RuntimeRequestId {
                provider: provider("claude")?,
                native_id: native,
            },
            &codex,
        );
        assert_ne!(first, second);
        Ok(())
    }

    #[test]
    fn malformed_and_ambiguous_ids_are_rejected() -> Result<(), &'static str> {
        let codex = provider("codex")?;
        assert!(is_ambiguous_lead_id(&json!("cw-anything")));
        assert!(!is_ambiguous_lead_id(&json!(3)));
        assert_eq!(decode(&json!("cw-claude"), &codex), None);
        assert_eq!(decode(&json!("cw-claude:{bad"), &codex), None);
        assert_eq!(decode(&json!("cw-codex:1"), &codex), None);
        assert_eq!(decode(&json!({"id": 1}), &codex), None);
        Ok(())
    }
}
