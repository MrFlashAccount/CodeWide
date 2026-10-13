/**
 * Linking a session's history across compactions: the boundary Claude
 * writes without a parent continues the message the preserved messages
 * followed, else its logical parent.
 */

import { describe, expect, it } from "vitest";
import { linkAcrossCompactions, type TranscriptRow } from "../src/claude/compactionLinks.js";

const message = (uuid: string, parentUuid: string | null): TranscriptRow => ({
  parentUuid,
  type: "user",
  uuid,
});

const boundary = (compactMetadata: Readonly<Record<string, unknown>>): TranscriptRow => ({
  compactMetadata,
  logicalParentUuid: "kept",
  parentUuid: null,
  subtype: "compact_boundary",
  type: "system",
  uuid: "boundary",
});

const parentOf = (rows: readonly TranscriptRow[], uuid: string): unknown =>
  rows.find((row) => row.uuid === uuid)?.["parentUuid"];

describe("history across compactions", () => {
  const before = [
    message("old", null),
    message("last-before", "old"),
    message("kept", "last-before"),
  ];

  it("continues the message the preserved messages followed", () => {
    const rows = linkAcrossCompactions([
      ...before,
      boundary({ preservedMessages: { anchorUuid: "summary", uuids: ["kept"] } }),
      message("summary", "boundary"),
    ]);
    expect(parentOf(rows, "boundary")).toBe("last-before");
  });

  it("reads the former preserved segment the same way", () => {
    const rows = linkAcrossCompactions([
      ...before,
      boundary({ preservedSegment: { anchorUuid: "summary", headUuid: "kept", tailUuid: "kept" } }),
    ]);
    expect(parentOf(rows, "boundary")).toBe("last-before");
  });

  it("falls back to the logical parent without preserved messages", () => {
    const rows = linkAcrossCompactions([...before, boundary({ trigger: "auto" })]);
    expect(parentOf(rows, "boundary")).toBe("kept");
  });

  it("leaves linked boundaries, unknown parents and other rows as they are", () => {
    const linked = { ...boundary({}), parentUuid: "old" };
    const orphan = { ...boundary({}), logicalParentUuid: "missing", uuid: "orphan" };
    const rows = linkAcrossCompactions([...before, linked, orphan]);
    expect(rows[3]).toBe(linked);
    expect(rows[4]).toBe(orphan);
    expect(rows.slice(0, 3)).toEqual(before);
    expect(rows[0]).toBe(before[0]);
  });
});
