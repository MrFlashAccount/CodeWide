import { useId, useState } from "react";
import { useWindowDimensions } from "react-native";
import type {
  ThreadChangeResource,
  ThreadChangeScope,
} from "../../../data/workspace-resource-database";
import { useEvent } from "../../../react/useEvent";
import type { CodeReviewViewMode } from "../editor/editorBridge";
import { useAppDialog } from "../../../ui/AppDialog";
import type { CodeReviewWorkspaceProps } from "./codeReviewContract";
import { codeReviewMenuActions } from "./codeReviewMenu";
import { useCodeReviewResources } from "./codeReviewResources";
import { useReviewComments } from "../comments/reviewComments";
import { useReviewVoice } from "../comments/reviewVoice";

export function useCodeReviewState(props: CodeReviewWorkspaceProps) {
  const {
    changes: initialChanges,
    changeScope: initialChangeScope = "session",
    initialLine,
    initialMode = "unified",
    initialPath,
    initialWrapLines = false,
    onAttach,
    onDownload,
    onLoadScope,
    onPreferencesChange,
  } = props;

  const dialog = useAppDialog();
  const window = useWindowDimensions();
  const {
    commentDraft,
    comments,
    commitComment,
    selectedReference,
    selectionRef,
    selectLine,
    setComments,
    setSelectedReference,
    updateCommentDraft,
    updateReferenceDraft,
  } = useReviewComments();

  const resourceOwnerId = useId();
  const [workspaceWidth, setWorkspaceWidth] = useState(0);
  const [requestedScope, setRequestedScope] = useState(initialChangeScope);
  const [scopeRevision, setScopeRevision] = useState(0);
  const [sidebarPreference, setSidebarPreference] = useState<boolean | null>(null);
  const [selectedPath, setSelectedPath] = useState<string | null>(
    initialPath !== undefined && initialChanges.some((change) => change.path === initialPath)
      ? initialPath
      : (initialChanges[0]?.path ?? null),
  );
  const [mode, setMode] = useState<CodeReviewViewMode>(
    initialLine === undefined ? initialMode : "source",
  );
  const [wrapLines, setWrapLines] = useState(initialWrapLines);
  const [attaching, setAttaching] = useState(false);
  const {
    changes,
    changeScope,
    changeScopes,
    document,
    documentStatus,
    effectiveSelectedPath,
    hasDiff,
    loadError,
    loading,
    revealReference,
    reviewFiles,
    scopeLoading,
    workspaceRevision,
  } = useCodeReviewResources(props, resourceOwnerId, requestedScope, scopeRevision, selectedPath);

  const compact = (workspaceWidth > 0 ? workspaceWidth : window.width) < 720;
  const sidebarOpen = sidebarPreference ?? !compact;
  const attachDisabled = comments.length === 0 || attaching;
  const effectiveMode: CodeReviewViewMode = mode !== "source" && !hasDiff ? "source" : mode;

  const selectFile = useEvent((change: ThreadChangeResource) => {
    setSelectedPath(change.path);
    setSelectedReference(null);
    if (compact) {
      setSidebarPreference(false);
    }
  });
  const { addComment, close, microphoneAccess, pressVoice, voiceResource } = useReviewVoice(
    props,
    resourceOwnerId,
    selectedReference,
    selectionRef,
    updateCommentDraft,
    updateReferenceDraft,
    commitComment,
  );

  const attach = useEvent(async () => {
    if (comments.length === 0 || attaching) {
      return;
    }
    setAttaching(true);
    let attached = false;
    try {
      attached = await onAttach(comments);
    } catch (error) {
      dialog.alert(
        "Could not attach review",
        error instanceof Error ? error.message : "Review upload failed",
      );
    }
    setAttaching(false);
    if (attached) {
      close();
    }
  });
  const notifyPreferences = useEvent(
    (nextScope: ThreadChangeScope, nextMode: CodeReviewViewMode, nextWrapLines: boolean) => {
      onPreferencesChange?.({ mode: nextMode, scope: nextScope, wrapLines: nextWrapLines });
    },
  );
  const selectMenuAction = useEvent((id: string) => {
    if (id.startsWith("scope:")) {
      const scope = changeScopes.find((candidate) => `scope:${candidate}` === id);
      if (
        scope === undefined ||
        scope === changeScope ||
        onLoadScope === undefined ||
        scopeLoading
      ) {
        return;
      }
      setRequestedScope(scope);
      setScopeRevision((current) => current + 1);
      setSelectedReference(null);
      notifyPreferences(scope, mode, wrapLines);
      return;
    }
    if (id.startsWith("view:")) {
      const nextMode =
        id === "view:source"
          ? "source"
          : id === "view:split"
            ? "split"
            : id === "view:unified"
              ? "unified"
              : null;
      if (nextMode === null) {
        return;
      }
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
    if (id === "download") {
      onDownload?.();
    }
  });
  const menuActions = [
    ...codeReviewMenuActions({ mode, scopes: changeScopes, selectedScope: changeScope, wrapLines }),
    ...(onDownload === undefined
      ? []
      : [
          { icon: "download-outline" as const, id: "download", label: "Download", section: "File" },
        ]),
  ];
  return {
    addComment,
    attach,
    attachDisabled,
    attaching,
    changes,
    changeScope,
    close,
    commentDraft,
    comments,
    compact,
    document,
    documentStatus,
    effectiveMode,
    effectiveSelectedPath,
    loadError,
    loading,
    menuActions,
    microphoneAccess,
    pressVoice,
    revealReference,
    reviewFiles,
    scopeLoading,
    selectedReference,
    selectFile,
    selectionRef,
    selectLine,
    selectMenuAction,
    setComments,
    setSidebarPreference,
    setWorkspaceWidth,
    sidebarOpen,
    updateCommentDraft,
    voiceResource,
    workspaceRevision,
    wrapLines,
  };
}
