import { describe, expect, it } from "vitest";
import {
  mergeThreadResources,
  parseThreadChangeDiff,
  parseThreadResourcesPatch,
} from "../src/data/thread-resource-response";

const change = {
  path: "src/file.ts",
  kind: "update",
  additions: 2.8,
  deletions: -3,
  turnId: "turn",
  itemId: "item",
};
const attachment = {
  key: "file",
  name: "notes.txt",
  kind: "file",
  path: "/notes.txt",
  url: null,
  origin: "user",
  turnId: "turn",
  itemId: "item",
};

describe("V1 thread resource response boundary", () => {
  it("validates identity, filters malformed entries and preserves bounded semantic fields", () => {
    const patch = parseThreadResourcesPatch(
      {
        threadId: "thread",
        revision: "r1",
        changes: [null, change],
        attachments: [false, attachment],
      },
      "thread",
      "all",
    );
    const value = mergeThreadResources(null, patch);
    expect(value.changes).toEqual([
      { ...change, availability: "unknown", additions: 2, deletions: 0, binary: false },
    ]);
    expect(value.attachments).toEqual([attachment]);
    expect(value.changeScope).toBe("session");
    expect(() =>
      parseThreadResourcesPatch({ threadId: "other", revision: "r1" }, "thread", "all"),
    ).toThrow("invalid thread resources");
  });

  it("keeps untouched attachment identity when a changes-only response is merged", () => {
    const previous = mergeThreadResources(
      null,
      parseThreadResourcesPatch(
        { threadId: "thread", revision: "r1", attachments: [attachment] },
        "thread",
        "all",
      ),
    );
    const patch = parseThreadResourcesPatch(
      {
        threadId: "thread",
        revision: "r2",
        changeScope: "staged",
        changeScopes: ["session", "session", "invalid"],
        changes: [change],
      },
      "thread",
      "changes",
    );
    const next = mergeThreadResources(previous, patch);
    expect(next.attachments).toBe(previous.attachments);
    expect(next.changeScopes).toEqual(["staged", "session"]);
    expect(next.changes).toHaveLength(1);
  });

  it("bounds resource entries and diff patches at the retained protocol limits", () => {
    // These limits belong to the response adapter and protect bounded materialization.
    const raw = {
      threadId: "thread",
      revision: "r1",
      changes: Array.from({ length: 5_001 }, () => change),
    };
    expect(parseThreadResourcesPatch(raw, "thread", "changes").changes).toHaveLength(5_000);
    const diff = {
      threadId: "thread",
      path: "src/file.ts",
      truncated: true,
      patches: Array.from({ length: 10_001 }, () => ({
        turnId: "turn",
        itemId: "item",
        kind: "update",
        diff: "patch",
      })),
    };
    expect(parseThreadChangeDiff(diff, "thread", "src/file.ts").patches).toHaveLength(10_000);
  });

  it("rejects mismatched diff path and scope while accepting the qualified path", () => {
    const diff = {
      threadId: "thread",
      path: "/workspace/src/file.ts",
      changeScope: "uncommitted",
      truncated: false,
      patches: [{ turnId: "turn", itemId: "item", kind: "update", diff: "patch" }],
    };
    expect(parseThreadChangeDiff(diff, "thread", "src/file.ts", "uncommitted").patches[0]?.diff).toBe(
      "patch",
    );
    expect(() => parseThreadChangeDiff(diff, "thread", "different.ts", "uncommitted")).toThrow(
      "different path",
    );
    expect(() => parseThreadChangeDiff(diff, "thread", "src/file.ts", "unstaged")).toThrow(
      "different change scope",
    );
  });
});
