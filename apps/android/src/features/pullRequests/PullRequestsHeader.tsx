import { ActivityIndicator, StyleSheet, View } from "react-native";

import { ThreadListHeaderAction } from "../../presentation/navigation/ThreadListHeader";
import { colors, iconSize, layoutSize, spacing } from "../../theme";
import { CatalogTitle } from "../../ui/CatalogTitle";

/** Quiet catalog header of `/pulls`; route actions live in their owning surfaces. */
export function PullRequestsHeader({
  onManageProviders,
  refreshing = false,
}: {
  readonly onManageProviders?: () => void;
  readonly refreshing?: boolean;
}): React.JSX.Element {
  return (
    <View
      accessibilityState={{ busy: refreshing }}
      style={styles.header}
      testID="pull-requests-header"
    >
      <View style={styles.titleGroup}>
        <CatalogTitle layout={styles.title}>Pull requests</CatalogTitle>
        {refreshing ? (
          <ActivityIndicator
            color={colors.textMuted}
            size={iconSize.inline}
            testID="pull-requests-refresh-indicator"
          />
        ) : null}
      </View>
      {onManageProviders === undefined ? null : (
        <ThreadListHeaderAction
          accessibilityLabel="Add or manage pull request providers"
          name="add"
          onPress={onManageProviders}
        />
      )}
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
    flexShrink: 1,
  },
  titleGroup: {
    alignItems: "center",
    columnGap: spacing.xs,
    flex: 1,
    flexDirection: "row",
    minWidth: 0,
  },
});
