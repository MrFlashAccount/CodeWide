import { StyleSheet } from "react-native";
import { colors, controlSize, radii, spacing, typeScale, typeWeight } from "../../../theme";

export const styles = StyleSheet.create({
  agentText: {
    color: colors.text,
    maxWidth: "100%",
    minWidth: 0,
    ...typeScale.body,
  },
  attachmentChip: {
    alignItems: "center",
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
    borderRadius: radii.small,
    borderWidth: 1,
    flexDirection: "row",
    gap: spacing.xxs,
    maxWidth: "100%",
    minHeight: controlSize.compact,
    paddingHorizontal: spacing.xs,
  },
  attachmentText: {
    color: colors.textMuted,
    flex: 1,
    ...typeScale.label,
  },
  controlSectionLabel: {
    color: colors.textMuted,
    ...typeScale.label,
    fontWeight: typeWeight.semibold,
    paddingBottom: spacing.xs,
    paddingTop: spacing.md,
    textTransform: "uppercase",
  },
  menuActionTitle: {
    color: colors.text,
    ...typeScale.title,
  },
  menuNotice: {
    color: colors.textMuted,
    ...typeScale.body,
    paddingVertical: spacing.xs,
  },
  protocolBody: {
    alignSelf: "stretch",
    gap: spacing.xxs,
    maxWidth: "100%",
    minWidth: 0,
    width: "100%",
  },
  protocolBodyActions: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
    minHeight: controlSize.compact,
  },
  rawLink: {
    color: colors.accent,
    ...typeScale.label,
    fontWeight: typeWeight.semibold,
  },
  searchResult: {
    borderBottomColor: colors.borderSoft,
    borderBottomWidth: 1,
    paddingVertical: spacing.compact,
  },
  toolMarkdownResult: {
    alignSelf: "stretch",
    maxWidth: "100%",
    minWidth: 0,
    width: "100%",
  },
  turnMetaText: {
    color: colors.textMuted,
    ...typeScale.caption,
  },
});
