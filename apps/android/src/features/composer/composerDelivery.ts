import { useComposerDeliveryActions, useComposerSubmission } from "./submission";
import { useVoiceBinding } from "./voice";
/** Composes the existing ComposerDelivery owners without adding state or lifecycle policy. */
export function useComposerDelivery({
  attachments,
  cancelQueuedComposerEdit,
  captureControlsResource,
  captureDraftMutations,
  capturePreferenceUpdate,
  clearComposerText,
  clearContentReviewAttachmentId,
  composerMarkdownRef,
  composerScope,
  composerUploadScope,
  contentReviewAttachmentId,
  conversationOwner,
  currentTurnId,
  draft,
  draftConnectionId,
  draftSelectionRef,
  draftThreadId,
  latestAttachmentsRef,
  latestComposerPreferencesRef,
  latestDraftRef,
  onEditQueued,
  onInterrupt,
  onListQueue,
  onSend,
  onStartVoiceTranscription,
  pastedAttachmentPending,
  pastedAttachmentPendingRef,
  queuedComposerEdit,
  queuedComposerEditBusy,
  remoteThread,
  saveDraft,
  saveDraftAttachments,
  saveQueuedComposerEdit,
  selectedEffort,
  selectedModel,
  selectedPermissions,
  selectedPersonality,
  threadLifecycleActive,
  uploadsBlockSend,
  voiceController,
  voiceError,
  voicePhase,
  voiceRetryAvailable,
}: {
  attachments: Parameters<typeof useComposerDeliveryActions>[0]["attachments"];
  cancelQueuedComposerEdit: Parameters<
    typeof useComposerDeliveryActions
  >[0]["cancelQueuedComposerEdit"];
  captureControlsResource: Parameters<typeof useComposerSubmission>[0]["captureControlsResource"];
  captureDraftMutations: Parameters<typeof useVoiceBinding>[0]["captureDraftMutations"];
  capturePreferenceUpdate: Parameters<typeof useComposerSubmission>[0]["capturePreferenceUpdate"];
  clearComposerText: Parameters<typeof useComposerDeliveryActions>[0]["clearComposerText"];
  clearContentReviewAttachmentId: Parameters<
    typeof useComposerSubmission
  >[0]["clearContentReviewAttachmentId"];
  composerMarkdownRef: Parameters<typeof useComposerSubmission>[0]["composerMarkdownRef"];
  composerScope: Parameters<typeof useVoiceBinding>[0]["composerScope"];
  composerUploadScope: Parameters<typeof useComposerSubmission>[0]["composerUploadScope"];
  contentReviewAttachmentId: Parameters<
    typeof useComposerSubmission
  >[0]["contentReviewAttachmentId"];
  conversationOwner: Parameters<typeof useComposerSubmission>[0]["conversationOwner"];
  currentTurnId: Parameters<typeof useComposerDeliveryActions>[0]["currentTurnId"];
  draft: Parameters<typeof useComposerDeliveryActions>[0]["draft"];
  draftConnectionId: Parameters<typeof useComposerSubmission>[0]["draftConnectionId"];
  draftSelectionRef: Parameters<typeof useVoiceBinding>[0]["draftSelectionRef"];
  draftThreadId: Parameters<typeof useComposerSubmission>[0]["draftThreadId"];
  latestAttachmentsRef: Parameters<typeof useComposerSubmission>[0]["latestAttachmentsRef"];
  latestComposerPreferencesRef: Parameters<
    typeof useComposerSubmission
  >[0]["latestComposerPreferencesRef"];
  latestDraftRef: Parameters<typeof useComposerSubmission>[0]["latestDraftRef"];
  onEditQueued: Parameters<typeof useComposerDeliveryActions>[0]["onEditQueued"];
  onInterrupt: Parameters<typeof useComposerDeliveryActions>[0]["onInterrupt"];
  onListQueue: Parameters<typeof useComposerSubmission>[0]["onListQueue"];
  onSend: Parameters<typeof useComposerSubmission>[0]["onSend"];
  onStartVoiceTranscription: Parameters<typeof useVoiceBinding>[0]["onStartVoiceTranscription"];
  pastedAttachmentPending: Parameters<
    typeof useComposerDeliveryActions
  >[0]["pastedAttachmentPending"];
  pastedAttachmentPendingRef: Parameters<
    typeof useComposerSubmission
  >[0]["pastedAttachmentPendingRef"];
  queuedComposerEdit: Parameters<typeof useComposerDeliveryActions>[0]["queuedComposerEdit"];
  queuedComposerEditBusy: Parameters<
    typeof useComposerDeliveryActions
  >[0]["queuedComposerEditBusy"];
  remoteThread: Parameters<typeof useVoiceBinding>[0]["remoteThread"];
  saveDraft: Parameters<typeof useComposerSubmission>[0]["saveDraft"];
  saveDraftAttachments: Parameters<typeof useComposerSubmission>[0]["saveDraftAttachments"];
  saveQueuedComposerEdit: Parameters<
    typeof useComposerDeliveryActions
  >[0]["saveQueuedComposerEdit"];
  selectedEffort: Parameters<typeof useComposerSubmission>[0]["selectedEffort"];
  selectedModel: Parameters<typeof useComposerSubmission>[0]["selectedModel"];
  selectedPermissions: Parameters<typeof useComposerSubmission>[0]["selectedPermissions"];
  selectedPersonality: Parameters<typeof useComposerSubmission>[0]["selectedPersonality"];
  threadLifecycleActive: Parameters<typeof useComposerDeliveryActions>[0]["threadLifecycleActive"];
  uploadsBlockSend: Parameters<typeof useComposerDeliveryActions>[0]["uploadsBlockSend"];
  voiceController: Parameters<typeof useVoiceBinding>[0]["voiceController"];
  voiceError: Parameters<typeof useComposerDeliveryActions>[0]["voiceError"];
  voicePhase: Parameters<typeof useComposerDeliveryActions>[0]["voicePhase"];
  voiceRetryAvailable: Parameters<typeof useComposerDeliveryActions>[0]["voiceRetryAvailable"];
}) {
  const { captureSend, send } = useComposerSubmission({
    captureControlsResource,
    captureDraftMutations,
    capturePreferenceUpdate,
    clearContentReviewAttachmentId,
    composerMarkdownRef,
    composerScope,
    composerUploadScope,
    contentReviewAttachmentId,
    conversationOwner,
    currentTurnId,
    draftConnectionId,
    draftThreadId,
    latestAttachmentsRef,
    latestComposerPreferencesRef,
    latestDraftRef,
    onListQueue,
    onSend,
    pastedAttachmentPendingRef,
    queuedComposerEdit,
    saveDraft,
    saveDraftAttachments,
    selectedEffort,
    selectedModel,
    selectedPermissions,
    selectedPersonality,
    threadLifecycleActive,
  });
  const { discardVoice, finishVoice, microphoneAccess, retryVoice, toggleVoice } = useVoiceBinding({
    captureDraftMutations,
    captureSend,
    composerScope,
    draft,
    draftSelectionRef,
    onStartVoiceTranscription,
    remoteThread,
    voiceController,
  });
  const {
    activatePrimaryAction,
    composerDiscardEnabled,
    deliveryActions,
    discardComposer,
    editingQueuedMessage,
    handleDeliveryAction,
    sendDisabled,
    steerComposer,
    stoppingResponse,
  } = useComposerDeliveryActions({
    attachments,
    cancelQueuedComposerEdit,
    clearComposerText,
    currentTurnId,
    discardVoice,
    draft,
    finishVoice,
    onEditQueued,
    onInterrupt,
    pastedAttachmentPending,
    queuedComposerEdit,
    queuedComposerEditBusy,
    saveQueuedComposerEdit,
    send,
    threadLifecycleActive,
    uploadsBlockSend,
    voiceError,
    voicePhase,
    voiceRetryAvailable,
  });
  return {
    activatePrimaryAction,
    composerDiscardEnabled,
    deliveryActions,
    discardComposer,
    editingQueuedMessage,
    finishVoice,
    handleDeliveryAction,
    microphoneAccess,
    retryVoice,
    sendDisabled,
    steerComposer,
    stoppingResponse,
    toggleVoice,
  };
}
