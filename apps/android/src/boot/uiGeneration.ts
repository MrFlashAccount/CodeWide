export type UiGeneration = "legacy" | "v2";

export const DEFAULT_UI_GENERATION: UiGeneration = "legacy";

export function parseUiGeneration(value: unknown): UiGeneration | null {
  return value === "legacy" || value === "v2" ? value : null;
}
