import { StyleSheet } from "react-native";
import { colors, controlSize, radii, spacing, typeScale, typeWeight } from "../../../theme";

export const styles = StyleSheet.create({
  userBubble: {
    minWidth: 0,
    alignSelf: "flex-end",
    width: "auto",
    maxWidth: "82%",
    backgroundColor: colors.messageSurface,
    borderRadius: radii.selected,
    paddingHorizontal: spacing.sm,
    paddingTop: spacing.xs,
    paddingBottom: spacing.xs,
  },
  agentMessage: {
    paddingHorizontal: spacing.optical,
    paddingVertical: spacing.xxs,
  },
  cardIconSlot: {
    flexShrink: 0,
    alignItems: "center",
    justifyContent: "center",
  },
  cardTitle: {
    minWidth: 0,
    flexShrink: 1,
    color: colors.text,
    ...typeScale.label,
    fontWeight: typeWeight.semibold,
  },
  cardTitleWave: {
    alignSelf: "center",
    justifyContent: "center",
  },
  thinkingStatus: {
    minWidth: 0,
    minHeight: controlSize.compact,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.compact,
    paddingHorizontal: 0,
  },
  thinkingStatusInActivity: { paddingLeft: 0 },
  turnMetaText: {
    color: colors.textMuted,
    ...typeScale.caption,
  },
});
