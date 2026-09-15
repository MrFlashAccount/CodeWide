import { useConversationOwner } from "../../ui/use-conversation-owner";
import type { QueueWorkspaceCapabilities } from "../queue/queueWorkspaceCapabilities";
import { useComposerAttachments } from "./attachments/composerAttachments";
import { useComposerState } from "./composerState";
import type { ComposerWorkspaceCapabilities } from "./composerWorkspaceCapabilities";
import { useQueueEditActions } from "./queueEdit";
import { useComposerControlActions } from "./settings";
export function useComposerCommands({
  composerStateBinding,
  queueVisibilityBinding,
  queueInputs,
  conversationOwner,
  overlayScrollOwnershipBinding,
  composerScope,
  draftConnectionId,
  draftThreadId,
  attachmentsInputs,
  getStableTransferAccess,
  composerInputs,
  fileTransferController,
  voiceController,
}: {
  composerStateBinding: ReturnType<typeof useComposerState>;
  queueVisibilityBinding: { closeInlineQueueOverlay(): void };
  queueInputs: QueueWorkspaceCapabilities;
  conversationOwner: ReturnType<typeof useConversationOwner>;
  overlayScrollOwnershipBinding: { dismissComposerKeyboardForOverlay(): void };
  composerScope: string;
  draftConnectionId: string | null;
  draftThreadId: string | null;
  attachmentsInputs: {
    getTransferAccess: Parameters<typeof useComposerAttachments>[0]["getTransferAccess"];
  };
  getStableTransferAccess: Parameters<typeof useComposerAttachments>[0]["getStableTransferAccess"];
  composerInputs: ComposerWorkspaceCapabilities;
  fileTransferController: Parameters<typeof useComposerAttachments>[0]["fileTransferController"];
  voiceController: ComposerWorkspaceCapabilities["voiceController"];
}) {
  const queueEditActionsBinding = useQueueEditActions({
    queuedComposerEdit: composerStateBinding.queueEditStateBinding.queuedComposerEdit,
    setQueuedComposerEdit: composerStateBinding.queueEditStateBinding.setQueuedComposerEdit,
    queuedComposerEditBusy: composerStateBinding.queueEditStateBinding.queuedComposerEditBusy,
    setQueuedComposerEditBusy: composerStateBinding.queueEditStateBinding.setQueuedComposerEditBusy,
    setQueuedComposerEditError:
      composerStateBinding.queueEditStateBinding.setQueuedComposerEditError,
    composerUploadScope: composerStateBinding.composerEditingBinding.composerUploadScope,
    draftSelectionRef: composerStateBinding.composerEditingBinding.draftSelectionRef,
    composerInputRef: composerStateBinding.composerEditingBinding.composerInputRef,
    composerMarkdownRef: composerStateBinding.composerEditingBinding.composerMarkdownRef,
    latestAttachmentsRef: composerStateBinding.composerEditingBinding.latestAttachmentsRef,
    uploadsBlockSend: composerStateBinding.composerEditingBinding.uploadsBlockSend,
    voicePhase: composerStateBinding.composerVoiceStateBinding.voicePhase,
    closeInlineQueueOverlay: queueVisibilityBinding.closeInlineQueueOverlay,
    setMenuVisible: composerStateBinding.composerMenuStateBinding.setMenuVisible,
    onEditQueued: queueInputs.onEditQueued,
    onListQueue: queueInputs.onListQueue,
    conversationOwner,
  });
  const composerControlActionsBinding = useComposerControlActions({
    closeInlineQueueOverlay: queueVisibilityBinding.closeInlineQueueOverlay,
    setComposerTrayVisible: composerStateBinding.composerMenuStateBinding.setComposerTrayVisible,
    dismissComposerKeyboardForOverlay:
      overlayScrollOwnershipBinding.dismissComposerKeyboardForOverlay,
    setMenuInitialPage: composerStateBinding.composerMenuStateBinding.setMenuInitialPage,
    setMenuVisible: composerStateBinding.composerMenuStateBinding.setMenuVisible,
    currentControlsResource: composerStateBinding.composerEditingBinding.currentControlsResource,
    requestControls: composerStateBinding.composerEditingBinding.requestControls,
  });
  const composerAttachmentsBinding = useComposerAttachments({
    composerScope,
    composerUploadScope: composerStateBinding.composerEditingBinding.composerUploadScope,
    draftConnectionId,
    draftThreadId,
    getTransferAccess: attachmentsInputs.getTransferAccess,
    getStableTransferAccess,
    queuedComposerEdit: composerStateBinding.queueEditStateBinding.queuedComposerEdit,
    upsertDraftAttachment: composerInputs.upsertDraftAttachment,
    latestAttachmentsRef: composerStateBinding.composerEditingBinding.latestAttachmentsRef,
    captureDraftMutations: composerStateBinding.composerEditingBinding.captureDraftMutations,
    fileTransferController,
    attachmentCount: composerStateBinding.composerEditingBinding.attachmentCount,
    setComposerTrayVisible: composerStateBinding.composerMenuStateBinding.setComposerTrayVisible,
    dismissComposerKeyboardForOverlay:
      overlayScrollOwnershipBinding.dismissComposerKeyboardForOverlay,
    contentReviewAttachmentId:
      composerStateBinding.reviewAttachmentIdsBinding.contentReviewAttachmentId,
    setContentReviewAttachmentId:
      composerStateBinding.reviewAttachmentIdsBinding.setContentReviewAttachmentId,
    latestDraftRef: composerStateBinding.composerEditingBinding.latestDraftRef,
    draftSelectionRef: composerStateBinding.composerEditingBinding.draftSelectionRef,
    voiceController,
    setPastedAttachmentPending:
      composerStateBinding.largePasteStateBinding.setPastedAttachmentPending,
    pastedAttachmentPendingRef:
      composerStateBinding.largePasteStateBinding.pastedAttachmentPendingRef,
    largePasteOperationRef: composerStateBinding.largePasteStateBinding.largePasteOperationRef,
    updateAttachments: composerStateBinding.composerEditingBinding.updateAttachments,
    removeDraftAttachment: composerInputs.removeDraftAttachment,
  });
  return { composerAttachmentsBinding, composerControlActionsBinding, queueEditActionsBinding };
}
