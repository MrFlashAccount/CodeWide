import { colors, controlSize, iconSize, radii } from "../../../../theme";
import {
  SIDEBAR_FRAME_SHARE,
  SIDEBAR_MAX_WIDTH,
  SIDEBAR_MIN_WIDTH,
} from "../../../../ui/sidebarDimensions";
import type { CodeReviewWorkspaceState } from "../editorBridge";
import { createFileTree } from "./fileTree.web";
import { createFileSheet } from "./fileSheet.web";

/** Resolves an element required by the bundled editor document. */
export function editorElement(id: string): HTMLElement {
  const element = document.getElementById(id);
  if (element === null) {
    throw new Error("Missing review element " + id);
  }
  return element;
}

/** Connects file navigation to its workspace owner without rebuilding the diff. */
export function createFileNavigation(
  select: (path: string) => void,
  setOpen: (open: boolean) => void,
): (state: CodeReviewWorkspaceState) => void {
  const panel = document.querySelector("dialog");
  const grip = document.querySelector<HTMLButtonElement>("button#file-grip");
  if (panel === null || grip === null) {
    throw new Error("Missing review picker");
  }
  const tree = createFileTree(editorElement("tree"), select);
  const show = createFileSheet(panel, grip, () => {
    setOpen(false);
  });
  editorElement("close-files").onclick = () => {
    setOpen(false);
  };
  for (const [key, value] of Object.entries({
    accent: colors.accent,
    "accent-soft": colors.accentMuted,
    border: colors.borderSoft,
    "border-strong": colors.outline,
    canvas: colors.code,
    "control-regular": String(controlSize.regular) + "px",
    dim: colors.textDim,
    "error-container": colors.errorContainer,
    green: colors.green,
    "icon-action": String(iconSize.action) + "px",
    "icon-inline": String(iconSize.inline) + "px",
    muted: colors.textMuted,
    "pane-radius": String(radii.composer) + "px",
    panel: colors.surface,
    "panel-raised": colors.surfaceContainer,
    "panel-soft": colors.surfaceContainerHigh,
    red: colors.red,
    scrim: colors.scrim,
    "search-radius": String(radii.medium) + "px",
    "sidebar-width": `clamp(${String(SIDEBAR_MIN_WIDTH)}px, ${SIDEBAR_FRAME_SHARE}, ${String(SIDEBAR_MAX_WIDTH)}px)`,
    text: colors.text,
  })) {
    document.documentElement.style.setProperty("--review-" + key, value);
  }
  return (state: CodeReviewWorkspaceState) => {
    const opened = show(state.compact, state.sidebarOpen);
    const totals = editorElement("tree-totals");
    const prFiles = state.files[0]?.review !== undefined;
    editorElement("preview").toggleAttribute("data-review-actions", prFiles);
    totals.hidden = !prFiles;
    if (prFiles && state.sidebarOpen) {
      let additions = 0;
      let deletions = 0;
      for (const file of state.files) {
        additions += file.additions;
        deletions += file.deletions;
      }
      totals.textContent = `${String(state.files.length)} files loaded · +${String(additions)} −${String(deletions)}`;
    }
    if (state.sidebarOpen) {
      tree.update(state);
    }
    if (opened) {
      tree.reveal();
    }
  };
}
