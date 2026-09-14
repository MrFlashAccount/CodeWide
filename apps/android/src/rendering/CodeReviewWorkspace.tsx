import { Ionicons } from "@expo/vector-icons";
import type { Thread } from "@codewide/codex-protocol/v0.147.0/v2";
import { useEffect, useId, useRef, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, useWindowDimensions, View } from "react-native";

import type { ThreadChangeDiffValue, VoiceTranscriptionEvent, VoiceTranscriptionOptions, VoiceTranscriptionSession } from "../data/use-remote-workspace";
import type { ThreadChangeResource, ThreadChangeScope, ThreadResourcesValue } from "../data/workspace-resource-database";
import { privateAssetCacheKey, type GetTransferAccess, type PrivateAssetSource } from "../data/private-transfer";
import { colors, radii, spacing, typeScale, typeWeight, iconSize, layoutSize, controlSize } from "../theme";
import { AppText as Text } from "../ui/Typography";
import { useAppDialog } from "../ui/AppDialog";
import { useMicrophoneAccess } from "../ui/use-microphone-access";
import { ActionMenu } from "../ui/ActionMenu";
import { useVoiceInputResource, type AppVoiceInputRuntime } from "../ui/VoiceInputRuntime";
import { changedFileDisplayPath } from "./changed-file-path";
import { changeScopeTitle, codeReviewMenuActions } from "./change-menu";
import { CodeReviewEditor } from "./CodeReviewEditor";
import { useAsyncResource, useEphemeralAsyncResource } from "./async-resource-store";
import {
  codeReviewDocumentRevision,
  codeReviewWorkspaceRevision,
  type CodeReviewDocument,
  type CodeReviewFileItem,
  type CodeReviewViewMode,
} from "./code-review-bridge";
import type { CodeReviewFileResource } from "./code-review-files";
import { codeReviewCommentKey, codeReviewVoiceInputScope, type CodeReviewComment, type CodeReviewLineReference } from "./code-review";
import { loadDocumentPreview } from "./DocumentPreviewHost";

type VoiceStarter = (listener: (event: VoiceTranscriptionEvent) => void, options?: VoiceTranscriptionOptions) => Promise<VoiceTranscriptionSession>;

export function CodeReviewWorkspace({
  changes: initialChanges,
  changeScope: initialChangeScope = "session",
  changeScopes: initialChangeScopes = ["session", "lastTurn"],
  scopeLabel,
  initialMode = "unified",
  initialWrapLines = false,
  initialPath,
  initialLine,
  initialColumn,
  cwd,
  thread,
  voiceRuntime,
  getTransferAccess,
  sourceOverrides,
  sourceAssets,
  onLoadDiff,
  onInitialLoad,
  onLoadScope,
  onPreferencesChange,
  onDownload,
  onAttach,
  onClose,
}: {
  changes: readonly CodeReviewFileResource[];
  changeScope?: ThreadChangeScope;
  changeScopes?: readonly ThreadChangeScope[];
  scopeLabel?: string;
  initialMode?: CodeReviewViewMode;
  initialWrapLines?: boolean;
  initialPath?: string;
  initialLine?: number;
  initialColumn?: number;
  cwd: string;
  thread: Thread | null;
  voiceRuntime: AppVoiceInputRuntime | null;
  getTransferAccess: GetTransferAccess;
  sourceOverrides?: Readonly<Record<string, string>>;
  /** Retain scoped/content identity; an attachment name is not a host filesystem path. */
  sourceAssets?: Readonly<Record<string, PrivateAssetSource>>;
  onLoadDiff?(path: string, scope?: ThreadChangeScope): Promise<ThreadChangeDiffValue>;
  onInitialLoad?(): Promise<ThreadResourcesValue>;
  onLoadScope?(scope: ThreadChangeScope): Promise<ThreadResourcesValue>;
  onPreferencesChange?(preferences: { scope: ThreadChangeScope; mode: CodeReviewViewMode; wrapLines: boolean }): void;
  onDownload?(): void;
  onAttach(comments: readonly CodeReviewComment[]): Promise<boolean>;
  onClose(): void;
}) {
  const dialog = useAppDialog();
  const window = useWindowDimensions();
  const voiceController = voiceRuntime?.controller ?? null;
  const microphoneAccess = useMicrophoneAccess();
  const onStartVoiceTranscription: VoiceStarter | undefined = voiceRuntime?.startRemote;
  const selectionRef = useRef({ start: 0, end: 0 });
  const resourceOwnerId = useId();
  const recordingScopeRef = useRef<string | null>(null);
  const [workspaceWidth, setWorkspaceWidth] = useState(0);
  const [requestedScope, setRequestedScope] = useState(initialChangeScope);
  const [scopeRevision, setScopeRevision] = useState(0);
  const [sidebarPreference, setSidebarPreference] = useState<boolean | null>(null);
  const [selectedPath, setSelectedPath] = useState<string | null>(
    initialPath !== undefined && initialChanges.some((change) => change.path === initialPath)
      ? initialPath
      : initialChanges[0]?.path ?? null,
  );
  const [mode, setMode] = useState<CodeReviewViewMode>(initialLine === undefined ? initialMode : "source");
  const [wrapLines, setWrapLines] = useState(initialWrapLines);
  const [selectedReference, setSelectedReference] = useState<CodeReviewLineReference | null>(null);
  const [commentDrafts, setCommentDrafts] = useState<Record<string, string>>({});
  const commentKey = selectedReference === null ? null : codeReviewCommentKey(selectedReference);
  const commentDraft = commentKey === null ? "" : commentDrafts[commentKey] ?? "";
  const voiceScope = voiceRuntime === null || selectedReference === null ? null
    : codeReviewVoiceInputScope(voiceRuntime.scopePrefix, resourceOwnerId, selectedReference);
  const voiceResource = useVoiceInputResource(voiceRuntime, voiceScope);
  const [comments, setComments] = useState<CodeReviewComment[]>([]);
  const [attaching, setAttaching] = useState(false);
  const shouldLoadInitialScope = requestedScope === initialChangeScope && onInitialLoad !== undefined;
  const shouldLoadAlternateScope = requestedScope !== initialChangeScope && onLoadScope !== undefined;
  const scopeResource = useAsyncResource<ThreadResourcesValue>(
    shouldLoadInitialScope || shouldLoadAlternateScope
      ? `code-review-scope:${resourceOwnerId}:${thread?.id ?? "none"}`
      : null,
    `${requestedScope}:${scopeRevision}`,
    async () => shouldLoadInitialScope
      ? await onInitialLoad!()
      : await onLoadScope!(requestedScope),
  );
  const loadedScope = scopeResource.value;
  const changes: readonly CodeReviewFileResource[] = loadedScope === null
    ? initialChanges
    : loadedScope.changes.map((change) => initialChanges.some((initial) => initial.path === change.path && initial.sourceOnly === true)
      ? { ...change, sourceOnly: true }
      : change);
  const changeScope = loadedScope?.changeScope ?? initialChangeScope;
  const changeScopes = loadedScope?.changeScopes ?? initialChangeScopes;
  const scopeLoading = scopeResource.status === "loading";
  const revealReference: CodeReviewLineReference | null = initialPath !== undefined && initialLine !== undefined
    ? {
        path: initialPath,
        line: initialLine,
        side: "new",
        coordinate: "file",
        ...(initialColumn === undefined ? {} : { column: initialColumn }),
      }
    : null;
  const compact = (workspaceWidth > 0 ? workspaceWidth : window.width) < 720;
  const sidebarOpen = sidebarPreference ?? !compact;
  const selectedChange = changes.find((change) => change.path === selectedPath) ?? changes[0] ?? null;
  const effectiveSelectedPath = selectedChange?.path ?? null;
  const sourceAsset = selectedChange === null ? undefined : sourceAssets?.[selectedChange.path];
  const documentRevision = selectedChange === null
    ? "none"
    : `${changeScope}:${selectedChange.turnId}:${selectedChange.itemId}:${selectedChange.additions}:${selectedChange.deletions}:${selectedChange.availability}:${selectedChange.sourceOnly === true ? "source" : "diff"}:${sourceOverrides?.[selectedChange.path] ?? "remote"}`;
  const documentResource = useEphemeralAsyncResource<CodeReviewResourceValue>(
    selectedChange === null ? null : `code-review:${resourceOwnerId}:${thread?.id ?? "none"}:${selectedChange.path}`,
    `${documentRevision}:${sourceAsset === undefined ? "host-path" : privateAssetCacheKey(sourceAsset)}`,
    async (publish, signal) => {
      if (selectedChange === null) throw new Error("No changed file selected");
      return await loadCodeReviewResource(selectedChange, changeScope, getTransferAccess, onLoadDiff, signal, sourceOverrides, publish, sourceAsset);
    },
    estimateCodeReviewResourceWeight,
  );
  const document = documentResource.value?.document ?? null;
  const hasDiff = document !== null && document.patches.length > 0;
  const loadError = documentResource.error ?? scopeResource.error;
  const documentWarning = documentResource.value?.warning ?? null;
  const diffTruncated = documentResource.value?.diffTruncated ?? false;
  const loading = documentResource.status === "loading" || documentResource.status === "idle";
  const attachDisabled = comments.length === 0 || attaching;
  const effectiveMode: CodeReviewViewMode = mode !== "source" && !hasDiff ? "source" : mode;
  const documentStatus = selectedChange === null
    ? null
    : selectedChange.sourceOnly === true
      ? "Attached file"
      : selectedChange.kind === "delete" || selectedChange.availability === "deleted"
      ? "Deleted file"
      : selectedChange.kind === "add"
        ? "New file"
        : diffTruncated
          ? "Diff truncated"
          : documentWarning !== null ? "Current file" : null;
  const reviewFiles: CodeReviewFileItem[] = changes.map((change) => ({
    path: change.path,
    treePath: reviewTreePath(change.path, cwd),
    status: change.kind === "add" ? "added" as const : change.kind === "delete" ? "deleted" as const : "modified" as const,
    additions: change.additions,
    deletions: change.deletions,
    sourceOnly: change.sourceOnly === true,
  }));
  const workspaceRevision = codeReviewWorkspaceRevision(reviewFiles);

  const selectFile = (change: ThreadChangeResource) => {
    setSelectedPath(change.path);
    setSelectedReference(null);
    if (compact) setSidebarPreference(false);
  };

  const selectLine = (reference: CodeReviewLineReference) => {
    const sameLine = selectedReference !== null && sameLineReference(selectedReference, reference);
    if (!sameLine) {
      selectionRef.current = { start: 0, end: 0 };
    }
    setSelectedReference(reference);
  };
  const updateCommentDraft = (value: string) => {
    // A pending transcript belongs to this line even after another line opens.
    if (commentKey !== null) setCommentDrafts((current) => ({ ...current, [commentKey]: value }));
  };
  const commitComment = (reference: CodeReviewLineReference, draft: string) => {
    const body = draft.trim();
    if (body === "") return;
    const committedCommentKey = codeReviewCommentKey(reference);
    setComments((current) => [...current, { ...reference, id: `review-${Date.now().toString(36)}-${current.length}`, body, createdAt: Date.now() }]);
    setCommentDrafts((current) => ({ ...current, [committedCommentKey]: "" }));
    setSelectedReference((current) => current !== null && sameLineReference(current, reference) ? null : current);
  };
  const addComment = (reference: CodeReviewLineReference, draft: string) => {
    const scope = voiceRuntime === null ? null
      : codeReviewVoiceInputScope(voiceRuntime.scopePrefix, resourceOwnerId, reference);
    const phase = scope === null ? "idle" : voiceRuntime?.resources?.voiceInputs.get(scope)?.phase ?? "idle";
    if (scope !== null && phase !== "idle") {
      void voiceController?.finish(scope, true, (text) => commitComment(reference, text));
    } else commitComment(reference, draft);
  };
  const bindVoice = (draft: string) => {
    if (voiceController === null || voiceScope === null) return;
    voiceController.bind({
      scope: voiceScope,
      source: () => draft,
      selection: () => selectionRef.current,
      thread,
      updateDraft: updateCommentDraft,
      send: updateCommentDraft,
      ...(onStartVoiceTranscription === undefined ? {} : { startRemote: onStartVoiceTranscription }),
    });
  };
  const pressVoice = async (draft: string, selection: { start: number; end: number }) => {
    if (voiceController === null || voiceScope === null) return;
    if ((voiceResource?.phase === undefined || voiceResource.phase === "idle") && !voiceResource?.retryAvailable && !microphoneAccess.allowCapture()) return;
    updateCommentDraft(draft);
    selectionRef.current = selection;
    bindVoice(draft);
    if (voiceResource?.retryAvailable === true) await voiceController.retry(voiceScope);
    else if (voiceResource?.phase === undefined || voiceResource.phase === "idle") {
      const starting = voiceController.toggle(voiceScope);
      if (voiceRuntime?.resources?.voiceInputs.get(voiceScope)?.phase === "starting") recordingScopeRef.current = voiceScope;
      await starting;
    } else if (voiceResource.phase !== "finishing") await voiceController.finish(voiceScope, false);
  };
  const close = () => {
    if (recordingScopeRef.current !== null) void voiceController?.finish(recordingScopeRef.current, false);
    if (voiceScope !== null) voiceController?.unbind(voiceScope);
    onClose();
  };
  useEffect(() => () => {
    const scope = recordingScopeRef.current;
    if (scope === null) return;
    void voiceController?.finish(scope, false);
    voiceController?.unbind(scope);
  }, [voiceController]);
  const attach = async () => {
    if (comments.length === 0 || attaching) return;
    setAttaching(true);
    let attached = false;
    try {
      attached = await onAttach(comments);
    } catch (cause) {
      dialog.alert("Could not attach review", cause instanceof Error ? cause.message : "Review upload failed");
    }
    setAttaching(false);
    if (attached) close();
  };
  const notifyPreferences = (nextScope: ThreadChangeScope, nextMode: CodeReviewViewMode, nextWrapLines: boolean) => {
    onPreferencesChange?.({ scope: nextScope, mode: nextMode, wrapLines: nextWrapLines });
  };
  const selectMenuAction = (id: string) => {
    if (id.startsWith("scope:")) {
      const scope = id.slice("scope:".length) as ThreadChangeScope;
      if (!changeScopes.includes(scope) || scope === changeScope || onLoadScope === undefined || scopeLoading) return;
      setRequestedScope(scope);
      setScopeRevision((current) => current + 1);
      setSelectedReference(null);
      notifyPreferences(scope, mode, wrapLines);
      return;
    }
    if (id.startsWith("view:")) {
      const nextMode = id.slice("view:".length) as CodeReviewViewMode;
      setMode(nextMode);
      notifyPreferences(changeScope, nextMode, wrapLines);
      return;
    }
    if (id === "wrap") {
      const nextWrapLines = !wrapLines;
      setWrapLines(nextWrapLines);
      notifyPreferences(changeScope, mode, nextWrapLines);
      return;
    }
    if (id === "download") onDownload?.();
  };
  const menuActions = [
    ...codeReviewMenuActions(changeScopes, changeScope, mode, wrapLines),
    ...(onDownload === undefined ? [] : [{ id: "download", section: "File", label: "Download", icon: "download-outline" as const }]),
  ];
  return (
    <View
      testID="code-review-workspace"
      style={styles.root}
      onLayout={({ nativeEvent }) => setWorkspaceWidth(Math.floor(nativeEvent.layout.width))}
    >
      <View style={styles.header}>
        <Pressable accessibilityLabel="Close code review" onPress={close} style={styles.iconButton}><Ionicons name="close" size={iconSize.navigation} color={colors.text} /></Pressable>
        <Pressable accessibilityLabel="Toggle files" onPress={() => setSidebarPreference(!sidebarOpen)} style={styles.iconButton}><Ionicons name="folder-open-outline" size={iconSize.action} color={colors.text} /></Pressable>
        <View style={styles.headerTitle}>
          <Text numberOfLines={1} ellipsizeMode="middle" style={styles.title}>{effectiveSelectedPath === null ? "Code review" : changedFileDisplayPath(effectiveSelectedPath, cwd, 72)}</Text>
          <View style={styles.subtitleRow}>
            <Text numberOfLines={1} style={styles.subtitle}>{scopeLabel ?? changeScopeTitle(changeScope)} · {changes.length} files · {comments.length} comments</Text>
            {documentStatus !== null && <Text accessibilityLabel={`File status: ${documentStatus}`} numberOfLines={1} style={styles.documentStatus}>· {documentStatus}</Text>}
          </View>
        </View>
        <ActionMenu accessibilityLabel="Changes options" actions={menuActions} placement="bottom" align="end" onSelect={selectMenuAction}>
          <Pressable accessibilityLabel="Changes options" disabled={scopeLoading} style={styles.iconButton}>
            {scopeLoading ? <ActivityIndicator size="small" color={colors.textMuted} /> : <Ionicons name="ellipsis-vertical" size={iconSize.action} color={colors.text} />}
          </Pressable>
        </ActionMenu>
        <Pressable accessibilityLabel="Attach review" disabled={attachDisabled} onPress={() => void attach()} style={[styles.attachButton, !attachDisabled && styles.attachButtonReady, compact && styles.attachButtonCompact, attachDisabled && styles.disabled]}>
          {attaching ? <ActivityIndicator size="small" color={colors.text} /> : <Ionicons name="attach" size={iconSize.action} color={attachDisabled ? colors.textDim : colors.text} />}
          {!compact && <Text style={styles.attachButtonText}>Attach {comments.length || ""}</Text>}
        </Pressable>
      </View>

      <View style={styles.workspace}>
        <View style={styles.editorPane}>
          <CodeReviewEditor
            document={document}
            loading={loading}
            loadError={loadError}
            files={reviewFiles}
            workspaceRevision={workspaceRevision}
            selectedPath={effectiveSelectedPath}
            sidebarOpen={sidebarOpen}
            compact={compact}
            wrapLines={wrapLines}
            mode={effectiveMode}
            comments={comments}
            selectedReference={selectedReference}
            revealReference={selectedReference === null ? revealReference : null}
            commentDraft={commentDraft}
            voicePhase={voiceResource?.phase ?? "idle"}
            voicePermissionGranted={microphoneAccess.granted}
            voiceRetryAvailable={voiceResource?.retryAvailable ?? false}
            voiceError={voiceResource?.error ?? null}
            onLinePress={selectLine}
            onCommentDraftChange={updateCommentDraft}
            onCommentSelectionChange={(selection) => { selectionRef.current = selection; }}
            onCommentSubmit={addComment}
            onVoicePress={(draft, selection) => void pressVoice(draft, selection)}
            onFileSelect={(path) => {
              const change = changes.find((candidate) => candidate.path === path);
              if (change !== undefined) selectFile(change);
            }}
          />
          {comments.length > 0 && (
            <ScrollView horizontal style={styles.commentStrip} contentContainerStyle={styles.commentStripContent} keyboardShouldPersistTaps="handled">
              {comments.map((comment) => (
                <View key={comment.id} style={styles.commentChip}>
                  <Text numberOfLines={1} style={styles.commentChipLocation}>{shortPath(comment.path)}:{comment.line}</Text>
                  <Text numberOfLines={1} style={styles.commentChipBody}>{comment.body}</Text>
                  <Pressable accessibilityLabel="Delete comment" hitSlop={8} onPress={() => setComments((current) => current.filter((candidate) => candidate.id !== comment.id))}>
                    <Ionicons name="close-circle" size={iconSize.inline} color={colors.textDim} />
                  </Pressable>
                </View>
              ))}
            </ScrollView>
          )}
        </View>
      </View>
    </View>
  );
}

type CodeReviewResourceValue = {
  document: CodeReviewDocument;
  diffTruncated: boolean;
  warning: string | null;
};

async function loadCodeReviewResource(
  change: CodeReviewFileResource,
  changeScope: ThreadChangeScope,
  getTransferAccess: GetTransferAccess,
  onLoadDiff: ((path: string, scope?: ThreadChangeScope) => Promise<ThreadChangeDiffValue>) | undefined,
  signal: AbortSignal,
  sourceOverrides: Readonly<Record<string, string>> | undefined,
  publish: (value: CodeReviewResourceValue) => void,
  sourceAsset: PrivateAssetSource | undefined,
): Promise<CodeReviewResourceValue> {
  const name = change.path.split("/").at(-1) ?? change.path;
  const sourceOverride = sourceOverrides?.[change.path];
  const sourcePromise = sourceOverride !== undefined
    ? Promise.resolve(sourceOverride)
    : change.availability === "available" || change.availability === "unknown"
    ? loadDocumentPreview({ kind: "text", name, path: change.path, getTransferAccess, ...(sourceAsset === undefined ? {} : { source: sourceAsset }) }, signal)
        .then((loaded) => loaded.source)
        .catch((cause: unknown) => {
          if (signal.aborted) throw cause;
          return `// Current file could not be loaded\n// ${cause instanceof Error ? cause.message : "File preview failed"}\n`;
        })
    : Promise.resolve(change.availability === "deleted" ? "" : "// File is unavailable\n");
  let diffFailed = false;
  const diffPromise = onLoadDiff === undefined || change.sourceOnly === true
    ? Promise.resolve<ThreadChangeDiffValue | null>(null)
    : onLoadDiff(change.path, changeScope).catch(() => {
        diffFailed = true;
        return null;
      });
  const fallbackSource = await sourcePromise;
  if (signal.aborted) throw new DOMException("Aborted", "AbortError");
  const deleted = change.kind === "delete" || change.availability === "deleted";
  const sourceDisplayState: CodeReviewDocument["displayState"] = deleted
    ? "deleted"
    : fallbackSource === "" ? "empty" : undefined;
  const sourceDocument: CodeReviewDocument = {
    path: change.path,
    source: fallbackSource,
    patches: [],
    ...(sourceDisplayState === undefined ? {} : { displayState: sourceDisplayState }),
    revision: codeReviewDocumentRevision(change.path, fallbackSource, [], sourceDisplayState),
  };
  publish({
    document: sourceDocument,
    diffTruncated: false,
    warning: null,
  });
  const diff = await diffPromise;
  if (signal.aborted) throw new DOMException("Aborted", "AbortError");
  const source = diff?.source ?? fallbackSource;
  const patches = diff?.patches
    .map((patch) => ({ kind: patch.kind, diff: patch.diff }))
    .filter((patch) => patch.diff !== "") ?? [];
  const displayState: CodeReviewDocument["displayState"] = deleted
    ? "deleted"
    : source === "" && patches.length === 0 ? "empty" : undefined;
  const materializedDocument: CodeReviewDocument = {
    path: change.path,
    source,
    patches,
    ...(displayState === undefined ? {} : { displayState }),
    revision: codeReviewDocumentRevision(change.path, source, patches, displayState),
  };
  return {
    document: materializedDocument,
    diffTruncated: diff?.truncated ?? false,
    warning: diffFailed
      ? "Diff unavailable. Showing the current file."
      : patches.length === 0 && diff !== null ? "Diff contained no renderable patches. Showing the complete current file." : null,
  };
}

function estimateCodeReviewResourceWeight(value: CodeReviewResourceValue): number {
  return (value.document.source.length + value.document.patches.reduce((sum, patch) => sum + patch.diff.length, 0)) * 2;
}

function shortPath(path: string): string {
  const parts = path.replaceAll("\\", "/").split("/").filter(Boolean);
  return parts.slice(-2).join("/") || path;
}

function reviewTreePath(path: string, cwd: string): string {
  const normalizedPath = path.replaceAll("\\", "/");
  const normalizedCwd = cwd.replaceAll("\\", "/").replace(/\/$/, "");
  return normalizedCwd !== "" && normalizedPath.startsWith(`${normalizedCwd}/`)
    ? normalizedPath.slice(normalizedCwd.length + 1)
    : normalizedPath.replace(/^\//, "");
}

function sameLineReference(left: CodeReviewLineReference, right: CodeReviewLineReference): boolean {
  return left.path === right.path
    && left.line === right.line
    && left.side === right.side
    && (left.coordinate ?? "file") === (right.coordinate ?? "file");
}

const styles = StyleSheet.create({
  root: { flex: 1, minHeight: 0, backgroundColor: colors.background },
  header: { minHeight: layoutSize.header, flexDirection: "row", alignItems: "center", gap: spacing.compact, paddingHorizontal: spacing.xs, backgroundColor: colors.surface },
  iconButton: { width: controlSize.regular, height: controlSize.regular, alignItems: "center", justifyContent: "center", borderRadius: radii.medium, backgroundColor: colors.surfaceContainer },
  headerTitle: { flex: 1, minWidth: 80 },
  title: { color: colors.text, ...typeScale.body, fontWeight: typeWeight.semibold },
  subtitleRow: { minWidth: 0, flexDirection: "row", alignItems: "center", gap: spacing.xxs },
  subtitle: { flexShrink: 1, color: colors.textMuted, ...typeScale.label },
  documentStatus: { flexShrink: 1, color: colors.textDim, ...typeScale.label },
  reviewToolbar: { minHeight: controlSize.touch, flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: spacing.sm, paddingBottom: spacing.xxs, backgroundColor: "#111214" },
  modeSwitch: { flexDirection: "row", backgroundColor: "#090A0C", borderRadius: radii.pill, padding: spacing.xxs },
  modeButton: { minWidth: controlSize.compact, minHeight: controlSize.compact, paddingVertical: spacing.xxs, paddingHorizontal: spacing.sm, alignItems: "center", justifyContent: "center", borderRadius: radii.pill },
  modeButtonSelected: { backgroundColor: "#26292E" },
  modeButtonText: { color: colors.textMuted, ...typeScale.label },
  modeButtonTextSelected: { color: colors.text, fontWeight: typeWeight.semibold },
  wrapButton: { minHeight: controlSize.compact, flexDirection: "row", alignItems: "center", gap: spacing.xxs, paddingHorizontal: spacing.sm, paddingVertical: spacing.xxs, borderRadius: radii.pill, backgroundColor: "#17191C" },
  wrapButtonSelected: { backgroundColor: "#242A33" },
  wrapButtonText: { color: colors.textMuted, ...typeScale.label },
  wrapButtonTextSelected: { color: colors.text, fontWeight: typeWeight.semibold },
  attachButton: { minHeight: controlSize.regular, flexDirection: "row", alignItems: "center", gap: spacing.xs, paddingHorizontal: spacing.sm, borderWidth: 1, borderColor: colors.border, borderRadius: radii.medium, backgroundColor: colors.surfaceContainer },
  attachButtonReady: { backgroundColor: colors.surfaceContainerHigh },
  attachButtonCompact: { minHeight: controlSize.regular, width: controlSize.regular, paddingHorizontal: 0, justifyContent: "center" },
  attachButtonText: { color: colors.text, ...typeScale.body, fontWeight: typeWeight.semibold },
  workspace: { flex: 1, minHeight: 0, flexDirection: "row", position: "relative" },
  editorPane: { flex: 1, minWidth: 0, minHeight: 0, backgroundColor: "#0B0C0E" },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: spacing.sm },
  muted: { color: colors.textMuted },
  commentStrip: { flexGrow: 0, maxHeight: 48, backgroundColor: "#111214" },
  commentStripContent: { alignItems: "center", gap: spacing.xs, paddingHorizontal: spacing.sm, paddingVertical: spacing.xxs },
  commentChip: { maxWidth: "100%", minHeight: controlSize.compact, flexDirection: "row", alignItems: "center", gap: spacing.xs, paddingHorizontal: spacing.sm, paddingVertical: spacing.xxs, backgroundColor: colors.surfaceContainerHighest, borderRadius: radii.pill },
  commentChipLocation: { color: colors.accent, ...typeScale.label, fontWeight: typeWeight.semibold },
  commentChipBody: { flexShrink: 1, color: colors.text, ...typeScale.label },
  disabled: { opacity: 0.38 },
});
