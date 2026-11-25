import { useContext, type ReactElement } from "react";
import {
  StyleSheet,
  type StyleProp,
  type View,
  type ViewProps,
  type ViewStyle,
} from "react-native";
import Reanimated, {
  useAnimatedProps,
  useAnimatedStyle,
  type AnimatedRef,
  type SharedValue,
} from "react-native-reanimated";

import {
  WorkspaceResizeCheckpoint,
  type WorkspaceResizeTarget,
} from "../native/WorkspaceResizeCheckpoint";
import { useCoveredPaneFocus } from "./useCoveredPaneFocus";
import { PaneDividerShade } from "./PaneDividerShade";
import { catalogFrame, destinationFrame } from "./paneFrames";
import type { PaneMotionState } from "./paneMotion";
import { consumedWorkspaceInsets, WorkspaceSafeInsetsContext } from "./workspaceSafeInsets";

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
  readonly cacheDetailDuring: SharedValue<boolean> | null;
  readonly catalog: ReactElement | null;
  readonly catalogViewProps: WorkspacePaneViewProps;
  readonly detail: ReactElement | null;
  readonly detailStyle?: StyleProp<ViewStyle>;
  readonly detailViewProps: WorkspacePaneViewProps;
  readonly divider?: ReactElement | null;
  /** The frame view the pane motion measures when a rearrangement starts. */
  readonly frameRef: AnimatedRef<View>;
  readonly frameStyle?: StyleProp<ViewStyle>;
  /** The frame's one pane motion; every pane frame below derives from it. */
  readonly geometry: PaneMotionState;
  /** A split clips the rounded surface itself to the safe area. */
  readonly insetDetail: boolean;
  readonly presentation: WorkspaceTwoPanePresentation;
  readonly resizeTarget: WorkspaceResizeTarget;
  readonly testID?: string;
};

/**
 * Places the catalog and the destination from the frame's pane motion. At rest Yoga lays them out
 * in one row: the catalog at its relative sidebar width and the destination beside it, or over the
 * frame. During resize both surfaces lay out at their current widths. Below the catalog minimum,
 * the growing destination covers its stationary neighbour. Callers retain navigation, lifetime,
 * interaction and surface ownership.
 */
export function WorkspaceTwoPaneLayout({
  cacheDetailDuring,
  catalog,
  catalogViewProps,
  detail,
  detailStyle,
  detailViewProps,
  divider,
  frameRef,
  frameStyle,
  geometry,
  insetDetail,
  presentation,
  resizeTarget,
  testID,
}: WorkspaceTwoPaneLayoutProps): React.JSX.Element {
  const catalogRef = useCoveredPaneFocus(presentation.kind === "wideDetailExpanded");
  const windowInsets = useContext(WorkspaceSafeInsetsContext);
  const frameInsets = insetDetail ? windowInsets : consumedWorkspaceInsets;
  const cacheWideDetail = presentation.kind === "wide";
  // Reuse the adjacent pane across tab switches without keeping a GPU texture during normal use.
  const detailLayerProps = useAnimatedProps(() => ({
    renderToHardwareTextureAndroid: cacheWideDetail && cacheDetailDuring?.value === true,
  }));
  const catalogStyle = useAnimatedStyle(() => catalogFrame(geometry));
  const destinationStyle = useAnimatedStyle(() => destinationFrame(geometry));
  return (
    <Reanimated.View
      collapsable={false}
      ref={frameRef}
      style={[styles.frame, frameStyle]}
      testID={testID}
    >
      <Reanimated.View
        {...catalogViewProps}
        ref={catalogRef}
        style={[styles.catalog, presentation.kind === "detailOnly" && styles.hidden, catalogStyle]}
      >
        {catalog}
        <PaneDividerShade geometry={geometry} pane="left" />
      </Reanimated.View>
      <Reanimated.View
        {...detailViewProps}
        animatedProps={detailLayerProps}
        // The pane placement follows the surface style, so the frame owns the destination's box.
        style={[
          detailStyle,
          styles.destination,
          { marginBottom: frameInsets.bottom, marginTop: frameInsets.top },
          presentation.kind === "catalogOnly" && styles.hidden,
          destinationStyle,
        ]}
      >
        <WorkspaceSafeInsetsContext.Provider
          value={insetDetail ? consumedWorkspaceInsets : windowInsets}
        >
          {detail}
        </WorkspaceSafeInsetsContext.Provider>
      </Reanimated.View>
      {divider}
      <WorkspaceResizeCheckpoint target={resizeTarget} />
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
