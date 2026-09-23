import { useComposerDraftCommands, useComposerDraftState, useComposerEditorEvents } from "./draft";
import { useComposerSettings } from "./settings";
import { useComposerSuggestions } from "./suggestions";
/** Composes the existing ComposerEditing owners without adding state or lifecycle policy. */
export function useComposerEditing({
  composerScope,
  composerState,
  controlsResourceId,
  conversationOwner,
  cwd,
  draftConnectionId,
  draftThreadId,
  newChat,
  onLoadControls,
  onUpdateSettings,
  queuedComposerEdit,
  saveComposerPreferences,
  saveDraft,
  saveDraftAttachments,
  voiceController,
  workspaceResources,
}: {
  composerScope: Parameters<typeof useComposerEditorEvents>[0]["composerScope"];
  composerState: Parameters<typeof useComposerDraftState>[1];
  controlsResourceId: Parameters<typeof useComposerSettings>[0]["controlsResourceId"];
  conversationOwner: Parameters<typeof useComposerSettings>[0]["conversationOwner"];
  cwd: Parameters<typeof useComposerSuggestions>[0]["cwd"];
  draftConnectionId: Parameters<typeof useComposerDraftCommands>[0]["draftConnectionId"];
  draftThreadId: Parameters<typeof useComposerDraftCommands>[0]["draftThreadId"];
  newChat: Parameters<typeof useComposerSettings>[0]["newChat"];
  onLoadControls: Parameters<typeof useComposerSuggestions>[0]["onLoadControls"];
  onUpdateSettings: Parameters<typeof useComposerSettings>[0]["onUpdateSettings"];
  queuedComposerEdit: Parameters<typeof useComposerDraftCommands>[0]["queuedComposerEdit"];
  saveComposerPreferences: Parameters<typeof useComposerSettings>[0]["saveComposerPreferences"];
  saveDraft: Parameters<typeof useComposerDraftCommands>[0]["saveDraft"];
  saveDraftAttachments: Parameters<typeof useComposerDraftCommands>[0]["saveDraftAttachments"];
  voiceController: Parameters<typeof useComposerEditorEvents>[0]["voiceController"];
  workspaceResources: Parameters<typeof useComposerSettings>[0]["workspaceResources"];
}) {
  const {
    attachmentCount,
    attachments,
    composerInputRef,
    composerPreferences,
    composerSession,
    composerUploadScope,
    draft,
    draftSelectionRef,
    uploadsBlockSend,
  } = useComposerDraftState(composerScope, composerState, queuedComposerEdit);
  const {
    applyModelSettings,
    captureControlsResource,
    capturePreferenceUpdate,
    controlError,
    currentControlsResource,
    requestControls,
    selectedEffort,
    selectedModel,
    selectedPermissions,
    selectedPersonality,
    selectedServiceTier,
    selectEffort,
    selectModel,
    selectPermissions,
    selectServiceTier,
    setSelectedPersonality,
    updateComposerPreferences,
  } = useComposerSettings({
    composerPreferences,
    composerScope,
    composerSession,
    controlsResourceId,
    conversationOwner,
    cwd,
    draftConnectionId,
    draftThreadId,
    newChat,
    onLoadControls,
    onUpdateSettings,
    saveComposerPreferences,
    workspaceResources,
  });
  const { captureDraftMutations, updateAttachments, updateDraft, updateText } =
    useComposerDraftCommands({
      composerSession,
      draftConnectionId,
      draftThreadId,
      queuedComposerEdit,
      saveDraft,
      saveDraftAttachments,
    });
  const {
    handleComposerTextChange,
    insertSkillInvocation,
    searchComposerSuggestions,
    selectComposerMention,
  } = useComposerSuggestions({
    composerInputRef,
    composerScope,
    composerSession,
    currentControlsResource,
    cwd,
    draftSelectionRef,
    onLoadControls,
    updateComposerPreferences,
    updateDraft,
    updateText,
    voiceController,
  });
  const { clearComposerText } = useComposerEditorEvents({
    composerScope,
    draftSelectionRef,
    updateDraft,
    voiceController,
  });
  return {
    applyModelSettings,
    attachmentCount,
    attachments,
    captureControlsResource,
    captureDraftMutations,
    capturePreferenceUpdate,
    clearComposerText,
    composerInputRef,
    composerSession,
    composerUploadScope,
    controlError,
    currentControlsResource,
    draft,
    draftSelectionRef,
    handleComposerTextChange,
    insertSkillInvocation,
    requestControls,
    searchComposerSuggestions,
    selectComposerMention,
    selectedEffort,
    selectedModel,
    selectedPermissions,
    selectedPersonality,
    selectedServiceTier,
    selectEffort,
    selectModel,
    selectPermissions,
    selectServiceTier,
    setSelectedPersonality,
    updateAttachments,
    uploadsBlockSend,
  };
}
