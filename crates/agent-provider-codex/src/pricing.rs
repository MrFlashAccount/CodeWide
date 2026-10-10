//! The `OpenAI` API-equivalent price table of Codex models and the usage
//! projection of turns read back from rollouts.
//!
//! The table is data for the shared `CatalogPricing` and is declared to the
//! companion through `AgentProvider::usage_pricing`; costs are display
//! estimates and never persisted.

use std::sync::LazyLock;

use agent_core::model::{LongContextRates, ModelPriceEntry, ModelRates};
use agent_core::usage::{
    CatalogPricing, CostProjection, ModelPricing, TokenCounts, TurnUsageProjection,
    UsageScopeProjection, UsageStatus, add_cost,
};
use serde_json::Value;

pub const PRICING_VERSION: &str = "openai-api-2026-10-02";
const LONG_CONTEXT_INPUT_TOKENS: u64 = 272_000;

/// `OpenAI` standard API rates (<https://developers.openai.com/api/docs/pricing>).
pub struct OpenAiPricing;

static TABLE: LazyLock<CatalogPricing> = LazyLock::new(|| CatalogPricing::new(openai_prices()));

impl ModelPricing for OpenAiPricing {
    fn request_cost(&self, model: &str, usage: TokenCounts) -> Option<CostProjection> {
        TABLE.request_cost(model, usage)
    }

    fn session_cost(&self, model: &str, usage: TokenCounts) -> Option<CostProjection> {
        TABLE.session_cost(model, usage)
    }

    fn input_price(&self, model: &str) -> Option<f64> {
        TABLE.input_price(model)
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

/// Model ids with their input, cached-input and output rates. A cache write
/// is billed at 1.25× input; a request above 272K input tokens at 2× input
/// and 1.5× output.
const OPENAI_RATES: &[(&str, f64, f64, f64)] = &[
    ("gpt-6-astra", 10.0, 1.0, 50.0),
    ("gpt-6.1-sol", 2.0, 0.1, 10.0),
    ("gpt-6-sol", 2.0, 0.2, 10.0),
    ("gpt-6-luna", 0.1, 0.01, 0.5),
    ("gpt-5.6", 4.0, 0.4, 20.0),
    ("gpt-5.6-sol", 4.0, 0.4, 20.0),
    ("gpt-5.6-terra", 2.0, 0.2, 12.0),
    ("gpt-5.6-luna", 0.2, 0.02, 1.2),
];

/// The table as catalog `prices`.
pub(crate) fn openai_prices() -> impl Iterator<Item = (String, ModelPriceEntry)> {
    OPENAI_RATES
        .iter()
        .map(|&(model, input, cached_input, output)| {
            let rates = ModelRates {
                input,
                cached_input,
                cache_write_input: input * 1.25,
                output,
            };
            let price = ModelPriceEntry {
                pricing_version: PRICING_VERSION.into(),
                rates,
                long_context: Some(LongContextRates {
                    above_input_tokens: LONG_CONTEXT_INPUT_TOKENS,
                    rates: ModelRates {
                        input: input * 2.0,
                        cached_input: cached_input * 2.0,
                        cache_write_input: rates.cache_write_input * 2.0,
                        output: output * 1.5,
                    },
                }),
            };
            (model.to_owned(), price)
        })
}

#[cfg(test)]
mod tests {
    use agent_core::usage::ModelPrice;

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
