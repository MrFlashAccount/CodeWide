import { KeyboardAwareLegendList } from "@legendapp/list/keyboard";
import type { Insets, LegendListProps, LegendListRef } from "@legendapp/list/react-native";
import {
  forwardRef,
  type ForwardedRef,
  type ReactElement,
  type RefAttributes,
  useEffect,
  useImperativeHandle,
  useRef,
} from "react";
import type { SharedValue } from "react-native-reanimated";

import { windowLayoutStore } from "../native/window-layout-store";
import { useEvent } from "../react/useEvent";

export interface ThreadTimelineListRef {
  getItemViewportOffset: (itemKey: string) => number | null;
  indexForItemKey: (itemKey: string) => number | null;
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
  | "recycleItems"
> & {
  contentInsetEndAdjustment?: SharedValue<number>;
  itemSizeEstimate: number;
  keyboardLiftBehavior?: "always" | "whenAtEnd" | "persistent" | "never";
  keyboardOffset?: number;
  renderRevision: string;
};

function ThreadTimelineListInner<ItemT>(
  {
    contentInsetEndAdjustment,
    itemsAreEqual,
    itemSizeEstimate,
    keyboardLiftBehavior = "whenAtEnd",
    keyboardOffset = 0,
    renderRevision,
    ...props
  }: ThreadTimelineListProps<ItemT>,
  ref: ForwardedRef<ThreadTimelineListRef>,
): ReactElement {
  const internalRef = useRef<LegendListRef>(null);
  const invalidateMeasurements = useEvent(() => {
    internalRef.current?.clearCaches({ mode: "sizes" });
  });
  useEffect(
    () => windowLayoutStore.subscribeMeasurementInvalidation(invalidateMeasurements),
    [invalidateMeasurements],
  );
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
  const indexForItemKey = useEvent(
    (itemKey: string): number | null => internalRef.current?.getState().indexByKey(itemKey) ?? null,
  );
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
      indexForItemKey,
      reportContentInset,
      scrollToEnd,
      scrollToIndex,
      scrollToOffset,
    }),
    [
      getItemViewportOffset,
      indexForItemKey,
      reportContentInset,
      scrollToEnd,
      scrollToIndex,
      scrollToOffset,
    ],
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
      alignItemsAtEnd
      dataKey={renderRevision}
      drawDistance={250}
      estimatedItemSize={itemSizeEstimate}
      itemsAreEqual={itemsAreEqual ?? referenceEqual}
      recycleItems={false}
      showsHorizontalScrollIndicator={false}
      showsVerticalScrollIndicator={false}
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
