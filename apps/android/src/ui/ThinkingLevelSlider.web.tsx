/** Web fallback of the thinking level slider: one button per level. */
import type { ReactNode } from "react";
import { Pressable, StyleSheet, View } from "react-native";

import { colors, radii, spacing, typeScale } from "../theme";
import { modelEffortLabel } from "./modelEffortPresentation";
import type { ThinkingLevelSliderProps } from "./ThinkingLevelSlider.types";
import { AppText as Text } from "./Typography";

/** Picks one of a model's thinking levels. */
export function ThinkingLevelSlider({
  levels,
  onSelect,
  selected,
  testID,
}: ThinkingLevelSliderProps): ReactNode {
  return (
    <View accessibilityRole="radiogroup" style={styles.row} testID={testID}>
      {levels.map((level) => (
        <Pressable
          accessibilityLabel={`Thinking level, ${modelEffortLabel(level)}`}
          accessibilityRole="radio"
          accessibilityState={{ checked: level === selected }}
          key={level}
          onPress={() => {
            onSelect(level);
          }}
          style={[styles.level, level === selected && styles.selected]}
        >
          <Text style={styles.label}>{modelEffortLabel(level)}</Text>
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  label: {
    ...typeScale.body,
    color: colors.text,
  },
  level: {
    alignItems: "center",
    borderRadius: radii.pill,
    flex: 1,
    paddingVertical: spacing.sm,
  },
  row: {
    backgroundColor: colors.surfaceContainer,
    borderRadius: radii.pill,
    flexDirection: "row",
    gap: spacing.xxs,
    padding: spacing.xxs,
  },
  selected: {
    backgroundColor: colors.surfaceContainerHighest,
  },
});
