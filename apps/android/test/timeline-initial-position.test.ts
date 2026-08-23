import { describe, expect, it } from "vitest";

import { legendInitialPositionProps } from "../src/rendering/timeline-initial-position";

describe("LegendList initial position", () => {
  it("uses the live tail without also supplying an item index", () => {
    expect(legendInitialPositionProps({ kind: "tail" })).toEqual({ initialScrollAtEnd: true });
  });

  it("restores an item at its exact viewport offset without tail mode", () => {
    expect(legendInitialPositionProps({ kind: "item", index: 7, viewOffset: 31.5, viewPosition: 0 })).toEqual({
      initialScrollIndex: { index: 7, viewOffset: 31.5, viewPosition: 0 },
    });
  });
});
