import type { useConversationOwner } from "../../ui/use-conversation-owner";
import { useLargePasteState } from "./attachments/largePaste";
import { useReviewAttachmentIds } from "./attachments/reviewAdmission";
import { useComposerEditing } from "./composerEditing";
import { useComposerMenuState } from "./ComposerMenu";
import type { ComposerWorkspaceCapabilities } from "./composerWorkspaceCapabilities";
import { useQueueEditState } from "./queueEdit";
import { useComposerVoiceState } from "./voice";

export function useComposerState({
  composerInputs,
  composerScope,
  composerState,
  controlsResourceId,
  conversationOwner,
  cwd,
  draftConnectionId,
  draftThreadId,
  newChat,
  voiceController,
  workspaceResources,
}: {
  composerInputs: ComposerWorkspaceCapabilities;
  composerScope: string;
  composerState: Parameters<typeof useComposerEditing>[0]["composerState"];
  controlsResourceId: Parameters<typeof useComposerEditing>[0]["controlsResourceId"];
  conversationOwner: ReturnType<typeof useConversationOwner>;
  cwd: string;
  draftConnectionId: string | null;
  draftThreadId: string | null;
  newChat: boolean;
  voiceController: ComposerWorkspaceCapabilities["voiceController"];
  workspaceResources: Parameters<typeof useComposerEditing>[0]["workspaceResources"];
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
    controlsResourceId,
    conversationOwner,
    cwd,
    draftConnectionId,
    draftThreadId,
    newChat,
    onLoadControls: composerInputs.onLoadControls,
    onUpdateSettings: composerInputs.onUpdateSettings,
    queuedComposerEdit: queueEditStateBinding.queuedComposerEdit,
    saveComposerPreferences: composerInputs.saveComposerPreferences,
    saveDraft: composerInputs.saveDraft,
    saveDraftAttachments: composerInputs.saveDraftAttachments,
    voiceController,
    workspaceResources,
  });
  const reviewAttachmentIdsBinding = useReviewAttachmentIds(composerScope);
  return {
    composerEditingBinding,
    composerMenuStateBinding,
    composerVoiceStateBinding,
    largePasteStateBinding,
    queueEditStateBinding,
    reviewAttachmentIdsBinding,
  };
}
