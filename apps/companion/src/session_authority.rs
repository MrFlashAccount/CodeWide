//! Transport-independent authorization lifetime for authenticated device sessions.

use std::time::{Duration, SystemTime, UNIX_EPOCH};

use tokio::sync::broadcast;

use crate::auth::{AuthorizationChange, AuthorizationContext};

/// Keeps a long-running resource bound to the authenticated device session,
/// without coupling that resource to any HTTP or WebSocket connection.
pub(crate) struct SessionAuthority {
    device_id: String,
    expires_at: u64,
    changes: Option<broadcast::Receiver<AuthorizationChange>>,
}

impl SessionAuthority {
    pub(crate) fn new(
        authorization: &AuthorizationContext,
        changes: Option<broadcast::Receiver<AuthorizationChange>>,
    ) -> Option<Self> {
        let AuthorizationContext::Session {
            device_id,
            expires_at,
            ..
        } = authorization
        else {
            return None;
        };
        Some(Self {
            device_id: device_id.clone(),
            expires_at: *expires_at,
            changes,
        })
    }

    pub(crate) fn is_valid(&mut self) -> bool {
        if unix_time_ms() >= self.expires_at {
            return false;
        }
        let Some(changes) = &mut self.changes else {
            return true;
        };
        loop {
            match changes.try_recv() {
                Ok(change) if change.device_id == self.device_id => return false,
                Ok(_) => {}
                Err(broadcast::error::TryRecvError::Empty) => return true,
                Err(
                    broadcast::error::TryRecvError::Lagged(_)
                    | broadcast::error::TryRecvError::Closed,
                ) => return false,
            }
        }
    }

    pub(crate) async fn revoked(&mut self) {
        tokio::select! {
            () = wait_until(self.expires_at) => {}
            () = matching_authorization_change(&self.device_id, &mut self.changes) => {}
        }
    }
}

async fn matching_authorization_change(
    device_id: &str,
    changes: &mut Option<broadcast::Receiver<AuthorizationChange>>,
) {
    let Some(changes) = changes else {
        return std::future::pending().await;
    };
    loop {
        match changes.recv().await {
            Ok(change) if change.device_id == device_id => return,
            Ok(_) => {}
            Err(broadcast::error::RecvError::Lagged(_) | broadcast::error::RecvError::Closed) => {
                return;
            }
        }
    }
}

async fn wait_until(expires_at: u64) {
    tokio::time::sleep(Duration::from_millis(
        expires_at.saturating_sub(unix_time_ms()),
    ))
    .await;
}

fn unix_time_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |duration| {
            u64::try_from(duration.as_millis()).unwrap_or(u64::MAX)
        })
}

#[cfg(test)]
mod tests {
    #![allow(clippy::expect_used)]

    use super::*;
    use crate::auth::AuthorizationChangeReason;

    fn session(device_id: &str, expires_at: u64) -> AuthorizationContext {
        AuthorizationContext::Session {
            device_id: device_id.to_owned(),
            scopes: vec!["shell.explicit".into()],
            expires_at,
        }
    }

    #[tokio::test]
    async fn validity_depends_on_session_not_transport_epoch() {
        let (changes, receiver) = broadcast::channel(1);
        let mut authority = SessionAuthority::new(&session("device-a", u64::MAX), Some(receiver))
            .expect("session authority");
        assert!(authority.is_valid());

        changes
            .send(AuthorizationChange {
                device_id: "device-b".into(),
                reason: AuthorizationChangeReason::DeviceRevoked,
            })
            .expect("unrelated change");
        assert!(authority.is_valid());

        changes
            .send(AuthorizationChange {
                device_id: "device-a".into(),
                reason: AuthorizationChangeReason::DeviceRevoked,
            })
            .expect("matching change");
        assert!(!authority.is_valid());
    }

    #[tokio::test]
    async fn expired_or_unobservable_session_fails_closed() {
        let mut expired =
            SessionAuthority::new(&session("device-a", 0), None).expect("session authority");
        assert!(!expired.is_valid());

        let (changes, receiver) = broadcast::channel(1);
        drop(changes);
        let mut closed = SessionAuthority::new(&session("device-a", u64::MAX), Some(receiver))
            .expect("session authority");
        assert!(!closed.is_valid());
    }
}
