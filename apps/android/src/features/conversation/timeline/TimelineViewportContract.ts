import type { LegendListRenderItemProps } from "@legendapp/list/react-native";
import type { Dispatch, ReactElement, RefObject, SetStateAction } from "react";
import type { EdgeInsets } from "react-native-safe-area-context";
import type { ThreadHistoryViewport } from "../../../data/use-thread-history-controller";
import type {
  ThreadTimelineListRef,
  TimelineInitialPosition,
} from "../../../rendering/ThreadTimelineList";
import type { TimelineItem } from "./timelineTypes";

/** Content, measurements, and controls owned by the timeline viewport. */
export type TimelineViewportProps = {
  footerContent: ReactElement | null;
  emptyContent: ReactElement | null;
  composerScope: string;
  timelineRef: RefObject<ThreadTimelineListRef | null>;
  displayedTimeline: TimelineItem[];
  timelineInitialPosition: TimelineInitialPosition;
  threadSearch: string;
  threadSearchMatch: number;
  windowLayout: Readonly<{
    width: number;
    height: number;
    scale: number;
    fontScale: number;
    measurementRevision: string;
    desktop: boolean;
  }>;
  timelineCompact: boolean;
  bottomChromeHeight: number;
  liveStatusVisible: boolean;
  threadSearchVisible: boolean;
  conversationInsets: EdgeInsets;
  fullscreenCovered: boolean;
  historyViewport: ThreadHistoryViewport;
  awayFromLatest: boolean;
  threadSearchActive: boolean;
  inlineQueueExpanded: boolean;
  draftConnectionId: string | null;
  draftThreadId: string | null;
  commitInitialTimelineLoad: () => void;
  timelineViewportHeightRef: { current: number };
  reportHistoryViewport: () => void;
  scheduleUnreadAgentVisibilityCheck: () => void;
  setTimelineGestureActive: Dispatch<SetStateAction<boolean>>;
  fullscreenScrollOwnership: {
    isCovered: () => boolean;
    willOpen(id: string): void;
    didClose(id: string): void;
  };
  cancelScheduledPaginationTrim: () => void;
  paginationEdgeLockRef: { current: "older" | "newer" | null };
  scrollGestureStartedAtRef: { current: number | null };
  lastTimelineOffsetYRef: { current: number | null };
  firstVisibleHistoryAnchorRef: { current: string | null };
  timelineContentHeightRef: { current: number };
  scrollOffsetRef: { current: number };
  awayFromLatestRef: { current: boolean };
  setAwayFromLatest: Dispatch<SetStateAction<boolean>>;
  persistTimelineAtEnd: () => void;
  schedulePaginationWindowTrim: () => void;
  persistTimelineOffset: (offset: number) => void;
  trimPaginationWindow: () => void;
  timelinePositioned: boolean;
  loadOlderAtTimelineStart: () => void;
  loadNewerAtTimelineEnd: () => void;
  onTimelineFirstVisibleItemChanged: ({
    index,
    item,
  }: {
    index: number;
    item: TimelineItem;
    key: string;
  }) => void;

  renderTimelineItem: ({ item }: LegendListRenderItemProps<TimelineItem>) => ReactElement;
};
