import type { LegendListProps, LegendListRef } from "@legendapp/list/react-native";
import { forwardRef, useImperativeHandle, type ForwardedRef, type ReactElement } from "react";
import { View } from "react-native";

export const legendListScrollToEnd = jest.fn(async () => undefined);
export const legendListScrollToIndex = jest.fn(async () => undefined);
export const legendListIsAtEnd = jest.fn(() => true);
let withinEndThreshold = true;
const endThresholdListeners = new Set<(withinThreshold: boolean) => void>();

export function setLegendListWithinEndThreshold(withinThreshold: boolean): void {
  withinEndThreshold = withinThreshold;
  for (const listener of endThresholdListeners) {
    listener(withinThreshold);
  }
}

function KeyboardAwareLegendListInner<ItemT>(
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
  useImperativeHandle(
    ref,
    // WHY: The test double implements only the imperative methods exercised by presentation tests.
    () =>
      ({
        clearCaches: () => undefined,
        getState: () =>
          ({
            indexByKey: (key: string) => {
              const index = data.findIndex(
                (item, itemIndex) => props.keyExtractor?.(item, itemIndex) === key,
              );
              return index < 0 ? undefined : index;
            },
            positionByKey: (key: string) =>
              data.findIndex((item, index) => props.keyExtractor?.(item, index) === key) * 480,
            isAtEnd: legendListIsAtEnd(),
            isWithinMaintainScrollAtEndThreshold: withinEndThreshold,
            listen: (_listenerType: string, listener: (withinThreshold: boolean) => void) => {
              endThresholdListeners.add(listener);
              return () => endThresholdListeners.delete(listener);
            },
            scroll: 100,
          }) as ReturnType<LegendListRef["getState"]>,
        scrollToEnd: legendListScrollToEnd,
        scrollToIndex: legendListScrollToIndex,
      }) as LegendListRef,
    [data, props.keyExtractor],
  );
  const empty =
    typeof ListEmptyComponent === "function" ? <ListEmptyComponent /> : ListEmptyComponent;
  const header =
    typeof ListHeaderComponent === "function" ? <ListHeaderComponent /> : ListHeaderComponent;
  const footer =
    typeof ListFooterComponent === "function" ? <ListFooterComponent /> : ListFooterComponent;
  return (
    <View {...viewProps}>
      {header}
      {data.length === 0
        ? empty
        : data.map((item, index) => (
            <View key={props.keyExtractor?.(item, index) ?? String(index)}>
              {renderItem({ extraData: props.extraData, index, item })}
            </View>
          ))}
      {footer}
    </View>
  );
}

export const KeyboardAwareLegendList = forwardRef(KeyboardAwareLegendListInner);
