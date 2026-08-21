import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { codeReviewDocumentEmptyState, EMPTY_CHANGES_STATE, EMPTY_CHANGES_TREE_STATE } from "../src/rendering/code-review-empty-state";
import type { CodeReviewDocument } from "../src/rendering/code-review-bridge";

const nativeEditorHtml = readFileSync(new URL("../assets/code-review-editor.html", import.meta.url), "utf8");
const webEditor = readFileSync(new URL("../src/rendering/CodeReviewEditor.web.tsx", import.meta.url), "utf8");

function document(overrides: Partial<CodeReviewDocument> = {}): CodeReviewDocument {
  return { path: "/workspace/file.ts", source: "value\n", patches: [], revision: "r1", ...overrides };
}

describe("code review empty states", () => {
  it("describes an empty scope in both panes", () => {
    expect(EMPTY_CHANGES_STATE).toEqual({ title: "No changes", message: "Nothing to show in this scope." });
    expect(EMPTY_CHANGES_TREE_STATE).toEqual({ title: "Nothing to show", message: "No changed files in this scope." });
  });

  it("explains deleted files in source mode but preserves a renderable diff", () => {
    const deleted = document({ displayState: "deleted", source: "", patches: [{ kind: "delete", diff: "-old" }] });
    expect(codeReviewDocumentEmptyState(deleted, "source")?.title).toBe("File was deleted");
    expect(codeReviewDocumentEmptyState(deleted, "unified")).toBeNull();
  });

  it("does not render a fake blank line for an empty document", () => {
    expect(codeReviewDocumentEmptyState(document({ displayState: "empty", source: "" }), "source")).toEqual({
      title: "Nothing to show",
      message: "This file has no content or renderable diff.",
    });
  });

  it("centers empty states in both native and web review panes", () => {
    expect(nativeEditorHtml).toContain(".review-empty { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center;");
    expect(webEditor).toContain('sidebarScroll: { flex: 1 }');
    expect(webEditor).toContain('sidebarContent: { flexGrow: 1');
    expect(webEditor).toContain('emptyState: { flex: 1, minHeight: 160, alignItems: "center", justifyContent: "center"');
    expect(webEditor).toContain('emptyTitle: { color: colors.text, fontSize: 15, lineHeight: 20, fontWeight: "700", textAlign: "center" }');
    expect(webEditor).toContain('emptyMessage: { maxWidth: 340, color: colors.textMuted, fontSize: 13, lineHeight: 19, textAlign: "center" }');
  });
});
