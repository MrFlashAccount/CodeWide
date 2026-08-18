import { describe, expect, it } from "vitest";

import { mergeChronologicalTimeline, protocolTimestampMs } from "../src/rendering/optimistic-timeline";

describe("optimistic timeline ordering", () => {
  it("places an optimistic message before a newer remote turn", () => {
    const result = mergeChronologicalTimeline(
      [
        { value: "remote-1", timestampMs: 1_000 },
        { value: "remote-2", timestampMs: 3_000 },
      ],
      [{ value: "local", timestampMs: 2_000 }],
    );
    expect(result).toEqual(["remote-1", "local", "remote-2"]);
  });

  it("preserves remote order and keeps undated local rows at the end", () => {
    const result = mergeChronologicalTimeline(
      [
        { value: "remote-b", timestampMs: 2_000 },
        { value: "remote-a", timestampMs: 1_000 },
      ],
      [{ value: "local", timestampMs: null }],
    );
    expect(result).toEqual(["remote-b", "remote-a", "local"]);
  });

  it("normalizes protocol seconds without changing millisecond timestamps", () => {
    expect(protocolTimestampMs(1_786_647_000)).toBe(1_786_647_000_000);
    expect(protocolTimestampMs(1_786_647_000_123)).toBe(1_786_647_000_123);
    expect(protocolTimestampMs(null)).toBeNull();
  });
});
