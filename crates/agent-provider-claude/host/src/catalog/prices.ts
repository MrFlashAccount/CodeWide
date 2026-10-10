/**
 * Anthropic API list prices of Claude models, published with the model
 * catalog (`catalog.models` `prices`).
 *
 * The companion prices live usage with them; the SDK's own figure for a
 * finished turn replaces that estimate. Rates are USD per million tokens and
 * follow Anthropic's rate card: output costs 5× input, a 5-minute cache write
 * 1.25× input and a cache read 0.1× input unless a model states its own. Ids
 * are the canonical API model ids an SDK request reports, plus every catalog
 * alias that resolves to one of them.
 */

import type { ModelPriceEntry, ModelRates } from "../protocol.js";
import type { RawModel } from "../claude/port.js";

/** The source of the rates below (<https://platform.claude.com/docs/en/about-claude/pricing>). */
export const PRICING_VERSION = "anthropic-api-2026-10-06";

const OUTPUT_MULTIPLIER = 5;
const CACHE_WRITE_MULTIPLIER = 1.25;
const CACHE_READ_MULTIPLIER = 0.1;

const FABLE_INPUT_USD = 10;
const FABLE_5_1_CACHE_READ_USD = 0.25;
const OPUS_5_5_INPUT_USD = 4;
const OPUS_5_5_CACHE_READ_USD = 0.2;
const OPUS_INPUT_USD = 5;
const SONNET_5_INPUT_USD = 2;
const SONNET_4_6_INPUT_USD = 3;
const HAIKU_5_5_INPUT_USD = 0.1;
/** Claude Haiku 5.5 bills a prompt above this size at its second rate card. */
const HAIKU_5_5_LONG_PROMPT_TOKENS = 100_000;
const HAIKU_5_5_LONG_INPUT_USD = 0.5;
const HAIKU_4_5_INPUT_USD = 1;

const rates = (input: number, cachedInput = input * CACHE_READ_MULTIPLIER): ModelRates => ({
  cachedInput,
  cacheWriteInput: input * CACHE_WRITE_MULTIPLIER,
  input,
  output: input * OUTPUT_MULTIPLIER,
});

const priced = (
  modelRates: ModelRates,
  longContext?: ModelPriceEntry["longContext"],
): ModelPriceEntry => ({
  ...(longContext === undefined ? {} : { longContext }),
  pricingVersion: PRICING_VERSION,
  rates: modelRates,
});

const FABLE_5_1 = priced(rates(FABLE_INPUT_USD, FABLE_5_1_CACHE_READ_USD));
const FABLE_5 = priced(rates(FABLE_INPUT_USD));
const OPUS = priced(rates(OPUS_INPUT_USD));
const SONNET_5 = priced(rates(SONNET_5_INPUT_USD));

const MODEL_PRICES: Readonly<Record<string, ModelPriceEntry>> = {
  "claude-fable-5": FABLE_5,
  "claude-fable-5-1": FABLE_5_1,
  "claude-haiku-4-5": priced(rates(HAIKU_4_5_INPUT_USD)),
  "claude-haiku-5-5": priced(rates(HAIKU_5_5_INPUT_USD), {
    aboveInputTokens: HAIKU_5_5_LONG_PROMPT_TOKENS,
    rates: rates(HAIKU_5_5_LONG_INPUT_USD),
  }),
  "claude-mythos-5": FABLE_5,
  "claude-mythos-5-1": FABLE_5_1,
  "claude-opus-4-6": OPUS,
  "claude-opus-4-7": OPUS,
  "claude-opus-4-8": OPUS,
  "claude-opus-5": OPUS,
  "claude-opus-5-5": priced(rates(OPUS_5_5_INPUT_USD, OPUS_5_5_CACHE_READ_USD)),
  "claude-sonnet-4-6": priced(rates(SONNET_4_6_INPUT_USD)),
  "claude-sonnet-5": SONNET_5,
  "claude-sonnet-5-5": SONNET_5,
};

/** A canonical model id without a long-context suffix such as `[1m]`. */
export function canonicalModelId(model: string): string {
  return model
    .trim()
    .toLowerCase()
    .replace(/\[[^\]]*\]$/u, "");
}

function priceOf(model: string): ModelPriceEntry | undefined {
  const id = canonicalModelId(model);
  return Object.hasOwn(MODEL_PRICES, id) ? MODEL_PRICES[id] : undefined;
}

/** Catalog prices: every known model, then each catalog row whose model resolves to one. */
export function catalogPrices(
  models: readonly RawModel[],
): Readonly<Record<string, ModelPriceEntry>> {
  const prices: Record<string, ModelPriceEntry> = { ...MODEL_PRICES };
  for (const model of models) {
    const price = priceOf(model.resolvedModel ?? model.value);
    if (price !== undefined) {
      prices[model.value] = price;
    }
  }
  return prices;
}
