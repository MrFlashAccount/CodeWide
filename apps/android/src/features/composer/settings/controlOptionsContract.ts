import type { Personality } from "@codewide/codex-protocol/v0.147.0";
import type { TurnControlsValue } from "../../../data/turn-controls-types";
import type { ComposerMenuPage } from "../composerTypes";
export type ComposerControlOptionsProps = {
  page: ComposerMenuPage;
  controls: TurnControlsValue;
  selectedModel: string | null;
  selectedEffort: string | null;
  selectedPersonality: Personality | null;
  selectedPermissions: string | null;
  onSelectModel(model: string, effort: string): void;
  onSelectEffort(effort: string): void;
  onSelectPersonality(personality: Personality | null): void;
  onSelectPermissions(permissions: string | null): void;
};
