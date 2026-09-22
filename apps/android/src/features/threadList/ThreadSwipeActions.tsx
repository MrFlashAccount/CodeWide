import { Ionicons, MaterialIcons } from "@expo/vector-icons";
import type { ReactNode } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { colors, iconSize, layoutSize, radii, spacing, typeScale, typeWeight } from "../../theme";
import { AppText as Text } from "../../ui/Typography";

export const THREAD_SWIPE_ACTION_WIDTH = layoutSize.row;

export const THREAD_SWIPE_UNDERLAY_OVERLAP = radii.selected;

export const THREAD_SWIPE_ACTIONS_WIDTH = THREAD_SWIPE_ACTION_WIDTH * 3;

export function ThreadSwipeActions({ children }: { children: ReactNode }) {
  return (
    <View style={styles.swipeActionsLayout}>
      <View style={styles.swipeActionsUnderlay}>
        <View style={styles.swipeActionsRight}>{children}</View>
      </View>
    </View>
  );
}

export function ThreadSwipeAction({
  icon,
  label,
  onPress,
  tone,
}: {
  icon: keyof typeof Ionicons.glyphMap | "push-pin";
  label: string;
  onPress?: () => void;
  tone: "neutral" | "accent" | "danger";
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
        <MaterialIcons color={foreground} name="push-pin" size={iconSize.action} />
      ) : (
        <Ionicons color={foreground} name={icon} size={iconSize.action} />
      )}
      <Text style={[styles.swipeActionText, { color: foreground }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  swipeAction: {
    alignItems: "center",
    alignSelf: "stretch",
    gap: spacing.xxs,
    justifyContent: "center",
    width: THREAD_SWIPE_ACTION_WIDTH,
  },
  swipeActionAccent: { backgroundColor: colors.primary },
  swipeActionDanger: { backgroundColor: colors.errorContainer },
  swipeActionNeutral: { backgroundColor: colors.surfaceContainerHigh },
  swipeActionPressed: { opacity: 0.72 },
  swipeActionsLayout: {
    alignSelf: "stretch",
    width: THREAD_SWIPE_ACTIONS_WIDTH,
  },
  swipeActionsRight: {
    flexDirection: "row",
    height: "100%",
    width: THREAD_SWIPE_ACTIONS_WIDTH,
  },
  swipeActionsUnderlay: {
    backgroundColor: colors.surfaceContainerHigh,
    borderRadius: radii.selected,
    bottom: 0,
    left: -THREAD_SWIPE_UNDERLAY_OVERLAP,
    overflow: "hidden",
    paddingLeft: THREAD_SWIPE_UNDERLAY_OVERLAP,
    position: "absolute",
    right: 0,
    top: 0,
  },
  swipeActionText: {
    ...typeScale.label,
    fontWeight: typeWeight.semibold,
  },
});
