import { Pressable, StyleSheet, View } from "react-native";

import { colors, spacing, typeScale, radii, controlSize } from "../theme";
import { AppText as Text } from "./Typography";

export function SpeedscopeProfileViewer({ onClose }: {
  title: string;
  fileName: string;
  content: string;
  onClose(): void;
}) {
  return (
    <View style={styles.root}>
      <Text style={styles.message}>The bundled Speedscope viewer is available in the Android app.</Text>
      <Pressable accessibilityRole="button" onPress={onClose} style={styles.button}>
        <Text style={styles.buttonText}>Close</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, alignItems: "center", justifyContent: "center", gap: spacing.md, backgroundColor: colors.background },
  message: { ...typeScale.body, color: colors.textMuted },
  button: { minHeight: controlSize.regular, paddingHorizontal: spacing.md, paddingVertical: spacing.xxs, borderRadius: radii.medium, backgroundColor: colors.surfaceRaised },
  buttonText: { ...typeScale.body, color: colors.text },
});
