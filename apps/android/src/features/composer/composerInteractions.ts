import type { ThreadGoal } from "@codewide/codex-protocol/v0.155.1/v2";
import { readThreadAgent, threadAgentSupports } from "../../data/threadAgent";
import type { useConversationOwner } from "../../ui/use-conversation-owner";
import type { ConversationGoalCapabilities } from "../goal/conversationGoalCapabilities";
import type { ThreadCurrentOutcome } from "../../data/thread-current-outcome";
import { selectComposerContinuation, useComposerContinuation } from "./composerContinuation";
import type { QueueWorkspaceCapabilities } from "../queue/queueWorkspaceCapabilities";
import { useComposerAccessoryActions } from "./ComposerAccessoryTray";
import type { useComposerCommands } from "./composerCommands";
import { useComposerDelivery } from "./composerDelivery";
import { useComposerFeatureActions } from "./composerFeatureActions";
import { createComposerGoalSubmission } from "./composerGoalSubmission";
import type { useComposerState } from "./composerState";
import type { ComposerWorkspaceCapabilities } from "./composerWorkspaceCapabilities";

export function useComposerInteractions({
  captureGoalLifecycle,
  composerCommands,
  composerInputs,
  composerScope,
  composerStateBinding,
  conversationOwner,
  createAndOpenTerminal,
  currentGoal,
  currentOutcome,
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
  captureGoalLifecycle: ConversationGoalCapabilities["captureGoalLifecycle"];
  composerCommands: ReturnType<typeof useComposerCommands>;
  composerInputs: ComposerWorkspaceCapabilities;
  composerScope: string;
  composerStateBinding: ReturnType<typeof useComposerState>;
  conversationOwner: ReturnType<typeof useConversationOwner>;
  createAndOpenTerminal: Parameters<typeof useComposerFeatureActions>[2];
  currentGoal: ThreadGoal | null;
  currentOutcome: ThreadCurrentOutcome | null;
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
    () => {
      if (currentGoal !== null) {
        composerStateBinding.composerMenuStateBinding.openGoalEdit(currentGoal);
      }
    },
  );
  const composerAccessoryActionsBinding = useComposerAccessoryActions({
    fileAttachmentEnabled: composerCommands.composerAttachmentsBinding.fileAttachmentEnabled,
    goalEnabled: onSetGoal !== undefined,
    openComposerFeature: composerFeatureActionsBinding.openComposerFeature,
    setComposerTrayVisible: composerStateBinding.composerMenuStateBinding.setComposerTrayVisible,
    skillsEnabled: threadAgentSupports(readThreadAgent(remoteThread), "input.skillsAndMentions"),
    terminalEnabled,
  });
  const goalSubmission = createComposerGoalSubmission(
    composerStateBinding.composerMenuStateBinding,
    currentGoal,
    onSetGoal,
  );
  const pauseGoalBeforeInterrupt =
    currentGoal?.status === "active"
      ? async (): Promise<void> => {
          if (captureGoalLifecycle === undefined) {
            throw new Error("Goal pause is unavailable");
          }
          const commands = captureGoalLifecycle();
          await commands.setStatus("paused");
        }
      : undefined;
  const continuation = selectComposerContinuation({
    acceptsInput: remoteThread?.canAcceptDirectInput === true,
    captureGoalLifecycle,
    currentGoal,
    currentOutcome,
    onContinueTurn: composerInputs.onContinueTurn,
    threadLifecycleActive,
  });
  const continuationBinding = useComposerContinuation(
    composerScope,
    conversationOwner,
    continuation,
  );
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
    continuation:
      continuation === null
        ? null
        : {
            activate: continuationBinding.activate,
            disabled: continuationBinding.disabled,
            label: continuation.label,
          },
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
    pauseGoalBeforeInterrupt,
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
    selectedServiceTier: composerStateBinding.composerEditingBinding.selectedServiceTier,
    threadLifecycleActive: threadLifecycleActive,
    uploadsBlockSend: composerStateBinding.composerEditingBinding.uploadsBlockSend,
    voiceController,
    voiceError: composerStateBinding.composerVoiceStateBinding.voiceError,
    voicePhase: composerStateBinding.composerVoiceStateBinding.voicePhase,
    voiceRetryAvailable: composerStateBinding.composerVoiceStateBinding.voiceRetryAvailable,
  });
  return {
    composerAccessoryActionsBinding,
    composerDeliveryBinding,
    openGoalDetails: composerFeatureActionsBinding.openGoalDetails,
  };
}
