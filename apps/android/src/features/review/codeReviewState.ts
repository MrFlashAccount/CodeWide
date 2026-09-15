import { useId, useState } from "react";
import { useWindowDimensions } from "react-native";
import type {
  ThreadChangeResource,
  ThreadChangeScope,
} from "../../data/workspace-resource-database";
import { useEvent } from "../../react/useEvent";
import { codeReviewMenuActions } from "../../rendering/change-menu";
import type { CodeReviewViewMode } from "../../rendering/code-review-bridge";
import { useAppDialog } from "../../ui/AppDialog";
import type { CodeReviewWorkspaceProps } from "./codeReviewContract";
import { useCodeReviewResources } from "./codeReviewResources";
import { useReviewComments } from "./reviewComments";
import { useReviewVoice } from "./reviewVoice";

export function useCodeReviewState(props: CodeReviewWorkspaceProps) {
  const {
    changes: initialChanges,
    changeScope: initialChangeScope = "session",
    initialMode = "unified",
    initialWrapLines = false,
    initialPath,
    initialLine,
    onLoadScope,
    onPreferencesChange,
    onDownload,
    onAttach,
  } = props;

  const dialog = useAppDialog();
  const window = useWindowDimensions();
  const {
    selectionRef,
    selectedReference,
    setSelectedReference,
    commentDraft,
    comments,
    setComments,
    selectLine,
    updateCommentDraft,
    updateReferenceDraft,
    commitComment,
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
    scopeLoading,
    revealReference,
    effectiveSelectedPath,
    document,
    hasDiff,
    loadError,
    loading,
    documentStatus,
    reviewFiles,
    workspaceRevision,
  } = useCodeReviewResources(props, resourceOwnerId, requestedScope, scopeRevision, selectedPath);

  const compact = (workspaceWidth > 0 ? workspaceWidth : window.width) < 720;
  const sidebarOpen = sidebarPreference ?? !compact;
  const attachDisabled = comments.length === 0 || attaching;
  const effectiveMode: CodeReviewViewMode = mode !== "source" && !hasDiff ? "source" : mode;

  const selectFile = useEvent((change: ThreadChangeResource) => {
    setSelectedPath(change.path);
    setSelectedReference(null);
    if (compact) setSidebarPreference(false);
  });
  const { voiceResource, microphoneAccess, addComment, pressVoice, close } = useReviewVoice(
    props,
    resourceOwnerId,
    selectedReference,
    selectionRef,
    updateCommentDraft,
    updateReferenceDraft,
    commitComment,
  );

  const attach = useEvent(async () => {
    if (comments.length === 0 || attaching) return;
    setAttaching(true);
    let attached = false;
    try {
      attached = await onAttach(comments);
    } catch (cause) {
      dialog.alert(
        "Could not attach review",
        cause instanceof Error ? cause.message : "Review upload failed",
      );
    }
    setAttaching(false);
    if (attached) close();
  });
  const notifyPreferences = useEvent(
    (nextScope: ThreadChangeScope, nextMode: CodeReviewViewMode, nextWrapLines: boolean) => {
      onPreferencesChange?.({ scope: nextScope, mode: nextMode, wrapLines: nextWrapLines });
    },
  );
  const selectMenuAction = useEvent((id: string) => {
    if (id.startsWith("scope:")) {
      const scope = changeScopes.find((candidate) => `scope:${candidate}` === id);
      if (scope === undefined || scope === changeScope || onLoadScope === undefined || scopeLoading)
        return;
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
      if (nextMode === null) return;
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
  });
  const menuActions = [
    ...codeReviewMenuActions(changeScopes, changeScope, mode, wrapLines),
    ...(onDownload === undefined
      ? []
      : [
          { id: "download", section: "File", label: "Download", icon: "download-outline" as const },
        ]),
  ];
  return {
    setWorkspaceWidth,
    close,
    setSidebarPreference,
    sidebarOpen,
    effectiveSelectedPath,
    changeScope,
    changes,
    comments,
    documentStatus,
    menuActions,
    selectMenuAction,
    scopeLoading,
    attachDisabled,
    attach,
    attaching,
    compact,
    document,
    loading,
    loadError,
    reviewFiles,
    workspaceRevision,
    wrapLines,
    effectiveMode,
    selectedReference,
    revealReference,
    commentDraft,
    voiceResource,
    microphoneAccess,
    selectLine,
    updateCommentDraft,
    selectionRef,
    addComment,
    pressVoice,
    selectFile,
    setComments,
  };
}
