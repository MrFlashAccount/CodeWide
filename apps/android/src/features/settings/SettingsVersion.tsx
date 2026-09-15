import * as Clipboard from "expo-clipboard";
import { StyleSheet } from "react-native";

import { colors, spacing, typeScale } from "../../theme";
import { AppText } from "../../ui/Typography";

interface SettingsVersionProps {
  readonly version: string;
}

export function SettingsVersion(props: SettingsVersionProps) {
  const label = `Version ${props.version}`;
  const copy = () => {
    void Clipboard.setStringAsync(label);
  };
  return (
    <AppText
      testID="settings-version"
      // Selectable Android text becomes focusable-in-touch-mode. ScrollView then
      // tracks this footer during sheet resizing and diagnostic layout updates.
      // Explicit copy preserves the action without creating a text-focus anchor.
      selectable={false}
      onLongPress={copy}
      accessibilityHint="Long press to copy version"
      accessibilityActions={[{ name: "copy", label: "Copy version" }]}
      onAccessibilityAction={copy}
      style={styles.version}
    >
      {label}
    </AppText>
  );
}

const styles = StyleSheet.create({
  version: {
    color: colors.textDim,
    ...typeScale.label,
    textAlign: "center",
    paddingTop: spacing.lg,
    paddingBottom: spacing.sm,
  },
});
