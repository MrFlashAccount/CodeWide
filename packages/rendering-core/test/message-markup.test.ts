import { describe, expect, it } from "vitest";
import { DomUtils, parseDocument } from "htmlparser2";
import { parseMessageMarkup, highlightMessageMarkup, messageMarkupNodeHtml } from "../src/message-markup";
import { parseRichMarkdown, plainRichMarkdownText } from "../src/markdown-ast";
import { renderMessageMath } from "../src/message-math";

function elements(html: string, tag: string) {
  return DomUtils.getElementsByTagName(tag, parseDocument(html).children, true);
}

describe("native message markup", () => {
  it("highlights visible text without rewriting link targets, entities or attributes", () => {
    const html = '<p>needle &amp; value <a href="/needle?q=needle">Needle link</a></p>';
    const highlighted = highlightMessageMarkup(html, "needle");
    expect(DomUtils.textContent(parseDocument(highlighted))).toBe("needle & value Needle link");
    expect(elements(highlighted, "mark")).toHaveLength(2);
    expect(elements(highlighted, "a")[0]?.attribs.href).toBe("/needle?q=needle");
    expect(highlightMessageMarkup(html, "")).toBe(html);
  });
  it("keeps the ordinary Markdown fast path, literal HTML/code and currency unchanged", () => {
    for (const source of ["**Hello**", "`<details>literal</details>`", "```html\n<b>literal</b>\n```", "Costs $5 and $10", "Escaped \\$x$", "&lt;b&gt;literal&lt;/b&gt;"]) {
      expect(parseMessageMarkup(source), source).toBeNull();
    }
  });
  it("preserves details nesting, initial open state and mixed markdown", () => {
    const nodes = parseMessageMarkup('<details open><summary>Outer</summary>\n\n**bold**\n\n<details><summary>Inner</summary>Text</details>\n</details>')!;
    const details = elements(nodes, "details");
    expect(details).toHaveLength(2);
    expect(details[0]?.attribs).toHaveProperty("open");
    expect(elements(nodes, "strong")).toHaveLength(1);
    expect(DomUtils.textContent(parseDocument(nodes))).toContain("Inner");
  });
  it("keeps pre whitespace, decodes entities exactly once and keeps table spans", () => {
    const nodes = parseMessageMarkup('<pre><code class="language-ts">  x &lt; 3\n    y &amp;amp; z</code></pre>\n<table><tr><th colspan="2">Head</th></tr><tr><td>A</td><td>B</td></tr></table>')!;
    expect(elements(nodes, "code")[0]?.attribs.class).toBe("language-ts");
    expect(DomUtils.textContent(elements(nodes, "pre")[0]!)).toBe("  x < 3\n    y &amp; z");
    expect(elements(nodes, "th")[0]?.attribs.colspan).toBe("2");
  });
  it("recognizes all four math delimiters and math fences without changing code literals", () => {
    const nodes = parseMessageMarkup('Inline $x^2$ and \\(y_1\\).\n\n$$\\frac{1}{2}$$\n\n\\[\\sqrt{x}\\]\n\n```latex\na+b\n```')!;
    expect(elements(nodes, "cw-inline-math")).toHaveLength(2);
    expect(elements(nodes, "cw-display-math")).toHaveLength(3);
  });
  it("keeps unfinished streamed details content inside the disclosure", () => {
    const nodes = parseMessageMarkup("<details><summary>Working</summary>\n\nPartial **answer**")!;
    expect(elements(nodes, "details")).toHaveLength(1);
    expect(DomUtils.textContent(elements(nodes, "details")[0]!)).toContain("answer");
  });
  it("keeps Markdown as the document owner and isolates only HTML-bearing blocks", () => {
    const source = "# Head\n\nBefore <mark>hot</mark> after.\n\n<details>\n<summary>More</summary>\n\n**inside**\n\n</details>\n\nTail **bold**.";
    const blocks = parseRichMarkdown(source, false).root.children;
    expect(blocks.map((block) => block.type)).toEqual(["heading", "html", "html", "paragraph"]);
    const inlineMarkup = blocks[1];
    const details = blocks[2];
    if (inlineMarkup?.type !== "html" || details?.type !== "html") throw new Error("Expected isolated HTML widgets");
    expect(messageMarkupNodeHtml(inlineMarkup)).toBe("<p>Before <mark>hot</mark> after.</p>\n");
    expect(messageMarkupNodeHtml(details)).toContain("<details>");
    expect(messageMarkupNodeHtml(details)).toContain("<strong>inside</strong>");
    expect(plainRichMarkdownText(source)).toBe("Head\nBefore hot after.\n\nMoreinside\n\nTail bold.");
  });
  it("does not promote a large mixed Markdown document into one HTML tree", () => {
    const paragraphs = Array.from({ length: 120 }, (_, index) => `Paragraph ${index} with **Markdown**.`);
    paragraphs.splice(60, 0, "<details>\n<summary>More</summary>\n\nInside\n\n</details>");
    const blocks = parseRichMarkdown(paragraphs.join("\n\n"), false).root.children;
    const markup = blocks.filter((block) => block.type === "html");
    expect(blocks).toHaveLength(121);
    expect(markup).toHaveLength(1);
    expect(markup[0]?.type === "html" ? messageMarkupNodeHtml(markup[0]) : null).toContain("<details>");
  });
});

describe("offline vector math", () => {
  it.each(["x^2+y_1", "\\frac{1}{2}", "\\sqrt{x}", "\\sum_{i=1}^{n} i", "\\begin{pmatrix}a&b\\\\c&d\\end{pmatrix}"])("typesets %s without HTML or external fonts", (source) => {
    const result = renderMessageMath(source, true, 14);
    expect(result.status).toBe("ready");
    if (result.status !== "ready") return;
    expect(result.width).toBeGreaterThan(0);
    expect(result.height).toBeGreaterThan(0);
    expect(result.svg).toContain("<path");
    expect(result.svg).not.toContain("<foreignObject");
    expect(result.svg).not.toContain("<script");
  });
  it("preserves unsupported or malformed source instead of crashing or losing it", () => {
    for (const source of ["\\unknown{1}", "\\frac{", "\\href{javascript:evil()}{x}", "\\require{html}"]) {
      expect(renderMessageMath(source, false, 14)).toEqual({ status: "invalid", source });
    }
  });
  it("isolates macro definitions between messages", () => {
    expect(renderMessageMath("\\newcommand{\\private}{x}\\private", false, 14).status).toBe("ready");
    expect(renderMessageMath("\\private", false, 14).status).toBe("invalid");
  });
});
