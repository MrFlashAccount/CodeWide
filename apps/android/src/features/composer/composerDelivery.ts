import { useComposerDeliveryActions, useComposerSubmission } from "./submission";
import { useVoiceBinding } from "./voice";
/** Composes the existing ComposerDelivery owners without adding state or lifecycle policy. */
export function useComposerDelivery({
  composerScope,
  composerUploadScope,
  latestAttachmentsRef,
  latestDraftRef,
  latestComposerPreferencesRef,
  composerMarkdownRef,
  selectedModel,
  selectedEffort,
  selectedPersonality,
  selectedPermissions,
  capturePreferenceUpdate,
  captureControlsResource,
  queuedComposerEdit,
  pastedAttachmentPendingRef,
  captureDraftMutations,
  threadLifecycleActive,
  currentTurnId,
  contentReviewAttachmentId,
  clearContentReviewAttachmentId,
  conversationOwner,
  draftConnectionId,
  draftThreadId,
  onSend,
  onListQueue,
  saveDraft,
  saveDraftAttachments,
  voiceController,
  draft,
  draftSelectionRef,
  remoteThread,
  onStartVoiceTranscription,
  queuedComposerEditBusy,
  voicePhase,
  attachments,
  onEditQueued,
  pastedAttachmentPending,
  uploadsBlockSend,
  voiceRetryAvailable,
  voiceError,
  cancelQueuedComposerEdit,
  clearComposerText,
  saveQueuedComposerEdit,
  onInterrupt,
}: {
  composerScope: Parameters<typeof useVoiceBinding>[0]["composerScope"];
  composerUploadScope: Parameters<typeof useComposerSubmission>[0]["composerUploadScope"];
  latestAttachmentsRef: Parameters<typeof useComposerSubmission>[0]["latestAttachmentsRef"];
  latestDraftRef: Parameters<typeof useComposerSubmission>[0]["latestDraftRef"];
  latestComposerPreferencesRef: Parameters<
    typeof useComposerSubmission
  >[0]["latestComposerPreferencesRef"];
  composerMarkdownRef: Parameters<typeof useComposerSubmission>[0]["composerMarkdownRef"];
  selectedModel: Parameters<typeof useComposerSubmission>[0]["selectedModel"];
  selectedEffort: Parameters<typeof useComposerSubmission>[0]["selectedEffort"];
  selectedPersonality: Parameters<typeof useComposerSubmission>[0]["selectedPersonality"];
  selectedPermissions: Parameters<typeof useComposerSubmission>[0]["selectedPermissions"];
  capturePreferenceUpdate: Parameters<typeof useComposerSubmission>[0]["capturePreferenceUpdate"];
  captureControlsResource: Parameters<typeof useComposerSubmission>[0]["captureControlsResource"];
  queuedComposerEdit: Parameters<typeof useComposerDeliveryActions>[0]["queuedComposerEdit"];
  pastedAttachmentPendingRef: Parameters<
    typeof useComposerSubmission
  >[0]["pastedAttachmentPendingRef"];
  captureDraftMutations: Parameters<typeof useVoiceBinding>[0]["captureDraftMutations"];
  threadLifecycleActive: Parameters<typeof useComposerDeliveryActions>[0]["threadLifecycleActive"];
  currentTurnId: Parameters<typeof useComposerDeliveryActions>[0]["currentTurnId"];
  contentReviewAttachmentId: Parameters<
    typeof useComposerSubmission
  >[0]["contentReviewAttachmentId"];
  clearContentReviewAttachmentId: Parameters<
    typeof useComposerSubmission
  >[0]["clearContentReviewAttachmentId"];
  conversationOwner: Parameters<typeof useComposerSubmission>[0]["conversationOwner"];
  draftConnectionId: Parameters<typeof useComposerSubmission>[0]["draftConnectionId"];
  draftThreadId: Parameters<typeof useComposerSubmission>[0]["draftThreadId"];
  onSend: Parameters<typeof useComposerSubmission>[0]["onSend"];
  onListQueue: Parameters<typeof useComposerSubmission>[0]["onListQueue"];
  saveDraft: Parameters<typeof useComposerSubmission>[0]["saveDraft"];
  saveDraftAttachments: Parameters<typeof useComposerSubmission>[0]["saveDraftAttachments"];
  voiceController: Parameters<typeof useVoiceBinding>[0]["voiceController"];
  draft: Parameters<typeof useComposerDeliveryActions>[0]["draft"];
  draftSelectionRef: Parameters<typeof useVoiceBinding>[0]["draftSelectionRef"];
  remoteThread: Parameters<typeof useVoiceBinding>[0]["remoteThread"];
  onStartVoiceTranscription: Parameters<typeof useVoiceBinding>[0]["onStartVoiceTranscription"];
  queuedComposerEditBusy: Parameters<
    typeof useComposerDeliveryActions
  >[0]["queuedComposerEditBusy"];
  voicePhase: Parameters<typeof useComposerDeliveryActions>[0]["voicePhase"];
  attachments: Parameters<typeof useComposerDeliveryActions>[0]["attachments"];
  onEditQueued: Parameters<typeof useComposerDeliveryActions>[0]["onEditQueued"];
  pastedAttachmentPending: Parameters<
    typeof useComposerDeliveryActions
  >[0]["pastedAttachmentPending"];
  uploadsBlockSend: Parameters<typeof useComposerDeliveryActions>[0]["uploadsBlockSend"];
  voiceRetryAvailable: Parameters<typeof useComposerDeliveryActions>[0]["voiceRetryAvailable"];
  voiceError: Parameters<typeof useComposerDeliveryActions>[0]["voiceError"];
  cancelQueuedComposerEdit: Parameters<
    typeof useComposerDeliveryActions
  >[0]["cancelQueuedComposerEdit"];
  clearComposerText: Parameters<typeof useComposerDeliveryActions>[0]["clearComposerText"];
  saveQueuedComposerEdit: Parameters<
    typeof useComposerDeliveryActions
  >[0]["saveQueuedComposerEdit"];
  onInterrupt: Parameters<typeof useComposerDeliveryActions>[0]["onInterrupt"];
}) {
  const { send, captureSend } = useComposerSubmission({
    composerScope,
    composerUploadScope,
    latestAttachmentsRef,
    latestDraftRef,
    latestComposerPreferencesRef,
    composerMarkdownRef,
    selectedModel,
    selectedEffort,
    selectedPersonality,
    selectedPermissions,
    capturePreferenceUpdate,
    captureControlsResource,
    queuedComposerEdit,
    pastedAttachmentPendingRef,
    captureDraftMutations,
    threadLifecycleActive,
    currentTurnId,
    contentReviewAttachmentId,
    clearContentReviewAttachmentId,
    conversationOwner,
    draftConnectionId,
    draftThreadId,
    onSend,
    onListQueue,
    saveDraft,
    saveDraftAttachments,
  });
  const { microphoneAccess, finishVoice, retryVoice, toggleVoice, discardVoice } = useVoiceBinding({
    captureDraftMutations,
    captureSend,
    voiceController,
    composerScope,
    draft,
    draftSelectionRef,
    remoteThread,
    onStartVoiceTranscription,
  });
  const {
    deliveryActions,
    handleDeliveryAction,
    editingQueuedMessage,
    stoppingResponse,
    sendDisabled,
    composerDiscardEnabled,
    discardComposer,
    activatePrimaryAction,
    steerComposer,
  } = useComposerDeliveryActions({
    queuedComposerEdit,
    queuedComposerEditBusy,
    voicePhase,
    finishVoice,
    send,
    currentTurnId,
    draft,
    attachments,
    onEditQueued,
    pastedAttachmentPending,
    uploadsBlockSend,
    voiceRetryAvailable,
    voiceError,
    cancelQueuedComposerEdit,
    discardVoice,
    clearComposerText,
    saveQueuedComposerEdit,
    onInterrupt,
    threadLifecycleActive,
  });
  return {
    editingQueuedMessage,
    retryVoice,
    toggleVoice,
    finishVoice,
    microphoneAccess,
    sendDisabled,
    composerDiscardEnabled,
    discardComposer,
    steerComposer,
    activatePrimaryAction,
    deliveryActions,
    handleDeliveryAction,
    stoppingResponse,
  };
}
