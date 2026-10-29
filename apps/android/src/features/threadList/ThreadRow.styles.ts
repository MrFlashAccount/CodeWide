import { StyleSheet } from "react-native";
import { colors, iconSize, radii, typeScale } from "../../theme";
import { threadListLayout } from "../../ui/thread-list-layout";
import { THREAD_LIST_ROW_VERTICAL_MARGIN } from "./threadListModel";

/** The failed-state glyph sits in the title line's glyph box. */
const STATUS_ICON_SLOT = 18;

export const styles = StyleSheet.create({
  selectionBar: { display: "none" },
  sheetTitle: {
    color: colors.text,
    flexShrink: 1,
    minWidth: 0,
    ...typeScale.heading,
  },
  swipeChildren: {
    alignSelf: "stretch",
    backgroundColor: "transparent",
    maxWidth: "100%",
    minWidth: 0,
    width: "100%",
  },
  swipeContainer: {
    alignSelf: "stretch",
    backgroundColor: "transparent",
    borderRadius: radii.selected,
    marginHorizontal: threadListLayout.edgeInset,
    marginVertical: THREAD_LIST_ROW_VERTICAL_MARGIN,
    maxWidth: "100%",
    minWidth: 0,
    overflow: "hidden",
  },
  threadAgentBadge: {
    alignItems: "center",
    flexShrink: 0,
    height: iconSize.indicator,
    justifyContent: "center",
    width: iconSize.indicator,
  },
  threadStatusIcon: {
    alignItems: "center",
    flexShrink: 0,
    height: STATUS_ICON_SLOT,
    justifyContent: "center",
    width: STATUS_ICON_SLOT,
  },
});
