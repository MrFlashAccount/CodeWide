use std::{
    collections::{HashMap, HashSet},
    net::Ipv4Addr,
    os::unix::fs::PermissionsExt,
    path::PathBuf,
    sync::{Arc, RwLock},
};

use base64::{Engine as _, engine::general_purpose::URL_SAFE_NO_PAD};
use rand::{TryRngCore, rngs::OsRng};
use tokio::task::JoinHandle;
use url::Url;

use crate::{
    account_pool::AccountPoolService,
    auth::{DeviceRegistry, DeviceStatus},
    catalog::SessionCatalog,
    content::{ContentProjector, PrivateContentService},
    device_tls::{DeviceTlsAcceptor, bootstrap_config, device_bound_config},
    dictation::DictationService,
    files::FileService,
    history_service::HistoryService,
    identity::{CompanionIdentity, TransportIdentity},
    image_previews::ImagePreviewService,
    media::MediaProxyService,
    message_search::MessageSearch,
    pairing_qr::{PairingLinkInput, build_link},
    projects::ProjectService,
    relay::{RelayConnectionStatus, RelayPairCommand, RelayRuntime, RelayStatus},
    resources::ResourceService,
    rollout::read_rollout_metadata,
    secure_store::SecretStoragePolicy,
    server::{self, CompanionServices},
    store::IndexStore,
    sync::SyncHub,
    telemetry::TelemetryStore,
    terminal,
    tunnels::LocalhostTunnelService,
    upstream::UpstreamHandle,
    vcs::VcsService,
    workspaces::WorkspaceService,
};

type RuntimeResult<T> = Result<T, Box<dyn std::error::Error + Send + Sync>>;

pub struct ManagedRuntimeConfig {
    pub state_directory: PathBuf,
    pub codex_home: PathBuf,
    pub app_server_socket: PathBuf,
    pub enable_mutations: bool,
    pub secret_storage_policy: SecretStoragePolicy,
}

impl ManagedRuntimeConfig {
    #[must_use]
    pub fn desktop(state_directory: PathBuf, codex_home: PathBuf) -> Self {
        Self {
            state_directory,
            app_server_socket: codex_home.join("app-server-control/app-server-control.sock"),
            codex_home,
            enable_mutations: true,
            secret_storage_policy: SecretStoragePolicy::PlatformPreferred,
        }
    }

    #[must_use]
    pub fn with_secret_storage_policy(mut self, policy: SecretStoragePolicy) -> Self {
        self.secret_storage_policy = policy;
        self
    }
}

#[derive(Clone, Debug)]
pub struct PairingPresentation {
    pub link: String,
    pub expires_at: u64,
}

pub struct ManagedRuntime {
    registry: Arc<DeviceRegistry>,
    relay: RelayRuntime,
    identity: TransportIdentity,
    media: Arc<MediaProxyService>,
    image_previews: Arc<ImagePreviewService>,
    bootstrap_handle: axum_server::Handle<std::net::SocketAddr>,
    inner_handle: axum_server::Handle<std::net::SocketAddr>,
    tasks: Vec<JoinHandle<()>>,
    task_failure: Arc<RwLock<Option<String>>>,
}

impl ManagedRuntime {
    /// Composes the production Companion data plane in the current platform host.
    ///
    /// # Errors
    /// Returns an error when durable state, identity, services, or private TLS
    /// listeners cannot be initialized.
    #[allow(clippy::too_many_lines)]
    pub async fn start(config: ManagedRuntimeConfig) -> RuntimeResult<Self> {
        terminal::preflight().map_err(|error| format!("terminal preflight failed: {error}"))?;
        tokio::fs::create_dir_all(&config.state_directory).await?;
        tokio::fs::set_permissions(
            &config.state_directory,
            std::fs::Permissions::from_mode(0o700),
        )
        .await?;

        let upstream = UpstreamHandle::spawn(config.app_server_socket.clone());
        let store = Arc::new(IndexStore::open(config.state_directory.join("state.redb"))?);
        let telemetry = Arc::new(TelemetryStore::open_with_jsonl(
            config.state_directory.join("telemetry.redb"),
            config.state_directory.join("telemetry-jsonl"),
        )?);
        let account_pool = if config.enable_mutations {
            Some(
                AccountPoolService::open(
                    upstream.clone(),
                    config.codex_home.clone(),
                    config.state_directory.clone(),
                )
                .await?,
            )
        } else {
            None
        };
        let catalog = Arc::new(SessionCatalog::empty(&config.codex_home));
        start_catalog_warmup(catalog.clone(), store.clone());
        let history = HistoryService::new(catalog.clone(), store.clone());
        let history = match MessageSearch::start(
            &config.state_directory.join("message-search.sqlite"),
            catalog.clone(),
        ) {
            Ok(search) => history.with_search(search),
            Err(error) => {
                tracing::error!(err = ?error, "message search unavailable; chat service remains available");
                history
            }
        };
        let sync = if config.enable_mutations {
            SyncHub::with_mutations(upstream.clone(), store.clone(), history.clone())
        } else {
            SyncHub::new(upstream, store.clone(), history.clone())
        };

        let attachment_root = config.codex_home.join("attachments/codewide");
        tokio::fs::create_dir_all(&attachment_root).await?;
        tokio::fs::set_permissions(&attachment_root, std::fs::Permissions::from_mode(0o700))
            .await?;
        let files = Arc::new(
            FileService::open_with_managed_attachments(
                HashMap::from([("attachments".to_owned(), attachment_root)]),
                Vec::new(),
                HashMap::new(),
                Some(config.state_directory.join("preview-files.json")),
                "attachments".to_owned(),
                None,
            )
            .await?,
        );
        files.gc_managed_attachments().await?;
        start_attachment_cleanup(files.clone());

        let content = PrivateContentService::open_indexed(
            config.state_directory.join("content-fallback"),
            Vec::new(),
            store.clone(),
        );
        let image_previews = Arc::new(ImagePreviewService::new());
        let media = Arc::new(MediaProxyService::new());
        let tunnels = Arc::new(LocalhostTunnelService::new()?);
        tunnels.start_periodic_cleanup();
        let dictation = Arc::new(
            DictationService::open(
                config.codex_home.join("auth.json"),
                config.state_directory.join("dictation"),
            )
            .await?,
        );
        let vcs = Arc::new(VcsService::new(
            config.state_directory.join("vcs-plugins.json"),
        ));
        let resources = Arc::new(
            ResourceService::open(
                config.state_directory.join("resource-index.redb"),
                catalog.clone(),
                store.clone(),
                files.clone(),
            )?
            .with_vcs(vcs.clone()),
        );
        let workspaces = Arc::new(WorkspaceService::new(
            vcs,
            config.codex_home.join("worktrees"),
        ));
        let projects = ProjectService::open(config.state_directory.join("projects.json")).await?;
        let mut sync = sync
            .with_content_projector(Arc::new(ContentProjector::new(content.clone())))
            .with_dictation(dictation)
            .with_files(files.clone())
            .with_resources(resources.clone())
            .with_projects(projects.clone())
            .with_workspaces(workspaces.clone());
        if let Some(account_pool) = &account_pool {
            sync = sync.with_account_pool(account_pool);
        }

        let identity = CompanionIdentity::load_or_create_with_policy(
            &config.state_directory.join("identity"),
            config.secret_storage_policy,
        )?;
        let registry = Arc::new(
            DeviceRegistry::open(
                Arc::from(ephemeral_admin_token()?),
                config.state_directory.join("devices.json"),
                None,
            )
            .await?,
        );
        tunnels.start_revocation_cleanup(registry.subscribe_authorization_changes());

        let bootstrap_listener = std::net::TcpListener::bind((Ipv4Addr::LOCALHOST, 0))?;
        bootstrap_listener.set_nonblocking(true)?;
        let bootstrap_target = bootstrap_listener.local_addr()?;
        let inner_listener = std::net::TcpListener::bind((Ipv4Addr::LOCALHOST, 0))?;
        inner_listener.set_nonblocking(true)?;
        let inner_target = inner_listener.local_addr()?;
        let relay = RelayRuntime::start(
            config.state_directory.join("relay.json"),
            inner_target,
            bootstrap_target,
        )
        .await?;
        let services = CompanionServices {
            build_shelf: None,
            files: Some(files),
            content: Some(content),
            image_previews: Some(image_previews.clone()),
            media: Some(media.clone()),
            tunnels: Some(tunnels),
            telemetry: Some(telemetry),
            catalog: Some(catalog),
            app_server_socket_path: Some(config.app_server_socket),
            excluded_ports: HashSet::from([bootstrap_target.port(), inner_target.port()]),
            transport_identity: Some(identity.public().clone()),
            bootstrap_tls_target: Some(bootstrap_target),
            bootstrap_tls_limit: Some(Arc::new(tokio::sync::Semaphore::new(16))),
            inner_tls_target: Some(inner_target),
            inner_tls_limit: Some(Arc::new(tokio::sync::Semaphore::new(256))),
            relay: Some(relay.clone()),
            ..CompanionServices::default()
        };
        let bootstrap_tls = bootstrap_config(&identity)?;
        let inner_tls = device_bound_config(&identity, registry.trusted_client_spki())?;
        let routers = server::split_routers_with_registry_and_services(
            store,
            registry.clone(),
            sync,
            services,
        );
        let bootstrap_handle = axum_server::Handle::new();
        let inner_handle = axum_server::Handle::new();
        let task_failure = Arc::new(RwLock::new(None));
        let bootstrap_task = spawn_server(
            "bootstrap",
            task_failure.clone(),
            axum_server::from_tcp_rustls(bootstrap_listener, bootstrap_tls)?
                .handle(bootstrap_handle.clone())
                .serve(routers.bootstrap.into_make_service()),
        );
        let inner_task = spawn_server(
            "inner",
            task_failure.clone(),
            axum_server::from_tcp(inner_listener)?
                .acceptor(DeviceTlsAcceptor::new(inner_tls))
                .handle(inner_handle.clone())
                .serve(routers.inner.into_make_service()),
        );

        Ok(Self {
            registry,
            relay,
            identity: identity.public().clone(),
            media,
            image_previews,
            bootstrap_handle,
            inner_handle,
            tasks: vec![bootstrap_task, inner_task],
            task_failure,
        })
    }

    #[must_use]
    pub fn failure(&self) -> Option<String> {
        self.task_failure
            .read()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .clone()
    }

    /// Creates a one-time pairing link for the configured Relay endpoint.
    /// # Errors
    /// Requires a configured and enabled Relay and durable pairing state.
    pub async fn create_pairing(&self) -> RuntimeResult<PairingPresentation> {
        let status = self.relay.status()?;
        if !status.enabled {
            return Err("Relay must be configured and enabled before pairing a device".into());
        }
        let endpoint = status
            .public_endpoint
            .ok_or("Relay has no public endpoint")?;
        let endpoint = Url::parse(&endpoint)?;
        let pairing = self.registry.create_pairing().await?;
        let link = build_link(&PairingLinkInput {
            endpoint: &endpoint,
            pairing_token: &pairing.pairing_token,
            expires_at: pairing.expires_at,
            display_name: "CodeWide host",
            emoji: "🖥️",
            tls_pin_sha256: &self.identity.tls_pin_sha256,
            identity_expires_at: Some(self.identity.expires_at),
        })?;
        Ok(PairingPresentation {
            link: link.into(),
            expires_at: pairing.expires_at,
        })
    }

    pub async fn devices(&self) -> Vec<DeviceStatus> {
        self.registry.device_statuses().await
    }

    /// Revokes one device and clears its service-owned transient state.
    /// # Errors
    /// Returns an error when the registry cannot durably persist the change.
    pub async fn revoke_device(&self, device_id: String) -> RuntimeResult<bool> {
        let removed = self.registry.revoke(&device_id).await?;
        if removed {
            self.media.purge_owner(&device_id);
            self.image_previews.purge_media_owner(&device_id);
        }
        Ok(removed)
    }

    /// Pairs this Companion with a Relay invitation bundle.
    /// # Errors
    /// Rejects invalid JSON, relay identity, invitation, or network response.
    pub async fn pair_relay(
        &self,
        relay_address: String,
        invitation_json: String,
    ) -> RuntimeResult<RelayStatus> {
        if relay_address.len() > 255 || invitation_json.len() > 8 * 1024 {
            return Err("Relay pairing input exceeds its bounded contract".into());
        }
        let invitation = serde_json::from_str(&invitation_json)?;
        Ok(self
            .relay
            .pair(RelayPairCommand {
                relay_address,
                invitation,
            })
            .await?)
    }

    /// Enables or disables the configured Relay adapter.
    /// # Errors
    /// Rejects an absent or invalid Relay configuration.
    pub async fn set_relay_enabled(&self, enabled: bool) -> RuntimeResult<RelayStatus> {
        Ok(self.relay.set_enabled(enabled).await?)
    }

    /// Returns durable Relay configuration plus live reachability.
    /// # Errors
    /// Rejects a corrupt or unsafe Relay configuration.
    pub fn relay_status(&self) -> RuntimeResult<RelayStatus> {
        Ok(self.relay.status()?)
    }
}

impl Drop for ManagedRuntime {
    fn drop(&mut self) {
        self.bootstrap_handle.shutdown();
        self.inner_handle.shutdown();
        for task in &self.tasks {
            task.abort();
        }
    }
}

fn ephemeral_admin_token() -> RuntimeResult<String> {
    let mut random = [0_u8; 32];
    OsRng
        .try_fill_bytes(&mut random)
        .map_err(|_| "secure randomness unavailable")?;
    Ok(URL_SAFE_NO_PAD.encode(random))
}

fn start_catalog_warmup(catalog: Arc<SessionCatalog>, store: Arc<IndexStore>) {
    tokio::spawn(async move {
        let result = tokio::task::spawn_blocking(move || {
            let catalog_threads = catalog.refresh()?;
            let mut metadata = Vec::new();
            let mut failures = 0_usize;
            for path in catalog.rollout_paths() {
                match read_rollout_metadata(&path) {
                    Ok(Some(value)) => metadata.push(value),
                    Ok(None) => {}
                    Err(_) => failures += 1,
                }
            }
            let indexed = metadata.len();
            if store.put_thread_metadata_batch(&metadata).is_err() {
                failures = failures.saturating_add(indexed);
                return Ok::<_, crate::catalog::CatalogError>((catalog_threads, 0, failures));
            }
            Ok((catalog_threads, indexed, failures))
        })
        .await;
        match result {
            Ok(Ok((catalog_threads, indexed_metadata, metadata_failures))) => {
                tracing::info!(threads = catalog_threads, "catalog warmup is ready");
                tracing::info!(threads = indexed_metadata, "metadata warmup is ready");
                if metadata_failures > 0 {
                    tracing::warn!(
                        failures = metadata_failures,
                        "some thread metadata headers could not be indexed"
                    );
                }
            }
            Ok(Err(error)) => tracing::warn!(err = ?error, "catalog warmup failed"),
            Err(error) => tracing::warn!(err = ?error, "catalog warmup task failed"),
        }
    });
}

fn start_attachment_cleanup(files: Arc<FileService>) {
    tokio::spawn(async move {
        loop {
            tokio::time::sleep(std::time::Duration::from_hours(24)).await;
            if let Err(error) = files.gc_managed_attachments().await {
                tracing::warn!(reason = %error, "managed attachment cleanup failed");
            }
        }
    });
}

fn spawn_server<F>(
    name: &'static str,
    failure: Arc<RwLock<Option<String>>>,
    server: F,
) -> JoinHandle<()>
where
    F: std::future::Future<Output = Result<(), std::io::Error>> + Send + 'static,
{
    tokio::spawn(async move {
        if let Err(error) = server.await {
            let message = format!("{name} server stopped: {error}");
            tracing::error!(err = ?error, server = name, "managed Companion server stopped");
            *failure
                .write()
                .unwrap_or_else(std::sync::PoisonError::into_inner) = Some(message);
        }
    })
}

#[must_use]
pub const fn relay_connection_label(status: RelayConnectionStatus) -> &'static str {
    match status {
        RelayConnectionStatus::Disabled => "disabled",
        RelayConnectionStatus::Connecting => "connecting",
        RelayConnectionStatus::Online => "online",
        RelayConnectionStatus::Reconnecting => "reconnecting",
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use codewide_relay::{
        pairing::InvitationBundle, registry::Registry, server::Relay,
        transport_tls::RelayTlsIdentity,
    };
    use tokio::net::TcpListener;
    use tokio_util::sync::CancellationToken;

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn fresh_desktop_runtime_starts_without_a_running_app_server() -> RuntimeResult<()> {
        let directory = tempfile::tempdir()?;
        let state = directory.path().join("state");
        let codex_home = directory.path().join("codex");
        tokio::fs::create_dir_all(&codex_home).await?;
        let runtime =
            ManagedRuntime::start(ManagedRuntimeConfig::desktop(state, codex_home)).await?;

        assert!(runtime.failure().is_none());
        assert!(!runtime.relay_status()?.configured);
        assert!(runtime.devices().await.is_empty());
        assert!(runtime.create_pairing().await.is_err());
        Ok(())
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn relay_pairing_produces_a_route_qualified_device_link() -> RuntimeResult<()> {
        let directory = tempfile::tempdir()?;
        let relay_state = directory.path().join("relay");
        let registry = Registry::open(&relay_state)?;
        let identity = RelayTlsIdentity::load_or_create(&relay_state)?;
        let listener = TcpListener::bind("127.0.0.1:0").await?;
        let relay_address = listener.local_addr()?;
        let stop = CancellationToken::new();
        let server_stop = stop.clone();
        let relay = Relay::new(registry.clone());
        let server_config = identity.server_config()?;
        let server = tokio::spawn(async move {
            let _ =
                codewide_relay::server::serve(relay, listener, server_config, server_stop).await;
        });

        let state = directory.path().join("companion");
        let codex_home = directory.path().join("codex");
        tokio::fs::create_dir_all(&codex_home).await?;
        let runtime =
            ManagedRuntime::start(ManagedRuntimeConfig::desktop(state, codex_home)).await?;
        let invitation = registry.create_invitation(None)?;
        runtime
            .pair_relay(
                relay_address.to_string(),
                serde_json::to_string(&InvitationBundle {
                    version: codewide_relay::pairing::INVITATION_VERSION,
                    relay_tls_pin_sha256: identity.pin(),
                    route_id: invitation.route_id,
                    invitation: invitation.token,
                })?,
            )
            .await?;
        tokio::time::timeout(std::time::Duration::from_secs(5), async {
            loop {
                if runtime
                    .relay_status()
                    .is_ok_and(|status| status.connection == RelayConnectionStatus::Online)
                {
                    return;
                }
                tokio::time::sleep(std::time::Duration::from_millis(25)).await;
            }
        })
        .await?;

        let pairing = runtime.create_pairing().await?;
        let link = Url::parse(&pairing.link)?;
        let query = link.query_pairs().collect::<HashMap<_, _>>();
        assert_eq!(link.scheme(), "codewide");
        assert_eq!(query.get("v").map(AsRef::as_ref), Some("1"));
        assert!(query.get("e").is_some_and(|endpoint| {
            endpoint.starts_with(&format!("ws://{relay_address}/c/"))
                && endpoint.ends_with("/v1/sync")
        }));
        assert!(query.contains_key("t"));
        assert!(query.contains_key("p"));

        stop.cancel();
        server.await?;
        Ok(())
    }
}
