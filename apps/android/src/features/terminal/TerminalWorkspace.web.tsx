import { StyleSheet, View } from "react-native";

import { colors, spacing, typeScale } from "../../theme";
import { AppText as Text } from "../../ui/Typography";

/** Provides the web fallback for the native-only terminal workspace. */
export function TerminalWorkspace(_props: {
  connectionId: string;
  cwd: string | null;
  onMinimize: () => void;
  threadId: string;
}) {
  return (
    <View style={styles.root}>
      <Text style={styles.title}>Terminal is available in the Android app.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    alignItems: "center",
    backgroundColor: colors.background,
    flex: 1,
    justifyContent: "center",
    padding: spacing.lg,
  },
  title: {
    color: colors.textMuted,
    textAlign: "center",
    ...typeScale.body,
  },
});
