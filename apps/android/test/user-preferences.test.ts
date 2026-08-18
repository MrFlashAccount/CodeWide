import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  DEFAULT_DOCUMENT_VIEWER_PREFERENCES,
  decodeDocumentViewerPreferences,
  documentReadingWidth,
  encodeDocumentViewerPreferences,
  normalizeDocumentTextScale,
} from "../src/data/user-preferences";

const nativeDatabase = readFileSync(new URL("../src/data/user-preferences-database.native.ts", import.meta.url), "utf8");

describe("user preferences", () => {
  it("round-trips document viewer preferences", () => {
    expect(decodeDocumentViewerPreferences(encodeDocumentViewerPreferences({
      textScale: 1.2,
      layoutMode: "reading",
    }))).toEqual({ textScale: 1.2, layoutMode: "reading" });
  });

  it("falls back safely for corrupt or obsolete stored values", () => {
    expect(decodeDocumentViewerPreferences("not json")).toEqual(DEFAULT_DOCUMENT_VIEWER_PREFERENCES);
    expect(decodeDocumentViewerPreferences('{"textScale":99,"layoutMode":"obsolete"}')).toEqual({
      textScale: 1.4,
      layoutMode: "wide",
    });
    expect(normalizeDocumentTextScale(Number.NaN)).toBe(1);
  });

  it("keeps reading measure stable as the text scale changes", () => {
    expect(documentReadingWidth(0.8)).toBe(512);
    expect(documentReadingWidth(1)).toBe(640);
    expect(documentReadingWidth(1.4)).toBe(896);
  });

  it("persists device-wide preferences in the durable settings database", () => {
    expect(nativeDatabase).toContain('id: "user-preferences-v1"');
    expect(nativeDatabase).toContain("persistence: getSettingsPersistence()");
    expect(nativeDatabase).toContain("await transaction.isPersisted.promise");
  });
});
