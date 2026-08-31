import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { restartApplication } from "./applicationRestart";
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
  onSelect(generation: UiGeneration): Promise<void>;
}

export function UiGenerationControl({ current }: UiGenerationControlProps): React.JSX.Element {
  const [busy, setBusy] = useState(false);
  const select = useEvent(async (generation: UiGeneration): Promise<void> => {
    if (busy || generation === current) return;
    setBusy(true);
    await selectUiGeneration(generation);
    await restartApplication();
  });
  return (
    <View style={styles.row} accessibilityLabel="UI generation selector">
      {(["legacy", "v2"] as const).map((generation) => (
        <UiGenerationOption
          busy={busy}
          current={current}
          generation={generation}
          key={generation}
          onSelect={select}
        />
      ))}
    </View>
  );
}

function UiGenerationOption({
  busy,
  current,
  generation,
  onSelect,
}: UiGenerationOptionProps): React.JSX.Element {
  const select = useEvent(() => {
    onSelect(generation).catch(() => undefined);
  });
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
  row: { flexDirection: "row", gap: 8 },
  button: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: "#27272a",
  },
  selected: { backgroundColor: "#0369a1" },
  label: { color: "#fafafa", fontWeight: "600" },
});
