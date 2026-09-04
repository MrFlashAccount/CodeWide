import {
  StyleSheet,
  type PressableStateCallbackType,
  type StyleProp,
  type ViewStyle,
} from "react-native";

import { colors, radii, spacing, touchTarget, typeScale } from "../../theme";

export function iconButtonStyle(state: PressableStateCallbackType): StyleProp<ViewStyle> {
  return [threadGoalSheetStyles.iconButton, state.pressed && threadGoalSheetStyles.pressed];
}

export function dangerButtonStyle(state: PressableStateCallbackType): StyleProp<ViewStyle> {
  return [
    threadGoalSheetStyles.button,
    threadGoalSheetStyles.dangerButton,
    state.pressed && threadGoalSheetStyles.pressed,
  ];
}

export function secondaryButtonStyle(state: PressableStateCallbackType): StyleProp<ViewStyle> {
  return [
    threadGoalSheetStyles.button,
    threadGoalSheetStyles.secondaryButton,
    state.pressed && threadGoalSheetStyles.pressed,
  ];
}

export function primaryButtonStyle(state: PressableStateCallbackType): StyleProp<ViewStyle> {
  return [
    threadGoalSheetStyles.button,
    threadGoalSheetStyles.primaryButton,
    state.pressed && threadGoalSheetStyles.pressed,
  ];
}

export const threadGoalSheetStyles = StyleSheet.create({
  actions: { alignItems: "center", flexDirection: "row", gap: spacing.xs },
  button: {
    alignItems: "center",
    borderRadius: radii.large,
    justifyContent: "center",
    minHeight: touchTarget,
    paddingHorizontal: spacing.md,
  },
  content: { gap: spacing.sm, paddingBottom: spacing.md },
  dangerButton: { backgroundColor: colors.errorContainer },
  detailItem: {
    backgroundColor: colors.surfaceContainer,
    borderRadius: radii.medium,
    flexBasis: "47%",
    flexGrow: 1,
    gap: spacing.optical,
    minWidth: 112,
    padding: spacing.sm,
  },
  detailLabel: { ...typeScale.caption },
  detailValue: { ...typeScale.label },
  details: { flexDirection: "row", flexWrap: "wrap", gap: spacing.xs },
  flex: { flex: 1 },
  header: { alignItems: "center", flexDirection: "row", minHeight: 64 },
  iconButton: {
    alignItems: "center",
    borderRadius: radii.large,
    height: touchTarget,
    justifyContent: "center",
    width: touchTarget,
  },
  input: {
    backgroundColor: colors.surfaceContainer,
    borderColor: colors.border,
    borderRadius: radii.medium,
    borderWidth: StyleSheet.hairlineWidth,
    color: colors.text,
    minHeight: 112,
    padding: spacing.md,
    textAlignVertical: "top",
    ...typeScale.body,
  },
  label: { ...typeScale.label },
  pressed: { opacity: 0.68 },
  primaryButton: { backgroundColor: colors.primary },
  primaryLabel: { color: colors.onPrimary },
  secondaryButton: { backgroundColor: colors.surfaceContainer },
  subtitle: { ...typeScale.label, marginTop: spacing.optical },
  title: { ...typeScale.heading },
  titleBlock: { flex: 1, minWidth: 0 },
});
