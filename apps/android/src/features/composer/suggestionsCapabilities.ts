import type { Dispatch, SetStateAction } from "react";
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
    updateDraft: ReturnType<typeof useComposerDraftCommands>["updateDraft"];
    voiceController: VoiceInputController | null;
    composerScope: string;
    cwd: string;
    setMenuVisible: Dispatch<SetStateAction<boolean>>;
    onLoadControls: ((cwd: string) => Promise<TurnControlsValue>) | undefined;
  };
