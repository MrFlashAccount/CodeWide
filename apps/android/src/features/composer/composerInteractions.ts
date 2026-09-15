import { useConversationOwner } from "../../ui/use-conversation-owner";
import { useGoalDetails } from "../goal/GoalFeature";
import type { QueueWorkspaceCapabilities } from "../queue/queueWorkspaceCapabilities";
import { useComposerAccessoryActions } from "./ComposerAccessoryTray";
import { useComposerCommands } from "./composerCommands";
import { useComposerDelivery } from "./composerDelivery";
import { useComposerFeatureActions } from "./composerFeatureActions";
import { useComposerState } from "./composerState";
import type { ComposerWorkspaceCapabilities } from "./composerWorkspaceCapabilities";

export function useComposerInteractions({
  composerCommands,
  openDrawing,
  createAndOpenTerminal,
  onGetGoal,
  newChat,
  draftConnectionId,
  draftThreadId,
  portForwardingConnectionId,
  composerStateBinding,
  composerScope,
  threadLifecycleActive,
  currentTurnId,
  conversationOwner,
  composerInputs,
  queueInputs,
  voiceController,
  remoteThread,
}: {
  composerCommands: ReturnType<typeof useComposerCommands>;
  openDrawing: Parameters<typeof useComposerFeatureActions>[1];
  createAndOpenTerminal: Parameters<typeof useComposerFeatureActions>[2];
  onGetGoal: Parameters<typeof useComposerFeatureActions>[4];
  newChat: boolean;
  draftConnectionId: string | null;
  draftThreadId: string | null;
  portForwardingConnectionId: string | null;
  composerStateBinding: ReturnType<typeof useComposerState>;
  composerScope: string;
  threadLifecycleActive: boolean;
  currentTurnId: string | null;
  conversationOwner: ReturnType<typeof useConversationOwner>;
  composerInputs: ComposerWorkspaceCapabilities;
  queueInputs: QueueWorkspaceCapabilities;
  voiceController: ComposerWorkspaceCapabilities["voiceController"];
  remoteThread: Parameters<typeof useComposerDelivery>[0]["remoteThread"];
}) {
  const composerFeatureActionsBinding = useComposerFeatureActions(
    composerCommands.composerAttachmentsBinding.pickComposerAttachment,
    openDrawing,
    createAndOpenTerminal,
    composerCommands.composerControlActionsBinding.openControls,
    onGetGoal,
  );
  const composerAccessoryActionsBinding = useComposerAccessoryActions({
    fileAttachmentEnabled: composerCommands.composerAttachmentsBinding.fileAttachmentEnabled,
    newChat,
    draftConnectionId,
    draftThreadId,
    portForwardingConnectionId,
    setComposerTrayVisible: composerStateBinding.composerMenuStateBinding.setComposerTrayVisible,
    openComposerFeature: composerFeatureActionsBinding.openComposerFeature,
  });
  const openGoalDetails = useGoalDetails(composerAccessoryActionsBinding.openAccessoryAction);
  const composerDeliveryBinding = useComposerDelivery({
    composerScope,
    composerUploadScope: composerStateBinding.composerEditingBinding.composerUploadScope,
    latestAttachmentsRef: composerStateBinding.composerEditingBinding.latestAttachmentsRef,
    latestDraftRef: composerStateBinding.composerEditingBinding.latestDraftRef,
    latestComposerPreferencesRef:
      composerStateBinding.composerEditingBinding.latestComposerPreferencesRef,
    composerMarkdownRef: composerStateBinding.composerEditingBinding.composerMarkdownRef,
    selectedModel: composerStateBinding.composerEditingBinding.selectedModel,
    selectedEffort: composerStateBinding.composerEditingBinding.selectedEffort,
    selectedPersonality: composerStateBinding.composerEditingBinding.selectedPersonality,
    selectedPermissions: composerStateBinding.composerEditingBinding.selectedPermissions,
    capturePreferenceUpdate: composerStateBinding.composerEditingBinding.capturePreferenceUpdate,
    captureControlsResource: composerStateBinding.composerEditingBinding.captureControlsResource,
    queuedComposerEdit: composerStateBinding.queueEditStateBinding.queuedComposerEdit,
    pastedAttachmentPendingRef:
      composerStateBinding.largePasteStateBinding.pastedAttachmentPendingRef,
    captureDraftMutations: composerStateBinding.composerEditingBinding.captureDraftMutations,
    threadLifecycleActive: threadLifecycleActive,
    currentTurnId: currentTurnId,
    contentReviewAttachmentId:
      composerStateBinding.reviewAttachmentIdsBinding.contentReviewAttachmentId,
    clearContentReviewAttachmentId:
      composerStateBinding.reviewAttachmentIdsBinding.clearContentReviewAttachmentId,
    conversationOwner,
    draftConnectionId,
    draftThreadId,
    onSend: composerInputs.onSend,
    onListQueue: queueInputs.onListQueue,
    saveDraft: composerInputs.saveDraft,
    saveDraftAttachments: composerInputs.saveDraftAttachments,
    voiceController,
    draft: composerStateBinding.composerEditingBinding.draft,
    draftSelectionRef: composerStateBinding.composerEditingBinding.draftSelectionRef,
    remoteThread: remoteThread,
    onStartVoiceTranscription: composerInputs.onStartVoiceTranscription,
    queuedComposerEditBusy: composerStateBinding.queueEditStateBinding.queuedComposerEditBusy,
    voicePhase: composerStateBinding.composerVoiceStateBinding.voicePhase,
    attachments: composerStateBinding.composerEditingBinding.attachments,
    onEditQueued: queueInputs.onEditQueued,
    pastedAttachmentPending: composerStateBinding.largePasteStateBinding.pastedAttachmentPending,
    uploadsBlockSend: composerStateBinding.composerEditingBinding.uploadsBlockSend,
    voiceRetryAvailable: composerStateBinding.composerVoiceStateBinding.voiceRetryAvailable,
    voiceError: composerStateBinding.composerVoiceStateBinding.voiceError,
    cancelQueuedComposerEdit: composerCommands.queueEditActionsBinding.cancelQueuedComposerEdit,
    clearComposerText: composerStateBinding.composerEditingBinding.clearComposerText,
    saveQueuedComposerEdit: composerCommands.queueEditActionsBinding.saveQueuedComposerEdit,
    onInterrupt: composerInputs.onInterrupt,
  });
  return { openGoalDetails, composerAccessoryActionsBinding, composerDeliveryBinding };
}
