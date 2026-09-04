import type { CodeReviewDocument, CodeReviewViewMode } from "./code-review-bridge";

export type CodeReviewEmptyState = {
  title: string;
  message: string;
};

export const EMPTY_CHANGES_STATE: CodeReviewEmptyState = {
  title: "No changes",
  message: "Nothing to show in this scope.",
};

export const LOADING_CHANGE_STATE: CodeReviewEmptyState = {
  title: "Loading file…",
  message: "Reading the selected file and its diff.",
};

export const EMPTY_CHANGES_TREE_STATE: CodeReviewEmptyState = {
  title: "Nothing to show",
  message: "No changed files in this scope.",
};

export function codeReviewDocumentEmptyState(
  document: CodeReviewDocument,
  mode: CodeReviewViewMode,
): CodeReviewEmptyState | null {
  if (document.displayState === "deleted" && (mode === "source" || document.patches.length === 0)) {
    return {
      title: "File was deleted",
      message: document.patches.length > 0
        ? "Switch to Unified or Split to inspect the deletion."
        : "No previous contents are available.",
    };
  }
  if (document.displayState === "empty" || document.source === "" && document.patches.length === 0) {
    return {
      title: "Nothing to show",
      message: "This file has no content or renderable diff.",
    };
  }
  return null;
}
