import { describe, expect, it } from "vitest";

import { normalizeFileChangeKind, projectFileChange } from "../src/rendering/file-change-rendering";

describe("file change rendering", () => {
  it("reads the object-form PatchChangeKind returned by Codex", () => {
    expect(normalizeFileChangeKind({ type: "add" })).toBe("add");
    expect(normalizeFileChangeKind({ type: "delete" })).toBe("delete");
    expect(normalizeFileChangeKind({ type: "update", move_path: null })).toBe("update");
  });

  it("projects a complete added file as visible diff lines and truthful stats", () => {
    expect(projectFileChange("const answer = 42;\nexport { answer };\n", { type: "add" })).toEqual({
      kind: "add",
      lines: ["+const answer = 42;", "+export { answer };"],
      renderSource: "+const answer = 42;\n+export { answer };",
      additions: 2,
      deletions: 0,
    });
  });

  it("projects a complete deleted file as visible diff lines and truthful stats", () => {
    expect(projectFileChange("old\ncontent", { type: "delete" })).toEqual({
      kind: "delete",
      lines: ["-old", "-content"],
      renderSource: "-old\n-content",
      additions: 0,
      deletions: 2,
    });
  });

  it("removes transport metadata from unified update diffs", () => {
    expect(projectFileChange("--- a/file\n+++ b/file\n-old\n+new", { type: "update", move_path: null })).toEqual({
      kind: "update",
      lines: ["-old", "+new"],
      renderSource: "--- a/file\n+++ b/file\n-old\n+new",
      additions: 1,
      deletions: 1,
    });
  });

  it("does not prefix an already unified added-file diff twice", () => {
    expect(projectFileChange("@@ -0,0 +1,2 @@\n+first\n+second", { type: "add" })).toEqual({
      kind: "add",
      lines: ["+first", "+second"],
      renderSource: "@@ -0,0 +1,2 @@\n+first\n+second",
      additions: 2,
      deletions: 0,
    });
  });

  it("does not prefix an already unified deleted-file diff twice", () => {
    expect(projectFileChange("@@ -1,2 +0,0 @@\n-first\n-second", { type: "delete" })).toEqual({
      kind: "delete",
      lines: ["-first", "-second"],
      renderSource: "@@ -1,2 +0,0 @@\n-first\n-second",
      additions: 0,
      deletions: 2,
    });
  });

  it("keeps code that resembles file headers inside a hunk", () => {
    expect(projectFileChange("@@ -1 +1 @@\n--- actual deleted code\n+++ actual added code", { type: "update" })).toEqual({
      kind: "update",
      lines: ["--- actual deleted code", "+++ actual added code"],
      renderSource: "@@ -1 +1 @@\n--- actual deleted code\n+++ actual added code",
      additions: 1,
      deletions: 1,
    });
  });
});
