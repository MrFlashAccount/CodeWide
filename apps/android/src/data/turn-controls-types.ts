export type TurnControlsValue = {
  models: Array<{ id: string; label: string; defaultEffort: string; efforts: string[]; supportsPersonality: boolean }>;
  skills: Array<{ name: string; path: string; description: string; enabled: boolean }>;
  permissions: Array<{ id: string; description: string | null; allowed: boolean }>;
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
