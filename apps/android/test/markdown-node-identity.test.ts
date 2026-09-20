import { describe, expect, it } from "vitest";
import type { Paragraph } from "mdast";

import { markdownNodeIdentity } from "../src/rendering/markdownNodeIdentity";

describe("streaming Markdown node identity", () => {
  it("keeps a growing block mounted while its end offset changes", () => {
    const first: Paragraph = {
      children: [],
      position: {
        end: { column: 12, line: 1, offset: 11 },
        start: { column: 1, line: 1, offset: 0 },
      },
      type: "paragraph",
    };
    const next: Paragraph = {
      children: [],
      position: {
        end: { column: 22, line: 1, offset: 21 },
        start: { column: 1, line: 1, offset: 0 },
      },
      type: "paragraph",
    };

    expect(first.position?.end.offset).not.toBe(next.position?.end.offset);
    expect(markdownNodeIdentity(first, "first")).toBe(markdownNodeIdentity(next, "next"));
  });

  it("keeps distinct source positions distinct", () => {
    const first: Paragraph = {
      children: [],
      position: {
        end: { column: 6, line: 1, offset: 5 },
        start: { column: 1, line: 1, offset: 0 },
      },
      type: "paragraph",
    };
    const second: Paragraph = {
      children: [],
      position: {
        end: { column: 7, line: 3, offset: 13 },
        start: { column: 1, line: 3, offset: 7 },
      },
      type: "paragraph",
    };

    expect(markdownNodeIdentity(first, "first")).not.toBe(markdownNodeIdentity(second, "second"));
  });
});
