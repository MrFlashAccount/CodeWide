import { colors, spacing, typeScale, typeWeight, controlSize } from "../theme";
import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { restartApplication } from "./applicationRestart";
import { stopRuntime } from "./runtimeSlot";
import { selectUiGeneration } from "./uiGenerationResource";
import type { UiGeneration } from "./uiGeneration";
import { useEvent } from "../react/useEvent";

interface UiGenerationControlProps {
  current: UiGeneration;
}

export function UiGenerationControl(props: UiGenerationControlProps): React.JSX.Element | null {
  const { current } = props;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const select = useEvent(async (): Promise<void> => {
    if (busy || current === "legacy") return;
    setBusy(true);
    setError(null);
    await selectUiGeneration("legacy");
    await stopRuntime(current);
    await restartApplication();
  });
  const requestSelection = useEvent((): void => {
    select().catch(() => {
      setError("The switch could not restart the app. Try again or reopen CodeWide.");
      setBusy(false);
    });
  });
  // A still-mounted Modern session may return to Legacy; Legacy exposes no switch.
  if (current === "legacy") return null;
  return (
    <View style={styles.control}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Return to Legacy"
        accessibilityState={{ busy }}
        disabled={busy}
        onPress={requestSelection}
        style={styles.row}
      >
        <Text style={styles.label}>Return to Legacy</Text>
      </Pressable>
      {error === null ? null : (
        <Text accessibilityLiveRegion="polite" style={styles.error}>
          {error}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  control: { gap: spacing.xs },
  row: {
    flexDirection: "row",
    alignItems: "center",
    minHeight: controlSize.regular,
    gap: spacing.xs,
  },
  error: { color: colors.error, ...typeScale.body },
  label: { color: colors.textMuted, ...typeScale.body, fontWeight: typeWeight.semibold },
});
