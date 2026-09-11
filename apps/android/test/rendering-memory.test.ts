import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  parseRichMarkdown,
  plainRichMarkdownRootText,
  resetRichMarkdownCache,
  richMarkdownCacheStats,
} from "@codewide/rendering-core";
import { privateImageResourceKey } from "../src/rendering/private-image-resource-key";
import { parseDiagramPreviewResult } from "../src/rendering/diagram-preview-result";

describe("rendering memory ownership", () => {
  it("accounts for native highlight spans and releases native rendering caches", () => {
    const highlighter = readFileSync(
      new URL("../android/app/src/main/java/dev/codewide/app/rendering/NativeCodeHighlighter.kt", import.meta.url),
      "utf8",
    );
    const application = readFileSync(
      new URL("../android/app/src/main/java/dev/codewide/app/MainApplication.kt", import.meta.url),
      "utf8",
    );
    expect(highlighter).toContain("getSpans(0, value.length, Any::class.java).size * 96");
    expect(highlighter).toContain("cache.evictAll()");
    expect(application).toContain("ComponentCallbacks2.TRIM_MEMORY_UI_HIDDEN");
    expect(application).toContain("Fresco.getImagePipeline().clearMemoryCaches()");
  });

  it("does not retain historical streaming ASTs but still reuses completed blocks", () => {
    resetRichMarkdownCache();
    const completed = parseRichMarkdown("# Completed\n\nStable content");
    const baseline = richMarkdownCacheStats();
    for (let index = 1; index <= 100; index += 1) {
      const text = `# Reply\n\n${"stream ".repeat(index)}`;
      const parsed = parseRichMarkdown(text, false);
      expect(plainRichMarkdownRootText(parsed.root)).toBe(`Reply\nstream${" stream".repeat(index - 1)}`);
    }
    expect(richMarkdownCacheStats()).toEqual(baseline);
    expect(parseRichMarkdown("# Completed\n\nStable content")).toBe(completed);
    expect(parseRichMarkdown("**Done**", false)).toEqual(parseRichMarkdown("**Done**"));
  });

  it("uses bounded content identities without embedding image bytes", () => {
    const uri = `data:image/png;base64,${"abcd".repeat(250_000)}`;
    const key = privateImageResourceKey({ kind: "direct", uri });
    expect(key.length).toBeLessThan(100);
    expect(key).not.toContain("data:");
    expect(privateImageResourceKey({ kind: "direct", uri })).toBe(key);
    expect(privateImageResourceKey({ kind: "direct", uri: `${uri}AAAA` })).not.toBe(key);
    expect(privateImageResourceKey({ kind: "path", path: "same" }))
      .not.toBe(privateImageResourceKey({ kind: "content", id: "same" }));
  });

  it("validates native diagram preview results", () => {
    const uri = "file:///data/user/0/dev.codewide.app/cache/diagram.png";
    expect(parseDiagramPreviewResult(JSON.stringify({ type: "preview", uri, width: 20, height: 10 })))
      .toEqual({ status: "ready", preview: { uri, width: 20, height: 10 } });
    expect(parseDiagramPreviewResult(JSON.stringify({ type: "error", message: "Invalid diagram" })))
      .toEqual({ status: "error", message: "Invalid diagram" });
    for (const invalid of [
      null,
      {},
      { type: "preview", uri, width: 0, height: 1 },
      { type: "preview", uri, width: 1, height: -1 },
      { type: "preview", uri: "https://example.test/diagram.png", width: 1, height: 1 },
      { type: "error", message: "" },
    ]) {
      expect(() => parseDiagramPreviewResult(JSON.stringify(invalid))).toThrow("Invalid diagram renderer");
    }
  });
});
