//! One locally owned, sixty-second enrollment window. No public operation opens it.
pub(crate) mod verification;
use crate::{
    Result, auth, denied,
    pairing::PairResponse,
    registry::{Registry, validate_label},
};
use axum::extract::ws::{Message, WebSocket};
use futures_util::SinkExt;
use serde::{Deserialize, Serialize};
use std::{
    sync::{Arc, Mutex},
    time::Duration,
};
use tokio::{sync::watch, time::Instant};
use tokio_util::sync::CancellationToken;

pub const WINDOW: Duration = Duration::from_mins(1);
pub const EXPORTER_LABEL: &[u8] = b"EXPORTER-Channel-Binding";
pub const ENDPOINT: &str = "/relay/enroll";
pub const WIRE_VERSION: u8 = 1;

/// Locally computed TLS channel binding; never accepted from the network peer.
#[derive(Clone)]
pub struct ChannelBinding(pub [u8; 32]);

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(tag = "state", rename_all = "camelCase", deny_unknown_fields)]
pub enum Phase {
    Waiting,
    Confirm {
        candidate: String,
        label: String,
        code: String,
    },
    Approved,
    Connecting {
        label: String,
    },
    Connected {
        label: String,
        route_id: String,
    },
    Cancelled,
    Expired,
}

impl Phase {
    #[must_use]
    pub const fn finished(&self) -> bool {
        matches!(
            self,
            Self::Connected { .. } | Self::Cancelled | Self::Expired
        )
    }
}

#[derive(Deserialize, Serialize)]
#[serde(tag = "type", rename_all = "camelCase", deny_unknown_fields)]
pub enum ClientMessage {
    Hello {
        version: u8,
        label: String,
        commitment: String,
    },
    Reveal {
        nonce: String,
    },
    Stored,
}

#[derive(Deserialize, Serialize)]
#[serde(tag = "type", rename_all = "camelCase", deny_unknown_fields)]
pub enum ServerMessage {
    Challenge { nonce: String },
    Confirm { remaining_seconds: u64 },
    Granted { credentials: PairResponse },
    Complete,
}

#[derive(Clone, Default)]
pub struct Enrollment(Arc<Mutex<Option<Arc<Window>>>>);

pub struct Window {
    pub deadline: Instant,
    pub changes: watch::Sender<Phase>,
    stop: CancellationToken,
    candidate: Mutex<Option<Candidate>>,
    online: watch::Sender<Option<String>>,
}

struct Candidate {
    id: String,
    label: String,
    approved: bool,
    route_id: Option<String>,
}

/// The local control connection owns the window and cancels it on disconnect.
pub struct WindowOwner(pub Arc<Window>);

impl Drop for WindowOwner {
    fn drop(&mut self) {
        self.0.cancel();
    }
}

impl Enrollment {
    /// Opens exactly one enrollment window, with an absolute, non-extendable deadline.
    /// # Errors
    /// Rejects a second local controller while a window is active.
    pub fn open(&self) -> Result<WindowOwner> {
        self.open_for(WINDOW)
    }

    fn open_for(&self, duration: Duration) -> Result<WindowOwner> {
        let mut active = self.0.lock().map_err(|_| denied())?;
        if active.as_ref().is_some_and(|window| window.is_open()) {
            return Err(
                std::io::Error::other("Pairing is already open in another terminal").into(),
            );
        }
        let window = Arc::new(Window {
            deadline: Instant::now() + duration,
            changes: watch::channel(Phase::Waiting).0,
            stop: CancellationToken::new(),
            candidate: Mutex::new(None),
            online: watch::channel(None).0,
        });
        *active = Some(window.clone());
        Ok(WindowOwner(window))
    }

    #[must_use]
    pub fn current(&self) -> Option<Arc<Window>> {
        self.0
            .lock()
            .ok()?
            .as_ref()
            .filter(|window| window.is_open())
            .cloned()
    }

    pub fn connected(&self, route_id: &str) {
        if let Some(window) = self.current()
            && window.candidate.lock().ok().is_some_and(|candidate| {
                candidate
                    .as_ref()
                    .is_some_and(|value| value.route_id.as_deref() == Some(route_id))
            })
        {
            window.online.send_replace(Some(route_id.to_owned()));
        }
    }
}

impl Window {
    #[must_use]
    pub fn is_open(&self) -> bool {
        !self.stop.is_cancelled()
            && Instant::now() < self.deadline
            && !self.changes.borrow().finished()
    }

    #[must_use]
    pub fn remaining_seconds(&self) -> u64 {
        self.deadline
            .saturating_duration_since(Instant::now())
            .as_secs()
            .saturating_add(1)
            .min(60)
    }

    /// Approves only the exact candidate currently shown by the local terminal.
    /// # Errors
    /// Rejects stale confirmations, expiration, or a closed window.
    pub fn approve(&self, id: &str) -> Result<()> {
        let mut candidate = self.candidate.lock().map_err(|_| denied())?;
        let value = candidate.as_mut().ok_or_else(denied)?;
        if !self.is_open()
            || value.id != id
            || value.approved
            || !matches!(*self.changes.borrow(), Phase::Confirm { .. })
        {
            return Err(denied());
        }
        value.approved = true;
        self.changes.send_replace(Phase::Approved);
        Ok(())
    }

    pub fn cancel(&self) {
        self.finish(Phase::Cancelled);
    }

    pub fn expire(&self) {
        self.finish(Phase::Expired);
    }

    fn finish(&self, phase: Phase) {
        // Serializes cancellation with the commit point below.
        if let Ok(_guard) = self.candidate.lock() {
            if self.changes.borrow().finished() {
                return;
            }
            self.changes.send_replace(phase);
            self.stop.cancel();
        }
    }

    fn claim(&self, label: String) -> Result<()> {
        validate_label(&label)?;
        let mut candidate = self.candidate.lock().map_err(|_| denied())?;
        if !self.is_open() || candidate.is_some() {
            return Err(denied());
        }
        let id = auth::generate();
        *candidate = Some(Candidate {
            id,
            label,
            approved: false,
            route_id: None,
        });
        Ok(())
    }

    fn show_symbols(&self, code: String) -> Result<()> {
        let candidate = self.candidate.lock().map_err(|_| denied())?;
        let candidate = candidate.as_ref().ok_or_else(denied)?;
        if !self.is_open() {
            return Err(denied());
        }
        self.changes.send_replace(Phase::Confirm {
            candidate: candidate.id.clone(),
            label: candidate.label.clone(),
            code,
        });
        Ok(())
    }

    /// Runs the bounded public handshake. Only a terminal-approved TLS channel gets credentials.
    pub async fn serve(
        self: Arc<Self>,
        mut socket: WebSocket,
        binding: ChannelBinding,
        registry: Registry,
    ) {
        let mut claimed = false;
        let outcome = tokio::select! {
            () = self.stop.cancelled() => Err(denied()),
            () = tokio::time::sleep_until(self.deadline) => { self.expire(); Err(denied()) },
            result = self.exchange(&mut socket, &binding, &registry, &mut claimed) => result,
        };
        if outcome.is_err() && claimed {
            self.cancel();
        }
        let _ = tokio::time::timeout(Duration::from_secs(1), socket.close()).await;
    }

    async fn exchange(
        &self,
        socket: &mut WebSocket,
        binding: &ChannelBinding,
        registry: &Registry,
        claimed: &mut bool,
    ) -> Result<()> {
        let first = tokio::time::timeout(Duration::from_secs(5), receive(socket)).await??;
        let ClientMessage::Hello {
            version: WIRE_VERSION,
            label,
            commitment,
        } = first
        else {
            return Err(denied());
        };
        let commitment = verification::decode(&commitment)?;
        self.claim(label)?;
        *claimed = true;
        // The candidate commits before seeing this unpredictable challenge.
        // It cannot choose its nonce after learning the resulting short symbols.
        let server_nonce: [u8; 32] = rand::random();
        send(
            socket,
            &ServerMessage::Challenge {
                nonce: hex::encode(server_nonce),
            },
        )
        .await?;
        let ClientMessage::Reveal { nonce } =
            tokio::time::timeout(Duration::from_secs(5), receive(socket)).await??
        else {
            return Err(denied());
        };
        let client_nonce = verification::decode(&nonce)?;
        verification::verify(binding, &client_nonce, &commitment)?;
        self.show_symbols(verification::code(binding, &client_nonce, &server_nonce))?;
        send(
            socket,
            &ServerMessage::Confirm {
                remaining_seconds: self.remaining_seconds(),
            },
        )
        .await?;
        let mut changes = self.changes.subscribe();
        loop {
            if *changes.borrow_and_update() == Phase::Approved {
                break;
            }
            tokio::select! {
                result = changes.changed() => result?,
                _ = socket.recv() => return Err(denied()),
            }
        }
        let label = self
            .candidate
            .lock()
            .map_err(|_| denied())?
            .as_ref()
            .ok_or_else(denied)?
            .label
            .clone();
        let credentials = registry.register(&label)?;
        let mut rollback = UncommittedRoute {
            registry: registry.clone(),
            route_id: credentials.route_id.clone(),
            committed: false,
        };
        self.candidate
            .lock()
            .map_err(|_| denied())?
            .as_mut()
            .ok_or_else(denied)?
            .route_id = Some(credentials.route_id.clone());
        send(socket, &ServerMessage::Granted { credentials }).await?;
        if !matches!(receive(socket).await?, ClientMessage::Stored) {
            return Err(denied());
        }
        self.changes.send_replace(Phase::Connecting {
            label: label.clone(),
        });
        let mut online = self.online.subscribe();
        loop {
            if online.borrow_and_update().as_deref() == Some(&rollback.route_id) {
                break;
            }
            tokio::select! {
                result = online.changed() => result?,
                _ = socket.recv() => return Err(denied()),
            }
        }
        {
            let _guard = self.candidate.lock().map_err(|_| denied())?;
            if !self.is_open() {
                return Err(denied());
            }
            rollback.committed = true;
            self.changes.send_replace(Phase::Connected {
                label,
                route_id: rollback.route_id.clone(),
            });
        }
        send(socket, &ServerMessage::Complete).await
    }
}

struct UncommittedRoute {
    registry: Registry,
    route_id: String,
    committed: bool,
}

impl Drop for UncommittedRoute {
    fn drop(&mut self) {
        if !self.committed {
            let _ = self.registry.revoke(&self.route_id);
        }
    }
}

async fn receive(socket: &mut WebSocket) -> Result<ClientMessage> {
    match socket.recv().await.ok_or_else(denied)?? {
        Message::Text(text) => Ok(serde_json::from_str(&text)?),
        _ => Err(denied()),
    }
}

async fn send(socket: &mut WebSocket, message: &ServerMessage) -> Result<()> {
    socket
        .send(Message::Text(serde_json::to_string(message)?.into()))
        .await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn owner_deadline_and_candidate_are_exclusive() -> Result<()> {
        let enrollment = Enrollment::default();
        let owner = enrollment.open()?;
        assert!(enrollment.open().is_err());
        owner.0.claim("MacBook".into())?;
        owner
            .0
            .show_symbols("🍋 🚀 🐳 🎸\nLemon · Rocket · Whale · Guitar".into())?;
        assert!(owner.0.claim("Other".into()).is_err());
        assert!(owner.0.approve("stale").is_err());
        let Phase::Confirm { candidate, .. } = owner.0.changes.borrow().clone() else {
            return Err(denied());
        };
        owner.0.approve(&candidate)?;
        assert!(owner.0.approve(&candidate).is_err());
        drop(owner);
        assert!(enrollment.current().is_none());
        let owner = enrollment.open_for(Duration::from_millis(1))?;
        tokio::time::sleep(Duration::from_millis(5)).await;
        assert!(enrollment.current().is_none());
        assert!(owner.0.claim("Late".into()).is_err());
        Ok(())
    }
}
