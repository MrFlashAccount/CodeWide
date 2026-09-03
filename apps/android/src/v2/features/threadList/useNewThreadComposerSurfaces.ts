import type { V2InputBlock } from "@codewide/sync-client/v2";
import { useState } from "react";

import { useEvent } from "../../../react/useEvent";
import type { ComposerAttachmentDraftItem } from "../../application/composer/composerAttachmentTypes";
import {
  insertSkillInvocation,
  type SkillCatalogEntry,
} from "../../application/skills/skillSelection";
import type { SavedServerId } from "../../domain/ids";
import { drawingWorkspaceRequest } from "../drawing/drawingDraft";
import type { DrawingWorkspaceRequest } from "../drawing/DrawingWorkspace";
import {
  actionFailure,
  composerActionLabel,
  isNewThreadComposerAction,
  type NewThreadComposerAction,
  type NewThreadComposerActionContext,
} from "./newThreadComposerActions";

interface UseNewThreadComposerSurfacesInput {
  message: string;
  onComposerAction?(
    action: NewThreadComposerAction,
    context: NewThreadComposerActionContext,
  ): void | Promise<void>;
  onMessageChange(message: string): void;
  savedServerId: SavedServerId;
  workspace: string | null;
}

export interface NewThreadComposerSurfaces {
  actionError: string | null;
  actionPending: boolean;
  clearError(): void;
  closeDrawing(): void;
  closeSkills(): void;
  drawingRequest: DrawingWorkspaceRequest | null;
  editDrawing(item: ComposerAttachmentDraftItem): void;
  onSelectSkill(skill: SkillCatalogEntry): void;
  resetSkillBlocks(): void;
  selectAction(id: string): void;
  setError(message: string): void;
  skillBlocks: readonly V2InputBlock[];
  skillsVisible: boolean;
}

/** Owns temporary New Thread sheets and composer-menu actions. */
export function useNewThreadComposerSurfaces(
  input: UseNewThreadComposerSurfacesInput,
): NewThreadComposerSurfaces {
  const [skillBlocks, setSkillBlocks] = useState<V2InputBlock[]>([]);
  const [drawingRequest, setDrawingRequest] = useState<DrawingWorkspaceRequest | null>(null);
  const [skillsVisible, setSkillsVisible] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionPending, setActionPending] = useState(false);
  const clearError = useEvent(() => setActionError(null));
  const setError = useEvent((message: string) => setActionError(message));
  const resetSkillBlocks = useEvent(() => setSkillBlocks([]));
  const closeDrawing = useEvent(() => setDrawingRequest(null));
  const closeSkills = useEvent(() => setSkillsVisible(false));
  const onSelectSkill = useEvent((skill: SkillCatalogEntry) => {
    const invocation = insertSkillInvocation(
      input.message,
      { end: input.message.length, start: input.message.length },
      skill,
    );
    input.onMessageChange(invocation.text);
    setSkillBlocks((current) => {
      const retained = current.filter(
        (block) => block.kind !== "skill" || block.path !== skill.path,
      );
      retained.push(invocation.block);
      return retained;
    });
    setSkillsVisible(false);
  });
  const editDrawing = useEvent((item: ComposerAttachmentDraftItem) => {
    const request = drawingWorkspaceRequest(item);
    if (request === null) {
      setActionError("This attachment cannot be edited.");
      return;
    }
    setDrawingRequest(request);
  });
  const selectAction = useEvent((id: string): void => {
    if (!isNewThreadComposerAction(id)) return;
    if (id === "drawing") {
      setDrawingRequest({ draftItemId: null, initialSnapshot: null, mode: "drawing" });
      return;
    }
    if (id === "skills") {
      if (input.workspace === null) {
        setActionError("Select a project before choosing a skill.");
        return;
      }
      setSkillsVisible(true);
      return;
    }
    if (input.onComposerAction === undefined) {
      setActionError(`${composerActionLabel(id)} is unavailable before the thread is created.`);
      return;
    }
    if (actionPending) return;
    setActionError(null);
    setActionPending(true);
    void Promise.resolve()
      .then(() =>
        input.onComposerAction?.(id, {
          savedServerId: input.savedServerId,
          workspace: input.workspace,
        }),
      )
      .then(
        () => setActionPending(false),
        (cause: unknown) => {
          setActionError(
            actionFailure(cause, `Could not open ${composerActionLabel(id).toLocaleLowerCase()}.`),
          );
          setActionPending(false);
        },
      );
  });
  return {
    actionError,
    actionPending,
    clearError,
    closeDrawing,
    closeSkills,
    drawingRequest,
    editDrawing,
    onSelectSkill,
    resetSkillBlocks,
    selectAction,
    setError,
    skillBlocks,
    skillsVisible,
  };
}
