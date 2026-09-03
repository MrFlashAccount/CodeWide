import { StyleSheet } from "react-native";

import { colors, radii, spacing, typeScale } from "../../presentation/tokens";

export const newThreadViewStyles = StyleSheet.create({
  chevron: { color: colors.accent, ...typeScale.title },
  disabled: { opacity: 0.45 },
  emptyState: {
    alignItems: "center",
    flex: 1,
    gap: spacing.xs,
    justifyContent: "center",
    paddingHorizontal: spacing.lg,
  },
  pending: { paddingHorizontal: spacing.sm, paddingVertical: spacing.xxs },
  projectButton: {
    alignItems: "center",
    borderRadius: radii.large,
    flexDirection: "row",
    gap: spacing.xxs,
    justifyContent: "center",
    maxWidth: "100%",
    minHeight: 40,
    paddingHorizontal: spacing.sm,
  },
  projectLoading: { color: colors.textMuted, ...typeScale.caption },
  projectText: { color: colors.accent, flexShrink: 1, minWidth: 0, ...typeScale.title },
  prompt: { ...typeScale.heading, textAlign: "center" },
});
