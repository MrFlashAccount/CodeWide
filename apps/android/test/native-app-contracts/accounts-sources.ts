import { readFileSync } from "node:fs";

export const accountWorkspaceAdapter = readFileSync(
  new URL("../../src/features/accounts/workspaceAdapter.ts", import.meta.url),
  "utf8",
);
