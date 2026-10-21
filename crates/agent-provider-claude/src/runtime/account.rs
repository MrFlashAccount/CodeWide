//! The provider's view of the user's Claude installation: the sign-in state
//! and the model catalog, read by probing `claude` (one `initialize`), and
//! the plan limits that probe reads. Probed at start and again on a catalog
//! request while no model is known or the user is signed out, at most once
//! a minute.

use std::{
    ffi::OsString,
    path::PathBuf,
    sync::{Arc, Mutex, PoisonError},
    time::Duration,
};

use agent_core::{
    model::{ModelCatalog, ProviderAccount},
    naming::CatalogNames,
    provider::{ProviderAuth, ProviderHealth},
    usage::CatalogPricing,
};
use tokio::{sync::watch, time::Instant};
use tracing::{info, warn};

use super::{
    models::ModelCatalogCache,
    probe::{ProbeLaunch, probe},
    published_limits::PublishedLimits,
};
use crate::session::ports::RateLimitSink;

const REPROBE_INTERVAL: Duration = Duration::from_mins(1);

/// How the probe starts `claude`.
pub struct ProbeTarget {
    pub executable: PathBuf,
    pub cwd: PathBuf,
    pub environment: Vec<(OsString, OsString)>,
}

/// The sign-in state and model catalog of this machine's `claude`.
pub struct Account {
    target: ProbeTarget,
    health: Arc<watch::Sender<ProviderHealth>>,
    catalog: Mutex<ModelCatalogCache>,
    pricing: Arc<CatalogPricing>,
    names: Arc<CatalogNames>,
    limits: Arc<PublishedLimits>,
    /// Held while a probe runs; the time of the last one.
    probing: tokio::sync::Mutex<Option<Instant>>,
}

impl Account {
    #[must_use]
    pub fn new(
        target: ProbeTarget,
        health: Arc<watch::Sender<ProviderHealth>>,
        pricing: Arc<CatalogPricing>,
        names: Arc<CatalogNames>,
        limits: Arc<PublishedLimits>,
    ) -> Self {
        Self {
            target,
            health,
            catalog: Mutex::new(ModelCatalogCache::default()),
            pricing,
            names,
            limits,
            probing: tokio::sync::Mutex::new(None),
        }
    }

    /// The model catalog, probing first when no model is known or the user
    /// is signed out (at most once a minute).
    pub async fn catalog(&self) -> ModelCatalog {
        let signed_in = matches!(
            &*self.health.borrow(),
            ProviderHealth::Available(ProviderAuth::Authenticated { .. })
        );
        if self.cache().models().is_empty() || !signed_in {
            self.probe(Some(REPROBE_INTERVAL)).await;
        }
        self.cache().catalog()
    }

    /// The catalog's id of a model a session recorded.
    #[must_use]
    pub fn id_for(&self, recorded: &str) -> String {
        self.cache().id_for(recorded).to_owned()
    }

    fn cache(&self) -> std::sync::MutexGuard<'_, ModelCatalogCache> {
        self.catalog.lock().unwrap_or_else(PoisonError::into_inner)
    }

    /// Probes `claude` unless one ran less than `min_interval` ago; a probe
    /// already running is waited for instead.
    pub async fn probe(&self, min_interval: Option<Duration>) {
        let mut last = self.probing.lock().await;
        if let (Some(interval), Some(at)) = (min_interval, *last)
            && at.elapsed() < interval
        {
            return;
        }
        *last = Some(Instant::now());
        let probed = probe(ProbeLaunch {
            executable: &self.target.executable,
            cwd: &self.target.cwd,
            environment: &self.target.environment,
        })
        .await;
        match probed {
            Ok(result) => {
                {
                    let mut cache = self.cache();
                    cache.update(result.models);
                    if !cache.prices().is_empty() {
                        self.pricing.replace(cache.prices().clone());
                    }
                    if !cache.names().is_empty() {
                        self.names.replace(cache.names().to_vec());
                    }
                }
                if let Some(usage) = &result.usage {
                    self.limits.usage_read(usage);
                }
                self.signed_in(result.account.as_ref());
            }
            Err(err) => warn!(err = %err, "Claude could not be probed"),
        }
    }

    /// Publishes the sign-in state; neither label is logged.
    fn signed_in(&self, account: Option<&ProviderAccount>) {
        let auth = provider_auth(account);
        self.health.send_if_modified(|current| match current {
            ProviderHealth::Available(previous) if *previous != auth => {
                info!(
                    authenticated = matches!(auth, ProviderAuth::Authenticated { .. }),
                    "Claude sign-in state changed"
                );
                *previous = auth;
                true
            }
            ProviderHealth::Available(_) | ProviderHealth::Unavailable => false,
        });
    }
}

/// The sign-in state an account reports; no account means it is not known.
#[must_use]
pub fn provider_auth(account: Option<&ProviderAccount>) -> ProviderAuth {
    match account {
        None => ProviderAuth::Unknown,
        Some(account) if account.authenticated => ProviderAuth::Authenticated {
            plan_label: account.label.clone(),
            account_label: account.account_label.clone(),
        },
        Some(_) => ProviderAuth::Unauthenticated,
    }
}
