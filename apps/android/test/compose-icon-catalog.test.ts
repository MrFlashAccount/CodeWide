import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { isComposeIconName } from "../src/presentation/icons/composeIconNames";

describe("native Compose icon catalog", () => {
  it("recognizes supported names without accepting prototype keys or arbitrary strings", () => {
    expect(isComposeIconName("checkmark")).toBe(true);
    expect(isComposeIconName("folder-outline")).toBe(true);
    expect(isComposeIconName("constructor")).toBe(false);
    expect(isComposeIconName("toString")).toBe(false);
    expect(isComposeIconName("american-football-outline")).toBe(false);
    expect(isComposeIconName("not-an-icon")).toBe(false);
  });

  it("supports the display variants shared by attachments, projects and row controls", () => {
    // This is the native display contract, not a scan of arbitrary application
    // string literals which may coincidentally match an upstream icon name.
    for (const name of [
      "image-outline",
      "musical-note-outline",
      "document-attach-outline",
      "folder",
      "folder-outline",
      "server-outline",
      "pin",
      "pin-outline",
      "open-outline",
      "download-outline",
      "checkmark",
      "alert-circle-outline",
    ]) {
      expect(isComposeIconName(name)).toBe(true);
    }
  });

  it("bundles supported flat vector paths instead of unsupported group transforms", () => {
    const assets = new URL("../assets/compose-icons/", import.meta.url);
    for (const filename of readdirSync(assets)) {
      if (!filename.endsWith(".xml")) continue;
      expect(isComposeIconName(filename.slice(0, -4))).toBe(true);
      const xml = readFileSync(new URL(filename, assets), "utf8");
      // This is the supported native vector format, not incidental serialization.
      expect(xml).toMatch(/<vector\b/u);
      expect(xml).toMatch(/android:pathData="[^"]+"/u);
      expect(xml).toContain('android:viewportWidth="512"');
      expect(xml).toContain('android:viewportHeight="512"');
      expect(xml).not.toMatch(/<(?:group|clip-path|gradient)\b/u);
    }
  });
});
