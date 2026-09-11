import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const editorPatch = readFileSync(
  fileURLToPath(
    new URL(
      "../../../patches/react-native-enriched-markdown@1.0.2.patch",
      import.meta.url,
    ),
  ),
  "utf8",
);

describe("native composer editor patch", () => {
  it("restores the placeholder after a controlled draft is cleared", () => {
    const setValueStart = editorPatch.indexOf('lastProcessedText = text?.toString() ?: ""');
    const setValue = editorPatch.slice(setValueStart, setValueStart + 120);

    expect(setValueStart).toBeGreaterThanOrEqual(0);
    expect(setValue).toContain('lastProcessedText = text?.toString() ?: ""');
    expect(setValue).toContain("+      syncHintVisibility()");
  });
});
