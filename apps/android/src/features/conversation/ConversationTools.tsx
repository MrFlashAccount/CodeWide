import { useImagePreviewAnnotationHandler } from "../../rendering/ImagePreviewHost";
import type { StoredThreadSummary } from "../../data/thread-summary-types";
import { useEvent } from "../../react/useEvent";
import { useAgentSelection } from "../agents/agentSelection";
import { ComposerSubagentContextChip } from "../agents/ComposerSubagentContextChip";
import { useAttachmentVisibility } from "../attachments/attachmentVisibility";
import { useDocumentNavigation } from "../attachments/documentNavigation";
import { useChangesFeature } from "../changes/ChangesFeature";
import { ThreadResourceContextChips } from "../changes/ThreadResourceContextChips";
import { useDrawingFeature } from "../drawing/DrawingFeature";
import { ComposerPortContextChip } from "../ports/ComposerPortContextChip";
import { useReviewFeature } from "../review/ReviewFeature";
import { useReviewSubmission } from "../review/reviewSubmission";
import { ComposerTerminalContextChip } from "../terminal/ComposerTerminalContextChip";
import { useTerminalActions, useTerminalDeletion } from "../terminal/terminalActions";
import type { UseConversationToolsProps } from "./ConversationTools.types";
import { useConversationRouteNavigation } from "./conversationRouteNavigation";

export function useConversationTools(props: UseConversationToolsProps) {
  const routeNavigation = useConversationRouteNavigation();
  const currentSubagentSummaries = useAgentSelection(
    props.composerScope,
    props.subagentSummaryDatabase,
    props.draftConnectionId,
    props.draftThreadId,
  );
  const openSubagents = useEvent(
    (_summaries: readonly StoredThreadSummary[], initialThreadId: string | null = null): void => {
      if (props.draftThreadId === null) {
        return;
      }
      void props.agentsInputs.onRefreshSubagents?.(props.draftThreadId).catch(() => undefined);
      routeNavigation.openAgents(initialThreadId);
    },
  );
  const presentTerminal = useEvent(() => {
    if (props.draftConnectionId === null || props.draftThreadId === null) {
      return;
    }
    routeNavigation.openTerminal({
      connectionId: props.draftConnectionId,
      cwd: props.cwd,
      threadId: props.draftThreadId,
    });
  });
  const terminalActionsBinding = useTerminalActions(
    props.draftConnectionId,
    props.draftThreadId,
    props.cwd,
    presentTerminal,
  );
  const deleteThread = useTerminalDeletion(
    props.actionsInputs.onDelete,
    props.draftConnectionId,
    props.draftThreadId,
  );
  const reviewSubmissionBinding = useReviewSubmission({
    admitCodeReview:
      props.composerCommands.composerAttachmentsBinding.reviewAdmission.admitCodeReview,
    admitContentReview: props.composerCommands.composerAttachmentsBinding.admitContentReview,
  });
  const drawingFeatureBinding = useDrawingFeature({
    available:
      props.fileTransferController !== null &&
      props.attachmentsInputs.getTransferAccess !== undefined &&
      props.draftThreadId !== null,
    captureStageAttachment:
      props.composerCommands.composerAttachmentsBinding.captureStageAttachment,
    composerScope: props.composerScope,
    draftThreadId: props.draftThreadId,
    fileAttachmentEnabled: props.composerCommands.composerAttachmentsBinding.fileAttachmentEnabled,
    hideComposerTray: () => {
      props.composerStateBinding.composerMenuStateBinding.setComposerTrayVisible(false);
    },
    readDrawingAttachments:
      props.composerCommands.composerAttachmentsBinding.readDrawingAttachments,
  });
  useImagePreviewAnnotationHandler(drawingFeatureBinding.annotateImage);
  useReviewFeature(
    props.composerScope,
    props.composerStateBinding.reviewAttachmentIdsBinding.contentReviewAttachmentId,
    props.readInputs.remoteThread,
    props.appVoiceInputRuntime,
    props.voiceController,
    props.composerInputs.onStartVoiceTranscription,
    reviewSubmissionBinding.attachContentReview,
  );
  const changesFeatureBinding = useChangesFeature({
    appVoiceInputRuntime: props.appVoiceInputRuntime,
    attachCodeReview: reviewSubmissionBinding.attachCodeReview,
    changesPreferences: props.changesPreferencesBinding.changesPreferences,
    currentChangePresentation: props.changeResourcePresentationBinding.currentChangePresentation,
    currentThreadResources: props.changeResourcePresentationBinding.currentThreadResources,
    cwd: props.cwd,
    getStableTransferAccess: props.getStableTransferAccess,
    onLoadThreadChangeDiff: props.changesInputs.onLoadThreadChangeDiff,
    onLoadThreadResources: props.changesInputs.onLoadThreadResources,
    onLoadTurnChanges: props.changesInputs.onLoadTurnChanges,
    remoteThread: props.readInputs.remoteThread,
    setChangesPreferences: props.changesPreferencesBinding.setChangesPreferences,
  });
  const attachmentVisibilityBinding = useAttachmentVisibility(
    () => {
      props.overlayScrollOwnershipBinding.dismissComposerKeyboardForOverlay();
    },
    props.changesInputs.onLoadThreadResources,
    () => {
      changesFeatureBinding.openChangesResource();
    },
    routeNavigation.openAttachments,
  );
  const openTimelineDocument = useEvent(
    (request: Parameters<typeof routeNavigation.openDocument>[0]) => {
      if (request.kind === "text") {
        changesFeatureBinding.openCodeDocument(request);
        return;
      }
      routeNavigation.openDocument(request);
    },
  );
  const documentNavigationBinding = useDocumentNavigation(
    props.cwd,
    props.attachmentsInputs.getTransferAccess,
    props.getStableTransferAccess,
    props.portsInputs.onOpenLoopbackLink,
    openTimelineDocument,
  );
  const toolContextChips = (
    <>
      {props.changesInputs.onLoadThreadResources !== undefined && (
        <ThreadResourceContextChips
          load={props.changesInputs.onLoadThreadResources}
          model={props.threadResourcesModel}
          onOpen={attachmentVisibilityBinding.openThreadResources}
          onPreferencesChange={props.changesPreferencesBinding.setChangesPreferences}
          preferences={props.changesPreferencesBinding.changesPreferences}
          resourceId={props.threadResourceId}
          revision={props.threadResourceRevision}
        />
      )}
      <ComposerPortContextChip
        connectionId={props.portForwardingConnectionId}
        onOpen={() => {
          props.composerCommands.composerControlActionsBinding.openControls("ports");
        }}
      />
      <ComposerTerminalContextChip
        connectionId={props.draftConnectionId}
        onOpen={terminalActionsBinding.openTerminal}
        threadId={props.draftThreadId}
      />
      {props.subagentThreadDetails !== null && (
        <ComposerSubagentContextChip
          connectionId={props.draftConnectionId}
          database={props.subagentSummaryDatabase}
          onOpen={(summaries) => {
            openSubagents(summaries);
          }}
          parentThreadId={props.draftThreadId}
        />
      )}
    </>
  );
  return {
    attachmentVisibilityBinding,
    changesFeatureBinding,
    currentSubagentSummaries,
    deleteThread,
    documentNavigationBinding,
    drawingFeatureBinding,
    openSubagents,
    openTimelineDocument,
    reviewSubmissionBinding,
    terminalActionsBinding,
    toolContextChips,
  };
}
