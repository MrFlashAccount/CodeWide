import type { DocumentViewerPreferenceStore } from "../../application/ports/documentViewerPreferenceStore";
import { documentViewerPreferences } from "../../application/documentViewerPreferences";

const STORAGE_KEY = "codewide-v2-document-viewer-preferences";

export function createDocumentViewerPreferenceStore(): DocumentViewerPreferenceStore {
  return {
    load: async () => decodePreferences(globalThis.localStorage?.getItem(STORAGE_KEY) ?? null),
    save: async (preferences) => {
      globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(preferences));
    },
  };
}

function decodePreferences(
  value: string | null,
): Awaited<ReturnType<DocumentViewerPreferenceStore["load"]>> {
  if (value === null) return null;
  const parsed: unknown = JSON.parse(value);
  if (typeof parsed !== "object" || parsed === null) return null;
  const layoutMode: unknown = Reflect.get(parsed, "layoutMode");
  if (layoutMode !== "reading" && layoutMode !== "wide") return null;
  const textScale: unknown = Reflect.get(parsed, "textScale");
  return documentViewerPreferences(layoutMode, textScale);
}
