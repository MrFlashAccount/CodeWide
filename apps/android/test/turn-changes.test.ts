import { describe, expect, it } from "vitest";
import { turnChangedFiles, turnItemChanges } from "../src/rendering/turn-changes";
import {
  loadRecordedTurnChanges,
  recordedTurnChangeDiff,
} from "../src/features/changes/changePresentation";

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
  it("loads full recorded patches when a turn-wide diff preview ends inside a hunk", async () => {
    const target = { connectionId: "server", threadId: "thread", turnId: "turn" };
    const preview =
      "diff --git a/file.ts b/file.ts\n--- a/file.ts\n+++ b/file.ts\n@@ -1,2 +1,2 @@\n-old\n… [25000 bytes; full content available]\n+new\n";
    expect(turnChangedFiles(preview)).toEqual([]);
    const full = turnItemChanges([
      {
        id: "edit",
        type: "fileChange",
        status: "completed",
        changes: [
          {
            path: "file.ts",
            kind: { type: "update" },
            diff: "--- a/file.ts\n+++ b/file.ts\n@@ -1 +1 @@\n-old\n+new\n",
          },
        ],
      },
    ]);
    const files = await loadRecordedTurnChanges({
      knownFiles: turnChangedFiles(preview),
      loadTurnChanges: async () => full,
      target,
    });
    expect(recordedTurnChangeDiff(target, files, "file.ts").patches).toEqual([
      expect.objectContaining({
        diff: "--- a/file.ts\n+++ b/file.ts\n@@ -1 +1 @@\n-old\n+new\n",
      }),
    ]);
  });
  it("keeps a complete turn-wide diff when edits have no fileChange items", async () => {
    const target = { connectionId: "server", threadId: "thread", turnId: "turn" };
    const knownFiles = turnChangedFiles(
      "diff --git a/file.ts b/file.ts\n--- a/file.ts\n+++ b/file.ts\n@@ -1 +1 @@\n-old\n+new\n",
    );
    expect(
      await loadRecordedTurnChanges({
        knownFiles,
        loadTurnChanges: async () => [],
        target,
      }),
    ).toEqual(knownFiles);
    expect(turnChangedFiles("diff --git a/file.ts b/file.ts\n… [earlier live output omitted] …\n")).toEqual([]);
    expect(
      await loadRecordedTurnChanges({
        knownFiles,
        loadTurnChanges: async () => {
          throw new Error("offline");
        },
        target,
      }),
    ).toEqual(knownFiles);
  });
});
