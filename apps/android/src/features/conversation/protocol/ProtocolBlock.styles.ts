import { StyleSheet } from "react-native";
import { colors, radii, spacing, typeScale } from "../../../theme";

export const styles = StyleSheet.create({
  agentMessage: {
    paddingHorizontal: spacing.optical,
    paddingVertical: spacing.xxs,
  },
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
