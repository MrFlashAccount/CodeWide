/**
 * Catalog prices: canonical model ids and the catalog aliases that resolve to
 * them carry API list rates; an unknown model stays unpriced.
 */

import { describe, expect, it } from "vitest";
import { catalogPrices } from "../src/catalog/prices.js";
import { ModelCatalog } from "../src/catalog/models.js";

const model = (value: string, resolvedModel?: string) => ({
  description: "",
  displayName: value,
  ...(resolvedModel === undefined ? {} : { resolvedModel }),
  supportedEffortLevels: ["high"],
  value,
});

describe("catalog prices", () => {
  it("prices aliases by the model they resolve to", () => {
    const prices = catalogPrices([
      model("opus", "claude-opus-5-5"),
      model("sonnet[1m]", "claude-sonnet-5-5[1m]"),
      model("experimental", "claude-unknown-9"),
    ]);
    expect(prices["opus"]).toEqual(prices["claude-opus-5-5"]);
    expect(prices["opus"]?.rates).toEqual({
      cachedInput: 0.2,
      cacheWriteInput: 5,
      input: 4,
      output: 20,
    });
    expect(prices["sonnet[1m]"]).toEqual(prices["claude-sonnet-5-5"]);
    expect(prices["experimental"]).toBeUndefined();
  });

  it("keeps a second rate card for long prompts", () => {
    expect(catalogPrices([])["claude-haiku-5-5"]?.longContext).toEqual({
      aboveInputTokens: 100_000,
      rates: { cachedInput: 0.05, cacheWriteInput: 0.625, input: 0.5, output: 2.5 },
    });
  });

  it("serves canonical prices before the first model list", () => {
    const catalog = new ModelCatalog();
    expect(catalog.models).toEqual([]);
    expect(catalog.prices["claude-opus-5-5"]).toBeDefined();
    catalog.update([model("opus", "claude-opus-5-5")]);
    expect(catalog.prices["opus"]).toBeDefined();
  });
});
