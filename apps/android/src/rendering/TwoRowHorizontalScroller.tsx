import type { ReactElement } from "react";
import { ScrollView, StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";

import { spacing } from "../theme";

interface TwoRowHorizontalScrollerProps {
  readonly items: readonly ReactElement[];
  readonly style?: StyleProp<ViewStyle>;
  readonly testID?: string;
}

const MAX_VISIBLE_ROWS = 2;

/** Keeps at most two items in each column and scrolls additional columns horizontally. */
export function TwoRowHorizontalScroller(props: TwoRowHorizontalScrollerProps): ReactElement {
  const columns: Array<{ readonly items: readonly ReactElement[]; readonly key: string }> = [];
  for (let index = 0; index < props.items.length; index += MAX_VISIBLE_ROWS) {
    const firstItem = props.items[index];
    if (firstItem === undefined || firstItem.key === null) {
      throw new Error("Two-row scroller items must have stable keys");
    }
    const secondItem = props.items[index + 1];
    columns.push({
      items: secondItem === undefined ? [firstItem] : [firstItem, secondItem],
      key: firstItem.key,
    });
  }
  return (
    <ScrollView
      contentContainerStyle={styles.content}
      horizontal
      nestedScrollEnabled
      showsHorizontalScrollIndicator={false}
      style={[props.style, styles.viewport]}
      {...(props.testID === undefined ? {} : { testID: props.testID })}
    >
      {columns.map((column) => (
        <View key={column.key} style={styles.column} testID="two-row-column">
          {column.items}
        </View>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  column: {
    gap: spacing.xxs,
  },
  content: {
    flexDirection: "row",
    gap: spacing.xxs,
  },
  // React Native gives every ScrollView flexGrow: 1. A message-owned scroller
  // must stay at its intrinsic row height instead of consuming the timeline.
  viewport: {
    flexGrow: 0,
  },
});
