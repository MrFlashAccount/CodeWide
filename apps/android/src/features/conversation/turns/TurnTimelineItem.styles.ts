import { StyleSheet } from "react-native";
import { colors, spacing, typeScale } from "../../../theme";

export const styles = StyleSheet.create({
  turnGroup: { gap: spacing.xxs },
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
  agentMessageRow: {
    width: "100%",
    minWidth: 0,
    flexDirection: "row",
    alignItems: "stretch",
    justifyContent: "flex-start",
    gap: 0,
  },
  userMessageContent: {
    minWidth: 0,
    gap: spacing.compact,
  },
  userMessageBlock: { minWidth: 0 },
  messageTime: {
    flexShrink: 0,
    color: colors.textDim,
    ...typeScale.caption,
    paddingHorizontal: spacing.sm,
  },
  agentPlaceholder: {
    color: colors.textDim,
    ...typeScale.label,
  },
});
