/**
 * Claude model catalog.
 *
 * Rows come from the SDK's `supportedModels()` (read by the runtime probe,
 * which makes no model call). The last successful list is kept; when the
 * probe fails the catalog serves that cache, or an empty list, and never
 * fails the RPC. Exactly one row is the default: the SDK's `default` alias
 * when present, otherwise the first row. Prices come with the list
 * (`prices.ts`).
 */

import type { ModelEntry, ModelPriceEntry } from "../protocol.js";
import type { RawModel } from "../claude/port.js";
import { catalogPrices } from "./prices.js";

const EFFORT_DESCRIPTIONS: Readonly<Record<string, string>> = {
  high: "Deeper reasoning",
  low: "Fastest responses",
  max: "Maximum reasoning",
  medium: "Balanced",
  xhigh: "Extended reasoning",
};

export function modelEntries(models: readonly RawModel[]): readonly ModelEntry[] {
  const defaultIndex = Math.max(
    0,
    models.findIndex((model) => model.value === "default"),
  );
  return models.map((model, index) => ({
    defaultEffort: model.supportedEffortLevels.includes("high")
      ? "high"
      : (model.supportedEffortLevels[0] ?? null),
    description: model.description,
    displayName: model.displayName,
    efforts: model.supportedEffortLevels.map((effort) => ({
      description: EFFORT_DESCRIPTIONS[effort] ?? effort,
      effort,
    })),
    hidden: false,
    id: model.value,
    inputModalities: ["text", "image"],
    isDefault: index === defaultIndex,
    model: model.value,
  }));
}

/** Keeps the last successful model list and the prices of its models. */
export class ModelCatalog {
  private cached: readonly ModelEntry[] = [];
  private cachedPrices: Readonly<Record<string, ModelPriceEntry>> = catalogPrices([]);

  update(models: readonly RawModel[]): void {
    if (models.length > 0) {
      this.cached = modelEntries(models);
      this.cachedPrices = catalogPrices(models);
    }
  }

  get models(): readonly ModelEntry[] {
    return this.cached;
  }

  /** Known model prices, available before the first successful list. */
  get prices(): Readonly<Record<string, ModelPriceEntry>> {
    return this.cachedPrices;
  }
}
