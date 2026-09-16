import type { TurnControlsValue } from "../../data/turn-controls-types";
import type { VoiceInputController } from "../../data/voice-input-controller";
import type { useComposerDraftCommands, useComposerDraftState } from "./draft";
import type { useComposerSettings } from "./settings";
/** Skill insertion and editor changes update the existing draft and selection owners. */
export type ComposerSuggestionsCapabilities = Pick<
  ReturnType<typeof useComposerDraftState>,
  "latestComposerPreferencesRef" | "composerInputRef" | "draftSelectionRef" | "draft"
> &
  Pick<
    ReturnType<typeof useComposerSettings>,
    "updateComposerPreferences" | "currentControlsResource"
  > & {
    composerScope: string;
    cwd: string;
    onLoadControls: ((cwd: string) => Promise<TurnControlsValue>) | undefined;
    updateDraft: ReturnType<typeof useComposerDraftCommands>["updateDraft"];
    voiceController: VoiceInputController | null;
  };
