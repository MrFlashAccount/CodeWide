import { StyleSheet, View } from "react-native";

import { colors, layoutSize, radii, spacing } from "../../../theme";

const ROWS = ["first", "second", "third", "fourth"] as const;
/** Placeholder bar heights match the title and meta line boxes they stand in for. */
const TITLE_BAR_HEIGHT = 12;
const META_BAR_HEIGHT = 10;

/** Local placeholder while nothing is published yet; no progress words. */
export function ListSkeleton(): React.JSX.Element {
  return (
    <View
      accessibilityLabel="Pull requests are loading"
      accessibilityState={{ busy: true }}
      testID="pull-request-list-skeleton"
    >
      {ROWS.map((row) => (
        <View key={row} style={styles.row}>
          <View style={styles.title} />
          <View style={styles.meta} />
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  meta: {
    backgroundColor: colors.surfaceContainer,
    borderRadius: radii.compact,
    height: META_BAR_HEIGHT,
    width: "40%",
  },
  row: {
    gap: spacing.xs,
    height: layoutSize.row,
    justifyContent: "center",
    paddingHorizontal: spacing.md,
  },
  title: {
    backgroundColor: colors.surfaceContainerHigh,
    borderRadius: radii.compact,
    height: TITLE_BAR_HEIGHT,
    width: "70%",
  },
});
