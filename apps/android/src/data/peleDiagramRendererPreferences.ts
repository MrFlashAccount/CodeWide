import { unknownRecord } from "./unknownRecord";

export const PELE_DIAGRAM_RENDERER_PREFERENCE_ID = "pele-diagram-renderer";

/** Device-wide opt-in for native Mermaid-compatible diagram rendering. */
export type PeleDiagramRendererPreference = {
  readonly enabled: boolean;
};

export const DEFAULT_PELE_DIAGRAM_RENDERER_PREFERENCE: PeleDiagramRendererPreference = {
  enabled: false,
};

export function decodePeleDiagramRendererPreference(
  value: string | null | undefined,
): PeleDiagramRendererPreference {
  if (value === null || value === undefined) {
    return DEFAULT_PELE_DIAGRAM_RENDERER_PREFERENCE;
  }
  try {
    const parsed = unknownRecord(JSON.parse(value));
    if (parsed === null || parsed.schemaVersion !== 1 || typeof parsed.enabled !== "boolean") {
      return DEFAULT_PELE_DIAGRAM_RENDERER_PREFERENCE;
    }
    return { enabled: parsed.enabled };
  } catch {
    return DEFAULT_PELE_DIAGRAM_RENDERER_PREFERENCE;
  }
}

export function encodePeleDiagramRendererPreference(
  preference: PeleDiagramRendererPreference,
): string {
  return JSON.stringify({ enabled: preference.enabled, schemaVersion: 1 });
}
