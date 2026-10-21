//! Reconstructs delivered events using the thread's durable provider context.
//! Pricing belongs to that provider; native storage only adds catalog metadata.
//! Page delivery sends the projected events through the socket's interest.

use std::sync::Arc;

use agent_core::usage::{UsagePricing, price_replay_payload};
use serde_json::Value;

use super::{
    SessionSocket,
    interest::{ReplayDelivery, SharedInterest, lock_interest},
    send_json,
};
use crate::{
    agent::{
        bindings::BindingStore,
        model::{AppThreadId, Capability},
        provider::NativeSurface,
        registry::ProviderRegistry,
    },
    store::ReplayPage,
};

/// Why one replay page could not be delivered: the journal entry could not be
/// decoded or projected, or the socket is gone.
pub(super) enum ReplayDeliveryError {
    Journal,
    Socket,
}

/// Sends one replay page through the socket's interest and returns the socket
/// position afterwards (the page head). Shared by the hello replay, the
/// post-snapshot replay and the live task so the predicate and the
/// `afterCursor` chain exist once. The interest snapshot is taken after the
/// page was read: an `interest add` applied later has a
/// `companion/thread/sync` fence at or past this page's head.
pub(super) async fn deliver_replay_page(
    socket: &SessionSocket,
    projector: &ReplayProjector,
    interest: &SharedInterest,
    position: u64,
    page: ReplayPage,
) -> Result<u64, ReplayDeliveryError> {
    let mut delivery = ReplayDelivery::new(&lock_interest(interest), position);
    for (cursor, payload) in page.entries {
        let payload =
            serde_json::from_slice::<Value>(&payload).map_err(|_| ReplayDeliveryError::Journal)?;
        if !delivery.delivers(&payload) {
            continue;
        }
        let payload = projector
            .project(payload)
            .await
            .map_err(|_| ReplayDeliveryError::Journal)?;
        send_json(socket, &delivery.event_frame(cursor, payload))
            .await
            .map_err(|_| ReplayDeliveryError::Socket)?;
    }
    if let Some(advance) = delivery.advance_frame(page.head_cursor) {
        send_json(socket, &advance)
            .await
            .map_err(|_| ReplayDeliveryError::Socket)?;
    }
    Ok(delivery.position())
}

pub(super) struct ReplayProjector {
    registry: Arc<ProviderRegistry>,
    bindings: Arc<BindingStore>,
}

impl ReplayProjector {
    pub(super) fn new(registry: Arc<ProviderRegistry>, bindings: Arc<BindingStore>) -> Self {
        Self { registry, bindings }
    }

    pub(super) async fn project(&self, payload: Value) -> Result<Value, String> {
        let registry = &self.registry;
        let thread_id = super::payload_thread_id(&payload).and_then(AppThreadId::parse);
        let provider_id = match thread_id {
            Some(id)
                if payload.get("codewideReplayPricing").is_some()
                    || crate::model_labels::names_a_model(&payload) =>
            {
                self.bindings
                    .provider_of(&id)
                    .await
                    .map_err(|error| error.to_string())?
            }
            _ => None,
        };
        let provider = match provider_id.as_ref() {
            Some(id) => registry.get(id),
            // A legacy journal may predate bindings. A single-provider host
            // still supplies unambiguous provider context without model lookup.
            None if !registry.is_multi_provider() => Some(registry.primary()),
            None => None,
        };
        let pricing = provider.and_then(|provider| provider.usage_pricing());
        let unpriced = UsagePricing::default();
        let payload = price_replay_payload(payload, pricing.as_deref().unwrap_or(&unpriced));
        // Named after pricing, which rebuilds the delivered costs.
        let payload = match provider.and_then(|provider| provider.model_names()) {
            Some(names) => crate::model_labels::label_payload(payload, names.as_ref()),
            None => payload,
        };
        let thread_store = registry
            .owner(Capability::CodexNative)
            .and_then(|owner| owner.native_surface())
            .and_then(NativeSurface::thread_store);
        match thread_store {
            Some(thread_store) => thread_store.replay_event(payload),
            None => Ok(payload),
        }
    }
}

#[cfg(test)]
mod tests {
    use agent_core::{
        model::{CapabilitySet, ModelPriceEntry, ModelRates, ProviderId, StartWhileActiveMode},
        usage::{CatalogPricing, prepare_replay_payload},
    };
    use serde_json::json;

    use super::*;
    use crate::{
        agent::{
            bindings::{BindingOrigin, BindingStore},
            client_wire::gateway::ClientWireGateway,
            registry::{ProviderRegistry, RegistryError},
            testing::FakeProvider,
        },
        store::IndexStore,
        usage::LiveUsageProjector,
    };

    type TestResult = Result<(), Box<dyn std::error::Error>>;

    fn table(input: f64) -> Arc<CatalogPricing> {
        Arc::new(CatalogPricing::new([(
            "shared-model".into(),
            ModelPriceEntry {
                pricing_version: "test-rates".into(),
                rates: ModelRates {
                    input,
                    cached_input: input / 10.0,
                    cache_write_input: input * 1.25,
                    output: input * 5.0,
                },
                long_context: None,
            },
        )]))
    }

    fn provider(id: &'static str, prices: Option<Arc<CatalogPricing>>) -> Arc<FakeProvider> {
        let mut provider = FakeProvider::new(id, CapabilitySet::none(StartWhileActiveMode::Busy));
        provider.pricing = prices.map(|prices| {
            let prices: Arc<dyn agent_core::usage::ModelPricing> = prices;
            prices
        });
        provider.into_arc()
    }

    /// A provider that names the shared model its own way.
    fn named_provider(id: &'static str) -> Arc<FakeProvider> {
        let mut provider = FakeProvider::new(id, CapabilitySet::none(StartWhileActiveMode::Busy));
        provider.pricing = Some(table(1.0));
        provider.names = Some(Arc::new(agent_core::naming::CatalogNames::new([(
            "shared-model".to_owned(),
            format!("Shared ({id})"),
        )])));
        provider.into_arc()
    }

    fn gateway(
        store: Arc<IndexStore>,
        multi: bool,
        priced: bool,
    ) -> Result<Arc<ClientWireGateway>, RegistryError> {
        let primary = provider("primary", Some(table(1.0)));
        let registry = if multi {
            ProviderRegistry::new(
                vec![primary, provider("secondary", priced.then(|| table(7.0)))],
                &ProviderId::from_static("primary"),
                Vec::new(),
            )?
        } else {
            ProviderRegistry::single(primary, Vec::new())
        };
        Ok(Arc::new(ClientWireGateway::new(
            Arc::new(registry),
            Arc::new(BindingStore::new(store)),
        )))
    }

    fn journal(
        store: Arc<IndexStore>,
        gateway: &ClientWireGateway,
        provider: &'static str,
    ) -> Result<(Value, Value), Box<dyn std::error::Error>> {
        let mut usage = LiveUsageProjector::new(store, gateway.registry().usage_pricing());
        let started = json!({"method": "thread/started", "params": {
            "thread": {"id": "thread", "model": "shared-model"}
        }});
        usage.observe_provider(&started, &ProviderId::from_static(provider))?;
        usage.observe(&started)?;
        usage.observe(&json!({"method": "turn/started", "params": {
            "threadId": "thread", "turn": {"id": "turn"}
        }}))?;
        let counts = json!({"inputTokens": 1000, "outputTokens": 100,
            "cachedInputTokens": 200, "cacheWriteInputTokens": 0,
            "reasoningOutputTokens": 0, "totalTokens": 1100});
        let event = json!({"method": "thread/tokenUsage/updated", "params": {
            "threadId": "thread", "turnId": "turn",
            "tokenUsage": {"total": counts, "last": counts, "modelContextWindow": 200_000}
        }});
        let projected = usage.observe(&event)?.ok_or("usage projection missing")?;
        let replay_pricing = usage.replay_pricing(&event);
        let event =
            crate::thread_patch::attach_thread_patch_with_usage(event, Some(projected.clone()));
        Ok((prepare_replay_payload(event, replay_pricing), projected))
    }

    #[tokio::test]
    async fn a_delivered_cost_and_settings_change_carry_the_bound_providers_model_name()
    -> TestResult {
        let directory = tempfile::tempdir()?;
        let store = Arc::new(IndexStore::open(directory.path().join("replay.redb"))?);
        let context = Arc::new(ClientWireGateway::new(
            Arc::new(ProviderRegistry::new(
                vec![named_provider("primary"), named_provider("secondary")],
                &ProviderId::from_static("primary"),
                Vec::new(),
            )?),
            Arc::new(BindingStore::new(store.clone())),
        ));
        context
            .bindings()
            .bind(
                &AppThreadId::from_static("thread"),
                &ProviderId::from_static("secondary"),
                BindingOrigin::Created,
            )
            .await?;
        let replay = ReplayProjector::new(context.registry().clone(), context.bindings().clone());
        let (stored, _) = journal(store, &context, "secondary")?;
        let delivered = replay.project(stored).await?;
        assert_eq!(
            delivered["codewideThreadPatch"]["operation"]["usage"]["turn"]["cost"]["modelLabel"],
            "Shared (secondary)"
        );
        let settings = replay
            .project(json!({"method": "thread/settings/updated", "params": {
                "threadId": "thread", "threadSettings": {"model": "shared-model"}}}))
            .await?;
        assert_eq!(
            settings["params"]["threadSettings"]["modelLabel"],
            "Shared (secondary)"
        );
        Ok(())
    }

    #[tokio::test]
    async fn live_cost_and_reopened_journal_use_the_bound_providers_rates() -> TestResult {
        let directory = tempfile::tempdir()?;
        let path = directory.path().join("replay.redb");
        let store = Arc::new(IndexStore::open(&path)?);
        let context = gateway(store.clone(), true, true)?;
        context
            .bindings()
            .bind(
                &AppThreadId::from_static("thread"),
                &ProviderId::from_static("secondary"),
                BindingOrigin::Created,
            )
            .await?;
        let (stored, expected) = journal(store.clone(), &context, "secondary")?;
        assert_eq!(expected["turn"]["cost"]["price"]["input"], 7.0);
        assert!(
            expected["turn"]["cost"]["totalCostUsd"]
                .as_f64()
                .is_some_and(|usd| usd > 0.0)
        );
        let delivered =
            ReplayProjector::new(context.registry().clone(), context.bindings().clone())
                .project(stored.clone())
                .await?;
        assert_eq!(
            delivered["codewideThreadPatch"]["operation"]["usage"],
            expected
        );
        assert!(delivered.get("codewideReplayPricing").is_none());
        store.append_replay_batch(&[serde_json::to_vec(&stored)?], 10, 1024 * 1024)?;
        drop(context);
        drop(store);

        let store = Arc::new(IndexStore::open(path)?);
        let context = gateway(store.clone(), true, true)?;
        let replay = ReplayProjector::new(context.registry().clone(), context.bindings().clone());
        let entries = store.replay_after(Some(0))?.entries;
        assert_eq!(entries.len(), 1);
        for (_, bytes) in entries {
            let event: Value = serde_json::from_slice(&bytes)?;
            assert!(event["codewideThreadPatch"]["operation"]["usage"]["turn"]["cost"].is_null());
            let delivered = replay.project(event).await?;
            assert_eq!(
                delivered["codewideThreadPatch"]["operation"]["usage"],
                expected
            );
        }
        Ok(())
    }

    #[tokio::test]
    async fn missing_provider_prices_do_not_borrow_the_primarys_matching_model() -> TestResult {
        let directory = tempfile::tempdir()?;
        let store = Arc::new(IndexStore::open(directory.path().join("replay.redb"))?);
        let context = gateway(store.clone(), true, false)?;
        context
            .bindings()
            .bind(
                &AppThreadId::from_static("thread"),
                &ProviderId::from_static("secondary"),
                BindingOrigin::Created,
            )
            .await?;
        let (stored, expected) = journal(store, &context, "secondary")?;
        let delivered =
            ReplayProjector::new(context.registry().clone(), context.bindings().clone())
                .project(stored)
                .await?;
        let usage = &delivered["codewideThreadPatch"]["operation"]["usage"];
        assert_eq!(usage["turn"]["tokens"], expected["turn"]["tokens"]);
        assert!(usage["turn"]["cost"].is_null());
        assert!(usage["thread"]["cost"].is_null());
        Ok(())
    }

    #[tokio::test]
    async fn an_unbound_multi_provider_event_stays_unpriced() -> TestResult {
        let directory = tempfile::tempdir()?;
        let store = Arc::new(IndexStore::open(directory.path().join("replay.redb"))?);
        let context = gateway(store.clone(), true, true)?;
        let (stored, _) = journal(store, &context, "secondary")?;
        let delivered =
            ReplayProjector::new(context.registry().clone(), context.bindings().clone())
                .project(stored)
                .await?;
        assert!(delivered["codewideThreadPatch"]["operation"]["usage"]["turn"]["cost"].is_null());
        Ok(())
    }

    #[tokio::test]
    async fn provider_reported_cost_survives_without_catalog_rates() -> TestResult {
        let directory = tempfile::tempdir()?;
        let store = Arc::new(IndexStore::open(directory.path().join("replay.redb"))?);
        let context = gateway(store.clone(), true, false)?;
        context
            .bindings()
            .bind(
                &AppThreadId::from_static("thread"),
                &ProviderId::from_static("secondary"),
                BindingOrigin::Created,
            )
            .await?;
        let (mut stored, _) = journal(store, &context, "secondary")?;
        stored["codewideReplayPricing"]["providerCost"] = json!({
            "basis": "managed", "model": "shared-model", "turnUsd": 0.0042,
            "threadUsd": 0.02
        });
        let delivered =
            ReplayProjector::new(context.registry().clone(), context.bindings().clone())
                .project(stored)
                .await?;
        let usage = &delivered["codewideThreadPatch"]["operation"]["usage"];
        assert_eq!(usage["turn"]["cost"]["basis"], "providerReported");
        assert_eq!(usage["turn"]["cost"]["totalCostUsd"], 0.0042);
        assert_eq!(usage["thread"]["cost"]["totalCostUsd"], 0.02);
        Ok(())
    }

    #[tokio::test]
    async fn legacy_single_provider_events_keep_the_hosts_unambiguous_rates() -> TestResult {
        let directory = tempfile::tempdir()?;
        let store = Arc::new(IndexStore::open(directory.path().join("replay.redb"))?);
        let context = gateway(store.clone(), false, true)?;
        let (stored, expected) = journal(store, &context, "primary")?;
        let delivered =
            ReplayProjector::new(context.registry().clone(), context.bindings().clone())
                .project(stored)
                .await?;
        assert_eq!(
            delivered["codewideThreadPatch"]["operation"]["usage"],
            expected
        );
        Ok(())
    }
}
