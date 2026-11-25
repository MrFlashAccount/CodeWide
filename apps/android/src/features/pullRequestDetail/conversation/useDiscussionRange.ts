import { observable, type Observable } from "@legendapp/state";
import { useRef } from "react";
import type { LayoutChangeEvent, NativeScrollEvent, NativeSyntheticEvent } from "react-native";

import type { ReviewThreadId } from "../../../data/forgeConversationContract";
import { useConstant } from "../../../react/useConstant";
import { useEvent } from "../../../react/useEvent";
import type { Discussion } from "./discussionModel";

const PRELOAD_DISTANCE_DP = 200;
const BATCH_SIZE = 4;
const INITIAL_ITEMS = 8;

type DiscussionRange = {
  readonly count: Observable<number>;
  readonly includeThread: (id: ReviewThreadId) => void;
  readonly onContentSizeChange: (width: number, height: number) => void;
  readonly onLayout: (event: LayoutChangeEvent) => void;
  readonly onScroll: (event: NativeSyntheticEvent<NativeScrollEvent>) => void;
  readonly onSectionLayout: (event: LayoutChangeEvent) => void;
};

/** Defers the discussion body until its section approaches the viewport, then admits rows as it is read. */
export function useDiscussionRange(
  discussion: Discussion | null,
  pageTop: number,
): DiscussionRange {
  const count = useConstant(() => observable(0));
  const geometry = useRef({
    contentHeight: 0,
    grownAtHeight: 0,
    offset: 0,
    viewportHeight: 0,
  });
  const total = discussion?.timeline.length ?? 0;
  const sectionTop = useRef<number | null>(null);
  const extend = useEvent((): void => {
    const { contentHeight, grownAtHeight, offset, viewportHeight } = geometry.current;
    if (viewportHeight <= 0) {
      return;
    }
    const viewportEnd = offset + viewportHeight;
    if (count.peek() === 0) {
      if (sectionTop.current !== null && sectionTop.current <= viewportEnd + PRELOAD_DISTANCE_DP) {
        geometry.current.grownAtHeight = contentHeight;
        count.set(INITIAL_ITEMS);
      }
      return;
    }
    const remaining = contentHeight - viewportEnd;
    if (count.peek() < total && grownAtHeight !== contentHeight && remaining < viewportHeight) {
      // Wait for the new rows' layout before admitting another batch at the same scroll position.
      geometry.current.grownAtHeight = contentHeight;
      count.set(Math.min(total, count.peek() + BATCH_SIZE));
    }
  });
  const onLayout = useEvent((event: LayoutChangeEvent): void => {
    geometry.current.viewportHeight = event.nativeEvent.layout.height;
    extend();
  });
  const onSectionLayout = useEvent((event: LayoutChangeEvent): void => {
    // The section is a direct child of the reading column, which starts below the scroll padding.
    sectionTop.current = pageTop + event.nativeEvent.layout.y;
    extend();
  });
  const onContentSizeChange = useEvent((_width: number, height: number): void => {
    geometry.current.contentHeight = height;
    extend();
  });
  const onScroll = useEvent((event: NativeSyntheticEvent<NativeScrollEvent>): void => {
    geometry.current.offset = event.nativeEvent.contentOffset.y;
    extend();
  });
  const includeThread = useEvent((id: ReviewThreadId): void => {
    const index = discussion?.timeline.findIndex(
      (item) =>
        (item.kind === "thread" && item.thread.id === id) ||
        (item.kind === "review" && item.threads.some((thread) => thread.id === id)),
    );
    if (index !== undefined && index >= count.peek()) {
      count.set(Math.max(INITIAL_ITEMS, index + 1));
    }
  });
  return { count, includeThread, onContentSizeChange, onLayout, onScroll, onSectionLayout };
}
