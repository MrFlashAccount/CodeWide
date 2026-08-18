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
