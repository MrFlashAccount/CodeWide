import { describe, expect, it } from "vitest";

import {
  codeReviewDocumentEmptyState,
  EMPTY_CHANGES_STATE,
  EMPTY_CHANGES_TREE_STATE,
  LOADING_CHANGE_STATE,
} from "../src/features/review/editor/editorEmptyState";
import type { CodeReviewDocument } from "../src/features/review/editor/editorBridge";

function document(overrides: Partial<CodeReviewDocument> = {}): CodeReviewDocument {
  return {
    path: "/workspace/file.ts",
    source: "value\n",
    patches: [],
    revision: "r1",
    ...overrides,
  };
}

describe("code review empty states", () => {
  it("describes an empty scope in both panes", () => {
    expect(EMPTY_CHANGES_STATE).toEqual({
      title: "No changes",
      message: "Nothing to show in this scope.",
    });
    expect(EMPTY_CHANGES_TREE_STATE).toEqual({
      title: "Nothing to show",
      message: "No changed files in this scope.",
    });
    expect(LOADING_CHANGE_STATE).toEqual({
      title: "Loading file…",
      message: "Reading the selected file and its diff.",
    });
  });

  it("explains deleted files in source mode but preserves a renderable diff", () => {
    const deleted = document({
      displayState: "deleted",
      source: "",
      patches: [{ kind: "delete", diff: "-old" }],
    });
    expect(codeReviewDocumentEmptyState(deleted, "source")?.title).toBe("File was deleted");
    expect(codeReviewDocumentEmptyState(deleted, "unified")).toBeNull();
  });

  it("shows no net change for a file created and removed within the session", () => {
    const createdThenDeleted = document({
      displayState: "deleted",
      fullFileDiff: true,
      source: "",
      patches: [
        { kind: "add", diff: "initial\n" },
        { kind: "update", diff: "@@ -1 +1 @@\n-initial\n+later\n" },
        { kind: "delete", diff: "later\n" },
      ],
    });
    for (const mode of ["unified", "source"] as const) {
      expect(codeReviewDocumentEmptyState(createdThenDeleted, mode)).toEqual({
        title: "No net changes",
        message: "This file was created and removed in the selected scope.",
      });
    }
  });

  it("does not render a fake blank line for an empty document", () => {
    expect(
      codeReviewDocumentEmptyState(document({ displayState: "empty", source: "" }), "source"),
    ).toEqual({
      title: "Nothing to show",
      message: "This file has no content or renderable diff.",
    });
  });

  it("identifies unsupported files without reporting a preview failure", () => {
    expect(
      codeReviewDocumentEmptyState(
        {
          displayState: "unsupported",
          patches: [],
          path: "/workspace/archive.zip",
          revision: "unsupported",
          source: "",
        },
        "source",
      ),
    ).toEqual({
      message: "This file format cannot be previewed in Changes.",
      title: "Unsupported format",
    });
  });
});
