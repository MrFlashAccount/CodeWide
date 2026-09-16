import type { useConversationOwner } from "../../ui/use-conversation-owner";
import type { QueueWorkspaceCapabilities } from "../queue/queueWorkspaceCapabilities";
import { useComposerAttachments } from "./attachments/composerAttachments";
import type { useComposerState } from "./composerState";
import type { ComposerWorkspaceCapabilities } from "./composerWorkspaceCapabilities";
import { useQueueEditActions } from "./queueEdit";
import { useComposerControlActions } from "./settings";
import type { ComposerMenuPage } from "./composerTypes";

export function useComposerCommands({
  attachmentsInputs,
  composerInputs,
  composerScope,
  composerStateBinding,
  conversationOwner,
  draftConnectionId,
  draftThreadId,
  fileTransferController,
  getStableTransferAccess,
  openToolRoute,
  overlayScrollOwnershipBinding,
  queueInputs,
  queueVisibilityBinding,
  voiceController,
}: {
  attachmentsInputs: {
    getTransferAccess: Parameters<typeof useComposerAttachments>[0]["getTransferAccess"];
  };
  composerInputs: ComposerWorkspaceCapabilities;
  composerScope: string;
  composerStateBinding: ReturnType<typeof useComposerState>;
  conversationOwner: ReturnType<typeof useConversationOwner>;
  draftConnectionId: string | null;
  draftThreadId: string | null;
  fileTransferController: Parameters<typeof useComposerAttachments>[0]["fileTransferController"];
  getStableTransferAccess: Parameters<typeof useComposerAttachments>[0]["getStableTransferAccess"];
  openToolRoute: (
    page: ComposerMenuPage,
    queueEdit: ReturnType<typeof useQueueEditActions>,
  ) => void;
  overlayScrollOwnershipBinding: { dismissComposerKeyboardForOverlay: () => void };
  queueInputs: QueueWorkspaceCapabilities;
  queueVisibilityBinding: { closeInlineQueueOverlay: () => void };
  voiceController: ComposerWorkspaceCapabilities["voiceController"];
}) {
  const queueEditActionsBinding = useQueueEditActions({
    closeInlineQueueOverlay: queueVisibilityBinding.closeInlineQueueOverlay,
    composerInputRef: composerStateBinding.composerEditingBinding.composerInputRef,
    composerMarkdownRef: composerStateBinding.composerEditingBinding.composerMarkdownRef,
    composerUploadScope: composerStateBinding.composerEditingBinding.composerUploadScope,
    conversationOwner,
    draftSelectionRef: composerStateBinding.composerEditingBinding.draftSelectionRef,
    latestAttachmentsRef: composerStateBinding.composerEditingBinding.latestAttachmentsRef,
    onEditQueued: queueInputs.onEditQueued,
    onListQueue: queueInputs.onListQueue,
    queuedComposerEdit: composerStateBinding.queueEditStateBinding.queuedComposerEdit,
    queuedComposerEditBusy: composerStateBinding.queueEditStateBinding.queuedComposerEditBusy,
    setQueuedComposerEdit: composerStateBinding.queueEditStateBinding.setQueuedComposerEdit,
    setQueuedComposerEditBusy: composerStateBinding.queueEditStateBinding.setQueuedComposerEditBusy,
    setQueuedComposerEditError:
      composerStateBinding.queueEditStateBinding.setQueuedComposerEditError,
    uploadsBlockSend: composerStateBinding.composerEditingBinding.uploadsBlockSend,
    voicePhase: composerStateBinding.composerVoiceStateBinding.voicePhase,
  });
  const composerControlActionsBinding = useComposerControlActions({
    closeInlineQueueOverlay: queueVisibilityBinding.closeInlineQueueOverlay,
    currentControlsResource: composerStateBinding.composerEditingBinding.currentControlsResource,
    dismissComposerKeyboardForOverlay:
      overlayScrollOwnershipBinding.dismissComposerKeyboardForOverlay,
    openToolRoute: (page) => {
      openToolRoute(page, queueEditActionsBinding);
    },
    requestControls: composerStateBinding.composerEditingBinding.requestControls,
    setComposerTrayVisible: composerStateBinding.composerMenuStateBinding.setComposerTrayVisible,
  });
  const composerAttachmentsBinding = useComposerAttachments({
    attachmentCount: composerStateBinding.composerEditingBinding.attachmentCount,
    captureDraftMutations: composerStateBinding.composerEditingBinding.captureDraftMutations,
    composerScope,
    composerUploadScope: composerStateBinding.composerEditingBinding.composerUploadScope,
    contentReviewAttachmentId:
      composerStateBinding.reviewAttachmentIdsBinding.contentReviewAttachmentId,
    dismissComposerKeyboardForOverlay:
      overlayScrollOwnershipBinding.dismissComposerKeyboardForOverlay,
    draftConnectionId,
    draftSelectionRef: composerStateBinding.composerEditingBinding.draftSelectionRef,
    draftThreadId,
    fileTransferController,
    getStableTransferAccess,
    getTransferAccess: attachmentsInputs.getTransferAccess,
    largePasteOperationRef: composerStateBinding.largePasteStateBinding.largePasteOperationRef,
    latestAttachmentsRef: composerStateBinding.composerEditingBinding.latestAttachmentsRef,
    latestDraftRef: composerStateBinding.composerEditingBinding.latestDraftRef,
    pastedAttachmentPendingRef:
      composerStateBinding.largePasteStateBinding.pastedAttachmentPendingRef,
    queuedComposerEdit: composerStateBinding.queueEditStateBinding.queuedComposerEdit,
    removeDraftAttachment: composerInputs.removeDraftAttachment,
    setComposerTrayVisible: composerStateBinding.composerMenuStateBinding.setComposerTrayVisible,
    setContentReviewAttachmentId:
      composerStateBinding.reviewAttachmentIdsBinding.setContentReviewAttachmentId,
    setPastedAttachmentPending:
      composerStateBinding.largePasteStateBinding.setPastedAttachmentPending,
    updateAttachments: composerStateBinding.composerEditingBinding.updateAttachments,
    upsertDraftAttachment: composerInputs.upsertDraftAttachment,
    voiceController,
  });
  return { composerAttachmentsBinding, composerControlActionsBinding, queueEditActionsBinding };
}
