import type { ReactNode } from "react";
import { useDocumentTransferAccess } from "../attachments/documentNavigation";
import { useComposerCommands } from "../composer/composerCommands";
import { useComposerInteractions } from "../composer/composerInteractions";
import { projectInlineQueue } from "../queue/QueueFeature";
import { createConversationChromeContent } from "./ConversationChromeContent";
import { createConversationComposerContent } from "./ConversationComposerContent";
import type { ConversationCompositionCapabilities } from "./conversationCompositionCapabilities";
import { createConversationFrame } from "./ConversationFrame";
import { createConversationOverlayContent } from "./ConversationOverlayContent";
import { useConversationScopeFeatures } from "./conversationScopeFeatures";
import { createConversationTimelineContent } from "./ConversationTimelineContent";
import { useConversationTools } from "./ConversationTools";
import { useConversationTimelineRead } from "./timeline/conversationTimelineRead";
import { useThreadTimeline } from "./timeline/ThreadTimeline";

/** Assembles existing conversation presentation slots without introducing mounted owners. */
export function createConversationSurfaceAssembly(props: {
  thread: NonNullable<ConversationCompositionCapabilities["surface"]["thread"]>;
  scoped: ReturnType<typeof useConversationScopeFeatures>;
  timelineRead: ReturnType<typeof useConversationTimelineRead>;
  liveStatusVisible: boolean;
  readInputs: ConversationCompositionCapabilities["read"];
  threadTimelineBinding: ReturnType<typeof useThreadTimeline>;
  surfaceInputs: ConversationCompositionCapabilities["surface"];
  projectsInputs: ConversationCompositionCapabilities["projects"];
  inlineQueueBinding: ReturnType<typeof projectInlineQueue>;
  inlineQueueMaxHeight: number;
  queueInputs: ConversationCompositionCapabilities["queue"];
  visibleQueuedPrompts: ConversationCompositionCapabilities["queue"]["queuedPrompts"];
  composerCommands: ReturnType<typeof useComposerCommands>;
  composerInputs: ConversationCompositionCapabilities["composer"];
  goalContent: ReactNode;
  bottomRequestPrompt: ReactNode;
  composerDelivery: ReturnType<typeof useComposerInteractions>;
  toolsBinding: ReturnType<typeof useConversationTools>;
  attachmentsInputs: ConversationCompositionCapabilities["attachments"];
  getStableTransferAccess: ReturnType<typeof useDocumentTransferAccess>;
  portsInputs: ConversationCompositionCapabilities["ports"];
  accountsInputs: ConversationCompositionCapabilities["accounts"];
  actionsInputs: ConversationCompositionCapabilities["actions"];
  terminalInputs: ConversationCompositionCapabilities["terminal"];
  goalInputs: ConversationCompositionCapabilities["goal"];
  reviewInputs: ConversationCompositionCapabilities["review"];
  changesInputs: ConversationCompositionCapabilities["changes"];
  agentsInputs: ConversationCompositionCapabilities["agents"];
}) {
  const timelineView = createConversationTimelineContent({
    composerScope: props.scoped.activation.composerScope,
    timelineState: props.scoped.timelineState,
    timelineRead: props.timelineRead,
    windowLayout: props.scoped.activation.windowLayout,
    timelineCompact: props.scoped.activation.timelineCompact,
    liveStatusVisible: props.liveStatusVisible,
    conversationInsets: props.scoped.activation.conversationInsets,
    overlayScrollStateBinding: props.scoped.overlayScrollStateBinding,
    historyViewport: props.readInputs.historyViewport,
    queueVisibilityBinding: props.scoped.queueVisibilityBinding,
    draftConnectionId: props.scoped.activation.draftConnectionId,
    draftThreadId: props.scoped.activation.draftThreadId,
    paginationTrimBinding: props.scoped.paginationTrimBinding,
    threadTimelineBinding: props.threadTimelineBinding,
    cwd: props.surfaceInputs.cwd,
    composerProjectSelectionBinding: props.scoped.composerProjectSelectionBinding,
    workspaceSupport: props.projectsInputs.workspaceSupport,
    projectsInputs: props.projectsInputs,
    workspaceMode: props.projectsInputs.workspaceMode,
    historyActivityModel: props.readInputs.historyActivityModel,
    historyActivityResourceId: props.readInputs.historyActivityResourceId,
    composerStateBinding: props.scoped.composerStateBinding,
    inlineQueueBinding: props.inlineQueueBinding,
    inlineQueueMaxHeight: props.inlineQueueMaxHeight,
    queueInputs: props.queueInputs,
    visibleQueuedPrompts: props.visibleQueuedPrompts,
    queueEditActionsBinding: props.composerCommands.queueEditActionsBinding,
    composerInputs: props.composerInputs,
    readOnly: props.surfaceInputs.readOnly,
    messageListState: props.readInputs.messageListState,
    readInputs: props.readInputs,
    goalContent: props.goalContent,
  });
  const composerView = createConversationComposerContent({
    surfaceInputs: props.surfaceInputs,
    composerInputs: props.composerInputs,
    readInputs: props.readInputs,
    composerStateBinding: props.scoped.composerStateBinding,
    composerCommands: props.composerCommands,
    toolsBinding: props.toolsBinding,
    attachmentsInputs: props.attachmentsInputs,
    getStableTransferAccess: props.getStableTransferAccess,
    composerDelivery: props.composerDelivery,
    activation: props.scoped.activation,
    portsInputs: props.portsInputs,
    overlayScrollOwnershipBinding: props.scoped.overlayScrollOwnershipBinding,
    timelineRead: props.timelineRead,
  });
  const chromeView = createConversationChromeContent({
    thread: props.thread,
    compact: props.surfaceInputs.compact,
    surfaceInputs: props.surfaceInputs,
    threadChatModel: props.readInputs.threadChatModel,
    draftConnectionId: props.scoped.activation.draftConnectionId,
    draftThreadId: props.scoped.activation.draftThreadId,
    historyActivityModel: props.readInputs.historyActivityModel,
    historyActivityResourceId: props.readInputs.historyActivityResourceId,
    cwd: props.surfaceInputs.cwd,
    newChat: props.surfaceInputs.newChat,
    timelineState: props.scoped.timelineState,
    timelineRead: props.timelineRead,
    readInputs: props.readInputs,
    currentUsage: props.readInputs.currentUsage,
    accountRateLimitsDatabase: props.accountsInputs.accountRateLimitsDatabase,
    accountsInputs: props.accountsInputs,
    readOnly: props.surfaceInputs.readOnly,
    archived: props.actionsInputs.archived,
    pinned: props.actionsInputs.pinned,
    overlayScrollOwnershipBinding: props.scoped.overlayScrollOwnershipBinding,
    threadRenameBinding: props.scoped.threadRenameBinding,
    actionsInputs: props.actionsInputs,
    deleteThread: props.toolsBinding.deleteThread,
    requestPrompt: props.bottomRequestPrompt,
    currentOutcome: props.readInputs.currentOutcome,
    composerView,
  });
  const conversationOverlayContentBinding = createConversationOverlayContent({
    surfaceInputs: props.surfaceInputs,
    composerStateBinding: props.scoped.composerStateBinding,
    readInputs: props.readInputs,
    composerCommands: props.composerCommands,
    composerInputs: props.composerInputs,
    terminalInputs: props.terminalInputs,
    goalInputs: props.goalInputs,
    portsInputs: props.portsInputs,
    visibleQueuedPrompts: props.visibleQueuedPrompts,
    timelineRead: props.timelineRead,
    composerScope: props.scoped.activation.composerScope,
    queueInputs: props.queueInputs,
    attachmentsInputs: props.attachmentsInputs,
    getStableTransferAccess: props.getStableTransferAccess,
    reviewInputs: props.reviewInputs,
    composerProjectSelectionBinding: props.scoped.composerProjectSelectionBinding,
    projectsInputs: props.projectsInputs,
    threadRenameBinding: props.scoped.threadRenameBinding,
    thread: props.thread,
    actionsInputs: props.actionsInputs,
    toolsBinding: props.toolsBinding,
    changesInputs: props.changesInputs,
    appVoiceInputRuntime: props.scoped.activation.appVoiceInputRuntime,
  });
  const frameBinding = createConversationFrame({
    appVoiceInputRuntime: props.scoped.activation.appVoiceInputRuntime,
    composerScope: props.scoped.activation.composerScope,
    overlayScrollOwnershipBinding: props.scoped.overlayScrollOwnershipBinding,
    agentsInputs: props.agentsInputs,
    draftConnectionId: props.scoped.activation.draftConnectionId,
    draftThreadId: props.scoped.activation.draftThreadId,
    toolsBinding: props.toolsBinding,
    chromeView,
    conversationOverlayContentBinding,
    surfaceInputs: props.surfaceInputs,
    conversationPaneGeometryBinding: props.scoped.activation.conversationPaneGeometryBinding,
    timelineState: props.scoped.timelineState,
    conversationInsets: props.scoped.activation.conversationInsets,
    composerStateBinding: props.scoped.composerStateBinding,
    timelineView,
    timelineRead: props.timelineRead,
    composerProjectSelectionBinding: props.scoped.composerProjectSelectionBinding,
    threadRenameBinding: props.scoped.threadRenameBinding,
  });
  return { frameBinding };
}
