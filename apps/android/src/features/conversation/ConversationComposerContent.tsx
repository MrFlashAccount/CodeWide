import type { MainThreadReadCapabilities } from "./mainThreadReadCapabilities";
import type { ConversationSurfaceCapabilities } from "./conversationSurfaceCapabilities";
import type { ConversationPortCapabilities } from "../ports/conversationPortCapabilities";
import type { ConversationAttachmentCapabilities } from "../attachments/conversationAttachmentCapabilities";
import type { ComposerWorkspaceCapabilities } from "../composer/composerWorkspaceCapabilities";
import { useDocumentTransferAccess } from "../attachments/documentNavigation";
import { useComposerCommands } from "../composer/composerCommands";
import { ComposerFeature } from "../composer/ComposerFeature";
import { useComposerInteractions } from "../composer/composerInteractions";
import { useComposerState } from "../composer/composerState";
import { useConversationActivation } from "./conversationActivation";
import { useConversationTools } from "./ConversationTools";
import { useConversationTimelineRead } from "./timeline/conversationTimelineRead";
import { useOverlayScrollOwnership } from "./timeline/overlayScrollOwnership";

export function createConversationComposerContent({
  surfaceInputs,
  composerInputs,
  readInputs,
  composerStateBinding,
  composerCommands,
  toolsBinding,
  attachmentsInputs,
  getStableTransferAccess,
  composerDelivery,
  activation,
  portsInputs,
  overlayScrollOwnershipBinding,
  timelineRead,
}: {
  surfaceInputs: ConversationSurfaceCapabilities;
  composerInputs: ComposerWorkspaceCapabilities;
  readInputs: MainThreadReadCapabilities;
  composerStateBinding: ReturnType<typeof useComposerState>;
  composerCommands: ReturnType<typeof useComposerCommands>;
  toolsBinding: ReturnType<typeof useConversationTools>;
  attachmentsInputs: ConversationAttachmentCapabilities;
  getStableTransferAccess: ReturnType<typeof useDocumentTransferAccess>;
  composerDelivery: ReturnType<typeof useComposerInteractions>;
  activation: ReturnType<typeof useConversationActivation>;
  portsInputs: ConversationPortCapabilities;
  overlayScrollOwnershipBinding: ReturnType<typeof useOverlayScrollOwnership>;
  timelineRead: ReturnType<typeof useConversationTimelineRead>;
}) {
  const composerContent = (
    <ComposerFeature
      newChat={surfaceInputs.newChat}
      workspaceResources={composerInputs.workspaceResources}
      controlsResourceId={composerInputs.controlsResourceId}
      cwd={surfaceInputs.cwd}
      remoteThread={readInputs.remoteThread}
      readOnly={surfaceInputs.readOnly}
      selectedModel={composerStateBinding.composerEditingBinding.selectedModel}
      selectedEffort={composerStateBinding.composerEditingBinding.selectedEffort}
      selectedPersonality={composerStateBinding.composerEditingBinding.selectedPersonality}
      selectedPermissions={composerStateBinding.composerEditingBinding.selectedPermissions}
      controlError={composerStateBinding.composerEditingBinding.controlError}
      onLoadControls={composerInputs.onLoadControls}
      openQuickControlMenu={composerCommands.composerControlActionsBinding.openQuickControlMenu}
      closeQuickControlMenu={composerCommands.composerControlActionsBinding.closeQuickControlMenu}
      openControls={composerCommands.composerControlActionsBinding.openControls}
      selectModel={composerStateBinding.composerEditingBinding.selectModel}
      selectEffort={composerStateBinding.composerEditingBinding.selectEffort}
      setSelectedPersonality={composerStateBinding.composerEditingBinding.setSelectedPersonality}
      selectPermissions={composerStateBinding.composerEditingBinding.selectPermissions}
      toolContextChips={toolsBinding.toolContextChips}
      queuedComposerEdit={composerStateBinding.queueEditStateBinding.queuedComposerEdit}
      cancelQueuedComposerEdit={composerCommands.queueEditActionsBinding.cancelQueuedComposerEdit}
      voiceError={composerStateBinding.composerVoiceStateBinding.voiceError}
      queuedComposerEditError={composerStateBinding.queueEditStateBinding.queuedComposerEditError}
      getTransferAccess={attachmentsInputs.getTransferAccess}
      composerUploadScope={composerStateBinding.composerEditingBinding.composerUploadScope}
      attachments={composerStateBinding.composerEditingBinding.attachments}
      getStableTransferAccess={getStableTransferAccess}
      removeComposerAttachment={
        composerCommands.composerAttachmentsBinding.removeComposerAttachment
      }
      composerTrayVisible={composerStateBinding.composerMenuStateBinding.composerTrayVisible}
      useAnchoredComposerMenu={
        composerDelivery.composerAccessoryActionsBinding.useAnchoredComposerMenu
      }
      fileAttachmentEnabled={composerCommands.composerAttachmentsBinding.fileAttachmentEnabled}
      draftConnectionId={activation.draftConnectionId}
      draftThreadId={activation.draftThreadId}
      portForwardingConnectionId={portsInputs.portForwardingConnectionId}
      openAccessoryAction={composerDelivery.composerAccessoryActionsBinding.openAccessoryAction}
      anchoredComposerActions={
        composerDelivery.composerAccessoryActionsBinding.anchoredComposerActions
      }
      dismissComposerKeyboardForOverlay={
        overlayScrollOwnershipBinding.dismissComposerKeyboardForOverlay
      }
      handleAnchoredComposerAction={
        composerDelivery.composerAccessoryActionsBinding.handleAnchoredComposerAction
      }
      setComposerTrayVisible={composerStateBinding.composerMenuStateBinding.setComposerTrayVisible}
      voicePhase={composerStateBinding.composerVoiceStateBinding.voicePhase}
      composerScope={activation.composerScope}
      composerInputRef={composerStateBinding.composerEditingBinding.composerInputRef}
      pastedAttachmentPending={composerStateBinding.largePasteStateBinding.pastedAttachmentPending}
      handleComposerLargePaste={
        composerCommands.composerAttachmentsBinding.handleComposerLargePaste
      }
      draft={composerStateBinding.composerEditingBinding.draft}
      handleComposerTextChange={
        composerStateBinding.composerEditingBinding.handleComposerTextChange
      }
      handleComposerMarkdownChange={
        composerStateBinding.composerEditingBinding.handleComposerMarkdownChange
      }
      draftSelectionRef={composerStateBinding.composerEditingBinding.draftSelectionRef}
      pendingVoiceSelection={composerStateBinding.composerVoiceStateBinding.pendingVoiceSelection}
      voiceController={composerInputs.voiceController}
      searchComposerSuggestions={
        composerStateBinding.composerEditingBinding.searchComposerSuggestions
      }
      selectComposerMention={composerStateBinding.composerEditingBinding.selectComposerMention}
      editingQueuedMessage={composerDelivery.composerDeliveryBinding.editingQueuedMessage}
      voiceBackend={composerStateBinding.composerVoiceStateBinding.voiceBackend}
      voiceResource={composerStateBinding.composerVoiceStateBinding.voiceResource}
      microphoneButtonRef={composerStateBinding.composerVoiceStateBinding.microphoneButtonRef}
      voiceRetryAvailable={composerStateBinding.composerVoiceStateBinding.voiceRetryAvailable}
      retryVoice={composerDelivery.composerDeliveryBinding.retryVoice}
      toggleVoice={composerDelivery.composerDeliveryBinding.toggleVoice}
      finishVoice={composerDelivery.composerDeliveryBinding.finishVoice}
      microphoneAccess={composerDelivery.composerDeliveryBinding.microphoneAccess}
      sendDisabled={composerDelivery.composerDeliveryBinding.sendDisabled}
      composerDiscardEnabled={composerDelivery.composerDeliveryBinding.composerDiscardEnabled}
      queuedComposerEditBusy={composerStateBinding.queueEditStateBinding.queuedComposerEditBusy}
      discardComposer={composerDelivery.composerDeliveryBinding.discardComposer}
      steerComposer={composerDelivery.composerDeliveryBinding.steerComposer}
      activatePrimaryAction={composerDelivery.composerDeliveryBinding.activatePrimaryAction}
      deliveryActions={composerDelivery.composerDeliveryBinding.deliveryActions}
      handleDeliveryAction={composerDelivery.composerDeliveryBinding.handleDeliveryAction}
      stoppingResponse={composerDelivery.composerDeliveryBinding.stoppingResponse}
      threadLifecycleActive={timelineRead.conversationPresentationBinding.threadLifecycleActive}
      currentTurnId={timelineRead.conversationPresentationBinding.currentTurnId}
    />
  );
  return { composerContent };
}
