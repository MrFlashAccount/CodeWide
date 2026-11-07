import { StyleSheet } from "react-native";

import { colors, radii, spacing } from "../theme";
import { ROW_ACTION_PRESSED_OPACITY } from "./RowActionTrigger.types";
import { threadListLayout } from "./thread-list-layout";

/** A catalog row has one vertical margin above and one below its card. */
const VERTICAL_MARGIN_COUNT = 2;

/**
 * Outer height of one catalog row cell (card plus its vertical margins). Every
 * catalog list sizes or estimates its virtualized row cells with this value.
 */
export const CATALOG_ROW_CELL_HEIGHT =
  threadListLayout.rowContentHeight + threadListLayout.rowVerticalMargin * VERTICAL_MARGIN_COUNT;

/**
 * Card geometry of a catalog row (Threads, Pull requests). Each list keeps its
 * own activation mechanism and applies these frame styles to it, so row size,
 * insets, selection and pressed feedback are identical across catalogs.
 */
export const catalogRowFrameStyles = StyleSheet.create({
  frame: {
    alignItems: "center",
    alignSelf: "stretch",
    borderRadius: radii.selected,
    flexDirection: "row",
    gap: spacing.xs,
    height: threadListLayout.rowContentHeight,
    marginHorizontal: threadListLayout.edgeInset,
    marginVertical: threadListLayout.rowVerticalMargin,
    maxWidth: "100%",
    minWidth: 0,
    paddingHorizontal: spacing.xs,
    paddingVertical: spacing.compact,
    position: "relative",
  },
  pressed: { opacity: ROW_ACTION_PRESSED_OPACITY },
  selected: { backgroundColor: colors.secondaryContainer },
  // A swipeable wrapper owns the card margins; the frame paints its own surface.
  swipeChild: {
    backgroundColor: colors.threadListSurface,
    borderRadius: radii.selected,
    marginHorizontal: 0,
    marginVertical: 0,
  },
});
