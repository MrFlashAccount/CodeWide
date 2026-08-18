import { StyleSheet, View } from "react-native";

import { colors, spacing, typeScale } from "../theme";
import { AppText as Text } from "./Typography";

export function TerminalWorkspace(_props: {
  connectionId: string;
  threadId: string;
  cwd: string | null;
  onMinimize(): void;
}) {
  return (
    <View style={styles.root}>
      <Text style={styles.title}>Terminal is available in the Android app.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, alignItems: "center", justifyContent: "center", padding: spacing.lg, backgroundColor: colors.background },
  title: { color: colors.textMuted, textAlign: "center", ...typeScale.bodyLarge },
});
