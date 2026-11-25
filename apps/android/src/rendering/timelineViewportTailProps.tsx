import type { LegendListProps } from "@legendapp/list/react-native";
import { StyleSheet } from "react-native";
import { TimelineScrollViewport } from "./TimelineScrollViewport";

type ResizeProps = Pick<
  LegendListProps<unknown>,
  | "contentContainerStyle"
  | "maintainScrollAtEnd"
  | "maintainScrollAtEndThreshold"
  | "renderScrollComponent"
>;

/** Native layout follows the tail on resize; LegendList still follows changes to its content. */
export function timelineViewportTailProps({
  contentContainerStyle,
  maintainScrollAtEnd,
  maintainScrollAtEndThreshold,
  renderScrollComponent,
}: ResizeProps): ResizeProps {
  if (
    maintainScrollAtEnd !== true ||
    maintainScrollAtEndThreshold === undefined ||
    renderScrollComponent !== undefined
  ) {
    return {};
  }
  return {
    // An explicit minHeight selects LegendList's flex-end layout for short transcripts.
    // Its JS-sized alignment spacer would otherwise resize separately from the keyboard.
    contentContainerStyle: [contentContainerStyle, styles.content],
    maintainScrollAtEnd: { on: { dataChange: true, footerLayout: true, itemLayout: true } },
    renderScrollComponent: (props) => (
      <TimelineScrollViewport scrollProps={props} threshold={maintainScrollAtEndThreshold} />
    ),
  };
}

const styles = StyleSheet.create({
  content: {
    flexGrow: 1,
    minHeight: 0,
  },
});
