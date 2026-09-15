import { readFileSync } from "node:fs";

export const connectionAdapter = readFileSync(
  new URL("../../src/features/connections/workspaceAdapter.ts", import.meta.url),
  "utf8",
);
export const connectionProjection = readFileSync(
  new URL("../../src/features/connections/connectionProjection.ts", import.meta.url),
  "utf8",
);
