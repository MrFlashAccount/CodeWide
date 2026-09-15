import { readFileSync } from "node:fs";

export const legacyRemoteStore = readFileSync(
  new URL("../../src/data/legacy-remote-store.native.ts", import.meta.url),
  "utf8",
);
export const privateAsset = readFileSync(
  new URL("../../src/data/private-transfer.ts", import.meta.url),
  "utf8",
);
export const voiceWorkspace = readFileSync(
  new URL("../../src/data/workspace-runtime.ts", import.meta.url),
  "utf8",
);
export const fileTransferController = readFileSync(
  new URL("../../src/data/file-transfer-controller.ts", import.meta.url),
  "utf8",
);
export const uiCachePersistence = readFileSync(
  new URL("../../src/data/ui-cache-persistence.native.ts", import.meta.url),
  "utf8",
);
export const connectionProfileDatabase = readFileSync(
  new URL("../../src/data/connection-profile-database.native.ts", import.meta.url),
  "utf8",
);
export const connectionStateModel = readFileSync(
  new URL("../../src/data/connection-state-model.ts", import.meta.url),
  "utf8",
);
export const pendingRequestDatabase = readFileSync(
  new URL("../../src/data/pending-request-database.native.ts", import.meta.url),
  "utf8",
);
export const otaPrefetch = readFileSync(
  new URL("../../src/data/use-ota-prefetch.ts", import.meta.url),
  "utf8",
);
export const sessionOwner = readFileSync(
  new URL("../../src/data/workspace-session.ts", import.meta.url),
  "utf8",
);
export const turnControlsOwner = readFileSync(
  new URL("../../src/data/turn-controls-loader.ts", import.meta.url),
  "utf8",
);
export const ownerConnectionRuntime = readFileSync(
  new URL("../../src/data/connection-runtime.ts", import.meta.url),
  "utf8",
);
export const ownerCatalogLifecycle = readFileSync(
  new URL("../../src/data/catalog-lifecycle.ts", import.meta.url),
  "utf8",
);
export const ownerWorkspaceRuntime = readFileSync(
  new URL("../../src/data/workspace-runtime.ts", import.meta.url),
  "utf8",
);
