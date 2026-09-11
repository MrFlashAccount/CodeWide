import { describe, expect, it } from "vitest";

import { parseRichMarkdown, projectLiveMarkdownTail } from "@codewide/rendering-core";

describe("live Markdown semantic projection", () => {
  it("publishes plain text immediately so native glyph animation owns its pacing", () => {
    expect(projectLiveMarkdownTail("Hello streaming wor")).toEqual({
      visible: "Hello streaming wor",
      pending: "",
    });
    expect(projectLiveMarkdownTail("Hello streaming word ")).toEqual({
      visible: "Hello streaming word ",
      pending: "",
    });
  });

  it("reveals a completed sentence without waiting for the stream stop event", () => {
    expect(projectLiveMarkdownTail("This fix will ship.")).toEqual({
      visible: "This fix will ship.",
      pending: "",
    });
    expect(projectLiveMarkdownTail("Is it ready?”")).toEqual({
      visible: "Is it ready?”",
      pending: "",
    });
    expect(projectLiveMarkdownTail("Still stream")).toEqual({
      visible: "Still stream",
      pending: "",
    });
  });

  it("holds unresolved inline Markdown instead of flashing its source", () => {
    expect(projectLiveMarkdownTail("Hello [long link tex")).toEqual({
      visible: "Hello ",
      pending: "[long link tex",
    });
    expect(projectLiveMarkdownTail("Hello [long link text](https://example.com)")).toEqual({
      visible: "Hello [long link text](https://example.com)",
      pending: "",
    });
    expect(projectLiveMarkdownTail("Hello [unfinished link.")).toEqual({
      visible: "Hello ",
      pending: "[unfinished link.",
    });
  });

  it("does not let unresolved references hide subsequent blocks", () => {
    expect(projectLiveMarkdownTail("[documentation][docs]\n\n")).toEqual({
      visible: "[documentation][docs]\n\n",
      pending: "",
    });
    expect(projectLiveMarkdownTail("[documentation][docs]\n\nAnother paragraph ")).toEqual({
      visible: "[documentation][docs]\n\nAnother paragraph ",
      pending: "",
    });

    const resolved = "[documentation][docs]\n\n[docs]: https://example.com";
    expect(projectLiveMarkdownTail(resolved)).toEqual({ visible: resolved, pending: "" });
    const paragraph = parseRichMarkdown(resolved).root.children[0];
    expect(paragraph?.type).toBe("paragraph");
    if (paragraph?.type === "paragraph") expect(paragraph.children[0]?.type).toBe("link");
  });

  it.each([
    "Literal [brackets with no link", "```ts\nconst x = 1;\n```",
    "```mermaid\ngraph TD\nA --> B\n```", "| Name | Value |\n| --- | --- |\n| one | 1 |",
  ])("keeps streaming after a completed block: %s", (block) => {
    const source = `Before\n\n${block}\n\nAfter, still arriv`;
    expect(projectLiveMarkdownTail(source)).toEqual({ visible: source, pending: "" });
  });

  it("does not flash a potential GFM table header", () => {
    expect(projectLiveMarkdownTail("| Name | Value |\n")).toEqual({
      visible: "",
      pending: "| Name | Value |\n",
    });
    const projected = projectLiveMarkdownTail("| Name | Value |\n| --- | --- |\n");
    expect(projected.pending).toBe("");
    expect(parseRichMarkdown(projected.visible).root.children[0]?.type).toBe("table");
  });

  it("commits complete table rows and holds the row still being written", () => {
    const source = "| Name | Value |\n| --- | --- |\n| one | 1 |\n| tw";
    const projected = projectLiveMarkdownTail(source);

    expect(projected.visible).toBe("| Name | Value |\n| --- | --- |\n| one | 1 |\n");
    expect(projected.pending).toBe("| tw");
    const table = parseRichMarkdown(projected.visible).root.children[0];
    expect(table?.type).toBe("table");
    if (table?.type === "table") expect(table.children).toHaveLength(2);
  });

  it("keeps Mermaid atomic until its closing fence arrives", () => {
    const partial = "Before\n\n```mermaid\ngraph TD\n  A --> B";
    expect(projectLiveMarkdownTail(partial)).toEqual({
      visible: "Before\n\n",
      pending: "```mermaid\ngraph TD\n  A --> B",
    });

    const complete = `${partial}\n\`\`\`\n`;
    expect(projectLiveMarkdownTail(complete)).toEqual({ visible: complete, pending: "" });
  });

  it("streams ordinary fenced code only by complete lines", () => {
    const source = "```ts\nconst first = 1;\nconst sec";
    expect(projectLiveMarkdownTail(source)).toEqual({
      visible: "```ts\nconst first = 1;\n",
      pending: "const sec",
    });
  });

  it("flushes malformed or unfinished syntax when the response completes", () => {
    const source = "Hello [unfinished";
    expect(projectLiveMarkdownTail(source, true)).toEqual({ visible: source, pending: "" });
  });
});
