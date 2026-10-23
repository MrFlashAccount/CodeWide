import { StyleSheet, View } from "react-native";

import { colors, layoutSize, spacing, typeScale } from "../../theme";
import { AppText as Text } from "../../ui/Typography";

/** Quiet catalog header of `/pulls`; route actions live in their owning surfaces. */
export function PullRequestsHeader(): React.JSX.Element {
  return (
    <View style={styles.header} testID="pull-requests-header">
      <Text accessibilityRole="header" numberOfLines={1} style={styles.title}>
        Pull requests
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    alignItems: "center",
    flexDirection: "row",
    height: layoutSize.header,
    paddingHorizontal: spacing.md,
  },
  title: {
    ...typeScale.heading,
    color: colors.text,
    flex: 1,
  },
});
