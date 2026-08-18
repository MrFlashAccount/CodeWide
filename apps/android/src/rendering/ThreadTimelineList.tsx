import { KeyboardAwareLegendList } from "@legendapp/list/keyboard";
import { type Insets, type LegendListProps, type LegendListRef } from "@legendapp/list/react-native";
import {
  forwardRef,
  type ForwardedRef,
  type ReactElement,
  type RefAttributes,
  useImperativeHandle,
  useRef,
} from "react";
import type { SharedValue } from "react-native-reanimated";

export interface ThreadTimelineListRef {
  scrollToEnd(options?: { animated?: boolean }): Promise<void>;
  scrollToIndex(options: { index: number; animated?: boolean; viewOffset?: number; viewPosition?: number }): void | Promise<void>;
  scrollToOffset(options: { offset: number; animated?: boolean }): void | Promise<void>;
  reportContentInset(inset?: Partial<Insets> | null): void;
}

export type ThreadTimelineListProps<ItemT> = Omit<
  LegendListProps<ItemT>,
  "contentInsetEndAdjustment" | "maintainVisibleContentPosition"
> & {
  renderRevision: string;
  keyboardLiftBehavior?: "always" | "whenAtEnd" | "persistent" | "never";
  keyboardOffset?: number;
  maintainScrollAtEndEnabled?: boolean;
  maintainVisibleContentPositionEnabled?: boolean;
  contentInsetEndAdjustment?: SharedValue<number>;
  freeze?: SharedValue<boolean>;
};

function ThreadTimelineListInner<ItemT>(
  {
    renderRevision,
    keyboardLiftBehavior = "whenAtEnd",
    keyboardOffset = 0,
    maintainScrollAtEndEnabled = true,
    maintainVisibleContentPositionEnabled = true,
    contentInsetEndAdjustment,
    freeze,
    itemsAreEqual,
    ...props
  }: ThreadTimelineListProps<ItemT>,
  ref: ForwardedRef<ThreadTimelineListRef>,
): ReactElement {
  const internalRef = useRef<LegendListRef>(null);
  useImperativeHandle(ref, () => ({
    scrollToEnd: async (options) => {
      await internalRef.current?.scrollToEnd(options);
    },
    scrollToIndex: (options) => internalRef.current?.scrollToIndex(options),
    scrollToOffset: (options) => internalRef.current?.scrollToOffset(options),
    reportContentInset: (inset) => internalRef.current?.reportContentInset(inset),
  }));

  const KeyboardAwareTimelineList = KeyboardAwareLegendList as unknown as (props: LegendListProps<ItemT> & {
    contentInsetEndAdjustment?: SharedValue<number>;
    freeze?: SharedValue<boolean>;
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
      {...(freeze === undefined ? {} : { freeze })}
      {...props}
      dataKey={renderRevision}
      initialScrollAtEnd
      alignItemsAtEnd
      maintainScrollAtEnd={maintainScrollAtEndEnabled ? {
        animated: false,
        on: {
          dataChange: true,
          itemLayout: true,
          footerLayout: false,
          layout: true,
        },
      } : false}
      maintainScrollAtEndThreshold={0.02}
      maintainVisibleContentPosition={maintainVisibleContentPositionEnabled ? { data: true, size: true } : false}
      itemsAreEqual={itemsAreEqual ?? referenceEqual}
      recycleItems
      drawDistance={500}
    />
  );
}

function referenceEqual<ItemT>(previous: ItemT, next: ItemT): boolean {
  return previous === next;
}

const ForwardedThreadTimelineList = forwardRef(ThreadTimelineListInner);

// LegendList owns the only virtualization and recycling implementation in the
// app. Keeping the wrapper thin prevents prop translation and fallback-engine
// branches from drifting away from the behavior tested on Android.
export const ThreadTimelineList = ForwardedThreadTimelineList as <ItemT>(
  props: ThreadTimelineListProps<ItemT> & RefAttributes<ThreadTimelineListRef>,
) => ReactElement;
