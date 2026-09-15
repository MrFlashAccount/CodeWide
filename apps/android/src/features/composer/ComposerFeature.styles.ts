import { StyleSheet } from "react-native";
import {
  colors,
  controlSize,
  radii,
  spacing,
  touchTarget,
  typeScale,
  typeWeight,
} from "../../theme";
import { conversationChromeEdgeInset } from "../../ui/conversation-chrome-layout";
import { COMPOSER_CHIP_BOTTOM_INSET, COMPOSER_MIN_HEIGHT } from "./composerLayout";

export const styles = StyleSheet.create({
  pressed: { opacity: 0.68 },
  composerDock: {
    paddingTop: 0,
    flexShrink: 0,
    minWidth: 0,
    alignSelf: "stretch",
  },

  queuedComposerEditBar: {
    minHeight: controlSize.regular,
    marginHorizontal: conversationChromeEdgeInset,
    marginTop: spacing.xs,
    paddingLeft: spacing.inputInset,
    paddingRight: spacing.xxs,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xxs,
    borderRadius: radii.composer,
    backgroundColor: colors.surfaceContainerHigh,
    borderWidth: 1,
    borderColor: colors.border,
  },
  queuedComposerEditTitle: {
    color: colors.text,
    flexShrink: 0,
    ...typeScale.label,
    fontWeight: typeWeight.semibold,
  },
  queuedComposerEditPreview: {
    color: colors.textMuted,
    flex: 1,
    minWidth: 0,
    ...typeScale.caption,
  },
  queuedComposerEditClose: {
    width: controlSize.regular,
    height: controlSize.regular,
    flexShrink: 0,
    alignItems: "center",
    justifyContent: "center",
  },
  composer: {
    minWidth: 0,
    flexShrink: 0,
    minHeight: touchTarget + COMPOSER_CHIP_BOTTOM_INSET + spacing.compact,
    paddingHorizontal: conversationChromeEdgeInset,
    paddingTop: COMPOSER_CHIP_BOTTOM_INSET,
    paddingBottom: spacing.compact,
    flexDirection: "row",
    alignSelf: "stretch",
    alignItems: "flex-end",
    gap: spacing.xs,
    overflow: "visible",
  },
  composerErrorRow: {
    minHeight: controlSize.compact,
    paddingHorizontal: conversationChromeEdgeInset,
    paddingTop: spacing.xxs,
    flexDirection: "row",
    alignItems: "center",
  },
  composerError: {
    minWidth: 0,
    flex: 1,
    color: colors.red,
    ...typeScale.label,
  },
  composerMenu: {
    width: touchTarget,
    height: touchTarget,
    flexShrink: 0,
    borderRadius: radii.composer,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
  },
  composerMenuActive: { backgroundColor: colors.primaryContainer },
  composerMenuAnchor: {
    width: touchTarget,
    height: touchTarget,
    flexShrink: 0,
  },
  composerInputShell: {
    flex: 1,
    flexBasis: 0,
    flexShrink: 1,
    width: 0,
    minWidth: 0,
    minHeight: COMPOSER_MIN_HEIGHT,
    position: "relative",
    flexDirection: "row",
    alignItems: "flex-end",
    overflow: "visible",
    // The shell paints behind its native editor children. A separate opaque
    // sibling must not participate in their drawing order.
    backgroundColor: colors.surfaceContainerHigh,
    borderRadius: radii.composer,
    borderWidth: 1,
    borderColor: colors.border,
  },

  disabled: { opacity: 0.42 },
});
