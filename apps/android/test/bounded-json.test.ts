import { describe, expect, it } from "vitest";

import { boundedJsonStringify } from "../src/rendering/bounded-json";

describe("boundedJsonStringify", () => {
  it("does not materialize an unbounded protocol preview", () => {
    const preview = boundedJsonStringify({ output: "x".repeat(2_000_000) }, 2_048);

    expect(preview.length).toBeLessThanOrEqual(2_048);
    expect(preview).toContain("truncated");
  });

  it("handles cycles without throwing", () => {
    const value: { self?: unknown } = {};
    value.self = value;

    expect(boundedJsonStringify(value)).toContain("circular");
  });
});
