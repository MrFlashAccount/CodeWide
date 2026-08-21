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
import { FileTree, themeToTreeStyles, type GitStatusEntry, type TreeThemeInput } from "@pierre/trees";

import {
  CODE_REVIEW_BRIDGE_VERSION,
  type CodeReviewClientEvent,
  type CodeReviewComposerState,
  type CodeReviewDocument,
  type CodeReviewFileItem,
  type CodeReviewHostCommand,
  type CodeReviewViewMode,
  type CodeReviewWorkspaceState,
} from "../src/rendering/code-review-bridge";
import {
  codeReviewDocumentEmptyState,
  EMPTY_CHANGES_STATE,
  EMPTY_CHANGES_TREE_STATE,
  type CodeReviewEmptyState,
} from "../src/rendering/code-review-empty-state";
import type { CodeReviewComment, CodeReviewLineReference } from "../src/rendering/code-review";

type AnnotationMetadata =
  | { kind: "comment"; id: string; body: string }
  | ({ kind: "composer" } & CodeReviewComposerState);

let latestRequestId = 0;
let latestHostSequence = 0;
let currentDocument: CodeReviewDocument | null = null;
let currentComments: readonly CodeReviewComment[] = [];
let currentWorkspace: CodeReviewWorkspaceState = { files: [], revision: "", selectedPath: null, sidebarOpen: false, compact: false };
let currentComposer: CodeReviewComposerState | null = null;
let currentMode: CodeReviewViewMode = "source";
let wrapLines = false;
let tree: FileTree | null = null;
let treePathToFile = new Map<string, CodeReviewFileItem>();
let selectedTreePath: string | null = null;
let fileRenderer: PierreFile<AnnotationMetadata> | null = null;
let diffRenderer: FileDiff<AnnotationMetadata> | null = null;
let activeRenderer: PierreFile<AnnotationMetadata> | FileDiff<AnnotationMetadata> | null = null;
let pendingRender: { requestId: number; startedAt: number } | null = null;
let pendingReveal: CodeReviewLineReference | null = null;
let revealedReference: CodeReviewLineReference | null = null;
let composerInput: HTMLTextAreaElement | null = null;
const materializedBefore = new Map<string, string | null>();

const treeTheme = {
  name: "codewide-dark",
  type: "dark",
  colors: {
    "sideBar.background": "#101113",
    "sideBar.foreground": "#f1f3f5",
    "sideBarSectionHeader.foreground": "#8d939c",
    "sideBar.border": "rgba(255,255,255,.12)",
    "list.activeSelectionBackground": "#242a33",
    "list.activeSelectionForeground": "#f1f3f5",
    // Android WebView keeps :hover under the finger while a native scroll is in
    // progress. Keep touch scrolling paint-stable; selection and focus retain
    // their own distinct backgrounds below.
    "list.hoverBackground": "#101113",
    "list.focusBackground": "#242a33",
    "list.focusOutline": "#78a9ff",
    "input.background": "#181a1e",
    "input.foreground": "#f1f3f5",
    "input.border": "rgba(255,255,255,.12)",
    "scrollbarSlider.background": "rgba(255,255,255,.18)",
    "gitDecoration.addedResourceForeground": "#55c58a",
    "gitDecoration.modifiedResourceForeground": "#68cdf2",
    "gitDecoration.deletedResourceForeground": "#f0757b",
  },
} satisfies TreeThemeInput;
const treeThemeStyles = themeToTreeStyles(treeTheme);

const treeHost = requiredElement("tree");
const treeEmptyHost = requiredElement("tree-empty");
const previewHost = requiredElement("preview");
const previewEmptyHost = requiredElement("preview-empty");
const workspaceHost = requiredElement("workspace");
const fileHost = document.createElement("div");
const diffHost = document.createElement("div");
fileHost.className = "pierre-preview-host";
diffHost.className = "pierre-preview-host";
previewHost.replaceChildren(fileHost, diffHost);

function requiredElement(id: string): HTMLElement {
  const element = document.getElementById(id);
  if (element === null) throw new Error(`Code review element #${id} is missing`);
  return element;
}

function post<T extends CodeReviewClientEvent>(payload: Omit<T, "version">): void {
  window.ReactNativeWebView?.postMessage(JSON.stringify({ version: CODE_REVIEW_BRIDGE_VERSION, ...payload }));
}

function receiveHostMessage(event: MessageEvent<string>): void {
  let parsed: unknown;
  try {
    parsed = JSON.parse(event.data);
  } catch {
    return;
  }
  if (!isHostCommand(parsed) || parsed.sequence <= latestHostSequence) return;
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
      revealPendingLine(activeRenderer);
      break;
  }
}

function isHostCommand(value: unknown): value is CodeReviewHostCommand {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const candidate = value as Partial<CodeReviewHostCommand>;
  return candidate.version === CODE_REVIEW_BRIDGE_VERSION
    && Number.isSafeInteger(candidate.sequence)
    && typeof candidate.command === "string"
    && ["document", "settings", "comments", "workspace", "composer", "reveal"].includes(candidate.command);
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
  if (currentDocument === null) renderCurrentDocument();
}

function ensureTree(payload: CodeReviewWorkspaceState): FileTree {
  if (tree !== null) return tree;
  tree = new FileTree({
    paths: payload.files.map((file) => file.treePath),
    gitStatus: gitStatus(payload.files),
    density: "compact",
    initialExpansion: "open",
    flattenEmptyDirectories: true,
    icons: "complete",
    // Pierre recomputes sticky ancestors on every scroll event. The Changes
    // tree does not need that desktop affordance, and disabling it keeps the
    // Android WebView scroll path limited to virtual-window updates.
    stickyFolders: false,
    search: true,
    fileTreeSearchMode: "expand-matches",
    overscan: 4,
    renderRowDecoration: ({ row }) => {
      const file = treePathToFile.get(row.path);
      if (file === undefined) return null;
      if (file.sourceOnly === true) return { text: "Attachment", parts: [{ text: "Attachment", color: "#8b949e" }] };
      return {
        text: `+${file.additions} −${file.deletions}`,
        parts: [
          { text: `+${file.additions}`, color: "#3fb950" },
          { text: ` −${file.deletions}`, color: "#f85149" },
        ],
      };
    },
    onSelectionChange: (selectedPaths) => {
      const selected = selectedPaths.map((path) => treePathToFile.get(path)).find((file) => file !== undefined);
      if (selected === undefined) return;
      selectedTreePath = selected.treePath;
      if (selected.path === currentWorkspace.selectedPath) return;
      post({ type: "fileSelect", requestId: latestRequestId, path: selected.path });
    },
  });
  tree.render({ containerWrapper: treeHost });
  const treeContainer = tree.getFileTreeContainer();
  if (treeContainer !== undefined) {
    for (const [property, value] of Object.entries(treeThemeStyles)) {
      if (value !== undefined) treeContainer.style.setProperty(property, String(value));
    }
  }
  return tree;
}

function gitStatus(files: readonly CodeReviewFileItem[]): GitStatusEntry[] {
  return files.map((file) => ({ path: file.treePath, status: file.status }));
}

function selectTreeFile(path: string | null, scroll: boolean): void {
  if (tree === null) return;
  const nextTreePath = currentWorkspace.files.find((file) => file.path === path)?.treePath ?? null;
  if (nextTreePath === selectedTreePath && !scroll) return;
  selectedTreePath = nextTreePath;
  for (const selected of tree.getSelectedPaths()) {
    if (selected !== nextTreePath) tree.getItem(selected)?.deselect();
  }
  if (nextTreePath !== null) {
    const item = tree.getItem(nextTreePath);
    if (item?.isSelected() !== true) item?.select();
    if (scroll) tree.scrollToPath(nextTreePath, { offset: "nearest", focus: false });
  }
}

function renderCurrentDocument(forceRender = false): void {
  if (currentDocument === null) {
    fileHost.hidden = true;
    diffHost.hidden = true;
    setEmptyState(previewEmptyHost, currentWorkspace.files.length === 0
      ? EMPTY_CHANGES_STATE
      : { title: "Select a file", message: "Choose a changed file from the tree." });
    return;
  }
  const requestId = latestRequestId;
  pendingRender = { requestId, startedAt: performance.now() };
  try {
    const emptyState = codeReviewDocumentEmptyState(currentDocument, currentMode);
    if (emptyState !== null) {
      fileHost.hidden = true;
      diffHost.hidden = true;
      activeRenderer = null;
      setEmptyState(previewEmptyHost, emptyState);
      finishRender();
      return;
    }
    setEmptyState(previewEmptyHost, null);
    if (currentMode === "source") renderSource(currentDocument, forceRender);
    else renderDiff(currentDocument, currentMode, forceRender);
  } catch (cause) {
    pendingRender = null;
    post({ type: "error", requestId, message: cause instanceof Error ? cause.message : "Code preview failed" });
  }
}

function setEmptyState(host: HTMLElement, state: CodeReviewEmptyState | null): void {
  host.hidden = state === null;
  if (state === null) return;
  const title = host.querySelector<HTMLElement>("[data-empty-title]");
  const message = host.querySelector<HTMLElement>("[data-empty-message]");
  if (title !== null) title.textContent = state.title;
  if (message !== null) message.textContent = state.message;
}

function renderSource(payload: CodeReviewDocument, forceRender = false): void {
  fileHost.hidden = false;
  diffHost.hidden = true;
  const instance = ensureFileRenderer();
  instance.setOptions(fileOptions());
  activeRenderer = instance;
  instance.render({
    containerWrapper: fileHost,
    file: fileContents(payload.path, payload.source, `${payload.revision}:source`),
    lineAnnotations: fileAnnotations(payload),
    forceRender,
  });
  revealPendingLine(instance);
}

function renderDiff(payload: CodeReviewDocument, mode: Exclude<CodeReviewViewMode, "source">, forceRender = false): void {
  const before = materializeBeforeSource(payload);
  if (before === null) {
    post({ type: "diffUnavailable", requestId: latestRequestId, message: "The complete previous version is unavailable. Showing the current file." });
    renderSource(payload, forceRender);
    return;
  }
  fileHost.hidden = true;
  diffHost.hidden = false;
  const instance = ensureDiffRenderer();
  instance.setOptions(diffOptions(mode));
  activeRenderer = instance;
  instance.render({
    containerWrapper: diffHost,
    oldFile: fileContents(payload.path, before, `${payload.revision}:old`),
    newFile: fileContents(payload.path, payload.source, `${payload.revision}:new`),
    lineAnnotations: diffAnnotations(payload),
    forceRender,
  });
  revealPendingLine(instance);
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
    themeType: "dark",
    overflow: wrapLines ? "wrap" : "scroll",
    stickyHeader: false,
    lineHoverHighlight: "number",
    onLineNumberClick: (event: OnLineClickProps) => {
      if (currentDocument !== null) openComposer(referenceForFileLine(currentDocument.path, event.lineNumber));
    },
    renderAnnotation,
    onPostRender: () => finishRender(),
  };
}

function diffOptions(mode: Exclude<CodeReviewViewMode, "source">): FileDiffOptions<AnnotationMetadata> {
  return {
    disableFileHeader: true,
    themeType: "dark",
    diffStyle: mode === "split" ? "split" : "unified",
    diffIndicators: "bars",
    hunkSeparators: "simple",
    expandUnchanged: true,
    collapsedContextThreshold: Number.MAX_SAFE_INTEGER,
    lineDiffType: "word-alt",
    overflow: wrapLines ? "wrap" : "scroll",
    stickyHeader: false,
    lineHoverHighlight: "number",
    onLineNumberClick: (event: OnDiffLineClickProps) => {
      if (currentDocument !== null) openComposer(referenceForDiffLine(currentDocument.path, event));
    },
    renderAnnotation,
    onPostRender: () => finishRender(),
  };
}

function finishRender(): void {
  const pending = pendingRender;
  if (pending === null || pending.requestId !== latestRequestId) return;
  pendingRender = null;
  post({ type: "rendered", requestId: pending.requestId, renderMs: performance.now() - pending.startedAt });
}

function fileContents(path: string, contents: string, cacheKey: string): FileContents {
  return { name: path, contents, cacheKey };
}

function materializeBeforeSource(payload: CodeReviewDocument): string | null {
  const cached = materializedBefore.get(payload.revision);
  if (cached !== undefined || materializedBefore.has(payload.revision)) return cached ?? null;
  let lines = payload.source.split("\n");
  try {
    for (let patchIndex = payload.patches.length - 1; patchIndex >= 0; patchIndex -= 1) {
      const patch = payload.patches[patchIndex];
      if (patch === undefined || patch.diff === "") continue;
      const metadata = processFile(canonicalPatch(payload.path, patch), { cacheKey: `${payload.revision}:patch:${patchIndex}`, throwOnError: true });
      if (metadata === undefined || !reversePatch(lines, metadata)) {
        rememberMaterialized(payload.revision, null);
        return null;
      }
    }
    const source = lines.join("\n");
    rememberMaterialized(payload.revision, source);
    return source;
  } catch {
    rememberMaterialized(payload.revision, null);
    return null;
  }
}

function canonicalPatch(path: string, patch: CodeReviewDocument["patches"][number]): string {
  const raw = patch.diff.trimEnd();
  if (/^---\s/m.test(raw) && /^\+\+\+\s/m.test(raw)) return raw;
  const normalizedPath = path.replace(/^\/+/, "");
  if (/^@@\s/m.test(raw)) return `--- a/${normalizedPath}\n+++ b/${normalizedPath}\n${raw}`;
  if (patch.kind === "update") throw new Error("Headerless update patch is not authoritative");
  const lines = logicalLines(raw);
  if (patch.kind === "add") {
    return `--- /dev/null\n+++ b/${normalizedPath}\n@@ -0,0 +1,${lines.length} @@\n${lines.map((line) => `+${line}`).join("\n")}`;
  }
  return `--- a/${normalizedPath}\n+++ /dev/null\n@@ -1,${lines.length} +0,0 @@\n${lines.map((line) => `-${line}`).join("\n")}`;
}

function reversePatch(lines: string[], metadata: FileDiffMetadata): boolean {
  for (let hunkIndex = metadata.hunks.length - 1; hunkIndex >= 0; hunkIndex -= 1) {
    const hunk = metadata.hunks[hunkIndex];
    if (hunk === undefined) continue;
    const start = Math.max(0, hunk.additionStart - 1);
    const after = metadata.additionLines.slice(hunk.additionLineIndex, hunk.additionLineIndex + hunk.additionCount).map(stripLineEnding);
    const before = metadata.deletionLines.slice(hunk.deletionLineIndex, hunk.deletionLineIndex + hunk.deletionCount).map(stripLineEnding);
    if (!sameLines(lines, start, after)) return false;
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

function logicalLines(value: string): string[] {
  if (value === "") return [];
  const lines = value.split("\n");
  if (lines.at(-1) === "") lines.pop();
  return lines;
}

function rememberMaterialized(revision: string, source: string | null): void {
  materializedBefore.set(revision, source);
  while (materializedBefore.size > 24) {
    const oldest = materializedBefore.keys().next().value as string | undefined;
    if (oldest === undefined) break;
    materializedBefore.delete(oldest);
  }
}

function referenceForFileLine(path: string, line: number): CodeReviewLineReference {
  return { path, line, side: "new", coordinate: "file" };
}

function referenceForDiffLine(path: string, event: OnDiffLineClickProps): CodeReviewLineReference {
  return { path, line: event.lineNumber, side: event.annotationSide === "deletions" ? "old" : "new", coordinate: "file" };
}

function openComposer(reference: CodeReviewLineReference): void {
  const same = currentComposer !== null && sameReference(currentComposer.reference, reference);
  currentComposer = {
    reference,
    draft: same ? currentComposer?.draft ?? "" : "",
    voicePhase: "idle",
    voiceRetryAvailable: false,
    voiceError: null,
  };
  post({ type: "lineTap", requestId: latestRequestId, reference });
  refreshAnnotations();
}

function updateComposer(payload: CodeReviewComposerState | null): void {
  const previous = currentComposer;
  currentComposer = payload;
  if (payload !== null && previous !== null && sameReference(payload.reference, previous.reference) && composerInput !== null) {
    if (composerInput.value !== payload.draft) {
      composerInput.value = payload.draft;
      resizeComposerInput(composerInput);
    }
    const presentationChanged = payload.voicePhase !== previous.voicePhase
      || payload.voiceRetryAvailable !== previous.voiceRetryAvailable
      || payload.voiceError !== previous.voiceError;
    if (!presentationChanged) return;
  }
  refreshAnnotations();
}

function refreshAnnotations(): void {
  if (currentDocument === null || activeRenderer === null) return;
  if (activeRenderer instanceof PierreFile) activeRenderer.setLineAnnotations(fileAnnotations(currentDocument));
  else activeRenderer.setLineAnnotations(diffAnnotations(currentDocument));
  activeRenderer.rerender();
  selectPreviewLine(activeRenderer);
}

function selectPreviewLine(instance: PierreFile<AnnotationMetadata> | FileDiff<AnnotationMetadata>): void {
  if (currentComposer === null) {
    const reveal = revealedReference?.path === currentDocument?.path ? revealedReference : null;
    instance.setSelectedLines(reveal === null ? null : {
      start: reveal.line,
      side: reveal.side === "old" ? "deletions" : "additions",
      end: reveal.line,
    }, { notify: false });
    return;
  }
  instance.setSelectedLines({
    start: currentComposer.reference.line,
    side: currentComposer.reference.side === "old" ? "deletions" : "additions",
    end: currentComposer.reference.line,
  }, { notify: false });
}

function revealPendingLine(instance: PierreFile<AnnotationMetadata> | FileDiff<AnnotationMetadata> | null): void {
  if (instance === null || pendingReveal === null || currentDocument?.path !== pendingReveal.path) return;
  const reveal = pendingReveal;
  pendingReveal = null;
  instance.setSelectedLines({
    start: reveal.line,
    end: reveal.line,
    side: reveal.side === "old" ? "deletions" : "additions",
  }, { notify: false });
  requestAnimationFrame(() => {
    const host = currentMode === "source" ? fileHost : diffHost;
    const candidates = host.querySelectorAll<HTMLElement>(`[data-column-number="${reveal.line}"]`);
    const target = reveal.side === "old" ? candidates.item(0) : candidates.item(candidates.length - 1);
    target?.scrollIntoView({ block: "center", inline: "nearest" });
  });
}

function fileAnnotations(payload: CodeReviewDocument): LineAnnotation<AnnotationMetadata>[] {
  const annotations: LineAnnotation<AnnotationMetadata>[] = currentComments
    .filter((comment) => comment.path === payload.path && comment.side === "new")
    .map((comment) => ({ lineNumber: comment.line, metadata: { kind: "comment", id: comment.id, body: comment.body } }));
  if (currentComposer !== null && currentComposer.reference.path === payload.path && currentComposer.reference.side === "new") {
    annotations.push({ lineNumber: currentComposer.reference.line, metadata: { kind: "composer", ...currentComposer } });
  }
  return annotations;
}

function diffAnnotations(payload: CodeReviewDocument): DiffLineAnnotation<AnnotationMetadata>[] {
  const annotations: DiffLineAnnotation<AnnotationMetadata>[] = currentComments
    .filter((comment) => comment.path === payload.path)
    .map((comment) => ({
      side: comment.side === "old" ? "deletions" : "additions",
      lineNumber: comment.line,
      metadata: { kind: "comment", id: comment.id, body: comment.body },
    }));
  if (currentComposer !== null && currentComposer.reference.path === payload.path) {
    annotations.push({
      side: currentComposer.reference.side === "old" ? "deletions" : "additions",
      lineNumber: currentComposer.reference.line,
      metadata: { kind: "composer", ...currentComposer },
    });
  }
  return annotations;
}

function renderAnnotation(annotation: LineAnnotation<AnnotationMetadata> | DiffLineAnnotation<AnnotationMetadata>): HTMLElement | undefined {
  const metadata = annotation.metadata;
  if (metadata === undefined) return undefined;
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
  const input = document.createElement("textarea");
  composerInput = input;
  input.className = "review-composer-input";
  input.placeholder = "Comment on this line…";
  input.rows = 1;
  input.value = spec.draft;
  input.setAttribute("aria-label", "Comment on this line");
  const voice = composerButton(spec.voiceRetryAvailable ? "retry" : spec.voicePhase === "idle" ? "microphone" : "stop", spec.voiceRetryAvailable ? "Retry voice comment" : spec.voicePhase === "idle" ? "Record voice comment" : "Stop voice comment");
  if (spec.voicePhase !== "idle") voice.classList.add("is-recording");
  if (spec.voicePhase === "starting" || spec.voicePhase === "finishing") voice.classList.add("is-pending");
  const submit = composerButton("send", "Add line comment");
  submit.classList.add("is-submit");
  const syncDraft = () => {
    if (currentComposer !== null && sameReference(currentComposer.reference, spec.reference)) currentComposer = { ...currentComposer, draft: input.value };
    submit.disabled = input.value.trim() === "";
    resizeComposerInput(input);
    post({ type: "draftChanged", requestId: latestRequestId, draft: input.value, selectionStart: input.selectionStart, selectionEnd: input.selectionEnd });
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
    post({ type: "voiceAction", requestId: latestRequestId, reference: spec.reference, draft: input.value, selectionStart: input.selectionStart, selectionEnd: input.selectionEnd });
  });
  submit.addEventListener("click", () => {
    const draft = input.value.trim();
    if (draft === "") return;
    post({ type: "commentSubmit", requestId: latestRequestId, reference: spec.reference, draft });
    currentComposer = null;
    composerInput = null;
    refreshAnnotations();
  });
  row.append(input, voice, submit);
  root.append(row);
  if (spec.voiceError !== null) {
    const error = document.createElement("div");
    error.className = "review-composer-error";
    error.textContent = spec.voiceError;
    root.append(error);
  }
  requestAnimationFrame(() => {
    resizeComposerInput(input);
    input.focus({ preventScroll: true });
    input.setSelectionRange(input.value.length, input.value.length);
    root.scrollIntoView({ block: "nearest", inline: "nearest" });
  });
  return root;
}

function resizeComposerInput(input: HTMLTextAreaElement): void {
  input.style.height = "0";
  input.style.height = `${Math.min(input.scrollHeight, 120)}px`;
}

function composerButton(icon: "microphone" | "retry" | "send" | "stop", label: string): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "review-composer-button";
  button.setAttribute("aria-label", label);
  button.innerHTML = composerIcon(icon);
  return button;
}

function composerIcon(icon: "microphone" | "retry" | "send" | "stop"): string {
  if (icon === "send") return '<svg viewBox="0 0 24 24"><path d="M5 12l7-7 7 7M12 5v14"/></svg>';
  if (icon === "retry") return '<svg viewBox="0 0 24 24"><path d="M20 6v5h-5M4 18v-5h5M6.1 9a7 7 0 0111.8-2.2L20 11M4 13l2.1 4.2A7 7 0 0017.9 15"/></svg>';
  if (icon === "stop") return '<svg viewBox="0 0 24 24"><rect x="7" y="7" width="10" height="10" rx="2"/></svg>';
  return '<svg viewBox="0 0 24 24"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M6 11a6 6 0 0012 0M12 17v4M9 21h6"/></svg>';
}

function sameReference(left: CodeReviewLineReference, right: CodeReviewLineReference): boolean {
  return left.path === right.path && left.line === right.line && left.side === right.side && (left.coordinate ?? "file") === (right.coordinate ?? "file");
}

declare global {
  interface Window {
    ReactNativeWebView?: { postMessage(value: string): void };
  }
}

window.addEventListener("message", receiveHostMessage);
document.addEventListener("message", receiveHostMessage as EventListener);
window.addEventListener("beforeunload", () => {
  tree?.cleanUp();
  fileRenderer?.cleanUp();
  diffRenderer?.cleanUp();
});
post({ type: "ready" });
