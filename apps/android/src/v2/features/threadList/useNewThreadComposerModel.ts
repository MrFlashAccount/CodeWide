import { useSyncExternalStore } from "react";

import { useEvent } from "../../../react/useEvent";
import type { ComposerAttachmentDraft } from "../../application/composer/composerAttachmentDraft";
import type { ComposerAttachmentTarget } from "../../application/ports/composerAttachmentTransport";
import type { PersistedNewThreadDraft } from "../../application/ports/composerDraftStore";
import { useV2Runtime } from "../../application/react/V2RuntimeContext";
import type { ProjectionResource } from "../../application/resources/projectionResource";
import type { QueryResourceHandle } from "../../application/resources/queryResource";
import type { SkillCatalogEntry } from "../../application/skills/skillSelection";
import type { SavedServerId } from "../../domain/ids";
import { useVoiceInputControl, useVoiceInputLevel } from "../conversation/VoiceInputControl";
import type { DrawingWorkspaceRequest } from "../drawing/DrawingWorkspace";
import type { WorkspaceModeSelection } from "./NewThreadWorkspaceMode";
import type { NewThreadViewProps } from "./NewThreadView";
import {
  newThreadComposerActions,
  type NewThreadComposerAction,
  type NewThreadComposerActionContext,
} from "./newThreadComposerActions";
import { newThreadContextItems } from "./newThreadControls";
import { newThreadInteractionState } from "./newThreadInteractionState";
import { useNewThreadComposerSurfaces } from "./useNewThreadComposerSurfaces";
import { useNewThreadDraftPersistence } from "./useNewThreadDraftPersistence";
import { useNewThreadProjectModel } from "./useNewThreadProjectModel";
import { useNewThreadSettingsModel } from "./useNewThreadSettingsModel";
import { useNewThreadSubmission } from "./useNewThreadSubmission";

interface UseNewThreadComposerModelInput {
  modelOpeningError: string | null;
  modelResource: QueryResourceHandle | null;
  onComposerAction?(
    action: NewThreadComposerAction,
    context: NewThreadComposerActionContext,
  ): void | Promise<void>;
  onThreadCreated(threadId: string): void;
  projectOpeningError: string | null;
  projectResource: QueryResourceHandle | null;
  projectionOpeningError: string | null;
  projectionResource: Pick<ProjectionResource, "snapshot" | "subscribe">;
  savedServerId: SavedServerId;
}

export interface NewThreadComposerModel {
  attachmentDraft: ComposerAttachmentDraft;
  closeDrawing(): void;
  closeSkills(): void;
  currentDate(): Date;
  drawingRequest: DrawingWorkspaceRequest | null;
  onDrawingAttached(): void;
  onSelectSkill(skill: SkillCatalogEntry): void;
  skillsVisible: boolean;
  skillsWorkspace: string | null;
  view: Omit<NewThreadViewProps, "onBack">;
}

export function useNewThreadComposerModel(
  input: UseNewThreadComposerModelInput,
): NewThreadComposerModel {
  const runtime = useV2Runtime();
  const projectionSnapshot = useSyncExternalStore(
    input.projectionResource.subscribe,
    input.projectionResource.snapshot,
    input.projectionResource.snapshot,
  );
  const durableDraft = useNewThreadDraftPersistence(input.savedServerId);
  const restoredNewThread = durableDraft.restored;
  const projects = useNewThreadProjectModel({
    initial: restoredNewThread,
    openingError: input.projectOpeningError,
    resource: input.projectResource,
    savedServerId: input.savedServerId,
  });
  const settingsModel = useNewThreadSettingsModel({
    initial: restoredNewThread?.settings ?? null,
    openingError: input.modelOpeningError,
    resource: input.modelResource,
  });
  const workspace = projects.workspace;
  const newThread: PersistedNewThreadDraft = {
    settings: settingsModel.settings,
    workspace,
    workspaceMode: projects.workspaceMode,
  };
  const composerTarget: ComposerAttachmentTarget = { threadId: null, workspace };
  const message = durableDraft.message;
  const replaceMessage = useEvent((value: string) => {
    durableDraft.replaceMessage(newThread, value);
  });
  const surfaces = useNewThreadComposerSurfaces({
    message,
    onMessageChange: replaceMessage,
    savedServerId: input.savedServerId,
    workspace,
    ...(input.onComposerAction === undefined ? {} : { onComposerAction: input.onComposerAction }),
  });
  const attachmentDraft = durableDraft.attachmentDraft(newThread);
  const completeDraft = useEvent(() => {
    durableDraft.clear(newThread);
    surfaces.resetSkillBlocks();
  });
  const submission = useNewThreadSubmission({
    attachmentDraft,
    onSucceeded: completeDraft,
    onThreadCreated: input.onThreadCreated,
    savedServerId: input.savedServerId,
    settings: settingsModel.settings,
    skillBlocks: surfaces.skillBlocks,
    workspace,
    workspaceMode: projects.workspaceMode,
  });
  const connectionLocked = projectionSnapshot.value.state !== "live";
  const interaction = newThreadInteractionState({
    actionPending: surfaces.actionPending,
    connectionLive: !connectionLocked,
    locallyLocked: submission.locallyLocked,
    submitting: submission.submitting,
  });
  const clearErrors = useEvent(() => {
    submission.clearFailure();
    surfaces.clearError();
  });
  const editMessage = useEvent((value: string): void => {
    replaceMessage(value);
    clearErrors();
  });
  const selectProject = useEvent((path: string | null): Promise<void> => {
    projects.select(path);
    durableDraft.persist({
      settings: settingsModel.settings,
      workspace: path,
      workspaceMode: { kind: "current" },
    });
    clearErrors();
    return Promise.resolve();
  });
  const selectWorkspaceMode = useEvent((selection: WorkspaceModeSelection) => {
    projects.selectMode(selection);
    durableDraft.persist({
      settings: settingsModel.settings,
      workspace,
      workspaceMode: selection,
    });
    clearErrors();
  });
  const selectModel = useEvent((id: string): void => {
    const next = settingsModel.selectModel(id);
    if (next === null) {
      surfaces.setError("Model settings are unavailable.");
      return;
    }
    durableDraft.persist({
      settings: next,
      workspace,
      workspaceMode: projects.workspaceMode,
    });
    clearErrors();
  });
  const selectPermissions = useEvent((id: string): void => {
    const next = settingsModel.selectPermissions(id);
    if (next === null) {
      surfaces.setError("Permission settings are unavailable.");
      return;
    }
    durableDraft.persist({
      settings: next,
      workspace,
      workspaceMode: projects.workspaceMode,
    });
    clearErrors();
  });
  const addTranscript = useEvent((text: string) => {
    const next = message.trim() === "" ? text : `${message.trimEnd()} ${text}`;
    replaceMessage(next);
  });
  const voiceScope = { id: `new-thread:${input.savedServerId}`, kind: "composer" as const };
  const voice = useVoiceInputControl({
    audience: input.savedServerId,
    live: !connectionLocked && projectionSnapshot.value.projections.live !== null,
    onSubmitTranscript: submission.submitVoice,
    onTranscript: addTranscript,
    projection: projectionSnapshot.value.projections.live,
    scope: voiceScope,
    thread: null,
  });
  const voiceLevel = useVoiceInputLevel(input.savedServerId, voiceScope);
  const currentDate = useEvent(() => new Date(runtime.now()));
  return {
    attachmentDraft,
    closeDrawing: surfaces.closeDrawing,
    closeSkills: surfaces.closeSkills,
    currentDate,
    drawingRequest: surfaces.drawingRequest,
    onDrawingAttached: surfaces.closeDrawing,
    onSelectSkill: surfaces.onSelectSkill,
    skillsVisible: surfaces.skillsVisible,
    skillsWorkspace: workspace,
    view: {
      composerTarget,
      connectionError:
        input.projectionOpeningError ??
        (projectionSnapshot.status === "error" ? projectionSnapshot.message : null),
      connectionLoading: connectionLocked,
      contextItems: newThreadContextItems({
        error: settingsModel.error,
        loading: settingsModel.loading,
        models: settingsModel.models,
        onSelectModel: selectModel,
        onSelectPermissions: selectPermissions,
        selection: settingsModel.settings,
      }),
      draftLocked: interaction.composerLocked,
      error: surfaces.actionError ?? submission.error,
      locallyLocked: submission.locallyLocked,
      menuActions: newThreadComposerActions(workspace),
      message,
      onAddProject: projects.add,
      onEdit: clearErrors,
      onEditAttachment: surfaces.editDrawing,
      onOpenProjectPicker: projects.openPicker,
      onPinProject: projects.pin,
      onProjectPickerChange: projects.closePicker,
      onReleaseUnsettled: submission.releaseUnsettled,
      onSelectComposerAction: surfaces.selectAction,
      onSelectProject: selectProject,
      onSelectWorkspaceMode: selectWorkspaceMode,
      onSubmit: submission.submit,
      onTextChange: editMessage,
      projectLoading: projects.loading,
      projectMutationsLocked: interaction.projectMutationsLocked,
      projectPickerVisible: projects.pickerVisible,
      projectSelectionLocked: interaction.projectSelectionLocked,
      projects: projects.projects,
      projectStatus: projects.status,
      retryBlocked: submission.retryBlocked,
      savedServerId: input.savedServerId,
      unsettledCount: submission.unsettledCount,
      voice,
      voiceLevel,
      voiceNowMs: runtime.now(),
      workspace,
      workspaceMode: projects.workspaceMode,
    },
  };
}
