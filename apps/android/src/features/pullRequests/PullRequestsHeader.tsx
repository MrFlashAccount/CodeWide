import { Ionicons } from "@expo/vector-icons";
import { Pressable, StyleSheet, View } from "react-native";

import { colors, controlSize, iconSize, layoutSize, spacing, typeScale } from "../../theme";
import { AppText as Text } from "../../ui/Typography";

/** Catalog header of `/pulls`: title, Settings and the Accounts sheet entry. */
export function PullRequestsHeader({
  onOpenAccounts,
  onOpenSettings,
}: {
  readonly onOpenAccounts: () => void;
  readonly onOpenSettings: () => void;
}): React.JSX.Element {
  return (
    <View style={styles.header} testID="pull-requests-header">
      <Pressable
        accessibilityLabel="Settings"
        accessibilityRole="button"
        onPress={onOpenSettings}
        style={styles.icon}
      >
        <Ionicons color={colors.text} name="menu" size={iconSize.navigation} />
      </Pressable>
      <Text accessibilityRole="header" numberOfLines={1} style={styles.title}>
        Pull requests
      </Text>
      <Pressable
        accessibilityLabel="Forge accounts"
        accessibilityRole="button"
        onPress={onOpenAccounts}
        style={styles.icon}
      >
        <Ionicons color={colors.text} name="person-circle-outline" size={iconSize.navigation} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    alignItems: "center",
    columnGap: spacing.xxs,
    flexDirection: "row",
    height: layoutSize.header,
    paddingHorizontal: spacing.xxs,
  },
  icon: {
    alignItems: "center",
    height: controlSize.touch,
    justifyContent: "center",
    width: controlSize.touch,
  },
  title: {
    ...typeScale.heading,
    color: colors.text,
    flex: 1,
  },
});
