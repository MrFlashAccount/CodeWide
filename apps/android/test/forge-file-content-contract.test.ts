import { describe, expect, it } from "vitest";

import { parsePullRequestFileContent } from "../src/data/forgeFileContentContract";
import type { PullRequestFile } from "../src/data/forgeMutationContract";
import {
  fileDocument,
  showsWholeFile,
  wholeFileDocument,
} from "../src/features/pullRequestDetail/changes/changesPresentation";
import { materializeBeforeSource } from "../src/features/review/editor/webview/materializeRecordedDiff.web";

describe("forge file content contract", () => {
  it("keeps each state with only its own fields", () => {
    expect(parsePullRequestFileContent({ content: "a\n", state: "text" })).toEqual({
      content: "a\n",
      state: "text",
    });
    expect(parsePullRequestFileContent({ bytes: 5_000_000, state: "tooLarge" })).toEqual({
      bytes: 5_000_000,
      state: "tooLarge",
    });
    expect(parsePullRequestFileContent({ bytes: null, state: "tooLarge" })).toEqual({
      bytes: null,
      state: "tooLarge",
    });
    expect(parsePullRequestFileContent({ state: "binary" })).toEqual({ state: "binary" });
    expect(parsePullRequestFileContent({ state: "missing" })).toEqual({ state: "missing" });
  });

  it("rejects an answer outside the contract", () => {
    for (const invalid of [
      null,
      "text",
      { state: "text" },
      { content: 3, state: "text" },
      { state: "tooLarge" },
      { bytes: -1, state: "tooLarge" },
      { bytes: 1.5, state: "tooLarge" },
      { state: "unsupported" },
    ]) {
      expect(parsePullRequestFileContent(invalid)).toBeNull();
    }
  });
});

const HEAD = ["use std::io;", "", "fn main() {", "    new();", "}", ""].join("\n");
const PATCH = "@@ -2,4 +2,4 @@ use std::io;\n \n fn main() {\n-    old();\n+    new();\n }";

function modified(overrides: Partial<PullRequestFile> = {}): PullRequestFile {
  return {
    additions: 1,
    deletions: 1,
    patch: { hunks: [], state: "present", text: PATCH },
    path: "src/main.rs",
    previousPath: null,
    status: "modified",
    viewed: { source: "forge", viewed: false },
    ...overrides,
  };
}

describe("whole-file document", () => {
  it("shows the whole head file with the patch inline when they line up", () => {
    const document = wholeFileDocument(modified(), HEAD);
    expect(document).toMatchObject({
      fullFileDiff: true,
      path: "src/main.rs",
      source: HEAD,
    });
    expect(document?.patches).toEqual([{ diff: PATCH, kind: "update" }]);
    expect(document?.revision).not.toBe(fileDocument(modified())?.revision);
  });

  it("lets the editor reconstruct the base file from it", () => {
    const document = wholeFileDocument(modified(), HEAD);
    expect(document === null ? null : materializeBeforeSource(document)).toBe(
      HEAD.replace("new();", "old();"),
    );
  });

  it("aligns a CRLF head file and shows it with LF line endings", () => {
    const document = wholeFileDocument(modified(), HEAD.replaceAll("\n", "\r\n"));
    expect(document?.source).toBe(HEAD);
    expect(document === null ? null : materializeBeforeSource(document)).toBe(
      HEAD.replace("new();", "old();"),
    );
  });

  it("keeps the patch view when the head file does not match the patch", () => {
    expect(wholeFileDocument(modified(), HEAD.replace("new();", "other();"))).toBeNull();
    expect(wholeFileDocument(modified(), "src/target.rs")).toBeNull();
    expect(
      wholeFileDocument(modified({ patch: { bytes: null, state: "tooLarge" } }), HEAD),
    ).toBeNull();
  });

  it("reads the whole file only where the head side differs from the patch alone", () => {
    expect(showsWholeFile(modified())).toBe(true);
    expect(showsWholeFile(modified({ status: "renamed" }))).toBe(true);
    expect(showsWholeFile(modified({ status: "added" }))).toBe(false);
    expect(showsWholeFile(modified({ status: "removed" }))).toBe(false);
    expect(showsWholeFile(modified({ patch: { state: "binary" } }))).toBe(false);
  });
});
