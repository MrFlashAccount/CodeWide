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
    displayName: versionedDisplayName(model),
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

/**
 * The row's name with its model version. The SDK names alias rows by family
 * only (`Opus`) and leads their description with the versioned name
 * (`Opus 5.5 · …`); the `default` row names the model it currently resolves
 * to. A description that does not lead with the family keeps the SDK name.
 */
function versionedDisplayName(model: RawModel): string {
  const separator = model.description.indexOf(" · ");
  const named = separator > 0 ? model.description.slice(0, separator).trim() : "";
  if (named === "") {
    return model.displayName;
  }
  if (model.value === "default") {
    return `Default (${named})`;
  }
  return named.startsWith(`${model.displayName} `) ? named : model.displayName;
}

/**
 * The catalog id of a model a session recorded: the row with that id, else
 * the alias row that resolves to it (not `default`, whose target moves), else
 * the recorded id itself.
 */
export function catalogModelId(models: readonly RawModel[], recorded: string): string {
  if (models.some((model) => model.value === recorded)) {
    return recorded;
  }
  const alias = models.find(
    (model) => model.value !== "default" && model.resolvedModel === recorded,
  );
  return alias?.value ?? recorded;
}

/** Keeps the last successful model list and the prices of its models. */
export class ModelCatalog {
  private cached: readonly ModelEntry[] = [];
  private cachedRaw: readonly RawModel[] = [];
  private cachedPrices: Readonly<Record<string, ModelPriceEntry>> = catalogPrices([]);

  update(models: readonly RawModel[]): void {
    if (models.length > 0) {
      this.cached = modelEntries(models);
      this.cachedRaw = models;
      this.cachedPrices = catalogPrices(models);
    }
  }

  /** `catalogModelId` over the last successful list. */
  idFor(recorded: string): string {
    return catalogModelId(this.cachedRaw, recorded);
  }

  get models(): readonly ModelEntry[] {
    return this.cached;
  }

  /** Known model prices, available before the first successful list. */
  get prices(): Readonly<Record<string, ModelPriceEntry>> {
    return this.cachedPrices;
  }
}
