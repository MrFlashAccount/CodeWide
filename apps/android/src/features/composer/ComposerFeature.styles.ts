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
import {
  COMPOSER_CHIP_BOTTOM_INSET,
  COMPOSER_DOCK_MIN_HEIGHT,
  COMPOSER_MIN_HEIGHT,
} from "./composerLayout";

export const styles = StyleSheet.create({
  composer: {
    alignItems: "flex-end",
    alignSelf: "stretch",
    flexDirection: "row",
    flexShrink: 0,
    gap: spacing.xs,
    minHeight: COMPOSER_DOCK_MIN_HEIGHT,
    minWidth: 0,
    overflow: "visible",
    paddingBottom: spacing.compact,
    paddingHorizontal: conversationChromeEdgeInset,
    paddingTop: COMPOSER_CHIP_BOTTOM_INSET,
  },
  composerDock: {
    alignSelf: "stretch",
    flexShrink: 0,
    minWidth: 0,
    paddingTop: 0,
  },

  composerError: {
    color: colors.red,
    flex: 1,
    minWidth: 0,
    ...typeScale.label,
  },
  composerErrorRow: {
    alignItems: "center",
    flexDirection: "row",
    minHeight: controlSize.compact,
    paddingHorizontal: conversationChromeEdgeInset,
    paddingTop: spacing.xxs,
  },
  composerInputShell: {
    alignItems: "flex-end",
    flex: 1,
    flexBasis: 0,
    flexDirection: "row",
    flexShrink: 1,
    minHeight: COMPOSER_MIN_HEIGHT,
    minWidth: 0,
    overflow: "visible",
    position: "relative",
    width: 0,
    // The shell paints behind its native editor children. A separate opaque
    // sibling must not participate in their drawing order.
    backgroundColor: colors.surfaceContainerHigh,
    borderColor: colors.border,
    borderRadius: radii.composer,
    borderWidth: 1,
  },
  composerMenu: {
    alignItems: "center",
    borderRadius: radii.composer,
    flexDirection: "row",
    flexShrink: 0,
    height: touchTarget,
    justifyContent: "center",
    width: touchTarget,
  },
  composerMenuActive: { backgroundColor: colors.primaryContainer },
  composerMenuAnchor: {
    flexShrink: 0,
    height: touchTarget,
    width: touchTarget,
  },
  disabled: { opacity: 0.42 },
  pressed: { opacity: 0.68 },
  queuedComposerEditBar: {
    alignItems: "center",
    backgroundColor: colors.surfaceContainerHigh,
    borderColor: colors.border,
    borderRadius: radii.composer,
    borderWidth: 1,
    flexDirection: "row",
    gap: spacing.xxs,
    marginHorizontal: conversationChromeEdgeInset,
    marginTop: spacing.xs,
    minHeight: controlSize.regular,
    paddingLeft: spacing.inputInset,
    paddingRight: spacing.xxs,
  },
  queuedComposerEditClose: {
    alignItems: "center",
    flexShrink: 0,
    height: controlSize.regular,
    justifyContent: "center",
    width: controlSize.regular,
  },
  queuedComposerEditPreview: {
    color: colors.textMuted,
    flex: 1,
    minWidth: 0,
    ...typeScale.caption,
  },

  queuedComposerEditTitle: {
    color: colors.text,
    flexShrink: 0,
    ...typeScale.label,
    fontWeight: typeWeight.semibold,
  },
});
