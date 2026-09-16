import { Pressable, StyleSheet, View } from "react-native";

import { colors, spacing, typeScale, radii, controlSize } from "../theme";
import { AppText as Text } from "./Typography";

export function SpeedscopeProfileViewer({
  onClose,
}: {
  content: string;
  fileName: string;
  onClose: () => void;
  title: string;
}) {
  return (
    <View style={styles.root}>
      <Text style={styles.message}>
        The bundled Speedscope viewer is available in the Android app.
      </Text>
      <Pressable accessibilityRole="button" onPress={onClose} style={styles.button}>
        <Text style={styles.buttonText}>Close</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  button: {
    backgroundColor: colors.surfaceRaised,
    borderRadius: radii.medium,
    minHeight: controlSize.regular,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xxs,
  },
  buttonText: {
    ...typeScale.body,
    color: colors.text,
  },
  message: {
    ...typeScale.body,
    color: colors.textMuted,
  },
  root: {
    alignItems: "center",
    backgroundColor: colors.background,
    flex: 1,
    gap: spacing.md,
    justifyContent: "center",
  },
});
