import { StyleSheet } from "react-native";

import {
  colors,
  controlSize,
  iconSize,
  layoutSize,
  radii,
  spacing,
  typeScale,
  typeTracking,
} from "../../../theme";
import { catalogModeBarContentInset } from "../../../presentation/layouts/catalogModeBarGeometry";

/** Diameter of the check-state dot; smaller than an indicator glyph so the title leads. */
const CHECK_DOT_SIZE = 10;
/** Stroke of the hollow dot used when checks are absent or unavailable. */
const HOLLOW_DOT_STROKE = 1.5;

/** PR list geometry: 64dp rows, 16dp inset, label-role section headers. */
export const listStyles = StyleSheet.create({
  age: {
    ...typeScale.label,
    color: colors.textDim,
    fontVariant: ["tabular-nums"],
  },
  categoryChips: {
    columnGap: spacing.xs,
    paddingRight: spacing.md,
  },
  categoryStrip: {
    flex: 1,
    minWidth: 0,
  },
  chip: {
    alignItems: "center",
    borderColor: colors.border,
    borderRadius: radii.small,
    borderWidth: 1,
    flexDirection: "row",
    minHeight: controlSize.compact,
    paddingHorizontal: spacing.sm,
  },
  chipLabel: {
    ...typeScale.label,
    color: colors.text,
  },
  chipSelected: {
    backgroundColor: colors.surfaceContainerHigh,
    borderColor: colors.surfaceContainerHigh,
  },
  dot: {
    borderRadius: radii.pill,
    height: CHECK_DOT_SIZE,
    width: CHECK_DOT_SIZE,
  },
  dotFailing: {
    backgroundColor: colors.error,
  },
  dotNeutral: {
    borderColor: colors.textDim,
    borderWidth: HOLLOW_DOT_STROKE,
  },
  dotPassing: {
    backgroundColor: colors.success,
  },
  dotPending: {
    backgroundColor: colors.warning,
  },
  fill: {
    flex: 1,
  },
  filters: {
    alignItems: "center",
    columnGap: spacing.xs,
    flexDirection: "row",
    paddingBottom: spacing.xs,
    paddingLeft: spacing.md,
    paddingTop: spacing.xs,
  },
  floatingBarContent: {
    paddingBottom: catalogModeBarContentInset,
  },
  meta: {
    ...typeScale.label,
    color: colors.textMuted,
    flexShrink: 1,
  },
  metaRow: {
    alignItems: "center",
    columnGap: spacing.compact,
    flexDirection: "row",
  },
  notice: {
    ...typeScale.label,
    color: colors.textMuted,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  pressed: {
    backgroundColor: colors.surfaceHover,
  },
  problemError: {
    ...typeScale.title,
    color: colors.error,
  },
  problemExpired: {
    ...typeScale.title,
    color: colors.warning,
  },
  repositoryFilter: {
    alignItems: "center",
    backgroundColor: colors.surfaceContainer,
    borderRadius: radii.small,
    columnGap: spacing.compact,
    flexDirection: "row",
    maxWidth: "52%",
    minHeight: controlSize.compact,
    paddingHorizontal: spacing.sm,
  },
  repositoryLabel: {
    ...typeScale.label,
    color: colors.text,
    flexShrink: 1,
  },
  row: {
    alignItems: "center",
    columnGap: spacing.sm,
    flexDirection: "row",
    minHeight: layoutSize.row,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  rowBody: {
    flex: 1,
    minWidth: 0,
  },
  rowLead: {
    alignItems: "center",
    justifyContent: "center",
    width: iconSize.inline,
  },
  section: {
    alignItems: "center",
    columnGap: spacing.xs,
    flexDirection: "row",
    paddingBottom: spacing.xxs,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
  },
  sectionLabel: {
    ...typeScale.label,
    color: colors.textDim,
    flex: 1,
    letterSpacing: typeTracking.caps,
  },
  title: {
    ...typeScale.body,
    color: colors.text,
    flexShrink: 1,
  },
  // In a row title line the title takes the free width so the age sits on the trailing edge.
  titleFill: {
    flex: 1,
    minWidth: 0,
  },
  titleRow: {
    alignItems: "center",
    columnGap: spacing.xs,
    flexDirection: "row",
  },
});
