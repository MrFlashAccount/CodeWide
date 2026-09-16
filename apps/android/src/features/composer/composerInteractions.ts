import type { useConversationOwner } from "../../ui/use-conversation-owner";
import { useGoalDetails } from "../goal/GoalFeature";
import type { QueueWorkspaceCapabilities } from "../queue/queueWorkspaceCapabilities";
import { useComposerAccessoryActions } from "./ComposerAccessoryTray";
import type { useComposerCommands } from "./composerCommands";
import { useComposerDelivery } from "./composerDelivery";
import { useComposerFeatureActions } from "./composerFeatureActions";
import type { useComposerState } from "./composerState";
import type { ComposerWorkspaceCapabilities } from "./composerWorkspaceCapabilities";

export function useComposerInteractions({
  composerCommands,
  composerInputs,
  composerScope,
  composerStateBinding,
  conversationOwner,
  currentTurnId,
  draftConnectionId,
  draftThreadId,
  goalEnabled,
  openDrawing,
  queueInputs,
  remoteThread,
  threadLifecycleActive,
  voiceController,
}: {
  composerCommands: ReturnType<typeof useComposerCommands>;
  composerInputs: ComposerWorkspaceCapabilities;
  composerScope: string;
  composerStateBinding: ReturnType<typeof useComposerState>;
  conversationOwner: ReturnType<typeof useConversationOwner>;
  currentTurnId: string | null;
  draftConnectionId: string | null;
  draftThreadId: string | null;
  goalEnabled: boolean;
  openDrawing: Parameters<typeof useComposerFeatureActions>[1];
  queueInputs: QueueWorkspaceCapabilities;
  remoteThread: Parameters<typeof useComposerDelivery>[0]["remoteThread"];
  threadLifecycleActive: boolean;
  voiceController: ComposerWorkspaceCapabilities["voiceController"];
}) {
  const composerFeatureActionsBinding = useComposerFeatureActions(
    composerCommands.composerAttachmentsBinding.pickComposerAttachment,
    openDrawing,
    composerCommands.composerControlActionsBinding.openControls,
    composerStateBinding.composerMenuStateBinding.openGoalAttachment,
  );
  const composerAccessoryActionsBinding = useComposerAccessoryActions({
    fileAttachmentEnabled: composerCommands.composerAttachmentsBinding.fileAttachmentEnabled,
    goalEnabled,
    openComposerFeature: composerFeatureActionsBinding.openComposerFeature,
    setComposerTrayVisible: composerStateBinding.composerMenuStateBinding.setComposerTrayVisible,
  });
  const openGoalDetails = useGoalDetails(composerAccessoryActionsBinding.openAccessoryAction);
  const composerDeliveryBinding = useComposerDelivery({
    attachments: composerStateBinding.composerEditingBinding.attachments,
    cancelQueuedComposerEdit: composerCommands.queueEditActionsBinding.cancelQueuedComposerEdit,
    captureControlsResource: composerStateBinding.composerEditingBinding.captureControlsResource,
    captureDraftMutations: composerStateBinding.composerEditingBinding.captureDraftMutations,
    capturePreferenceUpdate: composerStateBinding.composerEditingBinding.capturePreferenceUpdate,
    clearComposerText: composerStateBinding.composerEditingBinding.clearComposerText,
    clearContentReviewAttachmentId:
      composerStateBinding.reviewAttachmentIdsBinding.clearContentReviewAttachmentId,
    composerMarkdownRef: composerStateBinding.composerEditingBinding.composerMarkdownRef,
    composerScope,
    composerUploadScope: composerStateBinding.composerEditingBinding.composerUploadScope,
    contentReviewAttachmentId:
      composerStateBinding.reviewAttachmentIdsBinding.contentReviewAttachmentId,
    conversationOwner,
    currentTurnId: currentTurnId,
    draft: composerStateBinding.composerEditingBinding.draft,
    draftConnectionId,
    draftSelectionRef: composerStateBinding.composerEditingBinding.draftSelectionRef,
    draftThreadId,
    latestAttachmentsRef: composerStateBinding.composerEditingBinding.latestAttachmentsRef,
    latestComposerPreferencesRef:
      composerStateBinding.composerEditingBinding.latestComposerPreferencesRef,
    latestDraftRef: composerStateBinding.composerEditingBinding.latestDraftRef,
    onEditQueued: queueInputs.onEditQueued,
    onInterrupt: composerInputs.onInterrupt,
    onListQueue: queueInputs.onListQueue,
    onSend: composerInputs.onSend,
    onStartVoiceTranscription: composerInputs.onStartVoiceTranscription,
    pastedAttachmentPending: composerStateBinding.largePasteStateBinding.pastedAttachmentPending,
    pastedAttachmentPendingRef:
      composerStateBinding.largePasteStateBinding.pastedAttachmentPendingRef,
    queuedComposerEdit: composerStateBinding.queueEditStateBinding.queuedComposerEdit,
    queuedComposerEditBusy: composerStateBinding.queueEditStateBinding.queuedComposerEditBusy,
    remoteThread: remoteThread,
    saveDraft: composerInputs.saveDraft,
    saveDraftAttachments: composerInputs.saveDraftAttachments,
    saveQueuedComposerEdit: composerCommands.queueEditActionsBinding.saveQueuedComposerEdit,
    selectedEffort: composerStateBinding.composerEditingBinding.selectedEffort,
    selectedModel: composerStateBinding.composerEditingBinding.selectedModel,
    selectedPermissions: composerStateBinding.composerEditingBinding.selectedPermissions,
    selectedPersonality: composerStateBinding.composerEditingBinding.selectedPersonality,
    threadLifecycleActive: threadLifecycleActive,
    uploadsBlockSend: composerStateBinding.composerEditingBinding.uploadsBlockSend,
    voiceController,
    voiceError: composerStateBinding.composerVoiceStateBinding.voiceError,
    voicePhase: composerStateBinding.composerVoiceStateBinding.voicePhase,
    voiceRetryAvailable: composerStateBinding.composerVoiceStateBinding.voiceRetryAvailable,
  });
  return { composerAccessoryActionsBinding, composerDeliveryBinding, openGoalDetails };
}
