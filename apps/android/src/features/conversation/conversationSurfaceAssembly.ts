import type { ReactNode } from "react";
import type { useDocumentTransferAccess } from "../attachments/documentNavigation";
import type { useComposerCommands } from "../composer/composerCommands";
import type { useComposerInteractions } from "../composer/composerInteractions";
import type { projectInlineQueue } from "../queue/QueueFeature";
import { createConversationChromeContent } from "./ConversationChromeContent";
import { createConversationComposerContent } from "./ConversationComposerContent";
import type { ConversationCompositionCapabilities } from "./conversationCompositionCapabilities";
import { createConversationFrame } from "./ConversationFrame";
import { createConversationOverlayContent } from "./ConversationOverlayContent";
import type { useConversationScopeFeatures } from "./conversationScopeFeatures";
import { createConversationTimelineContent } from "./ConversationTimelineContent";
import type { useConversationTools } from "./ConversationTools";
import type { useConversationTimelineRead } from "./timeline/conversationTimelineRead";
import type { useThreadTimeline } from "./timeline/ThreadTimeline";

/** Assembles existing conversation presentation slots without introducing mounted owners. */
export function createConversationSurfaceAssembly(props: {
  accountsInputs: ConversationCompositionCapabilities["accounts"];
  actionsInputs: ConversationCompositionCapabilities["actions"];
  agentsInputs: ConversationCompositionCapabilities["agents"];
  attachmentsInputs: ConversationCompositionCapabilities["attachments"];
  bottomRequestPrompt: ReactNode;
  changesInputs: ConversationCompositionCapabilities["changes"];
  composerCommands: ReturnType<typeof useComposerCommands>;
  composerDelivery: ReturnType<typeof useComposerInteractions>;
  composerInputs: ConversationCompositionCapabilities["composer"];
  getStableTransferAccess: ReturnType<typeof useDocumentTransferAccess>;
  goalContent: ReactNode;
  goalInputs: ConversationCompositionCapabilities["goal"];
  inlineQueueBinding: ReturnType<typeof projectInlineQueue>;
  inlineQueueMaxHeight: number;
  liveStatusVisible: boolean;
  portsInputs: ConversationCompositionCapabilities["ports"];
  projectsInputs: ConversationCompositionCapabilities["projects"];
  queueInputs: ConversationCompositionCapabilities["queue"];
  readInputs: ConversationCompositionCapabilities["read"];
  reviewInputs: ConversationCompositionCapabilities["review"];
  scoped: ReturnType<typeof useConversationScopeFeatures>;
  surfaceInputs: ConversationCompositionCapabilities["surface"];
  terminalInputs: ConversationCompositionCapabilities["terminal"];
  thread: NonNullable<ConversationCompositionCapabilities["surface"]["thread"]>;
  threadTimelineBinding: ReturnType<typeof useThreadTimeline>;
  timelineRead: ReturnType<typeof useConversationTimelineRead>;
  toolsBinding: ReturnType<typeof useConversationTools>;
  visibleQueuedPrompts: ConversationCompositionCapabilities["queue"]["queuedPrompts"];
}) {
  const timelineView = createConversationTimelineContent({
    composerInputs: props.composerInputs,
    composerProjectSelectionBinding: props.scoped.composerProjectSelectionBinding,
    composerScope: props.scoped.activation.composerScope,
    composerStateBinding: props.scoped.composerStateBinding,
    conversationInsets: props.scoped.activation.conversationInsets,
    cwd: props.surfaceInputs.cwd,
    draftConnectionId: props.scoped.activation.draftConnectionId,
    draftThreadId: props.scoped.activation.draftThreadId,
    goalContent: null,
    historyActivityModel: props.readInputs.historyActivityModel,
    historyActivityResourceId: props.readInputs.historyActivityResourceId,
    historyViewport: props.readInputs.historyViewport,
    inlineQueueBinding: props.inlineQueueBinding,
    inlineQueueMaxHeight: props.inlineQueueMaxHeight,
    liveStatusVisible: props.liveStatusVisible,
    messageListState: props.readInputs.messageListState,
    overlayScrollStateBinding: props.scoped.overlayScrollStateBinding,
    paginationTrimBinding: props.scoped.paginationTrimBinding,
    projectsInputs: props.projectsInputs,
    queueEditActionsBinding: props.composerCommands.queueEditActionsBinding,
    queueInputs: props.queueInputs,
    queueVisibilityBinding: props.scoped.queueVisibilityBinding,
    readInputs: props.readInputs,
    readOnly: props.surfaceInputs.readOnly,
    threadTimelineBinding: props.threadTimelineBinding,
    timelineCompact: props.scoped.activation.timelineCompact,
    timelineRead: props.timelineRead,
    timelineState: props.scoped.timelineState,
    visibleQueuedPrompts: props.visibleQueuedPrompts,
    windowLayout: props.scoped.activation.windowLayout,
    workspaceMode: props.projectsInputs.workspaceMode,
    workspaceSupport: props.projectsInputs.workspaceSupport,
  });
  const composerView = createConversationComposerContent({
    activation: props.scoped.activation,
    attachmentsInputs: props.attachmentsInputs,
    composerCommands: props.composerCommands,
    composerDelivery: props.composerDelivery,
    composerInputs: props.composerInputs,
    composerStateBinding: props.scoped.composerStateBinding,
    getStableTransferAccess: props.getStableTransferAccess,
    goalContent: props.goalContent,
    goalInputs: props.goalInputs,
    goalResource: props.scoped.goalResource,
    overlayScrollOwnershipBinding: props.scoped.overlayScrollOwnershipBinding,
    readInputs: props.readInputs,
    surfaceInputs: props.surfaceInputs,
    timelineRead: props.timelineRead,
    toolsBinding: props.toolsBinding,
  });
  const chromeView = createConversationChromeContent({
    accountRateLimitsDatabase: props.accountsInputs.accountRateLimitsDatabase,
    accountsInputs: props.accountsInputs,
    actionsInputs: props.actionsInputs,
    archived: props.actionsInputs.archived,
    compact: props.surfaceInputs.compact,
    composerView,
    currentOutcome: props.readInputs.currentOutcome,
    currentUsage: props.readInputs.currentUsage,
    cwd: props.surfaceInputs.cwd,
    deleteThread: props.toolsBinding.deleteThread,
    draftConnectionId: props.scoped.activation.draftConnectionId,
    draftThreadId: props.scoped.activation.draftThreadId,
    historyActivityModel: props.readInputs.historyActivityModel,
    historyActivityResourceId: props.readInputs.historyActivityResourceId,
    newChat: props.surfaceInputs.newChat,
    overlayScrollOwnershipBinding: props.scoped.overlayScrollOwnershipBinding,
    pinned: props.actionsInputs.pinned,
    readInputs: props.readInputs,
    readOnly: props.surfaceInputs.readOnly,
    requestPrompt: props.bottomRequestPrompt,
    surfaceInputs: props.surfaceInputs,
    thread: props.thread,
    threadChatModel: props.readInputs.threadChatModel,
    threadRenameBinding: props.scoped.threadRenameBinding,
    timelineRead: props.timelineRead,
    timelineState: props.scoped.timelineState,
  });
  const conversationOverlayContentBinding = createConversationOverlayContent({
    actionsInputs: props.actionsInputs,
    composerProjectSelectionBinding: props.scoped.composerProjectSelectionBinding,
    projectsInputs: props.projectsInputs,
    surfaceInputs: props.surfaceInputs,
    thread: props.thread,
    threadRenameBinding: props.scoped.threadRenameBinding,
  });
  const frameBinding = createConversationFrame({
    agentsInputs: props.agentsInputs,
    appVoiceInputRuntime: props.scoped.activation.appVoiceInputRuntime,
    chromeView,
    composerProjectSelectionBinding: props.scoped.composerProjectSelectionBinding,
    composerScope: props.scoped.activation.composerScope,
    composerStateBinding: props.scoped.composerStateBinding,
    conversationInsets: props.scoped.activation.conversationInsets,
    conversationOverlayContentBinding,
    conversationPaneGeometryBinding: props.scoped.activation.conversationPaneGeometryBinding,
    draftConnectionId: props.scoped.activation.draftConnectionId,
    draftThreadId: props.scoped.activation.draftThreadId,
    overlayScrollOwnershipBinding: props.scoped.overlayScrollOwnershipBinding,
    surfaceInputs: props.surfaceInputs,
    threadRenameBinding: props.scoped.threadRenameBinding,
    timelineRead: props.timelineRead,
    timelineState: props.scoped.timelineState,
    timelineView,
    toolsBinding: props.toolsBinding,
  });
  return { frameBinding };
}
