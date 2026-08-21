export type TurnControlsValue = {
  models: Array<{ id: string; label: string; defaultEffort: string; efforts: string[]; supportsPersonality: boolean; isDefault: boolean }>;
  skills: Array<{ name: string; path: string; description: string; enabled: boolean }>;
  permissions: Array<{ id: string; description: string | null; allowed: boolean }>;
  defaults: {
    model: string | null;
    effort: string | null;
    permissions: string | null;
  };
};

export type TurnControlsRow = {
  id: string;
  connectionId: string;
  cwd: string;
  status: "loading" | "refreshing" | "ready" | "error";
  value: TurnControlsValue | null;
  error: string | null;
  updatedAt: number;
};
