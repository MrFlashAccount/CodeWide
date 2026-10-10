import { StyleSheet } from "react-native";

import { colors, radii, spacing, typeScale } from "../../theme";
import { listRowHeight } from "../../ui/AppListRow.types";

export const styles = StyleSheet.create({
  callout: {
    // Setup and progress are not warnings: a raised neutral surface keeps the
    // tone calm, and only a real failure switches to the error container.
    backgroundColor: colors.surfaceContainerHighest,
    borderRadius: radii.medium,
    flexDirection: "row",
    gap: spacing.sm,
    marginBottom: spacing.sm,
    marginHorizontal: spacing.sm,
    padding: spacing.sm,
  },
  calloutActions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.xs,
  },
  calloutBody: {
    flex: 1,
    gap: spacing.xs,
    minWidth: 0,
  },
  calloutError: {
    backgroundColor: colors.errorContainer,
    borderRadius: radii.medium,
    flexDirection: "row",
    gap: spacing.sm,
    marginBottom: spacing.sm,
    marginHorizontal: spacing.sm,
    padding: spacing.sm,
  },
  calloutIcon: {
    marginTop: spacing.optical,
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
    backgroundColor: colors.code,
    borderRadius: radii.compact,
    color: colors.text,
    paddingHorizontal: spacing.xs,
    paddingVertical: spacing.xxs,
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
