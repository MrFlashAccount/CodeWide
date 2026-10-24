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

/** Stroke of the hollow dot used when checks are absent or unavailable. */
const HOLLOW_DOT_STROKE = 1.5;
const ATTENTION_DOT_SIZE = 7;
const CHECK_BADGE_SIZE = 8;
const FILTER_COUNT_SIZE = 18;
const ACTIVE_TOKEN_MAX_WIDTH = 180;
const FILTER_COUNT_BORDER_WIDTH = 2;

/** PR list geometry: 64dp rows, 16dp inset, label-role section headers. */
export const listStyles = StyleSheet.create({
  activeToken: {
    alignItems: "center",
    backgroundColor: colors.surfaceContainer,
    borderColor: colors.border,
    borderRadius: radii.small,
    borderWidth: 1,
    columnGap: spacing.compact,
    flexDirection: "row",
    height: controlSize.compact,
    maxWidth: ACTIVE_TOKEN_MAX_WIDTH,
    paddingHorizontal: spacing.sm,
  },
  activeTokens: {
    columnGap: spacing.xs,
    paddingBottom: spacing.xs,
    paddingHorizontal: spacing.md,
  },
  activeTokenText: {
    ...typeScale.label,
    color: colors.text,
    flexShrink: 1,
  },
  age: {
    ...typeScale.label,
    color: colors.textDim,
    fontVariant: ["tabular-nums"],
  },
  attentionDot: {
    backgroundColor: colors.text,
    borderRadius: radii.pill,
    height: ATTENTION_DOT_SIZE,
    width: ATTENTION_DOT_SIZE,
  },
  checkDot: {
    borderColor: colors.threadListSurface,
    borderRadius: radii.pill,
    borderWidth: 1,
    bottom: -1,
    height: CHECK_BADGE_SIZE,
    position: "absolute",
    right: -1,
    width: CHECK_BADGE_SIZE,
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
  filterButton: {
    alignItems: "center",
    backgroundColor: colors.surfaceContainer,
    borderColor: colors.border,
    borderRadius: radii.medium,
    borderWidth: 1,
    height: controlSize.touch,
    justifyContent: "center",
    position: "relative",
    width: controlSize.touch,
  },
  filterCount: {
    alignItems: "center",
    backgroundColor: colors.primary,
    borderColor: colors.threadListSurface,
    borderRadius: radii.pill,
    borderWidth: FILTER_COUNT_BORDER_WIDTH,
    height: FILTER_COUNT_SIZE,
    justifyContent: "center",
    minWidth: FILTER_COUNT_SIZE,
    position: "absolute",
    right: -spacing.xxs,
    top: -spacing.xxs,
  },
  filterCountText: {
    ...typeScale.caption,
    color: colors.onPrimary,
  },
  filterHeader: {
    flexShrink: 0,
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
  quickView: {
    alignItems: "center",
    borderColor: colors.border,
    borderRadius: radii.pill,
    borderWidth: 1,
    height: controlSize.compact,
    justifyContent: "center",
    paddingHorizontal: spacing.sm,
  },
  quickViews: {
    columnGap: spacing.xs,
    paddingBottom: spacing.xs,
    paddingHorizontal: spacing.md,
  },
  quickViewSelected: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  quickViewText: {
    ...typeScale.label,
    color: colors.textMuted,
  },
  quickViewTextSelected: {
    color: colors.onPrimary,
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
    position: "relative",
    width: iconSize.inline,
  },
  searchField: {
    alignItems: "center",
    backgroundColor: colors.surfaceContainer,
    borderColor: colors.borderSoft,
    borderRadius: radii.medium,
    borderWidth: 1,
    columnGap: spacing.xs,
    flex: 1,
    flexDirection: "row",
    height: controlSize.touch,
    paddingHorizontal: spacing.sm,
  },
  searchInput: {
    ...typeScale.body,
    color: colors.text,
    flex: 1,
    minWidth: 0,
    paddingVertical: 0,
  },
  searchRow: {
    alignItems: "center",
    columnGap: spacing.xs,
    flexDirection: "row",
    paddingBottom: spacing.xs,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.xs,
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
