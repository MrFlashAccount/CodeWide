import { describe, expect, it } from "vitest";
import { plainRichMarkdownRootText } from "@codewide/rendering-core";

import { markdownDocumentBlocks, markdownDocumentTargetIndex } from "../src/rendering/markdown-document-blocks";

describe("Markdown document viewport", () => {
  it("retains headings, complete tables, links and fenced code in reading order", () => {
    const blocks = markdownDocumentBlocks([
      "# Research\n\nRead [details](./details.md).\n\n| Name | Result |\n| --- | --- |\n| Alpha | Valid |\n| Beta | Pending |\n",
      "## Diagram\n\n```mermaid\ngraph TD\nA --> B\n```\n\nFinal paragraph.",
    ]);
    expect(blocks.map((block) => block.node.type)).toEqual(["heading", "paragraph", "table", "heading", "code", "paragraph"]);
    expect(blocks.map((block) => plainRichMarkdownRootText(block.node)).join("\n")).toContain("Final paragraph.");
    const paragraph = blocks.find((block) => block.node.type === "paragraph")?.node;
    expect(paragraph).toMatchObject({ children: expect.arrayContaining([expect.objectContaining({ type: "link", url: "./details.md" })]) });
    const table = blocks.find((block) => block.node.type === "table")?.node;
    expect(table?.type === "table" ? table.children.length : 0).toBe(3);
    expect(blocks.find((block) => block.node.type === "code")?.node).toMatchObject({ lang: "mermaid", value: "graph TD\nA --> B" });
  });

  it("preserves existing review addresses and image ordering across virtualized blocks", () => {
    const blocks = markdownDocumentBlocks(["# Title\n\n![First](one.png)\n\n![Second](two.png)"]);
    // Review comments already refer to segment/type-index paths; viewport changes must not orphan them.
    expect(blocks.map((block) => `${block.reviewPathPrefix}/${block.path}`)).toEqual([
      "segment-0/heading-0", "segment-0/paragraph-1", "segment-0/paragraph-2",
    ]);
    const imageOrders: number[] = [];
    for (const block of blocks) {
      if (block.node.type !== "paragraph") continue;
      for (const child of block.node.children) {
        if (child.type === "image") imageOrders.push(block.imageOrder.get(child)!);
      }
    }
    expect(imageOrders).toEqual([0, 1]);
  });

  it("opens a source-line target in its document block instead of mounting the preceding document", () => {
    const segments = ["# First\n\nParagraph.\n", "# Later\n\n| A | B |\n| --- | --- |\n| x | y |\n\nTail"];
    const blocks = markdownDocumentBlocks(segments);
    const index = markdownDocumentTargetIndex(blocks, segments, { segmentIndex: 1, line: 5 });
    expect(blocks[index]?.node.type).toBe("table");
    expect(blocks[index]?.segmentIndex).toBe(1);
    expect(markdownDocumentTargetIndex(blocks, segments, null)).toBe(0);
    expect(markdownDocumentTargetIndex([], [], null)).toBe(0);
  });
});
