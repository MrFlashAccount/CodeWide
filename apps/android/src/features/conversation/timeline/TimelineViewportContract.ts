import type { LegendListRenderItemProps } from "@legendapp/list/react-native";
import type { Dispatch, ReactElement, RefObject, SetStateAction } from "react";
import type { View } from "react-native";
import type { EdgeInsets } from "react-native-safe-area-context";
import type { ThreadHistoryViewport } from "../../../data/use-thread-history-controller";
import type { ThreadTimelineListRef } from "../../../rendering/ThreadTimelineList";
import type { TimelineItem } from "./timelineTypes";
import type { TimelineJumpRequest } from "./timelineJump";
import type { TimelineJumpVisibility } from "./timelineJumpVisibility";
import type { TimelineRow } from "./timelineRows";

/** Content, measurements, and controls owned by the timeline viewport. */
export type TimelineViewportProps = {
  awayFromLatest: boolean;
  awayFromLatestRef: { current: boolean };
  bottomChromeHeight: number;
  cancelScheduledPaginationTrim: () => void;
  commitInitialTimelineLoad: () => void;
  completeTimelineJump: (requestId: number) => void;
  composerScope: string;
  conversationInsets: EdgeInsets;
  displayedTimeline: TimelineItem[];
  draftConnectionId: string | null;
  draftThreadId: string | null;
  emptyContent: ReactElement | null;
  firstVisibleHistoryAnchorRef: { current: string | null };
  footerContent: ReactElement | null;
  fullscreenCovered: boolean;
  fullscreenScrollOwnership: {
    didClose: (id: string) => void;
    isCovered: () => boolean;
    willOpen: (id: string) => void;
  };
  historyViewport: ThreadHistoryViewport;
  inlineQueueExpanded: boolean;
  jumpVisibility: TimelineJumpVisibility;
  lastTimelineOffsetYRef: { current: number | null };
  latestUnreadAgentRef: RefObject<View | null>;
  latestUnreadAgentTurnId: string | null;
  liveStatusVisible: boolean;
  loadNewerAtTimelineEnd: () => void;
  loadOlderAtTimelineStart: () => void;
  newChat: boolean;
  onTimelineFirstVisibleItemChanged: ({
    index,
    item,
  }: {
    index: number;
    item: TimelineItem;
    key: string;
  }) => void;
  paginationEdgeLockRef: { current: "older" | "newer" | null };
  persistTimelineAtEnd: () => void;
  persistTimelineOffset: (offset: number) => void;
  renderTimelineItem: ({ item }: LegendListRenderItemProps<TimelineRow>) => ReactElement;
  reportHistoryViewport: () => void;
  schedulePaginationWindowTrim: () => void;
  scheduleUnreadAgentVisibilityCheck: () => void;
  scrollGestureStartedAtRef: { current: number | null };
  scrollOffsetRef: { current: number };
  searchMessageItemId: string | null;
  setAwayFromLatest: Dispatch<SetStateAction<boolean>>;
  setTimelineGestureActive: Dispatch<SetStateAction<boolean>>;
  threadSearch: string;
  threadSearchActive: boolean;
  threadSearchMatch: number;
  threadSearchVisible: boolean;
  timelineCompact: boolean;
  timelineContentHeightRef: { current: number };
  timelineJumpRequest: TimelineJumpRequest | null;
  timelinePositioned: boolean;
  timelineRef: RefObject<ThreadTimelineListRef | null>;
  timelineViewportHeightRef: { current: number };
  timelineViewportRef: RefObject<View | null>;
  trimPaginationWindow: () => void;

  windowLayout: Readonly<{
    desktop: boolean;
    fontScale: number;
    height: number;
    measurementRevision: string;
    scale: number;
    width: number;
  }>;
};
