import { describe, expect, it } from "vitest";

import type { CodeExcerpt, ThreadAnchor } from "../src/data/forgeConversationContract";
import {
  excerptLabel,
  excerptRows,
} from "../src/features/pullRequestDetail/conversation/codeExcerpt";

const EXCERPT: CodeExcerpt = {
  lines: [
    { kind: "context", newLine: 40, oldLine: 38, text: "fn read() {" },
    { kind: "removed", oldLine: 39, text: "    old();" },
    { kind: "added", newLine: 41, text: "    new();" },
    { kind: "added", newLine: 42, text: "    more();" },
  ],
};

function line(side: "new" | "old", startLine: number | null, end: number): ThreadAnchor {
  return { kind: "line", line: end, path: "src/a.rs", side, startLine };
}

describe("thread code excerpt", () => {
  it("numbers each row on its own sides and marks only the last row of a one-line thread", () => {
    expect(excerptRows(EXCERPT, line("new", null, 42))).toEqual([
      {
        anchored: false,
        kind: "context",
        marker: " ",
        newLabel: "40",
        oldLabel: "38",
        text: "fn read() {",
      },
      {
        anchored: false,
        kind: "removed",
        marker: "-",
        newLabel: "",
        oldLabel: "39",
        text: "    old();",
      },
      {
        anchored: false,
        kind: "added",
        marker: "+",
        newLabel: "41",
        oldLabel: "",
        text: "    new();",
      },
      {
        anchored: true,
        kind: "added",
        marker: "+",
        newLabel: "42",
        oldLabel: "",
        text: "    more();",
      },
    ]);
  });

  it("marks every row of a line range on the anchor's side", () => {
    const anchored = (anchor: ThreadAnchor) =>
      excerptRows(EXCERPT, anchor).map((row) => row.anchored);
    expect(anchored(line("new", 40, 42))).toEqual([true, false, true, true]);
    // On the old side only the removed and context rows have numbers in range.
    expect(anchored(line("old", 38, 39))).toEqual([true, true, false, true]);
    expect(anchored({ kind: "file", path: "src/a.rs" })).toEqual([false, false, false, true]);
  });

  it("names the file and the lines it shows", () => {
    expect(excerptLabel(EXCERPT, line("new", null, 42))).toBe("Code at src/a.rs lines 40 to 42");
    expect(
      excerptLabel(
        { lines: [{ kind: "removed", oldLine: 7, text: "x" }] },
        {
          kind: "file",
          path: "b.rs",
        },
      ),
    ).toBe("Code at b.rs line 7");
  });
});
