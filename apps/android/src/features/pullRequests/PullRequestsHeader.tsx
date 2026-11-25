import { ActivityIndicator, StyleSheet, View } from "react-native";

import { useEvent } from "../../react/useEvent";
import { colors, iconSize, layoutSize, spacing } from "../../theme";
import { CatalogTitle } from "../../ui/CatalogTitle";
import { OverflowMenu } from "../../ui/OverflowMenu";
import { threadListLayout } from "../../ui/thread-list-layout";

/** Pull requests catalog title, refresh status and account actions. */
export function PullRequestsHeader({
  onAddAccount,
  onOpenSettings,
  refreshing = false,
}: {
  readonly onAddAccount: (() => void) | null;
  readonly onOpenSettings: () => void;
  readonly refreshing?: boolean;
}): React.JSX.Element {
  const select = useEvent((id: string): void => {
    if (id === "add-account") {
      onAddAccount?.();
    } else if (id === "settings") {
      onOpenSettings();
    }
  });
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
      <OverflowMenu
        accessibilityLabel="Pull request actions"
        actions={[
          {
            disabled: onAddAccount === null,
            icon: "person-add-outline",
            id: "add-account",
            label: "Add account",
          },
          { icon: "settings-outline", id: "settings", label: "Settings" },
        ]}
        align="end"
        onSelect={select}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    alignItems: "center",
    flexDirection: "row",
    height: layoutSize.header,
    paddingEnd: threadListLayout.edgeInset,
    paddingStart: spacing.md,
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
