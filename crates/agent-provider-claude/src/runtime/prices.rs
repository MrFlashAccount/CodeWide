//! Anthropic API list prices of Claude models, published with the model
//! catalog (`catalog.models` `prices`; `host/src/catalog/prices.ts`).
//!
//! The companion prices live usage with them; Claude's own figure for a
//! finished turn replaces that estimate. Rates are USD per million tokens and
//! follow Anthropic's rate card: output costs 5× input, a 5-minute cache
//! write 1.25× input and a cache read 0.1× input unless a model states its
//! own. Ids are the canonical API model ids a request reports, plus every
//! catalog alias that resolves to one of them. Pure.

use std::collections::BTreeMap;

use agent_core::model::{LongContextRates, ModelPriceEntry, ModelRates};

use super::models::RawModel;

/// The source of the rates below (<https://platform.claude.com/docs/en/about-claude/pricing>).
pub const PRICING_VERSION: &str = "anthropic-api-2026-10-06";

const OUTPUT_MULTIPLIER: f64 = 5.0;
const CACHE_WRITE_MULTIPLIER: f64 = 1.25;
const CACHE_READ_MULTIPLIER: f64 = 0.1;

const FABLE_INPUT_USD: f64 = 10.0;
const FABLE_5_1_CACHE_READ_USD: f64 = 0.25;
const OPUS_5_5_INPUT_USD: f64 = 4.0;
const OPUS_5_5_CACHE_READ_USD: f64 = 0.2;
const OPUS_INPUT_USD: f64 = 5.0;
const SONNET_5_INPUT_USD: f64 = 2.0;
const SONNET_4_6_INPUT_USD: f64 = 3.0;
const HAIKU_5_5_INPUT_USD: f64 = 0.1;
/// Claude Haiku 5.5 bills a prompt above this size at its second rate card.
const HAIKU_5_5_LONG_PROMPT_TOKENS: u64 = 100_000;
const HAIKU_5_5_LONG_INPUT_USD: f64 = 0.5;
const HAIKU_4_5_INPUT_USD: f64 = 1.0;

/// One model's rate card: its input rate and, when it states its own, its
/// cache-read rate; the other rates follow the multipliers above.
#[derive(Clone, Copy)]
struct Card {
    input: f64,
    cached_input: Option<f64>,
    long_context: Option<(u64, f64)>,
}

const fn card(input: f64) -> Card {
    Card {
        input,
        cached_input: None,
        long_context: None,
    }
}

const fn card_with_cache_read(input: f64, cached_input: f64) -> Card {
    Card {
        input,
        cached_input: Some(cached_input),
        long_context: None,
    }
}

const FABLE_5_1: Card = card_with_cache_read(FABLE_INPUT_USD, FABLE_5_1_CACHE_READ_USD);
const FABLE_5: Card = card(FABLE_INPUT_USD);
const OPUS: Card = card(OPUS_INPUT_USD);
const SONNET_5: Card = card(SONNET_5_INPUT_USD);
const HAIKU_5_5: Card = Card {
    input: HAIKU_5_5_INPUT_USD,
    cached_input: None,
    long_context: Some((HAIKU_5_5_LONG_PROMPT_TOKENS, HAIKU_5_5_LONG_INPUT_USD)),
};

/// Canonical API model ids and their rate cards.
const MODEL_CARDS: [(&str, Card); 14] = [
    ("claude-fable-5", FABLE_5),
    ("claude-fable-5-1", FABLE_5_1),
    ("claude-haiku-4-5", card(HAIKU_4_5_INPUT_USD)),
    ("claude-haiku-5-5", HAIKU_5_5),
    ("claude-mythos-5", FABLE_5),
    ("claude-mythos-5-1", FABLE_5_1),
    ("claude-opus-4-6", OPUS),
    ("claude-opus-4-7", OPUS),
    ("claude-opus-4-8", OPUS),
    ("claude-opus-5", OPUS),
    (
        "claude-opus-5-5",
        card_with_cache_read(OPUS_5_5_INPUT_USD, OPUS_5_5_CACHE_READ_USD),
    ),
    ("claude-sonnet-4-6", card(SONNET_4_6_INPUT_USD)),
    ("claude-sonnet-5", SONNET_5),
    ("claude-sonnet-5-5", SONNET_5),
];

fn rates(input: f64, cached_input: Option<f64>) -> ModelRates {
    ModelRates {
        input,
        cached_input: cached_input.unwrap_or(input * CACHE_READ_MULTIPLIER),
        cache_write_input: input * CACHE_WRITE_MULTIPLIER,
        output: input * OUTPUT_MULTIPLIER,
    }
}

impl Card {
    fn entry(self) -> ModelPriceEntry {
        ModelPriceEntry {
            pricing_version: PRICING_VERSION.to_owned(),
            rates: rates(self.input, self.cached_input),
            long_context: self
                .long_context
                .map(|(above_input_tokens, input)| LongContextRates {
                    above_input_tokens,
                    rates: rates(input, None),
                }),
        }
    }
}

/// A canonical model id: trimmed, lower case, without a trailing bracketed
/// suffix such as the long-context `[1m]` (the host's `/\[[^\]]*\]$/`).
#[must_use]
pub fn canonical_model_id(model: &str) -> String {
    let model = model.trim().to_lowercase();
    let suffix_start = model.strip_suffix(']').and_then(|head| {
        // The suffix opens at the first `[` after the last `]` before the end.
        let after_close = head.rfind(']').map_or(0, |close| close + 1);
        head[after_close..].find('[').map(|open| after_close + open)
    });
    match suffix_start {
        Some(start) => model[..start].to_owned(),
        None => model,
    }
}

fn card_of(model: &str) -> Option<Card> {
    let id = canonical_model_id(model);
    MODEL_CARDS
        .iter()
        .find_map(|(known, card)| (*known == id).then_some(*card))
}

/// The price of `model` (a canonical id, optionally with a long-context
/// suffix); `None` for a model without a known price.
#[must_use]
pub fn price_of(model: &str) -> Option<ModelPriceEntry> {
    card_of(model).map(Card::entry)
}

/// Catalog prices: every known model, then each catalog row whose model
/// (its resolved model, else its own id) has a known price.
#[must_use]
pub fn catalog_prices(models: &[RawModel]) -> BTreeMap<String, ModelPriceEntry> {
    let mut prices: BTreeMap<String, ModelPriceEntry> = MODEL_CARDS
        .iter()
        .map(|(id, card)| ((*id).to_owned(), card.entry()))
        .collect();
    for model in models {
        let resolved = model.resolved_model.as_deref().unwrap_or(&model.value);
        if let Some(price) = price_of(resolved) {
            prices.insert(model.value.clone(), price);
        }
    }
    prices
}

#[cfg(test)]
mod tests {
    use super::*;

    fn model(value: &str, resolved_model: Option<&str>) -> RawModel {
        RawModel {
            value: value.to_owned(),
            display_name: value.to_owned(),
            description: String::new(),
            resolved_model: resolved_model.map(str::to_owned),
            supported_effort_levels: vec!["high".to_owned()],
        }
    }

    #[test]
    fn aliases_are_priced_by_the_model_they_resolve_to() {
        let prices = catalog_prices(&[
            model("opus", Some("claude-opus-5-5")),
            model("sonnet[1m]", Some("claude-sonnet-5-5[1m]")),
            model("experimental", Some("claude-unknown-9")),
        ]);
        assert_eq!(prices.get("opus"), prices.get("claude-opus-5-5"));
        assert_eq!(
            prices.get("opus").map(|price| price.rates),
            Some(ModelRates {
                input: 4.0,
                cached_input: 0.2,
                cache_write_input: 5.0,
                output: 20.0,
            })
        );
        assert!(prices.contains_key("sonnet[1m]"));
        assert_eq!(prices.get("sonnet[1m]"), prices.get("claude-sonnet-5-5"));
        assert!(!prices.contains_key("experimental"));
    }

    #[test]
    fn a_long_prompt_has_its_own_rate_card() {
        let long_context = catalog_prices(&[])
            .get("claude-haiku-5-5")
            .and_then(|price| price.long_context);
        assert_eq!(
            long_context,
            Some(LongContextRates {
                above_input_tokens: 100_000,
                rates: ModelRates {
                    input: 0.5,
                    cached_input: 0.05,
                    cache_write_input: 0.625,
                    output: 2.5,
                },
            })
        );
    }

    #[test]
    fn canonical_ids_ignore_case_whitespace_and_the_context_suffix() {
        assert_eq!(
            canonical_model_id(" Claude-Opus-5-5[1M] "),
            "claude-opus-5-5"
        );
        assert_eq!(canonical_model_id("claude-opus-5-5"), "claude-opus-5-5");
        assert_eq!(canonical_model_id("a[b[c]"), "a");
        assert_eq!(canonical_model_id("a]b[c]"), "a]b");
        assert_eq!(canonical_model_id("a]"), "a]");
        assert!(price_of("claude-sonnet-4-6[1m]").is_some());
        assert!(price_of("claude-unknown-1").is_none());
    }
}
