import * as Clipboard from "expo-clipboard";
import { StyleSheet } from "react-native";

import { colors, spacing, typeScale } from "../../theme";
import { AppText } from "../../ui/Typography";
import { useAppDialog } from "../../ui/AppDialog";

interface SettingsVersionProps {
  readonly version: string;
}

export function SettingsVersion(props: SettingsVersionProps) {
  const dialog = useAppDialog();
  const label = `Version ${props.version}`;
  const copy = () => {
    Clipboard.setStringAsync(label).catch((error: unknown) => {
      dialog.alert(
        "Copy failed",
        error instanceof Error ? error.message : "Could not copy version",
      );
    });
  };
  return (
    <AppText
      accessibilityActions={[{ label: "Copy version", name: "copy" }]}
      accessibilityHint="Long press to copy version"
      onAccessibilityAction={copy}
      onLongPress={copy}
      // Selectable Android text becomes focusable-in-touch-mode. ScrollView then
      // tracks this footer during sheet resizing and diagnostic layout updates.
      // Explicit copy preserves the action without creating a text-focus anchor.
      selectable={false}
      style={styles.version}
      testID="settings-version"
    >
      {label}
    </AppText>
  );
}

const styles = StyleSheet.create({
  version: {
    color: colors.textDim,
    ...typeScale.label,
    paddingBottom: spacing.sm,
    paddingTop: spacing.lg,
    textAlign: "center",
  },
});
