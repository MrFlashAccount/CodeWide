import { processFile } from "@pierre/diffs";
import { describe, expect, it } from "vitest";

import { canonicalPatch } from "../code-review-editor/canonicalPatch";
import type { CodeReviewPatch } from "../src/rendering/code-review-bridge";

function parse(patch: CodeReviewPatch) {
  const metadata = processFile(canonicalPatch("file.ts", patch), { throwOnError: true });
  if (metadata === undefined) throw new Error("Expected a parsed file");
  return metadata;
}

describe("recorded patch compatibility", () => {
  it.each(["\n", "\r\n"])("restores suppressed blank context within multiple hunks (%j)", (ending) => {
    const diff = [
      "--- a/file.ts", "+++ b/file.ts", "@@ -10,4 +10,4 @@",
      "", "-oldFirst", "+newFirst", "", " context",
      "@@ -30,2 +30,2 @@", "-oldSecond", "+newSecond", "", "",
    ].join(ending);
    const parsed = parse({ kind: "update", diff });
    expect(parsed.deletionLines.join("")).toBe(["", "oldFirst", "", "context", "oldSecond", "", ""].join(ending));
    expect(parsed.additionLines.join("")).toBe(["", "newFirst", "", "context", "newSecond", "", ""].join(ending));
    expect(parsed.hunks.map((hunk) => [hunk.deletionStart, hunk.additionStart, hunk.deletionCount, hunk.additionCount])).toEqual([[10, 10, 4, 4], [30, 30, 2, 2]]);
  });

  it("preserves prefixed blank context and trailing whitespace in changed content", () => {
    const parsed = parse({ kind: "update", diff: "@@ -1,3 +1,3 @@\n-old  \n+new \t\n \n \n" });
    expect(parsed.deletionLines.join("")).toBe("old  \n\n\n");
    expect(parsed.additionLines.join("")).toBe("new \t\n\n\n");
  });

  it.each(["add", "delete"] as const)("preserves whitespace in headerless %s content", (kind) => {
    const parsed = parse({ kind, diff: "value \t\n\n\n" });
    const lines = kind === "add" ? parsed.additionLines : parsed.deletionLines;
    expect(lines.map((line) => line.replace(/\n$/, ""))).toEqual(["value \t", "", ""]);
  });

  it("preserves explicit no-newline metadata", () => {
    const parsed = parse({ kind: "update", diff: "@@ -1 +1 @@\n-old\n\\ No newline at end of file\n+new  \n\\ No newline at end of file\n" });
    expect(parsed.deletionLines).toEqual(["old"]);
    expect(parsed.additionLines).toEqual(["new  "]);
  });

  it.each([
    "@@ -1,2 +1,2 @@\n-old\n+new\n",
    "@@ -1,2 +1,2 @@\ninvalid\n-old\n+new\n",
    "@@ -1 +1 @@\n-old\n+new\n+extra\n",
    "@@ -1,0 +1,2 @@\n\n+new\n",
  ])("does not conceal invalid or truncated hunks (%j)", (diff) => {
    expect(() => parse({ kind: "update", diff })).toThrow();
  });
});
