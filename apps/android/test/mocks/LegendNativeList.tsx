import type { LegendListProps, LegendListRef } from "@legendapp/list/react-native";
import {
  forwardRef,
  memo,
  useImperativeHandle,
  useState,
  type ForwardedRef,
  type ReactElement,
} from "react";
import { View } from "react-native";

// These mounted test rows never recycle into another item, so their state has React's lifetime.
export { useState as useRecyclingState } from "react";

type RowProps<ItemT> = {
  readonly extraData: unknown;
  readonly index: number;
  readonly item: ItemT;
  readonly renderItem: LegendListProps<ItemT>["renderItem"];
};

/**
 * One rendered row. Like LegendList's own containers, a row re-renders when
 * its item, index or the list's `extraData` changes, and not merely because
 * `renderItem` is a new function: a value a row reads only through its
 * `renderItem` closure must also reach the list as `extraData`.
 */
const Row = memo(
  function Row<ItemT>(props: RowProps<ItemT>): ReactElement | null {
    const rendered = props.renderItem?.({
      extraData: props.extraData,
      index: props.index,
      item: props.item,
    });
    return rendered === undefined ? null : <>{rendered}</>;
  },
  (previous, next) =>
    previous.item === next.item &&
    previous.index === next.index &&
    previous.extraData === next.extraData,
);

export const legendListScrollToIndex = jest.fn(async () => undefined);
let initialRenderLimit = Number.POSITIVE_INFINITY;

export function setLegendListInitialRenderLimit(limit: number): void {
  initialRenderLimit = limit;
}

function LegendListInner<ItemT>(
  props: LegendListProps<ItemT>,
  ref: ForwardedRef<LegendListRef>,
): ReactElement {
  const {
    data,
    ListEmptyComponent,
    ListFooterComponent,
    ListHeaderComponent,
    renderItem,
    ...viewProps
  } = props;
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
  const footer =
    typeof ListFooterComponent === "function" ? <ListFooterComponent /> : ListFooterComponent;
  const header =
    typeof ListHeaderComponent === "function" ? <ListHeaderComponent /> : ListHeaderComponent;
  return (
    <View {...viewProps}>
      {header}
      {data.length === 0
        ? empty
        : data
            .slice(0, renderLimit)
            .map((item, index) => (
              <View key={props.keyExtractor?.(item, index) ?? String(index)}>
                <Row extraData={props.extraData} index={index} item={item} renderItem={renderItem} />
              </View>
            ))}
      {footer}
    </View>
  );
}

export const LegendList = forwardRef(LegendListInner);
