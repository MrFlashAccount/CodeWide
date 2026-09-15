import { useConversationOwner } from "../../ui/use-conversation-owner";
import { useLargePasteState } from "./attachments/largePaste";
import { useReviewAttachmentIds } from "./attachments/reviewAdmission";
import { useComposerEditing } from "./composerEditing";
import { useComposerMenuState } from "./ComposerMenu";
import type { ComposerWorkspaceCapabilities } from "./composerWorkspaceCapabilities";
import { useQueueEditState } from "./queueEdit";
import { useComposerVoiceState } from "./voice";
export function useComposerState({
  composerScope,
  workspaceResources,
  draftConnectionId,
  draftThreadId,
  composerState,
  newChat,
  cwd,
  controlsResourceId,
  conversationOwner,
  composerInputs,
  voiceController,
}: {
  composerScope: string;
  workspaceResources: Parameters<typeof useComposerEditing>[0]["workspaceResources"];
  draftConnectionId: string | null;
  draftThreadId: string | null;
  composerState: Parameters<typeof useComposerEditing>[0]["composerState"];
  newChat: boolean;
  cwd: string;
  controlsResourceId: Parameters<typeof useComposerEditing>[0]["controlsResourceId"];
  conversationOwner: ReturnType<typeof useConversationOwner>;
  composerInputs: ComposerWorkspaceCapabilities;
  voiceController: ComposerWorkspaceCapabilities["voiceController"];
}) {
  const composerVoiceStateBinding = useComposerVoiceState(
    composerScope,
    workspaceResources,
    draftConnectionId,
    draftThreadId,
  );
  const composerMenuStateBinding = useComposerMenuState(composerScope);
  const largePasteStateBinding = useLargePasteState(composerScope);
  const queueEditStateBinding = useQueueEditState(composerScope);
  const composerEditingBinding = useComposerEditing({
    composerScope,
    composerState,
    queuedComposerEdit: queueEditStateBinding.queuedComposerEdit,
    newChat,
    cwd,
    draftConnectionId,
    draftThreadId,
    workspaceResources,
    controlsResourceId,
    conversationOwner,
    onLoadControls: composerInputs.onLoadControls,
    onUpdateSettings: composerInputs.onUpdateSettings,
    saveComposerPreferences: composerInputs.saveComposerPreferences,
    loadDraft: composerInputs.loadDraft,
    setQueuedComposerEdit: queueEditStateBinding.setQueuedComposerEdit,
    saveDraft: composerInputs.saveDraft,
    saveDraftAttachments: composerInputs.saveDraftAttachments,
    voiceController,
    setMenuVisible: composerMenuStateBinding.setMenuVisible,
  });
  const reviewAttachmentIdsBinding = useReviewAttachmentIds(composerScope);
  return {
    composerMenuStateBinding,
    queueEditStateBinding,
    composerEditingBinding,
    composerVoiceStateBinding,
    reviewAttachmentIdsBinding,
    largePasteStateBinding,
  };
}
