import type { Personality } from "@codewide/codex-protocol/v0.155.1";
import type { TurnControlsValue } from "../../../data/turn-controls-types";
import type { ComposerMenuPage } from "../composerTypes";

/** State and commands exposed by the composer's control-options page. */
export type ComposerControlOptionsProps = {
  controls: TurnControlsValue;
  onSelectEffort: (effort: string) => void;
  onSelectModel: (model: string, effort: string) => void;
  onSelectPermissions: (permissions: string | null) => void;
  onSelectPersonality: (personality: Personality | null) => void;
  page: ComposerMenuPage;
  selectedEffort: string | null;
  selectedModel: string | null;
  selectedPermissions: string | null;
  selectedPersonality: Personality | null;
};
