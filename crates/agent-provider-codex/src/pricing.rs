//! The `OpenAI` API-equivalent price table of Codex models and the usage
//! projection of turns read back from rollouts.
//!
//! The table is declared to the companion through
//! `AgentProvider::usage_pricing`; costs are display estimates and never
//! persisted.

use agent_core::usage::{
    CostProjection, ModelPrice, ModelPricing, TokenCounts, TurnUsageProjection,
    UsageScopeProjection, UsageStatus, add_cost, cache_hit_percent, normalize_model,
};
use serde_json::Value;

pub const PRICING_VERSION: &str = "openai-api-2026-10-02";
const LONG_CONTEXT_INPUT_TOKENS: u64 = 272_000;

/// `OpenAI` standard API rates (<https://developers.openai.com/api/docs/pricing>).
pub struct OpenAiPricing;

impl ModelPricing for OpenAiPricing {
    fn request_cost(&self, model: &str, usage: TokenCounts) -> Option<CostProjection> {
        estimate_cost(model, usage, true)
    }

    fn session_cost(&self, model: &str, usage: TokenCounts) -> Option<CostProjection> {
        // Cumulative counters do not preserve the request boundaries needed to
        // reconstruct long-context multipliers. Keep the estimate deterministic
        // and price the aggregate at the selected model's base API rates.
        estimate_cost(model, usage, false)
    }

    fn input_price(&self, model: &str) -> Option<f64> {
        price_for(model).map(|price| price.input)
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
        add_cost(
            cost,
            model.and_then(|model| OpenAiPricing.request_cost(model, request)),
        )
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
            cost: model.and_then(|model| OpenAiPricing.session_cost(model, total)),
        },
    }
}

/// Cumulative and last-request token usage of a rollout `token_count` event.
#[must_use]
pub fn parse_rollout_usage(payload: &Value) -> Option<(TokenCounts, TokenCounts, Option<u64>)> {
    let info = payload.get("info")?;
    let total = TokenCounts::from_snake_case(info.get("total_token_usage")?);
    let last = TokenCounts::from_snake_case(info.get("last_token_usage")?);
    let context = info.get("model_context_window").and_then(Value::as_u64);
    Some((total, last, context))
}

fn price_for(model: &str) -> Option<ModelPrice> {
    match normalize_model(model).as_str() {
        "gpt-6-astra" => Some(ModelPrice {
            input: 10.0,
            cached_input: 1.0,
            output: 50.0,
        }),
        "gpt-6.1-sol" => Some(ModelPrice {
            input: 2.0,
            cached_input: 0.1,
            output: 10.0,
        }),
        "gpt-6-sol" => Some(ModelPrice {
            input: 2.0,
            cached_input: 0.2,
            output: 10.0,
        }),
        "gpt-6-luna" => Some(ModelPrice {
            input: 0.1,
            cached_input: 0.01,
            output: 0.5,
        }),
        "gpt-5.6" | "gpt-5.6-sol" => Some(ModelPrice {
            input: 4.0,
            cached_input: 0.4,
            output: 20.0,
        }),
        "gpt-5.6-terra" => Some(ModelPrice {
            input: 2.0,
            cached_input: 0.2,
            output: 12.0,
        }),
        "gpt-5.6-luna" => Some(ModelPrice {
            input: 0.2,
            cached_input: 0.02,
            output: 1.2,
        }),
        _ => None,
    }
}

fn estimate_cost(
    model: &str,
    usage: TokenCounts,
    apply_long_context_multiplier: bool,
) -> Option<CostProjection> {
    let model = normalize_model(model);
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
        cache_hit_percent: cache_hit_percent(cached, usage.input_tokens),
        uncached_input_cost_usd: uncached_cost,
        cached_input_cost_usd: cached_cost,
        cache_write_input_cost_usd: cache_write_cost,
        output_cost_usd: output_cost,
        total_cost_usd: uncached_cost + cached_cost + cache_write_cost + output_cost,
    })
}

// WHY: a display estimate; token counts far below 2^52 convert exactly.
#[allow(clippy::cast_precision_loss)]
fn cost(tokens: u64, dollars_per_million: f64) -> f64 {
    tokens as f64 * dollars_per_million / 1_000_000.0
}

#[cfg(test)]
mod tests {
    use super::*;

    fn request_cost(model: &str, usage: TokenCounts) -> Option<CostProjection> {
        OpenAiPricing.request_cost(model, usage)
    }

    #[test]
    fn prices_each_request_with_long_context_multiplier() -> Result<(), &'static str> {
        let usage = TokenCounts {
            total_tokens: 274_100,
            input_tokens: 273_000,
            output_tokens: 1_100,
            ..TokenCounts::default()
        };
        let cost = request_cost("gpt-5.6-luna", usage).ok_or("known model missing")?;
        assert!((cost.total_cost_usd - 0.11118).abs() < 0.000_000_1);
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
        let terra = request_cost("GPT-5.6-Terra", million).ok_or("known model missing")?;
        assert_eq!(
            terra.price,
            ModelPrice {
                input: 2.0,
                cached_input: 0.2,
                output: 12.0
            }
        );
        assert!((terra.total_cost_usd - 22.0).abs() < f64::EPSILON);

        let astra = request_cost("GPT-6-Astra", million).ok_or("known model missing")?;
        assert_eq!(
            astra.price,
            ModelPrice {
                input: 10.0,
                cached_input: 1.0,
                output: 50.0
            }
        );
        assert!((astra.total_cost_usd - 95.0).abs() < f64::EPSILON);
        Ok(())
    }

    #[test]
    fn prices_new_gpt_6_models_with_cached_input() -> Result<(), &'static str> {
        let usage = TokenCounts {
            total_tokens: 2_000,
            input_tokens: 1_000,
            cached_input_tokens: 500,
            output_tokens: 1_000,
            ..TokenCounts::default()
        };
        for (model, expected_price, expected_cost) in [
            (
                " GPT-6.1-Sol ",
                ModelPrice {
                    input: 2.0,
                    cached_input: 0.1,
                    output: 10.0,
                },
                0.01105,
            ),
            (
                "gpt-6-sol",
                ModelPrice {
                    input: 2.0,
                    cached_input: 0.2,
                    output: 10.0,
                },
                0.0111,
            ),
            (
                "gpt-6-luna",
                ModelPrice {
                    input: 0.1,
                    cached_input: 0.01,
                    output: 0.5,
                },
                0.000_555,
            ),
        ] {
            let projection = request_cost(model, usage).ok_or("known model missing")?;
            assert_eq!(projection.price, expected_price);
            assert!((projection.total_cost_usd - expected_cost).abs() < 0.000_000_1);
        }
        Ok(())
    }

    #[test]
    fn gpt_6_1_sol_projection_prices_cache_writes_and_long_context() -> Result<(), &'static str> {
        // Standard API rates: https://developers.openai.com/api/docs/pricing
        // Long-context rates apply only when an individual request exceeds 272K input tokens.
        for (input_tokens, expected_turn_cost, expected_thread_cost) in
            [(272_000, 0.519, 0.519), (273_000, 1.037, 0.521)]
        {
            let usage = TokenCounts {
                total_tokens: input_tokens + 1_000,
                input_tokens,
                cached_input_tokens: 20_000,
                cache_write_input_tokens: 6_000,
                output_tokens: 1_000,
                ..TokenCounts::default()
            };
            let projection = projection_from_rollout(
                Some("gpt-6.1-sol"),
                TokenCounts::default(),
                usage,
                usage,
                &[usage],
                None,
                true,
            );
            let turn = projection.turn.cost.ok_or("turn cost missing")?;
            let thread = projection.thread.cost.ok_or("thread cost missing")?;
            assert_eq!(turn.model, "gpt-6.1-sol");
            assert_eq!(turn.basis, "apiEquivalent");
            assert_eq!(turn.uncached_input_tokens, input_tokens - 26_000);
            assert_eq!(turn.cached_input_tokens, 20_000);
            assert_eq!(turn.cache_write_input_tokens, 6_000);
            assert!((turn.total_cost_usd - expected_turn_cost).abs() < 0.000_000_1);
            assert!((thread.total_cost_usd - expected_thread_cost).abs() < 0.000_000_1);
        }
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
        let estimate = OpenAiPricing
            .session_cost("gpt-5.6-luna", usage)
            .ok_or("known model missing")?;
        assert!((estimate.uncached_input_cost_usd - 0.1).abs() < f64::EPSILON);
        assert!((estimate.cached_input_cost_usd - 0.01).abs() < f64::EPSILON);
        assert!((estimate.output_cost_usd - 1.2).abs() < f64::EPSILON);
        assert!((estimate.total_cost_usd - 1.31).abs() < f64::EPSILON);
        Ok(())
    }
}
