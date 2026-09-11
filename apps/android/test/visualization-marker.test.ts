import { describe, expect, it } from "vitest";
import { parseRichMarkdown, plainRichMarkdownText, projectCompleteMarkdown } from "@codewide/rendering-core";
import { parseMessageMarkup } from "@codewide/rendering-core/markup";
import { documentPreviewSurface, resolvePreviewableDocumentLink } from "../src/rendering/document-preview";

function marker(path: string): string {
  return `\uE200visualize\uE202${JSON.stringify({ path })}\uE201`;
}

describe("visualization file markers", () => {
  it("opens the supplied HTML in the same fullscreen surface as an attached HTML file", () => {
    const path = "/home/sergeigarin/Documents/Codex/2026-08-09-open-source-chatgpt-like-remote-connection/work/project-sidebar-study.html";
    const paragraph = parseRichMarkdown(marker(path)).root.children[0];
    expect(paragraph?.type).toBe("paragraph");
    if (paragraph?.type !== "paragraph") throw new Error("Expected paragraph");
    const link = paragraph.children[0];
    expect(link?.type).toBe("link");
    if (link?.type !== "link") throw new Error("Expected visualization link");
    const target = resolvePreviewableDocumentLink(link.url, "/ignored");
    expect(target).toEqual({ kind: "html", path, name: "project-sidebar-study.html" });
    expect(target).toEqual(resolvePreviewableDocumentLink(path, "/ignored"));
    if (target === null) throw new Error("Expected local HTML target");
    expect(documentPreviewSurface(target.kind)).toBe("fullscreen");
    expect(plainRichMarkdownText(marker(path))).toBe("Open visualization · project-sidebar-study.html");
  });

  it.each(["nested/demo.html", "../demo.htm", "nested/demo.xhtml", "nested/demo.HTML"])(
    "uses the ordinary HTML target for a relative visualization: %s", (path) => {
      const paragraph = parseRichMarkdown(marker(path)).root.children[0];
      if (paragraph?.type !== "paragraph") throw new Error("Expected paragraph");
      const link = paragraph.children[0];
      if (link?.type !== "link") throw new Error("Expected visualization link");
      const target = resolvePreviewableDocumentLink(link.url, "/repo/work");
      expect(target).toEqual(resolvePreviewableDocumentLink(path, "/repo/work"));
      if (target === null) throw new Error("Expected HTML target");
      expect(documentPreviewSurface(target.kind)).toBe("fullscreen");
    },
  );

  it("preserves surrounding text, multiple markers and special filename characters", () => {
    const path = "/tmp/a #b?100% [demo]_ю.html";
    const paragraph = parseRichMarkdown(`Before ${marker(path)} between ${marker("work/second.htm")} after`).root.children[0];
    if (paragraph?.type !== "paragraph") throw new Error("Expected paragraph");
    const links = paragraph.children.filter((node) => node.type === "link");
    expect(links).toHaveLength(2);
    expect(resolvePreviewableDocumentLink(links[0]!.url, "/repo")?.path).toBe(path);
    expect(resolvePreviewableDocumentLink(links[1]!.url, "/repo")?.path).toBe("/repo/work/second.htm");
    expect(plainRichMarkdownText(`Before ${marker(path)} after`)).toBe("Before Open visualization · a #b?100% [demo]_ю.html after");
  });

  it("also renders links in native HTML/math messages without injecting filename HTML", () => {
    const html = parseMessageMarkup(`<details><summary>Preview</summary>\n\n${marker("/tmp/<img src=x>.html")}\n\n</details>`);
    expect(html).toContain("<a href=");
    expect(html).toContain("#codewide-visualization");
    expect(html).toContain("&lt;img src=x&gt;.html");
    expect(html).not.toContain("<img src=x>");
    expect(html).not.toContain("\uE200visualize");
  });

  it("keeps code examples literal", () => {
    const value = marker("/tmp/demo.html");
    const root = parseRichMarkdown(`\`${value}\`\n\n\`\`\`text\n${value}\n\`\`\``).root;
    expect(root.children).toEqual([
      { type: "paragraph", children: [{ type: "inlineCode", value }] },
      { type: "code", value, lang: "text" },
    ]);
  });

  it.each(["{", "{}", "null", '{"path":42}', '{"path":"https://host/demo.html"}', '{"path":"//host/demo.html"}', '{"path":"/tmp/demo.png"}', '{"path":"/tmp/\\u0000.html"}', '{"path":"/tmp/\\ud800.html"}'])("keeps invalid payload literal: %s", (payload) => {
    const source = `\uE200visualize\uE202${payload}\uE201`;
    expect(plainRichMarkdownText(source)).toBe(source);
  });

  it("does not activate an incomplete marker and activates it once complete", () => {
    const source = marker("/tmp/demo.html");
    expect(plainRichMarkdownText(source.slice(0, -1))).toBe(source.slice(0, -1));
    const rendered = projectCompleteMarkdown(source).map(plainRichMarkdownText).join("");
    expect(rendered).toBe("Open visualization · demo.html");
  });
});
