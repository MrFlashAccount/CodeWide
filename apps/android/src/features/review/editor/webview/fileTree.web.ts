import { FileTree, type FileTreeBatchOperation } from "@pierre/trees";
import type { CodeReviewFileItem, CodeReviewWorkspaceState } from "../editorBridge";

const ROW_HEIGHT = 30;

type ReviewFileTree = {
  readonly reveal: () => void;
  readonly update: (state: CodeReviewWorkspaceState) => void;
};

function isRowButton(node: EventTarget): node is HTMLButtonElement {
  return "tagName" in node && node.tagName === "BUTTON";
}

function badge(file: CodeReviewFileItem | undefined): string {
  if (file?.sourceOnly === true) {
    return "Attachment";
  }
  const review = file?.review;
  if (review === undefined) {
    return "";
  }
  return review.drafts > 0 ? `✎${String(review.drafts)}` : "";
}

/** Adapts the selected review file and PR badges to Pierre's virtualized tree. */
export function createFileTree(host: HTMLElement, select: (path: string) => void): ReviewFileTree {
  const search = document.querySelector<HTMLInputElement>("#file-search");
  const empty = document.getElementById("no-matches");
  if (search === null || empty === null) {
    throw new Error("Missing file search");
  }
  let files = new Map<string, CodeReviewFileItem>();
  let selected: CodeReviewFileItem | undefined;
  let revision: string | null = null;
  const updateSearchStatus = () => {
    const noMatches = tree.getSearchValue() !== "" && tree.getSearchMatchingPaths().length === 0;
    empty.hidden = !noMatches;
    host.hidden = files.size === 0 || noMatches;
  };
  const tree = new FileTree({
    density: "compact",
    fileTreeSearchMode: "hide-non-matches",
    flattenEmptyDirectories: true,
    icons: "complete",
    initialExpansion: "open",
    itemHeight: ROW_HEIGHT,
    onSearchChange: (query) => {
      if (query === null) {
        search.value = "";
      }
      updateSearchStatus();
    },
    onSelectionChange: (paths) => {
      const file = files.get(paths.at(-1) ?? "");
      if (file !== undefined && file.path !== selected?.path) {
        select(file.path);
      }
    },
    paths: [],
    renderRowDecoration: ({ row }) => {
      const file = files.get(row.path);
      const text = badge(file);
      if (file?.review !== undefined) {
        const parts = [
          { color: "var(--review-green)", text: `+${String(file.additions)}` },
          { color: "var(--review-red)", text: ` −${String(file.deletions)}` },
        ];
        if (text !== "") {
          parts.push({ color: "var(--review-muted)", text: " " + text });
        }
        return { parts, text: parts.map((part) => part.text).join("") };
      }
      return text === "" ? null : { text };
    },
    stickyFolders: false,
    unsafeCSS:
      "[data-file-tree-virtualized-scroll] { padding-block-end: var(--review-tree-end-space, 0px); }",
  });
  search.oninput = () => {
    tree.setSearch(search.value === "" ? null : search.value);
  };

  // Activating the already selected row closes the picker too. Pierre's selection event
  // only fires when the selection changes; a row activation also carries its tree path.
  function activateCurrent(event: Event): void {
    if (selected === undefined) {
      return;
    }
    const row = event.composedPath().find(isRowButton);
    if (row?.dataset.itemPath === selected.treePath) {
      select(selected.path);
    }
  }
  host.addEventListener("click", activateCurrent, true);
  host.addEventListener(
    "keydown",
    (event) => {
      if (event.key === "Enter" && tree.isSearchOpen()) {
        activateCurrent(event);
      }
    },
    true,
  );

  function reveal(): void {
    tree.setSearch(null);
    if (selected !== undefined) {
      tree.scrollToPath(selected.treePath, { focus: false, offset: "nearest" });
    }
  }
  const update = (state: CodeReviewWorkspaceState): void => {
    empty.textContent =
      state.filesComplete === false ? "No matches in the files loaded so far" : "No matching files";
    const prior = files;
    files = new Map(state.files.map((file) => [file.treePath, file]));
    selected = state.files.find((file) => file.path === state.selectedPath);
    if (state.revision !== revision) {
      revision = state.revision;
      updateTreePaths(tree, prior, files);
      tree.setGitStatus(state.files.map((file) => ({ path: file.treePath, status: file.status })));
    }
    if (
      tree.getFileTreeContainer() === undefined ||
      state.files.some(
        (file) =>
          badge(prior.get(file.treePath)) !== badge(file) ||
          prior.get(file.treePath)?.additions !== file.additions ||
          prior.get(file.treePath)?.deletions !== file.deletions,
      )
    ) {
      tree.render({ containerWrapper: host });
    }
    syncSelection(tree, selected?.treePath);
    updateSearchStatus();
  };
  return { reveal, update };
}

/** Applying path changes keeps Pierre's active search index and folder expansion in sync. */
function updateTreePaths(
  tree: FileTree,
  prior: ReadonlyMap<string, CodeReviewFileItem>,
  next: ReadonlyMap<string, CodeReviewFileItem>,
): void {
  if (prior.size === 0 && !tree.isSearchOpen()) {
    tree.resetPaths([...next.keys()]);
    return;
  }
  const operations: FileTreeBatchOperation[] = [];
  for (const path of prior.keys()) {
    if (!next.has(path)) {
      operations.push({ path, type: "remove" });
    }
  }
  for (const path of next.keys()) {
    if (!prior.has(path)) {
      operations.push({ path, type: "add" });
    }
  }
  if (operations.length > 0) {
    tree.batch(operations);
  }
}

function syncSelection(tree: FileTree, path: string | undefined): void {
  for (const previous of tree.getSelectedPaths()) {
    if (previous !== path) {
      tree.getItem(previous)?.deselect();
    }
  }
  if (path === undefined) {
    return;
  }
  const item = tree.getItem(path);
  if (item?.isSelected() === false) {
    item.select();
    tree.scrollToPath(path, { focus: false, offset: "nearest" });
  }
}
