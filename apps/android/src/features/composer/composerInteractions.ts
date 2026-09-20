import type { useConversationOwner } from "../../ui/use-conversation-owner";
import type { ConversationGoalCapabilities } from "../goal/conversationGoalCapabilities";
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
  createAndOpenTerminal,
  currentTurnId,
  draftConnectionId,
  draftThreadId,
  onSetGoal,
  openDrawing,
  queueInputs,
  remoteThread,
  terminalEnabled,
  threadLifecycleActive,
  voiceController,
}: {
  composerCommands: ReturnType<typeof useComposerCommands>;
  composerInputs: ComposerWorkspaceCapabilities;
  composerScope: string;
  composerStateBinding: ReturnType<typeof useComposerState>;
  conversationOwner: ReturnType<typeof useConversationOwner>;
  createAndOpenTerminal: Parameters<typeof useComposerFeatureActions>[2];
  currentTurnId: string | null;
  draftConnectionId: string | null;
  draftThreadId: string | null;
  onSetGoal: ConversationGoalCapabilities["onSetGoal"];
  openDrawing: Parameters<typeof useComposerFeatureActions>[1];
  queueInputs: QueueWorkspaceCapabilities;
  remoteThread: Parameters<typeof useComposerDelivery>[0]["remoteThread"];
  terminalEnabled: boolean;
  threadLifecycleActive: boolean;
  voiceController: ComposerWorkspaceCapabilities["voiceController"];
}) {
  const composerFeatureActionsBinding = useComposerFeatureActions(
    composerCommands.composerAttachmentsBinding.pickComposerAttachment,
    openDrawing,
    createAndOpenTerminal,
    composerCommands.composerControlActionsBinding.openControls,
    composerStateBinding.composerMenuStateBinding.openGoalAttachment,
    () => {
      composerStateBinding.composerEditingBinding.composerInputRef.current?.focus();
    },
  );
  const composerAccessoryActionsBinding = useComposerAccessoryActions({
    fileAttachmentEnabled: composerCommands.composerAttachmentsBinding.fileAttachmentEnabled,
    goalEnabled: onSetGoal !== undefined,
    openComposerFeature: composerFeatureActionsBinding.openComposerFeature,
    setComposerTrayVisible: composerStateBinding.composerMenuStateBinding.setComposerTrayVisible,
    terminalEnabled,
  });
  const openGoalDetails = useGoalDetails(composerAccessoryActionsBinding.openAccessoryAction);
  const goalSubmission =
    composerStateBinding.composerMenuStateBinding.goalAttachmentVisible && onSetGoal !== undefined
      ? {
          close: composerStateBinding.composerMenuStateBinding.closeGoalAttachment,
          submit: async (objective: string): Promise<void> => {
            await onSetGoal({ objective, status: "active" });
          },
        }
      : null;
  const composerDeliveryBinding = useComposerDelivery({
    attachments: composerStateBinding.composerEditingBinding.attachments,
    cancelQueuedComposerEdit: composerCommands.queueEditActionsBinding.cancelQueuedComposerEdit,
    captureControlsResource: composerStateBinding.composerEditingBinding.captureControlsResource,
    captureDraftMutations: composerStateBinding.composerEditingBinding.captureDraftMutations,
    capturePreferenceUpdate: composerStateBinding.composerEditingBinding.capturePreferenceUpdate,
    clearComposerText: composerStateBinding.composerEditingBinding.clearComposerText,
    clearContentReviewAttachmentId:
      composerStateBinding.reviewAttachmentIdsBinding.clearContentReviewAttachmentId,
    composerInputRef: composerStateBinding.composerEditingBinding.composerInputRef,
    composerScope,
    composerSession: composerStateBinding.composerEditingBinding.composerSession,
    composerUploadScope: composerStateBinding.composerEditingBinding.composerUploadScope,
    contentReviewAttachmentId:
      composerStateBinding.reviewAttachmentIdsBinding.contentReviewAttachmentId,
    conversationOwner,
    currentTurnId: currentTurnId,
    draft: composerStateBinding.composerEditingBinding.draft,
    draftConnectionId,
    draftSelectionRef: composerStateBinding.composerEditingBinding.draftSelectionRef,
    draftThreadId,
    goalSubmission,
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
