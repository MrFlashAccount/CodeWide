import { StyleSheet } from "react-native";
import { colors, controlSize, radii, spacing, typeScale } from "../../../theme";

const QUESTION_MAX_WIDTH = 640;
const DISABLED_OPACITY = 0.45;
const QUESTION_NUMBER_SIZE = 24;
const CUSTOM_ANSWER_MIN_WIDTH = 160;
const CUSTOM_ANSWER_MAX_HEIGHT = 120;

export const styles = StyleSheet.create({
  action: {
    alignItems: "center",
    justifyContent: "center",
    minHeight: controlSize.compact,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xxs,
  },
  actions: {
    alignItems: "center",
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.xs,
    justifyContent: "flex-end",
    marginLeft: "auto",
  },
  card: {
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
    borderRadius: radii.medium,
    borderWidth: 1,
    gap: spacing.xs,
    maxWidth: QUESTION_MAX_WIDTH,
    padding: spacing.xs,
    width: "100%",
  },
  choices: { gap: spacing.xxs },
  close: {
    alignItems: "center",
    borderRadius: radii.pill,
    height: controlSize.compact,
    justifyContent: "center",
    width: controlSize.compact,
  },
  custom: {
    alignItems: "center",
    flex: 1,
    flexBasis: CUSTOM_ANSWER_MIN_WIDTH,
    flexDirection: "row",
    gap: spacing.xs,
    minWidth: CUSTOM_ANSWER_MIN_WIDTH,
  },
  description: {
    ...typeScale.label,
    color: colors.textMuted,
  },
  disabled: { opacity: DISABLED_OPACITY },
  dock: {
    alignSelf: "center",
    maxWidth: QUESTION_MAX_WIDTH,
    paddingBottom: spacing.xs,
    paddingHorizontal: spacing.compact,
    width: "100%",
  },
  error: {
    ...typeScale.label,
    color: colors.error,
  },
  footer: {
    alignItems: "center",
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.xs,
    paddingHorizontal: spacing.xs,
    paddingVertical: spacing.xxs,
  },
  header: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.xs,
    paddingLeft: spacing.xs,
  },
  input: {
    ...typeScale.label,
    color: colors.text,
    flex: 1,
    maxHeight: CUSTOM_ANSWER_MAX_HEIGHT,
    minHeight: controlSize.compact,
    minWidth: 0,
    paddingHorizontal: 0,
    paddingVertical: spacing.xs,
    textAlignVertical: "center",
  },
  label: {
    ...typeScale.label,
    color: colors.textMuted,
    flex: 1,
  },
  muted: {
    ...typeScale.label,
    color: colors.textMuted,
  },
  number: {
    alignItems: "center",
    backgroundColor: colors.surfaceContainerHigh,
    borderColor: colors.border,
    borderRadius: radii.pill,
    borderWidth: 1,
    flexShrink: 0,
    height: QUESTION_NUMBER_SIZE,
    justifyContent: "center",
    width: QUESTION_NUMBER_SIZE,
  },
  numberText: {
    ...typeScale.label,
    color: colors.textMuted,
  },
  option: {
    alignItems: "center",
    borderRadius: radii.small,
    flexDirection: "row",
    gap: spacing.xs,
    minHeight: controlSize.regular,
    paddingHorizontal: spacing.xs,
    paddingVertical: spacing.xs,
  },
  optionBody: {
    flex: 1,
    gap: spacing.optical,
    minWidth: 0,
  },
  optionText: {
    ...typeScale.label,
    color: colors.text,
  },
  primary: {
    backgroundColor: colors.primary,
    borderRadius: radii.pill,
  },
  primaryText: {
    ...typeScale.label,
    color: colors.onPrimary,
  },
  question: {
    ...typeScale.body,
    color: colors.text,
    paddingHorizontal: spacing.xs,
  },
  secondary: {
    borderColor: colors.border,
    borderRadius: radii.pill,
    borderWidth: 1,
  },
  selected: { backgroundColor: colors.surfaceContainerHigh },
});
