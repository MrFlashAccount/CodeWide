import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  codeReviewDocumentEmptyState,
  EMPTY_CHANGES_STATE,
  EMPTY_CHANGES_TREE_STATE,
  LOADING_CHANGE_STATE,
} from "../src/features/review/editor/editorEmptyState";
import type { CodeReviewDocument } from "../src/features/review/editor/editorBridge";
import { compactSource, sourceObjectDeclaration } from "./source-contract";

const nativeEditorHtml = readFileSync(
  new URL("../src/features/review/editor/webview/codeReviewEditor.html", import.meta.url),
  "utf8",
);
const webEditor = readFileSync(
  new URL("../src/features/review/editor/CodeReviewEditor.web.tsx", import.meta.url),
  "utf8",
);

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

  it("does not render a fake blank line for an empty document", () => {
    expect(
      codeReviewDocumentEmptyState(document({ displayState: "empty", source: "" }), "source"),
    ).toEqual({
      title: "Nothing to show",
      message: "This file has no content or renderable diff.",
    });
  });

  it("centers empty states in both native and web review panes", () => {
    expect(compactSource(nativeEditorHtml)).toContain(
      ".review-empty { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center;",
    );
    expect(nativeEditorHtml).toContain('.review-empty[data-loading="true"] .review-empty-title');
    expect(webEditor).toContain("sidebarScroll: { flex: 1 }");
    expect(sourceObjectDeclaration(webEditor, "sidebarContent")).toContain("flexGrow: 1");
    const emptyStateStyle = sourceObjectDeclaration(webEditor, "emptyState");
    expect(emptyStateStyle).toContain("flex: 1");
    expect(emptyStateStyle).toContain("minHeight: 160");
    expect(emptyStateStyle).toContain('alignItems: "center"');
    expect(emptyStateStyle).toContain('justifyContent: "center"');
    for (const name of ["emptyTitle", "emptyMessage"]) {
      const style = webEditor.match(new RegExp(`${name}: \\{[^}]+\\}`, "u"))?.[0];
      expect(style).toContain('textAlign: "center"');
      expect(style).toContain("...typeScale.body");
    }
  });
});
