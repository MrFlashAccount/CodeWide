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

interface UiGenerationOptionProps {
  busy: boolean;
  current: UiGeneration;
  generation: UiGeneration;
  onSelect(generation: UiGeneration): void;
}

export function UiGenerationControl(props: UiGenerationControlProps): React.JSX.Element {
  const { current } = props;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const select = useEvent(async (generation: UiGeneration): Promise<void> => {
    if (busy || generation === current) return;
    setBusy(true);
    setError(null);
    await selectUiGeneration(generation);
    await stopRuntime(current);
    await restartApplication();
  });
  const requestSelection = useEvent((generation: UiGeneration): void => {
    select(generation).catch(() => {
      setError("The switch could not restart the app. Try again or reopen CodeWide.");
      setBusy(false);
    });
  });
  return (
    <View style={styles.control}>
      <View style={styles.row} accessibilityLabel="UI generation selector">
        {(["legacy", "v2"] as const).map((generation) => (
          <UiGenerationOption
            busy={busy}
            current={current}
            generation={generation}
            key={generation}
            onSelect={requestSelection}
          />
        ))}
      </View>
      {error === null ? null : (
        <Text accessibilityLiveRegion="polite" style={styles.error}>
          {error}
        </Text>
      )}
    </View>
  );
}

function UiGenerationOption(props: UiGenerationOptionProps): React.JSX.Element {
  const { busy, current, generation, onSelect } = props;
  const select = useEvent(() => onSelect(generation));
  return (
    <Pressable
      accessibilityLabel={`Use ${generation === "v2" ? "V2" : "legacy"} interface`}
      accessibilityRole="button"
      disabled={busy}
      onPress={select}
      style={[styles.button, generation === current && styles.selected]}
    >
      <Text style={styles.label}>{generation === "v2" ? "V2" : "Legacy"}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  control: { gap: 8 },
  row: { flexDirection: "row", gap: 8 },
  button: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: "#27272a",
  },
  selected: { backgroundColor: "#0369a1" },
  error: { color: "#ef4444", fontSize: 13 },
  label: { color: "#fafafa", fontWeight: "600" },
});
