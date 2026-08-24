import { KeyboardAwareLegendList } from "@legendapp/list/keyboard";
import { type Insets, type LegendListProps, type LegendListRef } from "@legendapp/list/react-native";
import {
  forwardRef,
  type ForwardedRef,
  type ReactElement,
  type RefAttributes,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
} from "react";
import type { SharedValue } from "react-native-reanimated";

import { useEvent } from "../react/useEvent";
import { legendInitialPositionProps, type TimelineInitialPosition } from "./timeline-initial-position";

export type { TimelineInitialPosition } from "./timeline-initial-position";

// Navigation telemetry puts a chat timeline row between 362px and 585px on
// the current phone/tablet layouts. LegendList's 100px default therefore
// allocates roughly four times too many expensive Markdown rows while it is
// resolving initialScrollAtEnd. This is only a first-render hint; measured row
// sizes take over immediately.
const TIMELINE_ESTIMATED_ITEM_SIZE = 480;
const TIMELINE_TAIL_FOLLOW_THRESHOLD = 0.02;
const TIMELINE_TAIL_FOLLOW_CONFIG = {
  animated: false,
  on: {
    dataChange: true,
    itemLayout: true,
  },
} as const;

export interface ThreadTimelineListRef {
  getItemViewportOffset(itemKey: string): number | null;
  scrollToEnd(options?: { animated?: boolean }): Promise<void>;
  scrollToIndex(options: { index: number; animated?: boolean; viewOffset?: number; viewPosition?: number }): void | Promise<void>;
  scrollToOffset(options: { offset: number; animated?: boolean }): void | Promise<void>;
  reportContentInset(inset?: Partial<Insets> | null): void;
}

export type ThreadTimelineListProps<ItemT> = Omit<
  LegendListProps<ItemT>,
  | "alignItemsAtEnd"
  | "contentInsetEndAdjustment"
  | "dataKey"
  | "drawDistance"
  | "estimatedItemSize"
  | "initialScrollAtEnd"
  | "initialScrollIndex"
  | "maintainScrollAtEnd"
  | "maintainScrollAtEndThreshold"
  | "maintainVisibleContentPosition"
  | "recycleItems"
> & {
  renderRevision: string;
  measurementRevision: string;
  initialPosition?: TimelineInitialPosition;
  keyboardLiftBehavior?: "always" | "whenAtEnd" | "persistent" | "never";
  keyboardOffset?: number;
  contentInsetEndAdjustment?: SharedValue<number>;
  followTail?: boolean;
};

function ThreadTimelineListInner<ItemT>(
  {
    renderRevision,
    measurementRevision,
    initialPosition = { kind: "tail" },
    keyboardLiftBehavior = "whenAtEnd",
    keyboardOffset = 0,
    contentInsetEndAdjustment,
    followTail = false,
    itemsAreEqual,
    ...props
  }: ThreadTimelineListProps<ItemT>,
  ref: ForwardedRef<ThreadTimelineListRef>,
): ReactElement {
  const internalRef = useRef<LegendListRef>(null);
  // LegendList owns its measurement cache. Font-scale/density changes make
  // those native measurements invalid, but remounting the list would also
  // discard its visible-item anchor and visibly jump the chat. Invalidate the
  // third-party cache at the list boundary before the revised layout paints.
  useLayoutEffect(() => {
    internalRef.current?.clearCaches({ mode: "sizes" });
  }, [measurementRevision]);
  const getItemViewportOffset = useEvent((itemKey: string): number | null => {
    const state = internalRef.current?.getState();
    if (state === undefined) return null;
    const position = state.positionByKey(itemKey);
    if (position === undefined) return null;
    const offset = position - state.scroll;
    return Number.isFinite(offset) ? offset : null;
  });
  const scrollToEnd = useEvent(async (options?: { animated?: boolean }): Promise<void> => {
    await internalRef.current?.scrollToEnd(options);
  });
  const scrollToIndex = useEvent((options: Parameters<ThreadTimelineListRef["scrollToIndex"]>[0]) =>
    internalRef.current?.scrollToIndex(options));
  const scrollToOffset = useEvent((options: Parameters<ThreadTimelineListRef["scrollToOffset"]>[0]) =>
    internalRef.current?.scrollToOffset(options));
  const reportContentInset = useEvent((inset?: Partial<Insets> | null) =>
    internalRef.current?.reportContentInset(inset));
  useImperativeHandle(ref, () => ({
    getItemViewportOffset,
    scrollToEnd,
    scrollToIndex,
    scrollToOffset,
    reportContentInset,
  }), [getItemViewportOffset, reportContentInset, scrollToEnd, scrollToIndex, scrollToOffset]);

  const KeyboardAwareTimelineList = KeyboardAwareLegendList as unknown as (props: LegendListProps<ItemT> & {
    contentInsetEndAdjustment?: SharedValue<number>;
    keyboardLiftBehavior: "always" | "whenAtEnd" | "persistent" | "never";
    keyboardOffset: number;
    ref: ForwardedRef<LegendListRef>;
  }) => ReactElement;

  return (
    <KeyboardAwareTimelineList
      ref={internalRef}
      keyboardLiftBehavior={keyboardLiftBehavior}
      keyboardOffset={keyboardOffset}
      {...(contentInsetEndAdjustment === undefined ? {} : { contentInsetEndAdjustment })}
      {...props}
      {...legendInitialPositionProps(initialPosition)}
      dataKey={renderRevision}
      alignItemsAtEnd
      maintainScrollAtEnd={followTail ? TIMELINE_TAIL_FOLLOW_CONFIG : false}
      maintainScrollAtEndThreshold={TIMELINE_TAIL_FOLLOW_THRESHOLD}
      maintainVisibleContentPosition={{ data: true, size: true }}
      itemsAreEqual={itemsAreEqual ?? referenceEqual}
      recycleItems={false}
      estimatedItemSize={TIMELINE_ESTIMATED_ITEM_SIZE}
      drawDistance={250}
    />
  );
}

function referenceEqual<ItemT>(previous: ItemT, next: ItemT): boolean {
  return previous === next;
}

const ForwardedThreadTimelineList = forwardRef(ThreadTimelineListInner);

// LegendList owns timeline virtualization, but rows are deliberately not
// recycled. Stateful markdown and activity trees must unmount instead of being
// rebound to another turn after a long scroll.
export const ThreadTimelineList = ForwardedThreadTimelineList as <ItemT>(
  props: ThreadTimelineListProps<ItemT> & RefAttributes<ThreadTimelineListRef>,
) => ReactElement;
