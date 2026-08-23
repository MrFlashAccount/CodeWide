import { describe, expect, it } from "vitest";

import { replaceEqualDeep } from "../src/data/replace-equal-deep";

describe("replaceEqualDeep", () => {
  it("returns the previous JSON graph when the next graph is deeply equal", () => {
    const previous = { rows: [{ id: "one", value: 1 }], cursor: null };
    const next = { rows: [{ id: "one", value: 1 }], cursor: null };

    expect(replaceEqualDeep(previous, next)).toBe(previous);
  });

  it("replaces a changed branch and retains equal siblings", () => {
    const previous = {
      changed: { id: "one", value: 1 },
      retained: { id: "two", value: 2 },
    };
    const next = {
      changed: { id: "one", value: 3 },
      retained: { id: "two", value: 2 },
    };

    const result = replaceEqualDeep(previous, next);

    expect(result).not.toBe(previous);
    expect(result.changed).toEqual(next.changed);
    expect(result.changed).not.toBe(previous.changed);
    expect(result.retained).toBe(previous.retained);
  });

  it("treats non-plain values atomically", () => {
    const previous = new Date(1);
    const next = new Date(1);

    expect(replaceEqualDeep(previous, next)).toBe(next);
  });
});
