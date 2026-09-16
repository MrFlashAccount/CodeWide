import { Pressable, StyleSheet } from "react-native";
import { colors, spacing, typeScale } from "../theme";
import { AppText } from "./Typography";
import type { SkillPickerRowProps } from "./SkillPickerRow.types";
import { listRowHeight } from "./AppListRow.types";

export function SkillPickerRow({ description, onPress, title }: SkillPickerRowProps) {
  return (
    <Pressable
      accessibilityHint="Insert skill into message"
      accessibilityLabel={title}
      accessibilityRole="button"
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
  description: {
    ...typeScale.label,
    color: colors.textMuted,
  },
  pressed: { opacity: 0.7 },
  row: {
    backgroundColor: colors.surfaceContainer,
    gap: spacing.xxs,
    height: listRowHeight.double,
    justifyContent: "center",
    paddingHorizontal: spacing.sm,
  },
  title: {
    ...typeScale.body,
    color: colors.text,
  },
});
