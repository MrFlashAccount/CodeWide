import type { ReactElement } from "react";
import {
  StyleSheet,
  type StyleProp,
  type View,
  type ViewProps,
  type ViewStyle,
} from "react-native";
import Reanimated, { useAnimatedStyle, type AnimatedRef } from "react-native-reanimated";

import { catalogFrame, destinationFrame } from "./paneFrames";
import type { PaneMotionState } from "./paneMotion";

/**
 * Responsive placement of the left (catalog) pane and the center destination. The two expanded
 * kinds collapse one side while keeping it mounted: the detail covers the catalog, or the catalog
 * is shown alone.
 */
export type WorkspaceTwoPanePresentation =
  | { readonly kind: "catalogOnly" }
  | { readonly kind: "detailOnly" }
  | { readonly kind: "stacked" }
  | { readonly kind: "wideCatalogExpanded" }
  | { readonly kind: "wideDetailExpanded" }
  | { readonly kind: "wide" };

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
  /** The frame view the pane motion measures when a rearrangement starts. */
  readonly frameRef: AnimatedRef<View>;
  readonly frameStyle?: StyleProp<ViewStyle>;
  /** The frame's one pane motion; every pane frame below derives from it. */
  readonly geometry: PaneMotionState;
  readonly presentation: WorkspaceTwoPanePresentation;
  readonly testID?: string;
};

/**
 * Places the catalog and the destination from the frame's pane motion. At rest Yoga lays them out
 * in one row: the catalog at its relative sidebar width and the destination beside it, or over the
 * frame. While panes move the destination lies absolutely, slides by translation and the catalog
 * only dims, so neither relayouts its content per frame. Callers retain navigation, lifetime,
 * interaction and surface ownership.
 */
export function WorkspaceTwoPaneLayout({
  catalog,
  catalogViewProps,
  detail,
  detailStyle,
  detailViewProps,
  frameRef,
  frameStyle,
  geometry,
  presentation,
  testID,
}: WorkspaceTwoPaneLayoutProps): React.JSX.Element {
  const catalogStyle = useAnimatedStyle(() => catalogFrame(geometry));
  const destinationStyle = useAnimatedStyle(() => destinationFrame(geometry));
  return (
    <Reanimated.View ref={frameRef} style={[styles.frame, frameStyle]} testID={testID}>
      <Reanimated.View
        {...catalogViewProps}
        style={[styles.catalog, presentation.kind === "detailOnly" && styles.hidden, catalogStyle]}
      >
        {catalog}
      </Reanimated.View>
      <Reanimated.View
        {...detailViewProps}
        // The pane placement follows the surface style, so the frame owns the destination's box.
        style={[
          detailStyle,
          styles.destination,
          presentation.kind === "catalogOnly" && styles.hidden,
          destinationStyle,
        ]}
      >
        {detail}
      </Reanimated.View>
    </Reanimated.View>
  );
}

const styles = StyleSheet.create({
  // The catalog stretches over the frame height and never yields its width to the destination.
  catalog: {
    flexShrink: 0,
  },
  // In the row the destination takes the rest from a zero basis; absolute, it spans the height.
  destination: {
    bottom: 0,
    flexBasis: 0,
    flexShrink: 1,
    minWidth: 0,
    top: 0,
  },
  frame: {
    flex: 1,
    flexDirection: "row",
    overflow: "hidden",
    position: "relative",
  },
  // A phone presentation that shows one side alone does not lay out the other.
  hidden: {
    display: "none",
  },
});
