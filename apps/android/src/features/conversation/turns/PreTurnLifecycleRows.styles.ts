import { StyleSheet } from "react-native";
import { colors, controlSize, spacing, typeScale, typeWeight } from "../../../theme";

export const styles = StyleSheet.create({
  preTurnLifecycleDetail: {
    alignSelf: "stretch",
    minWidth: 0,
    width: "100%",
  },
  preTurnLifecycleIcon: {
    alignItems: "center",
    flexShrink: 0,
    height: 18,
    justifyContent: "center",
    width: 16,
  },
  preTurnLifecycleList: {
    alignSelf: "stretch",
    gap: spacing.xxs,
    minWidth: 0,
    paddingVertical: spacing.optical,
    width: "100%",
  },
  preTurnLifecycleRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.xs,
    minHeight: controlSize.compact,
    paddingHorizontal: spacing.xs,
    width: "100%",
  },
  preTurnLifecycleText: {
    color: colors.textMuted,
    flexShrink: 1,
    minWidth: 0,
    ...typeScale.label,
    fontWeight: typeWeight.semibold,
  },
  preTurnLifecycleWave: {
    flexShrink: 1,
    minWidth: 0,
  },
});
