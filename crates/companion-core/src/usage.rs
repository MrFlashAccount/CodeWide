//! Live token usage of every thread, projected from client-wire
//! notifications during sync ingest. Accounting types and the price-table
//! contract live in `agent_core::usage`; prices come from the thread's own
//! provider's table (`UsagePricing::for_provider`), or from the cost the
//! provider reported itself (`codewideProviderCost`), and are never persisted.

use std::{collections::HashMap, sync::Arc};

use agent_core::{
    model::{ProviderCost, ProviderId},
    usage::{
        ModelPricing, PROVIDER_COST_FIELD, REQUEST_MODEL_FIELD, ReplayPricing, RequestUsage,
        TokenCounts, TurnUsageProjection, UsagePricing, UsageScopeProjection, UsageStatus,
        normalize_model, provider_reported_cost,
    },
};
use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::store::{IndexStore, StoreError};

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct PersistedThreadUsage {
    model: Option<String>,
    /// The thread's provider, once an event of its provider stream was seen.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    provider: Option<ProviderId>,
    total: TokenCounts,
    has_total: bool,
    turns: HashMap<String, PersistedTurnUsage>,
    /// The provider-reported cost of the latest usage update: a pricing
    /// input, carried by providers without a price table.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    provider_cost: Option<ProviderCost>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct PersistedTurnUsage {
    model: Option<String>,
    baseline: Option<TokenCounts>,
    total: TokenCounts,
    latest_request: TokenCounts,
    model_context_window: Option<u64>,
    // Missing in pre-migration records: their exact request boundaries cannot
    // be recovered from cumulative counters alone.
    requests: Option<Vec<RequestUsage>>,
    status: UsageStatus,
    /// The provider-reported cost of this turn, when the provider sent one.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    provider_cost: Option<ProviderCost>,
}

pub struct LiveUsageProjector {
    store: Arc<IndexStore>,
    pricing: UsagePricing,
    threads: HashMap<String, PersistedThreadUsage>,
}

impl LiveUsageProjector {
    #[must_use]
    pub fn new(store: Arc<IndexStore>, pricing: UsagePricing) -> Self {
        Self {
            store,
            pricing,
            threads: HashMap::new(),
        }
    }

    /// Records that `payload` came from `provider`'s event stream, so its
    /// thread is priced only by that provider's table. The record is kept
    /// with the thread's usage state when [`Self::observe`] next writes it.
    ///
    /// # Errors
    ///
    /// Returns an error when the durable usage state cannot be read.
    pub fn observe_provider(
        &mut self,
        payload: &Value,
        provider: &ProviderId,
    ) -> Result<(), StoreError> {
        let Some(thread_id) = payload_thread_id(payload) else {
            return Ok(());
        };
        if let Some(state) = self.threads.get_mut(thread_id) {
            if state.provider.as_ref() != Some(provider) {
                state.provider = Some(provider.clone());
            }
            return Ok(());
        }
        let mut state = self.load(thread_id)?;
        state.provider = Some(provider.clone());
        self.threads.insert(thread_id.to_owned(), state);
        Ok(())
    }

    /// Observes one App Server notification and returns a backend-owned usage
    /// projection when that notification changes the visible usage state.
    ///
    /// # Errors
    ///
    /// Returns an error when the durable usage state cannot be read or committed.
    #[allow(clippy::too_many_lines)]
    pub fn observe(&mut self, payload: &Value) -> Result<Option<Value>, StoreError> {
        let Some(method) = payload.get("method").and_then(Value::as_str) else {
            return Ok(None);
        };
        let Some(params) = payload.get("params").and_then(Value::as_object) else {
            return Ok(None);
        };
        let Some(thread_id) = params
            .get("threadId")
            .and_then(Value::as_str)
            .or_else(|| params.get("thread")?.get("id")?.as_str())
        else {
            return Ok(None);
        };
        let mut state = self.load(thread_id)?;
        let pricing = self.pricing.for_provider(state.provider.as_ref());
        let mut projection = None;
        match method {
            "thread/started" => {
                if let Some(model) = params
                    .get("thread")
                    .and_then(|thread| thread.get("model"))
                    .and_then(Value::as_str)
                {
                    state.model = Some(normalize_model(model));
                }
            }
            "thread/settings/updated" => {
                if let Some(model) = params
                    .get("threadSettings")
                    .and_then(|value| value.get("model"))
                    .and_then(Value::as_str)
                {
                    state.model = Some(normalize_model(model));
                }
            }
            "turn/started" => {
                if let Some(turn_id) = params
                    .get("turn")
                    .and_then(|value| value.get("id"))
                    .and_then(Value::as_str)
                {
                    state
                        .turns
                        .entry(turn_id.to_owned())
                        .or_insert_with(|| PersistedTurnUsage {
                            model: state.model.clone(),
                            baseline: state.has_total.then_some(state.total),
                            total: state.total,
                            latest_request: TokenCounts::default(),
                            model_context_window: None,
                            requests: Some(Vec::new()),
                            status: UsageStatus::Live,
                            provider_cost: None,
                        });
                }
            }
            "model/rerouted" => {
                if let (Some(turn_id), Some(model)) = (
                    params.get("turnId").and_then(Value::as_str),
                    params.get("toModel").and_then(Value::as_str),
                ) {
                    state
                        .turns
                        .entry(turn_id.to_owned())
                        .or_insert_with(|| PersistedTurnUsage {
                            model: state.model.clone(),
                            baseline: state.has_total.then_some(state.total),
                            total: state.total,
                            latest_request: TokenCounts::default(),
                            model_context_window: None,
                            requests: Some(Vec::new()),
                            status: UsageStatus::Live,
                            provider_cost: None,
                        })
                        .model = Some(normalize_model(model));
                }
            }
            "thread/tokenUsage/updated" => {
                if let (Some(turn_id), Some(raw_usage)) = (
                    params.get("turnId").and_then(Value::as_str),
                    params.get("tokenUsage"),
                ) && let Some((total, last, model_context_window)) = parse_live_usage(raw_usage)
                {
                    let turn = state.turns.entry(turn_id.to_owned()).or_insert_with(|| {
                        PersistedTurnUsage {
                            model: state.model.clone(),
                            baseline: Some(total.saturating_sub(last)),
                            total,
                            latest_request: last,
                            model_context_window,
                            requests: None,
                            status: UsageStatus::Live,
                            provider_cost: None,
                        }
                    });
                    let is_new_request = total != turn.total;
                    let baseline = turn
                        .baseline
                        .get_or_insert_with(|| total.saturating_sub(last));
                    if !total.is_monotonic_from(*baseline) {
                        turn.baseline = Some(total.saturating_sub(last));
                        turn.requests = None;
                    }
                    let request_model = params
                        .get(REQUEST_MODEL_FIELD)
                        .and_then(Value::as_str)
                        .or(turn.model.as_deref())
                        .or(state.model.as_deref());
                    if is_new_request {
                        if let (Some(requests), Some(model)) =
                            (turn.requests.as_mut(), request_model)
                        {
                            requests.push(RequestUsage {
                                model: normalize_model(model),
                                tokens: last,
                            });
                        } else {
                            turn.requests = None;
                        }
                    }
                    let provider_cost = params
                        .get(PROVIDER_COST_FIELD)
                        .cloned()
                        .and_then(|cost| serde_json::from_value::<ProviderCost>(cost).ok());
                    turn.total = total;
                    turn.latest_request = last;
                    turn.model_context_window = model_context_window;
                    turn.provider_cost.clone_from(&provider_cost);
                    state.total = total;
                    state.has_total = true;
                    state.provider_cost = provider_cost;
                    projection = Some(project(&state, turn_id, &pricing));
                }
            }
            "turn/completed" => {
                if let Some(turn_id) = params
                    .get("turn")
                    .and_then(|value| value.get("id"))
                    .and_then(Value::as_str)
                    .or_else(|| params.get("turnId").and_then(Value::as_str))
                    && let Some(turn) = state.turns.get_mut(turn_id)
                {
                    turn.status = UsageStatus::Final;
                    projection = Some(project(&state, turn_id, &pricing));
                }
            }
            _ => return Ok(None),
        }
        self.store.put_thread_usage(thread_id, &state)?;
        self.threads.insert(thread_id.to_owned(), state);
        projection
            .map(serde_json::to_value)
            .transpose()
            .map_err(StoreError::from)
    }

    fn load(&self, thread_id: &str) -> Result<PersistedThreadUsage, StoreError> {
        if let Some(state) = self.threads.get(thread_id) {
            return Ok(state.clone());
        }
        self.store
            .thread_usage::<PersistedThreadUsage>(thread_id)
            .map(Option::unwrap_or_default)
    }

    /// Captures only the token and model inputs required to reprice one replay
    /// notification. The durable journal must not contain a calculated price.
    pub(crate) fn replay_pricing(&self, payload: &Value) -> Option<Value> {
        let params = payload.get("params")?;
        let thread_id = params
            .get("threadId")
            .and_then(Value::as_str)
            .or_else(|| params.pointer("/thread/id").and_then(Value::as_str))?;
        let state = self.threads.get(thread_id)?;
        // A thread whose provider has no price table keeps no model inputs,
        // so no other provider's table can price it on replay.
        let priced = !self
            .pricing
            .for_provider(state.provider.as_ref())
            .is_empty();
        let turn_id = params
            .get("turnId")
            .and_then(Value::as_str)
            .or_else(|| params.pointer("/turn/id").and_then(Value::as_str));
        let turn = turn_id.and_then(|id| state.turns.get(id));
        let model = turn
            .and_then(|turn| turn.model.clone())
            .or_else(|| state.model.clone())
            .filter(|_| priced);
        let has_usage_projection = matches!(
            payload.get("method").and_then(Value::as_str),
            Some("thread/tokenUsage/updated" | "turn/completed")
        );
        let pricing = ReplayPricing {
            model: model.clone(),
            thread_model: has_usage_projection.then_some(model).flatten(),
            turn_requests: has_usage_projection
                .then(|| turn.and_then(|turn| turn.requests.clone()))
                .flatten()
                .filter(|_| priced),
            provider_cost: has_usage_projection
                .then(|| turn.and_then(|turn| turn.provider_cost.clone()))
                .flatten()
                .map(|cost| ProviderCost {
                    thread_usd: state
                        .provider_cost
                        .as_ref()
                        .and_then(|thread| thread.thread_usd),
                    ..cost
                }),
        };
        serde_json::to_value(pricing).ok()
    }

    /// The price tables that may price `payload`'s thread: its provider's
    /// table once the provider is known.
    pub(crate) fn thread_pricing(&self, payload: &Value) -> UsagePricing {
        let provider = payload_thread_id(payload)
            .and_then(|thread_id| self.threads.get(thread_id))
            .and_then(|state| state.provider.as_ref());
        self.pricing.for_provider(provider)
    }
}

fn payload_thread_id(payload: &Value) -> Option<&str> {
    let params = payload.get("params")?;
    params
        .get("threadId")
        .and_then(Value::as_str)
        .or_else(|| params.pointer("/thread/id").and_then(Value::as_str))
}

fn project(
    state: &PersistedThreadUsage,
    turn_id: &str,
    pricing: &UsagePricing,
) -> TurnUsageProjection {
    let turn = &state.turns[turn_id];
    let model = turn.model.as_deref().or(state.model.as_deref());
    let turn_tokens = turn.total.saturating_sub(
        turn.baseline
            .unwrap_or_else(|| turn.total.saturating_sub(turn.latest_request)),
    );
    TurnUsageProjection {
        version: 1,
        status: turn.status,
        model_context_window: turn.model_context_window,
        latest_request: turn.latest_request,
        turn: UsageScopeProjection {
            tokens: turn_tokens,
            cost: match &turn.provider_cost {
                Some(reported) => Some(provider_reported_cost(
                    reported,
                    reported.turn_usd,
                    turn_tokens,
                )),
                None => turn
                    .requests
                    .as_deref()
                    .and_then(|requests| pricing.requests_cost(requests)),
            },
        },
        thread: UsageScopeProjection {
            tokens: state.total,
            cost: match &state.provider_cost {
                Some(reported) => reported
                    .thread_usd
                    .map(|usd| provider_reported_cost(reported, usd, state.total)),
                None => state
                    .has_total
                    .then(|| model.and_then(|model| pricing.session_cost(model, state.total)))
                    .flatten(),
            },
        },
    }
}

fn parse_live_usage(value: &Value) -> Option<(TokenCounts, TokenCounts, Option<u64>)> {
    Some((
        TokenCounts::from_camel_case(value.get("total")?),
        TokenCounts::from_camel_case(value.get("last")?),
        value.get("modelContextWindow").and_then(Value::as_u64),
    ))
}

#[cfg(test)]
pub(crate) mod test_pricing {
    use agent_core::usage::{
        CostProjection, ModelPrice, ModelPricing, TokenCounts, normalize_model,
    };

    pub(crate) const TEST_PRICING_VERSION: &str = "test-pricing";

    /// A linear price table for tests: `model-a` and `model-b` are priced.
    pub(crate) struct TestPricing;

    fn price(model: &str) -> Option<ModelPrice> {
        match normalize_model(model).as_str() {
            "model-a" => Some(ModelPrice {
                input: 2.0,
                cached_input: 0.2,
                output: 10.0,
            }),
            "model-b" => Some(ModelPrice {
                input: 4.0,
                cached_input: 0.4,
                output: 20.0,
            }),
            _ => None,
        }
    }

    // WHY: test token counts are small integers that convert exactly.
    #[allow(clippy::cast_precision_loss)]
    fn usd(tokens: u64, per_million: f64) -> f64 {
        tokens as f64 * per_million / 1_000_000.0
    }

    impl ModelPricing for TestPricing {
        fn request_cost(&self, model: &str, usage: TokenCounts) -> Option<CostProjection> {
            let price = price(model)?;
            let input = usd(usage.input_tokens, price.input);
            let output = usd(usage.output_tokens, price.output);
            Some(CostProjection {
                model: normalize_model(model),
                pricing_version: TEST_PRICING_VERSION.into(),
                currency: "USD".into(),
                basis: "apiEquivalent".into(),
                price,
                uncached_input_tokens: usage.input_tokens,
                cached_input_tokens: 0,
                cache_write_input_tokens: 0,
                output_tokens: usage.output_tokens,
                cache_hit_percent: 0.0,
                uncached_input_cost_usd: input,
                cached_input_cost_usd: 0.0,
                cache_write_input_cost_usd: 0.0,
                output_cost_usd: output,
                total_cost_usd: input + output,
            })
        }

        fn session_cost(&self, model: &str, usage: TokenCounts) -> Option<CostProjection> {
            self.request_cost(model, usage)
        }

        fn input_price(&self, model: &str) -> Option<f64> {
            price(model).map(|price| price.input)
        }
    }
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use agent_core::usage::{UsagePricing, prepare_replay_payload, price_replay_payload};
    use serde_json::json;

    use super::*;
    use test_pricing::{TEST_PRICING_VERSION, TestPricing};

    fn pricing() -> UsagePricing {
        UsagePricing::new(vec![Arc::new(TestPricing)])
    }

    #[test]
    fn live_projection_survives_a_companion_restart() -> Result<(), Box<dyn std::error::Error>> {
        let directory = tempfile::tempdir()?;
        let store = Arc::new(IndexStore::open(directory.path().join("index.redb"))?);
        let mut projector = LiveUsageProjector::new(store.clone(), pricing());
        projector.observe(&json!({
            "method": "thread/settings/updated",
            "params": {"threadId": "thread", "threadSettings": {"model": "model-b"}}
        }))?;
        projector.observe(&json!({
            "method": "turn/started",
            "params": {"threadId": "thread", "turn": {"id": "turn"}}
        }))?;
        let Some(first) = projector.observe(&live_usage_event(12, 12))? else {
            return Err("first usage projection is missing".into());
        };
        assert_eq!(first["turn"]["tokens"]["totalTokens"], 12);
        assert_eq!(first["thread"]["tokens"]["totalTokens"], 12);
        assert!(
            first["thread"]["cost"]["totalCostUsd"]
                .as_f64()
                .is_some_and(|cost| cost > 0.0)
        );
        let stored: Value = store.thread_usage("thread")?.ok_or("usage state missing")?;
        assert!(stored.get("threadCost").is_none());
        assert!(stored["turns"]["turn"].get("cost").is_none());
        assert_eq!(stored["turns"]["turn"]["requests"][0]["model"], "model-b");

        drop(projector);
        let mut restarted = LiveUsageProjector::new(store, pricing());
        let Some(second) = restarted.observe(&live_usage_event(30, 18))? else {
            return Err("second usage projection is missing".into());
        };
        assert_eq!(second["turn"]["tokens"]["totalTokens"], 30);
        assert!(
            second["thread"]["cost"]["totalCostUsd"]
                .as_f64()
                .is_some_and(|cost| cost > 0.0)
        );
        assert!(
            second["turn"]["cost"]["totalCostUsd"]
                .as_f64()
                .unwrap_or_default()
                > 0.0
        );
        let Some(final_projection) = restarted.observe(&json!({
            "method": "turn/completed",
            "params": {"threadId": "thread", "turn": {"id": "turn"}}
        }))?
        else {
            return Err("final usage projection is missing".into());
        };
        assert_eq!(final_projection["status"], "final");
        Ok(())
    }

    #[test]
    fn replay_journal_stores_only_pricing_inputs_and_reprices_on_delivery()
    -> Result<(), Box<dyn std::error::Error>> {
        let directory = tempfile::tempdir()?;
        let store = Arc::new(IndexStore::open(directory.path().join("index.redb"))?);
        let mut projector = LiveUsageProjector::new(store, pricing());
        projector.observe(&json!({
            "method": "thread/settings/updated",
            "params": {"threadId": "thread", "threadSettings": {"model": "model-a"}}
        }))?;
        projector.observe(&json!({
            "method": "turn/started",
            "params": {"threadId": "thread", "turn": {"id": "turn"}}
        }))?;
        let event = live_usage_event(12, 12);
        let usage = projector.observe(&event)?.ok_or("usage missing")?;
        let replay_pricing = projector.replay_pricing(&event);
        let payload = json!({
            "method": "thread/tokenUsage/updated",
            "params": {"threadId": "thread", "turnId": "turn",
                "codewideOutputFootprint": {"basis": "approxBytesPerToken",
                    "estimatedTokens": 1_000, "estimatedInputCostUsd": 999.0}},
            "codewideThreadPatch": {"operation": {"usage": usage}}
        });
        let stored = prepare_replay_payload(payload, replay_pricing);
        let operation = &stored["codewideThreadPatch"]["operation"];
        assert!(operation["usage"]["turn"]["cost"].is_null());
        assert!(operation["usage"]["thread"]["cost"].is_null());
        assert!(stored["params"]["codewideOutputFootprint"]["estimatedInputCostUsd"].is_null());
        let encoded = serde_json::to_string(&stored)?;
        assert!(!encoded.contains("totalCostUsd"));
        assert!(!encoded.contains("\"price\""));
        let delivered = price_replay_payload(stored, &pricing());
        assert!(delivered.get("codewideReplayPricing").is_none());
        assert_eq!(
            delivered["codewideThreadPatch"]["operation"]["usage"]["turn"]["cost"]["price"]["input"],
            2.0
        );
        assert_eq!(
            delivered["params"]["codewideOutputFootprint"]["estimatedInputCostUsd"],
            0.002
        );
        let legacy = json!({"codewideThreadPatch": {"operation": {"usage": {
            "turn": {"tokens": TokenCounts::default(), "cost": {"totalCostUsd": 999.0}},
            "thread": {"tokens": TokenCounts::default(), "cost": {"totalCostUsd": 999.0}}
        }}}});
        let legacy = price_replay_payload(legacy, &pricing());
        assert!(legacy["codewideThreadPatch"]["operation"]["usage"]["turn"]["cost"].is_null());
        assert!(legacy["codewideThreadPatch"]["operation"]["usage"]["thread"]["cost"].is_null());
        Ok(())
    }

    #[test]
    fn started_thread_model_prices_new_turn_without_a_settings_event()
    -> Result<(), Box<dyn std::error::Error>> {
        let directory = tempfile::tempdir()?;
        let store = Arc::new(IndexStore::open(directory.path().join("index.redb"))?);
        let mut projector = LiveUsageProjector::new(store, pricing());
        projector.observe(&json!({
            "method": "thread/started",
            "params": {"thread": {"id": "thread", "model": "model-a", "reasoningEffort": "high"}}
        }))?;
        projector.observe(&json!({
            "method": "turn/started",
            "params": {"threadId": "thread", "turn": {"id": "turn"}}
        }))?;
        let projection = projector
            .observe(&live_usage_event(12, 12))?
            .ok_or("usage projection missing")?;
        assert_eq!(projection["turn"]["cost"]["model"], "model-a");
        assert_eq!(projection["turn"]["cost"]["price"]["input"], 2.0);
        Ok(())
    }

    #[test]
    fn legacy_cached_prices_are_ignored_and_removed_on_next_write()
    -> Result<(), Box<dyn std::error::Error>> {
        let directory = tempfile::tempdir()?;
        let store = Arc::new(IndexStore::open(directory.path().join("index.redb"))?);
        let total = TokenCounts {
            total_tokens: 1_100,
            input_tokens: 1_000,
            output_tokens: 100,
            ..TokenCounts::default()
        };
        store.put_thread_usage(
            "thread",
            &json!({
                "model": "model-a",
                "total": total,
                "hasTotal": true,
                "threadCost": {"totalCostUsd": 999.0},
                "threadCostComplete": true,
                "turns": {"turn": {
                    "model": "model-a",
                    "baseline": TokenCounts::default(),
                    "total": total,
                    "latestRequest": total,
                    "modelContextWindow": 272_000,
                    "cost": {"totalCostUsd": 999.0},
                    "status": "live"
                }}
            }),
        )?;
        let mut projector = LiveUsageProjector::new(store.clone(), pricing());
        let projection = projector
            .observe(&json!({
                "method": "turn/completed",
                "params": {"threadId": "thread", "turn": {"id": "turn"}}
            }))?
            .ok_or("final usage projection missing")?;
        assert!(projection["turn"]["cost"].is_null());
        assert_eq!(
            projection["thread"]["cost"]["pricingVersion"],
            TEST_PRICING_VERSION
        );
        let stored: Value = store.thread_usage("thread")?.ok_or("usage state missing")?;
        assert!(stored.get("threadCost").is_none());
        assert!(stored["turns"]["turn"].get("cost").is_none());
        Ok(())
    }

    fn provider_pricing() -> UsagePricing {
        UsagePricing::by_provider(vec![(
            ProviderId::from_static("codex"),
            Arc::new(TestPricing),
        )])
    }

    fn started(
        projector: &mut LiveUsageProjector,
        provider: &'static str,
    ) -> Result<(), StoreError> {
        let thread = json!({"method": "thread/started", "params": {"thread": {"id": "thread", "model": "model-a"}}});
        projector.observe_provider(&thread, &ProviderId::from_static(provider))?;
        projector.observe(&thread)?;
        projector.observe(&json!({
            "method": "turn/started",
            "params": {"threadId": "thread", "turn": {"id": "turn"}}
        }))?;
        Ok(())
    }

    #[test]
    fn a_thread_is_priced_only_by_its_own_providers_table() -> Result<(), Box<dyn std::error::Error>>
    {
        let directory = tempfile::tempdir()?;
        let store = Arc::new(IndexStore::open(directory.path().join("index.redb"))?);
        let mut codex = LiveUsageProjector::new(store, provider_pricing());
        started(&mut codex, "codex")?;
        let priced = codex
            .observe(&live_usage_event(12, 12))?
            .ok_or("usage missing")?;
        assert_eq!(priced["turn"]["cost"]["model"], "model-a");

        let directory = tempfile::tempdir()?;
        let store = Arc::new(IndexStore::open(directory.path().join("index.redb"))?);
        let mut claude = LiveUsageProjector::new(store, provider_pricing());
        // The model name is in another provider's table; it must not price this thread.
        started(&mut claude, "claude")?;
        let unpriced = claude
            .observe(&live_usage_event(12, 12))?
            .ok_or("usage missing")?;
        assert!(unpriced["turn"]["cost"].is_null());
        assert!(unpriced["thread"]["cost"].is_null());
        let replay = claude
            .replay_pricing(&live_usage_event(12, 12))
            .ok_or("replay pricing missing")?;
        assert!(replay["model"].is_null());
        assert!(replay["turnRequests"].is_null());
        assert!(claude.thread_pricing(&live_usage_event(12, 12)).is_empty());
        Ok(())
    }

    #[test]
    fn a_provider_reported_cost_prices_the_turn_and_thread_and_survives_replay()
    -> Result<(), Box<dyn std::error::Error>> {
        let directory = tempfile::tempdir()?;
        let store = Arc::new(IndexStore::open(directory.path().join("index.redb"))?);
        let mut projector = LiveUsageProjector::new(store.clone(), provider_pricing());
        started(&mut projector, "claude")?;
        let mut event = live_usage_event(30, 18);
        event["params"][PROVIDER_COST_FIELD] = json!({"basis": "list", "model": "claude-sonnet-4-6", "turnUsd": 0.02, "threadUsd": 0.05});
        let usage = projector.observe(&event)?.ok_or("usage missing")?;
        assert_eq!(usage["turn"]["cost"]["basis"], "providerReported");
        assert_eq!(usage["turn"]["cost"]["model"], "claude-sonnet-4-6");
        assert_eq!(usage["turn"]["cost"]["totalCostUsd"], 0.02);
        assert_eq!(usage["thread"]["cost"]["totalCostUsd"], 0.05);

        let replay_pricing = projector.replay_pricing(&event);
        let payload = json!({
            "method": "thread/tokenUsage/updated",
            "params": {"threadId": "thread", "turnId": "turn"},
            "codewideThreadPatch": {"operation": {"usage": usage}}
        });
        let stored = prepare_replay_payload(payload, replay_pricing);
        assert!(!serde_json::to_string(&stored)?.contains("totalCostUsd"));
        // Any provider's table may reprice the journal: the reported cost wins.
        let delivered = price_replay_payload(stored, &provider_pricing());
        let replayed = &delivered["codewideThreadPatch"]["operation"]["usage"];
        assert_eq!(replayed["turn"]["cost"]["totalCostUsd"], 0.02);
        assert_eq!(replayed["thread"]["cost"]["totalCostUsd"], 0.05);

        // The final projection after a restart keeps the reported cost.
        drop(projector);
        let mut restarted = LiveUsageProjector::new(store, provider_pricing());
        let final_projection = restarted
            .observe(&json!({
                "method": "turn/completed",
                "params": {"threadId": "thread", "turn": {"id": "turn"}}
            }))?
            .ok_or("final usage missing")?;
        assert_eq!(final_projection["turn"]["cost"]["totalCostUsd"], 0.02);
        Ok(())
    }

    #[test]
    fn a_reported_request_model_prices_the_request() -> Result<(), Box<dyn std::error::Error>> {
        let directory = tempfile::tempdir()?;
        let store = Arc::new(IndexStore::open(directory.path().join("index.redb"))?);
        let mut projector = LiveUsageProjector::new(store, pricing());
        // The selected model is an alias no table prices.
        projector.observe(&json!({
            "method": "thread/settings/updated",
            "params": {"threadId": "thread", "threadSettings": {"model": "alias"}}
        }))?;
        projector.observe(&json!({
            "method": "turn/started",
            "params": {"threadId": "thread", "turn": {"id": "turn"}}
        }))?;
        let unnamed = projector
            .observe(&live_usage_event(12, 12))?
            .ok_or("usage missing")?;
        assert!(unnamed["turn"]["cost"].is_null());
        let mut named = live_usage_event(30, 18);
        named["params"][REQUEST_MODEL_FIELD] = json!("model-a");
        let priced = projector.observe(&named)?.ok_or("usage missing")?;
        // Only requests of a known model are priced; an unnamed one leaves the turn unpriced.
        assert!(priced["turn"]["cost"].is_null());

        projector.observe(&json!({
            "method": "turn/started",
            "params": {"threadId": "thread", "turn": {"id": "next"}}
        }))?;
        let mut first = live_usage_event(45, 15);
        first["params"]["turnId"] = json!("next");
        first["params"][REQUEST_MODEL_FIELD] = json!("model-a");
        let usage = projector.observe(&first)?.ok_or("usage missing")?;
        assert_eq!(usage["turn"]["cost"]["model"], "model-a");
        assert!(
            usage["turn"]["cost"]["totalCostUsd"]
                .as_f64()
                .is_some_and(|cost| cost > 0.0)
        );
        Ok(())
    }

    fn live_usage_event(total: u64, last: u64) -> Value {
        json!({
            "method": "thread/tokenUsage/updated",
            "params": {
                "threadId": "thread",
                "turnId": "turn",
                "tokenUsage": {
                    "total": {"totalTokens": total, "inputTokens": total - 2, "cachedInputTokens": 0, "cacheWriteInputTokens": 0, "outputTokens": 2, "reasoningOutputTokens": 0},
                    "last": {"totalTokens": last, "inputTokens": last - 2, "cachedInputTokens": 0, "cacheWriteInputTokens": 0, "outputTokens": 2, "reasoningOutputTokens": 0},
                    "modelContextWindow": 258_400
                }
            }
        })
    }
}
