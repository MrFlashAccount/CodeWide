import type { CodeReviewDocument, CodeReviewViewMode } from "./editorBridge";

export type CodeReviewEmptyState = {
  message: string;
  title: string;
};

export const EMPTY_CHANGES_STATE: CodeReviewEmptyState = {
  message: "Nothing to show in this scope.",
  title: "No changes",
};

export const LOADING_CHANGE_STATE: CodeReviewEmptyState = {
  message: "Reading the selected file and its diff.",
  title: "Loading file…",
};

export const EMPTY_CHANGES_TREE_STATE: CodeReviewEmptyState = {
  message: "No changed files in this scope.",
  title: "Nothing to show",
};

export function codeReviewDocumentEmptyState(
  document: CodeReviewDocument,
  mode: CodeReviewViewMode,
): CodeReviewEmptyState | null {
  if (document.displayState === "unsupported") {
    return {
      message: "This file format cannot be previewed in Changes.",
      title: "Unsupported format",
    };
  }
  if (document.displayState === "image") {
    return null;
  }
  if (
    document.fullFileDiff === true &&
    document.displayState === "deleted" &&
    document.source === "" &&
    document.patches[0]?.kind === "add"
  ) {
    return {
      message: "This file was created and removed in the selected scope.",
      title: "No net changes",
    };
  }
  if (document.displayState === "deleted" && (mode === "source" || document.patches.length === 0)) {
    return {
      message:
        document.patches.length > 0
          ? "Switch to Unified or Split to inspect the deletion."
          : "No previous contents are available.",
      title: "File was deleted",
    };
  }
  if (
    document.displayState === "empty" ||
    (document.source === "" && document.patches.length === 0)
  ) {
    return {
      message: "This file has no content or renderable diff.",
      title: "Nothing to show",
    };
  }
  if (mode === "source" && document.source === "" && document.patches.length > 0) {
    return {
      message: "Switch to Unified or Split to inspect the recorded changes.",
      title: "No source content",
    };
  }
  return null;
}
