import type { ReactNode } from "react";
import type { StyleProp, ViewStyle } from "react-native";
import Reanimated, { useAnimatedStyle } from "react-native-reanimated";

import { useThreePanels } from "./threePanels";

/**
 * Pane chrome: a header, search bar or bottom bar spanning its pane. While panes rearrange it
 * lays out to the width the pane shows on every frame, on the UI thread, so its trailing controls
 * ride the pane's visible edge and its text reflows instead of being clipped and then jumping
 * when the pane settles. It must be a stretched child spanning the pane's content box; content
 * opts in by rendering its chrome inside it (or through `ThreePanelsHeader`, which does).
 */
export function PaneChrome({
  children,
  pointerEvents,
  style,
  testID,
}: {
  readonly children: ReactNode;
  readonly pointerEvents?: "auto" | "box-none";
  /** Placement of the chrome box itself, such as an absolute fill over the pane. */
  readonly style?: StyleProp<ViewStyle>;
  readonly testID?: string;
}): React.JSX.Element {
  const { chromeInset } = useThreePanels();
  // The trailing margin belongs to the wrapper alone, so content styles never fight over it.
  const follow = useAnimatedStyle(() => ({ marginRight: chromeInset.get() }));
  return (
    <Reanimated.View pointerEvents={pointerEvents} style={[style, follow]} testID={testID}>
      {children}
    </Reanimated.View>
  );
}
