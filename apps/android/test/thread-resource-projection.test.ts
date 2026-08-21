import { describe, expect, it } from "vitest";

import { projectThreadResourcePatch } from "../src/data/thread-resource-projection";
import type { ThreadResourcesValue } from "../src/data/workspace-resource-database";

const EMPTY: ThreadResourcesValue = {
  threadId: "thread-1",
  revision: "initial",
  changeScope: "branch",
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
});
