import { StyleSheet } from "react-native";
import { colors, spacing, typeScale } from "../../../theme";

export const styles = StyleSheet.create({
  agentMessageRow: {
    alignItems: "stretch",
    flexDirection: "row",
    gap: 0,
    justifyContent: "flex-start",
    minWidth: 0,
    width: "100%",
  },
  agentPlaceholder: {
    color: colors.textDim,
    ...typeScale.label,
  },
  messageTime: {
    color: colors.textDim,
    flexShrink: 0,
    ...typeScale.caption,
    paddingHorizontal: spacing.sm,
  },
  turnGroup: { gap: spacing.xxs },
  userMessageBlock: { minWidth: 0 },
  userMessageContent: {
    gap: spacing.compact,
    minWidth: 0,
  },
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
