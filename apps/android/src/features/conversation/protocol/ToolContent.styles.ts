import { StyleSheet } from "react-native";
import { colors, controlSize, radii, spacing, typeScale, typeWeight } from "../../../theme";

export const styles = StyleSheet.create({
  attachmentChip: {
    minHeight: controlSize.compact,
    maxWidth: "100%",
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xxs,
    paddingHorizontal: spacing.xs,
    borderRadius: radii.small,
    backgroundColor: colors.surfaceRaised,
    borderWidth: 1,
    borderColor: colors.border,
  },
  attachmentText: { flex: 1, color: colors.textMuted, ...typeScale.label },
  agentText: { minWidth: 0, maxWidth: "100%", color: colors.text, ...typeScale.body },
  searchResult: {
    paddingVertical: spacing.compact,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderSoft,
  },
  rawLink: { color: colors.accent, ...typeScale.label, fontWeight: typeWeight.semibold },
  protocolBody: {
    width: "100%",
    minWidth: 0,
    maxWidth: "100%",
    alignSelf: "stretch",
    gap: spacing.xxs,
  },
  toolMarkdownResult: { width: "100%", minWidth: 0, maxWidth: "100%", alignSelf: "stretch" },
  protocolBodyActions: {
    minHeight: controlSize.compact,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  turnMetaText: { color: colors.textMuted, ...typeScale.caption },
  menuNotice: { color: colors.textMuted, ...typeScale.body, paddingVertical: spacing.xs },
  menuActionTitle: { color: colors.text, ...typeScale.title },
  controlSectionLabel: {
    color: colors.textMuted,
    ...typeScale.label,
    fontWeight: typeWeight.semibold,
    textTransform: "uppercase",
    paddingTop: spacing.md,
    paddingBottom: spacing.xs,
  },
});
