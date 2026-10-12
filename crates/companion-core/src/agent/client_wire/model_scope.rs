//! A thread keeps its provider for life: switching agents is a fork. A turn
//! or settings change on an existing thread therefore may not name a model
//! that only another provider offers.
//!
//! Which provider offers a model comes from the providers' catalogs, cached
//! for a short time so a turn does not wait on every catalog. A model no
//! catalog lists is left to the thread's provider (Codex accepts models
//! outside its list); only a model listed by another provider and not by the
//! thread's own is rejected, with `-32602`.

use std::{
    collections::{HashMap, HashSet},
    time::{Duration, Instant},
};

use serde_json::Value;
use tokio::sync::Mutex;

use super::gateway::{RpcFailure, Target};
use crate::agent::{
    model::{ERROR_INVALID_PARAMS, ProviderId},
    registry::ProviderRegistry,
};

/// How long the providers' model lists are trusted before they are read again.
const OWNERS_TTL: Duration = Duration::from_mins(5);

/// Thread-scoped methods whose `model` sets the thread's model.
const MODEL_METHODS: [&str; 3] = [
    "turn/start",
    "thread/settings/update",
    "turn/settings/update",
];

/// Which providers list each model id, with when it was read.
struct Owners {
    read_at: Instant,
    by_model: HashMap<String, HashSet<ProviderId>>,
}

/// The cached model ownership of the enabled providers.
#[derive(Default)]
pub struct ModelScope {
    owners: Mutex<Option<Owners>>,
}

impl ModelScope {
    /// Rejects `method` when its `model` belongs only to another provider than
    /// the thread's. A single-provider host has nothing to switch to.
    ///
    /// # Errors
    /// Returns `-32602` naming the provider that offers the model.
    pub async fn check(
        &self,
        registry: &ProviderRegistry,
        target: &Target,
        method: &str,
        params: &Value,
    ) -> Result<(), RpcFailure> {
        if !registry.is_multi_provider() || !MODEL_METHODS.contains(&method) {
            return Ok(());
        }
        let Some(model) = params.get("model").and_then(Value::as_str) else {
            return Ok(());
        };
        let own = &target.wire.descriptor.id;
        let mut owners = self.owners_of(registry, model, false).await;
        if owners.is_empty() {
            // A model added since the last read: read the catalogs again once.
            owners = self.owners_of(registry, model, true).await;
        }
        if owners.is_empty() || owners.contains(own) {
            return Ok(());
        }
        let other = owners
            .iter()
            .filter_map(|id| registry.get(id))
            .map(|provider| provider.descriptor().display_name)
            .next()
            .unwrap_or_else(|| "another agent".into());
        Err(RpcFailure::new(
            ERROR_INVALID_PARAMS,
            format!(
                "{model} is a {other} model; this thread runs on {}. Fork the thread to switch agents.",
                target.wire.descriptor.display_name
            ),
        ))
    }

    /// The providers listing `model`, from catalogs read within the TTL
    /// unless `refresh` asks for a new read.
    async fn owners_of(
        &self,
        registry: &ProviderRegistry,
        model: &str,
        refresh: bool,
    ) -> HashSet<ProviderId> {
        let mut cached = self.owners.lock().await;
        let stale = cached
            .as_ref()
            .is_none_or(|owners| refresh || owners.read_at.elapsed() > OWNERS_TTL);
        if stale {
            *cached = Some(read_owners(registry).await);
        }
        cached
            .as_ref()
            .and_then(|owners| owners.by_model.get(model).cloned())
            .unwrap_or_default()
    }
}

/// Reads every enabled provider's catalog; a provider whose catalog fails
/// owns nothing in this read, so its threads are not blocked by it.
async fn read_owners(registry: &ProviderRegistry) -> Owners {
    let mut by_model: HashMap<String, HashSet<ProviderId>> = HashMap::new();
    for provider in registry.enabled() {
        let Ok(catalog) = provider.catalog_models().await else {
            continue;
        };
        let id = provider.descriptor().id;
        for entry in catalog.models {
            for name in [entry.id, entry.model] {
                by_model.entry(name).or_default().insert(id.clone());
            }
        }
    }
    Owners {
        read_at: Instant::now(),
        by_model,
    }
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use serde_json::json;

    use super::*;
    use crate::{
        agent::{
            bindings::{BindingOrigin, BindingStore},
            client_wire::gateway::ClientWireGateway,
            model::{AppThreadId, CapabilitySet, StartWhileActiveMode},
            provider::AgentProvider,
            testing::ScriptedProvider,
        },
        store::IndexStore,
    };

    const THREAD: &str = "019bd2f0-0000-7000-8000-000000000001";

    async fn gateway(
        providers: &[&'static str],
    ) -> Result<(ClientWireGateway, tempfile::TempDir), Box<dyn std::error::Error>> {
        let directory = tempfile::tempdir()?;
        let store = Arc::new(IndexStore::open(directory.path().join("state.redb"))?);
        let enabled = providers
            .iter()
            .map(|id| {
                let provider: Arc<dyn AgentProvider> = Arc::new(ScriptedProvider::new(
                    id,
                    CapabilitySet::none(StartWhileActiveMode::Busy),
                ));
                provider
            })
            .collect();
        let registry = Arc::new(ProviderRegistry::new(
            enabled,
            &ProviderId::from_static("codex"),
            Vec::new(),
        )?);
        let bindings = Arc::new(BindingStore::new(store));
        bindings
            .bind(
                &AppThreadId::from_static(THREAD),
                &ProviderId::from_static("codex"),
                BindingOrigin::Created,
            )
            .await?;
        Ok((ClientWireGateway::new(registry, bindings), directory))
    }

    async fn check(
        gateway: &ClientWireGateway,
        method: &str,
        model: &str,
    ) -> Result<Result<(), RpcFailure>, Box<dyn std::error::Error>> {
        let target = gateway
            .resolve_thread(THREAD, None)
            .await
            .map_err(|failure| failure.message)?;
        let params = json!({"threadId": THREAD, "model": model});
        Ok(gateway.check_model_scope(&target, method, &params).await)
    }

    #[tokio::test]
    async fn another_providers_model_is_rejected_on_an_existing_thread()
    -> Result<(), Box<dyn std::error::Error>> {
        let (gateway, _directory) = gateway(&["codex", "claude"]).await?;
        for method in MODEL_METHODS {
            let failure = check(&gateway, method, "claude-default")
                .await?
                .err()
                .ok_or("another provider's model was accepted")?;
            assert_eq!(failure.code, ERROR_INVALID_PARAMS);
            assert!(failure.message.contains("Fork the thread"));
        }
        assert!(
            check(&gateway, "turn/start", "codex-default")
                .await?
                .is_ok()
        );
        // A model no catalog lists stays with the thread's provider.
        assert!(check(&gateway, "turn/start", "custom-model").await?.is_ok());
        assert!(
            check(&gateway, "thread/read", "claude-default")
                .await?
                .is_ok()
        );
        Ok(())
    }

    #[tokio::test]
    async fn a_single_provider_host_checks_nothing() -> Result<(), Box<dyn std::error::Error>> {
        let (gateway, _directory) = gateway(&["codex"]).await?;
        assert!(
            check(&gateway, "turn/start", "claude-default")
                .await?
                .is_ok()
        );
        Ok(())
    }
}
