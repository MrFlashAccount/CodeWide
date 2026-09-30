use super::{
    RelayConfig, RelayError, RelayRuntime, auth, invalid_config, validate_relay_address,
    validate_route_id,
};
use codewide_relay::enrollment_client::EnrollmentClient;
use serde::Serialize;
use std::{sync::Arc, time::Duration};
use tokio::{sync::watch, time::Instant};
use tokio_util::sync::CancellationToken;

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RelayEnrollmentStatus {
    pub id: String,
    pub state: String,
    pub code: Option<String>,
    pub remaining_seconds: u32,
    pub message: Option<String>,
}

pub(super) struct Attempt {
    status: watch::Sender<RelayEnrollmentStatus>,
    stop: CancellationToken,
    deadline: Arc<std::sync::Mutex<Instant>>,
}

impl Drop for Attempt {
    fn drop(&mut self) {
        self.stop.cancel();
    }
}

impl RelayRuntime {
    /// Starts an address-only, terminal-approved enrollment in the runtime owner.
    /// # Errors
    /// Rejects invalid addresses, labels, or overlapping Relay changes.
    pub fn begin_enrollment(
        &self,
        address: &str,
        label: &str,
    ) -> Result<RelayEnrollmentStatus, RelayError> {
        let executor = tokio::runtime::Handle::try_current()
            .map_err(|_| RelayError::new(invalid_config("Relay runtime is unavailable")))?;
        let address = validate_relay_address(address).map_err(RelayError::new)?;
        codewide_relay::registry::validate_label(label).map_err(RelayError::new)?;
        let guard = self
            .0
            .reconfiguration
            .clone()
            .try_lock_owned()
            .map_err(|_| {
                RelayError::new(invalid_config("Another Relay operation is in progress"))
            })?;
        let initial = RelayEnrollmentStatus {
            id: auth::generate(),
            state: "connecting".into(),
            code: None,
            remaining_seconds: 0,
            message: None,
        };
        let attempt = Attempt {
            status: watch::channel(initial.clone()).0,
            stop: CancellationToken::new(),
            deadline: Arc::new(std::sync::Mutex::new(
                Instant::now() + Duration::from_secs(70),
            )),
        };
        let stop = attempt.stop.clone();
        let status = attempt.status.clone();
        let deadline = attempt.deadline.clone();
        *self.0.enrollment.lock().map_err(|_| {
            RelayError::new(invalid_config("Relay enrollment state is unavailable"))
        })? = Some(attempt);
        let runtime = self.clone();
        let label = label.to_owned();
        executor.spawn(async move {
            let _guard = guard;
            let result = runtime
                .enroll(&address, &label, &status, &stop, &deadline)
                .await;
            status.send_modify(|snapshot| {
                snapshot.remaining_seconds = 0;
                snapshot.code = None;
                match result {
                    Ok(()) => snapshot.state = "connected".into(),
                    Err(error) => {
                        snapshot.state = if stop.is_cancelled() {
                            "cancelled"
                        } else {
                            "failed"
                        }
                        .into();
                        snapshot.message = Some(error.to_string());
                    }
                }
            });
        });
        Ok(initial)
    }

    /// Reads only presentation state; credentials never cross this boundary.
    /// # Errors
    /// Rejects unknown or stale attempt identifiers.
    pub fn enrollment_status(&self, id: &str) -> Result<RelayEnrollmentStatus, RelayError> {
        let active = self.0.enrollment.lock().map_err(|_| {
            RelayError::new(invalid_config("Relay enrollment state is unavailable"))
        })?;
        let attempt = active
            .as_ref()
            .filter(|attempt| attempt.status.borrow().id == id)
            .ok_or_else(|| {
                RelayError::new(invalid_config("Relay pairing attempt is no longer active"))
            })?;
        let mut result = attempt.status.borrow().clone();
        if result.code.is_some() {
            let remaining = attempt
                .deadline
                .lock()
                .map_err(|_| {
                    RelayError::new(invalid_config("Relay enrollment state is unavailable"))
                })?
                .saturating_duration_since(Instant::now())
                .as_secs()
                .saturating_add(1)
                .min(60);
            result.remaining_seconds = u32::try_from(remaining).unwrap_or(0);
        }
        Ok(result)
    }

    /// Cancels only the named attempt; its worker restores previous settings.
    /// # Errors
    /// Propagates unavailable local state.
    pub fn cancel_enrollment(&self, id: &str) -> Result<(), RelayError> {
        let active = self.0.enrollment.lock().map_err(|_| {
            RelayError::new(invalid_config("Relay enrollment state is unavailable"))
        })?;
        if let Some(attempt) = active
            .as_ref()
            .filter(|attempt| attempt.status.borrow().id == id)
        {
            attempt.stop.cancel();
        }
        Ok(())
    }

    async fn enroll(
        &self,
        address: &str,
        label: &str,
        status: &watch::Sender<RelayEnrollmentStatus>,
        stop: &CancellationToken,
        deadline: &std::sync::Mutex<Instant>,
    ) -> codewide_relay::Result<()> {
        let previous = RelayConfig::load(&self.0.config_path)?;
        let mut installed = false;
        let exchange = async {
            let mut client = EnrollmentClient::connect(address, label).await
                .map_err(|_| invalid_config("Could not open Relay pairing. Run codewide-relay pair on the Relay host, then connect within one minute. Check the address, port and Relay version."))?;
            *deadline
                .lock()
                .map_err(|_| invalid_config("Relay enrollment state is unavailable"))? =
                client.deadline;
            status.send_modify(|snapshot| {
                snapshot.state = "confirm".into();
                snapshot.code = Some(client.code.clone());
            });
            let credentials = client.credentials().await.map_err(|_| invalid_config("Relay pairing expired, was rejected, or the connection closed. Run codewide-relay pair again."))?;
            validate_route_id(&credentials.route_id)?;
            auth::validate(&credentials.access_token)?;
            if credentials.generation != 1 {
                return Err(invalid_config(
                    "The Relay returned invalid pairing credentials",
                ));
            }
            let config = RelayConfig {
                enabled: true,
                relay_address: Arc::from(address),
                relay_tls_pin_sha256: Arc::from(client.pin.clone()),
                route_id: Arc::from(credentials.route_id),
                access_token: Arc::from(credentials.access_token),
            };
            config.save(&self.0.config_path)?;
            installed = true;
            status.send_modify(|snapshot| snapshot.state = "activating".into());
            self.replace(Some(
                config.adapter(self.0.device_target, self.0.pairing_target),
            ))
            .await;
            client.complete().await.map_err(|_| invalid_config("The Relay connection was not confirmed before pairing closed. Previous settings have been restored."))
        };
        let result = tokio::select! {
            result = exchange => result,
            () = stop.cancelled() => Err(invalid_config("Relay pairing cancelled")),
        };
        if result.is_err() && installed {
            match &previous {
                Some(config) => config.save(&self.0.config_path)?,
                None => std::fs::remove_file(&self.0.config_path)?,
            }
            self.replace(
                previous.map(|config| config.adapter(self.0.device_target, self.0.pairing_target)),
            )
            .await;
        }
        result
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use codewide_relay::{
        Result,
        enrollment::Phase,
        registry::Registry,
        server::{Relay, serve},
        transport_tls::RelayTlsIdentity,
    };

    #[tokio::test]
    async fn runtime_enrollment_uses_host_label_and_persists_only_after_approval() -> Result<()> {
        let directory = tempfile::tempdir()?;
        let registry = Registry::open(&directory.path().join("relay"))?;
        let identity = RelayTlsIdentity::load_or_create(&directory.path().join("relay"))?;
        let relay = Relay::new(registry.clone());
        let enrollment = relay.enrollment();
        let owner = enrollment.open()?;
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await?;
        let address = listener.local_addr()?.to_string();
        let stop = CancellationToken::new();
        let worker_stop = stop.clone();
        let tls = identity.server_config()?;
        let server = tokio::spawn(async move { serve(relay, listener, tls, worker_stop).await });
        let path = directory.path().join("companion-relay.json");
        let target = "127.0.0.1:9".parse()?;
        let runtime = RelayRuntime::start(path.clone(), target, target).await?;
        let attempt = runtime.begin_enrollment(&address, "Test MacBook")?;
        assert!(runtime.begin_enrollment(&address, "Second").is_err());
        let displayed = wait_for(&runtime, &attempt.id, "confirm").await?;
        let Phase::Confirm {
            candidate,
            label,
            code,
        } = owner.0.changes.borrow().clone()
        else {
            return Err("Missing terminal confirmation".into());
        };
        assert_eq!(label, "Test MacBook");
        assert_eq!(displayed.code.as_deref(), Some(code.as_str()));
        assert!(!path.exists());
        runtime.cancel_enrollment("stale-attempt")?;
        owner.0.approve(&candidate)?;
        wait_for(&runtime, &attempt.id, "connected").await?;
        let saved = RelayConfig::load(&path)?.ok_or("Missing saved configuration")?;
        assert_eq!(saved.relay_tls_pin_sha256.as_ref(), identity.pin());
        assert_eq!(
            runtime.status()?.connection,
            super::super::RelayConnectionStatus::Online
        );
        assert_eq!(
            registry.summaries()?[0].label.as_deref(),
            Some("Test MacBook")
        );
        drop(owner);

        let owner = enrollment.open()?;
        let retry = runtime.begin_enrollment(&address, "Test MacBook")?;
        wait_for(&runtime, &retry.id, "confirm").await?;
        runtime.cancel_enrollment(&retry.id)?;
        wait_for(&runtime, &retry.id, "cancelled").await?;
        assert_eq!(
            RelayConfig::load(&path)?
                .ok_or("Previous configuration was removed")?
                .route_id,
            saved.route_id
        );
        assert_eq!(
            runtime.status()?.connection,
            super::super::RelayConnectionStatus::Online
        );
        drop(owner);
        runtime.set_enabled(false).await?;
        stop.cancel();
        server.await??;
        Ok(())
    }

    async fn wait_for(
        runtime: &RelayRuntime,
        id: &str,
        state: &str,
    ) -> Result<RelayEnrollmentStatus> {
        tokio::time::timeout(Duration::from_secs(5), async {
            loop {
                let snapshot = runtime.enrollment_status(id)?;
                if snapshot.state == state {
                    return Ok(snapshot);
                }
                if snapshot.state == "failed" {
                    return Err(snapshot.message.unwrap_or_default().into());
                }
                tokio::time::sleep(Duration::from_millis(10)).await;
            }
        })
        .await?
    }
}
