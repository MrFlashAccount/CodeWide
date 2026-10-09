//! Provider-neutral token accounting and the price-table contract.
//!
//! The companion projects token usage for every thread. Prices are owned by
//! the provider whose models they describe: a provider declares its table
//! through [`ModelPricing`] (see `AgentProvider::usage_pricing`), and a model
//! that no table prices stays unpriced. Persisted usage and the replay journal
//! never contain a calculated price; prices are derived on delivery.

use std::sync::Arc;

use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Clone, Copy, Debug, Default, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TokenCounts {
    pub total_tokens: u64,
    pub input_tokens: u64,
    pub cached_input_tokens: u64,
    pub cache_write_input_tokens: u64,
    pub output_tokens: u64,
    pub reasoning_output_tokens: u64,
}

impl TokenCounts {
    #[must_use]
    pub fn saturating_sub(self, baseline: Self) -> Self {
        Self {
            total_tokens: self.total_tokens.saturating_sub(baseline.total_tokens),
            input_tokens: self.input_tokens.saturating_sub(baseline.input_tokens),
            cached_input_tokens: self
                .cached_input_tokens
                .saturating_sub(baseline.cached_input_tokens),
            cache_write_input_tokens: self
                .cache_write_input_tokens
                .saturating_sub(baseline.cache_write_input_tokens),
            output_tokens: self.output_tokens.saturating_sub(baseline.output_tokens),
            reasoning_output_tokens: self
                .reasoning_output_tokens
                .saturating_sub(baseline.reasoning_output_tokens),
        }
    }

    #[must_use]
    pub fn is_monotonic_from(self, baseline: Self) -> bool {
        self.total_tokens >= baseline.total_tokens
            && self.input_tokens >= baseline.input_tokens
            && self.cached_input_tokens >= baseline.cached_input_tokens
            && self.cache_write_input_tokens >= baseline.cache_write_input_tokens
            && self.output_tokens >= baseline.output_tokens
            && self.reasoning_output_tokens >= baseline.reasoning_output_tokens
    }

    /// Reads counters with camelCase field names (client-wire usage).
    /// Missing counters are zero.
    #[must_use]
    pub fn from_camel_case(value: &Value) -> Self {
        Self::read(value, |camel, _| camel)
    }

    /// Reads counters with `snake_case` field names (stored provider usage).
    /// Missing counters are zero.
    #[must_use]
    pub fn from_snake_case(value: &Value) -> Self {
        Self::read(value, |_, snake| snake)
    }

    fn read(value: &Value, field: fn(&'static str, &'static str) -> &'static str) -> Self {
        let get = |camel, snake| {
            value
                .get(field(camel, snake))
                .and_then(Value::as_u64)
                .unwrap_or(0)
        };
        Self {
            total_tokens: get("totalTokens", "total_tokens"),
            input_tokens: get("inputTokens", "input_tokens"),
            cached_input_tokens: get("cachedInputTokens", "cached_input_tokens"),
            cache_write_input_tokens: get("cacheWriteInputTokens", "cache_write_input_tokens"),
            output_tokens: get("outputTokens", "output_tokens"),
            reasoning_output_tokens: get("reasoningOutputTokens", "reasoning_output_tokens"),
        }
    }
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelPrice {
    pub input: f64,
    pub cached_input: f64,
    pub output: f64,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CostProjection {
    pub model: String,
    pub pricing_version: String,
    pub currency: String,
    pub basis: String,
    pub price: ModelPrice,
    pub uncached_input_tokens: u64,
    pub cached_input_tokens: u64,
    pub cache_write_input_tokens: u64,
    pub output_tokens: u64,
    pub cache_hit_percent: f64,
    pub uncached_input_cost_usd: f64,
    pub cached_input_cost_usd: f64,
    pub cache_write_input_cost_usd: f64,
    pub output_cost_usd: f64,
    pub total_cost_usd: f64,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UsageScopeProjection {
    pub tokens: TokenCounts,
    pub cost: Option<CostProjection>,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TurnUsageProjection {
    pub version: u8,
    pub status: UsageStatus,
    pub model_context_window: Option<u64>,
    pub latest_request: TokenCounts,
    pub turn: UsageScopeProjection,
    pub thread: UsageScopeProjection,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum UsageStatus {
    Live,
    Final,
}

/// One model request of a turn: the pricing input that survives restarts.
#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct RequestUsage {
    pub model: String,
    pub tokens: TokenCounts,
}

/// The token and model inputs required to reprice one replayed notification.
#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReplayPricing {
    pub model: Option<String>,
    pub thread_model: Option<String>,
    pub turn_requests: Option<Vec<RequestUsage>>,
}

/// A provider-owned price table. Model ids are compared after
/// [`normalize_model`].
pub trait ModelPricing: Send + Sync {
    /// The cost of one model request, or `None` when the model is unpriced.
    fn request_cost(&self, model: &str, usage: TokenCounts) -> Option<CostProjection>;

    /// The cost of cumulative usage whose request boundaries are unknown, or
    /// `None` when the model is unpriced.
    fn session_cost(&self, model: &str, usage: TokenCounts) -> Option<CostProjection>;

    /// The uncached input price in USD per million tokens.
    fn input_price(&self, model: &str) -> Option<f64>;
}

/// The host's price tables in provider order: the first table that prices a
/// model answers for it. An empty set leaves every model unpriced.
#[derive(Clone, Default)]
pub struct UsagePricing {
    tables: Vec<Arc<dyn ModelPricing>>,
}

impl UsagePricing {
    #[must_use]
    pub fn new(tables: Vec<Arc<dyn ModelPricing>>) -> Self {
        Self { tables }
    }

    /// The summed cost of every request, or `None` when any request is unpriced.
    #[must_use]
    pub fn requests_cost(&self, requests: &[RequestUsage]) -> Option<CostProjection> {
        requests_cost(self, requests)
    }
}

impl ModelPricing for UsagePricing {
    fn request_cost(&self, model: &str, usage: TokenCounts) -> Option<CostProjection> {
        self.tables
            .iter()
            .find_map(|table| table.request_cost(model, usage))
    }

    fn session_cost(&self, model: &str, usage: TokenCounts) -> Option<CostProjection> {
        self.tables
            .iter()
            .find_map(|table| table.session_cost(model, usage))
    }

    fn input_price(&self, model: &str) -> Option<f64> {
        self.tables
            .iter()
            .find_map(|table| table.input_price(model))
    }
}

/// The summed cost of every request, or `None` when any request is unpriced.
#[must_use]
pub fn requests_cost(
    pricing: &dyn ModelPricing,
    requests: &[RequestUsage],
) -> Option<CostProjection> {
    let mut total = None;
    for request in requests {
        let estimate = pricing.request_cost(&request.model, request.tokens)?;
        total = add_cost(total, Some(estimate));
    }
    total
}

#[must_use]
pub fn normalize_model(model: &str) -> String {
    model.trim().to_ascii_lowercase()
}

/// Sums two cost projections. Different models collapse into `"mixed"`.
#[must_use]
pub fn add_cost(
    left: Option<CostProjection>,
    right: Option<CostProjection>,
) -> Option<CostProjection> {
    match (left, right) {
        (None, value) | (value, None) => value,
        (Some(mut left), Some(right)) => {
            if left.model != right.model {
                left.model = "mixed".into();
                left.price = ModelPrice {
                    input: 0.0,
                    cached_input: 0.0,
                    output: 0.0,
                };
            }
            left.uncached_input_tokens = left
                .uncached_input_tokens
                .saturating_add(right.uncached_input_tokens);
            left.cached_input_tokens = left
                .cached_input_tokens
                .saturating_add(right.cached_input_tokens);
            left.cache_write_input_tokens = left
                .cache_write_input_tokens
                .saturating_add(right.cache_write_input_tokens);
            left.output_tokens = left.output_tokens.saturating_add(right.output_tokens);
            left.uncached_input_cost_usd += right.uncached_input_cost_usd;
            left.cached_input_cost_usd += right.cached_input_cost_usd;
            left.cache_write_input_cost_usd += right.cache_write_input_cost_usd;
            left.output_cost_usd += right.output_cost_usd;
            left.total_cost_usd += right.total_cost_usd;
            let total_input = left.uncached_input_tokens
                + left.cached_input_tokens
                + left.cache_write_input_tokens;
            left.cache_hit_percent = cache_hit_percent(left.cached_input_tokens, total_input);
            Some(left)
        }
    }
}

/// `part` as a percentage of `total`; zero for an empty total.
// WHY: a display percentage; token counts far below 2^52 convert exactly.
#[allow(clippy::cast_precision_loss)]
#[must_use]
pub fn cache_hit_percent(part: u64, total: u64) -> f64 {
    if total == 0 {
        0.0
    } else {
        part as f64 / total as f64 * 100.0
    }
}

/// Stores replay notifications without derived prices. A legacy journal entry
/// has no pricing inputs and is delivered without its stale cached prices.
#[must_use]
pub fn prepare_replay_payload(mut payload: Value, pricing: Option<Value>) -> Value {
    visit_pricing_fields(&mut payload, None, &UsagePricing::default());
    if let Some(pricing) = pricing
        && let Some(object) = payload.as_object_mut()
    {
        object.insert("codewideReplayPricing".into(), pricing);
    }
    payload
}

/// Prices one replayed notification from its stored pricing inputs.
#[must_use]
pub fn price_replay_payload(mut payload: Value, tables: &dyn ModelPricing) -> Value {
    let pricing = payload
        .as_object_mut()
        .and_then(|object| object.remove("codewideReplayPricing"))
        .and_then(|value| serde_json::from_value::<ReplayPricing>(value).ok());
    visit_pricing_fields(&mut payload, pricing.as_ref(), tables);
    payload
}

fn visit_pricing_fields(
    value: &mut Value,
    pricing: Option<&ReplayPricing>,
    tables: &dyn ModelPricing,
) {
    match value {
        Value::Array(values) => {
            for value in values {
                visit_pricing_fields(value, pricing, tables);
            }
        }
        Value::Object(object) => {
            if object
                .get("turn")
                .is_some_and(|turn| turn.get("tokens").is_some())
                && object
                    .get("thread")
                    .is_some_and(|thread| thread.get("tokens").is_some())
            {
                if let Some(turn) = object.get_mut("turn").and_then(Value::as_object_mut) {
                    let cost = pricing
                        .and_then(|pricing| pricing.turn_requests.as_deref())
                        .and_then(|requests| requests_cost(tables, requests))
                        .and_then(|cost| serde_json::to_value(cost).ok())
                        .unwrap_or(Value::Null);
                    turn.insert("cost".into(), cost);
                }
                if let Some(thread) = object.get_mut("thread").and_then(Value::as_object_mut) {
                    let cost = pricing
                        .and_then(|pricing| pricing.thread_model.as_deref())
                        .and_then(|model| {
                            thread
                                .get("tokens")
                                .cloned()
                                .and_then(|tokens| {
                                    serde_json::from_value::<TokenCounts>(tokens).ok()
                                })
                                .and_then(|tokens| tables.session_cost(model, tokens))
                        })
                        .and_then(|cost| serde_json::to_value(cost).ok())
                        .unwrap_or(Value::Null);
                    thread.insert("cost".into(), cost);
                }
            }
            if object.get("basis").and_then(Value::as_str) == Some("approxBytesPerToken") {
                let price = pricing
                    .and_then(|pricing| pricing.model.as_deref())
                    .and_then(|model| tables.input_price(model));
                let tokens = object.get("estimatedTokens").and_then(Value::as_u64);
                // WHY: the cost is a display estimate derived from the stored
                // token count and the current Companion model price.
                #[allow(clippy::cast_precision_loss)]
                let cost = tokens
                    .zip(price)
                    .map(|(tokens, price)| tokens as f64 * price / 1_000_000.0);
                object.insert("estimatedInputCostUsd".into(), serde_json::json!(cost));
            }
            for child in object.values_mut() {
                visit_pricing_fields(child, pricing, tables);
            }
        }
        _ => {}
    }
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    struct FlatPricing;

    impl ModelPricing for FlatPricing {
        fn request_cost(&self, model: &str, usage: TokenCounts) -> Option<CostProjection> {
            (normalize_model(model) == "priced").then(|| CostProjection {
                model: "priced".into(),
                pricing_version: "flat".into(),
                currency: "USD".into(),
                basis: "apiEquivalent".into(),
                price: ModelPrice {
                    input: 1.0,
                    cached_input: 1.0,
                    output: 1.0,
                },
                uncached_input_tokens: usage.input_tokens,
                cached_input_tokens: 0,
                cache_write_input_tokens: 0,
                output_tokens: usage.output_tokens,
                cache_hit_percent: 0.0,
                uncached_input_cost_usd: 1.0,
                cached_input_cost_usd: 0.0,
                cache_write_input_cost_usd: 0.0,
                output_cost_usd: 0.0,
                total_cost_usd: 1.0,
            })
        }

        fn session_cost(&self, model: &str, usage: TokenCounts) -> Option<CostProjection> {
            self.request_cost(model, usage)
        }

        fn input_price(&self, model: &str) -> Option<f64> {
            (normalize_model(model) == "priced").then_some(1.0)
        }
    }

    #[test]
    fn reads_camel_and_snake_case_counters() {
        let camel = TokenCounts::from_camel_case(&json!({"totalTokens": 3, "inputTokens": 2}));
        let snake = TokenCounts::from_snake_case(&json!({"total_tokens": 3, "input_tokens": 2}));
        assert_eq!(camel, snake);
        assert_eq!(camel.total_tokens, 3);
        assert_eq!(camel.output_tokens, 0);
    }

    #[test]
    fn a_turn_with_an_unpriced_request_has_no_cost() {
        let pricing = UsagePricing::new(vec![Arc::new(FlatPricing)]);
        let priced = RequestUsage {
            model: "Priced".into(),
            tokens: TokenCounts::default(),
        };
        let unpriced = RequestUsage {
            model: "other".into(),
            tokens: TokenCounts::default(),
        };
        let cost = pricing.requests_cost(&[priced.clone(), priced.clone()]);
        assert!(cost.is_some_and(|cost| (cost.total_cost_usd - 2.0).abs() < f64::EPSILON));
        assert!(pricing.requests_cost(&[priced, unpriced]).is_none());
        assert!(UsagePricing::default().input_price("priced").is_none());
    }

    #[test]
    fn mixed_models_collapse_into_one_mixed_cost() -> Result<(), &'static str> {
        let pricing = FlatPricing;
        let tokens = TokenCounts::default();
        let mut other = pricing.request_cost("priced", tokens).ok_or("priced")?;
        other.model = "other".into();
        let sum = add_cost(pricing.request_cost("priced", tokens), Some(other)).ok_or("sum")?;
        assert_eq!(sum.model, "mixed");
        assert!((sum.price.input).abs() < f64::EPSILON);
        Ok(())
    }
}
