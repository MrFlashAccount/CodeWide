import { useComposerInteractions } from "../composer/composerInteractions";
import { ThreadGoalChip } from "../goal/ThreadGoalChip";
import { projectInlineQueue } from "../queue/QueueFeature";
import { useConversationRequestPrompts } from "../requests/ConversationRequestPrompts";
import type { ConversationCompositionCapabilities } from "./conversationCompositionCapabilities";
import { ConversationSelectionPlaceholder } from "./ConversationEmptyState";
import { useConversationScopeFeatures } from "./conversationScopeFeatures";
import { createConversationSurfaceAssembly } from "./conversationSurfaceAssembly";
import { useConversationTools } from "./ConversationTools";
import { useConversationTimelineRead } from "./timeline/conversationTimelineRead";
import { useConversationAndroidBack } from "./timeline/overlayScrollOwnership";
import { useThreadTimeline, useThreadTimelineActions } from "./timeline/ThreadTimeline";
import { useConversationComposerCommands } from "./conversationComposerCommands";
import { conversationStatusLayout } from "./conversationStatusLayout";

/** Binds conversation capabilities to the read, tool, and composer surfaces. */
export function ConversationComposition(
  props: ConversationCompositionCapabilities,
): React.JSX.Element {
  const scoped = useConversationScopeFeatures({
    changesInputs: props.changes,
    composerInputs: props.composer,
    goalInputs: props.goal,
    projectsInputs: props.projects,
    queueInputs: props.queue,
    readInputs: props.read,
    surfaceInputs: props.surface,
  });

  const visibleQueuedPrompts = props.queue.queuedPrompts;
  const inlineQueueBinding = projectInlineQueue(visibleQueuedPrompts);
  const timelineRead = useConversationTimelineRead({
    composerScope: scoped.activation.composerScope,
    conversationOwner: scoped.activation.conversationOwner,
    currentOutcome: props.read.currentOutcome,
    draftConnectionId: scoped.activation.draftConnectionId,
    draftThreadId: scoped.activation.draftThreadId,
    historyRestoreReady: props.read.historyRestoreReady,
    historyViewport: props.read.historyViewport,
    messageListState: props.read.messageListState,
    newChat: props.surface.newChat,
    overlayScrollOwnershipBinding: scoped.overlayScrollOwnershipBinding,
    overlayScrollStateBinding: scoped.overlayScrollStateBinding,
    readInputs: props.read,
    searchWindow: props.read.searchWindow,
    surfaceInputs: props.surface,
    timelineState: scoped.timelineState,
    unread: props.surface.unread,
  });
  const { currentGoal, inlineQueueMaxHeight, liveStatusVisible } = conversationStatusLayout(
    scoped,
    timelineRead,
  );
  const { bottomRequestPrompt, embeddedRequestPrompt } = useConversationRequestPrompts(
    props.requests,
  );
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
  const { composerCommands, getStableTransferAccess } = useConversationComposerCommands({
    props,
    scoped,
    timelineRead,
    visibleQueuedPrompts,
  });
  const toolsBinding = useConversationTools({
    actionsInputs: props.actions,
    agentsInputs: props.agents,
    appVoiceInputRuntime: scoped.activation.appVoiceInputRuntime,
    attachmentsInputs: props.attachments,
    changeResourcePresentationBinding: scoped.changeResourcePresentationBinding,
    changesInputs: props.changes,
    changesPreferencesBinding: scoped.changesPreferencesBinding,
    composerCommands,
    composerInputs: props.composer,
    composerScope: scoped.activation.composerScope,
    composerStateBinding: scoped.composerStateBinding,
    cwd: props.surface.cwd,
    diagnosticsInputs: props.diagnostics,
    draftConnectionId: scoped.activation.draftConnectionId,
    draftThreadId: scoped.activation.draftThreadId,
    fileTransferController: props.attachments.fileTransferController,
    getStableTransferAccess,
    overlayScrollOwnershipBinding: scoped.overlayScrollOwnershipBinding,
    portForwardingConnectionId: props.ports.portForwardingConnectionId,
    portsInputs: props.ports,
    readInputs: props.read,
    subagentSummaryDatabase: props.agents.subagentSummaryDatabase,
    subagentThreadDetails: props.agents.subagentThreadDetails,
    surfaceInputs: props.surface,
    threadResourceId: props.changes.threadResourceId,
    threadResourceRevision: props.changes.threadResourceRevision,
    threadResourcesModel: props.changes.threadResourcesModel,
    threadTimelineActionsBinding,
    voiceController: props.composer.voiceController,
  });
  const threadTimelineBinding = useThreadTimeline({
    animateLiveUpdates: scoped.activation.animateLiveUpdates,
    composerScope: scoped.activation.composerScope,
    fixUnsupportedBlock: threadTimelineActionsBinding.fixUnsupportedBlock,
    focusSearchMessage: timelineRead.timelineSearchActionsBinding.focusSearchMessage,
    forkThroughTurn: threadTimelineActionsBinding.forkThroughTurn,
    getStableTransferAccess,
    getTransferAccess: props.attachments.getTransferAccess,
    latestUnreadAgentTurnId: timelineRead.unreadReceiptBinding.latestUnreadAgentTurnId,
    loadStableTurnItems: threadTimelineActionsBinding.loadStableTurnItems,
    onFixUnsupportedBlock: props.diagnostics.onFixUnsupportedBlock,
    onFork: props.actions.onFork,
    onLoadTurnItems: props.read.onLoadTurnItems,
    onRetryFailedMessage: props.composer.onRetryFailedMessage,
    openThreadDocumentLink: toolsBinding.documentNavigationBinding.openThreadDocumentLink,
    requestPrompt: embeddedRequestPrompt,
    scheduleUnreadAgentVisibilityCheck:
      timelineRead.unreadReceiptActionsBinding.scheduleUnreadAgentVisibilityCheck,
    searchWindow: props.read.searchWindow,
    setLatestUnreadAgentNode: timelineRead.unreadReceiptActionsBinding.setLatestUnreadAgentNode,
    threadSearchActive: timelineRead.timelineSearchProjectionBinding.threadSearchActive,
    timelineCompact: scoped.activation.timelineCompact,
    timelineDateLabels: timelineRead.timelineDateLabels,
  });
  const composerDelivery = useComposerInteractions({
    composerCommands,
    composerInputs: props.composer,
    composerScope: scoped.activation.composerScope,
    composerStateBinding: scoped.composerStateBinding,
    conversationOwner: scoped.activation.conversationOwner,
    createAndOpenTerminal: toolsBinding.terminalActionsBinding.createAndOpenTerminal,
    currentTurnId: timelineRead.conversationPresentationBinding.currentTurnId,
    draftConnectionId: scoped.activation.draftConnectionId,
    draftThreadId: scoped.activation.draftThreadId,
    newChat: props.surface.newChat,
    onGetGoal: props.goal.onGetGoal,
    openDrawing: toolsBinding.drawingFeatureBinding.openDrawing,
    portForwardingConnectionId: props.ports.portForwardingConnectionId,
    queueInputs: props.queue,
    remoteThread: props.read.remoteThread,
    threadLifecycleActive: timelineRead.conversationPresentationBinding.threadLifecycleActive,
    voiceController: props.composer.voiceController,
  });
  const goalContent =
    currentGoal === null ? null : (
      <ThreadGoalChip goal={currentGoal} onPress={composerDelivery.openGoalDetails} />
    );

  if (props.surface.thread === null) {
    return <ConversationSelectionPlaceholder />;
  }
  const { frameBinding } = createConversationSurfaceAssembly({
    accountsInputs: props.accounts,
    actionsInputs: props.actions,
    agentsInputs: props.agents,
    attachmentsInputs: props.attachments,
    bottomRequestPrompt,
    changesInputs: props.changes,
    composerCommands,
    composerDelivery,
    composerInputs: props.composer,
    getStableTransferAccess,
    goalContent,
    goalInputs: props.goal,
    inlineQueueBinding,
    inlineQueueMaxHeight,
    liveStatusVisible,
    portsInputs: props.ports,
    projectsInputs: props.projects,
    queueInputs: props.queue,
    readInputs: props.read,
    reviewInputs: props.review,
    scoped,
    surfaceInputs: props.surface,
    terminalInputs: props.terminal,
    thread: props.surface.thread,
    threadTimelineBinding,
    timelineRead,
    toolsBinding,
    visibleQueuedPrompts,
  });

  return frameBinding.frame;
}
