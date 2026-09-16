import { readFileSync } from "node:fs";

export const navigationActions = readFileSync(
  new URL("../../src/services/threads/threadNavigationService.ts", import.meta.url),
  "utf8",
);
export const conversationNavigation = readFileSync(
  new URL("../../app/v1/index.tsx", import.meta.url),
  "utf8",
);
export const threadServerSelection = readFileSync(
  new URL("../../src/features/workspace/workspaceListBindings.ts", import.meta.url),
  "utf8",
);
