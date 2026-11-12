import { StyleSheet } from "react-native";

import { colors, controlSize, radii, spacing, typeScale } from "../../../theme";
import { conversationChromeEdgeInset } from "../../../ui/conversation-chrome-layout";
import {
  COMPOSER_MAX_HEIGHT,
  COMPOSER_MIN_HEIGHT,
  COMPOSER_TEXT_INSET,
} from "../../composer/composerLayout";

/** The chat composer's input row, under an anchor row like a reply quote. */
export const lineCommentComposerStyles = StyleSheet.create({
  actionBar: {
    alignItems: "center",
    borderTopColor: colors.border,
    borderTopWidth: StyleSheet.hairlineWidth,
    columnGap: spacing.xs,
    flexDirection: "row",
    paddingTop: spacing.xs,
  },
  actionBarLead: {
    alignItems: "flex-start",
    flex: 1,
  },
  anchor: {
    ...typeScale.label,
    color: colors.textMuted,
    flex: 1,
    minWidth: 0,
  },
  anchorRow: {
    alignItems: "center",
    columnGap: spacing.xs,
    flexDirection: "row",
    minHeight: controlSize.compact,
    paddingLeft: spacing.xs,
  },
  editor: {
    ...typeScale.composerInput,
    color: colors.text,
    maxHeight: COMPOSER_MAX_HEIGHT,
    paddingHorizontal: spacing.sm,
    paddingVertical: COMPOSER_TEXT_INSET,
  },
  // The native editor draws its text from the top; filling the shell keeps the
  // placeholder and the first line at the top-left, and long text scrolls inside.
  editorExpanded: {
    height: "100%",
    maxHeight: "100%",
    paddingHorizontal: spacing.xs,
    paddingVertical: spacing.sm,
  },
  error: {
    ...typeScale.label,
    color: colors.red,
    paddingHorizontal: spacing.xs,
  },
  expanded: {
    flex: 1,
  },
  iconButton: {
    alignItems: "center",
    height: controlSize.compact,
    justifyContent: "center",
    width: controlSize.compact,
  },
  inputRow: {
    alignItems: "flex-end",
    columnGap: spacing.xs,
    flexDirection: "row",
  },
  inputShell: {
    backgroundColor: colors.surfaceContainerHigh,
    borderColor: colors.border,
    borderRadius: radii.composer,
    borderWidth: 1,
    flex: 1,
    justifyContent: "center",
    minHeight: COMPOSER_MIN_HEIGHT,
    minWidth: 0,
  },
  panel: {
    borderTopColor: colors.border,
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: conversationChromeEdgeInset,
    paddingTop: spacing.xxs,
    rowGap: spacing.xxs,
  },
  quote: {
    alignItems: "center",
    backgroundColor: colors.surfaceContainer,
    borderBottomRightRadius: radii.compact,
    borderLeftWidth: spacing.optical,
    borderTopRightRadius: radii.compact,
    columnGap: spacing.xs,
    flexDirection: "row",
    paddingHorizontal: spacing.xs,
    paddingVertical: spacing.xxs,
  },
  quoteCode: {
    ...typeScale.code,
    color: colors.text,
    flex: 1,
    minWidth: 0,
  },
  quoteNew: {
    borderLeftColor: colors.green,
  },
  quoteNumber: {
    ...typeScale.code,
    color: colors.textDim,
  },
  quoteOld: {
    borderLeftColor: colors.red,
  },
  shellExpanded: {
    alignSelf: "stretch",
    backgroundColor: "transparent",
    borderRadius: 0,
    borderWidth: 0,
    justifyContent: "flex-start",
  },
  submit: {
    alignItems: "center",
    backgroundColor: colors.primary,
    borderRadius: radii.pill,
    height: controlSize.regular,
    justifyContent: "center",
    paddingHorizontal: spacing.md,
  },
  submitDisabled: {
    backgroundColor: colors.surfaceContainerHigh,
  },
  submitLabel: {
    ...typeScale.title,
    color: colors.onPrimary,
  },
  submitLabelDisabled: {
    color: colors.textDim,
  },
  submitPressed: {
    backgroundColor: colors.primaryPressed,
  },
});
