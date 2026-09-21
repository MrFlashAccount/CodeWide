//! Durable pairing and outbound carrier for the standalone relay application.
use codewide_relay::{
    adapter::{Adapter, AdapterConnectionState},
    auth,
    pairing::{InvitationBundle, PairRequest, PairResponse},
    registry::validate_route_id,
    transport_tls::pinned_client_config,
};
use serde::{Deserialize, Serialize};
use std::{
    io::Write,
    net::SocketAddr,
    os::unix::fs::{OpenOptionsExt, PermissionsExt},
    path::{Path, PathBuf},
    sync::{
        Arc,
        atomic::{AtomicU64, Ordering},
    },
    time::Duration,
};
use tokio::{
    sync::{Mutex, watch},
    task::JoinHandle,
};
use tokio_util::sync::CancellationToken;

const CONFIG_VERSION: u8 = 3;
const INVITATION_VERSION: u8 = 4;
const MAX_PAIR_RESPONSE_BYTES: usize = 4096;

#[derive(Debug, thiserror::Error)]
#[error("relay operation failed")]
pub struct RelayError {
    #[source]
    source: codewide_relay::Error,
}

pub struct RelayConfig {
    enabled: bool,
    relay_address: Arc<str>,
    relay_tls_pin_sha256: Arc<str>,
    route_id: Arc<str>,
    access_token: Arc<str>,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RelayPairCommand {
    pub relay_address: String,
    pub invitation: InvitationBundle,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RelayEnabledCommand {
    pub enabled: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RelayStatus {
    pub configured: bool,
    pub enabled: bool,
    pub connection: RelayConnectionStatus,
    pub public_endpoint: Option<String>,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum RelayConnectionStatus {
    Disabled,
    Connecting,
    Online,
    Reconnecting,
}

#[derive(Clone)]
pub struct RelayRuntime(Arc<RelayRuntimeInner>);

struct RelayRuntimeInner {
    config_path: PathBuf,
    device_target: SocketAddr,
    pairing_target: SocketAddr,
    running: Mutex<Option<RunningAdapter>>,
    connection: watch::Sender<RelayConnectionStatus>,
    generation: Arc<AtomicU64>,
}

struct RunningAdapter {
    stop: CancellationToken,
    task: JoinHandle<()>,
}

impl Drop for RunningAdapter {
    fn drop(&mut self) {
        self.stop.cancel();
        self.task.abort();
    }
}

impl RelayRuntime {
    /// Starts the configured outbound adapter and owns all later live reconfiguration.
    /// # Errors
    /// Rejects an unsafe or invalid durable Relay configuration.
    pub async fn start(
        config_path: PathBuf,
        device_target: SocketAddr,
        pairing_target: SocketAddr,
    ) -> Result<Self, RelayError> {
        let (connection, _) = watch::channel(RelayConnectionStatus::Disabled);
        let runtime = Self(Arc::new(RelayRuntimeInner {
            config_path,
            device_target,
            pairing_target,
            running: Mutex::new(None),
            connection,
            generation: Arc::new(AtomicU64::new(0)),
        }));
        let config = RelayConfig::load(&runtime.0.config_path)?
            .filter(RelayConfig::is_enabled)
            .map(|config| config.adapter(device_target, pairing_target));
        runtime.replace(config).await;
        Ok(runtime)
    }

    /// Pairs with one Relay and activates the new outbound adapter immediately.
    /// # Errors
    /// Rejects invalid input and propagates pairing or durable-write failures.
    pub async fn pair(&self, command: RelayPairCommand) -> Result<RelayStatus, RelayError> {
        let config = RelayConfig::pair(
            &command.relay_address,
            command.invitation,
            &self.0.config_path,
        )
        .await?;
        self.replace(Some(
            config.adapter(self.0.device_target, self.0.pairing_target),
        ))
        .await;
        self.status()
    }

    /// Enables or disables Relay without restarting Companion.
    /// # Errors
    /// Rejects absent or invalid config and propagates durable-write failures.
    pub async fn set_enabled(&self, enabled: bool) -> Result<RelayStatus, RelayError> {
        RelayConfig::set_enabled(&self.0.config_path, enabled)?;
        let adapter = if enabled {
            RelayConfig::load(&self.0.config_path)?
                .map(|config| config.adapter(self.0.device_target, self.0.pairing_target))
        } else {
            None
        };
        self.replace(adapter).await;
        self.status()
    }

    /// Reads the durable rollout state.
    /// # Errors
    /// Rejects an unsafe or invalid config file.
    pub fn status(&self) -> Result<RelayStatus, RelayError> {
        Ok(match RelayConfig::load(&self.0.config_path)? {
            Some(config) => RelayStatus {
                configured: true,
                enabled: config.is_enabled(),
                connection: if config.is_enabled() {
                    *self.0.connection.borrow()
                } else {
                    RelayConnectionStatus::Disabled
                },
                public_endpoint: Some(config.public_endpoint()),
            },
            None => RelayStatus {
                configured: false,
                enabled: false,
                connection: RelayConnectionStatus::Disabled,
                public_endpoint: None,
            },
        })
    }

    async fn replace(&self, adapter: Option<Adapter>) {
        let mut running = self.0.running.lock().await;
        let generation = self.0.generation.fetch_add(1, Ordering::AcqRel) + 1;
        self.0.connection.send_replace(if adapter.is_some() {
            RelayConnectionStatus::Connecting
        } else {
            RelayConnectionStatus::Disabled
        });
        *running = adapter.map(|adapter| {
            RunningAdapter::start(
                adapter,
                self.0.connection.clone(),
                self.0.generation.clone(),
                generation,
            )
        });
    }
}

impl RunningAdapter {
    fn start(
        adapter: Adapter,
        connection: watch::Sender<RelayConnectionStatus>,
        current_generation: Arc<AtomicU64>,
        generation: u64,
    ) -> Self {
        let stop = CancellationToken::new();
        let worker_stop = stop.clone();
        let task = tokio::spawn(async move {
            let (adapter_status, mut status_changes) =
                watch::channel(AdapterConnectionState::Connecting);
            let status_connection = connection.clone();
            let status_generation = current_generation.clone();
            let status_task = tokio::spawn(async move {
                loop {
                    if status_generation.load(Ordering::Acquire) != generation {
                        return;
                    }
                    let mapped = match *status_changes.borrow_and_update() {
                        AdapterConnectionState::Connecting => RelayConnectionStatus::Connecting,
                        AdapterConnectionState::Connected => RelayConnectionStatus::Online,
                        AdapterConnectionState::Reconnecting => RelayConnectionStatus::Reconnecting,
                    };
                    status_connection.send_replace(mapped);
                    if status_changes.changed().await.is_err() {
                        return;
                    }
                }
            });
            if let Err(error) = adapter.run_with_status(worker_stop, adapter_status).await {
                tracing::error!(err = ?error, "Relay adapter stopped");
            }
            status_task.abort();
            if current_generation.load(Ordering::Acquire) == generation {
                connection.send_replace(RelayConnectionStatus::Reconnecting);
            }
        });
        Self { stop, task }
    }
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct StoredRelayConfig {
    version: u8,
    enabled: bool,
    relay_address: String,
    relay_tls_pin_sha256: String,
    route_id: String,
    access_token: String,
}

impl RelayConfig {
    /// Loads the durable pairing if it exists.
    /// # Errors
    /// Rejects unsafe files, invalid JSON, malformed origins, and malformed tokens.
    pub fn load(path: &Path) -> Result<Option<Self>, RelayError> {
        Self::load_inner(path).map_err(|source| RelayError { source })
    }

    fn load_inner(path: &Path) -> codewide_relay::Result<Option<Self>> {
        let metadata = match std::fs::symlink_metadata(path) {
            Ok(metadata) => metadata,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
            Err(error) => return Err(error.into()),
        };
        if !metadata.file_type().is_file() || metadata.permissions().mode() & 0o077 != 0 {
            return Err(invalid_config("relay pairing file must be private (0600)"));
        }
        let stored: StoredRelayConfig = serde_json::from_reader(std::fs::File::open(path)?)?;
        Self::from_stored(stored).map(Some)
    }

    /// Pairs through the relay API and atomically stores the issued route credential.
    /// # Errors
    /// Rejects invalid input or response data and propagates network and filesystem failures.
    pub async fn pair(
        relay_address: &str,
        bundle: InvitationBundle,
        path: &Path,
    ) -> Result<Self, RelayError> {
        Self::pair_inner(relay_address, bundle, path)
            .await
            .map_err(|source| RelayError { source })
    }

    async fn pair_inner(
        relay_address: &str,
        bundle: InvitationBundle,
        path: &Path,
    ) -> codewide_relay::Result<Self> {
        if bundle.version != INVITATION_VERSION {
            return Err(invalid_config("relay invitation version is unsupported"));
        }
        let relay_address = validate_relay_address(relay_address)?;
        let companion_url = companion_origin(&relay_address);
        let tls = pinned_client_config(&bundle.relay_tls_pin_sha256)?;
        validate_route_id(&bundle.route_id)?;
        auth::validate(&bundle.invitation)?;
        let endpoint = pairing_endpoint(&companion_url, &bundle.route_id)?;
        let client = reqwest::Client::builder()
            .redirect(reqwest::redirect::Policy::none())
            .timeout(Duration::from_secs(15))
            .https_only(true)
            .use_preconfigured_tls(tls.as_ref().clone())
            .build()?;
        let mut response = client
            .post(endpoint)
            .json(&PairRequest {
                invitation: bundle.invitation,
            })
            .send()
            .await?
            .error_for_status()?;
        let mut body = Vec::new();
        while let Some(chunk) = response.chunk().await? {
            if body.len() + chunk.len() > MAX_PAIR_RESPONSE_BYTES {
                return Err(invalid_config("relay pairing response is oversized"));
            }
            body.extend_from_slice(&chunk);
        }
        let paired: PairResponse = serde_json::from_slice(&body)?;
        validate_route_id(&paired.route_id)?;
        auth::validate(&paired.access_token)?;
        if paired.generation == 0 || paired.route_id != bundle.route_id {
            return Err(invalid_config("relay pairing generation is invalid"));
        }
        let config = Self {
            enabled: true,
            relay_address: Arc::from(relay_address),
            relay_tls_pin_sha256: Arc::from(bundle.relay_tls_pin_sha256),
            route_id: Arc::from(paired.route_id),
            access_token: Arc::from(paired.access_token),
        };
        config.save(path)?;
        Ok(config)
    }

    #[must_use]
    pub fn adapter(&self, device_target: SocketAddr, pairing_target: SocketAddr) -> Adapter {
        Adapter {
            public_url: Arc::from(public_origin(&self.relay_address)),
            companion_url: Arc::from(companion_origin(&self.relay_address)),
            relay_tls_pin_sha256: self.relay_tls_pin_sha256.clone(),
            route_id: self.route_id.clone(),
            access_token: self.access_token.clone(),
            device_target,
            pairing_target,
        }
    }

    /// Returns whether Companion should start this outbound Relay adapter.
    #[must_use]
    pub fn is_enabled(&self) -> bool {
        self.enabled
    }

    /// Changes only the local rollout switch while preserving credentials and pinning.
    /// # Errors
    /// Rejects absent or invalid config and propagates durable write failures.
    pub fn set_enabled(path: &Path, enabled: bool) -> Result<(), RelayError> {
        Self::set_enabled_inner(path, enabled).map_err(|source| RelayError { source })
    }

    fn set_enabled_inner(path: &Path, enabled: bool) -> codewide_relay::Result<()> {
        let mut config = Self::load_inner(path)?
            .ok_or_else(|| invalid_config("Relay pairing is not configured"))?;
        config.enabled = enabled;
        config.save(path)
    }

    /// Returns the route-qualified endpoint stored by Android after normal pairing.
    #[must_use]
    pub fn public_endpoint(&self) -> String {
        format!(
            "{}/c/{}/v1/sync",
            public_origin(&self.relay_address),
            self.route_id
        )
    }

    fn from_stored(stored: StoredRelayConfig) -> codewide_relay::Result<Self> {
        if stored.version != CONFIG_VERSION {
            return Err(invalid_config("relay pairing version is unsupported"));
        }
        let relay_address = validate_relay_address(&stored.relay_address)?;
        pinned_client_config(&stored.relay_tls_pin_sha256)?;
        validate_route_id(&stored.route_id)?;
        auth::validate(&stored.access_token)?;
        Ok(Self {
            enabled: stored.enabled,
            relay_address: Arc::from(relay_address),
            relay_tls_pin_sha256: Arc::from(stored.relay_tls_pin_sha256),
            route_id: Arc::from(stored.route_id),
            access_token: Arc::from(stored.access_token),
        })
    }

    fn save(&self, path: &Path) -> codewide_relay::Result<()> {
        let parent = path
            .parent()
            .ok_or_else(|| std::io::Error::other("relay pairing path has no parent"))?;
        std::fs::create_dir_all(parent)?;
        std::fs::set_permissions(parent, std::fs::Permissions::from_mode(0o700))?;
        let temporary = path.with_extension(format!("tmp-{}", auth::generate()));
        let mut file = std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .mode(0o600)
            .open(&temporary)?;
        serde_json::to_writer(
            &mut file,
            &StoredRelayConfig {
                version: CONFIG_VERSION,
                enabled: self.enabled,
                relay_address: self.relay_address.to_string(),
                relay_tls_pin_sha256: self.relay_tls_pin_sha256.to_string(),
                route_id: self.route_id.to_string(),
                access_token: self.access_token.to_string(),
            },
        )?;
        file.write_all(b"\n")?;
        file.sync_all()?;
        std::fs::rename(&temporary, path)?;
        std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600))?;
        Ok(())
    }
}

#[must_use]
pub fn default_config_path() -> PathBuf {
    std::env::var_os("XDG_STATE_HOME")
        .map_or_else(
            || {
                std::env::var_os("HOME").map_or_else(
                    || PathBuf::from(".local/state"),
                    |home| PathBuf::from(home).join(".local/state"),
                )
            },
            PathBuf::from,
        )
        .join("codewide/companion/relay.json")
}

fn validate_relay_address(value: &str) -> codewide_relay::Result<String> {
    if value.contains("//") || value.chars().any(|character| "/?#@".contains(character)) {
        return Err(invalid_config("Relay address must be host:port"));
    }
    let parsed = url::Url::parse(&format!("ws://{value}"))?;
    if parsed.port().is_none()
        || parsed.host_str().is_none()
        || !parsed.username().is_empty()
        || parsed.password().is_some()
        || !matches!(parsed.path(), "" | "/")
        || parsed.query().is_some()
        || parsed.fragment().is_some()
    {
        return Err(invalid_config("Relay address must be host:port"));
    }
    Ok(value.to_owned())
}

fn public_origin(relay_address: &str) -> String {
    format!("ws://{relay_address}")
}

fn companion_origin(relay_address: &str) -> String {
    format!("wss://{relay_address}")
}

fn pairing_endpoint(companion_url: &str, route_id: &str) -> codewide_relay::Result<url::Url> {
    let mut endpoint = url::Url::parse(companion_url)?;
    endpoint
        .set_scheme("https")
        .map_err(|()| invalid_config("Relay Companion URL has an invalid scheme"))?;
    endpoint.set_path(&format!("/relay/pair/{route_id}"));
    Ok(endpoint)
}

fn invalid_config(message: &'static str) -> codewide_relay::Error {
    std::io::Error::new(std::io::ErrorKind::InvalidInput, message).into()
}

#[cfg(test)]
mod tests {
    use super::*;
    use codewide_relay::{registry::Registry, server::Relay, transport_tls::RelayTlsIdentity};
    use tokio::net::TcpListener;

    #[test]
    fn durable_pairing_round_trips_and_rejects_unsafe_files() -> codewide_relay::Result<()> {
        let directory = tempfile::tempdir()?;
        let path = directory.path().join("relay.json");
        let config = RelayConfig {
            enabled: true,
            relay_address: Arc::from("relay.example:8780"),
            relay_tls_pin_sha256: Arc::from("sha256/AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA="),
            route_id: Arc::from(auth::generate()),
            access_token: Arc::from(auth::generate()),
        };
        config.save(&path)?;
        assert!(RelayConfig::load(&path)?.is_some_and(|loaded| loaded.is_enabled()));
        RelayConfig::set_enabled_inner(&path, false)?;
        assert!(RelayConfig::load(&path)?.is_some_and(|loaded| !loaded.is_enabled()));
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o644))?;
        assert!(RelayConfig::load(&path).is_err());
        Ok(())
    }

    #[test]
    fn derives_both_transports_from_one_relay_address() -> codewide_relay::Result<()> {
        assert_eq!(
            validate_relay_address("relay.example:8780")?,
            "relay.example:8780"
        );
        assert_eq!(
            public_origin("relay.example:8780"),
            "ws://relay.example:8780"
        );
        assert_eq!(
            companion_origin("relay.example:8780"),
            "wss://relay.example:8780"
        );
        assert!(validate_relay_address("ws://relay.example:8780").is_err());
        assert!(validate_relay_address("relay.example").is_err());
        assert!(validate_relay_address("user@relay.example:8780").is_err());
        assert_eq!(
            pairing_endpoint(&companion_origin("relay.example:8780"), "route")?.as_str(),
            "https://relay.example:8780/relay/pair/route"
        );
        Ok(())
    }

    #[tokio::test]
    async fn pairing_enable_and_disable_reconfigure_the_live_adapter() -> codewide_relay::Result<()>
    {
        let relay_state = tempfile::tempdir()?;
        let companion_state = tempfile::tempdir()?;
        let registry = Registry::open(relay_state.path())?;
        let identity = RelayTlsIdentity::load_or_create(relay_state.path())?;
        let pin = identity.pin();
        let server_config = identity.server_config()?;
        let listener = TcpListener::bind("127.0.0.1:0").await?;
        let address = listener.local_addr()?;
        let stop = CancellationToken::new();
        let worker_stop = stop.clone();
        let relay = Relay::new(registry.clone());
        let relay_task = tokio::spawn(async move {
            let _ =
                codewide_relay::server::serve(relay, listener, server_config, worker_stop).await;
        });
        let runtime = RelayRuntime::start(
            companion_state.path().join("relay.json"),
            "127.0.0.1:1".parse()?,
            "127.0.0.1:1".parse()?,
        )
        .await?;
        assert!(!runtime.status()?.configured);
        let invitation = registry.create_invitation(None)?;
        runtime
            .pair(RelayPairCommand {
                relay_address: address.to_string(),
                invitation: InvitationBundle {
                    version: INVITATION_VERSION,
                    relay_tls_pin_sha256: pin.clone(),
                    route_id: invitation.route_id,
                    invitation: invitation.token,
                },
            })
            .await?;
        wait_for_ready(address, &pin, reqwest::StatusCode::NO_CONTENT).await?;
        wait_for_connection(&runtime, RelayConnectionStatus::Online).await?;
        runtime.set_enabled(false).await?;
        assert_eq!(
            runtime.status()?.connection,
            RelayConnectionStatus::Disabled
        );
        tokio::time::sleep(Duration::from_millis(50)).await;
        assert_eq!(
            runtime.status()?.connection,
            RelayConnectionStatus::Disabled
        );
        wait_for_ready(address, &pin, reqwest::StatusCode::SERVICE_UNAVAILABLE).await?;
        runtime.set_enabled(true).await?;
        wait_for_ready(address, &pin, reqwest::StatusCode::NO_CONTENT).await?;
        wait_for_connection(&runtime, RelayConnectionStatus::Online).await?;
        stop.cancel();
        relay_task.await?;
        Ok(())
    }

    async fn wait_for_ready(
        address: SocketAddr,
        pin: &str,
        expected: reqwest::StatusCode,
    ) -> codewide_relay::Result<()> {
        let tls = pinned_client_config(pin)?;
        let client = reqwest::Client::builder()
            .https_only(true)
            .use_preconfigured_tls(tls.as_ref().clone())
            .build()?;
        tokio::time::timeout(Duration::from_secs(5), async {
            loop {
                if client
                    .get(format!("https://{address}/readyz"))
                    .send()
                    .await
                    .is_ok_and(|response| response.status() == expected)
                {
                    return;
                }
                tokio::time::sleep(Duration::from_millis(25)).await;
            }
        })
        .await?;
        Ok(())
    }

    async fn wait_for_connection(
        runtime: &RelayRuntime,
        expected: RelayConnectionStatus,
    ) -> codewide_relay::Result<()> {
        tokio::time::timeout(Duration::from_secs(5), async {
            loop {
                if runtime
                    .status()
                    .is_ok_and(|status| status.connection == expected)
                {
                    return;
                }
                tokio::time::sleep(Duration::from_millis(25)).await;
            }
        })
        .await?;
        Ok(())
    }
}
