import type { LegendListProps, LegendListRef } from "@legendapp/list/react-native";
import {
  forwardRef,
  useImperativeHandle,
  useState,
  type ForwardedRef,
  type ReactElement,
} from "react";
import { View } from "react-native";

// These mounted test rows never recycle into another item, so their state has React's lifetime.
export { useState as useRecyclingState } from "react";

export const legendListScrollToIndex = jest.fn(async () => undefined);
let initialRenderLimit = Number.POSITIVE_INFINITY;

export function setLegendListInitialRenderLimit(limit: number): void {
  initialRenderLimit = limit;
}

function LegendListInner<ItemT>(
  props: LegendListProps<ItemT>,
  ref: ForwardedRef<LegendListRef>,
): ReactElement {
  const { data, ListEmptyComponent, renderItem, ...viewProps } = props;
  const [renderLimit, setRenderLimit] = useState(initialRenderLimit);
  useImperativeHandle(
    ref,
    // WHY: The test double implements only the imperative methods exercised by presentation tests.
    () =>
      ({
        clearCaches: () => undefined,
        scrollToIndex: async (options) => {
          await legendListScrollToIndex(options);
          setRenderLimit((current) => Math.max(current, options.index + 1));
        },
      }) as LegendListRef,
    [],
  );
  const empty =
    typeof ListEmptyComponent === "function" ? <ListEmptyComponent /> : ListEmptyComponent;
  return (
    <View {...viewProps}>
      {data.length === 0
        ? empty
        : data
            .slice(0, renderLimit)
            .map((item, index) => (
              <View key={props.keyExtractor?.(item, index) ?? String(index)}>
                {renderItem({ extraData: props.extraData, index, item })}
              </View>
            ))}
    </View>
  );
}

export const LegendList = forwardRef(LegendListInner);
