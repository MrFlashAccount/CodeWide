/**
 * Thinking levels of one catalog model. A model either offers levels with a
 * default (`efforts` may be empty when the catalog names only the default) or
 * offers none (`defaultEffort: null`, as a Claude model without effort support).
 */
export type ModelReasoningLevels =
  | { readonly defaultEffort: string; readonly efforts: readonly string[] }
  | { readonly defaultEffort: null; readonly efforts: readonly [] };

/** The levels a picker offers for `model`; empty when the model has no thinking levels. */
export function modelEffortLevels(model: ModelReasoningLevels): readonly string[] {
  if (model.defaultEffort === null) {
    return [];
  }
  return model.efforts.length > 0 ? model.efforts : [model.defaultEffort];
}

/**
 * Keeps `effort` when `model` offers it, otherwise falls back to the model's
 * default; `null` for a model without thinking levels.
 */
export function clampModelEffort(
  model: ModelReasoningLevels,
  effort: string | null,
): string | null {
  if (model.defaultEffort === null) {
    return null;
  }
  return effort !== null && modelEffortLevels(model).includes(effort)
    ? effort
    : model.defaultEffort;
}
