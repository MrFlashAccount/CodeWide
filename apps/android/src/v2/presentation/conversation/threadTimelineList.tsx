import { KeyboardAwareLegendList } from "@legendapp/list/keyboard";
import type { LegendListProps, LegendListRef } from "@legendapp/list/react-native";
import {
  forwardRef,
  type ForwardedRef,
  type ReactElement,
  type RefAttributes,
  useImperativeHandle,
  useRef,
} from "react";

import { useEvent } from "../../../react/useEvent";
import { useLegendMeasurementRevision } from "../../infrastructure/react/useLegendMeasurementRevision";
import { legendInitialPositionProps } from "./timelineInitialPosition";
import type { TimelineInitialPosition } from "./timelineInitialPosition";

const TIMELINE_ESTIMATED_ITEM_SIZE = 480;
const TIMELINE_TAIL_FOLLOW_THRESHOLD = 0.02;
const TIMELINE_TAIL_FOLLOW_CONFIG = {
  animated: false,
  on: { dataChange: true, itemLayout: true },
} as const;

type KeyboardLiftBehavior = "always" | "whenAtEnd" | "persistent" | "never";

export interface ThreadTimelineListRef {
  getItemViewportOffset(itemKey: string): number | null;
  scrollToEnd(options?: ThreadTimelineScrollOptions): Promise<void>;
}

interface ThreadTimelineScrollOptions {
  animated?: boolean;
}

export type ThreadTimelineListProps<ItemT> = Omit<
  LegendListProps<ItemT>,
  | "alignItemsAtEnd"
  | "anchoredEndSpace"
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
  | "refScrollView"
  | "renderScrollComponent"
> & {
  followTail?: boolean;
  initialPosition?: TimelineInitialPosition;
  keyboardLiftBehavior?: KeyboardLiftBehavior;
  keyboardOffset?: number;
  measurementRevision: string;
  renderRevision: string;
};

type KeyboardAwareTimelineListProps<ItemT> = LegendListProps<ItemT> & {
  keyboardLiftBehavior: KeyboardLiftBehavior;
  keyboardOffset: number;
  ref: ForwardedRef<LegendListRef>;
};

function ThreadTimelineListInner<ItemT>(
  props: ThreadTimelineListProps<ItemT>,
  ref: ForwardedRef<ThreadTimelineListRef>,
): ReactElement {
  const {
    followTail = false,
    initialPosition = { kind: "tail" },
    itemsAreEqual,
    keyboardLiftBehavior = "whenAtEnd",
    keyboardOffset = 0,
    measurementRevision,
    renderRevision,
    ...listProps
  } = props;
  const internalRef = useRef<LegendListRef>(null);
  useLegendMeasurementRevision(internalRef, measurementRevision);
  const getItemViewportOffset = useEvent((itemKey: string): number | null => {
    const state = internalRef.current?.getState();
    if (state === undefined) return null;
    const position = state.positionByKey(itemKey);
    if (position === undefined) return null;
    const offset = position - state.scroll;
    return Number.isFinite(offset) ? offset : null;
  });
  const scrollToEnd = useEvent(async (options?: ThreadTimelineScrollOptions): Promise<void> => {
    await internalRef.current?.scrollToEnd(options);
  });
  useImperativeHandle(ref, () => ({ getItemViewportOffset, scrollToEnd }), [
    getItemViewportOffset,
    scrollToEnd,
  ]);

  // WHY: The keyboard package erases LegendList's item generic even though it forwards
  // the same props and ref at runtime. A local typed facade restores that upstream contract.
  const KeyboardAwareTimelineList = KeyboardAwareLegendList as unknown as (
    value: KeyboardAwareTimelineListProps<ItemT>,
  ) => ReactElement;
  return (
    <KeyboardAwareTimelineList
      ref={internalRef}
      {...listProps}
      {...legendInitialPositionProps(initialPosition)}
      alignItemsAtEnd
      dataKey={renderRevision}
      drawDistance={250}
      estimatedItemSize={TIMELINE_ESTIMATED_ITEM_SIZE}
      itemsAreEqual={itemsAreEqual ?? referenceEqual}
      keyboardLiftBehavior={keyboardLiftBehavior}
      keyboardOffset={keyboardOffset}
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

// WHY: React.forwardRef cannot preserve a generic item parameter in its public component type.
export const ThreadTimelineList = ForwardedThreadTimelineList as <ItemT>(
  props: ThreadTimelineListProps<ItemT> & RefAttributes<ThreadTimelineListRef>,
) => ReactElement;
