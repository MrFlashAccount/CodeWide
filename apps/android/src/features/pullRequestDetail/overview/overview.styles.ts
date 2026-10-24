import { StyleSheet } from "react-native";

import { colors, controlSize, radii, spacing, typeScale, typeWeight } from "../../../theme";

/** Overview geometry (N-01/N-02): 16dp inset, 8dp between cards, 12dp card inset, lines ≥48dp. */
export const overviewStyles = StyleSheet.create({
  banner: {
    backgroundColor: colors.surfaceContainer,
    borderColor: colors.border,
    borderRadius: radii.medium,
    borderWidth: 1,
    gap: spacing.xs,
    padding: spacing.sm,
  },
  bannerError: {
    backgroundColor: colors.errorContainer,
    borderColor: colors.errorContainer,
  },
  bannerWarning: {
    backgroundColor: colors.warningContainer,
    borderColor: colors.warningContainer,
  },
  body: {
    ...typeScale.body,
    color: colors.text,
  },
  card: {
    backgroundColor: "transparent",
    overflow: "hidden",
  },
  cardHeader: {
    alignItems: "center",
    columnGap: spacing.xs,
    flexDirection: "row",
    minHeight: controlSize.touch,
    paddingHorizontal: spacing.sm,
  },
  cardLine: {
    alignItems: "center",
    borderTopColor: colors.borderSoft,
    borderTopWidth: StyleSheet.hairlineWidth,
    columnGap: spacing.xs,
    flexDirection: "row",
    minHeight: controlSize.touch,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  cardTitle: {
    ...typeScale.body,
    color: colors.text,
    fontWeight: typeWeight.semibold,
  },
  code: {
    ...typeScale.code,
    color: colors.textMuted,
  },
  column: {
    gap: spacing.xs,
  },
  danger: {
    color: colors.error,
  },
  fill: {
    flex: 1,
    minWidth: 0,
  },
  label: {
    ...typeScale.label,
    color: colors.textMuted,
  },
  lineBody: {
    flex: 1,
    minWidth: 0,
  },
  markdownLine: {
    alignItems: "stretch",
    flexDirection: "column",
  },
  meta: {
    ...typeScale.label,
    color: colors.textMuted,
  },
  row: {
    alignItems: "center",
    columnGap: spacing.xs,
    flexDirection: "row",
    flexWrap: "nowrap",
  },
  section: {
    gap: spacing.sm,
  },
  sectionBody: {
    alignItems: "stretch",
    flexDirection: "column",
  },
  sectionHeader: {
    ...typeScale.heading,
    color: colors.text,
  },
  // A card line whose header and body stack (activity items).
  stacked: {
    alignItems: "stretch",
    flexDirection: "column",
    gap: spacing.xs,
  },
  statusStrip: {
    alignItems: "center",
    columnGap: spacing.sm,
    flexDirection: "row",
    flexWrap: "wrap",
    rowGap: spacing.xs,
  },
  success: {
    color: colors.success,
  },
  title: {
    ...typeScale.body,
    color: colors.text,
    fontWeight: typeWeight.medium,
  },
  wrapRow: {
    columnGap: spacing.xs,
    flexDirection: "row",
    flexWrap: "wrap",
    rowGap: spacing.xs,
  },
});
