import { Ionicons, MaterialIcons } from "@expo/vector-icons";
import { type ReactNode } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { colors, iconSize, layoutSize, radii, spacing, typeScale, typeWeight } from "../../theme";
import { AppText as Text } from "../../ui/Typography";

export const THREAD_SWIPE_ACTION_WIDTH = layoutSize.row;

export const THREAD_SWIPE_UNDERLAY_OVERLAP = radii.selected;

export const THREAD_SWIPE_ACTIONS_WIDTH = THREAD_SWIPE_ACTION_WIDTH * 3;

export function ThreadSwipeActions({ children }: { children: ReactNode }) {
  return (
    <View style={styles.swipeActionsUnderlay}>
      <View style={styles.swipeActionsRight}>{children}</View>
    </View>
  );
}

export function ThreadSwipeAction({
  label,
  icon,
  tone,
  onPress,
}: {
  label: string;
  icon: keyof typeof Ionicons.glyphMap | "push-pin";
  tone: "neutral" | "accent" | "danger";
  onPress?(): void;
}) {
  const foreground =
    tone === "neutral"
      ? colors.text
      : tone === "danger"
        ? colors.onErrorContainer
        : colors.onPrimary;
  return (
    <Pressable
      accessibilityLabel={`${label} thread`}
      accessibilityRole="button"
      disabled={onPress === undefined}
      onPress={onPress}
      style={({ pressed }) => [
        styles.swipeAction,
        tone === "neutral" && styles.swipeActionNeutral,
        tone === "accent" && styles.swipeActionAccent,
        tone === "danger" && styles.swipeActionDanger,
        pressed && styles.swipeActionPressed,
      ]}
    >
      {icon === "push-pin" ? (
        <MaterialIcons name="push-pin" size={iconSize.action} color={foreground} />
      ) : (
        <Ionicons name={icon} size={iconSize.action} color={foreground} />
      )}
      <Text style={[styles.swipeActionText, { color: foreground }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  swipeActionsRight: {
    flexDirection: "row",
    height: "100%",
    width: THREAD_SWIPE_ACTIONS_WIDTH,
  },
  swipeActionsUnderlay: {
    alignSelf: "stretch",
    backgroundColor: colors.surfaceContainerHigh,
    borderRadius: radii.selected,
    overflow: "hidden",
    paddingLeft: THREAD_SWIPE_UNDERLAY_OVERLAP,
    width: THREAD_SWIPE_ACTIONS_WIDTH + THREAD_SWIPE_UNDERLAY_OVERLAP,
  },
  swipeAction: {
    alignSelf: "stretch",
    width: THREAD_SWIPE_ACTION_WIDTH,
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.xxs,
  },
  swipeActionNeutral: { backgroundColor: colors.surfaceContainerHigh },
  swipeActionAccent: { backgroundColor: colors.primary },
  swipeActionDanger: { backgroundColor: colors.errorContainer },
  swipeActionPressed: { opacity: 0.72 },
  swipeActionText: { ...typeScale.label, fontWeight: typeWeight.semibold },
});
