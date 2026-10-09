import { StyleSheet } from "react-native";
import {
  colors,
  controlSize,
  iconSize,
  layoutSize,
  radii,
  spacing,
  typeScale,
  typeWeight,
} from "../theme";
import { APP_MAX_FONT_SIZE_MULTIPLIER } from "./typography-policy";

/** Grid titles reserve two lines even when page metadata changes or text is enlarged. */
export const GRID_TITLE_LINES = 2;

// Scrollable tabs truncate visually while preserving their complete accessible name.
const TAB_MAX_WIDTH = 240;
const GRID_MIN_HEIGHT = controlSize.touch + controlSize.touch;

export const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderColor: colors.borderSoft,
    flex: 1,
    minHeight: layoutSize.row,
    minWidth: 0,
  },
  close: {
    alignItems: "center",
    borderColor: "transparent",
    borderRadius: radii.small,
    borderWidth: StyleSheet.hairlineWidth,
    flexShrink: 0,
    height: controlSize.touch,
    justifyContent: "center",
    width: controlSize.touch,
  },
  closeGlyph: {
    includeFontPadding: false,
    lineHeight: iconSize.action,
    textAlign: "center",
  },
  compact: {
    borderWidth: StyleSheet.hairlineWidth,
    minHeight: controlSize.regular,
  },
  compactClose: {
    height: controlSize.regular,
    width: controlSize.regular,
  },
  compactFocused: {
    borderColor: colors.text,
    borderWidth: StyleSheet.hairlineWidth,
  },
  compactGrid: {
    borderRadius: radii.medium,
    minHeight: controlSize.compact + controlSize.compact + controlSize.compact,
  },
  compactGridTitle: {
    minHeight: typeScale.label.lineHeight * GRID_TITLE_LINES,
  },
  compactLabel: {
    ...typeScale.label,
  },
  compactLeading: {
    height: iconSize.inline,
  },
  compactSelect: {
    borderWidth: 0,
    minHeight: controlSize.compact,
    paddingHorizontal: spacing.xs,
    paddingVertical: spacing.xxs,
  },
  compactStrip: {
    borderRadius: 0,
    borderTopLeftRadius: radii.small,
    borderTopRightRadius: radii.small,
    minHeight: controlSize.compact,
    overflow: "hidden",
  },
  detail: {
    color: colors.textMuted,
    ...typeScale.caption,
  },
  focused: { borderColor: colors.text },
  grid: {
    alignItems: "stretch",
    flexDirection: "column",
    minHeight: GRID_MIN_HEIGHT,
  },
  gridClose: {
    position: "absolute",
    right: 0,
    top: 0,
  },
  gridLeading: {
    alignSelf: "flex-start",
    flexShrink: 0,
    height: controlSize.compact,
    justifyContent: "center",
  },
  gridSelect: {
    alignItems: "stretch",
    flexDirection: "column",
    justifyContent: "center",
    paddingBottom: spacing.sm,
  },
  gridTitle: {
    // Reserve both lines at the supported maximum font scale to keep card geometry stable.
    minHeight: typeScale.body.lineHeight * GRID_TITLE_LINES * APP_MAX_FONT_SIZE_MULTIPLIER,
  },
  identity: {
    flex: 1,
    gap: spacing.xxs,
    minWidth: 0,
  },
  label: {
    color: colors.textMuted,
    ...typeScale.body,
  },
  leading: { flexShrink: 0 },
  pressed: { backgroundColor: colors.surfaceHover },
  root: {
    alignItems: "center",
    borderColor: "transparent",
    borderRadius: radii.small,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
  },
  select: {
    alignItems: "center",
    alignSelf: "stretch",
    borderColor: "transparent",
    borderRadius: radii.small,
    borderWidth: StyleSheet.hairlineWidth,
    flex: 1,
    flexDirection: "row",
    gap: spacing.xs,
    minHeight: controlSize.touch,
    minWidth: controlSize.touch,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  selected: { backgroundColor: colors.surfaceRaised },
  selectedLabel: {
    color: colors.text,
    fontWeight: typeWeight.semibold,
  },
  selectionMark: {
    backgroundColor: colors.textDim,
    borderRadius: radii.pill,
    bottom: 0,
    height: spacing.optical,
    left: spacing.sm,
    position: "absolute",
    right: spacing.sm,
  },
  strip: {
    flexShrink: 0,
    maxWidth: TAB_MAX_WIDTH,
    minHeight: controlSize.touch,
  },
  stripLabel: {
    color: colors.textMuted,
    ...typeScale.label,
  },
});
