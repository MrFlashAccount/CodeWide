import type { ReactElement } from "react";
import {
  StyleSheet,
  View,
  type LayoutChangeEvent,
  type StyleProp,
  type ViewProps,
  type ViewStyle,
} from "react-native";
import Reanimated, { useAnimatedStyle } from "react-native-reanimated";

import { useEvent } from "../react/useEvent";
import { currentPaneGeometry, type PaneMotionState } from "./paneMotion";

/**
 * Responsive placement of the left (catalog) pane and the center destination. The two expanded
 * kinds collapse one side while keeping it mounted: the detail covers the catalog, or the catalog
 * is shown alone.
 */
export type WorkspaceTwoPanePresentation =
  | { readonly kind: "catalogOnly" }
  | { readonly kind: "detailOnly" }
  | { readonly kind: "stacked" }
  | { readonly kind: "wideCatalogExpanded"; readonly viewportWidth: number }
  | { readonly kind: "wideDetailExpanded"; readonly viewportWidth: number }
  | { readonly kind: "wide"; readonly viewportWidth: number };

type WorkspacePaneViewProps = Pick<
  ViewProps,
  | "accessibilityElementsHidden"
  | "aria-hidden"
  | "collapsable"
  | "importantForAccessibility"
  | "onLayout"
  | "pointerEvents"
  | "testID"
>;

type WorkspaceTwoPaneLayoutProps = {
  readonly catalog: ReactElement | null;
  readonly catalogViewProps: WorkspacePaneViewProps;
  readonly detail: ReactElement | null;
  readonly detailStyle?: StyleProp<ViewStyle>;
  readonly detailViewProps: WorkspacePaneViewProps;
  readonly frameStyle?: StyleProp<ViewStyle>;
  /** The frame's one pane motion; every pane frame below derives from it. */
  readonly geometry: PaneMotionState;
  readonly presentation: WorkspaceTwoPanePresentation;
  readonly testID?: string;
};

/**
 * Places the catalog and the destination from the frame's pane geometry. Both are absolutely
 * positioned: the destination slides by translation and the catalog only dims, so neither
 * relayouts its content while panes move. Callers retain navigation, lifetime, interaction and
 * surface ownership.
 */
export function WorkspaceTwoPaneLayout({
  catalog,
  catalogViewProps,
  detail,
  detailStyle,
  detailViewProps,
  frameStyle,
  geometry,
  presentation,
  testID,
}: WorkspaceTwoPaneLayoutProps): React.JSX.Element {
  const onFrameLayout = useEvent((event: LayoutChangeEvent): void => {
    geometry.frameWidth.set(event.nativeEvent.layout.width);
  });
  const catalogFrame = useAnimatedStyle(() => {
    const pane = currentPaneGeometry(geometry);
    return { opacity: pane.catalogOpacity, width: pane.catalogWidth };
  });
  const detailFrame = useAnimatedStyle(() => {
    const pane = currentPaneGeometry(geometry);
    return {
      borderBottomLeftRadius: pane.centerLeftRadius,
      borderTopLeftRadius: pane.centerLeftRadius,
      transform: [{ translateX: pane.detailX }],
      width: pane.detailWidth,
    };
  });
  return (
    <View onLayout={onFrameLayout} style={[styles.frame, frameStyle]} testID={testID}>
      <Reanimated.View
        {...catalogViewProps}
        style={[styles.pane, presentation.kind === "detailOnly" && styles.hidden, catalogFrame]}
      >
        {catalog}
      </Reanimated.View>
      <Reanimated.View
        {...detailViewProps}
        // The pane placement follows the surface style so the destination stays absolute.
        style={[
          detailStyle,
          styles.pane,
          presentation.kind === "catalogOnly" && styles.hidden,
          detailFrame,
        ]}
      >
        {detail}
      </Reanimated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  frame: {
    flex: 1,
    overflow: "hidden",
    position: "relative",
  },
  // A phone presentation that shows one side alone does not lay out the other.
  hidden: {
    display: "none",
  },
  pane: {
    bottom: 0,
    left: 0,
    position: "absolute",
    top: 0,
  },
});
