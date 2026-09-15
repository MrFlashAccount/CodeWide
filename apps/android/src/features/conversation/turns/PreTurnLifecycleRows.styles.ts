import { StyleSheet } from "react-native";
import { colors, controlSize, spacing, typeScale, typeWeight } from "../../../theme";

export const styles = StyleSheet.create({
  preTurnLifecycleList: {
    width: "100%",
    minWidth: 0,
    alignSelf: "stretch",
    gap: spacing.xxs,
    paddingVertical: spacing.optical,
  },
  preTurnLifecycleRow: {
    width: "100%",
    minHeight: controlSize.compact,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    paddingHorizontal: spacing.xs,
  },
  preTurnLifecycleIcon: {
    width: 16,
    height: 18,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  preTurnLifecycleText: {
    minWidth: 0,
    flexShrink: 1,
    color: colors.textMuted,
    ...typeScale.label,
    fontWeight: typeWeight.semibold,
  },
  preTurnLifecycleWave: { minWidth: 0, flexShrink: 1 },
  preTurnLifecycleDetail: { width: "100%", minWidth: 0, alignSelf: "stretch" },
});
