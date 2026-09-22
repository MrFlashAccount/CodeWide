import { readFileSync } from "node:fs";

export const navigationActions = readFileSync(
  new URL("../../src/services/threads/threadNavigationService.ts", import.meta.url),
  "utf8",
);
