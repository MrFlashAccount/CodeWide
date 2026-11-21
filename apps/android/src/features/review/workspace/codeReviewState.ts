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
import { useConstant } from "../../../react/useConstant";
import { createLineCommentDrafts } from "../comments/lineCommentDrafts";
import type { CodeReviewComment, CodeReviewLineReference } from "../comments/reviewComment";
import { useReviewComments } from "../comments/reviewComments";

const MIN_SIDEBAR_WIDTH = 620;

export function useCodeReviewState(props: CodeReviewWorkspaceProps) {
  const {
    changes: initialChanges,
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
    comments,
    commitComment: addComment,
    selectedReference,
    selectLine: anchorLine,
    setComments,
    setSelectedReference,
  } = useReviewComments();

  const resourceOwnerId = useId();
  const localDrafts = useConstant(() => createLineCommentDrafts(resourceOwnerId));
  const [edited, setEdited] = useState<{
    comment: CodeReviewComment;
    drafts: ReturnType<typeof createLineCommentDrafts>;
  } | null>(null);
  const lineDrafts = edited?.drafts ?? localDrafts;
  /** Opens the line composer, or re-anchors the open one with its text. */
  const selectLine = useEvent((reference: CodeReviewLineReference): void => {
    if (selectedReference !== null) {
      lineDrafts.move(selectedReference, reference);
    }
    anchorLine(reference);
  });
  const [workspaceWidth, setWorkspaceWidth] = useState(0);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [requestedScope, setRequestedScope] = useState<ThreadChangeScope | null>(null);
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
    vcs,
    workspaceRevision,
  } = useCodeReviewResources(props, resourceOwnerId, requestedScope, scopeRevision, selectedPath);

  const compact = (workspaceWidth > 0 ? workspaceWidth : window.width) < MIN_SIDEBAR_WIDTH;
  const sidebarOpen = compact ? pickerOpen : (sidebarPreference ?? true);
  const setFilesOpen = useEvent((open: boolean) => {
    if (compact) {
      setPickerOpen(open);
    } else {
      setSidebarPreference(open);
    }
  });
  const resize = useEvent((width: number) => {
    if (width >= MIN_SIDEBAR_WIDTH) {
      setPickerOpen(false);
    }
    setWorkspaceWidth(width);
  });
  const attachDisabled = comments.length === 0 || attaching;
  const effectiveMode: CodeReviewViewMode = mode !== "source" && !hasDiff ? "source" : mode;

  const selectFile = useEvent((change: ThreadChangeResource) => {
    if (change.path === effectiveSelectedPath) {
      setPickerOpen(false);
      return;
    }
    setEdited(null);
    setSelectedPath(change.path);
    setSelectedReference(null);
    if (compact) {
      setPickerOpen(false);
    }
  });
  const editComment = useEvent((comment: CodeReviewComment) => {
    setSelectedPath(comment.path);
    const drafts = createLineCommentDrafts(resourceOwnerId + ":" + comment.id);
    setEdited({ comment, drafts });
    drafts.write(comment, { markdown: comment.body, plainText: comment.body });
    setSelectedReference(comment);
  });
  const commitComment = useEvent((reference: CodeReviewLineReference, body: string) => {
    if (edited === null) {
      addComment(reference, body);
    } else {
      setComments((current) =>
        current.map((comment) =>
          comment.id === edited.comment.id ? { ...comment, ...reference, body } : comment,
        ),
      );
    }
    setEdited(null);
  });
  const close = useEvent(() => {
    props.onClose();
  });
  const retryLoad = useEvent(() => {
    setScopeRevision((current) => current + 1);
  });
  const closeComposer = useEvent(() => {
    setEdited(null);
    setSelectedReference(null);
  });

  const attach = useEvent((): void => {
    if (comments.length === 0 || attaching) {
      return;
    }
    setAttaching(true);
    onAttach(comments)
      .then((attached) => {
        setAttaching(false);
        if (attached) {
          close();
        }
      })
      .catch((error: unknown) => {
        setAttaching(false);
        dialog.error("Could not attach review", error);
      });
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
        (scope === changeScope && loadError === null) ||
        onLoadScope === undefined ||
        scopeLoading
      ) {
        return;
      }
      setEdited(null);
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
    attach,
    attachDisabled,
    attaching,
    changes,
    changeScope,
    close,
    closeComposer,
    comments,
    commitComment,
    compact,
    document,
    documentStatus,
    editComment,
    editing: edited !== null && selectedReference !== null,
    effectiveMode,
    effectiveSelectedPath,
    lineDrafts,
    loadError,
    loading,
    menuActions,
    retryLoad,
    revealReference,
    reviewFiles,
    scopeLoading,
    selectedReference,
    selectFile,
    selectLine,
    selectMenuAction,
    setComments,
    setFilesOpen,
    setWorkspaceWidth: resize,
    sidebarOpen,
    vcs,
    workspaceRevision,
    wrapLines,
  };
}
