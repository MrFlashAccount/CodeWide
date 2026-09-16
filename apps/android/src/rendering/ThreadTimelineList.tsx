import { KeyboardAwareLegendList } from "@legendapp/list/keyboard";
import type { Insets, LegendListProps, LegendListRef } from "@legendapp/list/react-native";
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
import {
  legendInitialPositionProps,
  type TimelineInitialPosition,
} from "./timeline-initial-position";

export type { TimelineInitialPosition } from "./timeline-initial-position";

// Navigation telemetry puts a chat timeline row between 362px and 585px on
// the current phone/tablet layouts. LegendList's 100px default therefore
// allocates roughly four times too many expensive Markdown rows while it is
// resolving initialScrollAtEnd. This is only a first-render hint; measured row
// sizes take over immediately.
const TIMELINE_ESTIMATED_ITEM_SIZE = 480;
const TIMELINE_TAIL_FOLLOW_THRESHOLD = 0.02;
const TIMELINE_TAIL_INITIAL_POSITION: TimelineInitialPosition = { kind: "tail" };
const TIMELINE_TAIL_FOLLOW_CONFIG = {
  animated: false,
  on: {
    dataChange: true,
    itemLayout: true,
  },
} as const;

export interface ThreadTimelineListRef {
  getItemViewportOffset: (itemKey: string) => number | null;
  reportContentInset: (inset?: Partial<Insets> | null) => void;
  scrollToEnd: (options?: { animated?: boolean }) => Promise<void>;
  scrollToIndex: (options: {
    animated?: boolean;
    index: number;
    viewOffset?: number;
    viewPosition?: number;
  }) => Promise<void>;
  scrollToOffset: (options: { animated?: boolean; offset: number }) => Promise<void>;
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
  contentInsetEndAdjustment?: SharedValue<number>;
  followTail?: boolean;
  initialPosition?: TimelineInitialPosition;
  keyboardLiftBehavior?: "always" | "whenAtEnd" | "persistent" | "never";
  keyboardOffset?: number;
  measurementRevision: string;
  renderRevision: string;
};

function ThreadTimelineListInner<ItemT>(
  {
    contentInsetEndAdjustment,
    followTail = false,
    initialPosition = TIMELINE_TAIL_INITIAL_POSITION,
    itemsAreEqual,
    keyboardLiftBehavior = "whenAtEnd",
    keyboardOffset = 0,
    measurementRevision,
    renderRevision,
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
    if (state === undefined) {
      return null;
    }
    const position = state.positionByKey(itemKey);
    if (position === undefined) {
      return null;
    }
    const offset = position - state.scroll;
    return Number.isFinite(offset) ? offset : null;
  });
  const scrollToEnd = useEvent(async (options?: { animated?: boolean }): Promise<void> => {
    await internalRef.current?.scrollToEnd(options);
  });
  const scrollToIndex = useEvent(
    async (options: Parameters<ThreadTimelineListRef["scrollToIndex"]>[0]): Promise<void> => {
      await internalRef.current?.scrollToIndex(options);
    },
  );
  const scrollToOffset = useEvent(
    async (options: Parameters<ThreadTimelineListRef["scrollToOffset"]>[0]): Promise<void> => {
      await internalRef.current?.scrollToOffset(options);
    },
  );
  const reportContentInset = useEvent((inset?: Partial<Insets> | null) =>
    internalRef.current?.reportContentInset(inset),
  );
  useImperativeHandle(
    ref,
    () => ({
      getItemViewportOffset,
      reportContentInset,
      scrollToEnd,
      scrollToIndex,
      scrollToOffset,
    }),
    [getItemViewportOffset, reportContentInset, scrollToEnd, scrollToIndex, scrollToOffset],
  );

  const keyboardAwareLegendList: unknown = KeyboardAwareLegendList;
  // WHY: LegendList's forwardRef declaration erases the generic item parameter. This local adapter
  // restores the same public props while adding the keyboard wrapper's documented native props.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  const KeyboardAwareTimelineList = keyboardAwareLegendList as (
    props: LegendListProps<ItemT> & {
      contentInsetEndAdjustment?: SharedValue<number>;
      keyboardLiftBehavior: "always" | "whenAtEnd" | "persistent" | "never";
      keyboardOffset: number;
      ref: ForwardedRef<LegendListRef>;
    },
  ) => ReactElement;

  return (
    <KeyboardAwareTimelineList
      keyboardLiftBehavior={keyboardLiftBehavior}
      keyboardOffset={keyboardOffset}
      ref={internalRef}
      {...(contentInsetEndAdjustment === undefined ? {} : { contentInsetEndAdjustment })}
      {...props}
      showsHorizontalScrollIndicator={false}
      showsVerticalScrollIndicator={false}
      {...legendInitialPositionProps(initialPosition)}
      alignItemsAtEnd
      dataKey={renderRevision}
      drawDistance={250}
      estimatedItemSize={TIMELINE_ESTIMATED_ITEM_SIZE}
      itemsAreEqual={itemsAreEqual ?? referenceEqual}
      maintainScrollAtEnd={followTail ? TIMELINE_TAIL_FOLLOW_CONFIG : false}
      maintainScrollAtEndThreshold={TIMELINE_TAIL_FOLLOW_THRESHOLD}
      maintainVisibleContentPosition={{ data: true, size: true }}
      recycleItems={false}
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
// WHY: React.forwardRef cannot preserve a generic component signature, while this adapter forwards
// every ItemT-dependent prop and the ref unchanged to ThreadTimelineListInner.
// oxlint-disable-next-line typescript/no-unsafe-type-assertion
export const ThreadTimelineList = ForwardedThreadTimelineList as <ItemT>(
  props: ThreadTimelineListProps<ItemT> & RefAttributes<ThreadTimelineListRef>,
) => ReactElement;
