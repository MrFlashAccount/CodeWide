import { readFileSync } from "node:fs";

export const ownerUseWindowLayout = readFileSync(
  new URL("../../src/features/workspace/useWindowLayout.ts", import.meta.url),
  "utf8",
);
export const ownerNewServerRoute = readFileSync(
  new URL("../../app/v1/settings/servers/new/index.tsx", import.meta.url),
  "utf8",
);
export const ownerWorkspaceLayout = readFileSync(
  new URL("../../app/v1/V1WorkspaceShell.tsx", import.meta.url),
  "utf8",
);
export const ownerWorkspaceComposition = readFileSync(
  new URL("../../app/v1/V1WorkspaceRouteComposition.tsx", import.meta.url),
  "utf8",
);
export const ownerSettingsRoute = readFileSync(
  new URL("../../app/v1/settings/index.tsx", import.meta.url),
  "utf8",
);
export const ownerNewThreadRoute = readFileSync(
  new URL("../../app/v1/new/index.tsx", import.meta.url),
  "utf8",
);
export const ownerWorkspaceThreadList = readFileSync(
  new URL("../../src/features/workspace/WorkspaceThreadList.tsx", import.meta.url),
  "utf8",
);
