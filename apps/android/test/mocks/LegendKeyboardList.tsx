import type { LegendListProps, LegendListRef } from "@legendapp/list/react-native";
import { forwardRef, useImperativeHandle, type ForwardedRef, type ReactElement } from "react";
import { View } from "react-native";

function KeyboardAwareLegendListInner<ItemT>(
  props: LegendListProps<ItemT>,
  ref: ForwardedRef<LegendListRef>,
): ReactElement {
  const { data, ListEmptyComponent, renderItem, ...viewProps } = props;
  useImperativeHandle(ref, () => ({ clearCaches: () => undefined }) as LegendListRef, []);
  const empty =
    typeof ListEmptyComponent === "function" ? <ListEmptyComponent /> : ListEmptyComponent;
  return (
    <View {...viewProps}>
      {data.length === 0
        ? empty
        : data.map((item, index) => (
            <View key={props.keyExtractor?.(item, index) ?? String(index)}>
              {renderItem({ extraData: props.extraData, index, item })}
            </View>
          ))}
    </View>
  );
}

export const KeyboardAwareLegendList = forwardRef(KeyboardAwareLegendListInner);
