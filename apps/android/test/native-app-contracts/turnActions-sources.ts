import { readFileSync } from "node:fs";

export const copySession = readFileSync(
  new URL("../../src/features/turnActions/turnActions.ts", import.meta.url),
  "utf8",
);
export const threadHeaderView = readFileSync(
  new URL("../../src/features/turnActions/ThreadActions.tsx", import.meta.url),
  "utf8",
);
export const migratedThreadHeaderActions = readFileSync(
  new URL("../../src/features/turnActions/threadHeaderActions.ts", import.meta.url),
  "utf8",
);
export const turnWorkspaceAdapter = readFileSync(
  new URL("../../src/features/turnActions/workspaceAdapter.ts", import.meta.url),
  "utf8",
);
export const turnActionsAdapter = readFileSync(
  new URL("../../src/features/turnActions/workspaceAdapter.ts", import.meta.url),
  "utf8",
);
