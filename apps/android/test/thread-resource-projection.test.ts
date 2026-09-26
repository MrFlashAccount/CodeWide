import { describe, expect, it } from "vitest";

import { projectThreadResourcePatch } from "../src/data/thread-resource-projection";
import {
  effectiveSessionKind,
  effectiveThreadChanges,
} from "../src/data/sessionChangeVisibility";
import type { ThreadResourcesValue } from "../src/data/workspace-resource-database";

function firstChange(changes: readonly ThreadResourcesValue["changes"][number][]) {
  const change = changes[0];
  if (change === undefined) {
    throw new Error("Expected one changed file");
  }
  return change;
}

const EMPTY: ThreadResourcesValue = {
  threadId: "thread-1",
  revision: "initial",
  changeScope: "session",
  changeScopes: ["session", "lastTurn", "branch"],
  changes: [],
  attachments: [],
};

describe("thread resource stream projection", () => {
  it("uses pushed file changes without a follow-up resource read", () => {
    const projected = projectThreadResourcePatch(EMPTY, "/workspace/repo", {
      version: 1,
      threadId: "thread-1",
      operation: {
        kind: "fileChanges",
        turnId: "turn-1",
        itemId: "item-1",
        changes: [{
          path: "src/index.ts",
          kind: { type: "update", move_path: null },
          diff: "@@ -1 +1 @@\n-old\n+new",
        }],
      },
    }, 42);

    expect(projected).toMatchObject({
      revision: "event.42",
      changes: [{
        path: "/workspace/repo/src/index.ts",
        kind: "update",
        availability: "available",
        additions: 1,
        deletions: 1,
        turnId: "turn-1",
        itemId: "item-1",
      }],
    });
  });

  it("replaces a repeated patch for the same item instead of double counting it", () => {
    const first = projectThreadResourcePatch(EMPTY, "/workspace/repo", {
      version: 1,
      threadId: "thread-1",
      operation: {
        kind: "fileChanges",
        turnId: "turn-1",
        itemId: "item-1",
        changes: [{ path: "file.ts", kind: { type: "add" }, diff: "one\n" }],
      },
    }, 1);
    const second = projectThreadResourcePatch(first, "/workspace/repo", {
      version: 1,
      threadId: "thread-1",
      operation: {
        kind: "fileChanges",
        turnId: "turn-1",
        itemId: "item-1",
        changes: [{ path: "file.ts", kind: { type: "add" }, diff: "one\ntwo\n" }],
      },
    }, 2);

    expect(second.changes).toHaveLength(1);
    expect(second.changes[0]?.additions).toBe(2);
  });

  it("removes a file created then deleted in the session and restores it after re-creation", () => {
    const event = (kind: "add" | "update" | "delete", itemId: string) => ({
      version: 1 as const,
      threadId: "thread-1",
      operation: {
        kind: "fileChanges" as const,
        turnId: "turn-1",
        itemId,
        changes: [{ path: "file.ts", kind: { type: kind }, diff: "one\n" }],
      },
    });
    const added = projectThreadResourcePatch(EMPTY, "/workspace/repo", event("add", "create"), 1);
    const edited = projectThreadResourcePatch(
      added,
      "/workspace/repo",
      event("update", "edit"),
      2,
    );
    expect(effectiveSessionKind(firstChange(edited.changes), "session")).toBe("add");
    const removed = projectThreadResourcePatch(
      edited,
      "/workspace/repo",
      event("delete", "remove"),
      3,
    );
    expect(removed.changes[0]?.createdInScope).toBe(true);
    expect(effectiveThreadChanges(removed.changes, "session")).toEqual([]);
    expect(effectiveThreadChanges(removed.changes, "lastTurn")).toHaveLength(1);
    const recreated = projectThreadResourcePatch(
      removed,
      "/workspace/repo",
      event("add", "recreate"),
      4,
    );
    expect(effectiveThreadChanges(recreated.changes, "session")).toHaveLength(1);
    expect(effectiveSessionKind(firstChange(recreated.changes), "session")).toBe("add");
  });

  it("treats a restored pre-existing file as modified rather than newly added", () => {
    const changes = [{
      additions: 2,
      availability: "available" as const,
      createdInScope: false,
      deletions: 1,
      itemId: "restore",
      kind: "add" as const,
      path: "/workspace/file.ts",
      turnId: "turn-2",
    }];
    expect(effectiveSessionKind(firstChange(changes), "session")).toBe("update");
    expect(effectiveThreadChanges(changes, "lastTurn")).toBe(changes);
  });

  it("clears last-turn changes when the next turn starts", () => {
    const previous: ThreadResourcesValue = {
      ...EMPTY,
      changeScope: "lastTurn",
      changes: [{
        path: "/workspace/repo/old.ts",
        kind: "update",
        availability: "available",
        additions: 1,
        deletions: 0,
        turnId: "old-turn",
        itemId: "old-item",
      }],
    };
    const projected = projectThreadResourcePatch(previous, "/workspace/repo", {
      version: 1,
      threadId: "thread-1",
      operation: { kind: "turnStarted", turn: { id: "turn-2", items: [] } },
    }, 3);

    expect(projected.changes).toEqual([]);
  });

  it("does not infer staged changes from a live file event", () => {
    const staged = { ...EMPTY, changeScope: "staged" as const };
    const projected = projectThreadResourcePatch(staged, "/workspace/repo", {
      version: 1,
      threadId: "thread-1",
      operation: {
        kind: "fileChanges",
        turnId: "turn-1",
        itemId: "item-1",
        changes: [{ path: "file.ts", kind: { type: "update", move_path: null }, diff: "+new" }],
      },
    }, 4);

    expect(projected).toBe(staged);
  });

  it("does not add live step changes to the branch comparison", () => {
    const branch = { ...EMPTY, changeScope: "branch" as const };
    const projected = projectThreadResourcePatch(branch, "/workspace/repo", {
      version: 1,
      threadId: "thread-1",
      operation: {
        kind: "fileChanges",
        turnId: "turn-1",
        itemId: "item-1",
        changes: [{ path: "file.ts", kind: { type: "update", move_path: null }, diff: "+new" }],
      },
    }, 5);

    expect(projected).toBe(branch);
    expect(projected.changes).toEqual([]);
  });
});
