import { StyleSheet } from "react-native";
import {
  colors,
  layoutSize,
  radii,
  spacing,
  touchTarget,
  typeScale,
  typeWeight,
} from "../../theme";

export const styles = StyleSheet.create({
  emptyConversation: {
    alignItems: "center",
    backgroundColor: colors.conversationSurface,
    flex: 1,
    gap: spacing.sm,
    justifyContent: "center",
  },
  emptyText: {
    color: colors.textMuted,
    ...typeScale.title,
  },
  errorText: {
    color: colors.red,
    ...typeScale.body,
  },
  headerIcon: {
    alignItems: "center",
    borderRadius: radii.large,
    height: touchTarget,
    justifyContent: "center",
    width: touchTarget,
  },
  primaryButton: {
    alignItems: "center",
    backgroundColor: colors.primary,
    borderRadius: radii.medium,
    justifyContent: "center",
    minHeight: touchTarget,
    paddingHorizontal: spacing.md,
  },
  primaryButtonText: {
    color: colors.onPrimary,
    fontWeight: typeWeight.semibold,
  },
  scannerCamera: {
    alignItems: "center",
    flex: 1,
    justifyContent: "center",
  },
  scannerError: {
    backgroundColor: colors.surfaceContainerHigh,
    borderRadius: radii.medium,
    bottom: spacing.xl,
    left: spacing.md,
    padding: spacing.sm,
    position: "absolute",
    right: spacing.md,
  },
  scannerFrame: {
    backgroundColor: "transparent",
    borderColor: colors.accent,
    borderRadius: radii.large,
    borderWidth: 3,
    height: 260,
    width: 260,
  },
  scannerHeader: {
    alignItems: "center",
    borderBottomColor: colors.border,
    borderBottomWidth: 1,
    flexDirection: "row",
    minHeight: layoutSize.header,
    paddingHorizontal: spacing.md,
  },
  scannerRoot: {
    backgroundColor: colors.background,
    flex: 1,
  },
  sheetTitle: {
    color: colors.text,
    flexShrink: 1,
    minWidth: 0,
    ...typeScale.heading,
  },
});
