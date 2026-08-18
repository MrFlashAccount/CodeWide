use std::{collections::HashMap, sync::Arc};

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::store::{IndexStore, StoreError};

pub const PRICING_VERSION: &str = "openai-api-2026-08-17";
const LONG_CONTEXT_INPUT_TOKENS: u64 = 272_000;

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

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct PersistedThreadUsage {
    model: Option<String>,
    total: TokenCounts,
    has_total: bool,
    thread_cost: Option<CostProjection>,
    thread_cost_complete: bool,
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
    cost: Option<CostProjection>,
    status: UsageStatus,
}

pub struct LiveUsageProjector {
    store: Arc<IndexStore>,
    threads: HashMap<String, PersistedThreadUsage>,
}

impl LiveUsageProjector {
    #[must_use]
    pub fn new(store: Arc<IndexStore>) -> Self {
        Self {
            store,
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
                            cost: None,
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
                            cost: None,
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
                            cost: None,
                            status: UsageStatus::Live,
                        }
                    });
                    let is_new_request = total != turn.total;
                    let baseline = turn
                        .baseline
                        .get_or_insert_with(|| total.saturating_sub(last));
                    if !total.is_monotonic_from(*baseline) {
                        turn.baseline = Some(total.saturating_sub(last));
                        turn.cost = None;
                    }
                    turn.total = total;
                    turn.latest_request = last;
                    turn.model_context_window = model_context_window;
                    let session_model = turn.model.clone().or_else(|| state.model.clone());
                    if is_new_request || turn.cost.is_none() {
                        turn.cost = add_cost(
                            turn.cost.take(),
                            estimate_request_cost(turn.model.as_deref(), last),
                        );
                    }
                    // Session counters are authoritative even after the companion
                    // restarts midway through a thread. Price the cumulative
                    // counters as one API-equivalent estimate instead of exposing
                    // a partial sum of only the requests observed by this process.
                    state.thread_cost = estimate_session_cost(session_model.as_deref(), total);
                    state.thread_cost_complete = state.thread_cost.is_some();
                    state.total = total;
                    state.has_total = true;
                    projection = Some(project(&state, turn_id));
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
                    projection = Some(project(&state, turn_id));
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

    fn load(&mut self, thread_id: &str) -> Result<PersistedThreadUsage, StoreError> {
        if let Some(state) = self.threads.get(thread_id) {
            return Ok(state.clone());
        }
        self.store
            .thread_usage::<PersistedThreadUsage>(thread_id)
            .map(Option::unwrap_or_default)
    }
}

#[must_use]
pub fn projection_from_rollout(
    model: Option<&str>,
    baseline: TokenCounts,
    total: TokenCounts,
    latest_request: TokenCounts,
    requests: &[TokenCounts],
    model_context_window: Option<u64>,
    final_status: bool,
) -> TurnUsageProjection {
    let turn_tokens = total.saturating_sub(baseline);
    let turn_cost = requests.iter().copied().fold(None, |cost, request| {
        add_cost(cost, estimate_request_cost(model, request))
    });
    TurnUsageProjection {
        version: 1,
        status: if final_status {
            UsageStatus::Final
        } else {
            UsageStatus::Live
        },
        model_context_window,
        latest_request,
        turn: UsageScopeProjection {
            tokens: turn_tokens,
            cost: turn_cost,
        },
        thread: UsageScopeProjection {
            tokens: total,
            cost: estimate_session_cost(model, total),
        },
    }
}

#[must_use]
pub fn parse_rollout_usage(payload: &Value) -> Option<(TokenCounts, TokenCounts, Option<u64>)> {
    let info = payload.get("info")?;
    let total = parse_counts(info.get("total_token_usage")?, true);
    let last = parse_counts(info.get("last_token_usage")?, true);
    let context = info.get("model_context_window").and_then(Value::as_u64);
    Some((total, last, context))
}

fn parse_live_usage(value: &Value) -> Option<(TokenCounts, TokenCounts, Option<u64>)> {
    Some((
        parse_counts(value.get("total")?, false),
        parse_counts(value.get("last")?, false),
        value.get("modelContextWindow").and_then(Value::as_u64),
    ))
}

fn parse_counts(value: &Value, snake_case: bool) -> TokenCounts {
    let get = |camel: &str, snake: &str| {
        value
            .get(if snake_case { snake } else { camel })
            .and_then(Value::as_u64)
            .unwrap_or(0)
    };
    TokenCounts {
        total_tokens: get("totalTokens", "total_tokens"),
        input_tokens: get("inputTokens", "input_tokens"),
        cached_input_tokens: get("cachedInputTokens", "cached_input_tokens"),
        cache_write_input_tokens: get("cacheWriteInputTokens", "cache_write_input_tokens"),
        output_tokens: get("outputTokens", "output_tokens"),
        reasoning_output_tokens: get("reasoningOutputTokens", "reasoning_output_tokens"),
    }
}

fn project(state: &PersistedThreadUsage, turn_id: &str) -> TurnUsageProjection {
    let turn = &state.turns[turn_id];
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
            cost: turn.cost.clone(),
        },
        thread: UsageScopeProjection {
            tokens: state.total,
            cost: state
                .thread_cost_complete
                .then(|| state.thread_cost.clone())
                .flatten(),
        },
    }
}

fn normalize_model(model: &str) -> String {
    model.trim().to_ascii_lowercase()
}

fn price_for(model: &str) -> Option<ModelPrice> {
    match normalize_model(model).as_str() {
        "gpt-5.6" | "gpt-5.6-sol" => Some(ModelPrice {
            input: 5.0,
            cached_input: 0.5,
            output: 30.0,
        }),
        "gpt-5.6-terra" => Some(ModelPrice {
            input: 2.5,
            cached_input: 0.25,
            output: 15.0,
        }),
        "gpt-5.6-luna" => Some(ModelPrice {
            input: 1.0,
            cached_input: 0.1,
            output: 6.0,
        }),
        _ => None,
    }
}

fn estimate_request_cost(model: Option<&str>, usage: TokenCounts) -> Option<CostProjection> {
    estimate_cost(model, usage, true)
}

fn estimate_session_cost(model: Option<&str>, usage: TokenCounts) -> Option<CostProjection> {
    // Cumulative counters do not preserve the request boundaries needed to
    // reconstruct long-context multipliers. Keep the estimate deterministic
    // and price the aggregate at the selected model's base API rates.
    estimate_cost(model, usage, false)
}

fn estimate_cost(
    model: Option<&str>,
    usage: TokenCounts,
    apply_long_context_multiplier: bool,
) -> Option<CostProjection> {
    let model = normalize_model(model?);
    let price = price_for(&model)?;
    let cached = usage.cached_input_tokens.min(usage.input_tokens);
    let cache_write = usage
        .cache_write_input_tokens
        .min(usage.input_tokens.saturating_sub(cached));
    let uncached = usage
        .input_tokens
        .saturating_sub(cached)
        .saturating_sub(cache_write);
    let long_context =
        apply_long_context_multiplier && usage.input_tokens > LONG_CONTEXT_INPUT_TOKENS;
    let input_multiplier = if long_context { 2.0 } else { 1.0 };
    let output_multiplier = if long_context { 1.5 } else { 1.0 };
    let uncached_cost = cost(uncached, price.input * input_multiplier);
    let cached_cost = cost(cached, price.cached_input * input_multiplier);
    let cache_write_cost = cost(cache_write, price.input * 1.25 * input_multiplier);
    let output_cost = cost(usage.output_tokens, price.output * output_multiplier);
    Some(CostProjection {
        model,
        pricing_version: PRICING_VERSION.into(),
        currency: "USD".into(),
        basis: "apiEquivalent".into(),
        price,
        uncached_input_tokens: uncached,
        cached_input_tokens: cached,
        cache_write_input_tokens: cache_write,
        output_tokens: usage.output_tokens,
        cache_hit_percent: percentage(cached, usage.input_tokens),
        uncached_input_cost_usd: uncached_cost,
        cached_input_cost_usd: cached_cost,
        cache_write_input_cost_usd: cache_write_cost,
        output_cost_usd: output_cost,
        total_cost_usd: uncached_cost + cached_cost + cache_write_cost + output_cost,
    })
}

fn add_cost(left: Option<CostProjection>, right: Option<CostProjection>) -> Option<CostProjection> {
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
            left.cache_hit_percent = percentage(left.cached_input_tokens, total_input);
            Some(left)
        }
    }
}

#[allow(clippy::cast_precision_loss)]
fn cost(tokens: u64, dollars_per_million: f64) -> f64 {
    tokens as f64 * dollars_per_million / 1_000_000.0
}

#[allow(clippy::cast_precision_loss)]
fn percentage(part: u64, total: u64) -> f64 {
    if total == 0 {
        0.0
    } else {
        part as f64 / total as f64 * 100.0
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn prices_each_request_with_long_context_multiplier() -> Result<(), &'static str> {
        let usage = TokenCounts {
            total_tokens: 274_100,
            input_tokens: 273_000,
            output_tokens: 1_100,
            ..TokenCounts::default()
        };
        let cost =
            estimate_request_cost(Some("gpt-5.6-luna"), usage).ok_or("known model missing")?;
        assert!((cost.total_cost_usd - 0.5559).abs() < 0.000_000_1);
        Ok(())
    }

    #[test]
    fn uses_current_model_prices() -> Result<(), &'static str> {
        let million = TokenCounts {
            total_tokens: 2_000_000,
            input_tokens: 1_000_000,
            output_tokens: 1_000_000,
            ..TokenCounts::default()
        };
        let terra =
            estimate_request_cost(Some("GPT-5.6-Terra"), million).ok_or("known model missing")?;
        assert_eq!(
            terra.price,
            ModelPrice {
                input: 2.5,
                cached_input: 0.25,
                output: 15.0
            }
        );
        assert!((terra.total_cost_usd - 27.5).abs() < f64::EPSILON);
        Ok(())
    }

    #[test]
    fn rollout_projection_owns_the_turn_delta() {
        let baseline = TokenCounts {
            total_tokens: 100,
            input_tokens: 80,
            output_tokens: 20,
            ..TokenCounts::default()
        };
        let total = TokenCounts {
            total_tokens: 160,
            input_tokens: 125,
            output_tokens: 35,
            ..TokenCounts::default()
        };
        let last = TokenCounts {
            total_tokens: 60,
            input_tokens: 45,
            output_tokens: 15,
            ..TokenCounts::default()
        };
        let projection = projection_from_rollout(
            Some("gpt-5.6-sol"),
            baseline,
            total,
            last,
            &[last],
            Some(200_000),
            true,
        );
        assert_eq!(projection.turn.tokens, last);
        assert!(projection.turn.cost.is_some());
        assert_eq!(projection.thread.tokens, total);
        assert!(projection.thread.cost.is_some());
    }

    #[test]
    fn session_projection_prices_cumulative_tokens_without_fake_request_premium()
    -> Result<(), &'static str> {
        let usage = TokenCounts {
            total_tokens: 2_000_000,
            input_tokens: 1_000_000,
            cached_input_tokens: 500_000,
            output_tokens: 1_000_000,
            ..TokenCounts::default()
        };
        let estimate =
            estimate_session_cost(Some("gpt-5.6-luna"), usage).ok_or("known model missing")?;
        assert!((estimate.uncached_input_cost_usd - 0.5).abs() < f64::EPSILON);
        assert!((estimate.cached_input_cost_usd - 0.05).abs() < f64::EPSILON);
        assert!((estimate.output_cost_usd - 6.0).abs() < f64::EPSILON);
        assert!((estimate.total_cost_usd - 6.55).abs() < f64::EPSILON);
        Ok(())
    }

    #[test]
    fn live_projection_survives_a_companion_restart() -> Result<(), Box<dyn std::error::Error>> {
        let directory = tempfile::tempdir()?;
        let store = Arc::new(IndexStore::open(directory.path().join("index.redb"))?);
        let mut projector = LiveUsageProjector::new(store.clone());
        projector.observe(&json!({
            "method": "thread/settings/updated",
            "params": {"threadId": "thread", "threadSettings": {"model": "gpt-5.6-sol"}}
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

        drop(projector);
        let mut restarted = LiveUsageProjector::new(store);
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
