import { StyleSheet } from "react-native";
import { colors, radii, spacing, touchTarget, typeScale, typeWeight } from "../../../theme";
export const styles = StyleSheet.create({
  pressed: { opacity: 0.68 },
  jumpToLatest: {
    position: "absolute",
    right: spacing.md,
    zIndex: 20,
    width: touchTarget,
    height: touchTarget,
    borderRadius: radii.pill,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.primaryContainer,
    elevation: 3,
  },
  jumpToLatestBadge: {
    position: "absolute",
    top: -3,
    right: -3,
    minWidth: 20,
    minHeight: 20,
    paddingHorizontal: spacing.xxs,
    paddingVertical: spacing.optical,
    borderRadius: radii.small,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.accent,
  },
  jumpToLatestBadgeText: {
    color: colors.onPrimary,
    ...typeScale.caption,
    fontWeight: typeWeight.semibold,
    fontVariant: ["tabular-nums"],
  },
});
