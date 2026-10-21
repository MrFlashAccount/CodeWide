import { StyleSheet } from "react-native";

import { colors, radii, spacing, touchTarget, typeScale } from "../theme";
import {
  conversationChromeEdgeInset,
  conversationComposerDockMinHeight,
} from "./conversation-chrome-layout";

/**
 * Geometry of a bar that takes the editor's place under the composer's context chips:
 * the composer's row insets and height, and the editor's pill shape, so swapping one
 * for the other moves nothing.
 */
export const composerSlotStyles = StyleSheet.create({
  label: {
    ...typeScale.composerInput,
    color: colors.text,
    flexShrink: 1,
  },
  pill: {
    alignItems: "center",
    backgroundColor: colors.surfaceContainerHigh,
    borderColor: colors.border,
    borderRadius: radii.composer,
    borderWidth: 1,
    flex: 1,
    flexDirection: "row",
    gap: spacing.xs,
    height: touchTarget,
    minWidth: 0,
    paddingHorizontal: spacing.md,
  },
  /** The editor's placeholder tone, for a bar that explains why there is no editor. */
  placeholder: { color: colors.textMuted },
  row: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.xs,
    minHeight: conversationComposerDockMinHeight,
    paddingBottom: spacing.compact,
    paddingHorizontal: conversationChromeEdgeInset,
    paddingTop: spacing.xxs,
  },
});
