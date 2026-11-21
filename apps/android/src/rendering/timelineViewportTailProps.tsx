import type { LegendListProps } from "@legendapp/list/react-native";
import { Platform, requireNativeComponent, StyleSheet, View, type ViewProps } from "react-native";
import Animated from "react-native-reanimated";

const ScrollHost =
  Platform.OS === "android"
    ? requireNativeComponent<ViewProps & { endThresholdRatio: number }>(
        "CodeWideTimelineScrollHost",
      )
    : View;

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
      <ScrollHost endThresholdRatio={maintainScrollAtEndThreshold} style={styles.viewport}>
        <Animated.ScrollView {...props} />
      </ScrollHost>
    ),
  };
}

const styles = StyleSheet.create({
  content: {
    flexGrow: 1,
    minHeight: 0,
  },
  viewport: {
    flex: 1,
  },
});
