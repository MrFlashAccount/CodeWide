import type { MainThreadReadCapabilities } from "./mainThreadReadCapabilities";
import type { ConversationSurfaceCapabilities } from "./conversationSurfaceCapabilities";
import { createElement, Fragment, type ReactNode } from "react";
import type { ConversationAttachmentCapabilities } from "../attachments/conversationAttachmentCapabilities";
import type { ComposerWorkspaceCapabilities } from "../composer/composerWorkspaceCapabilities";
import type { useDocumentTransferAccess } from "../attachments/documentNavigation";
import type { useComposerCommands } from "../composer/composerCommands";
import { ComposerFeature } from "../composer/ComposerFeature";
import type { useComposerInteractions } from "../composer/composerInteractions";
import type { useComposerState } from "../composer/composerState";
import type { useConversationActivation } from "./conversationActivation";
import type { ConversationCompositionCapabilities } from "./conversationCompositionCapabilities";
import type { useConversationTools } from "./ConversationTools";
import type { useConversationTimelineRead } from "./timeline/conversationTimelineRead";
import type { useOverlayScrollOwnership } from "./timeline/overlayScrollOwnership";
import { ConversationComposerSlot } from "./ConversationComposerSlot";

export function createConversationComposerContent({
  activation,
  attachmentsInputs,
  composerCommands,
  composerDelivery,
  composerInputs,
  composerStateBinding,
  getStableTransferAccess,
  goalContent,
  goalInputs,
  overlayScrollOwnershipBinding,
  readInputs,
  surfaceInputs,
  timelineRead,
  toolsBinding,
}: {
  activation: ReturnType<typeof useConversationActivation>;
  attachmentsInputs: ConversationAttachmentCapabilities;
  composerCommands: ReturnType<typeof useComposerCommands>;
  composerDelivery: ReturnType<typeof useComposerInteractions>;
  composerInputs: ComposerWorkspaceCapabilities;
  composerStateBinding: ReturnType<typeof useComposerState>;
  getStableTransferAccess: ReturnType<typeof useDocumentTransferAccess>;
  goalContent: ReactNode;
  goalInputs: ConversationCompositionCapabilities["goal"];
  overlayScrollOwnershipBinding: ReturnType<typeof useOverlayScrollOwnership>;
  readInputs: MainThreadReadCapabilities;
  surfaceInputs: ConversationSurfaceCapabilities;
  timelineRead: ReturnType<typeof useConversationTimelineRead>;
  toolsBinding: ReturnType<typeof useConversationTools>;
}): { readonly composerContent: React.JSX.Element } {
  const toolContextChips = createElement(
    Fragment,
    null,
    goalContent,
    toolsBinding.toolContextChips,
  );
  const composerContent = (
    <ConversationComposerSlot state={readInputs.composerState}>
      <ComposerFeature
        activatePrimaryAction={composerDelivery.composerDeliveryBinding.activatePrimaryAction}
        anchoredComposerActions={
          composerDelivery.composerAccessoryActionsBinding.anchoredComposerActions
        }
        attachments={composerStateBinding.composerEditingBinding.attachments}
        cancelQueuedComposerEdit={composerCommands.queueEditActionsBinding.cancelQueuedComposerEdit}
        closeGoalAttachment={composerStateBinding.composerMenuStateBinding.closeGoalAttachment}
        closeQuickControlMenu={composerCommands.composerControlActionsBinding.closeQuickControlMenu}
        composerDiscardEnabled={composerDelivery.composerDeliveryBinding.composerDiscardEnabled}
        composerInputRef={composerStateBinding.composerEditingBinding.composerInputRef}
        composerScope={activation.composerScope}
        composerTrayVisible={composerStateBinding.composerMenuStateBinding.composerTrayVisible}
        composerUploadScope={composerStateBinding.composerEditingBinding.composerUploadScope}
        controlError={composerStateBinding.composerEditingBinding.controlError}
        controlsResourceId={composerInputs.controlsResourceId}
        currentTurnId={timelineRead.conversationPresentationBinding.currentTurnId}
        cwd={surfaceInputs.cwd}
        deliveryActions={composerDelivery.composerDeliveryBinding.deliveryActions}
        discardComposer={composerDelivery.composerDeliveryBinding.discardComposer}
        dismissComposerKeyboardForOverlay={
          overlayScrollOwnershipBinding.dismissComposerKeyboardForOverlay
        }
        draft={composerStateBinding.composerEditingBinding.draft}
        draftConnectionId={activation.draftConnectionId}
        draftSelectionRef={composerStateBinding.composerEditingBinding.draftSelectionRef}
        draftThreadId={activation.draftThreadId}
        editingQueuedMessage={composerDelivery.composerDeliveryBinding.editingQueuedMessage}
        fileAttachmentEnabled={composerCommands.composerAttachmentsBinding.fileAttachmentEnabled}
        finishVoice={composerDelivery.composerDeliveryBinding.finishVoice}
        getStableTransferAccess={getStableTransferAccess}
        getTransferAccess={attachmentsInputs.getTransferAccess}
        goalAttachmentVisible={composerStateBinding.composerMenuStateBinding.goalAttachmentVisible}
        handleAnchoredComposerAction={
          composerDelivery.composerAccessoryActionsBinding.handleAnchoredComposerAction
        }
        handleComposerLargePaste={
          composerCommands.composerAttachmentsBinding.handleComposerLargePaste
        }
        handleComposerTextChange={
          composerStateBinding.composerEditingBinding.handleComposerTextChange
        }
        handleDeliveryAction={composerDelivery.composerDeliveryBinding.handleDeliveryAction}
        microphoneAccess={composerDelivery.composerDeliveryBinding.microphoneAccess}
        microphoneButtonRef={composerStateBinding.composerVoiceStateBinding.microphoneButtonRef}
        newChat={surfaceInputs.newChat}
        onLoadControls={composerInputs.onLoadControls}
        onSetGoal={goalInputs.onSetGoal}
        openAccessoryAction={composerDelivery.composerAccessoryActionsBinding.openAccessoryAction}
        openControls={composerCommands.composerControlActionsBinding.openControls}
        openQuickControlMenu={composerCommands.composerControlActionsBinding.openQuickControlMenu}
        pastedAttachmentPending={
          composerStateBinding.largePasteStateBinding.pastedAttachmentPending
        }
        pendingVoiceSelection={composerStateBinding.composerVoiceStateBinding.pendingVoiceSelection}
        queuedComposerEdit={composerStateBinding.queueEditStateBinding.queuedComposerEdit}
        queuedComposerEditBusy={composerStateBinding.queueEditStateBinding.queuedComposerEditBusy}
        queuedComposerEditError={composerStateBinding.queueEditStateBinding.queuedComposerEditError}
        readOnly={surfaceInputs.readOnly}
        remoteThread={readInputs.remoteThread}
        removeComposerAttachment={
          composerCommands.composerAttachmentsBinding.removeComposerAttachment
        }
        retryVoice={composerDelivery.composerDeliveryBinding.retryVoice}
        searchComposerSuggestions={
          composerStateBinding.composerEditingBinding.searchComposerSuggestions
        }
        selectComposerMention={composerStateBinding.composerEditingBinding.selectComposerMention}
        selectedEffort={composerStateBinding.composerEditingBinding.selectedEffort}
        selectedModel={composerStateBinding.composerEditingBinding.selectedModel}
        selectedPermissions={composerStateBinding.composerEditingBinding.selectedPermissions}
        selectedPersonality={composerStateBinding.composerEditingBinding.selectedPersonality}
        selectedServiceTier={composerStateBinding.composerEditingBinding.selectedServiceTier}
        selectEffort={composerStateBinding.composerEditingBinding.selectEffort}
        selectModel={composerStateBinding.composerEditingBinding.selectModel}
        selectPermissions={composerStateBinding.composerEditingBinding.selectPermissions}
        selectServiceTier={composerStateBinding.composerEditingBinding.selectServiceTier}
        sendDisabled={composerDelivery.composerDeliveryBinding.sendDisabled}
        setComposerTrayVisible={
          composerStateBinding.composerMenuStateBinding.setComposerTrayVisible
        }
        setSelectedPersonality={composerStateBinding.composerEditingBinding.setSelectedPersonality}
        steerComposer={composerDelivery.composerDeliveryBinding.steerComposer}
        stoppingResponse={composerDelivery.composerDeliveryBinding.stoppingResponse}
        terminalEnabled={composerDelivery.composerAccessoryActionsBinding.terminalEnabled}
        threadLifecycleActive={timelineRead.conversationPresentationBinding.threadLifecycleActive}
        toggleVoice={composerDelivery.composerDeliveryBinding.toggleVoice}
        toolContextChips={toolContextChips}
        useAnchoredComposerMenu={
          composerDelivery.composerAccessoryActionsBinding.useAnchoredComposerMenu
        }
        voiceBackend={composerStateBinding.composerVoiceStateBinding.voiceBackend}
        voiceController={composerInputs.voiceController}
        voiceError={composerStateBinding.composerVoiceStateBinding.voiceError}
        voicePhase={composerStateBinding.composerVoiceStateBinding.voicePhase}
        voiceResource={composerStateBinding.composerVoiceStateBinding.voiceResource}
        voiceRetryAvailable={composerStateBinding.composerVoiceStateBinding.voiceRetryAvailable}
        workspaceResources={composerInputs.workspaceResources}
      />
    </ConversationComposerSlot>
  );
  return { composerContent };
}
