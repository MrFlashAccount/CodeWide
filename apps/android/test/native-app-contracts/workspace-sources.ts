import { readFileSync } from "node:fs";

export const ownerUseWindowLayout = readFileSync(
  new URL("../../src/features/workspace/useWindowLayout.ts", import.meta.url),
  "utf8",
);
export const ownerWorkspaceOverlays = readFileSync(
  new URL("../../src/features/workspace/WorkspaceOverlays.tsx", import.meta.url),
  "utf8",
);
export const ownerWorkspaceScreen = readFileSync(
  new URL("../../src/features/workspace/WorkspaceScreen.tsx", import.meta.url),
  "utf8",
);
export const ownerWorkspaceThreadList = readFileSync(
  new URL("../../src/features/workspace/WorkspaceThreadList.tsx", import.meta.url),
  "utf8",
);
