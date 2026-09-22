//! Server-local authenticated device identity for durable upload ownership.

use base64::{Engine as _, engine::general_purpose::URL_SAFE_NO_PAD};
use sha2::{Digest, Sha256};

use crate::auth::AuthorizationContext;

#[derive(Debug, thiserror::Error)]
#[error("authenticated device session required")]
pub struct UploadOwnerError;

// Historical identity namespace preserves ownership of already persisted V1 uploads.
const PREFIX: &str = "sync-v2-server-principal:v1:";

#[derive(Clone, Debug, Eq, Hash, PartialEq)]
pub struct UploadOwnerKey(String);

impl UploadOwnerKey {
    /// Derives a server-local owner from the paired device principal.
    ///
    /// This key never crosses the wire and is unrelated to the client's opaque
    /// connection cache partition. The paired device identity owns its uploads.
    ///
    /// # Errors
    ///
    /// Returns an error when the authorization is not a paired session or the binding is invalid.
    pub fn derive(authorization: &AuthorizationContext) -> Result<Self, UploadOwnerError> {
        let AuthorizationContext::Session { device_id, .. } = authorization else {
            return Err(UploadOwnerError);
        };
        if device_id.is_empty() {
            return Err(UploadOwnerError);
        }
        let digest = Sha256::digest(device_id.as_bytes());
        Ok(Self(format!("{PREFIX}{}", URL_SAFE_NO_PAD.encode(digest))))
    }

    #[must_use]
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn session(device_id: &str) -> AuthorizationContext {
        AuthorizationContext::Session {
            device_id: device_id.into(),
            expires_at: u64::MAX,
        }
    }

    #[test]
    fn binding_is_stable_and_separates_server_principals() {
        let first = UploadOwnerKey::derive(&session("device-a"))
            .unwrap_or_else(|error| panic!("{error:?}"));
        assert_eq!(
            first,
            UploadOwnerKey::derive(&session("device-a"))
                .unwrap_or_else(|error| panic!("{error:?}"))
        );
        assert_ne!(
            first,
            UploadOwnerKey::derive(&session("device-b"))
                .unwrap_or_else(|error| panic!("{error:?}"))
        );
        assert!(UploadOwnerKey::derive(&AuthorizationContext::Admin).is_err());
    }
}
