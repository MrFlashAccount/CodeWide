/**
 * Claude model catalog.
 *
 * Rows come from the SDK's `supportedModels()` (read by the runtime probe,
 * which makes no model call). The last successful list is kept; when the
 * probe fails the catalog serves that cache, or an empty list, and never
 * fails the RPC. Exactly one row is the default: the SDK's `default` alias
 * when present, otherwise the first row.
 */

import type { ModelEntry } from "../protocol.js";
import type { RawModel } from "../claude/port.js";

const EFFORT_DESCRIPTIONS: Readonly<Record<string, string>> = {
  low: "Fastest responses",
  medium: "Balanced",
  high: "Deeper reasoning",
  xhigh: "Extended reasoning",
  max: "Maximum reasoning",
};

export function modelEntries(models: readonly RawModel[]): readonly ModelEntry[] {
  const defaultIndex = Math.max(
    0,
    models.findIndex((model) => model.value === "default"),
  );
  return models.map((model, index) => ({
    id: model.value,
    model: model.value,
    displayName: model.displayName,
    description: model.description,
    isDefault: index === defaultIndex,
    hidden: false,
    efforts: model.supportedEffortLevels.map((effort) => ({ effort, description: EFFORT_DESCRIPTIONS[effort] ?? effort })),
    defaultEffort: model.supportedEffortLevels.includes("high") ? "high" : (model.supportedEffortLevels[0] ?? null),
    inputModalities: ["text", "image"],
  }));
}

/** Keeps the last successful model list. */
export class ModelCatalog {
  private cached: readonly ModelEntry[] = [];

  update(models: readonly RawModel[]): void {
    if (models.length > 0) this.cached = modelEntries(models);
  }

  get models(): readonly ModelEntry[] {
    return this.cached;
  }
}
