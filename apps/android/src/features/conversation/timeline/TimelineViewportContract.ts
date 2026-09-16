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
  awayFromLatest: boolean;
  awayFromLatestRef: { current: boolean };
  bottomChromeHeight: number;
  cancelScheduledPaginationTrim: () => void;
  commitInitialTimelineLoad: () => void;
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
  lastTimelineOffsetYRef: { current: number | null };
  liveStatusVisible: boolean;
  loadNewerAtTimelineEnd: () => void;
  loadOlderAtTimelineStart: () => void;
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
  renderTimelineItem: ({ item }: LegendListRenderItemProps<TimelineItem>) => ReactElement;
  reportHistoryViewport: () => void;
  schedulePaginationWindowTrim: () => void;
  scheduleUnreadAgentVisibilityCheck: () => void;
  scrollGestureStartedAtRef: { current: number | null };
  scrollOffsetRef: { current: number };
  setAwayFromLatest: Dispatch<SetStateAction<boolean>>;
  setTimelineGestureActive: Dispatch<SetStateAction<boolean>>;
  threadSearch: string;
  threadSearchActive: boolean;
  threadSearchMatch: number;
  threadSearchVisible: boolean;
  timelineCompact: boolean;
  timelineContentHeightRef: { current: number };
  timelineInitialPosition: TimelineInitialPosition;
  timelinePositioned: boolean;
  timelineRef: RefObject<ThreadTimelineListRef | null>;
  timelineViewportHeightRef: { current: number };
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
