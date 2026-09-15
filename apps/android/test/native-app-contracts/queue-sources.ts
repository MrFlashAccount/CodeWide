import { readFileSync } from "node:fs";

export const migratedQueueFeature = readFileSync(
  new URL("../../src/features/queue/QueueFeature.tsx", import.meta.url),
  "utf8",
);
export const queueWorkspaceAdapter = readFileSync(
  new URL("../../src/features/queue/workspaceAdapter.ts", import.meta.url),
  "utf8",
);
