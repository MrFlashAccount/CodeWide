import { StyleSheet } from "react-native";

import { SETTINGS_ROW_LEADING_SIZE } from "../../ui/settingsRowLayout";

import { colors, radii, spacing, typeScale } from "../../theme";
import { listRowHeight } from "../../ui/AppListRow.types";

export const styles = StyleSheet.create({
  callout: {
    // Setup and progress are not warnings: a raised neutral surface keeps the
    // tone calm, and only a real failure switches to the error container.
    backgroundColor: colors.surfaceContainerHighest,
    borderRadius: radii.medium,
    gap: spacing.xs,
    marginBottom: spacing.md,
    // The callout text starts in the row's text column.
    marginLeft: spacing.md + SETTINGS_ROW_LEADING_SIZE + spacing.md - spacing.sm,
    marginRight: spacing.md,
    padding: spacing.sm,
  },
  calloutActions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.xs,
  },
  calloutError: {
    backgroundColor: colors.errorContainer,
    borderRadius: radii.medium,
    gap: spacing.xs,
    marginBottom: spacing.md,
    // The callout text starts in the row's text column.
    marginLeft: spacing.md + SETTINGS_ROW_LEADING_SIZE + spacing.md - spacing.sm,
    marginRight: spacing.md,
    padding: spacing.sm,
  },
  calloutText: {
    color: colors.text,
    ...typeScale.label,
  },
  calloutTextError: {
    color: colors.onErrorContainer,
    ...typeScale.label,
  },
  card: {
    backgroundColor: colors.surfaceContainer,
    borderRadius: radii.medium,
    overflow: "hidden",
  },
  command: {
    alignItems: "center",
    backgroundColor: colors.code,
    borderRadius: radii.compact,
    flexDirection: "row",
    paddingLeft: spacing.xs,
  },
  commandText: {
    color: colors.text,
    flex: 1,
    minWidth: 0,
    ...typeScale.code,
  },
  description: {
    color: colors.textMuted,
    ...typeScale.label,
  },
  descriptionError: {
    color: colors.red,
  },
  descriptionSuccess: {
    color: colors.green,
  },
  leadingSlot: {
    alignItems: "center",
    width: SETTINGS_ROW_LEADING_SIZE,
  },
  row: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.md,
    minHeight: listRowHeight.double,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  text: {
    flex: 1,
    gap: spacing.xxs,
    minWidth: 0,
  },
  title: {
    color: colors.text,
    ...typeScale.body,
  },
  titleShimmer: {
    alignSelf: "flex-start",
  },
});
