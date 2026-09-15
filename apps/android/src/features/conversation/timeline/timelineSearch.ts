/** V1 timelineSearch owner, extracted without changing interaction or resource lifetime. */
import { projectedTurnMetadata } from "@codewide/sync-client";
import { boundedJsonStringify } from "../../../rendering/bounded-json";
import { timelineSearchTextCache } from "./timelineProjection";
import type { TimelineItem } from "./timelineTypes";

export function timelineSearchText(item: TimelineItem): string {
  const cached = timelineSearchTextCache.get(item);
  if (cached !== undefined) return cached;
  const value =
    item.kind === "turn"
      ? [
          ...item.turn.items.map((rawItem) => {
            if (rawItem.type === "userMessage")
              return rawItem.content
                .map((content) =>
                  "text" in content ? content.text : boundedJsonStringify(content, 8_192),
                )
                .join("\n");
            if (rawItem.type === "agentMessage") return rawItem.text;
            return boundedJsonStringify(rawItem, 16_384);
          }),
          boundedJsonStringify(projectedTurnMetadata(item.turn) ?? {}, 8_192),
        ].join("\n")
      : item.kind === "optimistic"
        ? item.text
        : item.status;
  timelineSearchTextCache.set(item, value);
  return value;
}

import { useRef } from "react";
import { useEvent } from "../../../react/useEvent";
import { useConversationRef, useConversationState } from "../../../ui/use-conversation-scope";
import { SearchConversationWindow } from "../../search/search-conversation-window";

export function useTimelineSearchState(
  composerScope: string,
  searchWindow: SearchConversationWindow | null,
) {
  const [threadSearchVisible, setThreadSearchVisible] = useConversationState(
    composerScope,
    () => false,
  );

  const [threadSearch, setThreadSearch] = useConversationState(composerScope, () => "");

  const [threadSearchMatch, setThreadSearchMatch] = useConversationState(composerScope, () => 0);

  const timelineIndexRetryTimerRef = useConversationRef<ReturnType<typeof setTimeout> | null>(
    composerScope,
    () => null,
  );

  const searchOriginOffsetRef = useConversationRef<number | null>(composerScope, () => null);

  const searchTimelineScope = `${composerScope}:search:${searchWindow?.target.hit.messageId ?? "live"}`;

  const focusedSearchMessageRef = useRef<SearchConversationWindow | null>(null);

  const positionedSearchWindowRef = useRef<SearchConversationWindow | null>(null);

  const isCurrentSearchWindow = useEvent(
    (window: SearchConversationWindow) => window === searchWindow,
  );
  return {
    threadSearchVisible,
    threadSearch,
    threadSearchMatch,
    timelineIndexRetryTimerRef,
    searchOriginOffsetRef,
    searchTimelineScope,
    focusedSearchMessageRef,
    positionedSearchWindowRef,
    isCurrentSearchWindow,
    setThreadSearchVisible,
    setThreadSearch,
    setThreadSearchMatch,
  };
}

import { useDeferredValue } from "react";
import { View } from "react-native";
import { spacing } from "../../../theme";
import { useTimelineViewportState } from "./timelineViewport";

export function useTimelineSearchProjection(threadSearch: string, timeline: TimelineItem[]) {
  const deferredThreadSearch = useDeferredValue(threadSearch);

  const threadSearchMatches = (() => {
    const query = deferredThreadSearch.trim().toLocaleLowerCase();
    if (query === "") return [];
    return timeline.flatMap((item, index) =>
      timelineSearchText(item).toLocaleLowerCase().includes(query) ? [index] : [],
    );
  })();

  const threadSearchActive = threadSearch.trim() !== "";

  const displayedTimeline = threadSearchActive
    ? threadSearchMatches.flatMap((index) =>
        timeline[index] === undefined ? [] : [timeline[index]],
      )
    : timeline;
  return { threadSearchMatches, threadSearchActive, displayedTimeline };
}

export function useTimelineSearchActions({
  focusedSearchMessageRef,
  positionedSearchWindowRef,
  isCurrentSearchWindow,
  searchOriginOffsetRef,
  timelineIndexRetryTimerRef,
  threadSearchMatch,
  setThreadSearch,
  setThreadSearchVisible,
  setThreadSearchMatch,
  timelineViewportRef,
  timelineRef,
  lastTimelineOffsetYRef,
  timelineContentHeightRef,
  timelineViewportHeightRef,
  scrollOffsetRef,
  searchWindow,
  timelineModelReady,
  threadSearchMatches,
  threadSearchActive,
  displayedTimeline,
}: Pick<
  ReturnType<typeof useTimelineSearchState>,
  | "focusedSearchMessageRef"
  | "positionedSearchWindowRef"
  | "isCurrentSearchWindow"
  | "searchOriginOffsetRef"
  | "timelineIndexRetryTimerRef"
  | "threadSearchMatch"
  | "setThreadSearch"
  | "setThreadSearchVisible"
  | "setThreadSearchMatch"
> &
  Pick<
    ReturnType<typeof useTimelineViewportState>,
    | "timelineViewportRef"
    | "timelineRef"
    | "lastTimelineOffsetYRef"
    | "timelineContentHeightRef"
    | "timelineViewportHeightRef"
    | "scrollOffsetRef"
  > &
  ReturnType<typeof useTimelineSearchProjection> & {
    searchWindow: SearchConversationWindow | null;
    timelineModelReady: boolean;
  }) {
  const focusSearchMessage = useEvent((node: View) => {
    const window = searchWindow;
    if (window === null || focusedSearchMessageRef.current === window) return;
    requestAnimationFrame(() => {
      const viewport = timelineViewportRef.current;
      if (
        viewport === null ||
        !isCurrentSearchWindow(window) ||
        focusedSearchMessageRef.current === window
      )
        return;
      viewport.measureInWindow((_x, viewportY) =>
        node.measureInWindow((_nodeX, nodeY) => {
          if (!isCurrentSearchWindow(window) || focusedSearchMessageRef.current === window) return;
          focusedSearchMessageRef.current = window;
          void timelineRef.current?.scrollToOffset({
            offset: Math.max(
              0,
              (lastTimelineOffsetYRef.current ?? 0) + nodeY - viewportY - spacing.md,
            ),
            animated: false,
          });
        }),
      );
    });
  });

  const positionSearchTurn = useEvent(() => {
    if (
      searchWindow === null ||
      !timelineModelReady ||
      timelineRef.current === null ||
      positionedSearchWindowRef.current === searchWindow ||
      focusedSearchMessageRef.current === searchWindow
    )
      return;
    const index = displayedTimeline.findIndex(
      (item) => item.kind === "turn" && item.id === searchWindow.target.hit.turnId,
    );
    if (index < 0) return;
    positionedSearchWindowRef.current = searchWindow;
    void timelineRef.current.scrollToIndex({ index, animated: false, viewPosition: 0 });
  });

  const scrollToThreadSearchIndex = useEvent((index: number) => {
    void timelineRef.current?.scrollToIndex({ index, animated: true, viewPosition: 0.3 });
  });

  const restoreThreadSearchOrigin = useEvent(() => {
    const offset = searchOriginOffsetRef.current;
    if (offset === null) return;
    searchOriginOffsetRef.current = null;
    if (timelineIndexRetryTimerRef.current !== null)
      clearTimeout(timelineIndexRetryTimerRef.current);
    timelineIndexRetryTimerRef.current = setTimeout(() => {
      timelineIndexRetryTimerRef.current = null;
      timelineRef.current?.scrollToOffset({
        offset: Math.max(
          0,
          timelineContentHeightRef.current - timelineViewportHeightRef.current - offset,
        ),
        animated: false,
      });
    }, 96);
  });

  const updateThreadSearch = useEvent((value: string) => {
    const nextActive = value.trim() !== "";
    if (!threadSearchActive && nextActive && searchOriginOffsetRef.current === null) {
      searchOriginOffsetRef.current = scrollOffsetRef.current;
    } else if (threadSearchActive && !nextActive) {
      restoreThreadSearchOrigin();
    }
    setThreadSearch(value);
  });

  const closeThreadSearch = useEvent(() => {
    updateThreadSearch("");
    setThreadSearchVisible(false);
  });

  const moveThreadSearch = useEvent((delta: -1 | 1) => {
    if (threadSearchMatches.length === 0) return;
    const next =
      (threadSearchMatch + delta + threadSearchMatches.length) % threadSearchMatches.length;
    setThreadSearchMatch(next);
    scrollToThreadSearchIndex(next);
  });
  return {
    focusSearchMessage,
    positionSearchTurn,
    scrollToThreadSearchIndex,
    updateThreadSearch,
    closeThreadSearch,
    moveThreadSearch,
  };
}
