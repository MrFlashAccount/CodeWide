//! Live token usage of every thread, projected from client-wire
//! notifications during sync ingest. Accounting types and the price-table
//! contract live in `agent_core::usage`; prices come from the enabled
//! providers' tables (`UsagePricing`) and are never persisted.

use std::{collections::HashMap, sync::Arc};

use agent_core::usage::{
    ModelPricing, ReplayPricing, RequestUsage, TokenCounts, TurnUsageProjection, UsagePricing,
    UsageScopeProjection, UsageStatus, normalize_model,
};
use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::store::{IndexStore, StoreError};

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct PersistedThreadUsage {
    model: Option<String>,
    total: TokenCounts,
    has_total: bool,
    turns: HashMap<String, PersistedTurnUsage>,
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
                    let request_model = turn.model.as_deref().or(state.model.as_deref());
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
                    turn.total = total;
                    turn.latest_request = last;
                    turn.model_context_window = model_context_window;
                    state.total = total;
                    state.has_total = true;
                    projection = Some(project(&state, turn_id, &self.pricing));
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
                    projection = Some(project(&state, turn_id, &self.pricing));
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
        let turn_id = params
            .get("turnId")
            .and_then(Value::as_str)
            .or_else(|| params.pointer("/turn/id").and_then(Value::as_str));
        let turn = turn_id.and_then(|id| state.turns.get(id));
        let model = turn
            .and_then(|turn| turn.model.clone())
            .or_else(|| state.model.clone());
        let has_usage_projection = matches!(
            payload.get("method").and_then(Value::as_str),
            Some("thread/tokenUsage/updated" | "turn/completed")
        );
        let pricing = ReplayPricing {
            model: model.clone(),
            thread_model: has_usage_projection.then_some(model).flatten(),
            turn_requests: has_usage_projection
                .then(|| turn.and_then(|turn| turn.requests.clone()))
                .flatten(),
        };
        serde_json::to_value(pricing).ok()
    }
}

fn project(
    state: &PersistedThreadUsage,
    turn_id: &str,
    pricing: &UsagePricing,
) -> TurnUsageProjection {
    let turn = &state.turns[turn_id];
    let model = turn.model.as_deref().or(state.model.as_deref());
    TurnUsageProjection {
        version: 1,
        status: turn.status,
        model_context_window: turn.model_context_window,
        latest_request: turn.latest_request,
        turn: UsageScopeProjection {
            tokens: turn.total.saturating_sub(
                turn.baseline
                    .unwrap_or_else(|| turn.total.saturating_sub(turn.latest_request)),
            ),
            cost: turn
                .requests
                .as_deref()
                .and_then(|requests| pricing.requests_cost(requests)),
        },
        thread: UsageScopeProjection {
            tokens: state.total,
            cost: state
                .has_total
                .then(|| model.and_then(|model| pricing.session_cost(model, state.total)))
                .flatten(),
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
