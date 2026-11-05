import { StyleSheet } from "react-native";

import {
  colors,
  controlSize,
  radii,
  spacing,
  typeScale,
  typeTracking,
  typeWeight,
} from "../../../theme";
import { APP_SHEET_MAX_WIDTH } from "../../../ui/appSheetGeometry";

const CHOICE_SIZE = 22;
const FACET_ICON_SIZE = 34;
const FACET_ROW_HEIGHT = 58;
const OPTION_ROW_HEIGHT = 54;
const TOKEN_HEIGHT = controlSize.compact - spacing.xxs;
const TOKEN_INPUT_MIN_WIDTH = 120;

export const filterStyles = StyleSheet.create({
  applyButton: {
    alignItems: "center",
    backgroundColor: colors.primary,
    borderRadius: radii.pill,
    justifyContent: "center",
    minHeight: controlSize.touch,
    paddingHorizontal: spacing.lg,
    width: "100%",
  },
  applyText: {
    ...typeScale.body,
    color: colors.onPrimary,
    fontWeight: typeWeight.semibold,
  },
  body: {
    flex: 1,
    minHeight: 0,
  },
  checkBox: {
    alignItems: "center",
    borderColor: colors.border,
    borderRadius: radii.small,
    borderWidth: 1,
    height: CHOICE_SIZE,
    justifyContent: "center",
    width: CHOICE_SIZE,
  },
  checkBoxSelected: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  emptyHint: {
    ...typeScale.body,
    color: colors.textDim,
    paddingVertical: spacing.sm,
  },
  facetBadge: {
    alignItems: "center",
    backgroundColor: colors.surfaceContainerHighest,
    borderRadius: radii.pill,
    minWidth: CHOICE_SIZE,
    paddingHorizontal: spacing.compact,
    paddingVertical: spacing.optical,
  },
  facetBadgeText: {
    ...typeScale.label,
    color: colors.text,
  },
  facetBody: {
    flex: 1,
    minWidth: 0,
  },
  facetContent: {
    paddingBottom: spacing.xl,
    paddingHorizontal: spacing.md,
  },
  facetIcon: {
    alignItems: "center",
    backgroundColor: colors.surfaceContainerHigh,
    borderRadius: radii.small,
    height: FACET_ICON_SIZE,
    justifyContent: "center",
    width: FACET_ICON_SIZE,
  },
  facetList: {
    paddingBottom: spacing.md,
  },
  facetNav: {
    flex: 1,
  },
  facetRow: {
    alignItems: "center",
    columnGap: spacing.sm,
    flexDirection: "row",
    minHeight: FACET_ROW_HEIGHT,
    paddingHorizontal: spacing.sm,
  },
  facetScroll: {
    flex: 1,
  },
  fill: {
    flex: 1,
    minHeight: 0,
  },
  footer: {
    alignItems: "center",
    borderTopWidth: 0,
  },
  header: {
    alignItems: "center",
    minHeight: FACET_ROW_HEIGHT,
  },
  headerActions: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.xs,
  },
  headerButton: {
    alignItems: "center",
    height: controlSize.regular,
    justifyContent: "center",
    width: controlSize.regular,
  },
  headerIdentity: {
    alignItems: "center",
    flex: 1,
    flexDirection: "row",
    gap: spacing.compact,
    minWidth: 0,
  },
  headerTitle: {
    ...typeScale.title,
    color: colors.text,
  },
  inputGroup: {
    marginBottom: spacing.md,
    rowGap: spacing.xs,
  },
  inputHint: {
    ...typeScale.label,
    color: colors.textDim,
  },
  inputLabel: {
    ...typeScale.body,
    color: colors.text,
    fontWeight: typeWeight.semibold,
  },
  intro: {
    ...typeScale.body,
    color: colors.textMuted,
    paddingBottom: spacing.md,
    paddingTop: spacing.sm,
  },
  optionDetail: {
    ...typeScale.label,
    color: colors.textMuted,
  },
  optionRow: {
    alignItems: "center",
    borderBottomColor: colors.borderSoft,
    borderBottomWidth: 1,
    columnGap: spacing.sm,
    flexDirection: "row",
    minHeight: OPTION_ROW_HEIGHT,
    paddingHorizontal: spacing.xs,
  },
  optionTitle: {
    ...typeScale.body,
    color: colors.text,
    flexShrink: 1,
  },
  resetButton: {
    alignItems: "center",
    justifyContent: "center",
    minHeight: controlSize.regular,
    paddingHorizontal: spacing.sm,
  },
  resetText: {
    ...typeScale.body,
    color: colors.textMuted,
  },
  sectionLabel: {
    ...typeScale.label,
    color: colors.textDim,
    letterSpacing: typeTracking.caps,
    paddingTop: spacing.md,
  },
  sheet: {
    alignSelf: "center",
    maxWidth: APP_SHEET_MAX_WIDTH,
    width: "100%",
  },
  suggestion: {
    alignItems: "center",
    borderColor: colors.border,
    borderRadius: radii.pill,
    borderStyle: "dashed",
    borderWidth: 1,
    columnGap: spacing.xxs,
    flexDirection: "row",
    maxWidth: "100%",
    minHeight: TOKEN_HEIGHT,
    paddingHorizontal: spacing.sm,
  },
  suggestions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.xs,
  },
  suggestionText: {
    ...typeScale.caption,
    color: colors.textMuted,
    flexShrink: 1,
    fontWeight: typeWeight.semibold,
  },
  token: {
    alignItems: "center",
    backgroundColor: colors.surfaceContainerHighest,
    borderRadius: radii.pill,
    columnGap: spacing.xxs,
    flexDirection: "row",
    maxWidth: "100%",
    minHeight: TOKEN_HEIGHT,
    paddingLeft: spacing.sm,
    paddingRight: spacing.compact,
  },
  tokenBox: {
    alignItems: "center",
    backgroundColor: colors.surfaceContainer,
    borderColor: colors.border,
    borderRadius: radii.medium,
    borderWidth: 1,
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.xs,
    minHeight: controlSize.touch,
    paddingHorizontal: spacing.xs,
    paddingVertical: spacing.xs,
  },
  tokenInput: {
    ...typeScale.body,
    color: colors.text,
    flexGrow: 1,
    minHeight: TOKEN_HEIGHT,
    minWidth: TOKEN_INPUT_MIN_WIDTH,
    paddingHorizontal: spacing.xs,
    paddingVertical: 0,
  },
  tokenText: {
    ...typeScale.caption,
    color: colors.text,
    flexShrink: 1,
    fontWeight: typeWeight.semibold,
  },
  triState: {
    alignItems: "center",
    borderColor: colors.border,
    borderRadius: radii.small,
    borderWidth: 1,
    height: CHOICE_SIZE,
    justifyContent: "center",
    width: CHOICE_SIZE,
  },
  triStateActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
});
