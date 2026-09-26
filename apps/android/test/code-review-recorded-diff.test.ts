import { describe, expect, it } from "vitest";

import type { CodeReviewDocument } from "../src/features/review/editor/editorBridge";
import { materializeBeforeSource } from "../src/features/review/editor/webview/materializeRecordedDiff.web";

function document(source: string, diffs: readonly string[]): CodeReviewDocument {
  return {
    path: "src/example.ts",
    source,
    revision: source,
    patches: diffs.map((diff) => ({ diff, kind: "update" })),
    fullFileDiff: true,
  };
}

describe("recorded code review diff", () => {
  it("reconstructs the complete file before sequential edits in one session", () => {
    const first = "@@ -1,3 +1,3 @@\n one\n-old\n+middle\n three\n";
    const second = "@@ -1,3 +1,3 @@\n one\n-middle\n+new\n three\n";
    expect(materializeBeforeSource(document("one\nnew\nthree\n", [first, second]))).toBe(
      "one\nold\nthree\n",
    );
  });

  it("uses the empty session baseline when a new file was changed outside recorded patches", () => {
    const creation = "one\nlong(\n value\n)\n";
    const laterEdit = "@@ -2 +2 @@\n-long(value)\n+new(value)\n";
    const changedFile: CodeReviewDocument = {
      ...document("one\nnew(value)\n", []),
      patches: [
        { diff: creation, kind: "add" },
        { diff: laterEdit, kind: "update" },
      ],
    };
    expect(materializeBeforeSource(changedFile)).toBe("");
    expect(materializeBeforeSource({ ...changedFile, fullFileDiff: false })).toBeNull();
  });

  it("keeps the empty baseline when a file is created and deleted in one session", () => {
    const createdThenDeleted: CodeReviewDocument = {
      ...document("", []),
      displayState: "deleted",
      patches: [
        { diff: "old\n", kind: "add" },
        { diff: "@@ -1 +1 @@\n-old\n+new\n", kind: "update" },
        { diff: "new\n", kind: "delete" },
      ],
    };
    expect(materializeBeforeSource(createdThenDeleted)).toBe("");
  });

  it("locates an unchanged recorded hunk after later lines shift its position", () => {
    const diff = "@@ -2,3 +2,3 @@\n before\n-old\n+new\n after\n";
    expect(materializeBeforeSource(document("later\nheader\nbefore\nnew\nafter\n", [diff]))).toBe(
      "later\nheader\nbefore\nold\nafter\n",
    );
  });

  it("refuses to place a recorded hunk when its context is ambiguous", () => {
    const diff = "@@ -2,3 +2,3 @@\n before\n-old\n+new\n after\n";
    expect(
      materializeBeforeSource(document("before\nnew\nafter\ngap\nbefore\nnew\nafter\n", [diff])),
    ).toBeNull();
  });

  it("does not relocate recorded Turn patches", () => {
    const diff = "@@ -2,3 +2,3 @@\n before\n-old\n+new\n after\n";
    expect(
      materializeBeforeSource({
        ...document("later\nheader\nbefore\nnew\nafter\n", [diff]),
        fullFileDiff: false,
      }),
    ).toBeNull();
  });
});
