import { parseRichMarkdown } from "@codewide/rendering-core";
import { plainMarkdownTable } from "../src/rendering/plainMarkdownTable";
import { describe, expect, it } from "vitest";

import { markdownTableLayout } from "../src/rendering/markdown-table-layout";

describe("markdown table layout", () => {
  it("fills the whole bubble when columns fit", () => {
    expect(markdownTableLayout(360, 2)).toEqual({ tableWidth: 360, cellWidth: 180 });
  });

  it("keeps readable columns and overflows horizontally when they do not fit", () => {
    expect(markdownTableLayout(360, 4)).toEqual({ tableWidth: 576, cellWidth: 144 });
  });
});

describe("plain chat tables", () => {
  function readTable(source: string) {
    const node = parseRichMarkdown(source).root.children[0];
    if (node?.type !== "table") throw new Error("Fixture must parse as a Markdown table");
    return node;
  }

  it("preserves empty cells, Unicode, repeated values and column alignments", () => {
    expect(
      plainMarkdownTable(readTable("| A | B | C | D |\n|---|:---:|---:|---|\n|同| |同|🌱 🌿|")),
    ).toEqual({
      alignments: ["left", "center", "right", "left"],
      cells: ["A", "B", "C", "D", "同", "", "同", "🌱 🌿"],
      rowCount: 2,
    });
  });

  it.each(["[link](https://example.org)", "**bold**", "`code`", "![caption](image.png)"])(
    "retains the rich renderer for %s",
    (cell) =>
      expect(plainMarkdownTable(readTable(`| A | B |\n|---|---|\n| x | ${cell} |`))).toBeNull(),
  );

  it("leaves ragged and unusually large tables on the existing renderer", () => {
    const parsed = readTable("| A | B |\n|---|---|\n| single |");
    expect(plainMarkdownTable(parsed)?.cells).toEqual(["A", "B", "single", ""]);
    const [header] = parsed.children;
    if (!header) throw new Error("Missing header");
    expect(
      plainMarkdownTable({
        ...parsed,
        children: [header, { type: "tableRow", children: [] }],
      }),
    ).toBeNull();
    expect(
      plainMarkdownTable(readTable("| A | B |\n|---|---|\n" + "| 1 | 2 |\n".repeat(100))),
    ).toBeNull();
    expect(
      plainMarkdownTable(readTable("| A | B |\n|---|---|\n| x | " + "字".repeat(40_000) + " |")),
    ).toBeNull();
  });
});
