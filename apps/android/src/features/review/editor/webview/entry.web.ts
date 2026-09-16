import {
  File as PierreFile,
  FileDiff,
  processFile,
  type DiffLineAnnotation,
  type FileContents,
  type FileDiffMetadata,
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

import {
  CODE_REVIEW_BRIDGE_VERSION,
  type CodeReviewClientEvent,
  type CodeReviewComposerState,
  type CodeReviewDocument,
  type CodeReviewFileItem,
  type CodeReviewHostCommand,
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
import type { CodeReviewComment, CodeReviewLineReference } from "../../comments/reviewComment";

type AnnotationMetadata =
  | { body: string; id: string; kind: "comment" }
  | ({ kind: "composer" } & CodeReviewComposerState);
type CodeReviewClientPayload = CodeReviewClientEvent extends infer Event
  ? Event extends CodeReviewClientEvent
    ? Omit<Event, "version">
    : never
  : never;
type ComposerEventTargets = {
  input: HTMLTextAreaElement;
  reference: CodeReviewLineReference;
  submit: HTMLButtonElement;
  voice: HTMLButtonElement;
};

const FILE_TREE_OVERSCAN = 4;
const MATERIALIZED_SOURCE_CACHE_LIMIT = 24;
const MAX_COMPOSER_HEIGHT_PX = 120;

let latestRequestId = 0;
let latestHostSequence = 0;
let currentDocument: CodeReviewDocument | null = null;
let currentComments: readonly CodeReviewComment[] = [];
let currentWorkspace: CodeReviewWorkspaceState = {
  compact: false,
  files: [],
  revision: "",
  selectedPath: null,
  sidebarOpen: false,
};
let currentComposer: CodeReviewComposerState | null = null;
let currentMode: CodeReviewViewMode = "source";
let wrapLines = false;
let tree: FileTree | null = null;
let treePathToFile = new Map<string, CodeReviewFileItem>();
let selectedTreePath: string | null = null;
let fileRenderer: PierreFile<AnnotationMetadata> | null = null;
let diffRenderer: FileDiff<AnnotationMetadata> | null = null;
let activeFileRenderer: PierreFile<AnnotationMetadata> | null = null;
let activeDiffRenderer: FileDiff<AnnotationMetadata> | null = null;
let pendingRender: { requestId: number; startedAt: number } | null = null;
let pendingReveal: CodeReviewLineReference | null = null;
let revealedReference: CodeReviewLineReference | null = null;
let composerInput: HTMLTextAreaElement | null = null;
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
`;

const treeHost = requiredElement("tree");
const treeEmptyHost = requiredElement("tree-empty");
const previewHost = requiredElement("preview");
const previewEmptyHost = requiredElement("preview-empty");
const workspaceHost = requiredElement("workspace");
const fileHost = document.createElement("div");
const diffHost = document.createElement("div");
const patchHost = document.createElement("div");
const patchRenderers: { host: HTMLElement; renderer: FileDiff<AnnotationMetadata> }[] = [];
fileHost.className = "pierre-preview-host";
diffHost.className = "pierre-preview-host";
patchHost.className = "pierre-preview-host";
patchHost.hidden = true;
previewHost.replaceChildren(fileHost, diffHost, patchHost);

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
      currentComposer = null;
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
    case "composer":
      updateComposer(parsed.payload);
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
  return ["document", "settings", "comments", "workspace", "composer", "reveal"].includes(value);
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
      post({ path: selected.path, requestId: latestRequestId, type: "fileSelect" });
    },
    overscan: FILE_TREE_OVERSCAN,
    renderRowDecoration: ({ row }) => {
      const file = treePathToFile.get(row.path);
      if (file === undefined) {
        return null;
      }
      if (file.sourceOnly === true) {
        return { parts: [{ color: "#8b949e", text: "Attachment" }], text: "Attachment" };
      }
      return {
        parts: [
          { color: "#3fb950", text: `+${String(file.additions)}` },
          { color: "#f85149", text: ` −${String(file.deletions)}` },
        ],
        text: `+${String(file.additions)} −${String(file.deletions)}`,
      };
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
  const document = currentDocument;
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
  fileHost.hidden = true;
  diffHost.hidden = true;
  patchHost.hidden = false;
  while (patchRenderers.length > payload.patches.length) {
    const removed = patchRenderers.pop();
    removed?.renderer.cleanUp();
    removed?.host.remove();
  }
  for (const [index, patch] of payload.patches.entries()) {
    const metadata = processFile(canonicalPatch(payload.path, patch), {
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
      entry = { host, renderer: new FileDiff<AnnotationMetadata>(diffOptions(mode)) };
      patchRenderers.push(entry);
    }
    const instance = entry.renderer;
    instance.setOptions({
      ...diffOptions(mode),
      onLineNumberClick: (event) => {
        activeFileRenderer = null;
        activeDiffRenderer = instance;
        openComposer(referenceForDiffLine(payload.path, event));
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
        openComposer(referenceForFileLine(currentDocument.path, event.lineNumber));
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
        openComposer(referenceForDiffLine(currentDocument.path, event));
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
  const source = tryMaterializeBeforeSource(payload);
  rememberMaterialized(payload.revision, source);
  return source;
}

function tryMaterializeBeforeSource(payload: CodeReviewDocument): string | null {
  const lines = payload.source.split("\n");
  try {
    return reverseRecordedPatches(payload, lines) ? lines.join("\n") : null;
  } catch {
    return null;
  }
}

function reverseRecordedPatches(payload: CodeReviewDocument, lines: string[]): boolean {
  for (let patchIndex = payload.patches.length - 1; patchIndex >= 0; patchIndex -= 1) {
    const patch = payload.patches.at(patchIndex);
    if (patch === undefined || patch.diff === "") {
      continue;
    }
    const metadata = processFile(canonicalPatch(payload.path, patch), {
      cacheKey: `${payload.revision}:patch:${String(patchIndex)}`,
      throwOnError: true,
    });
    if (metadata === undefined || !reversePatch(lines, metadata)) {
      return false;
    }
  }
  return true;
}

function reversePatch(lines: string[], metadata: FileDiffMetadata): boolean {
  for (let hunkIndex = metadata.hunks.length - 1; hunkIndex >= 0; hunkIndex -= 1) {
    const hunk = metadata.hunks.at(hunkIndex);
    if (hunk === undefined) {
      continue;
    }
    const start = Math.max(0, hunk.additionStart - 1);
    const after = metadata.additionLines
      .slice(hunk.additionLineIndex, hunk.additionLineIndex + hunk.additionCount)
      .map(stripLineEnding);
    const before = metadata.deletionLines
      .slice(hunk.deletionLineIndex, hunk.deletionLineIndex + hunk.deletionCount)
      .map(stripLineEnding);
    if (!sameLines(lines, start, after)) {
      return false;
    }
    lines.splice(start, after.length, ...before);
  }
  return true;
}

function sameLines(lines: readonly string[], start: number, expected: readonly string[]): boolean {
  return expected.every((line, offset) => lines[start + offset] === line);
}

function stripLineEnding(value: string): string {
  return value.replace(/\r?\n$/, "");
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

function referenceForFileLine(path: string, line: number): CodeReviewLineReference {
  return { coordinate: "file", line, path, side: "new" };
}

function referenceForDiffLine(path: string, event: OnDiffLineClickProps): CodeReviewLineReference {
  return {
    coordinate: "file",
    line: event.lineNumber,
    path,
    side: event.annotationSide === "deletions" ? "old" : "new",
  };
}

function openComposer(reference: CodeReviewLineReference): void {
  const same = currentComposer !== null && sameReference(currentComposer.reference, reference);
  currentComposer = {
    draft: same ? (currentComposer?.draft ?? "") : "",
    reference,
    voiceError: null,
    voicePermissionGranted: false,
    voicePhase: "idle",
    voiceRetryAvailable: false,
  };
  post({ reference, requestId: latestRequestId, type: "lineTap" });
  refreshAnnotations();
}

function updateComposer(payload: CodeReviewComposerState | null): void {
  const previous = currentComposer;
  currentComposer = payload;
  const input = composerInput;
  if (
    payload !== null &&
    previous !== null &&
    input !== null &&
    sameReference(payload.reference, previous.reference)
  ) {
    updateComposerDraft(input, payload.draft);
    if (sameComposerPresentation(payload, previous)) {
      return;
    }
  }
  refreshAnnotations();
}

function updateComposerDraft(input: HTMLTextAreaElement, draft: string): void {
  if (input.value === draft) {
    return;
  }
  input.value = draft;
  resizeComposerInput(input);
}

function sameComposerPresentation(
  left: CodeReviewComposerState,
  right: CodeReviewComposerState,
): boolean {
  return (
    left.voicePhase === right.voicePhase &&
    left.voicePermissionGranted === right.voicePermissionGranted &&
    left.voiceRetryAvailable === right.voiceRetryAvailable &&
    left.voiceError === right.voiceError
  );
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

function selectPreviewLine(
  instance: PierreFile<AnnotationMetadata> | FileDiff<AnnotationMetadata>,
): void {
  if (currentComposer === null) {
    const reveal = revealedReference?.path === currentDocument?.path ? revealedReference : null;
    instance.setSelectedLines(
      reveal === null
        ? null
        : {
            end: reveal.line,
            side: reveal.side === "old" ? "deletions" : "additions",
            start: reveal.line,
          },
      { notify: false },
    );
    return;
  }
  instance.setSelectedLines(
    {
      end: currentComposer.reference.line,
      side: currentComposer.reference.side === "old" ? "deletions" : "additions",
      start: currentComposer.reference.line,
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
      annotations.push({
        lineNumber: comment.line,
        metadata: { body: comment.body, id: comment.id, kind: "comment" },
      });
    }
  }
  if (
    currentComposer !== null &&
    currentComposer.reference.path === payload.path &&
    currentComposer.reference.side === "new"
  ) {
    annotations.push({
      lineNumber: currentComposer.reference.line,
      metadata: { kind: "composer", ...currentComposer },
    });
  }
  return annotations;
}

function diffAnnotations(payload: CodeReviewDocument): DiffLineAnnotation<AnnotationMetadata>[] {
  const annotations: DiffLineAnnotation<AnnotationMetadata>[] = [];
  for (const comment of currentComments) {
    if (comment.path === payload.path) {
      annotations.push({
        lineNumber: comment.line,
        metadata: { body: comment.body, id: comment.id, kind: "comment" },
        side: comment.side === "old" ? "deletions" : "additions",
      });
    }
  }
  if (currentComposer !== null && currentComposer.reference.path === payload.path) {
    annotations.push({
      lineNumber: currentComposer.reference.line,
      metadata: { kind: "composer", ...currentComposer },
      side: currentComposer.reference.side === "old" ? "deletions" : "additions",
    });
  }
  return annotations;
}

function renderAnnotation(
  annotation: LineAnnotation<AnnotationMetadata> | DiffLineAnnotation<AnnotationMetadata>,
): HTMLElement | undefined {
  const metadata = annotation.metadata;
  if (metadata.kind === "comment") {
    const comment = document.createElement("div");
    comment.className = "review-comment";
    comment.textContent = metadata.body;
    return comment;
  }
  return createComposer(metadata);
}

function createComposer(spec: CodeReviewComposerState): HTMLElement {
  const root = document.createElement("div");
  root.className = "review-composer";
  const row = document.createElement("div");
  row.className = "review-composer-row";
  const input = createComposerInput(spec.draft);
  const voice = createVoiceButton(spec);
  const submit = composerButton("send", "Add line comment");
  submit.classList.add("is-submit");
  bindComposerEvents({ input, reference: spec.reference, submit, voice });
  row.append(input, voice, submit);
  root.append(row);
  appendVoiceError(root, spec.voiceError);
  requestAnimationFrame(() => {
    resizeComposerInput(input);
    input.focus({ preventScroll: true });
    input.setSelectionRange(input.value.length, input.value.length);
    root.scrollIntoView({ block: "nearest", inline: "nearest" });
  });
  return root;
}

function createComposerInput(draft: string): HTMLTextAreaElement {
  const input = document.createElement("textarea");
  composerInput = input;
  input.className = "review-composer-input";
  input.placeholder = "Comment on this line…";
  input.rows = 1;
  input.value = draft;
  input.setAttribute("aria-label", "Comment on this line");
  return input;
}

function createVoiceButton(spec: CodeReviewComposerState): HTMLButtonElement {
  const button = composerButton(voiceButtonIcon(spec), voiceButtonLabel(spec));
  applyVoiceButtonState(button, spec);
  return button;
}

function voiceButtonIcon(
  spec: CodeReviewComposerState,
): "loading" | "microphone" | "retry" | "stop" {
  if (spec.voiceRetryAvailable) {
    return "retry";
  }
  if (spec.voicePhase === "starting" || spec.voicePhase === "finishing") {
    return "loading";
  }
  return spec.voicePhase === "idle" ? "microphone" : "stop";
}

function voiceButtonLabel(spec: CodeReviewComposerState): string {
  if (spec.voiceRetryAvailable) {
    return "Retry voice comment";
  }
  return spec.voicePhase === "idle" ? "Record voice comment" : "Stop voice comment";
}

function applyVoiceButtonState(button: HTMLButtonElement, spec: CodeReviewComposerState): void {
  if (spec.voicePhase !== "idle") {
    button.classList.add("is-recording");
  }
  if (spec.voicePhase === "idle" && !spec.voiceRetryAvailable && !spec.voicePermissionGranted) {
    button.classList.add("needs-permission");
    button.setAttribute("aria-label", "Allow microphone access");
  }
  if (spec.voicePhase === "starting" || spec.voicePhase === "finishing") {
    button.classList.add("is-pending");
  }
}

function bindComposerEvents({ input, reference, submit, voice }: ComposerEventTargets): void {
  const syncDraft = () => {
    if (currentComposer !== null && sameReference(currentComposer.reference, reference)) {
      currentComposer = { ...currentComposer, draft: input.value };
    }
    submit.disabled = input.value.trim() === "";
    resizeComposerInput(input);
    post({
      draft: input.value,
      reference,
      requestId: latestRequestId,
      selectionEnd: input.selectionEnd,
      selectionStart: input.selectionStart,
      type: "draftChanged",
    });
  };
  input.addEventListener("input", syncDraft);
  input.addEventListener("select", syncDraft);
  input.addEventListener("keydown", (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
      event.preventDefault();
      submit.click();
    }
  });
  voice.addEventListener("click", () => {
    syncDraft();
    post({
      draft: input.value,
      reference,
      requestId: latestRequestId,
      selectionEnd: input.selectionEnd,
      selectionStart: input.selectionStart,
      type: "voiceAction",
    });
  });
  submit.addEventListener("click", () => {
    const draft = input.value.trim();
    if (draft === "") {
      return;
    }
    post({ draft, reference, requestId: latestRequestId, type: "commentSubmit" });
    currentComposer = null;
    composerInput = null;
    refreshAnnotations();
  });
}

function appendVoiceError(root: HTMLElement, message: string | null): void {
  if (message === null) {
    return;
  }
  const error = document.createElement("div");
  error.className = "review-composer-error";
  error.textContent = message;
  root.append(error);
}

function resizeComposerInput(input: HTMLTextAreaElement): void {
  input.style.height = "0";
  input.style.height = `${String(Math.min(input.scrollHeight, MAX_COMPOSER_HEIGHT_PX))}px`;
}

function composerButton(
  icon: "microphone" | "retry" | "send" | "stop" | "loading",
  label: string,
): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "review-composer-button";
  button.setAttribute("aria-label", label);
  button.innerHTML = composerIcon(icon);
  return button;
}

function composerIcon(icon: "microphone" | "retry" | "send" | "stop" | "loading"): string {
  if (icon === "loading") {
    return '<svg viewBox="0 0 24 24"><path d="M20 12a8 8 0 1 1-8-8"/></svg>';
  }
  if (icon === "send") {
    return '<svg viewBox="0 0 24 24"><path d="M5 12l7-7 7 7M12 5v14"/></svg>';
  }
  if (icon === "retry") {
    return '<svg viewBox="0 0 24 24"><path d="M20 6v5h-5M4 18v-5h5M6.1 9a7 7 0 0111.8-2.2L20 11M4 13l2.1 4.2A7 7 0 0017.9 15"/></svg>';
  }
  if (icon === "stop") {
    return '<svg viewBox="0 0 24 24"><rect x="7" y="7" width="10" height="10" rx="2"/></svg>';
  }
  return '<svg viewBox="0 0 24 24"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M6 11a6 6 0 0012 0M12 17v4M9 21h6"/></svg>';
}

function sameReference(left: CodeReviewLineReference, right: CodeReviewLineReference): boolean {
  return (
    left.path === right.path &&
    left.line === right.line &&
    left.side === right.side &&
    (left.coordinate ?? "file") === (right.coordinate ?? "file")
  );
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
