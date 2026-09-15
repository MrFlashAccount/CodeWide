import { StyleSheet } from "react-native";
import { colors, controlSize, radii, spacing, typeScale } from "../../theme";

export const styles = StyleSheet.create({
  emptyText: { color: colors.textMuted, ...typeScale.title },
  conversationBackendRefreshIndicator: { flexShrink: 0 },
  conversationSubtitle: { color: colors.textMuted, ...typeScale.label, marginTop: spacing.optical },
  historyLoadingIndicator: {
    position: "absolute",
    top: spacing.xs,
    left: 0,
    right: 0,
    zIndex: 11,
    alignItems: "center",
  },
  historyLoadingIndicatorPill: {
    width: controlSize.compact,
    height: controlSize.compact,
    borderRadius: radii.pill,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.surfaceContainerHigh,
  },
});
