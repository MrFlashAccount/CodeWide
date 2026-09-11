import type { Link, Nodes } from "mdast";
import { describe, expect, it } from "vitest";
import { parseRichMarkdown, plainRichMarkdownText } from "@codewide/rendering-core";
import { parseMessageMarkup } from "@codewide/rendering-core/markup";
import { resolvePreviewableDocumentLink } from "../src/rendering/document-preview";

function collectLinks(node: Nodes): Link[] {
  if (node.type === "link") return [node];
  if (!("children" in node)) return [];
  return node.children.flatMap(collectLinks);
}

function links(source: string): Link[] {
  return collectLinks(parseRichMarkdown(source).root);
}

describe("local paths require explicit Markdown links", () => {
  it.each([
    "/tmp/report.html", "/etc/hosts", "/a", "./README", "../docs/report.md",
    "src/rendering/Screen.tsx:42:7", "/tmp/неизвестный.custom", "/tmp/foo_bar/a(copy).txt",
    "src/components/", "input/output", "and/or", "a / b", "1/2", "application/json", "//host/file.html",
  ])("leaves path-shaped prose as text: %s", (path) => {
    const source = `Open ${path} please`;
    expect(links(source)).toEqual([]);
    expect(plainRichMarkdownText(source)).toBe(source);
  });

  it.each(["`/tmp/My file #1?100%.html`", '"/tmp/My file #1?100%.html"', "«/tmp/My file #1?100%.html»", "`./src/a.ts:4`"])("does not link quoted paths or inline code: %s", (source) => {
    expect(links(source)).toEqual([]);
  });

  it("keeps inline code instead of wrapping it in a file link", () => {
    expect(parseRichMarkdown("`/tmp/report.html`").root.children).toEqual([
      { type: "paragraph", children: [{ type: "inlineCode", value: "/tmp/report.html" }] },
    ]);
  });

  it("does not swallow explicit Markdown syntax inside path-shaped prose", () => {
    expect(links("/tmp/foo_bar/a[b](copy).txt").map((link) => link.url)).toEqual(["copy"]);
    expect(links("`/tmp/foo_bar/a[b](copy).txt`")).toEqual([]);
  });

  it.each([
    ["[report](/tmp/report.html)", "/tmp/report.html"],
    ["[source](src/rendering/Screen.tsx:42:7)", "/repo/src/rendering/Screen.tsx"],
    ["[My file](</tmp/My file.md>)", "/tmp/My file.md"],
  ])("preserves intentional local file links: %s", (source, path) => {
    const result = links(source);
    expect(result).toHaveLength(1);
    expect(resolvePreviewableDocumentLink(result[0]!.url, "/repo")?.path).toBe(path);
    if (source.includes(":42:7")) expect(resolvePreviewableDocumentLink(result[0]!.url, "/repo")).toMatchObject({ line: 42, column: 7 });
  });

  it("preserves external URLs, images and explicit links", () => {
    const source = "[/tmp/label.html](https://example.com/report) https://example.com/tmp/report.html ![picture](/tmp/picture.png)";
    const result = links(source);
    expect(result.map((link) => link.url)).toEqual(["https://example.com/report", "https://example.com/tmp/report.html"]);
    for (const link of result) expect(link.children.some((node) => node.type === "link")).toBe(false);
    expect(parseRichMarkdown(source).root.children).toEqual(expect.arrayContaining([
      expect.objectContaining({ children: expect.arrayContaining([expect.objectContaining({ type: "image", url: "/tmp/picture.png" })]) }),
    ]));
  });

  it("applies the same rule to the native HTML/math path", () => {
    const html = parseMessageMarkup("<b>Files</b> /tmp/report.html and `./src/a.ts:4`\n\n```sh\ncat /tmp/report.html\n```\n\n[report](/tmp/report.html)");
    expect(html).toContain("<code>./src/a.ts:4</code>");
    expect(html).toContain('<pre><code class="language-sh">cat /tmp/report.html');
    expect(html).not.toContain('href="./src/a.ts');
    expect(html).not.toContain('cat <a');
    expect(html?.match(/<a\s/gu)).toHaveLength(1);
    expect(html).toContain('href="/tmp/report.html">report</a>');
  });
});
