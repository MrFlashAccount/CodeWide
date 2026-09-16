import { StyleSheet } from "react-native";
import { colors, radii, spacing, touchTarget, typeScale, typeWeight } from "../../../theme";

export const styles = StyleSheet.create({
  jumpToLatest: {
    alignItems: "center",
    backgroundColor: colors.primaryContainer,
    borderRadius: radii.pill,
    elevation: 3,
    height: touchTarget,
    justifyContent: "center",
    position: "absolute",
    right: spacing.md,
    width: touchTarget,
    zIndex: 20,
  },
  jumpToLatestBadge: {
    alignItems: "center",
    backgroundColor: colors.accent,
    borderRadius: radii.small,
    justifyContent: "center",
    minHeight: 20,
    minWidth: 20,
    paddingHorizontal: spacing.xxs,
    paddingVertical: spacing.optical,
    position: "absolute",
    right: -3,
    top: -3,
  },
  jumpToLatestBadgeText: {
    color: colors.onPrimary,
    ...typeScale.caption,
    fontVariant: ["tabular-nums"],
    fontWeight: typeWeight.semibold,
  },
  pressed: { opacity: 0.68 },
});
