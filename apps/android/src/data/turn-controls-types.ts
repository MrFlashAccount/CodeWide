import type { CatalogSkill } from "./skill-catalog-types";
import type { AgentProviderId } from "./threadAgent";

export type TurnControlsValue = {
  defaults: {
    effort: string | null;
    model: string | null;
    permissions: string | null;
    serviceTier?: string | null;
  };
  models: Array<{
    defaultEffort: string;
    defaultServiceTier?: string | null;
    efforts: string[];
    id: string;
    isDefault: boolean;
    label: string;
    /** `model/list` `codewideAgentProvider`; `null` from a legacy single-provider Companion. */
    provider: AgentProviderId | null;
    serviceTiers?: Array<{ description: string; id: string; name: string }>;
    supportsPersonality: boolean;
  }>;
  permissions: Array<{
    allowed: boolean;
    description: string | null;
    id: string;
    /** `permissionProfile/list` `codewideAgentProviders`; `null` when not annotated. */
    providers: readonly AgentProviderId[] | null;
  }>;
  skills: CatalogSkill[];
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
