import { describe, expect, it } from "vitest";
import { turnChangedFiles, turnItemChanges } from "../src/rendering/turn-changes";

describe("historical turn changes", () => {
  it("loads recorded additions lazily without reading today's worktree and excludes rejected edits", () => {
    expect(turnItemChanges([
      { id: "created", type: "fileChange", status: "completed", changes: [{ path: "/project/new.ts", kind: { type: "add" }, diff: "first\nsecond\n" }] },
      { id: "rejected", type: "fileChange", status: "declined", changes: [{ path: "/project/no.ts", kind: { type: "delete" }, diff: "no\n" }] },
      { id: "pending", type: "fileChange", status: "inProgress", changes: [{ path: "/project/pending.ts", kind: { type: "add" }, diff: "pending\n" }] },
    ])).toEqual([{
      path: "/project/new.ts",
      patch: "+first\n+second",
      kind: "add",
      itemId: "created",
      additions: 2,
      deletions: 0,
    }]);
  });
  it("keeps exact turn patches and counts changed lines without file headers", () => {
    const first = "diff --git a/a.ts b/a.ts\n--- a/a.ts\n+++ b/a.ts\n@@ -1 +1 @@\n-before\n+after\n";
    const second = "diff --git a/gone.txt b/gone.txt\n--- a/gone.txt\n+++ /dev/null\n@@ -1 +0,0 @@\n-removed\n";
    expect(turnChangedFiles(first + second)).toEqual([
      { path: "a.ts", patch: first, kind: "update", itemId: "recorded-diff:0", additions: 1, deletions: 1 },
      { path: "gone.txt", patch: second, kind: "delete", itemId: "recorded-diff:1", additions: 0, deletions: 1 },
    ]);
  });
  it("does not invent changes when a turn has no recorded diff", () => {
    expect(turnChangedFiles("")).toEqual([]);
  });
});
