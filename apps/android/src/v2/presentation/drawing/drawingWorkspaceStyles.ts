import {
  StyleSheet,
  type PressableStateCallbackType,
  type StyleProp,
  type ViewStyle,
} from "react-native";

import { colors, radii, spacing, touchTarget, typeScale } from "../../theme";

export function closeButtonStyle(state: PressableStateCallbackType): StyleProp<ViewStyle> {
  return [drawingWorkspaceStyles.iconButton, state.pressed && drawingWorkspaceStyles.pressed];
}

export function saveButtonStyle(state: PressableStateCallbackType): StyleProp<ViewStyle> {
  return [drawingWorkspaceStyles.saveButton, state.pressed && drawingWorkspaceStyles.savePressed];
}

export const drawingWorkspaceStyles = StyleSheet.create({
  board: { flex: 1, position: "relative" },
  errorBar: {
    alignItems: "center",
    backgroundColor: colors.surfaceRaised,
    flexDirection: "row",
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  errorText: { flex: 1, ...typeScale.label },
  header: {
    alignItems: "center",
    backgroundColor: colors.surface,
    borderBottomColor: colors.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    gap: spacing.sm,
    minHeight: 64,
    paddingBottom: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  iconButton: {
    alignItems: "center",
    borderRadius: radii.large,
    height: touchTarget,
    justifyContent: "center",
    width: touchTarget,
  },
  loader: {
    alignItems: "center",
    bottom: 0,
    justifyContent: "center",
    left: 0,
    position: "absolute",
    right: 0,
    top: 0,
    zIndex: 1,
  },
  loadingText: { color: colors.textMuted, ...typeScale.body },
  pressed: { backgroundColor: colors.surfaceHover },
  quickdraw: { flex: 1 },
  root: { backgroundColor: colors.background, flex: 1 },
  saveButton: {
    alignItems: "center",
    backgroundColor: colors.accent,
    borderRadius: radii.large,
    height: 38,
    justifyContent: "center",
    minWidth: 78,
    paddingHorizontal: spacing.md,
  },
  savePressed: { opacity: 0.82 },
  saveText: { color: colors.onPrimary, ...typeScale.label },
  subtitle: { ...typeScale.label },
  title: { ...typeScale.title },
  titleBlock: { flex: 1, minWidth: 0 },
});
