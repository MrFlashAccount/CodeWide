import { readFileSync } from "node:fs";

export const ownerThreadTimeline = readFileSync(
  new URL("../../src/features/conversation/timeline/ThreadTimeline.tsx", import.meta.url),
  "utf8",
);
export const ownerTimelineProjection = readFileSync(
  new URL("../../src/features/conversation/timeline/timelineProjection.ts", import.meta.url),
  "utf8",
);
export const ownerTimelineViewport = readFileSync(
  new URL("../../src/features/conversation/timeline/TimelineViewport.tsx", import.meta.url),
  "utf8",
);
export const ownerOverlayScrollOwnership = readFileSync(
  new URL("../../src/features/conversation/timeline/overlayScrollOwnership.ts", import.meta.url),
  "utf8",
);
export const ownerUnreadReceipt = readFileSync(
  new URL("../../src/features/conversation/timeline/unreadReceipt.ts", import.meta.url),
  "utf8",
);
export const ownerJumpToLatest = readFileSync(
  new URL("../../src/features/conversation/timeline/JumpToLatest.tsx", import.meta.url),
  "utf8",
);
export const ownerTimelineViewportState = readFileSync(
  new URL("../../src/features/conversation/timeline/timelineViewport.ts", import.meta.url),
  "utf8",
);
export const ownerHistoryAnchor = readFileSync(
  new URL("../../src/features/conversation/timeline/historyAnchor.ts", import.meta.url),
  "utf8",
);
