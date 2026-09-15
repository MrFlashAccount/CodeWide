import { describe, expect, it } from "vitest";
import { recordedTurnChangeDiff, recordedTurnResourcesValue } from "../src/features/changes/changePresentation";
import { turnItemChanges } from "../src/rendering/turn-changes";

const target = { connectionId: "server", threadId: "thread", turnId: "turn" };

describe("recorded change presentation", () => {
  it("aggregates each file while retaining the recorded patch order and terminal deletion", () => {
    const files = turnItemChanges([
      { id: "first", type: "fileChange", status: "completed", changes: [{ path: "/repo/a.ts", kind: { type: "add" }, diff: "one\ntwo\n" }] },
      { id: "second", type: "fileChange", status: "completed", changes: [{ path: "/repo/a.ts", kind: { type: "delete" }, diff: "one\ntwo\n" }] },
      { id: "other", type: "fileChange", status: "completed", changes: [{ path: "/repo/b.ts", kind: { type: "add" }, diff: "three\n" }] },
    ]);
    const resources = recordedTurnResourcesValue(target, files);
    expect(resources.threadId).toBe(target.threadId);
    expect(resources.changeScope).toBe("lastTurn");
    expect(resources.changes).toEqual([
      { path: "/repo/a.ts", kind: "delete", availability: "deleted", additions: 2, deletions: 2, turnId: "turn", itemId: "second" },
      { path: "/repo/b.ts", kind: "add", availability: "unavailable", additions: 1, deletions: 0, turnId: "turn", itemId: "other" },
    ]);
    const diff = recordedTurnChangeDiff(target, files, "/repo/a.ts");
    expect(diff.patches.map((patch) => patch.itemId)).toEqual(["first", "second"]);
    expect(diff.patches.map((patch) => patch.diff)).toEqual(files.filter((file) => file.path === "/repo/a.ts").map((file) => file.patch));
    expect(files[0]?.kind).toBe("add");
    expect(recordedTurnChangeDiff(target, files, "/repo/missing.ts").patches).toEqual([]);
  });
});
