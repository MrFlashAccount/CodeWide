//! Server-local authenticated principal binding for V2 routing and receipts.

use base64::{Engine as _, engine::general_purpose::URL_SAFE_NO_PAD};
use sha2::{Digest, Sha256};

use crate::auth::AuthorizationContext;

use super::protocol::V2Error;

const PREFIX: &str = "sync-v2-server-principal:v1:";

#[derive(Clone, Debug, Eq, Hash, PartialEq)]
pub struct AuthenticatedContextKey(String);

impl AuthenticatedContextKey {
    /// Derives a server-local owner from the paired device principal.
    ///
    /// This key never crosses the wire and is unrelated to the client's opaque
    /// `savedServerId` cache partition. Companion identity rotation is handled
    /// by the ledger installation marker, not by changing this principal key.
    ///
    /// # Errors
    ///
    /// Returns an error when the authorization is not a paired session or the binding is invalid.
    pub fn derive(authorization: &AuthorizationContext) -> Result<Self, V2Error> {
        let AuthorizationContext::Session { device_id, .. } = authorization else {
            return Err(V2Error::forbidden("authenticated V2 session required"));
        };
        if device_id.is_empty() {
            return Err(V2Error::forbidden(
                "authenticated V2 context is unavailable",
            ));
        }
        let digest = Sha256::digest(device_id.as_bytes());
        Ok(Self(format!("{PREFIX}{}", URL_SAFE_NO_PAD.encode(digest))))
    }

    #[must_use]
    pub fn as_str(&self) -> &str {
        &self.0
    }

    pub(crate) fn from_persisted(value: String) -> Option<Self> {
        value.starts_with(PREFIX).then_some(Self(value))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn session(device_id: &str) -> AuthorizationContext {
        AuthorizationContext::Session {
            device_id: device_id.into(),
            scopes: vec!["threads.read".into()],
            expires_at: u64::MAX,
        }
    }

    #[test]
    fn binding_is_stable_and_separates_server_principals() {
        let first = AuthenticatedContextKey::derive(&session("device-a"))
            .unwrap_or_else(|error| panic!("{error:?}"));
        assert_eq!(
            first,
            AuthenticatedContextKey::derive(&session("device-a"))
                .unwrap_or_else(|error| panic!("{error:?}"))
        );
        assert_ne!(
            first,
            AuthenticatedContextKey::derive(&session("device-b"))
                .unwrap_or_else(|error| panic!("{error:?}"))
        );
        assert!(AuthenticatedContextKey::derive(&AuthorizationContext::Admin).is_err());
    }
}
