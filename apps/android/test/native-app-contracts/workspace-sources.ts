import { readFileSync } from "node:fs";

export const ownerUseWindowLayout = readFileSync(
  new URL("../../src/features/workspace/useWindowLayout.ts", import.meta.url),
  "utf8",
);
export const ownerNewServerRoute = readFileSync(
  new URL("../../app/(workspace)/settings/servers/new/index.tsx", import.meta.url),
  "utf8",
);
export const ownerWorkspaceLayout = readFileSync(
  new URL("../../src/routeComposition/WorkspaceShell.tsx", import.meta.url),
  "utf8",
);
export const ownerWorkspaceStyles = readFileSync(
  new URL("../../src/routeComposition/WorkspaceShell.styles.ts", import.meta.url),
  "utf8",
);
export const ownerWorkspaceComposition = readFileSync(
  new URL("../../src/routeComposition/WorkspaceRouteComposition.tsx", import.meta.url),
  "utf8",
);
export const ownerSettingsRoute = readFileSync(
  new URL("../../app/(workspace)/settings/index.tsx", import.meta.url),
  "utf8",
);
export const ownerNewThreadRoute = readFileSync(
  new URL("../../app/(workspace)/new/index.tsx", import.meta.url),
  "utf8",
);
export const ownerWorkspaceThreadList = readFileSync(
  new URL("../../src/features/workspace/WorkspaceThreadList.tsx", import.meta.url),
  "utf8",
);
export const ownerThreadRouteLayout = readFileSync(
  new URL("../../app/(workspace)/threads/[connectionId]/[threadId]/_layout.tsx", import.meta.url),
  "utf8",
);
export const ownerNewThreadLayout = readFileSync(
  new URL("../../app/(workspace)/new/_layout.tsx", import.meta.url),
  "utf8",
);
export const ownerFullscreenRouteOverlay = readFileSync(
  new URL("../../src/components/navigation/RouteFullscreenOverlay.tsx", import.meta.url),
  "utf8",
);
export const ownerChangesRoute = readFileSync(
  new URL("../../app/(workspace)/threads/[connectionId]/[threadId]/changes/index.tsx", import.meta.url),
  "utf8",
);
export const ownerTurnChangesRoute = readFileSync(
  new URL(
    "../../app/(workspace)/threads/[connectionId]/[threadId]/changes/turns/[turnId].tsx",
    import.meta.url,
  ),
  "utf8",
);
export const ownerThreadContentRoute = readFileSync(
  new URL(
    "../../app/(workspace)/threads/[connectionId]/[threadId]/content/[sessionId].tsx",
    import.meta.url,
  ),
  "utf8",
);
export const ownerThreadDocumentRoute = readFileSync(
  new URL(
    "../../app/(workspace)/threads/[connectionId]/[threadId]/documents/[sessionId].tsx",
    import.meta.url,
  ),
  "utf8",
);
export const ownerBrowserRoute = readFileSync(
  new URL("../../app/(workspace)/browser/[sessionId].tsx", import.meta.url),
  "utf8",
);
export const ownerDrawingRoute = readFileSync(
  new URL("../../app/(workspace)/drawing/[sessionId].tsx", import.meta.url),
  "utf8",
);
export const ownerAgentsRoute = readFileSync(
  new URL("../../app/(workspace)/threads/[connectionId]/[threadId]/agents/index.tsx", import.meta.url),
  "utf8",
);
export const ownerTerminalRoute = readFileSync(
  new URL("../../app/(workspace)/threads/[connectionId]/[threadId]/terminal.tsx", import.meta.url),
  "utf8",
);
export const ownerDraftContentRoute = readFileSync(
  new URL("../../app/(workspace)/new/content/[sessionId].tsx", import.meta.url),
  "utf8",
);
export const ownerDraftDocumentRoute = readFileSync(
  new URL("../../app/(workspace)/new/documents/[sessionId].tsx", import.meta.url),
  "utf8",
);
