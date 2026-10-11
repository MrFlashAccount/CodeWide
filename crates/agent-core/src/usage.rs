//! Provider-neutral token accounting and the price-table contract.
//!
//! The companion projects token usage for every thread. Prices are owned by
//! the provider whose models they describe: a provider declares its table
//! through [`ModelPricing`] (see `AgentProvider::usage_pricing`), and a model
//! that no table prices stays unpriced. Persisted usage and the replay journal
//! never contain a calculated price; prices are derived on delivery.

use std::collections::HashMap;
use std::sync::{Arc, RwLock};

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::model::{
    ModelPriceEntry, ProviderCost, ProviderCostBasis, ProviderId, TokenUsage, TurnUsageRecord,
};

/// `CostProjection::basis` of a cost the provider computed itself (for
/// example, the Claude Agent SDK). It carries only a total: the price and
/// per-component costs are zero, and `pricing_version` names the provider's
/// price table (`list` or `managed`).
pub const PROVIDER_REPORTED_BASIS: &str = "providerReported";

/// Client-wire field of `thread/tokenUsage/updated` params that carries a
/// provider-reported cost ([`ProviderCost`]). Present only when the provider
/// reported one, so a Codex stream never carries it.
pub const PROVIDER_COST_FIELD: &str = "codewideProviderCost";

/// Client-wire field of `thread/tokenUsage/updated` params that names the
/// model of the `last` request, when the provider reported it. It prices the
/// request instead of the thread's selected model (an alias, or another model
/// the provider routed the request to).
pub const REQUEST_MODEL_FIELD: &str = "codewideRequestModel";

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

    /// Counters of a neutral [`TokenUsage`]; negative counters read as zero.
    #[must_use]
    pub fn from_usage(usage: &TokenUsage) -> Self {
        let count = |value: i64| u64::try_from(value).unwrap_or(0);
        Self {
            total_tokens: count(usage.total_tokens),
            input_tokens: count(usage.input_tokens),
            cached_input_tokens: count(usage.cached_input_tokens),
            cache_write_input_tokens: count(usage.cache_write_input_tokens.unwrap_or(0)),
            output_tokens: count(usage.output_tokens),
            reasoning_output_tokens: count(usage.reasoning_output_tokens),
        }
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
    /// The provider-reported cost of the notification's turn and thread, a
    /// pricing input of providers without a price table.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub provider_cost: Option<ProviderCost>,
}

impl TurnUsageProjection {
    /// The final projection of a turn usage record a provider kept for a
    /// finished turn (history reads). Costs come only from the record's
    /// provider-reported cost.
    #[must_use]
    pub fn from_record(record: &TurnUsageRecord) -> Self {
        let turn = TokenCounts::from_usage(&record.turn);
        let thread = TokenCounts::from_usage(&record.total);
        let cost = record.cost.as_ref();
        Self {
            version: 1,
            status: UsageStatus::Final,
            model_context_window: record
                .context_window
                .and_then(|window| u64::try_from(window).ok()),
            latest_request: TokenCounts::from_usage(&record.last),
            turn: UsageScopeProjection {
                tokens: turn,
                cost: cost.map(|cost| provider_reported_cost(cost, cost.turn_usd, turn)),
            },
            thread: UsageScopeProjection {
                tokens: thread,
                cost: cost.and_then(|cost| {
                    cost.thread_usd
                        .map(|usd| provider_reported_cost(cost, usd, thread))
                }),
            },
        }
    }
}

/// A provider-reported cost of `tokens`: only the total is known, so the
/// price and per-component costs are zero (see [`PROVIDER_REPORTED_BASIS`]).
#[must_use]
pub fn provider_reported_cost(
    cost: &ProviderCost,
    usd: f64,
    tokens: TokenCounts,
) -> CostProjection {
    let cached = tokens.cached_input_tokens.min(tokens.input_tokens);
    let cache_write = tokens
        .cache_write_input_tokens
        .min(tokens.input_tokens.saturating_sub(cached));
    CostProjection {
        model: cost.model.clone(),
        pricing_version: match cost.basis {
            ProviderCostBasis::List => "list".into(),
            ProviderCostBasis::Managed => "managed".into(),
        },
        currency: "USD".into(),
        basis: PROVIDER_REPORTED_BASIS.into(),
        price: ModelPrice {
            input: 0.0,
            cached_input: 0.0,
            output: 0.0,
        },
        uncached_input_tokens: tokens
            .input_tokens
            .saturating_sub(cached)
            .saturating_sub(cache_write),
        cached_input_tokens: cached,
        cache_write_input_tokens: cache_write,
        output_tokens: tokens.output_tokens,
        cache_hit_percent: cache_hit_percent(cached, tokens.input_tokens),
        uncached_input_cost_usd: 0.0,
        cached_input_cost_usd: 0.0,
        cache_write_input_cost_usd: 0.0,
        output_cost_usd: 0.0,
        total_cost_usd: usd,
    }
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

/// `CostProjection::basis` of a cost the companion computed from a model's
/// API list rates.
pub const API_EQUIVALENT_BASIS: &str = "apiEquivalent";

/// A price table of model ids → API list rates, shared by every provider: a
/// provider publishes its rates with its model catalog (or declares them
/// statically), and costs are computed here from the rates alone.
#[derive(Default)]
pub struct CatalogPricing {
    prices: RwLock<HashMap<String, ModelPriceEntry>>,
}

impl CatalogPricing {
    /// A table of `prices`; model ids are normalized ([`normalize_model`]).
    #[must_use]
    pub fn new(prices: impl IntoIterator<Item = (String, ModelPriceEntry)>) -> Self {
        let table = Self::default();
        table.replace(prices);
        table
    }

    /// Replaces the whole table, as the provider's latest catalog states it.
    pub fn replace(&self, prices: impl IntoIterator<Item = (String, ModelPriceEntry)>) {
        let prices = prices
            .into_iter()
            .map(|(model, price)| (normalize_model(&model), price))
            .collect();
        // A poisoned lock still holds the previous complete table.
        match self.prices.write() {
            Ok(mut current) => *current = prices,
            Err(poisoned) => *poisoned.into_inner() = prices,
        }
    }

    /// Whether no model is priced yet.
    #[must_use]
    pub fn is_empty(&self) -> bool {
        match self.prices.read() {
            Ok(prices) => prices.is_empty(),
            Err(poisoned) => poisoned.into_inner().is_empty(),
        }
    }

    fn price(&self, model: &str) -> Option<ModelPriceEntry> {
        let prices = match self.prices.read() {
            Ok(prices) => prices,
            Err(poisoned) => poisoned.into_inner(),
        };
        prices.get(&normalize_model(model)).cloned()
    }
}

impl ModelPricing for CatalogPricing {
    fn request_cost(&self, model: &str, usage: TokenCounts) -> Option<CostProjection> {
        let price = self.price(model)?;
        Some(rates_cost(model, &price, usage, true))
    }

    fn session_cost(&self, model: &str, usage: TokenCounts) -> Option<CostProjection> {
        // Cumulative counters do not preserve the request boundaries needed to
        // apply long-context rates, so the aggregate is priced at base rates.
        let price = self.price(model)?;
        Some(rates_cost(model, &price, usage, false))
    }

    fn input_price(&self, model: &str) -> Option<f64> {
        self.price(model).map(|price| price.rates.input)
    }
}

/// The cost of `usage` at `price`. A single request whose input exceeds the
/// long-context threshold is priced at the long-context rates when
/// `request_boundaries` is true.
#[must_use]
pub fn rates_cost(
    model: &str,
    price: &ModelPriceEntry,
    usage: TokenCounts,
    request_boundaries: bool,
) -> CostProjection {
    let rates = price
        .long_context
        .filter(|long| request_boundaries && usage.input_tokens > long.above_input_tokens)
        .map_or(price.rates, |long| long.rates);
    let cached = usage.cached_input_tokens.min(usage.input_tokens);
    let cache_write = usage
        .cache_write_input_tokens
        .min(usage.input_tokens.saturating_sub(cached));
    let uncached = usage
        .input_tokens
        .saturating_sub(cached)
        .saturating_sub(cache_write);
    let uncached_cost = usd(uncached, rates.input);
    let cached_cost = usd(cached, rates.cached_input);
    let cache_write_cost = usd(cache_write, rates.cache_write_input);
    let output_cost = usd(usage.output_tokens, rates.output);
    CostProjection {
        model: normalize_model(model),
        pricing_version: price.pricing_version.clone(),
        currency: "USD".into(),
        basis: API_EQUIVALENT_BASIS.into(),
        price: ModelPrice {
            input: price.rates.input,
            cached_input: price.rates.cached_input,
            output: price.rates.output,
        },
        uncached_input_tokens: uncached,
        cached_input_tokens: cached,
        cache_write_input_tokens: cache_write,
        output_tokens: usage.output_tokens,
        cache_hit_percent: cache_hit_percent(cached, usage.input_tokens),
        uncached_input_cost_usd: uncached_cost,
        cached_input_cost_usd: cached_cost,
        cache_write_input_cost_usd: cache_write_cost,
        output_cost_usd: output_cost,
        total_cost_usd: uncached_cost + cached_cost + cache_write_cost + output_cost,
    }
}

// WHY: a display estimate; token counts far below 2^52 convert exactly.
#[allow(clippy::cast_precision_loss)]
fn usd(tokens: u64, dollars_per_million: f64) -> f64 {
    tokens as f64 * dollars_per_million / 1_000_000.0
}

/// One price table and the provider that owns it (`None` for a table of no
/// particular provider).
#[derive(Clone)]
struct PricingEntry {
    provider: Option<ProviderId>,
    table: Arc<dyn ModelPricing>,
}

/// The host's price tables in provider order: the first table that prices a
/// model answers for it. An empty set leaves every model unpriced. A thread
/// is priced only by its own provider's table ([`UsagePricing::for_provider`]),
/// so a model can never be priced by another provider's table.
#[derive(Clone, Default)]
pub struct UsagePricing {
    tables: Vec<PricingEntry>,
}

impl UsagePricing {
    /// Tables of no particular provider; [`UsagePricing::for_provider`] of
    /// any provider leaves them out.
    #[must_use]
    pub fn new(tables: Vec<Arc<dyn ModelPricing>>) -> Self {
        Self {
            tables: tables
                .into_iter()
                .map(|table| PricingEntry {
                    provider: None,
                    table,
                })
                .collect(),
        }
    }

    /// The enabled providers' tables in registry order.
    #[must_use]
    pub fn by_provider(tables: Vec<(ProviderId, Arc<dyn ModelPricing>)>) -> Self {
        Self {
            tables: tables
                .into_iter()
                .map(|(provider, table)| PricingEntry {
                    provider: Some(provider),
                    table,
                })
                .collect(),
        }
    }

    /// The tables a thread is priced by: its provider's table only, or every
    /// table while the thread's provider is unknown.
    #[must_use]
    pub fn for_provider(&self, provider: Option<&ProviderId>) -> Self {
        match provider {
            None => self.clone(),
            Some(provider) => Self {
                tables: self
                    .tables
                    .iter()
                    .filter(|entry| entry.provider.as_ref() == Some(provider))
                    .cloned()
                    .collect(),
            },
        }
    }

    /// Whether no table prices anything.
    #[must_use]
    pub fn is_empty(&self) -> bool {
        self.tables.is_empty()
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
            .find_map(|entry| entry.table.request_cost(model, usage))
    }

    fn session_cost(&self, model: &str, usage: TokenCounts) -> Option<CostProjection> {
        self.tables
            .iter()
            .find_map(|entry| entry.table.session_cost(model, usage))
    }

    fn input_price(&self, model: &str) -> Option<f64> {
        self.tables
            .iter()
            .find_map(|entry| entry.table.input_price(model))
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
                let provider_cost = pricing.and_then(|pricing| pricing.provider_cost.as_ref());
                if let Some(turn) = object.get_mut("turn").and_then(Value::as_object_mut) {
                    let cost = match provider_cost {
                        Some(reported) => scope_tokens(turn).map(|tokens| {
                            provider_reported_cost(reported, reported.turn_usd, tokens)
                        }),
                        None => pricing
                            .and_then(|pricing| pricing.turn_requests.as_deref())
                            .and_then(|requests| requests_cost(tables, requests)),
                    }
                    .and_then(|cost| serde_json::to_value(cost).ok())
                    .unwrap_or(Value::Null);
                    turn.insert("cost".into(), cost);
                }
                if let Some(thread) = object.get_mut("thread").and_then(Value::as_object_mut) {
                    let cost = match provider_cost {
                        Some(reported) => reported.thread_usd.and_then(|usd| {
                            scope_tokens(thread)
                                .map(|tokens| provider_reported_cost(reported, usd, tokens))
                        }),
                        None => pricing
                            .and_then(|pricing| pricing.thread_model.as_deref())
                            .and_then(|model| {
                                scope_tokens(thread)
                                    .and_then(|tokens| tables.session_cost(model, tokens))
                            }),
                    }
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

/// The token counters of one usage scope (`turn` or `thread`).
fn scope_tokens(scope: &serde_json::Map<String, Value>) -> Option<TokenCounts> {
    scope
        .get("tokens")
        .cloned()
        .and_then(|tokens| serde_json::from_value::<TokenCounts>(tokens).ok())
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

    fn catalog() -> CatalogPricing {
        let rates = |input: f64| crate::model::ModelRates {
            input,
            cached_input: input / 10.0,
            cache_write_input: input * 1.25,
            output: input * 5.0,
        };
        CatalogPricing::new([(
            " Claude-Haiku ".to_owned(),
            ModelPriceEntry {
                pricing_version: "test-api".into(),
                rates: rates(1.0),
                long_context: Some(crate::model::LongContextRates {
                    above_input_tokens: 1_000,
                    rates: rates(5.0),
                }),
            },
        )])
    }

    #[test]
    fn catalog_prices_each_token_kind_at_its_rate() -> Result<(), &'static str> {
        let usage = TokenCounts {
            total_tokens: 1_000_000,
            input_tokens: 800_000,
            cached_input_tokens: 400_000,
            cache_write_input_tokens: 200_000,
            output_tokens: 200_000,
            ..TokenCounts::default()
        };
        // Below the long-context threshold only when priced as an aggregate.
        let cost = catalog()
            .session_cost("claude-haiku", usage)
            .ok_or("model unpriced")?;
        assert_eq!(cost.basis, API_EQUIVALENT_BASIS);
        assert_eq!(cost.pricing_version, "test-api");
        assert_eq!(cost.uncached_input_tokens, 200_000);
        // 0.2M × $1 + 0.4M × $0.1 + 0.2M × $1.25 + 0.2M × $5.
        assert!((cost.total_cost_usd - 1.49).abs() < 1e-9);
        Ok(())
    }

    #[test]
    fn a_long_request_uses_the_long_context_rates() -> Result<(), &'static str> {
        let request = |input_tokens| TokenCounts {
            total_tokens: input_tokens,
            input_tokens,
            ..TokenCounts::default()
        };
        let table = catalog();
        let short = table
            .request_cost("CLAUDE-HAIKU", request(1_000))
            .ok_or("unpriced")?;
        let long = table
            .request_cost("claude-haiku", request(1_001))
            .ok_or("unpriced")?;
        assert!((short.total_cost_usd - 0.001).abs() < 1e-12);
        assert!((long.total_cost_usd - 0.005_005).abs() < 1e-12);
        assert!(table.request_cost("claude-opus", request(10)).is_none());
        table.replace(std::iter::empty());
        assert!(table.is_empty());
        Ok(())
    }
}
