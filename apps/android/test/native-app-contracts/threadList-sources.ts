import { readFileSync } from "node:fs";

export const threadRow = readFileSync(
  new URL("../../src/features/threadList/ThreadRow.tsx", import.meta.url),
  "utf8",
);
export const threadRowActions = readFileSync(
  new URL("../../src/features/threadList/threadRowActions.ts", import.meta.url),
  "utf8",
);
export const threadRowWebMenu = readFileSync(
  new URL("../../src/features/threadList/ThreadRowWebMenu.tsx", import.meta.url),
  "utf8",
);
export const threadSidebarHeader = readFileSync(
  new URL("../../src/features/threadList/ThreadSidebarHeader.tsx", import.meta.url),
  "utf8",
);
export const mobileThreadsHeader = readFileSync(
  new URL("../../src/features/threadList/MobileThreadsHeader.tsx", import.meta.url),
  "utf8",
);
export const listMenus = readFileSync(
  new URL("../../src/features/threadList/ThreadListMenus.tsx", import.meta.url),
  "utf8",
);
export const migratedThreadListWorkspace = readFileSync(
  new URL("../../src/features/threadList/threadListWorkspace.ts", import.meta.url),
  "utf8",
);
export const migratedThreadListProjection = readFileSync(
  new URL("../../src/features/threadList/threadListProjection.ts", import.meta.url),
  "utf8",
);
export const migratedMobileThreads = readFileSync(
  new URL("../../src/features/threadList/MobileThreads.tsx", import.meta.url),
  "utf8",
);
export const migratedThreadRowContent = readFileSync(
  new URL("../../src/features/threadList/ThreadRowContent.tsx", import.meta.url),
  "utf8",
);
export const migratedThreadRowStyles = readFileSync(
  new URL("../../src/features/threadList/ThreadRow.styles.ts", import.meta.url),
  "utf8",
);
export const migratedThreadSwipeActions = readFileSync(
  new URL("../../src/features/threadList/ThreadSwipeActions.tsx", import.meta.url),
  "utf8",
);
export const migratedThreadListModel = readFileSync(
  new URL("../../src/features/threadList/threadListModel.ts", import.meta.url),
  "utf8",
);
export const threadSidebarBody = readFileSync(
  new URL("../../src/features/threadList/ThreadSidebar.tsx", import.meta.url),
  "utf8",
);
