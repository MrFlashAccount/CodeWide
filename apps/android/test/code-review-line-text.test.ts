import { describe, expect, it } from "vitest";

import {
  lineReference,
  patchLineText,
  sourceLineText,
} from "../src/features/review/editor/webview/lineText.web";

const PATCH = [
  "--- a/src/main.rs",
  "+++ b/src/main.rs",
  "@@ -2,4 +2,4 @@ use std::io;",
  " ",
  " fn main() {",
  "-    old();",
  "+    new();",
  " }",
].join("\n");

describe("tapped line text for the line composer quote", () => {
  it("quotes a line of the complete file, without its line ending", () => {
    const source = "first\r\nsecond\r\nthird";
    expect(sourceLineText(source, 2)).toBe("second");
    expect(sourceLineText(source, 4)).toBeUndefined();
    expect(sourceLineText(null, 1)).toBeUndefined();
  });

  it("quotes each side of a unified patch by that side's line numbers", () => {
    expect(patchLineText(PATCH, "new", 4)).toBe("    new();");
    expect(patchLineText(PATCH, "old", 4)).toBe("    old();");
    expect(patchLineText(PATCH, "new", 3)).toBe("fn main() {");
    expect(patchLineText(PATCH, "old", 5)).toBe("}");
    expect(patchLineText(PATCH, "new", 9)).toBeUndefined();
  });

  it("does not read file headers or text outside the declared hunks", () => {
    const headerlessDeletion = "@@ -1,1 +0,0 @@\n---- removed dashes\n+++ trailing noise";
    expect(patchLineText(headerlessDeletion, "old", 1)).toBe("--- removed dashes");
    expect(patchLineText(headerlessDeletion, "new", 1)).toBeUndefined();
  });

  it("carries the text in the line reference, cut to one quotable line", () => {
    expect(lineReference({ line: 3, path: "a.ts", side: "old", text: "const a = 1;" })).toEqual({
      context: "const a = 1;",
      coordinate: "file",
      line: 3,
      path: "a.ts",
      side: "old",
    });
    expect(
      lineReference({ line: 3, path: "a.ts", side: "new", text: undefined }),
    ).not.toHaveProperty("context");
    expect(
      lineReference({ line: 1, path: "a.ts", side: "new", text: "x".repeat(5000) }).context?.length,
    ).toBeLessThan(5000);
  });
});
