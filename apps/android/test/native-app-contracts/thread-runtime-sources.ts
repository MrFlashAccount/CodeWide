import { readFileSync } from "node:fs";

export const threadChatProjection = readFileSync(
  new URL("../../src/data/thread-chat-projection.ts", import.meta.url),
  "utf8",
);
export const threadSummaryDatabase = readFileSync(
  new URL("../../src/data/thread-summary-database.native.ts", import.meta.url),
  "utf8",
);
export const threadSummarySqlite = readFileSync(
  new URL("../../src/data/thread-summary-sqlite.native.ts", import.meta.url),
  "utf8",
);
export const threadDetailDatabase = readFileSync(
  new URL("../../src/data/thread-detail-database.native.ts", import.meta.url),
  "utf8",
);
export const threadDetailProjection = readFileSync(
  new URL("../../src/data/thread-detail-projection.ts", import.meta.url),
  "utf8",
);
export const threadProjectionStore = readFileSync(
  new URL("../../src/data/thread-projection-store.ts", import.meta.url),
  "utf8",
);
export const threadUiStateDatabase = readFileSync(
  new URL("../../src/data/thread-ui-state-database.native.ts", import.meta.url),
  "utf8",
);
export const ownerThreadSyncRuntime = readFileSync(
  new URL("../../src/data/thread-sync-runtime.ts", import.meta.url),
  "utf8",
);
export const ownerThreadSyncForeground = readFileSync(
  new URL("../../src/data/thread-sync-foreground.ts", import.meta.url),
  "utf8",
);
export const ownerThreadSyncItems = readFileSync(
  new URL("../../src/data/thread-sync-items.ts", import.meta.url),
  "utf8",
);
export const ownerThreadSyncHistory = readFileSync(
  new URL("../../src/data/thread-sync-history.ts", import.meta.url),
  "utf8",
);
export const ownerThreadSyncRemoteLoader = readFileSync(
  new URL("../../src/data/thread-sync-remote-loader.ts", import.meta.url),
  "utf8",
);
export const ownerCommandDelivery = readFileSync(
  new URL("../../src/data/command-delivery.ts", import.meta.url),
  "utf8",
);
export const ownerThreadSyncProjection = readFileSync(
  new URL("../../src/data/thread-sync-projection.ts", import.meta.url),
  "utf8",
);
export const reconnectOwner = readFileSync(
  new URL("../../src/data/thread-sync-reconnect.ts", import.meta.url),
  "utf8",
);
