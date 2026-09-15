import { readFileSync } from "node:fs";

export const navigationActions = readFileSync(
  new URL("../../src/features/navigation/navigationActions.ts", import.meta.url),
  "utf8",
);
export const conversationNavigation = readFileSync(
  new URL("../../src/features/navigation/conversationNavigationActions.ts", import.meta.url),
  "utf8",
);
export const threadServerSelection = readFileSync(
  new URL("../../src/features/navigation/serverSelection.ts", import.meta.url),
  "utf8",
);
