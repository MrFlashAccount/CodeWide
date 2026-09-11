import { describe, expect, it } from "vitest";

import { parseThreadTurnsListPage } from "../src/data/thread-turns-list-page";

const turn = {
  id: "turn",
  status: "completed",
  items: [],
};

describe("thread turns list page", () => {
  it("validates turns and a usable continuation before persistence", () => {
    expect(parseThreadTurnsListPage({ data: [turn], nextCursor: "older" }, null))
      .toEqual({ turns: [turn], nextCursor: "older" });
  });

  it.each([
    null,
    {},
    { data: [], nextCursor: 42 },
    { data: [null], nextCursor: null },
    { data: [], nextCursor: "" },
    { data: [], nextCursor: "requested" },
  ])("rejects a malformed or non-advancing page %#", (value) => {
    expect(() => parseThreadTurnsListPage(value, "requested")).toThrow("invalid history page");
  });
});
