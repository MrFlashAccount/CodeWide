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
  controlsResourceId,
  conversationOwner,
  cwd,
  draftConnectionId,
  draftThreadId,
  loadDraft,
  newChat,
  onLoadControls,
  onUpdateSettings,
  queuedComposerEdit,
  saveComposerPreferences,
  saveDraft,
  saveDraftAttachments,
  setQueuedComposerEdit,
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
  loadDraft: Parameters<typeof useComposerSeed>[2];
  newChat: Parameters<typeof useComposerSettings>[0]["newChat"];
  onLoadControls: Parameters<typeof useComposerSuggestions>[0]["onLoadControls"];
  onUpdateSettings: Parameters<typeof useComposerSettings>[0]["onUpdateSettings"];
  queuedComposerEdit: Parameters<typeof useComposerDraftCommands>[0]["queuedComposerEdit"];
  saveComposerPreferences: Parameters<typeof useComposerSettings>[0]["saveComposerPreferences"];
  saveDraft: Parameters<typeof useComposerDraftCommands>[0]["saveDraft"];
  saveDraftAttachments: Parameters<typeof useComposerDraftCommands>[0]["saveDraftAttachments"];
  setQueuedComposerEdit: Parameters<typeof useComposerDraftCommands>[0]["setQueuedComposerEdit"];
  voiceController: Parameters<typeof useComposerEditorEvents>[0]["voiceController"];
  workspaceResources: Parameters<typeof useComposerSettings>[0]["workspaceResources"];
}) {
  const {
    attachmentCount,
    attachments,
    composerInputRef,
    composerMarkdownRef,
    composerPreferences,
    composerStateMissing,
    composerUploadScope,
    draft,
    draftSelectionRef,
    latestAttachmentsRef,
    latestComposerPreferencesRef,
    latestDraftRef,
    uploadsBlockSend,
  } = useComposerDraftState(composerScope, composerState, queuedComposerEdit);
  const {
    captureControlsResource,
    capturePreferenceUpdate,
    controlError,
    currentControlsResource,
    requestControls,
    selectedEffort,
    selectedModel,
    selectedPermissions,
    selectedPersonality,
    selectEffort,
    selectModel,
    selectPermissions,
    setSelectedPersonality,
    updateComposerPreferences,
  } = useComposerSettings({
    composerPreferences,
    composerScope,
    controlsResourceId,
    conversationOwner,
    cwd,
    draftConnectionId,
    draftThreadId,
    latestComposerPreferencesRef,
    newChat,
    onLoadControls,
    onUpdateSettings,
    saveComposerPreferences,
    workspaceResources,
  });
  useComposerSeed(composerScope, composerStateMissing, loadDraft, draftConnectionId, draftThreadId);
  const { captureDraftMutations, updateAttachments, updateDraft } = useComposerDraftCommands({
    composerMarkdownRef,
    draftConnectionId,
    draftThreadId,
    latestAttachmentsRef,
    latestDraftRef,
    queuedComposerEdit,
    saveDraft,
    saveDraftAttachments,
    setQueuedComposerEdit,
  });
  const {
    handleComposerTextChange,
    insertSkillInvocation,
    searchComposerSuggestions,
    selectComposerMention,
  } = useComposerSuggestions({
    composerInputRef,
    composerScope,
    currentControlsResource,
    cwd,
    draft,
    draftSelectionRef,
    latestComposerPreferencesRef,
    onLoadControls,
    updateComposerPreferences,
    updateDraft,
    voiceController,
  });
  const { clearComposerText, handleComposerMarkdownChange } = useComposerEditorEvents({
    composerMarkdownRef,
    composerScope,
    draftSelectionRef,
    updateDraft,
    voiceController,
  });
  return {
    attachmentCount,
    attachments,
    captureControlsResource,
    captureDraftMutations,
    capturePreferenceUpdate,
    clearComposerText,
    composerInputRef,
    composerMarkdownRef,
    composerUploadScope,
    controlError,
    currentControlsResource,
    draft,
    draftSelectionRef,
    handleComposerMarkdownChange,
    handleComposerTextChange,
    insertSkillInvocation,
    latestAttachmentsRef,
    latestComposerPreferencesRef,
    latestDraftRef,
    requestControls,
    searchComposerSuggestions,
    selectComposerMention,
    selectedEffort,
    selectedModel,
    selectedPermissions,
    selectedPersonality,
    selectEffort,
    selectModel,
    selectPermissions,
    setSelectedPersonality,
    updateAttachments,
    uploadsBlockSend,
  };
}
