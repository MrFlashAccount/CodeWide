import { describe, expect, it } from "vitest";

import { richMarkdownLayout } from "../src/rendering/rich-markdown-layout";

describe("rich markdown layout", () => {
  it("keeps text and text-only containers intrinsic", () => {
    expect(richMarkdownLayout("Done.")).toBe("intrinsic");
    expect(richMarkdownLayout("Done.\n\n- Companion rebuilt\n- Binary restarted")).toBe("intrinsic");
    expect(richMarkdownLayout("> A text-only quote")).toBe("intrinsic");
    expect(richMarkdownLayout("1. Parent\n   - Nested text")).toBe("intrinsic");
  });

  it("fills the available width only for renderers that need a viewport", () => {
    expect(richMarkdownLayout("```ts\nconst answer = 42;\n```")).toBe("fill");
    expect(richMarkdownLayout("| A | B |\n| - | - |\n| 1 | 2 |")).toBe("fill");
    expect(richMarkdownLayout("![Preview](https://example.test/image.png)")).toBe("fill");
  });

  it("propagates a wide descendant through intrinsic containers", () => {
    expect(richMarkdownLayout("- Text\n- ![Preview](https://example.test/image.png)")).toBe("fill");
    expect(richMarkdownLayout("> ```mermaid\n> graph LR\n> A --> B\n> ```")).toBe("fill");
  });
});
