import { describe, expect, it } from "vitest";

import { richMarkdownLayout } from "../src/rendering/rich-markdown-layout";

describe("rich markdown layout", () => {
  it("keeps plain answers in native intrinsic measurement regardless of length or line count", () => {
    expect(richMarkdownLayout("Done.")).toBe("intrinsic");
    expect(richMarkdownLayout("A long paragraph ".repeat(40))).toBe("intrinsic");
    expect(richMarkdownLayout("First paragraph.\n\nSecond paragraph with a [link](https://example.test)."))
      .toBe("intrinsic");
  });

  it("fills the available width for block renderers that require a concrete viewport", () => {
    expect(richMarkdownLayout("- first\n- second")).toBe("fill");
    expect(richMarkdownLayout("```ts\nconst answer = 42;\n```")).toBe("fill");
    expect(richMarkdownLayout("| A | B |\n| - | - |\n| 1 | 2 |")).toBe("fill");
    expect(richMarkdownLayout("![Preview](https://example.test/image.png)")).toBe("fill");
    expect(richMarkdownLayout("> [!NOTE]\n> Read this.")).toBe("fill");
  });
});
