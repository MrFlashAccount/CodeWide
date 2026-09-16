import {
  useComposerDraftCommands,
  useComposerDraftState,
  useComposerEditorEvents,
  useComposerSeed,
} from "./draft";
import { useComposerSettings } from "./settings";
import { useComposerSuggestions } from "./suggestions";
/** Composes the existing ComposerEditing owners without adding state or lifecycle policy. */
export function useComposerEditing({
  composerScope,
  composerState,
  queuedComposerEdit,
  newChat,
  cwd,
  draftConnectionId,
  draftThreadId,
  workspaceResources,
  controlsResourceId,
  conversationOwner,
  onLoadControls,
  onUpdateSettings,
  saveComposerPreferences,
  loadDraft,
  setQueuedComposerEdit,
  saveDraft,
  saveDraftAttachments,
  voiceController,
}: {
  composerScope: Parameters<typeof useComposerEditorEvents>[0]["composerScope"];
  composerState: Parameters<typeof useComposerDraftState>[1];
  queuedComposerEdit: Parameters<typeof useComposerDraftCommands>[0]["queuedComposerEdit"];
  newChat: Parameters<typeof useComposerSettings>[0]["newChat"];
  cwd: Parameters<typeof useComposerSuggestions>[0]["cwd"];
  draftConnectionId: Parameters<typeof useComposerDraftCommands>[0]["draftConnectionId"];
  draftThreadId: Parameters<typeof useComposerDraftCommands>[0]["draftThreadId"];
  workspaceResources: Parameters<typeof useComposerSettings>[0]["workspaceResources"];
  controlsResourceId: Parameters<typeof useComposerSettings>[0]["controlsResourceId"];
  conversationOwner: Parameters<typeof useComposerSettings>[0]["conversationOwner"];
  onLoadControls: Parameters<typeof useComposerSuggestions>[0]["onLoadControls"];
  onUpdateSettings: Parameters<typeof useComposerSettings>[0]["onUpdateSettings"];
  saveComposerPreferences: Parameters<typeof useComposerSettings>[0]["saveComposerPreferences"];
  loadDraft: Parameters<typeof useComposerSeed>[2];
  setQueuedComposerEdit: Parameters<typeof useComposerDraftCommands>[0]["setQueuedComposerEdit"];
  saveDraft: Parameters<typeof useComposerDraftCommands>[0]["saveDraft"];
  saveDraftAttachments: Parameters<typeof useComposerDraftCommands>[0]["saveDraftAttachments"];
  voiceController: Parameters<typeof useComposerEditorEvents>[0]["voiceController"];
}) {
  const {
    composerUploadScope,
    draft,
    attachments,
    uploadsBlockSend,
    attachmentCount,
    composerPreferences,
    latestDraftRef,
    latestAttachmentsRef,
    latestComposerPreferencesRef,
    composerStateMissing,
    draftSelectionRef,
    composerInputRef,
    composerMarkdownRef,
  } = useComposerDraftState(composerScope, composerState, queuedComposerEdit);
  const {
    captureControlsResource,
    currentControlsResource,
    controlError,
    requestControls,
    selectedModel,
    selectedEffort,
    selectedPersonality,
    selectedPermissions,
    setSelectedPersonality,
    selectModel,
    selectEffort,
    selectPermissions,
    updateComposerPreferences,
    capturePreferenceUpdate,
  } = useComposerSettings({
    composerScope,
    newChat,
    cwd,
    draftConnectionId,
    draftThreadId,
    workspaceResources,
    controlsResourceId,
    composerPreferences,
    latestComposerPreferencesRef,
    conversationOwner,
    onLoadControls,
    onUpdateSettings,
    saveComposerPreferences,
  });
  useComposerSeed(composerScope, composerStateMissing, loadDraft, draftConnectionId, draftThreadId);
  const { updateDraft, updateAttachments, captureDraftMutations } = useComposerDraftCommands({
    queuedComposerEdit,
    setQueuedComposerEdit,
    latestDraftRef,
    latestAttachmentsRef,
    composerMarkdownRef,
    draftConnectionId,
    draftThreadId,
    saveDraft,
    saveDraftAttachments,
  });
  const {
    insertSkillInvocation,
    searchComposerSuggestions,
    selectComposerMention,
    handleComposerTextChange,
  } = useComposerSuggestions({
    latestComposerPreferencesRef,
    updateComposerPreferences,
    composerInputRef,
    draftSelectionRef,
    draft,
    updateDraft,
    voiceController,
    composerScope,
    currentControlsResource,
    onLoadControls,
    cwd,
  });
  const { handleComposerMarkdownChange, clearComposerText } = useComposerEditorEvents({
    composerMarkdownRef,
    draftSelectionRef,
    voiceController,
    composerScope,
    updateDraft,
  });
  return {
    composerUploadScope,
    draftSelectionRef,
    composerInputRef,
    composerMarkdownRef,
    latestAttachmentsRef,
    uploadsBlockSend,
    latestDraftRef,
    latestComposerPreferencesRef,
    selectedModel,
    selectedEffort,
    selectedPersonality,
    selectedPermissions,
    capturePreferenceUpdate,
    captureControlsResource,
    captureDraftMutations,
    currentControlsResource,
    requestControls,
    attachmentCount,
    draft,
    attachments,
    clearComposerText,
    updateAttachments,
    controlError,
    selectModel,
    selectEffort,
    setSelectedPersonality,
    selectPermissions,
    handleComposerTextChange,
    handleComposerMarkdownChange,
    searchComposerSuggestions,
    selectComposerMention,
    insertSkillInvocation,
  };
}
