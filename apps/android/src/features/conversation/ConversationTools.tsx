import { useImagePreviewAnnotationHandler } from "../../rendering/ImagePreviewHost";
import { useAgentSelection } from "../agents/agentSelection";
import { useAgentsFeature } from "../agents/AgentsFeature";
import { ComposerSubagentContextChip } from "../agents/ComposerSubagentContextChip";
import type { SubagentThreadView } from "../agents/SubagentSheet";
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
import { useTerminalFeature } from "../terminal/TerminalFeature";
import type { UseConversationToolsProps } from "./ConversationTools.types";
import { SubagentConversation } from "./SubagentConversation";
export function useConversationTools(props: UseConversationToolsProps) {
  const currentSubagentSummaries = useAgentSelection(
    props.composerScope,
    props.subagentSummaryDatabase,
    props.draftConnectionId,
    props.draftThreadId,
  );
  const renderSubagentThread = (view: SubagentThreadView) => (
    <SubagentConversation
      key={`${view.connectionId}:${view.thread.id}`}
      view={view}
      server={props.surfaceInputs.server}
      summaries={props.subagentSummaryDatabase}
      details={props.subagentThreadDetails}
      refresh={props.agentsInputs.onRefreshSubagents}
      loadTurnChanges={props.changesInputs.onLoadTurnChanges}
      getTransferAccess={props.attachmentsInputs.getTransferAccess}
      fixUnsupportedBlock={
        props.diagnosticsInputs.onFixUnsupportedBlock === undefined
          ? undefined
          : props.threadTimelineActionsBinding.fixUnsupportedBlock
      }
    />
  );
  const openSubagents = useAgentsFeature(
    props.draftConnectionId,
    props.draftThreadId,
    props.readInputs.remoteThread ?? null,
    props.subagentThreadDetails,
    props.agentsInputs.onRefreshSubagents,
    props.overlayScrollOwnershipBinding.fullscreenOverlay,
    renderSubagentThread,
  );
  const presentTerminal = useTerminalFeature(
    props.draftConnectionId,
    props.draftThreadId,
    props.cwd,
    props.overlayScrollOwnershipBinding.fullscreenOverlay,
  );
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
    draftThreadId: props.draftThreadId,
    composerScope: props.composerScope,
    fileAttachmentEnabled: props.composerCommands.composerAttachmentsBinding.fileAttachmentEnabled,
    readDrawingAttachments:
      props.composerCommands.composerAttachmentsBinding.readDrawingAttachments,
    captureStageAttachment:
      props.composerCommands.composerAttachmentsBinding.captureStageAttachment,
    hideComposerTray: () =>
      props.composerStateBinding.composerMenuStateBinding.setComposerTrayVisible(false),
    fullscreenOverlay: props.overlayScrollOwnershipBinding.fullscreenOverlay,
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
    cwd: props.cwd,
    remoteThread: props.readInputs.remoteThread,
    changesPreferences: props.changesPreferencesBinding.changesPreferences,
    setChangesPreferences: props.changesPreferencesBinding.setChangesPreferences,
    dismissComposerKeyboardForOverlay:
      props.overlayScrollOwnershipBinding.dismissComposerKeyboardForOverlay,
    fullscreenOverlay: props.overlayScrollOwnershipBinding.fullscreenOverlay,
    appVoiceInputRuntime: props.appVoiceInputRuntime,
    getStableTransferAccess: props.getStableTransferAccess,
    attachCodeReview: reviewSubmissionBinding.attachCodeReview,
    onLoadTurnChanges: props.changesInputs.onLoadTurnChanges,
    onLoadThreadResources: props.changesInputs.onLoadThreadResources,
    onLoadThreadChangeDiff: props.changesInputs.onLoadThreadChangeDiff,
    currentThreadResources: props.changeResourcePresentationBinding.currentThreadResources,
    currentChangePresentation: props.changeResourcePresentationBinding.currentChangePresentation,
  });
  const attachmentVisibilityBinding = useAttachmentVisibility(
    props.composerScope,
    () => props.overlayScrollOwnershipBinding.dismissComposerKeyboardForOverlay(),
    props.changesInputs.onLoadThreadResources,
    () => changesFeatureBinding.openChangesResource(),
  );
  const documentNavigationBinding = useDocumentNavigation(
    props.cwd,
    props.attachmentsInputs.getTransferAccess,
    props.getStableTransferAccess,
    props.portsInputs.onOpenLoopbackLink,
    (request) => changesFeatureBinding.openCodeDocument(request),
  );
  const toolContextChips = (
    <>
      {props.changesInputs.onLoadThreadResources !== undefined && (
        <ThreadResourceContextChips
          model={props.threadResourcesModel}
          resourceId={props.threadResourceId}
          revision={props.threadResourceRevision}
          load={props.changesInputs.onLoadThreadResources}
          preferences={props.changesPreferencesBinding.changesPreferences}
          onPreferencesChange={props.changesPreferencesBinding.setChangesPreferences}
          onOpen={attachmentVisibilityBinding.openThreadResources}
        />
      )}
      <ComposerPortContextChip
        connectionId={props.portForwardingConnectionId}
        onOpen={() => props.composerCommands.composerControlActionsBinding.openControls("ports")}
      />
      <ComposerTerminalContextChip
        connectionId={props.draftConnectionId}
        threadId={props.draftThreadId}
        onOpen={terminalActionsBinding.openTerminal}
      />
      {props.subagentThreadDetails !== null && (
        <ComposerSubagentContextChip
          database={props.subagentSummaryDatabase}
          connectionId={props.draftConnectionId}
          parentThreadId={props.draftThreadId}
          onOpen={(summaries) => openSubagents(summaries)}
        />
      )}
    </>
  );
  return {
    documentNavigationBinding,
    drawingFeatureBinding,
    terminalActionsBinding,
    toolContextChips,
    deleteThread,
    attachmentVisibilityBinding,
    reviewSubmissionBinding,
    openSubagents,
    currentSubagentSummaries,
    changesFeatureBinding,
  };
}
