import type { CatalogSkill } from "./skill-catalog-types";
import type { AgentProviderId } from "./threadAgent";

export type TurnControlsValue = {
  defaults: {
    effort: string | null;
    model: string | null;
    permissions: string | null;
    serviceTier?: string | null;
  };
  models: TurnControlsModel[];
  permissions: Array<{
    allowed: boolean;
    description: string | null;
    id: string;
    /** `permissionProfile/list` `codewideAgentProviders`; `null` when not annotated. */
    providers: readonly AgentProviderId[] | null;
  }>;
  skills: CatalogSkill[];
};

/**
 * Reasoning levels of one catalog model. A model either offers thinking levels
 * with a default (`efforts` may be empty when the catalog lists only the
 * default) or offers none: `defaultEffort: null` and no levels, as a Claude
 * model without effort support reports `defaultReasoningEffort: null`.
 */
export type TurnControlsModelReasoning =
  | { defaultEffort: string; efforts: string[] }
  | { defaultEffort: null; efforts: readonly [] };

/** One `model/list` row as the composer offers it. */
export type TurnControlsModel = TurnControlsModelReasoning & {
  defaultServiceTier?: string | null;
  id: string;
  isDefault: boolean;
  label: string;
  /** `model/list` `codewideAgentProvider`; `null` from a legacy single-provider Companion. */
  provider: AgentProviderId | null;
  serviceTiers?: Array<{ description: string; id: string; name: string }>;
  supportsPersonality: boolean;
};

export type TurnControlsSection = keyof TurnControlsValue;

export type TurnControlsLoadOptions =
  | { readonly mode?: "runtime" }
  | {
      readonly mode: "refresh";
      readonly sections: readonly TurnControlsSection[];
    };

export type LoadTurnControls = (
  cwd: string,
  options?: TurnControlsLoadOptions,
) => Promise<TurnControlsValue>;

export type TurnControlsRow = {
  connectionId: string;
  cwd: string;
  error: string | null;
  id: string;
  status: "loading" | "refreshing" | "ready" | "error";
  updatedAt: number;
  value: TurnControlsValue | null;
};

import type { Personality } from "@codewide/codex-protocol/v0.155.1";
export type ThreadSettings = {
  effort?: string | null;
  model?: string | null;
  permissions?: string | null;
  personality?: Personality | null;
  serviceTier?: string | null;
};
