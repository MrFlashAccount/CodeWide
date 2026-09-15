import { Pressable, StyleSheet } from "react-native";
import { colors, spacing, typeScale } from "../theme";
import { AppText } from "./Typography";
import type { SkillPickerRowProps } from "./SkillPickerRow.types";
import { listRowHeight } from "./AppListRow.types";

export function SkillPickerRow({ title, description, onPress }: SkillPickerRowProps) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityHint="Insert skill into message"
      onPress={onPress}
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}
    >
      <AppText numberOfLines={1} style={styles.title}>
        {title}
      </AppText>
      {description !== "" && (
        <AppText numberOfLines={1} style={styles.description}>
          {description}
        </AppText>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    paddingHorizontal: spacing.sm,
    justifyContent: "center",
    gap: spacing.xxs,
    height: listRowHeight.double,
    backgroundColor: colors.surfaceContainer,
  },
  title: {
    ...typeScale.body,
    color: colors.text,
  },
  description: {
    ...typeScale.label,
    color: colors.textMuted,
  },
  pressed: { opacity: 0.7 },
});
