import * as Clipboard from "expo-clipboard";
import { Linking, Pressable, StyleSheet, View } from "react-native";

import type { AndroidReleaseUpdate } from "../../data/androidReleaseContract";
import { useEvent } from "../../react/useEvent";
import { colors, controlHitSlop, controlSize, radii, spacing, typeScale } from "../../theme";
import { AppText } from "../../ui/Typography";
import { useAppDialog } from "../../ui/AppDialog";

interface SettingsVersionProps {
  readonly update: AndroidReleaseUpdate | null;
  readonly version: string;
}

export function SettingsVersion(props: SettingsVersionProps) {
  const dialog = useAppDialog();
  const label = `Version ${props.version}`;
  const copy = useEvent(() => {
    Clipboard.setStringAsync(label).catch((error: unknown) => {
      dialog.alert(
        "Copy failed",
        error instanceof Error ? error.message : "Could not copy version",
      );
    });
  });
  const openRelease = useEvent(() => {
    if (props.update === null) {
      return;
    }
    Linking.openURL(props.update.releaseUrl).catch((error: unknown) => {
      dialog.error("Could not open GitHub release", error);
    });
  });
  return (
    <View style={styles.container}>
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
      {props.update !== null && (
        <Pressable
          accessibilityHint="Open the latest CodeWide release on GitHub"
          accessibilityLabel={`Update CodeWide to version ${props.update.latestVersion}`}
          accessibilityRole="link"
          hitSlop={controlHitSlop.compact}
          onPress={openRelease}
          style={({ pressed }) => [styles.update, pressed && styles.updatePressed]}
          testID="settings-version-update"
        >
          <AppText style={styles.updateText}>Update to {props.update.latestVersion}</AppText>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: "center",
    gap: spacing.xs,
    paddingBottom: spacing.sm,
    paddingTop: spacing.lg,
  },
  update: {
    alignItems: "center",
    backgroundColor: colors.accentMuted,
    borderRadius: radii.pill,
    justifyContent: "center",
    minHeight: controlSize.compact,
    paddingHorizontal: spacing.sm,
  },
  updatePressed: {
    backgroundColor: colors.surfaceHover,
  },
  updateText: {
    color: colors.text,
    ...typeScale.label,
  },
  version: {
    color: colors.textDim,
    ...typeScale.label,
    textAlign: "center",
  },
});
