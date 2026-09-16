import { StyleSheet } from "react-native";
import { colors, controlSize, radii, spacing, typeScale, typeWeight } from "../../../theme";
import { TURN_FOOTER_MIN_HEIGHT } from "./TurnFooter";

export const styles = StyleSheet.create({
  disabled: { opacity: 0.42 },
  messageTime: {
    color: colors.textDim,
    flexShrink: 0,
    ...typeScale.caption,
    paddingHorizontal: spacing.sm,
  },
  optimisticError: {
    alignSelf: "flex-end",
    color: colors.red,
    maxWidth: "82%",
    paddingHorizontal: spacing.compact,
    ...typeScale.caption,
    textAlign: "right",
  },
  pressed: { opacity: 0.68 },
  retryMessageButton: {
    alignItems: "center",
    borderRadius: radii.medium,
    flexDirection: "row",
    gap: spacing.xxs,
    minHeight: controlSize.compact,
    paddingHorizontal: spacing.xs,
  },
  retryMessageText: {
    color: colors.accent,
    ...typeScale.label,
    fontWeight: typeWeight.semibold,
  },
  turnFooter: {
    alignItems: "center",
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.compact,
    minHeight: TURN_FOOTER_MIN_HEIGHT,
    paddingHorizontal: spacing.xxs,
  },
  turnFooterEnd: {
    alignSelf: "flex-end",
    justifyContent: "flex-end",
    maxWidth: "86%",
  },
  turnGroup: { gap: spacing.xxs },
  turnMetaText: {
    color: colors.textMuted,
    ...typeScale.caption,
  },
  turnStatusDot: {
    borderRadius: radii.pill,
    height: 7,
    width: 7,
  },
  turnStatusFailed: { backgroundColor: colors.red },
  userMessageRow: {
    alignItems: "flex-end",
    flexDirection: "column",
    gap: spacing.xxs,
    minWidth: 0,
    width: "100%",
  },
  userTurnCluster: {
    alignItems: "stretch",
    gap: spacing.optical,
    width: "100%",
  },
});
