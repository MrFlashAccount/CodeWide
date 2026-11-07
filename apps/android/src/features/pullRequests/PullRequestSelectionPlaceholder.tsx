import { Ionicons } from "@expo/vector-icons";
import { StyleSheet, View } from "react-native";

import { colors, iconSize, spacing, typeScale } from "../../theme";
import { AppText as Text } from "../../ui/Typography";

/** Empty wide destination after onboarding, before the user selects a pull request. */
export function PullRequestSelectionPlaceholder(): React.JSX.Element {
  return (
    <View style={styles.placeholder} testID="pull-request-selection-placeholder">
      <Ionicons
        color={colors.textDim}
        name="git-pull-request-outline"
        size={iconSize.illustration}
      />
      <Text style={styles.title}>Select a pull request</Text>
      <Text style={styles.description}>Choose a pull request from the list to open it here.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  description: {
    color: colors.textDim,
    textAlign: "center",
    ...typeScale.body,
  },
  placeholder: {
    alignItems: "center",
    backgroundColor: colors.conversationSurface,
    flex: 1,
    gap: spacing.sm,
    justifyContent: "center",
    padding: spacing.lg,
  },
  title: {
    color: colors.textMuted,
    ...typeScale.title,
  },
});
