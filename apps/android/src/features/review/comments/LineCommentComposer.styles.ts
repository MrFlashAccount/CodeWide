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
  editorExpanded: {
    flex: 1,
    maxHeight: "100%",
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
  shellExpanded: {
    alignSelf: "stretch",
    justifyContent: "flex-start",
  },
});
