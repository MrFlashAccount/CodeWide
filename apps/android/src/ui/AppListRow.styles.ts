import { StyleSheet } from "react-native";
import { colors, radii, spacing, typeScale } from "../theme";

export const listRowStyles = StyleSheet.create({
  surface: { width: "100%", minWidth: 0, overflow: "hidden", backgroundColor: colors.surfaceContainer },
  only: { borderRadius: radii.medium },
  first: { borderTopLeftRadius: radii.medium, borderTopRightRadius: radii.medium },
  middle: {},
  last: { borderBottomLeftRadius: radii.medium, borderBottomRightRadius: radii.medium },
  disabled: { opacity: 0.4 },
  selected: { backgroundColor: colors.surfaceContainerHigh },
  row: { flexDirection: "row", alignItems: "center", paddingHorizontal: spacing.md, paddingVertical: spacing.xs, gap: spacing.md },
  text: { flex: 1, minWidth: 0, gap: spacing.xxs },
  title: { ...typeScale.body, color: colors.text },
  description: { ...typeScale.label, color: colors.textMuted },
  supporting: { flexDirection: "row", alignItems: "center", gap: spacing.xxs },
  supportingText: { flex: 1, minWidth: 0 },
  danger: { color: colors.red },
  slot: { flexDirection: "row", alignItems: "center", gap: spacing.xs, flexShrink: 0 },
  separator: { position: "absolute", bottom: 0, left: spacing.sm, right: spacing.sm, height: StyleSheet.hairlineWidth, backgroundColor: colors.border },
  pressed: { opacity: 0.7 },
});
