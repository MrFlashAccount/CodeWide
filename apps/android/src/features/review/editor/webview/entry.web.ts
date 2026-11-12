import {
  File as PierreFile,
  FileDiff,
  processFile,
  type DiffLineAnnotation,
  type FileContents,
  type FileDiffOptions,
  type FileOptions,
  type LineAnnotation,
  type OnDiffLineClickProps,
  type OnLineClickProps,
} from "@pierre/diffs";
import {
  FileTree,
  themeToTreeStyles,
  type GitStatusEntry,
  type TreeThemeInput,
} from "@pierre/trees";
import { canonicalPatch } from "./canonicalPatch.web";
import { lineReference, patchLineText, sourceLineText } from "./lineText.web";
import { materializeBeforeSource as reconstructBeforeSource } from "./materializeRecordedDiff.web";

import {
  CODE_REVIEW_BRIDGE_VERSION,
  type CodeReviewClientEvent,
  type CodeReviewDocument,
  type CodeReviewFileItem,
  type CodeReviewHostCommand,
  type CodeReviewInlineComment,
  type CodeReviewViewMode,
  type CodeReviewWorkspaceState,
} from "../editorBridge";
import {
  codeReviewDocumentEmptyState,
  EMPTY_CHANGES_STATE,
  EMPTY_CHANGES_TREE_STATE,
  LOADING_CHANGE_STATE,
  type CodeReviewEmptyState,
} from "../editorEmptyState";
import type { CodeReviewLineReference } from "../../comments/reviewComment";

/** Every annotation is a comment: the line composer is native, never part of the document. */
type AnnotationMetadata = { readonly comment: CodeReviewInlineComment };
type CodeReviewClientPayload = CodeReviewClientEvent extends infer Event
  ? Event extends CodeReviewClientEvent
    ? Omit<Event, "version">
    : never
  : never;

const FILE_TREE_OVERSCAN = 4;
const MATERIALIZED_SOURCE_CACHE_LIMIT = 24;

let latestRequestId = 0;
let latestHostSequence = 0;
let currentDocument: CodeReviewDocument | null = null;
let currentComments: readonly CodeReviewInlineComment[] = [];
let currentWorkspace: CodeReviewWorkspaceState = {
  compact: false,
  files: [],
  revision: "",
  selectedPath: null,
  sidebarOpen: false,
};
/** The line the native composer is open on; highlighted as its anchor. */
let currentSelection: CodeReviewLineReference | null = null;
let currentMode: CodeReviewViewMode = "source";
let wrapLines = false;
let tree: FileTree | null = null;
let treePathToFile = new Map<string, CodeReviewFileItem>();
let selectedTreePath: string | null = null;
let currentReviewSignature = "";
let fileRenderer: PierreFile<AnnotationMetadata> | null = null;
let diffRenderer: FileDiff<AnnotationMetadata> | null = null;
let activeFileRenderer: PierreFile<AnnotationMetadata> | null = null;
let activeDiffRenderer: FileDiff<AnnotationMetadata> | null = null;
let pendingRender: { requestId: number; startedAt: number } | null = null;
let pendingReveal: CodeReviewLineReference | null = null;
let revealedReference: CodeReviewLineReference | null = null;
const materializedBefore = new Map<string, string | null>();

const treeTheme = {
  colors: {
    "gitDecoration.addedResourceForeground": "#55c58a",
    "gitDecoration.deletedResourceForeground": "#f0757b",
    "gitDecoration.modifiedResourceForeground": "#68cdf2",
    "input.background": "#181a1e",
    "input.border": "rgba(255,255,255,.12)",
    "input.foreground": "#f1f3f5",
    "list.activeSelectionBackground": "#242a33",
    "list.activeSelectionForeground": "#f1f3f5",
    "list.focusBackground": "#242a33",
    "list.focusOutline": "#78a9ff",
    "scrollbarSlider.background": "rgba(255,255,255,.18)",
    "sideBar.background": "#101113",
    "sideBar.border": "rgba(255,255,255,.12)",
    "sideBar.foreground": "#f1f3f5",
    "sideBarSectionHeader.foreground": "#8d939c",
  },
  name: "codewide-dark",
  type: "dark",
} satisfies TreeThemeInput;
const treeThemeStyles = themeToTreeStyles(treeTheme);
/** Status glyphs drawn as boxed icons (plus, dot, minus, arrow) instead of Pierre's letters. */
const STATUS_ICON_PATHS: Readonly<Record<"added" | "deleted" | "modified" | "renamed", string>> = {
  added:
    "<path d='M8 4.75v6.5M4.75 8h6.5' stroke='black' stroke-width='1.5' stroke-linecap='round'/>",
  deleted: "<path d='M4.75 8h6.5' stroke='black' stroke-width='1.5' stroke-linecap='round'/>",
  modified: "<circle cx='8' cy='8' r='2.25' fill='black'/>",
  renamed:
    "<path d='M4.5 8h6.25M8.5 5.5 11 8l-2.5 2.5' fill='none' stroke='black' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'/>",
};

function statusIconMask(inner: string): string {
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'><rect x='1.75' y='1.75' width='12.5' height='12.5' rx='3' fill='none' stroke='black' stroke-width='1.5'/>${inner}</svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
}

const STATUS_ICON_CSS = Object.entries(STATUS_ICON_PATHS)
  .map(
    ([status, inner]) =>
      `[data-item-git-status="${status}"] [data-item-section="git"] { --review-status-icon: ${statusIconMask(inner)}; }`,
  )
  .join("\n");

const TOUCH_FILE_TREE_CSS = `
@media (hover: none), (pointer: coarse) {
  [data-type="item"]:hover:not([data-item-selected="true"]) {
    background-color: var(--trees-bg);
    --truncate-marker-background-overlay-color: transparent;
  }

  [data-type="item"][data-item-focused="true"]::before,
  [data-type="item"]:focus-visible::before {
    display: none;
  }

  [data-item-flattened-subitem]:hover {
    text-decoration: none;
  }

  :host(:hover) [data-item-section="spacing-item"] {
    opacity: 0;
  }
}

[data-item-git-status] [data-item-section="git"] {
  font-size: 0;
  min-width: 16px;
  overflow: visible;
}

[data-item-git-status] [data-item-section="git"]::before {
  content: "";
  display: inline-block;
  flex-shrink: 0;
  width: 16px;
  height: 16px;
  background-color: currentColor;
  -webkit-mask: var(--review-status-icon) center / contain no-repeat;
  mask: var(--review-status-icon) center / contain no-repeat;
}

${STATUS_ICON_CSS}
`;

const treeHost = requiredElement("tree");
const treeEmptyHost = requiredElement("tree-empty");
const previewHost = requiredElement("preview");
const previewEmptyHost = requiredElement("preview-empty");
const imageHost = requiredElement("image-preview");
const imageElement = requiredElement("review-image");
const workspaceHost = requiredElement("workspace");
const fileHost = document.createElement("div");
const diffHost = document.createElement("div");
const patchHost = document.createElement("div");
const patchFallbackLabel = document.createElement("div");
const patchRenderers: {
  host: HTMLElement;
  renderer: FileDiff<AnnotationMetadata>;
}[] = [];
fileHost.className = "pierre-preview-host";
diffHost.className = "pierre-preview-host";
patchHost.className = "pierre-preview-host";
patchHost.hidden = true;
patchFallbackLabel.className = "review-patch-fallback-label";
patchFallbackLabel.textContent = "Recorded edits could not be aligned with the current file";
patchFallbackLabel.hidden = true;
patchHost.append(patchFallbackLabel);
previewHost.replaceChildren(fileHost, diffHost, patchHost, imageHost);

// Pierre reports selection changes, not activation of an already selected file.
// Its row path attribute is the adapter seam for reopening that file on touch.
treeHost.addEventListener("click", (event) => {
  if (!currentWorkspace.compact || !currentWorkspace.sidebarOpen) {
    return;
  }
  for (const target of event.composedPath()) {
    if (!hasElementDataset(target)) {
      continue;
    }
    const path = target.dataset.itemPath;
    if (path === undefined) {
      continue;
    }
    const file = treePathToFile.get(path);
    if (file?.path === currentWorkspace.selectedPath) {
      post({ path: file.path, requestId: latestRequestId, type: "fileSelect" });
    }
    return;
  }
});

function hasElementDataset(value: EventTarget): value is HTMLElement {
  return "dataset" in value;
}

function requiredElement(id: string): HTMLElement {
  const element = document.getElementById(id);
  if (element === null) {
    throw new Error(`Code review element #${id} is missing`);
  }
  return element;
}

function post(payload: CodeReviewClientPayload): void {
  window.ReactNativeWebView?.postMessage(
    JSON.stringify({ version: CODE_REVIEW_BRIDGE_VERSION, ...payload }),
  );
}

function receiveHostMessage(data: string): void {
  let parsed: unknown;
  try {
    parsed = JSON.parse(data);
  } catch {
    return;
  }
  if (!isHostCommand(parsed) || parsed.sequence <= latestHostSequence) {
    return;
  }
  latestHostSequence = parsed.sequence;
  switch (parsed.command) {
    case "document":
      latestRequestId = parsed.payload.requestId;
      currentDocument = parsed.payload.document;
      renderCurrentDocument();
      break;
    case "settings":
      currentMode = parsed.payload.mode;
      wrapLines = parsed.payload.wrapLines;
      // Pierre skips rendering when the file and annotations are unchanged.
      // Display-only options are not part of that equality check, so settings
      // changes must explicitly invalidate the fast path.
      renderCurrentDocument(true);
      break;
    case "comments":
      currentComments = parsed.payload;
      refreshAnnotations();
      break;
    case "workspace":
      updateWorkspace(parsed.payload);
      break;
    case "selection":
      currentSelection = parsed.payload;
      highlightSelection();
      break;
    case "reveal":
      pendingReveal = parsed.payload;
      revealedReference = parsed.payload;
      revealPendingLine(activeFileRenderer ?? activeDiffRenderer);
      break;
  }
}

function isHostCommand(value: unknown): value is CodeReviewHostCommand {
  return isHostEnvelope(value) && isHostCommandName(value.command);
}

function isHostEnvelope(value: unknown): value is {
  command: string;
  payload: unknown;
  sequence: number;
  version: typeof CODE_REVIEW_BRIDGE_VERSION;
} {
  if (!isRecord(value)) {
    return false;
  }
  return (
    value.version === CODE_REVIEW_BRIDGE_VERSION &&
    Number.isSafeInteger(value.sequence) &&
    typeof value.command === "string" &&
    "payload" in value
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isHostCommandName(value: string): boolean {
  return ["document", "settings", "comments", "workspace", "selection", "reveal"].includes(value);
}

function updateWorkspace(payload: CodeReviewWorkspaceState): void {
  const pathsChanged = tree === null || payload.revision !== currentWorkspace.revision;
  currentWorkspace = payload;
  workspaceHost.dataset.compact = payload.compact ? "true" : "false";
  workspaceHost.dataset.sidebarOpen = payload.sidebarOpen ? "true" : "false";
  treePathToFile = new Map(payload.files.map((file) => [file.treePath, file]));
  treeHost.hidden = payload.files.length === 0;
  setEmptyState(treeEmptyHost, payload.files.length === 0 ? EMPTY_CHANGES_TREE_STATE : null);
  const instance = ensureTree(payload);
  if (pathsChanged && tree !== null) {
    instance.resetPaths(payload.files.map((file) => file.treePath));
    instance.setGitStatus(gitStatus(payload.files));
  } else {
    instance.setGitStatus(gitStatus(payload.files));
  }
  refreshReviewDecorations(instance, payload.files);
  selectTreeFile(payload.selectedPath, pathsChanged);
  if (currentDocument === null) {
    renderCurrentDocument();
  }
}

function ensureTree(payload: CodeReviewWorkspaceState): FileTree {
  if (tree !== null) {
    return tree;
  }
  tree = new FileTree({
    density: "compact",
    flattenEmptyDirectories: true,
    gitStatus: gitStatus(payload.files),
    icons: "complete",
    initialExpansion: "open",
    paths: payload.files.map((file) => file.treePath),
    // Pierre recomputes sticky ancestors on every scroll event. The Changes
    // tree does not need that desktop affordance, and disabling it keeps the
    // Android WebView scroll path limited to virtual-window updates.
    fileTreeSearchMode: "expand-matches",
    onSelectionChange: (selectedPaths) => {
      const selected = selectedPaths
        .map((path) => treePathToFile.get(path))
        .find((file) => file !== undefined);
      if (selected === undefined) {
        return;
      }
      selectedTreePath = selected.treePath;
      if (selected.path === currentWorkspace.selectedPath) {
        return;
      }
      post({
        path: selected.path,
        requestId: latestRequestId,
        type: "fileSelect",
      });
    },
    overscan: FILE_TREE_OVERSCAN,
    renderRowDecoration: ({ row }) => {
      const file = treePathToFile.get(row.path);
      if (file === undefined) {
        return null;
      }
      if (file.sourceOnly === true) {
        return {
          parts: [{ color: "#8b949e", text: "Attachment" }],
          text: "Attachment",
        };
      }
      if (file.review !== undefined) {
        // PR rows keep the lane for review state; counts live in the file toolbar.
        const review = reviewDecoration(file.review);
        return review.length === 0 ? null : decorationText(review);
      }
      if (file.countsAreNet === false) {
        return null;
      }
      return decorationText([
        { color: "#3fb950", text: `+${String(file.additions)}` },
        { color: "#f85149", text: ` −${String(file.deletions)}` },
      ]);
    },
    search: true,
    stickyFolders: false,
    unsafeCSS: TOUCH_FILE_TREE_CSS,
  });
  tree.render({ containerWrapper: treeHost });
  const treeContainer = tree.getFileTreeContainer();
  if (treeContainer !== undefined) {
    for (const [property, value] of Object.entries(treeThemeStyles)) {
      treeContainer.style.setProperty(property, value);
    }
  }
  return tree;
}

type DecorationPart = { readonly color: string; readonly text: string };

/** `✎2 ✓`: pending drafts and the viewed mark of a PR file. */
function reviewDecoration(review: NonNullable<CodeReviewFileItem["review"]>): DecorationPart[] {
  const parts: DecorationPart[] = [];
  if (review.drafts > 0) {
    parts.push({ color: "#78a9ff", text: `✎${String(review.drafts)}` });
  }
  if (review.viewed) {
    parts.push({ color: "#3fb950", text: parts.length === 0 ? "✓" : " ✓" });
  }
  return parts;
}

/** Redraws row decorations when a viewed mark or draft count changed. */
function refreshReviewDecorations(instance: FileTree, files: readonly CodeReviewFileItem[]): void {
  const nextReviewSignature = reviewSignature(files);
  if (nextReviewSignature === currentReviewSignature) {
    return;
  }
  currentReviewSignature = nextReviewSignature;
  // Row decorations read the file map lazily; re-rendering the root redraws them
  // without resetting paths, expansion or scroll.
  instance.setComposition(instance.getComposition());
}

function reviewSignature(files: readonly CodeReviewFileItem[]): string {
  return files
    .map((file) =>
      file.review === undefined
        ? ""
        : `${file.treePath}:${String(file.review.drafts)}:${file.review.viewed ? "1" : "0"}`,
    )
    .join("|");
}

function decorationText(parts: readonly DecorationPart[]): {
  parts: readonly DecorationPart[];
  text: string;
} {
  return { parts, text: parts.map((part) => part.text).join("") };
}

function gitStatus(files: readonly CodeReviewFileItem[]): GitStatusEntry[] {
  return files.map((file) => ({ path: file.treePath, status: file.status }));
}

function selectTreeFile(path: string | null, scroll: boolean): void {
  const instance = tree;
  if (instance === null) {
    return;
  }
  const nextTreePath = treePathForFile(path);
  if (nextTreePath === selectedTreePath && !scroll) {
    return;
  }
  selectedTreePath = nextTreePath;
  for (const selected of instance.getSelectedPaths()) {
    if (selected !== nextTreePath) {
      instance.getItem(selected)?.deselect();
    }
  }
  if (nextTreePath === null) {
    return;
  }
  selectTreeItem(instance, nextTreePath, scroll);
}

function treePathForFile(path: string | null): string | null {
  return currentWorkspace.files.find((file) => file.path === path)?.treePath ?? null;
}

function selectTreeItem(instance: FileTree, path: string, scroll: boolean): void {
  const item = instance.getItem(path);
  if (item?.isSelected() !== true) {
    item?.select();
  }
  if (scroll) {
    instance.scrollToPath(path, { focus: false, offset: "nearest" });
  }
}

function renderCurrentDocument(forceRender = false): void {
  imageHost.hidden = true;
  const document = currentDocument;
  if (document?.displayState !== "image") {
    imageElement.removeAttribute("src");
  }
  if (document === null) {
    renderMissingDocument();
    return;
  }
  const requestId = latestRequestId;
  pendingRender = { requestId, startedAt: performance.now() };
  try {
    const emptyState = codeReviewDocumentEmptyState(document, currentMode);
    if (emptyState !== null) {
      renderEmptyDocument(emptyState);
      return;
    }
    setEmptyState(previewEmptyHost, null);
    renderDocumentContent(document, forceRender);
  } catch (error) {
    pendingRender = null;
    post({
      message: error instanceof Error ? error.message : "Code preview failed",
      requestId,
      type: "error",
    });
  }
}

function renderImageDocument(document: CodeReviewDocument & { displayState: "image" }): void {
  fileHost.hidden = true;
  diffHost.hidden = true;
  patchHost.hidden = true;
  activeFileRenderer = null;
  activeDiffRenderer = null;
  imageHost.hidden = false;
  imageElement.setAttribute("src", document.imageDataUrl);
  finishRender();
}

function renderMissingDocument(): void {
  fileHost.hidden = true;
  diffHost.hidden = true;
  patchHost.hidden = true;
  if (currentWorkspace.files.length === 0) {
    setEmptyState(previewEmptyHost, EMPTY_CHANGES_STATE);
  } else if (currentWorkspace.selectedPath !== null) {
    setEmptyState(previewEmptyHost, LOADING_CHANGE_STATE, true);
  } else {
    setEmptyState(previewEmptyHost, {
      message: "Choose a changed file from the tree.",
      title: "Select a file",
    });
  }
}

function renderEmptyDocument(emptyState: CodeReviewEmptyState): void {
  fileHost.hidden = true;
  diffHost.hidden = true;
  patchHost.hidden = true;
  activeFileRenderer = null;
  activeDiffRenderer = null;
  setEmptyState(previewEmptyHost, emptyState);
  finishRender();
}

function renderDocumentContent(document: CodeReviewDocument, forceRender: boolean): void {
  if (document.displayState === "image") {
    renderImageDocument(document);
    return;
  }
  if (document.displayState === "unsupported") {
    return;
  }
  if (currentMode === "source") {
    renderSource(document, forceRender);
  } else {
    renderDiff(document, currentMode, forceRender);
  }
}

function setEmptyState(
  host: HTMLElement,
  state: CodeReviewEmptyState | null,
  loading = false,
): void {
  host.hidden = state === null;
  if (loading) {
    host.dataset.loading = "true";
  } else {
    delete host.dataset.loading;
  }
  if (state === null) {
    return;
  }
  const title = host.querySelector<HTMLElement>("[data-empty-title]");
  const message = host.querySelector<HTMLElement>("[data-empty-message]");
  if (title !== null) {
    title.textContent = state.title;
  }
  if (message !== null) {
    message.textContent = state.message;
  }
}

function renderSource(payload: CodeReviewDocument, forceRender = false): void {
  fileHost.hidden = false;
  diffHost.hidden = true;
  patchHost.hidden = true;
  const instance = ensureFileRenderer();
  instance.setOptions(fileOptions());
  activeFileRenderer = instance;
  activeDiffRenderer = null;
  instance.render({
    containerWrapper: fileHost,
    file: fileContents(payload.path, payload.source, `${payload.revision}:source`),
    forceRender,
    lineAnnotations: fileAnnotations(payload),
  });
  revealPendingLine(instance);
}

function renderDiff(
  payload: CodeReviewDocument,
  mode: Exclude<CodeReviewViewMode, "source">,
  forceRender = false,
): void {
  const before = materializeBeforeSource(payload);
  if (before === null) {
    if (payload.fullFileDiff === true) {
      renderEmptyDocument({
        message: "Recorded edits cannot be aligned with the current file.",
        title: "Diff unavailable",
      });
      return;
    }
    renderRecordedPatches(payload, mode, forceRender);
    return;
  }
  fileHost.hidden = true;
  diffHost.hidden = false;
  patchHost.hidden = true;
  const instance = ensureDiffRenderer();
  instance.setOptions(diffOptions(mode));
  activeFileRenderer = null;
  activeDiffRenderer = instance;
  instance.render({
    containerWrapper: diffHost,
    forceRender,
    lineAnnotations: diffAnnotations(payload),
    newFile: fileContents(payload.path, payload.source, `${payload.revision}:new`),
    oldFile: fileContents(payload.path, before, `${payload.revision}:old`),
  });
  revealPendingLine(instance);
}

/** Recorded edits are authoritative even without a complete before/after file. */
function renderRecordedPatches(
  payload: CodeReviewDocument,
  mode: Exclude<CodeReviewViewMode, "source">,
  forceRender: boolean,
): void {
  renderRecordedSource(payload, forceRender);
  diffHost.hidden = true;
  patchHost.hidden = false;
  while (patchRenderers.length > payload.patches.length) {
    const removed = patchRenderers.pop();
    removed?.renderer.cleanUp();
    removed?.host.remove();
  }
  for (const [index, patch] of payload.patches.entries()) {
    const patchText = canonicalPatch(payload.path, patch);
    const metadata = processFile(patchText, {
      cacheKey: `${payload.revision}:recorded:${String(index)}`,
      throwOnError: true,
    });
    if (metadata === undefined) {
      throw new Error("The recorded patch could not be rendered");
    }
    let entry = patchRenderers.at(index);
    if (entry === undefined) {
      const host = document.createElement("section");
      patchHost.append(host);
      entry = {
        host,
        renderer: new FileDiff<AnnotationMetadata>(diffOptions(mode)),
      };
      patchRenderers.push(entry);
    }
    const instance = entry.renderer;
    instance.setOptions({
      ...diffOptions(mode),
      onLineNumberClick: (event) => {
        activeFileRenderer = null;
        activeDiffRenderer = instance;
        const side = diffSide(event);
        selectLine(
          lineReference({
            line: event.lineNumber,
            path: payload.path,
            side,
            text: patchLineText(patchText, side, event.lineNumber),
          }),
        );
      },
    });
    activeFileRenderer = null;
    activeDiffRenderer = instance;
    instance.render({
      containerWrapper: entry.host,
      fileDiff: metadata,
      forceRender,
      lineAnnotations: diffAnnotations(payload),
    });
  }
}

function renderRecordedSource(payload: CodeReviewDocument, forceRender: boolean): void {
  const showSource =
    payload.fullFileDiff === true && payload.source !== "" && payload.displayState !== "deleted";
  patchFallbackLabel.hidden = !showSource;
  if (showSource) {
    renderSource(payload, forceRender);
    return;
  }
  fileHost.hidden = true;
}

function ensureFileRenderer(): PierreFile<AnnotationMetadata> {
  fileRenderer ??= new PierreFile<AnnotationMetadata>(fileOptions());
  return fileRenderer;
}

function ensureDiffRenderer(): FileDiff<AnnotationMetadata> {
  diffRenderer ??= new FileDiff<AnnotationMetadata>(diffOptions("unified"));
  return diffRenderer;
}

function fileOptions(): FileOptions<AnnotationMetadata> {
  return {
    disableFileHeader: true,
    lineHoverHighlight: "number",
    onLineNumberClick: (event: OnLineClickProps) => {
      if (currentDocument !== null) {
        selectLine(
          lineReference({
            line: event.lineNumber,
            path: currentDocument.path,
            side: "new",
            text: sourceLineText(currentDocument.source, event.lineNumber),
          }),
        );
      }
    },
    onPostRender: () => {
      finishRender();
    },
    overflow: wrapLines ? "wrap" : "scroll",
    renderAnnotation,
    stickyHeader: false,
    themeType: "dark",
  };
}

function diffOptions(
  mode: Exclude<CodeReviewViewMode, "source">,
): FileDiffOptions<AnnotationMetadata> {
  return {
    collapsedContextThreshold: Number.MAX_SAFE_INTEGER,
    diffIndicators: "bars",
    diffStyle: mode === "split" ? "split" : "unified",
    disableFileHeader: true,
    expandUnchanged: true,
    hunkSeparators: "simple",
    lineDiffType: "word-alt",
    lineHoverHighlight: "number",
    onLineNumberClick: (event: OnDiffLineClickProps) => {
      if (currentDocument !== null) {
        selectLine(referenceForDiffLine(currentDocument, event));
      }
    },
    onPostRender: () => {
      finishRender();
    },
    overflow: wrapLines ? "wrap" : "scroll",
    renderAnnotation,
    stickyHeader: false,
    themeType: "dark",
  };
}

function finishRender(): void {
  const pending = pendingRender;
  if (pending === null || pending.requestId !== latestRequestId) {
    return;
  }
  pendingRender = null;
  post({
    renderMs: performance.now() - pending.startedAt,
    requestId: pending.requestId,
    type: "rendered",
  });
}

function fileContents(path: string, contents: string, cacheKey: string): FileContents {
  return { cacheKey, contents, name: path };
}

function materializeBeforeSource(payload: CodeReviewDocument): string | null {
  if (materializedBefore.has(payload.revision)) {
    return materializedBefore.get(payload.revision) ?? null;
  }
  const source = reconstructBeforeSource(payload);
  rememberMaterialized(payload.revision, source);
  return source;
}

function rememberMaterialized(revision: string, source: string | null): void {
  materializedBefore.set(revision, source);
  while (materializedBefore.size > MATERIALIZED_SOURCE_CACHE_LIMIT) {
    const oldest = materializedBefore.keys().next().value;
    if (oldest === undefined) {
      break;
    }
    materializedBefore.delete(oldest);
  }
}

/** A line of the before/after diff, quoting its text from that side's complete file. */
function referenceForDiffLine(
  payload: CodeReviewDocument,
  event: OnDiffLineClickProps,
): CodeReviewLineReference {
  const side = diffSide(event);
  const source = side === "old" ? materializeBeforeSource(payload) : payload.source;
  return lineReference({
    line: event.lineNumber,
    path: payload.path,
    side,
    text: sourceLineText(source, event.lineNumber),
  });
}

function diffSide(event: OnDiffLineClickProps): CodeReviewLineReference["side"] {
  return event.annotationSide === "deletions" ? "old" : "new";
}

/** A tapped line becomes the composer's anchor at once; the native host then opens its composer. */
function selectLine(reference: CodeReviewLineReference): void {
  currentSelection = reference;
  post({ reference, requestId: latestRequestId, type: "lineTap" });
  highlightSelection();
}

function highlightSelection(): void {
  const active = activeFileRenderer ?? activeDiffRenderer;
  if (active !== null) {
    selectPreviewLine(active);
  }
}

function refreshAnnotations(): void {
  const document = currentDocument;
  const active = activeFileRenderer ?? activeDiffRenderer;
  if (document === null || active === null) {
    return;
  }
  if (activeFileRenderer !== null) {
    activeFileRenderer.setLineAnnotations(fileAnnotations(document));
  }
  if (activeDiffRenderer !== null) {
    activeDiffRenderer.setLineAnnotations(diffAnnotations(document));
  }
  active.rerender();
  selectPreviewLine(active);
}

/** Highlights the composer's line, else the last revealed line of this document. */
function selectPreviewLine(
  instance: PierreFile<AnnotationMetadata> | FileDiff<AnnotationMetadata>,
): void {
  const path = currentDocument?.path;
  const selected =
    currentSelection?.path === path
      ? currentSelection
      : revealedReference?.path === path
        ? revealedReference
        : null;
  instance.setSelectedLines(
    selected === null
      ? null
      : {
          end: selected.line,
          side: selected.side === "old" ? "deletions" : "additions",
          start: selected.line,
        },
    { notify: false },
  );
}

function revealPendingLine(
  instance: PierreFile<AnnotationMetadata> | FileDiff<AnnotationMetadata> | null,
): void {
  if (instance === null || pendingReveal === null || currentDocument?.path !== pendingReveal.path) {
    return;
  }
  const reveal = pendingReveal;
  pendingReveal = null;
  instance.setSelectedLines(
    {
      end: reveal.line,
      side: reveal.side === "old" ? "deletions" : "additions",
      start: reveal.line,
    },
    { notify: false },
  );
  requestAnimationFrame(() => {
    const host = currentMode === "source" ? fileHost : diffHost;
    const candidates = host.querySelectorAll<HTMLElement>(
      `[data-column-number="${String(reveal.line)}"]`,
    );
    if (candidates.length === 0) {
      return;
    }
    const target =
      reveal.side === "old" ? candidates.item(0) : candidates.item(candidates.length - 1);
    target.scrollIntoView({ block: "center", inline: "nearest" });
  });
}

function fileAnnotations(payload: CodeReviewDocument): LineAnnotation<AnnotationMetadata>[] {
  const annotations: LineAnnotation<AnnotationMetadata>[] = [];
  for (const comment of currentComments) {
    if (comment.path === payload.path && comment.side === "new") {
      annotations.push({ lineNumber: comment.line, metadata: { comment } });
    }
  }
  return annotations;
}

function diffAnnotations(payload: CodeReviewDocument): DiffLineAnnotation<AnnotationMetadata>[] {
  const annotations: DiffLineAnnotation<AnnotationMetadata>[] = [];
  for (const comment of currentComments) {
    if (comment.path === payload.path) {
      annotations.push({
        lineNumber: comment.line,
        metadata: { comment },
        side: comment.side === "old" ? "deletions" : "additions",
      });
    }
  }
  return annotations;
}

/**
 * A comment under its line. A pending one keeps its text in place with the
 * shimmer; a failed one stops shimmering and shows the owner's reason below.
 */
function renderAnnotation(
  annotation: LineAnnotation<AnnotationMetadata> | DiffLineAnnotation<AnnotationMetadata>,
): HTMLElement {
  const { comment } = annotation.metadata;
  const root = document.createElement("div");
  root.className = "review-comment";
  root.dataset.state = comment.state;
  const body = document.createElement("div");
  body.className = "review-comment-body";
  body.textContent = comment.body;
  root.append(body);
  if (comment.state === "pending") {
    root.setAttribute("aria-busy", "true");
  }
  if (comment.state === "failed") {
    const error = document.createElement("div");
    error.className = "review-comment-error";
    error.setAttribute("role", "alert");
    error.textContent = comment.error;
    root.append(error);
  }
  return root;
}

declare global {
  interface Window {
    ReactNativeWebView?: { postMessage: (value: string) => void };
  }
}

function receiveWindowMessage(event: MessageEvent<string>): void {
  receiveHostMessage(event.data);
}

function receiveDocumentMessage(event: Event): void {
  if ("data" in event && typeof event.data === "string") {
    receiveHostMessage(event.data);
  }
}

function startEditor(): void {
  window.addEventListener("message", receiveWindowMessage);
  document.addEventListener("message", receiveDocumentMessage);
  window.addEventListener("beforeunload", () => {
    tree?.cleanUp();
    fileRenderer?.cleanUp();
    diffRenderer?.cleanUp();
  });
  post({ type: "ready" });
}

if (typeof window !== "undefined") {
  startEditor();
}
