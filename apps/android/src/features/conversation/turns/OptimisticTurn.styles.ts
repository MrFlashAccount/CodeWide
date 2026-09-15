import { StyleSheet } from "react-native";
import { colors, controlSize, radii, spacing, typeScale, typeWeight } from "../../../theme";
import { TURN_FOOTER_MIN_HEIGHT } from "./TurnFooter";

export const styles = StyleSheet.create({
  pressed: { opacity: 0.68 },
  turnGroup: { gap: spacing.xxs },
  turnFooter: {
    minHeight: TURN_FOOTER_MIN_HEIGHT,
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: spacing.compact,
    paddingHorizontal: spacing.xxs,
  },
  turnFooterEnd: {
    alignSelf: "flex-end",
    justifyContent: "flex-end",
    maxWidth: "86%",
  },
  turnStatusDot: {
    width: 7,
    height: 7,
    borderRadius: radii.pill,
  },
  turnStatusFailed: { backgroundColor: colors.red },
  userTurnCluster: {
    width: "100%",
    alignItems: "stretch",
    gap: spacing.optical,
  },
  userMessageRow: {
    width: "100%",
    minWidth: 0,
    flexDirection: "column",
    alignItems: "flex-end",
    gap: spacing.xxs,
  },
  messageTime: {
    flexShrink: 0,
    color: colors.textDim,
    ...typeScale.caption,
    paddingHorizontal: spacing.sm,
  },
  optimisticError: {
    maxWidth: "82%",
    alignSelf: "flex-end",
    paddingHorizontal: spacing.compact,
    color: colors.red,
    ...typeScale.caption,
    textAlign: "right",
  },
  retryMessageButton: {
    minHeight: controlSize.compact,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xxs,
    paddingHorizontal: spacing.xs,
    borderRadius: radii.medium,
  },
  retryMessageText: {
    color: colors.accent,
    ...typeScale.label,
    fontWeight: typeWeight.semibold,
  },
  turnMetaText: {
    color: colors.textMuted,
    ...typeScale.caption,
  },
  disabled: { opacity: 0.42 },
});
