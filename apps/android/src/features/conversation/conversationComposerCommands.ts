import { useDocumentTransferAccess } from "../attachments/documentNavigation";
import { useComposerCommands } from "../composer/composerCommands";
import type { ConversationCompositionCapabilities } from "./conversationCompositionCapabilities";
import type { useConversationScopeFeatures } from "./conversationScopeFeatures";
import { useConversationRouteNavigation } from "./conversationRouteNavigation";
import { useConversationToolRoute } from "./conversationToolRoute";
import type { useConversationTimelineRead } from "./timeline/conversationTimelineRead";

type ConversationComposerCommandInput = {
  readonly props: ConversationCompositionCapabilities;
  readonly scoped: ReturnType<typeof useConversationScopeFeatures>;
  readonly timelineRead: ReturnType<typeof useConversationTimelineRead>;
  readonly visibleQueuedPrompts: ConversationCompositionCapabilities["queue"]["queuedPrompts"];
};

type ConversationComposerCommandBinding = {
  readonly composerCommands: ReturnType<typeof useComposerCommands>;
  readonly getStableTransferAccess: ReturnType<typeof useDocumentTransferAccess>;
};

/** Connects composer commands to route navigation and retained document transfer access. */
export function useConversationComposerCommands({
  props,
  scoped,
  timelineRead,
  visibleQueuedPrompts,
}: ConversationComposerCommandInput): ConversationComposerCommandBinding {
  const routeNavigation = useConversationRouteNavigation();
  const getStableTransferAccess = useDocumentTransferAccess(props.attachments.getTransferAccess);
  const openToolRoute = useConversationToolRoute({
    props,
    routeNavigation,
    scoped,
    timelineRead,
    visibleQueuedPrompts,
  });
  const composerCommands = useComposerCommands({
    attachmentsInputs: props.attachments,
    composerInputs: props.composer,
    composerScope: scoped.activation.composerScope,
    composerStateBinding: scoped.composerStateBinding,
    conversationOwner: scoped.activation.conversationOwner,
    draftConnectionId: scoped.activation.draftConnectionId,
    draftThreadId: scoped.activation.draftThreadId,
    fileTransferController: props.attachments.fileTransferController,
    getStableTransferAccess,
    openToolRoute,
    overlayScrollOwnershipBinding: scoped.overlayScrollOwnershipBinding,
    queueInputs: props.queue,
    queueVisibilityBinding: scoped.queueVisibilityBinding,
    voiceController: props.composer.voiceController,
  });
  return { composerCommands, getStableTransferAccess };
}
