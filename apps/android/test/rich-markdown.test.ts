import { describe, expect, it } from "vitest";

import {
  isSafeLink,
  MAX_MARKDOWN_CACHE_SOURCE_CHARS,
  MAX_MARKDOWN_SOURCE_CHARS,
  parseRichMarkdown,
  plainRichMarkdownText,
  resetRichMarkdownCache,
  richMarkdownBlockIndexAtLine,
  richMarkdownCacheStats,
} from "@codewide/rendering-core";

describe("rich markdown AST", () => {
  it("finds the rendered top-level block containing a source line", () => {
    const source = "# Intro\n\nFirst\n\n## Details\n\nBody";
    expect(richMarkdownBlockIndexAtLine(source, 1)).toBe(0);
    expect(richMarkdownBlockIndexAtLine(source, 3)).toBe(1);
    expect(richMarkdownBlockIndexAtLine(source, 5)).toBe(2);
    expect(richMarkdownBlockIndexAtLine(source, 7)).toBe(3);
  });

  it("parses GFM and preserves custom fenced extensions without executing HTML", () => {
    const parsed = parseRichMarkdown(`
# Result

- [x] shipped

| Name | State |
| --- | --- |
| API | live |

\`\`\`codex-metric latency
{"p95":120}
\`\`\`

<script>alert(1)</script>
`);
    expect(parsed.root.children.map((node) => node.type)).toEqual([
      "heading",
      "list",
      "table",
      "code",
      "html",
    ]);
    const code = parsed.root.children[3];
    expect(code?.type === "code" ? code.lang : null).toBe("codex-metric");
    expect(code?.type === "code" ? code.meta : null).toBe("latency");
    const list = parsed.root.children[1];
    expect(list?.type === "list" ? list.children[0]?.checked : null).toBe(true);
  });

  it("preserves references, footnotes, entities, images and nested inline formatting", () => {
    const parsed = parseRichMarkdown(`
[**Docs** &amp; status][docs] and [^note]  
next

![Preview](https://example.test/image.png "Image title")

[docs]: https://example.test/path "Docs title"
[^note]: hidden definition
`);
    const first = parsed.root.children[0];
    expect(first?.type).toBe("paragraph");
    if (first?.type !== "paragraph") throw new Error("Expected paragraph");
    expect(first.children.map((node) => node.type)).toEqual(["link", "text", "footnoteReference", "break", "text"]);
    expect(plainRichMarkdownText("[**Docs** &amp; status][docs] and [^note]\n\n[docs]: https://example.test/path\n[^note]: hidden definition"))
      .toBe("Docs & status and [note]");
    const imageParagraph = parsed.root.children[1];
    expect(imageParagraph?.type === "paragraph" ? imageParagraph.children[0] : null).toMatchObject({
      type: "image",
      url: "https://example.test/image.png",
      title: "Image title",
      alt: "Preview",
    });
    const footnote = parsed.root.children[2];
    expect(footnote).toMatchObject({ type: "footnoteDefinition", identifier: "note" });
    expect(footnote?.type === "footnoteDefinition" ? footnote.children.length : 0).toBeGreaterThan(0);
  });

  it("covers the full GFM surface plus GitHub alerts and fenced Mermaid", () => {
    const parsed = parseRichMarkdown(`
> [!WARNING]
> Keep the fallback.

- [ ] open task
- [x] ~~closed task~~
  - nested item

Visit https://example.test/docs and <team@example.test>.

| left | centered | right |
| :--- | :------: | ----: |
| one | two | three |

\`\`\`mermaid
flowchart LR
  A --> B
\`\`\`
`);
    expect(parsed.root.children.map((node) => node.type)).toEqual([
      "blockquote",
      "list",
      "paragraph",
      "table",
      "code",
    ]);
    const list = parsed.root.children[1];
    expect(list?.type === "list" ? list.children.map((item) => item.checked) : []).toEqual([false, true]);
    const paragraph = parsed.root.children[2];
    expect(paragraph?.type === "paragraph" ? paragraph.children.filter((node) => node.type === "link").length : 0).toBe(2);
    const table = parsed.root.children[3];
    expect(table?.type === "table" ? table.align : []).toEqual(["left", "center", "right"]);
    const diagram = parsed.root.children[4];
    expect(diagram?.type === "code" ? diagram.lang : null).toBe("mermaid");
  });

  it("projects collapsed Markdown into one native text flow", () => {
    expect(plainRichMarkdownText("# Title\n\n- **first**\n- `second`\n\nLast paragraph"))
      .toBe("Title\n• first\n• second\nLast paragraph");
  });

  it("bounds pathological message size and allows only explicit web links", () => {
    resetRichMarkdownCache();
    const parsed = parseRichMarkdown("a".repeat(MAX_MARKDOWN_SOURCE_CHARS + 100));
    expect(parsed.truncated).toBe(true);
    expect(parsed.originalLength).toBe(MAX_MARKDOWN_SOURCE_CHARS + 100);
    expect(richMarkdownCacheStats()).toEqual({ entries: 0, sourceChars: 0 });
    expect(isSafeLink("https://example.test/path")).toBe(true);
    expect(isSafeLink("javascript:alert(1)")).toBe(false);
    expect(isSafeLink("file:///data/private" )).toBe(false);
  });

  it("bounds the weighted markdown LRU across many large messages", () => {
    resetRichMarkdownCache();
    for (let index = 0; index < 12; index += 1) {
      parseRichMarkdown(`${index}\n${"x".repeat(400_000)}`);
    }
    const stats = richMarkdownCacheStats();
    expect(stats.entries).toBeLessThan(12);
    expect(stats.sourceChars).toBeLessThanOrEqual(MAX_MARKDOWN_CACHE_SOURCE_CHARS);
  });

  it("parses 1,000 deterministic mixed Markdown messages", () => {
    const messages = Array.from({ length: 1_000 }, (_, index) => [
      `## Result ${index}`,
      "",
      `- [${index % 2 === 0 ? "x" : " "}] item`,
      `- **strong** and \`inline-${index}\``,
      "",
      "| Name | State |",
      "| --- | --- |",
      `| fixture-${index} | ready |`,
    ].join("\n"));
    expect(messages).toHaveLength(1_000);
    for (const message of messages) expect(parseRichMarkdown(message).root.type).toBe("root");
  });
});
