import type { CatalogSkill } from "./skill-catalog-types";

export type TurnControlsValue = {
  defaults: {
    effort: string | null;
    model: string | null;
    permissions: string | null;
  };
  models: Array<{
    defaultEffort: string;
    efforts: string[];
    id: string;
    isDefault: boolean;
    label: string;
    supportsPersonality: boolean;
  }>;
  permissions: Array<{ allowed: boolean; description: string | null; id: string }>;
  skills: CatalogSkill[];
};

export type TurnControlsRow = {
  connectionId: string;
  cwd: string;
  error: string | null;
  id: string;
  status: "loading" | "refreshing" | "ready" | "error";
  updatedAt: number;
  value: TurnControlsValue | null;
};

import type { Personality } from "@codewide/codex-protocol/v0.147.0";
export type ThreadSettings = {
  effort?: string | null;
  model?: string | null;
  permissions?: string | null;
  personality?: Personality | null;
};
