import { StyleSheet } from "react-native";
import { colors, controlSize, radii, spacing, typeScale, typeWeight } from "../../../theme";

export const styles = StyleSheet.create({
  agentMessage: {
    paddingHorizontal: spacing.optical,
    paddingVertical: spacing.xxs,
  },
  cardIconSlot: {
    alignItems: "center",
    flexShrink: 0,
    justifyContent: "center",
  },
  cardTitle: {
    color: colors.text,
    flexShrink: 1,
    minWidth: 0,
    ...typeScale.label,
    fontWeight: typeWeight.semibold,
  },
  cardTitleWave: {
    alignSelf: "center",
    justifyContent: "center",
  },
  thinkingStatus: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.compact,
    minHeight: controlSize.compact,
    minWidth: 0,
    paddingHorizontal: 0,
  },
  thinkingStatusInActivity: { paddingLeft: 0 },
  turnMetaText: {
    color: colors.textMuted,
    ...typeScale.caption,
  },
  userBubble: {
    alignSelf: "flex-end",
    backgroundColor: colors.messageSurface,
    borderRadius: radii.selected,
    maxWidth: "82%",
    minWidth: 0,
    paddingBottom: spacing.xs,
    paddingHorizontal: spacing.sm,
    paddingTop: spacing.xs,
    width: "auto",
  },
});
