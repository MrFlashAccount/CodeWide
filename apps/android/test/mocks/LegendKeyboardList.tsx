import type { LegendListProps, LegendListRef } from "@legendapp/list/react-native";
import { forwardRef, useImperativeHandle, type ForwardedRef, type ReactElement } from "react";
import { View } from "react-native";

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
            positionByKey: (key: string) =>
              data.findIndex((item, index) => props.keyExtractor?.(item, index) === key) * 480,
            scroll: 100,
          }) as ReturnType<LegendListRef["getState"]>,
        scrollToEnd: async () => undefined,
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
