import type { Personality } from "@codewide/codex-protocol/v0.155.1";
import type { TurnControlsValue } from "../../../data/turn-controls-types";
import type { ComposerMenuPage } from "../composerTypes";
import type { ComposerControlsView } from "./composerControlsView";

/** State and commands exposed by the composer's control-options page. */
export type ComposerControlOptionsProps = {
  controls: TurnControlsValue;
  onSelectEffort: (effort: string) => void;
  /** `effort` is `null` only for a model without thinking levels. */
  onSelectModel: (model: string, effort: string | null) => void;
  /** `null` selects a new chat's server default. */
  onSelectPermissions: (permissions: string | null) => void;
  onSelectPersonality: (personality: Personality | null) => void;
  page: ComposerMenuPage;
  selectedPersonality: Personality | null;
  /** The conversation's effective model, thinking and access values. */
  view: ComposerControlsView;
};
