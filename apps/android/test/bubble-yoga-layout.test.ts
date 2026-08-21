import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const bubble = readFileSync(new URL("../src/rendering/Bubble.tsx", import.meta.url), "utf8");
const markdown = readFileSync(new URL("../src/rendering/RichMarkdown.tsx", import.meta.url), "utf8");
const mermaidNative = readFileSync(new URL("../src/rendering/MermaidDiagram.native.tsx", import.meta.url), "utf8");
const mermaidWeb = readFileSync(new URL("../src/rendering/MermaidDiagram.web.tsx", import.meta.url), "utf8");
const screen = readFileSync(new URL("../src/CodeWideScreen.tsx", import.meta.url), "utf8");

describe("Yoga-owned bubble layout", () => {
  it("keeps bubble geometry declarative", () => {
    expect(bubble).not.toMatch(/measurePretextBubble|useMemo|PixelRatio|onLayout|\bwidth\s*:/u);
    expect(bubble).not.toMatch(/\bheight\s*:/u);
    expect(bubble).toContain('maxWidth: "88%"');
    expect(bubble).toContain('maxWidth: "82%"');
    expect(bubble).toContain('alignSelf: "flex-start"');
    expect(bubble).toContain('alignSelf: "flex-end"');
  });

  it("lets native Text wrap and size Markdown without a second text layout", () => {
    expect(markdown).not.toContain("expo-pretext");
    expect(markdown).not.toContain("PretextTextBlock");
    expect(markdown).not.toContain("materializePretextLines");
    expect(markdown).toContain('<Text selectable reviewBlockPath={path} style={styles.paragraph}>{inline(node.children)}</Text>');
  });

  it("does not select a bubble layout from message content", () => {
    expect(screen).not.toContain("agentBubbleWidthPolicy");
    expect(screen).not.toContain("richMarkdownLayout");
    expect(screen).not.toContain("measurementSource");
    expect(screen).toContain('<Bubble variant="agent" testID="codex-bubble">');
    expect(screen).toContain('<Bubble variant="user" testID="user-bubble">');
  });

  it("lets diagram blocks stretch the bubble without measured width overrides", () => {
    expect(markdown).toContain('<View style={styles.wideBlock}>');
    expect(markdown).toContain('wideBlock: { width: "100%", minWidth: 0, maxWidth: "100%", alignSelf: "stretch" }');
    expect(mermaidNative).not.toContain("useRichContentWidth");
    expect(mermaidNative).toContain('style={styles.inlineReveal}');
    expect(mermaidNative).toContain('card: { width: "100%", minWidth: 0, maxWidth: "100%", alignSelf: "stretch"');
    expect(mermaidWeb).toContain('image: { width: "100%", minWidth: 0, maxWidth: "100%", alignSelf: "stretch"');
  });
});
