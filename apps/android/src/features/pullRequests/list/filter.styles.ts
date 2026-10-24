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

const ADVANCED_INPUT_HEIGHT = 120;
const CHOICE_SIZE = 22;
const FACET_ICON_SIZE = 34;
const FACET_NAV_WIDTH = 230;
const FACET_ROW_HEIGHT = 58;
const OPTION_ROW_HEIGHT = 54;

export const filterStyles = StyleSheet.create({
  advancedInput: {
    minHeight: ADVANCED_INPUT_HEIGHT,
    textAlignVertical: "top",
  },
  applyButton: {
    alignItems: "center",
    backgroundColor: colors.primary,
    borderRadius: radii.medium,
    justifyContent: "center",
    minHeight: controlSize.regular,
    paddingHorizontal: spacing.lg,
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
  bodyWide: {
    flexDirection: "row",
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
  facetNavWide: {
    borderRightColor: colors.borderSoft,
    borderRightWidth: 1,
    flexBasis: FACET_NAV_WIDTH,
    flexGrow: 0,
  },
  facetRow: {
    alignItems: "center",
    columnGap: spacing.sm,
    flexDirection: "row",
    minHeight: FACET_ROW_HEIGHT,
    paddingHorizontal: spacing.sm,
  },
  facetRowSelected: {
    backgroundColor: colors.surfaceContainerHigh,
    borderRadius: radii.medium,
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
    borderTopColor: colors.borderSoft,
    borderTopWidth: 1,
    flexDirection: "row",
    justifyContent: "space-between",
    paddingBottom: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
  },
  footerSummary: {
    ...typeScale.label,
    color: colors.textMuted,
  },
  header: {
    alignItems: "center",
    borderBottomColor: colors.borderSoft,
    borderBottomWidth: 1,
    flexDirection: "row",
    minHeight: FACET_ROW_HEIGHT,
    paddingHorizontal: spacing.sm,
  },
  headerButton: {
    alignItems: "center",
    height: controlSize.regular,
    justifyContent: "center",
    width: controlSize.regular,
  },
  headerTitle: {
    ...typeScale.title,
    color: colors.text,
    flex: 1,
  },
  input: {
    ...typeScale.body,
    backgroundColor: colors.surfaceContainer,
    borderColor: colors.border,
    borderRadius: radii.medium,
    borderWidth: 1,
    color: colors.text,
    minHeight: controlSize.touch,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.inputInset,
  },
  inputGroup: {
    marginBottom: spacing.md,
    rowGap: spacing.xs,
  },
  inputLabel: {
    ...typeScale.label,
    color: colors.textMuted,
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
    flex: 1,
    minHeight: 0,
    paddingHorizontal: 0,
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
