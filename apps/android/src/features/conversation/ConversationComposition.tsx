import { controlSize } from "../../theme";
import {
  conversationBottomContentInset,
  conversationHeaderChromeHeight,
} from "../../ui/conversation-chrome-layout";
import { useDocumentTransferAccess } from "../attachments/documentNavigation";
import { useComposerCommands } from "../composer/composerCommands";
import { useComposerInteractions } from "../composer/composerInteractions";
import { ThreadGoalChip } from "../goal/ThreadGoalChip";
import { projectInlineQueue } from "../queue/QueueFeature";
import { ApprovalPrompt } from "../requests/RequestFeature";
import { useRequestResponse } from "../requests/requestResponse";
import type { ConversationCompositionCapabilities } from "./conversationCompositionCapabilities";
import { ConversationSelectionPlaceholder } from "./ConversationEmptyState";
import { useConversationScopeFeatures } from "./conversationScopeFeatures";
import { createConversationSurfaceAssembly } from "./conversationSurfaceAssembly";
import { useConversationTools } from "./ConversationTools";
import { useConversationTimelineRead } from "./timeline/conversationTimelineRead";
import { useConversationAndroidBack } from "./timeline/overlayScrollOwnership";
import { useThreadTimeline, useThreadTimelineActions } from "./timeline/ThreadTimeline";

/** Binds conversation capabilities to the read, tool, and composer surfaces. */
export function ConversationComposition(props: ConversationCompositionCapabilities) {
  const scoped = useConversationScopeFeatures({
    surfaceInputs: props.surface,
    readInputs: props.read,
    composerInputs: props.composer,
    goalInputs: props.goal,
    queueInputs: props.queue,
    changesInputs: props.changes,
    projectsInputs: props.projects,
  });

  const visibleQueuedPrompts = props.queue.queuedPrompts;
  const inlineQueueBinding = projectInlineQueue(visibleQueuedPrompts);
  const timelineRead = useConversationTimelineRead({
    timelineState: scoped.timelineState,
    unread: props.surface.unread,
    readInputs: props.read,
    composerScope: scoped.activation.composerScope,
    surfaceInputs: props.surface,
    draftConnectionId: scoped.activation.draftConnectionId,
    draftThreadId: scoped.activation.draftThreadId,
    historyViewport: props.read.historyViewport,
    currentOutcome: props.read.currentOutcome,
    messageListState: props.read.messageListState,
    overlayScrollStateBinding: scoped.overlayScrollStateBinding,
    searchWindow: props.read.searchWindow,
    newChat: props.surface.newChat,
    historyRestoreReady: props.read.historyRestoreReady,
    conversationOwner: scoped.activation.conversationOwner,
    overlayScrollOwnershipBinding: scoped.overlayScrollOwnershipBinding,
  });
  const liveTurnPlanVisible =
    timelineRead.conversationPresentationBinding.liveTurnPlan !== null &&
    timelineRead.timelinePositioned &&
    !timelineRead.timelineSearchProjectionBinding.threadSearchActive;
  const currentGoal = scoped.goalResource?.goal ?? null;
  const threadGoalVisible =
    currentGoal !== null &&
    timelineRead.timelinePositioned &&
    !timelineRead.timelineSearchProjectionBinding.threadSearchActive;
  const liveStatusVisible = liveTurnPlanVisible || threadGoalVisible;
  const inlineQueueMaxHeight = Math.max(
    controlSize.touch * 3,
    scoped.activation.conversationPaneGeometryBinding.conversationPaneHeight -
      conversationHeaderChromeHeight(
        scoped.timelineState.timelineSearchStateBinding.threadSearchVisible,
      ) -
      conversationBottomContentInset(
        scoped.timelineState.timelineViewportStateBinding.bottomChromeHeight,
        liveStatusVisible,
      ),
  );
  const requestResponseBinding = useRequestResponse(props.requests.onRespondToRequest);
  const embeddedRequestPrompt =
    props.requests.pendingRequest === null ? null : (
      <ApprovalPrompt
        key={props.requests.pendingRequest.requestKey}
        embedded
        request={props.requests.pendingRequest}
        requestCount={props.requests.pendingRequestCount}
        {...(props.requests.onRespondToRequest === undefined
          ? {}
          : { onRespond: requestResponseBinding.respondToRequest })}
      />
    );
  const bottomRequestPrompt =
    props.requests.pendingRequest === null ? null : (
      <ApprovalPrompt
        key={props.requests.pendingRequest.requestKey}
        request={props.requests.pendingRequest}
        requestCount={props.requests.pendingRequestCount}
        {...(props.requests.onRespondToRequest === undefined
          ? {}
          : { onRespond: props.requests.onRespondToRequest })}
      />
    );
  const getStableTransferAccess = useDocumentTransferAccess(props.attachments.getTransferAccess);
  const threadTimelineActionsBinding = useThreadTimelineActions(
    props.diagnostics.onFixUnsupportedBlock,
    props.actions.onFork,
    props.read.onLoadTurnItems,
  );

  useConversationAndroidBack(
    scoped.queueVisibilityBinding.inlineQueueExpanded,
    scoped.queueVisibilityBinding.closeInlineQueueOverlay,
    props.surface.compact,
    props.surface.onBack,
  );
  const composerCommands = useComposerCommands({
    composerStateBinding: scoped.composerStateBinding,
    queueVisibilityBinding: scoped.queueVisibilityBinding,
    queueInputs: props.queue,
    conversationOwner: scoped.activation.conversationOwner,
    overlayScrollOwnershipBinding: scoped.overlayScrollOwnershipBinding,
    composerScope: scoped.activation.composerScope,
    draftConnectionId: scoped.activation.draftConnectionId,
    draftThreadId: scoped.activation.draftThreadId,
    attachmentsInputs: props.attachments,
    getStableTransferAccess,
    composerInputs: props.composer,
    fileTransferController: props.attachments.fileTransferController,
    voiceController: props.composer.voiceController,
  });
  const toolsBinding = useConversationTools({
    composerScope: scoped.activation.composerScope,
    subagentSummaryDatabase: props.agents.subagentSummaryDatabase,
    draftConnectionId: scoped.activation.draftConnectionId,
    draftThreadId: scoped.activation.draftThreadId,
    surfaceInputs: props.surface,
    subagentThreadDetails: props.agents.subagentThreadDetails,
    agentsInputs: props.agents,
    changesInputs: props.changes,
    attachmentsInputs: props.attachments,
    diagnosticsInputs: props.diagnostics,
    threadTimelineActionsBinding,
    readInputs: props.read,
    overlayScrollOwnershipBinding: scoped.overlayScrollOwnershipBinding,
    cwd: props.surface.cwd,
    actionsInputs: props.actions,
    composerCommands,
    fileTransferController: props.attachments.fileTransferController,
    composerStateBinding: scoped.composerStateBinding,
    appVoiceInputRuntime: scoped.activation.appVoiceInputRuntime,
    voiceController: props.composer.voiceController,
    composerInputs: props.composer,
    changesPreferencesBinding: scoped.changesPreferencesBinding,
    getStableTransferAccess,
    changeResourcePresentationBinding: scoped.changeResourcePresentationBinding,
    portsInputs: props.ports,
    threadResourcesModel: props.changes.threadResourcesModel,
    threadResourceId: props.changes.threadResourceId,
    threadResourceRevision: props.changes.threadResourceRevision,
    portForwardingConnectionId: props.ports.portForwardingConnectionId,
  });
  const threadTimelineBinding = useThreadTimeline({
    fixUnsupportedBlock: threadTimelineActionsBinding.fixUnsupportedBlock,
    forkThroughTurn: threadTimelineActionsBinding.forkThroughTurn,
    loadStableTurnItems: threadTimelineActionsBinding.loadStableTurnItems,
    onFixUnsupportedBlock: props.diagnostics.onFixUnsupportedBlock,
    onFork: props.actions.onFork,
    onLoadTurnItems: props.read.onLoadTurnItems,
    timelineDateLabels: timelineRead.timelineDateLabels,
    searchWindow: props.read.searchWindow,
    focusSearchMessage: timelineRead.timelineSearchActionsBinding.focusSearchMessage,
    openThreadDocumentLink: toolsBinding.documentNavigationBinding.openThreadDocumentLink,
    composerScope: scoped.activation.composerScope,
    getTransferAccess: props.attachments.getTransferAccess,
    getStableTransferAccess,
    timelineCompact: scoped.activation.timelineCompact,
    animateLiveUpdates: scoped.activation.animateLiveUpdates,
    threadSearchActive: timelineRead.timelineSearchProjectionBinding.threadSearchActive,
    requestPrompt: embeddedRequestPrompt,
    latestUnreadAgentTurnId: timelineRead.unreadReceiptBinding.latestUnreadAgentTurnId,
    setLatestUnreadAgentNode: timelineRead.unreadReceiptActionsBinding.setLatestUnreadAgentNode,
    scheduleUnreadAgentVisibilityCheck:
      timelineRead.unreadReceiptActionsBinding.scheduleUnreadAgentVisibilityCheck,
    onRetryFailedMessage: props.composer.onRetryFailedMessage,
  });
  const composerDelivery = useComposerInteractions({
    composerCommands,
    openDrawing: toolsBinding.drawingFeatureBinding.openDrawing,
    createAndOpenTerminal: toolsBinding.terminalActionsBinding.createAndOpenTerminal,
    onGetGoal: props.goal.onGetGoal,
    newChat: props.surface.newChat,
    draftConnectionId: scoped.activation.draftConnectionId,
    draftThreadId: scoped.activation.draftThreadId,
    portForwardingConnectionId: props.ports.portForwardingConnectionId,
    composerStateBinding: scoped.composerStateBinding,
    composerScope: scoped.activation.composerScope,
    threadLifecycleActive: timelineRead.conversationPresentationBinding.threadLifecycleActive,
    currentTurnId: timelineRead.conversationPresentationBinding.currentTurnId,
    conversationOwner: scoped.activation.conversationOwner,
    composerInputs: props.composer,
    queueInputs: props.queue,
    voiceController: props.composer.voiceController,
    remoteThread: props.read.remoteThread,
  });
  const goalContent =
    currentGoal === null ? null : (
      <ThreadGoalChip goal={currentGoal} onPress={composerDelivery.openGoalDetails} />
    );

  if (props.surface.thread === null) {
    return <ConversationSelectionPlaceholder />;
  }
  const { frameBinding } = createConversationSurfaceAssembly({
    thread: props.surface.thread,
    scoped,
    timelineRead,
    liveStatusVisible,
    readInputs: props.read,
    threadTimelineBinding,
    surfaceInputs: props.surface,
    projectsInputs: props.projects,
    inlineQueueBinding,
    inlineQueueMaxHeight,
    queueInputs: props.queue,
    visibleQueuedPrompts,
    composerCommands,
    composerInputs: props.composer,
    goalContent,
    bottomRequestPrompt,
    composerDelivery,
    toolsBinding,
    attachmentsInputs: props.attachments,
    getStableTransferAccess,
    portsInputs: props.ports,
    accountsInputs: props.accounts,
    actionsInputs: props.actions,
    terminalInputs: props.terminal,
    goalInputs: props.goal,
    reviewInputs: props.review,
    changesInputs: props.changes,
    agentsInputs: props.agents,
  });

  return frameBinding.frame;
}
