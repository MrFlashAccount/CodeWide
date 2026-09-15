import type { ProjectedThreadExecutionSettings } from "@codewide/sync-client";
import type { TurnControlsValue } from "../../data/turn-controls-types";

interface ComposerModelSelection {
  readonly model: string | null;
  readonly effort: string | null;
}

/** Existing threads never borrow a model from local drafts or catalog defaults. */
export function composerModelSettings(
  newChat: boolean,
  server: ProjectedThreadExecutionSettings | null,
  draft: ComposerModelSelection,
  controls: TurnControlsValue,
): ComposerModelSelection {
  if (!newChat) return { model: server?.model ?? null, effort: server?.effort ?? null };
  const model =
    draft.model ??
    controls.defaults.model ??
    controls.models.find((candidate) => candidate.isDefault)?.id ??
    null;
  const effort =
    draft.effort ??
    (draft.model === null ? controls.defaults.effort : null) ??
    controls.models.find((candidate) => candidate.id === model)?.defaultEffort ??
    null;
  return { model, effort };
}
