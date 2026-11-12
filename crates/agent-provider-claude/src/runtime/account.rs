//! The provider's view of the user's Claude installation: the sign-in state
//! and the model catalog, read by probing `claude` (one `initialize`), and
//! the plan limits that probe reads. Probed at start; a catalog read answers
//! Claude's current list as `model/list` does for Codex: it probes first
//! while no model is known or the user is signed out, and otherwise answers
//! at once and probes in the background when the last probe is a minute old,
//! so a model Claude adds or drops reaches the next read without a restart.

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
    /// How old the last probe may be before a catalog read probes again.
    reprobe_interval: Duration,
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
            reprobe_interval: REPROBE_INTERVAL,
        }
    }

    #[cfg(test)]
    pub(crate) const fn with_reprobe_interval(mut self, interval: Duration) -> Self {
        self.reprobe_interval = interval;
        self
    }

    /// The model catalog. With no model known or the user signed out it
    /// probes first; otherwise it answers the cached list at once and, when
    /// the last probe is older than the reprobe interval, probes in the
    /// background for the next read.
    pub async fn catalog(self: &Arc<Self>) -> ModelCatalog {
        let signed_in = matches!(
            &*self.health.borrow(),
            ProviderHealth::Available(ProviderAuth::Authenticated { .. })
        );
        if self.cache().models().is_empty() || !signed_in {
            self.probe(Some(self.reprobe_interval)).await;
        } else {
            let account = Arc::clone(self);
            tokio::spawn(async move { account.probe(Some(account.reprobe_interval)).await });
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

#[cfg(test)]
mod tests {
    use std::path::Path;

    use super::*;
    use crate::test_scripts::fake_claude;

    /// Answers `initialize` with the model rows in `models.json` of its
    /// working directory, read at each start, and a signed-in account.
    const LISTING: &str = r#"#!/bin/sh
while IFS= read -r line; do
  case "$line" in
    *'"subtype":"initialize"'*) printf '{"type":"control_response","response":{"subtype":"success","request_id":"codewide-1","response":{"commands":[],"models":%s,"account":{"subscriptionType":"max","tokenSource":"claude.ai"}}}}\n' "$(cat models.json)" ;;
    *get_usage*) printf '%s\n' '{"type":"control_response","response":{"subtype":"error","request_id":"codewide-2","error":"none"}}' ;;
  esac
done
"#;

    fn list(directory: &Path, values: &[&str]) {
        let rows: Vec<_> = values
            .iter()
            .map(|value| serde_json::json!({"value": value, "displayName": value, "description": ""}))
            .collect();
        std::fs::write(
            directory.join("models.json"),
            serde_json::to_string(&rows).unwrap_or_default(),
        )
        .unwrap_or_else(|error| panic!("{error}"));
    }

    fn ids(catalog: &ModelCatalog) -> Vec<String> {
        catalog
            .models
            .iter()
            .map(|model| model.id.clone())
            .collect()
    }

    #[tokio::test]
    async fn a_model_claude_adds_later_reaches_the_catalog_without_a_restart() {
        let directory = tempfile::tempdir().unwrap_or_else(|error| panic!("{error}"));
        list(directory.path(), &["default", "opus"]);
        let (health, _) = watch::channel(ProviderHealth::Available(ProviderAuth::Unknown));
        let (limits, _) = watch::channel(None);
        let account = Arc::new(
            Account::new(
                ProbeTarget {
                    executable: fake_claude(directory.path(), LISTING),
                    cwd: directory.path().to_owned(),
                    environment: Vec::new(),
                },
                Arc::new(health),
                Arc::new(CatalogPricing::default()),
                Arc::new(CatalogNames::default()),
                Arc::new(PublishedLimits::new(Arc::new(limits))),
            )
            .with_reprobe_interval(Duration::ZERO),
        );
        // Nothing known yet: the first read waits for the probe.
        assert_eq!(ids(&account.catalog().await), ["default", "opus"]);

        list(directory.path(), &["default", "opus", "claude-fable-5-2"]);
        // A known list answers at once, before the background probe settles.
        assert_eq!(ids(&account.catalog().await), ["default", "opus"]);
        let refreshed = tokio::time::timeout(Duration::from_secs(10), async {
            loop {
                let catalog = account.catalog().await;
                if catalog.models.len() == 3 {
                    return catalog;
                }
                tokio::time::sleep(Duration::from_millis(20)).await;
            }
        })
        .await
        .unwrap_or_else(|_| panic!("the added model never reached the catalog"));
        assert_eq!(ids(&refreshed), ["default", "opus", "claude-fable-5-2"]);
    }
}
