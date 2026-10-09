import { StyleSheet } from "react-native";
import { colors, controlSize, radii, spacing, typeScale } from "../../theme";

export const styles = StyleSheet.create({
  conversationBackendRefreshIndicator: { flexShrink: 0 },
  conversationSubtitle: {
    color: colors.textMuted,
    flexShrink: 1,
    ...typeScale.label,
  },
  conversationSubtitleRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.xs,
    marginTop: spacing.optical,
    minWidth: 0,
  },
  emptyText: {
    color: colors.textMuted,
    ...typeScale.title,
  },
  historyLoadingIndicator: {
    alignItems: "center",
    left: 0,
    position: "absolute",
    right: 0,
    top: spacing.xs,
    zIndex: 11,
  },
  historyLoadingIndicatorPill: {
    alignItems: "center",
    backgroundColor: colors.surfaceContainerHigh,
    borderRadius: radii.pill,
    height: controlSize.compact,
    justifyContent: "center",
    width: controlSize.compact,
  },
});
